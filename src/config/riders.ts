// Rider roster (HANDOFF/01_LOCKED_GAME_SPEC.md "Rider roster").
import type { RiderId } from '../shared/ids.js';
import { ENFORCER_MAP, MIXAMO_MAP, SCARLET_MAP } from './skeleton.js';

export interface RiderVariant {
  name: string;
  primary: string;
  secondary: string;
  emissive: string;
}

export interface RiderDef {
  id: RiderId;
  asset: string;
  name: string;
  tagline: string;
  gender: 'male' | 'female';
  sourceForward: '+Z' | '-Z';
  targetHeight: number;
  rig: 'mixamo' | 'custom';
  retarget: Record<string, RegExp>;
  /** Source node names removed by the pipeline (stray skinned parts, included sword). */
  removeNodes: RegExp[];
  /** Materials that receive the variant colours. Skin regions are masked (atlas-aware). */
  tintMaterials: string[];
  emissiveMaterials: string[];
  /** Materials whose atlas mixes skin and clothing: tinted through a generated non-skin mask. */
  atlasMaskMaterials: string[];
  /** How the variant colour is applied to masked atlas regions (see Variants.maskMode). */
  colorMode: 'hue' | 'dye';
  variants: [RiderVariant, RiderVariant, RiderVariant];
}

const V = (name: string, primary: string, secondary: string, emissive: string): RiderVariant => ({ name, primary, secondary, emissive });

export const RIDERS: Record<RiderId, RiderDef> = {
  RIDER_01_BLACKGUARD: {
    id: 'RIDER_01_BLACKGUARD',
    colorMode: 'hue',
    asset: 'rider.blackguard',
    name: 'Blackguard',
    tagline: 'Armoured grid enforcer. Emissive trim, zero mercy.',
    gender: 'male',
    sourceForward: '+Z',
    targetHeight: 1.86,
    rig: 'mixamo',
    retarget: MIXAMO_MAP,
    removeNodes: [/^Object_9$/, /^Object_11$/, /^Object_13$/, /^Object_14$/],
    tintMaterials: [],
    emissiveMaterials: ['material_0', 'Material_0.002', '38_BeckMesh_1_0_0.003', '38_BeckSuitMain1MAT_1_0_0.003'],
    atlasMaskMaterials: [],
    variants: [V('Grid Cyan', '#20242c', '#11141a', '#1ae4ff'), V('Rogue Orange', '#26201c', '#15110e', '#ff7a1a'), V('Crimson Code', '#2a1c1e', '#170e10', '#ff2a45')],
  },
  RIDER_02_SCARLET_PROXY: {
    id: 'RIDER_02_SCARLET_PROXY',
    colorMode: 'hue',
    asset: 'rider.scarlet',
    name: 'Scarlet Proxy',
    tagline: 'Sci-fi infiltrator. Custom 93-joint rig, blade discarded.',
    gender: 'female',
    sourceForward: '+Z',
    targetHeight: 1.72,
    rig: 'custom',
    retarget: SCARLET_MAP,
    removeNodes: [/^Object_15$/],
    tintMaterials: ['Hair'],
    emissiveMaterials: ['KJ_Mat.002', 'Hair'],
    atlasMaskMaterials: ['KJ_Mat.002'],
    variants: [V('Scarlet', '#d01a2a', '#2a0d12', '#ff2a4a'), V('Cobalt', '#1a4ad0', '#0d122a', '#3aa8ff'), V('Venom', '#1ad06a', '#0d2a18', '#3aff9a')],
  },
  RIDER_03_CYBERPUNK_MOHAWK: {
    id: 'RIDER_03_CYBERPUNK_MOHAWK',
    colorMode: 'hue',
    asset: 'rider.mohawk',
    name: 'Cyberpunk Mohawk',
    tagline: 'Street racer with a chrome arm and a louder haircut.',
    gender: 'male',
    sourceForward: '+Z',
    targetHeight: 1.84,
    rig: 'mixamo',
    retarget: MIXAMO_MAP,
    removeNodes: [],
    tintMaterials: ['Wolf3D_Outfit_Top', 'Wolf3D_Outfit_Bottom', 'Wolf3D_Hair'],
    emissiveMaterials: ['Wolf3D_Glasses'],
    atlasMaskMaterials: [],
    variants: [V('Hot Pink', '#ff4fb8', '#5a2a86', '#ff4fd8'), V('Acid Green', '#8aff3a', '#1f3a1a', '#8aff3a'), V('Ice Blue', '#4fd8ff', '#1a2a5a', '#4fd8ff')],
  },
  RIDER_04_CYBERPUNK_ENFORCER: {
    id: 'RIDER_04_CYBERPUNK_ENFORCER',
    // Black gear and a steel arm: dye by luminance so every swatch reads at a glance.
    colorMode: 'dye',
    asset: 'rider.enforcer',
    name: 'Cyberpunk Enforcer',
    tagline: 'Heavy cybernetic arm. Rescaled and texture-optimised.',
    gender: 'male',
    sourceForward: '-Z',
    targetHeight: 1.88,
    rig: 'custom',
    retarget: ENFORCER_MAP,
    removeNodes: [],
    tintMaterials: [],
    emissiveMaterials: [],
    atlasMaskMaterials: ['material', 'material_3'],
    variants: [V('Street Black', '#ffffff', '#ffffff', '#ffb020'), V('Neon Teal', '#1fd0c0', '#ffffff', '#2af0ff'), V('Blood Orange', '#ff5a14', '#ffffff', '#ff3a1a')],
  },
};

export function victoryClipFor(r: RiderDef): 'clip.victorySnake' | 'clip.victoryRobot' {
  return r.gender === 'female' ? 'clip.victorySnake' : 'clip.victoryRobot';
}
