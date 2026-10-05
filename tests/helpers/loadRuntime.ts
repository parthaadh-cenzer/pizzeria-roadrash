// Test helper: loads a runtime GLB through three.js in Node (textures stripped; KTX2 needs a GPU).
import { NodeIO } from '@gltf-transform/core';
import { ALL_EXTENSIONS } from '@gltf-transform/extensions';
import { MeshoptDecoder } from 'meshoptimizer';
import fs from 'node:fs';
import * as THREE from 'three';
import { GLTFLoader, type GLTF } from 'three/examples/jsm/loaders/GLTFLoader.js';
import type { RuntimeManifest } from '../../src/shared/manifest.js';
import type { CanonicalClip } from '../../src/config/skeleton.js';

export const manifest = (): RuntimeManifest => JSON.parse(fs.readFileSync('public/runtime-assets/manifest.json', 'utf8')) as RuntimeManifest;

export async function loadRuntimeModel(id: string, role = 'lod0'): Promise<GLTF> {
  await MeshoptDecoder.ready;
  const io = new NodeIO().registerExtensions(ALL_EXTENSIONS).registerDependencies({ 'meshopt.decoder': MeshoptDecoder });
  const doc = await io.read(`public/runtime-assets/${manifest().entries[id]!.files[role]!}`);
  for (const t of doc.getRoot().listTextures()) t.dispose();
  for (const e of doc.getRoot().listExtensionsUsed()) if (['KHR_texture_basisu', 'EXT_meshopt_compression'].includes(e.extensionName)) e.dispose();
  const glb = await io.writeBinary(doc);
  const ab = glb.buffer.slice(glb.byteOffset, glb.byteOffset + glb.byteLength) as ArrayBuffer;
  return new Promise((res, rej) => new GLTFLoader().parse(ab, '', res, rej));
}

export function loadClip(id: string): CanonicalClip {
  return JSON.parse(fs.readFileSync(`public/runtime-assets/${manifest().entries[id]!.files.clip!}`, 'utf8')) as CanonicalClip;
}

export function samplePose(root: THREE.Object3D, clip: THREE.AnimationClip, t: number): void {
  const mixer = new THREE.AnimationMixer(root);
  mixer.clipAction(clip).play();
  mixer.setTime(t);
  root.updateMatrixWorld(true);
}
