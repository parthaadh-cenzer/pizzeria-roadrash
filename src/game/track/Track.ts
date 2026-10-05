// Custom spline race track built from the locked anchors (HANDOFF/02_TRACK_BLUEPRINT.md).
// Source city assets dress this track but never define its topology.
import {
  BOOST_STRAIGHTS,
  BRIDGE_SPEC,
  CHECKPOINTS,
  CHECKPOINT_GATE_MARGIN,
  CROWD_DENSITY,
  DISTRICTS,
  PUDDLES,
  RECOVERY_NODE_SPACING,
  ROAD_PROFILE,
  ROAD_WIDTH_KEYS,
  SPLINE_TANGENT_SCALE,
  STRAIGHT_SEGMENTS,
  TRACK_ANCHORS,
  TUNNEL_RAIN,
  TUNNEL_SPEC,
  WATER_REGION,
  WEATHER_KEYS,
  type PuddleSize,
  type TrackAnchor,
} from '../../config/track.js';
import { RACE, WET_GRIP } from '../../config/gameplay.js';
import { DISTRICT_IDS, WEATHER_LEVELS, type DistrictId } from '../../shared/ids.js';
import { clamp, lerp, smoothstep, type V3 } from '../../shared/math.js';

export const STRUCTURE = { GROUND: 0, VIADUCT: 1, TUNNEL: 2, BRIDGE: 3, TRENCH: 4 } as const;
export type StructureKind = (typeof STRUCTURE)[keyof typeof STRUCTURE];

export interface Checkpoint {
  index: number; // 1..N (0 is the start line)
  s: number;
  label: string;
}

export interface RecoveryNode {
  s: number;
  index: number;
}

export interface Puddle {
  s0: number;
  s1: number;
  lateral: number; // metres from centreline
  halfWidth: number;
  size: PuddleSize;
}

export interface TrackObstacle {
  s0: number;
  s1: number;
  lat0: number;
  lat1: number;
  height: number;
  kind: 'debris' | 'barricade' | 'damaged-barrier';
}

export interface Projection {
  s: number;
  lateral: number;
  height: number;
  index: number;
  distance: number;
}

export interface GridSlot {
  slot: number;
  s: number;
  lateral: number;
}

export interface TrackFrame {
  px: number;
  py: number;
  pz: number;
  tx: number;
  ty: number;
  tz: number;
  rx: number;
  rz: number;
  ux: number;
  uy: number;
  uz: number;
}

interface HermiteSeg {
  p0: V3;
  p1: V3;
  m0: V3;
  m1: V3;
}

const SAMPLE_STEP = 1; // metres between arc-length samples
/** Segments whose minimum radius is below this get their handles tuned. */
const RADIUS_COMFORT = 70;
/** Candidate arc radii (m) when filleting a hairpin into or out of a locked straight. */
const FILLET_RADII = [48, 44, 40, 36, 32];

function hermite(seg: HermiteSeg, t: number): V3 {
  const t2 = t * t, t3 = t2 * t;
  const h00 = 2 * t3 - 3 * t2 + 1, h10 = t3 - 2 * t2 + t, h01 = -2 * t3 + 3 * t2, h11 = t3 - t2;
  return {
    x: h00 * seg.p0.x + h10 * seg.m0.x + h01 * seg.p1.x + h11 * seg.m1.x,
    y: h00 * seg.p0.y + h10 * seg.m0.y + h01 * seg.p1.y + h11 * seg.m1.y,
    z: h00 * seg.p0.z + h10 * seg.m0.z + h01 * seg.p1.z + h11 * seg.m1.z,
  };
}

function unit(x: number, y: number, z: number): V3 {
  const l = Math.hypot(x, y, z) || 1;
  return { x: x / l, y: y / l, z: z / l };
}

export class Track {
  readonly anchors: readonly TrackAnchor[];
  readonly length: number;
  readonly n: number;
  readonly step = SAMPLE_STEP;
  readonly px: Float64Array;
  readonly py: Float64Array;
  readonly pz: Float64Array;
  readonly tx: Float64Array;
  readonly ty: Float64Array;
  readonly tz: Float64Array;
  readonly rx: Float64Array;
  readonly rz: Float64Array;
  readonly ux: Float64Array;
  readonly uy: Float64Array;
  readonly uz: Float64Array;
  readonly curvature: Float32Array;
  readonly halfWidth: Float32Array;
  readonly weather: Float32Array;
  readonly rainFactor: Float32Array;
  readonly district: Uint8Array;
  readonly structure: Uint8Array;
  readonly anchorS = new Map<string, number>();
  readonly checkpoints: Checkpoint[] = [];
  readonly recoveryNodes: RecoveryNode[] = [];
  readonly puddles: Puddle[] = [];
  readonly obstacles: TrackObstacle[] = [];
  readonly boostRanges: { s0: number; s1: number }[] = [];
  readonly tunnel: { s0: number; s1: number };
  readonly bridge: { s0: number; s1: number; rampStart: number; lip: number; gapEnd: number; debrisStart: number; damagedStart: number };
  readonly grid: GridSlot[] = [];

  constructor(anchors: readonly TrackAnchor[] = TRACK_ANCHORS) {
    this.anchors = anchors;
    const segs = this.buildSegments();
    // Dense sampling per segment for arc length.
    const dense: V3[] = [];
    const denseAnchorIdx: number[] = new Array(anchors.length).fill(0);
    for (let i = 0; i < segs.length; i++) {
      const seg = segs[i]!;
      const chord = Math.hypot(seg.p1.x - seg.p0.x, seg.p1.y - seg.p0.y, seg.p1.z - seg.p0.z);
      const steps = Math.max(64, Math.ceil(chord * 4));
      const ai = this.segAnchor[i]!;
      if (ai >= 0) denseAnchorIdx[ai] = dense.length;
      for (let k = 0; k < steps; k++) dense.push(hermite(seg, k / steps));
    }
    dense.push({ ...dense[0]! });
    const cum = new Float64Array(dense.length);
    for (let i = 1; i < dense.length; i++) {
      const a = dense[i - 1]!, b = dense[i]!;
      cum[i] = cum[i - 1]! + Math.hypot(b.x - a.x, b.y - a.y, b.z - a.z);
    }
    const total = cum[dense.length - 1]!;
    const n = Math.round(total / SAMPLE_STEP);
    this.n = n;
    this.length = n * SAMPLE_STEP;
    const scale = total / this.length;
    anchors.forEach((a, i) => this.anchorS.set(a.id, cum[denseAnchorIdx[i]!]! / scale));

    this.px = new Float64Array(n);
    this.py = new Float64Array(n);
    this.pz = new Float64Array(n);
    let j = 0;
    for (let i = 0; i < n; i++) {
      const target = i * SAMPLE_STEP * scale;
      while (j < dense.length - 2 && cum[j + 1]! < target) j++;
      const a = dense[j]!, b = dense[j + 1]!;
      const f = (target - cum[j]!) / Math.max(1e-9, cum[j + 1]! - cum[j]!);
      this.px[i] = a.x + (b.x - a.x) * f;
      this.py[i] = a.y + (b.y - a.y) * f;
      this.pz[i] = a.z + (b.z - a.z) * f;
    }

    this.tx = new Float64Array(n);
    this.ty = new Float64Array(n);
    this.tz = new Float64Array(n);
    this.rx = new Float64Array(n);
    this.rz = new Float64Array(n);
    this.ux = new Float64Array(n);
    this.uy = new Float64Array(n);
    this.uz = new Float64Array(n);
    this.curvature = new Float32Array(n);
    for (let i = 0; i < n; i++) {
      const a = this.wrapIndex(i - 1), b = this.wrapIndex(i + 1);
      const t = unit(this.px[b]! - this.px[a]!, this.py[b]! - this.py[a]!, this.pz[b]! - this.pz[a]!);
      this.tx[i] = t.x;
      this.ty[i] = t.y;
      this.tz[i] = t.z;
      const rl = Math.hypot(t.z, t.x) || 1;
      const rx = -t.z / rl, rz = t.x / rl;
      this.rx[i] = rx;
      this.rz[i] = rz;
      // U = R x T
      const u = unit(0 * t.z - rz * t.y, rz * t.x - rx * t.z, rx * t.y - 0 * t.x);
      this.ux[i] = u.x;
      this.uy[i] = u.y;
      this.uz[i] = u.z;
    }
    for (let i = 0; i < n; i++) {
      const a = this.wrapIndex(i - 2), b = this.wrapIndex(i + 2);
      const ha = Math.atan2(this.tx[a]!, this.tz[a]!), hb = Math.atan2(this.tx[b]!, this.tz[b]!);
      let d = hb - ha;
      while (d > Math.PI) d -= Math.PI * 2;
      while (d < -Math.PI) d += Math.PI * 2;
      this.curvature[i] = d / (4 * SAMPLE_STEP);
    }

    // Structures
    const sT0 = this.sOf('T_IN') - TUNNEL_SPEC.extendBefore, sT1 = this.sOf('T_OUT') + TUNNEL_SPEC.extendAfter;
    this.tunnel = { s0: sT0, s1: sT1 };
    const sB0 = this.sOf('BR_IN'), sB1 = this.sOf('BR_OUT');
    this.bridge = {
      s0: sB0,
      s1: sB1,
      debrisStart: sB0 + BRIDGE_SPEC.intactEnd,
      damagedStart: sB0 + BRIDGE_SPEC.damagedEnd - 60,
      rampStart: sB0 + BRIDGE_SPEC.rampStart,
      lip: sB0 + BRIDGE_SPEC.lip,
      gapEnd: sB0 + BRIDGE_SPEC.lip + BRIDGE_SPEC.gap,
    };
    for (const b of BOOST_STRAIGHTS) this.boostRanges.push({ s0: this.sOf(b.from), s1: this.sOf(b.to) });

    this.halfWidth = new Float32Array(n);
    this.weather = new Float32Array(n);
    this.rainFactor = new Float32Array(n);
    this.district = new Uint8Array(n);
    this.structure = new Uint8Array(n);
    this.fillProfiles();
    this.fillStructures();
    this.buildCheckpoints();
    this.buildRecoveryNodes();
    this.buildPuddles();
    this.buildObstacles();
    this.buildGrid();
  }

  // ---------------------------------------------------------------- construction helpers
  private buildSegments(): HermiteSeg[] {
    const A = this.anchors;
    const N = A.length;
    const P = A.map((a) => ({ x: a.x, y: a.y, z: a.z }));
    const straight = new Set(STRAIGHT_SEGMENTS);
    const idx = (i: number) => ((i % N) + N) % N;
    const chordDir = (i: number): V3 => {
      const a = P[idx(i)]!, b = P[idx(i + 1)]!;
      return unit(b.x - a.x, b.y - a.y, b.z - a.z);
    };
    const chordLen = (i: number): number => {
      const a = P[idx(i)]!, b = P[idx(i + 1)]!;
      return Math.hypot(b.x - a.x, b.y - a.y, b.z - a.z);
    };
    const dirs: V3[] = [];
    for (let i = 0; i < N; i++) {
      const outStraight = straight.has(A[i]!.id);
      const inStraight = straight.has(A[idx(i - 1)]!.id);
      if (outStraight) dirs.push(chordDir(i));
      else if (inStraight) dirs.push(chordDir(i - 1));
      else {
        const a = chordDir(i - 1), b = chordDir(i);
        dirs.push(unit(a.x + b.x, a.y + b.y, a.z + b.z));
      }
    }
    const make = (i: number, k0: number, k1: number): HermiteSeg => {
      const L = chordLen(i);
      const d0 = dirs[i]!, d1 = dirs[idx(i + 1)]!;
      return {
        p0: P[i]!,
        p1: P[idx(i + 1)]!,
        m0: { x: d0.x * L * k0, y: d0.y * L * k0, z: d0.z * L * k0 },
        m1: { x: d1.x * L * k1, y: d1.y * L * k1, z: d1.z * L * k1 },
      };
    };
    const segs: HermiteSeg[] = [];
    this.segAnchor = [];
    for (let i = 0; i < N; i++) {
      if (straight.has(A[i]!.id)) {
        segs.push(make(i, 1, 1));
        this.segAnchor.push(i);
        continue;
      }
      // Handle tuning: keep the default shape where it is already drivable, otherwise search
      // handle magnitudes that maximise the minimum horizontal radius (never a hard polyline).
      const k = SPLINE_TANGENT_SCALE;
      let best = [Track.optimizeHandles(P[i]!, dirs[i]!, P[idx(i + 1)]!, dirs[idx(i + 1)]!, k)];
      let bestR = Track.segmentMinRadius(best[0]!);
      const intoStraight = straight.has(A[idx(i + 1)]!.id);
      const outOfStraight = straight.has(A[idx(i - 1)]!.id);
      if (bestR < RADIUS_COMFORT && (intoStraight || outOfStraight)) {
        // Fillet: a tangent circular arc joins the straight; try the largest workable radius.
        for (const R of FILLET_RADII) {
          const f = intoStraight
            ? Track.filletInto(P[i]!, dirs[i]!, P[idx(i + 1)]!, dirs[idx(i + 1)]!, R, k)
            : Track.filletOutOf(P[i]!, dirs[i]!, P[idx(i + 1)]!, dirs[idx(i + 1)]!, R, k);
          if (!f) continue;
          const r = Math.min(...f.map((s) => Track.segmentMinRadius(s)));
          if (r > bestR) {
            best = f;
            bestR = r;
          }
          if (r >= R * 0.85) break;
        }
      }
      for (let j = 0; j < best.length; j++) {
        segs.push(best[j]!);
        this.segAnchor.push(j === 0 ? i : -1);
      }
    }
    return segs;
  }

  /** Segment index -> anchor index (or -1 for helper segments). */
  private segAnchor: number[] = [];

  private static hermiteFrom(p0: V3, d0: V3, p1: V3, d1: V3, k0: number, k1: number): HermiteSeg {
    const L = Math.hypot(p1.x - p0.x, p1.y - p0.y, p1.z - p0.z);
    return {
      p0,
      p1,
      m0: { x: d0.x * L * k0, y: d0.y * L * k0, z: d0.z * L * k0 },
      m1: { x: d1.x * L * k1, y: d1.y * L * k1, z: d1.z * L * k1 },
    };
  }

  private static optimizeHandles(p0: V3, d0: V3, p1: V3, d1: V3, k: number): HermiteSeg {
    let best = Track.hermiteFrom(p0, d0, p1, d1, k, k);
    const r0 = Track.segmentMinRadius(best);
    if (r0 >= RADIUS_COMFORT) return best;
    let bestScore = r0;
    for (let a = 0.3; a <= 2.2001; a += 0.05) {
      for (let b = 0.3; b <= 2.2001; b += 0.05) {
        const cand = Track.hermiteFrom(p0, d0, p1, d1, a, b);
        const r = Math.min(Track.segmentMinRadius(cand), RADIUS_COMFORT);
        const score = r - 0.5 * (Math.abs(a - k) + Math.abs(b - k));
        if (score > bestScore) {
          bestScore = score;
          best = cand;
        }
      }
    }
    return best;
  }

  /**
   * Approach from p0 (direction d0) into a straight that starts at p1 with direction d1, via a
   * circular arc of radius R tangent to the straight at p1.
   */
  private static filletInto(p0: V3, d0: V3, p1: V3, d1: V3, R: number, k: number): HermiteSeg[] | null {
    const hd = unit(d1.x, 0, d1.z);
    let bestSet: HermiteSeg[] | null = null;
    let bestLen = Infinity;
    for (const side of [1, -1]) {
      // Horizontal perpendicular (rotate +90deg in XZ: x->z).
      const nx = -hd.z * side, nz = hd.x * side;
      const cx = p1.x + nx * R, cz = p1.z + nz * R;
      // Travel sense: +1 counter-clockwise (perp(r) direction), -1 clockwise.
      const sense = side;
      const ux = p0.x - cx, uz = p0.z - cz;
      const D = Math.hypot(ux, uz);
      if (D <= R * 1.05) continue;
      const alpha = Math.acos(R / D);
      const base = Math.atan2(uz, ux);
      for (const sgn of [1, -1]) {
        const ang = base + sgn * alpha;
        const ex = cx + Math.cos(ang) * R, ez = cz + Math.sin(ang) * R;
        const rx = Math.cos(ang), rz = Math.sin(ang);
        const tx = -rz * sense, tz = rx * sense; // travel direction on the circle at E
        const wx = ex - p0.x, wz = ez - p0.z;
        const wl = Math.hypot(wx, wz);
        if ((wx * tx + wz * tz) / wl < 0.98) continue;
        // Arc angle from E to p1 in the travel sense.
        const a1 = Math.atan2(p1.z - cz, p1.x - cx);
        let phi = (a1 - ang) * sense;
        while (phi < 0) phi += Math.PI * 2;
        while (phi >= Math.PI * 2) phi -= Math.PI * 2;
        const totalLen = wl + phi * R;
        if (totalLen >= bestLen) continue;
        // Build segments: p0 -> E (tuned), then arc pieces <= 45deg.
        const chordAll = Math.hypot(p1.x - p0.x, p1.z - p0.z);
        const yAt = (px: number, pz: number) => {
          const f = Math.hypot(px - p0.x, pz - p0.z) / Math.max(1, chordAll);
          return p0.y + (p1.y - p0.y) * clamp(f, 0, 1);
        };
        const slope = (p1.y - p0.y) / Math.max(1, totalLen);
        const E: V3 = { x: ex, y: yAt(ex, ez), z: ez };
        const tE = unit(tx, slope, tz);
        const set: HermiteSeg[] = [Track.optimizeHandles(p0, d0, E, tE, k)];
        const pieces = Math.max(1, Math.ceil(phi / (Math.PI / 4)));
        const dphi = phi / pieces;
        const mag = 4 * Math.tan(dphi / 4) * R;
        let prev = E, prevT = tE;
        for (let pI = 1; pI <= pieces; pI++) {
          const a = ang + sense * dphi * pI;
          const last = pI === pieces;
          const q: V3 = last ? p1 : { x: cx + Math.cos(a) * R, y: 0, z: cz + Math.sin(a) * R };
          if (!last) q.y = yAt(q.x, q.z);
          const rqx = Math.cos(a), rqz = Math.sin(a);
          const qT = last ? d1 : unit(-rqz * sense, slope, rqx * sense);
          set.push({
            p0: prev,
            p1: q,
            m0: { x: prevT.x * mag, y: (q.y - prev.y), z: prevT.z * mag },
            m1: { x: qT.x * mag, y: (q.y - prev.y), z: qT.z * mag },
          });
          prev = q;
          prevT = qT;
        }
        bestSet = set;
        bestLen = totalLen;
      }
    }
    return bestSet;
  }

  /** Mirror of filletInto: leave a straight ending at p0 (direction d0) toward p1. */
  private static filletOutOf(p0: V3, d0: V3, p1: V3, d1: V3, R: number, k: number): HermiteSeg[] | null {
    const neg = (v: V3): V3 => ({ x: -v.x, y: -v.y, z: -v.z });
    const rev = Track.filletInto(p1, neg(d1), p0, neg(d0), R, k);
    if (!rev) return null;
    return rev.reverse().map((s) => ({ p0: s.p1, p1: s.p0, m0: neg(s.m1), m1: neg(s.m0) }));
  }

  /** Analytic minimum horizontal radius of a Hermite segment. */
  static segmentMinRadius(seg: HermiteSeg): number {
    let minR = Infinity;
    const S = 96;
    for (let k = 0; k <= S; k++) {
      const t = k / S;
      // first derivative
      const d00 = 6 * t * t - 6 * t, d10 = 3 * t * t - 4 * t + 1, d01 = -6 * t * t + 6 * t, d11 = 3 * t * t - 2 * t;
      // second derivative
      const s00 = 12 * t - 6, s10 = 6 * t - 4, s01 = -12 * t + 6, s11 = 6 * t - 2;
      const dx = d00 * seg.p0.x + d10 * seg.m0.x + d01 * seg.p1.x + d11 * seg.m1.x;
      const dz = d00 * seg.p0.z + d10 * seg.m0.z + d01 * seg.p1.z + d11 * seg.m1.z;
      const ddx = s00 * seg.p0.x + s10 * seg.m0.x + s01 * seg.p1.x + s11 * seg.m1.x;
      const ddz = s00 * seg.p0.z + s10 * seg.m0.z + s01 * seg.p1.z + s11 * seg.m1.z;
      const sp2 = dx * dx + dz * dz;
      if (sp2 < 1e-6) return 0;
      const kap = Math.abs(dx * ddz - dz * ddx) / Math.pow(sp2, 1.5);
      if (kap > 1e-9) minR = Math.min(minR, 1 / kap);
    }
    return minR;
  }

  private keyS(anchor: string, offset = 0): number {
    return this.wrapS(this.sOf(anchor) + offset);
  }

  /** Cyclic piecewise interpolation over keyed values. */
  private cyclicInterp(keys: { s: number; v: number }[], s: number, smooth: boolean): number {
    const L = this.length;
    const k = keys;
    for (let i = 0; i < k.length; i++) {
      const a = k[i]!, b = k[(i + 1) % k.length]!;
      const sb = b.s > a.s ? b.s : b.s + L;
      let ss = s;
      if (ss < a.s) ss += L;
      if (ss >= a.s && ss <= sb) {
        const t = (ss - a.s) / Math.max(1e-6, sb - a.s);
        return lerp(a.v, b.v, smooth ? t * t * (3 - 2 * t) : t);
      }
    }
    return k[0]!.v;
  }

  private fillProfiles(): void {
    const widthKeys = ROAD_WIDTH_KEYS.map((w) => ({ s: this.keyS(w.anchor, w.offset ?? 0), v: w.width })).sort((a, b) => a.s - b.s);
    const weatherKeys = WEATHER_KEYS.map((w) => ({ s: this.keyS(w.anchor, w.offset ?? 0), v: w.intensity })).sort((a, b) => a.s - b.s);
    const districtStarts = DISTRICTS.map((d) => ({ id: d.id, s: this.sOf(d.fromAnchor) })).sort((a, b) => a.s - b.s);
    for (let i = 0; i < this.n; i++) {
      const s = i * SAMPLE_STEP;
      this.halfWidth[i] = this.cyclicInterp(widthKeys, s, false) / 2;
      this.weather[i] = clamp(this.cyclicInterp(weatherKeys, s, true), 0, 3);
      let d: DistrictId = districtStarts[districtStarts.length - 1]!.id;
      for (const ds of districtStarts) if (s >= ds.s) d = ds.id;
      this.district[i] = DISTRICT_IDS.indexOf(d);
      // Tunnel rain factor with eased portals
      const { s0, s1 } = this.tunnel;
      const r = TUNNEL_RAIN.portalRamp;
      let inside = 0;
      if (s >= s0 - r && s <= s1 + r) inside = Math.min(smoothstep(s0 - r, s0 + r, s), 1 - smoothstep(s1 - r, s1 + r, s));
      this.rainFactor[i] = lerp(1, TUNNEL_RAIN.interiorFactor, inside);
    }
  }

  private fillStructures(): void {
    const { s0: t0, s1: t1 } = this.tunnel;
    for (let i = 0; i < this.n; i++) {
      const s = i * SAMPLE_STEP;
      const y = this.py[i]!;
      let k: StructureKind = STRUCTURE.GROUND;
      if (s >= t0 && s <= t1) k = STRUCTURE.TUNNEL;
      else if (s >= this.bridge.s0 - 20 && s <= this.bridge.s1 + 20) k = STRUCTURE.BRIDGE;
      else if (y < ROAD_PROFILE.baseGroundY - 0.4) k = STRUCTURE.TRENCH;
      else if (y > ROAD_PROFILE.baseGroundY + 0.6) k = STRUCTURE.VIADUCT;
      this.structure[i] = k;
    }
  }

  private buildCheckpoints(): void {
    CHECKPOINTS.forEach((c, i) => {
      this.checkpoints.push({ index: i + 1, s: this.keyS(c.anchor, c.offset), label: c.label });
    });
    // Must be strictly ordered along the lap.
    for (let i = 1; i < this.checkpoints.length; i++) {
      if (this.checkpoints[i]!.s <= this.checkpoints[i - 1]!.s) throw new Error(`Checkpoint ${i + 1} is not ordered along the lap`);
    }
  }

  private buildRecoveryNodes(): void {
    const unsafe0 = this.bridge.debrisStart - 20;
    const unsafe1 = this.bridge.gapEnd + 12;
    let idx = 0;
    for (let s = 20; s < this.length - 10; s += RECOVERY_NODE_SPACING) {
      if (s > unsafe0 && s < unsafe1) continue;
      this.recoveryNodes.push({ s, index: idx++ });
    }
    // Explicit pre-jump node on intact deck.
    const pre = this.bridge.s0 + BRIDGE_SPEC.preJumpRecovery;
    this.recoveryNodes.push({ s: pre, index: idx++ });
    this.recoveryNodes.sort((a, b) => a.s - b.s);
    this.recoveryNodes.forEach((r, i) => (r.index = i));
  }

  private buildPuddles(): void {
    for (const p of PUDDLES) {
      const s0 = this.keyS(p.anchor, p.offset);
      const hw = this.halfWidthAt(s0 + p.length / 2);
      this.puddles.push({ s0, s1: s0 + p.length, lateral: p.lateral * (hw - p.halfWidth * 0.6), halfWidth: p.halfWidth, size: p.size });
    }
    this.puddles.sort((a, b) => a.s0 - b.s0);
  }

  private buildObstacles(): void {
    // Broken bridge progression: debris and damaged barriers hug the rails, keeping a readable line.
    const b = this.bridge;
    const rngSeq = [0.18, 0.62, 0.35, 0.81, 0.47, 0.09, 0.73, 0.28, 0.56, 0.91];
    let k = 0;
    for (let s = b.debrisStart + 8; s < b.rampStart - 10; s += 17) {
      const hw = this.halfWidthAt(s);
      const side = k % 2 === 0 ? 1 : -1;
      const depth = 1.2 + rngSeq[k % rngSeq.length]! * 2.2;
      const lat1 = side * (hw + 0.2);
      const lat0 = side * (hw - depth);
      this.obstacles.push({ s0: s, s1: s + 2.5 + rngSeq[(k + 3) % rngSeq.length]! * 3, lat0: Math.min(lat0, lat1), lat1: Math.max(lat0, lat1), height: 0.6 + rngSeq[(k + 5) % rngSeq.length]! * 0.8, kind: 'debris' });
      k++;
    }
  }

  private buildGrid(): void {
    for (let slot = 0; slot < RACE.maxPlayers; slot++) {
      const row = Math.floor(slot / RACE.gridColumns);
      const col = slot % RACE.gridColumns;
      const s = this.wrapS(-RACE.gridFrontOffset - row * RACE.gridRowSpacing - (col === 1 ? RACE.gridStagger : 0));
      const lateral = col === 0 ? -RACE.gridColumnOffset : RACE.gridColumnOffset;
      this.grid.push({ slot, s, lateral });
    }
  }

  // ---------------------------------------------------------------- queries
  sOf(anchorId: string): number {
    const s = this.anchorS.get(anchorId);
    if (s === undefined) throw new Error(`Unknown anchor ${anchorId}`);
    return s;
  }

  wrapIndex(i: number): number {
    return ((i % this.n) + this.n) % this.n;
  }

  wrapS(s: number): number {
    const L = this.length;
    return ((s % L) + L) % L;
  }

  /** Signed shortest distance along the loop from a to b. */
  deltaS(a: number, b: number): number {
    let d = b - a;
    const L = this.length;
    if (d > L / 2) d -= L;
    if (d < -L / 2) d += L;
    return d;
  }

  private lerpArr(arr: ArrayLike<number>, s: number): number {
    const u = this.wrapS(s) / SAMPLE_STEP;
    const i0 = Math.floor(u);
    const f = u - i0;
    const a = arr[i0 % this.n]!, b = arr[(i0 + 1) % this.n]!;
    return a + (b - a) * f;
  }

  frameAt(s: number, out?: TrackFrame): TrackFrame {
    const o = out ?? ({} as TrackFrame);
    o.px = this.lerpArr(this.px, s);
    o.py = this.lerpArr(this.py, s);
    o.pz = this.lerpArr(this.pz, s);
    const tx = this.lerpArr(this.tx, s), ty = this.lerpArr(this.ty, s), tz = this.lerpArr(this.tz, s);
    const tl = Math.hypot(tx, ty, tz) || 1;
    o.tx = tx / tl;
    o.ty = ty / tl;
    o.tz = tz / tl;
    const rl = Math.hypot(o.tz, o.tx) || 1;
    o.rx = -o.tz / rl;
    o.rz = o.tx / rl;
    const ux = -o.rz * o.ty, uy = o.rz * o.tx - o.rx * o.tz, uz = o.rx * o.ty;
    const ul = Math.hypot(ux, uy, uz) || 1;
    o.ux = ux / ul;
    o.uy = uy / ul;
    o.uz = uz / ul;
    return o;
  }

  /** World position of a point given track coordinates (height is along the road normal). */
  pointAt(s: number, lateral: number, height = 0): V3 {
    const f = this.frameAt(s);
    const h = height + this.surfaceOffsetAt(s);
    return {
      x: f.px + f.rx * lateral + f.ux * h,
      y: f.py + f.uy * h,
      z: f.pz + f.rz * lateral + f.uz * h,
    };
  }

  headingAt(s: number): number {
    const f = this.frameAt(s);
    return Math.atan2(f.tx, f.tz);
  }

  halfWidthAt(s: number): number {
    return this.lerpArr(this.halfWidth, s);
  }

  /** Lateral offset of the inner face of the edge barrier. */
  barrierOffsetAt(s: number): number {
    return this.halfWidthAt(s) + ROAD_PROFILE.shoulder;
  }

  weatherAt(s: number): number {
    return this.lerpArr(this.weather, s);
  }

  rainFactorAt(s: number): number {
    return this.lerpArr(this.rainFactor, s);
  }

  districtAt(s: number): DistrictId {
    return DISTRICT_IDS[this.district[Math.floor(this.wrapS(s) / SAMPLE_STEP) % this.n]!]!;
  }

  structureAt(s: number): StructureKind {
    return this.structure[Math.floor(this.wrapS(s) / SAMPLE_STEP) % this.n]! as StructureKind;
  }

  crowdDensityAt(s: number): number {
    return CROWD_DENSITY[this.districtAt(s)];
  }

  isInGap(s: number): boolean {
    const w = this.wrapS(s);
    return w >= this.bridge.lip && w < this.bridge.gapEnd;
  }

  /** Extra road-surface height (ramp) above the spline centreline at s. */
  surfaceOffsetAt(s: number): number {
    const w = this.wrapS(s);
    const b = this.bridge;
    if (w >= b.rampStart && w <= b.lip) {
      // Kicker: eases in, then keeps a slight upward slope right to the lip (launch reads clearly).
      const u = (w - b.rampStart) / (b.lip - b.rampStart);
      return BRIDGE_SPEC.rampRise * (0.65 * smoothstep(b.rampStart, b.lip, w) + 0.35 * u * u);
    }
    return 0;
  }

  /** True when the point is over water (outside any road surface). */
  isOverWater(x: number, z: number): boolean {
    return x > WATER_REGION.minX && x < WATER_REGION.maxX && z > WATER_REGION.minZ && z < WATER_REGION.maxZ;
  }

  /** Weather level name at s. */
  weatherLevelAt(s: number): (typeof WEATHER_LEVELS)[number] {
    return WEATHER_LEVELS[clamp(Math.round(this.weatherAt(s)), 0, 3)]!;
  }

  puddleAt(s: number, lateral: number): Puddle | null {
    const w = this.wrapS(s);
    for (const p of this.puddles) {
      if (w >= p.s0 && w <= p.s1 && Math.abs(lateral - p.lateral) <= p.halfWidth) return p;
    }
    return null;
  }

  /** Competitive grip multiplier at a road location (hover bikes use the same model). */
  gripAt(s: number, lateral: number): number {
    const p = this.puddleAt(s, lateral);
    if (p) return p.size === 'LARGE' ? WET_GRIP.LARGE_PUDDLE : WET_GRIP.SMALL_PUDDLE;
    const w = this.weatherAt(s) * this.rainFactorAt(s);
    const lv = [WET_GRIP.LIGHT, WET_GRIP.MODERATE, WET_GRIP.HEAVY, WET_GRIP.TORRENTIAL];
    const i0 = clamp(Math.floor(w), 0, 3), i1 = clamp(i0 + 1, 0, 3);
    return lerp(lv[i0]!, lv[i1]!, w - i0);
  }

  obstacleAt(s: number, lateral: number, radius: number): TrackObstacle | null {
    const w = this.wrapS(s);
    for (const o of this.obstacles) {
      if (w + radius >= o.s0 && w - radius <= o.s1 && lateral + radius >= o.lat0 && lateral - radius <= o.lat1) return o;
    }
    return null;
  }

  checkpointGateHalfWidth(s: number): number {
    return this.barrierOffsetAt(s) + CHECKPOINT_GATE_MARGIN;
  }

  /**
   * Projects a world point onto the track near `hintS` (continuity window). The window keeps
   * overpasses/bridges from creating progress ambiguity.
   */
  project(x: number, y: number, z: number, hintS: number | null, back = 40, ahead = 90): Projection {
    let bestI = 0;
    let bestD = Infinity;
    if (hintS === null) {
      for (let i = 0; i < this.n; i++) {
        const dx = x - this.px[i]!, dy = (y - this.py[i]!) * 1.5, dz = z - this.pz[i]!;
        const d = dx * dx + dy * dy + dz * dz;
        if (d < bestD) {
          bestD = d;
          bestI = i;
        }
      }
    } else {
      const c = Math.round(this.wrapS(hintS) / SAMPLE_STEP);
      for (let k = -back; k <= ahead; k++) {
        const i = this.wrapIndex(c + k);
        const dx = x - this.px[i]!, dy = (y - this.py[i]!) * 1.5, dz = z - this.pz[i]!;
        const d = dx * dx + dy * dy + dz * dz;
        if (d < bestD) {
          bestD = d;
          bestI = i;
        }
      }
    }
    // Refine on the neighbouring segments.
    let bestS = bestI * SAMPLE_STEP;
    let refinedD = Infinity;
    for (const j of [this.wrapIndex(bestI - 1), bestI]) {
      const k = this.wrapIndex(j + 1);
      const ax = this.px[j]!, ay = this.py[j]!, az = this.pz[j]!;
      const bx = this.px[k]! - ax, by = this.py[k]! - ay, bz = this.pz[k]! - az;
      const len2 = bx * bx + by * by + bz * bz;
      const t = clamp(((x - ax) * bx + (y - ay) * by + (z - az) * bz) / Math.max(1e-9, len2), 0, 1);
      const qx = ax + bx * t - x, qy = ay + by * t - y, qz = az + bz * t - z;
      const d = qx * qx + qy * qy + qz * qz;
      if (d < refinedD) {
        refinedD = d;
        bestS = (j + t) * SAMPLE_STEP;
      }
    }
    const s = this.wrapS(bestS);
    const f = this.frameAt(s);
    const dx = x - f.px, dy = y - f.py, dz = z - f.pz;
    return {
      s,
      index: Math.floor(s / SAMPLE_STEP),
      lateral: dx * f.rx + dz * f.rz,
      height: dx * f.ux + dy * f.uy + dz * f.uz - this.surfaceOffsetAt(s),
      distance: Math.sqrt(refinedD),
    };
  }

  /** Minimum horizontal turning radius found along the lap (for validation). */
  minRadius(): { radius: number; s: number } {
    let best = Infinity, at = 0;
    for (let i = 0; i < this.n; i++) {
      const k = Math.abs(this.curvature[i]!);
      if (k > 1e-6 && 1 / k < best) {
        best = 1 / k;
        at = i * SAMPLE_STEP;
      }
    }
    return { radius: best, s: at };
  }

  /** Last recovery node at or behind lap position s (wrapping). */
  recoveryNodeBefore(s: number): RecoveryNode {
    const w = this.wrapS(s);
    let best = this.recoveryNodes[this.recoveryNodes.length - 1]!;
    for (const r of this.recoveryNodes) if (r.s <= w) best = r;
    return best;
  }
}

let shared: Track | null = null;
/** Deterministic singleton; both server and client build the identical track. */
export function getTrack(): Track {
  if (!shared) shared = new Track();
  return shared;
}
