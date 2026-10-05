// Mounts the hosted-mode room relay (Socket.IO over WebSocket at RELAY_PATH) on HTTP servers.
// Used by the Vercel Function (api/relay.ts) and by the local host for development/testing.
import type http from 'node:http';
import type https from 'node:https';
import { Server } from 'socket.io';
import { RELAY_PATH } from '../../room/wire.js';
import { brokerFromEnv, type Broker } from './Broker.js';
import { RelayCore, type RelayOptions } from './RelayCore.js';

/** Comma-separated client origins allowed to use the relay; empty = any (same-origin and LAN setups). */
export function parseAllowedOrigins(v: string | undefined): string[] {
  return (v ?? '').split(',').map((s) => s.trim().replace(/\/+$/, '')).filter(Boolean);
}

export function originAllowed(origin: string | undefined, allowed: string[]): boolean {
  if (!allowed.length) return true;
  return !!origin && allowed.includes(origin);
}

export function attachRelay(servers: (http.Server | https.Server)[], broker: Broker = brokerFromEnv(), opts: RelayOptions = {}, allowedOrigins = parseAllowedOrigins(process.env.RELAY_ALLOWED_ORIGINS)): RelayCore {
  const io = new Server({
    path: RELAY_PATH,
    // Vercel Functions carry Socket.IO over WebSocket only (no HTTP long-polling).
    transports: ['websocket'],
    serveClient: false,
    cors: { origin: false },
    maxHttpBufferSize: 256 * 1024,
    // WebSocket upgrades are not subject to CORS: browsers send Origin, and the relay only admits
    // the configured client origins (RELAY_ALLOWED_ORIGINS) when that list is set.
    allowRequest: (req, cb) => cb(null, originAllowed(req.headers.origin, allowedOrigins)),
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
