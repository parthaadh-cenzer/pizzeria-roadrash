// Readable puddles (HANDOFF/04_ART_DIRECTION.md "Puddles"): one decal mesh per authored gameplay
// puddle (track.puddles, so what you see is what splashes), laid on the road surface. Organic,
// per-puddle outlines; mirror-like water with animated rain ripples; the planar reflection of
// nearby lights (the same pass the wet road samples), falling back to the environment map.
import * as THREE from 'three';
import type { Track } from '../../game/track/Track.js';
import type { RoadUniforms } from '../materials/WetRoadMaterial.js';

/** Decal margin beyond the gameplay rectangle (m): the organic edge wanders across it. */
const MARGIN = 1.1;
const STEP = 0.75;
const COLS = 10;

export function buildPuddleMeshes(track: Track, u: RoadUniforms): THREE.Mesh | null {
  const pos: number[] = [], nrm: number[] = [], pud: number[] = [], idx: number[] = [];
  track.puddles.forEach((p, i) => {
    const len = p.s1 - p.s0;
    const sa = p.s0 - MARGIN, sb = p.s1 + MARGIN;
    const la = p.lateral - p.halfWidth - MARGIN, lb = p.lateral + p.halfWidth + MARGIN;
    const base = pos.length / 3;
    let rows = 0;
    for (let s = sa; ; s += STEP) {
      const ss = Math.min(s, sb);
      const f = track.frameAt(ss);
      for (let c = 0; c <= COLS; c++) {
        const lat = la + ((lb - la) * c) / COLS;
        const q = track.pointAt(ss, lat, 0.018);
        pos.push(q.x, q.y, q.z);
        nrm.push(f.ux, f.uy, f.uz);
        // (across, along) normalised to the gameplay rectangle, puddle seed, elongation.
        pud.push((lat - p.lateral) / p.halfWidth, (ss - (p.s0 + p.s1) / 2) / (len / 2), i * 1.618 + 0.37, len / (2 * p.halfWidth));
      }
      rows++;
      if (ss >= sb) break;
    }
    for (let r = 0; r < rows - 1; r++) {
      for (let c = 0; c < COLS; c++) {
        const a = base + r * (COLS + 1) + c, b = a + 1, cc = a + COLS + 1, d = cc + 1;
        idx.push(a, b, cc, b, d, cc);
      }
    }
  });
  if (!pos.length) return null;
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('normal', new THREE.Float32BufferAttribute(nrm, 3));
  g.setAttribute('aPud', new THREE.Float32BufferAttribute(pud, 4));
  g.setIndex(idx);
  g.computeBoundingSphere();
  const mesh = new THREE.Mesh(g, createPuddleMaterial(u));
  mesh.name = 'puddles';
  mesh.renderOrder = 1;
  mesh.receiveShadow = true;
  return mesh;
}

function createPuddleMaterial(u: RoadUniforms): THREE.MeshPhysicalMaterial {
  const mat = new THREE.MeshPhysicalMaterial({
    color: 0x07090d,
    roughness: 0.03,
    metalness: 0,
    clearcoat: 1,
    clearcoatRoughness: 0.03,
    envMapIntensity: 1.25,
    transparent: true,
    depthWrite: false,
    polygonOffset: true,
    polygonOffsetFactor: -2,
    polygonOffsetUnits: -4,
  });
  mat.name = 'puddle_water';
  mat.onBeforeCompile = (shader) => {
    Object.assign(shader.uniforms, u);
    shader.vertexShader = shader.vertexShader
      .replace('#include <common>', `#include <common>
        attribute vec4 aPud;
        varying vec4 vPud;
        varying vec3 vPWorld;`)
      .replace('#include <worldpos_vertex>', `#include <worldpos_vertex>
        vPud = aPud;
        vPWorld = (modelMatrix * vec4(transformed, 1.0)).xyz;`);
    shader.fragmentShader = shader.fragmentShader
      .replace('#include <common>', `#include <common>
        uniform float uTime, uRain, uReflectOn;
        uniform sampler2D uRipple;
        uniform sampler2D uReflect;
        uniform mat4 uReflectMatrix;
        varying vec4 vPud;
        varying vec3 vPWorld;
        float pHash(vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
        float pNoise(vec2 p) { vec2 i = floor(p), f = fract(p); vec2 w = f * f * (3.0 - 2.0 * f);
          return mix(mix(pHash(i), pHash(i + vec2(1, 0)), w.x), mix(pHash(i + vec2(0, 1)), pHash(i + vec2(1, 1)), w.x), w.y); }
        // Organic outline: two superellipse lobes (per-puddle seed) plus world-space edge noise.
        float puddleShape(vec4 q, vec3 wp) {
          float seed = q.z;
          float p = 2.2 + 1.6 * fract(seed * 3.1);
          vec2 a = abs(q.xy);
          float d1 = pow(pow(a.x, p) + pow(a.y, p), 1.0 / p);
          vec2 c2 = vec2(0.45 * sin(seed * 5.7), 0.5 * cos(seed * 3.3));
          vec2 b = abs((q.xy - c2) / vec2(0.62 + 0.2 * fract(seed * 7.3), 0.55 + 0.25 * fract(seed * 1.9)));
          float d2 = length(b);
          float d = min(d1, d2 * 0.95);
          float n = pNoise(wp.xz * 0.9 + seed) * 0.26 + pNoise(wp.xz * 2.7 - seed) * 0.1;
          return d + n - 0.18;
        }`)
      .replace('#include <map_fragment>', `#include <map_fragment>
        float pd = puddleShape(vPud, vPWorld);
        float body = 1.0 - smoothstep(0.86, 0.98, pd);
        // Thin darker film at the waterline so the edge reads against the wet asphalt.
        float rimBand = smoothstep(0.8, 0.9, pd) * body;
        diffuseColor.rgb *= 1.0 - rimBand * 0.4;
        diffuseColor.a = body * 0.94;
        if (diffuseColor.a < 0.01) discard;`)
      .replace('#include <normal_fragment_maps>', `#include <normal_fragment_maps>
        // Rain rings on standing water: two scrolling ripple layers, strong under heavy rain.
        vec2 ruv = vPWorld.xz * 0.55;
        vec3 q1 = texture2D(uRipple, ruv + vec2(uTime * 0.017, uTime * 0.023)).xyz * 2.0 - 1.0;
        vec3 q2 = texture2D(uRipple, ruv * 1.9 - vec2(uTime * 0.021, -uTime * 0.013)).xyz * 2.0 - 1.0;
        vec2 prip = (q1.xy + q2.xy) * (0.25 + 0.75 * uRain);
        normal = normalize(normal + vec3(prip.x, 0.0, prip.y) * 0.8);`)
      .replace('#include <emissivemap_fragment>', `#include <emissivemap_fragment>
        // Nearby lights and neon mirrored in the water (planar pass), broken up by the ripples.
        vec3 pV = normalize(cameraPosition - vPWorld);
        float pFres = 0.1 + 0.9 * pow(1.0 - max(dot(pV, vec3(0.0, 1.0, 0.0)), 0.0), 4.0);
        // Standing water reads lighter than the asphalt at riding angles (it mirrors the cloud
        // glow), with a faint bright meniscus at the waterline.
        totalEmissiveRadiance += vec3(0.05, 0.058, 0.08) * pFres * body + vec3(0.07, 0.075, 0.09) * rimBand;
        // Nearby lights and neon mirrored in the water (planar pass): sharper and stronger than the
        // streaky wet-asphalt reflection around it, broken up by the ripples.
        if (uReflectOn > 0.5) {
          vec4 rc = uReflectMatrix * vec4(vPWorld, 1.0);
          vec2 suv = rc.xy / max(1e-4, rc.w) + prip * 0.025;
          vec3 refl = texture2D(uReflect, suv).rgb;
          totalEmissiveRadiance += refl * (0.75 + 0.5 * pFres) * body;
        }`);
  };
  mat.customProgramCacheKey = () => 'puddle_water';
  return mat;
}
