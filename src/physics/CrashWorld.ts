// Rapier world for crash physics: static track colliders (road, barriers, tunnel, obstacles)
// plus dynamic tumbling bodies for ejected riders and crashed bikes. Riding bikes use the
// arcade controller; only crash bodies are simulated here.
import RAPIER from '@dimforge/rapier3d-compat';
import { CRASH_RECOVERY, SIM_DT } from '../config/gameplay.js';
import { ROAD_PROFILE } from '../config/track.js';
import type { Quat, V3 } from '../shared/math.js';
import type { Track } from '../game/track/Track.js';
import { buildBarrierBoxes, buildObstacleBoxes, buildRoadColliderChunks } from '../game/track/TrackGeometry.js';

let initPromise: Promise<void> | null = null;
export function initRapier(): Promise<void> {
  if (!initPromise) initPromise = RAPIER.init();
  return initPromise;
}
export { RAPIER };

const GROUP_STATIC = 0x0001;
const GROUP_CRASH = 0x0002;
const groups = (membership: number, filter: number) => (membership << 16) | filter;

export interface CrashBodyPair {
  rider: RAPIER.RigidBody;
  bike: RAPIER.RigidBody;
  time: number;
  riderSettled: boolean;
  bikeSettled: boolean;
}

export interface BodyPose {
  p: V3;
  q: Quat;
}

export class CrashWorld {
  readonly world: RAPIER.World;
  private readonly track: Track;
  private readonly pairs = new Map<number, CrashBodyPair>();

  constructor(track: Track) {
    this.track = track;
    this.world = new RAPIER.World({ x: 0, y: -9.81, z: 0 });
    this.world.timestep = SIM_DT;
    this.buildStatic();
  }

  private buildStatic(): void {
    const fixed = this.world.createRigidBody(RAPIER.RigidBodyDesc.fixed());
    for (const c of buildRoadColliderChunks(this.track)) {
      const d = RAPIER.ColliderDesc.trimesh(c.vertices, c.indices).setFriction(0.9).setRestitution(0.1).setCollisionGroups(groups(GROUP_STATIC, GROUP_CRASH));
      this.world.createCollider(d, fixed);
    }
    for (const b of [...buildBarrierBoxes(this.track), ...buildObstacleBoxes(this.track)]) {
      const d = RAPIER.ColliderDesc.cuboid(b.hx, b.hy, b.hz)
        .setTranslation(b.cx, b.cy, b.cz)
        .setRotation(b.q)
        .setFriction(0.5)
        .setRestitution(0.25)
        .setCollisionGroups(groups(GROUP_STATIC, GROUP_CRASH));
      this.world.createCollider(d, fixed);
    }
  }

  /** Spawns tumbling rider + bike bodies from a crashing bike's state. */
  spawnCrash(id: number, pos: V3, yaw: number, vel: V3, lean: number): void {
    this.removeCrash(id);
    const fx = Math.sin(yaw), fz = Math.cos(yaw);
    const rx = -fz, rz = fx; // right
    const qYaw = { x: 0, y: Math.sin(yaw / 2), z: 0, w: Math.cos(yaw / 2) };
    const speed = Math.hypot(vel.x, vel.z);

    const bikeDesc = RAPIER.RigidBodyDesc.dynamic()
      .setTranslation(pos.x, pos.y + 0.55, pos.z)
      .setRotation(qYaw)
      .setLinvel(vel.x * 0.88, Math.max(vel.y, 0) + 1.2, vel.z * 0.88)
      .setAngvel({ x: fx * (lean >= 0 ? 1 : -1) * 3.5, y: (lean >= 0 ? -1 : 1) * 1.2, z: fz * (lean >= 0 ? 1 : -1) * 3.5 })
      .setLinearDamping(0.35)
      .setAngularDamping(0.8)
      .setCcdEnabled(true);
    const bike = this.world.createRigidBody(bikeDesc);
    this.world.createCollider(
      RAPIER.ColliderDesc.cuboid(0.34, 0.42, 1.05).setDensity(160).setFriction(0.75).setRestitution(0.2).setCollisionGroups(groups(GROUP_CRASH, GROUP_STATIC)),
      bike,
    );

    // Rider launched forward and up, pitching forward (local Y = head direction, Z = chest).
    const riderDesc = RAPIER.RigidBodyDesc.dynamic()
      .setTranslation(pos.x + fx * 0.4, pos.y + 1.35, pos.z + fz * 0.4)
      .setRotation(qYaw)
      .setLinvel(vel.x * 0.74 + rx * lean * 1.5, 3.2 + speed * 0.03, vel.z * 0.74 + rz * lean * 1.5)
      .setAngvel({ x: -rx * 5.5, y: 0.6, z: -rz * 5.5 }) // head-first forward tumble
      .setLinearDamping(0.45)
      .setAngularDamping(1.1)
      .setCcdEnabled(true);
    const rider = this.world.createRigidBody(riderDesc);
    this.world.createCollider(
      RAPIER.ColliderDesc.capsule(0.62, 0.24).setDensity(700).setFriction(0.9).setRestitution(0.12).setCollisionGroups(groups(GROUP_CRASH, GROUP_STATIC)),
      rider,
    );
    this.pairs.set(id, { rider, bike, time: 0, riderSettled: false, bikeSettled: false });
  }

  removeCrash(id: number): void {
    const p = this.pairs.get(id);
    if (!p) return;
    this.world.removeRigidBody(p.rider);
    this.world.removeRigidBody(p.bike);
    this.pairs.delete(id);
  }

  has(id: number): boolean {
    return this.pairs.has(id);
  }

  step(): void {
    this.world.step();
    for (const p of this.pairs.values()) {
      p.time += SIM_DT;
      if (!p.riderSettled) p.riderSettled = this.checkSettled(p.rider, p.time);
      if (!p.bikeSettled) p.bikeSettled = this.checkSettled(p.bike, p.time, CRASH_RECOVERY.bikeSettleSpeed);
    }
  }

  private checkSettled(b: RAPIER.RigidBody, t: number, speed: number = CRASH_RECOVERY.settleSpeed): boolean {
    if (t < CRASH_RECOVERY.ragdollMin) return false;
    const v = b.linvel(), w = b.angvel();
    const slow = Math.hypot(v.x, v.y, v.z) < speed && Math.hypot(w.x, w.y, w.z) < 1.2;
    if (slow || t >= CRASH_RECOVERY.forcedSettle) {
      b.setBodyType(RAPIER.RigidBodyType.KinematicPositionBased, true);
      b.setLinvel({ x: 0, y: 0, z: 0 }, false);
      b.setAngvel({ x: 0, y: 0, z: 0 }, false);
      return true;
    }
    return false;
  }

  pair(id: number): CrashBodyPair | undefined {
    return this.pairs.get(id);
  }

  riderPose(id: number): BodyPose | null {
    const p = this.pairs.get(id);
    if (!p) return null;
    return { p: { ...p.rider.translation() }, q: { ...p.rider.rotation() } };
  }

  bikePose(id: number): BodyPose | null {
    const p = this.pairs.get(id);
    if (!p) return null;
    return { p: { ...p.bike.translation() }, q: { ...p.bike.rotation() } };
  }

  /** Face-up when the rider's chest (local +Z) points upward once settled. */
  riderFaceUp(id: number): boolean {
    const p = this.pairs.get(id);
    if (!p) return true;
    const q = p.rider.rotation();
    // Rotate (0,0,1) by q -> y component
    const y = 2 * (q.y * q.z - q.w * q.x);
    return y >= 0;
  }

  /** Moves a (settled, kinematic) body. */
  setPose(id: number, which: 'rider' | 'bike', pos: V3, q: Quat): void {
    const p = this.pairs.get(id);
    if (!p) return;
    const b = which === 'rider' ? p.rider : p.bike;
    if (b.bodyType() !== RAPIER.RigidBodyType.KinematicPositionBased) b.setBodyType(RAPIER.RigidBodyType.KinematicPositionBased, true);
    b.setTranslation(pos, true);
    b.setRotation(q, true);
  }

  /** True if a body left the accessible world (water, below the road, outside containment). */
  isInaccessible(track: Track, pos: V3, hintS: number): boolean {
    if (pos.y < ROAD_PROFILE.waterY + 1.2 && track.isOverWater(pos.x, pos.z)) return true;
    const pr = track.project(pos.x, pos.y, pos.z, hintS, 80, 80);
    if (pr.height < -4) return true;
    if (Math.abs(pr.lateral) > track.barrierOffsetAt(pr.s) + ROAD_PROFILE.barrierThickness + 0.2) return true;
    if (track.isInGap(pr.s) && pr.height < -0.5) return true;
    return false;
  }

  dispose(): void {
    this.world.free();
  }
}
