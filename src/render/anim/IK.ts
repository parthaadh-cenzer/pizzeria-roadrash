// World-space bone manipulation and analytic two-bone IK for the procedural riding pose.
import * as THREE from 'three';

const _q = new THREE.Quaternion();
const _q2 = new THREE.Quaternion();
const _v1 = new THREE.Vector3();
const _v2 = new THREE.Vector3();
const _v3 = new THREE.Vector3();

export function worldQuat(o: THREE.Object3D, out = new THREE.Quaternion()): THREE.Quaternion {
  return o.getWorldQuaternion(out);
}

export function worldPos(o: THREE.Object3D, out = new THREE.Vector3()): THREE.Vector3 {
  return o.getWorldPosition(out);
}

/** Sets a bone's world rotation (keeps its parent's). Updates the subtree matrices. */
export function setWorldQuat(bone: THREE.Object3D, q: THREE.Quaternion): void {
  if (bone.parent) {
    bone.parent.getWorldQuaternion(_q2).invert();
    bone.quaternion.copy(_q2.multiply(q));
  } else bone.quaternion.copy(q);
  bone.updateMatrixWorld(true);
}

/** Applies a world-space rotation delta to a bone. */
export function rotateWorld(bone: THREE.Object3D, delta: THREE.Quaternion): void {
  bone.getWorldQuaternion(_q);
  setWorldQuat(bone, _q.premultiply(delta));
}

/** Rotates the bone so the direction (bone -> childPos) points toward target, weighted. */
export function aim(bone: THREE.Object3D, childPos: THREE.Vector3, target: THREE.Vector3, weight = 1): void {
  const p = worldPos(bone, _v1);
  const from = _v2.copy(childPos).sub(p);
  const to = _v3.copy(target).sub(p);
  if (from.lengthSq() < 1e-10 || to.lengthSq() < 1e-10) return;
  const d = new THREE.Quaternion().setFromUnitVectors(from.normalize(), to.normalize());
  if (weight < 1) d.slerp(new THREE.Quaternion(), 1 - weight);
  rotateWorld(bone, d);
}

/**
 * Analytic two-bone IK (shoulder/elbow/hand or hip/knee/foot). `pole` is a world point the
 * middle joint bends toward.
 */
export function twoBoneIK(upper: THREE.Object3D, mid: THREE.Object3D, end: THREE.Object3D, target: THREE.Vector3, pole: THREE.Vector3, weight = 1): void {
  if (weight <= 0.001) return;
  const a0 = worldPos(upper), m0 = worldPos(mid), e0 = worldPos(end);
  const la = a0.distanceTo(m0), lb = m0.distanceTo(e0);
  if (la < 1e-5 || lb < 1e-5) return;
  const tgt = target.clone();
  if (weight < 1) tgt.lerp(e0, 1 - weight);
  const toT = tgt.clone().sub(a0);
  const d = THREE.MathUtils.clamp(toT.length(), Math.abs(la - lb) + 1e-4, la + lb - 1e-4);
  const dirT = toT.normalize();
  // Bend plane from the pole.
  const toPole = pole.clone().sub(a0);
  let n = new THREE.Vector3().crossVectors(dirT, toPole);
  if (n.lengthSq() < 1e-8) n = new THREE.Vector3().crossVectors(dirT, new THREE.Vector3(0, 1, 0));
  n.normalize();
  const cosA = THREE.MathUtils.clamp((la * la + d * d - lb * lb) / (2 * la * d), -1, 1);
  const angA = Math.acos(cosA);
  // Rotate dirT toward the pole side by angA around n (cross(dirT, pole) x dirT points poleward).
  const midDir = dirT.clone().applyAxisAngle(n, angA);
  const wantMid = a0.clone().addScaledVector(midDir, la);
  aim(upper, m0, wantMid);
  aim(mid, worldPos(end), a0.clone().addScaledVector(dirT, d));
}

/** Curls finger chains toward the palm (fist / grip). Axes are precomputed at rig build. */
export interface FingerCurl {
  hand: THREE.Object3D;
  chains: { bones: THREE.Object3D[]; axisHandLocal: THREE.Vector3; thumb: boolean }[];
}

export function buildFingerCurl(bones: Map<string, THREE.Object3D>, side: 'left' | 'right'): FingerCurl | null {
  const hand = bones.get(`${side}Hand`);
  const mid = bones.get(`${side}Middle1`), idx = bones.get(`${side}Index1`), pinky = bones.get(`${side}Pinky1`), thumb = bones.get(`${side}Thumb1`);
  if (!hand || !mid || !idx || !pinky || !thumb) return null;
  const hp = worldPos(hand), mp = worldPos(mid), tp = worldPos(thumb);
  const fingerDir = mp.clone().sub(hp).normalize();
  const thumbDir = tp.clone().sub(hp).normalize();
  const palm = side === 'left' ? new THREE.Vector3().crossVectors(fingerDir, thumbDir) : new THREE.Vector3().crossVectors(thumbDir, fingerDir);
  palm.normalize();
  const axisWorld = new THREE.Vector3().crossVectors(fingerDir, palm).normalize();
  const handInv = worldQuat(hand).invert();
  const axisHandLocal = axisWorld.clone().applyQuaternion(handInv);
  const chains: FingerCurl['chains'] = [];
  for (const f of ['Index', 'Middle', 'Ring', 'Pinky']) {
    const list = [1, 2, 3].map((k) => bones.get(`${side}${f}${k}`)).filter((b): b is THREE.Object3D => !!b);
    if (list.length) chains.push({ bones: list, axisHandLocal: axisHandLocal.clone(), thumb: false });
  }
  const tlist = [1, 2, 3].map((k) => bones.get(`${side}Thumb${k}`)).filter((b): b is THREE.Object3D => !!b);
  if (tlist.length) chains.push({ bones: tlist.slice(1), axisHandLocal: axisHandLocal.clone(), thumb: true });
  return { hand, chains };
}

export function applyFingerCurl(fc: FingerCurl, amount: number): void {
  if (amount <= 0.01) return;
  const hq = worldQuat(fc.hand);
  for (const c of fc.chains) {
    const axis = c.axisHandLocal.clone().applyQuaternion(hq);
    const ang = (c.thumb ? 0.5 : 1.25) * amount;
    const q = new THREE.Quaternion().setFromAxisAngle(axis, ang);
    for (const b of c.bones) rotateWorld(b, q);
  }
}
