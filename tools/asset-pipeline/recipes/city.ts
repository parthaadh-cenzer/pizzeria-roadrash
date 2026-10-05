// City/track-structure recipes. Source city assets dress the custom track; they never define
// its topology.
import type { Document, Node, Primitive } from '@gltf-transform/core';
import sharp from 'sharp';
import * as THREE from 'three';
import { FICTIONAL_BRANDS } from '../../../src/config/brands.js';
import { mulberry32 } from '../../../src/shared/math.js';
import type { KitModule, ManifestEntry } from '../../../src/shared/manifest.js';
import { bakeAndMergeStatic, joinPrims, nodeWorldMatrix, partitionByGrid, primitiveIslands, subsetPrimitive } from '../lib/components.js';
import { log } from '../lib/core.js';
import { adAtlas } from '../lib/generated.js';
import { removeNodes, sceneOf } from '../lib/gltfOps.js';
import { codeHashOf, libHash, processModel, tuple } from './common.js';

const CODE = () => libHash() + codeHashOf('tools/asset-pipeline/recipes/city.ts');

/**
 * Real storefront/venue trademarks photographed into the Times Square facade atlases, as
 * normalised [x0, y0, x1, y1] boxes (glTF UV space, origin top-left). They are covered with
 * generated fictional shop signs; the rest of each facade photo is kept.
 */
const FACADE_TRADEMARKS: Record<string, [number, number, number, number][]> = {
  'Material.009': [
    [0.132, 0.068, 0.226, 0.096], // seafood restaurant sign
    [0.132, 0.099, 0.226, 0.116], // sporting goods sign + ticker
    [0.361, 0.095, 0.488, 0.113], // tower storefront lettering
    [0.386, 0.459, 0.464, 0.484], // event banner
    [0.5, 0.055, 0.757, 0.123], // sandwich shop / fashion / diner storefront band
    [0.767, 0.073, 0.813, 0.145], // police precinct sign
    [0.609, 0.352, 0.64, 0.368], // soft-drink sign
    [0.534, 0.38, 0.647, 0.394], // restaurant sign
    [0.88, 0.317, 0.992, 0.353], // cafe logos
    [0.877, 0.43, 0.919, 0.47], // venue sign
    [0.57, 0.454, 0.588, 0.469], // small logo
    [0.3, 0.607, 0.481, 0.657], // theatre marquee and banners
    [0.621, 0.505, 0.664, 0.528], // radio station billboard
    [0.889, 0.619, 0.942, 0.66], // hotel logo
    [0.859, 0.63, 0.876, 0.648], // hotel logo (small)
    [0.964, 0.668, 0.984, 0.682], // hotel logo (small)
    [0.763, 0.94, 0.989, 0.952], // fashion store signs
  ],
  'Material.005': [[0.884, 0.887, 0.984, 0.969]], // recruiting-office sign
};

/**
 * Remaining extruded storefront lettering that spells real store names, modelled in shared
 * trim materials (so it cannot be removed by material). Sites are in source-model units; only
 * small connected pieces (letters) near each site are removed.
 */
const LETTERING_SITES: { what: string; material: string; center: [number, number, number]; radius: number }[] = [
  { what: 'eyewear store', material: 'metal_gray', center: [7.7246, 0.2795, 0.7241], radius: 0.375 },
  { what: 'themed restaurant', material: 'material_0', center: [-2.0527, 0.2354, -1.0648], radius: 0.17 },
  { what: 'fashion store', material: 'metal_gray', center: [9.0155, 0.202, 0.667], radius: 0.21 },
];

const SIGN_COLORS = ['#18e0ff', '#ff2bd6', '#8a3dff', '#ff2a3a', '#ff7a1a', '#ffc21a', '#3dff9a'];

function escXml(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;');
}

/** Composites fictional neon shop signs over the given boxes of an image. */
async function coverTrademarks(image: Uint8Array, boxes: [number, number, number, number][], seed: number): Promise<Uint8Array> {
  const meta = await sharp(image).metadata();
  const W = meta.width!, H = meta.height!;
  const rnd = mulberry32(seed);
  let body = '';
  for (const [x0, y0, x1, y1] of boxes) {
    const x = x0 * W, y = y0 * H, w = (x1 - x0) * W, h = (y1 - y0) * H;
    // Wide storefront bands become a row of separate shop signs.
    const n = Math.max(1, Math.round(w / (h * 3.2)));
    for (let i = 0; i < n; i++) {
      const sx = x + (w / n) * i, sw = w / n;
      const brand = FICTIONAL_BRANDS[Math.floor(rnd() * FICTIONAL_BRANDS.length)]!;
      const color = SIGN_COLORS[Math.floor(rnd() * SIGN_COLORS.length)]!;
      const inset = Math.min(sw, h) * 0.06;
      const size = Math.min(h * 0.42, (sw * 0.9) / (brand.length * 0.64));
      body += `<rect x="${sx + 1}" y="${y}" width="${sw - 2}" height="${h}" fill="#0b0c16"/>`;
      body += `<rect x="${sx + inset}" y="${y + inset}" width="${sw - inset * 2}" height="${h - inset * 2}" fill="none" stroke="${color}" stroke-width="${Math.max(2, inset * 0.6)}"/>`;
      body += `<text x="${sx + sw / 2}" y="${y + h / 2 + size * 0.36}" font-family="Arial Black,Impact,sans-serif" font-size="${size}" font-weight="900" text-anchor="middle" fill="${color}">${escXml(brand)}</text>`;
    }
  }
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}">${body}</svg>`;
  return new Uint8Array(await sharp(image).composite([{ input: Buffer.from(svg) }]).png().toBuffer());
}

function emissiveMaterialNames(doc: Document): string[] {
  return doc
    .getRoot()
    .listMaterials()
    .filter((m) => m.getEmissiveFactor().some((v) => v > 0.01) || !!m.getEmissiveTexture())
    .map((m) => m.getName());
}

export async function buildCity(): Promise<ManifestEntry[]> {
  const out: ManifestEntry[] = [];

  // Future tunnel: reusable module, widened x2.55 and heightened x1.25 (blueprint).
  out.push(
    await processModel({
      id: 'city.tunnel',
      dir: 'city',
      source: 'Assets/City/future_tunnel.glb',
      codeHash: CODE(),
      textureMax: 1024,
      normalize: (m) => ({ q: new THREE.Quaternion(), scale: [2.55, 1.25, 1], translate: [0, 0, -(m.center.z)] }),
      describe: (m, doc) => ({
        city: { size: tuple(m.size), anchor: [0, 0, 0], emissiveMaterials: emissiveMaterialNames(doc).concat(['TunnelLed']) },
        notes: [`module length ${m.size.z.toFixed(2)} m, inner width ${m.size.x.toFixed(2)} m, height ${m.size.y.toFixed(2)} m`],
      }),
    }),
  );

  // Bridge kit: scene-spanning chunks clustered into individual modules with tags.
  let modules: KitModule[] = [];
  out.push(
    await processModel({
      id: 'city.bridgeKit',
      dir: 'city',
      source: 'Assets/City/bridges_and_street_assets.glb',
      codeHash: CODE(),
      textureMax: 512,
      prepare: (doc) => {
        modules = clusterModules(doc, 0.01, 0.35);
        return [`clustered into ${modules.length} modules`];
      },
      normalize: () => ({ q: new THREE.Quaternion(), scale: 1, translate: [0, 0, 0] }),
      describe: (m) => ({ city: { size: tuple(m.size), anchor: [0, 0, 0], modules } }),
    }),
  );

  // Times Square: road removed (custom road is authoritative), black/duplicate textures dropped,
  // real-brand billboard atlases replaced by generated fictional ads, spatially partitioned.
  let cells = 0;
  out.push(
    await processModel({
      id: 'city.timesSquare',
      dir: 'city',
      source: 'Assets/City/times square.glb',
      codeHash: CODE(),
      textureMax: 2048,
      perTexture: (_t, role) => (role === 'normal' ? 1024 : undefined),
      prepare: async (doc) => {
        const notes: string[] = [];
        const removed = removeNodes(doc, (n) => n.getName() === 'Object_32');
        notes.push(`road/sidewalk mesh removed (${removed.join(',')})`);
        // 3D neon storefront lettering (all real brand names) is dropped; fictional neon comes from
        // the generated billboards, holograms and rooftop signs.
        let neonPrims = 0;
        for (const mesh of doc.getRoot().listMeshes()) {
          for (const prim of mesh.listPrimitives()) {
            if (prim.getMaterial()?.getName() !== 'white_neon') continue;
            mesh.removePrimitive(prim);
            prim.dispose();
            neonPrims++;
          }
        }
        if (!neonPrims) throw new Error('city.timesSquare: expected white_neon storefront lettering not found');
        notes.push(`3D neon brand lettering removed (${neonPrims} primitive)`);
        const mats = doc.getRoot().listMaterials();
        const byName = (n: string) => mats.find((m) => m.getName() === n);
        // Billboard materials also carry extruded 3D sign lettering that spells real store names;
        // the lettering is made of small islands (< ~3 m once placed), the panels are large.
        const BILLBOARD_MATS = ['Material.007', 'Material.001', 'Material.008', 'Material.002'];
        const PLACED_SCALE = 20 * 1.2; // pipeline normalise x20, then placed at x1.2 in the world
        let letterIslands = 0;
        for (const node of doc.getRoot().listNodes()) {
          const mesh = node.getMesh();
          if (!mesh) continue;
          const wm = nodeWorldMatrix(node);
          for (const prim of mesh.listPrimitives()) {
            if (!BILLBOARD_MATS.includes(prim.getMaterial()?.getName() ?? '')) continue;
            const islands = primitiveIslands(prim, wm);
            const keep: number[] = [];
            let dropped = 0;
            for (const isl of islands) {
              if (Math.max(isl.size.x, isl.size.y, isl.size.z) * PLACED_SCALE < 3.2) dropped++;
              else keep.push(...isl.tris);
            }
            if (!dropped) continue;
            letterIslands += dropped;
            if (keep.length) mesh.addPrimitive(subsetPrimitive(doc, prim, keep));
            mesh.removePrimitive(prim);
            prim.dispose();
          }
        }
        notes.push(`${letterIslands} small 3D sign letter/logo islands removed from billboard geometry`);
        const letterMax = 1.6 / PLACED_SCALE;
        for (const site of LETTERING_SITES) {
          const c = new THREE.Vector3(...site.center);
          let removedHere = 0;
          for (const node of doc.getRoot().listNodes()) {
            const mesh = node.getMesh();
            if (!mesh) continue;
            const wm = nodeWorldMatrix(node);
            for (const prim of mesh.listPrimitives()) {
              if (prim.getMaterial()?.getName() !== site.material) continue;
              const islands = primitiveIslands(prim, wm);
              const keep: number[] = [];
              let dropped = 0;
              for (const isl of islands) {
                const letter = Math.max(isl.size.x, isl.size.y, isl.size.z) < letterMax && isl.center.distanceTo(c) < site.radius;
                if (letter) dropped++;
                else keep.push(...isl.tris);
              }
              if (!dropped) continue;
              removedHere += dropped;
              if (keep.length) mesh.addPrimitive(subsetPrimitive(doc, prim, keep));
              mesh.removePrimitive(prim);
              prim.dispose();
            }
          }
          if (!removedHere) throw new Error(`city.timesSquare: no lettering found at the ${site.what} site`);
          notes.push(`${site.what} lettering removed (${removedHere} pieces)`);
        }
        let seed = 11;
        for (const name of BILLBOARD_MATS) {
          const mat = byName(name);
          if (!mat) continue;
          const png = await adAtlas(seed++, 2048);
          const tex = doc.createTexture(`ads_${name}`).setImage(new Uint8Array(png)).setMimeType('image/png');
          const oldBase = mat.getBaseColorTexture();
          mat.setBaseColorTexture(tex).setEmissiveTexture(tex).setEmissiveFactor([1, 1, 1]);
          if (oldBase && oldBase.listParents().filter((p) => p.propertyType !== 'Root').length === 0) oldBase.dispose();
        }
        notes.push('billboard atlases (real trademarks) replaced with generated fictional ads');
        // The "advertising screens" material covers ~170k triangles of building glass and panels
        // whose source texture is solid black: keep them dark glossy glass (an emissive ad atlas
        // stretched across whole facades read as flat pastel light).
        const screens = byName('advertising_screens_texture_01');
        if (screens) {
          const black = screens.getBaseColorTexture();
          screens.setBaseColorTexture(null).setBaseColorFactor([0.018, 0.02, 0.03, 1]).setEmissiveTexture(null).setEmissiveFactor([0, 0, 0]);
          screens.setMetallicFactor(0.6).setRoughnessFactor(0.28);
          if (black && black.listParents().filter((p) => p.propertyType !== 'Root').length === 0) black.dispose();
          notes.push('all-black 8K screen texture dropped; screen/glass surfaces are dark glossy glass');
        }
        for (const [name, boxes] of Object.entries(FACADE_TRADEMARKS)) {
          const tex = byName(name)?.getBaseColorTexture();
          const img = tex?.getImage();
          if (!tex || !img) throw new Error(`city.timesSquare: facade atlas ${name} not found`);
          tex.setImage(await coverTrademarks(img, boxes, seed++)).setMimeType('image/png');
          notes.push(`${name}: ${boxes.length} real storefront trademark regions covered with fictional signs`);
        }
        const m4 = byName('Material.004'), m9 = byName('Material.009');
        if (m4 && m9?.getBaseColorTexture()) {
          const dup = m4.getBaseColorTexture();
          m4.setBaseColorTexture(m9.getBaseColorTexture());
          if (dup && dup.listParents().filter((p) => p.propertyType !== 'Root').length === 0) dup.dispose();
          notes.push('duplicate 8K texture (Material.004) redirected to its 4K twin');
        }
        cells = partitionByGrid(doc, 3.0, 'ts_cell');
        notes.push(`spatially partitioned into ${cells} cells (60 m)`);
        return notes;
      },
      // Main avenue centre (2.25, 0, -0.445) -> origin; ~20 m per source unit.
      normalize: () => ({ q: new THREE.Quaternion(), scale: 20, translate: [-2.25 * 20, 0, 0.445 * 20] }),
      simplify: { ratio: 0.55, error: 0.0015, dropNormals: true },
      lod1: { ratio: 0.3, error: 0.004, textureMax: 1024, dropNormals: true },
      describe: (m, doc) => ({ city: { size: tuple(m.size), anchor: [0, 0, 0], cells, emissiveMaterials: emissiveMaterialNames(doc) } }),
    }),
  );

  // Commercial blocks (stylised diorama), merged by material.
  out.push(
    await processModel({
      id: 'city.commercial',
      dir: 'city',
      source: 'Assets/City/cyberpunk_city_-_1.glb',
      codeHash: CODE(),
      textureMax: 512,
      prepare: (doc) => {
        bakeAndMergeStatic(doc, [], 'commercial_block');
        return ['merged by material (untextured stylised diorama)'];
      },
      normalize: (m) => ({ q: new THREE.Quaternion(), scale: 25, translate: [-m.center.x * 25, -m.min.y * 25, -m.center.z * 25] }),
      lod1: { ratio: 0.4, error: 0.01, textureMax: 256 },
      describe: (m, doc) => ({ city: { size: tuple(m.size), anchor: [0, 0, 0], emissiveMaterials: emissiveMaterialNames(doc) } }),
    }),
  );

  // Industrial ruin block (post-apocalyptic city); its wet road strips are removed.
  out.push(
    await processModel({
      id: 'city.industrial',
      dir: 'city',
      source: 'Assets/City/post-apocalyptic_city.glb',
      codeHash: CODE(),
      textureMax: 1024,
      prepare: (doc) => {
        const removed = removeNodes(doc, (n) => !!n.getMesh()?.listPrimitives().some((p) => /Wet_road/i.test(p.getMaterial()?.getName() ?? '')));
        bakeAndMergeStatic(doc, [], 'industrial_block');
        return [`road strips removed (${removed.join(',')}); merged by material`];
      },
      normalize: (m) => ({ q: new THREE.Quaternion(), scale: 1, translate: [-m.center.x, -m.min.y, -m.center.z] }),
      simplify: { ratio: 0.6, error: 0.002, dropNormals: true },
      lod1: { ratio: 0.25, error: 0.01, textureMax: 512, dropNormals: true },
      describe: (m) => ({ city: { size: tuple(m.size), anchor: [0, 0, 0] } }),
    }),
  );

  // Distant skyline: line primitives and edge materials dropped, heavy decimation.
  out.push(
    await processModel({
      id: 'city.skyline',
      dir: 'city',
      source: 'Assets/City/cyberpunk_city.glb',
      codeHash: CODE(),
      textureMax: 512,
      prepare: (doc) => {
        let lines = 0;
        for (const mesh of doc.getRoot().listMeshes()) {
          for (const p of mesh.listPrimitives()) {
            const edge = /edge_color/i.test(p.getMaterial()?.getName() ?? '');
            if (p.getMode() !== 4 || edge) {
              mesh.removePrimitive(p);
              p.dispose();
              lines++;
            }
          }
        }
        removeNodes(doc, (n) => n.getName() === 'auto__1');
        bakeAndMergeStatic(doc, [], 'skyline');
        return [`${lines} LINES/edge primitives dropped; ground plane removed; distant skyline only`];
      },
      normalize: (m) => {
        const s = 2600 / Math.max(m.size.x, m.size.z);
        return { q: new THREE.Quaternion(), scale: s, translate: [-m.center.x * s, -m.min.y * s, -m.center.z * s] };
      },
      simplify: { ratio: 0.05, error: 0.02, sloppy: true },
      lod1: { ratio: 0.45, error: 0.04, textureMax: 256, sloppy: true },
      describe: (m) => ({ city: { size: tuple(m.size), anchor: [0, 0, 0] } }),
    }),
  );
  return out;
}

/**
 * Clusters connected components (in world space * scale) into modules whose bounding boxes
 * touch within `gap` metres, then rebuilds each as a node pivoted at its bottom centre.
 */
function clusterModules(doc: Document, scale: number, gap: number): KitModule[] {
  interface Piece { prim: Primitive; world: THREE.Matrix4; tris: number[]; box: THREE.Box3 }
  const pieces: Piece[] = [];
  const meshNodes = doc.getRoot().listNodes().filter((n) => n.getMesh());
  for (const node of meshNodes) {
    const world = new THREE.Matrix4().makeScale(scale, scale, scale).multiply(nodeWorldMatrix(node));
    for (const prim of node.getMesh()!.listPrimitives()) {
      if (prim.getMode() !== 4) continue;
      for (const isl of primitiveIslands(prim, world)) pieces.push({ prim, world, tris: isl.tris, box: new THREE.Box3(isl.min, isl.max) });
    }
  }
  // Union-find on expanded boxes.
  const parent = pieces.map((_, i) => i);
  const find = (a: number): number => (parent[a] === a ? a : (parent[a] = find(parent[a]!)));
  const expanded = pieces.map((p) => p.box.clone().expandByScalar(gap));
  const order = pieces.map((_, i) => i).sort((a, b) => pieces[a]!.box.min.x - pieces[b]!.box.min.x);
  for (let oi = 0; oi < order.length; oi++) {
    const i = order[oi]!;
    for (let oj = oi + 1; oj < order.length; oj++) {
      const j = order[oj]!;
      if (expanded[j]!.min.x > expanded[i]!.max.x) break;
      if (expanded[i]!.intersectsBox(expanded[j]!)) parent[find(i)] = find(j);
    }
  }
  const groups = new Map<number, Piece[]>();
  pieces.forEach((p, i) => {
    const r = find(i);
    const g = groups.get(r) ?? [];
    g.push(p);
    groups.set(r, g);
  });
  const scene = sceneOf(doc);
  const out: KitModule[] = [];
  const sorted = [...groups.values()].sort((a, b) => boxOf(b).getSize(new THREE.Vector3()).length() - boxOf(a).getSize(new THREE.Vector3()).length());
  let idx = 0;
  for (const g of sorted) {
    const box = boxOf(g);
    const size = box.getSize(new THREE.Vector3());
    if (size.length() < 0.25) continue;
    const pivot = new THREE.Vector3((box.min.x + box.max.x) / 2, box.min.y, (box.min.z + box.max.z) / 2);
    const toPivot = new THREE.Matrix4().makeTranslation(-pivot.x, -pivot.y, -pivot.z);
    const prims: Primitive[] = g.map((p) => subsetPrimitive(doc, p.prim, p.tris, toPivot.clone().multiply(p.world)));
    const name = `kit_${String(idx++).padStart(2, '0')}`;
    const mesh = doc.createMesh(name).addPrimitive(joinPrims(doc, prims, prims[0]!.getMaterial()));
    const node: Node = doc.createNode(name).setMesh(mesh).setTranslation([pivot.x, pivot.y, pivot.z]);
    scene.addChild(node);
    const tris = g.reduce((a, p) => a + p.tris.length, 0);
    out.push({ name, size: tuple(size, 2), center: tuple(pivot, 2), tris, tags: tagModule(size) });
  }
  for (const n of meshNodes) n.dispose();
  log.step('city.bridgeKit', `modules: ${out.map((m) => `${m.name}[${m.tags.join('/')}] ${m.size.join('x')}`).join('; ')}`);
  return out;
}

function boxOf(g: { box: THREE.Box3 }[]): THREE.Box3 {
  const b = new THREE.Box3();
  for (const p of g) b.union(p.box);
  return b;
}

function tagModule(s: THREE.Vector3): string[] {
  const horiz = Math.max(s.x, s.z), minH = Math.min(s.x, s.z);
  const tags: string[] = [];
  if (horiz > 18 && s.y > 4) tags.push('bridge');
  if (horiz > 5 && s.y < 3.5 && minH > 3) tags.push('deck');
  if (s.y > 3 && horiz < 4.5) tags.push('pillar');
  if (horiz < 3.5 && s.y < 2.5) tags.push('debris');
  if (horiz > 4 && minH < 1.2 && s.y < 2) tags.push('barrier');
  if (!tags.length) tags.push('structure');
  return tags;
}
