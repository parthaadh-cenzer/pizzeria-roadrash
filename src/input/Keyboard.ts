// Desktop controls (locked): Arrow Up throttle, Arrow Down brake/reverse, Arrow Left/Right steer,
// Space kick, Enter weapon, N boost. Secret keyboard-only cheat: type "xyzzyspoon", then Shift+1
// activates (server-validated, 10 charges); after that each N press requests exactly one charge
// (auto-repeat ignored; presses are paced to the server's rate limit so none is lost).
import { BOOST_CHEAT, SIM_DT } from '../config/gameplay.js';

/** Sim ticks between released boost requests (just above the server's minimum interval). */
const BOOST_PACE_TICKS = Math.ceil(BOOST_CHEAT.minInterval / SIM_DT) + 2;

export class Keyboard {
  up = false;
  down = false;
  left = false;
  right = false;
  private kickEdge = false;
  private attackEdge = false;
  /** N presses waiting to be sent (one charge each), and the pacing countdown in sim ticks. */
  private boostQueue = 0;
  private boostCooldown = 0;
  private typed = '';
  private armed = false;
  cheatActive = false;
  enabled = false;
  onCheatPhrase: ((phrase: string) => void) | null = null;
  onPause: (() => void) | null = null;
  private down_ = (e: KeyboardEvent) => this.onKey(e, true);
  private up_ = (e: KeyboardEvent) => this.onKey(e, false);
  private blur_ = () => {
    this.up = this.down = this.left = this.right = false;
    this.boostQueue = 0;
  };

  constructor() {
    window.addEventListener('keydown', this.down_);
    window.addEventListener('keyup', this.up_);
    window.addEventListener('blur', this.blur_);
  }

  private onKey(e: KeyboardEvent, pressed: boolean): void {
    if (!this.enabled) return;
    const target = e.target as HTMLElement | null;
    if (target && (target.tagName === 'INPUT' || target.tagName === 'TEXTAREA')) return;
    switch (e.code) {
      case 'ArrowUp':
        this.up = pressed;
        e.preventDefault();
        return;
      case 'ArrowDown':
        this.down = pressed;
        e.preventDefault();
        return;
      case 'ArrowLeft':
        this.left = pressed;
        e.preventDefault();
        return;
      case 'ArrowRight':
        this.right = pressed;
        e.preventDefault();
        return;
      case 'Space':
        if (pressed && !e.repeat) this.kickEdge = true;
        e.preventDefault();
        return;
      case 'Enter':
      case 'NumpadEnter':
        if (pressed && !e.repeat) this.attackEdge = true;
        e.preventDefault();
        return;
      case 'Escape':
        if (pressed) this.onPause?.();
        return;
      case 'KeyN':
        // Once the cheat is active N is the boost key; before that it is just a letter of the phrase.
        if (this.cheatActive) {
          if (pressed && !e.repeat) this.boostQueue = Math.min(BOOST_CHEAT.charges, this.boostQueue + 1);
          e.preventDefault();
          return;
        }
        break;
      default:
        break;
    }
    if (!pressed || e.repeat) return;
    if (e.code === 'Digit1' && e.shiftKey) {
      // Shift+1 only activates the cheat (right after the phrase); boosting is on N.
      if (!this.cheatActive && this.armed) {
        this.armed = false;
        this.onCheatPhrase?.(BOOST_CHEAT.sequence);
      }
      this.typed = '';
      return;
    }
    if (e.key.length === 1 && /[a-z]/i.test(e.key)) {
      this.typed = (this.typed + e.key.toLowerCase()).slice(-BOOST_CHEAT.sequence.length);
      // Shift+1 must directly follow the phrase.
      this.armed = this.typed === BOOST_CHEAT.sequence;
    } else if (e.key !== 'Shift') {
      this.typed = '';
      this.armed = false;
    }
  }

  /** Consumes edge-triggered actions for one simulation tick. */
  takeEdges(): { kick: boolean; attack: boolean; boost: boolean } {
    this.boostCooldown = Math.max(0, this.boostCooldown - 1);
    let boost = false;
    if (this.boostQueue > 0 && this.boostCooldown === 0) {
      boost = true;
      this.boostQueue--;
      this.boostCooldown = BOOST_PACE_TICKS;
    }
    const r = { kick: this.kickEdge, attack: this.attackEdge, boost };
    this.kickEdge = this.attackEdge = false;
    return r;
  }

  /** Drops queued boost presses (no charges left). */
  clearBoostQueue(): void {
    this.boostQueue = 0;
  }

  /** Test hook: feeds a key event through the same parser. */
  feed(code: string, key: string, shift = false, pressed = true, repeat = false): void {
    this.onKey({ code, key, shiftKey: shift, repeat, target: null, preventDefault: () => undefined } as unknown as KeyboardEvent, pressed);
  }

  dispose(): void {
    window.removeEventListener('keydown', this.down_);
    window.removeEventListener('keyup', this.up_);
    window.removeEventListener('blur', this.blur_);
  }
}
