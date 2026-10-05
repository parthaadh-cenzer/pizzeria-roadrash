// Art-direction palette and shared materials (neutral dark anchors + controlled emissives).
import * as THREE from 'three';
import type { DistrictId } from '../../shared/ids.js';

export const NEON = {
  cyan: new THREE.Color(0x18e0ff),
  magenta: new THREE.Color(0xff2bd6),
  violet: new THREE.Color(0x8a3dff),
  red: new THREE.Color(0xff2a3a),
  orange: new THREE.Color(0xff7a1a),
  amber: new THREE.Color(0xffc21a),
  white: new THREE.Color(0xffffff),
};

export interface DistrictLook {
  accent: THREE.Color;
  secondary: THREE.Color;
  fog: THREE.Color;
  fogDensity: number;
  ambient: THREE.Color;
  hemiSky: THREE.Color;
  hemiGround: THREE.Color;
  exposure: number;
  windowWarmth: number;
}

const look = (accent: number, secondary: number, fog: number, fogDensity: number, ambient: number, sky: number, ground: number, exposure: number, windowWarmth: number): DistrictLook => ({
  accent: new THREE.Color(accent),
  secondary: new THREE.Color(secondary),
  fog: new THREE.Color(fog),
  fogDensity,
  ambient: new THREE.Color(ambient),
  hemiSky: new THREE.Color(sky),
  hemiGround: new THREE.Color(ground),
  exposure,
  windowWarmth,
});

// Fog densities are for LIGHT rain; weather intensity scales them up.
export const DISTRICT_LOOK: Record<DistrictId, DistrictLook> = {
  NEON_CORE: look(0xff2bd6, 0x18e0ff, 0x1a1030, 0.0042, 0x2a2440, 0x3a3a78, 0x201018, 1.08, 0.35),
  COMMERCIAL: look(0x18e0ff, 0xffb23a, 0x121a30, 0.0040, 0x262a3c, 0x344066, 0x1e1a14, 1.06, 0.65),
  STORM: look(0xffc21a, 0x6aa8ff, 0x10182a, 0.0056, 0x1e2636, 0x2e4466, 0x10141c, 1.02, 0.2),
  HEAVY_RAIN_TECHNICAL: look(0x18e0ff, 0x8a3dff, 0x121628, 0.0056, 0x202438, 0x303c66, 0x121420, 1.04, 0.3),
  INDUSTRIAL: look(0xff7a1a, 0x18e0ff, 0x1c1410, 0.0050, 0x2a221c, 0x40362a, 0x1a1008, 1.05, 0.8),
  TUNNEL: look(0x18e0ff, 0xff2bd6, 0x0a0c16, 0.0032, 0x1a1c28, 0x202438, 0x0c0c12, 1.0, 0.2),
  BRIDGE_CLIMB: look(0xffc21a, 0xff7a1a, 0x121826, 0.0048, 0x222838, 0x34466a, 0x14100c, 1.04, 0.5),
  BROKEN_BRIDGE: look(0xff2a3a, 0xffc21a, 0x0e1628, 0.0052, 0x1c2438, 0x2c4270, 0x0c1018, 1.02, 0.2),
  WESTERN_TECHNICAL: look(0x8a3dff, 0xff2bd6, 0x140f28, 0.0050, 0x221e38, 0x363068, 0x140e1a, 1.04, 0.35),
  FINAL_NEON_RUN: look(0xff2bd6, 0x18e0ff, 0x1a1032, 0.0044, 0x2a2442, 0x3c3a7c, 0x201020, 1.08, 0.4),
};

function hazardStripes(): THREE.CanvasTexture {
  const c = document.createElement('canvas');
  c.width = c.height = 64;
  const g = c.getContext('2d')!;
  g.fillStyle = '#141414';
  g.fillRect(0, 0, 64, 64);
  g.fillStyle = '#ffb01a';
  for (let i = -64; i < 128; i += 32) {
    g.beginPath();
    g.moveTo(i, 0);
    g.lineTo(i + 16, 0);
    g.lineTo(i + 16 - 64, 64);
    g.lineTo(i - 64, 64);
    g.closePath();
    g.fill();
  }
  const t = new THREE.CanvasTexture(c);
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

export class Materials {
  readonly concrete: THREE.MeshStandardMaterial;
  readonly concreteDark: THREE.MeshStandardMaterial;
  readonly wall: THREE.MeshStandardMaterial;
  readonly barrier: THREE.MeshStandardMaterial;
  readonly hazard: THREE.MeshStandardMaterial;
  readonly steel: THREE.MeshStandardMaterial;
  readonly glass: THREE.MeshPhysicalMaterial;
  readonly water: THREE.MeshPhysicalMaterial;
  private neonCache = new Map<string, THREE.MeshBasicMaterial>();

  constructor() {
    this.concrete = new THREE.MeshStandardMaterial({ color: 0x5b5f68, roughness: 0.82, metalness: 0.02, name: 'concrete' });
    this.concreteDark = new THREE.MeshStandardMaterial({ color: 0x33363e, roughness: 0.9, metalness: 0.02, name: 'concrete_dark' });
    this.wall = new THREE.MeshStandardMaterial({ color: 0x4a4d56, roughness: 0.85, metalness: 0.02, side: THREE.DoubleSide, name: 'wall' });
    this.barrier = new THREE.MeshStandardMaterial({ color: 0x8a8d96, roughness: 0.55, metalness: 0.05, name: 'barrier' });
    const stripes = hazardStripes();
    this.hazard = new THREE.MeshStandardMaterial({ color: 0xffffff, map: stripes, emissiveMap: stripes, emissive: 0xffb01a, emissiveIntensity: 1.6, roughness: 0.5, metalness: 0.1, name: 'hazard' });
    this.steel = new THREE.MeshStandardMaterial({ color: 0x3a3f4a, roughness: 0.38, metalness: 0.85, name: 'steel' });
    this.glass = new THREE.MeshPhysicalMaterial({ color: 0x0c1220, roughness: 0.08, metalness: 0.2, transmission: 0, clearcoat: 1, name: 'glass' });
    this.water = new THREE.MeshPhysicalMaterial({ color: 0x050a14, roughness: 0.06, metalness: 0.1, clearcoat: 1, clearcoatRoughness: 0.08, envMapIntensity: 1.2, name: 'water' });
  }

  /** Unlit emissive neon (bloom driven by intensity > 1 in the HDR buffer). */
  neon(color: THREE.Color | number, intensity = 2.5): THREE.MeshBasicMaterial {
    const c = new THREE.Color(color);
    const key = `${c.getHexString()}_${intensity}`;
    let m = this.neonCache.get(key);
    if (!m) {
      m = new THREE.MeshBasicMaterial({ color: c.clone().multiplyScalar(intensity), toneMapped: true, fog: true, name: `neon_${key}` });
      this.neonCache.set(key, m);
    }
    return m;
  }
}
