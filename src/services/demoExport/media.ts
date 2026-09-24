/**
 * Browser-compatible demo media for curated clips: H.264 (yuv420p, High
 * profile) in a faststart .mp4, short side capped at 720px, fps capped at
 * 60, audio dropped unless a clip explicitly opts in (then AAC). All
 * container/stream metadata is stripped - phone footage routinely carries
 * GPS location and device tags. Originals are only ever read, never
 * modified; outputs go to a new file under the export directory.
 */
import { spawn } from "node:child_process";
import { createHash } from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import type { TrimBounds } from "./curationManifest.js";
import type { ClipContext } from "./buildFixture.js";

export const MAX_MEDIA_SECONDS = 30;
export const MAX_SHORT_SIDE = 720;

export interface ProbeResult {
  durationS: number;
  width: number;
  height: number;
  videoCodec: string | null;
  pixFmt: string | null;
  audioCodec: string | null;
  tags: Record<string, string>;
}

function run(cmd: string, args: string[]): Promise<{ stdout: string; stderr: string }> {
  return new Promise((resolve, reject) => {
    // Array args, never a shell string - real clip names contain spaces/parens.
    const child = spawn(cmd, args, { windowsHide: true });
    let stdout = "", stderr = "";
    child.stdout.on("data", (c) => (stdout += c));
    child.stderr.on("data", (c) => (stderr += c));
    child.on("error", reject);
    child.on("close", (code) => (code === 0 ? resolve({ stdout, stderr }) : reject(new Error(`${cmd} exited ${code}: ${stderr.trim().slice(-600)}`))));
  });
}

export async function ffmpegAvailable(): Promise<boolean> {
  try {
    await run("ffmpeg", ["-hide_banner", "-version"]);
    await run("ffprobe", ["-hide_banner", "-version"]);
    return true;
  } catch {
    return false;
  }
}

export async function probe(file: string): Promise<ProbeResult> {
  const { stdout } = await run("ffprobe", ["-v", "error", "-print_format", "json", "-show_format", "-show_streams", file]);
  const j = JSON.parse(stdout) as { format?: { duration?: string; tags?: Record<string, string> }; streams?: Array<Record<string, unknown>> };
  const v = j.streams?.find((x) => x.codec_type === "video");
  const a = j.streams?.find((x) => x.codec_type === "audio");
  // Rotation side data means the displayed frame is transposed.
  const rot = Math.abs(Number(((v?.side_data_list as Array<Record<string, unknown>> | undefined) ?? []).find((d) => d.rotation !== undefined)?.rotation ?? 0));
  const [w, h] = [Number(v?.width ?? 0), Number(v?.height ?? 0)];
  const tags: Record<string, string> = { ...(j.format?.tags ?? {}) };
  for (const st of j.streams ?? []) Object.assign(tags, (st.tags as Record<string, string> | undefined) ?? {});
  return {
    durationS: Number(j.format?.duration ?? 0),
    width: rot === 90 || rot === 270 ? h : w,
    height: rot === 90 || rot === 270 ? w : h,
    videoCodec: (v?.codec_name as string | undefined) ?? null,
    pixFmt: (v?.pix_fmt as string | undefined) ?? null,
    audioCodec: (a?.codec_name as string | undefined) ?? null,
    tags,
  };
}

export async function sha256File(file: string): Promise<string> {
  const hash = createHash("sha256");
  await new Promise<void>((resolve, reject) => {
    fs.createReadStream(file).on("data", (c) => hash.update(c)).on("error", reject).on("end", () => resolve());
  });
  return hash.digest("hex");
}

const fmt = (n: number) => n.toFixed(3);

/** The exact, reproducible ffmpeg invocation (pure - unit-tested). */
export function buildFfmpegArgs(input: { src: string; out: string; trim: TrimBounds | "full"; includeAudio: boolean }): string[] {
  const scale = `scale='if(gt(iw,ih),-2,min(${MAX_SHORT_SIDE},iw))':'if(gt(iw,ih),min(${MAX_SHORT_SIDE},ih),-2)':flags=lanczos:out_range=tv,format=yuv420p`;
  // Phone HEVC is often full-range (yuvj420p); out_range=tv converts it to the
  // limited-range yuv420p every browser decodes correctly (caught by the
  // output probe on Emily's real footage).
  return [
    "-hide_banner", "-nostdin", "-loglevel", "error", "-y",
    ...(input.trim === "full" ? [] : ["-ss", fmt(input.trim.startS), "-to", fmt(input.trim.endS)]),
    "-i", input.src,
    "-map", "0:v:0", ...(input.includeAudio ? ["-map", "0:a:0?"] : []),
    "-vf", scale, "-fpsmax", "60",
    "-c:v", "libx264", "-preset", "medium", "-crf", "23", "-profile:v", "high", "-pix_fmt", "yuv420p", "-color_range", "tv", "-threads", "4",
    ...(input.includeAudio ? ["-c:a", "aac", "-b:a", "128k", "-ac", "2"] : ["-an"]),
    "-sn", "-dn", "-map_metadata", "-1", "-map_chapters", "-1",
    "-fflags", "+bitexact", "-flags:v", "+bitexact", "-flags:a", "+bitexact",
    "-movflags", "+faststart",
    input.out,
  ];
}

const PRIVATE_TAG = /location|gps|iso6709|make|model|software|creation_time|encoder|com\.apple|com\.android|author|comment|title/i;

export interface TranscodeResult {
  publicFilename: string;
  sha256: string;
  bytes: number;
  durationS: number;
  width: number;
  height: number;
  videoCodec: string;
  audioCodec: string | null;
  problems: string[];
}

export async function transcodeClip(input: {
  src: string; outDir: string; publicFilename: string; trim: TrimBounds | "full"; includeAudio: boolean;
}): Promise<TranscodeResult> {
  const out = path.join(input.outDir, input.publicFilename);
  fs.mkdirSync(input.outDir, { recursive: true });
  if (path.resolve(out) === path.resolve(input.src)) throw new Error("refusing to overwrite the source video");
  await run("ffmpeg", buildFfmpegArgs({ src: input.src, out, trim: input.trim, includeAudio: input.includeAudio }));
  const p = await probe(out);
  const problems: string[] = [];
  if (p.videoCodec !== "h264") problems.push(`video codec is ${p.videoCodec}, expected h264`);
  if (p.pixFmt !== "yuv420p") problems.push(`pixel format is ${p.pixFmt}, expected yuv420p`);
  if (Math.min(p.width, p.height) > MAX_SHORT_SIDE) problems.push(`short side ${Math.min(p.width, p.height)}px exceeds ${MAX_SHORT_SIDE}px`);
  if (!input.includeAudio && p.audioCodec) problems.push("audio present although the clip did not opt in");
  if (input.includeAudio && p.audioCodec && p.audioCodec !== "aac") problems.push(`audio codec is ${p.audioCodec}, expected aac`);
  if (input.trim !== "full") {
    const want = input.trim.endS - input.trim.startS;
    if (Math.abs(p.durationS - want) > 0.5) problems.push(`duration ${p.durationS.toFixed(2)}s differs from the requested ${want.toFixed(2)}s window`);
  }
  const leaked = Object.keys(p.tags).filter((k) =>
    PRIVATE_TAG.test(k)
    // ffmpeg's own version-stripped (+bitexact) identifier, e.g. "Lavc libx264" - not device metadata.
    && !(k === "encoder" && /^Lav[cf]( [a-z0-9_]+)?$/.test(p.tags[k] ?? "")));
  if (leaked.length) problems.push(`output still carries metadata tag(s): ${leaked.join(", ")}`);
  const stat = fs.statSync(out);
  return {
    publicFilename: input.publicFilename, sha256: await sha256File(out), bytes: stat.size, durationS: p.durationS,
    width: p.width, height: p.height, videoCodec: p.videoCodec ?? "", audioCodec: p.audioCodec, problems,
  };
}

/**
 * Where analysis time 0 sits in the source video, from the pipeline's own
 * frames/<player>/<clip>/stage0.json. Only the numeric trim fields are read -
 * that file also records local paths, which never leave this function.
 */
export function readStage0Context(framesRoot: string, playerSlug: string, clipSlug: string): ClipContext | null {
  const file = path.join(framesRoot, playerSlug, clipSlug, "stage0.json");
  if (!fs.existsSync(file)) return null;
  try {
    const j = JSON.parse(fs.readFileSync(file, "utf-8")) as { trimmed?: boolean; trim_start_s?: number | null; candidate_windows?: unknown[] | null };
    if (j.trimmed === false) return { analysisWindowStartS: 0 };
    const ambiguous = Array.isArray(j.candidate_windows) && j.candidate_windows.length > 1;
    return { analysisWindowStartS: typeof j.trim_start_s === "number" ? j.trim_start_s : null, analysisWindowAmbiguous: ambiguous };
  } catch {
    return null;
  }
}
