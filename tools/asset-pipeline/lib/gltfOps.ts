// Generic glTF document operations used by the recipes.
import { type Document, type Node, type Primitive, type Scene } from '@gltf-transform/core';
import { computeCreaseNormals } from './normals.js';
import { KHRMaterialsPBRSpecularGlossiness } from '@gltf-transform/extensions';
import { cloneDocument, compactPrimitive, dedup, meshopt, metalRough, prune, simplify, weld } from '@gltf-transform/functions';
import { MeshoptEncoder, MeshoptSimplifier } from 'meshoptimizer';
import * as THREE from 'three';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { getIO, log, QUIET } from './core.js';

export interface Measurement {
  min: THREE.Vector3;
  max: THREE.Vector3;
  size: THREE.Vector3;
  center: THREE.Vector3;
  nodes: Map<string, THREE.Vector3>;
  nodeQuats: Map<string, THREE.Quaternion>;
  meshes: { name: string; material: string; min: THREE.Vector3; max: THREE.Vector3; tris: number }[];
  triangles: number;
  scene: THREE.Group;
}

/**
 * Loads a copy of the document through three.js (textures stripped) and measures what will
 * actually render, including skinning in the default pose.
 */
export async function measure(doc: Document, opts: { perMesh?: boolean; hide?: RegExp } = {}): Promise<Measurement> {
  const copy = cloneDocument(doc);
  for (const t of copy.getRoot().listTextures()) t.dispose();
  for (const e of copy.getRoot().listExtensionsUsed()) {
    if (e.extensionName === 'KHR_materials_pbrSpecularGlossiness' || e.extensionName === 'KHR_texture_basisu' || e.extensionName === 'EXT_meshopt_compression') e.dispose();
  }
  const io = await getIO();
  const glb = await io.writeBinary(copy);
  const ab = glb.buffer.slice(glb.byteOffset, glb.byteOffset + glb.byteLength) as ArrayBuffer;
  const gltf = await new Promise<{ scene: THREE.Group }>((res, rej) => new GLTFLoader().parse(ab, '', res as never, rej));
  const scene = gltf.scene;
  if (opts.hide) scene.traverse((o) => { if (opts.hide!.test(o.name)) o.visible = false; });
  scene.updateMatrixWorld(true);
  const box = new THREE.Box3();
  const meshes: Measurement['meshes'] = [];
  let triangles = 0;
  scene.traverse((o) => {
    const m = o as THREE.Mesh;
    if (!m.isMesh || !isVisible(o)) return;
    const b = new THREE.Box3().setFromObject(m, true);
    if (!b.isEmpty()) box.union(b);
    const tris = (m.geometry.index ? m.geometry.index.count : m.geometry.attributes.position!.count) / 3;
    triangles += tris;
    if (opts.perMesh) meshes.push({ name: m.name, material: (m.material as THREE.Material).name, min: b.min.clone(), max: b.max.clone(), tris });
  });
  const nodes = new Map<string, THREE.Vector3>();
  const nodeQuats = new Map<string, THREE.Quaternion>();
  scene.traverse((o) => {
    nodes.set(o.name, o.getWorldPosition(new THREE.Vector3()));
    nodeQuats.set(o.name, o.getWorldQuaternion(new THREE.Quaternion()));
  });
  return { min: box.min, max: box.max, size: box.getSize(new THREE.Vector3()), center: box.getCenter(new THREE.Vector3()), nodes, nodeQuats, meshes, triangles, scene };
}

function isVisible(o: THREE.Object3D): boolean {
  let c: THREE.Object3D | null = o;
  while (c) {
    if (!c.visible) return false;
    c = c.parent;
  }
  return true;
}

export function sceneOf(doc: Document): Scene {
  const s = doc.getRoot().getDefaultScene() ?? doc.getRoot().listScenes()[0];
  if (!s) throw new Error('Document has no scene');
  return s;
}

/**
 * Wraps all scene roots in a normalization node. rotationY in radians is applied first, then
 * uniform scale, then translation (all in parent/world space).
 */
export function normalizeRoot(doc: Document, o: { q?: THREE.Quaternion; rotY?: number; scale: number | [number, number, number]; translate: [number, number, number]; name?: string }): Node {
  const scene = sceneOf(doc);
  const root = doc.createNode(o.name ?? 'RR_Root');
  const q = o.q ?? new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), o.rotY ?? 0);
  root.setRotation([q.x, q.y, q.z, q.w]);
  const s = typeof o.scale === 'number' ? [o.scale, o.scale, o.scale] : o.scale;
  root.setScale(s as [number, number, number]);
  root.setTranslation(o.translate);
  for (const child of scene.listChildren()) {
    scene.removeChild(child);
    root.addChild(child);
  }
  scene.addChild(root);
  return root;
}

/**
 * Computes the root translation that, after rotating and scaling, puts the model's footprint
 * centre at x=z=0 and its lowest point at y = groundY.
 */
export function groundCentreTranslation(m: Measurement, q: THREE.Quaternion, scale: number | [number, number, number], groundY = 0): [number, number, number] {
  // Transform the 8 bbox corners to find the rotated/scaled bounds.
  const s = typeof scale === 'number' ? new THREE.Vector3(scale, scale, scale) : new THREE.Vector3(...scale);
  const box = new THREE.Box3();
  for (let i = 0; i < 8; i++) {
    const p = new THREE.Vector3(i & 1 ? m.max.x : m.min.x, i & 2 ? m.max.y : m.min.y, i & 4 ? m.max.z : m.min.z);
    box.expandByPoint(p.applyQuaternion(q).multiply(s));
  }
  const c = box.getCenter(new THREE.Vector3());
  return [-c.x, groundY - box.min.y, -c.z];
}

export function quatY(rad: number): THREE.Quaternion {
  return new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), rad);
}
export function quatAxis(axis: [number, number, number], rad: number): THREE.Quaternion {
  return new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(...axis).normalize(), rad);
}

export function renameNode(doc: Document, from: RegExp, to: string): Node | undefined {
  const n = findNode(doc, from);
  if (n) n.setName(to);
  return n;
}

export function removeNodes(doc: Document, match: (n: Node) => boolean): string[] {
  const removed: string[] = [];
  for (const n of doc.getRoot().listNodes()) {
    if (match(n)) {
      removed.push(n.getName());
      n.dispose();
    }
  }
  return removed;
}

export function findNode(doc: Document, re: RegExp): Node | undefined {
  return doc.getRoot().listNodes().find((n) => re.test(n.getName()));
}

/** Renames skin joints: `map` is semantic name -> regexp matched against the source joint name. */
export function renameJoints(doc: Document, map: Record<string, RegExp>): Record<string, string> {
  const joints = new Set<Node>();
  for (const skin of doc.getRoot().listSkins()) for (const j of skin.listJoints()) joints.add(j);
  const used: Record<string, string> = {};
  for (const [semantic, re] of Object.entries(map)) {
    const hits = [...joints].filter((j) => re.test(j.getName()));
    if (hits.length === 0) continue;
    const j = hits[0]!;
    used[semantic] = j.getName();
    j.setName(semantic);
  }
  return used;
}

export function convertSpecGloss(doc: Document, id: string): Promise<void> | void {
  const has = doc.getRoot().listExtensionsUsed().some((e) => e.extensionName === KHRMaterialsPBRSpecularGlossiness.EXTENSION_NAME);
  if (!has) return;
  log.step(id, 'converting KHR_materials_pbrSpecularGlossiness -> metallic/roughness');
  return doc.transform(metalRough()).then(() => {
    for (const e of doc.getRoot().listExtensionsUsed()) if (e.extensionName === KHRMaterialsPBRSpecularGlossiness.EXTENSION_NAME) e.dispose();
  });
}

export function dropAnimations(doc: Document, keep: (name: string) => boolean = () => false): void {
  for (const a of doc.getRoot().listAnimations()) if (!keep(a.getName())) a.dispose();
}

export async function simplifyDoc(doc: Document, ratio: number, error: number, opts: { dropNormals?: boolean; sloppy?: boolean } = {}): Promise<void> {
  doc.setLogger(QUIET);
  await MeshoptSimplifier.ready;
  await doc.transform(prune({ keepLeaves: true, keepAttributes: true }));
  if (opts.sloppy) {
    // Topology-free decimation for distant geometry made of many disconnected boxes.
    for (const mesh of doc.getRoot().listMeshes()) for (const p of mesh.listPrimitives()) {
      const idx = p.getIndices();
      const pos = p.getAttribute('POSITION');
      if (!idx || !pos || p.getMode() !== 4) continue;
      const el: number[] = [];
      const P = new Float32Array(pos.getCount() * 3);
      for (let i = 0; i < pos.getCount(); i++) { pos.getElement(i, el); P[i * 3] = el[0]!; P[i * 3 + 1] = el[1]!; P[i * 3 + 2] = el[2]!; }
      const I = Uint32Array.from(idx.getArray() as ArrayLike<number>);
      const target = Math.max(3, Math.floor((I.length * ratio) / 3) * 3);
      const [out] = MeshoptSimplifier.simplifySloppy(I, P, 3, null, target, error);
      p.setIndices(doc.createAccessor().setType('SCALAR').setArray(new Uint32Array(out)).setBuffer(idx.getBuffer()));
      compactPrimitive(p);
    }
    return;
  }
  const rebuilt: Primitive[] = [];
  if (opts.dropNormals) {
    // Hard-edge normal seams block decimation; drop them and rebuild crease normals after.
    for (const mesh of doc.getRoot().listMeshes()) for (const p of mesh.listPrimitives()) {
      if (p.getAttribute('JOINTS_0')) continue;
      p.setAttribute('NORMAL', null);
      p.setAttribute('TANGENT', null);
      rebuilt.push(p);
    }
  }
  await doc.transform(weld(), simplify({ simplifier: MeshoptSimplifier, ratio, error, lockBorder: false }));
  for (const p of rebuilt) if (!p.isDisposed()) computeCreaseNormals(doc, p, 48);
}

export async function finalize(doc: Document, opts: { compress?: boolean } = {}): Promise<void> {
  doc.setLogger(QUIET);
  await MeshoptEncoder.ready;
  await doc.transform(prune({ keepLeaves: true, keepAttributes: false }), dedup());
  if (opts.compress !== false) await doc.transform(meshopt({ encoder: MeshoptEncoder, level: 'medium' }));
}

export function countTriangles(doc: Document): number {
  let t = 0;
  for (const m of doc.getRoot().listMeshes()) for (const p of m.listPrimitives()) {
    if (p.getMode() !== 4) continue;
    const idx = p.getIndices();
    t += (idx ? idx.getCount() : p.getAttribute('POSITION')!.getCount()) / 3;
  }
  return t;
}
