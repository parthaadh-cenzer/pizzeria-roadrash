// Weapon roster presentation (timings/reach live in gameplay.ts ATTACKS).
import type { WeaponId } from '../shared/ids.js';
import { CLIP_IDS, WEAPON_ASSET } from './assets.js';

export interface WeaponDef {
  id: WeaponId;
  asset: string;
  name: string;
  tagline: string;
  clip: string;
  trail: string;
  /** Display length (m) used for the resting carry pose. */
  carryAngleDeg: number;
}

export const WEAPONS: Record<WeaponId, WeaponDef> = {
  MACHETE: { id: 'MACHETE', asset: WEAPON_ASSET.MACHETE, name: 'Machete', tagline: 'Short and quick (0.65 m). Fastest recovery.', clip: CLIP_IDS.swordSlash, trail: '#dfe8ff', carryAngleDeg: 35 },
  MORNING_STAR: { id: 'MORNING_STAR', asset: WEAPON_ASSET.MORNING_STAR, name: 'Morning Star', tagline: 'Heaviest hit (1.35 m). Slow wind-up, ball trails the hand.', clip: CLIP_IDS.morningStarSwing, trail: '#ff7a1a', carryAngleDeg: 20 },
  KATANA: { id: 'KATANA', asset: WEAPON_ASSET.KATANA, name: 'Sci-Fi Katana', tagline: 'Long, clean arc (1.15 m). Medium-high impact.', clip: CLIP_IDS.swordSlash, trail: '#ff2bd6', carryAngleDeg: 40 },
  ZABIMARU: { id: 'ZABIMARU', asset: WEAPON_ASSET.ZABIMARU, name: 'Zabimaru', tagline: 'Segments extend to 2.2 m reach, strike, then retract.', clip: CLIP_IDS.swordSlash, trail: '#ff2a3a', carryAngleDeg: 40 },
};
