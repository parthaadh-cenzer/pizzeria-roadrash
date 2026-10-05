// End-to-end over real Socket.IO: host + phone-style client join the lobby, choose loadouts,
// ready up, the host starts, the synchronized intro runs, controls unlock at GO, both bots race
// the full lap (bridge jump included) and the host publishes results.
import http from 'node:http';
import type { AddressInfo } from 'node:net';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { Server } from 'socket.io';
import { io as connect, type Socket } from 'socket.io-client';
import { initRapier } from '../src/physics/CrashWorld.js';
import { Session, type RoomServer } from '../src/room/Session.js';
import { checkRuntimeAssets } from '../src/server/assets.js';
import { getTrack } from '../src/game/track/Track.js';
import { bikeParamsFor } from '../src/game/sim/BikeController.js';
import { decodeSnapshot } from '../src/shared/snapshot.js';
import { packInput } from '../src/shared/inputPack.js';
import { PROTOCOL_VERSION, type ClientToServer, type LobbyStateMsg, type OwnStateMsg, type RaceStartMsg, type ResultsMsg, type ServerToClient } from '../src/shared/protocol.js';
import type { RaceEvent } from '../src/game/sim/RaceSim.js';
import { autopilotInput } from './helpers/autopilot.js';

type C = Socket<ServerToClient, ClientToServer>;

let server: http.Server;
let url = '';

beforeAll(async () => {
  await initRapier();
  server = http.createServer();
  const io = new Server<ClientToServer, ServerToClient>(server, { serveClient: false });
  new Session(io as unknown as RoomServer, (local) => ({ lanUrls: [], secureUrls: [], secure: false, joinUrl: 'http://test/', qrSvg: '', caDownloadUrl: null, hostLocal: local, version: 'test' }), () => checkRuntimeAssets('public'));
  await new Promise<void>((r) => server.listen(0, '127.0.0.1', r));
  url = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
});

afterAll(() => {
  server.close();
});

interface Bot {
  s: C;
  id: number;
  lobby: LobbyStateMsg | null;
  start: RaceStartMsg | null;
  own: OwnStateMsg | null;
  results: ResultsMsg | null;
  events: RaceEvent[];
  seq: number;
  cheat: { ok: boolean; charges: number } | null;
  preGoMoves: number;
  snaps: number;
  error: Error | null;
}

function bot(): Promise<Bot> {
  return new Promise((resolve) => {
    const s: C = connect(url, { transports: ['websocket'], forceNew: true });
    const b: Bot = { s, id: -1, lobby: null, start: null, own: null, results: null, events: [], seq: 0, cheat: null, preGoMoves: 0, snaps: 0, error: null };
    s.on('welcome', (w) => {
      b.id = w.playerId;
      bots.push(b);
      resolve(b);
    });
    s.on('lobby', (l) => (b.lobby = l));
    s.on('raceStart', (m) => (b.start = m));
    s.on('snap', (buf, own, ev) => {
      try {
        const { header, players } = decodeSnapshot(buf);
        if (own) {
          if (b.own && header.tick < (b.start?.goTick ?? 0) && Math.abs(own.bike.lapDist - b.own.bike.lapDist) > 0.01) b.preGoMoves++;
          b.own = own;
        }
        if (players.length === 0) throw new Error('snapshot carried no racers');
        b.snaps++;
        b.events.push(...(JSON.parse(ev) as RaceEvent[]));
      } catch (e) {
        b.error ??= e as Error;
      }
    });
    s.on('results', (r) => (b.results = r));
    s.on('cheatResult', (r) => (b.cheat = r));
    s.on('connect', () => s.emit('hello', { token: null, protocol: PROTOCOL_VERSION, device: 'desktop' }));
  });
}

const bots: Bot[] = [];
const wait = (ms: number) => new Promise((r) => setTimeout(r, ms));
async function until(pred: () => boolean, ms: number, what: string): Promise<void> {
  const t0 = Date.now();
  while (!pred()) {
    for (const b of bots) if (b.error) throw b.error;
    if (Date.now() - t0 > ms) throw new Error(`timeout waiting for ${what}`);
    await wait(25);
  }
}

describe('LAN session end to end', () => {
  it('lobby -> loadout -> ready -> synchronized intro -> race -> bridge jump -> finish -> results', async () => {
    const host = await bot();
    const phone = await bot();
    host.s.emit('claimHost');
    phone.s.emit('join', { name: 'Phone' });
    await until(() => (host.lobby?.players.length ?? 0) === 2 && host.lobby?.hostId === host.id, 3000, 'two players in lobby');
    host.s.emit('loadout', { name: 'Host', riderId: 'RIDER_02_SCARLET_PROXY', riderColor: 1, bikeId: 'BIKE_05_TRON_LIGHT_CYCLE', bikeColor: 2, weaponId: 'ZABIMARU' });
    phone.s.emit('loadout', { riderId: 'RIDER_04_CYBERPUNK_ENFORCER', riderColor: 0, bikeId: 'BIKE_02_AKIRA_CRUISER', bikeColor: 1, weaponId: 'MORNING_STAR' });
    await until(() => host.lobby?.players.find((p) => p.id === phone.id)?.loadout.bikeId === 'BIKE_02_AKIRA_CRUISER', 3000, 'loadout sync');
    // Blackguard is retired from the roster: the server keeps the previous valid rider.
    phone.s.emit('loadout', { riderId: 'RIDER_01_BLACKGUARD', bikeColor: 1 });
    await wait(200);
    expect(host.lobby!.players.find((p) => p.id === phone.id)!.loadout.riderId).toBe('RIDER_04_CYBERPUNK_ENFORCER');
    // Ready gating: cannot start before everyone is ready (and assets loaded).
    host.s.emit('loaded', { ok: true, missing: [] });
    host.s.emit('ready', { ready: true });
    await until(() => !!host.lobby?.players.find((p) => p.id === host.id)?.ready, 3000, 'host ready');
    expect(host.lobby!.canStart).toBe(false);
    expect(host.lobby!.startBlockers.join(' ')).toContain('Phone');
    phone.s.emit('loaded', { ok: true, missing: [] });
    phone.s.emit('ready', { ready: true });
    await until(() => host.lobby?.canStart === true, 3000, 'canStart');
    // Only the host may start.
    phone.s.emit('start');
    await wait(200);
    expect(host.start).toBeNull();
    host.s.emit('start');
    await until(() => !!host.start && !!phone.start, 3000, 'raceStart');
    expect(host.start!.goTick).toBe(phone.start!.goTick);
    expect(host.start!.introStartTime).toBe(phone.start!.introStartTime);
    expect(host.start!.crowdSuppress).toContain('RIDER_02_SCARLET_PROXY:1');

    const track = getTrack();
    const params = { [host.id]: bikeParamsFor('BIKE_05_TRON_LIGHT_CYCLE'), [phone.id]: bikeParamsFor('BIKE_02_AKIRA_CRUISER') };
    let cheated = false;
    let boosted = false;
    const drive = setInterval(() => {
      for (const b of [host, phone]) {
        if (!b.own) continue;
        const inputs = [];
        for (let k = 0; k < 2; k++) {
          const inp = autopilotInput(track, b.own.bike, params[b.id]!, ++b.seq, { lateralTarget: b === host ? -2 : 2 });
          if (b === host && cheated && !boosted && b.own.boostCharges === 10 && b.own.bike.lapDist > 300) {
            inp.boost = true;
            boosted = true;
          }
          inputs.push(packInput(inp));
        }
        b.s.emit('inputs', { i: inputs });
      }
      // Secret cheat, keyboard-only in the real client; server validates activation.
      if (!cheated && host.own && host.own.bike.lapDist > 100) {
        host.s.emit('cheat', { phrase: 'wrongphrase' });
        host.s.emit('cheat', { phrase: 'xyzzyspoon' });
        cheated = true;
      }
    }, 1000 / 30);
    try {
      await until(() => !!host.results && !!phone.results, 280_000, 'results');
    } finally {
      clearInterval(drive);
    }
    // Controls were locked until the authoritative GO tick.
    expect(host.preGoMoves).toBe(0);
    // Cheat: activation grants exactly 10 charges; one Shift+1 consumes one.
    expect(host.cheat?.ok).toBe(true);
    expect(host.events.some((e) => e.t === 'cheat' && e.id === host.id && e.charges === 10)).toBe(true);
    expect(host.events.some((e) => e.t === 'boost' && e.id === host.id && e.charges === 9)).toBe(true);
    for (const b of [host, phone]) {
      const cps = b.events.filter((e) => e.t === 'checkpoint' && e.id === b.id).map((e) => (e as { index: number }).index);
      expect(cps).toEqual(track.checkpoints.map((c) => c.index));
      expect(b.events.some((e) => e.t === 'launch' && e.id === b.id)).toBe(true);
      expect(b.events.some((e) => e.t === 'finish' && e.id === b.id)).toBe(true);
    }
    const r = host.results!;
    expect(r.entries).toHaveLength(2);
    expect(r.entries.every((e) => !e.dnf && e.finishTime !== null)).toBe(true);
    expect(r.entries[0]!.gap).toBe(0);
    expect(r.entries[1]!.gap!).toBeGreaterThanOrEqual(0);
    expect(r).toEqual(phone.results);
    // Host returns everyone to the lobby with ready reset.
    host.s.emit('toLobby');
    await until(() => host.lobby?.phase === 'LOBBY' && !!host.lobby.players.every((p) => !p.ready), 3000, 'back to lobby');
    host.s.close();
    phone.s.close();
  }, 300_000);

  it('leaving mid-race is a permanent DNF and only the host can end a stuck race', async () => {
    const host = await bot();
    const leaver = await bot();
    const idle = await bot();
    host.s.emit('claimHost');
    leaver.s.emit('join', { name: 'Leaver' });
    idle.s.emit('join', { name: 'Idle' });
    await until(() => host.lobby?.hostId === host.id && host.lobby.players.filter((p) => p.connected).length === 3, 5000, 'three in lobby');
    // Riders from the previous race who went away still block the start until the host removes them.
    for (const p of host.lobby!.players.filter((x) => !x.connected)) host.s.emit('removePlayer', { id: p.id });
    await until(() => host.lobby!.players.length === 3, 5000, 'stale riders removed');
    for (const b of [host, leaver, idle]) {
      b.s.emit('loaded', { ok: true, missing: [] });
      b.s.emit('ready', { ready: true });
    }
    await until(() => host.lobby?.canStart === true, 5000, 'canStart');
    host.s.emit('start');
    await until(() => !!host.start && !!leaver.start && !!idle.start, 5000, 'raceStart');
    await until(() => (host.own?.tick ?? 0) > host.start!.goTick + 30, 30_000, 'GO');
    const acked = await new Promise<boolean>((r) => leaver.s.emit('leave', () => r(true)));
    expect(acked).toBe(true);
    await until(() => host.events.some((e) => e.t === 'dnf' && e.id === leaver.id), 5000, 'leaver DNF');
    // The leaver is no longer in the lobby list, and non-hosts cannot end the race.
    await until(() => !host.lobby!.players.some((p) => p.id === leaver.id), 5000, 'leaver removed from lobby');
    idle.s.emit('endRace');
    await wait(400);
    expect(host.results).toBeNull();
    host.s.emit('endRace');
    await until(() => !!host.results && !!idle.results, 5000, 'results after endRace');
    const r = host.results!;
    expect(r.entries).toHaveLength(3);
    expect(r.entries.every((e) => e.dnf && e.finishTime === null && e.gap === null)).toBe(true);
    host.s.emit('toLobby');
    await until(() => host.lobby?.phase === 'LOBBY', 5000, 'back to lobby');
    for (const b of [host, leaver, idle]) b.s.close();
  }, 60_000);

  it('ten lobby slots fill, the eleventh rider is refused, and a ten-racer grid starts', async () => {
    const host = await bot();
    host.s.emit('claimHost');
    await until(() => host.lobby?.hostId === host.id, 5000, 'host');
    for (const p of host.lobby!.players.filter((x) => !x.connected)) host.s.emit('removePlayer', { id: p.id });
    const riders: Bot[] = [];
    for (let i = 0; i < 9; i++) {
      const b = await bot();
      b.s.emit('join', { name: `R${i + 2}` });
      riders.push(b);
    }
    await until(() => host.lobby!.players.filter((p) => p.connected).length === 10, 8000, 'ten in lobby');
    const extra = await bot();
    const refused = new Promise<string>((r) => extra.s.on('errorMsg', (e) => r(e.code)));
    extra.s.emit('join', { name: 'Eleventh' });
    expect(await refused).toBe('LOBBY_FULL');
    const all = [host, ...riders];
    for (const b of all) {
      b.s.emit('loaded', { ok: true, missing: [] });
      b.s.emit('ready', { ready: true });
    }
    await until(() => host.lobby?.canStart === true, 8000, 'canStart with ten');
    host.s.emit('start');
    await until(() => all.every((b) => !!b.start), 8000, 'raceStart for all ten');
    const slots = host.start!.participants.map((p) => p.slot).sort((a, b) => a - b);
    expect(slots).toEqual([0, 1, 2, 3, 4, 5, 6, 7, 8, 9]);
    expect(extra.start).toBeNull();
    await until(() => all.every((b) => b.snaps > 3), 8000, 'snapshots');
    host.s.emit('endRace');
    await until(() => !!host.results, 5000, 'results');
    expect(host.results!.entries).toHaveLength(10);
    host.s.emit('toLobby');
    await until(() => host.lobby?.phase === 'LOBBY', 5000, 'lobby');
    for (const b of [...all, extra]) b.s.close();
  }, 60_000);
});
