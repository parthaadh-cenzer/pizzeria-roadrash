// Keeps imported set dressing out of the racing corridor. The Times Square block is one fixed
// model placed along the track; where the locked track bends away from its avenue, facades and
// street furniture would stand on the road (riders would visually drive through walls). Every
// triangle with any part inside the corridor volume (road + barriers + sidewalk, up to a
// clearance height above the road) is removed once, when the world is built.
import * as THREE from 'three';
import { ROAD_PROFILE } from '../../config/track.js';
import type { Track } from '../../game/track/Track.js';

export interface CorridorOptions {
  /** Extra clearance beyond the sidewalk's outer edge (m). */
  margin: number;
  /** Clearance above the road surface (m); structures higher than this may overhang. */
  height: number;
  /** Clearance below the road surface (m). */
  below: number;
}

const CELL = 16;

interface Sample {
  x: number;
  y: number;
  z: number;
  r: number;
}

class CorridorIndex {
  private grid = new Map<number, Sample[]>();
  readonly maxR: number;

  constructor(track: Track, opts: CorridorOptions) {
    let maxR = 0;
    const edge = ROAD_PROFILE.barrierThickness + ROAD_PROFILE.sidewalkWidth + opts.margin;
    for (let i = 0; i < track.n; i++) {
      const s = i * track.step;
      const r = track.barrierOffsetAt(s) + edge;
      maxR = Math.max(maxR, r);
      const smp = { x: track.px[i]!, y: track.py[i]!, z: track.pz[i]!, r };
      const k = this.key(Math.floor(smp.x / CELL), Math.floor(smp.z / CELL));
      const list = this.grid.get(k);
      if (list) list.push(smp);
      else this.grid.set(k, [smp]);
    }
    this.maxR = maxR;
  }

  private key(cx: number, cz: number): number {
    return (cx + 32768) * 65536 + (cz + 32768);
  }

  /** True if (x, y, z) lies within the corridor radius of a nearby centreline sample. */
  inside(x: number, y: number, z: number, below: number, height: number): boolean {
    const reach = Math.ceil(this.maxR / CELL);
    const cx = Math.floor(x / CELL), cz = Math.floor(z / CELL);
    for (let dx = -reach; dx <= reach; dx++) {
      for (let dz = -reach; dz <= reach; dz++) {
        const list = this.grid.get(this.key(cx + dx, cz + dz));
        if (!list) continue;
        for (const s of list) {
          if (y < s.y - below || y > s.y + height) continue;
          const ex = x - s.x, ez = z - s.z;
          // Samples are 1 m apart: the nearest-sample distance overestimates by < 0.5 m.
          if (ex * ex + ez * ez < (s.r + 0.5) * (s.r + 0.5)) return true;
        }
      }
    }
    return false;
  }

  /** Cheap reject: does an axis-aligned box come near any sample? */
  nearBox(box: THREE.Box3, below: number, height: number): boolean {
    const reach = this.maxR;
    const c0x = Math.floor((box.min.x - reach) / CELL), c1x = Math.floor((box.max.x + reach) / CELL);
    const c0z = Math.floor((box.min.z - reach) / CELL), c1z = Math.floor((box.max.z + reach) / CELL);
    for (let cx = c0x; cx <= c1x; cx++) {
      for (let cz = c0z; cz <= c1z; cz++) {
        const list = this.grid.get(this.key(cx, cz));
        if (!list) continue;
        for (const s of list) {
          if (box.max.y < s.y - below || box.min.y > s.y + height) continue;
          const dx = Math.max(box.min.x - s.x, 0, s.x - box.max.x);
          const dz = Math.max(box.min.z - s.z, 0, s.z - box.max.z);
          if (dx * dx + dz * dz < (s.r + 0.5) * (s.r + 0.5)) return true;
        }
      }
    }
    return false;
  }
}

/**
 * Removes every triangle of `root`'s meshes that reaches into the track corridor. Geometry is
 * edited in place (the model must not be shared with other placements). Returns counts.
 */
export function clearTrackCorridor(root: THREE.Object3D, track: Track, opts: CorridorOptions): { removed: number; total: number; meshes: number } {
  root.updateMatrixWorld(true);
  const index = new CorridorIndex(track, opts);
  const a = new THREE.Vector3(), b = new THREE.Vector3(), c = new THREE.Vector3(), p = new THREE.Vector3();
  let removed = 0, total = 0, meshes = 0;
  root.traverse((o) => {
    const mesh = o as THREE.Mesh;
    if (!mesh.isMesh || (mesh as unknown as THREE.SkinnedMesh).isSkinnedMesh) return;
    const geo = mesh.geometry;
    const pos = geo.getAttribute('position') as THREE.BufferAttribute | undefined;
    if (!pos) return;
    if (!geo.boundingBox) geo.computeBoundingBox();
    const wbox = geo.boundingBox!.clone().applyMatrix4(mesh.matrixWorld);
    const triCount = geo.index ? geo.index.count / 3 : pos.count / 3;
    total += triCount;
    if (!index.nearBox(wbox, opts.below, opts.height)) return;
    const m = mesh.matrixWorld;
    const idx = geo.index;
    const keep: number[] = [];
    let dropped = 0;
    for (let t = 0; t < triCount; t++) {
      const i0 = idx ? idx.getX(t * 3) : t * 3, i1 = idx ? idx.getX(t * 3 + 1) : t * 3 + 1, i2 = idx ? idx.getX(t * 3 + 2) : t * 3 + 2;
      a.fromBufferAttribute(pos, i0).applyMatrix4(m);
      b.fromBufferAttribute(pos, i1).applyMatrix4(m);
      c.fromBufferAttribute(pos, i2).applyMatrix4(m);
      // Sample the triangle densely enough (~2.5 m) that a large facade quad spanning the road
      // is caught even when none of its corners is on it.
      const longest = Math.max(a.distanceTo(b), b.distanceTo(c), c.distanceTo(a));
      const n = Math.max(1, Math.ceil(longest / 2.5));
      let hit = false;
      for (let u = 0; u <= n && !hit; u++) {
        for (let v = 0; v <= n - u && !hit; v++) {
          const w = n - u - v;
          p.set(0, 0, 0).addScaledVector(a, u / n).addScaledVector(b, v / n).addScaledVector(c, w / n);
          hit = index.inside(p.x, p.y, p.z, opts.below, opts.height);
        }
      }
      if (hit) dropped++;
      else keep.push(i0, i1, i2);
    }
    if (!dropped) return;
    meshes++;
    removed += dropped;
    geo.setIndex(keep);
    geo.computeBoundingBox();
    geo.computeBoundingSphere();
  });
  return { removed, total, meshes };
}
