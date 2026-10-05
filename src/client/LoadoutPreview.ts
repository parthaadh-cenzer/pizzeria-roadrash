// Loadout 3D preview on a wet neon studio stage. Each step shows only what it is about:
//  - character / colour / name: the rider alone, standing in a relaxed breathing idle;
//  - bike / bike colour: the bike alone on a slow turntable (wheels turning, steering and hover
//    systems alive);
//  - weapon: the weapon alone, turning slowly (the Morning Star's ball hangs and sways; Zabimaru
//    shows its compact rest state).
// The complete loadout appears for the first time at READY, in the start-grid hero view.
import * as THREE from 'three';
import type { LoadoutMsg } from '../shared/protocol.js';
import type { BikeActor } from '../render/actors/BikeActor.js';
import type { RiderActor } from '../render/actors/RiderActor.js';
import type { WeaponActor } from '../render/actors/WeaponActor.js';
import { Rain } from '../render/vfx/Rain.js';
import type { App, View } from './App.js';

type Subject = 'rider' | 'bike' | 'weapon';

export function subjectForStep(step: number): Subject {
  return step <= 2 ? 'rider' : step <= 4 ? 'bike' : 'weapon';
}

export class LoadoutPreview implements View {
  private app: App;
  private scene = new THREE.Scene();
  private camera = new THREE.PerspectiveCamera(34, 1, 0.05, 200);
  private turntable = new THREE.Group();
  private weaponPivot = new THREE.Group();
  private bike: BikeActor | null = null;
  private rider: RiderActor | null = null;
  private weapon: WeaponActor | null = null;
  private l: LoadoutMsg;
  private subject: Subject = 'rider';
  private camPos = new THREE.Vector3(0.9, 1.15, 3.6);
  private camLook = new THREE.Vector3(0, 0.95, 0);
  private camInit = false;
  private rain: Rain;
  private t = 0;
  private dirty = true;
  /** performance.now() when a parallel shader compile for new models started (0 = none pending). */
  private compiling = 0;

  constructor(app: App, l: LoadoutMsg) {
    this.app = app;
    this.l = { ...l };
    const env = app.world?.env.envMap ?? null;
    this.scene.environment = env;
    this.scene.environmentIntensity = 1.0;
    this.scene.background = new THREE.Color(0x06070e);
    this.scene.fog = new THREE.FogExp2(0x0a0818, 0.045);
    this.scene.add(new THREE.HemisphereLight(0x3a3a78, 0x140a18, 1.2));
    const key = new THREE.DirectionalLight(0xdfe6ff, 2.8);
    key.position.set(3, 6, 4);
    // Soft fill from the camera side so dark armour still reads against the night backdrop.
    const fill = new THREE.DirectionalLight(0xb8c4ff, 1.1);
    fill.position.set(4, 2.2, 1.5);
    this.scene.add(key, fill);
    // Rim lights high and behind the subject so their floor reflections stay out of frame.
    for (const [c, x, z] of [[0xff2bd6, -5, -3], [0x18e0ff, 3, -5], [0xff7a1a, -4, 3]] as const) {
      const p = new THREE.PointLight(c, 42, 18, 1.6);
      p.position.set(x, 4.5, z);
      this.scene.add(p);
    }
    const floor = new THREE.Mesh(new THREE.CircleGeometry(9, 64), new THREE.MeshPhysicalMaterial({ color: 0x0b0d14, roughness: 0.3, metalness: 0.2, clearcoat: 1, clearcoatRoughness: 0.22 }));
    floor.rotation.x = -Math.PI / 2;
    this.scene.add(floor);
    const ring = new THREE.Mesh(new THREE.RingGeometry(2.6, 2.7, 96), new THREE.MeshBasicMaterial({ color: new THREE.Color(0xff2bd6).multiplyScalar(3) }));
    ring.rotation.x = -Math.PI / 2;
    ring.position.y = 0.01;
    this.scene.add(ring, this.turntable, this.weaponPivot);
    this.rain = new Rain(1500);
    this.scene.add(this.rain.group);
  }

  apply(p: Partial<LoadoutMsg>): void {
    const next = { ...this.l, ...p };
    const changed = (k: keyof LoadoutMsg) => next[k] !== this.l[k];
    if ((this.subject === 'rider' && (changed('riderId') || changed('riderColor'))) || (this.subject === 'bike' && (changed('bikeId') || changed('bikeColor'))) || (this.subject === 'weapon' && changed('weaponId'))) this.dirty = true;
    this.l = next;
  }

  focusStep(i: number): void {
    const s = subjectForStep(i);
    if (s !== this.subject) {
      this.subject = s;
      this.dirty = true;
      this.camInit = false;
    }
  }

  private clearSubject(): void {
    this.rider?.dispose();
    this.bike?.dispose();
    this.weapon?.dispose();
    this.weaponPivot.clear();
    this.rider = this.bike = this.weapon = null;
  }

  private rebuild(): void {
    this.dirty = false;
    this.clearSubject();
    const lib = this.app.library;
    if (!lib) return;
    this.turntable.rotation.y = 0.6;
    if (this.subject === 'rider') {
      // Weapon hidden: the character is the subject.
      this.rider = lib.createRider(this.l.riderId, this.l.riderColor, null);
      this.rider?.setShowcase(this.scene, new THREE.Vector3(), 0.38, 'hidden');
    } else if (this.subject === 'bike') {
      this.bike = lib.createBike(this.l.bikeId, this.l.bikeColor);
      if (this.bike) {
        this.turntable.add(this.bike.root);
        this.bike.setRiding(new THREE.Vector3(), 0, 0, 0);
      }
    } else {
      this.weapon = lib.createWeapon(this.l.weaponId);
      if (this.weapon) this.weaponPivot.add(this.weapon.grip);
    }
    const started = (this.compiling = performance.now());
    this.app.core
      .precompile(this.scene, this.camera)
      .catch((e) => console.warn('[loadout] shader precompile incomplete', e))
      .finally(() => {
        if (this.compiling === started) this.compiling = 0;
      });
  }

  update(dt: number, time: number): void {
    if (this.dirty) this.rebuild();
    this.t += dt;
    let wantPos: THREE.Vector3, wantLook: THREE.Vector3;
    if (this.subject === 'rider') {
      this.rider?.updateShowcase(dt, this.t);
      // Full body, eye level slightly below the head: nothing cropped.
      wantPos = new THREE.Vector3(1.15, 1.12, 3.75);
      wantLook = new THREE.Vector3(0, 0.93, 0);
    } else if (this.subject === 'bike') {
      this.turntable.rotation.y += dt * 0.28;
      const bike = this.bike;
      if (bike) {
        // Wheels roll slowly; the Sci-Fi bars sweep gently; hover systems idle.
        bike.setRiding(new THREE.Vector3(), 0, 0, 0);
        bike.update(dt, { speed: 2.2, steer: Math.sin(this.t * 0.7) * 0.55, lean: 0, boosting: false, airborne: false, compression: 0, crashed: false });
      }
      const len = bike ? bike.info.length : 2.2, hgt = bike ? bike.info.height : 1.1;
      const d = 1.9 + len * 1.15;
      wantPos = new THREE.Vector3(0.72, 0.34, 0.69).normalize().multiplyScalar(d).add(new THREE.Vector3(0, hgt * 0.35, 0));
      wantLook = new THREE.Vector3(0, hgt * 0.45, 0);
    } else {
      const w = this.weapon;
      const len = w ? w.length : 1;
      const flail = this.l.weaponId === 'MORNING_STAR';
      // Held at chest height, turning slowly; the flail hangs from its handle so the ball sways.
      this.weaponPivot.position.set(0, flail ? 1.75 : 1.12 + Math.sin(this.t * 0.9) * 0.03, 0);
      this.weaponPivot.rotation.set(flail ? Math.PI : 0, this.t * 0.45, flail ? Math.sin(this.t * 0.8) * 0.12 : -0.95);
      this.weaponPivot.updateMatrixWorld(true);
      w?.update(dt, null, 0);
      const d = flail ? 0.9 + len * 1.8 : 0.6 + len * 1.25;
      const cy = flail ? 1.75 - len * 0.6 : 1.12;
      wantPos = new THREE.Vector3(0.5, 0.12, 1).normalize().multiplyScalar(d).add(new THREE.Vector3(0, cy, 0));
      wantLook = new THREE.Vector3(0, cy, 0);
    }
    if (!this.camInit) {
      this.camPos.copy(wantPos);
      this.camLook.copy(wantLook);
      this.camInit = true;
    }
    const k = 1 - Math.exp(-dt / 0.35);
    this.camPos.lerp(wantPos, k);
    this.camLook.lerp(wantLook, k);
    this.camera.position.copy(this.camPos);
    this.camera.lookAt(this.camLook);
    // Centre the subject in the area to the right of the loadout panel.
    const w = this.app.core.width, h = this.app.core.height;
    const panel = document.querySelector('.loadout .side')?.getBoundingClientRect();
    const panelW = panel && panel.width > 0 ? panel.right : 0;
    this.camera.aspect = w / h;
    this.camera.setViewOffset(w, h, -panelW / 2, 0, w, h);
    this.camera.updateProjectionMatrix();
    this.rain.update(time, this.camera, 1.2, 1, new THREE.Vector3());
    this.app.core.water.setRain(0.15, 0, false);
  }

  render(dt: number, time: number): void {
    // Keep the previous frame while new models' shaders compile (bounded wait).
    if (this.compiling && performance.now() - this.compiling < 4000) return;
    this.app.core.render(this.scene, this.camera, dt, time);
  }

  dispose(): void {
    this.clearSubject();
    this.app.core.water.clear();
  }
}
