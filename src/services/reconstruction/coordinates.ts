import type { Vec3 } from "./types.js";

/** VideoPose3D world output is [X, depth, vertical]. BarrelTrace is X-right/Y-up/Z-pitcher. */
export function videoPose3dToBarrelTrace([x, depth, vertical]: Vec3, pitcherSign: 1 | -1 = 1): Vec3 {
  return [x, vertical, depth * pitcherSign];
}

/** Three.js uses the same Y-up handed convention; source-like camera choices happen downstream. */
export function barrelTraceToThree([x, y, z]: Vec3): Vec3 {
  return [x, y, -z];
}

export function mirrorBatterLeftRight([x, y, z]: Vec3): Vec3 {
  return [-x, y, z];
}
