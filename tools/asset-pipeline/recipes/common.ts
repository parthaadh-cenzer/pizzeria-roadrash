// Shared recipe runner for model assets.
import type { Document } from '@gltf-transform/core';
import { cloneDocument } from '@gltf-transform/functions';
import fs from 'node:fs';
import path from 'node:path';
import * as THREE from 'three';
import { ASSET_REGISTRY, type AssetCategory } from '../../../src/config/assets.js';
import type { ManifestEntry } from '../../../src/shared/manifest.js';
import { cacheGet, cachePut, hashFile, log, readSource, recipeKey, ROOT, writeGlb, writeOutput } from '../lib/core.js';
import { convertSpecGloss, countTriangles, dropAnimations, finalize, groundCentreTranslation, measure, normalizeRoot, simplifyDoc, type Measurement } from '../lib/gltfOps.js';
import { tintMask, type MaskKind } from '../lib/masks.js';
import { compressTextures, encodeImageKtx2 } from '../lib/textures.js';

export interface NormalizeSpec {
  q: THREE.Quaternion;
  scale: number | [number, number, number];
  groundY?: number;
  /** Explicit translation (overrides ground/centre computation). */
  translate?: [number, number, number];
}

export interface ModelSpec {
  id: string;
  dir: string;
  source: string;
  codeHash: string;
  textureMax: number;
  perTexture?: Parameters<typeof compressTextures>[3];
  keepAnimations?: (name: string) => boolean;
  prepare?: (doc: Document) => Promise<string[] | void> | string[] | void;
  normalize: (m: Measurement) => NormalizeSpec;
  measureHide?: RegExp;
  simplify?: { ratio: number; error: number; dropNormals?: boolean; sloppy?: boolean };
  post?: (doc: Document) => Promise<string[] | void> | string[] | void;
  masks?: { material: string; kind: MaskKind }[];
  lod1?: { ratio: number; error: number; textureMax: number; dropNormals?: boolean; sloppy?: boolean };
  describe: (m: Measurement, doc: Document) => Partial<ManifestEntry> | Promise<Partial<ManifestEntry>>;
  /** Cheap, uncached decoration from config (runs every build, after the cached heavy step). */
  decorate?: (entry: ManifestEntry) => void;
}

export function sourceInfo(rels: string[]): ManifestEntry['source'] {
  return rels.map((rel) => {
    const abs = path.join(ROOT, rel);
    return { path: rel, sha256: hashFile(abs), bytes: fs.statSync(abs).size };
  });
}

export function registryDef(id: string): { category: AssetCategory; required: boolean } {
  const d = ASSET_REGISTRY.find((a) => a.id === id);
  if (!d) throw new Error(`Asset ${id} is not in ASSET_REGISTRY`);
  return d;
}

function allFiles(entry: ManifestEntry): string[] {
  return Object.values(entry.files);
}

export async function processModel(spec: ModelSpec): Promise<ManifestEntry> {
  const key = recipeKey([spec.id, hashFile(path.join(ROOT, spec.source)), spec.codeHash]);
  const cached = cacheGet<ManifestEntry>(spec.id, key);
  if (cached) {
    log.step(spec.id, 'cached');
    spec.decorate?.(cached);
    return cached;
  }
  const t0 = Date.now();
  const doc = await readSource(spec.source);
  const notes: string[] = [];
  await convertSpecGloss(doc, spec.id);
  // Filter clips by their source names before prepare() may rename the kept ones.
  dropAnimations(doc, spec.keepAnimations);
  const pn = await spec.prepare?.(doc);
  if (pn) notes.push(...pn);
  const m0 = await measure(doc, { hide: spec.measureHide });
  const n = spec.normalize(m0);
  const translate = n.translate ?? groundCentreTranslation(m0, n.q, n.scale, n.groundY ?? 0);
  normalizeRoot(doc, { q: n.q, scale: n.scale, translate });
  if (spec.simplify) {
    const before = Math.round((await measure(doc)).triangles);
    await simplifyDoc(doc, spec.simplify.ratio, spec.simplify.error, { dropNormals: spec.simplify.dropNormals, sloppy: spec.simplify.sloppy });
    notes.push(`LOD0 simplified ${before} -> ${countTriangles(doc)} triangles`);
  }
  const post = await spec.post?.(doc);
  if (post) notes.push(...post);

  const files: Record<string, string> = {};
  for (const mk of spec.masks ?? []) {
    const mat = doc.getRoot().listMaterials().find((m) => m.getName() === mk.material);
    const tex = mat?.getBaseColorTexture();
    const img = tex?.getImage();
    if (!img) {
      log.warn(spec.id, `mask source material ${mk.material} has no base colour texture`);
      continue;
    }
    const { png, coverage } = await tintMask(img, mk.kind);
    const ktx = await encodeImageKtx2(new Uint8Array(png), 512, 'data');
    files[`mask:${mk.material}`] = writeOutput(spec.dir, `${spec.id}.mask.${mk.material.replace(/[^a-z0-9]/gi, '_')}`, 'ktx2', ktx);
    notes.push(`tint mask ${mk.material} (${mk.kind}) coverage ${(coverage * 100).toFixed(1)}%`);
  }

  const m1 = await measure(doc, { perMesh: true });
  const described = await spec.describe(m1, doc);
  const lodDoc = spec.lod1 ? cloneDocument(doc) : null;

  const tex = await compressTextures(doc, spec.id, spec.textureMax, spec.perTexture);
  await finalize(doc);
  const lod0 = await writeGlb(spec.dir, `${spec.id}.lod0`, doc);
  files.lod0 = lod0.rel;
  let bytes = lod0.bytes;
  const triangles = Math.round(m1.triangles);
  if (lodDoc && spec.lod1) {
    await simplifyDoc(lodDoc, spec.lod1.ratio, spec.lod1.error, { dropNormals: spec.lod1.dropNormals, sloppy: spec.lod1.sloppy });
    await compressTextures(lodDoc, `${spec.id}:lod1`, spec.lod1.textureMax, (t, role) => Math.min(spec.lod1!.textureMax, spec.perTexture?.(t, role) ?? spec.lod1!.textureMax));
    const lodTris = countTriangles(lodDoc);
    await finalize(lodDoc);
    const lod1 = await writeGlb(spec.dir, `${spec.id}.lod1`, lodDoc);
    files.lod1 = lod1.rel;
    bytes += lod1.bytes;
    notes.push(`LOD1 ${Math.round(lodTris)} triangles`);
  }
  for (const f of Object.keys(files)) if (f.startsWith('mask:')) bytes += fs.statSync(path.join(ROOT, 'public/runtime-assets', files[f]!)).size;

  const def = registryDef(spec.id);
  const entry: ManifestEntry = {
    id: spec.id,
    category: def.category,
    required: def.required,
    source: sourceInfo([spec.source]),
    files,
    bytes,
    triangles,
    maxTextureSize: tex.maxSize,
    textureFormat: tex.count ? 'ktx2' : 'none',
    orientation: { forward: '+Z', up: '+Y', units: 'm' },
    notes,
    ...described,
  };
  cachePut(spec.id, key, allFiles(entry), entry);
  spec.decorate?.(entry);
  log.step(spec.id, `done in ${((Date.now() - t0) / 1000).toFixed(1)}s: ${triangles} tris, ${(bytes / 1e6).toFixed(2)} MB`);
  return entry;
}

export function tuple(v: THREE.Vector3, digits = 3): [number, number, number] {
  return [+v.x.toFixed(digits), +v.y.toFixed(digits), +v.z.toFixed(digits)];
}

export function codeHashOf(...files: string[]): string {
  return files.map((f) => hashFile(path.join(ROOT, f))).join(':');
}

/** Hash of shared pipeline library + configs; any change invalidates every recipe. */
export function libHash(): string {
  const dirs = ['tools/asset-pipeline/lib', 'tools/asset-pipeline/recipes/common.ts', 'src/config/skeleton.ts', 'src/config/assets.ts', 'src/shared/manifest.ts'];
  const files: string[] = [];
  for (const d of dirs) {
    const abs = path.join(ROOT, d);
    if (fs.statSync(abs).isDirectory()) for (const f of fs.readdirSync(abs).sort()) files.push(path.join(d, f));
    else files.push(d);
  }
  return codeHashOf(...files);
}
