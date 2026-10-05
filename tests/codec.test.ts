// Wire formats: 20 Hz binary snapshots and 30 Hz packed inputs.
import { describe, expect, it } from 'vitest';
import { decodeSnapshot, encodeSnapshot, PLAYER_BYTES, type PlayerSnap } from '../src/shared/snapshot.js';
import { packInput, unpackInput } from '../src/shared/inputPack.js';

function snap(id: number, over: Partial<PlayerSnap> = {}): PlayerSnap {
  const n = Math.SQRT1_2;
  return {
    id, state: 'RIDING', airborne: true, boosting: false, faceUp: true, connected: true, finished: false, dnf: false, assistOn: true, cheatActive: true,
    puddle: 3, x: 1234.567, y: 8.25, z: -987.5, yaw: 2.5, pitch: -0.1, lean: 0.4, bikeQ: { x: 0, y: n, z: 0, w: n },
    rx: 1234.1, ry: 9.3, rz: -987.2, riderQ: { x: 0.5, y: 0.5, z: 0.5, w: 0.5 }, riderYaw: -1.2, speed: 61.37, steer: -0.66,
    lapDist: 4321.25, s: 4700.5, lateral: -3.21, nextCheckpoint: 7, position: 2, attackId: 'ZABIMARU', attackTime: 0.312,
    attackSide: -1, instability: 0.42, compression: 0.5, stateTime: 1.234, boostCharges: 9, finishTime: null, hitDir: -1,
    ...over,
  };
}

describe('snapshot codec', () => {
  it('round-trips every field within its quantization', () => {
    const players = [snap(1), snap(10, { state: 'RAGDOLL', airborne: false, finished: true, finishTime: 143.25, attackId: null, boostCharges: 0, cheatActive: false, hitDir: 1 })];
    const buf = encodeSnapshot({ tick: 123456, serverTime: 98765.4321, raceState: 'RACING', goTick: 900 }, players);
    expect(buf.byteLength).toBe(18 + players.length * PLAYER_BYTES);
    const { header, players: out } = decodeSnapshot(buf);
    expect(header).toEqual({ tick: 123456, serverTime: 98765.4321, raceState: 'RACING', goTick: 900 });
    expect(out).toHaveLength(2);
    const [a, b] = out as [PlayerSnap, PlayerSnap];
    const src = players[0]!;
    expect(a.id).toBe(1);
    expect(a.state).toBe('RIDING');
    expect([a.airborne, a.boosting, a.faceUp, a.connected, a.finished, a.dnf, a.assistOn, a.cheatActive]).toEqual([true, false, true, true, false, false, true, true]);
    expect(a.puddle).toBe(3);
    expect(a.x).toBeCloseTo(src.x, 2);
    expect(a.z).toBeCloseTo(src.z, 2);
    expect(a.yaw).toBeCloseTo(src.yaw, 3);
    expect(a.lean).toBeCloseTo(src.lean, 3);
    expect(a.bikeQ.y).toBeCloseTo(src.bikeQ.y, 4);
    expect(a.riderQ.w).toBeCloseTo(0.5, 4);
    expect(a.speed).toBeCloseTo(src.speed, 2);
    expect(a.steer).toBeCloseTo(src.steer, 2);
    expect(a.lapDist).toBeCloseTo(src.lapDist, 2);
    expect(a.lateral).toBeCloseTo(src.lateral, 2);
    expect(a.nextCheckpoint).toBe(7);
    expect(a.position).toBe(2);
    expect(a.attackId).toBe(src.attackId);
    expect(a.attackTime).toBeCloseTo(0.312, 3);
    expect(a.attackSide).toBe(-1);
    expect(a.instability).toBeCloseTo(0.42, 2);
    expect(a.stateTime).toBeCloseTo(1.234, 3);
    expect(a.boostCharges).toBe(9);
    expect(a.finishTime).toBeNull();
    expect(b.state).toBe('RAGDOLL');
    expect(b.finished).toBe(true);
    expect(b.finishTime).toBeCloseTo(143.25, 3);
    expect(b.attackId).toBeNull();
    expect(b.hitDir).toBe(1);
  });

  it('10 racers fit in well under 1 KB per snapshot', () => {
    const buf = encodeSnapshot({ tick: 1, serverTime: 1, raceState: 'RACING', goTick: 1 }, Array.from({ length: 10 }, (_, i) => snap(i + 1)));
    expect(buf.byteLength).toBeLessThan(1024);
  });
});

describe('input packing', () => {
  it('round-trips controls and flags', () => {
    const i = { seq: 4242, throttle: 1, brake: 0.5, steer: -0.75, analog: true, autoAccel: true, kick: true, attack: false, boost: true };
    const o = unpackInput(packInput(i))!;
    expect(o.seq).toBe(4242);
    expect(o.throttle).toBe(1);
    expect(o.brake).toBeCloseTo(0.5, 2);
    expect(o.steer).toBeCloseTo(-0.75, 2);
    expect([o.analog, o.autoAccel, o.kick, o.attack, o.boost]).toEqual([true, true, true, false, true]);
  });

  it('rejects malformed or hostile payloads and clamps ranges', () => {
    expect(unpackInput(null)).toBeNull();
    expect(unpackInput([1, 2, 3])).toBeNull();
    expect(unpackInput([1, 2, 3, 4, 'x'])).toBeNull();
    expect(unpackInput([1, Number.NaN, 0, 0, 0])).toBeNull();
    expect(unpackInput({ 0: 1 })).toBeNull();
    const o = unpackInput([5, 9999, -40, 500, 0])!;
    expect(o.throttle).toBe(1);
    expect(o.brake).toBe(0);
    expect(o.steer).toBe(1);
  });
});
