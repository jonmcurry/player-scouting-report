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
