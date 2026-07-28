/**
 * TypeScript port of scripts/pose3d/one_euro_filter.py's One-Euro adaptive
 * filter (Casiez et al. 2012) - the SAME proven algorithm already used in
 * this codebase for the identical "static load + fast swing in one clip"
 * problem, applied here to smooth the 3D joint trajectory (pose_3d.json's
 * "joints" arrays) before storage, since scripts/pose3d/ has never smoothed
 * anything after 3D lifting (only 2D keypoints, before lifting - see that
 * file's own docstring). This directly addresses the documented reason a
 * prior version of this project's own 3D swing-model page rejected being
 * driven by real pose data: "no real per-frame data means no noisy real
 * data to fight, which is what made earlier data-driven versions look
 * jerky."
 *
 * Runs ONCE, here, in the Node worker at ingestion - NOT in the Python
 * pipeline itself. scripts/pose3d/metrics.py's phase-detection thresholds
 * (ROTATION_MIN_DEG, EXTENSION_HIGH_CONF_DEG, STRIDE_SPEED_MIN_HIP_WIDTHS_PER_S)
 * were calibrated against the CURRENT, unsmoothed pose_3d.json output -
 * smoothing upstream in Python would silently shift those already-validated
 * thresholds. Smoothing only here, only on data written into the new
 * video_clip_pose3d table, leaves pose_3d.json and every Python-side
 * calibration untouched.
 *
 * mincutoff/beta are NOT the same values one_euro_filter.py uses for 2D
 * pixel keypoints (mincutoff=0.8, beta=0.4) - those were tuned for
 * pixel-space magnitudes. pose_3d.json's joints are root-relative,
 * "metric-ish" H36M units (a different, much smaller order of magnitude),
 * so reusing the pixel-tuned constants as-is would make beta's adaptive
 * term negligible, behaving like a non-adaptive fixed cutoff and defeating
 * the point. See ONE_EURO_MINCUTOFF/ONE_EURO_BETA's own comments for the
 * real empirical tuning this was checked against.
 */

export interface Pose3dFrame {
  frame: number;
  time_s: number;
  tracked: boolean;
  joints: number[][]; // 17 x [x, y, z]
  angles: Record<string, number | null>;
}

// Empirically tuned against real frames/emily_c/Emily_C_AB1 (4)/pose_3d.json
// data via a real grid search (src/services/pose3d/tuneSmoothing.ts,
// standalone, not part of the runtime path) - NOT copied from a plausible-
// sounding guess. The first real attempt (mincutoff=0.05, beta=1.2,
// dcutoff=1.0 - the 2D-pixel-scale defaults, adjusted only for the smaller
// unit magnitude) was measurably too aggressive: it crushed peak swing
// acceleration to 5-9% of the raw signal's and, for the wrist, shifted the
// detected acceleration peak 10 frames away from the real contact frame -
// exactly the "flattening the real swing" failure this feature must avoid.
//
// The grid search measured, per representative joint (r_wrist, r_knee),
// three things at each (mincutoff, beta, dcutoff): noise reduction in a
// known-static 2s window, peak-acceleration-timing alignment against the
// real contact frame (from that clip's own metrics.json), and - the most
// directly meaningful check - how far the SMOOTHED joint position at the
// real contact frame drifts from the RAW position there, as a fraction of
// that joint's whole-clip range of motion. Position error dropped
// monotonically as mincutoff increased (13.1%/11.9% of ROM at the original
// guess, down to 1.7%/1.7% here), and peak-timing lag (present at every
// lower setting tried) reached exactly zero for BOTH joints only at this
// setting - the clearest, least-arbitrary point in the search to stop.
// Noise reduction here is real but modest (1.37x-1.57x, not 5-17x) -
// deliberately favoring not distorting real swing timing/position (which
// directly matters for a coaching tool evaluating mechanics) over maximum
// smoothness. Re-run tuneSmoothing.ts against more real clips before
// treating this as final if it's ever revisited.
export const ONE_EURO_MINCUTOFF = 10.0;
export const ONE_EURO_BETA = 2.0;
export const ONE_EURO_DCUTOFF = 15.0;
export const SMOOTHING_METHOD_LABEL = "one_euro_v1";

class OneEuroFilter {
  private freq: number;
  private readonly mincutoff: number;
  private readonly beta: number;
  private readonly dcutoff: number;
  private xPrev: number | null = null;
  private dxPrev = 0;
  private tPrev: number | null = null;

  constructor(freq: number, mincutoff: number, beta: number, dcutoff: number) {
    this.freq = freq;
    this.mincutoff = mincutoff;
    this.beta = beta;
    this.dcutoff = dcutoff;
  }

  private static alpha(cutoff: number, freq: number): number {
    const te = 1.0 / freq;
    const tau = 1.0 / (2 * Math.PI * cutoff);
    return 1.0 / (1.0 + tau / te);
  }

  apply(x: number, t: number): number {
    if (this.tPrev !== null) {
      const dt = Math.max(t - this.tPrev, 1e-6);
      this.freq = 1.0 / dt;
    }
    this.tPrev = t;

    if (this.xPrev === null) {
      this.xPrev = x;
      return x;
    }

    const dx = (x - this.xPrev) * this.freq;
    const aD = OneEuroFilter.alpha(this.dcutoff, this.freq);
    const dxHat = aD * dx + (1 - aD) * this.dxPrev;

    const cutoff = this.mincutoff + this.beta * Math.abs(dxHat);
    const a = OneEuroFilter.alpha(cutoff, this.freq);
    const xHat = a * x + (1 - a) * this.xPrev;

    this.xPrev = xHat;
    this.dxPrev = dxHat;
    return xHat;
  }
}

/**
 * Smooths every joint's x/y/z channel independently across the frame
 * sequence (51 independent 1D filters for 17 joints - same "filter each
 * axis independently" approach as PointFilter2D, extended from 2 axes to
 * 3). Returns new frame objects; input is not mutated. `angles` is copied
 * through UNCHANGED (see this module's own docstring for why - the FK
 * correction step needs the real, unsmoothed anchor-frame angle, and
 * smoothing joints/angles independently would risk making them
 * geometrically inconsistent with each other).
 */
export function smoothJoints(
  frames: Pose3dFrame[],
  mincutoff = ONE_EURO_MINCUTOFF,
  beta = ONE_EURO_BETA,
  dcutoff = ONE_EURO_DCUTOFF,
): Pose3dFrame[] {
  if (frames.length === 0) return [];
  const nJoints = frames[0]!.joints.length;
  const initialFreq = frames.length > 1 ? 1 / Math.max(frames[1]!.time_s - frames[0]!.time_s, 1e-6) : 30;

  // 17 joints x 3 axes = 51 independent filters.
  const filters: OneEuroFilter[][] = Array.from({ length: nJoints }, () =>
    Array.from({ length: 3 }, () => new OneEuroFilter(initialFreq, mincutoff, beta, dcutoff)),
  );

  return frames.map((frame) => ({
    ...frame,
    joints: frame.joints.map((xyz, jointIdx) =>
      xyz.map((v, axisIdx) => filters[jointIdx]![axisIdx]!.apply(v, frame.time_s)),
    ),
    angles: { ...frame.angles },
  }));
}
