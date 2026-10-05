// Long-running Node host for the hosted-mode room relay (api/relay.mjs, built by
// `npm run build:relay`): one process, WebSocket Socket.IO at /api/relay/socket.io, health at
// /api/relay/health. Rooms live in memory on a single instance; set REDIS_URL to run several.
// Environment: PORT (default 8080), RELAY_ALLOWED_ORIGINS (comma-separated client origins).
import server from './api/relay.mjs';

const port = Number(process.env.PORT) || 8080;
server.listen(port, '0.0.0.0', () => console.log(`[relay] listening on :${port}`));
for (const sig of ['SIGTERM', 'SIGINT']) process.on(sig, () => server.close(() => process.exit(0)));
