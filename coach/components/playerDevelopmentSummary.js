export const DEFAULT_CAPTURE_GUIDANCE = "Capture another swing with the full body and bat visible through contact.";

const isVerifiedStrength = (row) => row?.review_status === "verified" && row?.score === 3;
const needsEvidence = (row) => row?.review_status === "insufficient_evidence";
// User-facing score words (never "Solid"): 1 Needs Work, 2 Developing, 3 On Target.
export const SCORE_WORDS = { 1: "Needs Work", 2: "Developing", 3: "On Target" };

export function derivePlayerDevelopmentSummary({
  checklist = [],
  priorities = [],
  assignments = [],
  draftFindings = [],
  captureGuidance = null,
} = {}) {
  const strengths = checklist.filter(isVerifiedStrength).map((row) => ({
    slug: row.checkpoints?.slug ?? row.slug ?? "",
    // The checkpoint's own name - never a re-worded characterization nobody reviewed.
    label: row.checkpoints?.label ?? row.label ?? "Checkpoint",
    scoreWord: SCORE_WORDS[row.score],
    note: row.notes ?? "",
    score: row.score,
  }));
  const needsBetterEvidence = checklist.filter(needsEvidence).map((row) => ({
    slug: row.checkpoints?.slug ?? row.slug ?? "",
    label: row.checkpoints?.label ?? row.label ?? "Checkpoint",
  }));
  const currentPriority = priorities.find((row) => ["active", "monitoring"].includes(row.status)) ?? null;
  const recommendedDrill = currentPriority
    ? assignments.find((row) => row.player_priority_id === currentPriority.id && row.active) ?? null
    : null;

  return {
    strengths,
    currentPriority,
    needsBetterEvidence,
    recommendedDrill,
    draftFindingCount: draftFindings.length,
    nextStep: captureGuidance || (needsBetterEvidence.length ? DEFAULT_CAPTURE_GUIDANCE : null),
  };
}

export function reviewFindingState({ issues = [], hasAnalysisRun = false } = {}) {
  if (issues.length) return "findings";
  return hasAnalysisRun ? "analyzed-empty" : "unanalyzed";
}

export function hasPublishedMetrics(metrics) {
  if (!metrics) return false;
  return [
    metrics.max_bat_speed_full_rate_value,
    metrics.max_bat_speed_value,
    metrics.attack_angle_at_contact_deg,
    metrics.stride_length_hip_widths,
  ].some((value) => value !== null && value !== undefined);
}
