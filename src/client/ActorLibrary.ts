// Loads actor assets once, retargets clips per rider rig, and builds bikes/riders/weapons/Oni/crowd.
import * as THREE from 'three';
import type { GLTF } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { BIKE_ASSET, CLIP_IDS, RIDER_ASSET, WEAPON_ASSET } from '../config/assets.js';
import { BIKES } from '../config/bikes.js';
import { UPPER_BODY, type CanonicalClip } from '../config/skeleton.js';
import { BIKE_IDS, SELECTABLE_RIDER_IDS, WEAPON_IDS, type BikeId, type RiderId, type WeaponId } from '../shared/ids.js';
import type { AssetStore } from '../render/AssetStore.js';
import type { World } from '../render/world/World.js';
import { buildRig, retargetClip } from '../render/anim/Retarget.js';
import { BikeActor } from '../render/actors/BikeActor.js';
import { crowdVariants, type CrowdModel } from '../render/actors/Crowd.js';
import { OniIntro } from '../render/actors/OniIntro.js';
import { RiderActor, type RiderClips } from '../render/actors/RiderActor.js';
import { WeaponActor } from '../render/actors/WeaponActor.js';

const FULL_BODY: { id: string; rootMotion: boolean }[] = [
  { id: CLIP_IDS.getupBack, rootMotion: true },
  { id: CLIP_IDS.getupProne, rootMotion: true },
  { id: CLIP_IDS.run, rootMotion: false },
  { id: CLIP_IDS.disappointed, rootMotion: false },
  { id: CLIP_IDS.victoryRobot, rootMotion: false },
  { id: CLIP_IDS.victorySnake, rootMotion: false },
  { id: CLIP_IDS.cheerClap, rootMotion: false },
];
const UPPER: string[] = [CLIP_IDS.swordSlash, CLIP_IDS.morningStarSwing];

export class ActorLibrary {
  private assets: AssetStore;
  private bikes = new Map<BikeId, GLTF>();
  private riders = new Map<RiderId, GLTF>();
  private weapons = new Map<WeaponId, GLTF>();
  private oni: GLTF | null = null;
  private canon = new Map<string, CanonicalClip>();
  private riderClips = new Map<RiderId, Map<string, THREE.AnimationClip>>();
  private masks = new Map<string, Map<string, THREE.Texture>>();
  private crowd: CrowdModel[] = [];

  constructor(assets: AssetStore) {
    this.assets = assets;
  }

  private async loadMasks(id: string): Promise<void> {
    const e = this.assets.entry(id);
    const map = new Map<string, THREE.Texture>();
    if (e) {
      for (const [role] of Object.entries(e.files)) {
        if (!role.startsWith('mask:')) continue;
        const t = await this.assets.entryTexture(id, role);
        if (t) map.set(role.slice(5), t);
      }
    }
    this.masks.set(id, map);
  }

  async loadAll(): Promise<void> {
    const jobs: Promise<unknown>[] = [];
    for (const b of BIKE_IDS) jobs.push(this.assets.model(BIKE_ASSET[b]).then((g) => g && this.bikes.set(b, g)), this.loadMasks(BIKE_ASSET[b]));
    for (const r of SELECTABLE_RIDER_IDS) jobs.push(this.assets.model(RIDER_ASSET[r]).then((g) => g && this.riders.set(r, g)), this.loadMasks(RIDER_ASSET[r]));
    for (const w of WEAPON_IDS) jobs.push(this.assets.model(WEAPON_ASSET[w]).then((g) => g && this.weapons.set(w, g)));
    jobs.push(this.assets.model('starter.oni').then((g) => (this.oni = g)));
    for (const c of Object.values(CLIP_IDS)) jobs.push(this.assets.clip(c).then((clip) => clip && this.canon.set(c, clip)));
    const crowdIds = ['crowd.mohawk', 'crowd.enforcer', 'crowd.ruffle', 'crowd.horned'];
    const crowdJobs = crowdIds.map(async (id) => {
      const e = this.assets.entry(id);
      if (!e) return null;
      const [lod0, lod1] = await Promise.all([this.assets.model(id, 'lod0'), e.files.lod1 ? this.assets.model(id, 'lod1') : Promise.resolve(null)]);
      await this.loadMasks(id);
      if (!lod0) return null;
      const model: CrowdModel = {
        id,
        lod0,
        lod1,
        rigged: e.crowd?.rigged ?? false,
        variants: crowdVariants(id, e.crowd?.variants ?? 4),
        masks: this.masks.get(id) ?? new Map(),
        tintMaterials: e.crowd?.tintMaterials ?? [],
        riderAppearance: id === 'crowd.mohawk' ? 'RIDER_03_CYBERPUNK_MOHAWK' : id === 'crowd.enforcer' ? 'RIDER_04_CYBERPUNK_ENFORCER' : null,
      };
      return model;
    });
    await Promise.all(jobs);
    this.crowd = (await Promise.all(crowdJobs)).filter((m): m is CrowdModel => !!m);
    // Retarget every clip onto each rider rig once (clips bind by semantic bone name).
    for (const [rid, gltf] of this.riders) {
      const rig = buildRig(gltf.scene);
      const map = new Map<string, THREE.AnimationClip>();
      for (const c of FULL_BODY) {
        const clip = this.canon.get(c.id);
        if (clip) map.set(c.id, retargetClip(clip, rig, { rootMotion: c.rootMotion, name: c.id }));
      }
      for (const c of UPPER) {
        const clip = this.canon.get(c);
        if (clip) map.set(`${c}:upper`, retargetClip(clip, rig, { rootMotion: false, only: UPPER_BODY, name: `${c}:upper` }));
      }
      this.riderClips.set(rid, map);
    }
  }

  clipsFor(r: RiderId): RiderClips {
    const map = this.riderClips.get(r) ?? new Map<string, THREE.AnimationClip>();
    return { get: (id) => map.get(id), markers: (id) => this.canon.get(id)?.markers ?? {} };
  }

  createBike(id: BikeId, variant: number): BikeActor | null {
    const g = this.bikes.get(id);
    const info = this.assets.entry(BIKE_ASSET[id])?.bike;
    if (!g || !info) return null;
    return new BikeActor(id, g, { ...info, mount: BIKES[id].mount }, variant, this.masks.get(BIKE_ASSET[id]) ?? new Map());
  }

  createRider(id: RiderId, variant: number, weapon: WeaponId | null): RiderActor | null {
    const g = this.riders.get(id);
    if (!g) return null;
    const r = new RiderActor(id, g, variant, this.masks.get(RIDER_ASSET[id]) ?? new Map(), this.clipsFor(id));
    if (weapon) {
      const w = this.createWeapon(weapon);
      if (w) {
        w.attach(r.rig);
        r.weapon = w;
      }
    }
    return r;
  }

  createWeapon(id: WeaponId): WeaponActor | null {
    const g = this.weapons.get(id);
    const info = this.assets.entry(WEAPON_ASSET[id])?.weapon;
    if (!g || !info) return null;
    return new WeaponActor(id, g, info);
  }

  createOni(landing: THREE.Vector3, yaw: number): OniIntro | null {
    const info = this.assets.entry('starter.oni')?.starter;
    if (!this.oni || !info) return null;
    return new OniIntro(this.oni, info, landing, yaw);
  }

  crowdModels(): CrowdModel[] {
    return this.crowd;
  }

  canonical(id: string): CanonicalClip | null {
    return this.canon.get(id) ?? null;
  }

  /** Compiles all actor material variants (every render pass) so no shader compiles mid-race. */
  async warmup(world: World): Promise<void> {
    const holder = new THREE.Group();
    holder.position.set(0, -200, 0);
    for (const b of BIKE_IDS) for (let v = 0; v < 3; v++) {
      const bike = this.createBike(b, v);
      if (bike) holder.add(bike.root);
    }
    for (const r of SELECTABLE_RIDER_IDS) for (let v = 0; v < 3; v++) {
      const rider = this.createRider(r, v, WEAPON_IDS[v % WEAPON_IDS.length]!);
      if (rider) holder.add(rider.root);
    }
    const oni = this.createOni(new THREE.Vector3(), 0);
    if (oni) {
      oni.root.visible = true;
      holder.add(oni.root);
    }
    const cam = new THREE.PerspectiveCamera(70, 1.6, 0.1, 500);
    cam.position.set(0, -195, 8);
    cam.lookAt(0, -200, 0);
    try {
      await world.warmup(cam, [holder]);
    } catch (e) {
      console.warn('[actors] shader warm-up incomplete', e);
    }
  }
}
