// Per-device preferences (localStorage, guarded: private mode must still work).
import { STEERING } from '../config/gameplay.js';
import type { GraphicsPreset } from '../shared/ids.js';

export interface Settings {
  graphics: GraphicsPreset | 'AUTO';
  gyroSensitivity: number;
  invertGyro: boolean;
  touchSteering: boolean;
  volume: number;
  showPerf: boolean;
  lastName: string;
}

const KEY = 'pr.settings.v1';

const DEFAULTS: Settings = {
  graphics: 'AUTO',
  gyroSensitivity: STEERING.gyroSensitivityDefault,
  invertGyro: false,
  touchSteering: false,
  volume: 0.8,
  showPerf: false,
  lastName: '',
};

let current: Settings = { ...DEFAULTS };
const listeners: ((s: Settings) => void)[] = [];

export function loadSettings(): Settings {
  try {
    const raw = localStorage.getItem(KEY);
    if (raw) current = { ...DEFAULTS, ...(JSON.parse(raw) as Partial<Settings>) };
  } catch {
    current = { ...DEFAULTS };
  }
  if (import.meta.env.DEV && new URLSearchParams(location.search).has('perf')) current.showPerf = true;
  return current;
}

export function settings(): Settings {
  return current;
}

export function updateSettings(patch: Partial<Settings>): void {
  current = { ...current, ...patch };
  try {
    localStorage.setItem(KEY, JSON.stringify(current));
  } catch {
    /* storage unavailable: keep in memory */
  }
  for (const l of listeners) l(current);
}

export function onSettings(l: (s: Settings) => void): () => void {
  listeners.push(l);
  return () => listeners.splice(listeners.indexOf(l), 1);
}
