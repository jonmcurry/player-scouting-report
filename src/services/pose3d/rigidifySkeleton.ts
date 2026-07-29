/**
 * Rigid bone-length reconstruction - runs AFTER smoothJoints() (which
 * smooths each joint's x/y/z independently, for TIMING - see that file's
 * own docstring for why only there, never combined with this step).
 *
 * Real bug found while investigating why the rendered skeleton "looks
 * terrible": per-joint-independent smoothing does nothing to constrain the
 * DISTANCE between two smoothed joints, so a bone can visibly stretch/
 * shrink frame to frame even though each joint's own trajectory looks
 * smooth in isolation. Measured directly against real ingested clip data
 * (not assumed): forearm length varied ~97% of its own mean across one real
 * clip, hip-knee ~91-95% - a visibly broken skeleton, not just noisy.
 *
 * Fix: for each bone, take its MEDIAN observed length across the whole clip
 * (from the already-smoothed frames, so already timing-clean) as a single
 * per-clip reference length, then reconstruct every frame's joint positions
 * top-down from the root by walking the H36M parent-child tree - reusing
 * each frame's OBSERVED bone DIRECTION (parent->child unit vector, from the
 * smoothed data) but replacing its LENGTH with the fixed reference. This
 * preserves the swing's actual pose/orientation/timing while making every
 * bone length constant - the same forward-kinematics idea
 * coach/components/fkCorrection.js already uses for its 2 corrected
 * checkpoints, applied generally to every joint instead of just those two.
 *
 * H36M-17 joint indices/parent-child tree duplicated here from
 * coach/components/h36mSkeleton.js (a browser ES module with no build step
 * - can't import this Node/TS source, same JS/TS-boundary duplication this
 * project already accepts for CHECKPOINTS, see coach/shared.js's own
 * docstring) - MUST stay in sync if that file's topology ever changes.
 */
import type { Pose3dFrame } from "./smoothJoints.js";

export const RIGID_METHOD_LABEL = "rigid_v1";

const HIP = 0;
const NUM_JOINTS = 17;

// child joint index -> parent joint index, for every non-root joint.
const PARENT_OF: Record<number, number> = {
  1: 0, 2: 1, 3: 2, // r_hip, r_knee, r_ankle
  4: 0, 5: 4, 6: 5, // l_hip, l_knee, l_ankle
  7: 0, 8: 7, 9: 8, 10: 9, // thorax, neck, head, head_top
  11: 7, 12: 11, 13: 12, // l_shoulder, l_elbow, l_wrist
  14: 7, 15: 14, 16: 15, // r_shoulder, r_elbow, r_wrist
};

type Vec3 = [number, number, number];

function sub(a: Vec3, b: Vec3): Vec3 {
  return [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
}
function add(a: Vec3, b: Vec3): Vec3 {
  return [a[0] + b[0], a[1] + b[1], a[2] + b[2]];
}
function scaleVec(a: Vec3, s: number): Vec3 {
  return [a[0] * s, a[1] * s, a[2] * s];
}
function length(a: Vec3): number {
  return Math.sqrt(a[0] * a[0] + a[1] * a[1] + a[2] * a[2]);
}
function median(values: number[]): number {
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 0 ? (sorted[mid - 1]! + sorted[mid]!) / 2 : sorted[mid]!;
}

export function rigidifySkeleton(frames: Pose3dFrame[]): Pose3dFrame[] {
  if (frames.length === 0) return frames;

  // Per-bone reference length: median observed length across the whole
  // clip, keyed by child joint index (matches PARENT_OF's keys).
  const referenceLength: Record<number, number> = {};
  for (let child = 1; child < NUM_JOINTS; child++) {
    const parent = PARENT_OF[child]!;
    const lengths = frames.map((f) => length(sub(f.joints[child] as Vec3, f.joints[parent] as Vec3)));
    referenceLength[child] = median(lengths);
  }

  // Carries the last valid direction per bone forward across frames, for
  // the rare degenerate case where a frame's smoothed parent/child
  // positions coincide (near-zero observed bone length - would otherwise
  // divide by ~0). Real tracked data shouldn't hit this often, but a silent
  // NaN in a coaching-facing render is worse than a defensive fallback.
  const lastDirection: Record<number, Vec3> = {};

  return frames.map((frame) => {
    // Joint indices 0-16 are already parent-before-child in this exact
    // order for H36M-17 (confirmed against PARENT_OF above, not assumed) -
    // a plain increasing loop doubles as a valid topological walk.
    const rigidJoints: Vec3[] = new Array(NUM_JOINTS);
    rigidJoints[HIP] = frame.joints[HIP] as Vec3;

    for (let child = 1; child < NUM_JOINTS; child++) {
      const parent = PARENT_OF[child]!;
      const observed = sub(frame.joints[child] as Vec3, frame.joints[parent] as Vec3);
      const observedLen = length(observed);
      const direction: Vec3 =
        observedLen > 1e-6 ? scaleVec(observed, 1 / observedLen) : (lastDirection[child] ?? [0, 0, -1]);
      lastDirection[child] = direction;
      rigidJoints[child] = add(rigidJoints[parent]!, scaleVec(direction, referenceLength[child]!));
    }

    return { ...frame, joints: rigidJoints };
  });
}
