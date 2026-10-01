#!/usr/bin/env node
/**
 * Cross-platform Node/TypeScript port of scripts/extract_frames.ps1. Same
 * behavior, same output layout - this replaces the PowerShell dependency for
 * frame extraction, nothing else. It does not touch or replace the separate
 * Python pose3d pipeline (scripts/pose3d/), which does far more (YOLO + bat
 * tracking + VideoPose3D) and stays a host-run tool.
 *
 * Output (identical naming to the .ps1 version): frames/<player>/<clipName>/
 *   - frame_001.png, frame_002.png, ... (dense sequence at --fps, default 10)
 *   - contact_sheet.png (5x4 grid thumbnail spanning the whole clip)
 *
 * Usage:
 *   npm run extract -- --video videos/maggie_m_20260802_eagles_ab1.mp4 --player maggie_m
 *   npm run extract -- --video "videos/Emily_C_AB1 (4).mp4" --player emily_c --fps 15
 */
import { Command } from "commander";
import ffmpeg from "fluent-ffmpeg";
import fs from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { spawn } from "node:child_process";
import { batterInBox, normalizeBox, subjectBoxAt, subjectBoxOverFrames, type BatFrame, type PixelBox, type Pose2dFrame } from "../services/pose3d/subjectBox.js";
import { rawFrameIndices, type AnalysisWindow } from "../services/pose3d/analysisWindow.js";

interface ExtractOptions {
  video: string;
  player: string;
  fps: string;
  outDir?: string;
}

function clipNameFrom(videoPath: string): string {
  return path.basename(videoPath, path.extname(videoPath));
}

function runFfmpeg(input: string, outputOptions: string[], output: string): Promise<void> {
  return new Promise((resolve, reject) => {
    ffmpeg(input)
      .outputOptions(outputOptions)
      .output(output)
      .on("end", () => resolve())
      .on("error", (err: Error) => reject(err))
      .run();
  });
}

export interface PhaseFrame {
  slug: string;
  frame: number;
}

export interface AnalysisInputSource {
  /** The raw upload. */
  videoPath: string;
  /** How the pose pipeline's analyzed video maps onto videoPath
   * (analysisWindowForClipDir) - phase frames index into the analyzed video. */
  window: AnalysisWindow;
  /** Analyzed video frame rate (pose_2d.json meta.fps); only sizes the sequence window. */
  fps: number;
  nFrames: number;
  /** Frame size the pose keypoints are in (pose_2d.json meta). */
  width: number;
  height: number;
  poseFrames: Pose2dFrame[];
  batFrames: BatFrame[];
}

const ZOOM_LONG_SIDE = 1024;
const SEQUENCE_MAX_FRAMES = 24;
const SEQUENCE_LEAD_S = 0.1;
const SEQUENCE_TAIL_S = 0.4;
const SEQUENCE_MAX_S = 3;
/** Share of sequence frames in which the tracked batter must be inside the crop. */
const SEQUENCE_MIN_IN_BOX = 0.8;

/** The raw upload's video presentation timestamps, ascending. Phone video is
 * variable frame rate, so frame n's time is NOT n / fps - measured on a real
 * 30fps-nominal clip, n / fps landed several frames away from frame n, while
 * seeking just before the container's own timestamp returned frame n exactly. */
function probePts(videoPath: string): Promise<number[]> {
  return new Promise((resolve, reject) => {
    const child = spawn("ffprobe", ["-v", "error", "-select_streams", "v:0", "-show_entries", "packet=pts_time", "-of", "csv=p=0", videoPath]);
    let out = "", err = "";
    child.stdout.on("data", (d) => (out += d));
    child.stderr.on("data", (d) => (err += d));
    child.on("error", reject);
    child.on("close", (code) => {
      if (code !== 0) return reject(new Error(`ffprobe failed: ${err}`));
      resolve(out.split(/\r?\n/).map((l) => parseFloat(l)).filter(Number.isFinite).sort((x, y) => x - y));
    });
  });
}

// A quarter frame before the frame's own timestamp: ffmpeg's accurate
// (decode-and-discard) input seek then returns exactly that frame.
function seekBefore(pts: number[], i: number): number {
  const gap = i > 0 ? pts[i]! - pts[i - 1]! : (pts[1] ?? pts[0]! + 1 / 30) - pts[0]!;
  return Math.max(0, pts[i]! - 0.25 * gap);
}

/** crop (relative to the decoded frame, so the pose file's resolution and
 * the raw file's never need to match) + bilinear enlargement so the longer
 * side is ZOOM_LONG_SIDE. No sharpening, denoising or other enhancement. */
function cropScaleFilter(box: PixelBox, src: AnalysisInputSource): string {
  const n = normalizeBox(box, src.width, src.height);
  const scale = box.x1 - box.x0 >= box.y1 - box.y0 ? `${ZOOM_LONG_SIDE}:-2` : `-2:${ZOOM_LONG_SIDE}`;
  return `crop=w=iw*${n.w}:h=ih*${n.h}:x=iw*${n.x}:y=ih*${n.y},scale=${scale}:flags=bilinear`;
}

function grabFrame(videoPath: string, seekS: number, filters: string[], output: string): Promise<void> {
  return new Promise((resolve, reject) => {
    const cmd = ffmpeg(videoPath).seekInput(seekS).outputOptions(["-frames:v", "1"]);
    if (filters.length) cmd.videoFilters(filters);
    cmd.output(output).on("end", () => resolve()).on("error", (err: Error) => reject(err)).run();
  });
}

/**
 * AI analysis input for one swing, all cut from the raw upload's original
 * pixels at exactly the analyzed frames:
 *   phase_<slug>.png  full frame at each located phase
 *   zoom_<slug>.png   the same frame cropped around the batter (when the batter is confidently tracked there)
 *   swing_seq_NN.png  batter-cropped frames in time order, evenly spaced (at most SEQUENCE_MAX_FRAMES)
 *                     from just before load to just after the last located swing phase (at most
 *                     SEQUENCE_MAX_S). Only written when load and contact are located AND the tracked
 *                     batter is inside the crop in at least SEQUENCE_MIN_IN_BOX of those frames - a
 *                     sequence that has lost the batter is never offered as whole-swing evidence.
 * Clears earlier images and AI results in outDir first so a re-run never mixes two runs. Throws
 * when the analyzed frames can't be placed in the raw upload.
 */
export async function extractAnalysisInputs(
  src: AnalysisInputSource,
  phases: PhaseFrame[],
  outDir: string,
): Promise<{ phaseStills: number; zooms: number; sequenceFrames: number; sequenceSkipped: string | null }> {
  fs.mkdirSync(outDir, { recursive: true });
  // Earlier images, and earlier AI results that cite them by file name (run history stays in analysis_runs).
  for (const f of fs.readdirSync(outDir)) if (/\.(png|jpe?g)$/i.test(f) || /^analysis_result_.*\.json$/.test(f)) fs.unlinkSync(path.join(outDir, f));
  const pts = await probePts(src.videoPath);
  const rawIndex = (frames: number[]): number[] => {
    const idx = rawFrameIndices(src.window, pts, frames);
    if (!idx) throw new Error(`analyzed frames ${frames.join(",")} fall outside ${src.videoPath} - wrong analysis window`);
    return idx;
  };

  let zooms = 0;
  for (const phase of phases) {
    const seek = seekBefore(pts, rawIndex([phase.frame])[0]!);
    await grabFrame(src.videoPath, seek, [], path.join(outDir, `phase_${phase.slug}.png`));
    const box = subjectBoxAt(src.poseFrames, src.batFrames, phase.frame, src.width, src.height);
    if (box) {
      await grabFrame(src.videoPath, seek, [cropScaleFilter(box, src)], path.join(outDir, `zoom_${phase.slug}.png`));
      zooms++;
    }
  }

  let sequenceFrames = 0;
  let sequenceSkipped: string | null = null;
  const load = phases.find((p) => p.slug === "load");
  const contact = phases.find((p) => p.slug === "contact");
  if (!load || !contact || contact.frame <= load.frame) {
    sequenceSkipped = "load and contact are not both located in order";
  } else {
    // Ends after the LAST located swing phase, not just contact: automatic
    // contact detection can fire early (seen on real side-on 30fps game clips,
    // where the swing itself was only in the "extension" frame), and a window
    // that stops at contact would then show no swing at all. Capped so a
    // mislocated late phase can't stretch the window far into the run to first.
    const last = Math.max(...phases.filter((p) => ["contact", "extension", "follow_through"].includes(p.slug)).map((p) => p.frame));
    const start = Math.max(0, load.frame - Math.round(SEQUENCE_LEAD_S * src.fps));
    const end = Math.min(src.nFrames - 1, last + Math.round(SEQUENCE_TAIL_S * src.fps), start + Math.round(SEQUENCE_MAX_S * src.fps));
    const box = subjectBoxOverFrames(src.poseFrames, src.batFrames, start, end, src.width, src.height, load.frame);
    const count = Math.min(SEQUENCE_MAX_FRAMES, end - start + 1);
    const frames = [...new Set(Array.from({ length: count }, (_, i) => start + Math.round((i * (end - start)) / Math.max(1, count - 1))))];
    const inBox = box ? frames.filter((f) => batterInBox(src.poseFrames, f, box)).length / frames.length : 0;
    if (!box) sequenceSkipped = "the batter isn't confidently tracked across the swing window";
    else if (inBox < SEQUENCE_MIN_IN_BOX) sequenceSkipped = `the tracked batter is inside the crop in only ${Math.round(inBox * 100)}% of the swing window`;
    else {
      const raw = rawIndex(frames);
      for (let i = 0; i < raw.length; i++) {
        await grabFrame(src.videoPath, seekBefore(pts, raw[i]!), [cropScaleFilter(box, src)], path.join(outDir, `swing_seq_${String(i + 1).padStart(2, "0")}.png`));
      }
      sequenceFrames = raw.length;
    }
  }
  return { phaseStills: phases.length, zooms, sequenceFrames, sequenceSkipped };
}

export async function extractFrames(opts: ExtractOptions): Promise<string> {
  if (!fs.existsSync(opts.video)) {
    throw new Error(`Video not found: ${opts.video}`);
  }
  const fps = Number(opts.fps);
  if (!Number.isFinite(fps) || fps <= 0) {
    throw new Error(`--fps must be a positive number, got: ${opts.fps}`);
  }

  const clipName = clipNameFrom(opts.video);
  const outDir = opts.outDir ?? path.join("frames", opts.player, clipName);
  fs.mkdirSync(outDir, { recursive: true });

  // Dense frame sequence - matches `ffmpeg -y -i $VideoPath -vf "fps=$Fps" "$outDir/frame_%03d.png"`
  await runFfmpeg(opts.video, ["-vf", `fps=${fps}`], path.join(outDir, "frame_%03d.png"));

  // Contact sheet: 5x4 grid of thumbnails spanning the whole clip - matches
  // `ffmpeg -y -i $VideoPath -vf "select='not(mod(n\,10))',scale=320:-1,tile=5x4" -frames:v 1 "$outDir/contact_sheet.png"`
  await runFfmpeg(
    opts.video,
    ["-vf", "select='not(mod(n\\,10))',scale=320:-1,tile=5x4", "-frames:v", "1"],
    path.join(outDir, "contact_sheet.png"),
  );

  return outDir;
}

async function main() {
  const program = new Command();
  program
    .requiredOption("--video <path>", "Path to the source video (mp4/mov) in videos/")
    .requiredOption("--player <slug>", "Player name/slug - output goes to frames/<slug>/<clipName>/")
    .option("--fps <n>", "Frames per second to extract (measured against the file's own timeline)", "10")
    .option("--outDir <path>", "Override the default frames/<player>/<clipName> output directory");

  program.parse(process.argv);
  const opts = program.opts<ExtractOptions>();

  try {
    const outDir = await extractFrames(opts);
    console.log(`Frames written to ${outDir}`);
    console.log(
      "Review contact_sheet.png first, then pull the specific frame_###.png files for: " +
        "stance, load, stride/plant, contact, extension, follow-through.",
    );
  } catch (err) {
    console.error(err instanceof Error ? err.message : err);
    process.exit(1);
  }
}

// Only run the CLI when this file is executed directly (not when imported,
// e.g. by tests). Compared via pathToFileURL rather than a manual
// `file://${...}` string concat - the manual version silently never matches
// on Windows (backslash paths, missing the extra leading slash Windows file
// URLs need), which made this whole CLI a silent no-op until caught here.
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main();
}
