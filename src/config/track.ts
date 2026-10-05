// Locked route skeleton and region profiles (HANDOFF/02_TRACK_BLUEPRINT.md).
// Anchors are spline design anchors in metres: X east/west, Y elevation, Z north/south.
import type { DistrictId } from '../shared/ids.js';

export interface TrackAnchor {
  id: string;
  x: number;
  y: number;
  z: number;
  role: string;
}

/** Closed loop: the final SF (finish) is the same point as the first and is not repeated. */
export const TRACK_ANCHORS: readonly TrackAnchor[] = [
  { id: 'SF', x: -400, y: 0, z: -700, role: 'Start/Finish' },
  { id: 'N1', x: 200, y: 0, z: -700, role: 'Neon Boulevard' },
  { id: 'N2', x: 550, y: 4, z: -550, role: 'Neon Sweep' },
  { id: 'N3', x: 700, y: 8, z: -250, role: 'Commercial' },
  { id: 'N4', x: 550, y: 10, z: 0, role: 'Commercial' },
  { id: 'N5', x: 250, y: 12, z: 150, role: 'Dense Streets' },
  { id: 'N6', x: -100, y: 14, z: 200, role: 'Dense Streets' },
  { id: 'N7', x: -450, y: 12, z: 100, role: 'Storm Entry' },
  { id: 'B1_IN', x: -650, y: 10, z: 0, role: 'Boost #1 Entry' },
  { id: 'B1_OUT', x: -650, y: 12, z: 850, role: 'Boost #1 Exit' },
  { id: 'S1', x: -350, y: 10, z: 1050, role: 'Storm Braking' },
  { id: 'S2', x: 50, y: 8, z: 1100, role: 'Heavy Rain' },
  { id: 'I1', x: 350, y: 4, z: 950, role: 'Industrial' },
  { id: 'I2', x: 450, y: 0, z: 700, role: 'Industrial' },
  { id: 'I3', x: 300, y: -2, z: 450, role: 'Tunnel Approach' },
  { id: 'T_IN', x: 300, y: -2, z: 350, role: 'Tunnel Entrance' },
  { id: 'T_OUT', x: 300, y: -2, z: 0, role: 'Tunnel Exit' },
  { id: 'BA', x: 500, y: 4, z: -200, role: 'Bridge Climb' },
  { id: 'BR_IN', x: 650, y: 14, z: -350, role: 'Broken Bridge / Boost #2 Entry' },
  { id: 'BR_OUT', x: -150, y: 14, z: -350, role: 'Broken Bridge Exit' },
  { id: 'W1', x: -350, y: 8, z: -250, role: 'Western Technical' },
  { id: 'W2', x: -550, y: 4, z: -350, role: 'Final Technical' },
  { id: 'W3', x: -600, y: 0, z: -550, role: 'Neon Re-entry' },
];

/**
 * Segments that must be geometrically straight (from anchor id to the next anchor).
 * B1 and BR are the two dedicated maximum-speed straights; the tunnel approach and tunnel
 * are straight so the instanced tunnel modules line up.
 */
export const STRAIGHT_SEGMENTS: readonly string[] = ['B1_IN', 'I3', 'T_IN', 'BR_IN'];

/** The exactly-two dedicated boost straights (entry anchor ids). */
export const BOOST_STRAIGHTS: readonly { from: string; to: string }[] = [
  { from: 'B1_IN', to: 'B1_OUT' },
  { from: 'BR_IN', to: 'BR_OUT' },
];

/**
 * Hermite tangent magnitude as a fraction of the adjacent chord length. Lower values hug
 * the anchor polyline more tightly (shorter lap, tighter corners).
 */
export const SPLINE_TANGENT_SCALE = 0.62;

export interface DistrictSpan {
  id: DistrictId;
  fromAnchor: string;
  toAnchor: string;
}

export const DISTRICTS: readonly DistrictSpan[] = [
  { id: 'NEON_CORE', fromAnchor: 'SF', toAnchor: 'N2' },
  { id: 'COMMERCIAL', fromAnchor: 'N2', toAnchor: 'N6' },
  { id: 'STORM', fromAnchor: 'N6', toAnchor: 'S1' },
  { id: 'HEAVY_RAIN_TECHNICAL', fromAnchor: 'S1', toAnchor: 'I1' },
  { id: 'INDUSTRIAL', fromAnchor: 'I1', toAnchor: 'T_IN' },
  { id: 'TUNNEL', fromAnchor: 'T_IN', toAnchor: 'T_OUT' },
  { id: 'BRIDGE_CLIMB', fromAnchor: 'T_OUT', toAnchor: 'BR_IN' },
  { id: 'BROKEN_BRIDGE', fromAnchor: 'BR_IN', toAnchor: 'BR_OUT' },
  { id: 'WESTERN_TECHNICAL', fromAnchor: 'BR_OUT', toAnchor: 'W2' },
  { id: 'FINAL_NEON_RUN', fromAnchor: 'W2', toAnchor: 'SF' },
];

/**
 * Road width keys: anchor id + optional metre offset along the track, full road width in metres.
 * Widths are linearly interpolated along the lap.
 */
export interface WidthKey {
  anchor: string;
  offset?: number;
  width: number;
}

export const ROAD_WIDTH_KEYS: readonly WidthKey[] = [
  { anchor: 'SF', offset: -60, width: 18 },
  { anchor: 'SF', offset: 120, width: 18 },
  { anchor: 'N1', width: 14 },
  { anchor: 'N2', width: 13 },
  { anchor: 'N3', width: 12 },
  { anchor: 'N4', width: 11 },
  { anchor: 'N5', width: 12 },
  { anchor: 'N6', width: 12 },
  { anchor: 'N7', width: 13 },
  { anchor: 'B1_IN', offset: -40, width: 15 },
  { anchor: 'B1_IN', width: 16 },
  { anchor: 'B1_OUT', width: 16 },
  { anchor: 'B1_OUT', offset: 80, width: 14 },
  { anchor: 'S1', width: 12 },
  { anchor: 'S2', width: 11 },
  { anchor: 'I1', width: 12 },
  { anchor: 'I2', width: 13 },
  { anchor: 'I3', width: 11.5 },
  { anchor: 'T_IN', offset: -40, width: 10.4 },
  // Tunnel modules are ~12.1 m wall to wall; road + shoulders sit inside them.
  { anchor: 'T_IN', width: 9.4 },
  { anchor: 'T_OUT', width: 9.4 },
  { anchor: 'T_OUT', offset: 40, width: 10.6 },
  { anchor: 'BA', width: 12 },
  { anchor: 'BR_IN', offset: -30, width: 14 },
  { anchor: 'BR_IN', width: 16 },
  { anchor: 'BR_OUT', width: 16 },
  { anchor: 'BR_OUT', offset: 60, width: 12 },
  { anchor: 'W1', width: 11 },
  { anchor: 'W2', width: 10 },
  { anchor: 'W3', width: 11 },
  { anchor: 'SF', offset: -250, width: 14 },
];

/** Weather intensity keys: 0 = LIGHT, 1 = MODERATE, 2 = HEAVY, 3 = TORRENTIAL. */
export interface WeatherKey {
  anchor: string;
  offset?: number;
  intensity: number;
}

export const WEATHER_KEYS: readonly WeatherKey[] = [
  { anchor: 'SF', intensity: 1.0 },
  { anchor: 'N1', intensity: 1.0 },
  { anchor: 'N2', intensity: 0.6 },
  { anchor: 'N3', intensity: 0.2 },
  { anchor: 'N4', intensity: 0.4 },
  { anchor: 'N5', intensity: 0.9 },
  { anchor: 'N6', intensity: 1.2 },
  { anchor: 'N7', intensity: 1.8 },
  { anchor: 'B1_IN', intensity: 2.1 },
  { anchor: 'B1_OUT', intensity: 3.0 },
  { anchor: 'S1', intensity: 2.8 },
  { anchor: 'S2', intensity: 2.5 },
  { anchor: 'I1', intensity: 2.1 },
  { anchor: 'I2', intensity: 2.0 },
  { anchor: 'I3', intensity: 2.0 },
  { anchor: 'BA', intensity: 2.4 },
  { anchor: 'BR_IN', intensity: 2.9 },
  { anchor: 'BR_OUT', intensity: 3.0 },
  { anchor: 'W1', intensity: 2.6 },
  { anchor: 'W2', intensity: 2.0 },
  { anchor: 'W3', intensity: 1.4 },
  { anchor: 'SF', offset: -120, intensity: 1.0 },
];

/** Tunnel is covered: outdoor rain nearly vanishes inside. Ramps (m) at each portal. */
export const TUNNEL_RAIN = { interiorFactor: 0.04, portalRamp: 22 } as const;

export type PuddleSize = 'SMALL' | 'LARGE';
export interface PuddleDef {
  anchor: string;
  /** Start offset from anchor along the lap (m). */
  offset: number;
  length: number;
  /** Lateral centre, as a fraction of the half width (-1 = left edge, +1 = right edge). */
  lateral: number;
  /** Lateral half-width in metres. */
  halfWidth: number;
  size: PuddleSize;
}

/**
 * Authored puddle zones. Boost #1 keeps a clean central line with puddles in the outer lanes.
 * Heavy-rain technical puts wetter puddles on short inside lines.
 */
export const PUDDLES: readonly PuddleDef[] = [
  // Neon core: a couple of small ones for reflection readability
  { anchor: 'N1', offset: -160, length: 12, lateral: 0.6, halfWidth: 2.2, size: 'SMALL' },
  // Commercial
  { anchor: 'N3', offset: 30, length: 10, lateral: -0.55, halfWidth: 2.0, size: 'SMALL' },
  { anchor: 'N5', offset: 60, length: 14, lateral: 0.5, halfWidth: 2.4, size: 'SMALL' },
  // Storm / Boost #1 outer lanes
  { anchor: 'B1_IN', offset: 120, length: 26, lateral: -0.72, halfWidth: 3.0, size: 'LARGE' },
  { anchor: 'B1_IN', offset: 260, length: 22, lateral: 0.72, halfWidth: 3.0, size: 'LARGE' },
  { anchor: 'B1_IN', offset: 420, length: 30, lateral: -0.7, halfWidth: 3.2, size: 'LARGE' },
  { anchor: 'B1_IN', offset: 560, length: 18, lateral: 0.74, halfWidth: 2.8, size: 'SMALL' },
  { anchor: 'B1_IN', offset: 690, length: 26, lateral: 0.7, halfWidth: 3.2, size: 'LARGE' },
  // Torrential Boost #1 exit: a centre pool that forces a left/right line choice, and a drain
  // puddle against the kerb.
  { anchor: 'B1_OUT', offset: 40, length: 24, lateral: 0, halfWidth: 2.6, size: 'LARGE' },
  { anchor: 'B1_OUT', offset: 170, length: 12, lateral: 0.85, halfWidth: 1.6, size: 'SMALL' },
  // Heavy rain technical: inside lines wetter
  { anchor: 'S1', offset: -40, length: 30, lateral: -0.55, halfWidth: 3.0, size: 'LARGE' },
  { anchor: 'S1', offset: 120, length: 24, lateral: 0.5, halfWidth: 2.6, size: 'LARGE' },
  { anchor: 'S2', offset: -30, length: 20, lateral: 0.55, halfWidth: 2.6, size: 'SMALL' },
  { anchor: 'S2', offset: 110, length: 28, lateral: 0.5, halfWidth: 2.8, size: 'LARGE' },
  // Industrial
  { anchor: 'I1', offset: 90, length: 16, lateral: -0.45, halfWidth: 2.4, size: 'SMALL' },
  { anchor: 'I2', offset: 40, length: 22, lateral: 0.5, halfWidth: 2.8, size: 'LARGE' },
  // Bridge climb
  { anchor: 'BA', offset: -60, length: 14, lateral: -0.5, halfWidth: 2.2, size: 'SMALL' },
  { anchor: 'BA', offset: 120, length: 22, lateral: -0.62, halfWidth: 2.6, size: 'LARGE' },
  // Bridge approach deck (well before the debris field and the jump)
  { anchor: 'BR_IN', offset: 80, length: 12, lateral: 0.7, halfWidth: 1.8, size: 'SMALL' },
  // Western technical
  { anchor: 'W1', offset: -20, length: 20, lateral: 0.55, halfWidth: 2.4, size: 'LARGE' },
  { anchor: 'W1', offset: 120, length: 12, lateral: -0.78, halfWidth: 1.6, size: 'SMALL' },
  { anchor: 'W2', offset: 30, length: 14, lateral: -0.5, halfWidth: 2.2, size: 'SMALL' },
];

/** Crowd density 0..1 per district (blueprint "Crowd zones"). */
export const CROWD_DENSITY: Record<DistrictId, number> = {
  NEON_CORE: 1.0,
  COMMERCIAL: 0.6,
  STORM: 0.12,
  HEAVY_RAIN_TECHNICAL: 0.18,
  INDUSTRIAL: 0.1,
  TUNNEL: 0,
  BRIDGE_CLIMB: 0.05,
  BROKEN_BRIDGE: 0,
  WESTERN_TECHNICAL: 0.25,
  FINAL_NEON_RUN: 0.85,
};

/** Walkers only use sidewalks in these districts. */
export const WALKER_DISTRICTS: readonly DistrictId[] = ['NEON_CORE', 'COMMERCIAL', 'FINAL_NEON_RUN'];

export const TUNNEL_SPEC = {
  sourceModuleLength: 29.38,
  /**
   * The covered section extends past the T_IN/T_OUT portals over the neighbouring trench road
   * (the track itself is unchanged): ~700 m, twice the original 350 m bore. Modules are added
   * (and bent along the curved approaches), never stretched.
   */
  extendBefore: 175,
  extendAfter: 175,
  moduleCount: 24,
  /** Inner half width of the source module (m); walls are fitted to the road barriers. */
  moduleHalfWidth: 6.04,
  scaleX: 2.55,
  scaleY: 1.25,
  /** Lighting progression by tunnel fraction. */
  lightStops: [
    { t: 0.0, color: 0xdfe8ff },
    { t: 0.25, color: 0x16e0ff },
    { t: 0.5, color: 0xff2bd6 },
    { t: 0.75, color: 0xff2a1e },
    { t: 1.0, color: 0x16e0ff },
  ],
} as const;

/** Broken bridge progression, metres from BR_IN. */
export const BRIDGE_SPEC = {
  intactEnd: 550,
  debrisEnd: 650,
  damagedEnd: 710,
  rampStart: 710,
  lip: 735,
  /** A real jump (overrides the ~10 m handoff target): a clearly visible 40 m hole in the deck. */
  gap: 40,
  /** Height the kicker ramp rises above the deck at the lip (the readable launch lip). */
  rampRise: 1.2,
  /** Recovery node placed on intact deck before the damage (m from BR_IN). */
  preJumpRecovery: 520,
  /** Post-landing stabilization (m) before technical section. */
  stabilization: 100,
} as const;

export const ROAD_PROFILE = {
  shoulder: 0.8,
  curbHeight: 0.14,
  sidewalkWidth: 3.2,
  barrierHeight: 1.1,
  barrierThickness: 0.5,
  /** Elevation above base ground at which a road section becomes a viaduct. */
  viaductThreshold: 3.5,
  pillarSpacing: 32,
  baseGroundY: 0,
  waterY: -5,
} as const;

/**
 * Water body under the broken bridge (x/z rectangle). Falls into it trigger off-world recovery.
 */
export const WATER_REGION = { minX: -240, maxX: 540, minZ: -480, maxZ: -262 } as const;

/** Ordered checkpoint placement: anchor + offset. Start/finish (s = 0) is implicit. */
export interface CheckpointDef {
  anchor: string;
  offset: number;
  label: string;
}

export const CHECKPOINTS: readonly CheckpointDef[] = [
  { anchor: 'N1', offset: 0, label: 'Neon Boulevard' },
  { anchor: 'N3', offset: 0, label: 'Commercial' },
  { anchor: 'N5', offset: 0, label: 'Dense Streets' },
  { anchor: 'N7', offset: 0, label: 'Storm Entry' },
  { anchor: 'B1_IN', offset: 425, label: 'Boost #1' },
  { anchor: 'S1', offset: 0, label: 'Storm Braking' },
  { anchor: 'S2', offset: 0, label: 'Heavy Rain' },
  { anchor: 'I1', offset: 0, label: 'Industrial' },
  { anchor: 'I3', offset: 0, label: 'Tunnel Approach' },
  { anchor: 'T_IN', offset: 175, label: 'Tunnel' },
  { anchor: 'BA', offset: 0, label: 'Bridge Climb' },
  { anchor: 'BR_IN', offset: 300, label: 'Bridge Pre-Jump' },
  { anchor: 'BR_IN', offset: 760, label: 'Bridge Post-Jump' },
  { anchor: 'W1', offset: 0, label: 'Western Technical' },
  { anchor: 'W2', offset: 0, label: 'Final Technical' },
  { anchor: 'W3', offset: 60, label: 'Neon Re-entry' },
];

export const CHECKPOINT_GATE_MARGIN = 3; // metres beyond the barriers still counted inside a gate
export const RECOVERY_NODE_SPACING = 40;
