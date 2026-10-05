// Desktop cheat parser and mobile tilt mapping (pure logic; no browser needed).
import { beforeAll, describe, expect, it } from 'vitest';
import { BOOST_CHEAT, SIM_DT, STEERING } from '../src/config/gameplay.js';
import { screenRollFromOrientation, steerFromRoll } from '../src/input/Gyro.js';
import type { Keyboard as KeyboardT } from '../src/input/Keyboard.js';

const DEG = Math.PI / 180;
let Keyboard: typeof KeyboardT;

beforeAll(async () => {
  // Keyboard attaches listeners to window; a bare EventTarget is enough under node.
  (globalThis as unknown as { window: EventTarget }).window ??= new EventTarget();
  ({ Keyboard } = await import('../src/input/Keyboard.js'));
});

function typeWord(k: KeyboardT, word: string): void {
  for (const ch of word) k.feed(`Key${ch.toUpperCase()}`, ch);
}
const shift1 = (k: KeyboardT) => k.feed('Digit1', '!', true);

describe('secret boost cheat parser (keyboard only)', () => {
  it('requests activation only after the exact phrase followed by Shift+1', () => {
    const k = new Keyboard();
    k.enabled = true;
    const phrases: string[] = [];
    k.onCheatPhrase = (p) => phrases.push(p);
    shift1(k);
    typeWord(k, 'xyzzyspoo');
    shift1(k);
    expect(phrases).toEqual([]);
    typeWord(k, 'xyzzyspoon');
    shift1(k);
    expect(phrases).toEqual([BOOST_CHEAT.sequence]);
    // The phrase must be retyped after a use, and plain "1" (no Shift) never triggers.
    shift1(k);
    typeWord(k, 'xyzzyspoon');
    k.feed('Digit1', '1');
    shift1(k);
    expect(phrases).toHaveLength(1);
    k.dispose();
  });

  it('a non-letter key breaks the sequence; Shift itself does not', () => {
    const k = new Keyboard();
    k.enabled = true;
    const phrases: string[] = [];
    k.onCheatPhrase = (p) => phrases.push(p);
    typeWord(k, 'xyzzy');
    k.feed('Digit2', '2');
    typeWord(k, 'spoon');
    shift1(k);
    expect(phrases).toEqual([]);
    typeWord(k, 'xyzzyspoon');
    k.feed('ShiftLeft', 'Shift', true);
    shift1(k);
    expect(phrases).toEqual(['xyzzyspoon']);
    k.dispose();
  });

  it('after server activation each N press is exactly one boost request (Shift+1 no longer boosts)', () => {
    const k = new Keyboard();
    k.enabled = true;
    k.cheatActive = true;
    const n = (repeat = false) => k.feed('KeyN', 'n', false, true, repeat);
    shift1(k);
    expect(k.takeEdges().boost).toBe(false);
    n();
    expect(k.takeEdges().boost).toBe(true);
    expect(k.takeEdges().boost).toBe(false);
    k.dispose();
  });

  it('ignores auto-repeat and releases quick presses one at a time, paced to the server rate limit', () => {
    const k = new Keyboard();
    k.enabled = true;
    k.cheatActive = true;
    k.feed('KeyN', 'n');
    for (let i = 0; i < 20; i++) k.feed('KeyN', 'n', false, true, true); // held key: repeats ignored
    k.feed('KeyN', 'n', false, false);
    k.feed('KeyN', 'n'); // a second, quick physical press
    const ticks: number[] = [];
    for (let t = 0; t < 120; t++) if (k.takeEdges().boost) ticks.push(t);
    expect(ticks).toHaveLength(2);
    expect((ticks[1]! - ticks[0]!) * SIM_DT).toBeGreaterThanOrEqual(BOOST_CHEAT.minInterval);
    k.dispose();
  });

  it('all 10 charges can be spent one press at a time', () => {
    const k = new Keyboard();
    k.enabled = true;
    k.cheatActive = true;
    let sent = 0;
    for (let press = 0; press < BOOST_CHEAT.charges; press++) {
      k.feed('KeyN', 'n');
      k.feed('KeyN', 'n', false, false);
      for (let t = 0; t < 30; t++) if (k.takeEdges().boost) sent++;
    }
    expect(sent).toBe(BOOST_CHEAT.charges);
    k.clearBoostQueue();
    k.dispose();
  });

  it('before activation N is just a letter of the phrase (never a boost)', () => {
    const k = new Keyboard();
    k.enabled = true;
    const phrases: string[] = [];
    k.onCheatPhrase = (p) => phrases.push(p);
    typeWord(k, 'xyzzyspoon');
    expect(k.takeEdges().boost).toBe(false);
    shift1(k);
    expect(phrases).toEqual([BOOST_CHEAT.sequence]);
    k.dispose();
  });

  it('ignores keys while disabled (menus, lobby)', () => {
    const k = new Keyboard();
    const phrases: string[] = [];
    k.onCheatPhrase = (p) => phrases.push(p);
    typeWord(k, 'xyzzyspoon');
    shift1(k);
    k.feed('ArrowUp', 'ArrowUp');
    expect(phrases).toEqual([]);
    expect(k.up).toBe(false);
    k.dispose();
  });

  it('maps the locked desktop controls', () => {
    const k = new Keyboard();
    k.enabled = true;
    k.feed('ArrowUp', 'ArrowUp');
    k.feed('ArrowLeft', 'ArrowLeft');
    k.feed('Space', ' ');
    k.feed('Enter', 'Enter');
    expect(k.up && k.left && !k.right && !k.down).toBe(true);
    const e = k.takeEdges();
    expect(e.kick && e.attack && !e.boost).toBe(true);
    k.feed('ArrowUp', 'ArrowUp', false, false);
    expect(k.up).toBe(false);
    k.dispose();
  });
});

/** DeviceOrientation beta/gamma for a phone held upright in landscape, rolled clockwise by theta. */
function landscapeTilt(thetaDeg: number): { beta: number; gamma: number } {
  // Derived from gravity (-cos t, -sin t, 0) in device axes with the ZXY Euler convention.
  return { beta: thetaDeg, gamma: -90 };
}

describe('gyro steering mapping', () => {
  it('upright portrait is neutral; landscape compensation uses screen.orientation.angle', () => {
    expect(screenRollFromOrientation(90, 0, 0)).toBeCloseTo(0, 6);
    const lt = landscapeTilt(0);
    expect(screenRollFromOrientation(lt.beta, lt.gamma, 90)).toBeCloseTo(0, 6);
  });

  it('clockwise wheel tilt steers right (positive), anticlockwise steers left', () => {
    const cw = landscapeTilt(20), ccw = landscapeTilt(-20);
    const rCw = screenRollFromOrientation(cw.beta, cw.gamma, 90);
    const rCcw = screenRollFromOrientation(ccw.beta, ccw.gamma, 90);
    expect(rCw / DEG).toBeCloseTo(20, 4);
    expect(rCcw / DEG).toBeCloseTo(-20, 4);
    expect(steerFromRoll(rCw, 1)).toBeGreaterThan(0);
    expect(steerFromRoll(rCcw, 1)).toBeLessThan(0);
  });

  it('applies deadzone, full-scale angle, sensitivity and invert', () => {
    const dz = STEERING.gyroDeadzoneDeg, full = STEERING.gyroFullSteerDeg;
    expect(steerFromRoll((dz - 0.5) * DEG, 1)).toBe(0);
    expect(steerFromRoll(full * DEG, 1)).toBeCloseTo(1, 6);
    expect(steerFromRoll(80 * DEG, 1)).toBe(1);
    expect(steerFromRoll(((dz + full) / 2) * DEG, 1)).toBeCloseTo(0.5, 2);
    expect(steerFromRoll((full / 2) * DEG, 2)).toBeCloseTo(1, 6);
    expect(steerFromRoll(10 * DEG, 1, true)).toBeCloseTo(-steerFromRoll(10 * DEG, 1), 9);
  });
});
