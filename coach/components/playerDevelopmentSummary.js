export const DEFAULT_CAPTURE_GUIDANCE = "Capture another swing with the full body and bat visible through contact.";

const isVerifiedStrength = (row) => row?.review_status === "verified" && row?.score === 3;
const needsEvidence = (row) => row?.review_status === "insufficient_evidence";
const STRENGTH_TITLES = { "stance-setup": "Athletic setup", load: "Visible load" };

export function derivePlayerDevelopmentSummary({
  checklist = [],
  priorities = [],
  assignments = [],
  draftFindings = [],
  captureGuidance = null,
} = {}) {
  const strengths = checklist.filter(isVerifiedStrength).map((row) => ({
    slug: row.checkpoints?.slug ?? row.slug ?? "",
    label: STRENGTH_TITLES[row.checkpoints?.slug ?? row.slug] ?? row.checkpoints?.label ?? row.label ?? "Checkpoint",
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

export function canRenderExperimental3d(analysisQuality) {
  return analysisQuality?.reconstruction === "good";
}

export function hasPublishedMetrics(metrics) {
  if (!metrics) return false;
  return [
    metrics.max_bat_speed_full_rate_value,
    metrics.max_bat_speed_value,
    metrics.attack_angle_at_contact_deg,
    metrics.hip_shoulder_separation_at_contact_deg,
    metrics.torso_tilt_at_contact_deg,
    metrics.pelvis_tilt_at_contact_deg,
    metrics.stride_length_hip_widths,
    metrics.lead_elbow_angle_at_contact_deg,
    metrics.front_knee_angle_at_contact_deg,
  ].some((value) => value !== null && value !== undefined);
}
