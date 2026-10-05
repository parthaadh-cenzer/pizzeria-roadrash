// Colour variants and material normalisation shared by bikes, riders and the crowd.
// - factor tints for untextured paint/accent materials
// - emissive recolour for accent lights
// - atlas hue-shift restricted by a pipeline-generated mask (skin never recoloured)
// - one coherent PBR response (roughness ranges, env response, wet clear-coat sheen on paint)
import * as THREE from 'three';

export interface VariantSpec {
  paint?: THREE.Color | null;
  accent?: THREE.Color | null;
  emissive?: THREE.Color | null;
  paintMaterials?: string[];
  accentMaterials?: string[];
  emissiveMaterials?: string[];
  tintMaterials?: string[];
  masks?: Map<string, THREE.Texture>;
  maskColor?: THREE.Color | null;
  /**
   * 'hue' re-hues saturated regions and keeps their brightness; 'dye' tints by luminance with
   * a small lift so near-black fabric and armour take a clearly visible colour while keeping
   * the texture's detail (skin stays excluded by the mask either way).
   */
  maskMode?: 'hue' | 'dye';
  emissiveIntensity?: number;
  wetSheen?: boolean;
}

const HSV_GLSL = /* glsl */ `
vec3 vr_rgb2hsv(vec3 c) {
  vec4 K = vec4(0.0, -1.0 / 3.0, 2.0 / 3.0, -1.0);
  vec4 p = mix(vec4(c.bg, K.wz), vec4(c.gb, K.xy), step(c.b, c.g));
  vec4 q = mix(vec4(p.xyw, c.r), vec4(c.r, p.yzx), step(p.x, c.r));
  float d = q.x - min(q.w, q.y);
  float e = 1.0e-10;
  return vec3(abs(q.z + (q.w - q.y) / (6.0 * d + e)), d / (q.x + e), q.x);
}
vec3 vr_hsv2rgb(vec3 c) {
  vec4 K = vec4(1.0, 2.0 / 3.0, 1.0 / 3.0, 3.0);
  vec3 p = abs(fract(c.xxx + K.xyz) * 6.0 - K.www);
  return c.z * mix(K.xxx, clamp(p - K.xxx, 0.0, 1.0), c.y);
}`;

const HUE_GLSL = /* glsl */ `vec3 vrShift = vr_hsv2rgb(vec3(vrT.x, clamp(mix(vrHsv.y, vrT.y, 0.55), 0.0, 1.0), vrHsv.z * mix(1.0, vrT.z * 1.4, 0.35)));`;
const DYE_GLSL = /* glsl */ `float vrL = dot(diffuseColor.rgb, vec3(0.2126, 0.7152, 0.0722));
          vec3 vrShift = mix(uVrColor * (0.1 + vrL * 1.5), vec3(vrL), 0.12);`;

function upgradeToPhysical(m: THREE.MeshStandardMaterial): THREE.MeshPhysicalMaterial {
  if ((m as THREE.MeshPhysicalMaterial).isMeshPhysicalMaterial) return m.clone() as THREE.MeshPhysicalMaterial;
  const p = new THREE.MeshPhysicalMaterial();
  THREE.MeshStandardMaterial.prototype.copy.call(p, m);
  p.name = m.name;
  return p;
}

function addMaskedHueShift(m: THREE.MeshStandardMaterial, mask: THREE.Texture, color: THREE.Color, mode: 'hue' | 'dye'): void {
  const prev = m.onBeforeCompile;
  m.onBeforeCompile = (shader, r) => {
    prev.call(m, shader, r);
    shader.uniforms.uVrMask = { value: mask };
    shader.uniforms.uVrColor = { value: color };
    shader.fragmentShader = shader.fragmentShader
      .replace('#include <common>', `#include <common>\nuniform sampler2D uVrMask;\nuniform vec3 uVrColor;\n${HSV_GLSL}`)
      .replace(
        '#include <map_fragment>',
        `#include <map_fragment>
        #ifdef USE_MAP
        {
          float vrM = texture2D(uVrMask, vMapUv).r;
          vec3 vrHsv = vr_rgb2hsv(diffuseColor.rgb);
          vec3 vrT = vr_rgb2hsv(uVrColor);
          ${mode === 'dye' ? DYE_GLSL : HUE_GLSL}
          diffuseColor.rgb = mix(diffuseColor.rgb, vrShift, vrM);
        }
        #endif`,
      );
  };
  m.customProgramCacheKey = () => `vr_mask_${mode}_${mask.uuid}`;
}

/** Clones every material under `root` and applies the variant + material policy. */
export function applyVariant(root: THREE.Object3D, v: VariantSpec): void {
  const cache = new Map<THREE.Material, THREE.Material>();
  const has = (list: string[] | undefined, name: string) => !!list && list.includes(name);
  root.traverse((o) => {
    const mesh = o as THREE.Mesh;
    if (!mesh.isMesh) return;
    const convert = (src: THREE.Material): THREE.Material => {
      let out = cache.get(src);
      if (out) return out;
      const s = src as THREE.MeshStandardMaterial;
      if (!s.isMeshStandardMaterial) {
        out = src.clone();
        cache.set(src, out);
        return out;
      }
      const name = s.name;
      const paint = has(v.paintMaterials, name);
      const m = v.wetSheen && paint ? upgradeToPhysical(s) : (s.clone() as THREE.MeshStandardMaterial);
      // Coherent PBR response across heterogeneous sources.
      m.roughness = THREE.MathUtils.clamp(m.roughness, 0.14, 0.88);
      m.envMapIntensity = 1.0;
      if (paint && v.paint) m.color.copy(v.paint);
      if (has(v.accentMaterials, name) && v.accent) m.color.copy(v.accent);
      if (has(v.tintMaterials, name) && v.paint) m.color.copy(v.paint).lerp(new THREE.Color(1, 1, 1), 0.25);
      if (paint && (m as THREE.MeshPhysicalMaterial).isMeshPhysicalMaterial) {
        const p = m as THREE.MeshPhysicalMaterial;
        p.clearcoat = 0.7;
        p.clearcoatRoughness = 0.12;
      }
      const isEmissive = has(v.emissiveMaterials, name) || !!m.emissiveMap || m.emissive.getHex() !== 0;
      if (isEmissive) {
        if (v.emissive && has(v.emissiveMaterials, name)) m.emissive.copy(v.emissive);
        m.emissiveIntensity = (v.emissiveIntensity ?? 2.4) * (m.emissiveMap ? 1 : 1);
      }
      const mask = v.masks?.get(name);
      // A white dye is the factory finish: leave the authored texture untouched.
      const factory = v.maskMode === 'dye' && v.maskColor?.getHex() === 0xffffff;
      if (mask && v.maskColor && m.map && !factory) addMaskedHueShift(m, mask, v.maskColor, v.maskMode ?? 'hue');
      cache.set(src, m);
      return m;
    };
    mesh.material = Array.isArray(mesh.material) ? mesh.material.map(convert) : convert(mesh.material);
  });
}

export function hex(c: string): THREE.Color {
  return new THREE.Color(c);
}
