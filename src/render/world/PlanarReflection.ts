// Planar reflection for the wet road (HIGH/MEDIUM). Renders the scene mirrored across the local
// road height into a reduced-resolution target; the road shader samples it projectively and
// stretches it along the road direction (not a perfect mirror).
import * as THREE from 'three';
import type { RenderCore } from '../RenderCore.js';

/** Objects on this layer (neon, holograms, lit windows, signage, sky, actors) appear in reflections. */
export const REFLECT_LAYER = 1;

export function isReflective(o: THREE.Object3D): boolean {
  const m = (o as THREE.Mesh).material as THREE.Material | THREE.Material[] | undefined;
  if (!m) return false;
  const list = Array.isArray(m) ? m : [m];
  return list.some((x) => {
    if ((x as THREE.ShaderMaterial).isShaderMaterial) return true;
    if ((x as THREE.MeshBasicMaterial).isMeshBasicMaterial) return true;
    const s = x as THREE.MeshStandardMaterial;
    return !!s.emissiveMap || (s.emissive && s.emissive.getHex() !== 0 && s.emissiveIntensity > 0) || s.name === 'building_windows';
  });
}

export function tagReflective(root: THREE.Object3D): number {
  let n = 0;
  root.traverse((o) => {
    if (isReflective(o)) {
      o.layers.enable(REFLECT_LAYER);
      n++;
    }
  });
  return n;
}

export interface PassState {
  target: THREE.WebGLRenderTarget;
  planes: THREE.Plane[];
  layer: number;
}

export class PlanarReflection {
  readonly target: THREE.WebGLRenderTarget;
  readonly texture: THREE.Texture;
  readonly matrix = new THREE.Matrix4();
  private cam = new THREE.PerspectiveCamera();
  frame = 0;
  interval = 1;
  private plane = new THREE.Plane(new THREE.Vector3(0, 1, 0), 0);
  private hidden: THREE.Object3D[];
  private core: RenderCore;
  private scale: number;

  constructor(core: RenderCore, scale: number, hideMeshes: THREE.Object3D[], hideExtra: THREE.Object3D[]) {
    this.core = core;
    this.scale = scale;
    this.target = new THREE.WebGLRenderTarget(16, 16, { type: THREE.HalfFloatType, depthBuffer: true });
    this.texture = this.target.texture;
    this.hidden = [...hideMeshes, ...hideExtra];
  }

  /** Renderer state of this pass (target, clip plane, camera layer) for shader precompilation. */
  passState(): PassState {
    return { target: this.target, planes: [this.plane], layer: REFLECT_LAYER };
  }

  render(scene: THREE.Scene, camera: THREE.PerspectiveCamera, surfaceY: number): void {
    const r = this.core.renderer;
    this.cam.layers.set(REFLECT_LAYER);
    if (this.frame++ % this.interval !== 0) return;
    const w = Math.max(16, Math.floor(this.core.width * this.scale)), h = Math.max(16, Math.floor(this.core.height * this.scale));
    if (this.target.width !== w || this.target.height !== h) this.target.setSize(w, h);
    // Mirror camera across y = surfaceY.
    const pos = camera.getWorldPosition(new THREE.Vector3());
    const dir = camera.getWorldDirection(new THREE.Vector3());
    const target = pos.clone().add(dir);
    const up = new THREE.Vector3(0, 1, 0).applyQuaternion(camera.quaternion);
    pos.y = 2 * surfaceY - pos.y;
    target.y = 2 * surfaceY - target.y;
    up.y = -up.y;
    this.cam.position.copy(pos);
    this.cam.up.copy(up);
    this.cam.lookAt(target);
    this.cam.fov = camera.fov;
    this.cam.aspect = camera.aspect;
    this.cam.near = camera.near;
    this.cam.far = Math.min(camera.far, 900);
    this.cam.updateProjectionMatrix();
    this.cam.updateMatrixWorld();
    this.matrix.set(0.5, 0, 0, 0.5, 0, 0.5, 0, 0.5, 0, 0, 0.5, 0.5, 0, 0, 0, 1).multiply(this.cam.projectionMatrix).multiply(this.cam.matrixWorldInverse);

    this.plane.set(new THREE.Vector3(0, 1, 0), -(surfaceY + 0.02));
    const vis = this.hidden.map((o) => o.visible);
    for (const o of this.hidden) o.visible = false;
    const prevClip = r.clippingPlanes;
    const prevShadow = r.shadowMap.autoUpdate;
    const prevTarget = r.getRenderTarget();
    r.clippingPlanes = [this.plane];
    r.shadowMap.autoUpdate = false;
    r.setRenderTarget(this.target);
    r.clear();
    r.render(scene, this.cam);
    r.setRenderTarget(prevTarget);
    r.clippingPlanes = prevClip;
    r.shadowMap.autoUpdate = prevShadow;
    this.hidden.forEach((o, i) => (o.visible = vis[i]!));
  }
}
