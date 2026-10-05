// Logical runtime asset registry. Source files live in Assets/ (immutable) and are converted by
// tools/asset-pipeline into public/runtime-assets/. Runtime code refers only to logical IDs.
import type { BikeId, RiderId, WeaponId } from '../shared/ids.js';

export type AssetCategory = 'bike' | 'rider' | 'weapon' | 'starter' | 'city' | 'crowd' | 'weather' | 'animation' | 'texture';

export interface AssetEntryDef {
  id: string;
  category: AssetCategory;
  /** Required gameplay assets block race start when missing; cosmetic ones degrade with a warning. */
  required: boolean;
  /** Source path(s) relative to the project root; empty for procedural outputs. */
  sources: string[];
  description: string;
}

export const BIKE_ASSET: Record<BikeId, string> = {
  BIKE_01_SCIFI_MOTORCYCLE: 'bike.scifi',
  BIKE_02_AKIRA_CRUISER: 'bike.akira',
  BIKE_03_HOVERING_ENGINE: 'bike.hoveringEngine',
  BIKE_04_HOVER_ROCKET: 'bike.hoverRocket',
  BIKE_05_TRON_LIGHT_CYCLE: 'bike.tron',
  BIKE_06_MONOBIKE: 'bike.monobike',
};

export const RIDER_ASSET: Record<RiderId, string> = {
  RIDER_01_BLACKGUARD: 'rider.blackguard',
  RIDER_02_SCARLET_PROXY: 'rider.scarlet',
  RIDER_03_CYBERPUNK_MOHAWK: 'rider.mohawk',
  RIDER_04_CYBERPUNK_ENFORCER: 'rider.enforcer',
};

export const WEAPON_ASSET: Record<WeaponId, string> = {
  MACHETE: 'weapon.machete',
  MORNING_STAR: 'weapon.morningStar',
  KATANA: 'weapon.katana',
  ZABIMARU: 'weapon.zabimaru',
};

/** Semantic clip ids used by gameplay/animation code. */
export const CLIP_IDS = {
  getupBack: 'clip.getupBack',
  getupProne: 'clip.getupProne',
  run: 'clip.run',
  disappointed: 'clip.disappointed',
  victoryRobot: 'clip.victoryRobot',
  victorySnake: 'clip.victorySnake',
  swordSlash: 'clip.swordSlash',
  morningStarSwing: 'clip.morningStarSwing',
  cheerClap: 'clip.cheerClap',
  walk: 'clip.walk',
} as const;
export type ClipId = (typeof CLIP_IDS)[keyof typeof CLIP_IDS];

export const ASSET_REGISTRY: readonly AssetEntryDef[] = [
  // Bikes
  { id: 'bike.scifi', category: 'bike', required: true, sources: ['Assets/Bikes/sci-fi_motorcycle.glb'], description: 'Sci-Fi Motorcycle' },
  { id: 'bike.akira', category: 'bike', required: true, sources: ['Assets/Bikes/akira_class_cruiser.glb'], description: 'Akira Class Cruiser' },
  { id: 'bike.hoveringEngine', category: 'bike', required: true, sources: ['Assets/Bikes/hovering_engine_motorcycle.glb'], description: 'Hovering Engine Motorcycle' },
  { id: 'bike.hoverRocket', category: 'bike', required: true, sources: ['Assets/Bikes/hover_bike_-_the_rocket.glb'], description: 'Hover Rocket' },
  { id: 'bike.tron', category: 'bike', required: true, sources: ['Assets/Bikes/tron_uprising_-_argoncity_light_cycle.glb'], description: 'TRON Light Cycle' },
  { id: 'bike.monobike', category: 'bike', required: true, sources: ['Assets/Bikes/monobike_-_toriyama_dragonseeker.glb'], description: 'Monobike Dragonseeker' },
  // Riders
  { id: 'rider.blackguard', category: 'rider', required: true, sources: ['Assets/Characters/tron_uprising_blackguard.glb'], description: 'RIDER_01_BLACKGUARD' },
  { id: 'rider.scarlet', category: 'rider', required: true, sources: ['Assets/Characters/scarlet_proxy__free_sci-fi_charchter_riged.glb'], description: 'RIDER_02_SCARLET_PROXY' },
  { id: 'rider.mohawk', category: 'rider', required: true, sources: ['Assets/Characters/readyplayerme_cyberpunk.glb'], description: 'RIDER_03_CYBERPUNK_MOHAWK' },
  { id: 'rider.enforcer', category: 'rider', required: true, sources: ['Assets/Characters/cyberpunk_character.glb'], description: 'RIDER_04_CYBERPUNK_ENFORCER' },
  // Weapons
  { id: 'weapon.machete', category: 'weapon', required: true, sources: ['Assets/Weapons/free_realistic_modern_machete_with_uv_low-poly.glb'], description: 'Machete' },
  { id: 'weapon.morningStar', category: 'weapon', required: true, sources: ['Assets/Weapons/morning_star_low_poly.glb'], description: 'Morning Star' },
  { id: 'weapon.katana', category: 'weapon', required: true, sources: ['Assets/Weapons/no_name_-_katana.glb'], description: 'Sci-Fi Katana' },
  { id: 'weapon.zabimaru', category: 'weapon', required: true, sources: ['Assets/Weapons/zabimaru_v2_-_bleach.glb'], description: 'Zabimaru (segmented)' },
  // Race starter
  { id: 'starter.oni', category: 'starter', required: true, sources: ['Assets/Race starter/cyborg_oni.glb'], description: 'Cyborg Oni race starter' },
  // Track structure kits
  { id: 'city.tunnel', category: 'city', required: true, sources: ['Assets/City/future_tunnel.glb'], description: 'Future tunnel module' },
  { id: 'city.bridgeKit', category: 'city', required: true, sources: ['Assets/City/bridges_and_street_assets.glb'], description: 'Bridge/damage module kit' },
  { id: 'texture.wetRoad', category: 'texture', required: true, sources: ['Assets/City/post-apocalyptic_city.glb'], description: 'Wet asphalt material set (extracted)' },
  { id: 'texture.rain', category: 'texture', required: false, sources: ['Assets/Weather/rain_drops_circles__download__like_please.glb'], description: 'Rain streak + ripple normal textures (extracted)' },
  // City dressing (cosmetic)
  { id: 'city.timesSquare', category: 'city', required: false, sources: ['Assets/City/times square.glb'], description: 'Neon Core dressing (partitioned, fictional ads)' },
  { id: 'city.commercial', category: 'city', required: false, sources: ['Assets/City/cyberpunk_city_-_1.glb'], description: 'Commercial district blocks' },
  { id: 'city.industrial', category: 'city', required: false, sources: ['Assets/City/post-apocalyptic_city.glb'], description: 'Industrial sector dressing' },
  { id: 'city.skyline', category: 'city', required: false, sources: ['Assets/City/cyberpunk_city.glb'], description: 'Distant skyline (lines dropped, decimated)' },
  // Crowd
  { id: 'crowd.mohawk', category: 'crowd', required: false, sources: ['Assets/Audience/readyplayerme_cyberpunk.glb'], description: 'Crowd: ReadyPlayerMe cyberpunk' },
  { id: 'crowd.enforcer', category: 'crowd', required: false, sources: ['Assets/Audience/cyberpunk_character.glb'], description: 'Crowd: cyberpunk character' },
  { id: 'crowd.ruffle', category: 'crowd', required: false, sources: ['Assets/Audience/rigged_female_fashion_character_in_ruffle_dress.glb'], description: 'Crowd: ruffle dress (decimated)' },
  { id: 'crowd.horned', category: 'crowd', required: false, sources: ['Assets/Audience/female_character.glb'], description: 'Crowd: horned static figure (far/mid only)' },
  // Animation clips (converted from FBX or generated procedurally on the semantic skeleton)
  { id: CLIP_IDS.getupBack, category: 'animation', required: true, sources: ['Assets/Animation/Getting Up (1).fbx'], description: 'Face-up get-up (anim_getup_back)' },
  { id: CLIP_IDS.getupProne, category: 'animation', required: true, sources: ['Assets/Animation/Getting Up (1).fbx'], description: 'Face-down get-up (procedural push-up + shared stand phase)' },
  { id: CLIP_IDS.run, category: 'animation', required: true, sources: ['Assets/Animation/Fast Run (1).fbx'], description: 'Run to bike' },
  { id: CLIP_IDS.disappointed, category: 'animation', required: true, sources: ['Assets/Animation/Disappointed.fbx'], description: 'Results 4th+' },
  { id: CLIP_IDS.victoryRobot, category: 'animation', required: true, sources: ['Assets/Animation/Robot Hip Hop Dance.fbx'], description: 'Victory dance' },
  { id: CLIP_IDS.victorySnake, category: 'animation', required: true, sources: ['Assets/Animation/Snake Hip Hop Dance.fbx'], description: 'Victory dance (snake)' },
  { id: CLIP_IDS.swordSlash, category: 'animation', required: true, sources: ['Assets/Animation/Stable Sword Inward Slash.fbx'], description: 'Blade melee upper body' },
  { id: CLIP_IDS.morningStarSwing, category: 'animation', required: true, sources: ['Assets/Animation/anim_morningstar_swing_r.fbx'], description: 'Morning star swing' },
  { id: CLIP_IDS.cheerClap, category: 'animation', required: true, sources: [], description: 'Cheer/Clap (procedural; no source clip supplied)' },
  { id: CLIP_IDS.walk, category: 'animation', required: false, sources: [], description: 'In-place walk (procedural; no source clip supplied)' },
];

export const MANIFEST_PATH = 'runtime-assets/manifest.json';
