// Client-side sockets for the hosted (public) mode. Both present the small socket.io-client API
// the game uses (on / emit / volatile.emit / connected / disconnect), so Net and the rest of the
// client are unchanged:
//  - RelayClientSocket: a joining player, through the room relay to the host's room.
//  - WorkerClientSocket: the host's own player, straight into the room worker in the same tab.
import { io, type Socket } from 'socket.io-client';
import type { ClientToServer, ServerToClient } from '../shared/protocol.js';
import { RELAY_PATH, type RoomNotice } from '../room/wire.js';

type Fn = (...args: unknown[]) => void;

/** The socket surface the client uses (socket.io-client's Socket satisfies it structurally). */
export interface GameSocket {
  readonly connected: boolean;
  on<E extends keyof ServerToClient>(ev: E, fn: ServerToClient[E]): unknown;
  on(ev: 'connect' | 'disconnect', fn: () => void): unknown;
  emit<E extends keyof ClientToServer>(ev: E, ...args: Parameters<ClientToServer[E]>): unknown;
  readonly volatile: { emit<E extends keyof ClientToServer>(ev: E, ...args: Parameters<ClientToServer[E]>): unknown };
  disconnect(): unknown;
}

/** Room-level events for hosted mode (not part of the game protocol). */
export interface RoomEvents {
  /** Joining failed (bad or expired room code). */
  roomError: (msg: { code: string; message: string }) => void;
  /** The host closed the room or left for good. */
  roomClosed: (msg: { reason: string }) => void;
  /** Hosted room identity (host side: once the relay allocated it). */
  room: (msg: { code: string }) => void;
}

/** Shared frame plumbing: event handlers, acks, connect/disconnect notifications. */
abstract class FrameSocket {
  protected handlers = new Map<string, Fn[]>();
  private acks = new Map<number, Fn>();
  private ackSeq = 1;
  connected = false;
  readonly volatile = { emit: (ev: string, ...args: unknown[]) => this.emit(ev, ...args) };

  on(ev: string, fn: (...args: never[]) => unknown): this {
    const list = this.handlers.get(ev) ?? [];
    list.push(fn as unknown as Fn);
    this.handlers.set(ev, list);
    return this;
  }

  off(ev: string, fn: (...args: never[]) => unknown): this {
    const list = this.handlers.get(ev);
    if (list) this.handlers.set(ev, list.filter((f) => f !== (fn as unknown as Fn)));
    return this;
  }

  emit(ev: string, ...args: unknown[]): this {
    if (!this.connected) return this;
    let ack: number | undefined;
    if (typeof args[args.length - 1] === 'function') {
      ack = this.ackSeq++;
      this.acks.set(ack, args.pop() as Fn);
      if (this.acks.size > 64) this.acks.delete(this.acks.keys().next().value!);
    }
    this.sendFrame(ev, args, ack);
    return this;
  }

  protected abstract sendFrame(ev: string, args: unknown[], ack?: number): void;

  protected fire(ev: string, ...args: unknown[]): void {
    for (const h of this.handlers.get(ev) ?? []) {
      try {
        h(...args);
      } catch (e) {
        console.error(`[net] handler for ${ev} failed`, e);
      }
    }
  }

  protected receive(ev: string | null | undefined, args: unknown[], ack?: number | null): void {
    if (ack !== undefined && ack !== null) {
      const fn = this.acks.get(ack);
      this.acks.delete(ack);
      fn?.(...args);
    } else if (ev) this.fire(ev, ...args);
  }

  protected setConnected(c: boolean): void {
    if (c === this.connected) return;
    this.connected = c;
    this.fire(c ? 'connect' : 'disconnect');
  }
}

/** A stable per-tab identity so relay reconnects map back to the same room socket. */
function peerKey(): string {
  const k = 'pr.peerKey';
  try {
    const cur = sessionStorage.getItem(k);
    if (cur && /^[a-z0-9]{16,64}$/i.test(cur)) return cur;
  } catch {
    /* private mode */
  }
  const b = new Uint8Array(16);
  crypto.getRandomValues(b);
  const v = Array.from(b, (x) => x.toString(16).padStart(2, '0')).join('');
  try {
    sessionStorage.setItem(k, v);
  } catch {
    /* ignore */
  }
  return v;
}

/** A joining player: relay -> host room. Connected while both the relay and the host are up. */
export class RelayClientSocket extends FrameSocket {
  readonly code: string;
  private sock: Socket;
  private hostUp = true;
  private goneTimer: number | null = null;
  /** Gives up when the host has been gone this long (it would have reclaimed the room by now). */
  static hostGoneTimeoutMs = 45_000;

  constructor(code: string, origin = location.origin) {
    super();
    this.code = code;
    this.sock = io(origin, { path: RELAY_PATH, transports: ['websocket'], query: { role: 'peer', room: code, key: peerKey() }, reconnection: true, reconnectionDelay: 500, reconnectionDelayMax: 3000 });
    this.sock.on('joined', () => {
      this.hostUp = true;
      this.setConnected(true);
    });
    this.sock.on('disconnect', () => this.setConnected(false));
    this.sock.on('m', (ev: string, args: unknown[]) => this.receive(ev, args));
    this.sock.on('a', (ack: number, args: unknown[]) => this.receive(null, args, ack));
    this.sock.on('notice', (n: RoomNotice) => this.onNotice(n));
    this.sock.on('relayError', (e: { code: string; message: string }) => {
      this.sock.io.opts.reconnection = false;
      this.fire('roomError', e);
    });
  }

  private onNotice(n: RoomNotice): void {
    if (n.t === 'hostgone') {
      this.hostUp = false;
      this.setConnected(false);
      if (this.goneTimer === null) this.goneTimer = window.setTimeout(() => this.fire('roomClosed', { reason: 'The host left the game.' }), RelayClientSocket.hostGoneTimeoutMs);
    } else if (n.t === 'hostback') {
      if (this.goneTimer !== null) clearTimeout(this.goneTimer);
      this.goneTimer = null;
      this.hostUp = true;
      if (this.sock.connected) this.setConnected(true);
    } else if (n.t === 'closed') {
      this.sock.io.opts.reconnection = false;
      this.fire('roomClosed', { reason: n.reason });
      this.disconnect();
    }
  }

  protected sendFrame(ev: string, args: unknown[], ack?: number): void {
    if (!this.hostUp) return;
    if (ack === undefined) this.sock.emit('m', ev, args);
    else this.sock.emit('m', ev, args, ack);
  }

  disconnect(): this {
    if (this.goneTimer !== null) clearTimeout(this.goneTimer);
    this.sock.io.opts.reconnection = false;
    this.sock.disconnect();
    this.setConnected(false);
    return this;
  }
}

/** Messages between the host tab and its room worker. */
export type ToWorker =
  | { k: 'init'; origin: string; relay: string; room: string | null; secret: string | null }
  | { k: 'c2s'; ev: string; args: unknown[]; ack?: number }
  | { k: 'close'; reason: string };
export type FromWorker = import('../room/HostedRoom.js').RoomOutput;

/** The host's own player: frames go straight to the room worker in this tab (no network hop). */
export class WorkerClientSocket extends FrameSocket {
  readonly worker: Worker;
  code: string | null = null;
  relayUp = false;

  constructor(worker: Worker, init: { origin: string; relay: string; room: string | null; secret: string | null }) {
    super();
    this.worker = worker;
    worker.onmessage = (e: MessageEvent<FromWorker>) => {
      const m = e.data;
      if (m.k === 's2c') this.receive(m.ev, m.args, m.ack);
      else if (m.k === 'ready') this.setConnected(true);
      else if (m.k === 'room') {
        this.code = m.code;
        this.fire('room', { code: m.code, secret: m.secret });
      } else if (m.k === 'relay') {
        this.relayUp = m.up;
        this.fire('relay', { up: m.up });
      } else if (m.k === 'error') this.fire('roomError', { code: 'HOST', message: m.message });
    };
    worker.onerror = (e) => this.fire('roomError', { code: 'HOST', message: e.message || 'The room worker failed.' });
    worker.postMessage({ k: 'init', ...init } satisfies ToWorker);
  }

  protected sendFrame(ev: string, args: unknown[], ack?: number): void {
    this.worker.postMessage({ k: 'c2s', ev, args, ack } satisfies ToWorker);
  }

  /** Ends the room for everyone (host left). */
  closeRoom(reason: string): void {
    this.worker.postMessage({ k: 'close', reason } satisfies ToWorker);
  }

  disconnect(): this {
    this.setConnected(false);
    this.worker.terminate();
    return this;
  }
}
