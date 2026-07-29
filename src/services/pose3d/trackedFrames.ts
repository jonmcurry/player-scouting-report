/**
 * Real, serious bug found 2026-07-29 (not a subtle one - flagged directly
 * by the user looking at an actual rendered frame): the pipeline stored and
 * rendered EVERY frame from pose_3d.json, including frames where
 * `tracked: false` - meaning the 2D detector found no real person at all in
 * that frame. VideoPose3D's lift still emits SOME joint coordinates for
 * those frames (not real inferred positions - degenerate/carried-forward
 * garbage), and nothing downstream (smoothJoints, rigidifySkeleton, the
 * renderer) ever checked the `tracked` flag before treating that garbage as
 * a real reconstructed pose. Real measured impact, checked per-clip, not
 * assumed uniform: one clip was 89% tracked (just a garbage tail once the
 * batter left frame), one was 35% tracked (a long continuous at-bat with a
 * real ~2,500-frame tracked swing plus a lot of real dead time), and one
 * (`Emily_C_AB1_game2`) was 0.6% tracked - its "swing" was never real data
 * at all.
 *
 * Fix: extract the single LONGEST contiguous run of tracked==true frames
 * per clip, and use ONLY that for smoothing/rigidifying/storage - not the
 * union of every tracked frame regardless of position. A clip can have
 * several short tracked fragments scattered around real dead time (camera
 * panning, between-pitch downtime); stitching those together would create
 * timeline jump-cuts where the skeleton visibly teleports between two
 * unrelated poses. The real swing itself happens in one continuous window,
 * so picking the single longest run is both simpler and more honest than
 * trying to splice multiple fragments into one timeline.
 */
import type { Pose3dFrame } from "./smoothJoints.js";

// ~1 second at a typical 30fps clip - below this there genuinely isn't
// enough real tracked motion to render a meaningful comparison, not just an
// arbitrary round number.
export const MIN_TRACKED_FRAMES = 30;

export function extractLongestTrackedRun(frames: Pose3dFrame[]): Pose3dFrame[] {
  let bestStart = -1;
  let bestLength = 0;
  let runStart = -1;

  for (let i = 0; i < frames.length; i++) {
    if (frames[i]!.tracked) {
      if (runStart === -1) runStart = i;
      const length = i - runStart + 1;
      if (length > bestLength) {
        bestLength = length;
        bestStart = runStart;
      }
    } else {
      runStart = -1;
    }
  }

  return bestStart === -1 ? [] : frames.slice(bestStart, bestStart + bestLength);
}
