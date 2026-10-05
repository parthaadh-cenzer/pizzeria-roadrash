// Authoritative race simulation (host-owned). Runs at 60 Hz on the server; clients only
// predict their own bike and never decide hits, crashes, checkpoints, cheats or finish.
import { ATTACKS, BOOST_CHEAT, COMBAT, CRASH_RECOVERY, NETWORK, RACE, SIM_DT, clampLaps } from '../../config/gameplay.js';
import { BIKES } from '../../config/bikes.js';
import type { AttackId, BikeId, RiderId, RiderState, WeaponId } from '../../shared/ids.js';
import { clamp, lerp, wrapAngle, type Quat, type V3 } from '../../shared/math.js';
import { applyBikeImpulse, bikeParamsFor, createBikeState, stepBike } from './BikeController.js';
import { resolveBikeCollisions, type CollisionBody } from './BikeCollisions.js';
import { computeHit, findTarget, isContactWindow, startAttack, tickAttack, type CombatBody } from './Combat.js';
import { newProgress, progressScore, rankEntries, updateProgress, updateSafeNode, type ProgressState } from './Progress.js';
import { emptyEvents, NEUTRAL_INPUT, newAttackState, type AttackState, type BikeParams, type BikeState, type ControlInput, type CrashReason } from './types.js';
import type { Track } from '../track/Track.js';
import type { CrashWorld } from '../../physics/CrashWorld.js';

export interface Loadout {
  riderId: RiderId;
  riderColor: number;
  bikeId: BikeId;
  bikeColor: number;
  weaponId: WeaponId;
}

export interface ParticipantInit {
  id: number;
  name: string;
  slot: number;
  loadout: Loadout;
}

export type RaceEvent =
  | { t: 'hit'; a: number; b: number; atk: AttackId; x: number; y: number; z: number }
  | { t: 'swing'; a: number; atk: AttackId; side: number }
  | { t: 'crash'; id: number; reason: CrashReason }
  | { t: 'scrape'; id: number; k: number; side: number }
  | { t: 'splash'; id: number; size: number }
  | { t: 'land'; id: number; v: number }
  | { t: 'launch'; id: number }
  | { t: 'bump'; a: number; b: number; band: string; x: number; y: number; z: number }
  | { t: 'checkpoint'; id: number; index: number }
  | { t: 'lap'; id: number; lap: number; laps: number }
  | { t: 'wrongGate'; id: number }
  | { t: 'finish'; id: number; time: number; position: number }
  | { t: 'boost'; id: number; charges: number }
  | { t: 'cheat'; id: number; charges: number }
  | { t: 'recovered'; id: number; penalty: boolean }
  | { t: 'dnf'; id: number };

export interface PlayerRuntime {
  id: number;
  name: string;
  slot: number;
  loadout: Loadout;
  params: BikeParams;
  bike: BikeState;
  attack: AttackState;
  progress: ProgressState;
  state: RiderState;
  stateTime: number;
  inputs: ControlInput[];
  lastInput: ControlInput;
  lastSeq: number;
  connected: boolean;
  disconnectedFor: number;
  boostCharges: number;
  cheatActive: boolean;
  lastBoostAt: number;
  // crash/recovery
  crashReason: CrashReason | null;
  crashS: number;
  crashLapDist: number;
  faceUp: boolean;
  inaccessible: boolean;
  riderPos: V3;
  riderQ: Quat;
  riderYaw: number;
  bikePos: V3;
  bikeQ: Quat;
  liftFromQ: Quat;
  liftToQ: Quat;
  liftYaw: number;
  /** Where the lifted bike will stand (body centre); planned before the run to the bike. */
  liftPos: V3;
  liftFromPos: V3;
  penaltyLeft: number;
  finishTime: number | null;
  position: number;
}

export interface ResultEntry {
  id: number;
  name: string;
  position: number;
  finishTime: number | null;
  gap: number | null;
  dnf: boolean;
  loadout: Loadout;
}

const IDENTITY_Q: Quat = { x: 0, y: 0, z: 0, w: 1 };

function yawQuat(yaw: number): Quat {
  return { x: 0, y: Math.sin(yaw / 2), z: 0, w: Math.cos(yaw / 2) };
}

export function slerpQ(a: Quat, b: Quat, t: number): Quat {
  let cos = a.x * b.x + a.y * b.y + a.z * b.z + a.w * b.w;
  let bx = b.x, by = b.y, bz = b.z, bw = b.w;
  if (cos < 0) {
    cos = -cos;
    bx = -bx;
    by = -by;
    bz = -bz;
    bw = -bw;
  }
  let k0: number, k1: number;
  if (cos > 0.9995) {
    k0 = 1 - t;
    k1 = t;
  } else {
    const sin = Math.sqrt(1 - cos * cos);
    const ang = Math.atan2(sin, cos);
    k0 = Math.sin((1 - t) * ang) / sin;
    k1 = Math.sin(t * ang) / sin;
  }
  const x = a.x * k0 + bx * k1, y = a.y * k0 + by * k1, z = a.z * k0 + bz * k1, w = a.w * k0 + bw * k1;
  const l = Math.hypot(x, y, z, w) || 1;
  return { x: x / l, y: y / l, z: z / l, w: w / l };
}

/** Horizontal heading of a body's local +Z axis. */
function headingOf(q: Quat): number {
  const zx = 2 * (q.x * q.z + q.w * q.y);
  const zz = 1 - 2 * (q.x * q.x + q.y * q.y);
  return Math.atan2(zx, zz);
}

const RIDING_STATES: ReadonlySet<RiderState> = new Set(['RIDING', 'ATTACKING', 'KICKING', 'DESTABILIZED']);

export function isRidingState(s: RiderState): boolean {
  return RIDING_STATES.has(s);
}

export class RaceSim {
  readonly track: Track;
  readonly crash: CrashWorld;
  readonly players = new Map<number, PlayerRuntime>();
  tick = 0;
  readonly goTick: number;
  events: RaceEvent[] = [];
  firstFinishTick: number | null = null;
  finishedAll = false;
  /** Race length in laps (1-5), fixed for this race. */
  readonly laps: number;

  constructor(track: Track, crash: CrashWorld, participants: ParticipantInit[], goTick: number, laps = 1) {
    this.track = track;
    this.laps = clampLaps(laps);
    this.crash = crash;
    this.goTick = goTick;
    for (const p of participants) {
      const g = track.grid[p.slot]!;
      const lapDist = -track.deltaS(g.s, 0) >= 0 ? track.deltaS(0, g.s) : track.deltaS(0, g.s);
      const bike = createBikeState(track, g.s, g.lateral, lapDist);
      this.players.set(p.id, {
        id: p.id,
        name: p.name,
        slot: p.slot,
        loadout: p.loadout,
        params: bikeParamsFor(p.loadout.bikeId),
        bike,
        attack: newAttackState(),
        progress: newProgress(track, g.s, this.laps),
        state: 'GRID',
        stateTime: 0,
        inputs: [],
        lastInput: { ...NEUTRAL_INPUT },
        lastSeq: 0,
        connected: true,
        disconnectedFor: 0,
        boostCharges: 0,
        cheatActive: false,
        lastBoostAt: -1,
        crashReason: null,
        crashS: 0,
        crashLapDist: 0,
        faceUp: true,
        inaccessible: false,
        riderPos: { x: bike.x, y: bike.y, z: bike.z },
        riderQ: { ...IDENTITY_Q },
        riderYaw: bike.yaw,
        bikePos: { x: bike.x, y: bike.y, z: bike.z },
        bikeQ: yawQuat(bike.yaw),
        liftFromQ: { ...IDENTITY_Q },
        liftToQ: { ...IDENTITY_Q },
        liftYaw: 0,
        liftPos: { x: bike.x, y: bike.y, z: bike.z },
        liftFromPos: { x: bike.x, y: bike.y, z: bike.z },
        penaltyLeft: 0,
        finishTime: null,
        position: p.slot + 1,
      });
    }
  }

  get raceTime(): number {
    return Math.max(0, (this.tick - this.goTick) * SIM_DT);
  }

  get controlsLive(): boolean {
    return this.tick >= this.goTick;
  }

  queueInputs(id: number, inputs: ControlInput[]): void {
    const p = this.players.get(id);
    if (!p) return;
    for (const inp of inputs) {
      if (inp.seq <= p.lastSeq) continue;
      if (p.inputs.length && inp.seq <= p.inputs[p.inputs.length - 1]!.seq) continue;
      p.inputs.push(sanitizeInput(inp));
    }
  }

  setConnected(id: number, connected: boolean): void {
    const p = this.players.get(id);
    if (!p) return;
    p.connected = connected;
    if (connected) p.disconnectedFor = 0;
  }

  /** The player left the race for good: DNF immediately; the bike coasts to a safe stop. */
  retire(id: number): void {
    const p = this.players.get(id);
    if (!p) return;
    p.connected = false;
    if (p.progress.finished || p.progress.dnf) return;
    p.progress.dnf = true;
    this.events.push({ t: 'dnf', id });
  }

  /** Server-validated cheat activation (keyboard-only sequence typed in race). */
  activateCheat(id: number, phrase: string): boolean {
    const p = this.players.get(id);
    if (!p || !this.controlsLive || p.progress.finished || p.progress.dnf) return false;
    if (phrase !== BOOST_CHEAT.sequence || p.cheatActive) return false;
    p.cheatActive = true;
    p.boostCharges = BOOST_CHEAT.charges;
    this.events.push({ t: 'cheat', id, charges: p.boostCharges });
    return true;
  }

  private takeInput(p: PlayerRuntime): ControlInput {
    if (p.inputs.length > 6) {
      // Catch up after a burst, preserving edge-triggered actions.
      let kick = false, attack = false, boost = false;
      while (p.inputs.length > 3) {
        const d = p.inputs.shift()!;
        kick ||= d.kick;
        attack ||= d.attack;
        boost ||= d.boost;
      }
      const n = p.inputs[0]!;
      n.kick ||= kick;
      n.attack ||= attack;
      n.boost ||= boost;
    }
    const inp = p.inputs.shift();
    if (inp) {
      p.lastInput = inp;
      p.lastSeq = inp.seq;
      return inp;
    }
    return { ...p.lastInput, kick: false, attack: false, boost: false };
  }

  step(): void {
    const dt = SIM_DT;
    this.tick++;
    const live = this.controlsLive;
    const all = [...this.players.values()];

    const combatBodies: CombatBody[] = all.map((p) => ({ index: p.id, bike: p.bike, params: p.params, canBeHit: isRidingState(p.state) }));

    for (const p of all) {
      const inp = this.takeInput(p);
      p.stateTime += dt;
      if (!p.connected) p.disconnectedFor += dt;

      if (p.state === 'GRID' && live) this.setState(p, 'RIDING');

      if (isRidingState(p.state) || p.state === 'GRID' || p.state === 'FINISHED' || p.state === 'DISCONNECTED') {
        const controls = live && isRidingState(p.state) && p.connected;
        // Boost request (server validated: charges, rate limit).
        if (controls && inp.boost && p.boostCharges > 0 && this.raceTime - p.lastBoostAt >= BOOST_CHEAT.minInterval) {
          p.boostCharges--;
          p.lastBoostAt = this.raceTime;
          p.bike.boostTime = BOOST_CHEAT.chargeDuration;
          this.events.push({ t: 'boost', id: p.id, charges: p.boostCharges });
        }
        // Attacks
        if (controls && !p.attack.id && (inp.kick || inp.attack)) {
          const id: AttackId = inp.kick ? 'KICK' : p.loadout.weaponId;
          startAttack(p.attack, id, combatBodies.find((c) => c.index === p.id)!, combatBodies);
          this.events.push({ t: 'swing', a: p.id, atk: id, side: p.attack.side });
        }
        const ev = emptyEvents();
        const brake = p.state === 'FINISHED' || !p.connected ? 0.35 : 0;
        const prevLap = p.bike.lapDist;
        stepBike(p.bike, inp, p.params, this.track, dt, controls, ev, brake);
        if (ev.scrape > 0) this.events.push({ t: 'scrape', id: p.id, k: ev.scrape, side: ev.scrapeSide });
        if (ev.splash) this.events.push({ t: 'splash', id: p.id, size: ev.splash });
        if (ev.landed > 0.5) this.events.push({ t: 'land', id: p.id, v: ev.landed });
        if (ev.launched) this.events.push({ t: 'launch', id: p.id });
        if (ev.crash && p.state !== 'FINISHED') {
          this.beginCrash(p, ev.crash);
        } else {
          this.afterRidingStep(p, prevLap);
        }
      } else {
        this.stepCrashSequence(p, dt);
      }

      if (p.attack.id) {
        const done = tickAttack(p.attack, dt);
        if (!done && isRidingState(p.state)) this.resolveAttack(p, combatBodies);
      }
      if (isRidingState(p.state)) {
        const next: RiderState = p.attack.id ? (p.attack.id === 'KICK' ? 'KICKING' : 'ATTACKING') : p.bike.instability > 0.35 ? 'DESTABILIZED' : 'RIDING';
        if (next !== p.state) {
          p.state = next;
        }
      }
      if (!p.connected && !p.progress.finished && !p.progress.dnf && p.disconnectedFor > NETWORK.reconnectGrace) {
        p.progress.dnf = true;
        this.events.push({ t: 'dnf', id: p.id });
      }
    }

    // Bike-vs-bike contact
    const colBodies: CollisionBody[] = all.map((p) => ({ index: p.id, bike: p.bike, params: p.params, active: isRidingState(p.state) || p.state === 'FINISHED' || p.state === 'GRID' }));
    for (const c of resolveBikeCollisions(colBodies)) {
      this.events.push({ t: 'bump', a: c.a, b: c.b, band: c.band, x: c.x, y: c.y, z: c.z });
      for (const id of c.crash) {
        const p = this.players.get(id)!;
        if (isRidingState(p.state)) this.beginCrash(p, 'bike');
      }
    }
    // Instability escalation from hits/collisions
    for (const p of all) {
      if (isRidingState(p.state) && p.bike.instability > COMBAT.instabilityCrashThreshold) this.beginCrash(p, 'combat');
    }

    this.crash.step();
    this.updateRanking();
    this.updateFinishState();
  }

  private afterRidingStep(p: PlayerRuntime, prevLap: number): void {
    const b = p.bike;
    p.bikePos = { x: b.x, y: b.y, z: b.z };
    p.riderPos = { x: b.x, y: b.y, z: b.z };
    p.riderYaw = b.yaw;
    if (!this.controlsLive) return;
    const ev = updateProgress(p.progress, this.track, prevLap, b.lapDist, b.lateral);
    if (ev.checkpoint !== null) this.events.push({ t: 'checkpoint', id: p.id, index: ev.checkpoint });
    if (ev.lap !== null) this.events.push({ t: 'lap', id: p.id, lap: ev.lap, laps: this.laps });
    if (ev.wrongGate) this.events.push({ t: 'wrongGate', id: p.id });
    if (!b.airborne && isRidingState(p.state)) updateSafeNode(p.progress, this.track, b.s, b.lapDist);
    if (ev.finished) {
      p.finishTime = this.raceTime;
      p.progress.finishTime = p.finishTime;
      this.setState(p, 'FINISHED');
      p.attack.id = null;
      if (this.firstFinishTick === null) this.firstFinishTick = this.tick;
      const pos = [...this.players.values()].filter((o) => o.progress.finished).length;
      this.events.push({ t: 'finish', id: p.id, time: p.finishTime, position: pos });
    }
  }

  private setState(p: PlayerRuntime, s: RiderState): void {
    p.state = s;
    p.stateTime = 0;
  }

  private resolveAttack(p: PlayerRuntime, bodies: CombatBody[]): void {
    const id = p.attack.id!;
    if (!isContactWindow(id, p.attack.time)) return;
    const me = bodies.find((b) => b.index === p.id)!;
    const t = findTarget(me, bodies, ATTACKS[id].reach, p.attack.side);
    if (!t || p.attack.hitTargets.includes(t.index)) return;
    const target = this.players.get(t.index)!;
    p.attack.hitTargets.push(t.index);
    const hit = computeHit(id, p.bike, target.bike, target.params, t.side, t.forward);
    applyBikeImpulse(target.bike, target.params, hit.lateralImpulse, hit.yawKick, hit.instability);
    // Small reaction on the attacker.
    applyBikeImpulse(p.bike, p.params, -hit.lateralImpulse * 0.12 * Math.sign(t.side), 0, 0.05);
    const mx = (p.bike.x + target.bike.x) / 2, mz = (p.bike.z + target.bike.z) / 2;
    this.events.push({ t: 'hit', a: p.id, b: target.id, atk: id, x: mx, y: target.bike.y + 1.1, z: mz });
  }

  private beginCrash(p: PlayerRuntime, reason: CrashReason): void {
    if (!isRidingState(p.state)) return;
    const b = p.bike;
    p.crashReason = reason;
    p.crashS = b.s;
    p.crashLapDist = b.lapDist;
    p.inaccessible = false;
    p.attack.id = null;
    this.crash.spawnCrash(p.id, { x: b.x, y: b.y, z: b.z }, b.yaw, { x: b.vx, y: b.vy, z: b.vz }, b.lean);
    b.vx = b.vy = b.vz = 0;
    b.speed = 0;
    b.boostTime = 0;
    this.setState(p, 'RAGDOLL');
    this.events.push({ t: 'crash', id: p.id, reason });
  }

  private stepCrashSequence(p: PlayerRuntime, dt: number): void {
    const cw = this.crash;
    const pair = cw.pair(p.id);
    if (pair && (p.state === 'RAGDOLL' || p.state === 'SETTLING')) {
      const rp = cw.riderPose(p.id)!, bp = cw.bikePose(p.id)!;
      p.riderPos = rp.p;
      p.riderQ = rp.q;
      p.bikePos = bp.p;
      p.bikeQ = bp.q;
      if (cw.isInaccessible(this.track, rp.p, p.crashS)) p.inaccessible = true;
    }
    switch (p.state) {
      case 'RAGDOLL': {
        const forced = p.stateTime >= CRASH_RECOVERY.forcedSettle;
        if (p.inaccessible && p.stateTime >= CRASH_RECOVERY.ragdollMin) {
          this.beginPenalty(p);
        } else if ((pair?.riderSettled && p.stateTime >= CRASH_RECOVERY.ragdollMin) || forced) {
          p.faceUp = cw.riderFaceUp(p.id);
          this.setState(p, 'SETTLING');
        }
        break;
      }
      case 'SETTLING': {
        if (p.stateTime >= 0.25) {
          // Rider stands facing away from where the head lay (derived from body axes).
          const q = p.riderQ;
          const hx = 2 * (q.x * q.y - q.w * q.z), hz = 2 * (q.y * q.z + q.w * q.x);
          p.riderYaw = Math.atan2(-hx, -hz);
          if (!Number.isFinite(p.riderYaw)) p.riderYaw = p.bike.yaw;
          const pr = this.track.project(p.riderPos.x, p.riderPos.y, p.riderPos.z, p.crashS, 80, 80);
          p.riderPos = this.track.pointAt(pr.s, clamp(pr.lateral, -this.track.barrierOffsetAt(pr.s) + 0.4, this.track.barrierOffsetAt(pr.s) - 0.4), 0);
          this.setState(p, 'GETTING_UP');
        }
        break;
      }
      case 'GETTING_UP': {
        const dur = p.faceUp ? CRASH_RECOVERY.getupBackDuration : CRASH_RECOVERY.getupProneDuration;
        if (p.stateTime >= dur) {
          if (!pair?.bikeSettled && pair) {
            // Force the bike to rest if it is still sliding.
            cw.setPose(p.id, 'bike', p.bikePos, p.bikeQ);
          }
          const bp = cw.bikePose(p.id) ?? { p: p.bikePos, q: p.bikeQ };
          p.bikePos = bp.p;
          p.bikeQ = bp.q;
          // A bike that came to rest in the broken-bridge gap is lost (penalty recovery).
          const bikeS = this.track.project(bp.p.x, bp.p.y, bp.p.z, p.crashS, 80, 80).s;
          const bikeLost = cw.isInaccessible(this.track, bp.p, p.crashS) || this.track.isInGap(bikeS);
          const dist = Math.hypot(bp.p.x - p.riderPos.x, bp.p.z - p.riderPos.z);
          if (bikeLost || dist > CRASH_RECOVERY.runToBikeMaxDistance) this.beginPenalty(p);
          else {
            this.planLift(p);
            this.setState(p, 'RUNNING_TO_BIKE');
          }
        }
        break;
      }
      case 'RUNNING_TO_BIKE': {
        const target = this.approachPoint(p);
        const dx = target.x - p.riderPos.x, dz = target.z - p.riderPos.z;
        const d = Math.hypot(dx, dz);
        // Accelerate out of the get-up, slow to a stop beside the bike.
        const pace = clamp(0.35 + p.stateTime / 0.4, 0, 1) * clamp(d / 1.6, 0.3, 1);
        const stepLen = CRASH_RECOVERY.runSpeed * pace * dt;
        if (d <= Math.max(stepLen, 0.04)) {
          p.riderPos = { ...target };
          this.beginLift(p);
        } else {
          p.riderYaw = Math.atan2(dx, dz);
          const nx = p.riderPos.x + (dx / d) * stepLen, nz = p.riderPos.z + (dz / d) * stepLen;
          const pr = this.track.project(nx, p.riderPos.y, nz, p.crashS, 80, 80);
          const ground = this.track.pointAt(pr.s, pr.lateral, 0);
          p.riderPos = { x: nx, y: ground.y, z: nz };
        }
        if (p.stateTime > 12) this.beginPenalty(p);
        break;
      }
      case 'LIFTING': {
        const t = clamp(p.stateTime / CRASH_RECOVERY.liftDuration, 0, 1);
        const e = t * t * (3 - 2 * t);
        p.bikeQ = slerpQ(p.liftFromQ, p.liftToQ, e);
        // The bike rises from where it lay to its upright pose (no pop).
        p.bikePos = { x: lerp(p.liftFromPos.x, p.liftPos.x, e), y: lerp(p.liftFromPos.y, p.liftPos.y, e), z: lerp(p.liftFromPos.z, p.liftPos.z, e) };
        cw.setPose(p.id, 'bike', p.bikePos, p.bikeQ);
        if (t >= 1) this.setState(p, 'REMOUNTING');
        break;
      }
      case 'REMOUNTING': {
        const t = clamp(p.stateTime / CRASH_RECOVERY.mountDuration, 0, 1);
        p.riderPos = {
          x: lerp(p.riderPos.x, p.bikePos.x, t),
          y: lerp(p.riderPos.y, p.bikePos.y, t),
          z: lerp(p.riderPos.z, p.bikePos.z, t),
        };
        p.riderYaw = p.liftYaw;
        if (t >= 1) this.resumeRiding(p, p.bikePos, p.liftYaw, false);
        break;
      }
      case 'RECOVERY_PENALTY': {
        p.penaltyLeft -= dt;
        if (p.penaltyLeft <= 0) {
          this.setState(p, 'RIDING');
          this.events.push({ t: 'recovered', id: p.id, penalty: true });
        }
        break;
      }
      default:
        break;
    }
  }

  /**
   * The bike's recovery approach point (its mount side, from config/bikes.ts) around the pose the
   * bike will be lifted to, on the road surface: the rider runs there, lifts, then remounts.
   */
  private approachPoint(p: PlayerRuntime): V3 {
    const m = BIKES[p.loadout.bikeId].mount;
    const yaw = p.liftYaw;
    // Bike local +X is the rider's left: world (cos yaw, -sin yaw); +Z is (sin yaw, cos yaw).
    const lx = (m.mountSide === 'left' ? 1 : -1) * Math.abs(m.recoveryApproachPoint[0]), lz = m.recoveryApproachPoint[2];
    const x = p.liftPos.x + Math.cos(yaw) * lx + Math.sin(yaw) * lz;
    const z = p.liftPos.z - Math.sin(yaw) * lx + Math.cos(yaw) * lz;
    const pr = this.track.project(x, p.liftPos.y, z, p.crashS, 80, 80);
    const lat = clamp(pr.lateral, -this.track.barrierOffsetAt(pr.s) + 0.3, this.track.barrierOffsetAt(pr.s) - 0.3);
    return this.track.pointAt(pr.s, lat, 0);
  }

  /** Moves a recovery position off the broken-bridge lips onto solid deck on the rider's side. */
  private clearOfGap(s: number, riderS: number): number {
    const t = this.track, b = t.bridge, margin = 2.5;
    const w = t.wrapS(s);
    if (w < b.lip - margin || w >= b.gapEnd + margin) return s;
    const far = t.wrapS(riderS) >= (b.lip + b.gapEnd) / 2 && t.wrapS(riderS) < b.gapEnd + 400;
    return t.wrapS(far ? b.gapEnd + margin : b.lip - margin);
  }

  /** Plans the upright pose of the fallen bike (on solid road, facing along the track). */
  private planLift(p: PlayerRuntime): void {
    const pr = this.track.project(p.bikePos.x, p.bikePos.y, p.bikePos.z, p.crashS, 80, 80);
    const riderS = this.track.project(p.riderPos.x, p.riderPos.y, p.riderPos.z, p.crashS, 80, 80).s;
    const s = this.clearOfGap(pr.s, riderS);
    const lat = clamp(pr.lateral, -this.track.halfWidthAt(s) + 0.6, this.track.halfWidthAt(s) - 0.6);
    const ground = this.track.pointAt(s, lat, 0);
    const bikeYaw = headingOf(p.bikeQ);
    const trackYaw = this.track.headingAt(s);
    const yaw = Math.abs(wrapAngle(bikeYaw - trackYaw)) > Math.PI / 2 ? trackYaw : bikeYaw;
    p.liftYaw = yaw;
    // Body centre (crash bodies report their centre ~0.55 m above the ground contact).
    p.liftPos = { x: ground.x, y: ground.y + 0.55, z: ground.z };
  }

  private beginLift(p: PlayerRuntime): void {
    p.liftFromQ = { ...p.bikeQ };
    p.liftToQ = yawQuat(p.liftYaw);
    p.liftFromPos = { ...p.bikePos };
    this.setState(p, 'LIFTING');
  }

  private resumeRiding(p: PlayerRuntime, pos: V3, yaw: number, penalty: boolean): void {
    const pr = this.track.project(pos.x, pos.y, pos.z, p.crashS, 80, 80);
    const lapDist = p.crashLapDist + this.track.deltaS(p.crashS, pr.s);
    const nb = createBikeState(this.track, pr.s, pr.lateral, lapDist);
    nb.yaw = yaw;
    p.bike = nb;
    this.crash.removeCrash(p.id);
    p.bikePos = { x: nb.x, y: nb.y, z: nb.z };
    p.bikeQ = yawQuat(yaw);
    p.riderPos = { ...p.bikePos };
    p.riderYaw = yaw;
    this.setState(p, 'RIDING');
    this.events.push({ t: 'recovered', id: p.id, penalty });
  }

  /** Off-world / unreachable: recover at last safe node, immobilised for the penalty. */
  private beginPenalty(p: PlayerRuntime): void {
    const s = p.progress.lastSafeNodeS;
    const lapDist = p.crashLapDist + this.track.deltaS(p.crashS, s);
    const nb = createBikeState(this.track, s, 0, lapDist);
    p.bike = nb;
    this.crash.removeCrash(p.id);
    p.bikePos = { x: nb.x, y: nb.y, z: nb.z };
    p.bikeQ = yawQuat(nb.yaw);
    p.riderPos = { ...p.bikePos };
    p.riderYaw = nb.yaw;
    p.penaltyLeft = CRASH_RECOVERY.offWorldPenalty;
    this.setState(p, 'RECOVERY_PENALTY');
  }

  private updateRanking(): void {
    const ranked = rankEntries(
      [...this.players.values()].map((p) => ({ id: p.id, finished: p.progress.finished, finishTime: p.finishTime, dnf: p.progress.dnf, score: progressScore(p.progress, p.bike.lapDist) })),
    );
    ranked.forEach((r, i) => (this.players.get(r.id)!.position = i + 1));
  }

  private updateFinishState(): void {
    const all = [...this.players.values()];
    const pending = all.filter((p) => !p.progress.finished && !p.progress.dnf);
    if (this.firstFinishTick !== null && (this.tick - this.firstFinishTick) * SIM_DT > RACE.finishingWindow) {
      for (const p of pending) {
        p.progress.dnf = true;
        this.events.push({ t: 'dnf', id: p.id });
      }
    }
    this.finishedAll = all.every((p) => p.progress.finished || p.progress.dnf);
  }

  results(): ResultEntry[] {
    const ranked = rankEntries(
      [...this.players.values()].map((p) => ({ id: p.id, finished: p.progress.finished, finishTime: p.finishTime, dnf: p.progress.dnf || !p.progress.finished, score: progressScore(p.progress, p.bike.lapDist) })),
    );
    const winner = ranked.find((r) => r.finished && !r.dnf);
    return ranked.map((r, i) => {
      const p = this.players.get(r.id)!;
      const dnf = !p.progress.finished;
      return {
        id: p.id,
        name: p.name,
        position: i + 1,
        finishTime: dnf ? null : p.finishTime,
        gap: dnf || !winner || winner.finishTime === null || p.finishTime === null ? null : p.finishTime - winner.finishTime,
        dnf,
        loadout: p.loadout,
      };
    });
  }

  drainEvents(): RaceEvent[] {
    const e = this.events;
    this.events = [];
    return e;
  }
}

function sanitizeInput(i: ControlInput): ControlInput {
  const num = (v: unknown, lo: number, hi: number) => (typeof v === 'number' && Number.isFinite(v) ? clamp(v, lo, hi) : 0);
  return {
    seq: typeof i.seq === 'number' && Number.isFinite(i.seq) ? Math.floor(i.seq) : 0,
    throttle: num(i.throttle, 0, 1),
    brake: num(i.brake, 0, 1),
    steer: num(i.steer, -1, 1),
    analog: !!i.analog,
    autoAccel: !!i.autoAccel,
    kick: !!i.kick,
    attack: !!i.attack,
    boost: !!i.boost,
  };
}
