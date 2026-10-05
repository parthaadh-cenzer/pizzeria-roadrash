// Remote player snapshot interpolation (~100 ms behind the host clock) with short extrapolation.
import * as THREE from 'three';
import { NETWORK } from '../config/gameplay.js';
import type { PlayerSnap } from '../shared/snapshot.js';
import { wrapAngle } from '../shared/math.js';

interface Timed {
  t: number; // host ms
  p: PlayerSnap;
}

export interface Interpolated {
  snap: PlayerSnap;
  pos: THREE.Vector3;
  riderPos: THREE.Vector3;
  bikeQ: THREE.Quaternion;
  riderQ: THREE.Quaternion;
  yaw: number;
  riderYaw: number;
  lean: number;
  pitch: number;
  speed: number;
  steer: number;
  velocity: THREE.Vector3;
}

const q = (x: { x: number; y: number; z: number; w: number }) => new THREE.Quaternion(x.x, x.y, x.z, x.w).normalize();

export class Interpolator {
  private buf: Timed[] = [];

  push(serverTime: number, p: PlayerSnap): void {
    if (this.buf.length && serverTime <= this.buf[this.buf.length - 1]!.t) return;
    this.buf.push({ t: serverTime, p });
    if (this.buf.length > 40) this.buf.shift();
  }

  latest(): PlayerSnap | null {
    return this.buf[this.buf.length - 1]?.p ?? null;
  }

  sample(serverNow: number, delayMs: number = NETWORK.interpolationDelay * 1000): Interpolated | null {
    if (!this.buf.length) return null;
    const rt = serverNow - delayMs;
    let a = this.buf[0]!, b = this.buf[0]!;
    for (let i = 0; i < this.buf.length; i++) {
      const x = this.buf[i]!;
      if (x.t <= rt) a = x;
      if (x.t >= rt) {
        b = x;
        break;
      }
      b = x;
    }
    let k = b.t > a.t ? (rt - a.t) / (b.t - a.t) : 1;
    // Short extrapolation only when the buffer ran dry (<= 150 ms).
    if (rt > b.t) {
      const prev = this.buf[this.buf.length - 2];
      if (prev) {
        a = prev;
        k = 1 + Math.min(150, rt - b.t) / Math.max(1, b.t - prev.t);
      }
    }
    k = Math.max(0, Math.min(k, 1.6));
    const A = a.p, B = b.p;
    const lerp = (x: number, y: number) => x + (y - x) * k;
    const pos = new THREE.Vector3(lerp(A.x, B.x), lerp(A.y, B.y), lerp(A.z, B.z));
    const riderPos = new THREE.Vector3(lerp(A.rx, B.rx), lerp(A.ry, B.ry), lerp(A.rz, B.rz));
    const kk = Math.min(1, k);
    const dtS = Math.max(0.001, (b.t - a.t) / 1000);
    return {
      snap: kk >= 0.5 ? B : A,
      pos,
      riderPos,
      bikeQ: q(A.bikeQ).slerp(q(B.bikeQ), kk),
      riderQ: q(A.riderQ).slerp(q(B.riderQ), kk),
      yaw: A.yaw + wrapAngle(B.yaw - A.yaw) * k,
      riderYaw: A.riderYaw + wrapAngle(B.riderYaw - A.riderYaw) * kk,
      lean: lerp(A.lean, B.lean),
      pitch: lerp(A.pitch, B.pitch),
      speed: lerp(A.speed, B.speed),
      steer: lerp(A.steer, B.steer),
      velocity: new THREE.Vector3((B.x - A.x) / dtS, (B.y - A.y) / dtS, (B.z - A.z) / dtS),
    };
  }
}
