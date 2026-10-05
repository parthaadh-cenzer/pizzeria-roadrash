// npm run assets:verify — checks the built runtime assets against IMPLEMENTATION_CONTRACT §23:
// required runtime assets exist, source hashes are recorded and current, required clips exist,
// no spec-gloss remains, bike mount targets and rider retarget maps exist and resolve, the
// production client never references a source asset path, and texture size rules hold.
// Read-only: never touches Assets/ beyond hashing and header inspection.
import fs from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { ASSET_REGISTRY, BIKE_ASSET, CLIP_IDS, RIDER_ASSET, WEAPON_ASSET } from '../../src/config/assets.js';
import { REQUIRED_RUNTIME_ASSETS } from '../../src/config/runtimeAssets.js';
import { SEMANTIC_BONES } from '../../src/config/skeleton.js';
import type { ManifestEntry, RuntimeManifest, Vec3Tuple } from '../../src/shared/manifest.js';
import { OUT_ROOT, ROOT, sha256 } from './lib/core.js';

export type Level = 'PASS' | 'WARN' | 'FAIL';
export interface CheckResult {
  section: string;
  level: Level;
  message: string;
}

export const SECTIONS = {
  required: 'Required runtime assets exist',
  integrity: 'Runtime files intact (content hashes)',
  hashes: 'Source hashes recorded and current',
  clips: 'Required animation clips exist',
  specGloss: 'No unsupported spec-gloss in runtime GLBs',
  mounts: 'Bike mount targets exist',
  retarget: 'Rider retarget maps exist and resolve',
  sourcePaths: 'Production client never references Assets/',
  textures: 'Texture size rules (flagged heavy assets)',
  gameplayNodes: 'Gameplay nodes/clips referenced by runtime info exist',
} as const;

/** Runtime textures must fit mobile GPUs comfortably; the pipeline never emits more than this. */
export const MAX_RUNTIME_TEXTURE = 2048;
/** Source textures at or above this size flag an asset as heavy (ASSET_AUDIT: 4K/8K sets). */
export const HEAVY_SOURCE_TEXTURE = 4096;
const SUPPORTED_REQUIRED_EXT = new Set(['KHR_texture_basisu', 'EXT_meshopt_compression', 'KHR_mesh_quantization', 'KHR_texture_transform', 'KHR_materials_emissive_strength']);

// ------------------------------------------------------------------------------ GLB inspection
interface GltfJson {
  asset?: unknown;
  extensionsUsed?: string[];
  extensionsRequired?: string[];
  buffers?: { uri?: string; byteLength: number; extensions?: Record<string, { fallback?: boolean }> }[];
  bufferViews?: { buffer: number; byteOffset?: number; byteLength: number }[];
  images?: { bufferView?: number; uri?: string; mimeType?: string; name?: string }[];
  materials?: { name?: string; extensions?: Record<string, unknown> }[];
  nodes?: { name?: string }[];
  skins?: { joints: number[] }[];
  animations?: { name?: string }[];
  textures?: { source?: number; extensions?: Record<string, { source?: number }> }[];
}

export interface Glb {
  json: GltfJson;
  bin: Buffer | null;
}

export function parseGlb(buf: Buffer): Glb {
  if (buf.length < 20 || buf.readUInt32LE(0) !== 0x46546c67) throw new Error('not a binary glTF (bad magic)');
  let o = 12;
  let json: GltfJson | null = null;
  let bin: Buffer | null = null;
  while (o + 8 <= buf.length) {
    const len = buf.readUInt32LE(o);
    const type = buf.readUInt32LE(o + 4);
    const data = buf.subarray(o + 8, o + 8 + len);
    if (type === 0x4e4f534a) json = JSON.parse(data.toString('utf8')) as GltfJson;
    else if (type === 0x004e4942) bin = data;
    o += 8 + len;
  }
  if (!json) throw new Error('GLB has no JSON chunk');
  return { json, bin };
}

const KTX2_ID = Buffer.from([0xab, 0x4b, 0x54, 0x58, 0x20, 0x32, 0x30, 0xbb, 0x0d, 0x0a, 0x1a, 0x0a]);

export interface ImageInfo {
  w: number;
  h: number;
  fmt: 'ktx2' | 'png' | 'jpeg' | 'webp' | 'unknown';
}

export function imageSize(b: Buffer): ImageInfo {
  if (b.length >= 28 && b.subarray(0, 12).equals(KTX2_ID)) return { w: b.readUInt32LE(20), h: b.readUInt32LE(24), fmt: 'ktx2' };
  if (b.length >= 24 && b.readUInt32BE(0) === 0x89504e47) return { w: b.readUInt32BE(16), h: b.readUInt32BE(20), fmt: 'png' };
  if (b.length >= 4 && b[0] === 0xff && b[1] === 0xd8) {
    let o = 2;
    while (o + 9 < b.length) {
      if (b[o] !== 0xff) {
        o++;
        continue;
      }
      const m = b[o + 1]!;
      if (m >= 0xc0 && m <= 0xcf && m !== 0xc4 && m !== 0xc8 && m !== 0xcc) return { h: b.readUInt16BE(o + 5), w: b.readUInt16BE(o + 7), fmt: 'jpeg' };
      if (m === 0xd8 || m === 0x01 || (m >= 0xd0 && m <= 0xd7) || m === 0xff) {
        o += m === 0xff ? 1 : 2;
        continue;
      }
      o += 2 + b.readUInt16BE(o + 2);
    }
    return { w: 0, h: 0, fmt: 'jpeg' };
  }
  if (b.length >= 30 && b.toString('ascii', 0, 4) === 'RIFF' && b.toString('ascii', 8, 12) === 'WEBP') {
    const chunk = b.toString('ascii', 12, 16);
    if (chunk === 'VP8 ') return { w: b.readUInt16LE(26) & 0x3fff, h: b.readUInt16LE(28) & 0x3fff, fmt: 'webp' };
    if (chunk === 'VP8L') {
      const bits = b.readUInt32LE(21);
      return { w: (bits & 0x3fff) + 1, h: ((bits >>> 14) & 0x3fff) + 1, fmt: 'webp' };
    }
    if (chunk === 'VP8X') return { w: 1 + b.readUIntLE(24, 3), h: 1 + b.readUIntLE(27, 3), fmt: 'webp' };
  }
  return { w: 0, h: 0, fmt: 'unknown' };
}

/** Sizes of every image embedded in a GLB (bufferView or data: URI). */
export function glbImages(g: Glb): (ImageInfo & { name: string })[] {
  const out: (ImageInfo & { name: string })[] = [];
  const buffers = g.json.buffers ?? [];
  let binIndex = buffers.findIndex((b) => !b.uri && !b.extensions?.EXT_meshopt_compression?.fallback);
  if (binIndex < 0) binIndex = 0;
  (g.json.images ?? []).forEach((img, i) => {
    let bytes: Buffer | null = null;
    if (img.bufferView !== undefined && g.bin) {
      const bv = g.json.bufferViews![img.bufferView]!;
      if (bv.buffer === binIndex) bytes = g.bin.subarray(bv.byteOffset ?? 0, (bv.byteOffset ?? 0) + bv.byteLength);
    } else if (img.uri?.startsWith('data:')) {
      bytes = Buffer.from(img.uri.slice(img.uri.indexOf(',') + 1), 'base64');
    }
    const info = bytes ? imageSize(bytes) : { w: 0, h: 0, fmt: 'unknown' as const };
    out.push({ ...info, name: img.name ?? `image${i}` });
  });
  return out;
}

function nodeNames(g: Glb): Set<string> {
  return new Set((g.json.nodes ?? []).map((n) => n.name ?? ''));
}

function jointNames(g: Glb): Set<string> {
  const s = new Set<string>();
  for (const skin of g.json.skins ?? []) for (const j of skin.joints) s.add(g.json.nodes?.[j]?.name ?? '');
  return s;
}

// ------------------------------------------------------------------------------ verification
function isVec3(v: unknown): v is Vec3Tuple {
  return Array.isArray(v) && v.length === 3 && v.every((x) => typeof x === 'number' && Number.isFinite(x) && Math.abs(x) < 4);
}

function* walk(dir: string): Generator<string> {
  if (!fs.existsSync(dir)) return;
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) yield* walk(p);
    else yield p;
  }
}

function stripComments(src: string): string {
  return src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:'"`\\])\/\/.*$/gm, '$1');
}

/** Matches a quoted/templated path that points into the source Assets/ tree. */
const SOURCE_REF = /["'`(]\s*\.{0,2}\/?Assets\/[^"'`)]*/;

export interface VerifyOptions {
  /** Hash every source file (default true). */
  hashSources?: boolean;
  log?: (line: string) => void;
}

export async function verifyAssets(opt: VerifyOptions = {}): Promise<CheckResult[]> {
  const results: CheckResult[] = [];
  const add = (section: keyof typeof SECTIONS, level: Level, message: string) => results.push({ section: SECTIONS[section], level, message });
  const log = opt.log ?? (() => undefined);

  const manifestPath = path.join(OUT_ROOT, 'manifest.json');
  if (!fs.existsSync(manifestPath)) {
    add('required', 'FAIL', `runtime manifest missing (${path.relative(ROOT, manifestPath)}); run npm run assets:build`);
    return results;
  }
  const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8')) as RuntimeManifest;
  const entries = manifest.entries;

  // 1. Required runtime assets (and every listed runtime file) exist.
  const registryRequired = ASSET_REGISTRY.filter((a) => a.required).map((a) => a.id).sort();
  const clientRequired = [...REQUIRED_RUNTIME_ASSETS].sort();
  if (JSON.stringify(registryRequired) !== JSON.stringify(clientRequired)) add('required', 'FAIL', `client required list (config/runtimeAssets.ts) differs from the registry: ${registryRequired.filter((x) => !clientRequired.includes(x)).concat(clientRequired.filter((x) => !registryRequired.includes(x))).join(', ')}`);
  const glbCache = new Map<string, Glb>();
  const loadGlb = (rel: string): Glb => {
    let g = glbCache.get(rel);
    if (!g) {
      g = parseGlb(fs.readFileSync(path.join(OUT_ROOT, rel)));
      glbCache.set(rel, g);
    }
    return g;
  };
  let missingFiles = 0;
  for (const def of ASSET_REGISTRY) {
    const e = entries[def.id];
    if (!e) {
      add('required', def.required ? 'FAIL' : 'WARN', `${def.id} missing from the runtime manifest${def.required ? '' : ' (optional; degrades)'}`);
      continue;
    }
    if (e.required !== def.required) add('required', 'FAIL', `${def.id}: manifest required=${e.required} but registry says ${def.required}`);
    for (const [role, rel] of Object.entries(e.files)) {
      const abs = path.join(OUT_ROOT, rel);
      if (!fs.existsSync(abs) || fs.statSync(abs).size === 0) {
        missingFiles++;
        add('required', def.required ? 'FAIL' : 'WARN', `${def.id}.${role}: runtime file missing or empty (${rel})`);
        continue;
      }
      const data = fs.readFileSync(abs);
      const m = /\.([0-9a-f]{10})\.[a-z0-9]+$/.exec(rel);
      if (!m) add('integrity', 'FAIL', `${def.id}.${role}: file name carries no content hash (${rel})`);
      else if (sha256(data).slice(0, 10) !== m[1]) add('integrity', 'FAIL', `${def.id}.${role}: content does not match its hashed name (${rel})`);
      if (rel.endsWith('.glb')) {
        try {
          loadGlb(rel);
        } catch (err) {
          add('required', def.required ? 'FAIL' : 'WARN', `${def.id}.${role}: GLB unreadable: ${(err as Error).message}`);
        }
      }
    }
  }
  const presentRequired = registryRequired.filter((id) => entries[id]);
  add('required', 'PASS', `${presentRequired.length}/${registryRequired.length} required runtime assets present; ${Object.keys(entries).length} entries total; ${missingFiles} missing files`);
  for (const f of ['basis/basis_transcoder.js', 'basis/basis_transcoder.wasm']) {
    if (!fs.existsSync(path.join(OUT_ROOT, f))) add('required', 'FAIL', `KTX2 transcoder ${f} missing from runtime-assets`);
  }
  if (!results.some((r) => r.section === SECTIONS.integrity && r.level === 'FAIL')) add('integrity', 'PASS', 'every runtime file matches the content hash in its name');
  log('  required assets + integrity checked');

  // 2. Source hashes recorded (and still matching Assets/; the handoff audit record is cross-checked).
  const handoffPath = path.join(ROOT, 'ASSET_MANIFEST.json');
  const handoff = fs.existsSync(handoffPath) ? (JSON.parse(fs.readFileSync(handoffPath, 'utf8')) as { assets: { sourcePath: string; sha256: string }[] }) : { assets: [] };
  const handoffSha = new Map(handoff.assets.map((a) => [a.sourcePath, a.sha256]));
  const sourceTexMax = new Map<string, number>();
  const hashed = new Map<string, string>();
  let recorded = 0;
  for (const def of ASSET_REGISTRY) {
    const e = entries[def.id];
    if (!e) continue;
    const recordedPaths = new Set(e.source.map((s) => s.path));
    for (const s of def.sources) if (!recordedPaths.has(s)) add('hashes', 'FAIL', `${def.id}: source ${s} not recorded in the runtime manifest`);
    for (const s of e.source) {
      if (!/^[0-9a-f]{64}$/.test(s.sha256)) {
        add('hashes', 'FAIL', `${def.id}: source ${s.path} has no SHA-256 recorded`);
        continue;
      }
      recorded++;
      if (opt.hashSources === false) continue;
      const abs = path.join(ROOT, s.path);
      if (!fs.existsSync(abs)) {
        add('hashes', def.required ? 'FAIL' : 'WARN', `${def.id}: source ${s.path} is missing from Assets/`);
        continue;
      }
      let h = hashed.get(s.path);
      if (!h) {
        const buf = fs.readFileSync(abs);
        h = sha256(buf);
        hashed.set(s.path, h);
        if (s.path.toLowerCase().endsWith('.glb')) {
          try {
            sourceTexMax.set(s.path, Math.max(0, ...glbImages(parseGlb(buf)).map((i) => Math.max(i.w, i.h))));
          } catch {
            sourceTexMax.set(s.path, 0);
          }
        }
      }
      if (h !== s.sha256) add('hashes', 'FAIL', `${def.id}: ${s.path} changed since the runtime build (rerun npm run assets:build)`);
      const ho = handoffSha.get(s.path);
      if (ho && ho !== h) add('hashes', 'WARN', `${s.path} differs from the handoff ASSET_MANIFEST record`);
    }
  }
  if (!results.some((r) => r.section === SECTIONS.hashes && r.level === 'FAIL')) add('hashes', 'PASS', `${recorded} source hashes recorded${opt.hashSources === false ? '' : `; ${hashed.size} unique sources re-hashed and match; ${[...hashed.keys()].filter((p) => handoffSha.has(p)).length} also match the handoff audit`}`);
  log('  source hashes checked');

  // 3. Required animation clips.
  let clipOk = 0;
  for (const id of Object.values(CLIP_IDS)) {
    const def = ASSET_REGISTRY.find((a) => a.id === id)!;
    const e = entries[id];
    if (!e?.files.clip || !e.clip) {
      add('clips', def.required ? 'FAIL' : 'WARN', `${id}: clip missing`);
      continue;
    }
    try {
      const c = JSON.parse(fs.readFileSync(path.join(OUT_ROOT, e.files.clip), 'utf8')) as { fps: number; duration: number; bones: string[]; frames: number[][][]; hips: number[][] };
      const missing = SEMANTIC_BONES.filter((b) => !c.bones.includes(b));
      if (!(c.duration > 0) || !(c.fps > 0)) throw new Error(`bad timing (duration ${c.duration}, fps ${c.fps})`);
      if (c.frames.length < 2 || c.frames.length !== c.hips.length || c.frames.length !== e.clip.frames) throw new Error(`frame count mismatch (${c.frames.length} frames, ${c.hips.length} hips, manifest ${e.clip.frames})`);
      if (c.frames.some((f) => f.length !== c.bones.length || f.some((q) => q.length !== 4 || q.some((x) => !Number.isFinite(x))))) throw new Error('malformed rotation keys');
      if (missing.length) throw new Error(`missing semantic bones ${missing.join(', ')}`);
      clipOk++;
    } catch (err) {
      add('clips', def.required ? 'FAIL' : 'WARN', `${id}: ${(err as Error).message}`);
    }
  }
  const oni = entries['starter.oni'];
  if (oni?.starter && oni.files.lod0) {
    const anims = (loadGlb(oni.files.lod0).json.animations ?? []).map((a) => a.name);
    if (!anims.includes(oni.starter.clip)) add('clips', 'FAIL', `starter.oni: intro clip "${oni.starter.clip}" not found (has ${anims.join(', ') || 'none'})`);
    else clipOk++;
  } else add('clips', 'FAIL', 'starter.oni: starter info missing');
  if (!results.some((r) => r.section === SECTIONS.clips && r.level === 'FAIL')) add('clips', 'PASS', `${clipOk} clips valid (semantic-skeleton clips + Cyborg Oni intro)`);

  // 4. No KHR_materials_pbrSpecularGlossiness anywhere in runtime GLBs; required extensions supported.
  let glbCount = 0;
  for (const [id, e] of Object.entries(entries)) {
    for (const [role, rel] of Object.entries(e.files)) {
      if (!rel.endsWith('.glb') || !fs.existsSync(path.join(OUT_ROOT, rel))) continue;
      glbCount++;
      const j = loadGlb(rel).json;
      const specGloss = 'KHR_materials_pbrSpecularGlossiness';
      if ((j.extensionsUsed ?? []).includes(specGloss) || (j.materials ?? []).some((m) => m.extensions && specGloss in m.extensions)) add('specGloss', e.required ? 'FAIL' : 'WARN', `${id}.${role}: still uses ${specGloss}`);
      const unsupported = (j.extensionsRequired ?? []).filter((x) => !SUPPORTED_REQUIRED_EXT.has(x));
      if (unsupported.length) add('specGloss', 'FAIL', `${id}.${role}: requires unsupported extension(s) ${unsupported.join(', ')}`);
    }
  }
  if (!results.some((r) => r.section === SECTIONS.specGloss && r.level !== 'PASS')) add('specGloss', 'PASS', `${glbCount} runtime GLBs are metal-rough only with supported required extensions`);

  // 5. Bike mount targets.
  for (const [bikeId, assetId] of Object.entries(BIKE_ASSET)) {
    const b = entries[assetId]?.bike;
    if (!b) {
      add('mounts', 'FAIL', `${bikeId}: bike runtime info missing`);
      continue;
    }
    const m = b.mount;
    const problems: string[] = [];
    const vecs = ['seatTarget', 'leftGripTarget', 'rightGripTarget', 'leftFootTarget', 'rightFootTarget', 'mountEntryPoint', 'recoveryApproachPoint'] as const;
    for (const k of vecs) if (!isVec3(m?.[k])) problems.push(`${k} missing/invalid`);
    if (!problems.length) {
      const seat = m.seatTarget;
      if (seat[1] < 0.3 || seat[1] > b.height + b.hoverHeight + 0.5) problems.push(`seat height ${seat[1]} implausible`);
      if (!(m.leftGripTarget[0] > 0 && m.rightGripTarget[0] < 0 && m.leftFootTarget[0] > 0 && m.rightFootTarget[0] < 0)) problems.push('left/right targets not on their sides (+X is rider-left)');
      if (!(m.leftGripTarget[2] > seat[2] && m.rightGripTarget[2] > seat[2])) problems.push('grips not ahead of the seat');
      if (!(m.leftFootTarget[1] < seat[1] && m.rightFootTarget[1] < seat[1])) problems.push('pegs not below the seat');
      if ((m.mountSide === 'left') !== m.mountEntryPoint[0] > 0) problems.push('mount entry point not on the mount side');
      if (!['left', 'right'].includes(m.mountSide)) problems.push('mountSide invalid');
      if (!['sport', 'cruiser', 'prone', 'hover', 'monowheel'].includes(m.profile)) problems.push('profile invalid');
      if (!Number.isFinite(m.ridingSpineLean) || !Number.isFinite(m.ridingHipRotation)) problems.push('riding pose angles missing');
    }
    if (problems.length) add('mounts', 'FAIL', `${bikeId}: ${problems.join('; ')}`);
    else add('mounts', 'PASS', `${bikeId} (${m.profile}): seat ${m.seatTarget.join(',')} grips ±${Math.abs(m.leftGripTarget[0])} pegs ±${Math.abs(m.leftFootTarget[0])}, mount ${m.mountSide}`);
  }

  // 6. Rider (and rigged crowd) retarget maps resolve to skin joints in every LOD.
  const checkMap = (label: string, e: ManifestEntry, map: Record<string, string>, required: boolean, extra: string[]) => {
    const missing = SEMANTIC_BONES.filter((b) => !map[b]);
    const problems: string[] = [];
    if (missing.length) problems.push(`unmapped semantic bones: ${missing.join(', ')}`);
    for (const [role, rel] of Object.entries(e.files)) {
      if (!rel.endsWith('.glb')) continue;
      const g = loadGlb(rel);
      const joints = jointNames(g), names = nodeNames(g);
      const bad = Object.entries(map).filter(([, n]) => !joints.has(n)).map(([s, n]) => `${s}->${n}`);
      if (bad.length) problems.push(`${role}: not skin joints: ${bad.join(', ')}`);
      for (const x of extra) if (!names.has(x)) problems.push(`${role}: node ${x} missing`);
    }
    if (problems.length) add('retarget', required ? 'FAIL' : 'WARN', `${label}: ${problems.join('; ')}`);
    else add('retarget', 'PASS', `${label}: ${Object.keys(map).length} bones mapped, all resolve in ${Object.values(e.files).filter((f) => f.endsWith('.glb')).length} LOD(s)`);
  };
  for (const [riderId, assetId] of Object.entries(RIDER_ASSET)) {
    const e = entries[assetId];
    if (!e?.rider) {
      add('retarget', 'FAIL', `${riderId}: rider runtime info missing`);
      continue;
    }
    checkMap(riderId, e, e.rider.retargetMap, true, [e.rider.handBone]);
  }
  for (const [id, e] of Object.entries(entries)) {
    if (e.crowd?.rigged) checkMap(id, e, e.crowd.retargetMap, false, []);
  }

  // 7. The production client never references a source asset path.
  const clientDirs = ['client', 'render', 'input', 'audio', 'ui', 'network', 'physics', 'shared', 'game'].map((d) => path.join(ROOT, 'src', d));
  const offenders: string[] = [];
  for (const dir of clientDirs) {
    for (const f of walk(dir)) {
      if (!/\.(ts|js|css|html)$/.test(f)) continue;
      if (SOURCE_REF.test(stripComments(fs.readFileSync(f, 'utf8')))) offenders.push(path.relative(ROOT, f));
    }
  }
  const clientImportsRegistry: string[] = [];
  for (const dir of clientDirs) {
    for (const f of walk(dir)) {
      if (f.endsWith('.ts') && /import\s*\{[^}]*\bASSET_REGISTRY\b[^}]*\}\s*from/.test(fs.readFileSync(f, 'utf8'))) clientImportsRegistry.push(path.relative(ROOT, f));
    }
  }
  if (fs.existsSync(path.join(ROOT, 'index.html')) && SOURCE_REF.test(fs.readFileSync(path.join(ROOT, 'index.html'), 'utf8'))) offenders.push('index.html');
  for (const f of walk(path.join(ROOT, 'public'))) {
    if (f.startsWith(OUT_ROOT)) continue;
    if (/\.(js|html|json|webmanifest|css)$/.test(f) && SOURCE_REF.test(fs.readFileSync(f, 'utf8'))) offenders.push(path.relative(ROOT, f));
  }
  const distClient = path.join(ROOT, 'dist', 'client');
  let bundleNote = 'production bundle not built yet (npm run build) — source-level check only';
  if (fs.existsSync(distClient)) {
    let files = 0;
    for (const f of walk(distClient)) {
      if (f.includes(`${path.sep}runtime-assets${path.sep}`)) continue;
      if (!/\.(js|html|css|json|webmanifest)$/.test(f)) continue;
      files++;
      if (/(^|[^A-Za-z-])Assets\//.test(fs.readFileSync(f, 'utf8'))) offenders.push(path.relative(ROOT, f));
    }
    bundleNote = `${files} built client files scanned`;
  }
  const viteCfg = fs.readFileSync(path.join(ROOT, 'vite.config.ts'), 'utf8');
  if (!viteCfg.includes("'Assets/**'")) offenders.push('vite.config.ts (dev server does not deny Assets/**)');
  if (clientImportsRegistry.length) offenders.push(...clientImportsRegistry.map((f) => `${f} (imports ASSET_REGISTRY source paths)`));
  if (offenders.length) add('sourcePaths', 'FAIL', `source asset paths referenced by: ${offenders.join(', ')}`);
  else add('sourcePaths', 'PASS', `no Assets/ references in client source, public/ or index.html; Vite denies Assets/**; ${bundleNote}`);

  // 8. Texture size rules.
  let texChecked = 0;
  for (const [id, e] of Object.entries(entries)) {
    const def = ASSET_REGISTRY.find((a) => a.id === id);
    const srcMax = Math.max(0, ...e.source.map((s) => sourceTexMax.get(s.path) ?? 0));
    const heavy = srcMax >= HEAVY_SOURCE_TEXTURE;
    let runtimeMax = 0;
    const formats = new Set<string>();
    const problems: string[] = [];
    for (const [role, rel] of Object.entries(e.files)) {
      const abs = path.join(OUT_ROOT, rel);
      if (!fs.existsSync(abs)) continue;
      const imgs = rel.endsWith('.glb') ? glbImages(loadGlb(rel)) : rel.endsWith('.ktx2') || rel.endsWith('.png') || rel.endsWith('.webp') || rel.endsWith('.jpg') ? [{ ...imageSize(fs.readFileSync(abs)), name: role }] : [];
      for (const im of imgs) {
        texChecked++;
        formats.add(im.fmt);
        runtimeMax = Math.max(runtimeMax, im.w, im.h);
        if (im.fmt === 'unknown' || im.w === 0) problems.push(`${role}/${im.name}: unreadable image`);
        if (im.w > MAX_RUNTIME_TEXTURE || im.h > MAX_RUNTIME_TEXTURE) problems.push(`${role}/${im.name}: ${im.w}x${im.h} exceeds ${MAX_RUNTIME_TEXTURE}`);
        if (heavy && im.fmt !== 'ktx2') problems.push(`${role}/${im.name}: heavy-source texture shipped as ${im.fmt}, not KTX2`);
      }
    }
    if (e.maxTextureSize && runtimeMax && e.maxTextureSize !== runtimeMax) problems.push(`manifest records max ${e.maxTextureSize} but files contain ${runtimeMax}`);
    if (problems.length) add('textures', def?.required ? 'FAIL' : 'WARN', `${id}: ${problems.join('; ')}`);
    else if (heavy) add('textures', 'PASS', `${id}: heavy source (${srcMax}px) -> runtime max ${runtimeMax || 'none'}px ${[...formats].join('/') || 'untextured'}`);
  }
  if (!results.some((r) => r.section === SECTIONS.textures && r.level === 'FAIL')) add('textures', 'PASS', `${texChecked} runtime textures inspected; all ≤ ${MAX_RUNTIME_TEXTURE}px; heavy sources are KTX2-compressed`);

  // 9. Nodes/clips the runtime depends on (wheels, steering, boost, weapon segments/chains).
  for (const [bikeId, assetId] of Object.entries(BIKE_ASSET)) {
    const e = entries[assetId];
    if (!e?.bike || !e.files.lod0) continue;
    const g = loadGlb(e.files.lod0);
    const names = nodeNames(g);
    const anims = (g.json.animations ?? []).map((a) => a.name);
    const need = [...e.bike.wheels.map((w) => w.node), ...e.bike.steerNodes, ...e.bike.spinNodes.map((s) => s.node), ...(e.bike.boostNode ? [e.bike.boostNode] : [])];
    const missing = need.filter((n) => !names.has(n));
    // "*" = every bundled clip loops (BikeActor plays all GLB animations).
    if (e.bike.idleClip === '*' ? anims.length === 0 : e.bike.idleClip && !anims.includes(e.bike.idleClip)) missing.push(`clip ${e.bike.idleClip}`);
    if (missing.length) add('gameplayNodes', 'FAIL', `${bikeId}: missing ${missing.join(', ')}`);
    else add('gameplayNodes', 'PASS', `${bikeId}: ${e.bike.wheels.length} wheels, ${e.bike.steerNodes.length} steer, ${e.bike.spinNodes.length} spin nodes${e.bike.idleClip ? `, idle clip${e.bike.idleClip === '*' ? `s ${anims.join('/')}` : ` "${e.bike.idleClip}"`}` : ''}${e.bike.boostNode ? `, boost node ${e.bike.boostNode}` : ''}`);
  }
  for (const [weaponId, assetId] of Object.entries(WEAPON_ASSET)) {
    const e = entries[assetId];
    if (!e?.weapon || !e.files.lod0) {
      add('gameplayNodes', 'FAIL', `${weaponId}: weapon runtime info missing`);
      continue;
    }
    const names = nodeNames(loadGlb(e.files.lod0));
    const need = [...e.weapon.segments, ...e.weapon.chainBones, ...(e.weapon.ballNode ? [e.weapon.ballNode] : []), ...(e.weapon.tipNode ? [e.weapon.tipNode] : [])];
    const missing = need.filter((n) => !names.has(n));
    if (weaponId === 'ZABIMARU' && e.weapon.segments.length < 4) missing.push('segmented blade (need >= 4 segments for retract/extend)');
    if (weaponId === 'MORNING_STAR' && (!e.weapon.ballNode || e.weapon.chainBones.length < 2)) missing.push('chain + ball');
    if (missing.length) add('gameplayNodes', 'FAIL', `${weaponId}: missing ${missing.join(', ')}`);
    else add('gameplayNodes', 'PASS', `${weaponId}: length ${e.weapon.length} m${e.weapon.segments.length ? `, ${e.weapon.segments.length} segments` : ''}${e.weapon.chainBones.length ? `, ${e.weapon.chainBones.length}-link chain + ball` : ''}`);
  }
  return results;
}

export function summarize(results: CheckResult[]): { section: string; level: Level; pass: number; warn: number; fail: number }[] {
  return Object.values(SECTIONS).map((section) => {
    const rs = results.filter((r) => r.section === section);
    const fail = rs.filter((r) => r.level === 'FAIL').length;
    const warn = rs.filter((r) => r.level === 'WARN').length;
    return { section, level: fail ? 'FAIL' : rs.length ? (warn && !rs.some((r) => r.level === 'PASS') ? 'WARN' : 'PASS') : 'FAIL', pass: rs.filter((r) => r.level === 'PASS').length, warn, fail };
  });
}

async function main(): Promise<void> {
  const t0 = Date.now();
  console.log('Pizzeria Roadrash assets:verify');
  const results = await verifyAssets({ log: (l) => console.log(l) });
  let current = '';
  for (const r of results) {
    if (r.section !== current) {
      current = r.section;
      console.log(`\n${current}`);
    }
    console.log(`  ${r.level === 'PASS' ? 'PASS' : r.level === 'WARN' ? 'WARN' : 'FAIL'}  ${r.message}`);
  }
  const sum = summarize(results);
  console.log('\nSummary');
  for (const s of sum) console.log(`  ${s.level.padEnd(4)}  ${s.section}${s.warn ? ` (${s.warn} warning${s.warn > 1 ? 's' : ''})` : ''}`);
  const failed = sum.filter((s) => s.level === 'FAIL');
  console.log(`\n${failed.length ? `FAIL: ${failed.length} section(s) failed` : 'OK: all asset verification checks passed'} in ${((Date.now() - t0) / 1000).toFixed(1)} s`);
  process.exit(failed.length ? 1 : 0);
}

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  main().catch((e) => {
    console.error('assets:verify crashed', e);
    process.exit(1);
  });
}
