// Cyborg Oni race starter (spec "Race intro"): flies in with her existing clip (dead time trimmed),
// lands ahead of the front row facing the grid, rises, holds the countdown gesture, drops it on
// the authoritative GO, then lifts off clear of the racing line. Driven only by the synced intro
// clock so every client shows the same moment.
import * as THREE from 'three';
import { clone as cloneSkinned } from 'three/examples/jsm/utils/SkeletonUtils.js';
import type { GLTF } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { INTRO, RACE } from '../../config/gameplay.js';
import type { StarterRuntimeInfo } from '../../shared/manifest.js';
import { clamp, smoothstep } from '../../shared/math.js';
import { rotateWorld } from '../anim/IK.js';
import { applyVariant } from '../materials/Variants.js';

export class OniIntro {
  readonly root = new THREE.Group();
  private model: THREE.Object3D;
  private mixer: THREE.AnimationMixer;
  private action: THREE.AnimationAction | null;
  private info: StarterRuntimeInfo;
  private upperArm: THREE.Object3D | null;
  private clipEnd: number;
  readonly landing: THREE.Vector3;

  constructor(gltf: GLTF, info: StarterRuntimeInfo, landing: THREE.Vector3, facingYaw: number) {
    this.info = info;
    this.model = cloneSkinned(gltf.scene);
    applyVariant(this.model, { emissiveIntensity: 3 });
    this.model.traverse((o) => {
      const m = o as THREE.Mesh;
      if (m.isMesh) {
        m.castShadow = true;
        m.frustumCulled = false;
      }
    });
    this.root.add(this.model);
    this.mixer = new THREE.AnimationMixer(this.model);
    const clip = gltf.animations.find((c) => c.name === info.clip) ?? gltf.animations[0] ?? null;
    this.action = clip ? this.mixer.clipAction(clip) : null;
    this.clipEnd = clip ? clip.duration : info.trimStart;
    if (this.action) {
      this.action.setLoop(THREE.LoopOnce, 1);
      this.action.clampWhenFinished = true;
      this.action.play();
    }
    const hand = this.model.getObjectByName(info.handBone);
    this.upperArm = hand?.parent?.parent ?? null;
    // Place root motion so the landed pose stands exactly at the landing point.
    this.root.rotation.y = facingYaw;
    this.root.position.copy(landing);
    this.root.updateMatrixWorld(true);
    let landedOffset = new THREE.Vector3();
    if (this.action) {
      this.action.time = this.clipEnd - 1e-3;
      this.mixer.update(0);
      this.model.updateMatrixWorld(true);
      const box = new THREE.Box3().setFromObject(this.model, true);
      const c = box.getCenter(new THREE.Vector3());
      landedOffset = this.root.worldToLocal(c.clone());
      landedOffset.y = 0;
    }
    this.model.position.sub(landedOffset);
    this.landing = landing.clone();
    this.root.visible = false;
  }

  /** τ = seconds since the synchronized intro start. */
  update(tau: number): void {
    const goT = INTRO.countdownStart + RACE.countdownSeconds;
    const start = INTRO.oniClipStart;
    this.root.visible = tau >= start - 0.05 && tau < goT + 4;
    if (!this.root.visible || !this.action) return;
    const clipTime = clamp(this.info.trimStart + (tau - start), this.info.trimStart, this.clipEnd - 1e-3);
    this.action.time = clipTime;
    this.mixer.update(0);
    this.model.updateMatrixWorld(true);
    // Countdown gesture: pulse the raised arm on each count, sweep it down at GO.
    if (this.upperArm && tau >= INTRO.countdownStart - 0.3) {
      const right = new THREE.Vector3(1, 0, 0).applyQuaternion(this.root.quaternion);
      const beat = tau - INTRO.countdownStart;
      let ang = 0;
      if (beat < RACE.countdownSeconds) ang = -0.18 * Math.exp(-((beat % 1) * 7)) * (beat >= 0 ? 1 : 0);
      else ang = 1.25 * smoothstep(0, 0.22, beat - RACE.countdownSeconds);
      if (ang !== 0) rotateWorld(this.upperArm, new THREE.Quaternion().setFromAxisAngle(right, ang));
    }
    // Lift off after GO so the racing line is clear.
    const after = tau - goT;
    if (after > 0.9) {
      const k = after - 0.9;
      this.root.position.set(this.landing.x, this.landing.y + 3 * k * k + 2 * k, this.landing.z);
      this.root.position.addScaledVector(new THREE.Vector3(0, 0, -1).applyQuaternion(this.root.quaternion), 6 * k * k);
    } else this.root.position.copy(this.landing);
  }

  dispose(): void {
    this.mixer.stopAllAction();
    this.root.removeFromParent();
  }
}
