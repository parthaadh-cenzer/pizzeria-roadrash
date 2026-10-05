// READY hero presentation: the player's complete loadout (rider in their colour, holding their
// weapon, beside their bike in its colour) at their actual starting-grid slot in the race world.
// It shows a tight, fogged bubble around the grid only: a short far plane and dense fog hide the
// course, the districts, the tunnel and the bridge, and the minimap/HUD are not shown. The same
// layout (heroLayout) opens the race intro, so READY -> race start is one continuous shot.
import * as THREE from 'three';
import { getTrack, type Track } from '../game/track/Track.js';
import type { LoadoutMsg } from '../shared/protocol.js';
import type { BikeActor } from '../render/actors/BikeActor.js';
import type { RiderActor } from '../render/actors/RiderActor.js';
import type { App, View } from './App.js';

/** Visible radius of the grid bubble (m). */
export const HERO_FAR = 70;
const HERO_FOG = 0.075;

export interface HeroLayout {
  bikePos: THREE.Vector3;
  yaw: number;
  riderPos: THREE.Vector3;
  riderYaw: number;
  camPos: THREE.Vector3;
  camLook: THREE.Vector3;
  /** Parked (side-stand) lean, toward the rider's left. */
  lean: number;
}

/** Where a rider stands beside their parked bike on grid slot `slot`, and the hero camera. */
export function heroLayout(track: Track, slot: number): HeroLayout {
  const g = track.grid[Math.max(0, Math.min(track.grid.length - 1, slot))]!;
  const p = track.pointAt(g.s, g.lateral, 0);
  const yaw = track.headingAt(g.s);
  const fwd = new THREE.Vector3(Math.sin(yaw), 0, Math.cos(yaw));
  // Bike-local +X is the rider's left (the mount side).
  const left = new THREE.Vector3(Math.cos(yaw), 0, -Math.sin(yaw));
  const bikePos = new THREE.Vector3(p.x, p.y, p.z);
  const riderPos = bikePos.clone().addScaledVector(left, 0.95).addScaledVector(fwd, 0.2);
  // Front-quarter shot: the bike foreshortened behind its rider, both inside the frame.
  const camPos = bikePos.clone().addScaledVector(left, 1.75).addScaledVector(fwd, 5.1).add(new THREE.Vector3(0, 1.3, 0));
  const camLook = bikePos.clone().addScaledVector(left, 0.6).addScaledVector(fwd, 0.4).add(new THREE.Vector3(0, 0.9, 0));
  const toCam = camPos.clone().sub(riderPos).setY(0).normalize();
  const face = toCam.multiplyScalar(0.62).addScaledVector(fwd, 0.38);
  return { bikePos, yaw, riderPos, riderYaw: Math.atan2(face.x, face.z), camPos, camLook, lean: -0.09 };
}

export class HeroView implements View {
  private app: App;
  private camera: THREE.PerspectiveCamera;
  private bike: BikeActor | null = null;
  private rider: RiderActor | null = null;
  private loadout: LoadoutMsg | null;
  private slot: number;
  private layout: HeroLayout;
  private t = 0;
  private dirty = true;
  private occluder: () => number;
  private readonly zero = new THREE.Vector3();

  /**
   * @param loadout the full loadout to present (null: the empty grid bubble before READY).
   * @param occluder screen width (px) covered by UI on the left; the subject is framed to its right.
   */
  constructor(app: App, loadout: LoadoutMsg | null, slot: number, occluder: () => number) {
    this.app = app;
    this.loadout = loadout;
    this.slot = slot;
    this.occluder = occluder;
    this.layout = heroLayout(getTrack(), slot);
    this.camera = new THREE.PerspectiveCamera(31, 1, 0.1, HERO_FAR);
  }

  /** Current framing (the race intro starts from it). */
  get shot(): { layout: HeroLayout; viewShift: number } {
    return { layout: this.layout, viewShift: this.viewShift() };
  }

  set(loadout: LoadoutMsg | null, slot: number): void {
    const same = JSON.stringify(loadout) === JSON.stringify(this.loadout) && slot === this.slot;
    if (same) return;
    this.loadout = loadout;
    if (slot !== this.slot) {
      this.slot = slot;
      this.layout = heroLayout(getTrack(), slot);
    }
    this.dirty = true;
  }

  private rebuild(): void {
    this.dirty = false;
    this.clearActors();
    const lib = this.app.library, world = this.app.world;
    if (!lib || !world || !this.loadout) return;
    const L = this.layout, l = this.loadout;
    this.bike = lib.createBike(l.bikeId, l.bikeColor);
    this.rider = lib.createRider(l.riderId, l.riderColor, l.weaponId);
    if (this.bike) {
      world.scene.add(this.bike.root);
      this.bike.setRiding(L.bikePos, L.yaw, 0, L.lean);
    }
    this.rider?.setShowcase(world.scene, L.riderPos, L.riderYaw, 'hero');
  }

  private clearActors(): void {
    this.rider?.dispose();
    this.bike?.dispose();
    this.rider = null;
    this.bike = null;
  }

  /** Fraction of the screen width the subject is shifted right (to clear the UI). */
  private viewShift(): number {
    const w = this.app.core.width;
    return w > 0 ? Math.min(0.42, this.occluder() / w / 2) : 0;
  }

  update(dt: number, time: number): void {
    const world = this.app.world;
    if (!world) return;
    if (this.dirty) this.rebuild();
    this.t += dt;
    const L = this.layout;
    // A slow breathing push-in keeps the shot alive without revealing more of the street.
    const drift = Math.sin(this.t * 0.18) * 0.25;
    const fwd = new THREE.Vector3(Math.sin(L.yaw), 0, Math.cos(L.yaw));
    this.camera.position.copy(L.camPos).addScaledVector(fwd, drift);
    this.camera.lookAt(L.camLook);
    const w = this.app.core.width, h = this.app.core.height;
    this.camera.aspect = w / Math.max(1, h);
    this.camera.setViewOffset(w, h, -this.viewShift() * w, 0, w, h);
    this.camera.updateProjectionMatrix();
    world.update(dt, time, this.camera, L.bikePos, this.zero);
    // The bubble: nothing of the course is legible past a few dozen metres.
    const fog = world.scene.fog as THREE.FogExp2 | null;
    if (fog) fog.density = Math.max(fog.density, HERO_FOG);
    // Key light: the world's existing moon light re-aimed from the camera side for this shot
    // (no extra light: a changing light count would recompile every material). Directional, so
    // it lights the rider without a light pool on the wet road. Env restores it every frame.
    const moon = world.env.moon;
    const dir = L.camPos.clone().addScaledVector(fwd, 2).add(new THREE.Vector3(0, 7, 0)).sub(L.riderPos).normalize();
    moon.position.copy(L.riderPos).addScaledVector(dir, 40);
    moon.target.position.copy(L.riderPos);
    moon.intensity = 1.35;
    if (this.bike) {
      this.bike.setRiding(L.bikePos, L.yaw, 0, L.lean);
      this.bike.update(dt, { speed: 0, steer: 0, lean: L.lean, boosting: false, airborne: false, compression: 0, crashed: false });
    }
    this.rider?.updateShowcase(dt, this.t);
    this.app.core.water.setRain(0.12, 0, false);
  }

  render(dt: number, time: number): void {
    if (this.app.world) this.app.core.render(this.app.world.scene, this.camera, dt, time);
  }

  dispose(): void {
    this.clearActors();
    this.app.core.water.clear();
  }
}
