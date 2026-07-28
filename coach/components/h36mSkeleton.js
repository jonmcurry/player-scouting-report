// H36M-17 joint/bone topology shared by skeletonRenderer.js and
// fkCorrection.js. Names and index order verified against
// scripts/pose3d/lift_3d.py's H36M_JOINT_NAMES (itself confirmed there
// against VideoPose3D_src/common/h36m_dataset.py's remove_joints() call) -
// not re-derived from memory, must stay byte-for-byte in sync with that
// list since video_clip_pose3d.joint_names is a verbatim copy of it.

export const H36M_JOINT_NAMES = [
  "hip", "r_hip", "r_knee", "r_ankle", "l_hip", "l_knee", "l_ankle",
  "thorax", "neck", "head", "head_top",
  "l_shoulder", "l_elbow", "l_wrist",
  "r_shoulder", "r_elbow", "r_wrist",
];

export const HIP = 0, R_HIP = 1, R_KNEE = 2, R_ANKLE = 3, L_HIP = 4, L_KNEE = 5, L_ANKLE = 6;
export const THORAX = 7, NECK = 8, HEAD = 9, HEAD_TOP = 10;
export const L_SHOULDER = 11, L_ELBOW = 12, L_WRIST = 13;
export const R_SHOULDER = 14, R_ELBOW = 15, R_WRIST = 16;

// child -> parent, for every non-root joint (root/hip has no parent). Used
// by fkCorrection.js to walk/rotate a joint's descendant chain.
export const PARENT_OF = {
  [R_HIP]: HIP, [R_KNEE]: R_HIP, [R_ANKLE]: R_KNEE,
  [L_HIP]: HIP, [L_KNEE]: L_HIP, [L_ANKLE]: L_KNEE,
  [THORAX]: HIP, [NECK]: THORAX, [HEAD]: NECK, [HEAD_TOP]: HEAD,
  [L_SHOULDER]: THORAX, [L_ELBOW]: L_SHOULDER, [L_WRIST]: L_ELBOW,
  [R_SHOULDER]: THORAX, [R_ELBOW]: R_SHOULDER, [R_WRIST]: R_ELBOW,
};

// [parentIdx, childIdx] pairs, drawn as capsules. 16 bones for 17 joints -
// exactly a tree (every joint but the root has one parent edge).
export const BONES = [
  [HIP, R_HIP], [R_HIP, R_KNEE], [R_KNEE, R_ANKLE],
  [HIP, L_HIP], [L_HIP, L_KNEE], [L_KNEE, L_ANKLE],
  [HIP, THORAX], [THORAX, NECK], [NECK, HEAD], [HEAD, HEAD_TOP],
  [THORAX, L_SHOULDER], [L_SHOULDER, L_ELBOW], [L_ELBOW, L_WRIST],
  [THORAX, R_SHOULDER], [R_SHOULDER, R_ELBOW], [R_ELBOW, R_WRIST],
];

export function boneKey(parentIdx, childIdx) {
  return `${parentIdx}>${childIdx}`;
}

export const ARM_BONE_KEYS = new Set([
  boneKey(L_SHOULDER, L_ELBOW), boneKey(L_ELBOW, L_WRIST),
  boneKey(R_SHOULDER, R_ELBOW), boneKey(R_ELBOW, R_WRIST),
]);
export const LEG_BONE_KEYS = new Set([
  boneKey(R_HIP, R_KNEE), boneKey(R_KNEE, R_ANKLE),
  boneKey(L_HIP, L_KNEE), boneKey(L_KNEE, L_ANKLE),
]);
export const HEAD_BONE_KEYS = new Set([boneKey(NECK, HEAD), boneKey(HEAD, HEAD_TOP)]);

// Torso quad fill corners, in draw order - approximates the old
// emily_c_swing_model.html page's hand-authored torso fill using this
// project's real H36M joint indices instead of its own 4 named joints.
export const TORSO_QUAD = [L_SHOULDER, R_SHOULDER, R_HIP, L_HIP];

// THORAX's full descendant subtree (neck/head/both arms) - fkCorrection.js's
// hip-shoulder-separation correction rigidly rotates exactly this set about
// the vertical axis, which preserves every upper-body bone length for free.
export const THORAX_SUBTREE = [
  NECK, HEAD, HEAD_TOP,
  L_SHOULDER, L_ELBOW, L_WRIST,
  R_SHOULDER, R_ELBOW, R_WRIST,
];

// L_KNEE's descendant chain (just the ankle - H36M-17 has no foot joints) -
// fkCorrection.js's knee-extension correction rotates this about the axis
// perpendicular to the hip-knee-ankle plane.
export const KNEE_CHILDREN = { [L_KNEE]: [L_ANKLE], [R_KNEE]: [R_ANKLE] };
