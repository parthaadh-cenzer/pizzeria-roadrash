// Acceptance-level gameplay features in the authoritative simulation: shared top speed, every
// weapon and the kick land hits, puddle splash/grip, regional rain and the tunnel transition,
// and the broken-bridge fall -> safe recovery.
import { beforeAll, describe, expect, it } from 'vitest';
import { getTrack } from '../src/game/track/Track.js';
import { STRUCTURE } from '../src/game/track/Track.js';
import { CrashWorld, initRapier } from '../src/physics/CrashWorld.js';
import { RaceSim, type ParticipantInit, type RaceEvent } from '../src/game/sim/RaceSim.js';
import { bikeParamsFor, createBikeState, stepBike } from '../src/game/sim/BikeController.js';
import { SPEED, WET_GRIP } from '../src/config/gameplay.js';
import { BIKE_IDS, WEAPON_IDS, type AttackId, type BikeId, type WeaponId } from '../src/shared/ids.js';
import type { BikeState, BikeStepEvents, ControlInput } from '../src/game/sim/types.js';
import { autopilotInput } from './helpers/autopilot.js';

beforeAll(async () => {
  await initRapier();
});

const track = getTrack();
const P = (id: number, slot: number, bikeId: BikeId = 'BIKE_01_SCIFI_MOTORCYCLE', weaponId: WeaponId = 'KATANA'): ParticipantInit => ({
  id, name: `P${id}`, slot, loadout: { riderId: 'RIDER_02_SCARLET_PROXY', riderColor: 0, bikeId, bikeColor: 0, weaponId },
});
const input = (seq: number, over: Partial<ControlInput> = {}): ControlInput => ({ seq, throttle: 0, brake: 0, steer: 0, analog: false, autoAccel: false, kick: false, attack: false, boost: false, ...over });
/** Speed lives in the velocity vector; `speed` is derived from it each step. */
function setSpeed(b: BikeState, v: number): void {
  b.speed = v;
  b.vx = Math.sin(b.yaw) * v;
  b.vz = Math.cos(b.yaw) * v;
}
const noEvents = (): BikeStepEvents => ({ crash: null, scrape: 0, scrapeSide: 0, splash: 0, landed: 0, launched: false, obstacleHit: false }) as BikeStepEvents;

describe('bikes', () => {
  it('all six bikes reach the same top speed', () => {
    const tops: Record<string, number> = {};
    for (const bikeId of BIKE_IDS) {
      const sim = new RaceSim(track, new CrashWorld(track), [P(1, 0, bikeId)], 1);
      let top = 0;
      for (let t = 1; t < 60 * 45; t++) {
        const p = sim.players.get(1)!;
        sim.queueInputs(1, [autopilotInput(track, p.bike, p.params, t)]);
        sim.step();
        top = Math.max(top, p.bike.speed);
      }
      tops[bikeId] = top;
    }
    const values = Object.values(tops);
    for (const v of values) {
      expect(v).toBeGreaterThan(SPEED.physicsMax * 0.97);
      expect(v).toBeLessThanOrEqual(SPEED.physicsMax + 0.5);
    }
    expect(Math.max(...values) - Math.min(...values)).toBeLessThan(1.5);
  }, 120_000);

  it('mobile auto-acceleration drives the bike with no throttle input', () => {
    const params = bikeParamsFor('BIKE_02_AKIRA_CRUISER');
    const s = 60;
    const manual = createBikeState(track, s, 0, s), auto = createBikeState(track, s, 0, s);
    for (let t = 0; t < 180; t++) {
      stepBike(manual, input(t + 1), params, track, 1 / 60, true, noEvents(), 0);
      stepBike(auto, input(t + 1, { autoAccel: true, analog: true }), params, track, 1 / 60, true, noEvents(), 0);
    }
    expect(manual.speed).toBeLessThan(0.5);
    expect(auto.speed).toBeGreaterThan(15);
  });
});

describe('combat', () => {
  const attacks: AttackId[] = ['KICK', ...WEAPON_IDS];
  for (const atk of attacks) {
    it(`${atk} lands a hit on a rider alongside`, () => {
      const weapon: WeaponId = atk === 'KICK' ? 'KATANA' : (atk as WeaponId);
      const sim = new RaceSim(track, new CrashWorld(track), [P(1, 0, 'BIKE_01_SCIFI_MOTORCYCLE', weapon), P(2, 1)], 1);
      sim.step();
      const s = 60;
      const a = sim.players.get(1)!, b = sim.players.get(2)!;
      // 1.3 m apart: inside every attack's reach, outside bike-vs-bike contact.
      a.bike = createBikeState(track, s, -0.65, s);
      b.bike = createBikeState(track, s, 0.65, s);
      setSpeed(a.bike, 30);
      setSpeed(b.bike, 30);
      const events: RaceEvent[] = [];
      for (let t = 0; t < 90; t++) {
        sim.queueInputs(1, [input(t + 10, { throttle: 0.4, attack: atk !== 'KICK' && t === 2, kick: atk === 'KICK' && t === 2 })]);
        sim.queueInputs(2, [input(t + 10, { throttle: 0.4 })]);
        sim.step();
        events.push(...sim.drainEvents());
      }
      expect(events.some((e) => e.t === 'swing' && e.a === 1 && e.atk === atk)).toBe(true);
      expect(events.some((e) => e.t === 'hit' && e.a === 1 && e.b === 2 && e.atk === atk)).toBe(true);
      expect(sim.players.get(2)!.bike.instability).toBeGreaterThanOrEqual(0);
    });
  }

  it('misses when nobody is within reach', () => {
    const sim = new RaceSim(track, new CrashWorld(track), [P(1, 0, 'BIKE_01_SCIFI_MOTORCYCLE', 'MACHETE'), P(2, 1)], 1);
    sim.step();
    const a = sim.players.get(1)!, b = sim.players.get(2)!;
    a.bike = createBikeState(track, 60, -4, 60);
    b.bike = createBikeState(track, 60, 4, 60);
    const events: RaceEvent[] = [];
    for (let t = 0; t < 60; t++) {
      sim.queueInputs(1, [input(t + 10, { attack: t === 2 })]);
      sim.step();
      events.push(...sim.drainEvents());
    }
    expect(events.some((e) => e.t === 'hit')).toBe(false);
  });
});

describe('surface and weather', () => {
  it('large puddles splash, cut grip and briefly scale steering', () => {
    const puddle = track.puddles.find((p) => p.size === 'LARGE')!;
    expect(puddle).toBeDefined();
    const params = bikeParamsFor('BIKE_01_SCIFI_MOTORCYCLE');
    const b = createBikeState(track, puddle.s0 - 12, puddle.lateral, puddle.s0 - 12);
    setSpeed(b, 35);
    let splash = 0, steerTimer = 0;
    for (let t = 0; t < 60 && !splash; t++) {
      const ev = noEvents();
      stepBike(b, input(t + 1, { throttle: 0.5 }), params, track, 1 / 60, true, ev, 0);
      splash = ev.splash;
      steerTimer = b.puddleSteerTimer;
    }
    expect(splash).toBe(2);
    expect(steerTimer).toBeGreaterThan(0);
    const inside = track.gripAt((puddle.s0 + puddle.s1) / 2, puddle.lateral);
    expect(inside).toBe(WET_GRIP.LARGE_PUDDLE);
    expect(inside).toBeLessThan(track.gripAt(puddle.s0 - 30, puddle.lateral + 6));
  });

  it('rain intensity varies by region and the tunnel shelters it with a smooth transition', () => {
    const w: number[] = [];
    for (let s = 0; s < track.length; s += 10) w.push(track.weatherAt(s));
    expect(Math.min(...w)).toBeLessThan(1);
    expect(Math.max(...w)).toBeGreaterThan(2.2);
    const levels = new Set<string>();
    for (let s = 0; s < track.length; s += 10) levels.add(track.weatherLevelAt(s));
    expect(levels.size).toBeGreaterThanOrEqual(3);
    let tunnelS = -1;
    for (let s = 0; s < track.length; s += 2) if (track.structureAt(s) === STRUCTURE.TUNNEL) { tunnelS = s; break; }
    expect(tunnelS).toBeGreaterThan(0);
    let tunnelEnd = tunnelS;
    while (track.structureAt(tunnelEnd) === STRUCTURE.TUNNEL) tunnelEnd += 2;
    const mid = (tunnelS + tunnelEnd) / 2;
    expect(track.rainFactorAt(mid)).toBeLessThan(0.05);
    expect(track.rainFactorAt(tunnelS - 60)).toBeGreaterThan(0.9);
    // No hard cut at the portal: the factor ramps across several metres.
    const steps: number[] = [];
    for (let s = tunnelS - 30; s < tunnelS + 30; s += 1) steps.push(Math.abs(track.rainFactorAt(s + 1) - track.rainFactorAt(s)));
    expect(Math.max(...steps)).toBeLessThan(0.34);
  });
});

describe('crash recovery', () => {
  it('a barrier crash runs ragdoll -> settle -> get up -> run to bike -> lift -> remount without penalty', () => {
    const sim = new RaceSim(track, new CrashWorld(track), [P(1, 0)], 1);
    sim.step();
    const p = sim.players.get(1)!;
    const s0 = 400;
    p.bike = createBikeState(track, s0, 0, s0);
    setSpeed(p.bike, 45);
    const order: string[] = [];
    const events: RaceEvent[] = [];
    for (let t = 0; t < 60 * 40; t++) {
      const riding = p.state === 'RIDING' || p.state === 'DESTABILIZED';
      // Steer hard into the barrier until the crash, then leave the rider to recover.
      sim.queueInputs(1, [input(t + 10, riding && !events.some((e) => e.t === 'crash') ? { throttle: 1, steer: 1, analog: true } : {})]);
      sim.step();
      if (order[order.length - 1] !== p.state) order.push(p.state);
      events.push(...sim.drainEvents());
      if (events.some((e) => e.t === 'recovered')) break;
    }
    const chain = ['RAGDOLL', 'SETTLING', 'GETTING_UP', 'RUNNING_TO_BIKE', 'LIFTING', 'REMOUNTING', 'RIDING'];
    const from = order.indexOf('RAGDOLL');
    expect(from).toBeGreaterThanOrEqual(0);
    expect(order.slice(from)).toEqual(chain);
    const rec = events.find((e) => e.t === 'recovered') as { t: 'recovered'; penalty: boolean };
    expect(rec.penalty).toBe(false);
  }, 60_000);
});

describe('broken bridge', () => {
  it('a rider too slow for the gap falls, and is recovered at a safe point with the penalty', () => {
    const sim = new RaceSim(track, new CrashWorld(track), [P(1, 0)], 1);
    sim.step();
    const p = sim.players.get(1)!;
    const s0 = track.bridge.lip - 40;
    const lap = track.deltaS(0, s0) >= 0 ? track.deltaS(0, s0) : track.deltaS(0, s0) + track.length;
    p.bike = createBikeState(track, s0, 0, lap);
    setSpeed(p.bike, 14);
    const events: RaceEvent[] = [];
    const states = new Set<string>();
    for (let t = 0; t < 60 * 40; t++) {
      const riding = p.state === 'RIDING' || p.state === 'DESTABILIZED';
      sim.queueInputs(1, [riding ? autopilotInput(track, p.bike, p.params, t + 10, { aggression: 1 }) : input(t + 10)]);
      if (riding && p.bike.s < track.bridge.gapEnd && p.bike.s > track.bridge.rampStart - 50 && p.bike.speed > 14) setSpeed(p.bike, 14);
      sim.step();
      states.add(p.state);
      events.push(...sim.drainEvents());
      if (events.some((e) => e.t === 'recovered')) break;
    }
    const crash = events.find((e) => e.t === 'crash');
    const rec = events.find((e) => e.t === 'recovered') as { t: 'recovered'; penalty: boolean } | undefined;
    expect(crash).toBeDefined();
    expect(rec).toBeDefined();
    expect(rec!.penalty).toBe(true);
    expect(states.has('RECOVERY_PENALTY')).toBe(true);
    // Recovered on the road before the gap, riding again.
    expect(p.bike.s).toBeLessThan(track.bridge.lip);
    expect(['RIDING', 'DESTABILIZED']).toContain(p.state);
  }, 60_000);
});

describe('racing roster', () => {
  it('offers exactly Scarlet Proxy, Cyberpunk Mohawk and Cyberpunk Enforcer', async () => {
    const { SELECTABLE_RIDER_IDS, DEFAULT_RIDER_ID, isSelectableRiderId, RIDER_IDS } = await import('../src/shared/ids.js');
    expect([...SELECTABLE_RIDER_IDS]).toEqual(['RIDER_02_SCARLET_PROXY', 'RIDER_03_CYBERPUNK_MOHAWK', 'RIDER_04_CYBERPUNK_ENFORCER']);
    expect(isSelectableRiderId('RIDER_01_BLACKGUARD')).toBe(false);
    expect(isSelectableRiderId(DEFAULT_RIDER_ID)).toBe(true);
    // The wire encoding (RIDER_IDS order) is unchanged; Blackguard's assets remain built but unused.
    expect(RIDER_IDS.indexOf('RIDER_04_CYBERPUNK_ENFORCER')).toBe(3);
  });
});
