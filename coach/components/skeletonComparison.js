// Two-panel (or single-panel, when no correction applies) 3D skeleton
// comparison view - replaces videoScrubber.js's real-video playback
// entirely (see the approved plan). Renders the player's own real,
// smoothed pose3d joint trajectory, driven by the same real swing_phases
// timestamps videoScrubber.js used, via Canvas2D (skeletonRenderer.js) -
// never raw video, so none of the Content-Type/codec/frame-rate/caching bug
// class this replaces can recur.
import { supabase } from "../shared.js";
import { drawFigure, DEFAULT_CAMERA } from "./skeletonRenderer.js";
import { correctKneeAngle } from "./fkCorrection.js";
import { L_HIP, L_KNEE, L_ANKLE, R_HIP, R_KNEE, R_ANKLE } from "./h36mSkeleton.js";

// scripts/pose3d/pose3d_to_checklist.py's EXTENSION_THRESHOLDS: >=155deg is
// the only checklist score of 3 (the top score) - the sole checkpoint in
// this whole codebase with an actual calibrated healthy-angle target (see
// the approved plan's section 3). hip-shoulder-sep has NO such target
// anywhere in this codebase, so it never gets a corrected panel - see
// buildExtensionCorrectedFrames()'s own honesty guard below.
const EXTENSION_TARGET_DEG = 155;

/** Unpacks joints_blob (Postgres bytea, wire format confirmed empirically:
 * hex text prefixed with "\x") back into each frame's `joints` array -
 * mirrors src/services/db/videoClipUpsert.ts's packing exactly, so this is
 * the one place that format is decoded. Reconstructs the SAME per-frame
 * shape ({..., joints: [[x,y,z], ...]}) the rest of this file (and
 * fkCorrection.js/skeletonRenderer.js) already expects, so nothing
 * downstream of loadClipSkeletonData needs to know this optimization
 * exists. */
function unpackJoints(frames, jointNames, hexBlob) {
  const hex = hexBlob.startsWith("\\x") ? hexBlob.slice(2) : hexBlob;
  const bytes = new Uint8Array(hex.length / 2);
  for (let i = 0; i < bytes.length; i++) {
    bytes[i] = parseInt(hex.substr(i * 2, 2), 16);
  }
  const floats = new Float32Array(bytes.buffer);
  const jointsPerFrame = jointNames.length;

  return frames.map((f, frameIdx) => {
    const base = frameIdx * jointsPerFrame * 3;
    const joints = [];
    for (let j = 0; j < jointsPerFrame; j++) {
      joints.push([floats[base + j * 3], floats[base + j * 3 + 1], floats[base + j * 3 + 2]]);
    }
    return { ...f, joints };
  });
}

/** Real per-clip pose3d data, or null if this clip has no video_clip_pose3d
 * row yet (predates this feature, or is still processing). */
export async function loadClipSkeletonData(clipId) {
  const { data } = await supabase
    .from("video_clip_pose3d")
    .select("joint_names, frames, joints_blob, lead_side")
    .eq("video_clip_id", clipId)
    .maybeSingle();
  if (!data) return null;

  // joints_blob is null for any row written before this optimization -
  // those already have `joints` inline in each frame object, so pass
  // through unchanged rather than forcing a re-ingest of old clips.
  const frames = data.joints_blob ? unpackJoints(data.frames, data.joint_names, data.joints_blob) : data.frames;
  return { ...data, frames };
}

/** The player's real extension checklist score, or null if unscored. */
export async function loadExtensionScore(playerId) {
  const { data } = await supabase
    .from("checklist_scores")
    .select("score, checkpoints!inner(slug)")
    .eq("player_id", playerId)
    .eq("checkpoints.slug", "extension")
    .maybeSingle();
  return data?.score ?? null;
}

/**
 * Builds a parallel corrected-joints frame array with the front knee's
 * angle nudged toward EXTENSION_TARGET_DEG (never past it - a no-op per
 * frame where she's already at/above target). Returns null - not a guess -
 * if leadSide is unknown (no real front-leg fact from
 * scripts/pose3d/metrics.py's lead_side_guess was stored for this clip) or
 * if the real extension score is already 3 (nothing to correct toward).
 *
 * @param {Array} frames - video_clip_pose3d.frames
 * @param {"l"|"r"|null} leadSide
 * @param {number|null} extensionScore
 */
export function buildExtensionCorrectedFrames(frames, leadSide, extensionScore) {
  if (!leadSide || extensionScore === null || extensionScore >= 3) return null;
  const [hipIdx, kneeIdx, ankleIdx] = leadSide === "l" ? [L_HIP, L_KNEE, L_ANKLE] : [R_HIP, R_KNEE, R_ANKLE];
  return frames.map((f) => ({
    ...f,
    joints: correctKneeAngle(f.joints, hipIdx, kneeIdx, ankleIdx, EXTENSION_TARGET_DEG),
  }));
}

function currentPhaseLabel(phases, t) {
  let label = "—";
  for (const p of phases) {
    if (p.timeS !== null && p.timeS <= t) label = p.label;
  }
  return label;
}

/**
 * @param {HTMLElement} mountEl
 * @param {{ realFrames: Array, correctedFrames: Array|null, phases: Array<{slug:string,label:string,timeS:number|null,confidence:string|null}>, note?: string }} data
 */
export function renderSkeletonComparison(mountEl, { realFrames, correctedFrames, phases, note }) {
  const locatedPhases = phases.filter((p) => p.timeS !== null);
  const twoPanel = !!correctedFrames;

  mountEl.innerHTML = `
    <div class="scrubber">
      <div class="skeleton-canvases">
        <div class="skeleton-canvas-col">
          ${twoPanel ? `<p class="skeleton-canvas-label">Her real swing</p>` : ""}
          <canvas class="skeleton-canvas" data-cv-real width="360" height="420"></canvas>
        </div>
        ${
          twoPanel
            ? `<div class="skeleton-canvas-col">
                 <p class="skeleton-canvas-label">Target (front knee to ~${EXTENSION_TARGET_DEG}&deg;)</p>
                 <canvas class="skeleton-canvas" data-cv-corrected width="360" height="420"></canvas>
               </div>`
            : ""
        }
      </div>
      ${note ? `<p class="hint">${note}</p>` : ""}
      <div class="scrubber-controls">
        <button type="button" class="tap-target" data-play>&#9654; Play</button>
        <select class="tap-target" data-speed>
          <option value="0.25">0.25x</option>
          <option value="0.5" selected>0.5x</option>
          <option value="1">1x</option>
        </select>
        <span class="scrubber-phase-label" data-phase-label>&mdash;</span>
      </div>
      <div class="scrubber-track-wrap">
        <input type="range" class="tap-target" data-scrub min="0" max="1000" value="0" step="1">
        <div class="scrubber-ticks" data-ticks></div>
      </div>
      <p class="hint">Reconstructed from her real filmed swing (YOLO11-pose + VideoPose3D, smoothed) -
        not a video, a rendered 3D model, so drag to rotate isn't available here; scrub or press play.</p>
    </div>
  `;

  const cvReal = mountEl.querySelector("[data-cv-real]");
  const cvCorrected = mountEl.querySelector("[data-cv-corrected]");
  const playBtn = mountEl.querySelector("[data-play]");
  const speedSelect = mountEl.querySelector("[data-speed]");
  const phaseLabel = mountEl.querySelector("[data-phase-label]");
  const scrubInput = mountEl.querySelector("[data-scrub]");
  const ticksEl = mountEl.querySelector("[data-ticks]");

  const n = realFrames.length;
  const duration = n > 1 ? realFrames[n - 1].time_s - realFrames[0].time_s : 1;
  const t0 = realFrames[0]?.time_s ?? 0;
  const fps = n > 1 ? 1 / (realFrames[1].time_s - realFrames[0].time_s) : 30;

  ticksEl.innerHTML = locatedPhases
    .map(
      (p) => `
      <div class="scrubber-tick" style="left:${((p.timeS - t0) / (duration || 1)) * 100}%;"
           title="${p.label}${p.confidence === "low" ? " (low confidence)" : ""}">
        <span class="scrubber-tick-dot ${p.confidence === "low" ? "low-conf" : ""}"></span>
      </div>`,
    )
    .join("");

  let frame = 0;
  let playing = false;
  let speed = Number(speedSelect.value);
  let lastTick = 0;
  let acc = 0;

  function render() {
    const f = realFrames[frame];
    drawFigure(cvReal.getContext("2d"), f.joints, cvReal.width, cvReal.height, DEFAULT_CAMERA, {});
    if (twoPanel) {
      const cf = correctedFrames[frame];
      drawFigure(cvCorrected.getContext("2d"), cf.joints, cvCorrected.width, cvCorrected.height, DEFAULT_CAMERA, {});
    }
    scrubInput.value = String(Math.round((frame / Math.max(1, n - 1)) * 1000));
    phaseLabel.textContent = currentPhaseLabel(locatedPhases, f.time_s);
  }

  function tick(ts) {
    if (playing) {
      if (lastTick) {
        acc += ((ts - lastTick) / 1000) * fps * speed;
        while (acc >= 1) {
          frame = (frame + 1) % n;
          acc -= 1;
        }
      }
      lastTick = ts;
      render();
    }
    requestAnimationFrame(tick);
  }

  playBtn.addEventListener("click", () => {
    playing = !playing;
    lastTick = 0;
    playBtn.textContent = playing ? "⏸ Pause" : "▶ Play";
  });
  speedSelect.addEventListener("change", () => {
    speed = Number(speedSelect.value);
  });
  scrubInput.addEventListener("input", () => {
    frame = Math.min(n - 1, Math.round((Number(scrubInput.value) / 1000) * (n - 1)));
    render();
  });

  render();
  requestAnimationFrame(tick);
}

/** Static single-frame render for compModal.js's Tier 2 (the 5 checkpoints
 * with a real single-instant phase mapping) - replaces extractFrameToCanvas()'s
 * video-frame grab with the real reconstructed skeleton at that same phase's
 * real timestamp, nearest-frame-matched. */
export function renderSkeletonFrameToCanvas(realFrames, phaseTimeS, canvasEl) {
  let nearest = realFrames[0];
  let bestDelta = Infinity;
  for (const f of realFrames) {
    const delta = Math.abs(f.time_s - phaseTimeS);
    if (delta < bestDelta) {
      bestDelta = delta;
      nearest = f;
    }
  }
  canvasEl.width = 360;
  canvasEl.height = 420;
  drawFigure(canvasEl.getContext("2d"), nearest.joints, canvasEl.width, canvasEl.height, DEFAULT_CAMERA, {});
}
