// Compact binary snapshot for all racers (20 Hz). Little-endian DataView layout.
import { ATTACK_IDS, RACE_STATES, RIDER_STATES, type AttackId, type RaceState, type RiderState } from './ids.js';
import type { Quat } from './math.js';

export interface PlayerSnap {
  id: number;
  state: RiderState;
  airborne: boolean;
  boosting: boolean;
  faceUp: boolean;
  connected: boolean;
  finished: boolean;
  dnf: boolean;
  assistOn: boolean;
  cheatActive: boolean;
  puddle: number;
  x: number;
  y: number;
  z: number;
  yaw: number;
  pitch: number;
  lean: number;
  bikeQ: Quat;
  rx: number;
  ry: number;
  rz: number;
  riderQ: Quat;
  riderYaw: number;
  speed: number;
  steer: number;
  lapDist: number;
  s: number;
  lateral: number;
  nextCheckpoint: number;
  position: number;
  attackId: AttackId | null;
  attackTime: number;
  attackSide: number;
  instability: number;
  compression: number;
  stateTime: number;
  boostCharges: number;
  finishTime: number | null;
  hitDir: number;
}

export interface SnapshotHeader {
  tick: number;
  serverTime: number;
  raceState: RaceState;
  goTick: number;
}

const HEADER = 4 + 8 + 1 + 1 + 4;
export const PLAYER_BYTES = 84;

const F = {
  AIR: 1, BOOST: 2, FACEUP: 4, CONN: 8, FIN: 16, DNF: 32, ASSIST: 64, CHEAT: 128,
} as const;

const q16 = (v: number) => Math.max(-32767, Math.min(32767, Math.round(v * 32767)));
const a16 = (v: number) => Math.max(-32767, Math.min(32767, Math.round(v * 10000)));

export function encodeSnapshot(h: SnapshotHeader, players: PlayerSnap[]): ArrayBuffer {
  const buf = new ArrayBuffer(HEADER + players.length * PLAYER_BYTES);
  const dv = new DataView(buf);
  let o = 0;
  dv.setUint32(o, h.tick, true); o += 4;
  dv.setFloat64(o, h.serverTime, true); o += 8;
  dv.setUint8(o, RACE_STATES.indexOf(h.raceState)); o += 1;
  dv.setUint8(o, players.length); o += 1;
  dv.setUint32(o, h.goTick, true); o += 4;
  for (const p of players) {
    const start = o;
    dv.setUint8(o, p.id); o += 1;
    dv.setUint8(o, RIDER_STATES.indexOf(p.state)); o += 1;
    let f = 0;
    if (p.airborne) f |= F.AIR;
    if (p.boosting) f |= F.BOOST;
    if (p.faceUp) f |= F.FACEUP;
    if (p.connected) f |= F.CONN;
    if (p.finished) f |= F.FIN;
    if (p.dnf) f |= F.DNF;
    if (p.assistOn) f |= F.ASSIST;
    if (p.cheatActive) f |= F.CHEAT;
    dv.setUint8(o, f); o += 1;
    dv.setUint8(o, p.puddle); o += 1;
    dv.setFloat32(o, p.x, true); o += 4;
    dv.setFloat32(o, p.y, true); o += 4;
    dv.setFloat32(o, p.z, true); o += 4;
    dv.setInt16(o, a16(p.yaw), true); o += 2;
    dv.setInt16(o, a16(p.pitch), true); o += 2;
    dv.setInt16(o, a16(p.lean), true); o += 2;
    dv.setInt16(o, q16(p.bikeQ.x), true); o += 2;
    dv.setInt16(o, q16(p.bikeQ.y), true); o += 2;
    dv.setInt16(o, q16(p.bikeQ.z), true); o += 2;
    dv.setInt16(o, q16(p.bikeQ.w), true); o += 2;
    dv.setFloat32(o, p.rx, true); o += 4;
    dv.setFloat32(o, p.ry, true); o += 4;
    dv.setFloat32(o, p.rz, true); o += 4;
    dv.setInt16(o, q16(p.riderQ.x), true); o += 2;
    dv.setInt16(o, q16(p.riderQ.y), true); o += 2;
    dv.setInt16(o, q16(p.riderQ.z), true); o += 2;
    dv.setInt16(o, q16(p.riderQ.w), true); o += 2;
    dv.setInt16(o, a16(p.riderYaw), true); o += 2;
    dv.setInt16(o, Math.round(p.speed * 100), true); o += 2;
    dv.setInt8(o, Math.round(Math.max(-1, Math.min(1, p.steer)) * 127)); o += 1;
    dv.setFloat32(o, p.lapDist, true); o += 4;
    dv.setFloat32(o, p.s, true); o += 4;
    dv.setInt16(o, Math.round(p.lateral * 100), true); o += 2;
    dv.setUint8(o, p.nextCheckpoint); o += 1;
    dv.setUint8(o, p.position); o += 1;
    dv.setUint8(o, p.attackId ? ATTACK_IDS.indexOf(p.attackId) : 255); o += 1;
    dv.setUint16(o, Math.min(65535, Math.round(p.attackTime * 1000)), true); o += 2;
    dv.setInt8(o, p.attackSide); o += 1;
    dv.setUint8(o, Math.min(255, Math.round(p.instability * 100))); o += 1;
    dv.setUint8(o, Math.min(255, Math.round(p.compression * 255))); o += 1;
    dv.setUint16(o, Math.min(65535, Math.round(p.stateTime * 1000)), true); o += 2;
    dv.setUint8(o, p.boostCharges); o += 1;
    dv.setFloat32(o, p.finishTime ?? Number.NaN, true); o += 4;
    dv.setInt8(o, Math.sign(p.hitDir)); o += 1;
    o = start + PLAYER_BYTES;
  }
  return buf;
}

export function decodeSnapshot(buf: ArrayBuffer | ArrayBufferView): { header: SnapshotHeader; players: PlayerSnap[] } {
  // Browsers receive an ArrayBuffer; Node (socket.io-client, tests) receives a Buffer view.
  const dv = buf instanceof ArrayBuffer ? new DataView(buf) : new DataView(buf.buffer, buf.byteOffset, buf.byteLength);
  let o = 0;
  const tick = dv.getUint32(o, true); o += 4;
  const serverTime = dv.getFloat64(o, true); o += 8;
  const raceState = RACE_STATES[dv.getUint8(o)] ?? 'LOBBY'; o += 1;
  const count = dv.getUint8(o); o += 1;
  const goTick = dv.getUint32(o, true); o += 4;
  const players: PlayerSnap[] = [];
  for (let i = 0; i < count; i++) {
    const start = o;
    const id = dv.getUint8(o); o += 1;
    const state = RIDER_STATES[dv.getUint8(o)] ?? 'RIDING'; o += 1;
    const f = dv.getUint8(o); o += 1;
    const puddle = dv.getUint8(o); o += 1;
    const x = dv.getFloat32(o, true); o += 4;
    const y = dv.getFloat32(o, true); o += 4;
    const z = dv.getFloat32(o, true); o += 4;
    const yaw = dv.getInt16(o, true) / 10000; o += 2;
    const pitch = dv.getInt16(o, true) / 10000; o += 2;
    const lean = dv.getInt16(o, true) / 10000; o += 2;
    const bq = { x: dv.getInt16(o, true) / 32767, y: dv.getInt16(o + 2, true) / 32767, z: dv.getInt16(o + 4, true) / 32767, w: dv.getInt16(o + 6, true) / 32767 }; o += 8;
    const rx = dv.getFloat32(o, true); o += 4;
    const ry = dv.getFloat32(o, true); o += 4;
    const rz = dv.getFloat32(o, true); o += 4;
    const rq = { x: dv.getInt16(o, true) / 32767, y: dv.getInt16(o + 2, true) / 32767, z: dv.getInt16(o + 4, true) / 32767, w: dv.getInt16(o + 6, true) / 32767 }; o += 8;
    const riderYaw = dv.getInt16(o, true) / 10000; o += 2;
    const speed = dv.getInt16(o, true) / 100; o += 2;
    const steer = dv.getInt8(o) / 127; o += 1;
    const lapDist = dv.getFloat32(o, true); o += 4;
    const s = dv.getFloat32(o, true); o += 4;
    const lateral = dv.getInt16(o, true) / 100; o += 2;
    const nextCheckpoint = dv.getUint8(o); o += 1;
    const position = dv.getUint8(o); o += 1;
    const ai = dv.getUint8(o); o += 1;
    const attackTime = dv.getUint16(o, true) / 1000; o += 2;
    const attackSide = dv.getInt8(o); o += 1;
    const instability = dv.getUint8(o) / 100; o += 1;
    const compression = dv.getUint8(o) / 255; o += 1;
    const stateTime = dv.getUint16(o, true) / 1000; o += 2;
    const boostCharges = dv.getUint8(o); o += 1;
    const ft = dv.getFloat32(o, true); o += 4;
    const hitDir = dv.getInt8(o); o += 1;
    players.push({
      id, state,
      airborne: !!(f & F.AIR), boosting: !!(f & F.BOOST), faceUp: !!(f & F.FACEUP), connected: !!(f & F.CONN),
      finished: !!(f & F.FIN), dnf: !!(f & F.DNF), assistOn: !!(f & F.ASSIST), cheatActive: !!(f & F.CHEAT),
      puddle, x, y, z, yaw, pitch, lean, bikeQ: bq, rx, ry, rz, riderQ: rq, riderYaw, speed, steer, lapDist, s, lateral,
      nextCheckpoint, position, attackId: ai === 255 ? null : (ATTACK_IDS[ai] ?? null), attackTime, attackSide,
      instability, compression, stateTime, boostCharges, finishTime: Number.isNaN(ft) ? null : ft, hitDir,
    });
    o = start + PLAYER_BYTES;
  }
  return { header: { tick, serverTime, raceState, goTick }, players };
}
