import { swingSequenceWindow } from "../../../domain/swingWindow.ts";
import { engineCodeForPipelineVersion } from "../evidenceRegistry.ts";
import { SUBJECT_SPATIAL_RULE, isIdentityJump } from "./subjectPolicy.ts";
import { strictEngineVersionForComparison, type ClipEvidenceSignals } from "./strictBaseline.ts";
import { finite, index, object } from "./validation.ts";

/** extract.ts's AI-input result, by image name (e.g. "zoom_contact"), not path. */
export interface AiInputNames {
  phaseStills: string[]; zooms: string[]; sequenceFrames: number; sequenceSkipped: string | null;
}
export interface SubjectSignals {
  usedFallback: boolean | null; batEvidenceFrames: number | null; trackFrames: number | null;
  trackedFraction: number | null; identityJumpFraction: number | null;
  batterCropAvailable: boolean; windowAvailable: boolean;
}

// COCO-17 indices: shoulders and hips (Revision 1 coreKeypointFraction).
const CORE_KEYPOINTS = [5, 6, 11, 12] as const;

function confident(keypoint: unknown): keypoint is [number, number, number] {
  return Array.isArray(keypoint) && keypoint.length >= 3 && keypoint.slice(0, 3).every(finite)
    && (keypoint[2] as number) >= SUBJECT_SPATIAL_RULE.keypointMinConfidence;
}
/** Mirrors subjectBox.ts bodyAt via subjectPolicy.ts constants (drift-tested there). */
function bodyAt(keypoints: unknown): { cx: number; cy: number; h: number } | null {
  if (!Array.isArray(keypoints)) return null;
  const body = keypoints.filter(confident);
  if (body.length < SUBJECT_SPATIAL_RULE.minReliableKeypoints) return null;
  const ys = body.map(k => k[1]);
  return { cx: body.reduce((a, k) => a + k[0], 0) / body.length,
    cy: body.reduce((a, k) => a + k[1], 0) / body.length, h: Math.max(...ys) - Math.min(...ys) };
}
const round = (v: number) => Math.round(v * 1e6) / 1e6;

/**
 * Revision 1 S0-04 `extractClipEvidenceSignals`: parsing and counting over
 * existing artifacts only (pose_2d.json, bat_path.json, metrics.json, extract.ts
 * names). No 3D field is read (R2) and no media is decoded. The window is
 * extract.ts's own sequence window (domain/swingWindow.ts). Malformed inputs
 * are passed through as null so the comparator fails closed and records them.
 *
 * identityJumpFraction denominator: window frames with a usable body (>= 8
 * confident keypoints). Revision 1 does not state the denominator; this is the
 * conservative reading (never smaller than dividing by all window frames).
 */
export function extractClipEvidenceSignals(args: {
  pose2d: unknown; batPath: unknown; metrics: unknown; aiInputs: AiInputNames; captureProfile: string | null;
}): ClipEvidenceSignals {
  const pose = object(args.pose2d), meta = object(pose.meta), evidence = object(meta.bat_evidence);
  const metrics = object(args.metrics), phases = object(metrics.phases), contact = object(metrics.contact);
  // Absent -> null; any other value passes through verbatim so an unexpected
  // label is recorded by the comparator as invalid instead of being coerced.
  const label = (v: unknown) => (v === undefined ? null : v) as "high" | "low" | null;
  const located = Object.entries(phases).flatMap(([slug, value]) => {
    const frame = object(value).frame;
    return index(frame) ? [{ slug, frame }] : [];
  });
  const engine = strictEngineVersionForComparison(engineCodeForPipelineVersion(metrics.pipeline_version));

  let swingWindow: ClipEvidenceSignals["swingWindow"] = null;
  const fps = meta.fps, nFrames = meta.n_frames, frames = Array.isArray(pose.frames) ? pose.frames : null;
  const window = finite(fps) && fps > 0 && index(nFrames) && nFrames > 0
    ? swingSequenceWindow(located, fps, nFrames) : null;
  // A window ending before it starts (phase frames beyond the decoded frame
  // count) is unavailable here; the shared formula itself stays legacy-identical.
  if (window?.available && window.end >= window.start && frames) {
    const poseBy = new Map<number, unknown>();
    for (const f of frames) { const r = object(f); if (index(r.frame)) poseBy.set(r.frame, r.keypoints); }
    const batBy = new Map<number, unknown>();
    const batFrames = object(args.batPath).frames;
    if (Array.isArray(batFrames)) for (const f of batFrames) { const r = object(f); if (index(r.frame)) batBy.set(r.frame, r.tip); }
    const total = window.end - window.start + 1;
    let tracked = 0, core = 0, bat = 0, usable = 0, jumps = 0;
    let anchor = bodyAt(poseBy.get(window.anchorFrame));
    for (let f = window.start; f <= window.end; f++) {
      const keypoints = poseBy.get(f);
      if (Array.isArray(keypoints) && keypoints.length > 0) tracked++;
      if (Array.isArray(keypoints) && CORE_KEYPOINTS.every(i => confident(keypoints[i]))) core++;
      if (Array.isArray(batBy.get(f))) bat++;
      const here = bodyAt(keypoints);
      if (!here) continue;
      usable++;
      if (!anchor) { anchor = here; continue; }
      if (isIdentityJump(here, anchor) === true) jumps++;
    }
    swingWindow = { frames: total, batterTrackedFraction: round(tracked / total),
      identityJumpFraction: usable > 0 ? round(jumps / usable) : (null as unknown as number),
      coreKeypointFraction: round(core / total), batDetectedFraction: round(bat / total) };
  }
  return {
    engineVersion: engine ?? (typeof metrics.pipeline_version === "string" ? metrics.pipeline_version : "unknown"),
    batterSelection: {
      usedFallback: (typeof evidence.used_fallback === "boolean" ? evidence.used_fallback : null) as boolean,
      trackFrames: (index(evidence.track_frames) ? evidence.track_frames : null) as number,
      batEvidenceFrames: (index(evidence.bat_evidence_frames) ? evidence.bat_evidence_frames : null) as number,
    },
    contact: { frame: contact.frame === undefined ? null : contact.frame as number | null,
      confidence: label(contact.confidence) },
    phases: Object.fromEntries(Object.entries(phases).map(([slug, value]) => {
      const v = object(value);
      return [slug, { frame: v.frame === undefined ? null : v.frame as number | null, confidence: label(v.confidence) }];
    })),
    swingWindow,
    aiInputs: { phaseStills: [...args.aiInputs.phaseStills], zooms: [...args.aiInputs.zooms],
      sequenceFrames: args.aiInputs.sequenceFrames, sequenceSkipped: args.aiInputs.sequenceSkipped },
    captureProfile: args.captureProfile,
  };
}

/** Revision 2 V1 inputs from the same signals: the authorized subject signals
 * only. No contact, zoom-contact or engine predicate enters V1. */
export function subjectSignalsFrom(signals: ClipEvidenceSignals): SubjectSignals {
  return {
    usedFallback: signals.batterSelection.usedFallback ?? null,
    batEvidenceFrames: signals.batterSelection.batEvidenceFrames ?? null,
    trackFrames: signals.batterSelection.trackFrames ?? null,
    trackedFraction: signals.swingWindow?.batterTrackedFraction ?? null,
    identityJumpFraction: signals.swingWindow?.identityJumpFraction ?? null,
    batterCropAvailable: signals.aiInputs.zooms.length > 0,
    windowAvailable: signals.swingWindow !== null,
  };
}
