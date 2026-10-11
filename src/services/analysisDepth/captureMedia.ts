import { spawn } from "node:child_process";
import type { CaptureMediaFacts, CaptureVisualSignals } from "./captureAssessment.js";

const SAMPLE_W = 96;
const SAMPLE_H = 54;
const FRAME_BYTES = SAMPLE_W * SAMPLE_H;

function run(command: string, args: string[], maxBytes: number): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, { windowsHide: true });
    const parts: Buffer[] = [];
    let size = 0;
    let stderr = "";
    child.stdout.on("data", (chunk: Buffer) => {
      size += chunk.length;
      if (size > maxBytes) child.kill();
      else parts.push(chunk);
    });
    child.stderr.on("data", (chunk: Buffer) => { stderr += chunk.toString().slice(0, 300); });
    child.on("error", reject);
    child.on("close", (code) => code === 0 && size <= maxBytes
      ? resolve(Buffer.concat(parts))
      : reject(new Error(`${command} failed (${code}): ${stderr.slice(-300)}`)));
  });
}

function rate(value: unknown): number | null {
  if (typeof value !== "string" && typeof value !== "number") return null;
  const [a, b] = String(value).split("/").map(Number);
  const n = b === undefined ? a : b > 0 ? a! / b : NaN;
  return Number.isFinite(n) && n! > 0 ? Math.round(n! * 1000) / 1000 : null;
}

export function parseCaptureProbe(input: unknown): CaptureMediaFacts {
  const data = input as { format?: { duration?: string }; streams?: Array<Record<string, unknown>> };
  const stream = data?.streams?.find((s) => s.codec_type === "video");
  const side = Array.isArray(stream?.side_data_list) ? stream.side_data_list as Array<Record<string, unknown>> : [];
  const rotationRaw = side.find((s) => s.rotation !== undefined)?.rotation
    ?? (stream?.tags as Record<string, unknown> | undefined)?.rotate;
  const rotationValue = rotationRaw === undefined ? 0 : Number(rotationRaw);
  const rotation = Number.isFinite(rotationValue) && rotationValue % 90 === 0
    ? ((rotationValue % 360) + 360) % 360 : null;
  const width = rate(stream?.width);
  const height = rate(stream?.height);
  const displayWidth = rotation === 90 || rotation === 270 ? height : width;
  const displayHeight = rotation === 90 || rotation === 270 ? width : height;
  const durationS = rate(data?.format?.duration ?? stream?.duration);
  const frames = rate(stream?.nb_read_frames);
  const actualFps = frames && durationS ? Math.round(frames / durationS * 1000) / 1000 : null;
  const orientation = !displayWidth || !displayHeight ? "unknown"
    : displayWidth > displayHeight ? "landscape" : displayWidth < displayHeight ? "portrait" : "square";
  return { width: displayWidth, height: displayHeight, rotationDegrees: rotation,
    orientation, reportedFps: rate(stream?.r_frame_rate) ?? rate(stream?.avg_frame_rate), actualFps, durationS };
}

export async function probeCaptureMedia(file: string): Promise<CaptureMediaFacts> {
  const output = await run("ffprobe", ["-v", "error", "-count_frames", "-select_streams", "v:0",
    "-print_format", "json", "-show_format", "-show_streams", file], 2_000_000);
  return parseCaptureProbe(JSON.parse(output.toString("utf8")));
}

function mean(frame: Uint8Array): number {
  let total = 0;
  for (const value of frame) total += value;
  return total / frame.length;
}

function blurVariance(frame: Uint8Array): number {
  let sum = 0, sum2 = 0, count = 0;
  for (let y = 1; y < SAMPLE_H - 1; y++) for (let x = 1; x < SAMPLE_W - 1; x++) {
    const i = y * SAMPLE_W + x;
    const laplace = 4 * frame[i]! - frame[i - 1]! - frame[i + 1]! - frame[i - SAMPLE_W]! - frame[i + SAMPLE_W]!;
    sum += laplace; sum2 += laplace * laplace; count++;
  }
  return sum2 / count - (sum / count) ** 2;
}

function cornerDifference(a: Uint8Array, b: Uint8Array): number {
  const corners = [[0, 0], [SAMPLE_W - 18, 0], [0, SAMPLE_H - 12], [SAMPLE_W - 18, SAMPLE_H - 12]];
  let large = 0;
  for (const [left, top] of corners) {
    let sum = 0;
    for (let y = top!; y < top! + 12; y++) for (let x = left!; x < left! + 18; x++) {
      const i = y * SAMPLE_W + x;
      sum += Math.abs(a[i]! - b[i]!);
    }
    if (sum / (18 * 12) > 60) large++;
  }
  return large;
}

/** Extreme sampled-pixel proxies only. They never certify a clear capture. */
export function analyzeVisualSamples(bytes: Uint8Array): CaptureVisualSignals {
  const count = Math.floor(bytes.length / FRAME_BYTES);
  if (count < 3) return { exposure: "unavailable", blur: "unavailable", cameraMotion: "unavailable" };
  const frames = Array.from({ length: count }, (_, i) => bytes.subarray(i * FRAME_BYTES, (i + 1) * FRAME_BYTES));
  const means = frames.map(mean);
  const dark = means.filter((v) => v < 30).length > count * 0.7;
  const bright = means.filter((v) => v > 225).length > count * 0.7;
  const severeSoftness = frames.filter((f, i) => means[i]! > 35 && means[i]! < 220 && blurVariance(f) < 8).length > count * 0.7;
  let movingPairs = 0;
  for (let i = 1; i < count; i++) if (Math.abs(means[i]! - means[i - 1]!) < 20
    && cornerDifference(frames[i - 1]!, frames[i]!) >= 3) movingPairs++;
  return {
    exposure: dark ? "possible_dark" : bright ? "possible_bright" : "unavailable",
    blur: severeSoftness ? "possible_issue" : "unavailable",
    cameraMotion: movingPairs >= 3 && movingPairs > (count - 1) * 0.6 ? "possible_issue" : "unavailable",
  };
}

export async function sampleCaptureVisuals(file: string): Promise<CaptureVisualSignals> {
  const bytes = await run("ffmpeg", ["-v", "error", "-nostdin", "-i", file,
    "-vf", `fps=1/5,scale=${SAMPLE_W}:${SAMPLE_H},format=gray`, "-frames:v", "36",
    "-f", "rawvideo", "pipe:1"], FRAME_BYTES * 36);
  return analyzeVisualSamples(bytes);
}
