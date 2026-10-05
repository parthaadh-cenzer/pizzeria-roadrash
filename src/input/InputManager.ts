// Combines desktop keyboard, mobile gyro/touch into one ControlInput per 60 Hz simulation tick.
// Mobile: auto acceleration always on; steering from tilt, or touch zones when tilt is unusable.
import type { ControlInput } from '../game/sim/types.js';
import { settings } from '../client/settings.js';
import type { Gyro } from './Gyro.js';
import { Keyboard } from './Keyboard.js';
import type { TouchControls } from './TouchControls.js';

export class InputManager {
  readonly keyboard = new Keyboard();
  private seq = 0;
  mobile: boolean;
  gyro: Gyro | null;
  touch: TouchControls | null = null;

  constructor(mobile: boolean, gyro: Gyro | null) {
    this.mobile = mobile;
    this.gyro = gyro;
    this.keyboard.enabled = true;
  }

  /** True when tilt steering is live (permission granted and samples arriving). */
  get tiltActive(): boolean {
    return !!this.gyro && this.gyro.fresh && !settings().touchSteering;
  }

  sample(dt: number): ControlInput {
    const k = this.keyboard;
    const ke = k.takeEdges();
    const te = this.touch?.takeEdges() ?? { kick: false, attack: false };
    let steer = (k.right ? 1 : 0) - (k.left ? 1 : 0);
    let analog = false;
    let autoAccel = false;
    if (this.mobile) {
      autoAccel = true;
      if (this.tiltActive) {
        this.gyro!.sensitivity = settings().gyroSensitivity;
        this.gyro!.invert = settings().invertGyro;
        steer = this.gyro!.steer(dt);
        analog = true;
      } else if (this.touch) steer = this.touch.steer();
      this.touch?.setSteeringZones(!this.tiltActive);
    }
    this.seq++;
    return {
      seq: this.seq,
      throttle: k.up ? 1 : 0,
      brake: k.down ? 1 : 0,
      steer,
      analog,
      autoAccel,
      kick: ke.kick || te.kick,
      attack: ke.attack || te.attack,
      boost: ke.boost,
    };
  }

  dispose(): void {
    this.keyboard.dispose();
    this.touch?.dispose();
  }
}
