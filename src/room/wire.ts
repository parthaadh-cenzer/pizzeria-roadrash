// Hosted (public) mode wire format shared by the room relay, the host's room worker and joining
// clients. The relay only forwards opaque frames between one room's host and its peers.

/** Room codes avoid look-alike characters (0/O, 1/I/L) so they can be read aloud or typed. */
export const ROOM_CODE_ALPHABET = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789';
export const ROOM_CODE_LENGTH = 6;

export function newRoomCode(random: (n: number) => Uint8Array = defaultRandom): string {
  const b = random(ROOM_CODE_LENGTH);
  let s = '';
  for (let i = 0; i < ROOM_CODE_LENGTH; i++) s += ROOM_CODE_ALPHABET[b[i]! % ROOM_CODE_ALPHABET.length];
  return s;
}

function defaultRandom(n: number): Uint8Array {
  const b = new Uint8Array(n);
  globalThis.crypto.getRandomValues(b);
  return b;
}

/** Normalises user input / URL values into a room code, or null when it cannot be one. */
export function normalizeRoomCode(raw: unknown): string | null {
  if (typeof raw !== 'string') return null;
  const s = raw.trim().toUpperCase().replace(/[\s-]/g, '');
  if (s.length !== ROOM_CODE_LENGTH) return null;
  for (const ch of s) if (!ROOM_CODE_ALPHABET.includes(ch)) return null;
  return s;
}

/**
 * Room code from a join URL: `?room=CODE` (what the QR/link encodes) or a `/r/CODE` path.
 * Accepts absolute URLs, relative paths or a bare query string.
 */
export function roomCodeFromUrl(href: string): string | null {
  let u: URL;
  try {
    u = new URL(href, 'https://join.invalid/');
  } catch {
    return null;
  }
  const q = normalizeRoomCode(u.searchParams.get('room'));
  if (q) return q;
  const m = /\/r\/([^/?#]+)/.exec(u.pathname);
  return m ? normalizeRoomCode(decodeURIComponent(m[1]!)) : null;
}

/** The join link for a room on this deployment (the QR code encodes exactly this). */
export function joinUrlFor(origin: string, code: string): string {
  return `${origin.replace(/\/$/, '')}/?room=${code}`;
}

/** Relay socket path (same origin). */
export const RELAY_PATH = '/api/relay/socket.io';

// ------------------------------------------------------------------ frames
/** peer -> host: a client-to-server event (ack id when the sender expects a reply). */
export interface PeerFrame {
  ev: string;
  args: unknown[];
  ack?: number;
}
/** host -> peer: a server-to-client event, or the reply to a peer's ack. */
export interface HostFrame {
  ev?: string;
  args: unknown[];
  ack?: number;
}

/** Relay -> host control notices. */
export type HostNotice = { t: 'open'; pid: string } | { t: 'close'; pid: string };
/** Relay -> peers room notices. */
export type RoomNotice = { t: 'hostgone' } | { t: 'hostback' } | { t: 'closed'; reason: string };

// ------------------------------------------------------------------ binary-safe JSON (broker hops)
interface B64 {
  __b64: string;
  u8?: 1;
}

function toB64(u8: Uint8Array): string {
  if (typeof Buffer !== 'undefined') return Buffer.from(u8.buffer, u8.byteOffset, u8.byteLength).toString('base64');
  let s = '';
  for (let i = 0; i < u8.length; i++) s += String.fromCharCode(u8[i]!);
  return btoa(s);
}

function fromB64(s: string): Uint8Array {
  if (typeof Buffer !== 'undefined') return new Uint8Array(Buffer.from(s, 'base64'));
  const bin = atob(s);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

/** JSON that survives ArrayBuffers / typed arrays (snapshots) across a text pub/sub hop. */
export function encodeWire(v: unknown): string {
  return JSON.stringify(v, (_k, x: unknown) => {
    if (x instanceof ArrayBuffer) return { __b64: toB64(new Uint8Array(x)) } satisfies B64;
    if (ArrayBuffer.isView(x)) return { __b64: toB64(new Uint8Array(x.buffer, x.byteOffset, x.byteLength)), u8: 1 } satisfies B64;
    if (x && typeof x === 'object' && (x as { type?: string }).type === 'Buffer' && Array.isArray((x as { data?: unknown }).data)) {
      return { __b64: toB64(Uint8Array.from((x as { data: number[] }).data)), u8: 1 } satisfies B64;
    }
    return x;
  });
}

export function decodeWire<T = unknown>(s: string): T {
  return JSON.parse(s, (_k, x: unknown) => {
    if (x && typeof x === 'object' && typeof (x as B64).__b64 === 'string') {
      const u8 = fromB64((x as B64).__b64);
      return (x as B64).u8 ? u8 : u8.buffer.slice(u8.byteOffset, u8.byteOffset + u8.byteLength);
    }
    return x;
  }) as T;
}
