// Mobile in-race controls: large KICK and HIT buttons in thumb reach; translucent LEFT/RIGHT
// steering zones only when tilt steering is unavailable or denied. No throttle/brake/joystick/boost.
import { h } from '../ui/dom.js';

const KICK_SVG = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M9 3v7l-4 6 2 2 5-5 6 2 1-3-6-3V3z"/></svg>';
const HIT_SVG = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M14 3l7 7-9 9-4-4 3-3-4-4z"/><path d="M4 20l3-3"/></svg>';

export class TouchControls {
  readonly el: HTMLElement;
  private kickEdge = false;
  private attackEdge = false;
  private leftDown = new Set<number>();
  private rightDown = new Set<number>();
  private zones: HTMLElement[] = [];
  private kickBtn: HTMLElement;
  private hitBtn: HTMLElement;
  steeringZones = false;
  onPause: (() => void) | null = null;

  constructor() {
    const leftZone = h('div', { class: 'zone left' }, 'LEFT');
    const rightZone = h('div', { class: 'zone right' }, 'RIGHT');
    this.zones = [leftZone, rightZone];
    this.kickBtn = h('button', { class: 'act kick', 'aria-label': 'Kick', html: `${KICK_SVG}<span>KICK</span>` });
    this.hitBtn = h('button', { class: 'act hit', 'aria-label': 'Hit', html: `${HIT_SVG}<span>HIT</span>` });
    const pause = h('button', { class: 'btn small ghost pause', onclick: () => this.onPause?.() }, 'II');
    this.el = h('div', { class: 'touch' }, leftZone, rightZone, this.kickBtn, this.hitBtn, pause);
    const zone = (el: HTMLElement, set: Set<number>) => {
      el.addEventListener('pointerdown', (e) => {
        set.add(e.pointerId);
        try {
          el.setPointerCapture(e.pointerId);
        } catch {
          /* pointer already gone (very short tap): steering still works without capture */
        }
        el.classList.add('active');
        e.preventDefault();
      });
      const release = (e: PointerEvent) => {
        set.delete(e.pointerId);
        if (!set.size) el.classList.remove('active');
      };
      el.addEventListener('pointerup', release);
      el.addEventListener('pointercancel', release);
    };
    zone(leftZone, this.leftDown);
    zone(rightZone, this.rightDown);
    const button = (el: HTMLElement, fire: () => void) => {
      el.addEventListener('pointerdown', (e) => {
        fire();
        el.classList.add('down');
        navigator.vibrate?.(12);
        e.preventDefault();
        e.stopPropagation();
      });
      const up = () => el.classList.remove('down');
      el.addEventListener('pointerup', up);
      el.addEventListener('pointercancel', up);
      el.addEventListener('contextmenu', (e) => e.preventDefault());
    };
    button(this.kickBtn, () => (this.kickEdge = true));
    button(this.hitBtn, () => (this.attackEdge = true));
    this.setSteeringZones(false);
  }

  setSteeringZones(on: boolean): void {
    this.steeringZones = on;
    for (const z of this.zones) z.style.display = on ? 'flex' : 'none';
  }

  /** Digital steer from zones: -1 left, +1 right, 0 none. */
  steer(): number {
    return (this.rightDown.size ? 1 : 0) - (this.leftDown.size ? 1 : 0);
  }

  takeEdges(): { kick: boolean; attack: boolean } {
    const r = { kick: this.kickEdge, attack: this.attackEdge };
    this.kickEdge = this.attackEdge = false;
    return r;
  }

  dispose(): void {
    this.el.remove();
  }
}
