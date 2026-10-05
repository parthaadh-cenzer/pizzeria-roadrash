// Crowd (spec "Crowd"): visual only, never affects physics. Barrier spectators Cheer/Clap,
// sidewalk NPCs walk in place along sidewalk paths (never on the race surface). Near: optimized
// skinned models; mid: LOD1 skinned (reduced update rate); far: runtime-baked impostors.
// Randomized phase / height / material variant, no adjacent duplicates, racer appearances suppressed.
import * as THREE from 'three';
import { clone as cloneSkinned } from 'three/examples/jsm/utils/SkeletonUtils.js';
import type { GLTF } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { ROAD_PROFILE, WALKER_DISTRICTS } from '../../config/track.js';
import { RIDERS } from '../../config/riders.js';
import { hash01, mulberry32 } from '../../shared/math.js';
import { STRUCTURE, type Track } from '../../game/track/Track.js';
import { applyVariant } from '../materials/Variants.js';
import { buildRig, retargetClip } from '../anim/Retarget.js';
import type { CanonicalClip } from '../../config/skeleton.js';

export interface CrowdModel {
  id: string;
  lod0: GLTF;
  lod1: GLTF | null;
  rigged: boolean;
  variants: THREE.Color[];
  masks: Map<string, THREE.Texture>;
  tintMaterials: string[];
  /** Rider appearance this crowd model shares for variants 0..2 (for suppression). */
  riderAppearance: string | null;
}

interface Spot {
  pos: THREE.Vector3;
  yaw: number;
  s: number;
  walker: boolean;
  dir: number;
  lateral: number;
  speed: number;
  scale: number;
  phase: number;
  appearance: number;
}

interface Appearance {
  model: number;
  variant: number;
  key: string;
}

interface Skinned {
  root: THREE.Object3D;
  mixer: THREE.AnimationMixer;
  clap: THREE.AnimationAction | null;
  walk: THREE.AnimationAction | null;
  spot: Spot | null;
  appearance: number;
  lod: 0 | 1;
  model: number;
}

const CELL_W = 64, CELL_H = 128, ATLAS = 2048;
const FRAMES = 4; // per motion

export interface CrowdBudget {
  near: number;
  mid: number;
  far: number;
}

export class Crowd {
  readonly group = new THREE.Group();
  private spots: Spot[] = [];
  private appearances: Appearance[] = [];
  private models: CrowdModel[];
  private skinned: Skinned[] = [];
  private impostors: THREE.InstancedMesh | null = null;
  private impostorAttr: { cell: THREE.InstancedBufferAttribute; phase: THREE.InstancedBufferAttribute } | null = null;
  private atlas: THREE.WebGLRenderTarget | null = null;
  private clapClips = new Map<number, THREE.AnimationClip>();
  private walkClips = new Map<number, THREE.AnimationClip>();
  private reassignTimer = 0;
  private frame = 0;
  private budget: CrowdBudget;
  private track: Track;
  private impostorMat: THREE.ShaderMaterial | null = null;

  constructor(track: Track, models: CrowdModel[], clips: { clap: CanonicalClip | null; walk: CanonicalClip | null }, budget: CrowdBudget, suppress: string[], density: number) {
    this.track = track;
    this.models = models;
    this.budget = budget;
    this.group.name = 'crowd';
    // Appearances (model x variant), minus exact racer appearances.
    models.forEach((m, mi) => {
      m.variants.forEach((_, vi) => {
        const key = m.riderAppearance && vi < 3 ? `${m.riderAppearance}:${vi}` : `${m.id}:${vi}`;
        if (suppress.includes(key)) return;
        this.appearances.push({ model: mi, variant: vi, key });
      });
      if (m.rigged) {
        const rig = buildRig(m.lod0.scene);
        if (clips.clap) this.clapClips.set(mi, retargetClip(clips.clap, rig, { rootMotion: false }));
        if (clips.walk) this.walkClips.set(mi, retargetClip(clips.walk, rig, { rootMotion: false }));
      }
    });
    this.buildSpots(density);
    this.buildGrandstands();
  }

  private buildSpots(density: number): void {
    const t = this.track;
    const rnd = mulberry32(777);
    const b = t.bridge;
    let last = -1;
    const pick = () => {
      // Deterministic sequence with no adjacent duplicates.
      let a = Math.floor(rnd() * this.appearances.length);
      if (this.appearances.length > 1 && a === last) a = (a + 1 + Math.floor(rnd() * (this.appearances.length - 1))) % this.appearances.length;
      last = a;
      return a;
    };
    if (!this.appearances.length) return;
    for (let s = 0; s < t.length; s += 2.6) {
      if (t.structureAt(s) === STRUCTURE.TUNNEL || (s > b.s0 - 40 && s < b.s1 + 20)) continue;
      const d = t.crowdDensityAt(s) * density;
      const nearStart = t.deltaS(0, s) > -220 && t.deltaS(0, s) < 120;
      for (const side of [-1, 1]) {
        if (rnd() > d * (nearStart ? 1.6 : 1)) continue;
        const f = t.frameAt(s);
        const walker = WALKER_DISTRICTS.includes(t.districtAt(s)) && rnd() < 0.3;
        const inner = t.barrierOffsetAt(s) + ROAD_PROFILE.barrierThickness;
        const lateral = side * (walker ? inner + ROAD_PROFILE.sidewalkWidth - 0.7 : inner + 0.55 + rnd() * 1.2);
        const p = t.pointAt(s, lateral, ROAD_PROFILE.curbHeight);
        const heading = Math.atan2(f.tx, f.tz);
        const dir = rnd() < 0.5 ? 1 : -1;
        this.spots.push({
          pos: new THREE.Vector3(p.x, p.y, p.z),
          yaw: walker ? heading + (dir < 0 ? Math.PI : 0) : heading - side * Math.PI / 2 + (rnd() - 0.5) * 0.5,
          s, walker, dir, lateral, speed: 1.1 + rnd() * 0.5, scale: 0.94 + rnd() * 0.12, phase: rnd() * 10, appearance: pick(),
        });
      }
    }
  }

  private buildGrandstands(): void {
    const t = this.track;
    const rnd = mulberry32(99);
    const stepGeo = new THREE.BoxGeometry(1, 1, 1);
    const mats: THREE.Matrix4[] = [];
    let last = -1;
    for (let s = -190; s < 100; s += 12) {
      const ss = t.wrapS(s);
      const f = t.frameAt(ss);
      const heading = Math.atan2(f.tx, f.tz);
      for (const side of [-1, 1]) {
        const base = t.barrierOffsetAt(ss) + ROAD_PROFILE.barrierThickness + ROAD_PROFILE.sidewalkWidth + 1.0;
        for (let row = 0; row < 5; row++) {
          const lat = side * (base + row * 0.9 + 0.45);
          const p = t.pointAt(ss, lat, 0);
          const h = 0.5 + row * 0.55;
          mats.push(new THREE.Matrix4().compose(new THREE.Vector3(p.x, p.y + h / 2, p.z), new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), heading), new THREE.Vector3(0.9, h, 12)));
          for (let k = 0; k < 7; k++) {
            if (rnd() < 0.2 || !this.appearances.length) continue;
            let a = Math.floor(rnd() * this.appearances.length);
            if (a === last && this.appearances.length > 1) a = (a + 1) % this.appearances.length;
            last = a;
            const q = t.pointAt(t.wrapS(ss - 6 + k * 1.7 + rnd() * 0.4), lat, h);
            this.spots.push({ pos: new THREE.Vector3(q.x, q.y, q.z), yaw: heading - side * Math.PI / 2, s: ss, walker: false, dir: 1, lateral: lat, speed: 0, scale: 0.94 + rnd() * 0.12, phase: rnd() * 10, appearance: a });
          }
        }
      }
    }
    if (mats.length) {
      const im = new THREE.InstancedMesh(stepGeo, new THREE.MeshStandardMaterial({ color: 0x2b2e38, roughness: 0.6, metalness: 0.4 }), mats.length);
      mats.forEach((m, i) => im.setMatrixAt(i, m));
      im.computeBoundingSphere();
      im.name = 'grandstands';
      this.group.add(im);
    }
  }

  get spotCount(): number {
    return this.spots.length;
  }

  // ------------------------------------------------------------------------------ skinned pools
  private makeSkinned(mi: number, lod: 0 | 1): Skinned | null {
    const m = this.models[mi]!;
    if (!m.rigged) return null;
    const src = lod === 1 && m.lod1 ? m.lod1 : m.lod0;
    const root = cloneSkinned(src.scene);
    root.traverse((o) => {
      const mesh = o as THREE.Mesh;
      if (mesh.isMesh) mesh.frustumCulled = false;
    });
    const mixer = new THREE.AnimationMixer(root);
    const clapClip = this.clapClips.get(mi), walkClip = this.walkClips.get(mi);
    const clap = clapClip ? mixer.clipAction(clapClip) : null;
    const walk = walkClip ? mixer.clipAction(walkClip) : null;
    root.visible = false;
    this.group.add(root);
    return { root, mixer, clap, walk, spot: null, appearance: -1, lod, model: mi };
  }

  /** Builds skinned pools and the impostor atlas (renders each appearance once). */
  build(renderer: THREE.WebGLRenderer): void {
    const rigged = this.models.map((m, i) => (m.rigged ? i : -1)).filter((i) => i >= 0);
    if (rigged.length) {
      for (let k = 0; k < this.budget.near; k++) {
        const s = this.makeSkinned(rigged[k % rigged.length]!, 0);
        if (s) this.skinned.push(s);
      }
      for (let k = 0; k < this.budget.mid; k++) {
        const s = this.makeSkinned(rigged[k % rigged.length]!, 1);
        if (s) this.skinned.push(s);
      }
    }
    this.buildImpostors(renderer);
  }

  private tint(root: THREE.Object3D, a: Appearance): void {
    const m = this.models[a.model]!;
    const color = m.variants[a.variant]!;
    if (root.userData.appearance === a.key) return;
    root.userData.appearance = a.key;
    // Always re-apply from the source materials so variant shaders never stack.
    let orig = root.userData.orig as [THREE.Mesh, THREE.Material | THREE.Material[]][] | undefined;
    if (!orig) {
      orig = [];
      root.traverse((o) => {
        const mesh = o as THREE.Mesh;
        if (mesh.isMesh) orig!.push([mesh, mesh.material]);
      });
      root.userData.orig = orig;
    } else for (const [mesh, mat] of orig) mesh.material = mat;
    applyVariant(root, { paint: color, tintMaterials: m.tintMaterials, masks: m.masks, maskColor: color, emissiveIntensity: 1.2 });
  }

  private buildImpostors(renderer: THREE.WebGLRenderer): void {
    if (!this.appearances.length) return;
    const atlas = new THREE.WebGLRenderTarget(ATLAS, ATLAS, { samples: 0 });
    this.atlas = atlas;
    const cols = ATLAS / CELL_W;
    const scene = new THREE.Scene();
    scene.add(new THREE.HemisphereLight(0xc8d4ff, 0x302838, 2.2));
    const key = new THREE.DirectionalLight(0xffe6d0, 1.4);
    key.position.set(1, 2, 3);
    scene.add(key);
    const cam = new THREE.OrthographicCamera(-0.55, 0.55, 2.1, -0.1, 0.1, 10);
    cam.position.set(0, 1, 4);
    cam.lookAt(0, 1, 0);
    const prevTarget = renderer.getRenderTarget();
    const prevClear = renderer.getClearColor(new THREE.Color());
    const prevAlpha = renderer.getClearAlpha();
    renderer.setRenderTarget(this.atlas);
    renderer.setClearColor(0x000000, 0);
    renderer.clear();
    this.appearances.forEach((a, ai) => {
      const m = this.models[a.model]!;
      const root = cloneSkinned(m.lod0.scene);
      this.tint(root, a);
      scene.add(root);
      const mixer = new THREE.AnimationMixer(root);
      for (let motion = 0; motion < 2; motion++) {
        const clip = motion === 0 ? this.clapClips.get(a.model) : this.walkClips.get(a.model);
        const act = clip ? mixer.clipAction(clip) : null;
        act?.play();
        for (let fr = 0; fr < FRAMES; fr++) {
          if (act && clip) {
            act.time = (fr / FRAMES) * (motion === 0 ? 1.6 : clip.duration);
            mixer.update(0);
          }
          const cell = ai * FRAMES * 2 + motion * FRAMES + fr;
          const x = (cell % cols) * CELL_W, y = Math.floor(cell / cols) * CELL_H;
          // Target-space viewport/scissor (renderer viewports are scaled by pixel ratio).
          atlas.viewport.set(x, y, CELL_W, CELL_H);
          atlas.scissor.set(x, y, CELL_W, CELL_H);
          atlas.scissorTest = true;
          renderer.setRenderTarget(atlas);
          renderer.render(scene, cam);
        }
        act?.stop();
      }
      scene.remove(root);
    });
    atlas.scissorTest = false;
    atlas.viewport.set(0, 0, ATLAS, ATLAS);
    renderer.setRenderTarget(prevTarget);
    renderer.setClearColor(prevClear, prevAlpha);

    const geo = new THREE.InstancedBufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(new Float32Array([-0.5, 0, 0, 0.5, 0, 0, -0.5, 1, 0, 0.5, 1, 0]), 3));
    geo.setAttribute('uv', new THREE.BufferAttribute(new Float32Array([0, 0, 1, 0, 0, 1, 1, 1]), 2));
    geo.setIndex([0, 1, 2, 1, 3, 2]);
    const max = this.budget.far;
    const cell = new THREE.InstancedBufferAttribute(new Float32Array(max), 1);
    const phase = new THREE.InstancedBufferAttribute(new Float32Array(max), 1);
    geo.setAttribute('aCell', cell);
    geo.setAttribute('aPhase', phase);
    this.impostorMat = new THREE.ShaderMaterial({
      uniforms: { ...THREE.UniformsUtils.clone(THREE.UniformsLib.fog), uAtlas: { value: this.atlas.texture }, uTime: { value: 0 }, uCols: { value: cols }, uCellUV: { value: new THREE.Vector2(CELL_W / ATLAS, CELL_H / ATLAS) } },
      vertexShader: /* glsl */ `
        attribute float aCell; attribute float aPhase;
        uniform float uTime; uniform float uCols; uniform vec2 uCellUV;
        varying vec2 vUv;
        #include <fog_pars_vertex>
        void main() {
          vec3 origin = (instanceMatrix * vec4(0.0, 0.0, 0.0, 1.0)).xyz;
          float h = length(instanceMatrix[1].xyz) * 2.2;
          vec3 toCam = cameraPosition - origin; toCam.y = 0.0; toCam = normalize(toCam);
          vec3 side = vec3(toCam.z, 0.0, -toCam.x);
          vec3 wp = origin + side * position.x * h * 0.5 + vec3(0.0, 1.0, 0.0) * position.y * h;
          float frame = mod(floor(uTime * 6.0 + aPhase * 7.0), 4.0);
          float c = aCell + frame;
          vUv = vec2((mod(c, uCols) + uv.x) * uCellUV.x, (floor(c / uCols) + uv.y) * uCellUV.y);
          vec4 mvPosition = viewMatrix * vec4(wp, 1.0);
          gl_Position = projectionMatrix * mvPosition;
          #include <fog_vertex>
        }`,
      fragmentShader: /* glsl */ `
        uniform sampler2D uAtlas; varying vec2 vUv;
        #include <fog_pars_fragment>
        void main() { vec4 c = texture2D(uAtlas, vUv); if (c.a < 0.45) discard; gl_FragColor = vec4(c.rgb * 0.8, 1.0);
          #include <fog_fragment>
          #include <colorspace_fragment>
        }`,
      fog: true,
    });
    this.impostors = new THREE.InstancedMesh(geo, this.impostorMat, max);
    this.impostors.count = 0;
    this.impostors.frustumCulled = false;
    this.impostors.name = 'crowd_impostors';
    this.impostorAttr = { cell, phase };
    this.group.add(this.impostors);
  }

  // ------------------------------------------------------------------------------ per frame
  update(dt: number, time: number, camera: THREE.Camera, camS: number): void {
    this.frame++;
    // Walkers advance along their sidewalk path (lateral fixed on the sidewalk).
    for (const sp of this.spots) {
      if (!sp.walker) continue;
      sp.s = this.track.wrapS(sp.s + sp.dir * sp.speed * dt);
      const p = this.track.pointAt(sp.s, sp.lateral, ROAD_PROFILE.curbHeight);
      sp.pos.set(p.x, p.y, p.z);
      const f = this.track.frameAt(sp.s);
      sp.yaw = Math.atan2(f.tx, f.tz) + (sp.dir < 0 ? Math.PI : 0);
    }
    this.reassignTimer -= dt;
    if (this.reassignTimer <= 0) {
      this.reassignTimer = 0.35;
      this.assign(camera, camS);
    }
    for (const sk of this.skinned) {
      if (!sk.spot) continue;
      const sp = sk.spot;
      sk.root.position.copy(sp.pos);
      sk.root.rotation.y = sp.yaw;
      const everyN = sk.lod === 0 ? 1 : 3;
      if (this.frame % everyN === 0) sk.mixer.update(dt * everyN);
    }
    if (this.impostorMat) this.impostorMat.uniforms.uTime!.value = time;
  }

  private assign(camera: THREE.Camera, camS: number): void {
    const camPos = camera.position;
    const cand: { sp: Spot; d: number }[] = [];
    for (const sp of this.spots) {
      const ds = this.track.deltaS(camS, sp.s);
      if (ds < -80 || ds > 420) continue;
      cand.push({ sp, d: sp.pos.distanceToSquared(camPos) });
    }
    cand.sort((a, b) => a.d - b.d);
    const used = new Set<Skinned>();
    let ci = 0;
    const takeTier = (lod: 0 | 1, count: number) => {
      for (let n = 0; n < count && ci < cand.length; ci++) {
        const sp = cand[ci]!.sp;
        const a = this.appearances[sp.appearance]!;
        const pool = this.skinned.find((s) => !used.has(s) && s.lod === lod && s.model === a.model && s.spot === sp) ?? this.skinned.find((s) => !used.has(s) && s.lod === lod && s.model === a.model);
        if (!pool) {
          // No skinned instance of this model free in the tier: leave for impostors.
          (sp as Spot & { imp?: boolean }).imp = true;
          continue;
        }
        used.add(pool);
        if (pool.spot !== sp) {
          pool.spot = sp;
          this.tint(pool.root, a);
          pool.root.scale.setScalar(sp.scale);
          const act = sp.walker ? pool.walk : pool.clap;
          const other = sp.walker ? pool.clap : pool.walk;
          other?.stop();
          if (act) {
            act.play();
            act.time = sp.phase % act.getClip().duration;
          }
        }
        pool.root.visible = true;
        n++;
      }
    };
    takeTier(0, this.budget.near);
    takeTier(1, this.budget.mid);
    for (const s of this.skinned) if (!used.has(s)) {
      s.root.visible = false;
      s.spot = null;
    }
    // Far tier + anything the pools could not take: impostors.
    if (this.impostors && this.impostorAttr) {
      const skinnedSpots = new Set([...used].map((s) => s.spot));
      let n = 0;
      const m = new THREE.Matrix4();
      for (const c of cand) {
        if (n >= this.budget.far) break;
        if (skinnedSpots.has(c.sp)) continue;
        const sp = c.sp;
        m.compose(sp.pos, new THREE.Quaternion(), new THREE.Vector3(sp.scale, sp.scale * 0.85, sp.scale));
        this.impostors.setMatrixAt(n, m);
        this.impostorAttr.cell.setX(n, sp.appearance * FRAMES * 2 + (sp.walker ? FRAMES : 0));
        this.impostorAttr.phase.setX(n, hash01(Math.floor(sp.phase * 1000)));
        n++;
      }
      this.impostors.count = n;
      this.impostors.instanceMatrix.needsUpdate = true;
      this.impostorAttr.cell.needsUpdate = true;
      this.impostorAttr.phase.needsUpdate = true;
    }
  }

  dispose(): void {
    for (const s of this.skinned) s.mixer.stopAllAction();
    this.atlas?.dispose();
    this.group.removeFromParent();
  }
}

/** Crowd colour palettes: variants 0..2 reuse the rider variant colours (suppression keys). */
export function crowdVariants(id: string, count: number): THREE.Color[] {
  const riderFor: Record<string, keyof typeof RIDERS | undefined> = { 'crowd.mohawk': 'RIDER_03_CYBERPUNK_MOHAWK', 'crowd.enforcer': 'RIDER_04_CYBERPUNK_ENFORCER' };
  const r = riderFor[id];
  const out: THREE.Color[] = [];
  const extra = ['#ff7a1a', '#3dff9a', '#8a3dff', '#ffc21a', '#e8e8f0', '#ff2a3a', '#18e0ff', '#c04cff'];
  for (let i = 0; i < count; i++) {
    if (r && i < 3) out.push(new THREE.Color(RIDERS[r].variants[i]!.primary));
    else out.push(new THREE.Color(extra[(i + id.length) % extra.length]!));
  }
  return out;
}
