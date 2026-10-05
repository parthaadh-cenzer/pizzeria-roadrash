// Crease-angle vertex normals. Used after decimating hard-surface meshes whose original
// normals were dropped (normal seams otherwise block the simplifier).
import type { Document, Primitive } from '@gltf-transform/core';

export function computeCreaseNormals(doc: Document, prim: Primitive, creaseDeg = 50): void {
  const pos = prim.getAttribute('POSITION');
  const idxAcc = prim.getIndices();
  if (!pos || !idxAcc || prim.getMode() !== 4) return;
  const idx = Uint32Array.from(idxAcc.getArray() as ArrayLike<number>);
  const nv = pos.getCount();
  const P = new Float32Array(nv * 3);
  const el: number[] = [];
  for (let i = 0; i < nv; i++) {
    pos.getElement(i, el);
    P[i * 3] = el[0]!;
    P[i * 3 + 1] = el[1]!;
    P[i * 3 + 2] = el[2]!;
  }
  const nt = idx.length / 3;
  const FN = new Float32Array(nt * 3);
  const FA = new Float32Array(nt); // area weights
  for (let t = 0; t < nt; t++) {
    const a = idx[t * 3]! * 3, b = idx[t * 3 + 1]! * 3, c = idx[t * 3 + 2]! * 3;
    const ux = P[b]! - P[a]!, uy = P[b + 1]! - P[a + 1]!, uz = P[b + 2]! - P[a + 2]!;
    const vx = P[c]! - P[a]!, vy = P[c + 1]! - P[a + 1]!, vz = P[c + 2]! - P[a + 2]!;
    let nx = uy * vz - uz * vy, ny = uz * vx - ux * vz, nz = ux * vy - uy * vx;
    const l = Math.hypot(nx, ny, nz);
    FA[t] = l;
    if (l > 0) {
      nx /= l;
      ny /= l;
      nz /= l;
    }
    FN[t * 3] = nx;
    FN[t * 3 + 1] = ny;
    FN[t * 3 + 2] = nz;
  }
  // vertex -> faces (weld by position so shared positions smooth across)
  const keyOf = (i: number) => `${Math.round(P[i * 3]! * 1e4)},${Math.round(P[i * 3 + 1]! * 1e4)},${Math.round(P[i * 3 + 2]! * 1e4)}`;
  const groups = new Map<string, number[]>();
  for (let t = 0; t < nt; t++) {
    for (let k = 0; k < 3; k++) {
      const key = keyOf(idx[t * 3 + k]!);
      let g = groups.get(key);
      if (!g) groups.set(key, (g = []));
      g.push(t);
    }
  }
  const cosCrease = Math.cos((creaseDeg * Math.PI) / 180);
  // New vertex per (original vertex, smoothed normal) corner.
  const outIdx = new Uint32Array(idx.length);
  const cornerKey = new Map<string, number>();
  const newVerts: { src: number; n: [number, number, number] }[] = [];
  for (let t = 0; t < nt; t++) {
    const fx = FN[t * 3]!, fy = FN[t * 3 + 1]!, fz = FN[t * 3 + 2]!;
    for (let k = 0; k < 3; k++) {
      const vi = idx[t * 3 + k]!;
      let sx = 0, sy = 0, sz = 0;
      for (const f of groups.get(keyOf(vi))!) {
        const gx = FN[f * 3]!, gy = FN[f * 3 + 1]!, gz = FN[f * 3 + 2]!;
        if (gx * fx + gy * fy + gz * fz >= cosCrease) {
          sx += gx * FA[f]!;
          sy += gy * FA[f]!;
          sz += gz * FA[f]!;
        }
      }
      const l = Math.hypot(sx, sy, sz) || 1;
      const n: [number, number, number] = [sx / l, sy / l, sz / l];
      const ck = `${vi}|${Math.round(n[0] * 100)},${Math.round(n[1] * 100)},${Math.round(n[2] * 100)}`;
      let ni = cornerKey.get(ck);
      if (ni === undefined) {
        ni = newVerts.length;
        newVerts.push({ src: vi, n });
        cornerKey.set(ck, ni);
      }
      outIdx[t * 3 + k] = ni;
    }
  }
  const buffer = pos.getBuffer();
  for (const sem of prim.listSemantics()) {
    const acc = prim.getAttribute(sem)!;
    const size = acc.getElementSize();
    const arr = new Float32Array(newVerts.length * size);
    for (let i = 0; i < newVerts.length; i++) {
      acc.getElement(newVerts[i]!.src, el);
      for (let k = 0; k < size; k++) arr[i * size + k] = el[k]!;
    }
    prim.setAttribute(sem, doc.createAccessor().setType(acc.getType()).setArray(arr).setBuffer(buffer));
  }
  const N = new Float32Array(newVerts.length * 3);
  newVerts.forEach((v, i) => N.set(v.n, i * 3));
  prim.setAttribute('NORMAL', doc.createAccessor().setType('VEC3').setArray(N).setBuffer(buffer));
  prim.setIndices(doc.createAccessor().setType('SCALAR').setArray(outIdx).setBuffer(buffer));
}
