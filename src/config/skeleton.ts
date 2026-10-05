// Common semantic humanoid layer, independent of source bone names
// (IMPLEMENTATION_CONTRACT §8). Per-rig maps convert source rigs to these names.

export const SEMANTIC_BONES = [
  'hips',
  'spine',
  'chest',
  'upperChest',
  'neck',
  'head',
  'leftShoulder',
  'leftUpperArm',
  'leftLowerArm',
  'leftHand',
  'rightShoulder',
  'rightUpperArm',
  'rightLowerArm',
  'rightHand',
  'leftUpperLeg',
  'leftLowerLeg',
  'leftFoot',
  'leftToes',
  'rightUpperLeg',
  'rightLowerLeg',
  'rightFoot',
  'rightToes',
] as const;
export type SemanticBone = (typeof SEMANTIC_BONES)[number];

export const FINGER_BONES = [
  'leftThumb1', 'leftThumb2', 'leftThumb3',
  'leftIndex1', 'leftIndex2', 'leftIndex3',
  'leftMiddle1', 'leftMiddle2', 'leftMiddle3',
  'leftRing1', 'leftRing2', 'leftRing3',
  'leftPinky1', 'leftPinky2', 'leftPinky3',
  'rightThumb1', 'rightThumb2', 'rightThumb3',
  'rightIndex1', 'rightIndex2', 'rightIndex3',
  'rightMiddle1', 'rightMiddle2', 'rightMiddle3',
  'rightRing1', 'rightRing2', 'rightRing3',
  'rightPinky1', 'rightPinky2', 'rightPinky3',
] as const;
export type FingerBone = (typeof FINGER_BONES)[number];

export const SEMANTIC_PARENT: Record<SemanticBone, SemanticBone | null> = {
  hips: null,
  spine: 'hips',
  chest: 'spine',
  upperChest: 'chest',
  neck: 'upperChest',
  head: 'neck',
  leftShoulder: 'upperChest',
  leftUpperArm: 'leftShoulder',
  leftLowerArm: 'leftUpperArm',
  leftHand: 'leftLowerArm',
  rightShoulder: 'upperChest',
  rightUpperArm: 'rightShoulder',
  rightLowerArm: 'rightUpperArm',
  rightHand: 'rightLowerArm',
  leftUpperLeg: 'hips',
  leftLowerLeg: 'leftUpperLeg',
  leftFoot: 'leftLowerLeg',
  leftToes: 'leftFoot',
  rightUpperLeg: 'hips',
  rightLowerLeg: 'rightUpperLeg',
  rightFoot: 'rightLowerLeg',
  rightToes: 'rightFoot',
};

/** Bone whose position defines each bone's "direction" (for rest-pose alignment). */
export const DIRECTION_CHILD: Partial<Record<SemanticBone, SemanticBone | FingerBone>> = {
  hips: 'spine',
  spine: 'chest',
  chest: 'upperChest',
  upperChest: 'neck',
  neck: 'head',
  leftShoulder: 'leftUpperArm',
  leftUpperArm: 'leftLowerArm',
  leftLowerArm: 'leftHand',
  leftHand: 'leftMiddle1',
  rightShoulder: 'rightUpperArm',
  rightUpperArm: 'rightLowerArm',
  rightLowerArm: 'rightHand',
  rightHand: 'rightMiddle1',
  leftUpperLeg: 'leftLowerLeg',
  leftLowerLeg: 'leftFoot',
  leftFoot: 'leftToes',
  rightUpperLeg: 'rightLowerLeg',
  rightLowerLeg: 'rightFoot',
  rightFoot: 'rightToes',
};

/** Upper-body bones used for layered melee while riding. */
export const UPPER_BODY: readonly SemanticBone[] = [
  'spine', 'chest', 'upperChest', 'neck', 'head',
  'leftShoulder', 'leftUpperArm', 'leftLowerArm', 'leftHand',
  'rightShoulder', 'rightUpperArm', 'rightLowerArm', 'rightHand',
];

const mixamo = (name: string) => new RegExp(`^(mixamorig:?)?${name}(_\\d+)?$`);

/** Mixamo-style rigs (Blackguard with prefix, ReadyPlayerMe without, FBX clips). */
export const MIXAMO_MAP: Record<string, RegExp> = {
  hips: mixamo('Hips'),
  spine: mixamo('Spine'),
  chest: mixamo('Spine1'),
  upperChest: mixamo('Spine2'),
  neck: mixamo('Neck'),
  head: mixamo('Head'),
  leftShoulder: mixamo('LeftShoulder'),
  leftUpperArm: mixamo('LeftArm'),
  leftLowerArm: mixamo('LeftForeArm'),
  leftHand: mixamo('LeftHand'),
  rightShoulder: mixamo('RightShoulder'),
  rightUpperArm: mixamo('RightArm'),
  rightLowerArm: mixamo('RightForeArm'),
  rightHand: mixamo('RightHand'),
  leftUpperLeg: mixamo('LeftUpLeg'),
  leftLowerLeg: mixamo('LeftLeg'),
  leftFoot: mixamo('LeftFoot'),
  leftToes: mixamo('LeftToeBase'),
  rightUpperLeg: mixamo('RightUpLeg'),
  rightLowerLeg: mixamo('RightLeg'),
  rightFoot: mixamo('RightFoot'),
  rightToes: mixamo('RightToeBase'),
  leftThumb1: mixamo('LeftHandThumb1'), leftThumb2: mixamo('LeftHandThumb2'), leftThumb3: mixamo('LeftHandThumb3'),
  leftIndex1: mixamo('LeftHandIndex1'), leftIndex2: mixamo('LeftHandIndex2'), leftIndex3: mixamo('LeftHandIndex3'),
  leftMiddle1: mixamo('LeftHandMiddle1'), leftMiddle2: mixamo('LeftHandMiddle2'), leftMiddle3: mixamo('LeftHandMiddle3'),
  leftRing1: mixamo('LeftHandRing1'), leftRing2: mixamo('LeftHandRing2'), leftRing3: mixamo('LeftHandRing3'),
  leftPinky1: mixamo('LeftHandPinky1'), leftPinky2: mixamo('LeftHandPinky2'), leftPinky3: mixamo('LeftHandPinky3'),
  rightThumb1: mixamo('RightHandThumb1'), rightThumb2: mixamo('RightHandThumb2'), rightThumb3: mixamo('RightHandThumb3'),
  rightIndex1: mixamo('RightHandIndex1'), rightIndex2: mixamo('RightHandIndex2'), rightIndex3: mixamo('RightHandIndex3'),
  rightMiddle1: mixamo('RightHandMiddle1'), rightMiddle2: mixamo('RightHandMiddle2'), rightMiddle3: mixamo('RightHandMiddle3'),
  rightRing1: mixamo('RightHandRing1'), rightRing2: mixamo('RightHandRing2'), rightRing3: mixamo('RightHandRing3'),
  rightPinky1: mixamo('RightHandPinky1'), rightPinky2: mixamo('RightHandPinky2'), rightPinky3: mixamo('RightHandPinky3'),
};

const arp = (name: string) => new RegExp(`^${name.replace(/\./g, '\\.')}(_\\d+)?$`);

/** Scarlet Proxy: Auto-Rig Pro export, 93 joints (stretch bones carry the deformation). */
export const SCARLET_MAP: Record<string, RegExp> = {
  hips: arp('root.x'),
  spine: arp('spine_01.x'),
  chest: arp('spine_02.x'),
  upperChest: arp('spine_03.x'),
  neck: arp('neck.x'),
  head: arp('head.x'),
  leftShoulder: arp('shoulder.l'),
  leftUpperArm: arp('arm_stretch.l'),
  leftLowerArm: arp('forearm_stretch.l'),
  leftHand: arp('hand.l'),
  rightShoulder: arp('shoulder.r'),
  rightUpperArm: arp('arm_stretch.r'),
  rightLowerArm: arp('forearm_stretch.r'),
  rightHand: arp('hand.r'),
  leftUpperLeg: arp('thigh_stretch.l'),
  leftLowerLeg: arp('leg_stretch.l'),
  leftFoot: arp('foot.l'),
  leftToes: arp('toes_01.l'),
  rightUpperLeg: arp('thigh_stretch.r'),
  rightLowerLeg: arp('leg_stretch.r'),
  rightFoot: arp('foot.r'),
  rightToes: arp('toes_01.r'),
  leftThumb1: arp('c_thumb1.l'), leftThumb2: arp('c_thumb2.l'), leftThumb3: arp('c_thumb3.l'),
  leftIndex1: arp('c_index1.l'), leftIndex2: arp('c_index2.l'), leftIndex3: arp('c_index3.l'),
  leftMiddle1: arp('c_middle1.l'), leftMiddle2: arp('c_middle2.l'), leftMiddle3: arp('c_middle3.l'),
  leftRing1: arp('c_ring1.l'), leftRing2: arp('c_ring2.l'), leftRing3: arp('c_ring3.l'),
  leftPinky1: arp('c_pinky1.l'), leftPinky2: arp('c_pinky2.l'), leftPinky3: arp('c_pinky3.l'),
  rightThumb1: arp('c_thumb1.r'), rightThumb2: arp('c_thumb2.r'), rightThumb3: arp('c_thumb3.r'),
  rightIndex1: arp('c_index1.r'), rightIndex2: arp('c_index2.r'), rightIndex3: arp('c_index3.r'),
  rightMiddle1: arp('c_middle1.r'), rightMiddle2: arp('c_middle2.r'), rightMiddle3: arp('c_middle3.r'),
  rightRing1: arp('c_ring1.r'), rightRing2: arp('c_ring2.r'), rightRing3: arp('c_ring3.r'),
  rightPinky1: arp('c_pinky1.r'), rightPinky2: arp('c_pinky2.r'), rightPinky3: arp('c_pinky3.r'),
};

const cp = (name: string) => new RegExp(`^${name}(_\\d+)?$`);

/** Cyberpunk Enforcer (cyberpunk_character.glb): custom 56-joint rig with spaced names. */
export const ENFORCER_MAP: Record<string, RegExp> = {
  hips: cp('hips'),
  spine: cp('spine1'),
  chest: cp('spine2'),
  upperChest: cp('spine3'),
  neck: cp('neck'),
  head: cp('head'),
  leftShoulder: cp('l shoulder'),
  leftUpperArm: cp('l arm'),
  leftLowerArm: cp('l forearm'),
  leftHand: cp('l hand'),
  rightShoulder: cp('r shoulder'),
  rightUpperArm: cp('r arm'),
  rightLowerArm: cp('r forearm'),
  rightHand: cp('r hand'),
  leftUpperLeg: cp('l leg'),
  leftLowerLeg: cp('l knee'),
  leftFoot: cp('l foot'),
  leftToes: cp('l toes'),
  rightUpperLeg: cp('r leg'),
  rightLowerLeg: cp('r knee'),
  rightFoot: cp('r foot'),
  rightToes: cp('r toes'),
  leftThumb1: cp('l thumb1'), leftThumb2: cp('l thumb2'), leftThumb3: cp('l thumb3'),
  leftIndex1: cp('l index1'), leftIndex2: cp('l index2'), leftIndex3: cp('l index3'),
  leftMiddle1: cp('l middle1'), leftMiddle2: cp('l middle2'), leftMiddle3: cp('l middle3'),
  leftRing1: cp('l ring1'), leftRing2: cp('l ring2'), leftRing3: cp('l ring3'),
  leftPinky1: cp('l pinky1'), leftPinky2: cp('l pinky2'), leftPinky3: cp('l pinky3'),
  rightThumb1: cp('r thumb1'), rightThumb2: cp('r thumb2'), rightThumb3: cp('r thumb3'),
  rightIndex1: cp('r index1'), rightIndex2: cp('r index2'), rightIndex3: cp('r index3'),
  rightMiddle1: cp('r middle1'), rightMiddle2: cp('r middle2'), rightMiddle3: cp('r middle3'),
  rightRing1: cp('r ring1'), rightRing2: cp('r ring2'), rightRing3: cp('r ring3'),
  rightPinky1: cp('r pinky1'), rightPinky2: cp('r pinky2'), rightPinky3: cp('r pinky3'),
};

/** Canonical clip format written by the pipeline (world-space rotations, character faces +Z). */
export interface CanonicalClip {
  id: string;
  fps: number;
  duration: number;
  loop: boolean;
  procedural: boolean;
  source: string;
  /** Rest hips height in metres. */
  hipsHeight: number;
  bones: string[];
  /** Rest world rotations [x,y,z,w] per bone (same order as bones). */
  restRot: number[][];
  /** Rest world positions (m) per bone plus direction reference points. */
  restPos: Record<string, [number, number, number]>;
  /** frames[f][b] = [x,y,z,w] world rotation. */
  frames: number[][][];
  /** Hips world position (m) per frame. */
  hips: number[][];
  markers: Record<string, number>;
}
