// Runtime asset manifest emitted by tools/asset-pipeline into public/runtime-assets/manifest.json.
import type { AssetCategory } from '../config/assets.js';

export type Vec3Tuple = [number, number, number];

export interface MountTargets {
  seatTarget: Vec3Tuple;
  leftGripTarget: Vec3Tuple;
  rightGripTarget: Vec3Tuple;
  leftFootTarget: Vec3Tuple;
  rightFootTarget: Vec3Tuple;
  mountEntryPoint: Vec3Tuple;
  recoveryApproachPoint: Vec3Tuple;
  mountSide: 'left' | 'right';
  /** Forward spine lean (deg) of the riding pose. */
  ridingSpineLean: number;
  /** Pelvis pitch (deg) of the riding pose. */
  ridingHipRotation: number;
  profile: 'sport' | 'cruiser' | 'prone' | 'hover' | 'monowheel';
}

export interface BikeRuntimeInfo {
  length: number;
  width: number;
  height: number;
  hoverHeight: number;
  wheels: { node: string; radius: number; axis: Vec3Tuple }[];
  steerNodes: string[];
  spinNodes: { node: string; axis: Vec3Tuple; rate: number }[];
  emissiveMaterials: string[];
  paintMaterials: string[];
  boostNode: string | null;
  exhaust: Vec3Tuple[];
  headlight: Vec3Tuple;
  idleClip: string | null;
  mount: MountTargets;
}

export interface RiderRuntimeInfo {
  height: number;
  /** semantic bone name -> node name in the runtime GLB */
  retargetMap: Record<string, string>;
  rigKind: 'mixamo' | 'custom';
  hiddenNodes: string[];
  handBone: string;
  skinMaterials: string[];
  tintMaterials: string[];
  rightHandGripOffset: Vec3Tuple;
}

export interface WeaponRuntimeInfo {
  length: number;
  /** Weapon local frame: grip at origin, blade/chain along +Y. */
  gripOffset: Vec3Tuple;
  segments: string[];
  chainBones: string[];
  ballNode: string | null;
  tipNode: string | null;
}

export interface StarterRuntimeInfo {
  clip: string;
  trimStart: number;
  landingTime: number;
  gestureTime: number;
  height: number;
  handBone: string;
}

export interface KitModule {
  name: string;
  size: Vec3Tuple;
  center: Vec3Tuple;
  tris: number;
  tags: string[];
}

export interface CityRuntimeInfo {
  size: Vec3Tuple;
  /** Centre of the main avenue (for Times Square) or of the footprint, in runtime units. */
  anchor: Vec3Tuple;
  cells?: number;
  modules?: KitModule[];
  emissiveMaterials?: string[];
  roadMaterial?: string | null;
}

export interface CrowdRuntimeInfo {
  height: number;
  rigged: boolean;
  retargetMap: Record<string, string>;
  tintMaterials: string[];
  variants: number;
}

export interface TextureSetInfo {
  baseColor?: string;
  normal?: string;
  orm?: string;
  roughness?: string;
  emissive?: string;
  alpha?: string;
  width: number;
  height: number;
}

export interface ClipRuntimeInfo {
  fps: number;
  duration: number;
  frames: number;
  bones: string[];
  procedural: boolean;
  loop: boolean;
}

export interface ManifestEntry {
  id: string;
  category: AssetCategory;
  required: boolean;
  source: { path: string; sha256: string; bytes: number }[];
  /** Runtime files, keyed by role (lod0, lod1, clip, baseColor ...). Paths relative to runtime-assets/. */
  files: Record<string, string>;
  bytes: number;
  triangles: number;
  maxTextureSize: number;
  textureFormat: 'ktx2' | 'webp' | 'png' | 'none';
  orientation: { forward: '+Z'; up: '+Y'; units: 'm' };
  notes: string[];
  bike?: BikeRuntimeInfo;
  rider?: RiderRuntimeInfo;
  weapon?: WeaponRuntimeInfo;
  starter?: StarterRuntimeInfo;
  city?: CityRuntimeInfo;
  crowd?: CrowdRuntimeInfo;
  texture?: TextureSetInfo;
  clip?: ClipRuntimeInfo;
  materialVariants?: { name: string; colors: Record<string, string> }[];
  animations?: string[];
}

export interface RuntimeManifest {
  manifestVersion: string;
  pipelineVersion: string;
  generatedAt: string;
  entries: Record<string, ManifestEntry>;
  missingSources: string[];
  warnings: string[];
}
