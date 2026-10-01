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
 * Also runs AI diagnosis automatically once a clip is ready: extracts the
 * located phase stills, batter-zoomed crops and a short batter-zoomed swing
 * sequence (extractAnalysisInputs, by the pipeline's own phase frames) and
 * hands them to analyze.ts's analyzeAndSync (Gemini today -
 * see geminiAnalyzer.ts for the current API-key status). Wrapped in its own
 * try/catch, separate from the pipeline/ingestion try/catch above - a
 * diagnosis failure must never undo an otherwise-successful clip or mark it
 * failed, since the pose3d/checklist/skeleton data is the core value and is
 * already saved by that point.
 *
 * Usage:
 *   npm run process-upload-queue
 *   (Ctrl-C to stop; polls every POLL_INTERVAL_MS, processes one clip at a
 *   time within this process - deliberate, not a limitation: pose3d
 *   inference (YOLO11-pose/VideoPose3D) is GPU/CPU-bound, so running N of
 *   these concurrently ON ONE MACHINE would just make them compete for the
 *   same GPU, not finish N times faster.
 *
 *   To scale throughput at real volume (hundreds/thousands of queued
 *   clips), run this SAME command on multiple separate machines/Cloud Run
 *   Job instances instead - already safe to do without any code change,
 *   since claimNextPendingClip() (src/services/db/uploadQueue.ts) claims
 *   work via an atomic conditional UPDATE that Postgres serializes for real,
 *   not a lock table or in-process coordination that only works within one
 *   process. It also reclaims a clip stuck in 'processing' past
 *   UPLOAD_QUEUE_STALE_CLAIM_MINUTES (default 15), so a crashed worker's
 *   in-flight clip doesn't get stuck forever - the one gap this used to be
 *   missing.)
 */
import { spawn } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { claimNextPendingClip, markClipFailed, markClipReady } from "../services/db/uploadQueue.js";
import { upsertPose3dFrames, deletePose3dFrames } from "../services/db/videoClipUpsert.js";
import { downloadFile } from "../services/storage/gcs.js";
import { smoothJoints, SMOOTHING_METHOD_LABEL, type Pose3dFrame } from "../services/pose3d/smoothJoints.js";
import { rigidifySkeleton, RIGID_METHOD_LABEL } from "../services/pose3d/rigidifySkeleton.js";
import { extractLongestTrackedRun, MIN_TRACKED_FRAMES } from "../services/pose3d/trackedFrames.js";
import { ingestPhases } from "./ingestPhases.js";
import { extractAnalysisInputs, type PhaseFrame } from "./extract.js";
import { analysisWindowForClipDir } from "../services/pose3d/analysisWindow.js";
import { analyzeAndSync } from "./analyze.js";

const POLL_INTERVAL_MS = 10_000;
const VENV_PYTHON = path.join(".venv_pose3d", "Scripts", "python.exe");
const PIPELINE_SCRIPT = path.join("scripts", "pose3d", "run_pipeline.py");

function runPipeline(videoPath: string, outDir: string): Promise<void> {
  return new Promise((resolve, reject) => {
    // Array args, NOT a shell string - real clip names contain spaces and
    // parentheses (e.g. "Emily_C_AB1 (4).mp4"), which a shell-interpreted
    // command would mis-tokenize; spawn() with an args array passes each
    // argument through verbatim regardless of its contents.
    //
    // PYTHONUNBUFFERED=1: without this, Python fully block-buffers stdout
    // whenever it isn't a TTY (i.e. always, when spawned as a child process
    // here) - every [locate_swing]/[detect_2d]/[metrics]/[overlay] print()
    // sits in Python's own internal buffer and never reaches the
    // stdout.on("data") forwarding below in practice, defeating the whole
    // point of forwarding it. This forces line-buffered (well, unbuffered)
    // output instead, confirmed by direct testing - without it, a real run
    // produced zero stage output in this worker's log despite completing.
    const startedAt = Date.now();
    const child = spawn(VENV_PYTHON, [PIPELINE_SCRIPT, videoPath, outDir], {
      env: { ...process.env, PYTHONUNBUFFERED: "1" },
    });
    let stderr = "";
    // Forward the pipeline's own [locate_swing]/[detect_2d]/[metrics]/
    // [overlay]-tagged progress prints live to this worker's console -
    // previously only stderr was captured (and only surfaced on failure),
    // so none of that stage-by-stage output was ever visible to anyone
    // tailing this process, success or failure.
    child.stdout.on("data", (chunk) => {
      process.stdout.write(chunk);
    });
    child.stderr.on("data", (chunk) => {
      stderr += chunk.toString();
    });
    child.on("error", (err) => reject(err));
    child.on("close", (code) => {
      // Trust run_pipeline.py's own pipeline_status.json over the raw exit
      // code - it's an explicit contract (see run_pipeline.py's write_status
      // docstring) rather than inference, added after some Windows/CUDA-
      // driver combinations were found to crash during the Python process's
      // OWN teardown AFTER the pipeline had already finished and written all
      // its real output (confirmed for real: a 27,647-frame clip completed
      // with a genuine contact detection, then exited 3221225794 /
      // 0xC0000142 STATUS_DLL_INIT_FAILED with empty stderr). Guessing that
      // from metrics.json's presence/content used to work but meant re-
      // deriving "did this really finish" logic for every new file the
      // pipeline happens to write; pipeline_status.json is the one file
      // written for exactly this purpose, last, atomically, in every
      // terminal path (success, low-quality-footage early return, and a
      // real in-pipeline exception all write it - see run_pipeline.py).
      //
      // "Retry" reuses the same outDir/clip_slug, so a status file could
      // already exist from an earlier attempt before this run even starts -
      // only trust one written DURING this run (mtime >= startedAt), never a
      // stale leftover that would otherwise look like a false completion.
      const statusPath = path.join(outDir, "pipeline_status.json");
      let status: { status?: string; detail?: unknown } | null = null;
      if (fs.existsSync(statusPath) && fs.statSync(statusPath).mtimeMs >= startedAt) {
        try {
          status = JSON.parse(fs.readFileSync(statusPath, "utf-8"));
        } catch {
          status = null; // read mid-write despite the atomic rename - status file take precedence gone, fall through
        }
      }

      if (status?.status === "complete") {
        if (code !== 0) {
          console.warn(
            `[process-upload-queue] pose3d pipeline exited with code ${code}, but its own ` +
              `pipeline_status.json says "complete" (${JSON.stringify(status.detail)}) - treating as a ` +
              `post-completion crash (e.g. a CUDA/driver teardown issue), not a real failure. Proceeding.`,
          );
        }
        resolve();
        return;
      }
      if (status?.status === "crashed") {
        reject(new Error(`pose3d pipeline reported a real failure: ${JSON.stringify(status.detail)}\nstderr:\n${stderr}`));
        return;
      }

      // No usable status file (e.g. the venv python itself failed to start,
      // before run_pipeline.py's own code ever ran) - fall back to the exit
      // code as a last resort rather than hang forever undecided.
      if (code === 0) {
        console.warn(
          `[process-upload-queue] pose3d pipeline exited 0 but wrote no pipeline_status.json - proceeding anyway.`,
        );
        resolve();
        return;
      }
      reject(new Error(`pose3d pipeline exited with code ${code} and wrote no pipeline_status.json:\n${stderr}`));
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
      phases?: Record<string, { frame: number | null; time_s: number | null }>;
      pipeline_version?: string;
    };
    const trackedFrames = extractLongestTrackedRun(pose3d.frames);
    if (trackedFrames.length < MIN_TRACKED_FRAMES) {
      console.log(
        `[process-upload-queue] Clip "${clip.clipSlug}": longest real tracked run is only ` +
          `${trackedFrames.length} frame(s) (need >= ${MIN_TRACKED_FRAMES}) - not enough real ` +
          `data for a skeleton comparison, skipping pose3d storage.`,
      );
      await deletePose3dFrames(clip.videoClipId);
    } else {
      const smoothedFrames = smoothJoints(trackedFrames);
      const rigidFrames = rigidifySkeleton(smoothedFrames);
      await upsertPose3dFrames({
        videoClipId: clip.videoClipId,
        jointNames: pose3d.meta.joint_names,
        smoothingMethod: `${SMOOTHING_METHOD_LABEL}+${RIGID_METHOD_LABEL}`,
        leadSide: metrics.lead_side_guess ?? null,
        frames: rigidFrames,
      });
    }

    await markClipReady(clip.videoClipId);
    console.log(`[process-upload-queue] Clip "${clip.clipSlug}" ready.`);

    // AI diagnosis (checklist draft + issues + comps + drills) - own try/
    // catch deliberately separate from the block above: this clip's pose3d/
    // checklist/skeleton data is the core value and is already saved and
    // marked ready by this point, so a diagnosis failure (e.g. an invalid
    // GEMINI_API_KEY - a real, current gap, see .env) must never undo that
    // or mark an otherwise-successful clip as failed. Runs automatically on
    // every upload per the coach's own request - "everything should run as
    // soon as a video is uploaded" - rather than needing a human to run
    // extract.ts + analyze.ts by hand afterward.
    try {
      const phaseEntries = Object.entries(metrics.phases ?? {})
        .filter((entry): entry is [string, { frame: number; time_s: number }] => typeof entry[1]?.frame === "number")
        .map(([slug, phase]): PhaseFrame => ({ slug, frame: phase.frame }));
      // Phase frames index into the window the pipeline analyzed, not the raw
      // upload (Stage 0 trims long uploads) - unknown alignment means the
      // stills would show the wrong moment, so skip rather than guess.
      const analysisWindow = analysisWindowForClipDir(outDir, localRawPath);
      if (phaseEntries.length === 0) {
        console.log(`[process-upload-queue] Clip "${clip.clipSlug}": no located swing phases, skipping AI diagnosis.`);
      } else if (analysisWindow === null) {
        console.log(`[process-upload-queue] Clip "${clip.clipSlug}": couldn't match the analyzed window to the upload, skipping AI diagnosis.`);
      } else {
        const stillsDir = path.join(outDir, "phase_stills");
        const pose2d = JSON.parse(fs.readFileSync(path.join(outDir, "pose_2d.json"), "utf-8"));
        const batPath = path.join(outDir, "bat_path.json");
        const inputs = await extractAnalysisInputs({
          videoPath: localRawPath, window: analysisWindow, fps: pose2d.meta.fps, nFrames: pose2d.meta.n_frames,
          width: pose2d.meta.width, height: pose2d.meta.height, poseFrames: pose2d.frames,
          batFrames: fs.existsSync(batPath) ? JSON.parse(fs.readFileSync(batPath, "utf-8")).frames ?? [] : [],
        }, phaseEntries, stillsDir);
        console.log(
          `[process-upload-queue] Extracted ${inputs.phaseStills} phase still(s), ${inputs.zooms} batter zoom(s), ` +
            `${inputs.sequenceFrames} swing-sequence frame(s) for AI diagnosis (window start ${analysisWindow.startS.toFixed(3)}s)` +
            (inputs.sequenceSkipped ? ` - no swing sequence: ${inputs.sequenceSkipped}` : ""),
        );
        const pitchContext = [clip.pitch, clip.result].filter(Boolean).join(" - ") || "No pitch/result details recorded for this at-bat.";
        // AI_ANALYZER selects the backend - defaults to Gemini (the intended
        // production path); set to "claude-cli" for local testing to use
        // claudeCliAnalyzer.ts instead, which needs no separate API key (see
        // that file's own docstring - reuses the machine's Claude
        // subscription login). Never the reverse default: a dev's local
        // subscription login isn't a real server-side credential, so
        // production must keep defaulting to Gemini even if this env var is
        // simply unset there.
        const useClaudeCli = process.env.AI_ANALYZER === "claude-cli";
        console.log(`[process-upload-queue] Running AI diagnosis for "${clip.clipSlug}" via ${useClaudeCli ? "claude CLI" : "Gemini"}`);
        await analyzeAndSync(
          clip.teamSlug, clip.playerSlug, stillsDir, pitchContext, false, null,
          useClaudeCli, clip.videoClipId, metrics.pipeline_version ?? null,
        );
      }
    } catch (diagErr) {
      const message = diagErr instanceof Error ? diagErr.message : String(diagErr);
      console.error(`[process-upload-queue] AI diagnosis for "${clip.clipSlug}" failed (clip itself is still ready): ${message}`);
    }
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.error(`[process-upload-queue] Clip "${clip.clipSlug}" failed: ${message}`);
    await markClipFailed(clip.videoClipId, message);
  } finally {
    // Only the raw downloaded copy, not outDir - GCS still has the
    // authoritative raw video (safe to re-download if ever needed), so this
    // local copy is pure redundant disk usage once processing finishes,
    // success OR failure. outDir's outputs stay: overlay.mp4 is what a
    // coach needs to watch to approve/reject the public skeleton render
    // (see NEXT_STEPS.md), and pose_3d.json/metrics.json let
    // ingest-phases/ingest-pose3d-frames re-run later without repeating the
    // expensive pipeline run. This used to only run on the success path -
    // a real, confirmed leak: every failed clip (a download error, a
    // pipeline crash, a bad ingest) left its full raw video sitting in
    // videos/_uploads/ forever, since the catch block jumped straight to
    // markClipFailed and never reached this cleanup. Real disk exhaustion
    // risk, worse than the success-path case this comment already reasoned
    // about, since failed clips can retry/reprocess repeatedly. Guarded
    // with existsSync since a failure before the download completes means
    // there's nothing to remove.
    if (fs.existsSync(localRawPath)) {
      try {
        fs.unlinkSync(localRawPath);
      } catch (cleanupErr) {
        console.error(
          `[process-upload-queue] Clip "${clip.clipSlug}": couldn't remove local raw copy ${localRawPath}: ${
            cleanupErr instanceof Error ? cleanupErr.message : cleanupErr
          }`,
        );
      }
    }
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
