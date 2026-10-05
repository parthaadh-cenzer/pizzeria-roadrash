import { describe, expect, it } from 'vitest';
import * as THREE from 'three';
import { buildRig, resetToRest, retargetClip } from '../src/render/anim/Retarget.js';
import { twoBoneIK, worldPos } from '../src/render/anim/IK.js';
import { CLIP_IDS } from '../src/config/assets.js';
import type { CanonicalClip } from '../src/config/skeleton.js';
import { loadClip, loadRuntimeModel, samplePose } from './helpers/loadRuntime.js';

const RIDERS = ['rider.blackguard', 'rider.scarlet', 'rider.mohawk', 'rider.enforcer'];

function tposeClip(src: CanonicalClip): CanonicalClip {
  // Source rest pose as a clip: every rig must adopt the canonical T-pose.
  return { ...src, frames: [src.restRot, src.restRot], hips: [src.restPos.hips!, src.restPos.hips!], duration: 1 / src.fps };
}

describe('semantic retargeting onto the four riders', () => {
  for (const id of RIDERS) {
    it(`${id}: T-pose, run and cheer/clap retarget sanely`, async () => {
      const gltf = await loadRuntimeModel(id);
      const root = gltf.scene;
      const rig = buildRig(root);
      for (const b of ['hips', 'spine', 'head', 'leftUpperArm', 'rightLowerArm', 'leftHand', 'rightFoot']) expect(rig.bones.has(b), b).toBe(true);
      const run = loadClip(CLIP_IDS.run);

      // 1. Canonical T-pose: arms horizontal (hands at shoulder height, far apart).
      samplePose(root, retargetClip(tposeClip(run), rig), 0);
      const ls = worldPos(rig.bones.get('leftUpperArm')!), lh = worldPos(rig.bones.get('leftHand')!), rh = worldPos(rig.bones.get('rightHand')!);
      expect(Math.abs(lh.y - ls.y)).toBeLessThan(0.12);
      expect(lh.x).toBeGreaterThan(0.45); // character left is +X when facing +Z
      expect(rh.x).toBeLessThan(-0.45);

      // 2. Run: feet near the ground, head above hips, character stays upright.
      resetToRest(rig);
      const runClip = retargetClip(run, rig, { rootMotion: false });
      samplePose(root, runClip, 0.2);
      const head = worldPos(rig.bones.get('head')!), hips = worldPos(rig.bones.get('hips')!);
      const lf = worldPos(rig.bones.get('leftFoot')!), rf = worldPos(rig.bones.get('rightFoot')!);
      expect(head.y).toBeGreaterThan(hips.y + 0.4);
      expect(Math.min(lf.y, rf.y)).toBeLessThan(0.35);
      expect(head.y).toBeLessThan(2.1);

      // 3. Cheer/clap: hands come together in front of the chest at some point in the loop.
      resetToRest(rig);
      const clap = retargetClip(loadClip(CLIP_IDS.cheerClap), rig, { rootMotion: false });
      let best = Infinity;
      let front = -Infinity;
      for (let t = 0; t < 1.6; t += 0.05) {
        samplePose(root, clap, t);
        const a = worldPos(rig.bones.get('leftHand')!), b = worldPos(rig.bones.get('rightHand')!);
        const chest = worldPos(rig.bones.get('chest')!);
        best = Math.min(best, a.distanceTo(b));
        front = Math.max(front, (a.z + b.z) / 2 - chest.z);
      }
      expect(best).toBeLessThan(0.28);
      expect(front).toBeGreaterThan(0.1);
    });
  }

  it('getup_back starts lying down and ends standing', async () => {
    const gltf = await loadRuntimeModel('rider.scarlet');
    const rig = buildRig(gltf.scene);
    const c = retargetClip(loadClip(CLIP_IDS.getupBack), rig);
    samplePose(gltf.scene, c, 0);
    const h0 = worldPos(rig.bones.get('head')!).y;
    samplePose(gltf.scene, c, c.duration - 0.02);
    const h1 = worldPos(rig.bones.get('head')!).y;
    expect(h0).toBeLessThan(0.7);
    expect(h1).toBeGreaterThan(1.3);
    const prone = retargetClip(loadClip(CLIP_IDS.getupProne), rig);
    samplePose(gltf.scene, prone, 0);
    expect(worldPos(rig.bones.get('head')!).y).toBeLessThan(0.8);
    samplePose(gltf.scene, prone, prone.duration - 0.02);
    expect(worldPos(rig.bones.get('head')!).y).toBeGreaterThan(1.3);
  });

  it('two-bone IK places hands on arbitrary grip targets', async () => {
    const gltf = await loadRuntimeModel('rider.enforcer');
    const rig = buildRig(gltf.scene);
    const s = rig.bones.get('rightUpperArm')!, e = rig.bones.get('rightLowerArm')!, h = rig.bones.get('rightHand')!;
    const shoulder = worldPos(s);
    const target = shoulder.clone().add(new THREE.Vector3(-0.12, -0.25, 0.32));
    twoBoneIK(s, e, h, target, shoulder.clone().add(new THREE.Vector3(-0.5, -0.3, -0.4)));
    expect(worldPos(h).distanceTo(target)).toBeLessThan(0.02);
    // Elbow bends toward the pole side (outward/back), not through the body.
    expect(worldPos(e).x).toBeLessThan(target.x + 0.05);
  });
});
