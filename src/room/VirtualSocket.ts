// Room-side sockets that are not Socket.IO server sockets: the hosted room's own player (loopback
// in the host tab) and relay peers. They implement the RoomSocket subset Session relies on.
import type { RoomServer, RoomSocket } from './Session.js';

type Fn = (...args: unknown[]) => void;

export class VirtualRoomSocket implements RoomSocket {
  readonly id: string;
  readonly handshake: { address?: string };
  private handlers = new Map<string, Fn[]>();
  private closed = false;
  /**
   * @param send delivers a server-to-client event (or an ack reply) to the remote client.
   * @param kick called when the room force-disconnects this client (e.g. removed by the host).
   */
  constructor(
    id: string,
    private readonly send: (ev: string | null, args: unknown[], ack?: number) => void,
    private readonly kick: () => void = () => undefined,
    address?: string,
  ) {
    this.id = id;
    this.handshake = { address };
  }

  on(ev: string, fn: (...args: never[]) => unknown): unknown {
    const list = this.handlers.get(ev) ?? [];
    list.push(fn as unknown as Fn);
    this.handlers.set(ev, list);
    return this;
  }

  emit(ev: string, ...args: unknown[]): unknown {
    if (!this.closed) this.send(ev, args);
    return true;
  }

  disconnect(): unknown {
    if (this.closed) return this;
    this.kick();
    this.close();
    return this;
  }

  get isClosed(): boolean {
    return this.closed;
  }

  /** A client-to-server event arrived (an ack id makes the last handler argument a reply fn). */
  deliver(ev: string, args: unknown[], ack?: number): void {
    if (this.closed) return;
    const call = ack === undefined ? args : [...args, (...reply: unknown[]) => this.send(null, reply, ack)];
    for (const h of this.handlers.get(ev) ?? []) {
      try {
        h(...call);
      } catch (e) {
        console.error(`[room] handler for ${ev} failed`, e);
      }
    }
  }

  /** The transport to this client went away. */
  close(): void {
    if (this.closed) return;
    this.closed = true;
    for (const h of this.handlers.get('disconnect') ?? []) h();
    this.handlers.clear();
  }
}

export class VirtualRoomServer implements RoomServer {
  private onConn: ((s: RoomSocket) => void)[] = [];

  on(_ev: 'connection', fn: (s: RoomSocket) => void): unknown {
    this.onConn.push(fn);
    return this;
  }

  connect(s: VirtualRoomSocket): void {
    for (const f of this.onConn) f(s);
  }
}
