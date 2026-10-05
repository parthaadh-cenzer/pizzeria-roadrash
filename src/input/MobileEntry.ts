// Mobile ENTER RACE flow (spec "Enter Race mobile flow"): one explicit gesture attempts, in order,
// motion permission, fullscreen, landscape lock and gyro neutral calibration, then continues.
// Unsupported fullscreen/orientation lock never blocks play; portrait shows a rotate gate.
import type { DeviceInfo } from '../client/device.js';
import { h } from '../ui/dom.js';
import { Gyro } from './Gyro.js';

export type StepResult = 'ok' | 'no' | 'na';

export interface EntryReport {
  motion: StepResult;
  fullscreen: StepResult;
  landscape: StepResult;
  calibrated: StepResult;
  steering: 'tilt' | 'touch';
}

export function isPortrait(): boolean {
  return window.innerHeight > window.innerWidth * 1.05;
}

export class MobileEntry {
  readonly gyro = new Gyro();
  private device: DeviceInfo;
  last: EntryReport | null = null;

  constructor(device: DeviceInfo) {
    this.device = device;
  }

  /**
   * Must be called synchronously from the ENTER RACE tap: the permission and fullscreen requests
   * are started before the first await so browsers treat them as user-initiated.
   */
  async enterRace(ui: HTMLElement): Promise<boolean> {
    const permissionP = this.device.secure ? this.gyro.requestPermission() : Promise.resolve(false);
    const el = document.documentElement as HTMLElement & { webkitRequestFullscreen?: () => Promise<void> };
    let fullscreenP: Promise<boolean>;
    try {
      const req = el.requestFullscreen ? el.requestFullscreen({ navigationUI: 'hide' }) : el.webkitRequestFullscreen?.();
      fullscreenP = Promise.resolve(req).then(() => !!(document.fullscreenElement || (document as unknown as { webkitFullscreenElement?: Element }).webkitFullscreenElement)).catch(() => false);
    } catch {
      fullscreenP = Promise.resolve(false);
    }
    const panel = h('div', { class: 'gate' });
    ui.appendChild(panel);
    const render = (r: Partial<EntryReport>, done: boolean, notes: string[]) => {
      const children: (Node | null)[] = [
        h('h2', {}, 'Enter race'),
        h(
          'div',
          { class: 'checklist' },
          h('div', { class: r.motion ?? 'na' }, 'Motion sensors'),
          h('div', { class: r.fullscreen ?? 'na' }, 'Fullscreen'),
          h('div', { class: r.landscape ?? 'na' }, 'Landscape'),
          h('div', { class: r.calibrated ?? 'na' }, 'Straight-ahead calibrated'),
        ),
        ...notes.map((n) => h('div', { class: 'notice small', style: 'max-width:420px' }, n)),
        done ? h('button', { class: 'btn primary big', onclick: () => finish(true) }, 'Ready') : h('div', { class: 'small muted' }, 'Setting up…'),
        done ? h('button', { class: 'btn ghost small', onclick: () => finish(false) }, 'Cancel') : null,
      ];
      panel.replaceChildren(...children.filter((c): c is Node => c !== null));
    };
    let finish: (ok: boolean) => void = () => undefined;
    const result = new Promise<boolean>((res) => (finish = (ok) => {
      panel.remove();
      res(ok);
    }));
    render({}, false, []);

    const [motionOk, fsOk] = await Promise.all([permissionP, fullscreenP]);
    let landscape: StepResult = 'na';
    try {
      const so = screen.orientation as ScreenOrientation & { lock?: (o: string) => Promise<void> };
      if (so && typeof so.lock === 'function') {
        await so.lock('landscape');
        landscape = 'ok';
      }
    } catch {
      landscape = 'no';
    }
    if (landscape !== 'ok') landscape = isPortrait() ? 'no' : 'ok';
    const hasData = motionOk ? await this.gyro.waitForData(1200) : false;
    if (hasData) this.gyro.calibrate();
    const report: EntryReport = {
      motion: hasData ? 'ok' : 'no',
      fullscreen: fsOk ? 'ok' : this.device.fullscreenApi ? 'no' : 'na',
      landscape,
      calibrated: hasData ? 'ok' : 'na',
      steering: hasData ? 'tilt' : 'touch',
    };
    this.last = report;
    const notes: string[] = [];
    if (!this.device.secure) notes.push('Not a secure (https) connection: tilt steering is unavailable here, so LEFT/RIGHT touch zones are used. Ask the host for secure mode (npm run dev:secure).');
    else if (!hasData) notes.push('Motion access was denied or no tilt data is available. LEFT/RIGHT touch zones will steer; KICK and HIT still work.');
    if (report.fullscreen !== 'ok') notes.push('Fullscreen was not available; the race still works.');
    if (isPortrait()) notes.push('Rotate your phone to landscape.');
    if (hasData) notes.push('Hold the phone the way you want to ride: that angle is now straight ahead. Tilt like a steering wheel.');
    render(report, true, notes);
    // Auto-continue when everything worked.
    if (hasData && !isPortrait()) setTimeout(() => finish(true), 1400);
    return result;
  }

  calibrate(): void {
    if (this.gyro.available) this.gyro.calibrate();
  }

  /** Rotate-to-landscape gate while racing on a phone. Returns a disposer. */
  watchOrientation(ui: HTMLElement): () => void {
    let gate: HTMLElement | null = null;
    const check = () => {
      if (isPortrait()) {
        if (!gate) {
          gate = h('div', { class: 'gate' }, h('div', { class: 'rotate-icon' }), h('h2', {}, 'Rotate to landscape'), h('div', { class: 'small muted' }, 'Pizzeria Roadrash is played sideways.'));
          ui.appendChild(gate);
        }
      } else if (gate) {
        gate.remove();
        gate = null;
      }
    };
    window.addEventListener('resize', check);
    window.addEventListener('orientationchange', check);
    check();
    return () => {
      window.removeEventListener('resize', check);
      window.removeEventListener('orientationchange', check);
      gate?.remove();
    };
  }
}
