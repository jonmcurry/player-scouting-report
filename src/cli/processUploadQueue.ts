#!/usr/bin/env node
/**
 * Long-running worker for the coach app's browser-upload flow: polls for
 * video_clips rows a coach has uploaded (status='pending'), and runs them
 * through the full pose3d pipeline + the existing ingestPhases step, then
 * smooths and stores the 3D joint trajectory, automatically - no per-clip
 * CLI command from a human.
 *
 * This has to be a real, standing process on a machine with the pose3d
 * pipeline's isolated `.venv_pose3d` environment (torch/YOLO11-pose/
 * VideoPose3D - see scripts/pose3d/README.md) - it cannot run inside a
 * browser, a Deno Edge Function, or any lightweight serverless environment.
 * "Automatic" means a coach never has to type a CLI command per clip; it
 * does not mean this can run anywhere the heavy pipeline can't.
 *
 * Reuses ingestPhases() UNCHANGED (built and verified earlier this
 * session) for phase timestamps. Video playback is no longer part of this
 * app (replaced by a 3D skeleton comparison, driven by pose_3d.json's real
 * joint data - see the approved plan) - this worker's job after the
 * pipeline runs is to smooth that joint trajectory once (see
 * src/services/pose3d/smoothJoints.ts, empirically tuned against real
 * data) and store it, not to transcode/upload a browser-playable video.
 *
 * Usage:
 *   npm run process-upload-queue
 *   (Ctrl-C to stop; polls every POLL_INTERVAL_MS, processes one clip at a
 *   time - simple by design, no parallel processing, no retry/backoff job
 *   queue, no crash-recovery lease/heartbeat. See the approved plan's "real
 *   open risks" section for what's deliberately deferred.)
 */
import { spawn } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { claimNextPendingClip, markClipFailed, markClipReady } from "../services/db/uploadQueue.js";
import { upsertPose3dFrames } from "../services/db/videoClipUpsert.js";
import { downloadFile } from "../services/storage/gcs.js";
import { smoothJoints, SMOOTHING_METHOD_LABEL, type Pose3dFrame } from "../services/pose3d/smoothJoints.js";
import { ingestPhases } from "./ingestPhases.js";

const POLL_INTERVAL_MS = 10_000;
const VENV_PYTHON = path.join(".venv_pose3d", "Scripts", "python.exe");
const PIPELINE_SCRIPT = path.join("scripts", "pose3d", "run_pipeline.py");

function runPipeline(videoPath: string, outDir: string): Promise<void> {
  return new Promise((resolve, reject) => {
    // Array args, NOT a shell string - real clip names contain spaces and
    // parentheses (e.g. "Emily_C_AB1 (4).mp4"), which a shell-interpreted
    // command would mis-tokenize; spawn() with an args array passes each
    // argument through verbatim regardless of its contents.
    const child = spawn(VENV_PYTHON, [PIPELINE_SCRIPT, videoPath, outDir]);
    let stderr = "";
    child.stderr.on("data", (chunk) => {
      stderr += chunk.toString();
    });
    child.on("error", (err) => reject(err));
    child.on("close", (code) => {
      if (code === 0) resolve();
      else reject(new Error(`pose3d pipeline exited with code ${code}:\n${stderr}`));
    });
  });
}

export async function processOnePendingClip(): Promise<boolean> {
  const clip = await claimNextPendingClip();
  if (!clip) return false;

  console.log(`[process-upload-queue] Claimed clip "${clip.clipSlug}" (${clip.teamSlug}/${clip.playerSlug})`);
  const ext = path.extname(clip.rawGcsPath) || ".mp4";
  const localRawPath = path.join("videos", "_uploads", `${clip.clipSlug}${ext}`);
  const outDir = path.join("frames", clip.playerSlug, clip.clipSlug);

  try {
    console.log(`[process-upload-queue] Downloading ${clip.rawGcsPath} -> ${localRawPath}`);
    await downloadFile(clip.rawGcsPath, localRawPath);

    console.log(`[process-upload-queue] Running pose3d pipeline -> ${outDir}`);
    fs.mkdirSync(outDir, { recursive: true });
    await runPipeline(localRawPath, outDir);

    console.log("[process-upload-queue] Ingesting phases");
    await ingestPhases(clip.teamSlug, clip.playerSlug, clip.date, clip.opponent, clip.ab, outDir);

    console.log("[process-upload-queue] Smoothing + storing 3D joint trajectory");
    const pose3d = JSON.parse(fs.readFileSync(path.join(outDir, "pose_3d.json"), "utf-8")) as {
      meta: { joint_names: string[] };
      frames: Pose3dFrame[];
    };
    // metrics.json's lead_side_guess is the pipeline's own real "which leg is
    // the front leg" answer (a 2D-pixel heuristic - see metrics.py's
    // front_side_at()) - reused as-is here rather than re-derived from 3D
    // joint angles, since a 3D-only "larger knee angle = front leg" guess was
    // tried while building the skeleton comparison view and disagreed with
    // this real value on a real clip.
    const metrics = JSON.parse(fs.readFileSync(path.join(outDir, "metrics.json"), "utf-8")) as {
      lead_side_guess?: "l" | "r" | null;
    };
    const smoothedFrames = smoothJoints(pose3d.frames);
    await upsertPose3dFrames({
      videoClipId: clip.videoClipId,
      jointNames: pose3d.meta.joint_names,
      smoothingMethod: SMOOTHING_METHOD_LABEL,
      leadSide: metrics.lead_side_guess ?? null,
      frames: smoothedFrames,
    });

    await markClipReady(clip.videoClipId);
    console.log(`[process-upload-queue] Clip "${clip.clipSlug}" ready.`);
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.error(`[process-upload-queue] Clip "${clip.clipSlug}" failed: ${message}`);
    await markClipFailed(clip.videoClipId, message);
  }
  return true;
}

async function main() {
  console.log(`[process-upload-queue] Polling every ${POLL_INTERVAL_MS / 1000}s. Ctrl-C to stop.`);
  for (;;) {
    let didWork = false;
    try {
      didWork = await processOnePendingClip();
    } catch (err) {
      // A failure to even CLAIM a clip (e.g. a transient DB error) - log
      // and keep the loop alive rather than crashing the whole worker.
      console.error("[process-upload-queue] Poll error:", err instanceof Error ? err.message : err);
    }
    if (!didWork) {
      await new Promise((resolve) => setTimeout(resolve, POLL_INTERVAL_MS));
    }
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main();
}
