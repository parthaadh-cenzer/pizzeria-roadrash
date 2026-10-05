// Results (spec "Results"): actual participating avatars in their colours. #1 victory dance with
// their bike parked behind in hero position; #2-#3 Cheer/Clap; #4+ Disappointed; DNF stays DNF.
// Camera: full lineup -> winner push-in -> name + 1ST PLACE -> result board.
import * as THREE from 'three';
import type { ResultsMsg } from '../shared/protocol.js';
import { getTrack } from '../game/track/Track.js';
import type { BikeActor } from '../render/actors/BikeActor.js';
import type { RiderActor } from '../render/actors/RiderActor.js';
import { clamp, smoothstep } from '../shared/math.js';
import { h } from '../ui/dom.js';
import { ordinal } from './RaceClient.js';
import type { App, View } from './App.js';

function fmt(t: number | null): string {
  if (t === null) return 'DNF';
  const m = Math.floor(t / 60), s = t - m * 60;
  return `${m}:${s.toFixed(2).padStart(5, '0')}`;
}

export class ResultsView implements View {
  private app: App;
  private riders: RiderActor[] = [];
  private winnerBike: BikeActor | null = null;
  private camera = new THREE.PerspectiveCamera(50, 1, 0.1, 1500);
  private t = 0;
  private lineup: THREE.Vector3[] = [];
  private winner: THREE.Vector3 = new THREE.Vector3();
  private forward = new THREE.Vector3();
  private card: HTMLElement;
  private board: HTMLElement;

  constructor(app: App, m: ResultsMsg) {
    this.app = app;
    app.phase = 'RESULTS';
    const track = getTrack();
    const world = app.world!;
    const lib = app.library!;
    const s = 22;
    const f = track.frameAt(s);
    const yaw = Math.atan2(f.tx, f.tz) + Math.PI; // face back toward the finish gantry (and camera)
    this.forward.set(f.tx, 0, f.tz).normalize();
    const n = m.entries.length;
    m.entries.forEach((e, i) => {
      // Winner centre-front; the rest fan out behind in finishing order.
      const lat = i === 0 ? 0 : ((i % 2 === 1 ? 1 : -1) * Math.ceil(i / 2) * 1.7);
      const back = i === 0 ? 0 : 1.6 + Math.floor((i - 1) / 4) * 1.2;
      const p = track.pointAt(s + back, lat, 0);
      const pos = new THREE.Vector3(p.x, p.y, p.z);
      this.lineup.push(pos);
      const rider = lib.createRider(e.loadout.riderId, e.loadout.riderColor, e.loadout.weaponId);
      if (!rider) return;
      const pose = e.dnf ? 'disappointed' : i === 0 ? 'victory' : i <= 2 ? 'cheer' : 'disappointed';
      rider.setResultPose(pose, world.scene, pos, yaw);
      this.riders.push(rider);
      if (i === 0) {
        this.winner.copy(pos);
        const bike = lib.createBike(e.loadout.bikeId, e.loadout.bikeColor);
        if (bike) {
          const bp = track.pointAt(s + 3.2, 0, 0);
          bike.setRiding(new THREE.Vector3(bp.x, bp.y, bp.z), yaw + 0.9, 0, 0);
          world.scene.add(bike.root);
          this.winnerBike = bike;
        }
      }
    });
    void n;
    const winner = m.entries[0];
    const meId = app.net.playerId;
    this.card = h('div', { class: 'winner-card', style: 'opacity:0' }, h('div', { class: 'n' }, winner?.dnf ? 'NO FINISHERS' : winner?.name ?? ''), h('div', { class: 'p' }, winner?.dnf ? '' : '1ST PLACE'));
    const rows = m.entries.map((e) =>
      h('tr', { class: e.id === meId ? 'me' : '' }, h('td', { class: 'p' }, e.dnf ? '—' : ordinal(e.position)), h('td', {}, e.name), h('td', {}, fmt(e.dnf ? null : e.finishTime)), h('td', { class: 'muted' }, e.dnf ? 'DNF' : e.gap === null || e.gap === 0 ? '' : `+${e.gap.toFixed(2)}`)),
    );
    this.board = h(
      'div',
      { class: 'results panel', style: 'opacity:0' },
      h('h2', {}, 'Results'),
      h('table', {}, h('tr', { class: 'muted small' }, h('td', {}, 'Pos'), h('td', {}, 'Rider'), h('td', {}, 'Time'), h('td', {}, 'Gap')), ...rows),
      app.net.isHost ? h('div', { class: 'row', style: 'margin-top:12px' }, h('button', { class: 'btn primary', onclick: () => app.net.socket.emit('toLobby') }, 'Back to lobby')) : h('div', { class: 'small muted', style: 'margin-top:10px' }, 'Waiting for the host to return to the lobby…'),
    );
    app.show(null);
    app.ui.append(this.card, this.board);
    app.audio.play('crowd', 1);
  }

  update(dt: number, time: number): void {
    this.t += dt;
    for (const r of this.riders) r.updateResult(dt, this.t);
    this.winnerBike?.update(dt, { speed: 0, steer: 0.4, lean: 0, boosting: false, airborne: false, compression: 0, crashed: false });
    const world = this.app.world!;
    const centre = this.lineup.reduce((a, p) => a.add(p), new THREE.Vector3()).divideScalar(Math.max(1, this.lineup.length));
    const side = new THREE.Vector3(-this.forward.z, 0, this.forward.x);
    // 0-3 s lineup, 3-6 s push in to the winner, then hold for the card and the board.
    const wide = centre.clone().addScaledVector(this.forward, -9).addScaledVector(side, 2).add(new THREE.Vector3(0, 3.2, 0));
    const close = this.winner.clone().addScaledVector(this.forward, -3.2).addScaledVector(side, 0.8).add(new THREE.Vector3(0, 1.6, 0));
    const k = smoothstep(3, 6, this.t);
    this.camera.position.lerpVectors(wide, close, k);
    this.camera.lookAt(new THREE.Vector3().lerpVectors(centre.clone().add(new THREE.Vector3(0, 1.1, 0)), this.winner.clone().add(new THREE.Vector3(0, 1.2, 0)), k));
    this.camera.aspect = this.app.core.width / this.app.core.height;
    this.camera.updateProjectionMatrix();
    this.card.style.opacity = String(clamp((this.t - 6) / 0.5, 0, 1) * (1 - clamp((this.t - 10) / 0.6, 0, 1)));
    this.board.style.opacity = String(clamp((this.t - 9.5) / 0.6, 0, 1));
    world.update(dt, time, this.camera, this.winner, new THREE.Vector3());
  }

  render(dt: number, time: number): void {
    this.app.core.render(this.app.world!.scene, this.camera, dt, time);
  }

  dispose(): void {
    for (const r of this.riders) r.dispose();
    this.winnerBike?.dispose();
    this.card.remove();
    this.board.remove();
  }
}
