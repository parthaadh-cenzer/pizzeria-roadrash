// Locked gameplay constants (HANDOFF/03_GAMEPLAY_CONSTANTS.md).
// Every gameplay system reads tuning from here; do not scatter these numbers into systems.
import type { AttackId, BikeId, WeatherLevel } from '../shared/ids.js';

const DEG = Math.PI / 180;

export const SPEED = {
  /** Physics max speed in m/s, shared by every bike. */
  physicsMax: 80,
  /** Displayed max speed in km/h (cinematic, not SI). */
  displayedMax: 400,
  /** Display mapping: physics speed x5. */
  displayFactor: 5,
  maxBraking: 22,
  reverseCap: 8,
  /** Coasting drag when no throttle (m/s^2). Tuned for arcade feel; not in locked table. */
  coastDrag: 2.2,
  /** Aerodynamic drag coefficient used so acceleration tapers toward the cap. */
  aeroDragK: 0.0009,
} as const;

export function displaySpeedKmh(physicsSpeed: number): number {
  return Math.round(Math.abs(physicsSpeed) * SPEED.displayFactor);
}

export interface BikeBalance {
  accel: number; // m/s^2
  handling: number;
  stability: number;
  leanTargetDeg: number;
}

export const BIKE_BALANCE: Record<BikeId, BikeBalance> = {
  BIKE_01_SCIFI_MOTORCYCLE: { accel: 11.8, handling: 1.0, stability: 1.0, leanTargetDeg: 48 },
  BIKE_02_AKIRA_CRUISER: { accel: 10.0, handling: 0.82, stability: 1.2, leanTargetDeg: 42 },
  BIKE_03_HOVERING_ENGINE: { accel: 13.2, handling: 0.86, stability: 0.92, leanTargetDeg: 48 },
  BIKE_04_HOVER_ROCKET: { accel: 12.6, handling: 0.9, stability: 0.88, leanTargetDeg: 48 },
  BIKE_05_TRON_LIGHT_CYCLE: { accel: 11.4, handling: 1.12, stability: 1.02, leanTargetDeg: 48 },
  BIKE_06_MONOBIKE: { accel: 10.8, handling: 1.18, stability: 0.78, leanTargetDeg: 52 },
};

export const STEERING = {
  lowSpeedMaxYawRate: 105 * DEG,
  maxSpeedBaseYawRate: 42 * DEG,
  /** Speed (m/s) below which the low-speed yaw rate applies fully. */
  lowSpeedRef: 12,
  keyboardRampToFull: 0.16,
  keyboardRelease: 0.2,
  visualLeanLag: 0.09,
  gyroDeadzoneDeg: 3,
  gyroFullSteerDeg: 28,
  /** Exponential smoothing time constant for gyro samples (s). */
  gyroSmoothing: 0.08,
  gyroSensitivityMin: 0.5,
  gyroSensitivityMax: 2.0,
  gyroSensitivityDefault: 1.0,
  /** Lateral grip: how quickly sideways velocity is killed (1/s) at grip 1.0. */
  lateralGripRate: 9.5,
} as const;

export const MOBILE_ASSIST = {
  /** |steer| above this for `sustainTime` engages corner assist. */
  strongSteer: 0.72,
  sustainTime: 0.35,
  /** Throttle multiplier while assist is engaged. */
  throttleScale: 0.55,
  /** Mild engine braking (m/s^2) while assist is engaged. */
  engineBrake: 2.6,
  /** Assist release when |steer| drops below this. */
  releaseSteer: 0.45,
} as const;

export const WET_GRIP: Record<WeatherLevel | 'SMALL_PUDDLE' | 'LARGE_PUDDLE', number> = {
  LIGHT: 1.0,
  MODERATE: 0.96,
  HEAVY: 0.9,
  TORRENTIAL: 0.84,
  SMALL_PUDDLE: 0.78,
  LARGE_PUDDLE: 0.68,
};

export const LARGE_PUDDLE = {
  /** Speed loss on entry at the reference speed and area (scaled by both, clamped). */
  immediateSpeedLoss: 0.08,
  steeringScale: 0.8,
  steeringScaleDuration: 0.65,
  /** Reference entry speed (m/s) and puddle area (m², length x full width) for the scaling. */
  refSpeed: 40,
  refArea: 140,
  /** A large puddle hit at or above this speed throws the full-screen splash sheet (m/s). */
  sheetSpeed: 27,
} as const;

export const BOOST_CHEAT = {
  sequence: 'xyzzyspoon',
  charges: 10,
  chargeDuration: 1.25,
  acceleration: 80,
  /** Server rate limit between consumptions (s). */
  minInterval: 0.25,
  boostFovPeak: 92,
} as const;

export interface AttackDef {
  reach: number;
  windup: number;
  active: number;
  recovery: number;
  total: number;
  lateralReaction: number;
  /** Yaw disturbance multiplier applied to the target. */
  yawFactor: number;
  /** Lean disturbance multiplier applied to the target. */
  leanFactor: number;
  /** Instability added to the target (0..1 scale) before stability scaling. */
  instability: number;
}

export const ATTACKS: Record<AttackId, AttackDef> = {
  KICK: { reach: 1.05, windup: 0.18, active: 0.1, recovery: 0.32, total: 0.6, lateralReaction: 1.8, yawFactor: 0.25, leanFactor: 0.6, instability: 0.75 },
  MACHETE: { reach: 0.65, windup: 0.16, active: 0.1, recovery: 0.28, total: 0.54, lateralReaction: 1.15, yawFactor: 0.55, leanFactor: 0.45, instability: 0.45 },
  KATANA: { reach: 1.15, windup: 0.22, active: 0.12, recovery: 0.36, total: 0.7, lateralReaction: 1.35, yawFactor: 0.6, leanFactor: 0.5, instability: 0.55 },
  MORNING_STAR: { reach: 1.35, windup: 0.34, active: 0.16, recovery: 0.5, total: 1.0, lateralReaction: 2.05, yawFactor: 0.9, leanFactor: 0.9, instability: 0.85 },
  ZABIMARU: { reach: 2.2, windup: 0.28, active: 0.18, recovery: 0.46, total: 0.92, lateralReaction: 1.2, yawFactor: 0.4, leanFactor: 0.4, instability: 0.5 },
};

export const COMBAT = {
  /** Transient instability decays toward zero in ~0.8 s. */
  instabilityDecayTime: 0.8,
  /** Instability above this may escalate into a crash. */
  instabilityCrashThreshold: 1.35,
  morningStarBallLag: 0.12,
  /** Lateral distance from rider centre line where the reach is measured from (m). */
  shoulderOffset: 0.35,
  /** Max longitudinal offset (m) for a valid target alongside. */
  longitudinalWindow: 2.4,
  /** Relative speed at which reaction scaling reaches 2x. */
  relativeSpeedRef: 12,
} as const;

export const BIKE_COLLISION = {
  bumpMax: 4,
  displaceMax: 10,
  wobbleMax: 16,
  /** Capsule radius and half length used for bike-vs-bike contact (m). */
  radius: 0.45,
  halfLength: 1.05,
} as const;

export const WORLD_CRASH = {
  glancingAngleDeg: 20,
  crashAngleDeg: 35,
  /** Normal impact speed (m/s) considered "meaningful". */
  meaningfulSpeed: 9,
  rollCrashDeg: 65,
  rollCrashTime: 0.15,
  hardLandingAngleDeg: 28,
  hardLandingVerticalSpeed: 8,
  frontalCrashRelativeSpeed: 16,
  scrapeSpeedLoss: 0.06,
} as const;

export const CRASH_RECOVERY = {
  ragdollMin: 0.8,
  settleTarget: 1.2,
  forcedSettle: 2.0,
  settleSpeed: 0.6,
  runToBikeMaxDistance: 35,
  runSpeed: 6.2,
  liftDuration: 1.25,
  mountDuration: 1.1,
  // Both clips reach standing by ~1.75 s (then end in an arms-out balance pose): hand over to the
  // run just after standing. Equal durations let each client pick the clip from its own rendered
  // ragdoll without changing the sim timeline.
  getupBackDuration: 1.95,
  getupProneDuration: 1.95,
  offWorldPenalty: 3.0,
  /** Crashed bike physics body settle speed (m/s). */
  bikeSettleSpeed: 0.8,
} as const;

export const BRIDGE_JUMP = {
  gapLength: 40,
  /**
   * Arcade launch: a fixed vertical kick off the 1.2 m lip gives ~0.9 s of air at any speed, so the
   * distance grows linearly with speed: ~42 m/s (210 km/h) clears the 40 m gap, 80 m/s (the cap,
   * boost included) lands ~31 m past the far edge, still on the landing deck.
   */
  launchVerticalSpeed: 3.0,
  minComfortableSpeed: 45,
  /** Landing deck height relative to the intact deck (the ramp lip sits BRIDGE_SPEC.rampRise above it). */
  landingDrop: 0,
  landingAssistRate: 6,
  badLateralAngleDeg: 22,
} as const;

export const NETWORK = {
  physicsHz: 60,
  inputHz: 30,
  snapshotHz: 20,
  interpolationDelay: 0.1,
  snapCorrectionDistance: 2.5,
  correctionSmoothing: 0.18,
  reconnectGrace: 20,
  /** Lead time (s) between host start and the synchronized intro. */
  introLeadTime: 1.5,
} as const;

export const CAMERA = {
  chaseDistance: 5.2,
  baseHeight: 2.15,
  fovLow: 68,
  fovHigh: 84,
  fovBoost: 92,
  accelPullback: 0.45,
  brakePushIn: 0.25,
  shakePerImpact: 0.045,
  lookAhead: 6,
} as const;

export const RACE = {
  /** Default race length; the host picks 1-5 laps in the lobby. */
  laps: 1,
  minLaps: 1,
  maxLaps: 5,
  maxPlayers: 10,
  gridColumns: 2,
  gridRows: 5,
  /** Longitudinal spacing between grid rows (m). */
  gridRowSpacing: 9,
  /** Stagger of the right column relative to left (m). */
  gridStagger: 4.5,
  /** Lateral offset of each column from centreline (m). */
  gridColumnOffset: 3.6,
  /** Front row distance behind the start line (m). */
  gridFrontOffset: 14,
  countdownSeconds: 3,
  /** Seconds after the first finisher before remaining racers become DNF. */
  finishingWindow: 60,
  /** Seconds after results before the lobby reopens automatically when no host is connected. */
  resultsHold: 30,
} as const;

/** Validates a lap count from the host (integer 1-5; anything else falls back to the default). */
export function clampLaps(v: unknown): number {
  const n = typeof v === 'number' && Number.isFinite(v) ? Math.round(v) : RACE.laps;
  return Math.max(RACE.minLaps, Math.min(RACE.maxLaps, n));
}

/** Oni intro timeline, seconds relative to intro start (server synchronized). */
export const INTRO = {
  cameraSweep: 4.2,
  oniClipStart: 0.6,
  oniClipTrimStart: 1.0, // source keys begin at t=1.0
  oniClipEnd: 7.333,
  /** Countdown 3-2-1 begins after Oni holds the gesture. */
  countdownStart: 7.2,
} as const;

export function introTotalDuration(): number {
  return INTRO.countdownStart + RACE.countdownSeconds;
}

export const SIM_DT = 1 / NETWORK.physicsHz;
