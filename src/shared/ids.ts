// Canonical IDs and enums shared by server, client, tools and tests.
// String unions are used for readability; numeric indices (the array order) are used on the wire.

export const RIDER_IDS = [
  'RIDER_01_BLACKGUARD',
  'RIDER_02_SCARLET_PROXY',
  'RIDER_03_CYBERPUNK_MOHAWK',
  'RIDER_04_CYBERPUNK_ENFORCER',
] as const;
export type RiderId = (typeof RIDER_IDS)[number];
/**
 * The racing roster. RIDER_IDS stays the full built-asset list because its order is the wire
 * encoding; Blackguard's assets are kept but the rider is no longer selectable.
 */
export const SELECTABLE_RIDER_IDS = ['RIDER_02_SCARLET_PROXY', 'RIDER_03_CYBERPUNK_MOHAWK', 'RIDER_04_CYBERPUNK_ENFORCER'] as const satisfies readonly RiderId[];
export type SelectableRiderId = (typeof SELECTABLE_RIDER_IDS)[number];
export const DEFAULT_RIDER_ID: SelectableRiderId = 'RIDER_02_SCARLET_PROXY';

export const BIKE_IDS = [
  'BIKE_01_SCIFI_MOTORCYCLE',
  'BIKE_02_AKIRA_CRUISER',
  'BIKE_03_HOVERING_ENGINE',
  'BIKE_04_HOVER_ROCKET',
  'BIKE_05_TRON_LIGHT_CYCLE',
  'BIKE_06_MONOBIKE',
] as const;
export type BikeId = (typeof BIKE_IDS)[number];

export const WEAPON_IDS = ['MACHETE', 'MORNING_STAR', 'KATANA', 'ZABIMARU'] as const;
export type WeaponId = (typeof WEAPON_IDS)[number];

/** Attacks include the procedural kick plus the four weapons. */
export const ATTACK_IDS = ['KICK', ...WEAPON_IDS] as const;
export type AttackId = (typeof ATTACK_IDS)[number];

export const WEATHER_LEVELS = ['LIGHT', 'MODERATE', 'HEAVY', 'TORRENTIAL'] as const;
export type WeatherLevel = (typeof WEATHER_LEVELS)[number];

/** Global client flow (IMPLEMENTATION_CONTRACT §6). */
export const GAME_PHASES = [
  'BOOT',
  'ASSET_CHECK',
  'MENU',
  'LOBBY',
  'LOADOUT',
  'READY',
  'INTRO',
  'COUNTDOWN',
  'RACING',
  'FINISHING',
  'RESULTS',
] as const;
export type GamePhase = (typeof GAME_PHASES)[number];

/** Authoritative server race state. */
export const RACE_STATES = ['LOBBY', 'INTRO', 'COUNTDOWN', 'RACING', 'FINISHING', 'RESULTS'] as const;
export type RaceState = (typeof RACE_STATES)[number];

/** Rider state machine (IMPLEMENTATION_CONTRACT §6). */
export const RIDER_STATES = [
  'GRID', // parked on the grid before GO
  'RIDING',
  'ATTACKING',
  'KICKING',
  'DESTABILIZED',
  'RAGDOLL',
  'SETTLING',
  'GETTING_UP',
  'RUNNING_TO_BIKE',
  'LIFTING',
  'REMOUNTING',
  'RECOVERY_PENALTY', // off-world recovery at last safe node, immobilised
  'FINISHED',
  'DISCONNECTED',
] as const;
export type RiderState = (typeof RIDER_STATES)[number];

export const ATTACK_PHASES = ['IDLE', 'WINDUP', 'ACTIVE', 'RECOVERY'] as const;
export type AttackPhase = (typeof ATTACK_PHASES)[number];

export const GETUP_KINDS = ['FACE_UP', 'FACE_DOWN'] as const;
export type GetupKind = (typeof GETUP_KINDS)[number];

export const GRAPHICS_PRESETS = ['HIGH', 'MEDIUM', 'MOBILE'] as const;
export type GraphicsPreset = (typeof GRAPHICS_PRESETS)[number];

export const DISTRICT_IDS = [
  'NEON_CORE',
  'COMMERCIAL',
  'STORM',
  'HEAVY_RAIN_TECHNICAL',
  'INDUSTRIAL',
  'TUNNEL',
  'BRIDGE_CLIMB',
  'BROKEN_BRIDGE',
  'WESTERN_TECHNICAL',
  'FINAL_NEON_RUN',
] as const;
export type DistrictId = (typeof DISTRICT_IDS)[number];

export const COLOR_VARIANT_COUNT = 3;
export const MAX_PLAYERS = 10;

export function isRiderId(v: unknown): v is RiderId {
  return typeof v === 'string' && (RIDER_IDS as readonly string[]).includes(v);
}
export function isSelectableRiderId(v: unknown): v is SelectableRiderId {
  return typeof v === 'string' && (SELECTABLE_RIDER_IDS as readonly string[]).includes(v);
}
export function isBikeId(v: unknown): v is BikeId {
  return typeof v === 'string' && (BIKE_IDS as readonly string[]).includes(v);
}
export function isWeaponId(v: unknown): v is WeaponId {
  return typeof v === 'string' && (WEAPON_IDS as readonly string[]).includes(v);
}
export function indexOfId<T extends string>(list: readonly T[], id: T): number {
  const i = list.indexOf(id);
  if (i < 0) throw new Error(`Unknown id ${id}`);
  return i;
}
