// Bike roster presentation + mount calibration (normalized bike space: metres, +Z forward,
// +Y up, ground at y = 0, centred on x/z). Physics balance lives in gameplay.ts.
import type { BikeId } from '../shared/ids.js';
import type { MountTargets, Vec3Tuple } from '../shared/manifest.js';

export interface BikeVariant {
  name: string;
  paint: string; // hex
  accent: string;
  emissive: string;
}

export interface BikeDef {
  id: BikeId;
  asset: string;
  name: string;
  tagline: string;
  /** Source forward axis before normalization. */
  sourceForward: '+Z' | '-Z' | '+X' | '-X';
  targetLength: number;
  hoverHeight: number;
  /** Materials that take the variant paint / accent colour (exact names). */
  paintMaterials: string[];
  accentMaterials: string[];
  emissiveMaterials: string[];
  /** Textured bikes use hue-shift masks instead of factor tints. */
  atlasTint: boolean;
  variants: [BikeVariant, BikeVariant, BikeVariant];
  mount: MountTargets;
  /** Riding-pose calibration beyond the shared mount targets. */
  riding: RidingCalibration;
  /** Mechanical steering assembly articulated procedurally (bikes with a real steering rig). */
  steering?: SteeringAssembly;
  exhaust: Vec3Tuple[];
  headlight: Vec3Tuple;
}

export interface RidingCalibration {
  /** Added to the pelvis placement after seating (bike space, m). */
  pelvisOffset: Vec3Tuple;
  /** Lateral push of the knee pole (m): > 0 keeps knees outside wide bodywork. */
  kneeOut: number;
  /** Forward reach of the knee pole (m); prone bikes use a low, rearward pole. */
  kneeForward: number;
  /** Maximum extra forward torso lean (deg) the reach solver may add so hands meet the grips. */
  maxReachLean: number;
  /** How far the solver may slide the pelvis forward on the seat for short-armed riders (m). */
  maxSlide: number;
}

export interface SteeringAssembly {
  /** Nodes that yaw together about the steering axis (wheel and both handlebar chains). */
  nodes: string[];
  /** A point on the steering axis (bike space) and the axis rake back from vertical (deg). */
  pivot: Vec3Tuple;
  rakeDeg: number;
  /** Full-lock steering angle (deg). */
  maxDeg: number;
  /** Grip = midpoint of these bone pairs (left, right); hands follow them while steering. */
  grips: [[string, string], [string, string]];
}

const V = (name: string, paint: string, accent: string, emissive: string): BikeVariant => ({ name, paint, accent, emissive });

export const BIKES: Record<BikeId, BikeDef> = {
  BIKE_01_SCIFI_MOTORCYCLE: {
    id: 'BIKE_01_SCIFI_MOTORCYCLE',
    asset: 'bike.scifi',
    name: 'Sci-Fi Motorcycle',
    tagline: 'Balanced all-rounder. Hubless wheels, low racing tuck.',
    sourceForward: '+Z',
    targetLength: 2.75,
    hoverHeight: 0,
    paintMaterials: ['Main'],
    accentMaterials: ['material', 'RedTone', 'wires'],
    emissiveMaterials: ['lightsGlass', 'emissionY', 'interface'],
    atlasTint: false,
    variants: [V('Midnight Cyan', '#1b2433', '#0e5f7a', '#18e0ff'), V('Scarlet Pulse', '#2a0d12', '#b0142a', '#ff2a3a'), V('Violet Arc', '#1c1230', '#5b2aa8', '#b85cff')],
    mount: {
      seatTarget: [0, 0.67, 0.02],
      leftGripTarget: [0.437, 0.701, 0.628],
      rightGripTarget: [-0.437, 0.701, 0.628],
      leftFootTarget: [0.25, 0.36, -0.34],
      rightFootTarget: [-0.25, 0.36, -0.34],
      mountEntryPoint: [0.85, 0, -0.2],
      recoveryApproachPoint: [1.1, 0, -0.1],
      mountSide: 'left',
      ridingSpineLean: 42,
      ridingHipRotation: 12,
      profile: 'sport',
    },
    riding: { pelvisOffset: [0, 0, 0.1], kneeOut: 0.25, kneeForward: 0.7, maxReachLean: 30, maxSlide: 0.2 },
    steering: {
      nodes: ['wheel_front', 'steer_left', 'steer_right'],
      pivot: [0, 0.423, 0.93],
      rakeDeg: 22,
      maxDeg: 18,
      grips: [['steeringWheel3L_08', 'steeringWheel3L_end_040'], ['steeringWheel3R_015', 'steeringWheel3R_end_045']],
    },
    exhaust: [[0, 0.45, -1.35]],
    headlight: [0, 0.58, 1.25],
  },
  BIKE_02_AKIRA_CRUISER: {
    id: 'BIKE_02_AKIRA_CRUISER',
    asset: 'bike.akira',
    name: 'Akira Class Cruiser',
    tagline: 'Heavy and planted. Slow to spin up, hard to knock over.',
    sourceForward: '+Z',
    targetLength: 2.9,
    hoverHeight: 0,
    paintMaterials: ['material'],
    accentMaterials: ['Material.004', 'Lux_Quilted_Leather'],
    emissiveMaterials: ['akira_coil', 'glow'],
    atlasTint: false,
    variants: [V('Capsule Red', '#9a0c0c', '#3a0606', '#ff3b2a'), V('Neo White', '#c9ccd6', '#20242e', '#39e8ff'), V('Toxic Lime', '#2a3a0a', '#1a1f0a', '#b6ff2a')],
    mount: {
      seatTarget: [0, 0.44, -0.33],
      leftGripTarget: [0.18, 0.64, 0.16],
      rightGripTarget: [-0.18, 0.64, 0.16],
      leftFootTarget: [0.21, 0.27, 0.12],
      rightFootTarget: [-0.21, 0.27, 0.12],
      mountEntryPoint: [0.95, 0, -0.35],
      recoveryApproachPoint: [1.2, 0, -0.2],
      mountSide: 'left',
      ridingSpineLean: 34,
      ridingHipRotation: 6,
      profile: 'cruiser',
    },
    riding: { pelvisOffset: [0, 0, 0], kneeOut: 0.2, kneeForward: 0.7, maxReachLean: 30, maxSlide: 0.2 },
    exhaust: [[0.18, 0.32, -1.42], [-0.18, 0.32, -1.42]],
    headlight: [0, 0.8, 1.05],
  },
  BIKE_03_HOVERING_ENGINE: {
    id: 'BIKE_03_HOVERING_ENGINE',
    asset: 'bike.hoveringEngine',
    name: 'Hovering Engine Motorcycle',
    tagline: 'Fastest launch in the pack. Boost flames on the cheat.',
    sourceForward: '-X',
    targetLength: 2.65,
    hoverHeight: 0.22,
    paintMaterials: ['Body'],
    accentMaterials: ['Material.007'],
    emissiveMaterials: ['Emission_Floater', 'Speedo_meter', 'boost'],
    atlasTint: false,
    variants: [V('Glacier', '#7fd6e0', '#0c1a33', '#39f0ff'), V('Solar Orange', '#d8641a', '#1c1208', '#ffb020'), V('Ghost Magenta', '#cf3aa8', '#1a0a18', '#ff4bd8')],
    mount: {
      seatTarget: [0, 0.95, -0.14],
      leftGripTarget: [0.35, 1.13, 0.19],
      rightGripTarget: [-0.35, 1.13, 0.19],
      leftFootTarget: [0.34, 0.42, 0.22],
      rightFootTarget: [-0.34, 0.42, 0.22],
      mountEntryPoint: [0.85, 0, -0.1],
      recoveryApproachPoint: [1.1, 0, 0],
      mountSide: 'left',
      ridingSpineLean: 26,
      ridingHipRotation: 4,
      profile: 'hover',
    },
    riding: { pelvisOffset: [0, 0, 0], kneeOut: 0.3, kneeForward: 0.7, maxReachLean: 30, maxSlide: 0.2 },
    exhaust: [[0, 0.62, -1.25]],
    headlight: [0, 0.7, 1.2],
  },
  BIKE_04_HOVER_ROCKET: {
    id: 'BIKE_04_HOVER_ROCKET',
    asset: 'bike.hoverRocket',
    name: 'Hover Rocket',
    tagline: 'Jet-turbine lunge. Twitchy when bumped.',
    sourceForward: '+X',
    targetLength: 2.9,
    hoverHeight: 0.3,
    paintMaterials: [],
    accentMaterials: [],
    emissiveMaterials: ['Test'],
    atlasTint: true,
    variants: [V('Factory', '#ffffff', '#ffffff', '#ffffff'), V('Arctic Hue', '#6fd8ff', '#ffffff', '#39e8ff'), V('Ember Hue', '#ff7a2a', '#ffffff', '#ff5a1a')],
    mount: {
      seatTarget: [0, 0.53, -0.28],
      leftGripTarget: [0.37, 0.93, 0.17],
      rightGripTarget: [-0.37, 0.93, 0.17],
      leftFootTarget: [0.37, 0.5, 0.44],
      rightFootTarget: [-0.37, 0.5, 0.44],
      mountEntryPoint: [1.0, 0, -0.2],
      recoveryApproachPoint: [1.3, 0, -0.1],
      mountSide: 'left',
      ridingSpineLean: 4,
      ridingHipRotation: -10,
      profile: 'hover',
    },
    riding: { pelvisOffset: [0, 0, 0], kneeOut: 0.25, kneeForward: 0.7, maxReachLean: 30, maxSlide: 0.2 },
    exhaust: [[0, 0.7, -1.4]],
    headlight: [0, 0.75, 1.45],
  },
  BIKE_05_TRON_LIGHT_CYCLE: {
    id: 'BIKE_05_TRON_LIGHT_CYCLE',
    asset: 'bike.tron',
    name: 'TRON Light Cycle',
    tagline: 'Sharpest turn-in. Prone riding under the canopy.',
    sourceForward: '+Z',
    targetLength: 2.6,
    hoverHeight: 0,
    paintMaterials: [],
    accentMaterials: [],
    emissiveMaterials: ['Glow'],
    atlasTint: false,
    variants: [V('Grid Orange', '#0b0d12', '#0b0d12', '#ff6a1a'), V('User Cyan', '#0b0d12', '#0b0d12', '#1ae4ff'), V('Program Red', '#0b0d12', '#0b0d12', '#ff1f3a')],
    mount: {
      seatTarget: [0, 0.66, -0.34],
      leftGripTarget: [0.2, 0.78, 0.75],
      rightGripTarget: [-0.2, 0.78, 0.75],
      leftFootTarget: [0.17, 0.4, -0.88],
      rightFootTarget: [-0.17, 0.4, -0.88],
      mountEntryPoint: [0.8, 0, -0.2],
      recoveryApproachPoint: [1.05, 0, -0.1],
      mountSide: 'left',
      ridingSpineLean: 68,
      ridingHipRotation: 22,
      profile: 'prone',
    },
    riding: { pelvisOffset: [0, 0, 0], kneeOut: 0.25, kneeForward: 0.2, maxReachLean: 20, maxSlide: 0.16 },
    exhaust: [[0, 0.4, -1.28]],
    headlight: [0, 0.62, 1.3],
  },
  BIKE_06_MONOBIKE: {
    id: 'BIKE_06_MONOBIKE',
    asset: 'bike.monobike',
    name: 'Monobike Dragonseeker',
    tagline: 'Single giant wheel. Agile, but easy to unsettle.',
    sourceForward: '+Z',
    targetLength: 2.0,
    hoverHeight: 0,
    paintMaterials: [],
    accentMaterials: [],
    emissiveMaterials: ['Monobike_U2'],
    atlasTint: true,
    variants: [V('Rust Orange', '#ffffff', '#ffffff', '#ff8a2a'), V('Sea Teal', '#39d6c8', '#ffffff', '#39e8ff'), V('Royal Violet', '#9a5cff', '#ffffff', '#c06cff')],
    mount: {
      seatTarget: [0, 1.42, -0.47],
      leftGripTarget: [0.42, 1.44, 0.36],
      rightGripTarget: [-0.42, 1.44, 0.36],
      leftFootTarget: [0.3, 0.98, -0.12],
      rightFootTarget: [-0.3, 0.98, -0.12],
      mountEntryPoint: [0.9, 0, -0.2],
      recoveryApproachPoint: [1.2, 0, -0.1],
      mountSide: 'left',
      ridingSpineLean: 34,
      ridingHipRotation: 8,
      profile: 'monowheel',
    },
    riding: { pelvisOffset: [0, 0, 0], kneeOut: 0.3, kneeForward: 0.7, maxReachLean: 40, maxSlide: 0.2 },
    exhaust: [[0, 0.9, -0.95]],
    headlight: [0, 1.1, 0.9],
  },
};
