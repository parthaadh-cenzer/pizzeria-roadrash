// Test-only driving helper: follows the centreline with speed chosen from upcoming curvature.
// Used to prove the locked track is completable end-to-end in the authoritative simulation.
import { maxYawRate } from '../../src/game/sim/BikeController.js';
import type { BikeParams, BikeState, ControlInput } from '../../src/game/sim/types.js';
import type { Track } from '../../src/game/track/Track.js';
import { clamp, wrapAngle } from '../../src/shared/math.js';

export interface AutopilotOptions {
  lateralTarget?: number;
  aggression?: number;
}

export function autopilotInput(track: Track, b: BikeState, p: BikeParams, seq: number, opt: AutopilotOptions = {}): ControlInput {
  const speed = Math.max(0, b.speed);
  const look = 8 + speed * 0.45;
  const target = track.pointAt(b.s + look, opt.lateralTarget ?? 0, 0);
  const desired = Math.atan2(target.x - b.x, target.z - b.z);
  const err = wrapAngle(desired - b.yaw);
  // + err means target is to the left (yaw increases to the left).
  const steer = clamp(-err * 2.4, -1, 1);
  // Speed limit from the tightest curvature in the next stretch.
  let maxK = 0;
  for (let d = 0; d < 40 + speed * 2.2; d += 4) maxK = Math.max(maxK, Math.abs(track.curvature[track.wrapIndex(Math.floor(b.s + d))]!));
  let vLimit = 80;
  if (maxK > 1e-4) {
    // Solve v such that v * k <= yawRate(v) * 0.8
    for (let v = 80; v > 8; v -= 1) {
      if (v * maxK <= maxYawRate(v, p.handling) * 0.78 * (opt.aggression ?? 1)) {
        vLimit = v;
        break;
      }
      vLimit = v;
    }
  }
  const throttle = speed < vLimit - 1 ? 1 : 0;
  const brake = speed > vLimit + 4 ? 1 : 0;
  return { seq, throttle, brake, steer, analog: true, autoAccel: false, kick: false, attack: false, boost: false };
}
