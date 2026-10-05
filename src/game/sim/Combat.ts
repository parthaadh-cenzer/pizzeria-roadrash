// Melee combat timing and hit resolution (HANDOFF/03_GAMEPLAY_CONSTANTS.md "Combat").
// Hits are destabilizing physical impulses; there is no health, ammo or durability.
import { ATTACKS, BIKE_COLLISION, COMBAT } from '../../config/gameplay.js';
import type { AttackId, AttackPhase } from '../../shared/ids.js';
import { clamp } from '../../shared/math.js';
import type { AttackState, BikeParams, BikeState } from './types.js';

/** Active-window offset: the Morning Star ball contact trails the hand by ~120 ms. */
export function activeOffset(id: AttackId): number {
  return id === 'MORNING_STAR' ? COMBAT.morningStarBallLag : 0;
}

export function attackPhaseAt(id: AttackId, t: number): AttackPhase {
  const d = ATTACKS[id];
  if (t < d.windup) return 'WINDUP';
  if (t < d.windup + d.active) return 'ACTIVE';
  if (t < d.total) return 'RECOVERY';
  return 'IDLE';
}

/** True while the attack's contact volume is live (includes weapon-specific lag). */
export function isContactWindow(id: AttackId, t: number): boolean {
  const d = ATTACKS[id];
  const o = activeOffset(id);
  return t >= d.windup + o && t < d.windup + d.active + o;
}

export interface CombatBody {
  index: number;
  bike: BikeState;
  params: BikeParams;
  canBeHit: boolean;
}

export interface TargetInfo {
  index: number;
  side: number;
  forward: number;
  lateral: number;
  gap: number;
}

/** Relative geometry of `other` in attacker space: forward offset, lateral offset (+right). */
export function relativeTo(att: BikeState, other: BikeState): { forward: number; lateral: number; up: number } {
  const fx = Math.sin(att.yaw), fz = Math.cos(att.yaw);
  const dx = other.x - att.x, dz = other.z - att.z;
  return { forward: dx * fx + dz * fz, lateral: dx * -fz + dz * fx, up: other.y - att.y };
}

/**
 * Nearest valid opponent within reach. `side` 0 means either side (used to choose the side at
 * attack start); otherwise only that side is considered.
 */
export function findTarget(attacker: CombatBody, bodies: readonly CombatBody[], reach: number, side: number): TargetInfo | null {
  let best: TargetInfo | null = null;
  for (const b of bodies) {
    if (b.index === attacker.index || !b.canBeHit) continue;
    const r = relativeTo(attacker.bike, b.bike);
    if (Math.abs(r.up) > 2) continue;
    if (Math.abs(r.forward) > COMBAT.longitudinalWindow) continue;
    const s = Math.sign(r.lateral) || 1;
    if (side !== 0 && s !== side) continue;
    const gap = Math.abs(r.lateral) - COMBAT.shoulderOffset - BIKE_COLLISION.radius;
    if (gap > reach) continue;
    const dist = Math.hypot(r.forward, r.lateral);
    if (!best || dist < Math.hypot(best.forward, best.lateral)) best = { index: b.index, side: s, forward: r.forward, lateral: r.lateral, gap };
  }
  return best;
}

export function startAttack(att: AttackState, id: AttackId, attacker: CombatBody, bodies: readonly CombatBody[]): void {
  att.id = id;
  att.time = 0;
  att.hitTargets = [];
  const t = findTarget(attacker, bodies, ATTACKS[id].reach * 1.6, 0);
  // Default side: weapons are right-handed; the kick favours the right leg without a target.
  att.side = t ? t.side : 1;
}

export interface HitResult {
  target: number;
  attack: AttackId;
  lateralImpulse: number;
  yawKick: number;
  instability: number;
  worldPushX: number;
  worldPushZ: number;
}

/** Computes the reaction applied to a target, scaled by relative speed, stability and direction. */
export function computeHit(id: AttackId, attacker: BikeState, target: BikeState, targetParams: BikeParams, side: number, forwardOffset: number): HitResult {
  const d = ATTACKS[id];
  const rel = Math.abs(attacker.speed - target.speed);
  const speedScale = 0.85 + 0.35 * clamp(rel / COMBAT.relativeSpeedRef, 0, 1);
  const dirScale = 1 - 0.4 * clamp(Math.abs(forwardOffset) / COMBAT.longitudinalWindow, 0, 1);
  const k = speedScale * dirScale;
  // Push away from the attacker along the attacker's lateral axis.
  const fx = Math.sin(attacker.yaw), fz = Math.cos(attacker.yaw);
  const pushX = -fz * side, pushZ = fx * side;
  const mag = (d.lateralReaction * k) / targetParams.stability;
  // Target-frame lateral component of the push.
  const tfx = Math.sin(target.yaw), tfz = Math.cos(target.yaw);
  const lateralInTarget = pushX * -tfz + pushZ * tfx;
  return {
    target: -1,
    attack: id,
    lateralImpulse: lateralInTarget * mag,
    yawKick: (d.yawFactor * 0.1 * Math.sign(lateralInTarget || side) * k) / targetParams.stability,
    instability: d.instability * k,
    worldPushX: pushX * mag,
    worldPushZ: pushZ * mag,
  };
}

/** Advances an attack; returns true when finished this tick. */
export function tickAttack(att: AttackState, dt: number): boolean {
  if (!att.id) return false;
  att.time += dt;
  if (att.time >= ATTACKS[att.id].total) {
    att.id = null;
    att.time = 0;
    att.hitTargets = [];
    return true;
  }
  return false;
}
