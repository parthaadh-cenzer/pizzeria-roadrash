// Gyro/tilt steering for landscape phones (spec "Gyro steering"). The steering angle is the phone's
// roll about the screen normal, derived from the gravity direction in device space, so it works
// however far back the screen is tilted. Neutral is calibrated at ENTER RACE.
import { STEERING } from '../config/gameplay.js';
import { clamp } from '../shared/math.js';

const DEG = Math.PI / 180;

/** Roll (rad) of the device about its screen normal from DeviceOrientation beta/gamma (degrees). */
export function screenRollFromOrientation(betaDeg: number, gammaDeg: number, screenAngleDeg: number): number {
  const b = betaDeg * DEG, g = gammaDeg * DEG;
  // Gravity in device coordinates (x right, y up the screen, z out of the screen).
  const gx = Math.cos(b) * Math.sin(g);
  const gy = -Math.sin(b);
  // Clockwise device rotation (as seen by the user) gives a positive roll in portrait.
  let roll = Math.atan2(gx, -gy);
  // screen.orientation.angle 90 = device turned counter-clockwise (roll -90deg): add it back.
  roll += screenAngleDeg * DEG;
  while (roll > Math.PI) roll -= 2 * Math.PI;
  while (roll < -Math.PI) roll += 2 * Math.PI;
  return roll;
}

/** Maps a calibrated roll (rad) to steering -1..1 with deadzone, full-scale angle and sensitivity. */
export function steerFromRoll(rollRad: number, sensitivity: number, invert = false): number {
  const deg = rollRad / DEG;
  const dz = STEERING.gyroDeadzoneDeg;
  const full = STEERING.gyroFullSteerDeg / Math.max(0.1, sensitivity);
  const mag = Math.max(0, Math.abs(deg) - dz) / Math.max(1, full - dz);
  const s = clamp(mag, 0, 1) * Math.sign(deg);
  return invert ? -s : s;
}

export class Gyro {
  available = false;
  permission: 'unknown' | 'granted' | 'denied' | 'not-required' = 'unknown';
  private rawRoll = 0;
  private neutral = 0;
  private smoothed = 0;
  private lastSample = 0;
  sensitivity: number = STEERING.gyroSensitivityDefault;
  invert = false;
  private listener = (e: DeviceOrientationEvent) => {
    if (e.beta === null || e.gamma === null) return;
    this.available = true;
    this.lastSample = performance.now();
    this.rawRoll = screenRollFromOrientation(e.beta, e.gamma, screenAngle());
  };

  start(): void {
    window.addEventListener('deviceorientation', this.listener);
  }

  stop(): void {
    window.removeEventListener('deviceorientation', this.listener);
  }

  /** iOS 13+ requires an explicit permission request from a user gesture. */
  async requestPermission(): Promise<boolean> {
    const DOE = (window as unknown as { DeviceOrientationEvent?: { requestPermission?: () => Promise<string> } }).DeviceOrientationEvent;
    const DME = (window as unknown as { DeviceMotionEvent?: { requestPermission?: () => Promise<string> } }).DeviceMotionEvent;
    if (!DOE) {
      this.permission = 'denied';
      return false;
    }
    if (typeof DOE.requestPermission === 'function') {
      try {
        const r = await DOE.requestPermission();
        if (DME && typeof DME.requestPermission === 'function') await DME.requestPermission().catch(() => 'denied');
        this.permission = r === 'granted' ? 'granted' : 'denied';
      } catch {
        this.permission = 'denied';
      }
    } else this.permission = 'not-required';
    if (this.permission !== 'denied') this.start();
    return this.permission !== 'denied';
  }

  /** Waits briefly for a usable sample (some browsers expose the API but never fire it). */
  async waitForData(ms = 900): Promise<boolean> {
    const t0 = performance.now();
    while (performance.now() - t0 < ms) {
      if (this.available) return true;
      await new Promise((r) => setTimeout(r, 50));
    }
    return this.available;
  }

  /** Current comfortable phone angle becomes steering neutral. */
  calibrate(): void {
    this.neutral = this.rawRoll;
    this.smoothed = 0;
  }

  get fresh(): boolean {
    return this.available && performance.now() - this.lastSample < 1000;
  }

  /** Smoothed steering -1..1 (exponential smoothing to prevent sensor jitter). */
  steer(dt: number): number {
    let d = this.rawRoll - this.neutral;
    while (d > Math.PI) d -= 2 * Math.PI;
    while (d < -Math.PI) d += 2 * Math.PI;
    const target = steerFromRoll(d, this.sensitivity, this.invert);
    const k = 1 - Math.exp(-dt / STEERING.gyroSmoothing);
    this.smoothed += (target - this.smoothed) * k;
    return this.smoothed;
  }
}

export function screenAngle(): number {
  const so = screen.orientation as ScreenOrientation | undefined;
  if (so && typeof so.angle === 'number') return so.angle;
  const legacy = (window as unknown as { orientation?: number }).orientation;
  return typeof legacy === 'number' ? legacy : 0;
}
