// Authoritative race rules: ordered checkpoints (no shortcuts), secret boost validation/charges,
// controls locked until GO, DNF after the finishing window and after the reconnect grace.
import { beforeAll, describe, expect, it } from 'vitest';
import { getTrack } from '../src/game/track/Track.js';
import { CrashWorld, initRapier } from '../src/physics/CrashWorld.js';
import { RaceSim, type ParticipantInit, type RaceEvent } from '../src/game/sim/RaceSim.js';
import { newProgress, progressScore, updateProgress } from '../src/game/sim/Progress.js';
import { BOOST_CHEAT, NETWORK, RACE, SIM_DT, clampLaps } from '../src/config/gameplay.js';
import type { ControlInput } from '../src/game/sim/types.js';
import { autopilotInput } from './helpers/autopilot.js';

beforeAll(async () => {
  await initRapier();
});

const P = (id: number, slot: number): ParticipantInit => ({
  id, name: `P${id}`, slot,
  loadout: { riderId: 'RIDER_02_SCARLET_PROXY', riderColor: 0, bikeId: 'BIKE_01_SCIFI_MOTORCYCLE', bikeColor: 0, weaponId: 'KATANA' },
});
const idle = (seq: number): ControlInput => ({ seq, throttle: 0, brake: 0, steer: 0, analog: false, autoAccel: false, kick: false, attack: false, boost: false });

describe('ordered checkpoints', () => {
  const track = getTrack();
  const N = track.checkpoints.length;

  it('counts checkpoints strictly in order and only through the gate', () => {
    const ps = newProgress(track, track.grid[0]!.s);
    // A single huge jump across every gate (teleport/shortcut) only ever credits the next one.
    const ev = updateProgress(ps, track, 0, track.length + 5, 0);
    expect(ev.checkpoint).toBe(1);
    expect(ev.finished).toBe(false);
    expect(ps.next).toBe(2);
    // Crossing the next gate far outside its width (cutting across) is rejected.
    const cp2 = track.checkpoints[1]!;
    const out = updateProgress(ps, track, cp2.s - 1, cp2.s + 1, track.checkpointGateHalfWidth(cp2.s) + 6);
    expect(out.wrongGate).toBe(true);
    expect(ps.next).toBe(2);
  });

  it('the finish line only counts after all checkpoints', () => {
    const ps = newProgress(track, track.grid[0]!.s);
    for (let i = 0; i < N - 1; i++) {
      const cp = track.checkpoints[i]!;
      updateProgress(ps, track, cp.s - 0.5, cp.s + 0.5, 0);
    }
    expect(updateProgress(ps, track, track.length - 1, track.length + 1, 0).finished).toBe(false);
    const last = track.checkpoints[N - 1]!;
    expect(updateProgress(ps, track, last.s - 0.5, last.s + 0.5, 0).checkpoint).toBe(last.index);
    expect(updateProgress(ps, track, track.length - 1, track.length + 1, 0).finished).toBe(true);
    expect(ps.finished).toBe(true);
  });
});

describe('multi-lap progress', () => {
  const track = getTrack();
  const N = track.checkpoints.length;
  const L = track.length;
  const passLap = (ps: ReturnType<typeof newProgress>, lap: number) => {
    for (const cp of track.checkpoints) updateProgress(ps, track, lap * L + cp.s - 0.5, lap * L + cp.s + 0.5, 0);
    return updateProgress(ps, track, (lap + 1) * L - 1, (lap + 1) * L + 1, 0);
  };

  it('a 3-lap race needs every checkpoint on every lap and finishes only after the last lap', () => {
    const ps = newProgress(track, track.grid[0]!.s, 3);
    const l1 = passLap(ps, 0);
    expect(l1.lap).toBe(1);
    expect(l1.finished).toBe(false);
    expect(ps.next).toBe(1);
    const l2 = passLap(ps, 1);
    expect(l2.lap).toBe(2);
    const l3 = passLap(ps, 2);
    expect(l3.finished).toBe(true);
    expect(ps.lap).toBe(3);
  });

  it('the line cannot be farmed: recrossing it without the next lap checkpoints does not count', () => {
    const ps = newProgress(track, track.grid[0]!.s, 2);
    passLap(ps, 0);
    expect(ps.lap).toBe(1);
    // Back and forth over the lap-1 line, then over where lap 2's line is, skipping checkpoints.
    for (let k = 0; k < 5; k++) {
      updateProgress(ps, track, L - 2, L + 2, 0);
      updateProgress(ps, track, 2 * L - 1, 2 * L + 1, 0);
    }
    expect(ps.lap).toBe(1);
    expect(ps.finished).toBe(false);
    // Lap-1 checkpoint positions do not count again on lap 2: only lap 2's (shifted by L) do.
    updateProgress(ps, track, track.checkpoints[0]!.s - 0.5, track.checkpoints[0]!.s + 0.5, 0);
    expect(ps.next).toBe(1);
    expect(passLap(ps, 1).finished).toBe(true);
  });

  it('ranking counts laps before checkpoints and distance', () => {
    const a = newProgress(track, track.grid[0]!.s, 3);
    const b = newProgress(track, track.grid[1]!.s, 3);
    passLap(a, 0); // a is on lap 2, checkpoint 1 next
    for (let i = 0; i < N; i++) updateProgress(b, track, track.checkpoints[i]!.s - 0.5, track.checkpoints[i]!.s + 0.5, 0); // b: lap 1, all gates
    expect(progressScore(a, L + 10)).toBeGreaterThan(progressScore(b, L - 10));
  });

  it('the host lap choice is clamped to 1-5', () => {
    expect(clampLaps(0)).toBe(1);
    expect(clampLaps(3)).toBe(3);
    expect(clampLaps(9)).toBe(5);
    expect(clampLaps(2.6)).toBe(3);
    expect(clampLaps('3' as unknown as number)).toBe(1);
    expect(clampLaps(Number.NaN)).toBe(1);
  });
});

describe('secret boost and GO lock', () => {
  it('validates activation, grants exactly 10 charges and consumes one per request', () => {
    const track = getTrack();
    const goTick = 30;
    const sim = new RaceSim(track, new CrashWorld(track), [P(1, 0), P(2, 1)], goTick);
    const start = sim.players.get(1)!.bike.lapDist;
    let seq = 0;
    // Before GO: controls are locked and the cheat cannot be activated.
    for (let t = 0; t < goTick - 1; t++) {
      sim.queueInputs(1, [{ ...idle(++seq), throttle: 1 }]);
      sim.step();
    }
    expect(sim.players.get(1)!.bike.lapDist).toBeCloseTo(start, 6);
    expect(sim.activateCheat(1, BOOST_CHEAT.sequence)).toBe(false);
    sim.step();
    expect(sim.activateCheat(1, 'xyzzy')).toBe(false);
    expect(sim.activateCheat(1, BOOST_CHEAT.sequence)).toBe(true);
    expect(sim.players.get(1)!.boostCharges).toBe(BOOST_CHEAT.charges);
    expect(sim.activateCheat(1, BOOST_CHEAT.sequence)).toBe(false); // no re-grant
    expect(sim.players.get(2)!.boostCharges).toBe(0);
    const events: RaceEvent[] = [];
    // Two boost requests on consecutive ticks: the rate limit lets only the first through.
    sim.queueInputs(1, [{ ...idle(++seq), throttle: 1, boost: true }]);
    sim.step();
    sim.queueInputs(1, [{ ...idle(++seq), throttle: 1, boost: true }]);
    sim.step();
    events.push(...sim.drainEvents());
    expect(sim.players.get(1)!.boostCharges).toBe(BOOST_CHEAT.charges - 1);
    expect(sim.players.get(1)!.bike.boostTime).toBeGreaterThan(0);
    // Non-cheating players cannot boost.
    sim.queueInputs(2, [{ ...idle(1), boost: true }]);
    sim.step();
    expect(sim.players.get(2)!.bike.boostTime).toBe(0);
    // Spend the rest (bike held in place so it cannot run into a barrier); never below zero.
    for (let k = 0; k < 40; k++) {
      for (let w = 0; w < Math.ceil(BOOST_CHEAT.minInterval / SIM_DT) + 1; w++) {
        sim.players.get(1)!.bike.speed = 0;
        sim.queueInputs(1, [{ ...idle(++seq), boost: w === 0 }]);
        sim.step();
      }
    }
    expect(sim.players.get(1)!.state).not.toBe('RAGDOLL');
    events.push(...sim.drainEvents());
    expect(sim.players.get(1)!.boostCharges).toBe(0);
    expect(events.filter((e) => e.t === 'boost' && e.id === 1)).toHaveLength(BOOST_CHEAT.charges);
  });
});

describe('DNF rules', () => {
  it('a racer who leaves is DNF immediately and never ranked ahead of finishers', () => {
    const track = getTrack();
    const sim = new RaceSim(track, new CrashWorld(track), [P(1, 0), P(2, 1)], 1);
    sim.step();
    sim.retire(2);
    sim.retire(2);
    const ev = sim.drainEvents().filter((e) => e.t === 'dnf');
    expect(ev).toEqual([{ t: 'dnf', id: 2 }]);
    expect(sim.players.get(2)!.connected).toBe(false);
    expect(sim.results().find((e) => e.id === 2)).toMatchObject({ dnf: true, finishTime: null });
  });

  it('racers still out after the finishing window, and disconnected racers past the grace, are DNF', () => {
    const track = getTrack();
    const sim = new RaceSim(track, new CrashWorld(track), [P(1, 0), P(2, 1), P(3, 2)], 1);
    sim.setConnected(3, false);
    const seq = new Map<number, number>();
    const events: RaceEvent[] = [];
    const limit = Math.ceil((600 + RACE.finishingWindow) / SIM_DT);
    let dnf3Tick = -1;
    for (let t = 0; t < limit && !sim.finishedAll; t++) {
      const p1 = sim.players.get(1)!;
      const n = (seq.get(1) ?? 0) + 1;
      seq.set(1, n);
      sim.queueInputs(1, [autopilotInput(track, p1.bike, p1.params, n)]);
      sim.queueInputs(2, [idle(t + 1)]); // P2 connected but parked
      sim.step();
      for (const e of sim.drainEvents()) {
        events.push(e);
        if (e.t === 'dnf' && e.id === 3) dnf3Tick = sim.tick;
      }
    }
    expect(sim.finishedAll).toBe(true);
    // Disconnect grace -> DNF.
    expect(dnf3Tick).toBeGreaterThan(0);
    expect(dnf3Tick * SIM_DT).toBeGreaterThanOrEqual(NETWORK.reconnectGrace);
    expect(dnf3Tick * SIM_DT).toBeLessThan(NETWORK.reconnectGrace + 1);
    // Finishing window after the first finisher -> DNF for the parked racer.
    const fin = events.find((e) => e.t === 'finish' && e.id === 1);
    expect(fin).toBeDefined();
    expect(events.some((e) => e.t === 'dnf' && e.id === 2)).toBe(true);
    expect((sim.tick - sim.firstFinishTick!) * SIM_DT).toBeGreaterThan(RACE.finishingWindow);
    const r = sim.results();
    expect(r.map((e) => [e.id, e.dnf])).toEqual([[1, false], [2, true], [3, true]]);
    expect(r[0]!.position).toBe(1);
    expect(r[0]!.gap).toBe(0);
    expect(r[1]!.finishTime).toBeNull();
  });
});
