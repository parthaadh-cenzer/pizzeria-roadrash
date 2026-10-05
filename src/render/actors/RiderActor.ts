// Rider presentation (IMPLEMENTATION_CONTRACT §8): procedural riding IK (pelvis to seat, hands to
// grips, feet to pegs, spine lean, steering/lean response), upper-body layered melee, mirrored
// procedural kick, ragdoll crash, face-up/down get-up, run to bike, procedural lift and remount,
// and results animations.
import * as THREE from 'three';
import { clone as cloneSkinned } from 'three/examples/jsm/utils/SkeletonUtils.js';
import type { GLTF } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { CLIP_IDS } from '../../config/assets.js';
import { ATTACKS, CRASH_RECOVERY } from '../../config/gameplay.js';
import { RIDERS, victoryClipFor, type RiderDef } from '../../config/riders.js';
import { RIDER_MOUNT, mountTweak } from '../../config/mounting.js';
import type { AttackId, RiderId, RiderState } from '../../shared/ids.js';
import { clamp, damp, smoothstep } from '../../shared/math.js';
import { applyFingerCurl, buildFingerCurl, rotateWorld, setWorldQuat, twoBoneIK, worldPos, worldQuat, type FingerCurl } from '../anim/IK.js';
import { buildRig, resetToRest, type Rig } from '../anim/Retarget.js';
import { applyVariant } from '../materials/Variants.js';
import type { BikeActor } from './BikeActor.js';
import { Ragdoll } from './Ragdoll.js';
import type { KeepOut, WeaponActor } from './WeaponActor.js';
import type RAPIER from '@dimforge/rapier3d-compat';

export interface RiderClips {
  get(id: string): THREE.AnimationClip | undefined;
  markers(id: string): Record<string, number>;
}

export interface RiderFrame {
  state: RiderState;
  stateTime: number;
  steer: number;
  lean: number;
  speed: number;
  instability: number;
  attackId: AttackId | null;
  attackTime: number;
  attackSide: number;
  faceUp: boolean;
  riderPos: THREE.Vector3;
  riderYaw: number;
  velocity: THREE.Vector3;
}

/**
 * Morning Star flail path for the weapon (right) hand, relative to the right shoulder in bike
 * space: [time, toward-target, up, forward]. Mirrored by target side: an outward arc on the
 * right, an overhead arc to the left. Both keep the hand, chain and ball outside the bike.
 */
const FLAIL_PATH: Record<'near' | 'far', [number, number, number, number][]> = {
  near: [[0, 0.18, 0.28, 0.08], [0.34, 0.16, 0.5, -0.22], [0.48, 0.52, 0.18, 0.18], [0.62, 0.48, -0.12, 0.04], [0.8, 0.3, 0.02, 0.22], [1, 0.2, 0.1, 0.25]],
  far: [[0, 0.05, 0.32, 0.02], [0.3, 0.05, 0.55, -0.15], [0.44, 0.36, 0.45, 0.12], [0.52, 0.56, 0.2, 0.12], [0.64, 0.52, -0.02, 0.05], [0.8, 0.32, 0.12, 0.2], [1, 0.2, 0.2, 0.25]],
};

function flailKey(side: number, t: number): THREE.Vector3 {
  const keys = FLAIL_PATH[side > 0 ? 'near' : 'far'];
  let i = 0;
  while (i < keys.length - 2 && t > keys[i + 1]![0]) i++;
  const k0 = keys[Math.max(0, i - 1)]!, k1 = keys[i]!, k2 = keys[i + 1]!, k3 = keys[Math.min(keys.length - 1, i + 2)]!;
  const u = clamp((t - k1[0]) / Math.max(1e-3, k2[0] - k1[0]), 0, 1);
  const cr = (a: number, b: number, c: number, d: number) => 0.5 * (2 * b + (-a + c) * u + (2 * a - 5 * b + 4 * c - d) * u * u + (-a + 3 * b - 3 * c + d) * u * u * u);
  return new THREE.Vector3(cr(k0[1], k1[1], k2[1], k3[1]), cr(k0[2], k1[2], k2[2], k3[2]), cr(k0[3], k1[3], k2[3], k3[3]));
}

const MOUNTED: ReadonlySet<RiderState> = new Set(['GRID', 'RIDING', 'ATTACKING', 'KICKING', 'DESTABILIZED', 'FINISHED', 'RECOVERY_PENALTY', 'DISCONNECTED']);
const RAGDOLL_STATES: ReadonlySet<RiderState> = new Set(['RAGDOLL', 'SETTLING']);

export type ResultPose = 'victory' | 'cheer' | 'disappointed' | 'idle';

export class RiderActor {
  readonly id: RiderId;
  readonly def: RiderDef;
  readonly root: THREE.Object3D;
  readonly rig: Rig;
  readonly mixer: THREE.AnimationMixer;
  weapon: WeaponActor | null = null;
  private clips: RiderClips;
  private actions = new Map<string, THREE.AnimationAction>();
  private curlL: FingerCurl | null;
  private curlR: FingerCurl | null;
  private attackW = 0;
  private lastState: RiderState = 'GRID';
  private ragdoll: Ragdoll | null = null;
  private frozen: Map<THREE.Object3D, THREE.Quaternion> | null = null;
  private frozenHips = new THREE.Vector3();
  /** Hips world transform when the pose was frozen: re-expressed under the new root placement. */
  private frozenHipsW: THREE.Matrix4 | null = null;
  private blendIn = 1;
  /** Horizontal root offset that keeps the hips continuous across ragdoll -> get-up -> run. */
  private rootOff = new THREE.Vector3();
  private anchorHips: THREE.Vector3 | null = null;
  private runPhase = 0;
  private runSpeed = 0;
  private lastFreePos: THREE.Vector3 | null = null;
  private clipSpeed: number | null = null;
  /** Get-up chosen from the rendered ragdoll: clip by its facing, root yaw matching where it lies. */
  private getup: { faceUp: boolean; yaw: number } | null = null;
  private headSteer = 0;
  private time = Math.random() * 10;
  private resultPose: ResultPose | null = null;
  readonly hipsRest: THREE.Vector3;

  constructor(id: RiderId, gltf: GLTF, variant: number, masks: Map<string, THREE.Texture>, clips: RiderClips) {
    this.id = id;
    this.def = RIDERS[id];
    this.clips = clips;
    this.root = cloneSkinned(gltf.scene);
    this.root.name = `rider_${id}`;
    const v = this.def.variants[variant] ?? this.def.variants[0];
    applyVariant(this.root, {
      paint: new THREE.Color(v.primary),
      emissive: new THREE.Color(v.emissive),
      tintMaterials: this.def.tintMaterials,
      emissiveMaterials: this.def.emissiveMaterials,
      masks,
      maskColor: v.primary.toLowerCase() === '#ffffff' ? null : new THREE.Color(v.primary),
      maskMode: this.def.colorMode,
      emissiveIntensity: 1.8,
    });
    this.root.traverse((o) => {
      const m = o as THREE.Mesh;
      if (m.isMesh) {
        m.castShadow = true;
        m.frustumCulled = false;
      }
    });
    this.rig = buildRig(this.root);
    this.hipsRest = this.rig.restModelP.get('hips')?.clone() ?? new THREE.Vector3(0, 1, 0);
    this.mixer = new THREE.AnimationMixer(this.root);
    this.curlL = buildFingerCurl(this.rig.bones, 'left');
    this.curlR = buildFingerCurl(this.rig.bones, 'right');
  }

  private action(clipId: string, loop: boolean): THREE.AnimationAction | null {
    let a = this.actions.get(clipId);
    if (!a) {
      const clip = this.clips.get(clipId);
      if (!clip) return null;
      a = this.mixer.clipAction(clip);
      a.setLoop(loop ? THREE.LoopRepeat : THREE.LoopOnce, Infinity);
      a.clampWhenFinished = !loop;
      this.actions.set(clipId, a);
    }
    return a;
  }

  /** Plays exactly one full-body clip at a given time (others disabled). */
  private playOnly(clipId: string | null, time: number, loop: boolean): void {
    for (const [id, a] of this.actions) if (id !== clipId) a.enabled = false;
    if (!clipId) return;
    const a = this.action(clipId, loop);
    if (!a) return;
    a.enabled = true;
    a.setEffectiveWeight(1);
    if (!a.isRunning()) a.play();
    const d = a.getClip().duration;
    a.time = loop ? time % Math.max(0.01, d) : Math.min(time, d - 1e-3);
    this.mixer.update(0);
  }

  // ------------------------------------------------------------------------------ mounted
  private placeOnBike(bike: BikeActor): void {
    if (this.root.parent !== bike.body) bike.body.add(this.root);
    // Pelvis on the seat surface: seat contact + this rider's hip height + bike/pair offsets.
    const seat = bike.info.mount.seatTarget;
    const off = bike.def.riding.pelvisOffset, tw = mountTweak(this.id, bike.id).pelvis ?? [0, 0, 0];
    const lift = RIDER_MOUNT[this.id].hipLift;
    this.root.position.set(seat[0] + off[0] + tw[0] - this.hipsRest.x, seat[1] + lift + off[1] + tw[1] - this.hipsRest.y, seat[2] + off[2] + tw[2] - this.hipsRest.z);
    this.root.quaternion.identity();
  }

  /** Shoulder-to-wrist length per arm (measured once from the bind pose). */
  private armLen: [number, number] | null = null;
  private armLengths(): [number, number] {
    if (!this.armLen) {
      const len = (side: string) => {
        const a = this.rig.restModelP.get(`${side}UpperArm`), b = this.rig.restModelP.get(`${side}LowerArm`), c = this.rig.restModelP.get(`${side}Hand`);
        return a && b && c ? a.distanceTo(b) + b.distanceTo(c) : 0.55;
      };
      this.armLen = [len('left'), len('right')];
    }
    return this.armLen;
  }

  private attackClipTime(id: AttackId, t: number): { clip: string; time: number } | null {
    // The Morning Star swing is procedural and side-aware (see FLAIL_PATH).
    if (id === 'KICK' || id === 'MORNING_STAR' || !this.weapon) return null;
    const clipId = CLIP_IDS.swordSlash;
    const clip = this.clips.get(`${clipId}:upper`);
    if (!clip) return null;
    const strike = this.clips.markers(clipId).strike ?? clip.duration * 0.5;
    const d = ATTACKS[id];
    const c0 = Math.max(0, strike - 0.42), c1 = Math.min(clip.duration - 0.01, strike + 0.5);
    const tStrike = d.windup + d.active * 0.5;
    const time = t < tStrike ? c0 + (strike - c0) * (t / tStrike) : strike + (c1 - strike) * clamp((t - tStrike) / Math.max(0.05, d.total - tStrike), 0, 1);
    return { clip: `${clipId}:upper`, time };
  }

  private kickWeight(t: number): number {
    const d = ATTACKS.KICK;
    if (t < d.windup) return 0.35 * smoothstep(0, d.windup, t);
    if (t < d.windup + d.active) return 0.35 + 0.65 * smoothstep(d.windup, d.windup + d.active * 0.6, t);
    return 1 - smoothstep(d.windup + d.active, d.total, t);
  }

  private poseMounted(bike: BikeActor, f: RiderFrame, dt: number): void {
    const m = bike.info.mount;
    const attacking = f.attackId && f.attackId !== 'KICK' ? this.attackClipTime(f.attackId, f.attackTime) : null;
    this.attackW = damp(this.attackW, attacking ? 1 : 0, attacking ? 0.03 : 0.09, dt);
    resetToRest(this.rig);
    this.placeOnBike(bike);
    if (attacking || this.attackW > 0.02) {
      const at = attacking ?? this.lastAttack;
      if (at) {
        this.lastAttack = at;
        for (const [id, a] of this.actions) if (id !== at.clip) a.enabled = false;
        const a = this.action(at.clip, false);
        if (a) {
          a.enabled = true;
          if (!a.isRunning()) a.play();
          a.setEffectiveWeight(this.attackW);
          a.time = at.time;
          this.mixer.update(0);
        }
      }
    } else this.playOnly(null, 0, false);
    this.root.updateMatrixWorld(true);

    const bq = bike.body.getWorldQuaternion(new THREE.Quaternion());
    const right = new THREE.Vector3(1, 0, 0).applyQuaternion(bq); // bike +X (rider's left); forward bend is +angle about +X
    const fwd = new THREE.Vector3(0, 0, 1).applyQuaternion(bq);
    const up = new THREE.Vector3(0, 1, 0).applyQuaternion(bq);
    const B = this.rig.bones;
    const deg = THREE.MathUtils.degToRad;
    const kickSide = f.attackId === 'KICK' ? f.attackSide : 0;
    const kickW = kickSide ? this.kickWeight(f.attackTime) : 0;
    this.time += dt;

    // Pelvis pitch, then spine lean distributed over the spine chain.
    const hips = B.get('hips');
    if (hips) rotateWorld(hips, new THREE.Quaternion().setFromAxisAngle(right, deg(m.ridingHipRotation)));
    const lean = deg(Math.max(0, m.ridingSpineLean - m.ridingHipRotation)) * (1 - 0.35 * this.attackW);
    // Upper body hangs into the turn (positive roll about +Z leans toward the rider's right).
    const turn = f.steer * deg(7);
    const wobble = f.instability * Math.sin(this.time * 13) * deg(9);
    const spineParts: [string, number][] = [['spine', 0.4], ['chest', 0.35], ['upperChest', 0.25]];
    for (const [name, k] of spineParts) {
      const b = B.get(name);
      if (!b) continue;
      rotateWorld(b, new THREE.Quaternion().setFromAxisAngle(right, lean * k));
      rotateWorld(b, new THREE.Quaternion().setFromAxisAngle(fwd, (turn + wobble - kickSide * deg(10) * kickW) * k));
    }
    // Morning Star: the torso turns and leans toward the target while the flail travels outward.
    const flail = f.attackId === 'MORNING_STAR' && this.weapon ? f.attackTime / ATTACKS.MORNING_STAR.total : -1;
    const flailSide = f.attackSide >= 0 ? 1 : -1;
    const flailW = flail >= 0 ? smoothstep(0, 0.12, flail) * (1 - smoothstep(0.72, 1, flail)) : 0;
    if (flailW > 0) {
      const strike = smoothstep(0.2, 0.5, flail);
      const yaw = -flailSide * deg(flailSide > 0 ? 16 : 30) * strike * flailW;
      const roll = flailSide * deg(flailSide > 0 ? 8 : 20) * strike * flailW;
      for (const [name, k] of spineParts) {
        const b = B.get(name);
        if (!b) continue;
        rotateWorld(b, new THREE.Quaternion().setFromAxisAngle(up, yaw * k));
        rotateWorld(b, new THREE.Quaternion().setFromAxisAngle(fwd, roll * k));
      }
    }
    // Reach: lean the torso further forward until both palms can close on their grips (the
    // grips move with the steering assembly). Never stretch arms or float hands off the bars.
    const cal = bike.def.riding, rm = RIDER_MOUNT[this.id];
    const grips = bike.gripsWorld();
    const lens = this.armLengths();
    const palmTarget = (i: 0 | 1, sh: THREE.Vector3) => grips[i].clone().addScaledVector(grips[i].clone().sub(sh).normalize(), -rm.palm);
    let extra = deg(mountTweak(this.id, bike.id).lean ?? 0);
    const maxExtra = extra + deg(cal.maxReachLean);
    const leanSpine = (a: number) => {
      for (const [name, k] of spineParts) {
        const b = B.get(name);
        if (b) rotateWorld(b, new THREE.Quaternion().setFromAxisAngle(right, a * k));
      }
    };
    if (extra) leanSpine(extra);
    // Shoulders follow the bars: when the steering swings one grip forward the torso twists with
    // it (about the spine, relative to the centred bars), so the far hand stays on its grip.
    let twist = 0;
    const lsh = B.get('leftUpperArm'), rsh = B.get('rightUpperArm'), top = B.get('upperChest') ?? B.get('chest');
    const twistAxis = hips && top ? worldPos(top).sub(worldPos(hips)).normalize() : up.clone();
    const twistBy = (a: number) => {
      for (const [name, k] of spineParts) {
        const b = B.get(name);
        if (b) rotateWorld(b, new THREE.Quaternion().setFromAxisAngle(twistAxis, a * k));
      }
      twist += a;
    };
    if (hips && lsh && rsh && top) {
      const axis = twistAxis;
      const flat = (v: THREE.Vector3) => v.addScaledVector(axis, -v.dot(axis)).normalize();
      const centre = flat(bike.targetWorld(m.leftGripTarget).sub(bike.targetWorld(m.rightGripTarget))), gripLine = flat(grips[0].clone().sub(grips[1]));
      // Slightly more than the bar yaw: the leading shoulder rolls in toward its grip.
      const follow = THREE.MathUtils.clamp(1.3 * Math.atan2(axis.dot(centre.clone().cross(gripLine)), centre.dot(gripLine)), -deg(30), deg(30));
      if (Math.abs(follow) > 1e-3) twistBy(follow);
    }
    const shortfall = () => {
      let need = 0;
      (['left', 'right'] as const).forEach((side, i) => {
        if (side === 'right' && (this.attackW > 0.5 || flailW > 0.5)) return;
        const sh = B.get(`${side}UpperArm`);
        if (!sh) return;
        const sp = worldPos(sh);
        need = Math.max(need, sp.distanceTo(palmTarget(i as 0 | 1, sp)) - lens[i]! * 0.97);
      });
      return need;
    };
    // 1) torso lean, 2) shoulder girdle reaching toward the bars, 3) sit further forward.
    for (let it = 0; it < 8; it++) {
      const need = shortfall();
      if (need <= 0.004 || extra >= maxExtra) break;
      const step = Math.min(maxExtra - extra, need / 0.5);
      leanSpine(step);
      extra += step;
    }
    if (shortfall() > 0.004) {
      (['left', 'right'] as const).forEach((side, i) => {
        const cl = B.get(`${side}Shoulder`), sh = B.get(`${side}UpperArm`);
        if (!cl || !sh) return;
        const from = worldPos(sh).sub(worldPos(cl)), to = grips[i]!.clone().sub(worldPos(cl));
        const q = new THREE.Quaternion().setFromUnitVectors(from.normalize(), to.normalize());
        rotateWorld(cl, new THREE.Quaternion().slerp(q, 0.35));
      });
    }
    // Still short at full lock: keep turning the chest toward the far grip before sliding.
    for (let it = 0; it < 8 && Math.abs(twist) < deg(40); it++) {
      const need = shortfall();
      if (need <= 0.004) break;
      const d = deg(2.5);
      twistBy(d);
      if (shortfall() < need) continue;
      twistBy(-2 * d);
      if (shortfall() < need) continue;
      twistBy(d);
      break;
    }
    let slid = 0;
    for (let it = 0; it < 4; it++) {
      const need = shortfall();
      if (need <= 0.004 || slid >= cal.maxSlide) break;
      const dz = Math.min(cal.maxSlide - slid, need * 0.9);
      this.root.position.z += dz;
      this.root.updateMatrixWorld(true);
      slid += dz;
    }
    // Head keeps looking down the road and into the turn.
    this.headSteer = damp(this.headSteer, f.steer, 0.12, dt);
    const head = B.get('head') ?? B.get('neck');
    if (head) {
      rotateWorld(head, new THREE.Quaternion().setFromAxisAngle(right, -(lean + extra + deg(m.ridingHipRotation)) * 0.72));
      rotateWorld(head, new THREE.Quaternion().setFromAxisAngle(up, -this.headSteer * deg(16) - twist * 0.6));
    }

    // Legs to pegs (kick leg extends laterally, mirrored by side).
    for (const side of ['left', 'right'] as const) {
      const s = side === 'left' ? 1 : -1; // bike +X is the rider's left
      const peg = bike.targetWorld(side === 'left' ? m.leftFootTarget : m.rightFootTarget);
      const hip = B.get(`${side}UpperLeg`), knee = B.get(`${side}LowerLeg`), foot = B.get(`${side}Foot`);
      if (!hip || !knee || !foot) continue;
      let target = peg;
      // attackSide +1 = target on the rider's right (bike -X).
      const kicking = kickSide !== 0 && ((kickSide > 0 && side === 'right') || (kickSide < 0 && side === 'left'));
      if (kicking && kickW > 0) {
        const hp = worldPos(hip);
        const ext = hp.clone().addScaledVector(right, s * 1.0).addScaledVector(up, -0.35).addScaledVector(fwd, 0.15);
        target = peg.clone().lerp(ext, kickW);
      }
      const pole = target.clone().addScaledVector(fwd, cal.kneeForward).addScaledVector(up, m.profile === 'prone' ? -0.4 : 0.35).addScaledVector(right, s * cal.kneeOut);
      twoBoneIK(hip, knee, foot, target, pole);
    }

    // Palms to the (steering) grips; the weapon arm follows the attack clip while swinging.
    const finished = f.state === 'FINISHED' && f.stateTime > 0.6;
    for (const side of ['left', 'right'] as const) {
      const s = side === 'left' ? 1 : -1;
      const sh = B.get(`${side}UpperArm`), el = B.get(`${side}LowerArm`), ha = B.get(`${side}Hand`);
      if (!sh || !el || !ha) continue;
      let target = palmTarget(side === 'left' ? 0 : 1, worldPos(sh));
      let w = side === 'right' ? 1 - this.attackW : 1;
      if (side === 'right' && flailW > 0) {
        // Flail hand path, mirrored by target side (bike -X is the rider's right).
        const k = flailKey(flailSide, flail), toward = right.clone().multiplyScalar(-flailSide);
        const fp = worldPos(sh).addScaledVector(toward, k.x).addScaledVector(up, k.y).addScaledVector(fwd, k.z);
        target = target.lerp(fp, flailW);
        w = 1;
        const flailPole = worldPos(sh).addScaledVector(toward, flailSide > 0 ? 0.45 : -0.2).addScaledVector(up, flailSide > 0 ? -0.3 : 0.35).addScaledVector(fwd, -0.3);
        twoBoneIK(sh, el, ha, target, flailPole, w);
        continue;
      }
      if (side === 'right' && finished) {
        // Victory fist over the finish line.
        target = worldPos(sh).addScaledVector(up, 0.55).addScaledVector(right, -0.15).addScaledVector(fwd, 0.1);
        w = 1;
      }
      const pole = worldPos(sh).addScaledVector(right, s * 0.5).addScaledVector(up, -0.4).addScaledVector(fwd, -0.45);
      twoBoneIK(sh, el, ha, target, pole, w);
    }
    if (this.curlL) applyFingerCurl(this.curlL, 1);
    if (this.curlR) applyFingerCurl(this.curlR, 1);
  }

  private lastAttack: { clip: string; time: number } | null = null;
  private keepOut: KeepOut | null = null;

  /** The owner's bike body volume: the flail ball stays outside it. */
  private keepOutFor(bike: BikeActor): KeepOut {
    if (this.keepOut?.frame !== bike.body) {
      const i = bike.info;
      this.keepOut = { frame: bike.body, half: new THREE.Vector3(i.width / 2, i.height / 2, i.length / 2), centre: new THREE.Vector3(0, i.hoverHeight + i.height / 2, 0) };
    }
    return this.keepOut;
  }

  // ------------------------------------------------------------------------------ free (crash & recovery)
  private placeFree(scene: THREE.Object3D, pos: THREE.Vector3, yaw: number): void {
    if (this.root.parent !== scene) scene.add(this.root);
    this.root.position.copy(pos);
    this.root.quaternion.setFromAxisAngle(new THREE.Vector3(0, 1, 0), yaw);
  }

  private freeze(): void {
    this.frozen = new Map();
    for (const b of this.rig.order) this.frozen.set(b, b.quaternion.clone());
    const h = this.rig.bones.get('hips');
    if (h) {
      this.frozenHips.copy(h.position);
      this.root.updateMatrixWorld(true);
      this.frozenHipsW = h.matrixWorld.clone();
      // Keep the hips where they are when the root is re-placed for the next state.
      this.anchorHips = new THREE.Vector3().setFromMatrixPosition(h.matrixWorld);
    }
  }

  /**
   * Blends from a frozen pose (ragdoll end / previous state) into the currently evaluated pose.
   * The hips are frozen in world space, so re-placing the root never moves the frozen body.
   */
  private applyFreezeBlend(w: number): void {
    if (!this.frozen || w >= 1) return;
    const h = this.rig.bones.get('hips');
    if (h && this.frozenHipsW && h.parent) {
      h.parent.updateMatrixWorld(true);
      const local = h.parent.matrixWorld.clone().invert().multiply(this.frozenHipsW);
      const pos = new THREE.Vector3(), q = new THREE.Quaternion(), sc = new THREE.Vector3();
      local.decompose(pos, q, sc);
      this.frozenHips.copy(pos);
      this.frozen.set(h, q);
    }
    for (const [b, q] of this.frozen) b.quaternion.slerpQuaternions(q, b.quaternion.clone(), w);
    if (h) h.position.lerpVectors(this.frozenHips, h.position.clone(), w);
  }

  /**
   * Face-up/face-down from the ragdoll as rendered (chest normal vs up), and the root yaw that lays
   * the chosen clip's first frame along the lying body (hips -> head), so the blend never flips
   * or spins the body. Call while the ragdoll pose is still on the skeleton.
   */
  private chooseGetup(f: RiderFrame): { faceUp: boolean; yaw: number } | null {
    const B = this.rig.bones;
    const hips = B.get('hips'), head = B.get('head') ?? B.get('neck'), l = B.get('leftUpperArm'), r = B.get('rightUpperArm');
    if (!hips || !head || !l || !r) return null;
    this.root.updateMatrixWorld(true);
    const P = worldPos(hips), H = worldPos(head);
    const front = worldPos(l).sub(worldPos(r)).cross(H.clone().sub(P)).normalize();
    const faceUp = front.y >= 0;
    const aRag = Math.atan2(H.x - P.x, H.z - P.z);
    // The clip's first frame in root space (identity root), then restore the root.
    const pos = this.root.position.clone(), q = this.root.quaternion.clone();
    this.root.position.set(0, 0, 0);
    this.root.quaternion.identity();
    resetToRest(this.rig);
    this.playOnly(faceUp ? CLIP_IDS.getupBack : CLIP_IDS.getupProne, 0, false);
    this.root.updateMatrixWorld(true);
    const P0 = worldPos(hips), H0 = worldPos(head);
    const aClip = Math.atan2(H0.x - P0.x, H0.z - P0.z);
    this.root.position.copy(pos);
    this.root.quaternion.copy(q);
    this.root.updateMatrixWorld(true);
    const yaw = Number.isFinite(aRag - aClip) ? aRag - aClip : f.riderYaw;
    return { faceUp, yaw };
  }

  /** Ground speed of the run clip (m/s), from the planted foot sliding back under the hips. */
  private runClipSpeed(): number {
    if (this.clipSpeed !== null) return this.clipSpeed;
    const a = this.action(CLIP_IDS.run, true), foot = this.rig.bones.get('leftFoot');
    let speed = 5.5;
    if (a && foot) {
      const d = a.getClip().duration, n = 48, pts: THREE.Vector3[] = [];
      const inv = new THREE.Matrix4();
      for (let i = 0; i <= n; i++) {
        resetToRest(this.rig);
        this.playOnly(CLIP_IDS.run, (i / n) * d, true);
        this.root.updateMatrixWorld(true);
        inv.copy(this.root.matrixWorld).invert();
        pts.push(new THREE.Vector3().setFromMatrixPosition(foot.matrixWorld).applyMatrix4(inv));
      }
      const minY = Math.min(...pts.map((p) => p.y));
      let dist = 0, time = 0;
      for (let i = 1; i < pts.length; i++) {
        if (pts[i]!.y < minY + 0.03 && pts[i - 1]!.y < minY + 0.03) {
          dist += pts[i - 1]!.z - pts[i]!.z;
          time += d / n;
        }
      }
      if (time > 0 && dist / time > 1) speed = dist / time;
    }
    this.clipSpeed = speed;
    return speed;
  }

  update(dt: number, f: RiderFrame, bike: BikeActor, scene: THREE.Object3D, physics: RAPIER.World | null): void {
    const entered = f.state !== this.lastState;
    const prev = this.lastState;
    this.lastState = f.state;
    const mounted = MOUNTED.has(f.state);
    this.weapon?.update(dt, mounted ? f.attackId : null, f.attackTime, mounted ? this.keepOutFor(bike) : null);

    if (MOUNTED.has(f.state)) {
      this.getup = null;
      this.endRagdoll();
      this.poseMounted(bike, f, dt);
      return;
    }
    if (RAGDOLL_STATES.has(f.state)) {
      if (!this.ragdoll && physics) {
        // Start from the current mounted pose in world space.
        const wp = this.root.getWorldPosition(new THREE.Vector3());
        const wq = this.root.getWorldQuaternion(new THREE.Quaternion());
        scene.add(this.root);
        this.root.position.copy(wp);
        this.root.quaternion.copy(wq);
        this.root.updateMatrixWorld(true);
        this.ragdoll = new Ragdoll(physics, this.rig, f.velocity.clone().multiplyScalar(0.78).add(new THREE.Vector3(0, 2.5, 0)), 6);
      }
      if (this.ragdoll) {
        this.ragdoll.steer(f.riderPos, dt);
        this.ragdoll.apply();
      } else {
        // No physics world available: settle procedurally toward the authoritative body.
        this.placeFree(scene, f.riderPos, f.riderYaw);
        this.playOnly(f.faceUp ? CLIP_IDS.getupBack : CLIP_IDS.getupProne, 0, false);
      }
      return;
    }
    // Leaving ragdoll: freeze its pose and blend into the recovery animation.
    if (this.ragdoll) {
      this.freeze();
      this.getup = this.chooseGetup(f);
      this.endRagdoll();
      this.blendIn = 0;
    }
    else if (entered && !MOUNTED.has(prev)) {
      // Consecutive recovery states blend from the previous pose instead of popping.
      this.freeze();
      this.blendIn = 0;
    }
    this.blendIn = Math.min(1, this.blendIn + dt / 0.35);
    // Ground speed of the authoritative rider position drives the run cadence (no foot skate).
    const fp = f.riderPos.clone();
    if (this.lastFreePos && dt > 0) this.runSpeed = damp(this.runSpeed, Math.min(12, Math.hypot(fp.x - this.lastFreePos.x, fp.z - this.lastFreePos.z) / dt), 0.12, dt);
    this.lastFreePos = fp;
    resetToRest(this.rig);
    switch (f.state) {
      case 'GETTING_UP': {
        this.placeFree(scene, f.riderPos, this.getup?.yaw ?? f.riderYaw);
        const clip = (this.getup?.faceUp ?? f.faceUp) ? CLIP_IDS.getupBack : CLIP_IDS.getupProne;
        this.playOnly(clip, f.stateTime, false);
        break;
      }
      case 'RUNNING_TO_BIKE': {
        const cs = this.runClipSpeed();
        resetToRest(this.rig);
        this.placeFree(scene, f.riderPos, f.riderYaw);
        if (entered) this.runPhase = 0;
        this.runPhase += (dt * this.runSpeed) / cs;
        this.playOnly(CLIP_IDS.run, this.runPhase, true);
        break;
      }
      case 'LIFTING': {
        this.playOnly(null, 0, false);
        const bikePos = bike.root.getWorldPosition(new THREE.Vector3());
        const toBike = Math.atan2(bikePos.x - f.riderPos.x, bikePos.z - f.riderPos.z);
        this.placeFree(scene, f.riderPos, toBike);
        this.root.updateMatrixWorld(true);
        this.poseLift(bike, f.stateTime / CRASH_RECOVERY.liftDuration);
        break;
      }
      case 'REMOUNTING': {
        this.playOnly(null, 0, false);
        this.poseRemount(bike, f, dt);
        break;
      }
      default:
        this.playOnly(null, 0, false);
    }
    // Anchor: the first placement after a freeze keeps the hips (horizontally) where they were;
    // the offset then eases out while the rider is running, so the body never pops or slides.
    this.root.updateMatrixWorld(true);
    const hips = this.rig.bones.get('hips');
    if (f.state === 'REMOUNTING') {
      // Parented to the bike: the frozen world-space hips already blend the swing-over.
      this.anchorHips = null;
      this.rootOff.set(0, 0, 0);
    } else if (this.anchorHips && hips) {
      const now = new THREE.Vector3().setFromMatrixPosition(hips.matrixWorld);
      this.rootOff.set(this.anchorHips.x - now.x, 0, this.anchorHips.z - now.z);
      this.anchorHips = null;
    } else if (f.state !== 'GETTING_UP') {
      this.rootOff.multiplyScalar(Math.exp(-dt / 0.3));
    }
    this.root.position.add(this.rootOff);
    this.root.updateMatrixWorld(true);
    this.applyFreezeBlend(this.blendIn);
    if (this.blendIn >= 1) {
      this.frozen = null;
      this.frozenHipsW = null;
    }
  }

  private poseLift(bike: BikeActor, t: number): void {
    const B = this.rig.bones;
    const hips = B.get('hips');
    if (!hips) return;
    // Crouch then drive up with the bike.
    const crouch = 0.28 * (1 - smoothstep(0.55, 1, t));
    hips.position.y -= crouch / Math.max(1e-3, worldScale(hips));
    this.root.updateMatrixWorld(true);
    const rq = this.root.getWorldQuaternion(new THREE.Quaternion());
    const right = new THREE.Vector3(1, 0, 0).applyQuaternion(rq), up = new THREE.Vector3(0, 1, 0);
    const spine = B.get('spine');
    if (spine) rotateWorld(spine, new THREE.Quaternion().setFromAxisAngle(right, THREE.MathUtils.degToRad(40 * (1 - t * 0.6))));
    bike.root.updateMatrixWorld(true);
    const grips = [bike.targetWorld(bike.info.mount.leftGripTarget), bike.targetWorld(bike.info.mount.rightGripTarget)];
    (['left', 'right'] as const).forEach((side, i) => {
      const sh = B.get(`${side}UpperArm`), el = B.get(`${side}LowerArm`), ha = B.get(`${side}Hand`);
      if (sh && el && ha) twoBoneIK(sh, el, ha, grips[i]!, worldPos(sh).addScaledVector(up, -0.5).addScaledVector(right, side === 'left' ? 0.4 : -0.4));
      const hp = B.get(`${side}UpperLeg`), kn = B.get(`${side}LowerLeg`), ft = B.get(`${side}Foot`);
      if (hp && kn && ft) {
        const foot = worldPos(ft);
        foot.y = this.root.position.y + 0.08;
        twoBoneIK(hp, kn, ft, foot, worldPos(hp).addScaledVector(up, -0.3).add(new THREE.Vector3(0, 0, 0.6).applyQuaternion(rq)));
      }
    });
    if (this.curlL) applyFingerCurl(this.curlL, 1);
    if (this.curlR) applyFingerCurl(this.curlR, 1);
  }

  private poseRemount(bike: BikeActor, f: RiderFrame, dt: number): void {
    const t = clamp(f.stateTime / CRASH_RECOVERY.mountDuration, 0, 1);
    this.poseMounted(bike, { ...f, attackId: null, steer: 0, lean: 0, instability: 0 }, dt);
    // Swing in from the mount side over the seat.
    const m = bike.info.mount;
    const e = m.mountEntryPoint;
    const side = m.mountSide === 'left' ? 1 : -1;
    const k = 1 - smoothstep(0, 1, t);
    this.root.position.x += (e[0] * side * 0.6) * k;
    this.root.position.y += Math.sin(t * Math.PI) * 0.25 - 0.1 * k;
    this.root.position.z += (e[2] - m.seatTarget[2]) * k * 0.5;
    this.root.rotateY(side * k * 0.9);
    this.root.updateMatrixWorld(true);
  }

  private endRagdoll(): void {
    if (this.ragdoll) {
      this.ragdoll.dispose();
      this.ragdoll = null;
    }
  }

  // ------------------------------------------------------------------------------ results
  setResultPose(pose: ResultPose, scene: THREE.Object3D, pos: THREE.Vector3, yaw: number): void {
    this.endRagdoll();
    this.resultPose = pose;
    this.placeFree(scene, pos, yaw);
    if (this.weapon) this.weapon.grip.visible = pose !== 'victory';
  }

  updateResult(dt: number, t: number): void {
    if (!this.resultPose) return;
    resetToRest(this.rig);
    const clip = this.resultPose === 'victory' ? victoryClipFor(this.def) : this.resultPose === 'cheer' ? CLIP_IDS.cheerClap : this.resultPose === 'disappointed' ? CLIP_IDS.disappointed : null;
    this.playOnly(clip, t + (this.time % 3), true);
    this.weapon?.update(dt, null, 0);
  }

  // ------------------------------------------------------------------------------ showcase
  private showcase: { weapon: 'hidden' | 'hero' } | null = null;

  /**
   * Standalone presentation (loadout character steps, the READY hero): a relaxed stance taken
   * from the rider's own clips, with subtle breathing, weight shift and head movement. The
   * weapon is hidden, or held in a per-weapon hero pose.
   */
  setShowcase(scene: THREE.Object3D, pos: THREE.Vector3, yaw: number, weapon: 'hidden' | 'hero'): void {
    this.endRagdoll();
    this.resultPose = null;
    this.showcase = { weapon };
    this.placeFree(scene, pos, yaw);
    if (this.weapon) this.weapon.grip.visible = weapon === 'hero';
  }

  /**
   * Leaves the showcase stance and blends (0.35 s) from the current pose into the next state the
   * rider is driven with (the race intro's mount: REMOUNTING).
   */
  endShowcase(next: RiderState): void {
    if (!this.showcase) return;
    this.showcase = null;
    this.root.updateMatrixWorld(true);
    this.freeze();
    this.blendIn = 0;
    this.lastState = next;
  }

  get inShowcase(): boolean {
    return this.showcase !== null;
  }

  updateShowcase(dt: number, t: number): void {
    if (!this.showcase) return;
    resetToRest(this.rig);
    // Scarlet's stance is the first beat of her dance (weight on one hip); the others stand relaxed.
    this.playOnly(this.def.gender === 'female' ? CLIP_IDS.victorySnake : CLIP_IDS.disappointed, 0, false);
    this.root.updateMatrixWorld(true);
    const B = this.rig.bones;
    const q = this.root.getWorldQuaternion(new THREE.Quaternion());
    const right = new THREE.Vector3(1, 0, 0).applyQuaternion(q), up = new THREE.Vector3(0, 1, 0), fwd = new THREE.Vector3(0, 0, 1).applyQuaternion(q);
    const deg = THREE.MathUtils.degToRad;
    const breath = Math.sin(t * 1.55);
    const hips = B.get('hips');
    if (hips) rotateWorld(hips, new THREE.Quaternion().setFromAxisAngle(up, Math.sin(t * 0.37) * deg(2.2)));
    for (const [name, k] of [['spine', 0.5], ['chest', 0.8], ['upperChest', 1]] as const) {
      const b = B.get(name);
      if (b) rotateWorld(b, new THREE.Quaternion().setFromAxisAngle(right, -breath * deg(1.1) * k));
    }
    const head = B.get('head');
    if (head) {
      rotateWorld(head, new THREE.Quaternion().setFromAxisAngle(up, Math.sin(t * 0.29 + 1.3) * deg(7)));
      rotateWorld(head, new THREE.Quaternion().setFromAxisAngle(right, Math.sin(t * 0.21) * deg(2.5)));
    }
    if (this.showcase.weapon === 'hero' && this.weapon) this.poseHeroWeapon(right, up, fwd);
    this.root.updateMatrixWorld(true);
    this.weapon?.update(dt, null, 0);
  }

  /** Right hand + blade direction for a believable resting hold, per weapon. */
  private poseHeroWeapon(right: THREE.Vector3, up: THREE.Vector3, fwd: THREE.Vector3): void {
    const B = this.rig.bones;
    const sh = B.get('rightUpperArm'), el = B.get('rightLowerArm'), ha = B.get('rightHand');
    if (!sh || !el || !ha || !this.weapon) return;
    const base = worldPos(sh);
    // Rider's right is -X in root space.
    const toRight = right.clone().multiplyScalar(-1);
    const id = this.weapon.id;
    const onShoulder = id === 'KATANA' || id === 'ZABIMARU';
    const target = onShoulder
      ? base.clone().addScaledVector(fwd, 0.2).addScaledVector(up, -0.16).addScaledVector(toRight, -0.06)
      : base.clone().addScaledVector(up, -0.5).addScaledVector(toRight, 0.12).addScaledVector(fwd, id === 'MORNING_STAR' ? 0.06 : 0.14);
    const pole = base.clone().addScaledVector(toRight, 0.35).addScaledVector(up, -0.35).addScaledVector(fwd, onShoulder ? -0.05 : -0.3);
    twoBoneIK(sh, el, ha, target, pole, 1);
    // Blade over the shoulder / pointing down and a little forward / flail handle hanging.
    const want = onShoulder
      ? up.clone().multiplyScalar(0.85).addScaledVector(fwd, -0.38).addScaledVector(toRight, 0.42)
      : id === 'MORNING_STAR'
        ? up.clone().multiplyScalar(-1).addScaledVector(fwd, 0.18)
        : up.clone().multiplyScalar(-0.78).addScaledVector(fwd, 0.55).addScaledVector(toRight, 0.12);
    this.root.updateMatrixWorld(true);
    const gripQ = this.weapon.grip.getWorldQuaternion(new THREE.Quaternion());
    const cur = new THREE.Vector3(0, 1, 0).applyQuaternion(gripQ);
    rotateWorld(ha, new THREE.Quaternion().setFromUnitVectors(cur.normalize(), want.normalize()));
    if (this.curlR) applyFingerCurl(this.curlR, 1);
  }

  dispose(): void {
    this.endRagdoll();
    this.mixer.stopAllAction();
    this.root.removeFromParent();
    this.weapon?.dispose();
  }
}

function worldScale(o: THREE.Object3D): number {
  const s = new THREE.Vector3();
  o.parent?.matrixWorld.decompose(new THREE.Vector3(), new THREE.Quaternion(), s);
  return s.x || 1;
}

export { worldQuat, setWorldQuat };
