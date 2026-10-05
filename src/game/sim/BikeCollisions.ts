// Bike-vs-bike contact using simplified capsules (never visual meshes).
// Relative collision speed bands come from HANDOFF/03_GAMEPLAY_CONSTANTS.md "Bike collisions".
import { BIKE_COLLISION } from '../../config/gameplay.js';
import { clamp } from '../../shared/math.js';
import type { BikeParams, BikeState } from './types.js';

export interface CollisionBody {
  index: number;
  bike: BikeState;
  params: BikeParams;
  active: boolean;
}

export type ContactBand = 'bump' | 'displace' | 'wobble' | 'crash';

export interface ContactResult {
  a: number;
  b: number;
  relSpeed: number;
  band: ContactBand;
  /** Index of the body that should crash when band === 'crash' (or -1). */
  crash: number[];
  x: number;
  y: number;
  z: number;
}

export function contactBand(relSpeed: number): ContactBand {
  if (relSpeed < BIKE_COLLISION.bumpMax) return 'bump';
  if (relSpeed < BIKE_COLLISION.displaceMax) return 'displace';
  if (relSpeed < BIKE_COLLISION.wobbleMax) return 'wobble';
  return 'crash';
}

function closestSegSeg(
  ax: number, az: number, bx: number, bz: number,
  cx: number, cz: number, dx: number, dz: number,
): { s: number; t: number; d2: number } {
  const d1x = bx - ax, d1z = bz - az, d2x = dx - cx, d2z = dz - cz;
  const rx = ax - cx, rz = az - cz;
  const a = d1x * d1x + d1z * d1z, e = d2x * d2x + d2z * d2z, f = d2x * rx + d2z * rz;
  let s = 0, t = 0;
  const c = d1x * rx + d1z * rz, b = d1x * d2x + d1z * d2z;
  const denom = a * e - b * b;
  s = denom > 1e-9 ? clamp((b * f - c * e) / denom, 0, 1) : 0;
  t = (b * s + f) / e;
  if (t < 0) {
    t = 0;
    s = clamp(-c / a, 0, 1);
  } else if (t > 1) {
    t = 1;
    s = clamp((b - c) / a, 0, 1);
  }
  const px = ax + d1x * s - (cx + d2x * t), pz = az + d1z * s - (cz + d2z * t);
  return { s, t, d2: px * px + pz * pz };
}

/** Resolves all pairwise contacts in place. Returns contacts for events/crash handling. */
export function resolveBikeCollisions(bodies: readonly CollisionBody[]): ContactResult[] {
  const out: ContactResult[] = [];
  const R = BIKE_COLLISION.radius, H = BIKE_COLLISION.halfLength;
  for (let i = 0; i < bodies.length; i++) {
    const A = bodies[i]!;
    if (!A.active) continue;
    for (let j = i + 1; j < bodies.length; j++) {
      const B = bodies[j]!;
      if (!B.active) continue;
      const a = A.bike, b = B.bike;
      if (Math.abs(a.x - b.x) > 4 || Math.abs(a.z - b.z) > 4 || Math.abs(a.y - b.y) > 1.6) continue;
      const afx = Math.sin(a.yaw), afz = Math.cos(a.yaw), bfx = Math.sin(b.yaw), bfz = Math.cos(b.yaw);
      const c = closestSegSeg(
        a.x - afx * H, a.z - afz * H, a.x + afx * H, a.z + afz * H,
        b.x - bfx * H, b.z - bfz * H, b.x + bfx * H, b.z + bfz * H,
      );
      if (c.d2 >= 4 * R * R) continue;
      const pax = a.x - afx * H + afx * 2 * H * c.s, paz = a.z - afz * H + afz * 2 * H * c.s;
      const pbx = b.x - bfx * H + bfx * 2 * H * c.t, pbz = b.z - bfz * H + bfz * 2 * H * c.t;
      let nx = pbx - pax, nz = pbz - paz;
      const dist = Math.hypot(nx, nz);
      if (dist < 1e-4) {
        nx = -afz;
        nz = afx;
      } else {
        nx /= dist;
        nz /= dist;
      }
      const pen = 2 * R - dist;
      // Separate by penetration, weighted by stability (heavier/more stable bikes move less).
      const wa = B.params.stability / (A.params.stability + B.params.stability);
      const wb = 1 - wa;
      a.x -= nx * pen * wa;
      a.z -= nz * pen * wa;
      b.x += nx * pen * wb;
      b.z += nz * pen * wb;
      const rvx = b.vx - a.vx, rvz = b.vz - a.vz;
      const relSpeed = Math.hypot(rvx, rvz);
      const vn = rvx * nx + rvz * nz; // < 0 approaching
      const band = contactBand(relSpeed);
      const crash: number[] = [];
      if (vn < 0) {
        const restitution = band === 'bump' ? 0.15 : 0.35;
        const jImp = -(1 + restitution) * vn;
        a.vx -= nx * jImp * wa;
        a.vz -= nz * jImp * wa;
        b.vx += nx * jImp * wb;
        b.vz += nz * jImp * wb;
      }
      const disturb = band === 'bump' ? 0.04 : band === 'displace' ? 0.3 : band === 'wobble' ? 0.95 : 1.6;
      a.instability += (disturb * wa * 2) / A.params.stability;
      b.instability += (disturb * wb * 2) / B.params.stability;
      a.hitDir = -Math.sign(nx * -afz + nz * afx) || a.hitDir;
      b.hitDir = Math.sign(nx * -bfz + nz * bfx) || b.hitDir;
      if (band === 'crash') {
        // Frontal striker crashes; the struck bike crashes too if it is the less stable one.
        const aFront = (nx * afx + nz * afz) > 0.6;
        const bFront = (-nx * bfx - nz * bfz) > 0.6;
        if (aFront || !bFront) crash.push(A.index);
        if (bFront || A.params.stability > B.params.stability) crash.push(B.index);
      }
      out.push({ a: A.index, b: B.index, relSpeed, band, crash, x: (pax + pbx) / 2, y: (a.y + b.y) / 2 + 0.6, z: (paz + pbz) / 2 });
    }
  }
  return out;
}
