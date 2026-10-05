// Animation clips: FBX (Mixamo) -> canonical world-space clips on the semantic skeleton, plus
// procedural clips for motions with no supplied source (cheer/clap, walk, face-down get-up).
import fs from 'node:fs';
import path from 'node:path';
import * as THREE from 'three';
import { FBXLoader } from 'three/examples/jsm/loaders/FBXLoader.js';
import { DIRECTION_CHILD, MIXAMO_MAP, SEMANTIC_BONES, SEMANTIC_PARENT, type CanonicalClip, type SemanticBone } from '../../../src/config/skeleton.js';
import { ROOT } from './core.js';

const FPS = 30;
const CM = 0.01;
const REF_POINTS = ['leftMiddle1', 'rightMiddle1', 'leftThumb1', 'rightThumb1', 'leftIndex1', 'rightIndex1'] as const;

interface FbxRig {
  root: THREE.Group;
  clip: THREE.AnimationClip;
  bones: Map<string, THREE.Object3D>;
}

function loadFbx(rel: string): FbxRig {
  const buf = fs.readFileSync(path.join(ROOT, rel));
  const ab = buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength) as ArrayBuffer;
  const root = new FBXLoader().parse(ab, '');
  const clip = root.animations[0];
  if (!clip) throw new Error(`${rel}: no animation clip`);
  const bones = new Map<string, THREE.Object3D>();
  const all: THREE.Object3D[] = [];
  root.traverse((o) => all.push(o));
  for (const [semantic, re] of Object.entries(MIXAMO_MAP)) {
    const hit = all.find((o) => re.test(o.name) || re.test(o.name.replace(/^mixamorig/, 'mixamorig:')));
    if (hit) bones.set(semantic, hit);
  }
  for (const b of SEMANTIC_BONES) if (!bones.has(b)) throw new Error(`${rel}: semantic bone ${b} not found`);
  return { root, clip, bones };
}

function wq(o: THREE.Object3D): number[] {
  const q = o.getWorldQuaternion(new THREE.Quaternion());
  return [+q.x.toFixed(5), +q.y.toFixed(5), +q.z.toFixed(5), +q.w.toFixed(5)];
}
function wp(o: THREE.Object3D): [number, number, number] {
  const p = o.getWorldPosition(new THREE.Vector3()).multiplyScalar(CM);
  return [+p.x.toFixed(4), +p.y.toFixed(4), +p.z.toFixed(4)];
}

interface Rest {
  restRot: number[][];
  restPos: Record<string, [number, number, number]>;
  hipsHeight: number;
}

function readRest(rig: FbxRig): Rest {
  rig.root.updateMatrixWorld(true);
  const restRot = SEMANTIC_BONES.map((b) => wq(rig.bones.get(b)!));
  const restPos: Record<string, [number, number, number]> = {};
  for (const b of SEMANTIC_BONES) restPos[b] = wp(rig.bones.get(b)!);
  for (const r of REF_POINTS) {
    const o = rig.bones.get(r);
    if (o) restPos[r] = wp(o);
  }
  return { restRot, restPos, hipsHeight: restPos.hips![1] };
}

let restCache: Rest | null = null;
/** Canonical Mixamo rest skeleton (T-pose) from the supplied FBX files. */
export function canonicalRest(): Rest {
  if (!restCache) restCache = readRest(loadFbx('Assets/Animation/Fast Run (1).fbx'));
  return restCache;
}

export function fbxToCanonical(rel: string, id: string, opts: { loop: boolean; trimStart?: number; trimEnd?: number; inPlace?: boolean }): CanonicalClip {
  const rig = loadFbx(rel);
  const rest = readRest(rig);
  const mixer = new THREE.AnimationMixer(rig.root);
  const action = mixer.clipAction(rig.clip);
  action.play();
  const t0 = opts.trimStart ?? 0;
  const t1 = Math.min(opts.trimEnd ?? rig.clip.duration, rig.clip.duration);
  const n = Math.max(2, Math.round((t1 - t0) * FPS) + 1);
  const frames: number[][][] = [];
  const hips: number[][] = [];
  const handSpeed: number[] = [];
  let prevHand: THREE.Vector3 | null = null;
  const hips0 = new THREE.Vector3();
  for (let f = 0; f < n; f++) {
    const t = Math.min(t1, t0 + f / FPS);
    mixer.setTime(t);
    rig.root.updateMatrixWorld(true);
    frames.push(SEMANTIC_BONES.map((b) => wq(rig.bones.get(b)!)));
    const hp = rig.bones.get('hips')!.getWorldPosition(new THREE.Vector3()).multiplyScalar(CM);
    if (f === 0) hips0.copy(hp);
    if (opts.inPlace) {
      hp.x = hips0.x;
      hp.z = hips0.z;
    }
    hips.push([+hp.x.toFixed(4), +hp.y.toFixed(4), +hp.z.toFixed(4)]);
    const hand = rig.bones.get('rightHand')!.getWorldPosition(new THREE.Vector3()).multiplyScalar(CM);
    handSpeed.push(prevHand ? hand.distanceTo(prevHand) * FPS : 0);
    prevHand = hand;
  }
  let strike = 0;
  for (let f = 1; f < handSpeed.length; f++) if (handSpeed[f]! > handSpeed[strike]!) strike = f;
  return {
    id,
    fps: FPS,
    duration: (n - 1) / FPS,
    loop: opts.loop,
    procedural: false,
    source: rel,
    hipsHeight: rest.hipsHeight,
    bones: [...SEMANTIC_BONES],
    restRot: rest.restRot,
    restPos: rest.restPos,
    frames,
    hips,
    markers: { strike: strike / FPS, peakHandSpeed: +handSpeed[strike]!.toFixed(2) },
  };
}

// ---------------------------------------------------------------------------- procedural
type V = THREE.Vector3;
const vec = (x: number, y: number, z: number) => new THREE.Vector3(x, y, z).normalize();

interface PoseSpec {
  hipsRot?: THREE.Quaternion; // world delta applied to rest hips
  hipsPos?: V; // absolute hips position (m)
  dirs?: Partial<Record<SemanticBone, V>>;
  /** Extra world-space rotation applied after direction solving (e.g. twists). */
  extra?: Partial<Record<SemanticBone, THREE.Quaternion>>;
}

function restQuat(rest: Rest, b: SemanticBone): THREE.Quaternion {
  const r = rest.restRot[SEMANTIC_BONES.indexOf(b)]!;
  return new THREE.Quaternion(r[0], r[1], r[2], r[3]);
}

function restDir(rest: Rest, b: SemanticBone): V | null {
  const c = DIRECTION_CHILD[b];
  if (!c || !rest.restPos[c]) return null;
  const p = rest.restPos[b]!, q = rest.restPos[c]!;
  return new THREE.Vector3(q[0] - p[0], q[1] - p[1], q[2] - p[2]).normalize();
}

/** Solves world rotations from bone direction targets on the canonical rest skeleton. */
export function solvePose(rest: Rest, spec: PoseSpec): { rot: THREE.Quaternion[]; hips: V } {
  const delta = new Map<SemanticBone, THREE.Quaternion>();
  const out: THREE.Quaternion[] = [];
  for (const b of SEMANTIC_BONES) {
    const parent = SEMANTIC_PARENT[b];
    let D: THREE.Quaternion;
    if (!parent) D = (spec.hipsRot ?? new THREE.Quaternion()).clone();
    else {
      D = delta.get(parent)!.clone();
      const target = spec.dirs?.[b];
      const d0 = restDir(rest, b);
      if (target && d0) {
        const cur = d0.clone().applyQuaternion(D);
        const r = new THREE.Quaternion().setFromUnitVectors(cur, target.clone().normalize());
        D = r.multiply(D);
      }
    }
    const ex = spec.extra?.[b];
    if (ex) D = ex.clone().multiply(D);
    delta.set(b, D);
    out.push(D.clone().multiply(restQuat(rest, b)));
  }
  const hp = rest.restPos.hips!;
  return { rot: out, hips: spec.hipsPos ?? new THREE.Vector3(hp[0], hp[1], hp[2]) };
}

function packFrame(rot: THREE.Quaternion[]): number[][] {
  return rot.map((q) => [+q.x.toFixed(5), +q.y.toFixed(5), +q.z.toFixed(5), +q.w.toFixed(5)]);
}

function makeClip(id: string, duration: number, loop: boolean, sample: (t: number) => { rot: THREE.Quaternion[]; hips: V }, markers: Record<string, number> = {}): CanonicalClip {
  const rest = canonicalRest();
  const n = Math.round(duration * FPS) + 1;
  const frames: number[][][] = [];
  const hips: number[][] = [];
  for (let f = 0; f < n; f++) {
    const p = sample(Math.min(duration, f / FPS));
    frames.push(packFrame(p.rot));
    hips.push([+p.hips.x.toFixed(4), +p.hips.y.toFixed(4), +p.hips.z.toFixed(4)]);
  }
  return {
    id, fps: FPS, duration: (n - 1) / FPS, loop, procedural: true, source: 'procedural (pipeline, semantic skeleton)',
    hipsHeight: rest.hipsHeight, bones: [...SEMANTIC_BONES], restRot: rest.restRot, restPos: rest.restPos, frames, hips, markers,
  };
}

const rotAxis = (axis: V, deg: number) => new THREE.Quaternion().setFromAxisAngle(axis.clone().normalize(), THREE.MathUtils.degToRad(deg));
const X = new THREE.Vector3(1, 0, 0), Y = new THREE.Vector3(0, 1, 0), Z = new THREE.Vector3(0, 0, 1);
const smooth = (x: number) => x * x * (3 - 2 * x);

/** Barrier spectator / podium Cheer + Clap loop (4 s). Character faces +Z; left is +X. */
export function makeCheerClap(): CanonicalClip {
  const rest = canonicalRest();
  const hp = rest.restPos.hips!;
  return makeClip('clip.cheerClap', 4, true, (t) => {
    // Cheer (right fist pump) blends in between 1.9 s and 3.1 s.
    const cheer = t < 1.7 ? 0 : t < 2.0 ? smooth((t - 1.7) / 0.3) : t < 2.9 ? 1 : t < 3.2 ? 1 - smooth((t - 2.9) / 0.3) : 0;
    const clap = Math.sin(t * Math.PI * 2 * 2.2); // ~2.2 claps per second
    const close = 0.5 + 0.5 * clap; // 1 = hands together
    const bounce = Math.abs(Math.sin(t * Math.PI * 2.2)) * 0.025;
    const lUpper = vec(0.26, -0.62, 0.72);
    const lFore = vec(-0.12 - 0.78 * close, 0.3, 0.8);
    const rUpperClap = vec(-0.26, -0.62, 0.72);
    const rForeClap = vec(0.12 + 0.78 * close, 0.3, 0.8);
    const pump = 0.5 + 0.5 * Math.sin(t * Math.PI * 2 * 2.6);
    const rUpperCheer = vec(-0.25, 0.9 + 0.08 * pump, 0.15);
    const rForeCheer = vec(-0.05, 0.98, 0.15 - 0.25 * pump);
    const lerpV = (a: V, b: V, k: number) => a.clone().lerp(b, k).normalize();
    const dirs: PoseSpec['dirs'] = {
      leftUpperArm: lerpV(lUpper, vec(0.35, -0.85, 0.25), cheer * 0.6),
      leftLowerArm: lerpV(lFore, vec(0.2, -0.3, 0.9), cheer * 0.6),
      rightUpperArm: lerpV(rUpperClap, rUpperCheer, cheer),
      rightLowerArm: lerpV(rForeClap, rForeCheer, cheer),
      leftUpperLeg: vec(0.08, -1, 0.02),
      rightUpperLeg: vec(-0.08, -1, 0.02),
      leftLowerLeg: vec(0.02, -1, -0.02),
      rightLowerLeg: vec(-0.02, -1, -0.02),
    };
    const nod = rotAxis(X, 6 * Math.sin(t * Math.PI * 2 * 1.1) + 4 * cheer);
    const sway = rotAxis(Y, 5 * Math.sin(t * Math.PI * 2 * 0.25));
    const palmsL = rotAxis(lFore, -80 * (1 - cheer));
    const palmsR = rotAxis(rForeClap, 80 * (1 - cheer));
    return solvePose(rest, {
      hipsRot: sway,
      hipsPos: new THREE.Vector3(hp[0], hp[1] + bounce - 0.01, hp[2]),
      dirs,
      extra: { head: nod, leftHand: palmsL, rightHand: palmsR, upperChest: rotAxis(X, 4 * cheer) },
    });
  }, { cheerStart: 1.9, cheerEnd: 3.0 });
}

/** In-place walk cycle for sidewalk NPCs (1.1 s loop). */
export function makeWalk(): CanonicalClip {
  const rest = canonicalRest();
  const hp = rest.restPos.hips!;
  const T = 1.1;
  return makeClip('clip.walk', T, true, (t) => {
    const ph = (t / T) * Math.PI * 2;
    const leg = (phase: number, side: number) => {
      const a = THREE.MathUtils.degToRad(24 * Math.sin(phase));
      const bend = THREE.MathUtils.degToRad(8 + 42 * Math.max(0, Math.cos(phase)));
      const thigh = new THREE.Vector3(0.04 * side, -Math.cos(a), Math.sin(a)).normalize();
      const shin = new THREE.Vector3(0.02 * side, -Math.cos(a - bend), Math.sin(a - bend)).normalize();
      const foot = new THREE.Vector3(0, -0.45 + 0.3 * Math.max(0, Math.cos(phase)), 1).normalize();
      return { thigh, shin, foot };
    };
    const L = leg(ph, 1), R = leg(ph + Math.PI, -1);
    const arm = (phase: number, side: number) => {
      const c = THREE.MathUtils.degToRad(-20 * Math.sin(phase));
      const up = new THREE.Vector3(0.12 * side, -Math.cos(c), Math.sin(c)).normalize();
      const fore = new THREE.Vector3(0.06 * side, -Math.cos(c + 0.35), Math.sin(c + 0.35)).normalize();
      return { up, fore };
    };
    const la = arm(ph, 1), ra = arm(ph + Math.PI, -1);
    const bob = -0.025 * Math.abs(Math.cos(ph));
    return solvePose(rest, {
      hipsRot: rotAxis(Y, 5 * Math.sin(ph)).multiply(rotAxis(Z, 2.5 * Math.sin(ph))),
      hipsPos: new THREE.Vector3(hp[0], hp[1] + bob - 0.015, hp[2]),
      dirs: {
        leftUpperLeg: L.thigh, leftLowerLeg: L.shin, leftFoot: L.foot,
        rightUpperLeg: R.thigh, rightLowerLeg: R.shin, rightFoot: R.foot,
        leftUpperArm: la.up, leftLowerArm: la.fore, rightUpperArm: ra.up, rightLowerArm: ra.fore,
      },
      extra: { chest: rotAxis(Y, -6 * Math.sin(ph)) },
    });
  });
}

/**
 * Face-down get-up (anim_getup_prone): no source clip exists, so a procedural push-up and
 * knee-tuck brings the rider from prone into the kneel of the supplied face-up get-up clip,
 * whose stand-up phase is then reused.
 */
export function makeGetupProne(getupBack: CanonicalClip): CanonicalClip {
  const rest = canonicalRest();
  const kneelT = 1.15;
  const kneelF = Math.round(kneelT * getupBack.fps);
  const kneelRot = getupBack.frames[kneelF]!.map((q) => new THREE.Quaternion(q[0], q[1], q[2], q[3]));
  const kneelHips = new THREE.Vector3(...(getupBack.hips[kneelF] as [number, number, number]));
  // Prone: whole body pitched forward 90deg (chest down), arms bent under shoulders.
  const pitchDown = rotAxis(X, 90);
  const prone = solvePose(rest, {
    hipsRot: pitchDown,
    hipsPos: new THREE.Vector3(kneelHips.x, 0.13, kneelHips.z - 0.55),
    dirs: {
      leftUpperArm: vec(0.55, -0.35, 0.3), leftLowerArm: vec(-0.25, -0.2, 0.95),
      rightUpperArm: vec(-0.55, -0.35, 0.3), rightLowerArm: vec(0.25, -0.2, 0.95),
      leftUpperLeg: vec(0.06, -0.05, -1), rightUpperLeg: vec(-0.06, -0.05, -1),
      leftLowerLeg: vec(0.04, -0.05, -1), rightLowerLeg: vec(-0.04, -0.05, -1),
      leftFoot: vec(0, -1, -0.2), rightFoot: vec(0, -1, -0.2),
    },
    extra: { head: rotAxis(X, -35) },
  });
  const pushPitch = rotAxis(X, 58);
  const push = solvePose(rest, {
    hipsRot: pushPitch,
    hipsPos: new THREE.Vector3(kneelHips.x, 0.42, kneelHips.z - 0.4),
    dirs: {
      leftUpperArm: vec(0.2, -0.95, 0.25), leftLowerArm: vec(0.1, -0.98, 0.15),
      rightUpperArm: vec(-0.2, -0.95, 0.25), rightLowerArm: vec(-0.1, -0.98, 0.15),
      leftUpperLeg: vec(0.08, -0.55, -0.8), rightUpperLeg: vec(-0.08, -0.55, -0.8),
      leftLowerLeg: vec(0.04, -0.1, -1), rightLowerLeg: vec(-0.04, -0.1, -1),
      leftFoot: vec(0, -1, -0.3), rightFoot: vec(0, -1, -0.3),
    },
    extra: { head: rotAxis(X, -25) },
  });
  const tail = getupBack.frames.length - kneelF;
  const pre = 1.35; // procedural part
  const total = pre + (tail - 1) / getupBack.fps;
  return makeClip('clip.getupProne', total, false, (t) => {
    if (t <= pre) {
      const k1 = 0.6;
      let rot: THREE.Quaternion[];
      let hips: V;
      if (t < k1) {
        const u = smooth(t / k1);
        rot = prone.rot.map((q, i) => q.clone().slerp(push.rot[i]!, u));
        hips = prone.hips.clone().lerp(push.hips, u);
      } else {
        const u = smooth((t - k1) / (pre - k1));
        rot = push.rot.map((q, i) => q.clone().slerp(kneelRot[i]!, u));
        hips = push.hips.clone().lerp(kneelHips, u);
      }
      return { rot, hips };
    }
    const f = Math.min(getupBack.frames.length - 1, kneelF + Math.round((t - pre) * getupBack.fps));
    return {
      rot: getupBack.frames[f]!.map((q) => new THREE.Quaternion(q[0], q[1], q[2], q[3])),
      hips: new THREE.Vector3(...(getupBack.hips[f] as [number, number, number])),
    };
  }, { standPhaseStart: pre });
}
