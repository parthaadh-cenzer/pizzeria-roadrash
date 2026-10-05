// Riders, crowd and the Cyborg Oni race starter.
import * as THREE from 'three';
import { RIDERS, type RiderDef } from '../../../src/config/riders.js';
import { ENFORCER_MAP, MIXAMO_MAP } from '../../../src/config/skeleton.js';
import type { RiderId } from '../../../src/shared/ids.js';
import type { ManifestEntry } from '../../../src/shared/manifest.js';
import { quatY, removeNodes, renameJoints, renameNode } from '../lib/gltfOps.js';
import type { MaskKind } from '../lib/masks.js';
import { codeHashOf, libHash, processModel } from './common.js';

const CODE = () => libHash() + codeHashOf('tools/asset-pipeline/recipes/characters.ts', 'src/config/riders.ts');

const identityMap = (m: Record<string, string>) => Object.fromEntries(Object.keys(m).map((k) => [k, k]));

async function rider(def: RiderDef, source: string): Promise<ManifestEntry> {
  let jointMap: Record<string, string> = {};
  let removed: string[] = [];
  return processModel({
    id: def.asset,
    dir: 'riders',
    source,
    codeHash: CODE(),
    textureMax: 1024,
    prepare: (doc) => {
      removed = removeNodes(doc, (n) => def.removeNodes.some((re) => re.test(n.getName())));
      jointMap = renameJoints(doc, def.retarget);
      const missing = ['hips', 'spine', 'head', 'leftHand', 'rightHand', 'leftFoot', 'rightFoot'].filter((b) => !jointMap[b]);
      if (missing.length) throw new Error(`${def.asset}: retarget map incomplete (${missing.join(', ')})`);
      return [
        `retarget map (${def.rig}): ${Object.entries(jointMap).slice(0, 22).map(([k, v]) => `${k}<-${v}`).join(', ')}`,
        removed.length ? `removed source nodes: ${removed.join(', ')}` : 'no source nodes removed',
      ];
    },
    normalize: (m) => {
      const q = def.sourceForward === '-Z' ? quatY(Math.PI) : new THREE.Quaternion();
      return { q, scale: def.targetHeight / m.size.y };
    },
    masks: def.atlasMaskMaterials.map((material) => ({ material, kind: (def.colorMode === 'dye' ? 'dye' : 'nonSkin') as MaskKind })),
    lod1: { ratio: 0.35, error: 0.02, textureMax: 512 },
    describe: (m) => ({
      rider: {
        height: +m.size.y.toFixed(3),
        retargetMap: identityMap(jointMap),
        rigKind: def.rig,
        hiddenNodes: removed,
        handBone: 'rightHand',
        skinMaterials: [],
        tintMaterials: def.tintMaterials,
        rightHandGripOffset: [0, 0, 0],
      },
    }),
    decorate: (e) => {
      e.materialVariants = def.variants.map((v) => ({ name: v.name, colors: { primary: v.primary, secondary: v.secondary, emissive: v.emissive } }));
      if (e.rider) e.rider.tintMaterials = def.tintMaterials;
    },
  });
}

export async function buildRiders(): Promise<ManifestEntry[]> {
  const sources: Record<RiderId, string> = {
    RIDER_01_BLACKGUARD: 'Assets/Characters/tron_uprising_blackguard.glb',
    RIDER_02_SCARLET_PROXY: 'Assets/Characters/scarlet_proxy__free_sci-fi_charchter_riged.glb',
    RIDER_03_CYBERPUNK_MOHAWK: 'Assets/Characters/readyplayerme_cyberpunk.glb',
    RIDER_04_CYBERPUNK_ENFORCER: 'Assets/Characters/cyberpunk_character.glb',
  };
  const out: ManifestEntry[] = [];
  for (const id of Object.keys(sources) as RiderId[]) out.push(await rider(RIDERS[id], sources[id]));
  return out;
}

interface CrowdDef {
  id: string;
  source: string;
  map: Record<string, RegExp> | null;
  forward: '+Z' | '-Z';
  height: number;
  textureMax: number;
  simplify?: { ratio: number; error: number };
  lod1: { ratio: number; error: number; textureMax: number };
  keepIdle: boolean;
  mask?: { material: string; kind: MaskKind };
  variants: number;
  tint: string[];
  alphaFix?: boolean;
}

const CROWD: CrowdDef[] = [
  { id: 'crowd.mohawk', source: 'Assets/Audience/readyplayerme_cyberpunk.glb', map: MIXAMO_MAP, forward: '+Z', height: 1.8, textureMax: 512, lod1: { ratio: 0.4, error: 0.02, textureMax: 256 }, keepIdle: false, variants: 8, tint: ['Wolf3D_Outfit_Top', 'Wolf3D_Outfit_Bottom', 'Wolf3D_Hair', 'Wolf3D_Outfit_Footwear'] },
  { id: 'crowd.enforcer', source: 'Assets/Audience/cyberpunk_character.glb', map: ENFORCER_MAP, forward: '-Z', height: 1.82, textureMax: 512, lod1: { ratio: 0.4, error: 0.02, textureMax: 256 }, keepIdle: false, mask: { material: 'material_3', kind: 'nonSkin' }, variants: 6, tint: [] },
  { id: 'crowd.ruffle', source: 'Assets/Audience/rigged_female_fashion_character_in_ruffle_dress.glb', map: MIXAMO_MAP, forward: '+Z', height: 1.7, textureMax: 512, simplify: { ratio: 0.05, error: 0.01 }, lod1: { ratio: 0.4, error: 0.03, textureMax: 256 }, keepIdle: true, mask: { material: 'Material.001', kind: 'nonSkin' }, variants: 6, tint: [] },
  { id: 'crowd.horned', source: 'Assets/Audience/female_character.glb', map: null, forward: '+Z', height: 1.95, textureMax: 512, lod1: { ratio: 0.35, error: 0.02, textureMax: 256 }, keepIdle: false, mask: { material: 'initialShadingGroup', kind: 'nonSkin' }, variants: 4, tint: [], alphaFix: true },
];

export async function buildCrowd(): Promise<ManifestEntry[]> {
  const out: ManifestEntry[] = [];
  for (const c of CROWD) {
    let jointMap: Record<string, string> = {};
    out.push(
      await processModel({
        id: c.id,
        dir: 'crowd',
        source: c.source,
        codeHash: CODE(),
        textureMax: c.textureMax,
        keepAnimations: (n) => c.keepIdle && n === 'mixamo.com',
        prepare: (doc) => {
          const notes: string[] = [];
          if (c.map) jointMap = renameJoints(doc, c.map);
          for (const a of doc.getRoot().listAnimations()) a.setName('idle');
          if (c.alphaFix) {
            for (const mat of doc.getRoot().listMaterials()) if (mat.getAlphaMode() === 'BLEND') mat.setAlphaMode('MASK').setAlphaCutoff(0.4);
            notes.push('whole-body BLEND material converted to MASK (no transparent sorting in crowds)');
          }
          if (!c.map) notes.push('static (unrigged) figure: mid/far crowd and impostors only');
          return notes;
        },
        normalize: (m) => ({ q: c.forward === '-Z' ? quatY(Math.PI) : new THREE.Quaternion(), scale: c.height / m.size.y }),
        simplify: c.simplify,
        masks: c.mask ? [c.mask] : [],
        lod1: c.lod1,
        describe: (m) => ({
          crowd: { height: +m.size.y.toFixed(3), rigged: !!c.map, retargetMap: identityMap(jointMap), tintMaterials: c.tint, variants: c.variants },
          animations: c.keepIdle ? ['idle'] : [],
        }),
      }),
    );
  }
  return out;
}

export async function buildStarter(): Promise<ManifestEntry> {
  return processModel({
    id: 'starter.oni',
    dir: 'starter',
    source: 'Assets/Race starter/cyborg_oni.glb',
    codeHash: CODE(),
    textureMax: 1024,
    keepAnimations: (n) => n === 'clip',
    prepare: (doc) => {
      for (const a of doc.getRoot().listAnimations()) a.setName('oni_intro');
      const hand = renameNode(doc, /JNT_wrist_r/, 'oni_hand_r');
      if (!hand) throw new Error('starter.oni: right wrist joint not found');
      return ['clip keys start at t=1.0 s; runtime trims the dead time', 'static "pose" clip dropped'];
    },
    normalize: (m) => ({ q: new THREE.Quaternion(), scale: 3.0 / m.size.y }),
    describe: (m) => ({
      starter: { clip: 'oni_intro', trimStart: 1.0, landingTime: 3.5, gestureTime: 4.9, height: +m.size.y.toFixed(3), handBone: 'oni_hand_r' },
      animations: ['oni_intro'],
    }),
  });
}
