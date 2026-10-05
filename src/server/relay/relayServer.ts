// Mounts the hosted-mode room relay (Socket.IO over WebSocket at RELAY_PATH) on HTTP servers.
// Used by the Vercel Function (api/relay.ts) and by the local host for development/testing.
import type http from 'node:http';
import type https from 'node:https';
import { Server } from 'socket.io';
import { RELAY_PATH } from '../../room/wire.js';
import { brokerFromEnv, type Broker } from './Broker.js';
import { RelayCore, type RelayOptions } from './RelayCore.js';

export function attachRelay(servers: (http.Server | https.Server)[], broker: Broker = brokerFromEnv(), opts: RelayOptions = {}): RelayCore {
  const io = new Server({
    path: RELAY_PATH,
    // Vercel Functions carry Socket.IO over WebSocket only (no HTTP long-polling).
    transports: ['websocket'],
    serveClient: false,
    cors: { origin: false },
    maxHttpBufferSize: 256 * 1024,
    pingInterval: 10_000,
    pingTimeout: 12_000,
  });
  for (const s of servers) io.attach(s);
  return new RelayCore(io, broker, opts);
}

/**
 * Normalises request URLs so the relay answers whether the platform passes the full path
 * (/api/relay/socket.io/...) or a function-relative one (/socket.io/...).
 */
export function normalizeRelayUrl(url: string | undefined): string {
  const u = url ?? '/';
  if (u.startsWith(RELAY_PATH)) return u;
  const i = u.indexOf('/socket.io');
  return i >= 0 ? RELAY_PATH + u.slice(i + '/socket.io'.length) : u;
}
