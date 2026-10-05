// In-race client view: synchronized Oni intro and countdown, local prediction + reconciliation,
// remote interpolation, actors, crowd, weather/VFX, chase camera, HUD, input and audio.
import * as THREE from 'three';
import { CRASH_RECOVERY, INTRO, LARGE_PUDDLE, NETWORK, RACE, SIM_DT, SPEED, introTotalDuration } from '../config/gameplay.js';
import { WEAPONS } from '../config/weapons.js';
import { getTrack, type Track } from '../game/track/Track.js';
import type { RaceEvent } from '../game/sim/RaceSim.js';
import { CrashWorld } from '../physics/CrashWorld.js';
import type { AttackId, RiderState } from '../shared/ids.js';
import { packInput } from '../shared/inputPack.js';
import type { OwnStateMsg, RaceParticipant, RaceStartMsg } from '../shared/protocol.js';
import { decodeSnapshot, type PlayerSnap } from '../shared/snapshot.js';
import { clamp, damp, smoothstep } from '../shared/math.js';
import { Interpolator, type Interpolated } from '../network/Interpolation.js';
import { Prediction } from '../network/Prediction.js';
import { InputManager } from '../input/InputManager.js';
import { TouchControls } from '../input/TouchControls.js';
import type { BikeActor } from '../render/actors/BikeActor.js';
import { Crowd } from '../render/actors/Crowd.js';
import type { OniIntro } from '../render/actors/OniIntro.js';
import type { RiderActor, RiderFrame } from '../render/actors/RiderActor.js';
import { ChaseCamera } from '../render/camera/ChaseCamera.js';
import type { LightEmitter } from '../render/world/TrackMeshes.js';
import type { World } from '../render/world/World.js';
import { CLIP_IDS } from '../config/assets.js';
import { Hud } from '../ui/Hud.js';
import { settings } from './settings.js';
import type { App, View } from './App.js';
import { heroLayout } from './HeroView.js';

const RIDING: ReadonlySet<RiderState> = new Set(['RIDING', 'ATTACKING', 'KICKING', 'DESTABILIZED']);
const MOUNTED: ReadonlySet<RiderState> = new Set([...RIDING, 'GRID', 'FINISHED', 'RECOVERY_PENALTY', 'DISCONNECTED']);

interface Racer {
  p: RaceParticipant;
  me: boolean;
  bike: BikeActor;
  rider: RiderActor;
  interp: Interpolator;
  last: PlayerSnap | null;
  label: THREE.Sprite;
  sprayAcc: number;
  localAttack: { id: AttackId; t: number; side: number } | null;
  pos: THREE.Vector3;
  yaw: number;
  speed: number;
  state: RiderState;
  /** Race-intro prelude: 'stand' beside the parked bike (as on the READY screen), 'mount', done. */
  prelude: 'stand' | 'mount' | 'done';
}

/**
 * READY -> race: riders start standing beside their parked bikes exactly as on the READY screen,
 * then swing on and settle into the grid pose while the camera leaves the hero framing for the
 * intro sweep. Times are intro time (tau: seconds from the synchronized intro start).
 */
const MOUNT_PRELUDE = { start: -0.7, end: 0.75, cameraHold: 0.6 } as const;

function nameSprite(name: string, color: string): THREE.Sprite {
  const c = document.createElement('canvas');
  c.width = 256;
  c.height = 64;
  const g = c.getContext('2d')!;
  g.font = '900 34px Arial Black, Impact, sans-serif';
  g.textAlign = 'center';
  g.textBaseline = 'middle';
  g.lineWidth = 6;
  g.strokeStyle = 'rgba(0,0,0,0.75)';
  g.strokeText(name, 128, 32, 240);
  g.fillStyle = color;
  g.fillText(name, 128, 32, 240);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  const s = new THREE.Sprite(new THREE.SpriteMaterial({ map: t, depthTest: true, depthWrite: false, transparent: true, fog: true }));
  s.scale.set(2.2, 0.55, 1);
  s.renderOrder = 30;
  return s;
}

export class RaceClient implements View {
  private app: App;
  private start: RaceStartMsg;
  private track: Track;
  private world: World;
  private physics: CrashWorld;
  private racers = new Map<number, Racer>();
  private me: Racer | null = null;
  private prediction: Prediction | null = null;
  private input: InputManager;
  private touch: TouchControls | null = null;
  private chase: ChaseCamera;
  private camera: THREE.PerspectiveCamera;
  private oni: OniIntro | null = null;
  private crowd: Crowd | null = null;
  private hud: Hud;
  private own: OwnStateMsg | null = null;
  private raceState = 'INTRO';
  private acc = 0;
  private sendAcc = 0;
  private offs: (() => void)[] = [];
  private lastCount = -1;
  private flares: THREE.Vector3[] = [];
  private frameTimes: number[] = [];
  private scaleTimer = 0;
  private finishedShown = false;
  private disposed = false;
  private intro: boolean = true;
  private handedOver = false;
  /** The race scene's shaders compile in parallel before the first frame is drawn. */
  private shadersReady = false;
  private readonly shaderWaitStart = performance.now();

  get raceId(): number {
    return this.start.raceId;
  }

  /** Screen-width fraction the READY hero was framed right of the UI (continuity at race start). */
  private heroShift = 0;

  constructor(app: App, start: RaceStartMsg, handoff: { viewShift: number } | null = null) {
    this.app = app;
    this.heroShift = handoff?.viewShift ?? 0;
    this.start = start;
    this.track = getTrack();
    this.world = app.world!;
    this.world.resetCameraHint(null);
    this.physics = new CrashWorld(this.track);
    const lib = app.library!;
    const scene = this.world.scene;
    for (const p of start.participants) {
      const bike = lib.createBike(p.loadout.bikeId, p.loadout.bikeColor);
      const rider = lib.createRider(p.loadout.riderId, p.loadout.riderColor, p.loadout.weaponId);
      if (!bike || !rider) {
        app.fatal('Race assets unavailable', [`Could not build ${p.loadout.bikeId} / ${p.loadout.riderId}. Run npm run assets:build on the host.`]);
        continue;
      }
      scene.add(bike.root);
      if (rider.weapon) scene.add(rider.weapon.trailMesh);
      const me = p.id === app.net.playerId;
      const label = nameSprite(p.name, me ? '#ff2bd6' : '#ffffff');
      label.visible = !me;
      scene.add(label);
      const g = this.track.grid[p.slot]!;
      const gp = this.track.pointAt(g.s, g.lateral, 0);
      const racer: Racer = { p, me, bike, rider, interp: new Interpolator(), last: null, label, sprayAcc: 0, localAttack: null, pos: new THREE.Vector3(gp.x, gp.y, gp.z), yaw: this.track.headingAt(g.s), speed: 0, state: 'GRID', prelude: 'done' };
      // Joining at the start (not a mid-race reconnect): begin beside the bike, as on READY.
      if ((app.net.serverNow() - start.introStartTime) / 1000 < MOUNT_PRELUDE.start) {
        const L = heroLayout(this.track, p.slot);
        racer.prelude = 'stand';
        rider.setShowcase(scene, L.riderPos, L.riderYaw, 'hero');
      }
      bike.setRiding(racer.pos, racer.yaw, 0, 0);
      bike.root.updateMatrixWorld(true);
      this.racers.set(p.id, racer);
      if (me) {
        this.me = racer;
        this.prediction = new Prediction(p.loadout.bikeId, this.track);
      }
    }
    // Oni lands safely ahead of the front row, facing the grid.
    const landing = this.track.pointAt(8, 0, 0);
    this.oni = lib.createOni(new THREE.Vector3(landing.x, landing.y, landing.z), this.track.headingAt(8) + Math.PI);
    if (this.oni) scene.add(this.oni.root);
    // Crowd: suppress exact racer appearances nearby / on the grid.
    const cfg = app.core.cfg;
    const models = lib.crowdModels();
    if (models.length) {
      this.crowd = new Crowd(
        this.track,
        models,
        { clap: lib.canonical(CLIP_IDS.cheerClap), walk: lib.canonical(CLIP_IDS.walk) },
        { near: cfg.crowdNear, mid: cfg.crowdMid, far: cfg.crowdFar },
        start.crowdSuppress,
        app.core.preset === 'MOBILE' ? 0.55 : app.core.preset === 'MEDIUM' ? 0.8 : 1,
      );
      this.crowd.build(app.core.renderer);
      scene.add(this.crowd.group);
    }
    for (const row of [0, 2, 4]) for (const side of [-1, 1]) {
      const s = this.track.wrapS(-RACE.gridFrontOffset - row * RACE.gridRowSpacing);
      const p = this.track.pointAt(s, side * (this.track.barrierOffsetAt(s) + 0.3), 1.2);
      this.flares.push(new THREE.Vector3(p.x, p.y, p.z));
    }

    this.chase = new ChaseCamera(cfg.drawDistance);
    this.camera = this.chase.camera;
    this.input = new InputManager(app.device.mobile, app.device.mobile ? app.mobileEntry.gyro : null);
    this.input.keyboard.onCheatPhrase = (phrase) => app.net.socket.emit('cheat', { phrase });
    this.input.keyboard.onPause = () => app.openSettings(true);
    this.hud = new Hud(this.track, app.device.mobile);
    app.show(null);
    app.ui.appendChild(this.hud.el);
    if (app.device.mobile) {
      this.touch = new TouchControls();
      this.touch.onPause = () => app.openSettings(true);
      this.input.touch = this.touch;
      app.ui.appendChild(this.touch.el);
      this.offs.push(app.mobileEntry.watchOrientation(app.ui));
      if (!app.mobileEntry.gyro.available) this.touch.setSteeringZones(true);
    }
    this.offs.push(app.net.on('snap', (m) => this.onSnap(m.buf, m.own, m.events)));
    this.offs.push(app.net.on('cheatResult', (r) => {
      if (r.ok) {
        this.input.keyboard.cheatActive = true;
        this.hud.message(`BOOST ×${r.charges}`, 1.6);
        app.audio.play('boost');
      }
    }));
    this.world.env.onThunder = (k) => app.audio.play('thunder', k);
    // Compile every shader variant of the race scene (racers, crowd, Oni, labels) off the main
    // thread during the intro lead-in, instead of stalling on the first rendered frame.
    this.world.reflectionPaused = true;
    app.core
      .precompile(this.world.scene, this.camera, this.world.passes())
      .catch((e) => console.warn('[race] shader precompile incomplete', e))
      .finally(() => {
        this.shadersReady = true;
        this.world.reflectionPaused = false;
      });
  }

  /** True once shaders are ready (or after a bounded wait on drivers without parallel compile). */
  private get drawable(): boolean {
    if (!this.shadersReady && performance.now() - this.shaderWaitStart > 6000) {
      this.shadersReady = true;
      this.world.reflectionPaused = false;
    }
    return this.shadersReady;
  }

  // ------------------------------------------------------------------------------ network
  private onSnap(buf: ArrayBuffer, own: OwnStateMsg | null, events: string): void {
    if (this.disposed) return;
    const { header, players } = decodeSnapshot(buf);
    this.raceState = header.raceState;
    for (const p of players) {
      const r = this.racers.get(p.id);
      if (!r) continue;
      r.interp.push(header.serverTime, p);
      r.last = p;
    }
    if (own && this.prediction) {
      this.own = own;
      this.prediction.reconcile(own, RIDING.has(own.state));
      if (this.input.keyboard.cheatActive !== own.cheatActive && own.cheatActive) this.input.keyboard.cheatActive = true;
      // Adopt the authoritative attack if ours diverged.
      const me = this.me;
      if (me) {
        if (own.attackId && (!me.localAttack || me.localAttack.id !== own.attackId || Math.abs(me.localAttack.t - own.attackTime) > 0.12)) me.localAttack = { id: own.attackId as AttackId, t: own.attackTime, side: own.attackSide };
        if (!own.attackId && me.localAttack && me.localAttack.t > 0.25) me.localAttack = null;
      }
    }
    let list: RaceEvent[] = [];
    try {
      list = JSON.parse(events) as RaceEvent[];
    } catch {
      list = [];
    }
    for (const e of list) this.onEvent(e);
  }

  private racerPos(id: number): THREE.Vector3 | null {
    return this.racers.get(id)?.pos ?? null;
  }

  private onEvent(e: RaceEvent): void {
    const meId = this.app.net.playerId;
    const a = this.app.audio;
    const vfx = this.world.particles;
    switch (e.t) {
      case 'hit': {
        vfx.burstSparks(e.x, e.y, e.z, 26);
        a.play('hit', e.a === meId || e.b === meId ? 1 : 0.5);
        if (e.b === meId) {
          this.chase.shake(0.55);
          this.app.core.flash = Math.max(this.app.core.flash, 0.08);
        }
        break;
      }
      case 'swing':
        a.play('swish', e.a === meId ? 0.9 : 0.35);
        break;
      case 'crash': {
        const p = this.racerPos(e.id);
        if (p) vfx.burstSparks(p.x, p.y + 0.5, p.z, 40);
        a.play('impact', e.id === meId ? 1 : 0.5);
        if (e.id === meId) {
          this.chase.shake(1.1);
          this.hud.message(e.reason === 'water' || e.reason === 'fell' ? 'LOST IT' : 'CRASH!', 1.6);
        }
        break;
      }
      case 'scrape': {
        const r = this.racers.get(e.id);
        if (r) {
          const side = new THREE.Vector3(-Math.cos(r.yaw), 0, Math.sin(r.yaw)).multiplyScalar(e.side * 0.5);
          vfx.burstSparks(r.pos.x + side.x, r.pos.y + 0.4, r.pos.z + side.z, Math.ceil(6 * e.k), side.x, side.z);
          if (e.id === meId) {
            this.chase.shake(0.12 * e.k);
            a.play('scrape', e.k);
          }
        }
        break;
      }
      case 'splash': {
        const r = this.racers.get(e.id);
        if (r) vfx.splash(r.pos.x, r.pos.y, r.pos.z, Math.sin(r.yaw) * r.speed, Math.cos(r.yaw) * r.speed, e.size === 2 ? 1.6 : 0.7);
        // Our own hit is presented immediately from local prediction (below); only fall back here.
        if (e.id === meId && e.size === 2 && !this.prediction && r) this.lensSplash(r.speed);
        break;
      }
      case 'land':
        if (e.v > 3) {
          const p = this.racerPos(e.id);
          if (p) vfx.burstSparks(p.x, p.y + 0.1, p.z, Math.ceil(e.v * 3));
          if (e.id === meId) {
            this.chase.shake(Math.min(0.8, e.v / 8));
            this.chase.land(e.v);
          }
          // Tyres hitting the wet deck throw spray outward.
          const r = this.racers.get(e.id);
          if (r) vfx.splash(r.pos.x, r.pos.y, r.pos.z, Math.sin(r.yaw) * r.speed, Math.cos(r.yaw) * r.speed, Math.min(1.4, e.v / 5));
        }
        break;
      case 'launch':
        if (e.id === meId) this.chase.shake(0.2);
        break;
      case 'bump':
        if (e.band !== 'bump') vfx.burstSparks(e.x, e.y, e.z, e.band === 'crash' ? 30 : 12);
        if (e.a === meId || e.b === meId) {
          this.chase.shake(e.band === 'bump' ? 0.1 : 0.4);
          a.play('impact', e.band === 'bump' ? 0.25 : 0.6);
        }
        break;
      case 'lap':
        if (e.id === meId) {
          const next = e.lap + 1;
          this.hud.message(next === e.laps ? `FINAL LAP ${next}/${e.laps}` : `LAP ${next}/${e.laps}`, 1.8);
          a.play('ui', 0.6);
        }
        break;
      case 'checkpoint':
        if (e.id === meId) this.hud.message(`CHECKPOINT ${e.index}/${this.track.checkpoints.length}`, 1.1);
        break;
      case 'wrongGate':
        if (e.id === meId) this.hud.message('MISSED THE GATE', 1.4);
        break;
      case 'finish': {
        if (e.id === meId) {
          this.finishedShown = true;
          this.hud.message(`FINISHED · ${ordinal(e.position)}`, 4);
          a.play('crowd', 1);
        }
        break;
      }
      case 'boost':
        if (e.id === meId) a.play('boost');
        break;
      case 'cheat':
        if (e.id === meId) this.hud.message(`BOOST ×${e.charges}`, 1.6);
        break;
      case 'recovered':
        if (e.id === meId) this.hud.message(e.penalty ? 'BACK ON TRACK' : 'GO GO GO', 1.2);
        break;
      case 'dnf':
        if (e.id === meId) this.hud.message('DNF', 3);
        break;
      default:
        break;
    }
  }

  /**
   * Large-puddle hit on our own bike: the splash sound always; the full-screen splash sheet only
   * for a genuinely fast hit (never from rain or small puddles), stronger the faster we were.
   */
  private lensSplash(speed: number): void {
    this.app.audio.play('splash', 1);
    if (speed < LARGE_PUDDLE.sheetSpeed) return;
    this.app.core.water.splash(0.55 + 0.45 * Math.min(1, (speed - LARGE_PUDDLE.sheetSpeed) / 25));
  }

  // ------------------------------------------------------------------------------ per frame
  private introTau(): number {
    return (this.app.net.serverNow() - this.start.introStartTime) / 1000;
  }

  update(dt: number, time: number): void {
    const net = this.app.net;
    const serverNow = net.serverNow();
    const tau = this.introTau();
    const goT = introTotalDuration();
    const controls = serverNow >= this.start.goTime;

    // Fixed 60 Hz prediction ticks, inputs sent at 30 Hz (unacked inputs resent for robustness).
    this.acc = Math.min(this.acc + dt, 0.25);
    while (this.acc >= SIM_DT) {
      this.acc -= SIM_DT;
      const input = this.input.sample(SIM_DT);
      const me = this.me;
      if (me && (input.kick || input.attack) && controls && !me.localAttack && RIDING.has(me.state)) {
        me.localAttack = { id: input.kick ? 'KICK' : me.p.loadout.weaponId, t: 0, side: 1 };
      }
      // N with no charges left does nothing (a brief, subtle HUD note; queued presses are dropped).
      if (input.boost && this.prediction && this.prediction.boostCharges <= 0 && this.input.keyboard.cheatActive) {
        this.input.keyboard.clearBoostQueue();
        this.hud.message('NO BOOST LEFT', 0.6);
      }
      const ev = this.prediction?.step(input, controls) ?? null;
      if (ev && me) {
        // Local immediacy for our own surface events (host events arrive later for others).
        if (ev.splash === 2) this.lensSplash(this.prediction?.state?.speed ?? 0);
      }
    }
    this.sendAcc += dt;
    if (this.sendAcc >= 1 / NETWORK.inputHz && this.prediction) {
      this.sendAcc = 0;
      // Every unacked tick since the last send (up to 12), so a slow frame never drops an edge
      // (boost / kick / attack); the host de-duplicates by sequence number.
      net.socket.volatile.emit('inputs', { i: this.prediction.unacked(12).map(packInput) });
    }
    this.prediction?.decayOffset(dt);

    // Racers.
    for (const r of this.racers.values()) this.updateRacer(r, dt, serverNow);
    const me = this.me;

    // Intro camera, then the chase camera.
    const focus = me ? me.pos : new THREE.Vector3();
    const aspect = this.app.core.width / this.app.core.height;
    const handover = INTRO.countdownStart + 2.2;
    this.intro = tau < handover;
    if (this.intro) this.introCamera(tau, aspect);
    else if (me) {
      if (!this.handedOver) {
        const d = this.chase.desiredFor({ pos: me.pos, yaw: me.yaw, pitch: 0, lean: 0, speed: 0, boosting: false, crashed: false, riderPos: me.pos });
        this.chase.snapTo(this.camera.position.clone(), d.look, me.yaw);
        this.handedOver = true;
      }
      const crashed = !MOUNTED.has(me.state);
      const riderPos = me.rider.root.getWorldPosition(new THREE.Vector3());
      this.chase.update(dt, { pos: me.pos, yaw: me.yaw, pitch: this.prediction?.state?.pitch ?? 0, lean: this.prediction?.state?.lean ?? 0, speed: me.speed, boosting: (this.prediction?.state?.boostTime ?? 0) > 0 || !!me.last?.boosting, crashed, riderPos, airborne: this.prediction?.state?.airborne ?? !!me.last?.airborne }, aspect, this.physics.world);
    }

    // Oni, countdown, smoke, GO.
    this.oni?.update(tau);
    this.countdown(tau, goT);

    // Local headlight + nearby bikes' headlights for the light pool.
    const dyn: LightEmitter[] = [];
    for (const r of this.racers.values()) {
      const hp = r.bike.headlightLocal.clone().applyMatrix4(r.bike.body.matrixWorld);
      if (r.me) {
        const hl = this.world.env.headlight;
        hl.position.copy(hp);
        hl.target.position.copy(hp).add(new THREE.Vector3(Math.sin(r.yaw) * 20, -2.4, Math.cos(r.yaw) * 20));
      } else if (r.pos.distanceToSquared(focus) < 90 * 90) dyn.push({ pos: hp, color: new THREE.Color(0xe8eeff), intensity: 22, range: 24 });
      if ((r.me ? (this.prediction?.state?.boostTime ?? 0) > 0 : r.last?.boosting) && MOUNTED.has(r.state)) {
        for (const ex of r.bike.exhaustLocal) {
          const w = ex.clone().applyMatrix4(r.bike.body.matrixWorld);
          this.world.particles.flame.emit({ x: w.x, y: w.y, z: w.z, vx: -Math.sin(r.yaw) * 6, vy: 0.5, vz: -Math.cos(r.yaw) * 6, life: 0.25, size: 0.5, sizeEnd: 0.1, r: 1.6, g: 0.7, b: 2.4, a: 1, gravity: 0, drag: 2 });
        }
        dyn.push({ pos: r.pos.clone().add(new THREE.Vector3(0, 0.6, 0)), color: new THREE.Color(0x8f6bff), intensity: 30, range: 12 });
      }
    }
    // Key and rim light on the Oni while it performs (it is a dark model on a dark street).
    if (this.oni?.root.visible) {
      const o = this.oni.root.position;
      const toGrid = new THREE.Vector3(Math.sin(this.oni.root.rotation.y), 0, Math.cos(this.oni.root.rotation.y));
      dyn.push({ pos: o.clone().addScaledVector(toGrid, 3).add(new THREE.Vector3(0, 4, 0)), color: new THREE.Color(0xffe2f2), intensity: 26, range: 10 });
      dyn.push({ pos: o.clone().addScaledVector(toGrid, -2.5).add(new THREE.Vector3(0, 3.5, 0)), color: new THREE.Color(0xff2bd6), intensity: 18, range: 8 });
    }
    this.world.env.setDynamic(dyn);

    // World, crowd, weather-driven screen water, audio.
    this.physics.world.step();
    const camVel = this.chase.velocity;
    this.world.update(dt, time, this.camera, focus, camVel);
    const w = this.world.weather;
    this.crowd?.update(dt, time, this.camera, w.s);
    const speed01 = me ? clamp(Math.abs(me.speed) / SPEED.physicsMax, 0, 1) : 0;
    this.app.core.water.setRain(clamp(w.intensity / 3, 0, 1) * w.rainFactor, speed01, w.rainFactor < 0.3);
    this.app.core.speedBlur = clamp((Math.abs(me?.speed ?? 0) - 48) / 32, 0, 1) * 0.55;
    const inTunnel = 1 - w.rainFactor;
    const onBridge = w.district === 'BROKEN_BRIDGE' ? 1 : 0;
    this.app.audio.ambience(w.intensity, w.rainFactor, inTunnel, onBridge, this.track.crowdDensityAt(w.s), speed01);
    for (const r of this.racers.values()) {
      const d = r.pos.distanceTo(this.camera.position);
      const gain = r.me ? 1 : clamp(1 - d / 80, 0, 1) * 0.6;
      const throttle = r.me ? (this.input.mobile ? 1 : this.input.keyboard.up ? 1 : 0.2) : 0.7;
      this.app.audio.engine(r.p.id, r.p.loadout.bikeId, MOUNTED.has(r.state) ? r.speed : 0, throttle, !!r.last?.boosting, gain);
    }

    // HUD.
    const own = this.own;
    this.hud.update(dt, {
      position: me?.last?.position ?? me?.p.slot ?? 1,
      total: this.racers.size,
      lap: own ? Math.min(own.laps, own.lap + 1) : 1,
      laps: this.start.laps,
      speed: me?.speed ?? 0,
      weapon: me ? WEAPONS[me.p.loadout.weaponId].name : '',
      boostCharges: this.prediction?.boostCharges ?? own?.boostCharges ?? 0,
      cheatActive: !!own?.cheatActive,
      pingMs: net.clock.rtt,
      connected: net.connected,
      trackLength: this.track.length,
      riders: [...this.racers.values()].map((r) => ({ id: r.p.id, lapDist: r.last?.lapDist ?? 0, x: r.pos.x, z: r.pos.z, me: r.me })),
    });
    if (me && me.state === 'RECOVERY_PENALTY' && me.last) this.hud.message(`RECOVERING +${Math.max(0, 3 - me.last.stateTime).toFixed(1)}s`, 0.2);
    this.hud.setVisible(!this.intro || tau > INTRO.countdownStart - 0.5);
    this.dynamicResolution(dt);
    if (settings().showPerf) {
      const info = this.app.core.renderer.info;
      this.hud.setPerf(`fps ${(1 / Math.max(dt, 1e-3)).toFixed(0)} · scale ${this.app.core.renderScale.toFixed(2)}\ncalls ${info.render.calls} · tris ${(info.render.triangles / 1000).toFixed(0)}k\nping ${net.clock.rtt.toFixed(0)} ms · corr ${(this.prediction?.lastCorrection ?? 0).toFixed(2)} m\n${w.district} rain ${w.intensity.toFixed(1)}`);
    } else this.hud.setPerf(null);
  }

  private updateRacer(r: Racer, dt: number, serverNow: number): void {
    const pred = r.me ? this.prediction : null;
    const it: Interpolated | null = r.interp.sample(serverNow, r.me ? 45 : NETWORK.interpolationDelay * 1000);
    const snapState = r.me ? (this.own?.state ?? it?.snap.state ?? 'GRID') : (it?.snap.state ?? 'GRID');
    r.state = snapState;
    const predicted = !!pred && pred.active && !!pred.state && RIDING.has(snapState);
    let steer = 0, lean = 0;
    if (predicted) {
      const s = pred!.state!;
      r.pos.set(s.x, s.y, s.z).add(pred!.offset);
      r.yaw = s.yaw;
      r.speed = s.speed;
      steer = s.steer;
      lean = s.lean;
      r.bike.setRiding(r.pos, s.yaw, s.pitch, s.lean);
    } else if (it) {
      if (MOUNTED.has(snapState)) {
        r.pos.copy(it.pos);
        r.yaw = it.yaw;
        r.bike.setRiding(it.pos, it.yaw, it.pitch, it.lean);
      } else {
        r.pos.copy(it.pos);
        r.bike.setPose(it.pos, it.bikeQ);
      }
      r.speed = it.speed;
      steer = it.steer;
      lean = it.lean;
    }
    const snap = it?.snap ?? r.last;
    const crashed = !MOUNTED.has(snapState);
    r.bike.update(dt, { speed: r.speed, steer, lean, boosting: predicted ? (pred!.state!.boostTime > 0) : !!snap?.boosting, airborne: predicted ? pred!.state!.airborne : !!snap?.airborne, compression: predicted ? pred!.state!.compression : (snap?.compression ?? 0), crashed });
    r.bike.root.updateMatrixWorld(true);
    // Attack presentation (local predicted immediately; remotes from snapshots).
    let attackId: AttackId | null = snap?.attackId ?? null, attackTime = snap?.attackTime ?? 0, attackSide = snap?.attackSide ?? 1;
    if (r.me && r.localAttack) {
      r.localAttack.t += dt;
      attackId = r.localAttack.id;
      attackTime = r.localAttack.t;
      attackSide = this.own?.attackId ? this.own.attackSide : r.localAttack.side;
      if (r.localAttack.t > 1.05) r.localAttack = null;
    }
    const frame: RiderFrame = {
      state: snapState,
      stateTime: snap?.stateTime ?? 0,
      steer,
      lean,
      speed: r.speed,
      instability: snap?.instability ?? 0,
      attackId,
      attackTime,
      attackSide,
      faceUp: snap?.faceUp ?? true,
      riderPos: it ? it.riderPos : r.pos,
      riderYaw: it ? it.riderYaw : r.yaw,
      velocity: predicted ? new THREE.Vector3(pred!.state!.vx, pred!.state!.vy, pred!.state!.vz) : (it?.velocity ?? new THREE.Vector3()),
    };
    if (!this.prelude(r, frame, dt)) r.rider.update(dt, frame, r.bike, this.world.scene, this.physics.world);
    // Tyre spray / hover mist scales with speed and wetness; puddles throw much more.
    const w = this.track.rainFactorAt(snap?.s ?? 0);
    if (!crashed && Math.abs(r.speed) > 6 && w > 0.3 && r.pos.distanceToSquared(this.camera.position) < 140 * 140) {
      const puddle = snap?.puddle ?? 0;
      r.sprayAcc += dt * Math.abs(r.speed) * (0.35 + this.track.weatherAt(snap?.s ?? 0) * 0.25) * (puddle === 2 ? 5 : puddle === 1 ? 2.5 : 1) * (this.app.core.preset === 'MOBILE' ? 0.4 : 1);
      const back = new THREE.Vector3(-Math.sin(r.yaw), 0, -Math.cos(r.yaw));
      const rear = r.pos.clone().addScaledVector(back, r.bike.info.length * 0.42);
      while (r.sprayAcc > 1) {
        r.sprayAcc -= 1;
        const spread = (Math.random() - 0.5) * 1.6;
        this.world.particles.spray.emit({
          x: rear.x + spread * 0.3, y: rear.y + 0.15, z: rear.z + spread * 0.3,
          vx: back.x * r.speed * 0.25 + spread * 1.5, vy: 1.2 + Math.random() * 2.4, vz: back.z * r.speed * 0.25 + spread * 1.5,
          life: 0.45 + Math.random() * 0.4, size: 0.4, sizeEnd: 1.6, r: 0.62, g: 0.68, b: 0.8, a: 0.28, gravity: 4, drag: 2.2,
        });
      }
    }
    r.label.position.copy(r.pos).add(new THREE.Vector3(0, 2.4, 0));
    r.label.visible = !r.me && r.pos.distanceTo(this.camera.position) < 70;
  }

  /**
   * Intro prelude for one racer: standing beside the parked bike, then mounting. Returns true
   * when it drove the rider this frame (the normal riding update is skipped).
   */
  private prelude(r: Racer, frame: RiderFrame, dt: number): boolean {
    if (r.prelude === 'done') return false;
    const tau = this.introTau();
    const L = heroLayout(this.track, r.p.slot);
    if (r.prelude === 'stand' && tau < MOUNT_PRELUDE.start) {
      r.bike.setRiding(L.bikePos, L.yaw, 0, L.lean);
      r.bike.root.updateMatrixWorld(true);
      r.rider.updateShowcase(dt, tau + 10);
      return true;
    }
    if (r.prelude === 'stand') {
      r.rider.endShowcase('REMOUNTING');
      r.prelude = 'mount';
    }
    const k = clamp((tau - MOUNT_PRELUDE.start) / (MOUNT_PRELUDE.end - MOUNT_PRELUDE.start), 0, 1);
    // The bike comes off its side-stand lean as the rider swings on.
    r.bike.setRiding(L.bikePos, L.yaw, 0, L.lean * (1 - smoothstep(0.2, 0.9, k)));
    r.bike.root.updateMatrixWorld(true);
    if (k >= 1) {
      r.prelude = 'done';
      return false;
    }
    r.rider.update(dt, { ...frame, state: 'REMOUNTING', stateTime: k * CRASH_RECOVERY.mountDuration, attackId: null }, r.bike, this.world.scene, this.physics.world);
    return true;
  }

  private introCamera(tau: number, aspect: number): void {
    const t = this.track;
    // Grid extent as signed race distances (the grid sits just behind the start line at s = 0).
    const frontD = -RACE.gridFrontOffset;
    const backD = frontD - (RACE.gridRows - 1) * RACE.gridRowSpacing - RACE.gridStagger;
    const back = t.wrapS(backD), front = t.wrapS(frontD), mid = t.wrapS((backD + frontD) / 2);
    // Every pose stays inside the road corridor, clear of the building line.
    const side = Math.max(2, t.halfWidthAt(front) - 1.5);
    const P = (s: number, lat: number, h: number) => {
      const p = t.pointAt(s, lat, h);
      return new THREE.Vector3(p.x, p.y, p.z);
    };
    const landing = this.oni?.landing ?? P(8, 0, 0);
    const me = this.me;
    const chaseEnd = me ? this.chase.desiredFor({ pos: me.pos, yaw: me.yaw, pitch: 0, lean: 0, speed: 0, boosting: false, crashed: false, riderPos: me.pos }) : { pos: P(front - 10, 0, 3), look: P(front + 10, 0, 1) };
    // Opens on the READY hero framing (my rider beside my bike) and holds through the mount.
    const hero = me ? heroLayout(t, me.p.slot) : null;
    const keys: { t: number; pos: THREE.Vector3; look: THREE.Vector3 }[] = [
      ...(hero
        ? [
            { t: -2, pos: hero.camPos, look: hero.camLook },
            { t: MOUNT_PRELUDE.cameraHold, pos: hero.camPos.clone().add(new THREE.Vector3(0, 0.4, 0)), look: hero.camLook.clone().add(new THREE.Vector3(0, 0.25, 0)) },
          ]
        : [{ t: 0, pos: P(back - 22, 0, 8.5), look: P(front + 4, 0, 1.2) }]),
      // Low tracking pass along the riders.
      { t: 2.4, pos: P(mid - 2, side, 2.4), look: P(mid + 6, -side * 0.3, 1.1) },
      // Ahead of the front row, looking up at the Oni as it lands and rises.
      { t: INTRO.cameraSweep, pos: P(front + 12, side * 0.35, 1.5), look: landing.clone().add(new THREE.Vector3(0, 2.1, 0)) },
      // Over the Oni's shoulder back at the grid for the countdown gesture (same side: never through it).
      { t: INTRO.countdownStart - 0.4, pos: P(12.5, side * 0.4, 3.3), look: P(front - 8, 0, 1.2) },
      { t: INTRO.countdownStart + 2.2, pos: chaseEnd.pos, look: chaseEnd.look },
    ];
    let i = 0;
    while (i < keys.length - 2 && tau > keys[i + 1]!.t) i++;
    const a = keys[i]!, b = keys[i + 1]!;
    const k = smoothstep(0, 1, clamp((tau - a.t) / (b.t - a.t), 0, 1));
    this.camera.position.lerpVectors(a.pos, b.pos, k);
    this.camera.lookAt(new THREE.Vector3().lerpVectors(a.look, b.look, k));
    // Hero lens and composition (subject framed right of the lobby UI) relax into the intro's.
    const settle = smoothstep(MOUNT_PRELUDE.start, MOUNT_PRELUDE.cameraHold + 1.2, tau);
    this.camera.fov = hero ? 31 + (60 - 31) * settle : damp(this.camera.fov, 60, 0.5, 1 / 60);
    this.camera.aspect = aspect;
    const w = this.app.core.width, h = this.app.core.height;
    const shift = this.heroShift * (1 - settle);
    if (shift > 0.001) this.camera.setViewOffset(w, h, -shift * w, 0, w, h);
    else this.camera.clearViewOffset();
    this.camera.updateProjectionMatrix();
  }

  private countdown(tau: number, goT: number): void {
    const cs = INTRO.countdownStart;
    const smoke = this.world.particles.smoke;
    const colors = [[2.2, 0.3, 1.9], [0.3, 1.8, 2.2], [2.2, 1.4, 0.2]];
    if (tau >= cs - 1 && tau < goT + 1.5) {
      // Colored smoke flares along the grid through the countdown, a big burst on GO.
      const burst = tau >= goT && tau < goT + 0.1;
      const n = burst ? 30 : Math.random() < 0.5 ? 1 : 0;
      for (let f = 0; f < this.flares.length; f++) {
        const p = this.flares[f]!, c = colors[f % 3]!;
        for (let k = 0; k < n; k++) smoke.emit({ x: p.x, y: p.y, z: p.z, vx: (Math.random() - 0.5) * (burst ? 8 : 1.2), vy: 1 + Math.random() * (burst ? 5 : 1.5), vz: (Math.random() - 0.5) * (burst ? 8 : 1.2), life: 2.5 + Math.random() * 2, size: 1.2, sizeEnd: 5, r: c[0]!, g: c[1]!, b: c[2]!, a: 0.35, gravity: -0.4, drag: 0.8 });
      }
    }
    if (tau >= cs && tau < goT) {
      const n = Math.ceil(goT - tau);
      if (n !== this.lastCount) {
        this.lastCount = n;
        this.app.audio.play('countdown');
      }
      this.hud.setCountdown(String(n));
    } else if (tau >= goT && tau < goT + 1) {
      if (this.lastCount !== 0) {
        this.lastCount = 0;
        this.app.audio.play('go');
      }
      this.hud.setCountdown('GO');
    } else this.hud.setCountdown(null);
    this.app.phase = tau < cs ? 'INTRO' : tau < goT ? 'COUNTDOWN' : this.finishedShown || this.raceState === 'FINISHING' ? 'FINISHING' : 'RACING';
  }

  private dynamicResolution(dt: number): void {
    this.frameTimes.push(dt);
    if (this.frameTimes.length > 90) this.frameTimes.shift();
    this.scaleTimer += dt;
    if (this.scaleTimer < 1.5 || this.frameTimes.length < 60) return;
    this.scaleTimer = 0;
    const avg = this.frameTimes.reduce((a, b) => a + b, 0) / this.frameTimes.length;
    const core = this.app.core;
    if (avg > 1 / 45) core.setRenderScale(core.renderScale - 0.08);
    else if (avg < 1 / 58 && core.renderScale < 1) core.setRenderScale(core.renderScale + 0.05);
  }

  render(dt: number, time: number): void {
    // Until then the previous frame stays on screen; simulation, input and audio keep running.
    if (!this.drawable) return;
    this.app.core.render(this.world.scene, this.camera, dt, time);
  }

  dispose(): void {
    this.disposed = true;
    for (const off of this.offs) off();
    for (const r of this.racers.values()) {
      r.rider.dispose();
      r.bike.dispose();
      r.label.removeFromParent();
    }
    this.oni?.dispose();
    this.crowd?.dispose();
    this.input.dispose();
    this.hud.el.remove();
    this.touch?.dispose();
    this.physics.dispose();
    this.world.env.setDynamic([]);
    this.world.env.onThunder = null;
    this.world.reflectionPaused = false;
    this.app.audio.stopEngines();
    this.app.audio.silenceLoops();
    this.app.core.water.clear();
    this.app.core.speedBlur = 0;
  }
}

export function ordinal(n: number): string {
  const s = ['TH', 'ST', 'ND', 'RD'];
  const v = n % 100;
  return `${n}${s[(v - 20) % 10] ?? s[v] ?? s[0]}`;
}
