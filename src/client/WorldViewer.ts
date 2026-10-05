// Attract-mode flythrough of the generated city behind the menu/lobby screens. In development it
// also serves visual QA (?view=world): window.__dev.shot(s, name) posts a capture to the host.
import * as THREE from 'three';
import { getTrack } from '../game/track/Track.js';
import type { App, View } from './App.js';

export class WorldViewer implements View {
  private app: App;
  private camera: THREE.PerspectiveCamera;
  private s: number;
  private speed: number;
  private lateral: number;
  private height: number;
  private paused: boolean;
  private prev = new THREE.Vector3();
  private vel = new THREE.Vector3();

  constructor(app: App, opts: { s?: number; speed?: number; lateral?: number; height?: number; paused?: boolean; dev?: boolean } = {}) {
    this.app = app;
    this.camera = new THREE.PerspectiveCamera(66, 1, 0.1, app.core.cfg.drawDistance);
    this.s = opts.s ?? 60;
    this.speed = opts.speed ?? 22;
    this.lateral = opts.lateral ?? -2;
    this.height = opts.height ?? 3.4;
    this.paused = !!opts.paused;
    if (opts.dev) {
      (window as unknown as { __dev: unknown }).__dev = {
        world: app.world,
        core: app.core,
        cam: this.camera,
        track: getTrack(),
        setS: (v: number) => (this.s = v),
        shot: async (at: number, name: string, lat = this.lateral, h = this.height) => {
          this.s = at;
          this.place(lat, h);
          for (let i = 0; i < 3; i++) app.world!.update(0.016, i * 0.016, this.camera, this.camera.position, this.vel);
          await snapshot(app.core.renderer.domElement, () => app.core.render(app.world!.scene, this.camera, 0.016, 1), name);
        },
      };
    }
  }

  private place(lat: number, h: number): void {
    const t = getTrack();
    const p = t.pointAt(this.s, lat, h);
    const a = t.pointAt(this.s + 26, lat * 0.5, h * 0.45);
    this.camera.position.set(p.x, p.y, p.z);
    this.camera.lookAt(a.x, a.y, a.z);
    this.camera.aspect = this.app.core.width / this.app.core.height;
    this.camera.updateProjectionMatrix();
  }

  update(dt: number, time: number): void {
    if (!this.app.world) return;
    if (!this.paused) this.s = getTrack().wrapS(this.s + this.speed * dt);
    this.place(this.lateral, this.height);
    this.vel.copy(this.camera.position).sub(this.prev).divideScalar(Math.max(dt, 1e-3));
    this.prev.copy(this.camera.position);
    this.app.world.update(dt, time, this.camera, this.camera.position, this.vel);
    this.app.core.water.setRain(0.2, 0.2, this.app.world.weather.rainFactor < 0.3);
  }

  render(dt: number, time: number): void {
    if (this.app.world) this.app.core.render(this.app.world.scene, this.camera, dt, time);
  }

  dispose(): void {
    this.app.core.water.clear();
  }
}

/** Dev helper: render one frame and post a downscaled JPEG to the host (/__dev/snapshot). */
export async function snapshot(canvas: HTMLCanvasElement, render: () => void, name: string, width = 960): Promise<void> {
  render();
  const c = document.createElement('canvas');
  c.width = width;
  c.height = Math.round((width * canvas.height) / canvas.width);
  c.getContext('2d')!.drawImage(canvas, 0, 0, c.width, c.height);
  const blob = await new Promise<Blob | null>((r) => c.toBlob(r, 'image/jpeg', 0.82));
  if (blob) await fetch(`/__dev/snapshot?name=${encodeURIComponent(name)}`, { method: 'POST', headers: { 'Content-Type': 'image/jpeg' }, body: blob });
}
