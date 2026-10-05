// Future tunnel (modular instanced shell) and broken-bridge set piece (kit modules).
// The custom spline road stays authoritative for driving and collision in both.
import * as THREE from 'three';
import { ROAD_PROFILE, TUNNEL_SPEC } from '../../config/track.js';
import type { Track } from '../../game/track/Track.js';
import { tunnelModulePlacements } from '../../game/track/TrackGeometry.js';
import type { AssetStore } from '../AssetStore.js';
import { NEON, type Materials } from '../materials/Palette.js';
import type { LightEmitter } from './TrackMeshes.js';

export interface StructureResult {
  group: THREE.Group;
  emitters: LightEmitter[];
  beacons: THREE.Mesh[];
}

function lightStop(t: number): THREE.Color {
  const stops = TUNNEL_SPEC.lightStops;
  for (let i = 0; i < stops.length - 1; i++) {
    const a = stops[i]!, b = stops[i + 1]!;
    if (t >= a.t && t <= b.t) return new THREE.Color(a.color).lerp(new THREE.Color(b.color), (t - a.t) / (b.t - a.t));
  }
  return new THREE.Color(stops[stops.length - 1]!.color);
}

/** Whether a module at centre s must be bent (curved road, or walls to be fitted to the barriers). */
function moduleNeedsBend(track: Track, sC: number, len: number): boolean {
  const want = (s: number) => track.barrierOffsetAt(s) + ROAD_PROFILE.barrierThickness;
  for (let s = sC - len / 2; s <= sC + len / 2; s += 2) {
    if (Math.abs(track.curvature[track.wrapIndex(Math.floor(s))]!) > 4e-4) return true;
    if (Math.abs(want(s) - TUNNEL_SPEC.moduleHalfWidth) > 0.05) return true;
  }
  return false;
}

/**
 * Bends a module's meshes along the road spline (module z -> track s, x -> lateral fitted to the
 * barriers, y -> up) so curved and tapering approaches get unstretched, seamless modules. Returns
 * the meshes with world-space geometry (identity transforms).
 */
function bendModule(track: Track, module: THREE.Object3D, sC: number, zScale: number): THREE.Mesh[] {
  module.position.set(0, 0, 0);
  module.rotation.set(0, 0, 0);
  module.scale.set(1, 1, 1);
  module.updateMatrixWorld(true);
  const f0 = track.frameAt(sC);
  const h = Math.atan2(f0.tx, f0.tz);
  // Module +X relative to the track's lateral axis (as placed by the straight-module path).
  const sgn = Math.sign(Math.cos(h) * f0.rx - Math.sin(h) * f0.rz) || 1;
  const meshes: THREE.Mesh[] = [];
  module.traverse((o) => {
    const m = o as THREE.Mesh;
    if (m.isMesh && m.visible) meshes.push(m);
  });
  const v = new THREE.Vector3(), n = new THREE.Vector3();
  for (const m of meshes) {
    const g = m.geometry.clone();
    g.deleteAttribute('tangent');
    // Source attributes may be quantized (normalized ints): read through them, write float32.
    const srcPos = g.attributes.position as THREE.BufferAttribute, srcNrm = g.attributes.normal as THREE.BufferAttribute | undefined;
    const pos = new THREE.Float32BufferAttribute(new Float32Array(srcPos.count * 3), 3);
    const nrm = srcNrm ? new THREE.Float32BufferAttribute(new Float32Array(srcNrm.count * 3), 3) : undefined;
    const mw = m.matrixWorld.clone(), nm = new THREE.Matrix3().getNormalMatrix(mw);
    for (let i = 0; i < pos.count; i++) {
      v.fromBufferAttribute(srcPos, i).applyMatrix4(mw);
      const s = sC + v.z * zScale;
      const w = (track.barrierOffsetAt(s) + ROAD_PROFILE.barrierThickness) / TUNNEL_SPEC.moduleHalfWidth;
      const f = track.frameAt(s);
      const P = track.pointAt(s, sgn * v.x * w, v.y);
      pos.setXYZ(i, P.x, P.y, P.z);
      if (nrm) {
        n.fromBufferAttribute(srcNrm!, i).applyMatrix3(nm);
        const nx = (sgn * n.x) / w;
        n.set(nx * f.rx + n.y * f.ux + n.z * f.tx, n.y * f.uy + n.z * f.ty, nx * f.rz + n.y * f.uz + n.z * f.tz).normalize();
        nrm.setXYZ(i, n.x, n.y, n.z);
      }
    }
    g.setAttribute('position', pos);
    if (nrm) g.setAttribute('normal', nrm);
    g.computeBoundingBox();
    g.computeBoundingSphere();
    const out = new THREE.Mesh(g, m.material);
    out.name = m.name;
    out.castShadow = m.castShadow;
    out.receiveShadow = m.receiveShadow;
    meshes[meshes.indexOf(m)] = out;
  }
  return meshes;
}

export async function buildTunnel(track: Track, assets: AssetStore, mats: Materials): Promise<StructureResult> {
  const group = new THREE.Group();
  group.name = 'tunnel';
  const emitters: LightEmitter[] = [];
  const gltf = await assets.model('city.tunnel');
  const placements = tunnelModulePlacements(track);
  const len = track.tunnel.s1 - track.tunnel.s0;
  const moduleLen = len / TUNNEL_SPEC.moduleCount;
  const src = gltf?.scene ?? null;
  const zScale = src ? moduleLen / TUNNEL_SPEC.sourceModuleLength : 1;
  for (const p of placements) {
    const t = (p.s - track.tunnel.s0) / len;
    const color = lightStop(t);
    let module: THREE.Object3D;
    if (src) {
      module = src.clone(true);
      module.traverse((o) => {
        const m = o as THREE.Mesh;
        if (!m.isMesh) return;
        // Custom wet road continues through the tunnel: hide the module's own floor.
        if (/Floor/i.test(m.name) || /Floor/i.test((m.material as THREE.Material).name)) {
          m.visible = false;
          return;
        }
        const mat = m.material as THREE.MeshStandardMaterial;
        if (/Led/i.test(mat.name)) {
          m.material = mats.neon(color, /Tube/i.test(mat.name) ? 1.35 : 0.9);
        } else {
          const c = mat.clone();
          c.roughness = Math.min(c.roughness, 0.45);
          c.envMapIntensity = 0.8;
          m.material = c;
        }
      });
    } else {
      // Degraded fallback (optional asset absent): simple lit box shell.
      module = new THREE.Group();
      const shell = new THREE.Mesh(new THREE.BoxGeometry(12.1, 4.4, moduleLen, 1, 1, 1), mats.wall);
      shell.position.y = 2.2;
      (shell.material as THREE.Material).side = THREE.BackSide;
      module.add(shell);
      const strip = new THREE.Mesh(new THREE.BoxGeometry(0.2, 0.08, moduleLen), mats.neon(color, 3));
      strip.position.set(0, 4.3, 0);
      module.add(strip);
    }
    if (src && moduleNeedsBend(track, p.s, moduleLen)) {
      for (const m of bendModule(track, module, p.s, zScale)) group.add(m);
    } else {
      const f = track.frameAt(p.s);
      const pos = track.pointAt(p.s, 0, 0);
      module.position.set(pos.x, pos.y, pos.z);
      module.rotation.y = Math.atan2(f.tx, f.tz);
      module.scale.set(1, 1, zScale);
      group.add(module);
    }
    for (const side of [-1, 1]) {
      const e = track.pointAt(p.s, side * 4.5, 3.6);
      emitters.push({ pos: new THREE.Vector3(e.x, e.y, e.z), color, intensity: 10, range: 18 });
    }
  }
  return { group, emitters, beacons: [] };
}

export async function buildBridge(track: Track, assets: AssetStore, mats: Materials): Promise<StructureResult> {
  const group = new THREE.Group();
  group.name = 'broken_bridge';
  const emitters: LightEmitter[] = [];
  const beacons: THREE.Mesh[] = [];
  const kit = await assets.model('city.bridgeKit');
  const b = track.bridge;
  const kitMesh = (name: string): THREE.Mesh | null => {
    const o = kit?.scene.getObjectByName(name) as THREE.Mesh | undefined;
    if (!o || !o.isMesh) return null;
    const m = new THREE.Mesh(o.geometry, mats.concrete);
    return m;
  };
  const frameQuat = (s: number) => {
    const f = track.frameAt(s);
    return new THREE.Quaternion().setFromRotationMatrix(new THREE.Matrix4().makeBasis(new THREE.Vector3(-f.rx, 0, -f.rz), new THREE.Vector3(f.ux, f.uy, f.uz), new THREE.Vector3(f.tx, f.ty, f.tz)));
  };

  // Debris at the physical obstacle boxes (visual matches collision).
  const debrisNames = ['kit_18', 'kit_19', 'kit_17', 'kit_11', 'kit_12'];
  track.obstacles.forEach((o, i) => {
    const s = (o.s0 + o.s1) / 2, lat = (o.lat0 + o.lat1) / 2;
    const src = kitMesh(debrisNames[i % debrisNames.length]!);
    let mesh: THREE.Mesh;
    if (src) {
      mesh = src;
      src.geometry.computeBoundingBox();
      const size = src.geometry.boundingBox!.getSize(new THREE.Vector3());
      mesh.scale.set((o.lat1 - o.lat0) / Math.max(0.2, size.x), o.height / Math.max(0.2, size.y), (o.s1 - o.s0) / Math.max(0.2, size.z));
    } else {
      mesh = new THREE.Mesh(new THREE.BoxGeometry(o.lat1 - o.lat0, o.height, o.s1 - o.s0), mats.concrete);
      mesh.geometry.translate(0, o.height / 2, 0);
    }
    const p = track.pointAt(s, lat, 0);
    mesh.position.set(p.x, p.y, p.z);
    mesh.quaternion.copy(frameQuat(s)).multiply(new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 0, 1), (i % 2 ? 1 : -1) * 0.12));
    group.add(mesh);
  });

  // Hanging deck slabs at both gap edges (damage silhouette readable from distance).
  const slabNames = ['kit_04', 'kit_05', 'kit_06', 'kit_07', 'kit_08', 'kit_09'];
  const edge = (s: number, dir: number, seed: number) => {
    const hw = track.barrierOffsetAt(s);
    for (let k = 0; k < 3; k++) {
      const src = kitMesh(slabNames[(seed + k) % slabNames.length]!) ?? new THREE.Mesh(new THREE.BoxGeometry(3.5, 1.3, 9), mats.concrete);
      const lat = -hw + ((k + 0.5) * (hw * 2)) / 3;
      const p = track.pointAt(s, lat, -0.8);
      src.position.set(p.x, p.y, p.z);
      src.quaternion.copy(frameQuat(s)).multiply(new THREE.Quaternion().setFromEuler(new THREE.Euler(dir * (0.45 + k * 0.12), (k - 1) * 0.15, (k - 1) * 0.08)));
      src.translateZ(dir * 3.5);
      src.translateY(-2.2);
      group.add(src);
    }
  };
  edge(b.lip, 1, 0);
  edge(b.gapEnd, -1, 3);

  // Broken guardrail ends and jagged deck chunks at both gap edges, sagging into the hole (visual
  // only: they sit below the flight path and add no colliders across the gap).
  const broken = (s: number, dir: number, seed: number) => {
    const B = track.barrierOffsetAt(s);
    for (const side of [-1, 1]) {
      const rail = kitMesh(seed % 2 ? 'kit_15' : 'kit_10');
      if (rail) {
        rail.geometry.computeBoundingBox();
        const sz = rail.geometry.boundingBox!.getSize(new THREE.Vector3());
        rail.scale.set(0.5 / Math.max(0.1, Math.min(sz.x, sz.z)), 1.1 / Math.max(0.1, sz.y), 3.2 / Math.max(0.1, Math.max(sz.x, sz.z)));
        const p = track.pointAt(s + dir * 1.4, side * (B + 0.25), 0.2);
        rail.position.set(p.x, p.y, p.z);
        rail.quaternion.copy(frameQuat(s)).multiply(new THREE.Quaternion().setFromEuler(new THREE.Euler(dir * 0.62, side * 0.25, -side * 0.35)));
        group.add(rail);
      }
      for (let k = 0; k < 2; k++) {
        const chunk = kitMesh(slabNames[(seed + k * 2 + (side > 0 ? 1 : 0)) % slabNames.length]!);
        if (!chunk) continue;
        chunk.scale.setScalar(1.6 + k * 0.5);
        const p = track.pointAt(s + dir * (0.9 + k * 0.8), side * (1.8 + k * 2.6), -0.25 - k * 0.3);
        chunk.position.set(p.x, p.y, p.z);
        chunk.quaternion.copy(frameQuat(s)).multiply(new THREE.Quaternion().setFromEuler(new THREE.Euler(dir * (0.3 + k * 0.25), side * (0.2 + k * 0.3), side * 0.12)));
        group.add(chunk);
      }
    }
  };
  broken(b.lip, 1, 1);
  broken(b.gapEnd, -1, 2);

  // Collapsed support structure below the landing deck.
  const support = kitMesh('kit_01');
  if (support) {
    const p = track.pointAt(b.gapEnd + 18, -4, 0);
    support.position.set(p.x, -5.5, p.z);
    support.rotation.set(0.12, track.headingAt(b.gapEnd) + 0.4, -0.18);
    support.scale.setScalar(1.3);
    group.add(support);
  }
  const wreck = kitMesh('kit_00');
  if (wreck) {
    const p = track.pointAt(b.lip - 120, -48, 0);
    wreck.position.set(p.x, -6, p.z);
    wreck.rotation.set(0.05, track.headingAt(b.lip) + 1.2, 0.2);
    group.add(wreck);
  }

  // Red/amber hazard beacons through the damaged zone and at the lip (blink in update()).
  const beaconGeo = new THREE.SphereGeometry(0.22, 10, 8);
  for (let s = b.debrisStart; s <= b.lip; s += 20) {
    for (const side of [-1, 1]) {
      const p = track.pointAt(s, side * (track.barrierOffsetAt(s) + 0.2), 1.35);
      const color = s > b.rampStart - 10 ? NEON.red : NEON.amber;
      const m = new THREE.Mesh(beaconGeo, new THREE.MeshBasicMaterial({ color: color.clone().multiplyScalar(4) }));
      m.position.set(p.x, p.y, p.z);
      m.userData.phase = (s / 20) % 2;
      beacons.push(m);
      group.add(m);
      emitters.push({ pos: m.position.clone(), color: color.clone(), intensity: 16, range: 16 });
    }
  }
  // Overhead JUMP sign before the ramp.
  {
    const s = b.rampStart - 60;
    const c = document.createElement('canvas');
    c.width = 512;
    c.height = 128;
    const g = c.getContext('2d')!;
    g.fillStyle = '#140404';
    g.fillRect(0, 0, 512, 128);
    g.fillStyle = '#ffb01a';
    g.font = '900 78px Arial Black, Impact, sans-serif';
    g.textAlign = 'center';
    g.textBaseline = 'middle';
    g.fillText('▲ GAP · JUMP ▲', 256, 66, 490);
    const tex = new THREE.CanvasTexture(c);
    tex.colorSpace = THREE.SRGBColorSpace;
    const hw = track.barrierOffsetAt(s);
    const sign = new THREE.Mesh(new THREE.PlaneGeometry(hw * 1.6, hw * 0.4), new THREE.MeshBasicMaterial({ map: tex, color: new THREE.Color(2.5, 2.5, 2.5), side: THREE.DoubleSide }));
    const p = track.pointAt(s, 0, 7.5);
    sign.position.set(p.x, p.y, p.z);
    sign.rotation.y = track.headingAt(s) + Math.PI;
    group.add(sign);
    for (const side of [-1, 1]) {
      const post = new THREE.Mesh(new THREE.BoxGeometry(0.3, 8, 0.3), mats.steel);
      const pp = track.pointAt(s, side * (hw * 0.82), 4);
      post.position.set(pp.x, pp.y, pp.z);
      group.add(post);
    }
    emitters.push({ pos: new THREE.Vector3(p.x, p.y, p.z), color: NEON.amber.clone(), intensity: 40, range: 30 });
  }
  return { group, emitters, beacons };
}

export function updateBeacons(beacons: THREE.Mesh[], time: number): void {
  for (const m of beacons) m.visible = Math.floor(time * 2.2 + (m.userData.phase as number)) % 2 === 0;
}
