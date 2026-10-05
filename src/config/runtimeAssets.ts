// Client-side view of the asset registry: logical ids only. The source paths in config/assets.ts
// are pipeline/host data and must never be bundled into the production client
// (IMPLEMENTATION_CONTRACT §23); tests/assets-registry.test.ts keeps this list in sync.
import { BIKE_ASSET, CLIP_IDS, RIDER_ASSET, WEAPON_ASSET } from './assets.js';

export const REQUIRED_RUNTIME_ASSETS: readonly string[] = [
  ...Object.values(BIKE_ASSET),
  ...Object.values(RIDER_ASSET),
  ...Object.values(WEAPON_ASSET),
  'starter.oni',
  'city.tunnel',
  'city.bridgeKit',
  'texture.wetRoad',
  CLIP_IDS.getupBack,
  CLIP_IDS.getupProne,
  CLIP_IDS.run,
  CLIP_IDS.disappointed,
  CLIP_IDS.victoryRobot,
  CLIP_IDS.victorySnake,
  CLIP_IDS.swordSlash,
  CLIP_IDS.morningStarSwing,
  CLIP_IDS.cheerClap,
];
