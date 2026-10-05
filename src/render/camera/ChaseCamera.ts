// Chase camera (HANDOFF/03 "Camera"): chase distance 5.2 m, height 2.15 m, FOV 68->84 deg with
// speed and ~92 deg while boosting, acceleration pull-back / braking push-in, impact shake,
// camera collision against tunnel/bridge/world colliders, crash follow and recovery reframing.
import * as THREE from 'three';
import { CAMERA, SPEED } from '../../config/gameplay.js';
import { clamp, damp, wrapAngle } from '../../shared/math.js';
import { RAPIER } from '../../physics/CrashWorld.js';

export interface ChaseTarget {
  pos: THREE.Vector3;
  yaw: number;
  pitch: number;
  lean: number;
  speed: number;
  boosting: boolean;
  crashed: boolean;
  riderPos: THREE.Vector3;
  /** In the air (bridge jump): subtle pull-back, lift and wider FOV. */
  airborne?: boolean;
}

export class ChaseCamera {
  readonly camera: THREE.PerspectiveCamera;
  private yaw = 0;
  // Camera and look point are smoothed as offsets from the target, so the locked chase distance
  // holds at any speed (smoothing absolute positions would trail by speed x time constant).
  private offset = new THREE.Vector3();
  private lookOffset = new THREE.Vector3();
  private snap: { pos: THREE.Vector3; look: THREE.Vector3 } | null = null;
  private pos = new THREE.Vector3();
  private look = new THREE.Vector3();
  private lastSpeed = 0;
  private accel = 0;
  private shakeAmt = 0;
  private air = 0;
  private dip = 0;
  private fov: number = CAMERA.fovLow;
  private init = false;
  readonly velocity = new THREE.Vector3();
  private prev = new THREE.Vector3();

  constructor(far: number) {
    this.camera = new THREE.PerspectiveCamera(CAMERA.fovLow, 1, 0.1, far);
  }

  shake(impulse: number): void {
    this.shakeAmt = Math.min(1.4, this.shakeAmt + impulse);
  }

  /** Landing compression: the camera sinks briefly with the suspension, then recovers. */
  land(verticalSpeed: number): void {
    this.dip = Math.min(0.55, this.dip + verticalSpeed * 0.07);
  }

  /** Jumps to a pose (used when handing over from the intro camera). */
  snapTo(pos: THREE.Vector3, look: THREE.Vector3, yaw: number): void {
    this.snap = { pos: pos.clone(), look: look.clone() };
    this.yaw = yaw;
    this.init = true;
  }

  desiredFor(t: ChaseTarget): { pos: THREE.Vector3; look: THREE.Vector3 } {
    const fwd = new THREE.Vector3(Math.sin(t.yaw), 0, Math.cos(t.yaw));
    return {
      pos: t.pos.clone().addScaledVector(fwd, -CAMERA.chaseDistance).add(new THREE.Vector3(0, CAMERA.baseHeight, 0)),
      look: t.pos.clone().addScaledVector(fwd, CAMERA.lookAhead).add(new THREE.Vector3(0, 1.1, 0)),
    };
  }

  update(dt: number, t: ChaseTarget, aspect: number, world: RAPIER.World | null): void {
    const cam = this.camera;
    const a = (t.speed - this.lastSpeed) / Math.max(dt, 1e-3);
    this.lastSpeed = t.speed;
    this.accel = damp(this.accel, a, 0.25, dt);
    let wantPos: THREE.Vector3, wantLook: THREE.Vector3;
    let fovTarget: number;
    if (t.crashed) {
      // Follow the rider, then frame rider + bike together during recovery.
      const mid = t.riderPos.clone().lerp(t.pos, 0.5);
      const spread = t.riderPos.distanceTo(t.pos);
      const back = new THREE.Vector3(Math.sin(this.yaw), 0, Math.cos(this.yaw));
      wantLook = mid.clone().add(new THREE.Vector3(0, 0.8, 0));
      wantPos = mid.clone().addScaledVector(back, -(7 + spread * 0.6)).add(new THREE.Vector3(0, 3.2 + spread * 0.25, 0));
      fovTarget = CAMERA.fovLow;
    } else {
      this.yaw = this.init ? this.yaw + wrapAngle(t.yaw - this.yaw) * (1 - Math.exp(-dt / 0.14)) : t.yaw;
      const fwd = new THREE.Vector3(Math.sin(this.yaw), 0, Math.cos(this.yaw));
      const pull = clamp(this.accel / 12, 0, 1) * CAMERA.accelPullback - clamp(-this.accel / 20, 0, 1) * CAMERA.brakePushIn;
      this.air = damp(this.air, t.airborne ? 1 : 0, t.airborne ? 0.22 : 0.35, dt);
      this.dip = Math.max(0, this.dip - dt * 1.6);
      const dist = CAMERA.chaseDistance + pull + Math.max(0, t.speed) * 0.006 + this.air * 1.3;
      wantPos = t.pos.clone().addScaledVector(fwd, -dist).add(new THREE.Vector3(0, CAMERA.baseHeight - Math.sin(t.pitch) * 1.2 + this.air * 0.55 - this.dip, 0));
      wantLook = t.pos.clone().addScaledVector(fwd, CAMERA.lookAhead).add(new THREE.Vector3(0, 1.1, 0));
      const s01 = clamp(Math.abs(t.speed) / SPEED.physicsMax, 0, 1);
      fovTarget = (t.boosting ? CAMERA.fovBoost : CAMERA.fovLow + (CAMERA.fovHigh - CAMERA.fovLow) * s01 * s01) + this.air * 4;
    }
    const wantOff = wantPos.clone().sub(t.pos);
    const wantLookOff = wantLook.clone().sub(t.pos);
    if (this.snap) {
      this.offset.copy(this.snap.pos).sub(t.pos);
      this.lookOffset.copy(this.snap.look).sub(t.pos);
      this.snap = null;
    } else if (!this.init) {
      this.offset.copy(wantOff);
      this.lookOffset.copy(wantLookOff);
      this.init = true;
    }
    if (t.crashed) {
      // A tumbling bike moves erratically: smooth the camera in world space instead.
      const p = t.pos.clone().add(this.offset), l = t.pos.clone().add(this.lookOffset);
      p.x = damp(p.x, wantPos.x, 0.35, dt);
      p.y = damp(p.y, wantPos.y, 0.35 * 1.6, dt);
      p.z = damp(p.z, wantPos.z, 0.35, dt);
      l.lerp(wantLook, 1 - Math.exp(-dt / 0.25));
      this.offset.copy(p).sub(t.pos);
      this.lookOffset.copy(l).sub(t.pos);
    } else {
      const tau = 0.055;
      this.offset.x = damp(this.offset.x, wantOff.x, tau, dt);
      this.offset.y = damp(this.offset.y, wantOff.y, tau * 1.6, dt);
      this.offset.z = damp(this.offset.z, wantOff.z, tau, dt);
      this.lookOffset.lerp(wantLookOff, 1 - Math.exp(-dt / 0.04));
    }
    this.pos.copy(t.pos).add(this.offset);
    this.look.copy(t.pos).add(this.lookOffset);
    this.fov = damp(this.fov, fovTarget, t.boosting ? 0.18 : 0.45, dt);

    // Collision: pull the camera in front of any collider between the target and the camera.
    const finalPos = this.pos.clone();
    if (world) {
      const origin = t.crashed ? this.look.clone() : t.pos.clone().add(new THREE.Vector3(0, 1.3, 0));
      const dir = finalPos.clone().sub(origin);
      const len = dir.length();
      if (len > 0.2) {
        dir.divideScalar(len);
        // Static world colliders only (ragdoll bodies never block the camera).
        const hit = world.castRay(new RAPIER.Ray(origin, dir), len, true, undefined, 0xffff0001);
        if (hit) finalPos.copy(origin).addScaledVector(dir, Math.max(0.4, hit.timeOfImpact - 0.3));
      }
    }
    // Impact shake proportional to collision strength.
    this.shakeAmt = Math.max(0, this.shakeAmt - dt * 2.8);
    const sh = this.shakeAmt * this.shakeAmt * 0.35;
    if (sh > 0) finalPos.add(new THREE.Vector3((Math.random() - 0.5) * sh, (Math.random() - 0.5) * sh, (Math.random() - 0.5) * sh));
    cam.position.copy(finalPos);
    cam.up.set(0, 1, 0);
    cam.lookAt(this.look);
    if (!t.crashed) cam.rotateZ(-t.lean * 0.12);
    cam.fov = this.fov;
    cam.aspect = aspect;
    cam.updateProjectionMatrix();
    this.velocity.copy(cam.position).sub(this.prev).divideScalar(Math.max(dt, 1e-3));
    this.prev.copy(cam.position);
  }
}
