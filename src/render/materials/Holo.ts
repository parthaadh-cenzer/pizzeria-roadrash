// Holograms and neon signage from internally generated canvas graphics (no ad services).
// Shader: scanline modulation, subtle RGB split at edges, occasional glitch slices,
// opacity noise and low-frequency flicker (art direction "Holograms / fictional ads").
import * as THREE from 'three';
import { AD_SLOGANS, FICTIONAL_BRANDS, FICTIONAL_GLYPHS } from '../../config/brands.js';
import { mulberry32 } from '../../shared/math.js';

const NEON_HEX = ['#18e0ff', '#ff2bd6', '#8a3dff', '#ff2a3a', '#ff7a1a', '#ffc21a', '#3dff9a'];

export function adCanvas(seed: number, w = 512, h = 256): HTMLCanvasElement {
  const rnd = mulberry32(seed);
  const pick = <T>(a: readonly T[]) => a[Math.floor(rnd() * a.length)]!;
  const c = document.createElement('canvas');
  c.width = w;
  c.height = h;
  const g = c.getContext('2d')!;
  const a = pick(NEON_HEX), b = pick(NEON_HEX);
  const grad = g.createLinearGradient(0, 0, w, h);
  grad.addColorStop(0, 'rgba(5,6,14,0.2)');
  grad.addColorStop(1, 'rgba(5,6,14,0.6)');
  g.fillStyle = grad;
  g.fillRect(0, 0, w, h);
  const style = Math.floor(rnd() * 3);
  g.textAlign = 'center';
  g.textBaseline = 'middle';
  const brand = pick(FICTIONAL_BRANDS);
  if (style === 0) {
    g.strokeStyle = a;
    g.lineWidth = Math.max(4, h * 0.03);
    g.strokeRect(g.lineWidth, g.lineWidth, w - g.lineWidth * 2, h - g.lineWidth * 2);
    g.fillStyle = a;
    g.font = `900 ${Math.round(h * 0.26)}px Arial Black, Impact, sans-serif`;
    g.fillText(brand, w / 2, h * 0.42, w * 0.92);
    g.fillStyle = b;
    g.font = `700 ${Math.round(h * 0.12)}px Arial, sans-serif`;
    g.fillText(pick(AD_SLOGANS), w / 2, h * 0.75, w * 0.9);
  } else if (style === 1) {
    g.fillStyle = a;
    g.font = `${Math.round(h * 0.7)}px serif`;
    g.fillText(pick(FICTIONAL_GLYPHS), w * 0.24, h * 0.52);
    g.fillStyle = b;
    g.font = `900 ${Math.round(h * 0.18)}px Arial Black, Impact, sans-serif`;
    g.fillText(brand, w * 0.64, h * 0.42, w * 0.6);
    g.font = `700 ${Math.round(h * 0.09)}px Arial, sans-serif`;
    g.fillText(pick(AD_SLOGANS), w * 0.64, h * 0.7, w * 0.6);
  } else {
    for (let i = 0; i < 6; i++) {
      g.fillStyle = i % 2 ? a : b;
      g.globalAlpha = 0.25 + rnd() * 0.5;
      g.fillRect(0, (i / 6) * h, w * (0.2 + rnd() * 0.8), h / 9);
    }
    g.globalAlpha = 1;
    g.fillStyle = '#ffffff';
    g.font = `900 ${Math.round(h * 0.22)}px Arial Black, Impact, sans-serif`;
    g.fillText(brand, w / 2, h / 2, w * 0.92);
  }
  return c;
}

export function holoMaterial(seed: number, tint: THREE.Color, intensity = 2.2): THREE.ShaderMaterial {
  const tex = new THREE.CanvasTexture(adCanvas(seed));
  tex.colorSpace = THREE.SRGBColorSpace;
  return new THREE.ShaderMaterial({
    uniforms: {
      ...THREE.UniformsUtils.clone(THREE.UniformsLib.fog),
      uMap: { value: tex },
      uTime: { value: 0 },
      uSeed: { value: (seed % 97) / 97 },
      uTint: { value: tint },
      uIntensity: { value: intensity },
    },
    vertexShader: /* glsl */ `
      varying vec2 vUv;
      #include <fog_pars_vertex>
      void main() { vUv = uv; vec4 mvPosition = modelViewMatrix * vec4(position, 1.0); gl_Position = projectionMatrix * mvPosition;
        #include <fog_vertex>
      }
    `,
    fragmentShader: /* glsl */ `
      uniform sampler2D uMap; uniform float uTime, uSeed, uIntensity; uniform vec3 uTint;
      varying vec2 vUv;
      #include <fog_pars_fragment>
      float hh(float x) { return fract(sin(x * 91.3 + uSeed * 17.0) * 43758.5); }
      void main() {
        vec2 uv = vUv;
        // Infrequent glitch slices (roughly once every few seconds, per sign).
        float gt = floor(uTime * 3.0);
        float glitchOn = step(0.93, hh(gt));
        float band = step(0.8, hh(floor(uv.y * 14.0) + gt));
        uv.x += glitchOn * band * (hh(gt + 3.0) - 0.5) * 0.12;
        float split = 0.004 + glitchOn * 0.01;
        float edge = smoothstep(0.35, 0.5, abs(uv.x - 0.5));
        vec3 col;
        col.r = texture2D(uMap, uv + vec2(split * edge, 0.0)).r;
        col.g = texture2D(uMap, uv).g;
        col.b = texture2D(uMap, uv - vec2(split * edge, 0.0)).b;
        float a = max(max(col.r, col.g), col.b);
        float scan = 0.78 + 0.22 * sin(uv.y * 420.0 + uTime * 12.0);
        float flicker = 0.9 + 0.1 * sin(uTime * 2.3 + uSeed * 20.0) * sin(uTime * 0.7);
        float noise = 0.85 + 0.15 * hh(floor(uv.y * 200.0) + floor(uTime * 20.0));
        vec3 outc = col * mix(vec3(1.0), uTint, 0.25) * uIntensity * scan * flicker * noise;
        gl_FragColor = vec4(outc, clamp(a * 0.9 + 0.08, 0.0, 1.0));
        #include <fog_fragment>
      }
    `,
    transparent: true,
    depthWrite: false,
    side: THREE.DoubleSide,
    blending: THREE.AdditiveBlending,
    fog: true,
  });
}

/** Solid neon sign (opaque emissive plane) for facades. */
export function neonSignMaterial(seed: number, intensity = 2.4): THREE.MeshBasicMaterial {
  const tex = new THREE.CanvasTexture(adCanvas(seed, 512, 128));
  tex.colorSpace = THREE.SRGBColorSpace;
  const m = new THREE.MeshBasicMaterial({ map: tex, color: new THREE.Color(intensity, intensity, intensity), fog: true });
  return m;
}
