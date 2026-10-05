// Pooled point particles: tyre spray/mist, puddle splashes, sparks, countdown smoke, flames, steam.
import * as THREE from 'three';

export interface ParticleSpec {
  x: number;
  y: number;
  z: number;
  vx: number;
  vy: number;
  vz: number;
  life: number;
  size: number;
  sizeEnd: number;
  r: number;
  g: number;
  b: number;
  a: number;
  gravity: number;
  drag: number;
}

export class ParticlePool {
  readonly points: THREE.Points;
  private max: number;
  private pos: Float32Array;
  private col: Float32Array;
  private size: Float32Array;
  private vel: Float32Array;
  private life: Float32Array;
  private maxLife: Float32Array;
  private sz: Float32Array;
  private alpha: Float32Array;
  private phys: Float32Array;
  private next = 0;
  private active = 0;

  constructor(max: number, opts: { additive: boolean; soft: number; name: string; scale?: number }) {
    this.max = max;
    this.pos = new Float32Array(max * 3);
    this.col = new Float32Array(max * 4);
    this.size = new Float32Array(max);
    this.vel = new Float32Array(max * 3);
    this.life = new Float32Array(max);
    this.maxLife = new Float32Array(max);
    this.sz = new Float32Array(max * 2);
    this.alpha = new Float32Array(max);
    this.phys = new Float32Array(max * 2);
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(this.pos, 3).setUsage(THREE.DynamicDrawUsage));
    geo.setAttribute('color', new THREE.BufferAttribute(this.col, 4).setUsage(THREE.DynamicDrawUsage));
    geo.setAttribute('size', new THREE.BufferAttribute(this.size, 1).setUsage(THREE.DynamicDrawUsage));
    geo.boundingSphere = new THREE.Sphere(new THREE.Vector3(), 1e6);
    const mat = new THREE.ShaderMaterial({
      uniforms: { ...THREE.UniformsUtils.clone(THREE.UniformsLib.fog), uScale: { value: opts.scale ?? 600 }, uSoft: { value: opts.soft } },
      vertexShader: /* glsl */ `
        attribute float size; attribute vec4 color; varying vec4 vColor; uniform float uScale;
        #include <fog_pars_vertex>
        void main() { vColor = color; vec4 mvPosition = modelViewMatrix * vec4(position, 1.0);
          gl_PointSize = size * uScale / max(0.1, -mvPosition.z); gl_Position = projectionMatrix * mvPosition;
          #include <fog_vertex>
        }`,
      fragmentShader: /* glsl */ `
        varying vec4 vColor; uniform float uSoft;
        #include <fog_pars_fragment>
        void main() { vec2 d = gl_PointCoord - 0.5; float r = length(d) * 2.0; float a = (1.0 - smoothstep(1.0 - uSoft, 1.0, r)) * vColor.a;
          if (a < 0.004) discard; gl_FragColor = vec4(vColor.rgb * ${opts.additive ? 'a' : '1.0'}, a);
          #include <fog_fragment>
        }`,
      transparent: true,
      depthWrite: false,
      blending: opts.additive ? THREE.AdditiveBlending : THREE.NormalBlending,
      fog: true,
    });
    this.points = new THREE.Points(geo, mat);
    this.points.frustumCulled = false;
    this.points.name = opts.name;
    this.points.renderOrder = 15;
  }

  emit(p: ParticleSpec): void {
    const i = this.next;
    this.next = (this.next + 1) % this.max;
    this.pos[i * 3] = p.x;
    this.pos[i * 3 + 1] = p.y;
    this.pos[i * 3 + 2] = p.z;
    this.vel[i * 3] = p.vx;
    this.vel[i * 3 + 1] = p.vy;
    this.vel[i * 3 + 2] = p.vz;
    this.life[i] = p.life;
    this.maxLife[i] = p.life;
    this.sz[i * 2] = p.size;
    this.sz[i * 2 + 1] = p.sizeEnd;
    this.col[i * 4] = p.r;
    this.col[i * 4 + 1] = p.g;
    this.col[i * 4 + 2] = p.b;
    this.alpha[i] = p.a;
    this.phys[i * 2] = p.gravity;
    this.phys[i * 2 + 1] = p.drag;
    this.active = Math.min(this.max, this.active + 1);
  }

  update(dt: number): void {
    for (let i = 0; i < this.max; i++) {
      if (this.life[i]! <= 0) {
        this.col[i * 4 + 3] = 0;
        this.size[i] = 0;
        continue;
      }
      this.life[i]! -= dt;
      const t = 1 - Math.max(0, this.life[i]!) / this.maxLife[i]!;
      const drag = Math.exp(-this.phys[i * 2 + 1]! * dt);
      this.vel[i * 3]! *= drag;
      this.vel[i * 3 + 1] = this.vel[i * 3 + 1]! * drag - this.phys[i * 2]! * dt;
      this.vel[i * 3 + 2]! *= drag;
      this.pos[i * 3]! += this.vel[i * 3]! * dt;
      this.pos[i * 3 + 1]! += this.vel[i * 3 + 1]! * dt;
      this.pos[i * 3 + 2]! += this.vel[i * 3 + 2]! * dt;
      this.size[i] = this.sz[i * 2]! + (this.sz[i * 2 + 1]! - this.sz[i * 2]!) * t;
      this.col[i * 4 + 3] = this.alpha[i]! * (1 - t) * Math.min(1, t * 8 + 0.2);
    }
    const g = this.points.geometry;
    g.attributes.position!.needsUpdate = true;
    g.attributes.color!.needsUpdate = true;
    g.attributes.size!.needsUpdate = true;
  }
}

export class Particles {
  readonly group = new THREE.Group();
  readonly spray: ParticlePool;
  readonly sparks: ParticlePool;
  readonly smoke: ParticlePool;
  readonly flame: ParticlePool;

  constructor(budget: number) {
    this.spray = new ParticlePool(Math.floor(budget * 0.55), { additive: false, soft: 0.9, name: 'spray' });
    this.sparks = new ParticlePool(Math.floor(budget * 0.15), { additive: true, soft: 0.5, name: 'sparks', scale: 400 });
    this.smoke = new ParticlePool(Math.floor(budget * 0.2), { additive: false, soft: 1.0, name: 'smoke', scale: 700 });
    this.flame = new ParticlePool(Math.floor(budget * 0.1), { additive: true, soft: 0.8, name: 'flame' });
    this.group.add(this.spray.points, this.smoke.points, this.flame.points, this.sparks.points);
  }

  update(dt: number): void {
    this.spray.update(dt);
    this.sparks.update(dt);
    this.smoke.update(dt);
    this.flame.update(dt);
  }

  burstSparks(x: number, y: number, z: number, n: number, dirX = 0, dirZ = 0): void {
    for (let i = 0; i < n; i++) {
      this.sparks.emit({
        x, y, z,
        vx: dirX * 6 + (Math.random() - 0.5) * 9, vy: 1 + Math.random() * 5, vz: dirZ * 6 + (Math.random() - 0.5) * 9,
        life: 0.25 + Math.random() * 0.35, size: 0.12, sizeEnd: 0.02,
        r: 2.6, g: 1.6 + Math.random() * 0.6, b: 0.5, a: 1, gravity: 12, drag: 1.2,
      });
    }
  }

  /**
   * Puddle crossing: a sharp rooster-tail jet thrown up behind the wheel plus an outward crown to
   * both sides, both scaled by speed (vx, vz is the bike velocity) and puddle size (strength).
   */
  splash(x: number, y: number, z: number, vx: number, vz: number, strength: number): void {
    const v = Math.hypot(vx, vz);
    const fx = v > 0.1 ? vx / v : 0, fz = v > 0.1 ? vz / v : 1;
    const lx = -fz, lz = fx;
    const k = strength * (0.5 + Math.min(1.2, v / 40));
    const nJet = Math.floor(22 * k), nCrown = Math.floor(20 * k);
    for (let i = 0; i < nJet; i++) {
      const up = 5 + Math.random() * 6 * k, back = 2 + Math.random() * 4, side = (Math.random() - 0.5) * 2.2;
      this.spray.emit({
        x: x - fx * 0.6 + (Math.random() - 0.5) * 0.4, y: y + 0.15, z: z - fz * 0.6 + (Math.random() - 0.5) * 0.4,
        vx: vx * 0.25 - fx * back + lx * side, vy: up, vz: vz * 0.25 - fz * back + lz * side,
        life: 0.28 + Math.random() * 0.3, size: 0.08, sizeEnd: 0.42,
        r: 0.78, g: 0.85, b: 0.95, a: 0.42, gravity: 9, drag: 1.1,
      });
    }
    for (let i = 0; i < nCrown; i++) {
      const s = i % 2 === 0 ? 1 : -1, out = 4 + Math.random() * 6 * k;
      this.spray.emit({
        x: x + lx * s * 0.5 + (Math.random() - 0.5) * 1.0, y: y + 0.08, z: z + lz * s * 0.5 + (Math.random() - 0.5) * 1.0,
        vx: vx * 0.35 + lx * s * out, vy: 1.5 + Math.random() * 3.5 * k, vz: vz * 0.35 + lz * s * out,
        life: 0.35 + Math.random() * 0.4, size: 0.12, sizeEnd: 0.7,
        r: 0.7, g: 0.78, b: 0.9, a: 0.32, gravity: 8, drag: 1.6,
      });
    }
  }
}
