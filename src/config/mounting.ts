// Rider-specific riding calibration, applied on top of each bike's mount profile
// (src/config/bikes.ts). Bike-space offsets: metres, +Z forward, +Y up, +X = rider's left.
import type { BikeId, RiderId } from '../shared/ids.js';
import type { Vec3Tuple } from '../shared/manifest.js';

export interface RiderMount {
  /** Height of the hips bone above the seat contact surface when seated (m). */
  hipLift: number;
  /** Wrist-to-palm-centre distance: the palm, not the wrist, closes on the grip (m). */
  palm: number;
}

export interface MountTweak {
  /** Pelvis offset for this rider on this bike (bike space, m). */
  pelvis?: Vec3Tuple;
  /** Extra forward spine lean (deg). */
  lean?: number;
}

export const RIDER_MOUNT: Record<RiderId, RiderMount> = {
  RIDER_01_BLACKGUARD: { hipLift: 0.09, palm: 0.08 },
  RIDER_02_SCARLET_PROXY: { hipLift: 0.08, palm: 0.075 },
  RIDER_03_CYBERPUNK_MOHAWK: { hipLift: 0.09, palm: 0.08 },
  RIDER_04_CYBERPUNK_ENFORCER: { hipLift: 0.1, palm: 0.085 },
};

/** Per rider x bike corrections found in visual calibration (all 18 active pairs reviewed). */
export const MOUNT_TWEAKS: Partial<Record<RiderId, Partial<Record<BikeId, MountTweak>>>> = {
  // Scarlet is the shortest rider and her rig's right forearm is ~5 cm shorter than the left:
  // she sits further forward and tucks lower on the two long-reach bikes.
  RIDER_02_SCARLET_PROXY: {
    BIKE_01_SCIFI_MOTORCYCLE: { pelvis: [0, 0, 0.13], lean: 10 },
    BIKE_05_TRON_LIGHT_CYCLE: { pelvis: [0, -0.01, 0.12], lean: 20 },
    BIKE_06_MONOBIKE: { pelvis: [0, 0, 0.12], lean: 20 },
  },
  // Mohawk's shorter shins: sit slightly forward so the Rocket's forward pegs stay in reach.
  RIDER_03_CYBERPUNK_MOHAWK: {
    BIKE_04_HOVER_ROCKET: { pelvis: [0, -0.01, 0.05] },
  },
};

export function mountTweak(rider: RiderId, bike: BikeId): MountTweak {
  return MOUNT_TWEAKS[rider]?.[bike] ?? {};
}
