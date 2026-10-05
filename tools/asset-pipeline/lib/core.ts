// Pipeline core: paths, hashing, logging, glTF IO, output writing and the build cache.
import { Logger, NodeIO, type Document } from '@gltf-transform/core';
import { ALL_EXTENSIONS } from '@gltf-transform/extensions';
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { MeshoptDecoder, MeshoptEncoder } from 'meshoptimizer';

export const ROOT = path.resolve('.');
export const SOURCE_ROOT = path.join(ROOT, 'Assets');
export const OUT_ROOT = path.join(ROOT, 'public', 'runtime-assets');
export const CACHE_ROOT = path.join(ROOT, '.pipeline-cache');
export const PIPELINE_VERSION = '1.0.0';

export function sha256(buf: Uint8Array | string): string {
  return crypto.createHash('sha256').update(buf).digest('hex');
}

const fileHashCache = new Map<string, string>();
export function hashFile(p: string): string {
  const abs = path.resolve(p);
  let h = fileHashCache.get(abs);
  if (!h) {
    h = sha256(fs.readFileSync(abs));
    fileHashCache.set(abs, h);
  }
  return h;
}

let ioPromise: Promise<NodeIO> | null = null;
export function getIO(): Promise<NodeIO> {
  if (!ioPromise) {
    ioPromise = (async () => {
      await MeshoptDecoder.ready;
      await MeshoptEncoder.ready;
      return new NodeIO()
        .registerExtensions(ALL_EXTENSIONS)
        .registerDependencies({ 'meshopt.decoder': MeshoptDecoder, 'meshopt.encoder': MeshoptEncoder });
    })();
  }
  return ioPromise;
}

export async function readSource(rel: string): Promise<Document> {
  const abs = path.join(ROOT, rel);
  if (!fs.existsSync(abs)) throw new MissingSourceError(rel);
  const io = await getIO();
  const doc = await io.read(abs);
  doc.setLogger(QUIET);
  return doc;
}

export const QUIET = new Logger(Logger.Verbosity.WARN);

export class MissingSourceError extends Error {
  constructor(readonly rel: string) {
    super(`Missing required source asset: ${rel}`);
  }
}

export const log = {
  step(id: string, msg: string): void {
    console.log(`  [${id}] ${msg}`);
  },
  warn(id: string, msg: string): void {
    console.warn(`  [${id}] WARNING ${msg}`);
  },
};

/** Writes bytes under runtime-assets with a deterministic content-hashed filename. */
export function writeOutput(dir: string, base: string, ext: string, bytes: Uint8Array | string): string {
  const data = typeof bytes === 'string' ? Buffer.from(bytes, 'utf8') : bytes;
  const h = sha256(data).slice(0, 10);
  const rel = `${dir}/${base}.${h}.${ext}`;
  const abs = path.join(OUT_ROOT, rel);
  fs.mkdirSync(path.dirname(abs), { recursive: true });
  if (!fs.existsSync(abs)) fs.writeFileSync(abs, data);
  return rel;
}

export async function writeGlb(dir: string, base: string, doc: Document): Promise<{ rel: string; bytes: number }> {
  const io = await getIO();
  const glb = await io.writeBinary(doc);
  return { rel: writeOutput(dir, base, 'glb', glb), bytes: glb.byteLength };
}

// ------------------------------------------------------------------ recipe-level cache
export interface CachedResult<T> {
  key: string;
  files: string[];
  value: T;
}

export function cacheGet<T>(name: string, key: string): T | null {
  const p = path.join(CACHE_ROOT, 'recipes', `${name}.json`);
  if (!fs.existsSync(p)) return null;
  try {
    const c = JSON.parse(fs.readFileSync(p, 'utf8')) as CachedResult<T>;
    if (c.key !== key) return null;
    if (!c.files.every((f) => fs.existsSync(path.join(OUT_ROOT, f)))) return null;
    return c.value;
  } catch {
    return null;
  }
}

export function cachePut<T>(name: string, key: string, files: string[], value: T): void {
  const p = path.join(CACHE_ROOT, 'recipes', `${name}.json`);
  fs.mkdirSync(path.dirname(p), { recursive: true });
  fs.writeFileSync(p, JSON.stringify({ key, files, value } satisfies CachedResult<T>));
}

export function recipeKey(parts: (string | number | object)[]): string {
  return sha256(JSON.stringify([PIPELINE_VERSION, ...parts]));
}
