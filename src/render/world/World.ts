// Race world composition: track visuals, dressing, tunnel, bridge, environment, weather VFX.
import * as THREE from 'three';
import type { Track } from '../../game/track/Track.js';
import type { DistrictId } from '../../shared/ids.js';
import type { AssetStore } from '../AssetStore.js';
import { createRoadUniforms, createWetRoadMaterial, type RoadUniforms } from '../materials/WetRoadMaterial.js';
import { Materials } from '../materials/Palette.js';
import type { RenderCore } from '../RenderCore.js';
import { Particles } from '../vfx/Particles.js';
import { Rain } from '../vfx/Rain.js';
import { buildDressing } from './Dressing.js';
import { Environment } from './Environment.js';
import { PlanarReflection, REFLECT_LAYER, tagReflective, type PassState } from './PlanarReflection.js';
import { buildPuddleMeshes } from './Puddles.js';
import { buildBridge, buildTunnel, updateBeacons } from './Structures.js';
import { buildTrackVisuals, type LightEmitter } from './TrackMeshes.js';

export interface WeatherSample {
  s: number;
  district: DistrictId;
  intensity: number; // 0..3
  rainFactor: number; // 1 outdoors, ~0 tunnel
}

export class World {
  readonly scene = new THREE.Scene();
  readonly mats = new Materials();
  readonly roadU: RoadUniforms = createRoadUniforms();
  env!: Environment;
  rain!: Rain;
  particles!: Particles;
  reflection: PlanarReflection | null = null;
  /** Skips the reflection pass (while a view waits for its shaders to finish compiling). */
  reflectionPaused = false;
  private animated: THREE.ShaderMaterial[] = [];
  private beacons: THREE.Mesh[] = [];
  private emitters: LightEmitter[] = [];
  private roadMeshes: THREE.Mesh[] = [];
  weather: WeatherSample = { s: 0, district: 'NEON_CORE', intensity: 1, rainFactor: 1 };
  private camS: number | null = null;
  readonly track: Track;
  private core: RenderCore;

  constructor(track: Track, core: RenderCore) {
    this.track = track;
    this.core = core;
    this.scene.name = 'race_world';
  }

  async build(assets: AssetStore, onStep: (label: string) => void): Promise<void> {
    const cfg = this.core.cfg;
    onStep('Environment');
    this.env = new Environment(this.core.renderer, this.scene, cfg.lightPool, cfg.shadows, cfg.shadowMapSize);
    this.env.onFlash = (k) => (this.core.flash = Math.max(this.core.flash, k));

    onStep('Wet road materials');
    const road = assets.entry('texture.wetRoad');
    const [base, orm, normal] = await Promise.all([
      assets.entryTexture('texture.wetRoad', 'baseColor', { srgb: true, repeat: true, mirrorV: true }),
      assets.entryTexture('texture.wetRoad', 'orm', { repeat: true, mirrorV: true }),
      assets.entryTexture('texture.wetRoad', 'normal', { repeat: true, mirrorV: true }),
    ]);
    if (!road) console.warn('[world] wet road textures missing; using flat material');
    const ripple = await assets.entryTexture('texture.rain', 'ripple', { repeat: true });
    this.roadU.uRipple.value = ripple ?? new THREE.DataTexture(new Uint8Array([128, 128, 255, 255]), 1, 1);
    this.roadU.uRipple.value.needsUpdate = true;
    const roadMat = createWetRoadMaterial(this.roadU, { base, orm, normal }, 'road');
    const sideMat = createWetRoadMaterial(this.roadU, { base, orm, normal }, 'sidewalk');
    const groundMat = createWetRoadMaterial(this.roadU, { base, orm, normal }, 'ground');
    for (const m of [roadMat, sideMat, groundMat]) m.envMap = this.env.roadEnvMap;

    onStep('Track');
    const tv = buildTrackVisuals(this.track, this.mats, { road: roadMat, sidewalk: sideMat, ground: groundMat }, { shadows: cfg.shadows });
    this.scene.add(tv.group);
    // Water under the viaducts mirrors the same panel-free environment as the road.
    const water = tv.group.getObjectByName('water') as THREE.Mesh | undefined;
    if (water) (water.material as THREE.MeshStandardMaterial).envMap = this.env.roadEnvMap;
    this.roadMeshes = tv.roadMeshes;
    this.emitters.push(...tv.emitters);
    // Readable puddles over the authored gameplay puddles (hidden from the reflection pass).
    const puddles = buildPuddleMeshes(this.track, this.roadU);
    if (puddles) {
      (puddles.material as THREE.MeshPhysicalMaterial).envMap = this.env.roadEnvMap;
      this.scene.add(puddles);
      this.roadMeshes = [...this.roadMeshes, puddles];
    }

    onStep('Tunnel');
    const tunnel = await buildTunnel(this.track, assets, this.mats);
    this.scene.add(tunnel.group);
    this.emitters.push(...tunnel.emitters);

    onStep('Broken bridge');
    const bridge = await buildBridge(this.track, assets, this.mats);
    this.scene.add(bridge.group);
    this.emitters.push(...bridge.emitters);
    this.beacons = bridge.beacons;

    onStep('City dressing');
    const dress = await buildDressing(this.track, assets, this.mats, { lowLod: cfg.lowLod, density: this.core.preset === 'MOBILE' ? 0.55 : this.core.preset === 'MEDIUM' ? 0.8 : 1 });
    this.scene.add(dress.group);
    this.emitters.push(...dress.emitters);
    this.animated.push(...dress.animated);

    this.env.setEmitters(this.emitters);
    this.rain = new Rain(cfg.rainParticles);
    this.scene.add(this.rain.group);
    this.particles = new Particles(this.core.preset === 'MOBILE' ? 1800 : 5000);
    this.scene.add(this.particles.group);

    tagReflective(this.scene);
    this.env.sky.layers.enable(REFLECT_LAYER);
    if (cfg.reflections === 'planar') {
      this.reflection = new PlanarReflection(this.core, cfg.reflectionScale, this.roadMeshes, [this.rain.group, this.particles.group]);
      this.reflection.interval = this.core.preset === 'HIGH' ? 1 : 2;
      this.roadU.uReflect.value = this.reflection.texture;
      this.roadU.uReflectOn.value = 1;
    }
  }

  /** Extra render passes whose shader variants must be precompiled (planar reflection). */
  passes(): PassState[] {
    return this.reflection ? [this.reflection.passState()] : [];
  }

  /** Compiles the world's shader variants in parallel (non-blocking where supported). */
  precompile(camera: THREE.PerspectiveCamera): Promise<void> {
    return this.core.precompile(this.scene, camera, this.passes());
  }

  /**
   * Compiles every shader variant the real passes use for the world plus `extra` objects, then
   * renders one frame so their textures are uploaded too (shader compiles and uploads are slow on
   * some drivers and must never happen mid-race).
   */
  async warmup(camera: THREE.PerspectiveCamera, extra: THREE.Object3D[] = []): Promise<void> {
    const holder = new THREE.Group();
    for (const o of extra) holder.add(o);
    this.scene.add(holder);
    try {
      await this.precompile(camera);
      this.core.render(this.scene, camera, 0.016, 0);
      if (this.reflection) {
        const f = this.track.frameAt(0);
        this.reflection.frame = 0;
        this.reflection.render(this.scene, camera, f.py);
      }
    } finally {
      this.scene.remove(holder);
      for (const o of extra) holder.remove(o);
    }
  }

  /** Samples weather/district at the camera's track position (continuity-hinted). */
  sampleAt(pos: THREE.Vector3): WeatherSample {
    const pr = this.track.project(pos.x, pos.y, pos.z, this.camS, 60, 120);
    this.camS = pr.s;
    const s = pr.s;
    this.weather = { s, district: this.track.districtAt(s), intensity: this.track.weatherAt(s), rainFactor: this.track.rainFactorAt(s) };
    return this.weather;
  }

  resetCameraHint(s: number | null): void {
    this.camS = s;
  }

  update(dt: number, time: number, camera: THREE.PerspectiveCamera, focus: THREE.Vector3, camVel: THREE.Vector3): void {
    const w = this.sampleAt(camera.position);
    this.env.update(dt, time, camera, focus, w.district, w.intensity, w.rainFactor, this.core.cfg.fogDensityScale);
    this.core.renderer.toneMappingExposure = this.env.exposure;
    this.rain.update(time, camera, w.intensity, w.rainFactor, camVel);
    this.particles.update(dt);
    this.roadU.uTime.value = time;
    this.roadU.uRain.value = Math.min(1, (w.intensity / 3) * 0.8 + 0.25) * (0.35 + 0.65 * w.rainFactor);
    this.roadU.uResolution.value.set(this.core.width * this.core.renderer.getPixelRatio(), this.core.height * this.core.renderer.getPixelRatio());
    for (const m of this.animated) m.uniforms.uTime!.value = time;
    updateBeacons(this.beacons, time);
    if (this.reflection && !this.reflectionPaused) {
      const surfaceY = this.track.frameAt(w.s).py + this.track.surfaceOffsetAt(w.s);
      this.reflection.render(this.scene, camera, surfaceY);
      this.roadU.uReflectMatrix.value.copy(this.reflection.matrix);
      this.roadU.uResolution.value.set(this.core.width * this.core.renderer.getPixelRatio(), this.core.height * this.core.renderer.getPixelRatio());
    }
  }
}
