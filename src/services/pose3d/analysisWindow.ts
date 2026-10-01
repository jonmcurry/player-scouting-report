/**
 * How the pose pipeline's analyzed video maps back onto the raw upload.
 *
 * Phase frames in metrics.json and pose_2d.json index into the video the
 * pipeline actually analyzed (pose_2d.json meta.video): for a long upload
 * that is Stage 0's trimmed window (locate_swing.py), possibly subsampled
 * again by Stage 0.5 (decimate.py). Those working copies are deleted when the
 * run ends, so anything that needs the same frame from the raw upload must
 * map it back:
 *
 *   - Stage 0 re-encodes the window starting at trim_start_s without forcing
 *     a frame rate, so analyzed frame 0 is the raw upload's first frame at or
 *     after trim_start_s, and frames stay one-to-one after it.
 *   - Stage 0.5 keeps every decimation_factor-th frame by index.
 *
 * So analyzed frame n = raw presentation frame k0 + n * frameStep, where k0
 * is the first raw frame at or after startS. Phone video is variable frame
 * rate, so a raw frame's time must come from the container's own timestamps,
 * never n / fps (see extract.ts).
 *
 * Returns null (unknown alignment, callers must not guess) when the analyzed
 * file can't be matched to the raw upload or exactly one recorded Stage 0
 * window.
 */
import fs from "node:fs";
import path from "node:path";

interface Stage0Window { video_path_for_pipeline: string; trim_start_s: number | null }
interface Stage0 extends Stage0Window { candidate_windows?: Stage0Window[] | null }
interface Decimate { decimated: boolean; original_video_path?: string | null; decimation_factor?: number | null }

export interface AnalysisWindow {
  /** Seconds into the raw upload where the analyzed video starts (0 when untrimmed). */
  startS: number;
  /** Raw frames per analyzed frame (Stage 0.5's decimation factor, else 1). */
  frameStep: number;
}

const same = (a: string, b: string) => path.normalize(a).toLowerCase() === path.normalize(b).toLowerCase();

export function analysisWindowFor(args: {
  rawVideoPath: string;
  analyzedVideoPath: string;
  stage0: Stage0 | null;
  decimate: Decimate | null;
}): AnalysisWindow | null {
  let frameStep = 1;
  let preDecimation = args.analyzedVideoPath;
  if (args.decimate?.decimated) {
    const factor = args.decimate.decimation_factor;
    if (!args.decimate.original_video_path || !Number.isInteger(factor) || factor! < 1) return null;
    frameStep = factor!;
    preDecimation = args.decimate.original_video_path;
  }
  if (same(preDecimation, args.rawVideoPath)) return { startS: 0, frameStep };
  if (!args.stage0) return null;
  // Every recorded window whose working file is the one analyzed; the top-level
  // entry repeats the best candidate. Two matches that disagree on where they
  // start mean the file can't be placed - fail closed rather than pick one.
  const starts = new Set(
    [...(args.stage0.candidate_windows ?? []), args.stage0]
      .filter((w) => w.video_path_for_pipeline && same(w.video_path_for_pipeline, preDecimation))
      .map((w) => w.trim_start_s),
  );
  if (starts.size !== 1) return null;
  const [startS] = [...starts];
  return typeof startS === "number" && Number.isFinite(startS) && startS >= 0 ? { startS, frameStep } : null;
}

/** Reads stage0.json/decimate.json/pose_2d.json from a pipeline output dir. */
export function analysisWindowForClipDir(clipDir: string, rawVideoPath: string): AnalysisWindow | null {
  const read = <T>(name: string): T | null => {
    const p = path.join(clipDir, name);
    return fs.existsSync(p) ? (JSON.parse(fs.readFileSync(p, "utf-8")) as T) : null;
  };
  const pose2d = read<{ meta: { video: string } }>("pose_2d.json");
  if (!pose2d?.meta?.video) return null;
  return analysisWindowFor({
    rawVideoPath, analyzedVideoPath: pose2d.meta.video, stage0: read<Stage0>("stage0.json"), decimate: read<Decimate>("decimate.json"),
  });
}

/**
 * Raw presentation-frame index for each analyzed frame, given the raw
 * upload's sorted presentation timestamps. Null when any frame falls outside
 * the raw video (wrong window - fail closed).
 */
export function rawFrameIndices(window: AnalysisWindow, rawPtsSorted: number[], analyzedFrames: number[]): number[] | null {
  // Stage 0 passes trim_start_s to ffmpeg formatted to milliseconds.
  const start = Math.round(window.startS * 1000) / 1000;
  const k0 = rawPtsSorted.findIndex((t) => t >= start - 1e-6);
  if (k0 < 0) return null;
  const out = analyzedFrames.map((n) => k0 + n * window.frameStep);
  return out.every((i) => Number.isInteger(i) && i >= 0 && i < rawPtsSorted.length) ? out : null;
}
