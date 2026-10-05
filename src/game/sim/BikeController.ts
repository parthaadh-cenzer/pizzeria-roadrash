// Arcade bike controller with physical collisions against the generated track.
// Shared by the authoritative server and client-side prediction; must stay deterministic.
import { BIKE_BALANCE, BIKE_COLLISION, BOOST_CHEAT, BRIDGE_JUMP, LARGE_PUDDLE, MOBILE_ASSIST, SPEED, STEERING, WORLD_CRASH } from '../../config/gameplay.js';
import { ROAD_PROFILE } from '../../config/track.js';
import type { BikeId } from '../../shared/ids.js';
import { DEG2RAD, approach, clamp, damp, lerp, smoothstep, wrapAngle } from '../../shared/math.js';
import type { Track } from '../track/Track.js';
import type { BikeParams, BikeState, BikeStepEvents, ControlInput } from './types.js';

const G = 9.81;
const BARRIER_COLLISION_HEIGHT = 2.4;
const WOBBLE_HZ = 5.2;
const INSTABILITY_TAU = 0.8 / 3; // ~95% decay in 0.8 s

export function bikeParamsFor(bikeId: BikeId): BikeParams {
  const b = BIKE_BALANCE[bikeId];
  return { bikeId, accel: b.accel, handling: b.handling, stability: b.stability, leanMax: b.leanTargetDeg * DEG2RAD };
}

export function createBikeState(track: Track, s: number, lateral: number, lapDist: number): BikeState {
  const p = track.pointAt(s, lateral, 0);
  return {
    x: p.x,
    y: p.y,
    z: p.z,
    yaw: track.headingAt(s),
    vx: 0,
    vy: 0,
    vz: 0,
    speed: 0,
    steer: 0,
    lean: 0,
    pitch: 0,
    s: track.wrapS(s),
    lateral,
    lapDist,
    airborne: false,
    airTime: 0,
    instability: 0,
    wobblePhase: 0,
    puddleSteerTimer: 0,
    puddle: 0,
    boostTime: 0,
    assistTime: 0,
    assistOn: false,
    rollOverTime: 0,
    compression: 0,
    hitDir: 0,
  };
}

export function cloneBikeState(b: BikeState): BikeState {
  return { ...b };
}

/** Maximum yaw rate (rad/s) for a given forward speed, before steering scaling. */
export function maxYawRate(speed: number, handling: number): number {
  const t = smoothstep(STEERING.lowSpeedRef, SPEED.physicsMax, Math.abs(speed));
  return lerp(STEERING.lowSpeedMaxYawRate, STEERING.maxSpeedBaseYawRate * handling, t);
}

/** Throttle acceleration envelope: tapers so every bike shares the same top speed. */
export function throttleAccel(accel: number, speed: number): number {
  const u = clamp(speed / SPEED.physicsMax, 0, 1);
  return accel * Math.max(0, 1 - 0.75 * u * u);
}

/**
 * Advances one bike by `dt`. `controls` false locks throttle/steer (grid, finished, disconnected).
 * Crash decisions are reported through `ev.crash`; the caller transitions the rider state.
 */
export function stepBike(
  st: BikeState,
  inp: ControlInput,
  p: BikeParams,
  track: Track,
  dt: number,
  controls: boolean,
  ev: BikeStepEvents,
  autopilotBrake = 0,
): void {
  // ------------------------------------------------------------ steering input
  const steerTarget = controls ? clamp(inp.steer, -1, 1) : 0;
  if (inp.analog && controls) {
    st.steer = damp(st.steer, steerTarget, 0.04, dt);
  } else if (steerTarget !== 0) {
    const reversing = st.steer !== 0 && Math.sign(st.steer) !== Math.sign(steerTarget);
    st.steer = approach(st.steer, steerTarget, dt / (reversing ? STEERING.keyboardRelease : STEERING.keyboardRampToFull));
  } else {
    st.steer = approach(st.steer, 0, dt / STEERING.keyboardRelease);
  }

  // ------------------------------------------------------------ grip & puddles
  const puddle = st.airborne ? null : track.puddleAt(st.s, st.lateral);
  const puddleKind = puddle ? (puddle.size === 'LARGE' ? 2 : 1) : 0;
  const fx0 = Math.sin(st.yaw), fz0 = Math.cos(st.yaw);
  let vf = st.vx * fx0 + st.vz * fz0;
  let vl = st.vx * -fz0 + st.vz * fx0;
  if (puddleKind !== st.puddle) {
    if (puddleKind === 2 && puddle) {
      // Faster entries into bigger pools bite harder (still small and controllable).
      const k = clamp(Math.abs(vf) / LARGE_PUDDLE.refSpeed, 0.35, 1.25) * clamp(((puddle.s1 - puddle.s0) * puddle.halfWidth * 2) / LARGE_PUDDLE.refArea, 0.6, 1.3);
      vf *= 1 - LARGE_PUDDLE.immediateSpeedLoss * k;
      st.puddleSteerTimer = LARGE_PUDDLE.steeringScaleDuration * clamp(k, 0.5, 1.3);
      ev.splash = 2;
    } else if (puddleKind === 1) ev.splash = 1;
    st.puddle = puddleKind;
  }
  st.puddleSteerTimer = Math.max(0, st.puddleSteerTimer - dt);
  const grip = track.gripAt(st.s, st.lateral);

  // ------------------------------------------------------------ longitudinal
  let throttle = controls ? (inp.autoAccel ? 1 : clamp(inp.throttle, 0, 1)) : 0;
  let brake = controls ? (inp.autoAccel ? 0 : clamp(inp.brake, 0, 1)) : autopilotBrake;
  let assistDecel = 0;
  if (controls && inp.autoAccel) {
    const a = Math.abs(st.steer);
    if (a > MOBILE_ASSIST.strongSteer) st.assistTime += dt;
    else if (a < MOBILE_ASSIST.releaseSteer) {
      st.assistTime = 0;
      st.assistOn = false;
    }
    if (st.assistTime >= MOBILE_ASSIST.sustainTime) st.assistOn = true;
    if (st.assistOn) {
      throttle *= MOBILE_ASSIST.throttleScale;
      if (vf > 5) assistDecel = MOBILE_ASSIST.engineBrake;
    }
  } else {
    st.assistOn = false;
    st.assistTime = 0;
  }

  let acc = 0;
  if (!st.airborne) {
    if (throttle > 0 && vf >= -0.5) acc += throttleAccel(p.accel, vf) * throttle;
    if (st.boostTime > 0 && vf >= 0) acc += BOOST_CHEAT.acceleration;
    if (throttle <= 0.01) acc -= Math.sign(vf) * (SPEED.coastDrag + SPEED.aeroDragK * vf * vf);
    if (brake > 0) {
      if (vf > 0.5) acc -= SPEED.maxBraking * brake;
      else if (!inp.autoAccel && controls) acc -= 6 * brake;
    }
    acc -= assistDecel;
    // Gravity along the road slope in the direction of travel.
    const f = track.frameAt(st.s);
    const along = fx0 * f.tx + fz0 * f.tz;
    acc -= G * f.ty * Math.sign(along);
  }
  st.boostTime = Math.max(0, st.boostTime - dt);
  vf += acc * dt;
  if (throttle <= 0.01 && brake <= 0.01 && Math.abs(vf) < 0.25 && st.boostTime <= 0) vf = 0;
  vf = clamp(vf, -SPEED.reverseCap, SPEED.physicsMax);

  // ------------------------------------------------------------ yaw
  const speedAbs = Math.abs(vf);
  const lowSpeed = clamp(speedAbs / 3, 0, 1);
  const gripSteer = 0.55 + 0.45 * grip;
  const puddleScale = st.puddleSteerTimer > 0 ? LARGE_PUDDLE.steeringScale : 1;
  const dir = vf >= 0 ? 1 : -1;
  let steerYawRate = -st.steer * maxYawRate(vf, p.handling) * lowSpeed * gripSteer * puddleScale * dir;
  if (st.airborne) steerYawRate *= 0.12;
  st.wobblePhase += dt * Math.PI * 2 * WOBBLE_HZ;
  if (st.wobblePhase > Math.PI * 2000) st.wobblePhase -= Math.PI * 2000;
  const wobbleYaw = st.instability * Math.sin(st.wobblePhase) * 0.9 / p.stability;
  st.yaw = wrapAngle(st.yaw + (steerYawRate + wobbleYaw) * dt);

  // ------------------------------------------------------------ lateral grip
  if (!st.airborne) vl *= Math.exp(-STEERING.lateralGripRate * grip * dt);
  const fx = Math.sin(st.yaw), fz = Math.cos(st.yaw);
  st.vx = fx * vf - fz * vl;
  st.vz = fz * vf + fx * vl;
  st.instability *= Math.exp(-dt / INSTABILITY_TAU);
  if (st.instability < 1e-4) st.instability = 0;

  // ------------------------------------------------------------ integrate & project
  const prevS = st.s;
  st.x += st.vx * dt;
  st.z += st.vz * dt;
  if (st.airborne) st.y += st.vy * dt;
  const proj = track.project(st.x, st.y, st.z, st.s);
  const ds = track.deltaS(prevS, proj.s);
  st.lapDist += ds;
  st.s = proj.s;
  st.lateral = proj.lateral;

  // ------------------------------------------------------------ barriers (physical edge objects)
  const R = BIKE_COLLISION.radius;
  const barrier = track.barrierOffsetAt(st.s);
  const heightAbove = st.airborne ? proj.height : 0;
  const inGapNow = track.isInGap(st.s);
  if (!inGapNow && heightAbove < BARRIER_COLLISION_HEIGHT && Math.abs(st.lateral) + R > barrier) {
    const f = track.frameAt(st.s);
    const side = Math.sign(st.lateral);
    const pen = Math.abs(st.lateral) + R - barrier;
    // Inward normal (horizontal).
    const nx = -f.rx * side, nz = -f.rz * side;
    st.x += nx * pen;
    st.z += nz * pen;
    st.lateral -= side * pen;
    const vn = st.vx * nx + st.vz * nz; // < 0 when moving into the barrier
    if (vn < 0) {
      const tvx = st.vx - vn * nx, tvz = st.vz - vn * nz;
      const tangential = Math.hypot(tvx, tvz);
      const normalSpeed = -vn;
      const angle = Math.atan2(normalSpeed, tangential) / DEG2RAD;
      ev.scrapeSide = side;
      if (angle > WORLD_CRASH.crashAngleDeg && normalSpeed > WORLD_CRASH.meaningfulSpeed) {
        ev.crash = 'barrier';
      } else if (angle < WORLD_CRASH.glancingAngleDeg) {
        const loss = 1 - WORLD_CRASH.scrapeSpeedLoss * (0.4 + (0.6 * angle) / WORLD_CRASH.glancingAngleDeg);
        st.vx = tvx * loss;
        st.vz = tvz * loss;
        ev.scrape = clamp(normalSpeed / 6 + 0.2, 0, 1);
        st.instability += 0.06 / p.stability;
      } else {
        st.vx = tvx * 0.82 - vn * nx * 0.25;
        st.vz = tvz * 0.82 - vn * nz * 0.25;
        ev.scrape = 1;
        st.instability += (0.35 + normalSpeed * 0.03) / p.stability;
        st.hitDir = -side;
      }
    }
  }

  // ------------------------------------------------------------ obstacles (bridge debris etc.)
  const obs = track.obstacleAt(st.s, st.lateral, R);
  if (obs && (!st.airborne || heightAbove < obs.height)) {
    const fwd = st.vx * fx + st.vz * fz;
    ev.obstacleHit = true;
    if (fwd > WORLD_CRASH.frontalCrashRelativeSpeed) ev.crash = 'obstacle';
    else {
      // Push out laterally toward the road centre and bleed speed.
      const f = track.frameAt(st.s);
      const toCentre = obs.lat0 + obs.lat1 > 0 ? -1 : 1;
      const edge = toCentre < 0 ? obs.lat0 - R - 0.05 : obs.lat1 + R + 0.05;
      const shift = edge - st.lateral;
      st.x += f.rx * shift;
      st.z += f.rz * shift;
      st.lateral = edge;
      st.vx *= 0.55;
      st.vz *= 0.55;
      st.instability += 0.5 / p.stability;
      ev.scrape = 1;
    }
  }

  // ------------------------------------------------------------ vertical: road, jump, landing, falls
  const frame = track.frameAt(st.s);
  const roadY = frame.py + track.surfaceOffsetAt(st.s);
  const lip = track.bridge.lip;
  if (!st.airborne) {
    const crossedLip = ds > 0 && track.deltaS(prevS, lip) > 0 && track.deltaS(st.s, lip) <= 0;
    if (crossedLip) {
      st.airborne = true;
      st.airTime = 0;
      st.vy = BRIDGE_JUMP.launchVerticalSpeed;
      st.y = frame.py + track.surfaceOffsetAt(lip - 0.01);
      ev.launched = true;
    } else if (inGapNow) {
      st.airborne = true;
      st.airTime = 0;
      st.vy = 0;
    } else {
      const newVy = (roadY - st.y) / dt;
      st.y = roadY;
      st.vy = clamp(newVy, -20, 20);
    }
  }
  if (st.airborne) {
    st.vy -= G * dt;
    st.airTime += dt;
    const wasInGap = track.isInGap(prevS);
    if (wasInGap && !inGapNow && st.y < roadY - 0.35) {
      // Fell short: struck the landing deck edge face. Never auto-saved.
      ev.crash = 'fell';
    } else if (!inGapNow && st.y <= roadY + 0.02) {
      const landingSpeed = -st.vy;
      const travelYaw = Math.atan2(st.vx, st.vz);
      const badAngle = Math.abs(wrapAngle(travelYaw - track.headingAt(st.s))) / DEG2RAD;
      const hardPitch = Math.abs(st.pitch) / DEG2RAD;
      if (landingSpeed > WORLD_CRASH.hardLandingVerticalSpeed) ev.crash = 'landing';
      else if (st.airTime > 0.08 && badAngle > BRIDGE_JUMP.badLateralAngleDeg && Math.hypot(st.vx, st.vz) > 6) ev.crash = 'landing';
      else if (hardPitch > WORLD_CRASH.hardLandingAngleDeg) ev.crash = 'landing';
      st.airborne = false;
      st.y = roadY;
      st.vy = 0;
      st.compression = clamp(landingSpeed / 6, 0, 1);
      ev.landed = landingSpeed;
      st.airTime = 0;
    } else if (st.y < roadY - 2.5) {
      ev.crash = track.isOverWater(st.x, st.z) ? 'water' : 'fell';
    }
  }
  // Road pitch (visual) with gentle road-normal landing assist.
  // In the air the bike's nose follows the flight arc (up off the lip, dipping toward landing).
  const pitchTarget = st.airborne ? -Math.atan2(st.vy, Math.max(1, Math.hypot(st.vx, st.vz))) * 0.7 : -Math.asin(clamp(frame.ty * Math.sign(fx * frame.tx + fz * frame.tz || 1), -1, 1));
  st.pitch = damp(st.pitch, pitchTarget, st.airborne ? 0.6 : 1 / BRIDGE_JUMP.landingAssistRate, dt);
  st.compression = damp(st.compression, 0, 0.18, dt);

  // Containment fallback: anything that escaped the physical barriers is off-world.
  if (!ev.crash && Math.abs(st.lateral) > barrier + ROAD_PROFILE.barrierThickness + 1.5 && !inGapNow) ev.crash = 'offworld';

  // ------------------------------------------------------------ lean
  const centripetal = -vf * steerYawRate; // + => lean right
  const leanTarget = clamp(Math.atan2(centripetal, G), -p.leanMax, p.leanMax);
  const wobbleLean = st.instability * Math.sin(st.wobblePhase * 0.9 + 0.7) * (30 * DEG2RAD) / p.stability;
  st.lean = damp(st.lean, leanTarget + wobbleLean, STEERING.visualLeanLag, dt);
  if (Math.abs(st.lean) > WORLD_CRASH.rollCrashDeg * DEG2RAD) {
    st.rollOverTime += dt;
    if (st.rollOverTime >= WORLD_CRASH.rollCrashTime && !ev.crash) ev.crash = 'roll';
  } else st.rollOverTime = 0;

  st.speed = st.vx * fx + st.vz * fz;
}

/** Applies a lateral impulse (m/s, + = to the bike's right) and instability from a hit or bump. */
export function applyBikeImpulse(st: BikeState, p: BikeParams, lateral: number, yawKick: number, instability: number): void {
  const fx = Math.sin(st.yaw), fz = Math.cos(st.yaw);
  // right vector = (-fz, fx)
  st.vx += -fz * lateral;
  st.vz += fx * lateral;
  st.yaw = wrapAngle(st.yaw + yawKick);
  st.instability += instability / p.stability;
  st.hitDir = Math.sign(lateral);
}
