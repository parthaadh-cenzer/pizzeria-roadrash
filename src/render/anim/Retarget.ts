// Retargeting of canonical (semantic, world-space) clips onto any rider/crowd rig.
// Rest poses differ (Mixamo T-pose vs ARP/custom A-poses); each semantic bone gets an alignment
// rotation mapping its target rest direction onto the source rest direction, then the source's
// world-space delta from rest is applied: T(t) = D(t) * A * T0, D(t) = S(t) * S0^-1.
import * as THREE from 'three';
import { DIRECTION_CHILD, FINGER_BONES, SEMANTIC_BONES, type CanonicalClip, type SemanticBone } from '../../config/skeleton.js';

export interface Rig {
  root: THREE.Object3D;
  bones: Map<string, THREE.Object3D>;
  /** Every bone under the root, parents before children. */
  order: THREE.Object3D[];
  restLocalQ: Map<THREE.Object3D, THREE.Quaternion>;
  restLocalP: Map<THREE.Object3D, THREE.Vector3>;
  restLocalS: Map<THREE.Object3D, THREE.Vector3>;
  /** Model-space (relative to root) rest rotations/positions. */
  restModelQ: Map<THREE.Object3D, THREE.Quaternion>;
  restModelM: Map<THREE.Object3D, THREE.Matrix4>;
  restModelP: Map<string, THREE.Vector3>;
  hipsHeight: number;
}

const SEMANTIC_SET = new Set<string>([...SEMANTIC_BONES, ...FINGER_BONES]);

/** Builds rig info from a model in its rest (bind) pose. Bones are named semantically by the pipeline. */
export function buildRig(root: THREE.Object3D): Rig {
  root.updateMatrixWorld(true);
  const rootInv = root.matrixWorld.clone().invert();
  const bones = new Map<string, THREE.Object3D>();
  const order: THREE.Object3D[] = [];
  const restLocalQ = new Map<THREE.Object3D, THREE.Quaternion>();
  const restLocalP = new Map<THREE.Object3D, THREE.Vector3>();
  const restLocalS = new Map<THREE.Object3D, THREE.Vector3>();
  const restModelQ = new Map<THREE.Object3D, THREE.Quaternion>();
  const restModelM = new Map<THREE.Object3D, THREE.Matrix4>();
  const restModelP = new Map<string, THREE.Vector3>();
  root.traverse((o) => {
    if (o === root) return;
    order.push(o);
    restLocalQ.set(o, o.quaternion.clone());
    restLocalP.set(o, o.position.clone());
    restLocalS.set(o, o.scale.clone());
    const m = rootInv.clone().multiply(o.matrixWorld);
    restModelM.set(o, m);
    const p = new THREE.Vector3(), q = new THREE.Quaternion(), s = new THREE.Vector3();
    m.decompose(p, q, s);
    restModelQ.set(o, q);
    if (SEMANTIC_SET.has(o.name) && !bones.has(o.name)) {
      bones.set(o.name, o);
      restModelP.set(o.name, p);
    }
  });
  const hips = restModelP.get('hips');
  return { root, bones, order, restLocalQ, restLocalP, restLocalS, restModelQ, restModelM, restModelP, hipsHeight: hips ? hips.y : 1 };
}

/** Restores every bone to its rest transform. */
export function resetToRest(rig: Rig): void {
  for (const o of rig.order) {
    o.quaternion.copy(rig.restLocalQ.get(o)!);
    o.position.copy(rig.restLocalP.get(o)!);
  }
}

function alignments(clip: CanonicalClip, rig: Rig): Map<string, THREE.Quaternion> {
  const out = new Map<string, THREE.Quaternion>();
  const src = clip.restPos;
  for (const b of SEMANTIC_BONES) {
    const child = DIRECTION_CHILD[b];
    let a: THREE.Quaternion | null = null;
    if (child) {
      const tp = rig.restModelP.get(b), tc = rig.restModelP.get(child);
      const sp = src[b], sc = src[child];
      if (tp && tc && sp && sc) {
        const dT = tc.clone().sub(tp);
        const dS = new THREE.Vector3(sc[0] - sp[0], sc[1] - sp[1], sc[2] - sp[2]);
        if (dT.lengthSq() > 1e-8 && dS.lengthSq() > 1e-8) a = new THREE.Quaternion().setFromUnitVectors(dT.normalize(), dS.normalize());
      }
    }
    if (!a) {
      // Inherit the parent's alignment (head, toes, degenerate bones).
      const parentName = parentSemantic(b);
      a = parentName ? (out.get(parentName) ?? new THREE.Quaternion()).clone() : new THREE.Quaternion();
    }
    out.set(b, a);
  }
  return out;
}

function parentSemantic(b: SemanticBone): SemanticBone | null {
  const map: Partial<Record<SemanticBone, SemanticBone>> = { head: 'neck', leftToes: 'leftFoot', rightToes: 'rightFoot', hips: undefined };
  return map[b] ?? null;
}

export interface RetargetOptions {
  /** Keep horizontal hips motion (get-ups). Default true; dances/run are already in place. */
  rootMotion?: boolean;
  /** Only these semantic bones get tracks (upper-body layering). */
  only?: readonly string[];
  name?: string;
}

/** Retargets a canonical clip to the rig. The resulting clip binds by bone name. */
export function retargetClip(clip: CanonicalClip, rig: Rig, opts: RetargetOptions = {}): THREE.AnimationClip {
  const align = alignments(clip, rig);
  const boneIndex = new Map(clip.bones.map((b, i) => [b, i]));
  const srcRest = clip.restRot.map((q) => new THREE.Quaternion(q[0], q[1], q[2], q[3]));
  const semanticTargets = SEMANTIC_BONES.filter((b) => rig.bones.has(b) && boneIndex.has(b));
  const include = new Set(opts.only ?? semanticTargets);
  const frames = clip.frames.length;
  const times = new Float32Array(frames);
  const values = new Map<string, Float32Array>();
  for (const b of semanticTargets) if (include.has(b)) values.set(b, new Float32Array(frames * 4));
  const hipsNode = rig.bones.get('hips');
  const hipsVals = new Float32Array(frames * 3);
  const scale = rig.hipsHeight / Math.max(0.2, clip.hipsHeight);
  const srcRestHips = new THREE.Vector3(...(clip.restPos.hips ?? [0, clip.hipsHeight, 0]));
  const tgtRestHips = rig.restModelP.get('hips') ?? new THREE.Vector3(0, rig.hipsHeight, 0);
  const hipsParentInv = hipsNode?.parent && rig.restModelM.has(hipsNode.parent) ? rig.restModelM.get(hipsNode.parent)!.clone().invert() : new THREE.Matrix4();
  const worldQ = new Map<THREE.Object3D, THREE.Quaternion>();
  const targetWorld = new Map<THREE.Object3D, THREE.Quaternion>();
  const prev = new Map<string, THREE.Quaternion>();
  const tmp = new THREE.Quaternion();
  const invParent = new THREE.Quaternion();

  for (let f = 0; f < frames; f++) {
    times[f] = f / clip.fps;
    targetWorld.clear();
    for (const b of semanticTargets) {
      const i = boneIndex.get(b)!;
      const s = clip.frames[f]![i]!;
      const D = new THREE.Quaternion(s[0], s[1], s[2], s[3]).multiply(srcRest[i]!.clone().invert());
      const node = rig.bones.get(b)!;
      targetWorld.set(node, D.multiply(align.get(b)!).multiply(rig.restModelQ.get(node)!));
    }
    worldQ.clear();
    for (const node of rig.order) {
      const parent = node.parent;
      const pq = parent && worldQ.has(parent) ? worldQ.get(parent)! : parent && rig.restModelQ.has(parent) ? rig.restModelQ.get(parent)! : new THREE.Quaternion();
      const tw = targetWorld.get(node);
      if (tw) {
        worldQ.set(node, tw);
        const name = node.name;
        const arr = values.get(name);
        if (arr) {
          invParent.copy(pq).invert();
          tmp.copy(invParent).multiply(tw).normalize();
          const p = prev.get(name);
          if (p && p.dot(tmp) < 0) tmp.set(-tmp.x, -tmp.y, -tmp.z, -tmp.w);
          prev.set(name, tmp.clone());
          arr.set([tmp.x, tmp.y, tmp.z, tmp.w], f * 4);
        }
      } else {
        worldQ.set(node, pq.clone().multiply(rig.restLocalQ.get(node)!));
      }
    }
    // Hips translation, scaled by hips height.
    const h = clip.hips[f]!;
    const delta = new THREE.Vector3(h[0] - srcRestHips.x, h[1] - srcRestHips.y, h[2] - srcRestHips.z).multiplyScalar(scale);
    if (opts.rootMotion === false) {
      delta.x = 0;
      delta.z = 0;
    }
    const model = tgtRestHips.clone().add(delta).applyMatrix4(hipsParentInv);
    hipsVals.set([model.x, model.y, model.z], f * 3);
  }
  const tracks: THREE.KeyframeTrack[] = [];
  for (const [b, arr] of values) tracks.push(new THREE.QuaternionKeyframeTrack(`${rig.bones.get(b)!.name}.quaternion`, times, arr));
  if (hipsNode && (!opts.only || opts.only.includes('hips'))) tracks.push(new THREE.VectorKeyframeTrack(`${hipsNode.name}.position`, times, hipsVals));
  return new THREE.AnimationClip(opts.name ?? clip.id, clip.duration, tracks);
}
