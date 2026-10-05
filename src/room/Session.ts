// Room authority: lobby, loadouts, laps, ready gating, race lifecycle and the authoritative
// simulation loop. Environment-neutral: the LAN host runs it in Node behind Socket.IO; the hosted
// (public) mode runs the same code in the host's browser (a Web Worker) behind the room relay.
import { NETWORK, RACE, SIM_DT, clampLaps, introTotalDuration } from '../config/gameplay.js';
import { RaceSim, isRidingState, type PlayerRuntime } from '../game/sim/RaceSim.js';
import { getTrack } from '../game/track/Track.js';
import { CrashWorld } from '../physics/CrashWorld.js';
import { COLOR_VARIANT_COUNT, MAX_PLAYERS, DEFAULT_RIDER_ID, isBikeId, isSelectableRiderId, isWeaponId, type RaceState } from '../shared/ids.js';
import { unpackInput } from '../shared/inputPack.js';
import { encodeSnapshot, type PlayerSnap } from '../shared/snapshot.js';
import {
  PROTOCOL_VERSION,
  type AssetStatus,
  type ClientToServer,
  type LoadoutMsg,
  type LobbyPlayer,
  type LobbyStateMsg,
  type OwnStateMsg,
  type ResultsMsg,
  type ServerInfoMsg,
  type ServerToClient,
} from '../shared/protocol.js';
/** The subset of a Socket.IO server socket the room uses (also implemented by relay peers). */
export interface RoomSocket {
  readonly id: string;
  readonly handshake?: { address?: string };
  on<E extends keyof ClientToServer>(ev: E, fn: ClientToServer[E]): unknown;
  on(ev: 'disconnect', fn: () => void): unknown;
  emit<E extends keyof ServerToClient>(ev: E, ...args: Parameters<ServerToClient[E]>): unknown;
  disconnect(close?: boolean): unknown;
}

export interface RoomServer {
  on(ev: 'connection', fn: (s: RoomSocket) => void): unknown;
}

export interface SessionOptions {
  /** True when the socket belongs to the hosting machine/tab (may claim host). */
  isLocal?: (s: RoomSocket) => boolean;
}

type Sock = RoomSocket;

function loopback(s: RoomSocket): boolean {
  const a = (s.handshake?.address ?? '').replace(/^::ffff:/, '');
  return a === '127.0.0.1' || a === '::1';
}

function randomToken(): string {
  const b = new Uint8Array(16);
  globalThis.crypto.getRandomValues(b);
  return Array.from(b, (x) => x.toString(16).padStart(2, '0')).join('');
}

interface SessionPlayer {
  id: number;
  token: string;
  name: string;
  socket: Sock | null;
  connected: boolean;
  disconnectedAt: number;
  ready: boolean;
  loaded: boolean;
  isHost: boolean;
  local: boolean;
  device: 'desktop' | 'mobile';
  loadout: LoadoutMsg;
  joined: boolean;
  inputCount: number;
  inputWindowStart: number;
  cheatAttempts: number;
}

const DEFAULT_LOADOUT: LoadoutMsg = { riderId: DEFAULT_RIDER_ID, riderColor: 0, bikeId: 'BIKE_01_SCIFI_MOTORCYCLE', bikeColor: 0, weaponId: 'KATANA' };
const LOBBY_DISCONNECT_GRACE_MS = 20_000;

export const serverNow = (): number => performance.now();

function cleanName(raw: unknown, fallback: string): string {
  if (typeof raw !== 'string') return fallback;
  const n = raw.replace(/[^\p{L}\p{N} _\-.!?]/gu, '').trim().slice(0, 16);
  return n.length ? n : fallback;
}

export class Session {

  private readonly infoFor: (local: boolean) => ServerInfoMsg;
  private readonly assetStatus: () => AssetStatus;
  private readonly players = new Map<number, SessionPlayer>();
  private nextId = 1;
  private hostId: number | null = null;
  private phase: 'LOBBY' | 'RACE' | 'RESULTS' = 'LOBBY';
  private raceState: RaceState = 'LOBBY';
  private sim: RaceSim | null = null;
  private crashWorld: CrashWorld | null = null;
  private raceId = 0;
  private simStartTime = 0;
  private participants: number[] = [];
  private results: ResultsMsg | null = null;
  private loopTimer: ReturnType<typeof setTimeout> | null = null;
  private resultsAt = 0;
  private resultsTimer: ReturnType<typeof setInterval> | null = null;
  private finishedAt = 0;
  /** Race length chosen by the host (1-5); fixed per race once it starts. */
  private laps: number = RACE.laps;
  private readonly isLocal: (s: RoomSocket) => boolean;
  private housekeepingTimer: ReturnType<typeof setInterval>;

  constructor(io: RoomServer, infoFor: (local: boolean) => ServerInfoMsg, assetStatus: () => AssetStatus, opts: SessionOptions = {}) {
    this.infoFor = infoFor;
    this.assetStatus = assetStatus;
    this.isLocal = opts.isLocal ?? loopback;
    io.on('connection', (s) => this.onConnection(s));
    this.housekeepingTimer = setInterval(() => this.housekeeping(), 1000);
    (this.housekeepingTimer as { unref?: () => void }).unref?.();
  }

  /** Stops timers (hosted rooms end when the host tab leaves). */
  dispose(): void {
    clearInterval(this.housekeepingTimer);
    if (this.loopTimer) clearTimeout(this.loopTimer);
    if (this.resultsTimer) clearInterval(this.resultsTimer);
    this.crashWorld?.dispose();
    this.sim = null;
  }

  /** Re-sends lobby / race / results state to every connected player (after a relay blip). */
  resync(): void {
    this.broadcastLobby();
    for (const p of this.players.values()) {
      if (!p.socket) continue;
      if (this.phase === 'RACE' && this.sim && this.participants.includes(p.id)) this.sendRaceStart(p.socket);
      if (this.phase === 'RESULTS' && this.results) p.socket.emit('results', this.results);
    }
  }

  // ------------------------------------------------------------------ connections
  private onConnection(socket: Sock): void {
    const local = this.isLocal(socket);
    let player: SessionPlayer | null = null;

    socket.on('hello', (msg) => {
      if (!msg || msg.protocol !== PROTOCOL_VERSION) {
        socket.emit('errorMsg', { code: 'PROTOCOL', message: 'Client and host versions differ. Reload the page.' });
        return;
      }
      const token = typeof msg.token === 'string' ? msg.token : null;
      const existing = token ? [...this.players.values()].find((p) => p.token === token) : undefined;
      if (existing) {
        // Reconnect to the same identity; never duplicate a player.
        if (existing.socket && existing.socket.id !== socket.id) existing.socket.disconnect(true);
        existing.socket = socket;
        existing.connected = true;
        existing.local = local;
        existing.device = msg.device === 'mobile' ? 'mobile' : 'desktop';
        player = existing;
        this.sim?.setConnected(existing.id, true);
      } else {
        player = {
          id: this.nextId++,
          token: randomToken(),
          name: `Rider ${this.nextId - 1}`,
          socket,
          connected: true,
          disconnectedAt: 0,
          ready: false,
          loaded: false,
          isHost: false,
          local,
          device: msg.device === 'mobile' ? 'mobile' : 'desktop',
          loadout: { ...DEFAULT_LOADOUT },
          joined: false,
          inputCount: 0,
          inputWindowStart: 0,
          cheatAttempts: 0,
        };
        this.players.set(player.id, player);
      }
      socket.emit('welcome', {
        playerId: player.id,
        token: player.token,
        isHost: player.isHost,
        protocol: PROTOCOL_VERSION,
        serverTime: serverNow(),
        info: this.infoFor(local),
      });
      this.broadcastLobby();
      if (this.phase === 'RACE' && this.sim && this.participants.includes(player.id)) this.sendRaceStart(socket);
      if (this.phase === 'RESULTS' && this.results) socket.emit('results', this.results);
    });

    socket.on('ping', (_msg, ack) => {
      if (typeof ack === 'function') ack(serverNow());
    });

    socket.on('claimHost', () => {
      if (!player) return;
      if (!local) {
        socket.emit('errorMsg', { code: 'HOST_LOCAL_ONLY', message: 'Only the host computer can host the game.' });
        return;
      }
      if (this.hostId !== null && this.hostId !== player.id && this.players.get(this.hostId)?.connected) {
        socket.emit('errorMsg', { code: 'HOST_TAKEN', message: 'A host is already running this game.' });
        return;
      }
      if (this.hostId !== null) {
        const old = this.players.get(this.hostId);
        if (old) old.isHost = false;
      }
      this.hostId = player.id;
      player.isHost = true;
      if (!player.joined) this.joinLobby(player, player.name);
      this.broadcastLobby();
    });

    socket.on('join', (msg) => {
      if (!player) return;
      this.joinLobby(player, cleanName(msg?.name, player.name));
      this.broadcastLobby();
    });

    socket.on('loadout', (msg) => {
      if (!player || !player.joined || this.phase === 'RACE') return;
      const l = player.loadout;
      if (msg.name !== undefined) player.name = cleanName(msg.name, player.name);
      if (isSelectableRiderId(msg.riderId)) l.riderId = msg.riderId;
      if (isBikeId(msg.bikeId)) l.bikeId = msg.bikeId;
      if (isWeaponId(msg.weaponId)) l.weaponId = msg.weaponId;
      if (Number.isInteger(msg.riderColor) && msg.riderColor! >= 0 && msg.riderColor! < COLOR_VARIANT_COUNT) l.riderColor = msg.riderColor!;
      if (Number.isInteger(msg.bikeColor) && msg.bikeColor! >= 0 && msg.bikeColor! < COLOR_VARIANT_COUNT) l.bikeColor = msg.bikeColor!;
      player.ready = false;
      this.broadcastLobby();
    });

    socket.on('loaded', (msg) => {
      if (!player) return;
      player.loaded = !!msg?.ok;
      if (!player.loaded) player.ready = false;
      this.broadcastLobby();
    });

    socket.on('ready', (msg) => {
      if (!player || !player.joined || this.phase !== 'LOBBY') return;
      player.ready = !!msg?.ready && player.loaded;
      this.broadcastLobby();
    });

    socket.on('removePlayer', (msg) => {
      if (!player || player.id !== this.hostId || this.phase !== 'LOBBY') return;
      const target = this.players.get(Number(msg?.id));
      if (!target || target.id === this.hostId) return;
      target.socket?.emit('kicked', { reason: 'Removed from the lobby by the host.' });
      target.socket?.disconnect(true);
      this.players.delete(target.id);
      this.broadcastLobby();
    });

    socket.on('setLaps', (msg) => {
      // Host only, lobby only: the value is fixed once a race starts.
      if (!player || player.id !== this.hostId || this.phase !== 'LOBBY') return;
      this.laps = clampLaps(msg?.laps);
      this.broadcastLobby();
    });

    socket.on('start', () => {
      if (!player || player.id !== this.hostId) return;
      const lobby = this.lobbyState();
      if (!lobby.canStart) {
        socket.emit('errorMsg', { code: 'CANNOT_START', message: lobby.startBlockers.join(' · ') });
        return;
      }
      void this.startRace();
    });

    socket.on('toLobby', () => {
      if (!player || player.id !== this.hostId) return;
      this.returnToLobby();
    });

    socket.on('endRace', () => {
      if (!player || player.id !== this.hostId || this.phase !== 'RACE' || !this.sim) return;
      this.finishRace();
    });

    socket.on('leave', (ack) => {
      if (!player) return;
      // Leaving is permanent: mid-race the racer becomes DNF and is no longer a participant. The
      // connection stays as a non-joined player so the menu's Host/Join works again.
      if (this.phase === 'RACE' && this.participants.includes(player.id)) {
        this.sim?.retire(player.id);
        this.participants = this.participants.filter((id) => id !== player!.id);
      }
      player.joined = false;
      player.ready = false;
      if (this.hostId === player.id) {
        this.hostId = null;
        player.isHost = false;
      }
      this.broadcastLobby();
      if (typeof ack === 'function') ack();
    });

    socket.on('inputs', (msg) => {
      if (!player || !this.sim || this.phase !== 'RACE') return;
      const now = serverNow();
      if (now - player.inputWindowStart > 1000) {
        player.inputWindowStart = now;
        player.inputCount = 0;
      }
      if (++player.inputCount > NETWORK.inputHz * 3) return; // rate limit
      const list = Array.isArray(msg?.i) ? msg.i.slice(0, 16) : [];
      const inputs = list.map(unpackInput).filter((x): x is NonNullable<typeof x> => x !== null);
      this.sim.queueInputs(player.id, inputs);
    });

    socket.on('cheat', (msg) => {
      if (!player || !this.sim) return;
      if (++player.cheatAttempts > 20) return;
      const ok = this.sim.activateCheat(player.id, typeof msg?.phrase === 'string' ? msg.phrase : '');
      const rp = this.sim.players.get(player.id);
      socket.emit('cheatResult', { ok, charges: rp?.boostCharges ?? 0 });
    });

    socket.on('disconnect', () => {
      if (!player) return;
      if (player.socket?.id !== socket.id) return;
      player.connected = false;
      player.socket = null;
      player.disconnectedAt = serverNow();
      player.ready = false;
      this.sim?.setConnected(player.id, false);
      this.broadcastLobby();
    });
  }

  private joinLobby(p: SessionPlayer, name: string): void {
    const joined = [...this.players.values()].filter((x) => x.joined && x.id !== p.id);
    if (!p.joined && joined.length >= MAX_PLAYERS) {
      p.socket?.emit('errorMsg', { code: 'LOBBY_FULL', message: `The lobby is full (${MAX_PLAYERS} riders).` });
      return;
    }
    p.name = name;
    p.joined = true;
  }

  private housekeeping(): void {
    if (this.phase === 'LOBBY') {
      const now = serverNow();
      let changed = false;
      for (const p of [...this.players.values()]) {
        if (!p.connected && now - p.disconnectedAt > LOBBY_DISCONNECT_GRACE_MS) {
          this.players.delete(p.id);
          if (this.hostId === p.id) this.hostId = null;
          changed = true;
        }
      }
      if (changed) this.broadcastLobby();
    }
  }

  // ------------------------------------------------------------------ lobby state
  private lobbyState(): LobbyStateMsg {
    const assets = this.assetStatus();
    const joined = [...this.players.values()].filter((p) => p.joined);
    const players: LobbyPlayer[] = joined.map((p, i) => ({
      id: p.id,
      name: p.name,
      connected: p.connected,
      ready: p.ready,
      isHost: p.id === this.hostId,
      loaded: p.loaded,
      slot: i,
      loadout: { ...p.loadout },
      device: p.device,
    }));
    const blockers: string[] = [];
    if (!assets.ok) blockers.push(`Required runtime assets missing: ${assets.missingRequired.slice(0, 4).join(', ')}${assets.missingRequired.length > 4 ? '…' : ''}`);
    if (joined.length === 0) blockers.push('No riders in the lobby');
    const notReady = joined.filter((p) => !p.ready || !p.connected);
    if (notReady.length) blockers.push(`Waiting for: ${notReady.map((p) => p.name).join(', ')}`);
    if (this.phase !== 'LOBBY') blockers.push('A race is already running');
    return {
      phase: this.phase,
      raceState: this.raceState,
      players,
      hostId: this.hostId,
      maxPlayers: MAX_PLAYERS,
      canStart: blockers.length === 0,
      startBlockers: blockers,
      assets,
      laps: this.phase === 'LOBBY' ? this.laps : (this.sim?.laps ?? this.laps),
      trackLength: getTrack().length,
    };
  }

  private broadcastLobby(): void {
    const state = this.lobbyState();
    for (const p of this.players.values()) {
      p.socket?.emit('lobby', state);
    }
  }

  // ------------------------------------------------------------------ race lifecycle
  private async startRace(): Promise<void> {
    const joined = [...this.players.values()].filter((p) => p.joined && p.connected);
    this.participants = joined.map((p) => p.id);
    const track = getTrack();
    this.crashWorld?.dispose();
    this.crashWorld = new CrashWorld(track);
    this.simStartTime = serverNow();
    const introStart = this.simStartTime + NETWORK.introLeadTime * 1000;
    const goTime = introStart + introTotalDuration() * 1000;
    const goTick = Math.ceil((goTime - this.simStartTime) / (SIM_DT * 1000));
    this.sim = new RaceSim(
      track,
      this.crashWorld,
      joined.map((p, i) => ({ id: p.id, name: p.name, slot: i, loadout: { ...p.loadout } })),
      goTick,
      this.laps,
    );
    this.raceId++;
    this.phase = 'RACE';
    this.raceState = 'INTRO';
    this.results = null;
    this.finishedAt = 0;
    for (const p of joined) if (p.socket) this.sendRaceStart(p.socket);
    this.broadcastLobby();
    this.startLoop();
  }

  private sendRaceStart(socket: Sock): void {
    if (!this.sim) return;
    const introStart = this.simStartTime + NETWORK.introLeadTime * 1000;
    const tickMs = SIM_DT * 1000;
    socket.emit('raceStart', {
      raceId: this.raceId,
      simStartTime: this.simStartTime,
      tickMs,
      introStartTime: introStart,
      goTick: this.sim.goTick,
      goTime: this.simStartTime + this.sim.goTick * tickMs,
      laps: this.sim.laps,
      participants: [...this.sim.players.values()].map((p) => ({ id: p.id, name: p.name, slot: p.slot, loadout: { ...p.loadout } })),
      crowdSuppress: [...this.sim.players.values()].map((p) => `${p.loadout.riderId}:${p.loadout.riderColor}`),
    });
  }

  private startLoop(): void {
    if (this.loopTimer) clearTimeout(this.loopTimer);
    const tickMs = SIM_DT * 1000;
    const snapEvery = Math.round(NETWORK.physicsHz / NETWORK.snapshotHz);
    const run = () => {
      if (!this.sim || this.phase !== 'RACE') return;
      const now = serverNow();
      const due = Math.floor((now - this.simStartTime) / tickMs);
      let steps = 0;
      while (this.sim.tick < due && steps < 8) {
        this.sim.step();
        steps++;
        this.updateRaceState();
        if (this.sim.tick % snapEvery === 0) this.sendSnapshots();
        if (this.phase !== 'RACE') return;
      }
      if (this.sim.tick < due - 30) {
        // Fell far behind (host stall); skip ahead rather than spiralling.
        this.simStartTime = now - this.sim.tick * tickMs;
      }
      this.loopTimer = setTimeout(run, Math.max(1, tickMs / 2));
    };
    run();
  }

  private updateRaceState(): void {
    const sim = this.sim!;
    const t = sim.tick * SIM_DT;
    const introOffset = NETWORK.introLeadTime;
    const goT = sim.goTick * SIM_DT;
    let state: RaceState = 'INTRO';
    if (t >= goT) state = sim.firstFinishTick !== null ? 'FINISHING' : 'RACING';
    else if (t >= introOffset + (introTotalDuration() - RACE.countdownSeconds)) state = 'COUNTDOWN';
    if (state !== this.raceState) {
      this.raceState = state;
      this.broadcastLobby();
    }
    if (sim.finishedAll) {
      if (!this.finishedAt) this.finishedAt = serverNow();
      if (serverNow() - this.finishedAt > 2500) this.finishRace();
    }
  }

  private finishRace(): void {
    if (!this.sim) return;
    const entries = this.sim.results();
    this.results = { raceId: this.raceId, entries: entries.map((e) => ({ ...e, loadout: { ...e.loadout } })) };
    this.phase = 'RESULTS';
    this.raceState = 'RESULTS';
    this.resultsAt = serverNow();
    this.sendSnapshots();
    for (const p of this.players.values()) p.socket?.emit('results', this.results);
    this.broadcastLobby();
    // Normally the host returns everyone to the lobby; if no host is connected the lobby reopens
    // by itself after the results hold so the session can never get stuck on the results board.
    if (this.resultsTimer) clearInterval(this.resultsTimer);
    this.resultsTimer = setInterval(() => {
      const host = this.hostId !== null ? this.players.get(this.hostId) : undefined;
      if (this.phase !== 'RESULTS') {
        if (this.resultsTimer) clearInterval(this.resultsTimer);
        this.resultsTimer = null;
      } else if (!host?.connected && serverNow() - this.resultsAt > RACE.resultsHold * 1000) this.returnToLobby();
    }, 1000);
  }

  private returnToLobby(): void {
    if (this.loopTimer) clearTimeout(this.loopTimer);
    this.loopTimer = null;
    if (this.resultsTimer) clearInterval(this.resultsTimer);
    this.resultsTimer = null;
    this.sim = null;
    this.crashWorld?.dispose();
    this.crashWorld = null;
    this.phase = 'LOBBY';
    this.raceState = 'LOBBY';
    this.results = null;
    for (const p of this.players.values()) p.ready = false;
    this.broadcastLobby();
  }

  private toSnap(p: PlayerRuntime): PlayerSnap {
    const b = p.bike;
    const riding = isRidingState(p.state) || p.state === 'GRID' || p.state === 'FINISHED' || p.state === 'RECOVERY_PENALTY';
    return {
      id: p.id,
      state: p.state,
      airborne: b.airborne,
      boosting: b.boostTime > 0,
      faceUp: p.faceUp,
      connected: p.connected,
      finished: p.progress.finished,
      dnf: p.progress.dnf,
      assistOn: b.assistOn,
      cheatActive: p.cheatActive,
      puddle: b.puddle,
      x: riding ? b.x : p.bikePos.x,
      y: riding ? b.y : p.bikePos.y,
      z: riding ? b.z : p.bikePos.z,
      yaw: b.yaw,
      pitch: b.pitch,
      lean: b.lean,
      bikeQ: p.bikeQ,
      rx: p.riderPos.x,
      ry: p.riderPos.y,
      rz: p.riderPos.z,
      riderQ: p.riderQ,
      riderYaw: p.riderYaw,
      speed: b.speed,
      steer: b.steer,
      lapDist: b.lapDist,
      s: b.s,
      lateral: b.lateral,
      nextCheckpoint: p.progress.next,
      position: p.position,
      attackId: p.attack.id,
      attackTime: p.attack.time,
      attackSide: p.attack.side,
      instability: b.instability,
      compression: b.compression,
      stateTime: p.stateTime,
      boostCharges: p.boostCharges,
      finishTime: p.finishTime,
      hitDir: b.hitDir,
    };
  }

  private sendSnapshots(): void {
    const sim = this.sim;
    if (!sim) return;
    const snaps = [...sim.players.values()].map((p) => this.toSnap(p));
    const buf = encodeSnapshot({ tick: sim.tick, serverTime: this.simStartTime + sim.tick * SIM_DT * 1000, raceState: this.raceState, goTick: sim.goTick }, snaps);
    const events = JSON.stringify(sim.drainEvents());
    for (const sp of this.players.values()) {
      if (!sp.socket) continue;
      const rp = sim.players.get(sp.id);
      let own: OwnStateMsg | null = null;
      if (rp) {
        own = {
          tick: sim.tick,
          lastSeq: rp.lastSeq,
          state: rp.state,
          stateTime: rp.stateTime,
          bike: { ...rp.bike },
          boostCharges: rp.boostCharges,
          cheatActive: rp.cheatActive,
          attackId: rp.attack.id,
          attackTime: rp.attack.time,
          attackSide: rp.attack.side,
          nextCheckpoint: rp.progress.next,
          lap: rp.progress.lap,
          laps: rp.progress.laps,
        };
      }
      sp.socket.emit('snap', buf, own, events);
    }
  }

  get resultsSince(): number {
    return this.resultsAt;
  }
}
