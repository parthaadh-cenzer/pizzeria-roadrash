// Wet road shader (HANDOFF/04_ART_DIRECTION.md "Wet road shader" + "Puddles").
// MeshPhysicalMaterial extended with: wet darkening, roughness reduction, animated ripple
// normals under rain, separate puddle masks with edge depth cue, procedural lane markings,
// and screen-space planar reflections stretched along the road direction (HIGH/MEDIUM).
import * as THREE from 'three';

export interface RoadUniforms {
  uTime: { value: number };
  uRain: { value: number };
  uRipple: { value: THREE.Texture | null };
  uReflect: { value: THREE.Texture | null };
  uReflectOn: { value: number };
  uReflectMatrix: { value: THREE.Matrix4 };
  uReflectStrength: { value: number };
  uResolution: { value: THREE.Vector2 };
  uMarkBright: { value: number };
  uAccent: { value: THREE.Color };
}

export function createRoadUniforms(): RoadUniforms {
  return {
    uTime: { value: 0 },
    uRain: { value: 0.5 },
    uRipple: { value: null },
    uReflect: { value: null },
    uReflectOn: { value: 0 },
    uReflectMatrix: { value: new THREE.Matrix4() },
    uReflectStrength: { value: 0.42 },
    uResolution: { value: new THREE.Vector2(1, 1) },
    uMarkBright: { value: 1 },
    uAccent: { value: new THREE.Color(0x18e0ff) },
  };
}

export function createWetRoadMaterial(u: RoadUniforms, maps: { base: THREE.Texture | null; orm: THREE.Texture | null; normal: THREE.Texture | null }, kind: 'road' | 'sidewalk' | 'ground'): THREE.MeshPhysicalMaterial {
  const mat = new THREE.MeshPhysicalMaterial({
    color: kind === 'road' ? 0x9aa0aa : kind === 'sidewalk' ? 0x7c808a : 0x5c606a,
    map: maps.base,
    roughnessMap: maps.orm,
    normalMap: maps.normal,
    normalScale: new THREE.Vector2(0.6, 0.6),
    roughness: 1,
    metalness: 0,
    clearcoat: kind === 'road' ? 0.35 : 0.15,
    clearcoatRoughness: 0.25,
    envMapIntensity: 0.9,
  });
  mat.name = `wet_${kind}`;
  mat.onBeforeCompile = (shader) => {
    Object.assign(shader.uniforms, u);
    shader.defines = { ...(shader.defines ?? {}), ROAD_KIND: kind === 'road' ? 1 : kind === 'sidewalk' ? 2 : 3 };
    shader.vertexShader = shader.vertexShader
      .replace(
        '#include <common>',
        `#include <common>
        attribute vec3 aTrack; // (s, lateral, halfWidth) in metres
        attribute float aWet;  // authored puddle mask 0..1
        varying vec3 vTrack;
        varying float vWet;
        varying vec3 vWorldPos;`,
      )
      .replace(
        '#include <worldpos_vertex>',
        `#include <worldpos_vertex>
        vTrack = aTrack;
        vWet = aWet;
        vWorldPos = (modelMatrix * vec4(transformed, 1.0)).xyz;`,
      );
    shader.fragmentShader = shader.fragmentShader
      .replace(
        '#include <common>',
        `#include <common>
        uniform float uTime, uRain, uReflectOn, uReflectStrength, uMarkBright;
        uniform sampler2D uRipple;
        uniform sampler2D uReflect;
        uniform mat4 uReflectMatrix;
        uniform vec2 uResolution;
        uniform vec3 uAccent;
        varying vec3 vTrack;
        varying float vWet;
        varying vec3 vWorldPos;
        float rHash(vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
        float rNoise(vec2 p) { vec2 i = floor(p), f = fract(p); vec2 w = f * f * (3.0 - 2.0 * f);
          return mix(mix(rHash(i), rHash(i + vec2(1, 0)), w.x), mix(rHash(i + vec2(0, 1)), rHash(i + vec2(1, 1)), w.x), w.y); }
        // Procedural markings: returns (paint amount, isStartLine).
        vec2 roadMarkings(vec3 t) {
          float s = t.x, lat = t.y, hw = t.z;
          float paint = 0.0;
          float edge = abs(abs(lat) - (hw - 0.3));
          paint = max(paint, 1.0 - smoothstep(0.08, 0.12, edge));
          float lanes = max(1.0, floor(hw * 2.0 / 3.9));
          float laneW = hw * 2.0 / lanes;
          float dash = step(fract(s / 9.0), 0.36);
          for (int k = 1; k < 5; k++) {
            if (float(k) >= lanes) break;
            float x = -hw + laneW * float(k);
            paint = max(paint, (1.0 - smoothstep(0.06, 0.1, abs(lat - x))) * dash);
          }
          // Start / finish chequer band (s in [0, 3.5]) wrapping at lap end.
          float start = 0.0;
          float ss = s < 1.0 ? s : s;
          if (ss >= 0.0 && ss < 3.5) {
            float c = mod(floor(lat / 0.7) + floor(ss / 0.7), 2.0);
            start = 1.0;
            paint = c;
          }
          return vec2(paint, start);
        }`,
      )
      .replace(
        '#include <map_fragment>',
        `#include <map_fragment>
        #if ROAD_KIND == 1
          vec2 mk = roadMarkings(vTrack);
          float wornPaint = mk.x * (0.75 + 0.25 * rNoise(vTrack.xy * vec2(0.5, 3.0)));
          diffuseColor.rgb = mix(diffuseColor.rgb, mix(vec3(0.85, 0.86, 0.9), vec3(1.0), mk.y) * uMarkBright, wornPaint);
          float shoulder = smoothstep(vTrack.z - 0.05, vTrack.z + 0.2, abs(vTrack.y));
          diffuseColor.rgb *= mix(1.0, 0.72, shoulder);
        #endif
        // Wet darkening; puddles darker still with an edge depth cue.
        float puddleN = rNoise(vWorldPos.xz * 0.35) * 0.35 + rNoise(vWorldPos.xz * 1.3) * 0.15;
        float puddle = smoothstep(0.35, 0.75, vWet + puddleN - 0.25);
        float wetness = clamp(0.55 + uRain * 0.45, 0.0, 1.0);
        diffuseColor.rgb *= mix(1.0, 0.55, wetness);
        float rim = smoothstep(0.15, 0.45, vWet + puddleN - 0.25) - puddle;
        diffuseColor.rgb *= mix(1.0, 0.45, puddle) * (1.0 - rim * 0.35);`,
      )
      .replace(
        '#include <roughnessmap_fragment>',
        `#include <roughnessmap_fragment>
        roughnessFactor = mix(roughnessFactor, roughnessFactor * 0.38 + 0.08, wetness);
        roughnessFactor = mix(roughnessFactor, 0.035, puddle);
        #if ROAD_KIND == 1
          roughnessFactor = mix(roughnessFactor, 0.3, wornPaint * 0.6);
        #endif`,
      )
      .replace(
        '#include <normal_fragment_maps>',
        `#include <normal_fragment_maps>
        // Animated rain ripples (two layers), strongest in puddles.
        vec2 ruv = vWorldPos.xz * 0.45;
        vec3 r1 = texture2D(uRipple, ruv + vec2(uTime * 0.013, uTime * 0.021)).xyz * 2.0 - 1.0;
        vec3 r2 = texture2D(uRipple, ruv * 1.7 - vec2(uTime * 0.019, -uTime * 0.011)).xyz * 2.0 - 1.0;
        vec2 rip = (r1.xy + r2.xy) * (0.18 + 0.55 * puddle) * uRain;
        normal = normalize(normal + vec3(rip.x, 0.0, rip.y) * 0.9);`,
      )
      .replace(
        '#include <emissivemap_fragment>',
        `#include <emissivemap_fragment>
        // Planar reflection sampled in screen space, distorted by ripples and stretched along
        // screen-vertical (the road direction ahead) instead of a perfect mirror.
        if (uReflectOn > 0.5) {
          vec4 rc = uReflectMatrix * vec4(vWorldPos, 1.0);
          vec2 suv = rc.xy / max(1e-4, rc.w);
          vec2 distort = rip * 0.04 + normal.xz * 0.012;
          vec3 refl = vec3(0.0);
          float wsum = 0.0;
          for (int k = 0; k < 6; k++) {
            float fk = float(k);
            float w = 1.0 - fk / 6.5;
            refl += texture2D(uReflect, suv + distort + vec2(0.0, fk * 0.009 * (0.4 + roughnessFactor * 3.0))).rgb * w;
            wsum += w;
          }
          refl /= wsum;
          vec3 V = normalize(cameraPosition - vWorldPos);
          float fres = 0.08 + 0.92 * pow(1.0 - max(dot(V, vec3(0.0, 1.0, 0.0)), 0.0), 5.0);
          float k = uReflectStrength * wetness * (1.0 - smoothstep(0.05, 0.6, roughnessFactor)) * mix(0.55, 1.0, fres);
          totalEmissiveRadiance += refl * k;
        }`,
      );
  };
  mat.customProgramCacheKey = () => `wetroad_${kind}`;
  return mat;
}
