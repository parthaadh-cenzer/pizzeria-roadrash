// Texture optimisation: POT downscale to a budget, then KTX2/Basis (ETC1S for colour/data,
// UASTC for normal maps) through a worker pool. Results are cached by content hash.
import { type Document, type Texture } from '@gltf-transform/core';
import { KHRTextureBasisu } from '@gltf-transform/extensions';
import { getTextureColorSpace, listTextureSlots } from '@gltf-transform/functions';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { Worker } from 'node:worker_threads';
import sharp from 'sharp';
import { CACHE_ROOT, log, sha256 } from './core.js';

interface Job {
  id: number;
  png: Uint8Array;
  uastc: boolean;
  normal: boolean;
  srgb: boolean;
}

class KtxPool {
  private workers: Worker[] = [];
  private idle: Worker[] = [];
  private queue: { job: Job; resolve: (b: Uint8Array) => void; reject: (e: Error) => void }[] = [];
  private pending = new Map<number, { resolve: (b: Uint8Array) => void; reject: (e: Error) => void }>();
  private nextId = 1;

  constructor(size: number) {
    const script = new URL('./ktx-worker.mjs', import.meta.url);
    for (let i = 0; i < size; i++) {
      const w = new Worker(script);
      w.on('message', (m: { id: number; ok: boolean; data?: Uint8Array; error?: string }) => {
        const p = this.pending.get(m.id);
        this.pending.delete(m.id);
        this.idle.push(w);
        if (p) {
          if (m.ok && m.data) p.resolve(new Uint8Array(m.data));
          else p.reject(new Error(m.error ?? 'KTX2 encode failed'));
        }
        this.pump();
      });
      w.on('error', (e: Error) => {
        for (const p of this.pending.values()) p.reject(e);
        this.pending.clear();
      });
      this.workers.push(w);
      this.idle.push(w);
    }
  }

  encode(png: Uint8Array, uastc: boolean, normal: boolean, srgb: boolean): Promise<Uint8Array> {
    return new Promise((resolve, reject) => {
      this.queue.push({ job: { id: this.nextId++, png, uastc, normal, srgb }, resolve, reject });
      this.pump();
    });
  }

  private pump(): void {
    while (this.idle.length && this.queue.length) {
      const w = this.idle.pop()!;
      const { job, resolve, reject } = this.queue.shift()!;
      this.pending.set(job.id, { resolve, reject });
      w.postMessage(job);
    }
  }

  async close(): Promise<void> {
    await Promise.all(this.workers.map((w) => w.terminate()));
  }
}

let pool: KtxPool | null = null;
function getPool(): KtxPool {
  if (!pool) pool = new KtxPool(Math.max(2, Math.min(16, os.cpus().length - 2)));
  return pool;
}
export async function closeTexturePool(): Promise<void> {
  if (pool) await pool.close();
  pool = null;
}

export type TextureRole = 'color' | 'normal' | 'data';

export function textureRole(tex: Texture): TextureRole {
  const slots = listTextureSlots(tex);
  if (slots.some((s) => /normal/i.test(s))) return 'normal';
  const cs = getTextureColorSpace(tex);
  return cs === 'srgb' ? 'color' : 'data';
}

function pot(n: number): number {
  return Math.pow(2, Math.round(Math.log2(Math.max(4, n))));
}

export interface TextureStats {
  count: number;
  maxSize: number;
  bytes: number;
}

/** Downscales and converts textures in a document to KTX2. Returns stats. */
export async function compressTextures(
  doc: Document,
  id: string,
  maxSize: number,
  perTexture?: (tex: Texture, role: TextureRole) => number | undefined,
): Promise<TextureStats> {
  const textures = doc.getRoot().listTextures();
  let maxOut = 0;
  let bytes = 0;
  const tasks = textures.map(async (tex) => {
    const img = tex.getImage();
    if (!img) return;
    if (tex.getMimeType() === 'image/ktx2') {
      bytes += img.byteLength;
      return;
    }
    const role = textureRole(tex);
    const meta = await sharp(img).metadata();
    const srcW = meta.width ?? 1024, srcH = meta.height ?? 1024;
    const limit = perTexture?.(tex, role) ?? maxSize;
    const w = Math.min(pot(srcW), limit), h = Math.min(pot(srcH), limit);
    maxOut = Math.max(maxOut, w, h);
    const uastc = role === 'normal';
    const key = sha256(img).slice(0, 24) + `_${w}x${h}_${role}`;
    const cachePath = path.join(CACHE_ROOT, 'ktx2', `${key}.ktx2`);
    let out: Uint8Array;
    if (fs.existsSync(cachePath)) out = new Uint8Array(fs.readFileSync(cachePath));
    else {
      const png = await sharp(img).resize(w, h, { fit: 'fill', kernel: 'lanczos3' }).png({ compressionLevel: 1 }).toBuffer();
      out = await getPool().encode(new Uint8Array(png), uastc, role === 'normal', role === 'color');
      fs.mkdirSync(path.dirname(cachePath), { recursive: true });
      fs.writeFileSync(cachePath, out);
    }
    tex.setImage(out);
    tex.setMimeType('image/ktx2');
    if (tex.getURI()) tex.setURI(tex.getURI().replace(/\.(png|jpe?g|webp)$/i, '.ktx2'));
    bytes += out.byteLength;
  });
  await Promise.all(tasks);
  if (textures.length) doc.createExtension(KHRTextureBasisu).setRequired(true);
  log.step(id, `textures: ${textures.length} -> KTX2 (max ${maxOut}px, ${(bytes / 1e6).toFixed(2)} MB)`);
  return { count: textures.length, maxSize: maxOut, bytes };
}

/** Standalone image -> KTX2 (for extracted/generated textures). */
export async function encodeImageKtx2(img: Uint8Array, size: number, role: TextureRole): Promise<Uint8Array> {
  const key = sha256(img).slice(0, 24) + `_${size}_${role}_raw`;
  const cachePath = path.join(CACHE_ROOT, 'ktx2', `${key}.ktx2`);
  if (fs.existsSync(cachePath)) return new Uint8Array(fs.readFileSync(cachePath));
  const meta = await sharp(img).metadata();
  const w = Math.min(pot(meta.width ?? size), size), h = Math.min(pot(meta.height ?? size), size);
  const png = await sharp(img).resize(w, h, { fit: 'fill' }).png({ compressionLevel: 1 }).toBuffer();
  const out = await getPool().encode(new Uint8Array(png), role === 'normal', role === 'normal', role === 'color');
  fs.mkdirSync(path.dirname(cachePath), { recursive: true });
  fs.writeFileSync(cachePath, out);
  return out;
}
