// Hosted (public) mode end to end in Node: the room authority (HostedRoom = the same Session the
// LAN host runs) behind the room relay, with the host and its peers on DIFFERENT relay instances
// that share one broker (as Vercel Function instances share Redis). Covers join-by-link, lap
// authority, room isolation, a race starting for everyone, host leaving and reconnect restoring
// lap progress.
import http from 'node:http';
import type { AddressInfo } from 'node:net';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { initRapier } from '../src/physics/CrashWorld.js';
import { HostedRoom, type RoomOutput } from '../src/room/HostedRoom.js';
import { Session, type RoomServer } from '../src/room/Session.js';
import { VirtualRoomServer, VirtualRoomSocket } from '../src/room/VirtualSocket.js';
import { joinUrlFor, normalizeRoomCode, roomCodeFromUrl, newRoomCode, ROOM_CODE_LENGTH, encodeWire, decodeWire } from '../src/room/wire.js';
import { MemoryBroker } from '../src/server/relay/Broker.js';
import { attachRelay, normalizeRelayUrl } from '../src/server/relay/relayServer.js';
import { RelayClientSocket } from '../src/network/transports.js';
import { PROTOCOL_VERSION, type LobbyStateMsg, type OwnStateMsg, type RaceStartMsg, type WelcomeMsg } from '../src/shared/protocol.js';

const wait = (ms: number) => new Promise((r) => setTimeout(r, ms));
async function until(pred: () => boolean, ms: number, what: string): Promise<void> {
  const t0 = Date.now();
  while (!pred()) {
    if (Date.now() - t0 > ms) throw new Error(`timeout waiting for ${what}`);
    await wait(20);
  }
}

const broker = new MemoryBroker();
const servers: http.Server[] = [];
let originA = '';
let originB = '';

async function relayInstance(): Promise<string> {
  const s = http.createServer();
  attachRelay([s], broker, { roomTtlSec: 20, heartbeatSec: 5 });
  await new Promise<void>((r) => s.listen(0, '127.0.0.1', r));
  servers.push(s);
  return `http://127.0.0.1:${(s.address() as AddressInfo).port}`;
}

beforeAll(async () => {
  await initRapier();
  originA = await relayInstance();
  originB = await relayInstance();
});

afterAll(() => {
  for (const s of servers) s.close();
});

/** The host's own player talking to its HostedRoom (what the host tab's worker link does). */
class HostPlayer {
  room: HostedRoom;
  code: string | null = null;
  lobby: LobbyStateMsg | null = null;
  welcome: WelcomeMsg | null = null;
  start: RaceStartMsg | null = null;
  constructor(origin: string) {
    this.room = new HostedRoom(origin, (m) => this.onOut(m));
    this.room.fromLocal('hello', [{ token: null, protocol: PROTOCOL_VERSION, device: 'desktop' }]);
  }
  private onOut(m: RoomOutput): void {
    if (m.k === 'room') this.code = m.code;
    if (m.k !== 's2c' || !m.ev) return;
    if (m.ev === 'welcome') this.welcome = m.args[0] as WelcomeMsg;
    if (m.ev === 'lobby') this.lobby = m.args[0] as LobbyStateMsg;
    if (m.ev === 'raceStart') this.start = m.args[0] as RaceStartMsg;
  }
  send(ev: string, ...args: unknown[]): void {
    this.room.fromLocal(ev, args);
  }
}

/** A joining player through the relay (the same socket class the browser uses). */
class Peer {
  sock: RelayClientSocket;
  lobby: LobbyStateMsg | null = null;
  welcome: WelcomeMsg | null = null;
  start: RaceStartMsg | null = null;
  own: OwnStateMsg | null = null;
  closed: string | null = null;
  error: string | null = null;
  constructor(origin: string, code: string) {
    this.sock = new RelayClientSocket(code, origin);
    this.sock.on('connect', () => this.sock.emit('hello', { token: this.welcome?.token ?? null, protocol: PROTOCOL_VERSION, device: 'mobile' }));
    this.sock.on('welcome', (w) => (this.welcome = w));
    this.sock.on('lobby', (l) => (this.lobby = l));
    this.sock.on('raceStart', (s) => (this.start = s));
    this.sock.on('snap', (_b, own) => {
      if (own) this.own = own;
    });
    (this.sock as unknown as { on(ev: string, fn: (m: { reason?: string; message?: string }) => void): void }).on('roomClosed', (m) => (this.closed = m.reason ?? 'closed'));
    (this.sock as unknown as { on(ev: string, fn: (m: { reason?: string; message?: string }) => void): void }).on('roomError', (m) => (this.error = m.message ?? 'error'));
  }
}

describe('room codes and join links', () => {
  it('generates readable codes and parses them from the QR/join link, a path, or typed input', () => {
    const code = newRoomCode();
    expect(code).toHaveLength(ROOM_CODE_LENGTH);
    expect(normalizeRoomCode(code)).toBe(code);
    expect(roomCodeFromUrl(joinUrlFor('https://pizzeria.example', code))).toBe(code);
    expect(roomCodeFromUrl(`/r/${code.toLowerCase()}`)).toBe(code);
    expect(roomCodeFromUrl(`?room=${code.slice(0, 3)}-${code.slice(3)}`)).toBe(code);
    expect(normalizeRoomCode(' abc 234 ')).toBe('ABC234');
    expect(normalizeRoomCode('ABC10O')).toBeNull(); // look-alike characters are not in codes
    expect(roomCodeFromUrl('https://pizzeria.example/')).toBeNull();
  });

  it('binary snapshots survive the broker hop', () => {
    const buf = new Uint8Array([1, 2, 250, 0, 7]).buffer;
    const back = decodeWire<{ b: ArrayBuffer; v: Uint8Array }>(encodeWire({ b: buf, v: new Uint8Array([9, 8]) }));
    expect(Array.from(new Uint8Array(back.b))).toEqual([1, 2, 250, 0, 7]);
    expect(Array.from(back.v)).toEqual([9, 8]);
  });

  it('the relay answers on the full or function-relative Socket.IO path', () => {
    expect(normalizeRelayUrl('/api/relay/socket.io/?EIO=4')).toBe('/api/relay/socket.io/?EIO=4');
    expect(normalizeRelayUrl('/socket.io/?EIO=4&transport=websocket')).toBe('/api/relay/socket.io/?EIO=4&transport=websocket');
  });
});

describe('hosted rooms through the relay (host and peers on different relay instances)', () => {
  it('host creates a room, a player joins by link, laps are host-only, rooms stay isolated, the race starts for both', async () => {
    const host = new HostPlayer(originA);
    await until(() => !!host.code && !!host.welcome, 5000, 'room allocated');
    host.send('claimHost');
    await until(() => host.lobby?.hostId === host.welcome!.playerId, 3000, 'host lobby');

    // Join through the exact link the QR code encodes, via the other relay instance.
    const code = roomCodeFromUrl(joinUrlFor(originB, host.code!))!;
    const peer = new Peer(originB, code);
    await until(() => !!peer.welcome, 5000, 'peer welcome');
    peer.sock.emit('join', { name: 'Phone' });
    await until(() => (host.lobby?.players.length ?? 0) === 2 && (peer.lobby?.players.length ?? 0) === 2, 5000, 'both in lobby');
    expect(peer.welcome!.info.roomCode).toBe(host.code);

    // LAPS: only the host changes it; everyone sees the value; it is clamped to 1-5.
    peer.sock.emit('setLaps', { laps: 4 });
    await wait(200);
    expect(host.lobby!.laps).toBe(1);
    host.send('setLaps', { laps: 3 });
    await until(() => peer.lobby?.laps === 3, 3000, 'laps sync to the peer');
    host.send('setLaps', { laps: 9 });
    await until(() => peer.lobby?.laps === 5, 3000, 'laps clamped');
    host.send('setLaps', { laps: 2 });
    await until(() => peer.lobby?.laps === 2 && host.lobby?.laps === 2, 3000, 'laps 2');
    expect(peer.lobby!.trackLength).toBeGreaterThan(8000);

    // A second, independent room with its own player.
    const host2 = new HostPlayer(originB);
    await until(() => !!host2.code && !!host2.welcome, 5000, 'second room');
    expect(host2.code).not.toBe(host.code);
    host2.send('claimHost');
    const peer2 = new Peer(originA, host2.code!);
    await until(() => !!peer2.welcome, 5000, 'peer2 welcome');
    peer2.sock.emit('join', { name: 'Other' });
    await until(() => host2.lobby?.players.length === 2, 5000, 'room 2 lobby');
    expect(host.lobby!.players.map((p) => p.name)).not.toContain('Other');
    expect(host2.lobby!.players.map((p) => p.name)).not.toContain('Phone');
    expect(host2.lobby!.laps).toBe(1);
    // A wrong code never reaches any room.
    const lost = new Peer(originA, host.code === 'ZZZZZZ' ? 'YYYYYY' : 'ZZZZZZ');
    await until(() => !!lost.error, 5000, 'unknown room rejected');
    expect(lost.welcome).toBeNull();

    // Ready gating and a synchronized start for both players (2 laps, immutable once started).
    for (const [send] of [[(ev: string, a: unknown) => host.send(ev, a)], [(ev: string, a: unknown) => peer.sock.emit(ev as 'loaded', a as { ok: boolean; missing: string[] })]] as const) {
      send('loaded', { ok: true, missing: [] });
      send('ready', { ready: true });
    }
    await until(() => host.lobby?.canStart === true, 5000, 'canStart');
    host.send('start');
    await until(() => !!host.start && !!peer.start, 5000, 'raceStart for both');
    expect(peer.start!.goTick).toBe(host.start!.goTick);
    expect(peer.start!.laps).toBe(2);
    host.send('setLaps', { laps: 5 });
    await wait(150);
    expect(host.lobby!.laps).toBe(2);
    await until(() => !!peer.own, 5000, 'snapshots reach the peer across instances');
    expect(peer.own!.laps).toBe(2);

    // The host leaves for good: the room closes for its players (and only for them).
    host.room.close('The host left the game.');
    await until(() => !!peer.closed, 5000, 'peer told the room closed');
    await wait(200);
    expect(peer2.closed).toBeNull();
    host2.room.close('done');
    for (const p of [peer, peer2, lost]) p.sock.disconnect();
  }, 30_000);
});

describe('reconnect during a race', () => {
  it('restores the rider and their lap progress', async () => {
    const server = new VirtualRoomServer();
    const session = new Session(server as unknown as RoomServer, (local) => ({ lanUrls: [], secureUrls: [], secure: false, joinUrl: '', qrSvg: '', caDownloadUrl: null, hostLocal: local, version: 't' }), () => ({ ok: true, missingRequired: [], missingOptional: [], manifestVersion: null }), { isLocal: (s) => s.id === 'h' });
    const mk = (id: string) => {
      const got: { welcome?: WelcomeMsg; start?: RaceStartMsg; own?: OwnStateMsg; lobby?: LobbyStateMsg } = {};
      const s = new VirtualRoomSocket(id, (ev, args) => {
        if (ev === 'welcome') got.welcome = args[0] as WelcomeMsg;
        if (ev === 'raceStart') got.start = args[0] as RaceStartMsg;
        if (ev === 'lobby') got.lobby = args[0] as LobbyStateMsg;
        if (ev === 'snap' && args[1]) got.own = args[1] as OwnStateMsg;
      });
      server.connect(s);
      return { s, got };
    };
    const h = mk('h');
    const p = mk('p1');
    h.s.deliver('hello', [{ token: null, protocol: PROTOCOL_VERSION, device: 'desktop' }]);
    p.s.deliver('hello', [{ token: null, protocol: PROTOCOL_VERSION, device: 'mobile' }]);
    h.s.deliver('claimHost', []);
    p.s.deliver('join', [{ name: 'Rejoiner' }]);
    h.s.deliver('setLaps', [{ laps: 3 }]);
    for (const c of [h, p]) {
      c.s.deliver('loaded', [{ ok: true, missing: [] }]);
      c.s.deliver('ready', [{ ready: true }]);
    }
    h.s.deliver('start', []);
    await until(() => !!p.got.start && !!p.got.own, 5000, 'race running');
    // The rider has completed a lap (authoritative state inside the room).
    const sim = (session as unknown as { sim: { players: Map<number, { progress: { lap: number } }> } }).sim;
    sim.players.get(p.got.welcome!.playerId)!.progress.lap = 1;
    const token = p.got.welcome!.token;
    const playerId = p.got.welcome!.playerId;
    p.s.close(); // connection lost mid-race

    const back = mk('p1b');
    back.s.deliver('hello', [{ token, protocol: PROTOCOL_VERSION, device: 'mobile' }]);
    await until(() => !!back.got.welcome && !!back.got.start && !!back.got.own, 5000, 'reconnected into the race');
    expect(back.got.welcome!.playerId).toBe(playerId);
    expect(back.got.start!.laps).toBe(3);
    expect(back.got.own!.lap).toBe(1);
    expect(back.got.own!.laps).toBe(3);
    session.dispose();
  }, 20_000);
});
