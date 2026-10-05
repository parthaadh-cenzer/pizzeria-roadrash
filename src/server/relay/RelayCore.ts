// Hosted-mode room relay. The authoritative room (lobby, laps, race simulation, combat, crashes,
// checkpoints, cheat validation) runs in the host's browser; this relay only forwards frames
// between that host and the peers of the same room, across relay instances via the broker. All
// routing keys include the room code, so rooms cannot see or address each other.
import type { Server, Socket } from 'socket.io';
import { decodeWire, encodeWire, newRoomCode, normalizeRoomCode, type HostFrame, type HostNotice, type PeerFrame, type RoomNotice } from '../../room/wire.js';
import type { Broker } from './Broker.js';

export interface RelayOptions {
  /** Room registry lifetime without a connected host (s): the host may reconnect within it. */
  roomTtlSec?: number;
  /** Registry refresh interval while the host is connected (s). */
  heartbeatSec?: number;
}

/** Messages on a room channel (to the host / to one peer / to every peer). */
type ToHost = { k: 'n'; n: HostNotice } | { k: 'f'; pid: string; f: PeerFrame };
type ToPeer = { k: 'f'; f: HostFrame } | { k: 'x' };
type ToRoom = { k: 'n'; n: RoomNotice };

const key = (code: string) => `rr:room:${code}`;
const hostCh = (code: string) => `rr:h:${code}`;
const peerCh = (code: string, pid: string) => `rr:p:${code}:${pid}`;
const roomCh = (code: string) => `rr:b:${code}`;

const PEER_KEY = /^[a-z0-9]{8,64}$/i;

export class RelayCore {
  readonly broker: Broker;
  private ttl: number;
  private beat: number;
  /** Channels with a subscriber on this instance: delivered locally without a broker hop. */
  private local = new Map<string, (msg: unknown) => void>();
  rooms = 0;

  constructor(io: Server, broker: Broker, opts: RelayOptions = {}) {
    this.broker = broker;
    this.ttl = opts.roomTtlSec ?? 90;
    this.beat = opts.heartbeatSec ?? 20;
    io.on('connection', (s) => {
      const q = s.handshake.query;
      if (q.role === 'host') void this.onHost(s, q);
      else if (q.role === 'peer') void this.onPeer(s, q);
      else s.disconnect(true);
    });
  }

  /** Room exists (a host created it and it has not expired or been closed). */
  async roomExists(code: string): Promise<boolean> {
    return (await this.broker.get(key(code))) !== null;
  }

  private async route(channel: string, msg: unknown): Promise<void> {
    const here = this.local.get(channel);
    if (here) return here(msg);
    await this.broker.publish(channel, encodeWire(msg));
  }

  private async listen(channel: string, fn: (msg: unknown) => void, localOnly = true): Promise<() => Promise<void>> {
    if (localOnly) this.local.set(channel, fn);
    const off = await this.broker.subscribe(channel, (p) => fn(decodeWire(p)));
    return async () => {
      if (this.local.get(channel) === fn) this.local.delete(channel);
      await off();
    };
  }

  // ---------------------------------------------------------------- host
  private async onHost(s: Socket, q: Record<string, unknown>): Promise<void> {
    let code = normalizeRoomCode(q.room);
    const secret = typeof q.secret === 'string' && q.secret.length >= 16 ? q.secret : null;
    if (code && secret) {
      const cur = await this.broker.get(key(code));
      if (cur !== null && (JSON.parse(cur) as { secret: string }).secret !== secret) {
        s.emit('relayError', { code: 'ROOM_TAKEN', message: 'That room belongs to another host.' });
        s.disconnect(true);
        return;
      }
      // Reclaim (the registry may have expired while the host's connection was being recycled).
      if (cur === null && !(await this.broker.setNx(key(code), JSON.stringify({ secret }), this.ttl))) {
        s.emit('relayError', { code: 'ROOM_TAKEN', message: 'That room code is in use.' });
        s.disconnect(true);
        return;
      }
    } else {
      const fresh = randomSecret();
      code = null;
      for (let i = 0; i < 12 && !code; i++) {
        const c = newRoomCode();
        if (await this.broker.setNx(key(c), JSON.stringify({ secret: fresh }), this.ttl)) code = c;
      }
      if (!code) {
        s.emit('relayError', { code: 'NO_ROOM', message: 'Could not allocate a room. Try again.' });
        s.disconnect(true);
        return;
      }
      q = { ...q, secret: fresh };
    }
    const roomCode = code;
    const hostSecret = (q.secret as string) ?? secret;
    if (!s.connected) return;
    this.rooms++;
    let closed = false;
    const off = await this.listen(hostCh(roomCode), (m) => {
      const msg = m as ToHost;
      if (msg.k === 'n') s.emit('notice', msg.n);
      else s.emit('pm', msg.pid, msg.f.ev, msg.f.args, msg.f.ack ?? null);
    });
    const heartbeat = setInterval(() => void this.broker.expire(key(roomCode), this.ttl), this.beat * 1000);
    s.on('hm', (pid: unknown, ev: unknown, args: unknown) => {
      if (typeof pid !== 'string' || typeof ev !== 'string' || !Array.isArray(args)) return;
      void this.route(peerCh(roomCode, pid), { k: 'f', f: { ev, args } } satisfies ToPeer);
    });
    s.on('ha', (pid: unknown, ack: unknown, args: unknown) => {
      if (typeof pid !== 'string' || typeof ack !== 'number' || !Array.isArray(args)) return;
      void this.route(peerCh(roomCode, pid), { k: 'f', f: { ack, args } } satisfies ToPeer);
    });
    s.on('close', (reason: unknown) => {
      closed = true;
      void this.broker.publish(roomCh(roomCode), encodeWire({ k: 'n', n: { t: 'closed', reason: typeof reason === 'string' ? reason.slice(0, 120) : 'The host closed the room.' } } satisfies ToRoom));
      void this.broker.del(key(roomCode));
      s.disconnect(true);
    });
    s.on('disconnect', () => {
      clearInterval(heartbeat);
      this.rooms--;
      void off();
      if (!closed) void this.broker.publish(roomCh(roomCode), encodeWire({ k: 'n', n: { t: 'hostgone' } } satisfies ToRoom));
    });
    s.emit('room', { code: roomCode, secret: hostSecret });
    void this.broker.publish(roomCh(roomCode), encodeWire({ k: 'n', n: { t: 'hostback' } } satisfies ToRoom));
  }

  // ---------------------------------------------------------------- peers
  private async onPeer(s: Socket, q: Record<string, unknown>): Promise<void> {
    const code = normalizeRoomCode(q.room);
    const pid = typeof q.key === 'string' && PEER_KEY.test(q.key) ? q.key : null;
    if (!code || !pid || !(await this.roomExists(code))) {
      s.emit('relayError', { code: 'ROOM_NOT_FOUND', message: code ? `Room ${code} was not found. It may have closed.` : 'That is not a valid room code.' });
      s.disconnect(true);
      return;
    }
    // A newer connection with this identity replaces an older one (possibly on another instance).
    await this.route(peerCh(code, pid), { k: 'x' } satisfies ToPeer);
    if (!s.connected) return;
    const offPeer = await this.listen(peerCh(code, pid), (m) => {
      const msg = m as ToPeer;
      if (msg.k === 'x') {
        s.disconnect(true);
        return;
      }
      if (msg.f.ack !== undefined) s.emit('a', msg.f.ack, msg.f.args);
      else s.emit('m', msg.f.ev, msg.f.args);
    });
    const offRoom = await this.listen(roomCh(code), (m) => s.emit('notice', (m as ToRoom).n), false);
    s.on('m', (ev: unknown, args: unknown, ack: unknown) => {
      if (typeof ev !== 'string' || !Array.isArray(args)) return;
      const f: PeerFrame = { ev, args };
      if (typeof ack === 'number') f.ack = ack;
      void this.route(hostCh(code), { k: 'f', pid, f } satisfies ToHost);
    });
    s.on('disconnect', () => {
      void offPeer();
      void offRoom();
      void this.route(hostCh(code), { k: 'n', n: { t: 'close', pid } } satisfies ToHost);
    });
    s.emit('joined', { code });
    void this.route(hostCh(code), { k: 'n', n: { t: 'open', pid } } satisfies ToHost);
  }
}

function randomSecret(): string {
  const b = new Uint8Array(24);
  globalThis.crypto.getRandomValues(b);
  return Array.from(b, (x) => x.toString(16).padStart(2, '0')).join('');
}
