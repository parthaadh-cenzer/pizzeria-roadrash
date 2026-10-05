// Client connection to the room: the LAN host (Socket.IO over WS/WSS on the same origin), or in
// hosted mode the room relay (joining players) / the room worker (the host's own player).
import { io } from 'socket.io-client';
import type { GameSocket } from './transports.js';
import {
  PROTOCOL_VERSION,
  type ErrorMsg,
  type LobbyStateMsg,
  type OwnStateMsg,
  type RaceStartMsg,
  type ResultsMsg,
  type ServerInfoMsg,
  type WelcomeMsg,
} from '../shared/protocol.js';

type Handler<T> = (v: T) => void;

export interface NetEvents {
  welcome: WelcomeMsg;
  lobby: LobbyStateMsg;
  raceStart: RaceStartMsg;
  snap: { buf: ArrayBuffer; own: OwnStateMsg | null; events: string };
  results: ResultsMsg;
  error: ErrorMsg;
  kicked: { reason: string };
  cheatResult: { ok: boolean; charges: number };
  connection: { connected: boolean };
}

const TOKEN_KEY = 'pr.session';

/** NTP-style offset estimate between performance.now() and the host clock. */
export class ClockSync {
  offset = 0;
  rtt = 0;
  private samples: { offset: number; rtt: number }[] = [];

  add(t0: number, serverTime: number, t1: number): void {
    const rtt = t1 - t0;
    this.samples.push({ offset: serverTime - (t0 + rtt / 2), rtt });
    if (this.samples.length > 12) this.samples.shift();
    // Use the lowest-RTT samples (least queueing noise).
    const best = [...this.samples].sort((a, b) => a.rtt - b.rtt).slice(0, 4);
    this.offset = best.reduce((a, s) => a + s.offset, 0) / best.length;
    this.rtt = best.reduce((a, s) => a + s.rtt, 0) / best.length;
  }

  serverNow(): number {
    return performance.now() + this.offset;
  }
}

export class Net {
  readonly socket: GameSocket;
  readonly clock = new ClockSync();
  playerId = -1;
  isHost = false;
  info: ServerInfoMsg | null = null;
  lobby: LobbyStateMsg | null = null;
  connected = false;
  private handlers: { [K in keyof NetEvents]?: Handler<NetEvents[K]>[] } = {};
  private pingTimer: number | null = null;
  private helloTimer: number | null = null;
  private welcomed = false;

  /** @param socket hosted-mode transport; the LAN host's Socket.IO connection by default. */
  constructor(device: 'desktop' | 'mobile', socket?: GameSocket) {
    this.socket = socket ?? (io({ transports: ['websocket'], reconnection: true, reconnectionDelay: 500, reconnectionDelayMax: 3000 }) as unknown as GameSocket);
    const hello = () => {
      let token: string | null = null;
      try {
        token = sessionStorage.getItem(TOKEN_KEY);
      } catch {
        token = null;
      }
      this.socket.emit('hello', { token, protocol: PROTOCOL_VERSION, device });
    };
    this.socket.on('connect', () => {
      this.connected = true;
      this.welcomed = false;
      hello();
      // A relay hop can drop the first frame while a room's host reconnects: say hello again.
      if (this.helloTimer !== null) clearInterval(this.helloTimer);
      this.helloTimer = window.setInterval(() => {
        if (this.welcomed || !this.connected) {
          if (this.helloTimer !== null) clearInterval(this.helloTimer);
          this.helloTimer = null;
        } else hello();
      }, 2500);
      this.emit('connection', { connected: true });
      this.burstPing();
    });
    this.socket.on('disconnect', () => {
      this.connected = false;
      this.emit('connection', { connected: false });
    });
    this.socket.on('welcome', (m) => {
      this.welcomed = true;
      this.playerId = m.playerId;
      this.isHost = m.isHost;
      this.info = m.info;
      try {
        sessionStorage.setItem(TOKEN_KEY, m.token);
      } catch {
        /* private mode: identity lasts for this page only */
      }
      this.emit('welcome', m);
    });
    this.socket.on('lobby', (m) => {
      this.lobby = m;
      this.isHost = m.hostId === this.playerId;
      this.emit('lobby', m);
    });
    this.socket.on('raceStart', (m) => this.emit('raceStart', m));
    this.socket.on('snap', (buf, own, events) => this.emit('snap', { buf, own, events }));
    this.socket.on('results', (m) => this.emit('results', m));
    this.socket.on('errorMsg', (m) => this.emit('error', m));
    this.socket.on('kicked', (m) => {
      try {
        sessionStorage.removeItem(TOKEN_KEY);
      } catch {
        /* ignore */
      }
      this.emit('kicked', m);
    });
    this.socket.on('cheatResult', (m) => this.emit('cheatResult', m));
    this.pingTimer = window.setInterval(() => this.ping(), 2000);
  }

  on<K extends keyof NetEvents>(ev: K, h: Handler<NetEvents[K]>): () => void {
    const list = (this.handlers[ev] ??= []) as Handler<NetEvents[K]>[];
    list.push(h);
    return () => {
      const i = list.indexOf(h);
      if (i >= 0) list.splice(i, 1);
    };
  }

  private emit<K extends keyof NetEvents>(ev: K, v: NetEvents[K]): void {
    for (const h of (this.handlers[ev] ?? []) as Handler<NetEvents[K]>[]) {
      try {
        h(v);
      } catch (e) {
        console.error(`[net] handler for ${ev} failed`, e);
      }
    }
  }

  private ping(): void {
    if (!this.connected) return;
    const t0 = performance.now();
    this.socket.emit('ping', { t: t0 }, (serverTime: number) => this.clock.add(t0, serverTime, performance.now()));
  }

  private burstPing(): void {
    for (let i = 0; i < 6; i++) window.setTimeout(() => this.ping(), i * 120);
  }

  serverNow(): number {
    return this.clock.serverNow();
  }

  /** Leaves the session for good and forgets the reconnect identity. */
  leave(): Promise<void> {
    try {
      sessionStorage.removeItem(TOKEN_KEY);
    } catch {
      /* ignore */
    }
    return new Promise((resolve) => {
      const t = window.setTimeout(resolve, 800);
      this.socket.emit('leave', () => {
        clearTimeout(t);
        resolve();
      });
    });
  }

  dispose(): void {
    if (this.pingTimer) clearInterval(this.pingTimer);
    if (this.helloTimer !== null) clearInterval(this.helloTimer);
    this.handlers = {};
    this.socket.disconnect();
  }
}
