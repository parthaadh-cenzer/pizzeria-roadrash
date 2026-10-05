// Pizzeria Roadrash LAN host. One local PC/laptop runs this; phones and desktops on the same
// Wi-Fi/LAN join through the displayed URL/QR code. No cloud backend is involved.
import express from 'express';
import fs from 'node:fs';
import http from 'node:http';
import https from 'node:https';
import net from 'node:net';
import path from 'node:path';
import QRCode from 'qrcode';
import { Server } from 'socket.io';
import { initRapier } from '../physics/CrashWorld.js';
import type { ClientToServer, ServerInfoMsg, ServerToClient } from '../shared/protocol.js';
import { checkRuntimeAssets } from './assets.js';
import { ensureServerCert, type CertBundle } from './certs.js';
import { isLocalAddress, lanAddresses } from './lan.js';
import { Session, type RoomServer } from '../room/Session.js';
import { renderSetupPage } from './setupPage.js';
import { attachRelay } from './relay/relayServer.js';

const args = process.argv.slice(2);
const flag = (name: string) => args.includes(`--${name}`);
const opt = (name: string, def: number) => {
  const a = args.find((x) => x.startsWith(`--${name}=`));
  return a ? Number(a.split('=')[1]) : def;
};

const DEV = flag('dev');
const SECURE = flag('secure');
const HTTP_PORT = opt('port', Number(process.env.PORT ?? 7373));
const HTTPS_PORT = opt('https-port', Number(process.env.HTTPS_PORT ?? 7443));
const VERSION = JSON.parse(fs.readFileSync(path.resolve('package.json'), 'utf8')).version as string;
const STATIC_ROOT = DEV ? path.resolve('public') : path.resolve('dist/client');

async function main(): Promise<void> {
  await initRapier();
  const app = express();
  app.disable('x-powered-by');

  let certs: CertBundle | null = null;
  if (SECURE) certs = await ensureServerCert();

  const httpServer = http.createServer(app);
  const httpsServer = certs ? https.createServer({ key: certs.key, cert: certs.cert }, app) : null;

  const lan = () => lanAddresses().map((l) => l.address);
  const lanUrls = () => lan().map((ip) => `http://${ip}:${HTTP_PORT}/`);
  const secureUrls = () => (httpsServer ? lan().map((ip) => `https://${ip}:${HTTPS_PORT}/`) : []);
  const joinUrl = () => (SECURE ? secureUrls()[0] : lanUrls()[0]) ?? `http://localhost:${HTTP_PORT}/`;

  let qrCache = { url: '', svg: '' };
  const qrSvg = async () => {
    const url = joinUrl();
    if (qrCache.url !== url) qrCache = { url, svg: await QRCode.toString(url, { type: 'svg', margin: 1, errorCorrectionLevel: 'M' }) };
    return qrCache.svg;
  };
  await qrSvg();

  const infoFor = (local: boolean): ServerInfoMsg => ({
    lanUrls: lanUrls(),
    secureUrls: secureUrls(),
    secure: SECURE,
    joinUrl: joinUrl(),
    qrSvg: qrCache.svg,
    caDownloadUrl: certs ? `http://${lan()[0] ?? 'localhost'}:${HTTP_PORT}/ca.crt` : null,
    hostLocal: local,
    version: VERSION,
  });

  // ------------------------------------------------------------ HTTP routes
  // Raw source assets are never served (runtime assets come from /runtime-assets only).
  app.use((req, res, next) => {
    // Case-sensitive on purpose: /assets/ is the production bundle directory.
    if (!/^\/(Assets|HANDOFF|\.certs|\.pipeline-cache)(\/|$)/.test(req.path)) return next();
    res.status(404).type('text/plain').send('Not served: source assets stay on the host. Clients load /runtime-assets only.');
  });
  app.get('/api/info', async (_req, res) => {
    await qrSvg();
    res.json({ ...infoFor(false), assets: checkRuntimeAssets(STATIC_ROOT) });
  });
  if (certs) {
    const caPem = certs.caCert;
    app.get('/ca.crt', (_req, res) => {
      res.setHeader('Content-Type', 'application/x-x509-ca-cert');
      res.setHeader('Content-Disposition', 'attachment; filename="pizzeria-roadrash-ca.crt"');
      res.send(caPem);
    });
    app.get('/setup', (_req, res) => {
      res.type('html').send(renderSetupPage({ secureUrl: secureUrls()[0] ?? `https://localhost:${HTTPS_PORT}/`, caUrl: '/ca.crt' }));
    });
  }

  const io = new Server<ClientToServer, ServerToClient>({
    serveClient: false,
    cors: { origin: false },
    maxHttpBufferSize: 64 * 1024,
    pingInterval: 5000,
    pingTimeout: 8000,
  });
  io.attach(httpServer);
  if (httpsServer) io.attach(httpsServer);
  // Hosted-mode room relay on the same host (development / testing of the public flow; an
  // in-memory broker unless REDIS_URL is set).
  const relay = attachRelay(httpsServer ? [httpServer, httpsServer] : [httpServer]);
  app.get('/api/relay/health', (_req, res) => res.json({ ok: true, broker: relay.broker.kind, rooms: relay.rooms }));
  new Session(io as unknown as RoomServer, infoFor, () => checkRuntimeAssets(STATIC_ROOT), { isLocal: (s) => isLocalAddress(s.handshake?.address) });

  if (DEV) {
    // Development-only visual QA: the client can post a canvas capture (localhost only).
    app.post('/__dev/snapshot', express.raw({ type: 'image/jpeg', limit: '8mb' }), (req, res) => {
      if (!isLoopback(req.socket.remoteAddress)) return void res.status(403).end();
      const name = String(req.query.name ?? 'snap').replace(/[^a-z0-9_-]/gi, '');
      fs.mkdirSync(path.resolve('.viewer.tmp/snaps'), { recursive: true });
      fs.writeFileSync(path.resolve('.viewer.tmp/snaps', `${name}.jpg`), req.body as Buffer);
      res.json({ ok: true });
    });
    const { createServer } = await import('vite');
    const vite = await createServer({
      server: { middlewareMode: true, ws: SECURE ? false : { server: httpServer } },
      appType: 'spa',
    });
    app.use(vite.middlewares);
  } else {
    if (!fs.existsSync(path.join(STATIC_ROOT, 'index.html'))) {
      console.error(`[host] ${STATIC_ROOT}/index.html not found. Run "npm run build" first, or use "npm run dev".`);
      process.exit(1);
    }
    app.use(
      express.static(STATIC_ROOT, {
        setHeaders: (res, file) => {
          if (file.includes(`${path.sep}runtime-assets${path.sep}`) && !file.endsWith('manifest.json')) res.setHeader('Cache-Control', 'public, max-age=31536000, immutable');
          else if (file.endsWith('sw.js') || file.endsWith('index.html') || file.endsWith('manifest.json')) res.setHeader('Cache-Control', 'no-cache');
        },
      }),
    );
    app.get(/^\/(?!socket\.io|api|runtime-assets).*/, (_req, res) => res.sendFile(path.join(STATIC_ROOT, 'index.html')));
  }

  await listenOrExplain(httpServer, HTTP_PORT, 'HTTP');
  if (httpsServer) await listenOrExplain(httpsServer, HTTPS_PORT, 'HTTPS');

  const assets = checkRuntimeAssets(STATIC_ROOT);
  const lines = [
    '',
    '  PIZZERIA ROADRASH — LAN host',
    `  mode: ${DEV ? 'development' : 'production'}${SECURE ? ' + secure (HTTPS/WSS)' : ''}`,
    `  host (this PC):   http://localhost:${HTTP_PORT}/`,
    ...lanUrls().map((u) => `  LAN (http):       ${u}`),
    ...secureUrls().map((u) => `  LAN (https):      ${u}`),
  ];
  if (certs) lines.push(`  phone setup:      http://${lan()[0] ?? 'localhost'}:${HTTP_PORT}/setup  (install + trust the local CA once)`);
  if (!SECURE) lines.push('  note: phone gyro/fullscreen/PWA need secure mode — run "npm run dev:secure".');
  if (!assets.ok) lines.push(`  WARNING: race start blocked, missing required runtime assets (${assets.missingRequired.length}). Run "npm run assets:build".`);
  else if (assets.missingOptional.length) lines.push(`  warning: ${assets.missingOptional.length} optional cosmetic assets missing; the game degrades gracefully.`);
  console.log(lines.join('\n'));
  console.log(await QRCode.toString(joinUrl(), { type: 'terminal', small: true }));
  console.log(`  Scan to join: ${joinUrl()}\n`);
}

function isLoopback(a: string | undefined): boolean {
  return !!a && /^(::1|127.0.0.1|::ffff:127.0.0.1)$/.test(a);
}

/** Refuses to share a port with another local app (Windows allows a 127.0.0.1 + 0.0.0.0 double bind). */
async function listenOrExplain(server: http.Server | https.Server, port: number, label: string): Promise<void> {
  const inUse = await new Promise<boolean>((resolve) => {
    const s = net.connect({ port, host: '127.0.0.1' }, () => {
      s.destroy();
      resolve(true);
    });
    s.on('error', () => resolve(false));
    s.setTimeout(400, () => {
      s.destroy();
      resolve(false);
    });
  });
  if (inUse) {
    console.error(`[host] ${label} port ${port} is already used by another program on this computer. Close it or pass --${label === 'HTTP' ? 'port' : 'https-port'}=<free port>.`);
    process.exit(1);
  }
  await new Promise<void>((resolve, reject) => {
    server.once('error', reject);
    server.listen(port, '0.0.0.0', () => resolve());
  }).catch((e: NodeJS.ErrnoException) => {
    console.error(`[host] cannot listen on ${label} port ${port}: ${e.code ?? e.message}`);
    process.exit(1);
  });
}

main().catch((e) => {
  console.error('[host] fatal', e);
  process.exit(1);
});
