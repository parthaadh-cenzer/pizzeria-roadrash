// Sky, environment reflections, layered lighting, fog and lightning.
// Layered lighting (art direction): low-cost hemisphere fill, limited moon key light, headlights,
// emissive sources, and a small pool of point lights reassigned to the nearest emitters.
import * as THREE from 'three';
import type { DistrictId } from '../../shared/ids.js';
import { damp } from '../../shared/math.js';
import { DISTRICT_LOOK, NEON } from '../materials/Palette.js';
import type { LightEmitter } from './TrackMeshes.js';

const SkyShader = {
  uniforms: {
    uTop: { value: new THREE.Color(0x05060e) },
    uHorizon: { value: new THREE.Color(0x2a1238) },
    uGlow: { value: new THREE.Color(0xff2bd6) },
    uTime: { value: 0 },
    uFlash: { value: 0 },
    uStorm: { value: 0.5 },
  },
  vertexShader: /* glsl */ `
    varying vec3 vDir;
    void main() { vDir = normalize(position); vec4 p = modelViewMatrix * vec4(position, 1.0); gl_Position = projectionMatrix * p; gl_Position.z = gl_Position.w; }
  `,
  fragmentShader: /* glsl */ `
    uniform vec3 uTop, uHorizon, uGlow; uniform float uTime, uFlash, uStorm;
    varying vec3 vDir;
    float h(vec2 p) { return fract(sin(dot(p, vec2(41.3, 289.1))) * 43758.5); }
    float n(vec2 p) { vec2 i = floor(p), f = fract(p); vec2 u = f * f * (3.0 - 2.0 * f);
      return mix(mix(h(i), h(i + vec2(1, 0)), u.x), mix(h(i + vec2(0, 1)), h(i + vec2(1, 1)), u.x), u.y); }
    float fbm(vec2 p) { float v = 0.0, a = 0.5; for (int i = 0; i < 5; i++) { v += a * n(p); p *= 2.03; a *= 0.5; } return v; }
    void main() {
      float y = clamp(vDir.y, -0.2, 1.0);
      vec3 col = mix(uHorizon, uTop, smoothstep(-0.02, 0.55, y));
      // City light pollution glow on the horizon.
      col += uGlow * 0.22 * exp(-max(y, 0.0) * 9.0);
      vec2 cp = vDir.xz / max(0.08, vDir.y + 0.15) * 0.35 + vec2(uTime * 0.004, uTime * 0.002);
      float c = fbm(cp * 2.0);
      float clouds = smoothstep(0.35, 0.85, c) * smoothstep(0.0, 0.25, y);
      col = mix(col, col * 1.6 + vec3(0.03, 0.03, 0.05), clouds * 0.6);
      col += vec3(0.55, 0.62, 0.85) * uFlash * (0.3 + clouds * 1.4) * smoothstep(-0.05, 0.3, y);
      gl_FragColor = vec4(col, 1.0);
    }
  `,
};

function makeEnvScene(panels = true): THREE.Scene {
  const s = new THREE.Scene();
  const sky = new THREE.Mesh(
    new THREE.SphereGeometry(50, 32, 16),
    new THREE.ShaderMaterial({
      side: THREE.BackSide,
      uniforms: { },
      vertexShader: 'varying vec3 d; void main(){ d = normalize(position); gl_Position = projectionMatrix * modelViewMatrix * vec4(position,1.0); }',
      fragmentShader: panels
        ? 'varying vec3 d; void main(){ float y = d.y; vec3 c = mix(vec3(0.10,0.05,0.14), vec3(0.015,0.02,0.05), smoothstep(-0.1,0.6,y)); c += vec3(0.45,0.12,0.4) * exp(-max(y,0.0)*6.0) * 0.5; if (y < -0.05) c = vec3(0.02,0.02,0.03); gl_FragColor = vec4(c,1.0); }'
        : // Road variant: neutral cloud glow (the real sky and neon arrive through the planar pass).
          'varying vec3 d; void main(){ float y = d.y; vec3 c = mix(vec3(0.06,0.055,0.075), vec3(0.015,0.02,0.04), smoothstep(-0.1,0.6,y)); c += vec3(0.12,0.1,0.13) * exp(-max(y,0.0)*6.0) * 0.5; if (y < -0.05) c = vec3(0.02,0.02,0.03); gl_FragColor = vec4(c,1.0); }',
    }),
  );
  s.add(sky);
  // Neon panels around the horizon give coloured reflections on paint and bodywork.
  const colors = [NEON.cyan, NEON.magenta, NEON.orange, NEON.violet, NEON.red, NEON.cyan, NEON.amber, NEON.magenta];
  for (let i = 0; panels && i < 24; i++) {
    const a = (i / 24) * Math.PI * 2 + (i % 3) * 0.1;
    const w = 3 + (i % 4) * 2.5, hgt = 1 + (i % 5) * 1.2;
    const m = new THREE.Mesh(new THREE.PlaneGeometry(w, hgt), new THREE.MeshBasicMaterial({ color: colors[i % colors.length]!.clone().multiplyScalar(2.2 + (i % 3)), side: THREE.DoubleSide }));
    m.position.set(Math.cos(a) * 40, 2 + (i % 6) * 2.4, Math.sin(a) * 40);
    m.lookAt(0, m.position.y, 0);
    s.add(m);
  }
  const top = new THREE.Mesh(new THREE.PlaneGeometry(60, 60), new THREE.MeshBasicMaterial({ color: new THREE.Color(0x3a4060).multiplyScalar(0.5) }));
  top.rotation.x = Math.PI / 2;
  top.position.y = 30;
  s.add(top);
  return s;
}

export class Environment {
  readonly sky: THREE.Mesh;
  readonly hemi: THREE.HemisphereLight;
  readonly moon: THREE.DirectionalLight;
  readonly fog: THREE.FogExp2;
  readonly envMap: THREE.Texture;
  /**
   * Environment for the wet road, sidewalks and puddles: the same night sky without the invented
   * neon panels, so the road only shows coloured reflections of lights that exist in the scene
   * (via the planar pass) instead of pools with no visible source.
   */
  readonly roadEnvMap: THREE.Texture;
  readonly headlight: THREE.SpotLight;
  private pool: THREE.PointLight[] = [];
  private emitters: LightEmitter[] = [];
  private dynamic: LightEmitter[] = [];
  private skyMat: THREE.ShaderMaterial;
  private flash = 0;
  private nextFlash = 6;
  private storm = 0;
  exposure = 1.05;
  private fogColor = new THREE.Color();
  private fogDensity = 0.004;
  private initialized = false;
  onThunder: ((intensity: number) => void) | null = null;
  onFlash: ((intensity: number) => void) | null = null;

  constructor(renderer: THREE.WebGLRenderer, scene: THREE.Scene, poolSize: number, shadows: boolean, shadowSize: number) {
    this.skyMat = new THREE.ShaderMaterial({ ...SkyShader, uniforms: THREE.UniformsUtils.clone(SkyShader.uniforms), side: THREE.BackSide, depthWrite: false, fog: false });
    this.sky = new THREE.Mesh(new THREE.SphereGeometry(4000, 48, 24), this.skyMat);
    this.sky.frustumCulled = false;
    this.sky.renderOrder = -10;
    scene.add(this.sky);

    const pm = new THREE.PMREMGenerator(renderer);
    this.envMap = pm.fromScene(makeEnvScene(), 0.02).texture;
    this.roadEnvMap = pm.fromScene(makeEnvScene(false), 0.02).texture;
    pm.dispose();
    scene.environment = this.envMap;
    scene.environmentIntensity = 0.55;

    this.hemi = new THREE.HemisphereLight(0x3a3a78, 0x201018, 0.9);
    scene.add(this.hemi);
    this.moon = new THREE.DirectionalLight(0x9fb4ff, 0.55);
    this.moon.position.set(-60, 120, 40);
    this.moon.castShadow = shadows;
    if (shadows) {
      this.moon.shadow.mapSize.set(shadowSize, shadowSize);
      const c = this.moon.shadow.camera;
      c.left = -28;
      c.right = 28;
      c.top = 28;
      c.bottom = -28;
      c.near = 10;
      c.far = 260;
      this.moon.shadow.bias = -0.0006;
      this.moon.shadow.normalBias = 0.03;
    }
    scene.add(this.moon, this.moon.target);

    this.headlight = new THREE.SpotLight(0xf2f5ff, 90, 70, THREE.MathUtils.degToRad(28), 0.55, 1.6);
    scene.add(this.headlight, this.headlight.target);

    for (let i = 0; i < poolSize; i++) {
      const l = new THREE.PointLight(0xffffff, 0, 30, 1.8);
      this.pool.push(l);
      scene.add(l);
    }
    this.fog = new THREE.FogExp2(0x151028, 0.004);
    scene.fog = this.fog;
  }

  setEmitters(e: LightEmitter[]): void {
    this.emitters = e;
  }

  /** Short-lived emitters (hit flashes, boost flames, headlights of other bikes). */
  setDynamic(e: LightEmitter[]): void {
    this.dynamic = e;
  }

  update(dt: number, time: number, camera: THREE.Camera, focus: THREE.Vector3, district: DistrictId, weather: number, rainFactor: number, fogScale: number): void {
    const look = DISTRICT_LOOK[district];
    // First frame snaps to the district look; afterwards districts blend smoothly.
    const k = this.initialized ? 1 - Math.exp(-dt / 1.6) : 1;
    this.fogColor.lerp(look.fog, k);
    const wantDensity = look.fogDensity * (0.8 + weather * 0.28) * fogScale * (rainFactor < 0.5 ? 0.6 : 1);
    this.fogDensity = this.initialized ? damp(this.fogDensity, wantDensity, 1.6, dt) : wantDensity;
    if (!this.initialized) this.exposure = look.exposure;
    this.initialized = true;
    this.fog.color.copy(this.fogColor);
    this.fog.density = this.fogDensity;
    this.hemi.color.lerp(look.hemiSky, k);
    this.hemi.groundColor.lerp(look.hemiGround, k);
    this.exposure = damp(this.exposure, look.exposure, 2.5, dt);
    const u = this.skyMat.uniforms;
    (u.uHorizon!.value as THREE.Color).lerp(look.fog.clone().multiplyScalar(1.6), k);
    (u.uGlow!.value as THREE.Color).lerp(look.accent, k);
    u.uTime!.value = time;
    this.sky.position.copy(camera.position);

    // Lightning in storm-heavy sections (never during the tunnel).
    this.storm = damp(this.storm, district === 'STORM' || district === 'BROKEN_BRIDGE' || weather > 2.4 ? 1 : 0, 3, dt);
    this.nextFlash -= dt * (0.4 + this.storm);
    if (this.storm > 0.3 && rainFactor > 0.5 && this.nextFlash <= 0) {
      this.flash = 1;
      this.nextFlash = 5 + Math.random() * 9;
      this.onFlash?.(0.12 + Math.random() * 0.1);
      const delay = 0.5 + Math.random() * 2.2;
      setTimeout(() => this.onThunder?.(0.6 + Math.random() * 0.4), delay * 1000);
    }
    this.flash = Math.max(0, this.flash - dt * (this.flash > 0.5 ? 6 : 2.5));
    const flicker = this.flash > 0 ? this.flash * (0.6 + 0.4 * Math.sin(time * 60)) : 0;
    u.uFlash!.value = flicker;
    this.moon.intensity = 0.55 + flicker * 3.5;

    // Shadow camera follows the focus (player bike).
    this.moon.position.set(focus.x - 60, focus.y + 120, focus.z + 40);
    this.moon.target.position.copy(focus);

    // Light pool: nearest emitters to the camera focus.
    const all = this.dynamic.length ? this.emitters.concat(this.dynamic) : this.emitters;
    const scored: { e: LightEmitter; d: number }[] = [];
    for (const e of all) {
      const d = e.pos.distanceToSquared(focus);
      if (d < 140 * 140) scored.push({ e, d: d / Math.max(0.2, e.intensity / 40) });
    }
    scored.sort((a, b) => a.d - b.d);
    for (let i = 0; i < this.pool.length; i++) {
      const l = this.pool[i]!;
      const s = scored[i];
      // Lights stay visible (a changing light count would recompile every shader).
      if (!s) {
        l.intensity = 0;
        continue;
      }
      l.position.copy(s.e.pos);
      l.color.copy(s.e.color);
      l.distance = s.e.range;
      const fade = 1 - Math.min(1, Math.sqrt(s.e.pos.distanceToSquared(focus)) / 140);
      l.intensity = s.e.intensity * fade;
    }
  }
}
