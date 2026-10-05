// District dressing: source city assets placed beside the custom track (never defining it),
// procedural lit buildings as fill, holograms/neon, start/finish gantry, checkpoint arches,
// braking boards and corner chevrons (blueprint "District sequence", art "District signatures").
import * as THREE from 'three';
import { ROAD_PROFILE } from '../../config/track.js';
import type { DistrictId } from '../../shared/ids.js';
import { hash01, mulberry32 } from '../../shared/math.js';
import { STRUCTURE, type Track } from '../../game/track/Track.js';
import type { AssetStore } from '../AssetStore.js';
import { holoMaterial, neonSignMaterial } from '../materials/Holo.js';
import { DISTRICT_LOOK, NEON, type Materials } from '../materials/Palette.js';
import { clearTrackCorridor } from './Corridor.js';
import type { LightEmitter } from './TrackMeshes.js';

export interface DressingResult {
  group: THREE.Group;
  emitters: LightEmitter[];
  animated: THREE.ShaderMaterial[];
  skyline: THREE.Object3D[];
}

interface Footprint {
  x: number;
  z: number;
  r: number;
}

function outerEdge(track: Track, s: number): number {
  return track.barrierOffsetAt(s) + ROAD_PROFILE.barrierThickness + ROAD_PROFILE.sidewalkWidth;
}

/** Distance from (x,z) to the nearest road outer edge (coarse, whole lap). */
function clearanceToRoads(track: Track, x: number, z: number): number {
  let best = Infinity;
  for (let i = 0; i < track.n; i += 4) {
    const d = Math.hypot(track.px[i]! - x, track.pz[i]! - z) - outerEdge(track, i);
    if (d < best) best = d;
  }
  return best;
}

const DISTRICT_HEIGHT: Record<DistrictId, [number, number, number]> = {
  // [min height, max height, density 0..1]
  NEON_CORE: [60, 240, 1],
  COMMERCIAL: [30, 150, 0.9],
  STORM: [15, 60, 0.25],
  HEAVY_RAIN_TECHNICAL: [20, 90, 0.55],
  INDUSTRIAL: [12, 40, 0.35],
  TUNNEL: [0, 0, 0],
  BRIDGE_CLIMB: [18, 70, 0.4],
  BROKEN_BRIDGE: [0, 0, 0],
  WESTERN_TECHNICAL: [25, 110, 0.6],
  FINAL_NEON_RUN: [50, 200, 1],
};

function buildingMaterial(): THREE.MeshStandardMaterial {
  const m = new THREE.MeshStandardMaterial({ color: 0x1a1d26, roughness: 0.7, metalness: 0.3, name: 'building_windows' });
  m.onBeforeCompile = (shader) => {
    shader.vertexShader = shader.vertexShader
      .replace('#include <common>', `#include <common>\nattribute vec4 aWin;\nvarying vec4 vWin;\nvarying vec3 vWPos;\nvarying vec3 vWNrm;`)
      .replace('#include <worldpos_vertex>', `#include <worldpos_vertex>\nvWin = aWin;\nvec4 wp = modelMatrix * instanceMatrix * vec4(transformed, 1.0);\nvWPos = wp.xyz;\nvWNrm = normalize(mat3(modelMatrix * instanceMatrix) * objectNormal);`);
    shader.fragmentShader = shader.fragmentShader
      .replace('#include <common>', `#include <common>\nvarying vec4 vWin;\nvarying vec3 vWPos;\nvarying vec3 vWNrm;\nfloat bh(vec3 p){ return fract(sin(dot(p, vec3(12.9898,78.233,37.719))) * 43758.5453); }`)
      .replace(
        '#include <emissivemap_fragment>',
        `#include <emissivemap_fragment>
        if (abs(vWNrm.y) < 0.5) {
          vec3 t = normalize(cross(vec3(0.0, 1.0, 0.0), vWNrm));
          float u = dot(vWPos, t);
          vec2 cell = vec2(u / 3.2, vWPos.y / 3.6);
          vec2 f = fract(cell);
          float win = step(0.18, f.x) * step(f.x, 0.82) * step(0.22, f.y) * step(f.y, 0.78);
          float lit = step(0.58 - vWin.a * 0.25, bh(vec3(floor(cell), vWin.a * 91.0)));
          float flick = 0.85 + 0.15 * bh(vec3(floor(cell) * 1.7, 3.0));
          totalEmissiveRadiance += vWin.rgb * win * lit * flick * 1.4;
          diffuseColor.rgb *= mix(1.0, 0.35, win);
        }`,
      )
      .replace('#include <roughnessmap_fragment>', `#include <roughnessmap_fragment>\nroughnessFactor = abs(vWNrm.y) < 0.5 ? 0.25 : 0.8;`);
  };
  m.customProgramCacheKey = () => 'building_windows';
  return m;
}

export async function buildDressing(track: Track, assets: AssetStore, mats: Materials, opts: { lowLod: boolean; density: number }): Promise<DressingResult> {
  const group = new THREE.Group();
  group.name = 'dressing';
  const emitters: LightEmitter[] = [];
  const animated: THREE.ShaderMaterial[] = [];
  const skyline: THREE.Object3D[] = [];
  const footprints: Footprint[] = [];
  const rnd = mulberry32(1337);

  const placeAt = (s: number, lateral: number) => {
    const p = track.pointAt(s, lateral, 0);
    return new THREE.Vector3(p.x, 0, p.z);
  };
  const yawAlong = (s: number) => {
    const f = track.frameAt(s);
    return Math.atan2(-f.tz, f.tx); // maps local +X to the tangent
  };

  // ------------------------------------------------------------------ Times Square (Neon Core)
  const ts = await assets.model('city.timesSquare');
  if (ts) {
    const s = 300;
    const obj = ts.scene;
    obj.scale.setScalar(1.2); // avenue half-width ~13.6 m clears road + sidewalks
    const p = track.pointAt(s, 0, 0);
    obj.position.set(p.x, Math.min(0, p.y) - 0.1, p.z);
    obj.rotation.y = yawAlong(s);
    obj.traverse((o) => {
      const m = o as THREE.Mesh;
      if (m.isMesh) {
        m.castShadow = false;
        m.receiveShadow = false;
        const mat = m.material as THREE.MeshStandardMaterial;
        if (mat.emissiveMap) mat.emissiveIntensity = 2.2;
      }
    });
    // The avenue follows the track only near s = 300; elsewhere its facades would stand on the road.
    const cleared = clearTrackCorridor(obj, track, { margin: 0.3, height: 14, below: 1.5 });
    console.info(`[dressing] Times Square: removed ${cleared.removed} of ${cleared.total} triangles inside the racing corridor (${cleared.meshes} meshes)`);
    group.add(obj);
    footprints.push({ x: p.x, z: p.z, r: 380 });
  }

  // ------------------------------------------------------------------ Commercial blocks
  const com = await assets.model('city.commercial');
  if (com) {
    const s0 = track.sOf('N2'), s1 = track.sOf('N6');
    let k = 0;
    for (let s = s0 + 60; s < s1; s += 260) {
      const side = k++ % 2 === 0 ? 1 : -1;
      const lateral = side * (outerEdge(track, s) + 128);
      const pos = placeAt(s, lateral);
      if (clearanceToRoads(track, pos.x, pos.z) < 118) continue;
      const inst = com.scene.clone(true);
      inst.position.copy(pos);
      inst.rotation.y = yawAlong(s) + (Math.floor(rnd() * 4) * Math.PI) / 2;
      group.add(inst);
      footprints.push({ x: pos.x, z: pos.z, r: 160 });
    }
    // Brighten the diorama's emissive colours so they read as neon.
    com.scene.traverse((o) => {
      const m = (o as THREE.Mesh).material as THREE.MeshStandardMaterial | undefined;
      if (m && m.emissive && m.emissive.getHex() !== 0) m.emissiveIntensity = 3;
    });
  }

  // ------------------------------------------------------------------ Industrial blocks
  const ind = await assets.model('city.industrial');
  if (ind) {
    const s0 = track.sOf('I1') - 60, s1 = track.sOf('T_IN') - 20;
    let k = 0;
    for (let s = s0; s < s1; s += 105) {
      for (const side of [-1, 1]) {
        if ((k++ + (side > 0 ? 1 : 0)) % 3 === 2) continue;
        const lateral = side * (outerEdge(track, s) + 48);
        const pos = placeAt(s, lateral);
        if (clearanceToRoads(track, pos.x, pos.z) < 44) continue;
        const inst = ind.scene.clone(true);
        inst.position.copy(pos);
        inst.rotation.y = yawAlong(s) + (side > 0 ? 0 : Math.PI) + (rnd() - 0.5) * 0.3;
        group.add(inst);
        footprints.push({ x: pos.x, z: pos.z, r: 50 });
        // No point light here: it had no visible fixture and only showed up as an orange pool on
        // the wet road. The blocks' own emissive windows and the street lamps light this stretch.
      }
    }
  }

  // ------------------------------------------------------------------ Distant skyline (silhouette + lit windows)
  const sky = await assets.model('city.skyline', 'lod0');
  if (sky) {
    const centre = new THREE.Vector3(0, 0, 200);
    const ring = [0, 1.25, 2.5, 3.8, 5.05];
    for (const a of ring) {
      const inst = sky.scene.clone(true);
      const d = 2300 + (a * 97) % 400;
      inst.position.set(centre.x + Math.cos(a) * d, -30, centre.z + Math.sin(a) * d);
      inst.rotation.y = -a + Math.PI / 2;
      inst.scale.setScalar(0.9);
      inst.traverse((o) => {
        const m = o as THREE.Mesh;
        if (!m.isMesh) return;
        const src = m.material as THREE.MeshStandardMaterial;
        const sm = new THREE.MeshBasicMaterial({ color: 0x1b1a2e, map: src.map ?? null, fog: false });
        sm.onBeforeCompile = (shader) => {
          shader.fragmentShader = shader.fragmentShader.replace(
            '#include <map_fragment>',
            `#include <map_fragment>
            vec3 lum = diffuseColor.rgb;
            float lit = smoothstep(0.55, 0.9, max(max(lum.r, lum.g), lum.b));
            diffuseColor.rgb = mix(vec3(0.03, 0.035, 0.07), vec3(1.0, 0.75, 0.5) * 2.2, lit * 0.8);`,
          );
        };
        m.material = sm;
        m.frustumCulled = false;
      });
      skyline.push(inst);
      group.add(inst);
    }
  }

  // ------------------------------------------------------------------ Procedural lit buildings (fill)
  const boxes: { m: THREE.Matrix4; win: [number, number, number, number] }[] = [];
  const box = new THREE.BoxGeometry(1, 1, 1);
  box.translate(0, 0.5, 0);
  const occupied = (x: number, z: number, r: number) => footprints.some((f) => Math.hypot(f.x - x, f.z - z) < f.r + r) || track.isOverWater(x, z);
  for (let s = 0; s < track.length; s += 18) {
    const d = track.districtAt(s);
    const [hmin, hmax, dens] = DISTRICT_HEIGHT[d];
    if (dens <= 0 || track.structureAt(s) === STRUCTURE.TUNNEL) continue;
    for (const side of [-1, 1]) {
      if (rnd() > dens * opts.density) continue;
      const depthRow = rnd() < 0.5 ? 0 : 1;
      const w = 14 + rnd() * 26, dp = 14 + rnd() * 22;
      const lateral = side * (outerEdge(track, s) + 10 + depthRow * 40 + dp / 2 + rnd() * 8);
      const pos = placeAt(s, lateral);
      const r = Math.max(w, dp) * 0.7;
      if (occupied(pos.x, pos.z, r)) continue;
      if (clearanceToRoads(track, pos.x, pos.z) < r + 6) continue;
      const hgt = hmin + Math.pow(rnd(), 1.6) * (hmax - hmin);
      const yaw = yawAlong(s) + (rnd() - 0.5) * 0.2;
      const mtx = new THREE.Matrix4().compose(pos, new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), yaw), new THREE.Vector3(w, hgt, dp));
      const look = DISTRICT_LOOK[d];
      const warm = rnd() < look.windowWarmth;
      const c = warm ? new THREE.Color(0xffb56a) : look.accent.clone().lerp(new THREE.Color(0xbfe8ff), 0.55);
      c.multiplyScalar(0.8 + rnd() * 0.6);
      boxes.push({ m: mtx, win: [c.r, c.g, c.b, rnd()] });
      footprints.push({ x: pos.x, z: pos.z, r });
      // Rooftop neon sign on some tall buildings in neon districts.
      if ((d === 'NEON_CORE' || d === 'FINAL_NEON_RUN' || d === 'COMMERCIAL') && hgt > 70 && rnd() < 0.35) {
        const sign = new THREE.Mesh(new THREE.PlaneGeometry(w * 0.9, w * 0.22), neonSignMaterial(Math.floor(rnd() * 1e6)));
        const top = pos.clone().add(new THREE.Vector3(0, hgt + w * 0.13, 0));
        sign.position.copy(top);
        sign.rotation.y = yaw + (side > 0 ? -Math.PI / 2 : Math.PI / 2);
        group.add(sign);
      }
    }
  }
  if (boxes.length) {
    const im = new THREE.InstancedMesh(box, buildingMaterial(), boxes.length);
    const win = new Float32Array(boxes.length * 4);
    boxes.forEach((b, i) => {
      im.setMatrixAt(i, b.m);
      win.set(b.win, i * 4);
    });
    im.geometry = box.clone();
    im.geometry.setAttribute('aWin', new THREE.InstancedBufferAttribute(win, 4));
    im.computeBoundingSphere();
    im.name = 'procedural_buildings';
    group.add(im);
  }

  // ------------------------------------------------------------------ Holograms along neon districts
  const holoDistricts: DistrictId[] = ['NEON_CORE', 'COMMERCIAL', 'FINAL_NEON_RUN', 'WESTERN_TECHNICAL', 'HEAVY_RAIN_TECHNICAL'];
  let hk = 0;
  for (let s = 40; s < track.length; s += 75) {
    const d = track.districtAt(s);
    if (!holoDistricts.includes(d)) continue;
    if (d !== 'NEON_CORE' && d !== 'FINAL_NEON_RUN' && hk % 2 === 1) {
      hk++;
      continue;
    }
    const side = hk++ % 2 === 0 ? 1 : -1;
    const f = track.frameAt(s);
    const lateral = side * (outerEdge(track, s) + 2.5);
    const baseP = track.pointAt(s, lateral, 0);
    const w = 9 + (hk % 3) * 3, hh = w * 0.5;
    const mat = holoMaterial(hk * 7919 + 13, DISTRICT_LOOK[d].accent, 2.4);
    animated.push(mat);
    const plane = new THREE.Mesh(new THREE.PlaneGeometry(w, hh), mat);
    plane.position.set(baseP.x, baseP.y + 7 + hh / 2, baseP.z);
    // Face approaching riders, angled toward the road.
    plane.rotation.y = Math.atan2(-f.tx, -f.tz) + side * 0.5;
    plane.renderOrder = 5;
    group.add(plane);
    const pole = new THREE.Mesh(new THREE.CylinderGeometry(0.15, 0.2, 7, 6), mats.steel);
    pole.position.set(baseP.x, baseP.y + 3.5, baseP.z);
    group.add(pole);
    emitters.push({ pos: plane.position.clone(), color: DISTRICT_LOOK[d].accent.clone(), intensity: 30, range: 26 });
  }

  // ------------------------------------------------------------------ Start/finish gantry
  {
    const s = 0;
    const f = track.frameAt(s);
    const hw = track.barrierOffsetAt(s) + 1.2;
    const g = new THREE.Group();
    const legGeo = new THREE.BoxGeometry(0.9, 11, 0.9);
    for (const side of [-1, 1]) {
      const leg = new THREE.Mesh(legGeo, mats.steel);
      leg.position.set(side * hw, 5.5, 0);
      g.add(leg);
      const strip = new THREE.Mesh(new THREE.BoxGeometry(0.12, 10.4, 0.12), mats.neon(NEON.magenta, 4));
      strip.position.set(side * (hw - 0.5), 5.4, 0.5);
      g.add(strip);
    }
    const beam = new THREE.Mesh(new THREE.BoxGeometry(hw * 2 + 1, 2.6, 1.2), mats.steel);
    beam.position.set(0, 11.2, 0);
    g.add(beam);
    const sign = new THREE.Mesh(new THREE.PlaneGeometry(hw * 2 - 1, 2.1), finishBanner());
    sign.position.set(0, 11.2, -0.62);
    sign.rotation.y = Math.PI;
    g.add(sign);
    const sign2 = sign.clone();
    sign2.position.z = 0.62;
    sign2.rotation.y = 0;
    g.add(sign2);
    const p = track.pointAt(s, 0, 0);
    g.position.set(p.x, p.y, p.z);
    g.rotation.y = Math.atan2(f.tx, f.tz);
    group.add(g);
    emitters.push({ pos: new THREE.Vector3(p.x, p.y + 9, p.z), color: new THREE.Color(0xffffff), intensity: 90, range: 40 });
  }

  // ------------------------------------------------------------------ Checkpoint arches (navigation cues)
  const archMat = mats.neon(NEON.cyan, 2.2);
  for (const cp of track.checkpoints) {
    if (track.structureAt(cp.s) === STRUCTURE.TUNNEL) continue;
    const f = track.frameAt(cp.s);
    const hw = track.barrierOffsetAt(cp.s) + 0.4;
    const arch = new THREE.Group();
    for (const side of [-1, 1]) {
      const post = new THREE.Mesh(new THREE.BoxGeometry(0.18, 7, 0.18), archMat);
      post.position.set(side * hw, 3.5, 0);
      arch.add(post);
    }
    const top = new THREE.Mesh(new THREE.BoxGeometry(hw * 2, 0.18, 0.18), archMat);
    top.position.set(0, 7, 0);
    arch.add(top);
    const p = track.pointAt(cp.s, 0, 0);
    arch.position.set(p.x, p.y, p.z);
    arch.rotation.y = Math.atan2(f.tx, f.tz);
    group.add(arch);
  }

  // ------------------------------------------------------------------ Corner chevrons + braking boards
  const chevronMat = chevronMaterial();
  const chevGeo = new THREE.PlaneGeometry(1.6, 1.1);
  const chevrons: THREE.Matrix4[] = [];
  for (let i = 0; i < track.n; i += 10) {
    const k = track.curvature[i]!;
    if (Math.abs(k) < 1 / 95) continue;
    const s = i;
    if (track.structureAt(s) === STRUCTURE.TUNNEL) continue;
    const outside = k > 0 ? -1 : 1; // yaw increasing = left turn -> outside is right
    const f = track.frameAt(s);
    const p = track.pointAt(s, outside * (track.barrierOffsetAt(s) + 0.6), 1.9);
    const yaw = Math.atan2(-f.tx, -f.tz);
    const m = new THREE.Matrix4().compose(new THREE.Vector3(p.x, p.y, p.z), new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), yaw), new THREE.Vector3(outside > 0 ? 1 : -1, 1, 1));
    chevrons.push(m);
  }
  if (chevrons.length) {
    const im = new THREE.InstancedMesh(chevGeo, chevronMat, chevrons.length);
    chevrons.forEach((m, i) => im.setMatrixAt(i, m));
    im.computeBoundingSphere();
    im.name = 'chevrons';
    group.add(im);
  }
  // Braking boards before the high-speed exits of both boost straights and the hairpin entries.
  const brakeTargets = [track.sOf('B1_OUT') + 40, track.bridge.gapEnd + 90, track.sOf('B1_IN') - 10, track.sOf('BR_IN') - 30];
  for (const target of brakeTargets) {
    for (const dist of [150, 100, 50]) {
      const s = target - dist;
      const f = track.frameAt(s);
      for (const side of [-1, 1]) {
        const board = new THREE.Mesh(new THREE.PlaneGeometry(1.4, 1.8), brakeBoardMaterial(dist));
        const p = track.pointAt(s, side * (track.barrierOffsetAt(s) + 0.9), 2.2);
        board.position.set(p.x, p.y, p.z);
        board.rotation.y = Math.atan2(-f.tx, -f.tz);
        group.add(board);
      }
      // The boards are self-lit signs, not lamps: no point light (an unseen light over the road
      // centre only showed up as an amber pool in the wet reflections).
    }
  }
  return { group, emitters, animated, skyline };
}

function finishBanner(): THREE.MeshBasicMaterial {
  const c = document.createElement('canvas');
  c.width = 1024;
  c.height = 128;
  const g = c.getContext('2d')!;
  for (let x = 0; x < 1024; x += 32) for (let y = 0; y < 128; y += 32) {
    g.fillStyle = ((x + y) / 32) % 2 === 0 ? '#ffffff' : '#101010';
    g.fillRect(x, y, 32, 32);
  }
  g.fillStyle = 'rgba(8,8,16,0.85)';
  g.fillRect(180, 18, 664, 92);
  g.fillStyle = '#ff2bd6';
  g.font = '900 64px Arial Black, Impact, sans-serif';
  g.textAlign = 'center';
  g.textBaseline = 'middle';
  g.fillText('PIZZERIA ROADRASH', 512, 66, 640);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  return new THREE.MeshBasicMaterial({ map: t, color: new THREE.Color(1.8, 1.8, 1.8), side: THREE.DoubleSide });
}

function chevronMaterial(): THREE.MeshBasicMaterial {
  const c = document.createElement('canvas');
  c.width = 128;
  c.height = 96;
  const g = c.getContext('2d')!;
  g.fillStyle = '#111';
  g.fillRect(0, 0, 128, 96);
  g.fillStyle = '#ffb01a';
  for (const ox of [10, 58]) {
    g.beginPath();
    g.moveTo(ox, 10);
    g.lineTo(ox + 30, 48);
    g.lineTo(ox, 86);
    g.lineTo(ox + 20, 86);
    g.lineTo(ox + 50, 48);
    g.lineTo(ox + 20, 10);
    g.closePath();
    g.fill();
  }
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  return new THREE.MeshBasicMaterial({ map: t, color: new THREE.Color(2.2, 2.2, 2.2), side: THREE.DoubleSide });
}

const boardCache = new Map<number, THREE.MeshBasicMaterial>();
function brakeBoardMaterial(dist: number): THREE.MeshBasicMaterial {
  let m = boardCache.get(dist);
  if (m) return m;
  const c = document.createElement('canvas');
  c.width = 96;
  c.height = 128;
  const g = c.getContext('2d')!;
  g.fillStyle = '#f2f2f2';
  g.fillRect(0, 0, 96, 128);
  g.fillStyle = '#d0141e';
  g.fillRect(6, 6, 84, 116);
  g.fillStyle = '#fff';
  g.font = '900 44px Arial Black, Impact, sans-serif';
  g.textAlign = 'center';
  g.textBaseline = 'middle';
  g.fillText(String(dist), 48, 64);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  m = new THREE.MeshBasicMaterial({ map: t, color: new THREE.Color(1.6, 1.6, 1.6), side: THREE.DoubleSide });
  boardCache.set(dist, m);
  return m;
}

export function hashSide(s: number): number {
  return hash01(Math.floor(s)) > 0.5 ? 1 : -1;
}
