// Weapon recipes. Runtime weapon frame: grip at the origin, blade/chain extends along +Y.
import type { Document, Node, Primitive } from '@gltf-transform/core';
import * as THREE from 'three';
import type { ManifestEntry } from '../../../src/shared/manifest.js';
import { bakeAndMergeStatic, joinPrims, nodeWorldMatrix, primitiveIslands, subsetPrimitive } from '../lib/components.js';
import { quatAxis, removeNodes, renameNode, sceneOf, type Measurement } from '../lib/gltfOps.js';
import { codeHashOf, libHash, processModel, tuple } from './common.js';

const CODE = () => libHash() + codeHashOf('tools/asset-pipeline/recipes/weapons.ts');

function gripTranslate(q: THREE.Quaternion, scale: number, grip: THREE.Vector3): [number, number, number] {
  const g = grip.clone().applyQuaternion(q).multiplyScalar(scale);
  return [-g.x, -g.y, -g.z];
}

function weaponLength(m: Measurement): number {
  return +m.size.y.toFixed(3);
}

export async function buildWeapons(): Promise<ManifestEntry[]> {
  const out: ManifestEntry[] = [];

  // Machete: origin already inside the grip; blade toward -X.
  out.push(
    await processModel({
      id: 'weapon.machete',
      dir: 'weapons',
      source: 'Assets/Weapons/free_realistic_modern_machete_with_uv_low-poly.glb',
      codeHash: CODE(),
      textureMax: 512,
      normalize: () => ({ q: quatAxis([0, 0, 1], -Math.PI / 2), scale: 1, translate: [0, 0, 0] }),
      describe: (m) => ({ weapon: { length: weaponLength(m), gripOffset: [0, 0, 0], segments: [], chainBones: [], ballNode: null, tipNode: null } }),
    }),
  );

  // Katana: isolate one gameplay sword (drop the duplicate sword and scabbards), merge primitives.
  out.push(
    await processModel({
      id: 'weapon.katana',
      dir: 'weapons',
      source: 'Assets/Weapons/no_name_-_katana.glb',
      codeHash: CODE(),
      textureMax: 512,
      prepare: (doc) => {
        // Remove the duplicate sword and scabbards with their mesh children (`Cube_0`, ...): disposing
        // only the parents orphaned the children, which the merge then baked unscaled (~5 m sword).
        const removed = removeNodes(doc, (n) => /^(Corp\.001|Ailes [123]\.001|Cube|Cube\.001)(_\d+)?$/.test(n.getName()));
        bakeAndMergeStatic(doc, [], 'katana');
        return [`removed duplicate sword/scabbards: ${removed.join(', ')}`, 'decorative "Take 01" clip dropped; primitives merged by material'];
      },
      normalize: (m) => {
        const q = quatAxis([1, 0, 0], -Math.PI / 2);
        const len = m.size.z; // blade along +Z in source
        const scale = 1.0 / len; // ~1 m overall: human-scale sword, handle ~25 cm
        return { q, scale, translate: gripTranslate(q, scale, new THREE.Vector3(0, 0.286, -1.194)) };
      },
      describe: (m) => ({ weapon: { length: weaponLength(m), gripOffset: [0, 0, 0], segments: [], chainBones: [], ballNode: null, tipNode: null } }),
    }),
  );

  // Morning Star: 12-joint chain rig kept for delayed ball physics; cm -> m.
  {
    let axis = new THREE.Vector3(0, 0, -1);
    let grip = new THREE.Vector3();
    out.push(
      await processModel({
        id: 'weapon.morningStar',
        dir: 'weapons',
        source: 'Assets/Weapons/morning_star_low_poly.glb',
        codeHash: CODE(),
        textureMax: 512,
        prepare: (doc) => {
          renameNode(doc, /^Handle End/, 'ms_handle_end');
          renameNode(doc, /^Handle_01$/, 'ms_handle');
          renameNode(doc, /^Chain_02$/, 'ms_chain_0');
          for (let i = 1; i <= 7; i++) renameNode(doc, new RegExp(`^Chain\\.${i}_`), `ms_chain_${i}`);
          renameNode(doc, /^Ball/, 'ms_ball');
          return ['chain bones renamed ms_chain_0..7, ball ms_ball'];
        },
        normalize: (m) => {
          const end = m.nodes.get('ms_handle_end')!, ball = m.nodes.get('ms_ball')!;
          axis = ball.clone().sub(end).normalize();
          const total = m.size.length() > 0 ? Math.max(m.size.x, m.size.y, m.size.z) : 93;
          const scale = 0.93 / total;
          grip = end.clone().addScaledVector(axis, 0.12 / scale);
          const q = new THREE.Quaternion().setFromUnitVectors(axis, new THREE.Vector3(0, 1, 0));
          return { q, scale, translate: gripTranslate(q, scale, grip) };
        },
        describe: (m) => ({
          weapon: {
            length: weaponLength(m),
            gripOffset: [0, 0, 0],
            segments: [],
            chainBones: ['ms_chain_0', 'ms_chain_1', 'ms_chain_2', 'ms_chain_3', 'ms_chain_4', 'ms_chain_5', 'ms_chain_6', 'ms_chain_7'],
            ballNode: 'ms_ball',
            tipNode: null,
          },
        }),
      }),
    );
  }

  // Zabimaru: split hilt / six segments / tip into pivoted nodes for runtime retract/extend.
  out.push(
    await processModel({
      id: 'weapon.zabimaru',
      dir: 'weapons',
      source: 'Assets/Weapons/zabimaru_v2_-_bleach.glb',
      codeHash: CODE(),
      textureMax: 512,
      prepare: (doc) => splitZabimaru(doc),
      normalize: () => {
        const q = quatAxis([0, 0, 1], Math.PI);
        const scale = 0.2;
        return { q, scale, translate: gripTranslate(q, scale, new THREE.Vector3(0, 5.708, 0)) };
      },
      describe: (m) => ({
        weapon: {
          length: weaponLength(m),
          gripOffset: [0, 0, 0],
          segments: ['zab_seg_1', 'zab_seg_2', 'zab_seg_3', 'zab_seg_4', 'zab_seg_5', 'zab_seg_6', 'zab_tip'],
          chainBones: [],
          ballNode: null,
          tipNode: 'zab_tip',
        },
        notes: [`segment centres (m): ${['zab_seg_1', 'zab_seg_6', 'zab_tip'].map((n) => `${n}=${JSON.stringify(tuple(m.nodes.get(n) ?? new THREE.Vector3()))}`).join(' ')}`],
      }),
    }),
  );
  return out;
}

/** Groups Zabimaru's disconnected islands into hilt, six blade segments and tip. */
function splitZabimaru(doc: Document): string[] {
  const centres: { name: string; c: THREE.Vector3 }[] = [
    { name: 'zab_hilt', c: new THREE.Vector3(0, 5.3, 0) },
    { name: 'zab_seg_1', c: new THREE.Vector3(0.058, 2.684, 0.153) },
    { name: 'zab_seg_2', c: new THREE.Vector3(-0.49, 0.248, 1.01) },
    { name: 'zab_seg_3', c: new THREE.Vector3(-1.873, -1.311, 2.572) },
    { name: 'zab_seg_4', c: new THREE.Vector3(-3.896, -1.531, 3.905) },
    { name: 'zab_seg_5', c: new THREE.Vector3(-5.893, -0.708, 4.235) },
    { name: 'zab_seg_6', c: new THREE.Vector3(-7.497, 0.412, 3.638) },
    { name: 'zab_tip', c: new THREE.Vector3(-8.333, 1.034, 3.331) },
  ];
  const groups = new Map<string, { prims: Primitive[]; box: THREE.Box3 }>();
  const meshNodes = doc.getRoot().listNodes().filter((n) => n.getMesh());
  for (const node of meshNodes) {
    const world = nodeWorldMatrix(node);
    for (const prim of node.getMesh()!.listPrimitives()) {
      const buckets = new Map<string, number[]>();
      const boxes = new Map<string, THREE.Box3>();
      for (const isl of primitiveIslands(prim, world)) {
        let best = centres[0]!, bd = Infinity;
        for (const c of centres) {
          const d = isl.center.distanceTo(c.c);
          if (d < bd) {
            bd = d;
            best = c;
          }
        }
        // Handle + guard islands sit above y ~4.4.
        const name = isl.center.y > 4.4 ? 'zab_hilt' : best.name;
        let b = buckets.get(name);
        if (!b) buckets.set(name, (b = []));
        b.push(...isl.tris);
        const bx = boxes.get(name) ?? new THREE.Box3();
        bx.union(new THREE.Box3(isl.min, isl.max));
        boxes.set(name, bx);
      }
      for (const [name, tris] of buckets) {
        const g = groups.get(name) ?? { prims: [], box: new THREE.Box3() };
        g.prims.push(subsetPrimitive(doc, prim, tris, world));
        g.box.union(boxes.get(name)!);
        groups.set(name, g);
      }
    }
  }
  for (const n of meshNodes) n.dispose();
  const scene = sceneOf(doc);
  const notes: string[] = [];
  for (const c of centres) {
    const g = groups.get(c.name);
    if (!g) throw new Error(`zabimaru: no geometry assigned to ${c.name}`);
    const pivot = g.box.getCenter(new THREE.Vector3());
    const toPivot = new THREE.Matrix4().makeTranslation(-pivot.x, -pivot.y, -pivot.z);
    const byMat = new Map<string, Primitive[]>();
    for (const p of g.prims) {
      const key = p.getMaterial()?.getName() ?? 'none';
      const list = byMat.get(key) ?? [];
      list.push(p);
      byMat.set(key, list);
    }
    const mesh = doc.createMesh(c.name);
    for (const list of byMat.values()) {
      const joined = joinPrims(doc, list, list[0]!.getMaterial());
      const all = Array.from({ length: joined.getIndices()!.getCount() / 3 }, (_, i) => i);
      mesh.addPrimitive(subsetPrimitive(doc, joined, all, toPivot));
      joined.dispose();
    }
    const node: Node = doc.createNode(c.name).setMesh(mesh).setTranslation([pivot.x, pivot.y, pivot.z]);
    scene.addChild(node);
    notes.push(`${c.name}: ${g.prims.length} island groups`);
  }
  return [`Zabimaru split into hilt, 6 segments and tip (extended pose as modelled)`, ...notes];
}
