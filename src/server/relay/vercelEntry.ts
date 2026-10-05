// Vercel Function: the hosted-mode room relay (Socket.IO over WebSocket, Fluid compute). Stateless
// apart from connections: rooms are registered and routed through Redis (REDIS_URL) so players of
// one room may land on different function instances. The game authority runs in the host's tab.
import http from 'node:http';
import { attachRelay, normalizeRelayUrl } from './relayServer.js';

const server = http.createServer((req, res) => {
  if ((req.url ?? '').includes('/health')) {
    res.setHeader('content-type', 'application/json');
    res.setHeader('cache-control', 'no-store');
    res.end(JSON.stringify({ ok: true, broker: relay.broker.kind, rooms: relay.rooms }));
    return;
  }
  res.statusCode = 404;
  res.end('Pizzeria Roadrash room relay');
});

const relay = attachRelay([server]);

// Runs before Socket.IO's own listeners.
for (const ev of ['request', 'upgrade'] as const) {
  server.prependListener(ev, (req: http.IncomingMessage) => {
    req.url = normalizeRelayUrl(req.url);
  });
}

export default server;
