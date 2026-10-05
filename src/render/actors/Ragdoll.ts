// Visual crash ragdoll (client). Articulated capsule bodies joined by spherical joints collide
// with the static track colliders; the pelvis is softly pulled toward the host's authoritative
// rider body so every client agrees on where the rider ends up.
import * as THREE from 'three';
import { RAPIER } from '../../physics/CrashWorld.js';
import { setWorldQuat } from '../anim/IK.js';
import type { Rig } from '../anim/Retarget.js';

interface Part {
  bone: THREE.Object3D;
  body: RAPIER.RigidBody;
  parent: number;
}

const PARTS: { bone: string; to: string | null; radius: number; parent: string | null; len?: number }[] = [
  { bone: 'hips', to: 'spine', radius: 0.14, parent: null, len: 0.18 },
  { bone: 'chest', to: 'neck', radius: 0.15, parent: 'hips' },
  { bone: 'head', to: null, radius: 0.11, parent: 'chest', len: 0.2 },
  { bone: 'leftUpperArm', to: 'leftLowerArm', radius: 0.05, parent: 'chest' },
  { bone: 'leftLowerArm', to: 'leftHand', radius: 0.045, parent: 'leftUpperArm' },
  { bone: 'rightUpperArm', to: 'rightLowerArm', radius: 0.05, parent: 'chest' },
  { bone: 'rightLowerArm', to: 'rightHand', radius: 0.045, parent: 'rightUpperArm' },
  { bone: 'leftUpperLeg', to: 'leftLowerLeg', radius: 0.075, parent: 'hips' },
  { bone: 'leftLowerLeg', to: 'leftFoot', radius: 0.06, parent: 'leftUpperLeg' },
  { bone: 'rightUpperLeg', to: 'rightLowerLeg', radius: 0.075, parent: 'hips' },
  { bone: 'rightLowerLeg', to: 'rightFoot', radius: 0.06, parent: 'rightUpperLeg' },
];

const GROUPS = (0x0002 << 16) | 0x0001; // member: crash, filter: static

export class Ragdoll {
  private world: RAPIER.World;
  private parts: Part[] = [];
  private joints: RAPIER.ImpulseJoint[] = [];
  private rig: Rig;
  alive = true;

  constructor(world: RAPIER.World, rig: Rig, velocity: THREE.Vector3, spin: number) {
    this.world = world;
    this.rig = rig;
    rig.root.updateMatrixWorld(true);
    const index = new Map<string, number>();
    for (const def of PARTS) {
      const bone = rig.bones.get(def.bone);
      if (!bone) continue;
      const p = bone.getWorldPosition(new THREE.Vector3());
      const q = bone.getWorldQuaternion(new THREE.Quaternion());
      let dirW: THREE.Vector3;
      let len: number;
      const child = def.to ? rig.bones.get(def.to) : null;
      if (child) {
        const cp = child.getWorldPosition(new THREE.Vector3());
        dirW = cp.sub(p);
        len = Math.max(0.08, dirW.length());
        dirW.normalize();
      } else {
        dirW = new THREE.Vector3(0, 1, 0).applyQuaternion(q);
        len = def.len ?? 0.2;
      }
      const invQ = q.clone().invert();
      const dirL = dirW.clone().applyQuaternion(invQ);
      const colQ = new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0, 1, 0), dirL);
      const mid = dirL.clone().multiplyScalar(len / 2);
      const body = world.createRigidBody(
        RAPIER.RigidBodyDesc.dynamic()
          .setTranslation(p.x, p.y, p.z)
          .setRotation({ x: q.x, y: q.y, z: q.z, w: q.w })
          .setLinvel(velocity.x, velocity.y, velocity.z)
          .setAngvel({ x: (Math.random() - 0.5) * spin, y: (Math.random() - 0.5) * spin, z: (Math.random() - 0.5) * spin })
          .setLinearDamping(0.35)
          .setAngularDamping(1.4)
          .setCcdEnabled(true),
      );
      world.createCollider(
        RAPIER.ColliderDesc.capsule(Math.max(0.01, len / 2 - def.radius * 0.5), def.radius)
          .setTranslation(mid.x, mid.y, mid.z)
          .setRotation({ x: colQ.x, y: colQ.y, z: colQ.z, w: colQ.w })
          .setDensity(900)
          .setFriction(0.9)
          .setRestitution(0.05)
          .setCollisionGroups(GROUPS),
        body,
      );
      const parentIdx = def.parent ? (index.get(def.parent) ?? -1) : -1;
      index.set(def.bone, this.parts.length);
      this.parts.push({ bone, body, parent: parentIdx });
      if (parentIdx >= 0) {
        const pb = this.parts[parentIdx]!.body;
        const pt = pb.translation(), pr = pb.rotation();
        const pq = new THREE.Quaternion(pr.x, pr.y, pr.z, pr.w).invert();
        const a1 = p.clone().sub(new THREE.Vector3(pt.x, pt.y, pt.z)).applyQuaternion(pq);
        const data = RAPIER.JointData.spherical({ x: a1.x, y: a1.y, z: a1.z }, { x: 0, y: 0, z: 0 });
        this.joints.push(world.createImpulseJoint(data, pb, body, true));
      }
    }
  }

  /** Steers the pelvis toward the authoritative rider position (critically damped spring). */
  steer(target: THREE.Vector3, dt: number): void {
    const pelvis = this.parts[0];
    if (!pelvis) return;
    const t = pelvis.body.translation(), v = pelvis.body.linvel();
    const k = 45, c = 11;
    const m = pelvis.body.mass();
    pelvis.body.applyImpulse({ x: ((target.x - t.x) * k - v.x * c) * m * dt, y: ((target.y + 0.1 - t.y) * k * 0.6 - v.y * c * 0.3) * m * dt, z: ((target.z - t.z) * k - v.z * c) * m * dt }, true);
  }

  /** Writes body transforms onto the skeleton (parents before children). */
  apply(): void {
    const hips = this.parts[0];
    if (!hips) return;
    const t = hips.body.translation();
    const hipsBone = hips.bone;
    const parentInv = hipsBone.parent ? hipsBone.parent.matrixWorld.clone().invert() : new THREE.Matrix4();
    hipsBone.position.copy(new THREE.Vector3(t.x, t.y, t.z).applyMatrix4(parentInv));
    hipsBone.updateMatrixWorld(true);
    for (const p of this.parts) {
      const r = p.body.rotation();
      setWorldQuat(p.bone, new THREE.Quaternion(r.x, r.y, r.z, r.w));
    }
  }

  pelvisPosition(out = new THREE.Vector3()): THREE.Vector3 {
    const t = this.parts[0]?.body.translation();
    return t ? out.set(t.x, t.y, t.z) : out;
  }

  dispose(): void {
    if (!this.alive) return;
    this.alive = false;
    for (const j of this.joints) this.world.removeImpulseJoint(j, true);
    for (const p of this.parts) this.world.removeRigidBody(p.body);
    this.parts = [];
    this.joints = [];
    void this.rig;
  }
}
