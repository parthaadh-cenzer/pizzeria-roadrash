// Simulation state shared by the authoritative server and client prediction.
import type { AttackId, BikeId, RiderState } from '../../shared/ids.js';

/** One fixed-step control sample. Produced at 60 Hz on the client, sent in 30 Hz batches. */
export interface ControlInput {
  seq: number;
  /** 0..1 */
  throttle: number;
  /** 0..1 */
  brake: number;
  /** -1..1, + = right. For digital steering this is the target (ramped in sim). */
  steer: number;
  /** true when steer is analog (gyro/touch smoothing already applied client-side). */
  analog: boolean;
  /** Mobile auto acceleration mode. */
  autoAccel: boolean;
  /** Edge-triggered actions for this tick. */
  kick: boolean;
  attack: boolean;
  boost: boolean;
}

export const NEUTRAL_INPUT: ControlInput = {
  seq: 0,
  throttle: 0,
  brake: 0,
  steer: 0,
  analog: false,
  autoAccel: false,
  kick: false,
  attack: false,
  boost: false,
};

export type CrashReason = 'barrier' | 'obstacle' | 'bike' | 'combat' | 'roll' | 'landing' | 'fell' | 'water' | 'offworld';

/** Continuous bike state; everything needed to replay inputs deterministically. */
export interface BikeState {
  x: number;
  y: number;
  z: number;
  yaw: number;
  vx: number;
  vy: number;
  vz: number;
  /** Signed forward speed (m/s). */
  speed: number;
  /** Smoothed steering -1..1. */
  steer: number;
  /** Visual/physical lean (rad, + = right). */
  lean: number;
  pitch: number;
  /** Track projection. */
  s: number;
  lateral: number;
  /** Unwrapped race distance; starts negative on the grid. */
  lapDist: number;
  airborne: boolean;
  airTime: number;
  instability: number;
  wobblePhase: number;
  /** Remaining time of reduced steering after a large puddle. */
  puddleSteerTimer: number;
  /** 0 none, 1 small, 2 large. */
  puddle: number;
  boostTime: number;
  assistTime: number;
  assistOn: boolean;
  rollOverTime: number;
  /** Suspension compression 0..1 for visuals (landing). */
  compression: number;
  /** Last lateral impulse direction for visuals (+right). */
  hitDir: number;
}

export interface BikeParams {
  bikeId: BikeId;
  accel: number;
  handling: number;
  stability: number;
  leanMax: number; // rad
}

/** Per-tick events emitted by the bike step (for VFX, audio, server decisions). */
export interface BikeStepEvents {
  crash: CrashReason | null;
  scrape: number; // intensity 0..1
  scrapeSide: number;
  splash: 0 | 1 | 2;
  landed: number; // landing vertical speed
  launched: boolean;
  obstacleHit: boolean;
}

export function emptyEvents(): BikeStepEvents {
  return { crash: null, scrape: 0, scrapeSide: 0, splash: 0, landed: 0, launched: false, obstacleHit: false };
}

export interface AttackState {
  id: AttackId | null;
  time: number;
  /** -1 left, +1 right */
  side: number;
  hitTargets: number[];
}

export function newAttackState(): AttackState {
  return { id: null, time: 0, side: 1, hitTargets: [] };
}

export interface RiderSimInfo {
  state: RiderState;
  stateTime: number;
}
