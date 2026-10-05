// Local-player prediction + server reconciliation (IMPLEMENTATION_CONTRACT §9). The same
// deterministic bike step runs here as on the host; server state is authoritative and unacked
// inputs are replayed on top of it. Corrections > 2.5 m snap with short visual smoothing.
import * as THREE from 'three';
import { BOOST_CHEAT, NETWORK, SIM_DT } from '../config/gameplay.js';
import { bikeParamsFor, cloneBikeState, stepBike } from '../game/sim/BikeController.js';
import { emptyEvents, type BikeParams, type BikeState, type BikeStepEvents, type ControlInput } from '../game/sim/types.js';
import type { Track } from '../game/track/Track.js';
import type { BikeId } from '../shared/ids.js';
import type { OwnStateMsg } from '../shared/protocol.js';

interface Pending {
  input: ControlInput;
  controls: boolean;
}

export class Prediction {
  state: BikeState | null = null;
  readonly params: BikeParams;
  private pending: Pending[] = [];
  private track: Track;
  /** Visual offset (render = sim + offset) decays after corrections. */
  readonly offset = new THREE.Vector3();
  private offsetTau: number = NETWORK.correctionSmoothing;
  boostCharges = 0;
  cheatActive = false;
  private lastBoostAt = -10;
  private simTime = 0;
  lastCorrection = 0;
  active = false;

  constructor(bikeId: BikeId, track: Track) {
    this.params = bikeParamsFor(bikeId);
    this.track = track;
  }

  /** Runs one predicted tick with a freshly sampled input. */
  step(input: ControlInput, controls: boolean): BikeStepEvents {
    const ev = emptyEvents();
    this.pending.push({ input, controls });
    if (this.pending.length > 240) this.pending.shift();
    if (!this.state || !this.active) return ev;
    this.simTime += SIM_DT;
    if (controls && input.boost && this.boostCharges > 0 && this.simTime - this.lastBoostAt >= BOOST_CHEAT.minInterval) {
      this.boostCharges--;
      this.lastBoostAt = this.simTime;
      this.state.boostTime = BOOST_CHEAT.chargeDuration;
    }
    stepBike(this.state, input, this.params, this.track, SIM_DT, controls, ev);
    return ev;
  }

  /** Applies the host's authoritative state for this player and replays unacked inputs. */
  reconcile(own: OwnStateMsg, riding: boolean): void {
    this.boostCharges = own.boostCharges;
    this.cheatActive = own.cheatActive;
    this.pending = this.pending.filter((p) => p.input.seq > own.lastSeq);
    if (!riding) {
      // Crash/recovery states are presented from host snapshots; prediction resumes on RIDING.
      this.active = false;
      this.state = cloneBikeState(own.bike);
      this.offset.set(0, 0, 0);
      return;
    }
    const before = this.state ? new THREE.Vector3(this.state.x, this.state.y, this.state.z) : null;
    const s = cloneBikeState(own.bike);
    for (const p of this.pending) stepBike(s, p.input, this.params, this.track, SIM_DT, p.controls, emptyEvents());
    if (before && this.active) {
      const err = before.clone().sub(new THREE.Vector3(s.x, s.y, s.z));
      const mag = err.length();
      this.lastCorrection = mag;
      if (mag > NETWORK.snapCorrectionDistance) {
        // Snap to authority with a very short visual ease.
        this.offset.copy(err).clampLength(0, 1.2);
        this.offsetTau = 0.07;
      } else if (mag > 0.002) {
        this.offset.add(err);
        this.offsetTau = NETWORK.correctionSmoothing;
      }
    }
    this.state = s;
    this.active = true;
  }

  decayOffset(dt: number): void {
    this.offset.multiplyScalar(Math.exp(-dt / this.offsetTau));
    if (this.offset.lengthSq() < 1e-6) this.offset.set(0, 0, 0);
  }

  /** Inputs not yet acknowledged, oldest first (resent for robustness). */
  unacked(max: number): ControlInput[] {
    return this.pending.slice(-max).map((p) => p.input);
  }
}
