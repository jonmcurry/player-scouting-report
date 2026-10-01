/**
 * Where the batter is in the frame, from the pose3d pipeline's own 2D output
 * (pose_2d.json keypoints + bat_path.json bat ends). Used for two things that
 * both exist because the batter is a small figure in a wide game-footage
 * frame (often under a tenth of a 4K frame's area):
 *
 *  - batter-zoomed AI input stills (extract.ts), cut from the same original
 *    frame, so a model sees the hitter at a usable size;
 *  - the coach app's "zoom on player" video view (stored per phase as
 *    swing_phases.detail.subject_box, normalized 0-1).
 *
 * Positioning only: the box decides which original pixels are shown, it
 * never adds, sharpens or synthesizes any. Fails closed (null) when the
 * tracked person has too few confident keypoints to place a box honestly.
 *
 * Geometry is the rule the 2026-09-23 crop experiment documented
 * (demo-export/analysis/crop_experiment/make_crops.py): union of reliable
 * keypoints (+ the tracked bat ends), padded by PAD x body height on every
 * side, widened to at least MIN_W x body height, clamped to the frame.
 */

export const SUBJECT_BOX_METHOD = "pose2d-keypoints+bat-v1";

const KEYPOINT_MIN_CONF = 0.3;
const BAT_MIN_CONF = 0.3;
const MIN_RELIABLE_KEYPOINTS = 8;
const PAD = 0.35;
const MIN_W = 0.9;
const MAX_JUMP = 1.0;

export interface Pose2dFrame { frame: number; keypoints: [number, number, number][] }
export interface BatFrame { frame: number; tip: [number, number] | null; knob: [number, number] | null; conf: number | null }
/** Pixel box, corners inclusive-exclusive. */
export interface PixelBox { x0: number; y0: number; x1: number; y1: number }
/** Normalized to the frame (0-1). */
export interface NormalizedBox { x: number; y: number; w: number; h: number }

function points(pose: Pose2dFrame | undefined, bat: BatFrame | undefined): { body: [number, number][]; extra: [number, number][] } {
  const body = (pose?.keypoints ?? []).filter((k) => k && k[2] >= KEYPOINT_MIN_CONF).map((k) => [k[0], k[1]] as [number, number]);
  const extra: [number, number][] = [];
  if (bat && (bat.conf ?? 0) >= BAT_MIN_CONF) for (const p of [bat.tip, bat.knob]) if (p) extra.push(p);
  return { body, extra };
}

/** Centre and height of a frame's confident keypoints, or null when too few are confident. */
function bodyAt(pose: Pose2dFrame | undefined): { cx: number; cy: number; h: number } | null {
  const body = points(pose, undefined).body;
  if (body.length < MIN_RELIABLE_KEYPOINTS) return null;
  const ys = body.map((p) => p[1]);
  return { cx: body.reduce((a, p) => a + p[0], 0) / body.length, cy: body.reduce((a, p) => a + p[1], 0) / body.length, h: Math.max(...ys) - Math.min(...ys) };
}

/** Whether the tracked batter is confidently visible with their body centre
 * inside `box` at `frame` - used to check a crop actually shows the batter. */
export function batterInBox(poseFrames: Pose2dFrame[], frame: number, box: PixelBox): boolean {
  const here = bodyAt(poseFrames.find((f) => f.frame === frame));
  return !!here && here.cx >= box.x0 && here.cx <= box.x1 && here.cy >= box.y0 && here.cy <= box.y1;
}

/**
 * Batter box over frames [from, to] (inclusive), or null when no frame in the
 * window has enough confident keypoints. Body height for padding is the
 * tallest single-frame keypoint extent in the window, so a crouched frame
 * doesn't shrink the padding.
 */
export function subjectBoxOverFrames(
  poseFrames: Pose2dFrame[],
  batFrames: BatFrame[],
  from: number,
  to: number,
  width: number,
  height: number,
  anchorFrame?: number,
): PixelBox | null {
  const poseBy = new Map(poseFrames.map((f) => [f.frame, f]));
  const batBy = new Map(batFrames.map((f) => [f.frame, f]));
  // Identity-switch guard: the tracker can jump to another player mid-clip
  // (seen on real clips: a fielder, the catcher). Frames whose body centre is
  // more than MAX_JUMP x body height from the anchor are treated as someone
  // else and left out of the box. The anchor is anchorFrame (a located swing
  // phase, e.g. load) when it has a usable pose, else the first usable frame.
  let anchor: { cx: number; cy: number; h: number } | null = anchorFrame === undefined ? null : bodyAt(poseBy.get(anchorFrame));
  let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity, bodyH = 0;
  for (let f = from; f <= to; f++) {
    const { body, extra } = points(poseBy.get(f), batBy.get(f));
    const here = bodyAt(poseBy.get(f));
    if (!here) continue;
    const { cx, cy, h } = here;
    if (!anchor) anchor = here;
    else if (Math.hypot(cx - anchor.cx, cy - anchor.cy) > MAX_JUMP * anchor.h) continue;
    bodyH = Math.max(bodyH, h);
    for (const [x, y] of [...body, ...extra]) {
      x0 = Math.min(x0, x); y0 = Math.min(y0, y); x1 = Math.max(x1, x); y1 = Math.max(y1, y);
    }
  }
  if (!Number.isFinite(x0) || bodyH <= 0) return null;
  const pad = PAD * bodyH;
  x0 -= pad; y0 -= pad; x1 += pad; y1 += pad;
  const minW = MIN_W * bodyH;
  if (x1 - x0 < minW) {
    const cx = (x0 + x1) / 2;
    x0 = cx - minW / 2; x1 = cx + minW / 2;
  }
  const box = {
    x0: Math.max(0, Math.floor(x0)), y0: Math.max(0, Math.floor(y0)),
    x1: Math.min(width, Math.ceil(x1)), y1: Math.min(height, Math.ceil(y1)),
  };
  return box.x1 > box.x0 && box.y1 > box.y0 ? box : null;
}

/** Batter box around one instant: the phase frame +/- `halfWindow` frames. */
export function subjectBoxAt(
  poseFrames: Pose2dFrame[], batFrames: BatFrame[], frame: number, width: number, height: number, halfWindow = 2,
): PixelBox | null {
  return subjectBoxOverFrames(poseFrames, batFrames, frame - halfWindow, frame + halfWindow, width, height);
}

export function normalizeBox(box: PixelBox, width: number, height: number): NormalizedBox {
  const r = (v: number) => Math.round(v * 10_000) / 10_000;
  return { x: r(box.x0 / width), y: r(box.y0 / height), w: r((box.x1 - box.x0) / width), h: r((box.y1 - box.y0) / height) };
}

/** Rescales a pixel box from the pose file's frame size to another
 * resolution of the same frame (e.g. a still decoded at a different size). */
export function scaleBox(box: PixelBox, fromW: number, fromH: number, toW: number, toH: number): PixelBox {
  const sx = toW / fromW, sy = toH / fromH;
  return {
    x0: Math.max(0, Math.floor(box.x0 * sx)), y0: Math.max(0, Math.floor(box.y0 * sy)),
    x1: Math.min(toW, Math.ceil(box.x1 * sx)), y1: Math.min(toH, Math.ceil(box.y1 * sy)),
  };
}
