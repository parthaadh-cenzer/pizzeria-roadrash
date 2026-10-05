// Weapons in hand: grip attachment from the rig's hand/finger geometry, Zabimaru retract/extend,
// Morning Star delayed ball on its chain, and a swing trail shown only during the contact window.
import * as THREE from 'three';
import { clone as cloneSkinned } from 'three/examples/jsm/utils/SkeletonUtils.js';
import type { GLTF } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { ATTACKS, COMBAT } from '../../config/gameplay.js';
import { WEAPONS } from '../../config/weapons.js';
import type { AttackId, WeaponId } from '../../shared/ids.js';
import type { WeaponRuntimeInfo } from '../../shared/manifest.js';
import { clamp } from '../../shared/math.js';
import { isContactWindow } from '../../game/sim/Combat.js';
import { aim } from '../anim/IK.js';
import type { Rig } from '../anim/Retarget.js';
import { applyVariant } from '../materials/Variants.js';

interface Segment {
  node: THREE.Object3D;
  extPos: THREE.Vector3;
  extQ: THREE.Quaternion;
  cmpPos: THREE.Vector3;
  cmpQ: THREE.Quaternion;
}

const TRAIL_SAMPLES = 14;

/** The owner's bike volume (in its body frame) that the flail ball never enters. */
export interface KeepOut {
  frame: THREE.Object3D;
  half: THREE.Vector3;
  centre: THREE.Vector3;
}

export class WeaponActor {
  readonly id: WeaponId;
  readonly grip = new THREE.Object3D();
  readonly model: THREE.Object3D;
  private info: WeaponRuntimeInfo;
  private segments: Segment[] = [];
  private chain0: THREE.Object3D | null = null;
  private ball: THREE.Object3D | null = null;
  private ballRestLocal = new THREE.Vector3();
  private ballPos = new THREE.Vector3();
  private ballVel = new THREE.Vector3();
  private ballInit = false;
  private extend = 0;
  private trail: THREE.Mesh;
  private trailPts: { base: THREE.Vector3; tip: THREE.Vector3; age: number }[] = [];
  private trailGeo: THREE.BufferGeometry;

  constructor(id: WeaponId, gltf: GLTF, info: WeaponRuntimeInfo) {
    this.id = id;
    this.info = info;
    this.model = cloneSkinned(gltf.scene);
    applyVariant(this.model, { emissiveIntensity: 2.2 });
    this.model.traverse((o) => {
      const m = o as THREE.Mesh;
      if (m.isMesh) {
        m.castShadow = true;
        m.frustumCulled = false;
      }
    });
    this.grip.add(this.model);
    // Zabimaru: extended pose as authored; compact pose stacks segments along the blade axis.
    if (info.segments.length) {
      const nodes = info.segments.map((n) => this.model.getObjectByName(n)).filter((n): n is THREE.Object3D => !!n);
      const hilt = this.model.getObjectByName('zab_hilt');
      const centres = [hilt ? hilt.position.clone() : new THREE.Vector3(), ...nodes.map((n) => n.position.clone())];
      nodes.forEach((node, i) => {
        const prev = centres[i]!, next = centres[i + 2] ?? centres[i + 1]!;
        const chord = next.clone().sub(prev);
        if (chord.lengthSq() < 1e-6) chord.set(0, 1, 0);
        // Positions/rotations are in the node's parent space (the normalization root); the blade
        // axis is weapon +Y expressed in that space.
        const parentInv = node.parent ? node.parent.matrix.clone().invert() : new THREE.Matrix4();
        const bladeAxis = new THREE.Vector3(0, 1, 0).transformDirection(parentInv).normalize();
        const toAxis = new THREE.Quaternion().setFromUnitVectors(chord.normalize(), bladeAxis);
        const cmpQ = toAxis.multiply(node.quaternion.clone());
        const cmpWeapon = new THREE.Vector3(0, 0.22 + i * 0.13, 0);
        this.segments.push({ node, extPos: node.position.clone(), extQ: node.quaternion.clone(), cmpPos: cmpWeapon.applyMatrix4(parentInv), cmpQ });
      });
    }
    if (info.chainBones.length) {
      this.chain0 = this.model.getObjectByName(info.chainBones[0]!) ?? null;
      this.ball = info.ballNode ? (this.model.getObjectByName(info.ballNode) ?? null) : null;
    }
    this.trailGeo = new THREE.BufferGeometry();
    this.trailGeo.setAttribute('position', new THREE.BufferAttribute(new Float32Array(TRAIL_SAMPLES * 2 * 3), 3));
    this.trailGeo.setAttribute('alpha', new THREE.BufferAttribute(new Float32Array(TRAIL_SAMPLES * 2), 1));
    const idx: number[] = [];
    for (let i = 0; i < TRAIL_SAMPLES - 1; i++) idx.push(i * 2, i * 2 + 1, i * 2 + 2, i * 2 + 1, i * 2 + 3, i * 2 + 2);
    this.trailGeo.setIndex(idx);
    const color = new THREE.Color(WEAPONS[id].trail).multiplyScalar(2.2);
    this.trail = new THREE.Mesh(
      this.trailGeo,
      new THREE.ShaderMaterial({
        uniforms: { uColor: { value: color } },
        vertexShader: 'attribute float alpha; varying float vA; void main(){ vA = alpha; gl_Position = projectionMatrix * viewMatrix * vec4(position, 1.0); }',
        fragmentShader: 'uniform vec3 uColor; varying float vA; void main(){ gl_FragColor = vec4(uColor * vA, vA); }',
        transparent: true,
        depthWrite: false,
        side: THREE.DoubleSide,
        blending: THREE.AdditiveBlending,
      }),
    );
    this.trail.frustumCulled = false;
    this.trail.visible = false;
    this.applyExtension(0);
  }

  /** Attaches to the rig's right hand: blade exits the fist on the index side, edge forward. */
  attach(rig: Rig): void {
    const hand = rig.bones.get('rightHand');
    if (!hand) return;
    const mid = rig.bones.get('rightMiddle1'), idx = rig.bones.get('rightIndex1'), pinky = rig.bones.get('rightPinky1');
    rig.root.updateMatrixWorld(true);
    const handM = hand.matrixWorld.clone();
    const handInv = handM.clone().invert();
    const hp = new THREE.Vector3().setFromMatrixPosition(handM);
    const toLocalDir = (w: THREE.Vector3) => w.clone().transformDirection(handInv);
    let fingerDir = new THREE.Vector3(0, 1, 0), gripAxis = new THREE.Vector3(0, 0, 1), palmCentre = new THREE.Vector3(0, 0.08, 0);
    if (mid && idx && pinky) {
      const mp = new THREE.Vector3().setFromMatrixPosition(mid.matrixWorld);
      const ip = new THREE.Vector3().setFromMatrixPosition(idx.matrixWorld);
      const pp = new THREE.Vector3().setFromMatrixPosition(pinky.matrixWorld);
      fingerDir = toLocalDir(mp.clone().sub(hp)).normalize();
      gripAxis = toLocalDir(ip.clone().sub(pp)).normalize();
      gripAxis.addScaledVector(fingerDir, -gripAxis.dot(fingerDir)).normalize();
      palmCentre = mp.clone().lerp(hp, 0.35).applyMatrix4(handInv);
    }
    const x = new THREE.Vector3().crossVectors(gripAxis, fingerDir).normalize();
    const basis = new THREE.Matrix4().makeBasis(x, gripAxis, new THREE.Vector3().crossVectors(x, gripAxis));
    this.grip.quaternion.setFromRotationMatrix(basis);
    // Hand bones may carry scale from the source rig; compensate so the weapon keeps metres.
    const s = new THREE.Vector3();
    handM.decompose(new THREE.Vector3(), new THREE.Quaternion(), s);
    this.grip.scale.setScalar(1 / Math.max(1e-6, s.x));
    this.grip.position.copy(palmCentre);
    hand.add(this.grip);
  }

  /** Presented length (m): Zabimaru at rest is its compact, retracted blade. */
  get length(): number {
    return this.segments.length ? 0.3 + this.segments.length * 0.13 : this.info.length;
  }

  get trailMesh(): THREE.Mesh {
    return this.trail;
  }

  private applyExtension(e: number): void {
    this.segments.forEach((sg, i) => {
      const k = clamp(e * 1.45 - i * 0.075, 0, 1);
      const w = k * k * (3 - 2 * k);
      sg.node.position.lerpVectors(sg.cmpPos, sg.extPos, w);
      sg.node.quaternion.slerpQuaternions(sg.cmpQ, sg.extQ, w);
    });
  }

  /** Extension curve: unfold during wind-up, hold through contact, retract in recovery. */
  private extensionAt(id: AttackId | null, t: number): number {
    if (id !== 'ZABIMARU') return 0;
    const d = ATTACKS.ZABIMARU;
    if (t < d.windup) return t / d.windup;
    if (t < d.windup + d.active) return 1;
    return clamp(1 - (t - d.windup - d.active) / d.recovery, 0, 1);
  }

  update(dt: number, attackId: AttackId | null, attackTime: number, keepOut: KeepOut | null = null): void {
    if (this.segments.length) {
      const target = this.extensionAt(attackId, attackTime);
      this.extend = target > this.extend ? target : Math.max(target, this.extend - dt * 4);
      this.applyExtension(this.extend);
    }
    if (this.chain0 && this.ball) {
      this.model.updateMatrixWorld(true);
      if (!this.ballInit) {
        this.ballRestLocal.copy(this.ball.getWorldPosition(new THREE.Vector3())).applyMatrix4(this.grip.matrixWorld.clone().invert());
        this.ballPos.copy(this.ball.getWorldPosition(new THREE.Vector3()));
        this.ballInit = true;
      }
      const target = this.ballRestLocal.clone().applyMatrix4(this.grip.matrixWorld);
      // Spring-damper point mass: the ball trails the hand by ~COMBAT.morningStarBallLag.
      const k = 1 / (COMBAT.morningStarBallLag * COMBAT.morningStarBallLag) * 0.9, c = 2 / COMBAT.morningStarBallLag * 0.9;
      const acc = target.clone().sub(this.ballPos).multiplyScalar(k).addScaledVector(this.ballVel, -c).add(new THREE.Vector3(0, -9.8, 0));
      this.ballVel.addScaledVector(acc, Math.min(dt, 1 / 30));
      this.ballPos.addScaledVector(this.ballVel, Math.min(dt, 1 / 30));
      const maxLen = target.distanceTo(new THREE.Vector3().setFromMatrixPosition(this.chain0.matrixWorld)) * 1.05;
      const base = new THREE.Vector3().setFromMatrixPosition(this.chain0.matrixWorld);
      const off = this.ballPos.clone().sub(base);
      if (off.length() > maxLen) this.ballPos.copy(base).addScaledVector(off.normalize(), maxLen);
      if (keepOut) this.pushOut(keepOut);
      aim(this.chain0, this.ball.getWorldPosition(new THREE.Vector3()), this.ballPos);
    }
    // Trail during the contact window only (plus a short fade).
    const live = attackId && attackId !== 'KICK' && isContactWindow(attackId, attackTime);
    for (const p of this.trailPts) p.age += dt;
    this.trailPts = this.trailPts.filter((p) => p.age < 0.14);
    if (live) {
      this.model.updateMatrixWorld(true);
      const tipNode = this.ball ?? (this.info.tipNode ? this.model.getObjectByName(this.info.tipNode) : null);
      const tip = tipNode ? tipNode.getWorldPosition(new THREE.Vector3()) : new THREE.Vector3(0, this.info.length, 0).applyMatrix4(this.grip.matrixWorld);
      const base = new THREE.Vector3(0, this.info.length * 0.3, 0).applyMatrix4(this.grip.matrixWorld);
      this.trailPts.unshift({ base, tip, age: 0 });
      if (this.trailPts.length > TRAIL_SAMPLES) this.trailPts.length = TRAIL_SAMPLES;
    }
    this.trail.visible = this.trailPts.length > 1;
    if (this.trail.visible) {
      const pos = this.trailGeo.attributes.position as THREE.BufferAttribute;
      const alpha = this.trailGeo.attributes.alpha as THREE.BufferAttribute;
      for (let i = 0; i < TRAIL_SAMPLES; i++) {
        const p = this.trailPts[Math.min(i, this.trailPts.length - 1)]!;
        pos.setXYZ(i * 2, p.base.x, p.base.y, p.base.z);
        pos.setXYZ(i * 2 + 1, p.tip.x, p.tip.y, p.tip.z);
        const a = i < this.trailPts.length ? (1 - i / TRAIL_SAMPLES) * (1 - p.age / 0.14) * 0.8 : 0;
        alpha.setX(i * 2, a * 0.2);
        alpha.setX(i * 2 + 1, a);
      }
      pos.needsUpdate = true;
      alpha.needsUpdate = true;
    }
  }

  /** Moves the ball (and cancels its inward velocity) out through the nearest side of the bike. */
  private pushOut(k: KeepOut): void {
    const inv = k.frame.matrixWorld.clone().invert();
    const p = this.ballPos.clone().applyMatrix4(inv).sub(k.centre);
    const margin = 0.12;
    const hx = k.half.x + margin, hy = k.half.y + margin, hz = k.half.z + margin;
    if (Math.abs(p.x) >= hx || Math.abs(p.y) >= hy || Math.abs(p.z) >= hz) return;
    // Out through the side the ball is already on (never through the top where the rider sits).
    const sx = Math.sign(p.x) || 1;
    p.x = sx * hx;
    this.ballPos.copy(p.add(k.centre).applyMatrix4(k.frame.matrixWorld));
    const side = new THREE.Vector3(sx, 0, 0).transformDirection(k.frame.matrixWorld);
    const vn = this.ballVel.dot(side);
    if (vn < 0) this.ballVel.addScaledVector(side, -vn);
  }

  dispose(): void {
    this.grip.removeFromParent();
    this.trail.removeFromParent();
  }
}
