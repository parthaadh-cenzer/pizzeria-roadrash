// Cross-instance plumbing for the room relay: pub/sub channels plus a tiny TTL key store for the
// room registry. Production (several Vercel Function instances) uses Redis; local development,
// the LAN host and tests use the in-memory broker (one process = one instance, or several relay
// instances sharing one broker in tests to prove cross-instance routing).
import { Redis } from 'ioredis';

export interface Broker {
  readonly kind: 'memory' | 'redis';
  publish(channel: string, payload: string): Promise<void>;
  subscribe(channel: string, fn: (payload: string) => void): Promise<() => Promise<void>>;
  /** Set only if absent (room creation). */
  setNx(key: string, value: string, ttlSec: number): Promise<boolean>;
  get(key: string): Promise<string | null>;
  expire(key: string, ttlSec: number): Promise<void>;
  del(key: string): Promise<void>;
  close(): Promise<void>;
}

export class MemoryBroker implements Broker {
  readonly kind = 'memory' as const;
  private subs = new Map<string, Set<(p: string) => void>>();
  private kv = new Map<string, { v: string; until: number }>();

  async publish(channel: string, payload: string): Promise<void> {
    const set = this.subs.get(channel);
    if (!set) return;
    // Asynchronous like a real broker hop.
    for (const fn of [...set]) queueMicrotask(() => fn(payload));
  }

  async subscribe(channel: string, fn: (payload: string) => void): Promise<() => Promise<void>> {
    let set = this.subs.get(channel);
    if (!set) this.subs.set(channel, (set = new Set()));
    set.add(fn);
    return async () => {
      set!.delete(fn);
      if (!set!.size) this.subs.delete(channel);
    };
  }

  private live(key: string): { v: string; until: number } | null {
    const e = this.kv.get(key);
    if (!e) return null;
    if (Date.now() > e.until) {
      this.kv.delete(key);
      return null;
    }
    return e;
  }

  async setNx(key: string, value: string, ttlSec: number): Promise<boolean> {
    if (this.live(key)) return false;
    this.kv.set(key, { v: value, until: Date.now() + ttlSec * 1000 });
    return true;
  }

  async get(key: string): Promise<string | null> {
    return this.live(key)?.v ?? null;
  }

  async expire(key: string, ttlSec: number): Promise<void> {
    const e = this.live(key);
    if (e) e.until = Date.now() + ttlSec * 1000;
  }

  async del(key: string): Promise<void> {
    this.kv.delete(key);
  }

  async close(): Promise<void> {
    this.subs.clear();
  }
}

/** Redis broker: one command connection and one subscriber connection per relay instance. */
export class RedisBroker implements Broker {
  readonly kind = 'redis' as const;
  private cmd: Redis;
  private sub: Redis;
  private handlers = new Map<string, Set<(p: string) => void>>();

  constructor(url: string) {
    const opts = { maxRetriesPerRequest: 3, enableAutoPipelining: true, lazyConnect: false };
    this.cmd = new Redis(url, opts);
    this.sub = new Redis(url, opts);
    this.sub.on('message', (channel: string, payload: string) => {
      for (const fn of this.handlers.get(channel) ?? []) fn(payload);
    });
    for (const c of [this.cmd, this.sub]) c.on('error', (e: Error) => console.error('[relay] redis', e.message));
  }

  async publish(channel: string, payload: string): Promise<void> {
    await this.cmd.publish(channel, payload);
  }

  async subscribe(channel: string, fn: (payload: string) => void): Promise<() => Promise<void>> {
    let set = this.handlers.get(channel);
    if (!set) {
      this.handlers.set(channel, (set = new Set()));
      await this.sub.subscribe(channel);
    }
    set.add(fn);
    return async () => {
      set!.delete(fn);
      if (!set!.size) {
        this.handlers.delete(channel);
        await this.sub.unsubscribe(channel).catch(() => undefined);
      }
    };
  }

  async setNx(key: string, value: string, ttlSec: number): Promise<boolean> {
    return (await this.cmd.set(key, value, 'EX', ttlSec, 'NX')) === 'OK';
  }

  async get(key: string): Promise<string | null> {
    return this.cmd.get(key);
  }

  async expire(key: string, ttlSec: number): Promise<void> {
    await this.cmd.expire(key, ttlSec);
  }

  async del(key: string): Promise<void> {
    await this.cmd.del(key);
  }

  async close(): Promise<void> {
    this.cmd.disconnect();
    this.sub.disconnect();
  }
}

/** Redis when a connection URL is configured (Vercel Marketplace Redis), else in-memory. */
export function brokerFromEnv(env: NodeJS.ProcessEnv = process.env): Broker {
  const url = env.REDIS_URL || env.KV_URL || env.UPSTASH_REDIS_URL;
  return url ? new RedisBroker(url) : new MemoryBroker();
}
