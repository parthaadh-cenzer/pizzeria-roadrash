// Race HUD (art direction "UI style"): minimal, high-contrast, semi-transparent. Position,
// minimap/progress, displayed speed, weapon, boost charges only after the cheat, subtle network.
import { displaySpeedKmh } from '../config/gameplay.js';
import type { Track } from '../game/track/Track.js';
import { h, setText, toggle } from './dom.js';

export interface HudRider {
  id: number;
  lapDist: number;
  x: number;
  z: number;
  me: boolean;
}

export interface HudData {
  position: number;
  total: number;
  /** Current lap (1-based) and race length. */
  lap: number;
  laps: number;
  speed: number;
  weapon: string;
  boostCharges: number;
  cheatActive: boolean;
  pingMs: number;
  connected: boolean;
  riders: HudRider[];
  trackLength: number;
}

export class Hud {
  readonly el: HTMLElement;
  private pos: HTMLElement;
  private lapEl: HTMLElement;
  private speed: HTMLElement;
  private weapon: HTMLElement;
  private boost: HTMLElement;
  /** Desktop key hint shown next to the charges once the cheat is active. */
  private boostHint: HTMLElement;
  private mobile: boolean;
  private net: HTMLElement;
  private progress: HTMLElement;
  private center: HTMLElement;
  private countdown: HTMLElement;
  private perf: HTMLElement;
  private map: HTMLCanvasElement;
  private mapCtx: CanvasRenderingContext2D;
  private mapPath: Path2D;
  private mapXf: (x: number, z: number) => [number, number];
  private msgTimer = 0;
  private marks: HTMLElement[] = [];

  constructor(track: Track, mobile: boolean) {
    this.pos = h('div', { class: 'pos' });
    this.lapEl = h('div', { class: 'lap' });
    this.speed = h('div', { class: 'speed' });
    this.weapon = h('div', { class: 'weapon' });
    this.boost = h('div', { class: 'boost' });
    this.boostHint = h('div', { class: 'boost-hint', style: 'display:none;font-size:11px;letter-spacing:.12em;opacity:.7;margin-top:2px' }, 'PRESS N TO BOOST');
    this.mobile = mobile;
    this.net = h('div', { class: 'net' });
    this.progress = h('div', { class: 'progress' });
    this.center = h('div', { class: 'center-msg', style: 'opacity:0' });
    this.countdown = h('div', { class: 'countdown', style: 'display:none' });
    this.perf = h('div', { class: 'perf', style: 'display:none' });
    this.map = h('canvas', { class: 'minimap' }) as HTMLCanvasElement;
    const size = mobile ? 110 : 150;
    this.map.width = this.map.height = size * 2;
    this.map.style.width = this.map.style.height = `${size}px`;
    this.mapCtx = this.map.getContext('2d')!;
    // Precompute the track outline in minimap space (north-up).
    let minX = Infinity, maxX = -Infinity, minZ = Infinity, maxZ = -Infinity;
    for (let i = 0; i < track.n; i += 4) {
      minX = Math.min(minX, track.px[i]!);
      maxX = Math.max(maxX, track.px[i]!);
      minZ = Math.min(minZ, track.pz[i]!);
      maxZ = Math.max(maxZ, track.pz[i]!);
    }
    const S = size * 2, pad = 14;
    const sc = (S - pad * 2) / Math.max(maxX - minX, maxZ - minZ);
    this.mapXf = (x, z) => [pad + (x - minX) * sc, pad + (z - minZ) * sc];
    this.mapPath = new Path2D();
    for (let i = 0; i <= track.n; i += 8) {
      const j = i % track.n;
      const [mx, my] = this.mapXf(track.px[j]!, track.pz[j]!);
      if (i === 0) this.mapPath.moveTo(mx, my);
      else this.mapPath.lineTo(mx, my);
    }
    this.el = h(
      'div',
      { class: 'hud' },
      h('div', { class: 'tl' }, this.pos, this.lapEl, this.progress, this.net),
      h('div', { class: mobile ? 'tr' : 'bl' }, this.map),
      h('div', { class: mobile ? 'tr' : 'br', style: mobile ? 'top:auto;bottom:calc(150px + var(--safe-b));right:calc(20px + var(--safe-r))' : '' }, this.speed, this.weapon, this.boost, this.boostHint),
      this.center,
      this.countdown,
      this.perf,
    );
  }

  update(dt: number, d: HudData): void {
    this.pos.innerHTML = `${d.position}<small>/${d.total}</small>`;
    setText(this.lapEl, `LAP ${d.lap}/${d.laps}`);
    this.speed.innerHTML = `${displaySpeedKmh(d.speed)}<small>km/h</small>`;
    setText(this.weapon, d.weapon);
    setText(this.boost, d.cheatActive ? `BOOST ×${d.boostCharges}` : '');
    const hint = d.cheatActive && !this.mobile && d.boostCharges > 0 ? 'block' : 'none';
    if (this.boostHint.style.display !== hint) this.boostHint.style.display = hint;
    setText(this.net, d.connected ? `${Math.round(d.pingMs)} ms` : 'reconnecting…');
    toggle(this.net, 'bad', !d.connected || d.pingMs > 120);
    // Progress bar marks.
    while (this.marks.length < d.riders.length) {
      const m = document.createElement('i');
      this.progress.appendChild(m);
      this.marks.push(m);
    }
    d.riders.forEach((r, i) => {
      const m = this.marks[i]!;
      m.className = r.me ? 'me' : '';
      m.style.left = `${Math.max(0, Math.min(1, r.lapDist / (d.trackLength * d.laps))) * 100}%`;
    });
    // Minimap.
    const g = this.mapCtx;
    g.clearRect(0, 0, this.map.width, this.map.height);
    g.lineWidth = 5;
    g.strokeStyle = 'rgba(24,224,255,0.55)';
    g.stroke(this.mapPath);
    for (const r of d.riders) {
      const [x, y] = this.mapXf(r.x, r.z);
      g.fillStyle = r.me ? '#ff2bd6' : '#ffffff';
      g.beginPath();
      g.arc(x, y, r.me ? 9 : 6, 0, Math.PI * 2);
      g.fill();
    }
    if (this.msgTimer > 0) {
      this.msgTimer -= dt;
      if (this.msgTimer <= 0) this.center.style.opacity = '0';
    }
  }

  message(text: string, seconds = 2): void {
    setText(this.center, text);
    this.center.style.opacity = '1';
    this.msgTimer = seconds;
  }

  setCountdown(text: string | null): void {
    if (text === null) {
      this.countdown.style.display = 'none';
      return;
    }
    this.countdown.style.display = 'block';
    setText(this.countdown, text);
    toggle(this.countdown, 'go', text === 'GO');
  }

  setPerf(text: string | null): void {
    this.perf.style.display = text ? 'block' : 'none';
    if (text) setText(this.perf, text);
  }

  setVisible(v: boolean): void {
    this.el.style.display = v ? 'block' : 'none';
  }
}
