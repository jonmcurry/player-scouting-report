// Forward-kinematics corrections for the two Tier-1 checklist checkpoints
// (extension, hip-shoulder-sep) that have a genuine single-angle
// correspondence in pose_3d.json's angles dict - see the approved plan's
// section 3/4 for why only these two, and section 4 for the geometric
// approach each correction uses. Pure functions, no DOM, independently
// testable against real emily_c coordinates (see verifyFkCorrection.ts).

import {
  THORAX, THORAX_SUBTREE, L_SHOULDER, R_SHOULDER, L_HIP, R_HIP,
} from "./h36mSkeleton.js";

function sub(a, b) { return [a[0] - b[0], a[1] - b[1], a[2] - b[2]]; }
function add(a, b) { return [a[0] + b[0], a[1] + b[1], a[2] + b[2]]; }
function scale(a, k) { return [a[0] * k, a[1] * k, a[2] * k]; }
function dot(a, b) { return a[0] * b[0] + a[1] * b[1] + a[2] * b[2]; }
function cross(a, b) {
  return [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
}
function norm(a) { return Math.hypot(a[0], a[1], a[2]); }
function normalize(a) {
  const n = norm(a);
  return n < 1e-9 ? [0, 0, 0] : scale(a, 1 / n);
}

/** Rodrigues' rotation formula: rotate vector v around unit axis by angleRad
 * (right-hand rule). The only rotation primitive this module needs - both
 * corrections rotate a small explicit point set around one explicit axis,
 * so a full matrix/quaternion library would be more machinery than the
 * problem calls for. */
export function rotateAroundAxis(v, axisUnit, angleRad) {
  const cosA = Math.cos(angleRad), sinA = Math.sin(angleRad);
  const kxv = cross(axisUnit, v);
  const kDotV = dot(axisUnit, v);
  return add(add(scale(v, cosA), scale(kxv, sinA)), scale(axisUnit, kDotV * (1 - cosA)));
}

function jointAngleDeg(a, b, c) {
  const v1 = sub(a, b), v2 = sub(c, b);
  const n1 = norm(v1), n2 = norm(v2);
  if (n1 < 1e-9 || n2 < 1e-9) return null;
  const cosA = Math.max(-1, Math.min(1, dot(v1, v2) / (n1 * n2)));
  return (Math.acos(cosA) * 180) / Math.PI;
}

/** Same fold-mod-180 trick as scripts/pose3d/lift_3d.py's
 * line_orientation_xy() - a line has no inherent direction, so this must
 * match that Python function exactly for hip-shoulder-sep's current-value
 * computation to agree with what's already stored in pose_3d.json. */
function lineOrientationXY(p1, p2) {
  const d1 = p2[0] - p1[0], d2 = p2[1] - p1[1];
  let ang = (Math.atan2(d2, d1) * 180) / Math.PI;
  ang = ((ang % 180) + 180) % 180;
  if (ang > 90) ang -= 180;
  return ang;
}

/** Mirrors scripts/pose3d/lift_3d.py's orientation_diff() exactly. */
function orientationDiff(a, b) {
  const d = Math.abs(a - b) % 180;
  return Math.min(d, 180 - d);
}

/**
 * Rotates only the ankle about the knee (about the axis perpendicular to
 * the hip-knee-ankle plane) so the knee's interior angle moves toward
 * targetDeg. Never overshoots and is a no-op if already >= targetDeg.
 * Preserves the shin (knee-ankle) bone length exactly, since any rotation
 * about an axis through the knee preserves distance from the knee.
 *
 * @param {number[][]} joints - 17 x [x,y,z] for one frame; NOT mutated
 * @param {number} hipIdx
 * @param {number} kneeIdx
 * @param {number} ankleIdx
 * @param {number} targetDeg
 * @returns {number[][]} new joints array, only ankleIdx changed
 */
export function correctKneeAngle(joints, hipIdx, kneeIdx, ankleIdx, targetDeg) {
  const hip = joints[hipIdx], knee = joints[kneeIdx], ankle = joints[ankleIdx];
  const currentDeg = jointAngleDeg(hip, knee, ankle);
  const out = joints.map((j) => [...j]);
  if (currentDeg === null || currentDeg >= targetDeg) return out;

  const v1 = normalize(sub(hip, knee)); // knee -> hip
  const v2 = sub(ankle, knee); // knee -> ankle
  let axis = cross(v1, v2);
  if (norm(axis) < 1e-6) {
    // Near-collinear: at/close to full extension, the hip-knee-ankle plane's
    // normal is poorly conditioned right at the moment that matters most
    // (flagged explicitly in the approved plan as a real edge case to test,
    // not a hypothetical). Any axis perpendicular to v1 still produces a
    // well-defined rotation that increases the angle - which one doesn't
    // matter when the leg is already essentially straight, since there is
    // no real bend-plane left to respect.
    const arbitrary = Math.abs(v1[0]) < 0.9 ? [1, 0, 0] : [0, 1, 0];
    axis = cross(v1, arbitrary);
  }
  axis = normalize(axis);

  // Rotating v2 by +theta around axis=cross(v1,v2) moves v2 AWAY from v1
  // (increases the interior angle) - verified algebraically (rotating v1
  // toward v2 by their angle-between recovers v2 exactly, by construction
  // of the cross product's right-hand-rule direction; continuing the same
  // rotation past that point moves further away from v1). deltaDeg is
  // always >= 0 here (guarded above), so this always increases the angle.
  const deltaDeg = targetDeg - currentDeg;
  const rotated = rotateAroundAxis(v2, axis, (deltaDeg * Math.PI) / 180);
  out[ankleIdx] = add(knee, rotated);
  return out;
}

/**
 * Rigidly rotates THORAX's entire descendant subtree (neck/head/both arms)
 * about the vertical (Z) axis through the thorax, so the real, unsmoothed
 * hip-shoulder-separation angle at this frame moves toward
 * targetSeparationDeg. Never overshoots and is a no-op if already >=
 * target. Preserves every upper-body bone length automatically (rigid-body
 * rotation preserves all pairwise distances within the rotated set) and
 * never touches the hip line (hips are not part of THORAX_SUBTREE).
 *
 * Rotation direction (does increasing the thorax's yaw increase or decrease
 * the fold-mod-180 separation metric?) is determined by a tiny numerical
 * probe rather than an analytical sign derivation - line_orientation_xy's
 * fold has boundary cases near the +-90deg wrap where an analytical sign
 * rule is easy to get backwards; measuring which direction actually helps
 * is simpler and unambiguous.
 *
 * @param {number[][]} joints - 17 x [x,y,z] for one frame; NOT mutated
 * @param {number} targetSeparationDeg
 * @returns {number[][]} new joints array, only THORAX_SUBTREE indices changed
 */
export function correctHipShoulderSeparation(joints, targetSeparationDeg) {
  const out = joints.map((j) => [...j]);
  const pivot = joints[THORAX];
  const axis = [0, 0, 1]; // world frame is Z-up (see lift_3d.py's module docstring)

  function separationAt(angleRad) {
    const ls = add(pivot, rotateAroundAxis(sub(joints[L_SHOULDER], pivot), axis, angleRad));
    const rs = add(pivot, rotateAroundAxis(sub(joints[R_SHOULDER], pivot), axis, angleRad));
    const shoulderLine = lineOrientationXY(ls, rs);
    const hipLine = lineOrientationXY(joints[L_HIP], joints[R_HIP]);
    return orientationDiff(shoulderLine, hipLine);
  }

  const currentSep = separationAt(0);
  if (currentSep >= targetSeparationDeg) return out;
  const deltaDeg = targetSeparationDeg - currentSep;

  const probeRad = (0.05 * Math.PI) / 180;
  const sign = separationAt(probeRad) >= separationAt(-probeRad) ? 1 : -1;
  const angleRad = sign * deltaDeg * (Math.PI / 180);

  for (const idx of THORAX_SUBTREE) {
    out[idx] = add(pivot, rotateAroundAxis(sub(joints[idx], pivot), axis, angleRad));
  }
  return out;
}
