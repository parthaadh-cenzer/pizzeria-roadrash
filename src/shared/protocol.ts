// Network protocol shared by the LAN host (server) and clients.
import type { BikeId, RaceState, RiderId, RiderState, WeaponId } from './ids.js';
import type { BikeState } from '../game/sim/types.js';

export const PROTOCOL_VERSION = 3;

export interface LoadoutMsg {
  riderId: RiderId;
  riderColor: number;
  bikeId: BikeId;
  bikeColor: number;
  weaponId: WeaponId;
}

export interface LobbyPlayer {
  id: number;
  name: string;
  connected: boolean;
  ready: boolean;
  isHost: boolean;
  loaded: boolean;
  slot: number;
  loadout: LoadoutMsg;
  device: 'desktop' | 'mobile';
}

export interface AssetStatus {
  ok: boolean;
  missingRequired: string[];
  missingOptional: string[];
  manifestVersion: string | null;
}

export interface LobbyStateMsg {
  phase: 'LOBBY' | 'RACE' | 'RESULTS';
  raceState: RaceState;
  players: LobbyPlayer[];
  hostId: number | null;
  maxPlayers: number;
  canStart: boolean;
  startBlockers: string[];
  assets: AssetStatus;
  /** Race length set by the host (1-5 laps). */
  laps: number;
  /** One lap of the track (m). */
  trackLength: number;
}

export interface ServerInfoMsg {
  lanUrls: string[];
  secureUrls: string[];
  secure: boolean;
  joinUrl: string;
  qrSvg: string;
  caDownloadUrl: string | null;
  hostLocal: boolean;
  version: string;
  /** Hosted (public) mode: the short room code that the join link/QR encodes. */
  roomCode?: string | null;
}

export interface WelcomeMsg {
  playerId: number;
  token: string;
  isHost: boolean;
  protocol: number;
  serverTime: number;
  info: ServerInfoMsg;
}

export interface RaceParticipant {
  id: number;
  name: string;
  slot: number;
  loadout: LoadoutMsg;
}

export interface RaceStartMsg {
  raceId: number;
  /** Server clock (ms) when tick 0 of the race simulation happened. */
  simStartTime: number;
  tickMs: number;
  introStartTime: number;
  goTick: number;
  goTime: number;
  /** Laps for this race (immutable once started). */
  laps: number;
  participants: RaceParticipant[];
  /** "riderId:color" appearances to suppress from the nearby crowd. */
  crowdSuppress: string[];
}

export interface OwnStateMsg {
  tick: number;
  lastSeq: number;
  state: RiderState;
  stateTime: number;
  bike: BikeState;
  boostCharges: number;
  cheatActive: boolean;
  attackId: string | null;
  attackTime: number;
  attackSide: number;
  nextCheckpoint: number;
  /** Laps completed / laps in the race. */
  lap: number;
  laps: number;
}

export interface ResultEntryMsg {
  id: number;
  name: string;
  position: number;
  finishTime: number | null;
  gap: number | null;
  dnf: boolean;
  loadout: LoadoutMsg;
}

export interface ResultsMsg {
  raceId: number;
  entries: ResultEntryMsg[];
}

export interface ErrorMsg {
  code: string;
  message: string;
}

/** Packed input tuple: [seq, throttle*255, brake*255, steer*127, flags]. */
export type PackedInput = [number, number, number, number, number];

export const INPUT_FLAG = { ANALOG: 1, AUTO: 2, KICK: 4, ATTACK: 8, BOOST: 16 } as const;

export interface ClientToServer {
  hello: (msg: { token: string | null; protocol: number; device: 'desktop' | 'mobile' }) => void;
  join: (msg: { name: string }) => void;
  claimHost: () => void;
  loadout: (msg: Partial<LoadoutMsg> & { name?: string }) => void;
  ready: (msg: { ready: boolean }) => void;
  start: () => void;
  /** Host only (lobby): race length 1-5 laps. */
  setLaps: (msg: { laps: number }) => void;
  removePlayer: (msg: { id: number }) => void;
  toLobby: () => void;
  /** Host only: ends the running race now; unfinished racers are DNF. */
  endRace: () => void;
  /** Leaves the session for good (mid-race: DNF). The ack lets the client reload afterwards. */
  leave: (ack?: () => void) => void;
  loaded: (msg: { ok: boolean; missing: string[] }) => void;
  inputs: (msg: { i: PackedInput[] }) => void;
  cheat: (msg: { phrase: string }) => void;
  ping: (msg: { t: number }, ack: (serverTime: number) => void) => void;
}

export interface ServerToClient {
  welcome: (msg: WelcomeMsg) => void;
  lobby: (msg: LobbyStateMsg) => void;
  raceStart: (msg: RaceStartMsg) => void;
  snap: (buf: ArrayBuffer, own: OwnStateMsg | null, events: string) => void;
  results: (msg: ResultsMsg) => void;
  cheatResult: (msg: { ok: boolean; charges: number }) => void;
  errorMsg: (msg: ErrorMsg) => void;
  kicked: (msg: { reason: string }) => void;
}
