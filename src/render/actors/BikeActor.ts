// Bike presentation: normalized model, colour variant, wheel/steer/spinner articulation, lean,
// hover bob, idle clips, boost flame and mount targets (bike space -> world) for rider IK.
import * as THREE from 'three';
import { clone as cloneSkinned } from 'three/examples/jsm/utils/SkeletonUtils.js';
import type { GLTF } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { BIKES, type BikeDef } from '../../config/bikes.js';
import type { BikeId } from '../../shared/ids.js';
import type { BikeRuntimeInfo, Vec3Tuple } from '../../shared/manifest.js';
import { damp } from '../../shared/math.js';
import { applyVariant } from '../materials/Variants.js';

interface Articulated {
  node: THREE.Object3D;
  rest: THREE.Quaternion;
  axis: THREE.Vector3; // in parent space
  radius: number;
  angle: number;
  rate: number;
}

/** A node of the mechanical steering assembly with its parent frame in bike space. */
interface SteeredNode {
  node: THREE.Object3D;
  restLocal: THREE.Matrix4;
  restPos: THREE.Vector3;
  restScale: THREE.Vector3;
  parent: THREE.Matrix4;
  parentInv: THREE.Matrix4;
  wheel: Articulated | null;
}

export interface BikeVisualState {
  speed: number;
  steer: number;
  lean: number;
  boosting: boolean;
  airborne: boolean;
  compression: number;
  crashed: boolean;
}

export class BikeActor {
  readonly id: BikeId;
  readonly def: BikeDef;
  readonly info: BikeRuntimeInfo;
  /** World placement (position + yaw/pitch, or full quaternion when crashed). */
  readonly root = new THREE.Group();
  /** Lean (roll) and suspension offset. The rider is parented here while mounted. */
  readonly body = new THREE.Group();
  readonly model: THREE.Object3D;
  private wheels: Articulated[] = [];
  private steers: Articulated[] = [];
  private spins: Articulated[] = [];
  private mixer: THREE.AnimationMixer | null = null;
  private boostNode: THREE.Object3D | null = null;
  private emissiveMats: THREE.MeshStandardMaterial[] = [];
  private baseEmissive: number[] = [];
  private bob = Math.random() * 10;
  private steerVis = 0;
  private assembly: { nodes: SteeredNode[]; pivot: THREE.Vector3; axis: THREE.Vector3; max: number; grips: [THREE.Object3D, THREE.Object3D][] } | null = null;
  private suspension = 0;
  readonly headlightLocal: THREE.Vector3;
  readonly exhaustLocal: THREE.Vector3[];

  constructor(id: BikeId, gltf: GLTF, info: BikeRuntimeInfo, variant: number, masks: Map<string, THREE.Texture>) {
    this.id = id;
    this.def = BIKES[id];
    this.info = info;
    this.model = cloneSkinned(gltf.scene);
    this.model.name = `bike_${id}`;
    const v = this.def.variants[variant] ?? this.def.variants[0];
    const isFactory = v.paint.toLowerCase() === '#ffffff';
    applyVariant(this.model, {
      paint: new THREE.Color(v.paint),
      accent: new THREE.Color(v.accent),
      emissive: new THREE.Color(v.emissive),
      paintMaterials: this.def.paintMaterials,
      accentMaterials: this.def.accentMaterials,
      emissiveMaterials: this.def.emissiveMaterials,
      masks,
      maskColor: this.def.atlasTint && !isFactory ? new THREE.Color(v.paint) : null,
      emissiveIntensity: 2.6,
      wetSheen: true,
    });
    this.model.traverse((o) => {
      const m = o as THREE.Mesh;
      if (!m.isMesh) return;
      m.castShadow = true;
      m.receiveShadow = true;
      m.frustumCulled = false;
      const mat = m.material as THREE.MeshStandardMaterial;
      if (mat.emissiveIntensity > 0 && (mat.emissive.getHex() !== 0 || mat.emissiveMap) && !this.emissiveMats.includes(mat)) {
        this.emissiveMats.push(mat);
        this.baseEmissive.push(mat.emissiveIntensity);
      }
    });
    this.body.add(this.model);
    this.root.add(this.body);
    this.model.updateMatrixWorld(true);
    const modelInv = new THREE.Quaternion();
    const axisFor = (node: THREE.Object3D, bikeAxis: THREE.Vector3) => {
      const pq = node.parent ? node.parent.getWorldQuaternion(new THREE.Quaternion()) : new THREE.Quaternion();
      this.model.getWorldQuaternion(modelInv);
      // Parent orientation relative to the bike model frame.
      const rel = modelInv.clone().invert().multiply(pq);
      return bikeAxis.clone().applyQuaternion(rel.invert()).normalize();
    };
    for (const w of info.wheels) {
      const n = this.model.getObjectByName(w.node);
      if (n) this.wheels.push({ node: n, rest: n.quaternion.clone(), axis: axisFor(n, new THREE.Vector3(1, 0, 0)), radius: Math.max(0.15, w.radius), angle: 0, rate: 1 });
    }
    for (const s of info.spinNodes) {
      const n = this.model.getObjectByName(s.node);
      if (n) this.spins.push({ node: n, rest: n.quaternion.clone(), axis: axisFor(n, new THREE.Vector3(1, 0, 0)), radius: 0.4, angle: 0, rate: s.rate });
    }
    const asm = this.def.steering;
    if (asm) {
      // Built with the bike at the origin, so world space here is bike (body) space.
      const nodes: SteeredNode[] = [];
      for (const name of asm.nodes) {
        const n = this.model.getObjectByName(name);
        if (!n || !n.parent) throw new Error(`${id}: steering node ${name} missing`);
        const parent = n.parent.matrixWorld.clone();
        nodes.push({ node: n, restLocal: n.matrix.clone(), restPos: n.position.clone(), restScale: n.scale.clone(), parent, parentInv: parent.clone().invert(), wheel: this.wheels.find((w) => w.node === n) ?? null });
      }
      const grips = asm.grips.map(([a, b]) => {
        const na = this.model.getObjectByName(a), nb = this.model.getObjectByName(b);
        if (!na || !nb) throw new Error(`${id}: grip bones ${a}/${b} missing`);
        return [na, nb] as [THREE.Object3D, THREE.Object3D];
      });
      const rake = THREE.MathUtils.degToRad(asm.rakeDeg);
      this.assembly = { nodes, pivot: new THREE.Vector3(...asm.pivot), axis: new THREE.Vector3(0, Math.cos(rake), -Math.sin(rake)), max: THREE.MathUtils.degToRad(asm.maxDeg), grips };
    } else {
      for (const s of info.steerNodes) {
        const n = this.model.getObjectByName(s);
        if (n) this.steers.push({ node: n, rest: n.quaternion.clone(), axis: axisFor(n, new THREE.Vector3(0, 1, 0)), radius: 1, angle: 0, rate: 1 });
      }
    }
    if (gltf.animations.length) {
      this.mixer = new THREE.AnimationMixer(this.model);
      for (const clip of gltf.animations) this.mixer.clipAction(clip).play();
    }
    this.boostNode = info.boostNode ? (this.model.getObjectByName(info.boostNode) ?? null) : null;
    if (this.boostNode) this.boostNode.visible = false;
    this.headlightLocal = new THREE.Vector3(...info.headlight);
    this.exhaustLocal = info.exhaust.map((e) => new THREE.Vector3(...e));
  }

  /** Mount target in world space (bike-local tuple -> world through the leaning body). */
  targetWorld(t: Vec3Tuple, out = new THREE.Vector3()): THREE.Vector3 {
    return out.set(t[0], t[1], t[2]).applyMatrix4(this.body.matrixWorld);
  }

  /**
   * Current grip positions in world space (left, right). Bikes with a steering assembly return
   * the moving handlebar bones; others swing the static grip targets about the bar centre.
   */
  gripsWorld(): [THREE.Vector3, THREE.Vector3] {
    this.body.updateMatrixWorld(true);
    if (this.assembly) {
      return this.assembly.grips.map(([a, b]) => a.getWorldPosition(new THREE.Vector3()).add(b.getWorldPosition(new THREE.Vector3())).multiplyScalar(0.5)) as [THREE.Vector3, THREE.Vector3];
    }
    const m = this.info.mount;
    const gl = new THREE.Vector3(...m.leftGripTarget), gr = new THREE.Vector3(...m.rightGripTarget);
    const pivot = gl.clone().add(gr).multiplyScalar(0.5).add(new THREE.Vector3(0, 0, -0.2));
    const q = new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), -this.steerVis * 0.35);
    return [gl, gr].map((g) => g.sub(pivot).applyQuaternion(q).add(pivot).applyMatrix4(this.body.matrixWorld)) as [THREE.Vector3, THREE.Vector3];
  }

  /** Riding placement: position on the road plus yaw/pitch; lean is applied on the body. */
  setRiding(pos: THREE.Vector3, yaw: number, pitch: number, lean: number): void {
    this.root.position.copy(pos);
    this.root.quaternion.setFromEuler(new THREE.Euler(pitch, yaw, 0, 'YXZ'));
    this.body.rotation.set(0, 0, lean);
  }

  /** Crash / lift placement from the authoritative body quaternion. */
  setPose(pos: THREE.Vector3, q: THREE.Quaternion): void {
    this.root.position.copy(pos);
    this.root.quaternion.copy(q);
    this.body.rotation.set(0, 0, 0);
    // Crash bodies are centred ~0.55 m above the ground contact.
    this.body.position.set(0, -0.55, 0);
  }

  update(dt: number, s: BikeVisualState): void {
    const roll = s.crashed ? 0 : s.speed * dt;
    for (const w of this.wheels) {
      w.angle += roll / w.radius;
      w.node.quaternion.copy(new THREE.Quaternion().setFromAxisAngle(w.axis, w.angle)).multiply(w.rest);
    }
    for (const sp of this.spins) {
      sp.angle += (s.crashed ? 0 : (4 + Math.abs(s.speed) * 0.6) * dt) * sp.rate;
      sp.node.quaternion.copy(new THREE.Quaternion().setFromAxisAngle(sp.axis, sp.angle)).multiply(sp.rest);
    }
    this.steerVis = damp(this.steerVis, s.crashed ? 0 : s.steer, 0.08, dt);
    for (const st of this.steers) st.node.quaternion.copy(new THREE.Quaternion().setFromAxisAngle(st.axis, -this.steerVis * 0.35)).multiply(st.rest);
    if (this.assembly) this.articulateSteering(this.assembly);
    this.mixer?.update(dt);
    if (this.boostNode) this.boostNode.visible = s.boosting;
    const hover = this.def.hoverHeight > 0 && !s.crashed;
    this.bob += dt;
    this.suspension = damp(this.suspension, s.compression, 0.08, dt);
    if (!s.crashed) this.body.position.set(0, hover ? Math.sin(this.bob * 2.3) * 0.035 : 0, 0);
    this.body.position.y -= this.suspension * 0.09;
    const glow = s.boosting ? 1.9 : 1;
    this.emissiveMats.forEach((m, i) => (m.emissiveIntensity = this.baseEmissive[i]! * glow));
  }

  /** Yaws the wheel and handlebar chains together about the raked steering axis. */
  private articulateSteering(a: NonNullable<BikeActor['assembly']>): void {
    // Positive steer turns right: the front swings toward the rider's right (bike -X).
    const turn = new THREE.Matrix4().makeRotationAxis(a.axis, -this.steerVis * a.max);
    const s = new THREE.Matrix4().makeTranslation(a.pivot.x, a.pivot.y, a.pivot.z).multiply(turn).multiply(new THREE.Matrix4().makeTranslation(-a.pivot.x, -a.pivot.y, -a.pivot.z));
    const local = new THREE.Matrix4();
    for (const n of a.nodes) {
      // Wheels keep their speed-driven roll; the rest start from the deployed riding pose.
      if (n.wheel) local.compose(n.restPos, n.node.quaternion, n.restScale);
      else local.copy(n.restLocal);
      local.premultiply(n.parent).premultiply(s).premultiply(n.parentInv);
      local.decompose(n.node.position, n.node.quaternion, n.node.scale);
    }
  }

  dispose(): void {
    this.root.removeFromParent();
  }
}
