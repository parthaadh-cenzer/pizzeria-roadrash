// Pizzeria Roadrash service worker.
// - Client shell (index + hashed Vite bundles + manifest/icons): network-first for navigations so a
//   host update is picked up immediately, cache fallback so the shell still opens when the host is
//   briefly unreachable (multiplayer itself always needs the LAN host; the app says so).
// - Runtime assets under /runtime-assets/: content-hashed file names, so cache-first; entries no
//   longer listed by the current runtime manifest are pruned whenever a fresh manifest arrives.
// - Never touches Socket.IO, the host API, dev endpoints, Vite dev-server modules or certificates.
const VERSION = 'rr-1.0.0';
const SHELL = `${VERSION}-shell`;
const ASSETS = `${VERSION}-assets`;
const SHELL_PRECACHE = ['/', '/manifest.webmanifest', '/icons/icon-180.png', '/icons/icon-192.png', '/icons/icon-512.png', '/icons/icon-512-maskable.png'];

const BYPASS = [/^\/socket\.io\//, /^\/api\//, /^\/__dev\//, /^\/@vite\//, /^\/@fs\//, /^\/@id\//, /^\/src\//, /^\/node_modules\//, /^\/ca\.(crt|pem|cer)$/, /^\/setup/];

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches
      .open(SHELL)
      .then((c) => c.addAll(SHELL_PRECACHE))
      .catch((e) => console.warn('[sw] shell precache incomplete', e))
      .then(() => self.skipWaiting()),
  );
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) => Promise.all(keys.filter((k) => k !== SHELL && k !== ASSETS).map((k) => caches.delete(k))))
      .then(() => self.clients.claim()),
  );
});

async function networkFirst(request, cacheName) {
  const cache = await caches.open(cacheName);
  try {
    const res = await fetch(request);
    if (res.ok && res.type === 'basic') await cache.put(request, res.clone());
    return res;
  } catch (e) {
    const hit = (await cache.match(request)) || (request.mode === 'navigate' ? await cache.match('/') : undefined);
    if (hit) return hit;
    throw e;
  }
}

async function cacheFirst(request, cacheName) {
  const cache = await caches.open(cacheName);
  const hit = await cache.match(request);
  if (hit) return hit;
  const res = await fetch(request);
  if (res.ok && res.type === 'basic' && res.status === 200) await cache.put(request, res.clone());
  return res;
}

/** Drop cached runtime files that the current manifest no longer references (old hashes). */
async function pruneRuntime(manifestResponse) {
  try {
    const m = await manifestResponse.json();
    const keep = new Set(['/runtime-assets/manifest.json']);
    for (const entry of Object.values(m.entries || {})) {
      for (const f of Object.values(entry.files || {})) {
        if (typeof f === 'string') keep.add(`/runtime-assets/${f}`);
        else if (Array.isArray(f)) for (const g of f) if (typeof g === 'string') keep.add(`/runtime-assets/${g}`);
      }
    }
    const cache = await caches.open(ASSETS);
    for (const req of await cache.keys()) {
      const p = new URL(req.url).pathname;
      if (p.startsWith('/runtime-assets/') && !keep.has(p)) await cache.delete(req);
    }
  } catch (e) {
    console.warn('[sw] runtime cache prune skipped', e);
  }
}

self.addEventListener('fetch', (event) => {
  const req = event.request;
  if (req.method !== 'GET') return;
  const url = new URL(req.url);
  if (url.origin !== self.location.origin) return;
  const p = url.pathname;
  if (p === '/sw.js' || BYPASS.some((r) => r.test(p))) return;
  if (req.headers.get('range')) return;

  if (p === '/runtime-assets/manifest.json') {
    event.respondWith(
      networkFirst(req, ASSETS).then((res) => {
        if (res.ok) event.waitUntil(pruneRuntime(res.clone()));
        return res;
      }),
    );
    return;
  }
  if (p.startsWith('/runtime-assets/')) {
    event.respondWith(cacheFirst(req, ASSETS));
    return;
  }
  if (req.mode === 'navigate') {
    event.respondWith(networkFirst(req, SHELL));
    return;
  }
  // Vite production bundles are content-hashed.
  if (p.startsWith('/assets/')) {
    event.respondWith(cacheFirst(req, SHELL));
    return;
  }
  if (p === '/manifest.webmanifest' || p.startsWith('/icons/')) {
    event.respondWith(networkFirst(req, SHELL));
  }
});
