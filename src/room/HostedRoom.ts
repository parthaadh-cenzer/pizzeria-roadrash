// Hosted-mode room authority: the same Session (lobby, laps, race simulation, combat, crashes,
// checkpoints, cheat validation) as the LAN host, behind virtual sockets: one for the host's own
// player (a local loopback) and one per peer arriving through the room relay. Runs in a Web Worker
// in the host's browser tab (see hostWorker.ts); tests run it directly in Node.
import { io, type Socket } from 'socket.io-client';
import type { AssetStatus, ServerInfoMsg } from '../shared/protocol.js';
import { Session } from './Session.js';
import { VirtualRoomServer, VirtualRoomSocket } from './VirtualSocket.js';
import { RELAY_PATH, joinUrlFor, type HostNotice } from './wire.js';

/** Frames from the room to the host's own player, plus room status. */
export type RoomOutput =
  | { k: 's2c'; ev: string | null; args: unknown[]; ack?: number }
  | { k: 'ready' }
  | { k: 'room'; code: string; secret: string }
  | { k: 'relay'; up: boolean }
  | { k: 'error'; message: string };

const LOCAL_ID = 'local';
/** A peer that sent nothing (inputs/pings) for this long is treated as disconnected. */
const PEER_SILENCE_MS = 12_000;

export class HostedRoom {
  readonly session: Session;
  private server = new VirtualRoomServer();
  private local: VirtualRoomSocket;
  private relay: Socket | null = null;
  private peers = new Map<string, { sock: VirtualRoomSocket; seen: number }>();
  private silenceTimer: ReturnType<typeof setInterval>;
  code: string | null;
  private secret: string | null;
  /** Relay origin (defaults to the page origin, which also forms the join link). */
  private readonly relayOrigin: string;

  constructor(
    private readonly origin: string,
    private readonly out: (m: RoomOutput) => void,
    opts: { room?: string | null; secret?: string | null; relay?: string } = {},
  ) {
    this.relayOrigin = opts.relay ?? origin;
    this.code = opts.room ?? null;
    this.secret = opts.secret ?? null;
    const assets: AssetStatus = { ok: true, missingRequired: [], missingOptional: [], manifestVersion: null };
    this.session = new Session(this.server, (isLocal) => this.info(isLocal), () => assets, { isLocal: (s) => s.id === LOCAL_ID });
    this.local = new VirtualRoomSocket(LOCAL_ID, (ev, args, ack) => this.out({ k: 's2c', ev, args, ack }));
    this.server.connect(this.local);
    this.silenceTimer = setInterval(() => {
      const now = performance.now();
      for (const [pid, p] of this.peers) if (now - p.seen > PEER_SILENCE_MS) this.closePeer(pid);
    }, 2000);
    (this.silenceTimer as { unref?: () => void }).unref?.();
    this.out({ k: 'ready' });
    this.connectRelay();
  }

  private info(isLocal: boolean): ServerInfoMsg {
    const joinUrl = this.code ? joinUrlFor(this.origin, this.code) : this.origin;
    return { lanUrls: [], secureUrls: [], secure: this.origin.startsWith('https:'), joinUrl, qrSvg: '', caDownloadUrl: null, hostLocal: isLocal, version: '', roomCode: this.code };
  }

  /** A client-to-server event from the host's own player. */
  fromLocal(ev: string, args: unknown[], ack?: number): void {
    this.local.deliver(ev, args, ack);
  }

  /** Ends the room for every player (the host left). */
  close(reason: string): void {
    this.relay?.emit('close', reason);
    this.dispose();
  }

  dispose(): void {
    clearInterval(this.silenceTimer);
    this.session.dispose();
    for (const pid of [...this.peers.keys()]) this.closePeer(pid);
    const r = this.relay;
    this.relay = null;
    if (r) setTimeout(() => r.disconnect(), 200);
  }

  get peerCount(): number {
    return this.peers.size;
  }

  private openPeer(pid: string): void {
    this.peers.get(pid)?.sock.close();
    const sock = new VirtualRoomSocket(pid, (ev, args, ack) => {
      const r = this.relay;
      if (!r?.connected) return;
      if (ack !== undefined) r.emit('ha', pid, ack, args);
      else r.emit('hm', pid, ev, args);
    });
    this.peers.set(pid, { sock, seen: performance.now() });
    this.server.connect(sock);
  }

  private closePeer(pid: string): void {
    const p = this.peers.get(pid);
    if (!p) return;
    this.peers.delete(pid);
    p.sock.close();
  }

  private connectRelay(): void {
    const query = () => (this.code && this.secret ? { role: 'host', room: this.code, secret: this.secret } : { role: 'host' });
    const r = io(this.relayOrigin, { path: RELAY_PATH, transports: ['websocket'], reconnection: true, reconnectionDelay: 500, reconnectionDelayMax: 3000, query: query(), forceNew: true });
    this.relay = r;
    r.on('room', (m: { code: string; secret: string }) => {
      const reclaimed = this.code === m.code;
      this.code = m.code;
      this.secret = m.secret;
      // Later reconnects (the relay recycles connections) reclaim the same room.
      r.io.opts.query = query();
      this.out({ k: 'room', code: m.code, secret: m.secret });
      this.out({ k: 'relay', up: true });
      if (reclaimed) this.session.resync();
    });
    r.on('disconnect', () => this.out({ k: 'relay', up: false }));
    r.on('relayError', (e: { code: string; message: string }) => this.out({ k: 'error', message: e.message }));
    r.on('notice', (n: HostNotice) => {
      if (n.t === 'open') this.openPeer(n.pid);
      else if (n.t === 'close') this.closePeer(n.pid);
    });
    r.on('pm', (pid: string, ev: string, args: unknown[], ack: number | null) => {
      if (typeof pid !== 'string' || typeof ev !== 'string') return;
      let p = this.peers.get(pid);
      if (!p) {
        // Our relay link was recycled and missed the peer's "open": adopt it now.
        this.openPeer(pid);
        p = this.peers.get(pid)!;
      }
      p.seen = performance.now();
      p.sock.deliver(ev, Array.isArray(args) ? args : [], ack ?? undefined);
    });
  }
}
