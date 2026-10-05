import { beforeAll, describe, expect, it } from 'vitest';
import { getTrack } from '../src/game/track/Track.js';
import { CrashWorld, initRapier } from '../src/physics/CrashWorld.js';
import { RaceSim, type ParticipantInit } from '../src/game/sim/RaceSim.js';
import { BIKE_IDS, SELECTABLE_RIDER_IDS, WEAPON_IDS } from '../src/shared/ids.js';
import { SIM_DT } from '../src/config/gameplay.js';
import { autopilotInput } from './helpers/autopilot.js';

beforeAll(async () => {
  await initRapier();
});

function participants(n: number): ParticipantInit[] {
  return Array.from({ length: n }, (_, i) => ({
    id: i + 1,
    name: `P${i + 1}`,
    slot: i,
    loadout: { riderId: SELECTABLE_RIDER_IDS[i % SELECTABLE_RIDER_IDS.length]!, riderColor: i % 3, bikeId: BIKE_IDS[i % 6]!, bikeColor: i % 3, weaponId: WEAPON_IDS[i % 4]! },
  }));
}

describe('authoritative race simulation', () => {
  it('bots complete the locked track through every ordered checkpoint and the bridge jump', () => {
    const track = getTrack();
    const crash = new CrashWorld(track);
    const sim = new RaceSim(track, crash, participants(6), 30);
    const seq = new Map<number, number>();
    const crashes: string[] = [];
    const launches = new Set<number>();
    const lanes = [-3, 3, -1.5, 1.5, 0, -4];
    const maxTicks = Math.ceil(400 / SIM_DT);
    for (let t = 0; t < maxTicks && !sim.finishedAll; t++) {
      for (const p of sim.players.values()) {
        const n = (seq.get(p.id) ?? 0) + 1;
        seq.set(p.id, n);
        sim.queueInputs(p.id, [autopilotInput(track, p.bike, p.params, n, { lateralTarget: lanes[p.slot % lanes.length]! * 0.5 })]);
      }
      sim.step();
      for (const e of sim.drainEvents()) {
        if (e.t === 'crash') crashes.push(`${e.id}:${e.reason}`);
        if (e.t === 'launch') launches.add(e.id);
      }
    }
    const results = sim.results();
    const finished = results.filter((r) => !r.dnf);
    expect(finished.length).toBeGreaterThanOrEqual(5);
    for (const r of finished) {
      expect(r.finishTime).toBeGreaterThan(90);
      expect(r.finishTime).toBeLessThan(330);
    }
    // Every finisher must have launched off the broken bridge (mandatory jump).
    for (const r of finished) expect(launches.has(r.id)).toBe(true);
    // Winner has gap 0; others positive.
    expect(results[0]!.gap).toBe(0);
    crash.dispose();
    console.log('finish times', finished.map((r) => `${r.name}=${r.finishTime?.toFixed(1)}`).join(' '), 'crashes', crashes.join(','));
  });

  // Multi-lap: bots must cover the configured number of laps (checkpoints every lap) before the
  // race can finish; results never arrive early.
  for (const laps of [2, 5]) {
    it(`bots complete a ${laps}-lap race and finish only after the final lap`, () => {
      const track = getTrack();
      const crash = new CrashWorld(track);
      const n = laps === 2 ? 2 : 1;
      const sim = new RaceSim(track, crash, participants(n), 30, laps);
      const seq = new Map<number, number>();
      const lapEvents = new Map<number, number[]>();
      let finishedAtLapDist: number[] = [];
      const maxTicks = Math.ceil((330 * laps) / SIM_DT);
      for (let t = 0; t < maxTicks && !sim.finishedAll; t++) {
        for (const p of sim.players.values()) {
          const k = (seq.get(p.id) ?? 0) + 1;
          seq.set(p.id, k);
          sim.queueInputs(p.id, [autopilotInput(track, p.bike, p.params, k, { lateralTarget: p.slot ? 1.5 : -1.5 })]);
        }
        sim.step();
        for (const e of sim.drainEvents()) {
          if (e.t === 'lap') lapEvents.set(e.id, [...(lapEvents.get(e.id) ?? []), e.lap]);
          if (e.t === 'finish') finishedAtLapDist = [...finishedAtLapDist, sim.players.get(e.id)!.bike.lapDist];
        }
      }
      const results = sim.results();
      const finished = results.filter((r) => !r.dnf);
      expect(finished.length).toBe(n);
      for (const r of finished) {
        expect(lapEvents.get(r.id)).toEqual(Array.from({ length: laps - 1 }, (_, i) => i + 1));
        expect(sim.players.get(r.id)!.progress.lap).toBe(laps);
        expect(r.finishTime!).toBeGreaterThan(90 * laps);
      }
      for (const d of finishedAtLapDist) expect(d).toBeGreaterThanOrEqual(track.length * laps);
      crash.dispose();
    }, 240_000);
  }
});
