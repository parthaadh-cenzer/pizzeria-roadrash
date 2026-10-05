// Shared generated geometry descriptions for the track: simplified road collider strips,
// physical edge barriers, tunnel shell and obstacle boxes. Used by Rapier (server/client) and
// by the renderer so visuals and collision stay in agreement.
import { ROAD_PROFILE, TUNNEL_SPEC } from '../../config/track.js';
import type { Quat } from '../../shared/math.js';
import { STRUCTURE, type Track } from './Track.js';

export interface BoxDesc {
  cx: number;
  cy: number;
  cz: number;
  hx: number;
  hy: number;
  hz: number;
  q: Quat;
  kind: 'barrier' | 'tunnel-wall' | 'tunnel-ceiling' | 'obstacle' | 'deck-edge';
  s: number;
  side: number;
}

export interface MeshChunk {
  vertices: Float32Array;
  indices: Uint32Array;
  s0: number;
  s1: number;
}

/** Height of physical barrier colliders (concrete barrier + fence/rail above it). */
export const BARRIER_COLLIDER_HEIGHT = 2.4;
export const TUNNEL_INNER_HEIGHT = 4.4;

/** Quaternion for a frame with columns [X, Y, Z] (must be right-handed). */
export function quatFromBasis(
  xx: number, xy: number, xz: number,
  yx: number, yy: number, yz: number,
  zx: number, zy: number, zz: number,
): Quat {
  const m00 = xx, m01 = yx, m02 = zx, m10 = xy, m11 = yy, m12 = zy, m20 = xz, m21 = yz, m22 = zz;
  const tr = m00 + m11 + m22;
  let x, y, z, w;
  if (tr > 0) {
    const S = Math.sqrt(tr + 1) * 2;
    w = 0.25 * S;
    x = (m21 - m12) / S;
    y = (m02 - m20) / S;
    z = (m10 - m01) / S;
  } else if (m00 > m11 && m00 > m22) {
    const S = Math.sqrt(1 + m00 - m11 - m22) * 2;
    w = (m21 - m12) / S;
    x = 0.25 * S;
    y = (m01 + m10) / S;
    z = (m02 + m20) / S;
  } else if (m11 > m22) {
    const S = Math.sqrt(1 + m11 - m00 - m22) * 2;
    w = (m02 - m20) / S;
    x = (m01 + m10) / S;
    y = 0.25 * S;
    z = (m12 + m21) / S;
  } else {
    const S = Math.sqrt(1 + m22 - m00 - m11) * 2;
    w = (m10 - m01) / S;
    x = (m02 + m20) / S;
    y = (m12 + m21) / S;
    z = 0.25 * S;
  }
  const l = Math.hypot(x, y, z, w) || 1;
  return { x: x / l, y: y / l, z: z / l, w: w / l };
}

/** Rotation taking local (+X left, +Y road normal, +Z along track) to world at s. */
export function trackQuat(track: Track, s: number): Quat {
  const f = track.frameAt(s);
  return quatFromBasis(-f.rx, 0, -f.rz, f.ux, f.uy, f.uz, f.tx, f.ty, f.tz);
}

function isGapSpan(track: Track, s0: number, s1: number): boolean {
  const b = track.bridge;
  return s1 > b.lip && s0 < b.gapEnd;
}

/**
 * Simplified road collider (road + shoulders + sidewalks) as trimesh chunks. The bridge gap is
 * left open so a missed jump physically falls.
 */
export function buildRoadColliderChunks(track: Track, chunkLen = 160, step = 2): MeshChunk[] {
  const chunks: MeshChunk[] = [];
  const b = track.bridge;
  const breaks = [b.lip, b.gapEnd];
  let s = 0;
  while (s < track.length - 1e-6) {
    let s1 = Math.min(track.length, s + chunkLen);
    for (const br of breaks) if (s < br && s1 > br) s1 = br;
    if (isGapSpan(track, s, s1)) {
      s = s1;
      continue;
    }
    const verts: number[] = [];
    const idx: number[] = [];
    const cols = 4;
    let rows = 0;
    for (let u = s; u <= s1 + 1e-6; u += step) {
      const uu = Math.min(u, s1);
      const out = track.barrierOffsetAt(uu) + ROAD_PROFILE.barrierThickness + ROAD_PROFILE.sidewalkWidth;
      const lats = [-out, -track.halfWidthAt(uu), track.halfWidthAt(uu), out];
      for (const l of lats) {
        const p = track.pointAt(uu, l, 0);
        verts.push(p.x, p.y, p.z);
      }
      rows++;
      if (uu >= s1) break;
    }
    for (let r = 0; r < rows - 1; r++) {
      for (let c = 0; c < cols - 1; c++) {
        const a = r * cols + c, b2 = a + 1, c2 = a + cols, d = c2 + 1;
        idx.push(a, c2, b2, b2, c2, d);
      }
    }
    chunks.push({ vertices: new Float32Array(verts), indices: new Uint32Array(idx), s0: s, s1 });
    s = s1;
  }
  return chunks;
}

/** Physical edge barriers along both sides; tunnel walls + ceiling inside the tunnel. */
export function buildBarrierBoxes(track: Track, spacing = 4): BoxDesc[] {
  const boxes: BoxDesc[] = [];
  const b = track.bridge;
  for (let s = spacing / 2; s < track.length; s += spacing) {
    if (s > b.lip - spacing / 2 && s < b.gapEnd + spacing / 2) continue;
    const q = trackQuat(track, s);
    const inTunnel = track.structureAt(s) === STRUCTURE.TUNNEL;
    const hy = BARRIER_COLLIDER_HEIGHT / 2;
    for (const side of [-1, 1]) {
      const lat = side * (track.barrierOffsetAt(s) + ROAD_PROFILE.barrierThickness / 2);
      const p = track.pointAt(s, lat, hy);
      boxes.push({
        cx: p.x, cy: p.y, cz: p.z,
        hx: ROAD_PROFILE.barrierThickness / 2, hy: inTunnel ? TUNNEL_INNER_HEIGHT / 2 : hy, hz: spacing / 2 + 0.25,
        q, kind: inTunnel ? 'tunnel-wall' : 'barrier', s, side,
      });
      if (inTunnel) {
        const pw = track.pointAt(s, lat, TUNNEL_INNER_HEIGHT / 2);
        const last = boxes[boxes.length - 1]!;
        last.cx = pw.x;
        last.cy = pw.y;
        last.cz = pw.z;
      }
    }
    if (inTunnel) {
      const p = track.pointAt(s, 0, TUNNEL_INNER_HEIGHT + 0.3);
      boxes.push({
        cx: p.x, cy: p.y, cz: p.z,
        hx: track.barrierOffsetAt(s) + ROAD_PROFILE.barrierThickness, hy: 0.3, hz: spacing / 2 + 0.25,
        q, kind: 'tunnel-ceiling', s, side: 0,
      });
    }
  }
  // Landing deck edge face so short jumps strike it.
  const edgeS = b.gapEnd + 0.4;
  const pe = track.pointAt(edgeS, 0, -0.8);
  boxes.push({ cx: pe.x, cy: pe.y, cz: pe.z, hx: track.barrierOffsetAt(edgeS) + 3, hy: 0.8, hz: 0.4, q: trackQuat(track, edgeS), kind: 'deck-edge', s: edgeS, side: 0 });
  return boxes;
}

export function buildObstacleBoxes(track: Track): BoxDesc[] {
  return track.obstacles.map((o) => {
    const s = (o.s0 + o.s1) / 2;
    const lat = (o.lat0 + o.lat1) / 2;
    const p = track.pointAt(s, lat, o.height / 2);
    return {
      cx: p.x, cy: p.y, cz: p.z,
      hx: (o.lat1 - o.lat0) / 2, hy: o.height / 2, hz: (o.s1 - o.s0) / 2,
      q: trackQuat(track, s), kind: 'obstacle' as const, s, side: Math.sign(lat),
    };
  });
}

/** Tunnel module placements along the straight tunnel (for rendering). */
export function tunnelModulePlacements(track: Track): { s: number; index: number }[] {
  const out: { s: number; index: number }[] = [];
  const len = track.tunnel.s1 - track.tunnel.s0;
  const count = TUNNEL_SPEC.moduleCount;
  const moduleLen = len / count;
  for (let i = 0; i < count; i++) out.push({ s: track.tunnel.s0 + moduleLen * (i + 0.5), index: i });
  return out;
}
