// Visual track construction (blueprint "Track construction"): road mesh, shoulders/curbs,
// sidewalks, physical barriers + fences, viaduct decks and pillars, trench walls, ground and water.
import * as THREE from 'three';
import { ROAD_PROFILE, WATER_REGION } from '../../config/track.js';
import type { DistrictId } from '../../shared/ids.js';
import { STRUCTURE, type Track } from '../../game/track/Track.js';
import { DISTRICT_LOOK, type Materials } from '../materials/Palette.js';

export interface LightEmitter {
  pos: THREE.Vector3;
  color: THREE.Color;
  intensity: number;
  range: number;
}

export interface TrackVisuals {
  group: THREE.Group;
  roadMeshes: THREE.Mesh[];
  emitters: LightEmitter[];
  groundMask: THREE.DataTexture;
}

const STEP = 2;
const CHUNK = 120;

function outerEdge(track: Track, s: number): number {
  return track.barrierOffsetAt(s) + ROAD_PROFILE.barrierThickness + ROAD_PROFILE.sidewalkWidth;
}

function puddleMask(track: Track, s: number, lat: number): number {
  let m = 0;
  const w = track.wrapS(s);
  for (const p of track.puddles) {
    if (w < p.s0 - 3 || w > p.s1 + 3) continue;
    const ds = w < p.s0 ? p.s0 - w : w > p.s1 ? w - p.s1 : 0;
    const dl = Math.max(0, Math.abs(lat - p.lateral) - p.halfWidth);
    const d = Math.hypot(ds, dl);
    m = Math.max(m, 1 - Math.min(1, d / 1.6));
  }
  return m;
}

interface StripBuilder {
  pos: number[];
  nrm: number[];
  uv: number[];
  trk: number[];
  wet: number[];
  idx: number[];
}

function newStrip(): StripBuilder {
  return { pos: [], nrm: [], uv: [], trk: [], wet: [], idx: [] };
}

function finishStrip(b: StripBuilder): THREE.BufferGeometry {
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(b.pos, 3));
  g.setAttribute('normal', new THREE.Float32BufferAttribute(b.nrm, 3));
  g.setAttribute('uv', new THREE.Float32BufferAttribute(b.uv, 2));
  g.setAttribute('aTrack', new THREE.Float32BufferAttribute(b.trk, 3));
  g.setAttribute('aWet', new THREE.Float32BufferAttribute(b.wet, 1));
  g.setIndex(b.idx);
  g.computeBoundingSphere();
  g.computeBoundingBox();
  return g;
}

/** Adds a ribbon across the given lateral columns for s in [s0, s1]. */
function ribbon(b: StripBuilder, track: Track, s0: number, s1: number, lats: (s: number) => number[], height: (s: number, lat: number, col: number) => number, wet: (s: number, lat: number) => number, uvScale: number): void {
  const base = b.pos.length / 3;
  let rows = 0;
  let cols = 0;
  for (let s = s0; s <= s1 + 1e-6; s += STEP) {
    const ss = Math.min(s, s1);
    const f = track.frameAt(ss);
    const L = lats(ss);
    cols = L.length;
    const hw = track.halfWidthAt(ss);
    L.forEach((lat, ci) => {
      const hgt = height(ss, lat, ci);
      const p = track.pointAt(ss, lat, hgt);
      b.pos.push(p.x, p.y, p.z);
      b.nrm.push(f.ux, f.uy, f.uz);
      b.uv.push(lat / uvScale, ss / uvScale);
      b.trk.push(track.wrapS(ss), lat, hw);
      b.wet.push(wet(ss, lat));
    });
    rows++;
    if (ss >= s1) break;
  }
  for (let r = 0; r < rows - 1; r++) {
    for (let c = 0; c < cols - 1; c++) {
      const a = base + r * cols + c, bb = a + 1, cc = a + cols, d = cc + 1;
      b.idx.push(a, bb, cc, bb, d, cc);
    }
  }
}

/** Vertical wall strip at a lateral offset between two heights (relative to road). */
function wall(b: StripBuilder, track: Track, s0: number, s1: number, lat: (s: number) => number, h0: (s: number) => number, h1: (s: number) => number, facing: number): void {
  const base = b.pos.length / 3;
  let rows = 0;
  for (let s = s0; s <= s1 + 1e-6; s += STEP) {
    const ss = Math.min(s, s1);
    const f = track.frameAt(ss);
    const l = lat(ss);
    for (const hh of [h0(ss), h1(ss)]) {
      const p = track.pointAt(ss, l, 0);
      b.pos.push(p.x, hh, p.z);
      b.nrm.push(f.rx * facing, 0, f.rz * facing);
      b.uv.push(ss / 4, hh / 4);
      b.trk.push(track.wrapS(ss), l, track.halfWidthAt(ss));
      b.wet.push(0);
    }
    rows++;
    if (ss >= s1) break;
  }
  for (let r = 0; r < rows - 1; r++) {
    const a = base + r * 2, c = a + 2;
    if (facing > 0) b.idx.push(a, c, a + 1, a + 1, c, c + 1);
    else b.idx.push(a, a + 1, c, a + 1, c + 1, c);
  }
}

function barrierGeometry(): THREE.BufferGeometry {
  // Jersey barrier profile extruded 4 m along +Z, centred at origin.
  const shape = new THREE.Shape();
  shape.moveTo(-0.3, 0);
  shape.lineTo(0.3, 0);
  shape.lineTo(0.28, 0.08);
  shape.lineTo(0.14, 0.32);
  shape.lineTo(0.1, 1.05);
  shape.lineTo(-0.1, 1.05);
  shape.lineTo(-0.14, 0.32);
  shape.lineTo(-0.28, 0.08);
  shape.closePath();
  const g = new THREE.ExtrudeGeometry(shape, { depth: 4.02, bevelEnabled: false, steps: 1 });
  g.translate(0, 0, -2.01);
  return g;
}

export function buildTrackVisuals(track: Track, mats: Materials, road: { road: THREE.Material; sidewalk: THREE.Material; ground: THREE.Material }, opts: { shadows: boolean }): TrackVisuals {
  const group = new THREE.Group();
  group.name = 'track';
  const roadMeshes: THREE.Mesh[] = [];
  const emitters: LightEmitter[] = [];
  const b = track.bridge;
  const T = ROAD_PROFILE;

  // ---------------------------------------------------------------- road + sidewalks (chunked)
  const breaks = [0, b.lip, b.gapEnd];
  for (let s0 = 0; s0 < track.length; s0 += CHUNK) {
    const s1 = Math.min(track.length, s0 + CHUNK);
    const spans: [number, number][] = [];
    let a = s0;
    for (const br of breaks) if (br > a && br < s1) {
      spans.push([a, br]);
      a = br;
    }
    spans.push([a, s1]);
    const rb = newStrip();
    const sw = newStrip();
    const under = newStrip();
    for (const [p, q] of spans) {
      if (p >= b.lip && q <= b.gapEnd) continue; // physical gap
      ribbon(
        rb, track, p, q,
        (s) => {
          const hw = track.halfWidthAt(s), B = track.barrierOffsetAt(s);
          const cols: number[] = [-(B + T.barrierThickness), -B];
          for (let i = 0; i <= 8; i++) cols.push(-hw + (2 * hw * i) / 8);
          cols.push(B, B + T.barrierThickness);
          return cols;
        },
        () => 0,
        (s, lat) => puddleMask(track, s, lat),
        7,
      );
      const inTunnel = (s: number) => track.structureAt(s) === STRUCTURE.TUNNEL;
      for (const side of [-1, 1]) {
        ribbon(
          sw, track, p, q,
          (s) => {
            const i0 = track.barrierOffsetAt(s) + T.barrierThickness;
            const w = inTunnel(s) ? 0.6 : T.sidewalkWidth;
            return side < 0 ? [-(i0 + w), -i0] : [i0, i0 + w];
          },
          () => T.curbHeight,
          () => 0.15,
          4,
        );
        // Outer curb / deck fascia face.
        const structureDrop = (s: number) => {
          const k = track.structureAt(s);
          const f = track.frameAt(s);
          if (k === STRUCTURE.VIADUCT || k === STRUCTURE.BRIDGE) return f.py - 1.4;
          return Math.min(f.py - 0.3, -0.12);
        };
        wall(sw, track, p, q, (s) => side * outerEdge(track, s), (s) => structureDrop(s), (s) => track.frameAt(s).py + T.curbHeight + track.surfaceOffsetAt(s), side);
      }
      // Deck underside for elevated sections.
      let u0 = -1;
      for (let s = p; s <= q; s += STEP) {
        const k = track.structureAt(s);
        const elevated = (k === STRUCTURE.VIADUCT || k === STRUCTURE.BRIDGE) && track.frameAt(s).py > T.viaductThreshold - 1;
        if (elevated && u0 < 0) u0 = s;
        if ((!elevated || s + STEP > q) && u0 >= 0) {
          ribbon(under, track, u0, Math.min(s, q), (ss) => { const o = outerEdge(track, ss); return [o, -o]; }, () => -1.4, () => 0, 6);
          u0 = -1;
        }
      }
    }
    if (rb.pos.length) {
      const m = new THREE.Mesh(finishStrip(rb), road.road);
      m.receiveShadow = opts.shadows;
      m.name = `road_${s0}`;
      group.add(m);
      roadMeshes.push(m);
    }
    if (sw.pos.length) {
      const m = new THREE.Mesh(finishStrip(sw), road.sidewalk);
      m.receiveShadow = opts.shadows;
      m.name = `sidewalk_${s0}`;
      group.add(m);
      roadMeshes.push(m);
    }
    if (under.pos.length) {
      const m = new THREE.Mesh(finishStrip(under), mats.concreteDark);
      m.name = `deck_under_${s0}`;
      group.add(m);
    }
  }

  // ---------------------------------------------------------------- barriers, neon edge strips, fences
  const barrierGeo = barrierGeometry();
  const placements: { s: number; side: number; hazard: boolean }[] = [];
  for (let s = 2; s < track.length; s += 4) {
    if (s > b.lip - 2 && s < b.gapEnd + 2) continue;
    if (track.structureAt(s) === STRUCTURE.TUNNEL) continue;
    const d = track.districtAt(s);
    const hazard = (s > b.debrisStart - 40 && s < b.lip) || (d === 'STORM' && Math.abs(track.curvature[track.wrapIndex(Math.floor(s))]!) > 1 / 120);
    for (const side of [-1, 1]) placements.push({ s, side, hazard });
  }
  const normal = placements.filter((p) => !p.hazard), haz = placements.filter((p) => p.hazard);
  const m4 = new THREE.Matrix4(), q = new THREE.Quaternion(), sc = new THREE.Vector3(1, 1, 1), pos = new THREE.Vector3();
  const place = (s: number, lat: number, h: number) => {
    const f = track.frameAt(s);
    const p = track.pointAt(s, lat, h);
    pos.set(p.x, p.y, p.z);
    q.setFromRotationMatrix(new THREE.Matrix4().makeBasis(new THREE.Vector3(-f.rx, 0, -f.rz), new THREE.Vector3(f.ux, f.uy, f.uz), new THREE.Vector3(f.tx, f.ty, f.tz)));
    m4.compose(pos, q, sc);
    return m4;
  };
  const addBarriers = (list: typeof placements, mat: THREE.Material, name: string) => {
    if (!list.length) return;
    const im = new THREE.InstancedMesh(barrierGeo, mat, list.length);
    im.name = name;
    list.forEach((p, i) => im.setMatrixAt(i, place(p.s, p.side * (track.barrierOffsetAt(p.s) + T.barrierThickness / 2), 0)));
    im.castShadow = false;
    im.receiveShadow = opts.shadows;
    im.computeBoundingSphere();
    group.add(im);
  };
  addBarriers(normal, mats.barrier, 'barriers');
  addBarriers(haz, mats.hazard, 'barriers_hazard');

  // Neon edge strip along the barrier tops, coloured per district (road edges readable at night).
  const stripGeo = new THREE.BoxGeometry(0.12, 0.06, 4.02);
  const byDistrict = new Map<string, number[]>();
  placements.forEach((p, i) => {
    const d = track.districtAt(p.s);
    const k = p.hazard ? 'HAZARD' : d;
    const arr = byDistrict.get(k) ?? [];
    arr.push(i);
    byDistrict.set(k, arr);
  });
  for (const [k, idxs] of byDistrict) {
    const color = k === 'HAZARD' ? new THREE.Color(0xffb01a) : DISTRICT_LOOK[k as DistrictId].accent;
    const im = new THREE.InstancedMesh(stripGeo, mats.neon(color, 3.2), idxs.length);
    im.name = `edge_neon_${k}`;
    idxs.forEach((pi, i) => {
      const p = placements[pi]!;
      im.setMatrixAt(i, place(p.s, p.side * (track.barrierOffsetAt(p.s) + T.barrierThickness / 2), 1.08));
    });
    im.computeBoundingSphere();
    group.add(im);
  }
  // Spectator fence (thin posts + rail) where crowds stand.
  const fenceS: { s: number; side: number }[] = placements.filter((p) => track.crowdDensityAt(p.s) >= 0.4 && Math.round(p.s / 4) % 1 === 0);
  if (fenceS.length) {
    const postGeo = new THREE.BoxGeometry(0.06, 1.3, 0.06);
    postGeo.translate(0, 1.05 + 0.65, 0);
    const posts = new THREE.InstancedMesh(postGeo, mats.steel, fenceS.length);
    const railGeo = new THREE.BoxGeometry(0.05, 0.05, 4.02);
    railGeo.translate(0, 2.3, 0);
    const rails = new THREE.InstancedMesh(railGeo, mats.steel, fenceS.length);
    fenceS.forEach((p, i) => {
      const mtx = place(p.s, p.side * (track.barrierOffsetAt(p.s) + T.barrierThickness / 2), 0);
      posts.setMatrixAt(i, mtx);
      rails.setMatrixAt(i, mtx);
    });
    posts.computeBoundingSphere();
    rails.computeBoundingSphere();
    group.add(posts, rails);
  }

  // ---------------------------------------------------------------- pillars under viaducts / bridge
  const pillarGeo = new THREE.BoxGeometry(1.6, 1, 2.2);
  pillarGeo.translate(0, -0.5, 0);
  const pillarMats: THREE.Matrix4[] = [];
  const nearOtherRoad = (x: number, z: number, s: number) => {
    for (let i = 0; i < track.n; i += 3) {
      if (Math.abs(track.deltaS(i, s)) < 120) continue;
      const dx = track.px[i]! - x, dz = track.pz[i]! - z;
      if (dx * dx + dz * dz < (outerEdge(track, i) + 4) ** 2) return true;
    }
    return false;
  };
  for (let s = 10; s < track.length; s += T.pillarSpacing) {
    const k = track.structureAt(s);
    if (k !== STRUCTURE.VIADUCT && k !== STRUCTURE.BRIDGE) continue;
    if (s > b.lip - 20 && s < b.gapEnd + 20) continue;
    const f = track.frameAt(s);
    const deckBottom = f.py - 1.4;
    const over = track.isOverWater(f.px, f.pz);
    const ground = over ? T.waterY - 1 : T.baseGroundY - 0.2;
    const height = deckBottom - ground;
    if (height < 2) continue;
    for (const side of k === STRUCTURE.BRIDGE ? [-1, 1] : [0]) {
      const lat = side * (track.halfWidthAt(s) * 0.6);
      const p = track.pointAt(s, lat, 0);
      if (nearOtherRoad(p.x, p.z, s)) continue;
      const mtx = new THREE.Matrix4().compose(new THREE.Vector3(p.x, deckBottom, p.z), new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), Math.atan2(f.tx, f.tz)), new THREE.Vector3(1, height, 1));
      pillarMats.push(mtx);
    }
  }
  if (pillarMats.length) {
    const im = new THREE.InstancedMesh(pillarGeo, mats.concrete, pillarMats.length);
    im.name = 'pillars';
    pillarMats.forEach((m, i) => im.setMatrixAt(i, m));
    im.computeBoundingSphere();
    group.add(im);
  }

  // ---------------------------------------------------------------- trench walls + tunnel podium
  const tw = newStrip();
  let t0 = -1;
  for (let s = 0; s <= track.length; s += STEP) {
    const k = track.structureAt(s);
    const below = k === STRUCTURE.TRENCH;
    if (below && t0 < 0) t0 = s;
    if ((!below || s + STEP > track.length) && t0 >= 0) {
      for (const side of [-1, 1]) wall(tw, track, t0, s, (ss) => side * outerEdge(track, ss), (ss) => track.frameAt(ss).py, () => 0.25, -side);
      t0 = -1;
    }
  }
  if (tw.pos.length) {
    const m = new THREE.Mesh(finishStrip(tw), mats.wall);
    m.name = 'trench_walls';
    group.add(m);
  }
  {
    const s0 = track.tunnel.s0, s1 = track.tunnel.s1;
    const a = track.pointAt(s0, 0, 0), c = track.pointAt(s1, 0, 0);
    const len = Math.hypot(c.x - a.x, c.z - a.z);
    const podium = new THREE.Mesh(new THREE.BoxGeometry(outerEdge(track, (s0 + s1) / 2) * 2 + 10, 1.2, len - 2), mats.concreteDark);
    podium.position.set((a.x + c.x) / 2, 2.4 + 0.6 + 0.05, (a.z + c.z) / 2);
    podium.rotation.y = Math.atan2(c.x - a.x, c.z - a.z);
    podium.name = 'tunnel_podium';
    group.add(podium);
  }

  // ---------------------------------------------------------------- street lamps (emitters for the light pool)
  const lampPos: THREE.Matrix4[] = [];
  const headPos: THREE.Matrix4[] = [];
  for (let s = 18; s < track.length; s += 34) {
    const k = track.structureAt(s);
    if (k === STRUCTURE.TUNNEL) continue;
    if (s > b.lip - 30 && s < b.gapEnd + 30) continue;
    const side = Math.floor(s / 34) % 2 === 0 ? 1 : -1;
    const f = track.frameAt(s);
    const lat = side * (track.barrierOffsetAt(s) + T.barrierThickness + 0.6);
    const base = track.pointAt(s, lat, T.curbHeight);
    const yaw = Math.atan2(-f.rx * side, -f.rz * side);
    lampPos.push(new THREE.Matrix4().compose(new THREE.Vector3(base.x, base.y, base.z), new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), yaw), new THREE.Vector3(1, 1, 1)));
    const head = track.pointAt(s, lat - side * 2.2, T.curbHeight + 8.2);
    headPos.push(new THREE.Matrix4().compose(new THREE.Vector3(head.x, head.y, head.z), new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), yaw), new THREE.Vector3(1, 1, 1)));
    const look = DISTRICT_LOOK[track.districtAt(s)];
    const warm = (s * 7919) % 100 < look.windowWarmth * 100;
    emitters.push({ pos: new THREE.Vector3(head.x, head.y - 0.4, head.z), color: warm ? new THREE.Color(0xffb56a) : look.accent.clone().lerp(new THREE.Color(0xffffff), 0.45), intensity: 38, range: 34 });
  }
  if (lampPos.length) {
    const poleGeo = new THREE.CylinderGeometry(0.09, 0.13, 8.4, 6);
    poleGeo.translate(0, 4.2, 0);
    const armGeo = new THREE.BoxGeometry(0.08, 0.08, 2.4);
    armGeo.translate(0, 8.3, 1.1);
    const poles = new THREE.InstancedMesh(poleGeo, mats.steel, lampPos.length);
    const arms = new THREE.InstancedMesh(armGeo, mats.steel, lampPos.length);
    lampPos.forEach((m, i) => {
      poles.setMatrixAt(i, m);
      arms.setMatrixAt(i, m);
    });
    const headGeo = new THREE.BoxGeometry(0.5, 0.12, 0.9);
    const heads = new THREE.InstancedMesh(headGeo, mats.neon(0xfff0dd, 4), headPos.length);
    headPos.forEach((m, i) => heads.setMatrixAt(i, m));
    for (const im of [poles, arms, heads]) {
      im.computeBoundingSphere();
      group.add(im);
    }
  }

  // ---------------------------------------------------------------- ground (masked) + water
  const groundMask = buildGroundMask(track);
  const bounds = { minX: -1300, maxX: 1500, minZ: -1400, maxZ: 1800 };
  const gGeo = new THREE.PlaneGeometry(bounds.maxX - bounds.minX, bounds.maxZ - bounds.minZ, 1, 1);
  gGeo.rotateX(-Math.PI / 2);
  gGeo.translate((bounds.minX + bounds.maxX) / 2, -0.06, (bounds.minZ + bounds.maxZ) / 2);
  const n = gGeo.attributes.position!.count;
  gGeo.setAttribute('aTrack', new THREE.Float32BufferAttribute(new Float32Array(n * 3), 3));
  gGeo.setAttribute('aWet', new THREE.Float32BufferAttribute(new Float32Array(n).fill(0.25), 1));
  const groundMat = road.ground as THREE.MeshPhysicalMaterial;
  const prevCompile = groundMat.onBeforeCompile;
  groundMat.onBeforeCompile = (shader, r) => {
    prevCompile.call(groundMat, shader, r);
    shader.uniforms.uGroundMask = { value: groundMask };
    shader.fragmentShader = shader.fragmentShader
      .replace('#include <common>', `#include <common>\nuniform sampler2D uGroundMask;`)
      .replace(
        '#include <clipping_planes_fragment>',
        `#include <clipping_planes_fragment>
        vec2 gmUv = vec2((vWorldPos.x - (${bounds.minX.toFixed(1)})) / ${(bounds.maxX - bounds.minX).toFixed(1)}, (vWorldPos.z - (${bounds.minZ.toFixed(1)})) / ${(bounds.maxZ - bounds.minZ).toFixed(1)});
        if (texture2D(uGroundMask, gmUv).r > 0.5) discard;`,
      );
  };
  groundMat.customProgramCacheKey = () => 'wetroad_ground_masked';
  const ground = new THREE.Mesh(gGeo, groundMat);
  ground.name = 'ground';
  ground.receiveShadow = opts.shadows;
  group.add(ground);

  const W = WATER_REGION;
  const water = new THREE.Mesh(new THREE.PlaneGeometry(W.maxX - W.minX + 40, W.maxZ - W.minZ + 40).rotateX(-Math.PI / 2), mats.water);
  water.position.set((W.minX + W.maxX) / 2, T.waterY, (W.minZ + W.maxZ) / 2);
  water.name = 'water';
  group.add(water);
  const quay = newStrip();
  const qv = (x0: number, z0: number, x1: number, z1: number) => {
    const base = quay.pos.length / 3;
    quay.pos.push(x0, T.waterY - 1, z0, x0, 0, z0, x1, T.waterY - 1, z1, x1, 0, z1);
    const nx = -(z1 - z0), nz = x1 - x0, l = Math.hypot(nx, nz);
    for (let i = 0; i < 4; i++) {
      quay.nrm.push(nx / l, 0, nz / l);
      quay.trk.push(0, 0, 0);
      quay.wet.push(0);
    }
    quay.uv.push(0, 0, 0, 1, 1, 0, 1, 1);
    quay.idx.push(base, base + 2, base + 1, base + 1, base + 2, base + 3);
  };
  qv(W.minX, W.minZ, W.maxX, W.minZ);
  qv(W.maxX, W.minZ, W.maxX, W.maxZ);
  qv(W.maxX, W.maxZ, W.minX, W.maxZ);
  qv(W.minX, W.maxZ, W.minX, W.minZ);
  const quayMesh = new THREE.Mesh(finishStrip(quay), mats.wall);
  group.add(quayMesh);

  return { group, roadMeshes, emitters, groundMask };
}

/** Ground-plane holes: under ground-level/below-ground road corridors and the water body. */
function buildGroundMask(track: Track): THREE.DataTexture {
  const size = 1024;
  const bounds = { minX: -1300, maxX: 1500, minZ: -1400, maxZ: 1800 };
  const data = new Uint8Array(size * size * 4);
  const toTex = (x: number, z: number) => [((x - bounds.minX) / (bounds.maxX - bounds.minX)) * size, ((z - bounds.minZ) / (bounds.maxZ - bounds.minZ)) * size] as const;
  const texel = (bounds.maxX - bounds.minX) / size;
  const stamp = (cx: number, cz: number, r: number) => {
    const [tx, tz] = toTex(cx, cz);
    const rr = r / texel;
    for (let y = Math.floor(tz - rr); y <= Math.ceil(tz + rr); y++) {
      if (y < 0 || y >= size) continue;
      for (let x = Math.floor(tx - rr); x <= Math.ceil(tx + rr); x++) {
        if (x < 0 || x >= size) continue;
        if ((x - tx) ** 2 + (y - tz) ** 2 <= rr * rr) data[(y * size + x) * 4] = 255;
      }
    }
  };
  for (let i = 0; i < track.n; i++) {
    const y = track.py[i]!;
    const k = track.structure[i]!;
    if (y < 0.6 || k === STRUCTURE.TUNNEL || k === STRUCTURE.TRENCH) stamp(track.px[i]!, track.pz[i]!, outerEdge(track, i) - 0.6);
  }
  const W = WATER_REGION;
  for (let z = W.minZ; z <= W.maxZ; z += texel) for (let x = W.minX; x <= W.maxX; x += texel) {
    const [tx, tz] = toTex(x, z);
    const xi = Math.floor(tx), zi = Math.floor(tz);
    if (xi >= 0 && xi < size && zi >= 0 && zi < size) data[(zi * size + xi) * 4] = 255;
  }
  const tex = new THREE.DataTexture(data, size, size, THREE.RGBAFormat);
  tex.magFilter = THREE.LinearFilter;
  tex.minFilter = THREE.LinearFilter;
  tex.needsUpdate = true;
  return tex;
}
