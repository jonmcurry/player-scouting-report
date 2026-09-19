// Ingest-time "analysis quality" summary shown to coaches as Good / Limited / Poor
// (coach/components/developmentLogic.js analysisQualityLabels). Pure: takes the already-parsed
// pipeline outputs and returns the JSON stored in video_clip_metrics.analysis_quality. Anything the
// pipeline can't actually know stays null ("Not measured" in the UI) - never guessed.

export type Rating = "good" | "limited" | "poor";

export interface AnalysisQuality {
  /** Fraction (0-1) of frames where shoulders + hips were confidently detected in 2D. */
  pose_coverage: number | null;
  /** Fraction of tracked frames where the bat itself was detected (not interpolated). */
  bat_coverage: number | null;
  /** Fraction of frames with a tracked 3D reconstruction. */
  pose3d_coverage: number | null;
  contact_confidence: Rating | null;
  reconstruction: Rating | null;
  occlusion: Rating | null;
  /** Handedness is only ever a heuristic here, so this is capped at "limited". */
  handedness: Rating | null;
}

interface QualityInput {
  pose2d: { meta?: { bat_evidence?: { track_frames?: number; bat_evidence_frames?: number } }; frames: { keypoints: number[][] | null }[] };
  pose3d?: { frames: { tracked?: boolean }[] } | null;
  metrics: { phases?: Record<string, { confidence?: string | null; reconstruction_reliable?: boolean | null; frame?: number | null } | undefined>; lead_side_guess?: string | null };
}

// COCO17 indices: shoulders 5/6, hips 11/12.
const CORE = [5, 6, 11, 12];
const CORE_MIN_CONF = 0.3;
const FRAME_VISIBLE_MEAN_CONF = 0.5;

const round = (n: number) => Math.round(n * 1000) / 1000;
const rateHigh = (v: number, good: number, limited: number): Rating => (v >= good ? "good" : v >= limited ? "limited" : "poor");

export function computeAnalysisQuality({ pose2d, pose3d, metrics }: QualityInput): AnalysisQuality {
  const frames = pose2d.frames ?? [];
  const n = frames.length;

  let coreOk = 0;
  let occluded = 0;
  for (const f of frames) {
    const kp = f.keypoints;
    if (!kp) { occluded++; continue; }
    const confs = CORE.map((i) => kp[i]?.[2] ?? 0);
    if (confs.every((c) => c >= CORE_MIN_CONF)) coreOk++;
    if (confs.reduce((a, b) => a + b, 0) / CORE.length < FRAME_VISIBLE_MEAN_CONF) occluded++;
  }
  const pose_coverage = n ? round(coreOk / n) : null;

  const ev = pose2d.meta?.bat_evidence;
  const bat_coverage = ev && ev.track_frames ? round(Math.min(1, (ev.bat_evidence_frames ?? 0) / ev.track_frames)) : null;

  const p3 = pose3d?.frames ?? null;
  const pose3d_coverage = p3 && p3.length ? round(p3.filter((f) => f.tracked).length / p3.length) : null;

  const phases = Object.values(metrics.phases ?? {}).filter((p): p is NonNullable<typeof p> => !!p && p.frame != null && p.reconstruction_reliable != null);
  let reconstruction: Rating | null = null;
  if (pose3d_coverage != null) {
    const base = rateHigh(pose3d_coverage, 0.85, 0.6);
    const unreliableShare = phases.length ? phases.filter((p) => p.reconstruction_reliable === false).length / phases.length : 0;
    // Flagged phases cap the rating: a well-tracked clip can still have an unreliable reconstruction.
    reconstruction = unreliableShare > 0.5 ? "poor" : unreliableShare > 0 && base === "good" ? "limited" : base;
  }

  const contact = metrics.phases?.contact;
  const contact_confidence: Rating | null = !contact || contact.frame == null ? "poor" : contact.confidence === "high" ? "good" : "limited";

  return {
    pose_coverage,
    bat_coverage,
    pose3d_coverage,
    contact_confidence,
    reconstruction,
    occlusion: n ? (occluded / n < 0.15 ? "good" : occluded / n < 0.35 ? "limited" : "poor") : null,
    handedness: metrics.lead_side_guess ? "limited" : null,
  };
}
