// Screen water: rain droplets that accumulate/slide/drain, and the large-puddle splash sheet
// that rises from the bottom and lower sides, briefly distorts the view, breaks into streaks and
// drains away within ~0.8-1.3 s. Encoded as a refraction map
// (rg = normal, b = thickness, a = coverage) consumed by the final post pass.
import * as THREE from 'three';

interface Drop {
  x: number;
  y: number;
  r: number;
  vy: number;
  life: number;
  max: number;
  trail: number;
}

function makeSprite(size: number): HTMLCanvasElement {
  const c = document.createElement('canvas');
  c.width = c.height = size;
  const g = c.getContext('2d')!;
  const img = g.createImageData(size, size);
  const R = size / 2;
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const dx = (x + 0.5 - R) / R, dy = (y + 0.5 - R) / R;
      const d2 = dx * dx + dy * dy;
      const i = (y * size + x) * 4;
      if (d2 >= 1) {
        img.data[i + 3] = 0;
        continue;
      }
      const nz = Math.sqrt(1 - d2);
      img.data[i] = Math.round((0.5 + dx * 0.5) * 255);
      img.data[i + 1] = Math.round((0.5 - dy * 0.5) * 255);
      img.data[i + 2] = Math.round(nz * 255);
      img.data[i + 3] = Math.round(Math.min(1, (1 - d2) * 3) * 255);
    }
  }
  g.putImageData(img, 0, 0);
  return c;
}

const clamp01 = (v: number) => Math.max(0, Math.min(1, v));

export class ScreenWater {
  readonly canvas: HTMLCanvasElement;
  readonly texture: THREE.CanvasTexture;
  private ctx: CanvasRenderingContext2D;
  private sprite: HTMLCanvasElement;
  private drops: Drop[] = [];
  private rain = 0;
  private speed = 0;
  private covered = 1;
  private sheet = 0; // 0..1 current sheet coverage (drives the draw)
  private sheetPhase: 'none' | 'active' = 'none';
  private sheetTime = 0;
  private sheetStrength = 0;
  private sheetDuration = 1;
  /** Per-column rivulet parameters (drain speed factor, break-up threshold). */
  private cols: { speed: number; brk: number; wob: number }[] = [];
  private w = 384;
  private h = 216;

  constructor() {
    this.canvas = document.createElement('canvas');
    this.canvas.width = this.w;
    this.canvas.height = this.h;
    this.ctx = this.canvas.getContext('2d')!;
    this.sprite = makeSprite(64);
    this.texture = new THREE.CanvasTexture(this.canvas);
    this.texture.colorSpace = THREE.NoColorSpace;
    this.texture.minFilter = THREE.LinearFilter;
    this.texture.generateMipmaps = false;
  }

  resize(width: number, height: number): void {
    const aspect = width / Math.max(1, height);
    const h = 216;
    const w = Math.round(Math.max(160, Math.min(640, h * aspect)));
    if (w !== this.w) {
      this.w = w;
      this.h = h;
      this.canvas.width = w;
      this.canvas.height = h;
      this.texture.dispose();
    }
  }

  /** intensity 0..1 of outdoor rain reaching the lens; speed 0..1 of max speed. */
  setRain(intensity: number, speed01: number, covered: boolean): void {
    this.rain = intensity;
    this.speed = speed01;
    this.covered = covered ? 1 : 0;
  }

  /** Large, fast puddle hit only: the splash sheet (strength 0..1 scales height and duration). */
  splash(strength: number): void {
    this.sheetStrength = Math.max(this.sheetPhase === 'none' ? 0 : this.sheetStrength, Math.min(1, strength));
    this.sheetPhase = 'active';
    this.sheetTime = 0;
    this.sheetDuration = 0.8 + 0.5 * this.sheetStrength;
    this.cols = [];
    for (let x = -12; x < this.w + 12; x += 7) this.cols.push({ speed: 0.7 + Math.random() * 0.8, brk: Math.random(), wob: Math.random() * 6.28 });
    for (let i = 0; i < 14 * strength; i++) this.spawn(true);
  }

  clear(): void {
    this.drops = [];
    this.sheet = 0;
    this.sheetPhase = 'none';
  }

  private spawn(fromSplash: boolean): void {
    const big = fromSplash || Math.random() < 0.12;
    const r = big ? 5 + Math.random() * 9 : 1.5 + Math.random() * 4;
    this.drops.push({
      x: Math.random() * this.w,
      y: fromSplash ? this.h * (0.45 + Math.random() * 0.55) : Math.random() * this.h * 0.95,
      r,
      vy: 0,
      life: 0,
      max: fromSplash ? 0.8 + Math.random() * 0.8 : 2.2 + Math.random() * 4,
      trail: 0,
    });
  }

  update(dt: number): void {
    // Spawning: heavier rain and speed put more water on the lens; covered (tunnel) = none.
    if (!this.covered) {
      // ~40% of the original lens-drop rate: world rain carries the weather, the lens stays readable.
      const rate = this.rain * (8 + 22 * this.speed) * 0.4;
      let n = rate * dt;
      while (n > 0) {
        if (Math.random() < n) this.spawn(false);
        n -= 1;
      }
    }
    const drainBoost = this.covered ? 2.5 : 1;
    for (const d of this.drops) {
      d.life += dt * drainBoost;
      if (d.r > 4.5 || this.covered) d.vy = Math.min(140, d.vy + dt * (40 + d.r * 12) * drainBoost);
      d.y += d.vy * dt;
      d.x += (Math.random() - 0.5) * d.vy * 0.02;
      if (d.vy > 20) d.trail += dt;
    }
    this.drops = this.drops.filter((d) => d.life < d.max && d.y - d.r < this.h + 4);
    if (this.drops.length > 110) this.drops.splice(0, this.drops.length - 110);

    // Splash sheet: rise (0.12 s) -> hold/distort -> break into streaks and drain.
    if (this.sheetPhase === 'active') {
      this.sheetTime += dt;
      const t = this.sheetTime;
      this.sheet = Math.min(1, t / 0.12) * this.sheetStrength;
      if (t >= this.sheetDuration) {
        this.sheetPhase = 'none';
        this.sheet = 0;
        this.sheetStrength = 0;
      }
    }
    this.draw();
  }

  /**
   * The sheet surface: a waterline higher at the lower sides (the spray comes up from the wheels
   * and the road edges). After a short hold it breaks into rivulets: each column's top drains down
   * at its own speed and columns thin out, leaving streaks that run off the bottom.
   */
  private drawSheet(g: CanvasRenderingContext2D): void {
    const t = this.sheetTime, T = this.sheetDuration, H = this.h, W = this.w;
    const hold = 0.26, breakT = clamp01((t - hold) / Math.max(0.1, T - hold));
    const clock = performance.now() * 0.001;
    this.cols.forEach((c, i) => {
      const x = -12 + i * 7;
      const edge = Math.pow(Math.abs(x - W / 2) / (W / 2), 2);
      // Waterline: rises with the sheet, higher toward the lower corners, wavy while it rises.
      const rise = this.sheet * (0.42 + 0.3 * edge);
      const wave = (Math.sin(x * 0.07 + clock * 3 + c.wob) * 7 + Math.sin(x * 0.21 - clock * 5) * 4) * (1 - breakT);
      // Drain: gravity per column after the hold.
      const fall = breakT * breakT * c.speed * H * 1.1;
      const top = H * (1 - rise) + wave + fall;
      if (top > H + 8) return;
      // Break-up: columns disappear progressively; the survivors become thin streaks.
      const alive = breakT < 0.08 || c.brk > breakT * 0.95;
      if (!alive) return;
      const streak = breakT > 0.08;
      const r = streak ? 3.5 + (1 - breakT) * 3 : 10 + ((i * 13) % 6);
      const a = Math.min(1, this.sheet * 1.4) * (streak ? 0.75 * (1 - breakT * 0.6) : 1);
      for (let y = top; y < H + 12; y += streak ? 6 : 11) {
        g.globalAlpha = a * (0.55 + 0.45 * ((y - top) / (H - top + 1)));
        g.drawImage(this.sprite, x - r, y - r * (streak ? 1.6 : 1), r * 2, r * (streak ? 3.2 : 2));
      }
    });
    g.globalAlpha = 1;
  }

  private draw(): void {
    const g = this.ctx;
    g.clearRect(0, 0, this.w, this.h);
    if (this.sheet > 0.01) this.drawSheet(g);
    for (const d of this.drops) {
      const fade = Math.min(1, (d.max - d.life) / 0.6);
      g.globalAlpha = fade;
      if (d.trail > 0) {
        const len = Math.min(40, d.vy * 0.25);
        for (let k = 1; k < 4; k++) {
          const rr = d.r * (0.5 - k * 0.1);
          g.drawImage(this.sprite, d.x - rr, d.y - k * len * 0.3 - rr, rr * 2, rr * 2);
        }
      }
      g.drawImage(this.sprite, d.x - d.r, d.y - d.r * 1.1, d.r * 2, d.r * 2.2);
    }
    g.globalAlpha = 1;
    this.texture.needsUpdate = true;
  }
}
