// Service worker routing (public/sw.js) in a sandbox: shell and runtime-asset caching strategies,
// offline fallback, pruning of stale runtime files, and never intercepting multiplayer traffic.
import fs from 'node:fs';
import vm from 'node:vm';
import { beforeEach, describe, expect, it } from 'vitest';

const ORIGIN = 'http://host.test';

class FakeCache {
  store = new Map<string, Response>();
  async match(req: Request | string): Promise<Response | undefined> {
    const r = this.store.get(typeof req === 'string' ? new URL(req, ORIGIN).href : req.url);
    return r?.clone();
  }
  async put(req: Request | string, res: Response): Promise<void> {
    this.store.set(typeof req === 'string' ? new URL(req, ORIGIN).href : req.url, res);
  }
  async addAll(urls: string[]): Promise<void> {
    for (const u of urls) this.store.set(new URL(u, ORIGIN).href, new Response(`precached ${u}`));
  }
  async keys(): Promise<Request[]> {
    return [...this.store.keys()].map((u) => new Request(u));
  }
  async delete(req: Request): Promise<boolean> {
    return this.store.delete(req.url);
  }
}

interface Sandbox {
  caches: { open(n: string): Promise<FakeCache>; keys(): Promise<string[]>; delete(n: string): Promise<boolean>; all: Map<string, FakeCache> };
  network: Map<string, () => Response>;
  fetched: string[];
  online: boolean;
  dispatch(type: string, event: object): void;
}

function loadSw(): Sandbox {
  const listeners = new Map<string, ((e: unknown) => void)[]>();
  const all = new Map<string, FakeCache>();
  const sb: Sandbox = {
    caches: {
      all,
      async open(n) {
        if (!all.has(n)) all.set(n, new FakeCache());
        return all.get(n)!;
      },
      async keys() {
        return [...all.keys()];
      },
      async delete(n) {
        return all.delete(n);
      },
    },
    network: new Map(),
    fetched: [],
    online: true,
    dispatch(type, event) {
      for (const l of listeners.get(type) ?? []) l(event);
    },
  };
  const self = {
    location: { origin: ORIGIN },
    addEventListener: (t: string, l: (e: unknown) => void) => listeners.set(t, [...(listeners.get(t) ?? []), l]),
    skipWaiting: () => Promise.resolve(),
    clients: { claim: () => Promise.resolve() },
  };
  const fetchImpl = async (req: Request) => {
    sb.fetched.push(new URL(req.url).pathname);
    if (!sb.online) throw new TypeError('network down');
    const make = sb.network.get(new URL(req.url).pathname);
    if (!make) return new Response('missing', { status: 404 });
    const res = make();
    Object.defineProperty(res, 'type', { value: 'basic' });
    return res;
  };
  vm.runInNewContext(fs.readFileSync('public/sw.js', 'utf8'), { self, caches: sb.caches, fetch: fetchImpl, URL, Response, Request, console, setTimeout, Promise });
  return sb;
}

/** Dispatches a fetch event; returns the response the worker supplied, or null if it passed. */
async function request(sb: Sandbox, path: string, init: RequestInit & { mode?: RequestMode } = {}): Promise<Response | null> {
  const req = new Request(ORIGIN + path, { method: init.method ?? 'GET', headers: init.headers });
  if (init.mode) Object.defineProperty(req, 'mode', { value: init.mode });
  let responded: Promise<Response> | null = null;
  const pending: Promise<unknown>[] = [];
  sb.dispatch('fetch', { request: req, respondWith: (p: Promise<Response>) => (responded = p), waitUntil: (p: Promise<unknown>) => pending.push(p) });
  if (!responded) return null;
  const res = await (responded as Promise<Response>);
  await Promise.all(pending);
  return res;
}

async function install(sb: Sandbox): Promise<void> {
  const waits: Promise<unknown>[] = [];
  sb.dispatch('install', { waitUntil: (p: Promise<unknown>) => waits.push(p) });
  sb.dispatch('activate', { waitUntil: (p: Promise<unknown>) => waits.push(p) });
  await Promise.all(waits);
}

let sb: Sandbox;
beforeEach(async () => {
  sb = loadSw();
  await install(sb);
});

describe('service worker', () => {
  it('precaches the client shell on install', async () => {
    const shell = [...sb.caches.all.entries()].find(([k]) => k.endsWith('-shell'))![1];
    const keys = (await shell.keys()).map((r) => new URL(r.url).pathname);
    expect(keys).toEqual(expect.arrayContaining(['/', '/manifest.webmanifest', '/icons/icon-192.png']));
  });

  it('never intercepts multiplayer, API, dev or certificate traffic', async () => {
    for (const p of ['/socket.io/?EIO=4&transport=websocket', '/api/info', '/__dev/snapshot', '/@vite/client', '/src/client/main.ts', '/ca.crt', '/setup']) {
      expect(await request(sb, p)).toBeNull();
    }
    expect(await request(sb, '/api/info', { method: 'POST' })).toBeNull();
    expect(sb.fetched).toEqual([]);
  });

  it('serves hashed runtime assets cache-first', async () => {
    let hits = 0;
    sb.network.set('/runtime-assets/bikes/bike.tron.lod0.75c6ce51a4.glb', () => {
      hits++;
      return new Response('glb-bytes');
    });
    const a = await request(sb, '/runtime-assets/bikes/bike.tron.lod0.75c6ce51a4.glb');
    const b = await request(sb, '/runtime-assets/bikes/bike.tron.lod0.75c6ce51a4.glb');
    expect(await a!.text()).toBe('glb-bytes');
    expect(await b!.text()).toBe('glb-bytes');
    expect(hits).toBe(1);
  });

  it('navigations are network-first with the cached shell as offline fallback', async () => {
    sb.network.set('/', () => new Response('fresh shell'));
    expect(await (await request(sb, '/', { mode: 'navigate' }))!.text()).toBe('fresh shell');
    sb.online = false;
    expect(await (await request(sb, '/lobby', { mode: 'navigate' }))!.text()).toBe('fresh shell');
  });

  it('prunes runtime files that a new manifest no longer lists', async () => {
    sb.network.set('/runtime-assets/anim/run.old1234567.json', () => new Response('old'));
    sb.network.set('/runtime-assets/anim/run.new7654321.json', () => new Response('new'));
    await request(sb, '/runtime-assets/anim/run.old1234567.json');
    await request(sb, '/runtime-assets/anim/run.new7654321.json');
    sb.network.set('/runtime-assets/manifest.json', () => new Response(JSON.stringify({ entries: { 'clip.run': { files: { clip: 'anim/run.new7654321.json' } } } })));
    await request(sb, '/runtime-assets/manifest.json');
    const assets = [...sb.caches.all.entries()].find(([k]) => k.endsWith('-assets'))![1];
    const keys = (await assets.keys()).map((r) => new URL(r.url).pathname);
    expect(keys).toContain('/runtime-assets/anim/run.new7654321.json');
    expect(keys).not.toContain('/runtime-assets/anim/run.old1234567.json');
    // The manifest itself stays available offline.
    sb.online = false;
    expect((await request(sb, '/runtime-assets/manifest.json'))!.ok).toBe(true);
  });

  it('drops caches from older worker versions on activate', async () => {
    const fresh = loadSw();
    await fresh.caches.open('rr-0.9.0-assets');
    await install(fresh);
    expect(await fresh.caches.keys()).not.toContain('rr-0.9.0-assets');
  });
});
