// Renderer, post-processing and graphics presets (HANDOFF/04_ART_DIRECTION.md).
// Post-processing is never mandatory: if it cannot be created the frame renders directly.
import * as THREE from 'three';
import { EffectComposer } from 'three/examples/jsm/postprocessing/EffectComposer.js';
import { OutputPass } from 'three/examples/jsm/postprocessing/OutputPass.js';
import { RenderPass } from 'three/examples/jsm/postprocessing/RenderPass.js';
import { ShaderPass } from 'three/examples/jsm/postprocessing/ShaderPass.js';
import { UnrealBloomPass } from 'three/examples/jsm/postprocessing/UnrealBloomPass.js';
import type { GraphicsPreset } from '../shared/ids.js';
import { ScreenWater } from './vfx/ScreenWater.js';
import type { PassState } from './world/PlanarReflection.js';

export interface PresetConfig {
  pixelRatioCap: number;
  bloom: boolean;
  bloomScale: number;
  shadows: boolean;
  shadowMapSize: number;
  reflections: 'planar' | 'none';
  reflectionScale: number;
  rainParticles: number;
  crowdNear: number;
  crowdMid: number;
  crowdFar: number;
  lodDistance: number;
  lightPool: number;
  lowLod: boolean;
  fogDensityScale: number;
  drawDistance: number;
  antialias: boolean;
}

export const PRESETS: Record<GraphicsPreset, PresetConfig> = {
  HIGH: { pixelRatioCap: 1.5, bloom: true, bloomScale: 0.5, shadows: true, shadowMapSize: 2048, reflections: 'planar', reflectionScale: 0.5, rainParticles: 14000, crowdNear: 36, crowdMid: 160, crowdFar: 900, lodDistance: 60, lightPool: 12, lowLod: false, fogDensityScale: 1, drawDistance: 2600, antialias: true },
  MEDIUM: { pixelRatioCap: 1.0, bloom: true, bloomScale: 0.5, shadows: true, shadowMapSize: 1024, reflections: 'planar', reflectionScale: 0.33, rainParticles: 8000, crowdNear: 20, crowdMid: 90, crowdFar: 600, lodDistance: 45, lightPool: 8, lowLod: false, fogDensityScale: 1, drawDistance: 2000, antialias: true },
  MOBILE: { pixelRatioCap: 1.0, bloom: true, bloomScale: 0.33, shadows: false, shadowMapSize: 512, reflections: 'none', reflectionScale: 0.25, rainParticles: 3500, crowdNear: 8, crowdMid: 40, crowdFar: 320, lodDistance: 30, lightPool: 6, lowLod: true, fogDensityScale: 1, drawDistance: 1400, antialias: false },
};

const FinalShader = {
  uniforms: {
    tDiffuse: { value: null as THREE.Texture | null },
    tWater: { value: null as THREE.Texture | null },
    uWaterStrength: { value: 1 },
    uVignette: { value: 0.32 },
    uTime: { value: 0 },
    uFlash: { value: 0 },
    uSpeed: { value: 0 },
    uAspect: { value: 1 },
  },
  vertexShader: /* glsl */ `
    varying vec2 vUv;
    void main() { vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }
  `,
  fragmentShader: /* glsl */ `
    uniform sampler2D tDiffuse;
    uniform sampler2D tWater;
    uniform float uWaterStrength, uVignette, uTime, uFlash, uSpeed, uAspect;
    varying vec2 vUv;
    float hash(vec2 p) { return fract(sin(dot(p, vec2(12.9898, 78.233))) * 43758.5453); }
    void main() {
      vec4 w = texture2D(tWater, vUv);
      // Water texture: rg = refraction normal (0.5 neutral), b = thickness, a = coverage.
      vec2 n = (w.rg - 0.5) * 2.0;
      float cover = w.a * uWaterStrength;
      vec2 uv = vUv + n * 0.035 * cover;
      // Subtle peripheral speed streaking (no heavy global motion blur).
      vec2 fromC = vUv - vec2(0.5, 0.52);
      float edge = smoothstep(0.25, 0.75, length(fromC * vec2(uAspect, 1.0)));
      vec3 col = texture2D(tDiffuse, uv).rgb;
      if (uSpeed > 0.01) {
        vec3 acc = col;
        for (int i = 1; i <= 3; i++) acc += texture2D(tDiffuse, uv - fromC * 0.012 * float(i) * uSpeed * edge).rgb;
        col = mix(col, acc / 4.0, edge * uSpeed);
      }
      // Water droplets brighten/cool slightly and blur via the refracted lookup.
      col = mix(col, col * vec3(0.92, 0.98, 1.08) + w.b * 0.05, cover * 0.6);
      // Vignette + faint grain.
      float v = smoothstep(0.95, 0.35, length(fromC * vec2(uAspect * 0.8, 1.0)));
      col *= mix(1.0 - uVignette, 1.0, v);
      col += (hash(vUv * 1024.0 + uTime) - 0.5) * 0.012;
      col += uFlash * vec3(0.75, 0.8, 1.0);
      gl_FragColor = vec4(col, 1.0);
    }
  `,
};

export class RenderCore {
  readonly renderer: THREE.WebGLRenderer;
  preset: GraphicsPreset = 'HIGH';
  cfg: PresetConfig = PRESETS.HIGH;
  composer: EffectComposer | null = null;
  private renderPass: RenderPass | null = null;
  private bloom: UnrealBloomPass | null = null;
  private finalPass: ShaderPass | null = null;
  readonly water: ScreenWater;
  private waterOverlay: THREE.Mesh | null = null;
  postFailed = false;
  width = 1;
  height = 1;
  flash = 0;
  speedBlur = 0;
  /** Dynamic resolution multiplier (0.55..1) applied on top of the preset pixel-ratio cap. */
  renderScale = 1;

  constructor(canvas: HTMLCanvasElement) {
    this.renderer = new THREE.WebGLRenderer({ canvas, antialias: false, powerPreference: 'high-performance', stencil: false, alpha: false });
    this.renderer.outputColorSpace = THREE.SRGBColorSpace;
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
    this.renderer.toneMappingExposure = 1.05;
    this.renderer.shadowMap.type = THREE.PCFShadowMap; // PCFSoft was removed in three r18x
    this.renderer.info.autoReset = false;
    this.water = new ScreenWater();
    this.resize();
    window.addEventListener('resize', () => this.resize());
    canvas.addEventListener('webglcontextlost', (e) => {
      e.preventDefault();
      console.error('[render] WebGL context lost');
    });
  }

  setPreset(p: GraphicsPreset): void {
    this.preset = p;
    this.cfg = PRESETS[p];
    this.renderer.shadowMap.enabled = this.cfg.shadows;
    this.resize();
    this.buildPost();
  }

  private buildPost(): void {
    this.composer?.dispose();
    this.composer = null;
    this.bloom = null;
    try {
      const target = new THREE.WebGLRenderTarget(this.width, this.height, { type: THREE.HalfFloatType, samples: this.cfg.antialias ? 4 : 0 });
      const composer = new EffectComposer(this.renderer, target);
      composer.setPixelRatio(this.renderer.getPixelRatio());
      composer.setSize(this.width, this.height);
      this.renderPass = new RenderPass(new THREE.Scene(), new THREE.PerspectiveCamera());
      composer.addPass(this.renderPass);
      if (this.cfg.bloom) {
        const s = this.cfg.bloomScale;
        this.bloom = new UnrealBloomPass(new THREE.Vector2(this.width * s, this.height * s), 0.72, 0.42, 1.25);
        composer.addPass(this.bloom);
      }
      this.finalPass = new ShaderPass(FinalShader);
      this.finalPass.uniforms.tWater!.value = this.water.texture;
      composer.addPass(this.finalPass);
      composer.addPass(new OutputPass());
      this.composer = composer;
      this.postFailed = false;
    } catch (e) {
      console.warn('[render] post-processing unavailable; rendering directly', e);
      this.composer = null;
      this.postFailed = true;
    }
  }

  resize(): void {
    // A hidden/zero-size host window (e.g. an embedded preview) falls back to 720p.
    this.width = window.innerWidth > 0 ? window.innerWidth : 1280;
    this.height = window.innerHeight > 0 ? window.innerHeight : 720;
    const pr = Math.min(window.devicePixelRatio || 1, this.cfg.pixelRatioCap) * this.renderScale;
    this.renderer.setPixelRatio(pr);
    this.renderer.setSize(this.width, this.height, false);
    if (this.composer) {
      this.composer.setPixelRatio(pr);
      this.composer.setSize(this.width, this.height);
      if (this.bloom) this.bloom.resolution.set(this.width * this.cfg.bloomScale, this.height * this.cfg.bloomScale);
    }
    this.water.resize(this.width, this.height);
  }

  setRenderScale(s: number): void {
    const v = Math.max(0.55, Math.min(1, s));
    if (Math.abs(v - this.renderScale) < 0.01) return;
    this.renderScale = v;
    this.resize();
  }

  /**
   * Compiles every shader variant a real frame uses, in parallel where KHR_parallel_shader_compile
   * exists: the main pass renders into the post-processing target (no in-shader tone mapping) and
   * extra passes such as the planar reflection add a clip plane and a camera layer, and each of
   * those is part of the program key. compile() reads the renderer's current target and clipping
   * planes synchronously, so they are set only around that call.
   */
  async precompile(scene: THREE.Scene, camera: THREE.Camera, passes: PassState[] = []): Promise<void> {
    const r = this.renderer;
    const pending: Promise<unknown>[] = [];
    const compile = (target: THREE.WebGLRenderTarget | null, planes: THREE.Plane[], cam: THREE.Camera) => {
      const prevTarget = r.getRenderTarget(), prevPlanes = r.clippingPlanes;
      r.setRenderTarget(target);
      r.clippingPlanes = planes;
      try {
        pending.push(r.compileAsync(scene, cam));
      } finally {
        r.setRenderTarget(prevTarget);
        r.clippingPlanes = prevPlanes;
      }
    };
    compile(this.composer && !this.postFailed ? this.composer.readBuffer : null, [], camera);
    for (const p of passes) {
      const cam = camera.clone();
      cam.layers.set(p.layer);
      compile(p.target, p.planes, cam);
    }
    await Promise.all(pending);
  }

  render(scene: THREE.Scene, camera: THREE.Camera, dt: number, time: number, usePost = true): void {
    this.water.update(dt);
    this.flash = Math.max(0, this.flash - dt * 3);
    this.renderer.info.reset();
    if (usePost && this.composer && this.renderPass && this.finalPass) {
      this.renderPass.scene = scene;
      this.renderPass.camera = camera;
      const u = this.finalPass.uniforms;
      u.uTime!.value = time;
      u.uFlash!.value = this.flash;
      u.uSpeed!.value = this.speedBlur;
      u.uAspect!.value = this.width / this.height;
      u.uWaterStrength!.value = 1;
      if (this.waterOverlay) this.waterOverlay.visible = false;
      this.composer.render(dt);
    } else {
      // Fallback: direct render; screen water drawn as a camera-attached overlay.
      this.ensureOverlay(camera);
      this.renderer.render(scene, camera);
    }
  }

  private ensureOverlay(camera: THREE.Camera): void {
    if (!this.waterOverlay) {
      const mat = new THREE.MeshBasicMaterial({ map: this.water.texture, transparent: true, depthTest: false, depthWrite: false, opacity: 0.35, color: 0xbcd4ff });
      this.waterOverlay = new THREE.Mesh(new THREE.PlaneGeometry(2, 2), mat);
      this.waterOverlay.renderOrder = 9999;
      this.waterOverlay.frustumCulled = false;
    }
    if (this.waterOverlay.parent !== camera) camera.add(this.waterOverlay);
    const cam = camera as THREE.PerspectiveCamera;
    const d = 0.2;
    const hgt = 2 * Math.tan(THREE.MathUtils.degToRad(cam.fov / 2)) * d;
    this.waterOverlay.position.set(0, 0, -d);
    this.waterOverlay.scale.set((hgt * cam.aspect) / 2, hgt / 2, 1);
    this.waterOverlay.visible = true;
  }
}
