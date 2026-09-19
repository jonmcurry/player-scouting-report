// Named, versioned mapping for the checked-in Mixamo FBX. No numeric/mysterious bone indexes.
export const AVATAR_VERSION = "batter-fbx-mixamo-v1";
export const AVATAR_RETARGET_MAP = Object.freeze({
  pelvis:"mixamorigHips", spine:"mixamorigSpine", chest:"mixamorigSpine2", neck:"mixamorigNeck", head:"mixamorigHead",
  leftShoulder:"mixamorigLeftShoulder", leftUpperArm:"mixamorigLeftArm", leftForearm:"mixamorigLeftForeArm", leftHand:"mixamorigLeftHand",
  rightShoulder:"mixamorigRightShoulder", rightUpperArm:"mixamorigRightArm", rightForearm:"mixamorigRightForeArm", rightHand:"mixamorigRightHand",
  leftThigh:"mixamorigLeftUpLeg", leftShin:"mixamorigLeftLeg", leftFoot:"mixamorigLeftFoot",
  rightThigh:"mixamorigRightUpLeg", rightShin:"mixamorigRightLeg", rightFoot:"mixamorigRightFoot",
});
