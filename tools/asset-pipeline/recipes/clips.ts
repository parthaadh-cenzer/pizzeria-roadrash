// Animation clips on the semantic skeleton (converted from FBX, or procedural where absent).
import path from 'node:path';
import { ASSET_REGISTRY, CLIP_IDS } from '../../../src/config/assets.js';
import type { CanonicalClip } from '../../../src/config/skeleton.js';
import type { ManifestEntry } from '../../../src/shared/manifest.js';
import { makeCheerClap, makeGetupProne, makeWalk, fbxToCanonical } from '../lib/clips.js';
import { cacheGet, cachePut, hashFile, log, recipeKey, ROOT, writeOutput } from '../lib/core.js';
import { codeHashOf, libHash, registryDef, sourceInfo } from './common.js';

const CODE = () => libHash() + codeHashOf('tools/asset-pipeline/recipes/clips.ts');

function entryFor(id: string, clip: CanonicalClip, file: string, bytes: number, notes: string[]): ManifestEntry {
  const def = registryDef(id);
  const srcs = ASSET_REGISTRY.find((a) => a.id === id)!.sources;
  return {
    id, category: def.category, required: def.required, source: sourceInfo(srcs), files: { clip: file }, bytes, triangles: 0,
    maxTextureSize: 0, textureFormat: 'none', orientation: { forward: '+Z', up: '+Y', units: 'm' }, notes,
    clip: { fps: clip.fps, duration: +clip.duration.toFixed(3), frames: clip.frames.length, bones: clip.bones, procedural: clip.procedural, loop: clip.loop },
  };
}

export async function buildClips(): Promise<ManifestEntry[]> {
  const anim = (f: string) => `Assets/Animation/${f}`;
  const allSources = ASSET_REGISTRY.filter((a) => a.category === 'animation').flatMap((a) => a.sources);
  const key = recipeKey(['clips', ...[...new Set(allSources)].map((s) => hashFile(path.join(ROOT, s))), CODE()]);
  const cached = cacheGet<ManifestEntry[]>('clips', key);
  if (cached) {
    log.step('clips', 'cached');
    return cached;
  }
  const specs: { id: string; make: () => CanonicalClip; notes: string[] }[] = [];
  let getupBack: CanonicalClip | null = null;
  specs.push({
    id: CLIP_IDS.getupBack,
    make: () => (getupBack = fbxToCanonical(anim('Getting Up (1).fbx'), CLIP_IDS.getupBack, { loop: false })),
    notes: ['anim_getup_back: supplied clip starts lying face-up (hips forward = +Y). "Getting Up (2).fbx" is animation-identical and unused.'],
  });
  specs.push({ id: CLIP_IDS.getupProne, make: () => makeGetupProne(getupBack!), notes: ['anim_getup_prone: no face-down source clip supplied; procedural push-up + knee tuck blends into the supplied stand-up phase'] });
  specs.push({ id: CLIP_IDS.run, make: () => fbxToCanonical(anim('Fast Run (1).fbx'), CLIP_IDS.run, { loop: true, inPlace: true }), notes: ['run to bike (in place; root motion driven by recovery state)'] });
  specs.push({ id: CLIP_IDS.disappointed, make: () => fbxToCanonical(anim('Disappointed.fbx'), CLIP_IDS.disappointed, { loop: true }), notes: ['results 4th+'] });
  specs.push({ id: CLIP_IDS.victoryRobot, make: () => fbxToCanonical(anim('Robot Hip Hop Dance.fbx'), CLIP_IDS.victoryRobot, { loop: true, inPlace: true }), notes: ['results #1 (male riders)'] });
  specs.push({ id: CLIP_IDS.victorySnake, make: () => fbxToCanonical(anim('Snake Hip Hop Dance.fbx'), CLIP_IDS.victorySnake, { loop: true, inPlace: true }), notes: ['results #1 (female riders)'] });
  specs.push({ id: CLIP_IDS.swordSlash, make: () => fbxToCanonical(anim('Stable Sword Inward Slash.fbx'), CLIP_IDS.swordSlash, { loop: false }), notes: ['upper-body layered for machete / katana / Zabimaru'] });
  specs.push({ id: CLIP_IDS.morningStarSwing, make: () => fbxToCanonical(anim('anim_morningstar_swing_r.fbx'), CLIP_IDS.morningStarSwing, { loop: false }), notes: ['upper-body layered for the morning star'] });
  specs.push({ id: CLIP_IDS.cheerClap, make: () => makeCheerClap(), notes: ['no Cheer/Clap source clip supplied; procedural loop on the semantic skeleton'] });
  specs.push({ id: CLIP_IDS.walk, make: () => makeWalk(), notes: ['no Walk source clip supplied; procedural in-place walk on the semantic skeleton'] });
  const out: ManifestEntry[] = [];
  for (const s of specs) {
    const clip = s.make();
    const json = JSON.stringify(clip);
    const file = writeOutput('anim', s.id.replace('clip.', ''), 'json', json);
    const markers = Object.entries(clip.markers).map(([k, v]) => `${k}=${typeof v === 'number' ? v.toFixed(2) : v}`).join(' ');
    out.push(entryFor(s.id, clip, file, json.length, [...s.notes, `duration ${clip.duration.toFixed(2)} s, ${clip.frames.length} frames${markers ? `, markers ${markers}` : ''}`]));
    log.step(s.id, `${clip.procedural ? 'procedural' : 'converted'} ${clip.duration.toFixed(2)} s`);
  }
  cachePut('clips', key, out.map((e) => e.files.clip!), out);
  return out;
}
