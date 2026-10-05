// Menu, lobby, loadout, loading, diagnostics and settings screens.
import { BIKES } from '../config/bikes.js';
import { BIKE_BALANCE, RACE, STEERING } from '../config/gameplay.js';
import { RIDERS } from '../config/riders.js';
import { WEAPONS } from '../config/weapons.js';
import { BIKE_IDS, GRAPHICS_PRESETS, SELECTABLE_RIDER_IDS, WEAPON_IDS, type BikeId, type RiderId, type WeaponId } from '../shared/ids.js';
import type { LobbyStateMsg, LoadoutMsg, ServerInfoMsg } from '../shared/protocol.js';
import { settings, updateSettings } from '../client/settings.js';
import { clear, h, setText, type Screen } from './dom.js';
import { normalizeRoomCode } from '../room/wire.js';

export function logo(): HTMLElement {
  return h('h1', { class: 'logo' }, h('span', { class: 'a' }, 'Pizzeria'), h('span', { class: 'b' }, 'Roadrash'));
}

/** Destructive action that needs a second tap (no blocking dialogs: they break fullscreen). */
function confirmButton(label: string, confirmLabel: string, run: () => void): HTMLElement {
  let armed = false;
  const b: HTMLButtonElement = h('button', {
    class: 'btn danger',
    onclick: () => {
      if (armed) return run();
      armed = true;
      b.textContent = confirmLabel;
      window.setTimeout(() => {
        armed = false;
        b.textContent = label;
      }, 3000);
    },
  }, label) as HTMLButtonElement;
  return b;
}

// ------------------------------------------------------------------------------ Boot / diagnostics
export class BootScreen implements Screen {
  el: HTMLElement;
  private msg: HTMLElement;
  private bar: HTMLElement;
  constructor() {
    this.msg = h('div', { class: 'muted small' }, 'Starting…');
    this.bar = h('i');
    this.el = h('div', { class: 'screen center scrim' }, logo(), h('div', { class: 'tagline' }, 'Rain-soaked neon speed'), h('div', { class: 'loading-bar' }, this.bar), this.msg);
  }
  set(text: string, frac: number): void {
    setText(this.msg, text);
    this.bar.style.width = `${Math.round(Math.max(0, Math.min(1, frac)) * 100)}%`;
  }
}

export interface Diagnostic {
  title: string;
  lines: string[];
  fatal: boolean;
  action?: { label: string; run: () => void };
}

export class DiagnosticsScreen implements Screen {
  el: HTMLElement;
  constructor(d: Diagnostic, onBack?: () => void) {
    this.el = h(
      'div',
      { class: 'screen center scrim' },
      h(
        'div',
        { class: 'panel stack', style: 'max-width:640px' },
        h('h2', { class: d.fatal ? 'err' : 'warn' }, d.title),
        ...d.lines.map((l) => h('div', { class: 'notice' + (d.fatal ? ' error' : '') }, l)),
        h('div', { class: 'row' }, d.action ? h('button', { class: 'btn primary', onclick: d.action.run }, d.action.label) : null, onBack ? h('button', { class: 'btn ghost', onclick: onBack }, 'Back') : null),
      ),
    );
  }
}

// ------------------------------------------------------------------------------ Menu
export interface MenuActions {
  host: () => void;
  join: () => void;
  howTo: () => void;
  settings: () => void;
  install: (() => void) | null;
}

export class MenuScreen implements Screen {
  el: HTMLElement;
  constructor(info: ServerInfoMsg | null, connected: boolean, a: MenuActions, notices: string[], mode: 'lan' | 'hosted' = 'lan') {
    const hosted = mode === 'hosted';
    const canHost = hosted || !!info?.hostLocal;
    const buttons = h('div', { class: 'menu-buttons' });
    if (canHost) buttons.append(h('button', { class: 'btn primary big', onclick: a.host }, 'Host Game'));
    buttons.append(h('button', { class: 'btn big' + (canHost ? '' : ' primary'), onclick: a.join, disabled: !connected }, !hosted && info?.hostLocal ? 'Join as Player' : 'Join Game'));
    buttons.append(h('div', { class: 'row', style: 'gap:10px' }, h('button', { class: 'btn ghost grow', onclick: a.howTo }, 'How to Play'), h('button', { class: 'btn ghost grow', onclick: a.settings }, 'Settings')));
    if (a.install) buttons.append(h('button', { class: 'btn ghost', onclick: a.install }, 'Install App'));
    this.el = h(
      'div',
      { class: 'screen center scrim' },
      logo(),
      h('div', { class: 'tagline' }, hosted ? 'Rain-soaked neon bike racing & melee · 1–10 riders · desktop & phones' : 'LAN motorcycle racing · melee · rain'),
      buttons,
      hosted ? h('div', { class: 'small muted menu-hint' }, 'Host a room, then friends scan your QR code or open your link — phones steer by tilting.') : null,
      h('div', { class: 'stack', style: 'margin-top:16px;max-width:520px' }, ...notices.map((n) => h('div', { class: 'notice' }, n))),
      !connected ? h('div', { class: 'notice error', style: 'margin-top:12px' }, 'Connecting to the LAN host… Multiplayer needs the host PC running Pizzeria Roadrash on this network.') : null,
      h('div', { class: 'version' }, info?.version ? `v${info.version}` : ''),
    );
  }
}

/** Hosted mode: join a room by its short code (the QR/link carries it automatically). */
export class JoinCodeScreen implements Screen {
  el: HTMLElement;
  constructor(onJoin: (code: string) => void, onBack: () => void) {
    const msg = h('div', { class: 'small muted' }, 'Six letters/numbers, shown under the host\'s QR code.');
    const input = h('input', { class: 'name-input code-input', maxlength: 9, placeholder: 'ROOM CODE', autocapitalize: 'characters', autocomplete: 'off', spellcheck: 'false' }) as HTMLInputElement;
    const go = () => {
      const code = normalizeRoomCode(input.value);
      if (code) onJoin(code);
      else {
        msg.textContent = 'That is not a room code — check the six characters under the QR code.';
        msg.className = 'small warn';
      }
    };
    input.addEventListener('keydown', (e) => {
      e.stopPropagation();
      if (e.key === 'Enter') go();
    });
    this.el = h(
      'div',
      { class: 'screen center scrim' },
      h(
        'div',
        { class: 'panel stack join-panel', style: 'width:min(420px, 92vw)' },
        h('h2', {}, 'Join a race'),
        h('div', { class: 'small' }, 'Scan the host\'s QR code with your phone camera, open their link — or type the room code:'),
        input,
        msg,
        h('div', { class: 'row' }, h('button', { class: 'btn ghost', onclick: onBack }, 'Back'), h('div', { class: 'grow' }), h('button', { class: 'btn primary', onclick: go }, 'Join')),
      ),
    );
    setTimeout(() => input.focus(), 50);
  }
}

export class HowToPlayScreen implements Screen {
  el: HTMLElement;
  constructor(mobile: boolean, onBack: () => void) {
    const row = (k: string, v: string) => h('div', { class: 'howto-row' }, h('span', { class: 'k' }, k), h('span', {}, v));
    this.el = h(
      'div',
      { class: 'screen center scrim' },
      h(
        'div',
        { class: 'panel stack howto', style: 'width:min(640px, 94vw)' },
        h('div', { class: 'row' }, h('h2', { class: 'grow' }, 'How to play'), h('button', { class: 'btn small', onclick: onBack }, 'Back')),
        h('div', { class: 'small' }, 'Race through a drowned neon city: pass every checkpoint in order, jump the broken bridge, knock rivals off their bikes. Crash and your rider picks themselves up and runs back to the bike.'),
        h('h3', {}, 'Getting in'),
        row('Host', 'HOST GAME creates a room and shows a QR code, link and room code. Set LAPS (1–5), pick your loadout, press Ready, then Start.'),
        row('Join', 'Scan the QR with a phone camera, open the link, or JOIN GAME and type the code.'),
        h('h3', {}, mobile ? 'Phone controls' : 'Desktop controls'),
        ...(mobile
          ? [row('Accelerate', 'Automatic'), row('Steer', 'Tilt the phone like a steering wheel (or tap LEFT / RIGHT halves)'), row('Attack', 'KICK and HIT buttons'), row('Enter race', 'Grants motion access, goes fullscreen and calibrates straight ahead')]
          : [row('Throttle / brake', 'Arrow Up / Arrow Down'), row('Steer', 'Arrow Left / Right'), row('Kick', 'Space'), row('Weapon', 'Enter'), row('Boost', 'N (when you have boost charges)'), row('Pause', 'Esc')]),
        h('div', { class: 'small muted' }, mobile ? 'Desktop players use the keyboard; everyone races together.' : 'Phone players tilt to steer and accelerate automatically; everyone races together.'),
      ),
    );
  }
}

// ------------------------------------------------------------------------------ Lobby
export interface LobbyActions {
  loadout: () => void;
  /** Host only: race length 1-5 laps. */
  setLaps: (laps: number) => void;
  ready: (r: boolean) => void;
  start: () => void;
  remove: (id: number) => void;
  leave: () => void;
  settings: () => void;
}

/** The scannable "join this race" block the host sees. */
export interface JoinPanel {
  url: string;
  qrSvg: string;
  /** Hosted mode: the short room code (fallback to scanning). */
  code: string | null;
  /** Extra URLs (LAN: other network interfaces). */
  extra: string[];
  note: string | HTMLElement | null;
}

function copyText(text: string): Promise<boolean> {
  if (navigator.clipboard?.writeText) return navigator.clipboard.writeText(text).then(() => true, () => legacyCopy(text));
  return Promise.resolve(legacyCopy(text));
}

function legacyCopy(text: string): boolean {
  const ta = document.createElement('textarea');
  ta.value = text;
  ta.style.position = 'fixed';
  ta.style.opacity = '0';
  document.body.appendChild(ta);
  ta.select();
  let ok = false;
  try {
    ok = document.execCommand('copy');
  } catch {
    ok = false;
  }
  ta.remove();
  return ok;
}

export class LobbyScreen implements Screen {
  el: HTMLElement;
  private join: JoinPanel | null = null;
  private roomCode: string | null = null;
  private last: LobbyStateMsg | null = null;
  /** Hosted (public) room rather than a LAN host. */
  private hosted = false;
  private list: HTMLElement;
  private side: HTMLElement;
  private footer: HTMLElement;
  private loadText: HTMLElement;
  private loadBar: HTMLElement;
  private me = -1;
  private a: LobbyActions;
  private mobile: boolean;
  private loaded = false;

  constructor(info: ServerInfoMsg | null, me: number, mobile: boolean, a: LobbyActions) {
    this.a = a;
    this.me = me;
    this.mobile = mobile;

    if (info && !info.roomCode && info.qrSvg) {
      // LAN host: the host PC's own address.
      this.join = {
        url: info.joinUrl,
        qrSvg: info.qrSvg,
        code: null,
        extra: info.lanUrls.slice(1, 3),
        note: info.secure
          ? h('div', { class: 'small muted' }, 'Secure LAN mode. First time on a phone? Open ', h('span', { class: 'url' }, (info.caDownloadUrl ?? '').replace('/ca.crt', '/setup')), ' to trust the local certificate.')
          : h('div', { class: 'notice small' }, 'Phones need secure mode for tilt steering and fullscreen: restart the host with npm run dev:secure.'),
      };
    }
    this.list = h('div', { class: 'players' });
    this.side = h('div', { class: 'stack' });
    this.footer = h('div', { class: 'stack' });
    this.loadBar = h('i');
    this.loadText = h('div', { class: 'small muted' }, 'Loading race assets…');
    this.el = h(
      'div',
      { class: 'screen scrim lobby-screen' },
      h(
        'div',
        { class: 'lobby lobby-hero' },
        h('div', { class: 'panel stack' }, h('div', { class: 'row' }, h('h2', { class: 'grow' }, 'Lobby'), h('button', { class: 'btn small ghost', onclick: a.settings }, 'Settings'), h('button', { class: 'btn small ghost', onclick: a.leave }, 'Leave')), this.list, h('div', { class: 'stack' }, h('div', { class: 'loading-bar', style: 'width:100%' }, this.loadBar), this.loadText), this.footer),
        this.side,
      ),
    );
  }

  setLoad(frac: number, text: string, done: boolean): void {
    this.loadBar.style.width = `${Math.round(frac * 100)}%`;
    setText(this.loadText, text);
    this.loaded = done;
  }

  /** Hosted mode: the QR/link block (host) and the room code (everyone). */
  setJoin(j: JoinPanel | null, code: string | null = null): void {
    this.hosted = true;
    this.join = j;
    this.roomCode = code ?? j?.code ?? null;
    if (this.last) this.render(this.last);
  }

  /** The local player's id (known once the room welcomed this client). */
  setMe(id: number): void {
    this.me = id;
  }

  render(s: LobbyStateMsg): void {
    this.last = s;
    clear(this.list);
    for (const p of s.players) {
      const r = RIDERS[p.loadout.riderId], b = BIKES[p.loadout.bikeId];
      const status = !p.connected ? h('span', { class: 'badge off' }, 'offline') : p.ready ? h('span', { class: 'badge ready' }, 'ready') : h('span', { class: 'badge wait' }, p.loaded ? 'choosing' : 'loading');
      this.list.append(
        h(
          'div',
          { class: 'player' + (p.id === this.me ? ' me' : '') },
          h('div', { class: 'slot' }, String(p.slot + 1)),
          h('div', {}, h('div', { class: 'name' }, p.name, p.isHost ? h('span', { class: 'badge host' }, 'host') : null, status), h('div', { class: 'sub' }, `${r.name} · ${b.name} · ${WEAPONS[p.loadout.weaponId].name} · ${p.device}`)),
          s.hostId === this.me && p.id !== this.me ? h('button', { class: 'btn small danger', onclick: () => this.a.remove(p.id) }, 'Remove') : h('span'),
        ),
      );
    }
    for (let i = s.players.length; i < s.maxPlayers; i++) this.list.append(h('div', { class: 'player', style: 'opacity:0.35' }, h('div', { class: 'slot' }, String(i + 1)), h('div', { class: 'sub' }, 'Open slot'), h('span')));

    clear(this.footer);
    const mine = s.players.find((p) => p.id === this.me);
    const row = h('div', { class: 'row' });
    row.append(h('button', { class: 'btn', onclick: this.a.loadout }, 'Loadout'));
    if (mine) {
      if (mine.ready) row.append(h('button', { class: 'btn ghost', onclick: () => this.a.ready(false) }, 'Not ready'));
      else row.append(h('button', { class: 'btn primary', onclick: () => this.a.ready(true), disabled: !this.loaded }, this.mobile ? 'Enter Race' : 'Ready'));
    }
    if (s.hostId === this.me) row.append(h('button', { class: 'btn primary', onclick: this.a.start, disabled: !s.canStart }, 'Start Race'));
    this.footer.append(row);
    if (s.hostId === this.me && !s.canStart) for (const b of s.startBlockers) this.footer.append(h('div', { class: 'notice small' }, b));
    if (!s.assets.ok) this.footer.append(h('div', { class: 'notice error small' }, `Host is missing required runtime assets: ${s.assets.missingRequired.slice(0, 6).join(', ')}`));
    if (s.assets.missingOptional.length) this.footer.append(h('div', { class: 'notice small' }, `Optional cosmetic assets missing (graceful fallback): ${s.assets.missingOptional.length}`));
    if (s.phase !== 'LOBBY') this.footer.append(h('div', { class: 'notice small' }, 'A race is in progress. You will join the next one.'));

    clear(this.side);
    const j = this.join;
    if (s.hostId === this.me && j) {
      const copyBtn = h('button', { class: 'btn small', onclick: () => void copyText(j.url).then((ok) => { copyBtn.textContent = ok ? 'Link copied' : 'Copy failed'; window.setTimeout(() => (copyBtn.textContent = 'Copy link'), 1800); }) }, 'Copy link') as HTMLButtonElement;
      this.side.append(
        h(
          'div',
          { class: 'panel stack join-block' },
          h('h3', {}, 'Scan to join'),
          h('div', { class: 'qr', html: j.qrSvg, role: 'img', 'aria-label': `QR code for ${j.url}` }),
          j.code ? h('div', { class: 'room-code' }, h('span', { class: 'small muted' }, 'ROOM'), h('b', {}, j.code)) : null,
          h('div', { class: 'row', style: 'justify-content:center' }, copyBtn),
          h('div', { class: 'url small' }, j.url),
          ...j.extra.map((u) => h('div', { class: 'url small' }, u)),
          j.note ? (typeof j.note === 'string' ? h('div', { class: 'small muted' }, j.note) : j.note) : null,
        ),
      );
    } else if (s.hostId === this.me && this.hosted) {
      this.side.append(h('div', { class: 'panel small muted' }, 'Opening your room…'));
    }
    if (s.hostId !== this.me && this.roomCode) this.side.append(h('div', { class: 'panel room-code' }, h('span', { class: 'small muted' }, 'ROOM'), h('b', {}, this.roomCode)));
    const readyCount = s.players.filter((p) => p.ready).length;
    const isHost = s.hostId === this.me && s.phase === 'LOBBY';
    const lapCtl = h(
      'div',
      { class: 'laps-ctl' },
      h('span', { class: 'laps-label' }, 'LAPS'),
      isHost ? h('button', { class: 'btn small laps-btn', onclick: () => this.a.setLaps(s.laps - 1), disabled: s.laps <= RACE.minLaps, 'aria-label': 'Fewer laps' }, '–') : null,
      h('span', { class: 'laps-value' }, String(s.laps)),
      isHost ? h('button', { class: 'btn small laps-btn', onclick: () => this.a.setLaps(s.laps + 1), disabled: s.laps >= RACE.maxLaps, 'aria-label': 'More laps' }, '+') : null,
      isHost ? null : h('span', { class: 'small muted' }, 'set by the host'),
    );
    const km = ((s.laps * s.trackLength) / 1000).toFixed(1);
    this.side.append(
      h(
        'div',
        { class: 'panel stack race-panel' },
        h('h3', {}, 'Race'),
        lapCtl,
        h('div', { class: 'small muted race-summary' }, `${s.laps} lap${s.laps > 1 ? 's' : ''} • ${km} km · ${s.players.length}/${s.maxPlayers} riders · ${readyCount} ready`),
      ),
    );
  }
}

// ------------------------------------------------------------------------------ Loadout
export const LOADOUT_STEPS = ['Character', 'Character color', 'Player name', 'Bike', 'Bike color', 'Weapon', 'Ready'] as const;

export interface LoadoutActions {
  change: (l: Partial<LoadoutMsg> & { name?: string }) => void;
  done: () => void;
  back: () => void;
  step: (i: number) => void;
}

export class LoadoutScreen implements Screen {
  el: HTMLElement;
  private body: HTMLElement;
  private steps: HTMLElement;
  private label: HTMLElement;
  step = 0;
  private l: LoadoutMsg;
  private name: string;
  private a: LoadoutActions;
  private mobile: boolean;

  constructor(l: LoadoutMsg, name: string, mobile: boolean, a: LoadoutActions) {
    this.l = { ...l };
    this.name = name;
    this.a = a;
    this.mobile = mobile;
    this.body = h('div', { class: 'stack' });
    this.steps = h('div', { class: 'steps' });
    this.label = h('div', { class: 'preview-label' });
    this.el = h('div', { class: 'loadout' }, h('div', { class: 'side panel' }, h('div', { class: 'row' }, h('h2', { class: 'grow' }, 'Loadout'), h('button', { class: 'btn small ghost', onclick: a.back }, 'Lobby')), this.steps, this.body), this.label);
    this.render();
  }

  private go(i: number): void {
    this.step = Math.max(0, Math.min(LOADOUT_STEPS.length - 1, i));
    this.a.step(this.step);
    this.render();
  }

  private set(p: Partial<LoadoutMsg>): void {
    Object.assign(this.l, p);
    this.a.change(p);
    this.render();
  }

  render(): void {
    clear(this.steps);
    LOADOUT_STEPS.forEach((s, i) => this.steps.append(h('button', { class: 'step' + (i === this.step ? ' on' : i < this.step ? ' done' : ''), onclick: () => this.go(i) }, `${i + 1}. ${s}`)));
    clear(this.body);
    const nav = h('div', { class: 'row' }, this.step > 0 ? h('button', { class: 'btn ghost', onclick: () => this.go(this.step - 1) }, 'Back') : null, h('div', { class: 'grow' }));
    const next = (label = 'Next') => h('button', { class: 'btn primary', onclick: () => this.go(this.step + 1) }, label);
    const r = RIDERS[this.l.riderId], b = BIKES[this.l.bikeId];
    switch (this.step) {
      case 0: {
        this.body.append(h('h3', {}, 'Choose your rider'), h('div', { class: 'choices' }, ...SELECTABLE_RIDER_IDS.map((id) => this.choice(RIDERS[id].name, RIDERS[id].tagline, id === this.l.riderId, () => this.set({ riderId: id as RiderId })))));
        nav.append(next());
        break;
      }
      case 1: {
        this.body.append(h('h3', {}, `${r.name} colors`), this.swatches(r.variants.map((v) => ({ name: v.name, a: v.primary, b: v.emissive })), this.l.riderColor, (i) => this.set({ riderColor: i })));
        nav.append(next());
        break;
      }
      case 2: {
        const input = h('input', { class: 'name-input', maxlength: 16, value: this.name, placeholder: 'Rider name' }) as HTMLInputElement;
        input.addEventListener('input', () => {
          this.name = input.value;
          this.a.change({ name: input.value });
        });
        input.addEventListener('keydown', (e) => {
          e.stopPropagation();
          if (e.key === 'Enter') this.go(this.step + 1);
        });
        this.body.append(h('h3', {}, 'Player name'), input, h('div', { class: 'small muted' }, 'Up to 16 characters. Shown on the grid, the board and the results.'));
        setTimeout(() => input.focus(), 50);
        nav.append(next());
        break;
      }
      case 3: {
        this.body.append(h('h3', {}, 'Choose your bike'), h('div', { class: 'small muted' }, 'All bikes share the same 400 km/h top speed.'), h('div', { class: 'choices' }, ...BIKE_IDS.map((id) => this.choice(BIKES[id].name, BIKES[id].tagline, id === this.l.bikeId, () => this.set({ bikeId: id as BikeId })))), this.bikeStats(this.l.bikeId));
        nav.append(next());
        break;
      }
      case 4: {
        this.body.append(h('h3', {}, `${b.name} colors`), this.swatches(b.variants.map((v) => ({ name: v.name, a: v.paint === '#ffffff' ? v.emissive : v.paint, b: v.emissive })), this.l.bikeColor, (i) => this.set({ bikeColor: i })));
        nav.append(next());
        break;
      }
      case 5: {
        this.body.append(h('h3', {}, 'Choose your weapon'), h('div', { class: 'choices' }, ...WEAPON_IDS.map((id) => this.choice(WEAPONS[id].name, WEAPONS[id].tagline, id === this.l.weaponId, () => this.set({ weaponId: id as WeaponId })))), h('div', { class: 'small muted' }, 'Desktop: Space = kick, Enter = weapon, N = boost (when you have charges). Mobile: KICK / HIT buttons.'));
        nav.append(next());
        break;
      }
      default: {
        this.body.append(
          h('h3', {}, 'Ready?'),
          h('div', { class: 'small' }, `${this.name || 'Rider'} · ${r.name} (${r.variants[this.l.riderColor]!.name}) · ${b.name} (${b.variants[this.l.bikeColor]!.name}) · ${WEAPONS[this.l.weaponId].name}`),
          this.mobile ? h('div', { class: 'small muted' }, 'ENTER RACE asks for motion access, goes fullscreen, locks landscape and sets your current phone angle as straight ahead.') : h('div', { class: 'small muted' }, 'Arrow keys to ride · Space kick · Enter weapon · N boost.'),
        );
        nav.append(h('button', { class: 'btn primary big', onclick: this.a.done }, this.mobile ? 'Enter Race' : 'Ready'));
      }
    }
    this.body.append(nav);
    setText(this.label, '');
    const subject = this.step <= 2 ? r.name : this.step <= 4 ? b.name : this.step === 5 ? WEAPONS[this.l.weaponId].name : `${r.name} · ${b.name} · ${WEAPONS[this.l.weaponId].name}`;
    this.label.append(h('div', { class: 'small muted' }, subject));
  }

  private choice(title: string, desc: string, sel: boolean, on: () => void): HTMLElement {
    return h('button', { class: 'choice' + (sel ? ' sel' : ''), onclick: on }, h('div', { class: 't' }, title), h('div', { class: 'd' }, desc));
  }

  private swatches(list: { name: string; a: string; b: string }[], sel: number, on: (i: number) => void): HTMLElement {
    return h('div', { class: 'swatches' }, ...list.map((v, i) => h('button', { class: 'swatch' + (i === sel ? ' sel' : ''), style: `background:linear-gradient(135deg, ${v.a} 0 55%, ${v.b} 55% 100%)`, onclick: () => on(i), title: v.name }, v.name)));
  }

  private bikeStats(id: BikeId): HTMLElement {
    const s = BIKE_BALANCE[id];
    const bar = (label: string, v: number, lo: number, hi: number) => h('div', { class: 'stat' }, label, h('div', { class: 'bar' }, h('i', { style: `width:${Math.round(((v - lo) / (hi - lo)) * 80 + 20)}%` })));
    return h('div', { class: 'stack', style: 'gap:6px' }, bar('Acceleration', s.accel, 10, 13.2), bar('Handling', s.handling, 0.82, 1.18), bar('Stability', s.stability, 0.78, 1.2));
  }
}

// ------------------------------------------------------------------------------ Settings
export class SettingsScreen implements Screen {
  el: HTMLElement;
  constructor(opts: { mobile: boolean; onClose: () => void; onRecalibrate?: () => void; onLeave?: () => void; onEndRace?: () => void; applied: () => void }) {
    const s = settings();
    const seg = <T extends string>(values: readonly T[], cur: T, on: (v: T) => void) => {
      const wrap = h('div', { class: 'seg' });
      for (const v of values) wrap.append(h('button', { class: v === cur ? 'on' : '', onclick: () => { on(v); this.refresh(opts); } }, v));
      return wrap;
    };
    const range = (min: number, max: number, step: number, v: number, on: (x: number) => void) => {
      const i = h('input', { type: 'range', min: String(min), max: String(max), step: String(step), value: String(v) }) as HTMLInputElement;
      i.addEventListener('input', () => on(Number(i.value)));
      return i;
    };
    this.el = h(
      'div',
      { class: 'screen center scrim' },
      h(
        'div',
        { class: 'panel settings stack' },
        h('div', { class: 'row' }, h('h2', { class: 'grow' }, 'Settings'), h('button', { class: 'btn small', onclick: opts.onClose }, 'Close')),
        h('div', { class: 'setting' }, h('div', {}, 'Graphics', h('div', { class: 'small muted' }, 'Presets never change gameplay or hazard visibility.')), seg(['AUTO', ...GRAPHICS_PRESETS] as const, s.graphics, (v) => { updateSettings({ graphics: v }); opts.applied(); })),
        h('div', { class: 'setting' }, h('div', {}, 'Volume'), range(0, 1, 0.05, s.volume, (v) => updateSettings({ volume: v }))),
        opts.mobile ? h('div', { class: 'setting' }, h('div', {}, 'Tilt sensitivity', h('div', { class: 'small muted' }, `±${STEERING.gyroDeadzoneDeg}° deadzone · ±${STEERING.gyroFullSteerDeg}° full steer at 1.0x`)), range(STEERING.gyroSensitivityMin, STEERING.gyroSensitivityMax, 0.05, s.gyroSensitivity, (v) => updateSettings({ gyroSensitivity: v }))) : null,
        opts.mobile ? h('div', { class: 'setting' }, h('div', {}, 'Invert tilt'), seg(['OFF', 'ON'] as const, s.invertGyro ? 'ON' : 'OFF', (v) => updateSettings({ invertGyro: v === 'ON' }))) : null,
        opts.mobile ? h('div', { class: 'setting' }, h('div', {}, 'Steering', h('div', { class: 'small muted' }, 'Touch zones are used automatically when tilt is unavailable.')), seg(['TILT', 'TOUCH'] as const, s.touchSteering ? 'TOUCH' : 'TILT', (v) => { updateSettings({ touchSteering: v === 'TOUCH' }); opts.applied(); })) : null,
        opts.onRecalibrate ? h('div', { class: 'setting' }, h('div', {}, 'Tilt neutral', h('div', { class: 'small muted' }, 'Hold the phone comfortably, then recalibrate.')), h('button', { class: 'btn small', onclick: opts.onRecalibrate }, 'Recalibrate')) : null,
        h('div', { class: 'setting' }, h('div', {}, 'Performance overlay'), seg(['OFF', 'ON'] as const, s.showPerf ? 'ON' : 'OFF', (v) => updateSettings({ showPerf: v === 'ON' }))),
        opts.onLeave ? h('button', { class: 'btn danger', onclick: opts.onLeave }, 'Leave race') : null,
        opts.onEndRace ? confirmButton('End race for everyone', 'Tap again: unfinished riders become DNF', opts.onEndRace) : null,
      ),
    );
  }
  private refresh(opts: ConstructorParameters<typeof SettingsScreen>[0]): void {
    const fresh = new SettingsScreen(opts);
    this.el.replaceWith(fresh.el);
    this.el = fresh.el;
  }
}
