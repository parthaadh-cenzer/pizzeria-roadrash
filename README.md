# Pizzeria Roadrash

A rain-soaked neon motorcycle racing and melee game for 1–10 players in the browser: desktop
keyboards and phones (tilt steering) race together. Play the public deployment with a link or QR
code, or host it yourself on a local network.

The locked design lives in `HANDOFF/` and `IMPLEMENTATION_CONTRACT.md`. The latest validation
report is `PRE_DEPLOYMENT_AUDIT.md`; visual QA captures are in `docs/qa/`.

## Repository and build (STAIGE Games)

Pizzeria Roadrash is a browser/PWA cyberpunk motorcycle combat racer (Three.js, Rapier physics,
Vite, TypeScript).

| | |
|---|---|
| Install | `npm ci` (Node.js 20+) |
| Production build | `npm run build:web` |
| Build output | `dist/client` (static site: `index.html`, JS bundles, `runtime-assets/`, `sw.js`) |
| Full build (static client + relay bundle + LAN server) | `npm run build` |

- **Assets:** the optimised runtime assets are committed in `public/runtime-assets/` and copied
  into the build; no asset step is needed. The raw source models (`Assets/`) are not in the
  repository; credits and licences are in [CREDITS.md](CREDITS.md).
- **Multiplayer/networking:** hosting and joining rooms from the static build needs the
  WebSocket relay `api/relay.mjs` (Socket.IO at `/api/relay/socket.io`, a Vercel Function;
  prebuilt in the repo, regenerate with `npm run build:relay`) and, across several function
  instances, a Redis URL in `REDIS_URL`. The race itself runs in the host's browser tab; the
  relay only forwards messages. A client hosted apart from the relay is built with
  `VITE_RELAY_URL=<relay base URL> npm run build:web` (see "Standalone relay" below).
  Alternatively, `npm run build && npm start` runs a self-contained
  LAN host (Node.js, HTTP 7373) that serves the game and the room authority.
- **No secrets** are in the repository: deployment-specific values come from environment
  variables.

## Playing the deployed version

Open the public game URL.

- **HOST GAME** creates a room. The lobby shows **SCAN TO JOIN** with a QR code, the room code
  and **COPY LINK**. Pick your loadout, set **LAPS**, press **Ready**, then **Start Race** once
  everyone is ready.
- **Join via QR** — scan the host's QR code with a phone camera. The game opens straight into
  that room's lobby.
- **Join via link or code** — open the shared link (`…/?room=CODE`), or choose **JOIN GAME** and
  type the six-character room code shown under the QR.
- **HOW TO PLAY** in the menu summarises the controls.

The host's browser tab runs the race authority for its room (lobby, laps, simulation, combat,
crashes, checkpoints, cheat validation), so keep the host tab open and in front while racing;
closing it ends the room for everyone.

### Laps

The host sets **LAPS** in the lobby (1–5, default 1). Everyone sees the value and the race
distance update (for example `3 laps • 24.9 km`). It is fixed once the race starts. A lap only
counts after every checkpoint of that lap, in order; the HUD shows `LAP 2/3`, and results appear
when riders have completed the configured length.

## Controls

| Desktop | Phone |
|---|---|
| Arrow Up: throttle · Arrow Down: brake/reverse | Automatic acceleration |
| Arrow Left/Right: steer | Tilt like a steering wheel (or LEFT/RIGHT touch zones) |
| Space: kick · Enter: weapon | KICK and HIT buttons |
| N: boost (one charge per press) | — |
| Esc: pause/settings | II: pause/settings (recalibrate tilt, sensitivity, invert) |

**Phones.** Tap **Enter race** in the lobby: it asks for motion access, goes fullscreen, locks
landscape and calibrates "straight ahead" from how you hold the phone. Anything unsupported is
skipped and the race still works (touch LEFT/RIGHT steering replaces tilt). Holding the phone in
portrait shows a rotate prompt.

**Boost cheat (desktop keyboard only).** Type `xyzzyspoon` during the race, then press Shift+1.
The race authority grants 10 charges and the HUD shows `BOOST ×10`. Each press of **N** spends
exactly one charge (`BOOST ×9`, …); holding the key does not repeat, and with no charges left N
does nothing.

The host's in-race settings also offer **End race for everyone** (unfinished riders are DNF);
any rider can **Leave race** (counts as DNF).

## Local / LAN development

Requirements: Node.js 20+.

```bash
npm install
```

The runtime assets are already in `public/runtime-assets/`. Rebuilding them needs the original
source models in `Assets/` (not in the repository, never modified by the pipeline; see
CREDITS.md): `npm run assets:build`, then `npm run assets:verify`. `assets:build` is incremental (cached in `.pipeline-cache/`); `-- --only=city` rebuilds one stage
(`clips, textures, bikes, riders, weapons, starter, crowd, city`).

| Command | Use |
|---|---|
| `npm run dev:secure` | LAN host with HTTPS/WSS on 7443 (phones: tilt, fullscreen, install) and HTTP on 7373 for the phone setup page. |
| `npm run dev` | LAN host, plain HTTP on 7373. |
| `npm run build` then `npm run start:secure` / `npm start` | The same LAN host from the production build. |

In LAN mode one PC runs the race authority in Node: open `http://localhost:7373/` on it, choose
**Host game**, and share the QR/URL the lobby shows (the host console prints it too). Ports:
`-- --port=8080 --https-port=8443` (or `PORT` / `HTTPS_PORT`). Phones in secure mode first open
`http://<host-ip>:7373/setup` once to trust the local certificate authority (kept in `.certs/`).

The development host also serves the public-mode room relay, so the hosted flow can be tried
locally: open `http://localhost:7373/?net=hosted` (the deployed build selects hosted mode by
itself).

## Production deployment (Vercel)

- **Static client:** `npm run build:web` → `dist/client` (with `public/runtime-assets`). Raw
  `Assets/`, certificates and caches are excluded by `.vercelignore`.
- **Room relay:** `api/relay.mjs`, a Vercel Function (Node.js, Fluid compute) serving Socket.IO
  over WebSocket at `/api/relay/socket.io`. It is generated from `src/server/relay/` by
  `npm run build:relay` — run that before deploying. The relay only forwards frames between a
  room's host tab and its players. Rooms are registered, and routed across function instances,
  through Redis.
- **Environment:** `REDIS_URL` — a Redis connection string (for example Redis from the Vercel
  Marketplace; `KV_URL` / `UPSTASH_REDIS_URL` are also accepted). Without it the relay only
  works while all of a room's players share one function instance. No secrets live in the
  repository.
- `vercel.json` sets the build, the output directory, the relay rewrite and cache headers.

```bash
npm run build:relay
```

```bash
npx vercel deploy --prod
```

Function connections are recycled at the platform's maximum duration (300 s by default). Clients
reconnect to the relay automatically, and the room keeps its state in the host tab, so a race
carries on.

## Standalone relay (long-running Node service)

The same relay also runs as one persistent Node process: `node relay-server.mjs` (or
`npm run start:relay`) after `npm ci --omit=dev`. `render.yaml` is a ready Render Blueprint for it.

| Variable | Where | Purpose |
|---|---|---|
| `PORT` | relay | Listening port (default 8080). |
| `RELAY_ALLOWED_ORIGINS` | relay | Comma-separated client origins allowed to connect (for example `https://games.staige.world,https://play.games.staige.world`). Unset = any origin (local development). Requests without a matching `Origin` are refused. |
| `REDIS_URL` | relay | Only for more than one relay instance. A single instance keeps rooms in memory; after a restart the host tab reclaims its room and players reconnect. |
| `VITE_RELAY_URL` | client build | Relay base URL when the client is hosted on another origin. Unset = the page's own origin. Join links and QR codes always use the page origin. |

Health check: `GET /api/relay/health` → `{ "ok": true, "broker": "memory" | "redis", "rooms": n }`.

## Troubleshooting

- **"Room … was not found"** — the host closed the room or left; ask for a new link/QR.
- **"Room closed"** — the host left the game. Everyone returns to the menu.
- **No tilt steering on a phone** — the page must be HTTPS (the deployment is; on a LAN use
  `npm run dev:secure` and the setup page). Touch LEFT/RIGHT zones always work.
- **Stuck on "Loading race assets"** — reload; the game loads about 80 MB of runtime assets the
  first time, then serves them from the browser cache.
- **LAN phone cannot connect** — allow Node.js through the Windows firewall for private networks.
- **Relay health** — `GET /api/relay/health` reports `{ ok, broker: "redis" | "memory", rooms }`.

## Validation

```bash
npm run typecheck
```

```bash
npm test
```

```bash
npm run audit:predeploy
```

`audit:predeploy` runs a clean install in a temporary directory, the asset build and
verification, typecheck, the test suite (LAN and hosted-room end-to-end races included), the
production build and live host probes, then rewrites `PRE_DEPLOYMENT_AUDIT.md`.

## Layout

- `src/shared`, `src/config`: protocol, ids and all gameplay/track/asset constants.
- `src/game`: deterministic track and race simulation (the client runs the same bike step for
  prediction).
- `src/room`: the race authority (`Session`) shared by the LAN host (Node) and hosted rooms (a Web
  Worker in the host's tab), and the hosted wire format.
- `src/server`: LAN host (Express + Socket.IO, Vite middleware in development, certificates) and
  the room relay (`src/server/relay`).
- `src/client`, `src/render`, `src/input`, `src/network`, `src/audio`, `src/ui`: the browser client.
- `tools/asset-pipeline`: `Assets/` → `public/runtime-assets/` build and verification.
- `tests/`: simulation, laps, protocol, input, hosted rooms, asset, service-worker, certificate
  and end-to-end tests.
