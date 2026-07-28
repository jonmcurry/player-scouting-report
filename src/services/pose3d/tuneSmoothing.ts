#!/usr/bin/env node
/**
 * Standalone tuning/verification tool for smoothJoints.ts's One-Euro
 * constants - NOT part of the runtime path (nothing imports this at
 * runtime). Run manually against real frames/<player>/<clip>/pose_3d.json
 * data when re-checking or re-tuning ONE_EURO_MINCUTOFF/ONE_EURO_BETA.
 *
 * Prints, per representative joint: (a) raw per-frame displacement
 * magnitude stats (to see the real scale of motion in these root-relative
 * units), and (b) a smoothness comparison (raw vs smoothed per-frame
 * "jerk" - the second difference of position, i.e. acceleration) around
 * the real contact frame (read from that clip's own metrics.json) - the
 * check this project's own established discipline requires: confirm noise
 * is reduced WITHOUT flattening the real swing's acceleration ramp.
 *
 * Usage:
 *   npx tsx src/services/pose3d/tuneSmoothing.ts "frames/emily_c/Emily_C_AB1 (4)"
 */
import fs from "node:fs";
import path from "node:path";
import { smoothJoints, type Pose3dFrame } from "./smoothJoints.js";

function dist3(a: number[], b: number[]): number {
  return Math.hypot(a[0]! - b[0]!, a[1]! - b[1]!, a[2]! - b[2]!);
}

function displacementSeries(frames: Pose3dFrame[], jointIdx: number): number[] {
  const out: number[] = [];
  for (let i = 1; i < frames.length; i++) {
    out.push(dist3(frames[i]!.joints[jointIdx]!, frames[i - 1]!.joints[jointIdx]!));
  }
  return out;
}

function stats(arr: number[]): { min: number; max: number; mean: number } {
  const mean = arr.reduce((a, b) => a + b, 0) / arr.length;
  return { min: Math.min(...arr), max: Math.max(...arr), mean };
}

/** Second difference of position (a proxy for acceleration/"jerk") - spikes
 * here in a supposedly-static window are noise; a real, sustained ramp
 * around contact is signal. */
function accelerationSeries(frames: Pose3dFrame[], jointIdx: number): number[] {
  const out: number[] = [];
  for (let i = 1; i < frames.length - 1; i++) {
    const prev = frames[i - 1]!.joints[jointIdx]!;
    const cur = frames[i]!.joints[jointIdx]!;
    const next = frames[i + 1]!.joints[jointIdx]!;
    const accel = [0, 1, 2].map((k) => next[k]! - 2 * cur[k]! + prev[k]!);
    out.push(Math.hypot(...accel));
  }
  return out;
}

async function main() {
  const clipDir = process.argv[2];
  if (!clipDir) {
    console.error("Usage: tuneSmoothing.ts <clipDir>");
    process.exit(1);
  }
  const pose3d = JSON.parse(fs.readFileSync(path.join(clipDir, "pose_3d.json"), "utf-8"));
  const frames: Pose3dFrame[] = pose3d.frames;
  const jointNames: string[] = pose3d.meta.joint_names;

  let contactFrame = -1;
  const metricsPath = path.join(clipDir, "metrics.json");
  if (fs.existsSync(metricsPath)) {
    const metrics = JSON.parse(fs.readFileSync(metricsPath, "utf-8"));
    contactFrame = metrics.contact?.frame ?? -1;
  }
  console.log(`Clip: ${clipDir}, ${frames.length} frames, contact frame: ${contactFrame}`);

  const REPRESENTATIVE = ["r_wrist", "r_knee"];
  const fps = pose3d.meta.fps;

  const GRID: Array<[number, number, number]> = [
    [3.0, 0.7, 8.0],
    [4.0, 0.8, 8.0],
    [5.0, 1.0, 10.0],
    [6.0, 1.2, 10.0],
    [8.0, 1.5, 12.0],
    [10.0, 2.0, 15.0],
  ];

  for (const jointName of REPRESENTATIVE) {
    const jointIdx = jointNames.indexOf(jointName);
    if (jointIdx === -1) continue;
    console.log(`\n=== ${jointName} (joint ${jointIdx}) ===`);
    const rawAccel = accelerationSeries(frames, jointIdx);
    const noiseWindowEnd = Math.min(Math.round(2 * fps), rawAccel.length);
    const rawNoise = stats(rawAccel.slice(0, noiseWindowEnd));
    const w0 = contactFrame > 0 ? Math.max(0, contactFrame - 15) : 0;
    const w1 = contactFrame > 0 ? Math.min(rawAccel.length, contactFrame + 15) : rawAccel.length;
    const rawSwing = stats(rawAccel.slice(w0, w1));
    console.log(`  raw noise mean=${rawNoise.mean.toExponential(3)}, raw swing max=${rawSwing.max.toExponential(3)}`);

    // Range of motion for this joint across the whole clip - used to express
    // position error as a fraction of real motion, not a raw unit that's
    // meaningless without context.
    let rangeMin = Infinity, rangeMax = -Infinity;
    for (const f of frames) {
      const d = Math.hypot(...f.joints[jointIdx]!);
      rangeMin = Math.min(rangeMin, d);
      rangeMax = Math.max(rangeMax, d);
    }
    const motionRange = rangeMax - rangeMin || 1;

    for (const [mincutoff, beta, dcutoff] of GRID) {
      const smoothed = smoothJoints(frames, mincutoff, beta, dcutoff);
      const smoothedAccel = accelerationSeries(smoothed, jointIdx);
      const smoothedNoise = stats(smoothedAccel.slice(0, noiseWindowEnd));
      const smoothedSwing = stats(smoothedAccel.slice(w0, w1));
      const noiseReduction = rawNoise.mean / smoothedNoise.mean;
      const signalPreservation = smoothedSwing.max / rawSwing.max;

      // Peak-timing alignment: does the smoothed signal's acceleration peak
      // land near the same frame as the raw signal's peak (lag = bad), not
      // just at a similar magnitude?
      const rawWindow = rawAccel.slice(w0, w1);
      const smoothedWindow = smoothedAccel.slice(w0, w1);
      const rawPeakIdx = rawWindow.indexOf(Math.max(...rawWindow));
      const smoothedPeakIdx = smoothedWindow.indexOf(Math.max(...smoothedWindow));
      const peakLagFrames = smoothedPeakIdx - rawPeakIdx;

      // Position fidelity at the actual contact frame - the more directly
      // meaningful check: how far off is the SMOOTHED joint position from
      // the RAW one at the exact moment that matters, relative to how far
      // this joint moves over the whole clip?
      let posErrorFrac = NaN;
      if (contactFrame > 0 && contactFrame < frames.length) {
        const rawPos = frames[contactFrame]!.joints[jointIdx]!;
        const smoothedPos = smoothed[contactFrame]!.joints[jointIdx]!;
        posErrorFrac = dist3(rawPos, smoothedPos) / motionRange;
      }

      console.log(
        `  mincutoff=${mincutoff} beta=${beta} dcutoff=${dcutoff}: ` +
          `noise reduction=${noiseReduction.toFixed(2)}x, signal preservation=${signalPreservation.toFixed(3)}, ` +
          `peak lag=${peakLagFrames}f, contact-frame pos error=${(posErrorFrac * 100).toFixed(1)}% of ROM`,
      );
    }
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
