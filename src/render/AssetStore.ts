// Runtime asset loading from public/runtime-assets (never from Assets/). Required gameplay
// assets fail explicitly; optional cosmetic assets degrade with a warning. Real progress.
import * as THREE from 'three';
import { GLTFLoader, type GLTF } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { KTX2Loader } from 'three/examples/jsm/loaders/KTX2Loader.js';
import { MeshoptDecoder } from 'three/examples/jsm/libs/meshopt_decoder.module.js';
import { REQUIRED_RUNTIME_ASSETS } from '../config/runtimeAssets.js';
import type { CanonicalClip } from '../config/skeleton.js';
import type { ManifestEntry, RuntimeManifest } from '../shared/manifest.js';

const BASE = '/runtime-assets/';

export class AssetError extends Error {
  constructor(readonly assetId: string, readonly required: boolean, message: string) {
    super(message);
  }
}

export interface LoadProgress {
  loaded: number;
  total: number;
  current: string;
  failedRequired: string[];
  failedOptional: string[];
}

export class AssetStore {
  manifest: RuntimeManifest | null = null;
  private gltfLoader: GLTFLoader;
  private ktx2: KTX2Loader;
  private models = new Map<string, Promise<GLTF | null>>();
  private clips = new Map<string, Promise<CanonicalClip | null>>();
  private textures = new Map<string, Promise<THREE.Texture | null>>();
  readonly progress: LoadProgress = { loaded: 0, total: 0, current: '', failedRequired: [], failedOptional: [] };
  private listeners: ((p: LoadProgress) => void)[] = [];
  useLowLod = false;

  constructor(renderer: THREE.WebGLRenderer) {
    this.ktx2 = new KTX2Loader().setTranscoderPath(`${BASE}basis/`).detectSupport(renderer);
    this.gltfLoader = new GLTFLoader().setKTX2Loader(this.ktx2).setMeshoptDecoder(MeshoptDecoder);
  }

  onProgress(l: (p: LoadProgress) => void): () => void {
    this.listeners.push(l);
    return () => this.listeners.splice(this.listeners.indexOf(l), 1);
  }

  private notify(): void {
    for (const l of this.listeners) l(this.progress);
  }

  async loadManifest(): Promise<RuntimeManifest> {
    const res = await fetch(`${BASE}manifest.json`, { cache: 'no-cache' });
    if (!res.ok) throw new AssetError('manifest', true, `Runtime asset manifest missing (HTTP ${res.status}). Run "npm run assets:build" on the host.`);
    this.manifest = (await res.json()) as RuntimeManifest;
    return this.manifest;
  }

  entry(id: string): ManifestEntry | null {
    return this.manifest?.entries[id] ?? null;
  }

  isRequired(id: string): boolean {
    return REQUIRED_RUNTIME_ASSETS.includes(id);
  }

  /** Required assets missing from the manifest (explicit diagnostic before any race). */
  missingRequired(): string[] {
    return REQUIRED_RUNTIME_ASSETS.filter((id) => !this.manifest?.entries[id]);
  }

  private fail(id: string, e: unknown): null {
    const required = this.isRequired(id);
    const msg = e instanceof Error ? e.message : String(e);
    if (required) {
      if (!this.progress.failedRequired.includes(id)) this.progress.failedRequired.push(id);
      console.error(`[assets] REQUIRED asset ${id} failed: ${msg}`);
    } else {
      if (!this.progress.failedOptional.includes(id)) this.progress.failedOptional.push(id);
      console.warn(`[assets] optional asset ${id} unavailable (degrading): ${msg}`);
    }
    this.notify();
    return null;
  }

  private track<T>(label: string, p: Promise<T>): Promise<T> {
    this.progress.total++;
    this.notify();
    return p.finally(() => {
      this.progress.loaded++;
      this.progress.current = label;
      this.notify();
    });
  }

  /** Loads a model entry (lod0, or lod1 when the low preset is active and one exists). */
  model(id: string, lod: 'auto' | 'lod0' | 'lod1' = 'auto'): Promise<GLTF | null> {
    const e = this.entry(id);
    const role = lod === 'auto' ? (this.useLowLod && e?.files.lod1 ? 'lod1' : 'lod0') : lod;
    const key = `${id}:${role}`;
    let p = this.models.get(key);
    if (!p) {
      p = this.track(id, (async () => {
        if (!e) throw new AssetError(id, this.isRequired(id), `${id} is not in the runtime manifest`);
        const file = e.files[role] ?? e.files.lod0;
        if (!file) throw new AssetError(id, this.isRequired(id), `${id} has no ${role} file`);
        return await this.gltfLoader.loadAsync(BASE + file);
      })().catch((err) => this.fail(id, err)));
      this.models.set(key, p);
    }
    return p;
  }

  clip(id: string): Promise<CanonicalClip | null> {
    let p = this.clips.get(id);
    if (!p) {
      p = this.track(id, (async () => {
        const e = this.entry(id);
        if (!e?.files.clip) throw new AssetError(id, this.isRequired(id), `${id} clip missing from manifest`);
        const res = await fetch(BASE + e.files.clip);
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        return (await res.json()) as CanonicalClip;
      })().catch((err) => this.fail(id, err)));
      this.clips.set(id, p);
    }
    return p;
  }

  texture(file: string, opts: { srgb?: boolean; repeat?: boolean; mirrorV?: boolean } = {}): Promise<THREE.Texture | null> {
    let p = this.textures.get(file);
    if (!p) {
      p = this.track(file, this.ktx2.loadAsync(BASE + file).then((t) => {
        t.colorSpace = opts.srgb ? THREE.SRGBColorSpace : THREE.NoColorSpace;
        if (opts.repeat) {
          t.wrapS = THREE.RepeatWrapping;
          t.wrapT = opts.mirrorV ? THREE.MirroredRepeatWrapping : THREE.RepeatWrapping;
        }
        t.anisotropy = 8;
        t.needsUpdate = true;
        return t as THREE.Texture;
      })).catch((err) => {
        console.warn(`[assets] texture ${file} failed`, err);
        return null;
      });
      this.textures.set(file, p);
    }
    return p;
  }

  /** Texture referenced by a manifest entry role (e.g. mask:Test). */
  entryTexture(id: string, role: string, opts: { srgb?: boolean; repeat?: boolean; mirrorV?: boolean } = {}): Promise<THREE.Texture | null> {
    const f = this.entry(id)?.files[role];
    if (!f) return Promise.resolve(null);
    return this.texture(f, opts);
  }
}
