/** Provisional, not calibrated. Revision 1 S0-04 G2/G5/G6, carried into
 * Revision 2 V1 only for its explicitly authorized subject signals. */
export const RECOVERED_SUBJECT_THRESHOLDS = Object.freeze({
  minBatEvidenceFrames: 5,
  minBatEvidenceFraction: 0.02,
  minTrackedFraction: 0.9,
  maxIdentityJumpFraction: 0.05,
});
/** Mirrors subjectBox.ts, not a second crop implementation. Source drift is tested.
 * bodyAt: >=8 keypoints at conf >=0.3; centre = arithmetic mean of those points;
 * height = max(y)-min(y). Anchor: requested usable frame, else first usable frame.
 * Compare with ANCHOR height, not current height; equality is not a jump.
 */
export const SUBJECT_SPATIAL_RULE = Object.freeze({ maxJumpBodyHeights: 1.0,
  keypointMinConfidence: 0.3, minReliableKeypoints: 8 });
export function isIdentityJump(current: { cx: number; cy: number }, anchor: { cx: number; cy: number; h: number }): boolean | null {
  if (![current?.cx, current?.cy, anchor?.cx, anchor?.cy, anchor?.h].every(Number.isFinite) || anchor.h <= 0) return null;
  return Math.hypot(current.cx - anchor.cx, current.cy - anchor.cy) > SUBJECT_SPATIAL_RULE.maxJumpBodyHeights * anchor.h;
}
