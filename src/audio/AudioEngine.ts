// Audio with named hooks (IMPLEMENTATION_CONTRACT §19). No source audio files are supplied, so every
// hook is a lightweight procedural WebAudio synth; if runtime audio assets appear in the manifest
// later they can replace a hook. Missing audio never throws — failures log a non-fatal warning.
import type { BikeId } from '../shared/ids.js';
import { settings } from '../client/settings.js';

export type AudioHook =
  | 'engine' | 'rain' | 'spray' | 'impact' | 'swish' | 'hit' | 'tunnel' | 'wind' | 'countdown' | 'go' | 'crowd' | 'ui' | 'thunder' | 'boost' | 'splash' | 'scrape';

interface EngineVoice {
  osc1: OscillatorNode;
  osc2: OscillatorNode;
  filter: BiquadFilterNode;
  gain: GainNode;
  kind: 'combustion' | 'turbine' | 'electric';
}

const ENGINE_KIND: Record<BikeId, EngineVoice['kind']> = {
  BIKE_01_SCIFI_MOTORCYCLE: 'electric',
  BIKE_02_AKIRA_CRUISER: 'combustion',
  BIKE_03_HOVERING_ENGINE: 'turbine',
  BIKE_04_HOVER_ROCKET: 'turbine',
  BIKE_05_TRON_LIGHT_CYCLE: 'electric',
  BIKE_06_MONOBIKE: 'combustion',
};

export class AudioEngine {
  private ctx: AudioContext | null = null;
  private master: GainNode | null = null;
  private noise: AudioBuffer | null = null;
  private engines = new Map<number, EngineVoice>();
  private loops = new Map<string, { src: AudioBufferSourceNode; filter: BiquadFilterNode; gain: GainNode }>();
  private warned = false;
  readonly source = 'procedural';

  /** Must be called from a user gesture (browser autoplay policy). */
  unlock(): void {
    try {
      if (!this.ctx) {
        const Ctx = window.AudioContext ?? (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
        if (!Ctx) return this.warn('WebAudio unavailable; running silent');
        this.ctx = new Ctx();
        this.master = this.ctx.createGain();
        this.master.gain.value = settings().volume;
        this.master.connect(this.ctx.destination);
        const len = this.ctx.sampleRate * 2;
        this.noise = this.ctx.createBuffer(1, len, this.ctx.sampleRate);
        const d = this.noise.getChannelData(0);
        for (let i = 0; i < len; i++) d[i] = Math.random() * 2 - 1;
        console.info('[audio] no runtime audio assets in the manifest; using procedural synthesis for all hooks');
      }
      void this.ctx.resume();
    } catch (e) {
      this.warn(`audio init failed: ${String(e)}`);
    }
  }

  private warn(msg: string): void {
    if (!this.warned) console.warn(`[audio] ${msg}`);
    this.warned = true;
  }

  get ready(): boolean {
    return !!this.ctx && this.ctx.state === 'running';
  }

  setVolume(v: number): void {
    if (this.master) this.master.gain.value = v;
  }

  private loop(name: string, type: BiquadFilterType, freq: number, q = 0.7): { gain: GainNode; filter: BiquadFilterNode } | null {
    if (!this.ctx || !this.noise || !this.master) return null;
    let l = this.loops.get(name);
    if (!l) {
      const src = this.ctx.createBufferSource();
      src.buffer = this.noise;
      src.loop = true;
      const filter = this.ctx.createBiquadFilter();
      filter.type = type;
      filter.frequency.value = freq;
      filter.Q.value = q;
      const gain = this.ctx.createGain();
      gain.gain.value = 0;
      src.connect(filter).connect(gain).connect(this.master);
      src.start();
      l = { src, filter, gain };
      this.loops.set(name, l);
    }
    return l;
  }

  /** Continuous ambience: rain intensity 0..3, tunnel factor 0..1, bridge wind 0..1, crowd 0..1. */
  ambience(rain: number, rainFactor: number, tunnel: number, wind: number, crowd: number, speed01: number): void {
    if (!this.ctx) return;
    const t = this.ctx.currentTime;
    const r = this.loop('rain', 'highpass', 900, 0.5);
    r?.gain.gain.setTargetAtTime(Math.min(0.5, 0.06 + rain * 0.12) * rainFactor, t, 0.4);
    const tn = this.loop('tunnel', 'lowpass', 180, 2.5);
    tn?.gain.gain.setTargetAtTime(tunnel * 0.35, t, 0.4);
    const w = this.loop('wind', 'bandpass', 500 + speed01 * 900, 0.8);
    w?.gain.gain.setTargetAtTime(0.03 + wind * 0.25 + speed01 * 0.12, t, 0.3);
    const c = this.loop('crowd', 'bandpass', 1100, 0.6);
    c?.gain.gain.setTargetAtTime(crowd * 0.18, t, 0.5);
    const s = this.loop('spray', 'highpass', 2500, 0.3);
    s?.gain.gain.setTargetAtTime(Math.min(0.3, speed01 * 0.2 * (0.4 + rain * 0.3) * rainFactor), t, 0.15);
  }

  /** Engine voice per racer (class-specific timbre); distance attenuates remote bikes. */
  engine(id: number, bike: BikeId, speed: number, throttle: number, boosting: boolean, gain: number): void {
    if (!this.ctx || !this.master) return;
    let v = this.engines.get(id);
    if (!v) {
      const kind = ENGINE_KIND[bike];
      const osc1 = this.ctx.createOscillator();
      const osc2 = this.ctx.createOscillator();
      osc1.type = kind === 'combustion' ? 'sawtooth' : kind === 'turbine' ? 'triangle' : 'square';
      osc2.type = kind === 'turbine' ? 'sine' : 'sawtooth';
      const filter = this.ctx.createBiquadFilter();
      filter.type = 'lowpass';
      filter.frequency.value = 600;
      const g = this.ctx.createGain();
      g.gain.value = 0;
      osc1.connect(filter);
      osc2.connect(filter);
      filter.connect(g).connect(this.master);
      osc1.start();
      osc2.start();
      v = { osc1, osc2, filter, gain: g, kind };
      this.engines.set(id, v);
    }
    const t = this.ctx.currentTime;
    const s = Math.abs(speed) / 80;
    const base = v.kind === 'combustion' ? 38 + s * 120 : v.kind === 'turbine' ? 160 + s * 520 : 70 + s * 260;
    v.osc1.frequency.setTargetAtTime(base * (boosting ? 1.2 : 1), t, 0.05);
    v.osc2.frequency.setTargetAtTime(base * (v.kind === 'turbine' ? 2.01 : 1.5), t, 0.05);
    v.filter.frequency.setTargetAtTime(400 + throttle * 1600 + s * 1800 + (boosting ? 1500 : 0), t, 0.08);
    v.gain.gain.setTargetAtTime(gain * (0.05 + throttle * 0.05 + s * 0.06), t, 0.08);
  }

  stopEngines(): void {
    for (const v of this.engines.values()) {
      v.osc1.stop();
      v.osc2.stop();
      v.gain.disconnect();
    }
    this.engines.clear();
  }

  private burst(dur: number, type: BiquadFilterType, freq: number, gain: number, sweepTo?: number): void {
    if (!this.ctx || !this.noise || !this.master) return;
    const t = this.ctx.currentTime;
    const src = this.ctx.createBufferSource();
    src.buffer = this.noise;
    const f = this.ctx.createBiquadFilter();
    f.type = type;
    f.frequency.setValueAtTime(freq, t);
    if (sweepTo) f.frequency.exponentialRampToValueAtTime(sweepTo, t + dur);
    const g = this.ctx.createGain();
    g.gain.setValueAtTime(gain, t);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    src.connect(f).connect(g).connect(this.master);
    src.start(t, Math.random());
    src.stop(t + dur + 0.05);
  }

  private tone(freq: number, dur: number, gain: number, type: OscillatorType = 'sine', slideTo?: number): void {
    if (!this.ctx || !this.master) return;
    const t = this.ctx.currentTime;
    const o = this.ctx.createOscillator();
    o.type = type;
    o.frequency.setValueAtTime(freq, t);
    if (slideTo) o.frequency.exponentialRampToValueAtTime(slideTo, t + dur);
    const g = this.ctx.createGain();
    g.gain.setValueAtTime(gain, t);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    o.connect(g).connect(this.master);
    o.start(t);
    o.stop(t + dur + 0.02);
  }

  /** One-shot named hooks. */
  play(hook: AudioHook, intensity = 1): void {
    if (!this.ctx) return;
    try {
      switch (hook) {
        case 'impact':
          this.burst(0.35, 'lowpass', 900, 0.5 * intensity);
          this.tone(70, 0.3, 0.4 * intensity, 'sine', 40);
          break;
        case 'scrape':
          this.burst(0.18, 'bandpass', 3200, 0.12 * intensity);
          break;
        case 'swish':
          this.burst(0.22, 'bandpass', 700, 0.18 * intensity, 3000);
          break;
        case 'hit':
          this.tone(620, 0.25, 0.18 * intensity, 'triangle', 380);
          this.tone(1370, 0.18, 0.1 * intensity, 'sine');
          this.burst(0.12, 'highpass', 2000, 0.2 * intensity);
          break;
        case 'countdown':
          this.tone(440, 0.28, 0.25, 'square');
          break;
        case 'go':
          this.tone(880, 0.6, 0.3, 'square');
          this.burst(0.8, 'lowpass', 300, 0.35, 1800);
          break;
        case 'splash':
          this.burst(0.5, 'bandpass', 1200, 0.35 * intensity, 300);
          break;
        case 'boost':
          this.burst(1.2, 'bandpass', 400, 0.4, 2400);
          break;
        case 'thunder':
          this.burst(2.4, 'lowpass', 180, 0.6 * intensity, 60);
          break;
        case 'ui':
          this.tone(1200, 0.05, 0.06, 'sine');
          break;
        case 'crowd':
          this.burst(1.6, 'bandpass', 1300, 0.3 * intensity);
          break;
        default:
          break;
      }
    } catch (e) {
      this.warn(`hook ${hook} failed: ${String(e)}`);
    }
  }

  silenceLoops(): void {
    if (!this.ctx) return;
    for (const l of this.loops.values()) l.gain.gain.setTargetAtTime(0, this.ctx.currentTime, 0.2);
  }
}
