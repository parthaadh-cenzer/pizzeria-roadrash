// Client application: global flow BOOT -> ASSET_CHECK -> MENU -> LOBBY -> LOADOUT -> READY ->
// INTRO -> COUNTDOWN -> RACING -> FINISHING -> RESULTS (IMPLEMENTATION_CONTRACT §6).
import { getTrack } from '../game/track/Track.js';
import type { GamePhase } from '../shared/ids.js';
import { DEFAULT_RIDER_ID } from '../shared/ids.js';
import type { LobbyStateMsg, LoadoutMsg, RaceStartMsg, ResultsMsg } from '../shared/protocol.js';
import { Net } from '../network/Net.js';
import { RelayClientSocket, WorkerClientSocket } from '../network/transports.js';
import { joinUrlFor, roomCodeFromUrl } from '../room/wire.js';
import QRCode from 'qrcode';
import { AssetStore } from '../render/AssetStore.js';
import { RenderCore } from '../render/RenderCore.js';
import { World } from '../render/world/World.js';
import { clear, type Screen } from '../ui/dom.js';
import { BootScreen, DiagnosticsScreen, HowToPlayScreen, JoinCodeScreen, LobbyScreen, LoadoutScreen, MenuScreen, SettingsScreen, type JoinPanel } from '../ui/screens.js';
import { AudioEngine } from '../audio/AudioEngine.js';
import { initRapier } from '../physics/CrashWorld.js';
import { autoPreset, detectDevice, type DeviceInfo } from './device.js';
import { canInstall, promptInstall } from './pwa.js';
import { loadSettings, settings, updateSettings } from './settings.js';
import { ActorLibrary } from './ActorLibrary.js';
import { LoadoutPreview } from './LoadoutPreview.js';
import { HeroView } from './HeroView.js';
import { RaceClient } from './RaceClient.js';
import { ResultsView } from './ResultsView.js';
import { MobileEntry } from '../input/MobileEntry.js';
import { WorldViewer } from './WorldViewer.js';

export interface View {
  update(dt: number, time: number): void;
  render(dt: number, time: number): void;
  dispose(): void;
}

export class App {
  readonly canvas: HTMLCanvasElement;
  readonly ui: HTMLDivElement;
  readonly device: DeviceInfo;
  core!: RenderCore;
  assets!: AssetStore;
  net!: Net;
  audio = new AudioEngine();
  world: World | null = null;
  library: ActorLibrary | null = null;
  phase: GamePhase = 'BOOT';
  private screen: Screen | null = null;
  private overlay: Screen | null = null;
  private view: View | null = null;
  private lobbyScreen: LobbyScreen | null = null;
  private preloadDone = false;
  private preloadPromise: Promise<void> | null = null;
  private pendingRace: RaceStartMsg | null = null;
  /** Results of a race this player took part in, received before assets were loaded (reload). */
  private pendingResults: ResultsMsg | null = null;
  private lastTime = performance.now();
  private startedAt = performance.now();
  readonly mobileEntry: MobileEntry;
  diagnostics: string[] = [];
  /** 'lan': a local host PC serves the game; 'hosted': public deployment with browser-hosted rooms. */
  mode: 'lan' | 'hosted' = 'lan';
  /** Hosted mode: the current room's code and, for its host, the scannable join panel. */
  roomCode: string | null = null;
  private roomHostSocket: WorkerClientSocket | null = null;
  private joinPanel: JoinPanel | null = null;

  constructor(canvas: HTMLCanvasElement, ui: HTMLDivElement) {
    this.canvas = canvas;
    this.ui = ui;
    this.device = detectDevice();
    loadSettings();
    this.mobileEntry = new MobileEntry(this.device);
  }

  // ------------------------------------------------------------------------ screens
  show(s: Screen | null): void {
    this.screen?.dispose?.();
    clear(this.ui);
    this.screen = s;
    if (s) this.ui.appendChild(s.el);
    if (this.overlay) this.ui.appendChild(this.overlay.el);
  }

  showOverlay(s: Screen | null): void {
    this.overlay?.el.remove();
    this.overlay?.dispose?.();
    this.overlay = s;
    if (s) this.ui.appendChild(s.el);
  }

  setView(v: View | null): void {
    if (this.view && this.view !== v) this.view.dispose();
    this.view = v;
  }

  fatal(title: string, lines: string[]): void {
    this.show(new DiagnosticsScreen({ title, lines, fatal: true, action: { label: 'Reload', run: () => location.reload() } }));
  }

  // ------------------------------------------------------------------------ start
  async start(): Promise<void> {
    const boot = new BootScreen();
    this.show(boot);
    if (!this.device.webgl2) {
      this.fatal('WebGL 2 not available', ['This device/browser cannot run the 3D renderer (WebGL 2 is required). Try Chrome, Edge, Firefox or Safari 15+.']);
      return;
    }
    this.core = new RenderCore(this.canvas);
    const preset = settings().graphics === 'AUTO' ? autoPreset(this.device) : settings().graphics;
    this.core.setPreset(preset as 'HIGH' | 'MEDIUM' | 'MOBILE');
    this.assets = new AssetStore(this.core.renderer);
    this.assets.useLowLod = this.core.cfg.lowLod;
    this.phase = 'ASSET_CHECK';
    boot.set('Checking runtime assets…', 0.2);
    try {
      await this.assets.loadManifest();
    } catch (e) {
      this.fatal('Runtime assets missing', [e instanceof Error ? e.message : String(e), 'The host must run: npm run assets:build (then npm run assets:verify).']);
      return;
    }
    const missing = this.assets.missingRequired();
    if (missing.length) this.diagnostics.push(`Required runtime assets missing: ${missing.join(', ')} — races cannot start until the host runs npm run assets:build.`);
    boot.set('Starting physics…', 0.4);
    await initRapier();
    this.loop();

    const params = new URLSearchParams(location.search);
    if (import.meta.env.DEV && params.get('view') === 'world') {
      // Development-only visual QA flythrough (window.__dev.shot()).
      await this.ensureWorld((l) => boot.set(l, 0.6));
      this.setView(new WorldViewer(this, { dev: true, s: Number(params.get('s') ?? 60), speed: Number(params.get('speed') ?? 22), paused: params.has('pause') }));
      this.show(null);
      return;
    }

    boot.set('Connecting…', 0.6);
    this.mode = await detectMode(params);
    this.phase = 'MENU';
    if (this.mode === 'lan') {
      this.net = new Net(this.device.mobile ? 'mobile' : 'desktop');
      this.wireNet();
      this.showMenu();
      return;
    }
    // Hosted: a join link / QR (?room=CODE) goes straight into that room.
    const code = roomCodeFromUrl(location.href);
    if (code) this.joinRoom(code);
    else this.showMenu();
  }

  // ------------------------------------------------------------------------ hosted rooms
  private resetNet(): void {
    const net = this.net as Net | undefined;
    net?.dispose();
    this.net = undefined as unknown as Net;
    this.roomHostSocket = null;
    this.roomCode = null;
    this.joinPanel = null;
  }

  /** HOST GAME (public version): this tab runs the room authority and gets a scannable lobby. */
  private hostRoom(): void {
    this.audio.unlock();
    this.resetNet();
    const worker = new Worker(new URL('../room/hostWorker.ts', import.meta.url), { type: 'module' });
    const sock = new WorkerClientSocket(worker, { origin: location.origin, room: null, secret: null });
    this.roomHostSocket = sock;
    this.net = new Net(this.device.mobile ? 'mobile' : 'desktop', sock);
    this.wireNet();
    sock.on('room', (m: { code: string }) => {
      this.roomCode = m.code;
      void this.buildJoinPanel(m.code);
    });
    sock.on('roomError', (e: { message: string }) => this.roomFailed('Could not host the room', e.message));
    const off = this.net.on('welcome', () => {
      off();
      this.net.socket.emit('claimHost');
    });
    this.phase = 'LOBBY';
    this.enterLobby();
    void this.preload();
  }

  /** JOIN (public version): through the room relay into the host's room. */
  private joinRoom(code: string): void {
    this.audio.unlock();
    this.resetNet();
    const sock = new RelayClientSocket(code);
    this.net = new Net(this.device.mobile ? 'mobile' : 'desktop', sock);
    this.roomCode = code;
    this.wireNet();
    sock.on('roomError', (e: { message: string }) => this.roomFailed('Could not join', e.message));
    sock.on('roomClosed', (m: { reason: string }) => this.roomFailed('Room closed', m.reason));
    const off = this.net.on('welcome', () => {
      off();
      this.net.socket.emit('join', { name: settings().lastName || 'Rider' });
    });
    this.phase = 'LOBBY';
    this.enterLobby();
    void this.preload();
  }

  private async buildJoinPanel(code: string): Promise<void> {
    const url = joinUrlFor(location.origin, code);
    const qrSvg = await QRCode.toString(url, { type: 'svg', margin: 2, errorCorrectionLevel: 'M', color: { dark: '#000000', light: '#ffffff' } });
    this.joinPanel = { url, qrSvg, code, extra: [], note: 'Phones: scan with the camera. Desktop: open the link or enter the code.' };
    this.lobbyScreen?.setJoin(this.joinPanel, code);
  }

  private roomFailed(title: string, message: string): void {
    this.resetNet();
    clearRoomFromUrl();
    this.phase = 'MENU';
    this.lobbyScreen = null;
    this.backdrop();
    this.show(new DiagnosticsScreen({ title, lines: [message], fatal: false, action: { label: 'Back to menu', run: () => this.showMenu() } }));
  }

  private leaveRoom(): void {
    if (this.mode === 'lan') {
      this.net.socket.emit('leave');
      this.showMenu();
      return;
    }
    const host = this.roomHostSocket;
    if (host) {
      host.closeRoom('The host closed the room.');
      this.net = undefined as unknown as Net;
      this.roomHostSocket = null;
      window.setTimeout(() => host.disconnect(), 400);
    } else {
      const net = this.net;
      this.net = undefined as unknown as Net;
      void net.leave().then(() => net.dispose());
    }
    this.resetNet();
    clearRoomFromUrl();
    this.showMenu();
  }

  private wireNet(): void {
    this.net.on('connection', () => {
      if (this.phase === 'MENU') this.showMenu();
    });
    this.net.on('welcome', () => {
      if (this.phase === 'MENU') this.showMenu();
      // A new room (or a room that restarted) must learn this client already has its assets.
      if (this.preloadDone) this.net?.socket.emit('loaded', { ok: true, missing: [] });
    });
    this.net.on('lobby', (s) => this.onLobby(s));
    this.net.on('raceStart', (m) => this.onRaceStart(m));
    this.net.on('results', (m) => this.onResults(m));
    this.net.on('error', (e) => this.toast(e.message, 5));
    this.net.on('kicked', (k) => {
      this.phase = 'MENU';
      this.setView(null);
      this.show(new DiagnosticsScreen({ title: 'Removed from lobby', lines: [k.reason], fatal: false, action: { label: 'Back to menu', run: () => this.showMenu() } }));
    });
  }

  private menuNotices(): string[] {
    const n = [...this.diagnostics];
    if (this.device.mobile && !this.device.secure) n.push('This connection is not secure, so tilt steering, fullscreen and app install are unavailable (touch steering still works). Ask the host to run "npm run dev:secure" and open the https:// address.');
    return n;
  }

  /** Attract-mode city flythrough behind the menu; the start-grid bubble behind lobby/loadout. */
  private backdrop(): void {
    if (this.phase === 'LOBBY' || this.phase === 'READY' || this.phase === 'LOADOUT') {
      this.lobbyBackdrop();
      return;
    }
    if (this.world && !(this.view instanceof WorldViewer)) this.setView(new WorldViewer(this));
    else if (!this.world) this.setView(null);
  }

  /** My lobby entry (loadout, ready, grid slot). */
  private me(): { l: LoadoutMsg; slot: number; ready: boolean } | null {
    const p = this.net?.lobby?.players.find((x) => x.id === this.net.playerId);
    return p ? { l: p.loadout, slot: p.slot, ready: p.ready } : null;
  }

  /**
   * Lobby background: my starting-grid slot in a tight fogged bubble (the course stays hidden).
   * My complete loadout appears there once I am READY.
   */
  private lobbyBackdrop(): void {
    if (!this.world || !this.library || !this.preloadDone) {
      if (!(this.view instanceof WorldViewer) && this.world) this.setView(new WorldViewer(this));
      return;
    }
    const me = this.me();
    const show = me && me.ready ? me.l : null;
    if (this.view instanceof HeroView) this.view.set(show, me?.slot ?? 0);
    else this.setView(new HeroView(this, show, me?.slot ?? 0, () => uiRightEdge()));
  }

  showMenu(): void {
    this.phase = 'MENU';
    this.lobbyScreen = null;
    this.backdrop();
    const hosted = this.mode === 'hosted';
    this.show(
      new MenuScreen(this.net?.info ?? null, hosted || !!this.net?.connected, {
        host: () => (hosted ? this.hostRoom() : this.join(true)),
        join: () => (hosted ? this.showJoinCode() : this.join(false)),
        howTo: () => this.show(new HowToPlayScreen(this.device.mobile, () => this.showMenu())),
        settings: () => this.openSettings(),
        install: canInstall() ? () => void promptInstall() : null,
      }, this.menuNotices(), this.mode),
    );
  }

  private showJoinCode(): void {
    this.show(new JoinCodeScreen((code) => this.joinRoom(code), () => this.showMenu()));
  }

  private join(host: boolean): void {
    this.audio.unlock();
    if (host) this.net.socket.emit('claimHost');
    else this.net.socket.emit('join', { name: settings().lastName || `Rider ${this.net.playerId}` });
    this.phase = 'LOBBY';
    this.enterLobby();
    void this.preload();
  }

  openSettings(inRace = false): void {
    const close = () => this.showOverlay(null);
    this.showOverlay(
      new SettingsScreen({
        mobile: this.device.mobile,
        onClose: close,
        onRecalibrate: this.device.mobile ? () => this.mobileEntry.calibrate() : undefined,
        onLeave: inRace
          ? () => {
              close();
              this.roomHostSocket?.closeRoom('The host left the game.');
              clearRoomFromUrl();
              void this.net.leave().then(() => location.reload());
            }
          : undefined,
        onEndRace: inRace && this.net.isHost ? () => { close(); this.net.socket.emit('endRace'); } : undefined,
        applied: () => this.toast('Graphics preset applies to the next race load', 2.5),
      }),
    );
  }

  // ------------------------------------------------------------------------ lobby / loadout
  private enterLobby(): void {
    this.backdrop();
    const ls = new LobbyScreen(this.net.info, this.net.playerId, this.device.mobile, {
      loadout: () => this.openLoadout(),
      setLaps: (laps) => this.net.socket.emit('setLaps', { laps }),
      ready: (r) => this.setReady(r),
      start: () => this.net.socket.emit('start'),
      remove: (id) => this.net.socket.emit('removePlayer', { id }),
      leave: () => this.leaveRoom(),
      settings: () => this.openSettings(),
    });
    this.lobbyScreen = ls;
    this.show(ls);
    if (this.mode === 'hosted') ls.setJoin(this.joinPanel, this.roomCode);
    if (this.net.lobby) ls.render(this.net.lobby);
    this.updatePreloadUi();
  }

  private myLoadout(): { l: LoadoutMsg; name: string } {
    const me = this.net.lobby?.players.find((p) => p.id === this.net.playerId);
    return { l: me?.loadout ?? { riderId: DEFAULT_RIDER_ID, riderColor: 0, bikeId: 'BIKE_01_SCIFI_MOTORCYCLE', bikeColor: 0, weaponId: 'KATANA' }, name: me?.name ?? settings().lastName };
  }

  private openLoadout(): void {
    this.phase = 'LOADOUT';
    const { l, name } = this.myLoadout();
    const cur: LoadoutMsg = { ...l };
    const ready = !!(this.library && this.preloadDone);
    let preview: LoadoutPreview | null = ready ? new LoadoutPreview(this, cur) : null;
    let hero: HeroView | null = null;
    if (preview) this.setView(preview);
    else this.backdrop();
    // Steps 1-6 present one subject at a time in the studio; step 7 (READY) is the first time the
    // complete loadout is shown, at the start grid.
    const showStep = (i: number) => {
      if (!ready) return;
      if (i >= 6) {
        preview = null;
        hero = new HeroView(this, { ...cur }, this.me()?.slot ?? 0, () => uiRightEdge());
        this.setView(hero);
      } else {
        hero = null;
        if (!preview) {
          preview = new LoadoutPreview(this, cur);
          this.setView(preview);
        }
        preview.focusStep(i);
      }
    };
    const scr = new LoadoutScreen(l, name, this.device.mobile, {
      change: (p) => {
        if (p.name !== undefined) updateSettings({ lastName: p.name });
        this.net.socket.emit('loadout', p);
        Object.assign(cur, p);
        preview?.apply(p);
        hero?.set({ ...cur }, this.me()?.slot ?? 0);
      },
      step: (i) => showStep(i),
      done: () => this.setReady(true),
      back: () => this.enterLobby(),
    });
    this.show(scr);
  }

  private async setReady(ready: boolean): Promise<void> {
    if (ready && !this.preloadDone) {
      this.toast('Still loading race assets…', 2);
      return;
    }
    if (ready && this.device.mobile) {
      // ENTER RACE: the explicit gesture for motion permission, fullscreen, landscape, calibration.
      const ok = await this.mobileEntry.enterRace(this.ui);
      if (!ok) return;
    }
    this.net.socket.emit('ready', { ready });
    this.phase = ready ? 'READY' : 'LOBBY';
    this.enterLobby();
  }

  private onLobby(s: LobbyStateMsg): void {
    if (this.lobbyScreen && (this.phase === 'LOBBY' || this.phase === 'READY')) {
      this.lobbyScreen.setMe(this.net.playerId);
      this.lobbyScreen.render(s);
      this.lobbyBackdrop();
    }
    if (s.phase === 'LOBBY') this.pendingResults = null;
    if (s.phase === 'LOBBY' && (this.phase === 'RESULTS' || this.phase === 'FINISHING')) this.enterLobbyAfterRace();
  }

  private enterLobbyAfterRace(): void {
    this.phase = 'LOBBY';
    this.enterLobby();
  }

  // ------------------------------------------------------------------------ preload
  async ensureWorld(onStep: (l: string) => void): Promise<World> {
    if (!this.world) {
      const w = new World(getTrack(), this.core);
      await w.build(this.assets, onStep);
      this.world = w;
    }
    return this.world;
  }

  private preload(): Promise<void> {
    if (!this.preloadPromise) {
      this.preloadPromise = (async () => {
        const off = this.assets.onProgress(() => this.updatePreloadUi());
        try {
          this.library = new ActorLibrary(this.assets);
          await Promise.all([this.library.loadAll(), this.ensureWorld(() => this.updatePreloadUi())]);
          await this.library.warmup(this.world!);
          const failed = this.assets.progress.failedRequired;
          this.preloadDone = failed.length === 0;
          if (failed.length) this.diagnostics.push(`Required assets failed to load: ${failed.join(', ')}`);
          this.net?.socket.emit('loaded', { ok: this.preloadDone, missing: failed });
        } catch (e) {
          console.error('[app] preload failed', e);
          this.diagnostics.push(`Asset loading failed: ${e instanceof Error ? e.message : String(e)}`);
          this.net?.socket.emit('loaded', { ok: false, missing: [String(e)] });
        } finally {
          off();
          this.updatePreloadUi();
          if (this.phase === 'LOBBY' || this.phase === 'READY' || this.phase === 'MENU') this.backdrop();
          if (this.pendingRace) {
            const m = this.pendingRace;
            this.pendingRace = null;
            this.onRaceStart(m);
          } else if (this.pendingResults) {
            const m = this.pendingResults;
            this.pendingResults = null;
            this.onResults(m);
          }
        }
      })();
    }
    return this.preloadPromise;
  }

  private updatePreloadUi(): void {
    const p = this.assets?.progress;
    if (!this.lobbyScreen || !p) return;
    const frac = p.total ? p.loaded / p.total : 0;
    const txt = this.preloadDone ? 'Race assets ready' : p.failedRequired.length ? `Failed: ${p.failedRequired.join(', ')}` : `Loading race assets… ${Math.round(frac * 100)}%`;
    this.lobbyScreen.setLoad(this.preloadDone ? 1 : frac, txt, this.preloadDone);
    if (this.net?.lobby) {
      this.lobbyScreen.setMe(this.net.playerId);
      this.lobbyScreen.render(this.net.lobby);
    }
  }

  // ------------------------------------------------------------------------ race
  private onRaceStart(m: RaceStartMsg): void {
    if (!m.participants.some((p) => p.id === this.net.playerId)) return;
    // The host re-sends raceStart after a socket reconnect; keep the running race view.
    if (this.view instanceof RaceClient && this.view.raceId === m.raceId) return;
    if (!this.preloadDone || !this.world || !this.library) {
      this.pendingRace = m;
      void this.preload();
      return;
    }
    this.phase = 'INTRO';
    this.lobbyScreen = null;
    // Continuity: the race opens on the READY hero framing when that was on screen.
    const handoff = this.view instanceof HeroView ? { viewShift: this.view.shot.viewShift } : null;
    const race = new RaceClient(this, m, handoff);
    this.setView(race);
  }

  private onResults(m: ResultsMsg): void {
    if (!this.preloadDone || !this.world || !this.library) {
      // e.g. the page was reloaded during results: show them once the avatars are loaded.
      if (m.entries.some((e) => e.id === this.net.playerId)) {
        this.pendingResults = m;
        void this.preload();
      }
      return;
    }
    this.phase = 'RESULTS';
    this.setView(new ResultsView(this, m));
  }

  toast(text: string, seconds: number): void {
    const el = document.createElement('div');
    el.className = 'toast';
    el.textContent = text;
    el.style.zIndex = '60';
    this.ui.appendChild(el);
    setTimeout(() => el.remove(), seconds * 1000);
  }

  // ------------------------------------------------------------------------ frame loop
  private loop(): void {
    const tick = () => {
      const now = performance.now();
      const dt = Math.min(0.1, (now - this.lastTime) / 1000);
      this.lastTime = now;
      const time = (now - this.startedAt) / 1000;
      try {
        if (this.view) {
          this.view.update(dt, time);
          this.view.render(dt, time);
        } else {
          this.core.renderer.setClearColor(0x07080f);
          this.core.renderer.clear();
        }
        this.screen?.update?.(dt);
      } catch (e) {
        console.error('[app] frame error', e);
      }
      requestAnimationFrame(tick);
    };
    requestAnimationFrame(tick);
  }

}

/** LAN mode when a local host answers /api/info; otherwise the public (hosted) deployment. */
async function detectMode(params: URLSearchParams): Promise<'lan' | 'hosted'> {
  const forced = params.get('net');
  if (forced === 'hosted' || forced === 'lan') return forced;
  const ctl = new AbortController();
  const t = window.setTimeout(() => ctl.abort(), 2500);
  try {
    const r = await fetch('/api/info', { cache: 'no-store', signal: ctl.signal });
    if (!r.ok) return 'hosted';
    const j = (await r.json()) as { lanUrls?: unknown };
    return Array.isArray(j.lanUrls) ? 'lan' : 'hosted';
  } catch {
    return 'hosted';
  } finally {
    clearTimeout(t);
  }
}

function clearRoomFromUrl(): void {
  const u = new URL(location.href);
  if (!u.searchParams.has('room')) return;
  u.searchParams.delete('room');
  history.replaceState(null, '', u.pathname + u.search + u.hash);
}

/** Right edge (px) of the left-hand UI column(s), so 3D subjects are framed beside them. */
function uiRightEdge(): number {
  let r = 0;
  for (const el of document.querySelectorAll('.lobby > *, .loadout .side')) {
    const b = el.getBoundingClientRect();
    if (b.width > 0 && b.height > 0 && b.left < window.innerWidth * 0.6) r = Math.max(r, b.right);
  }
  return r >= window.innerWidth * 0.8 ? 0 : r;
}
