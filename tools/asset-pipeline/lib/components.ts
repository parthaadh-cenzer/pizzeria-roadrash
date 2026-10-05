// Geometry splitting utilities: connected components, triangle subsets, re-pivoting,
// spatial partitioning and transform-baked merging.
import { type Accessor, type Document, type Mesh, type Node, type Primitive } from '@gltf-transform/core';
import * as THREE from 'three';

export interface Island {
  tris: number[]; // triangle indices into the primitive
  min: THREE.Vector3;
  max: THREE.Vector3;
  center: THREE.Vector3;
  size: THREE.Vector3;
  vertexCount: number;
}

function indicesOf(prim: Primitive): Uint32Array {
  const idx = prim.getIndices();
  if (idx) return Uint32Array.from(idx.getArray() as ArrayLike<number>);
  const n = prim.getAttribute('POSITION')!.getCount();
  return Uint32Array.from({ length: n }, (_, i) => i);
}

function positionsOf(prim: Primitive): Float32Array {
  const pos = prim.getAttribute('POSITION')!;
  const n = pos.getCount();
  const out = new Float32Array(n * 3);
  const el: number[] = [];
  for (let i = 0; i < n; i++) {
    pos.getElement(i, el);
    out[i * 3] = el[0]!;
    out[i * 3 + 1] = el[1]!;
    out[i * 3 + 2] = el[2]!;
  }
  return out;
}

/** Connected components (vertices welded by position so UV seams do not split islands). */
export function primitiveIslands(prim: Primitive, matrix?: THREE.Matrix4): Island[] {
  const idx = indicesOf(prim);
  const pos = positionsOf(prim);
  const nv = pos.length / 3;
  const parent = new Int32Array(nv).map((_, i) => i);
  const find = (a: number): number => {
    while (parent[a] !== a) {
      parent[a] = parent[parent[a]!]!;
      a = parent[a]!;
    }
    return a;
  };
  const union = (a: number, b: number) => {
    const ra = find(a), rb = find(b);
    if (ra !== rb) parent[ra] = rb;
  };
  const key = new Map<string, number>();
  for (let i = 0; i < nv; i++) {
    const k = `${Math.round(pos[i * 3]! * 1e4)},${Math.round(pos[i * 3 + 1]! * 1e4)},${Math.round(pos[i * 3 + 2]! * 1e4)}`;
    const e = key.get(k);
    if (e !== undefined) union(i, e);
    else key.set(k, i);
  }
  for (let t = 0; t < idx.length; t += 3) {
    union(idx[t]!, idx[t + 1]!);
    union(idx[t]!, idx[t + 2]!);
  }
  const groups = new Map<number, number[]>();
  for (let t = 0; t < idx.length / 3; t++) {
    const r = find(idx[t * 3]!);
    let g = groups.get(r);
    if (!g) groups.set(r, (g = []));
    g.push(t);
  }
  const v = new THREE.Vector3();
  const islands: Island[] = [];
  for (const tris of groups.values()) {
    const box = new THREE.Box3();
    const verts = new Set<number>();
    for (const t of tris) for (let k = 0; k < 3; k++) verts.add(idx[t * 3 + k]!);
    for (const i of verts) {
      v.set(pos[i * 3]!, pos[i * 3 + 1]!, pos[i * 3 + 2]!);
      if (matrix) v.applyMatrix4(matrix);
      box.expandByPoint(v);
    }
    islands.push({ tris, min: box.min, max: box.max, center: box.getCenter(new THREE.Vector3()), size: box.getSize(new THREE.Vector3()), vertexCount: verts.size });
  }
  return islands;
}

function copyAccessorSubset(doc: Document, src: Accessor, remap: Int32Array, count: number): Accessor {
  const size = src.getElementSize();
  // getElement() decodes normalized integers to floats, so normalized sources become float.
  const normalized = src.getNormalized();
  const ArrayType = normalized ? Float32Array : ((src.getArray() as Float32Array).constructor as new (n: number) => Float32Array<ArrayBuffer>);
  const out = new ArrayType(count * size);
  const el: number[] = [];
  for (let i = 0; i < remap.length; i++) {
    const j = remap[i]!;
    if (j < 0) continue;
    src.getElement(i, el);
    for (let k = 0; k < size; k++) out[j * size + k] = el[k]!;
  }
  return doc
    .createAccessor(src.getName())
    .setType(src.getType())
    .setArray(out)
    .setNormalized(false)
    .setBuffer(src.getBuffer());
}

/** New primitive containing only the given triangles (all attributes preserved). */
export function subsetPrimitive(doc: Document, prim: Primitive, tris: number[], transform?: THREE.Matrix4): Primitive {
  const idx = indicesOf(prim);
  const nv = prim.getAttribute('POSITION')!.getCount();
  const remap = new Int32Array(nv).fill(-1);
  let count = 0;
  const newIdx = new Uint32Array(tris.length * 3);
  let w = 0;
  for (const t of tris) {
    for (let k = 0; k < 3; k++) {
      const vi = idx[t * 3 + k]!;
      if (remap[vi] === -1) remap[vi] = count++;
      newIdx[w++] = remap[vi]!;
    }
  }
  const out = doc.createPrimitive().setMaterial(prim.getMaterial()).setMode(prim.getMode());
  for (const sem of prim.listSemantics()) {
    const acc = copyAccessorSubset(doc, prim.getAttribute(sem)!, remap, count);
    out.setAttribute(sem, acc);
  }
  const buffer = prim.getAttribute('POSITION')!.getBuffer();
  out.setIndices(doc.createAccessor().setType('SCALAR').setArray(newIdx).setBuffer(buffer));
  if (transform) transformPrimitiveInPlace(out, transform);
  return out;
}

/** Applies a matrix to POSITION (and NORMAL/TANGENT rotation) of a primitive in place. */
export function transformPrimitiveInPlace(prim: Primitive, m: THREE.Matrix4): void {
  const pos = prim.getAttribute('POSITION');
  const nrm = prim.getAttribute('NORMAL');
  const tan = prim.getAttribute('TANGENT');
  const normalMatrix = new THREE.Matrix3().getNormalMatrix(m);
  const v = new THREE.Vector3();
  const el: number[] = [];
  if (pos) {
    const arr = new Float32Array(pos.getCount() * 3);
    for (let i = 0; i < pos.getCount(); i++) {
      pos.getElement(i, el);
      v.set(el[0]!, el[1]!, el[2]!).applyMatrix4(m);
      arr.set([v.x, v.y, v.z], i * 3);
    }
    pos.setArray(arr).setNormalized(false);
  }
  if (nrm) {
    const arr = new Float32Array(nrm.getCount() * 3);
    for (let i = 0; i < nrm.getCount(); i++) {
      nrm.getElement(i, el);
      v.set(el[0]!, el[1]!, el[2]!).applyMatrix3(normalMatrix).normalize();
      arr.set([v.x, v.y, v.z], i * 3);
    }
    nrm.setArray(arr).setNormalized(false);
  }
  if (tan) {
    const arr = new Float32Array(tan.getCount() * 4);
    const upper = new THREE.Matrix3().setFromMatrix4(m);
    for (let i = 0; i < tan.getCount(); i++) {
      tan.getElement(i, el);
      v.set(el[0]!, el[1]!, el[2]!).applyMatrix3(upper).normalize();
      arr.set([v.x, v.y, v.z, el[3] ?? 1], i * 4);
    }
    tan.setArray(arr).setNormalized(false);
  }
  if (m.determinant() < 0) {
    const idx = prim.getIndices();
    if (idx) {
      const a = Uint32Array.from(idx.getArray() as ArrayLike<number>);
      for (let t = 0; t < a.length; t += 3) {
        const tmp = a[t + 1]!;
        a[t + 1] = a[t + 2]!;
        a[t + 2] = tmp;
      }
      idx.setArray(a);
    }
  }
}

export function nodeWorldMatrix(node: Node): THREE.Matrix4 {
  return new THREE.Matrix4().fromArray(node.getWorldMatrix());
}

/** Parent-chain walk: node and all ancestors. */
export function ancestors(node: Node): Node[] {
  const out: Node[] = [];
  let p: Node | null = node;
  while (p) {
    out.push(p);
    const parents = p.listParents().filter((x) => x.propertyType === 'Node') as Node[];
    p = parents[0] ?? null;
  }
  return out;
}

/**
 * Bakes every mesh node that is not inside a `keep` subtree into a single node (`name`),
 * joining primitives that share a material. Kept subtrees (wheels, spinning parts) are untouched.
 */
export function bakeAndMergeStatic(doc: Document, keep: Node[], name: string): Node {
  const keepSet = new Set<Node>();
  for (const k of keep) k.traverse((n) => keepSet.add(n));
  const scene = doc.getRoot().getDefaultScene() ?? doc.getRoot().listScenes()[0]!;
  const byMaterial = new Map<string, Primitive[]>();
  const materials = new Map<string, NonNullable<ReturnType<Primitive['getMaterial']>>>();
  const toDispose: Node[] = [];
  for (const node of doc.getRoot().listNodes()) {
    const mesh = node.getMesh();
    if (!mesh || keepSet.has(node) || node.getSkin()) continue;
    const m = nodeWorldMatrix(node);
    for (const prim of mesh.listPrimitives()) {
      if (prim.getMode() !== 4) continue;
      const all = Array.from({ length: (prim.getIndices()?.getCount() ?? prim.getAttribute('POSITION')!.getCount()) / 3 }, (_, i) => i);
      const copy = subsetPrimitive(doc, prim, all, m);
      const mat = prim.getMaterial();
      const key = mat ? mat.getName() + '#' + doc.getRoot().listMaterials().indexOf(mat) : 'none';
      if (mat) materials.set(key, mat);
      let arr = byMaterial.get(key);
      if (!arr) byMaterial.set(key, (arr = []));
      arr.push(copy);
    }
    node.setMesh(null);
    toDispose.push(node);
  }
  const merged = doc.createMesh(name);
  for (const [key, prims] of byMaterial) {
    merged.addPrimitive(joinPrims(doc, prims, materials.get(key) ?? null));
  }
  const out = doc.createNode(name).setMesh(merged);
  scene.addChild(out);
  // Remove emptied nodes that are not ancestors of kept subtrees.
  const keepAnc = new Set<Node>();
  for (const k of keep) for (const a of ancestors(k)) keepAnc.add(a);
  for (const n of toDispose) if (!keepAnc.has(n) && n.listChildren().length === 0) n.dispose();
  return out;
}

/** Joins primitives with identical attribute layouts into one (positions already in same space). */
export function joinPrims(doc: Document, prims: Primitive[], material: ReturnType<Primitive['getMaterial']>): Primitive {
  const semantics = prims[0]!.listSemantics().filter((s) => prims.every((p) => p.getAttribute(s)));
  let vtx = 0;
  let idxCount = 0;
  for (const p of prims) {
    vtx += p.getAttribute('POSITION')!.getCount();
    idxCount += p.getIndices()!.getCount();
  }
  const out = doc.createPrimitive().setMaterial(material);
  const buffer = prims[0]!.getAttribute('POSITION')!.getBuffer();
  for (const sem of semantics) {
    const first = prims[0]!.getAttribute(sem)!;
    const size = first.getElementSize();
    const arr = new Float32Array(vtx * size);
    let o = 0;
    const el: number[] = [];
    for (const p of prims) {
      const a = p.getAttribute(sem)!;
      for (let i = 0; i < a.getCount(); i++) {
        a.getElement(i, el);
        for (let k = 0; k < size; k++) arr[o++] = el[k] ?? 0;
      }
    }
    out.setAttribute(sem, doc.createAccessor().setType(first.getType()).setArray(arr).setBuffer(buffer));
  }
  const idx = new Uint32Array(idxCount);
  let io = 0, base = 0;
  for (const p of prims) {
    const a = p.getIndices()!.getArray() as ArrayLike<number>;
    for (let i = 0; i < a.length; i++) idx[io++] = a[i]! + base;
    base += p.getAttribute('POSITION')!.getCount();
  }
  out.setIndices(doc.createAccessor().setType('SCALAR').setArray(idx).setBuffer(buffer));
  for (const p of prims) p.dispose();
  return out;
}

/**
 * Moves the listed triangles of `prim` into a new node pivoted at `pivot` (world space).
 * Triangles are removed from the source primitive.
 */
export function extractToNode(doc: Document, srcNode: Node, prim: Primitive, tris: number[], name: string, pivot: THREE.Vector3, parent: Node): Node {
  const world = nodeWorldMatrix(srcNode);
  const parentInv = nodeWorldMatrix(parent).invert();
  // geometry -> world -> relative to pivot (in parent space)
  const pivotLocal = pivot.clone().applyMatrix4(parentInv);
  const toLocal = new THREE.Matrix4().makeTranslation(-pivotLocal.x, -pivotLocal.y, -pivotLocal.z).multiply(parentInv).multiply(world);
  const newPrim = subsetPrimitive(doc, prim, tris, toLocal);
  const mesh = doc.createMesh(name).addPrimitive(newPrim);
  const node = doc.createNode(name).setMesh(mesh).setTranslation([pivotLocal.x, pivotLocal.y, pivotLocal.z]);
  parent.addChild(node);
  removeTriangles(doc, prim, new Set(tris));
  return node;
}

export function removeTriangles(doc: Document, prim: Primitive, remove: Set<number>): void {
  const idx = indicesOf(prim);
  const keep: number[] = [];
  for (let t = 0; t < idx.length / 3; t++) if (!remove.has(t)) keep.push(idx[t * 3]!, idx[t * 3 + 1]!, idx[t * 3 + 2]!);
  const buffer = prim.getAttribute('POSITION')!.getBuffer();
  prim.setIndices(doc.createAccessor().setType('SCALAR').setArray(Uint32Array.from(keep)).setBuffer(buffer));
}

/** Splits every static mesh primitive into grid cells (x/z) for frustum culling. */
export function partitionByGrid(doc: Document, cellSize: number, name: string): number {
  const scene = doc.getRoot().getDefaultScene() ?? doc.getRoot().listScenes()[0]!;
  const cells = new Map<string, Map<string, Primitive[]>>();
  const mats = new Map<string, ReturnType<Primitive['getMaterial']>>();
  const toDispose: Node[] = [];
  for (const node of doc.getRoot().listNodes()) {
    const mesh = node.getMesh();
    if (!mesh || node.getSkin()) continue;
    const m = nodeWorldMatrix(node);
    for (const prim of mesh.listPrimitives()) {
      if (prim.getMode() !== 4) continue;
      const idx = indicesOf(prim);
      const pos = positionsOf(prim);
      const buckets = new Map<string, number[]>();
      const v = new THREE.Vector3();
      for (let t = 0; t < idx.length / 3; t++) {
        let cx = 0, cz = 0;
        for (let k = 0; k < 3; k++) {
          const i = idx[t * 3 + k]!;
          v.set(pos[i * 3]!, pos[i * 3 + 1]!, pos[i * 3 + 2]!).applyMatrix4(m);
          cx += v.x / 3;
          cz += v.z / 3;
        }
        const key = `${Math.floor(cx / cellSize)}_${Math.floor(cz / cellSize)}`;
        let b = buckets.get(key);
        if (!b) buckets.set(key, (b = []));
        b.push(t);
      }
      const mat = prim.getMaterial();
      const mk = mat ? `${doc.getRoot().listMaterials().indexOf(mat)}` : 'none';
      mats.set(mk, mat);
      for (const [key, tris] of buckets) {
        let cell = cells.get(key);
        if (!cell) cells.set(key, (cell = new Map()));
        let list = cell.get(mk);
        if (!list) cell.set(mk, (list = []));
        list.push(subsetPrimitive(doc, prim, tris, m));
      }
    }
    node.setMesh(null);
    toDispose.push(node);
  }
  for (const n of toDispose) n.dispose();
  for (const [key, cell] of cells) {
    const mesh: Mesh = doc.createMesh(`${name}_${key}`);
    for (const [mk, prims] of cell) mesh.addPrimitive(joinPrims(doc, prims, mats.get(mk) ?? null));
    scene.addChild(doc.createNode(`${name}_${key}`).setMesh(mesh));
  }
  return cells.size;
}
