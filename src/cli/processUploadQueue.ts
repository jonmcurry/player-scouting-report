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
import { claimNextPendingClip, heartbeatClaim, markClipAnalysisFinished, markClipFailed, markClipPermanentlyFailed, markClipProgress, markClipReady } from "../services/db/uploadQueue.js";
import { upsertPose3dFrames, deletePose3dFrames } from "../services/db/videoClipUpsert.js";
import { downloadFile, deleteObjectIfExists } from "../services/storage/gcs.js";
import { smoothJoints, SMOOTHING_METHOD_LABEL, type Pose3dFrame } from "../services/pose3d/smoothJoints.js";
import { rigidifySkeleton, RIGID_METHOD_LABEL } from "../services/pose3d/rigidifySkeleton.js";
import { extractLongestTrackedRun, MIN_TRACKED_FRAMES } from "../services/pose3d/trackedFrames.js";
import { ingestPhases } from "./ingestPhases.js";
import { extractAnalysisInputs, type PhaseFrame } from "./extract.js";
import { analysisWindowForClipDir } from "../services/pose3d/analysisWindow.js";
import { analyzeAndSync } from "./analyze.js";
import { purgeDeletedClips, supabasePurgeDb, retryUnfinishedDeletions, supabaseRetryDb } from "./purgeDeletedClips.js";
import { getSupabaseClient } from "../services/db/supabaseClient.js";
import { swingDetectionState } from "../services/development/swingDetection.js";
import { uploadDurationRejection } from "../services/development/uploadLimits.js";
import { probe, sha256File } from "../services/demoExport/media.js";
import { probeCaptureMedia, sampleCaptureVisuals } from "../services/analysisDepth/captureMedia.js";
import type { CaptureAssessment, CaptureMediaFacts, CaptureVisualSignals } from "../services/analysisDepth/captureAssessment.js";
import { persistCaptureAssessment } from "../services/db/captureAssessmentStore.js";
import { recordAttemptSnapshot } from "../services/db/attemptSnapshot.js";
import { enqueueAnalysisFailed } from "../services/notifications/outbox.js";
import { prepareEvidenceShadow } from "./evidenceShadow.js";
import { qualifyV2Findings, v2CoachingEligibility } from "../services/engine/v2Coaching.js";
import { buildV2EvidencePackage, renderV2Addendum, v2PhaseFrames } from "../services/ai/v2EvidencePackage.js";
import type { ClipContext } from "../services/db/uploadQueue.js";
import { experimentalEvents, experimentalResult, storedExperimentalResult, upsertExperimentalV2Result } from "../services/db/experimentalV2Results.js";
import type { ExperimentalV2Row } from "../services/development/experimentalV2Report.js";
import type { V2Qualification } from "../services/engine/v2Coaching.js";

import { selectEngine, BASELINE_PROGRESS, assertEngineArtifacts, hasRotationMismatch, REQUIRED_V2_ARTIFACTS, workerTiming } from "../services/engine/engineSelection.js";
import { superviseProcess } from "../services/engine/processLifetime.js";
import { ClaimLostError, startClaimHeartbeat } from "../services/engine/claimHeartbeat.js";

const ENGINE = selectEngine();
const TIMING = workerTiming();
const POLL_INTERVAL_MS = 10_000;
export function pipelineProgressFromOutput(output: string): number[] {
  return [...BASELINE_PROGRESS]
    .filter(([label]) => output.includes(label))
    .map(([, progress]) => progress);
}

function runPipeline(videoPath: string, outDir: string, onProgress: (progress: number) => Promise<void>, signal: AbortSignal): Promise<void> {
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
    const child = spawn(ENGINE.python, [ENGINE.script, videoPath, outDir], {
      env: { ...process.env, PYTHONUNBUFFERED: "1", ...(ENGINE.name === "v2-exp" ? { PYTHONDONTWRITEBYTECODE: "1", YOLO_OFFLINE: "1" } : {}) },
      detached: process.platform !== "win32", windowsHide: true,
    });
    const supervision = superviseProcess(child, TIMING.timeoutMs, signal, reject);
    const progressFromOutput = (output: string) => ENGINE.progress.filter(([label]) => output.includes(label)).map(([, progress]) => progress);
    let stderr = "";
    let progressOutputBuffer = "";
    // Forward the pipeline's own [locate_swing]/[detect_2d]/[metrics]/
    // [overlay]-tagged progress prints live to this worker's console -
    // previously only stderr was captured (and only surfaced on failure),
    // so none of that stage-by-stage output was ever visible to anyone
    // tailing this process, success or failure.
    child.stdout.on("data", (chunk) => {
      if (supervision.stopped) return;
      const output = chunk.toString();
      process.stdout.write(output);
      progressOutputBuffer += output;
      const lines = progressOutputBuffer.split(/\r?\n/);
      progressOutputBuffer = lines.pop() ?? "";
      for (const progress of progressFromOutput(lines.join("\n"))) {
        void onProgress(progress).catch((error) => {
          console.warn(`[process-upload-queue] Couldn't store ${progress}% progress: ${error instanceof Error ? error.message : error}`);
        });
      }
    });
    child.stderr.on("data", (chunk) => {
      stderr += chunk.toString();
    });
    child.on("error", (err) => { supervision.dispose(); reject(err); });
    child.on("close", (code) => {
      supervision.dispose();
      if (supervision.stopped) return;
      if (signal.aborted) { reject(new Error("Claim lost")); return; }
      for (const progress of progressFromOutput(progressOutputBuffer)) {
        void onProgress(progress).catch((error) => {
          console.warn(`[process-upload-queue] Couldn't store ${progress}% progress: ${error instanceof Error ? error.message : error}`);
        });
      }
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

      if (ENGINE.name === "v2-exp") {
        if (status?.status === "complete" || status?.status === "analysis_unavailable") resolve();
        else reject(new Error(`Experimental pipeline failed: ${JSON.stringify(status?.detail ?? "missing status")}`));
        return;
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

/** Extraction seeks a quarter frame early, so a container start within 1 ms of zero still lands on the
 * labelled frame up to 240 fps. Anything else, including an unreadable (NaN) start, fails closed. */
export const startOffsetSupported = (startS: number): boolean => Math.abs(startS) <= 0.001;

/** The container's start time in seconds (ffprobe format=start_time); NaN when it can't be read. */
export function containerStartS(file: string): Promise<number> {
  return new Promise((resolve) => {
    let out = "";
    const child = spawn("ffprobe", ["-v", "error", "-show_entries", "format=start_time", "-of", "csv=p=0", file]);
    // A hung probe must not stall the worker: treat it as unreadable.
    const timer = setTimeout(() => { child.kill(); resolve(Number.NaN); }, 30_000);
    child.stdout.on("data", (d) => (out += d.toString()));
    child.on("error", () => { clearTimeout(timer); resolve(Number.NaN); });
    child.on("close", (code) => { clearTimeout(timer); resolve(code === 0 && out.trim() !== "" ? Number(out.trim()) : Number.NaN); });
  });
}

function readJsonIfPresent(file: string): unknown {
  return fs.existsSync(file) ? JSON.parse(fs.readFileSync(file, "utf-8")) : null;
}

/** Development-only v2 coaching (M4): exact-frame stills for supported events only, an ordered labelled
 * package, the evidence addendum, and pre-storage qualification. Throws to the caller's diagnosis catch. */
async function runV2Coaching(args: { clip: ClipContext; outDir: string; localRawPath: string; sourceSha256: string | null;
  metrics: { pipeline_version?: string }; provider: "agy" | "claude"; base: ExperimentalV2Row }): Promise<void> {
  const { clip, outDir } = args;
  const skipped = (code: string) => upsertExperimentalV2Result({ ...args.base, outcome: "not_assessable", reason_codes: [code] });
  const read = (name: string) => JSON.parse(fs.readFileSync(path.join(outDir, name), "utf-8"));
  const metrics = read("metrics.json"), pose2d = read("pose_2d.json"), batPath = read("bat_path.json");
  // v2 decodes the upload directly: analysed frames must be source frames one-to-one.
  // extractAnalysisInputs seeks with ffmpeg -ss, which is offset by the container start time while
  // the frame timestamps are absolute. On a file that does not start at 0 every still would show a
  // later moment than its label (measured: +45 frames on a 1.5 s-offset synthetic file), so fail closed.
  if (!startOffsetSupported(await containerStartS(args.localRawPath))) {
    console.log("[process-upload-queue] Experimental v2 upload does not start at 0 s; skipping AI diagnosis.");
    await skipped("SOURCE_START_OFFSET_UNSUPPORTED");
    return;
  }
  const window = analysisWindowForClipDir(outDir, args.localRawPath);
  if (!window || window.startS !== 0 || window.frameStep !== 1) {
    // Same as baseline: an unplaceable window is a skipped diagnosis, not a failed clip.
    console.log("[process-upload-queue] Experimental v2 frames don't map one-to-one onto the upload; skipping AI diagnosis.");
    await skipped("FRAME_MAPPING_UNAVAILABLE");
    return;
  }
  const stillsDir = path.join(outDir, "phase_stills");
  const inputs = await extractAnalysisInputs({
    videoPath: args.localRawPath, window, fps: pose2d.meta.fps, nFrames: pose2d.meta.n_frames,
    width: pose2d.meta.width, height: pose2d.meta.height, poseFrames: pose2d.frames, batFrames: batPath.frames ?? [],
  }, v2PhaseFrames(metrics), stillsDir);
  const built = await buildV2EvidencePackage({ videoClipId: clip.videoClipId, sourceSha256: args.sourceSha256 ?? "",
    imagesDir: stillsDir, images: inputs.images, metrics, frameMap: read("frame_map.json"), batPath, pose2d, tracks: read("tracks.json") });
  if (!built.ok) {
    console.log(`[process-upload-queue] Experimental v2 evidence unavailable (${built.error}); skipping AI diagnosis.`);
    await skipped("EVIDENCE_PACKAGE_UNAVAILABLE"); return;
  }
  const pkg = built.pkg;
  // The CLI analyzers read every image in the directory: only package images may remain, byte-identical.
  for (const { name } of pkg.excludedImages) fs.rmSync(path.join(stillsDir, name), { force: true });
  const present = fs.readdirSync(stillsDir).filter(f => /\.(png|jpe?g)$/i.test(f)).sort();
  if (present.join("\n") !== pkg.images.map(i => i.name).sort().join("\n")) throw new Error("V2_PACKAGE_DIRECTORY_MISMATCH");
  for (const image of pkg.images) {
    if (await sha256File(path.join(stillsDir, image.name)) !== image.sha256) throw new Error("V2_PACKAGE_DIRECTORY_MISMATCH");
  }
  fs.writeFileSync(path.join(outDir, "evidence_package_v2.json"), JSON.stringify({ digest: built.digest, package: pkg }, null, 2));
  if (pkg.supportedEvents.length === 0) {
    console.log("[process-upload-queue] No citable v2 event has a still; skipping AI diagnosis.");
    await skipped("NO_SUPPORTED_EVENT_STILL"); return;
  }
  const addendum = renderV2Addendum(pkg);
  const pitchContext = [clip.pitch, clip.result].filter(Boolean).join(" - ") || "No pitch/result details recorded for this at-bat.";
  let qualification: V2Qualification | null = null;
  await analyzeAndSync(clip.teamSlug, clip.playerSlug, stillsDir, pitchContext, false, null, args.provider, clip.videoClipId,
    args.metrics.pipeline_version ?? null, [], null, {
      supportedEvents: pkg.supportedEvents, addendum: addendum.text,
      qualify: (result) => qualifyV2Findings(result, pkg),
      record: async (q) => {
        qualification = q;
        fs.writeFileSync(path.join(outDir, "coaching_qualification.json"),
          JSON.stringify({ package_digest: built.digest, render: addendum.version, ...q }, null, 2));
        if (q.withheld) await upsertExperimentalV2Result({ ...args.base, outcome: "withheld",
          reason_codes: [...new Set(["SUMMARY_UNSUPPORTED_CLAIM", ...q.decisions.filter(d => d.kind === "summary").flatMap(d => d.reasons)])] });
      },
      stored: async ({ result, analysisRunId, issueIds }) => {
        if (!qualification) throw new Error("Missing experimental qualification");
        await upsertExperimentalV2Result(storedExperimentalResult(args.base, qualification, result, analysisRunId, issueIds));
      },
    });
}

export async function processOnePendingClip(): Promise<boolean> {
  const clip = await claimNextPendingClip();
  if (!clip) return false;
  const claim = startClaimHeartbeat(clip.claimedAt, TIMING.heartbeatMs,
    expected => heartbeatClaim(clip.videoClipId, expected),
    error => console.warn("[process-upload-queue] Heartbeat failed; retrying next tick:", error));

  console.log(`[process-upload-queue] Claimed clip "${clip.clipSlug}" (${clip.teamSlug}/${clip.playerSlug})`);
  const ext = path.extname(clip.rawGcsPath) || ".mp4";
  const localRawPath = path.join("videos", "_uploads", `${clip.clipSlug}${ext}`);
  const outDir = ENGINE.outDir(clip.playerSlug, clip.clipSlug);
  const queueFailureNotification = async () => {
    try {
      await enqueueAnalysisFailed(getSupabaseClient(), clip.playerId, clip.videoClipId);
    } catch (notificationError) {
      console.error(`[process-upload-queue] Clip "${clip.clipSlug}": failure notification could not be queued: ${notificationError instanceof Error ? notificationError.message : notificationError}`);
    }
  };

  try {
    if (ENGINE.name === "v2-exp") await claim.write(() => upsertExperimentalV2Result(experimentalResult(clip.videoClipId)));
    console.log(`[process-upload-queue] Downloading ${clip.rawGcsPath} -> ${localRawPath}`);
    await downloadFile(clip.rawGcsPath, localRawPath);

    // Keep the established duration check independent of the new, deeper
    // capture probe. A capture-only decode failure must not reject a clip.
    const durationProbe = await probe(localRawPath);
    const durationRejection = uploadDurationRejection(durationProbe.durationS);
    if (durationRejection) {
      console.error(`[process-upload-queue] Clip "${clip.clipSlug}" rejected: ${durationRejection}`);
      // Deterministic: recorded as not assessable so it is never offered for retry.
      if (ENGINE.name === "v2-exp") await claim.write(() => upsertExperimentalV2Result(experimentalResult(clip.videoClipId, {
        outcome: "not_assessable", reason_codes: ["UPLOAD_DURATION_UNSUPPORTED"] })));
      await claim.finish(() => markClipPermanentlyFailed(clip.videoClipId, durationRejection));
      await queueFailureNotification();
      return true;
    }
    await claim.write(() => markClipProgress(clip.videoClipId, 15));
    // Capture assessment is additive. Missing migration, unavailable ffmpeg
    // signals, or a failed check never discards a valid family upload.
    let captureHash: string | null = null;
    let visualSignals: CaptureVisualSignals | null = null;
    let media: CaptureMediaFacts | null = null;
    try {
      media = await probeCaptureMedia(localRawPath);
      captureHash = await sha256File(localRawPath);
      visualSignals = await sampleCaptureVisuals(localRawPath).catch(() => null);
      const capturedMedia = media;
      const sourceHash = captureHash;
      await claim.write(() => persistCaptureAssessment({ clipId: clip.videoClipId, sourceHash,
        media: capturedMedia, visual: visualSignals }));
    } catch (captureError) {
      if (captureError instanceof ClaimLostError) throw captureError;
      console.warn(`[process-upload-queue] Capture media assessment unavailable: ${captureError instanceof Error ? captureError.message : captureError}`);
    }
    await claim.write(() => markClipProgress(clip.videoClipId, 25));
    console.log(`[process-upload-queue] Running pose3d pipeline -> ${outDir}`);
    fs.mkdirSync(outDir, { recursive: true });
    // Shadow evidence reads only artifacts written during THIS attempt (retries reuse outDir).
    const pipelineStartedAt = Date.now();
    await runPipeline(localRawPath, outDir, progress => claim.write(() => markClipProgress(clip.videoClipId, progress)), claim.signal);
    claim.check();
    if (ENGINE.name === "v2-exp") {
      const artifacts = Object.fromEntries(REQUIRED_V2_ARTIFACTS.map(name =>
        [name, JSON.parse(fs.readFileSync(path.join(outDir, name), "utf-8"))]));
      assertEngineArtifacts(artifacts);
      if (artifacts["pipeline_status.json"].status === "analysis_unavailable") {
        await claim.write(() => upsertExperimentalV2Result(experimentalResult(clip.videoClipId, {
          outcome: "not_assessable", reason_codes: artifacts["pipeline_status.json"].detail?.reason_codes ?? [],
        })));
        await claim.write(() => deletePose3dFrames(clip.videoClipId));
        await claim.finish(() => markClipPermanentlyFailed(clip.videoClipId,
          `Experimental engine analysis unavailable: ${JSON.stringify(artifacts["pipeline_status.json"].detail)}`));
        await queueFailureNotification();
        return true;
      }
      // Only a result that will be ingested needs the independent ffprobe orientation check;
      // an unavailable result keeps its own, more specific reason.
      if (hasRotationMismatch(artifacts["frame_map.json"].rotation, media)) {
        await claim.write(() => upsertExperimentalV2Result(experimentalResult(clip.videoClipId, {
          outcome: "not_assessable", reason_codes: ["ROTATION_MISMATCH"],
        })));
        await claim.write(() => deletePose3dFrames(clip.videoClipId));
        await claim.finish(() => markClipPermanentlyFailed(clip.videoClipId,
          "Experimental engine analysis unavailable: ROTATION_MISMATCH"));
        await queueFailureNotification();
        return true;
      }
    }
    await claim.write(() => markClipProgress(clip.videoClipId, 90));

    console.log("[process-upload-queue] Ingesting phases");
    await claim.write(() => ingestPhases(clip.teamSlug, clip.playerSlug, clip.date, clip.opponent, clip.ab, outDir, 0, ENGINE.name === "v2-exp" ? clip.videoClipId : undefined));
    await claim.write(() => markClipProgress(clip.videoClipId, 94));

    console.log("[process-upload-queue] Smoothing + storing 3D joint trajectory");
    const pose3d = ENGINE.requiresPose3d ? JSON.parse(fs.readFileSync(path.join(outDir, "pose_3d.json"), "utf-8")) as {
      meta: { joint_names: string[] };
      frames: Pose3dFrame[];
    } : { meta: { joint_names: [] }, frames: [] };
    // metrics.json's lead_side_guess is the pipeline's own real "which leg is
    // the front leg" answer (a 2D-pixel heuristic - see metrics.py's
    // front_side_at()) - reused as-is here rather than re-derived from 3D
    // joint angles, since a 3D-only "larger knee angle = front leg" guess was
    // tried while building the skeleton comparison view and disagreed with
    // this real value on a real clip.
    const metrics = JSON.parse(fs.readFileSync(path.join(outDir, "metrics.json"), "utf-8")) as {
      lead_side_guess?: "l" | "r" | null;
      phases?: Record<string, { frame: number | null; time_s: number | null }>;
      swing_detection?: { status?: string | null; confidence?: string | null } | null;
      pipeline_version?: string;
      detector_version?: string;
    };
    let fullCapture: CaptureAssessment | null = null;
    if (captureHash && media) {
      try {
        const pose2d = JSON.parse(fs.readFileSync(path.join(outDir, "pose_2d.json"), "utf-8"));
        const batFile = path.join(outDir, "bat_path.json");
        const batFrames = fs.existsSync(batFile) ? JSON.parse(fs.readFileSync(batFile, "utf-8")).frames ?? [] : [];
        fullCapture = await claim.write(() => persistCaptureAssessment({ clipId: clip.videoClipId, sourceHash: captureHash,
          media, visual: visualSignals, pose2d, batFrames, phases: metrics.phases }));
      } catch (captureError) {
        if (captureError instanceof ClaimLostError) throw captureError;
        console.warn(`[process-upload-queue] Capture phase assessment unavailable: ${captureError instanceof Error ? captureError.message : captureError}`);
      }
    }
    const trackedFrames = extractLongestTrackedRun(pose3d.frames);
    if (trackedFrames.length < MIN_TRACKED_FRAMES) {
      console.log(
        `[process-upload-queue] Clip "${clip.clipSlug}": longest real tracked run is only ` +
          `${trackedFrames.length} frame(s) (need >= ${MIN_TRACKED_FRAMES}) - not enough real ` +
          `data for a skeleton comparison, skipping pose3d storage.`,
      );
      await claim.write(() => deletePose3dFrames(clip.videoClipId));
    } else {
      const smoothedFrames = smoothJoints(trackedFrames);
      const rigidFrames = rigidifySkeleton(smoothedFrames);
      await claim.write(() => upsertPose3dFrames({
        videoClipId: clip.videoClipId,
        jointNames: pose3d.meta.joint_names,
        smoothingMethod: `${SMOOTHING_METHOD_LABEL}+${RIGID_METHOD_LABEL}`,
        leadSide: metrics.lead_side_guess ?? null,
        frames: rigidFrames,
      }));
    }
    await claim.write(() => markClipProgress(clip.videoClipId, 98));

    const detectionState = swingDetectionState(metrics);
    // v2: decided before "ready" so the app shows analysis as pending only when it will actually run.
    const v2Gate = ENGINE.name === "v2-exp" ? v2CoachingEligibility(Object.fromEntries(
      ["pipeline_status.json", "metrics.json", "tracks.json"].map(name => [name, readJsonIfPresent(path.join(outDir, name))]))) : null;
    const v2Base = ENGINE.name === "v2-exp" ? experimentalResult(clip.videoClipId, {
      ...(metrics.pipeline_version ? { pipeline_version: metrics.pipeline_version } : {}),
      events: experimentalEvents(readJsonIfPresent(path.join(outDir, "metrics.json")), readJsonIfPresent(path.join(outDir, "frame_map.json"))),
    }) : null;
    // Written before "ready" so a reader never sees a ready clip with a stale "processing" result.
    if (v2Base && !v2Gate!.eligible) {
      await claim.write(() => upsertExperimentalV2Result({ ...v2Base,
        outcome: v2Gate!.reasons.every(r => ["V2_AI_NOT_ENABLED", "V2_PROVIDER_UNSUPPORTED"].includes(r))
          ? "analysis_not_enabled" : "not_assessable", reason_codes: v2Gate!.reasons }));
    } else if (v2Base) await claim.write(() => upsertExperimentalV2Result(v2Base));
    await claim.finish(() => markClipReady(clip.videoClipId, detectionState,
      { analysisPending: ENGINE.name === "baseline" || v2Gate?.eligible === true }));
    try {
      await recordAttemptSnapshot({ clipId: clip.videoClipId, detectionState,
        phases: metrics.phases, pipelineVersion: metrics.pipeline_version ?? null,
        detectorVersion: metrics.detector_version ?? null,
        phaseVisibility: fullCapture?.phaseVisibility ?? null });
    } catch (attemptError) {
      console.warn(`[process-upload-queue] Attempt snapshot unavailable: ${attemptError instanceof Error ? attemptError.message : attemptError}`);
    }
    console.log(`[process-upload-queue] Clip "${clip.clipSlug}" ready (${detectionState}).`);

    if (v2Base) {
      if (!v2Gate!.eligible) {
        // Covers the explicit ENGINE_V2_AI opt-in: no v2 footage or evidence reaches a provider without it.
        console.log(`[process-upload-queue] Skipping AI diagnosis for experimental v2: ${v2Gate!.reasons.join(", ")}`);
        return true;
      }
      try {
        await runV2Coaching({ clip, outDir, localRawPath, sourceSha256: captureHash, metrics, provider: v2Gate!.provider!, base: v2Base });
      } catch (diagErr) {
        // The clip is already ready: a failure here must never fall through to the pipeline-failure path.
        try { await upsertExperimentalV2Result({ ...v2Base, outcome: "analysis_failed", reason_codes: ["AI_ANALYSIS_FAILED"], retry_eligible: true }); }
        catch (storeErr) { console.error(`[process-upload-queue] ${storeErr instanceof Error ? storeErr.message : storeErr}`); }
        console.error(`[process-upload-queue] Experimental v2 diagnosis for "${clip.clipSlug}" failed (clip itself is still ready): ${diagErr instanceof Error ? diagErr.message : diagErr}`);
        await queueFailureNotification();
      } finally {
        try { await markClipAnalysisFinished(clip.videoClipId); }
        catch (finishErr) { console.error(`[process-upload-queue] ${finishErr instanceof Error ? finishErr.message : finishErr}`); }
      }
      return true;
    }

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
      if (detectionState === "confirmed_no_swing") {
        console.log(`[process-upload-queue] Clip "${clip.clipSlug}": pipeline confirmed no swing; keeping the at-bat without generating a report.`);
      } else if (phaseEntries.length === 0) {
        console.log(`[process-upload-queue] Clip "${clip.clipSlug}": swing detection was inconclusive, skipping AI diagnosis.`);
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
        // PR10 shadow evidence (EVIDENCE_GATE_MODE=shadow only; default off does
        // nothing). Never throws and cannot change anything below.
        const evidenceShadow = await prepareEvidenceShadow({
          videoClipId: clip.videoClipId, outDir, stillsDir, metrics, sourceSha256: captureHash,
          pipelineStartedAt, images: inputs.images, extraction: { sequenceFrames: inputs.sequenceFrames, sequenceSkipped: inputs.sequenceSkipped },
        });
        const pitchContext = [clip.pitch, clip.result].filter(Boolean).join(" - ") || "No pitch/result details recorded for this at-bat.";
        // AI_ANALYZER selects the backend - defaults to Gemini (the intended
        // production path); set to "claude-cli" for local testing to use
        // claudeCliAnalyzer.ts instead, which needs no separate API key (see
        // that file's own docstring - reuses the machine's Claude
        // subscription login). Never the reverse default: a dev's local
        // subscription login isn't a real server-side credential, so
        // production must keep defaulting to Gemini even if this env var is
        // simply unset there.
        // "agy-cli" is the same kind of local-only backend via the Antigravity CLI.
        const localCli = process.env.AI_ANALYZER === "claude-cli" ? "claude"
          : process.env.AI_ANALYZER === "agy-cli" ? "agy" : false;
        console.log(`[process-upload-queue] Running AI diagnosis for "${clip.clipSlug}" via ${
          localCli === "claude" ? "claude CLI" : localCli === "agy" ? "agy CLI" : "Gemini"}`);
        await analyzeAndSync(
          clip.teamSlug, clip.playerSlug, stillsDir, pitchContext, false, null,
          localCli, clip.videoClipId, metrics.pipeline_version ?? null, [], evidenceShadow,
        );
      }
    } catch (diagErr) {
      const message = diagErr instanceof Error ? diagErr.message : String(diagErr);
      console.error(`[process-upload-queue] AI diagnosis for "${clip.clipSlug}" failed (clip itself is still ready): ${message}`);
      await queueFailureNotification();
    } finally {
      try {
        await markClipAnalysisFinished(clip.videoClipId);
      } catch (finishErr) {
        // The app stops treating it as processing after the stale window anyway.
        console.error(`[process-upload-queue] ${finishErr instanceof Error ? finishErr.message : finishErr}`);
      }
    }
  } catch (err) {
    if (claim.lost) { console.warn("[process-upload-queue] Claim lost; clip abandoned."); return true; }
    const message = err instanceof Error ? err.message : String(err);
    console.error(`[process-upload-queue] Clip "${clip.clipSlug}" failed: ${message}`);
    if (await claim.finish(() => markClipFailed(clip.videoClipId, message))) await queueFailureNotification();
  } finally {
    claim.stop();
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
    if (!claim.lost && fs.existsSync(localRawPath)) {
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
    // Deleted clips (delete-clip Edge Function) leave their derived files in
    // frames/<player>/<clipSlug>/ on this machine - remove them every loop.
    // Runs between clips, never during one, so a clip deleted mid-processing
    // is purged right after the worker finishes writing its outputs.
    try {
      // A delete that failed part-way and wasn't retried in the app for 15 minutes is finished
      // here (same SQL function as delete-clip), so its local files are purged right after.
      const bucket = process.env.GCS_BUCKET_NAME ?? "";
      const retried = await retryUnfinishedDeletions(supabaseRetryDb(getSupabaseClient()), deleteObjectIfExists, bucket);
      if (retried) console.log(`[process-upload-queue] Finished ${retried} clip deletion(s) that had stopped part-way.`);
    } catch (err) {
      console.error("[process-upload-queue] Deletion retry error:", err instanceof Error ? err.message : err);
    }
    try {
      const purged = await purgeDeletedClips(supabasePurgeDb(getSupabaseClient()), "frames");
      if (purged) console.log(`[process-upload-queue] Purged local files for ${purged} deleted clip(s).`);
    } catch (err) {
      console.error("[process-upload-queue] Purge error:", err instanceof Error ? err.message : err);
    }
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
