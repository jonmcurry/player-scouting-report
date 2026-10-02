// Where a clip stands in review - ONE rule for the coach page (player.html) and
// the family surface (supabase/functions/_shared/familyReport.ts).
//
// Two copies exist on purpose: this one (served statically from coach/) and
// supabase/functions/_shared/clipReviewState.ts (bundled into Edge Functions).
// Neither tree can import the other at runtime. clipReviewState.test.mjs runs
// both copies over one table of cases and compares their function bodies, so
// change both together.
//
// row:      { status: video_clips.status, analyzed: an analysis_runs row exists }
// findings: the clip's issues rows ({ review_status }), any review state
// returns:  'processing' | 'failed' | 'analyzed' | 'awaiting_coach' | 'reviewed'
//
// 'analyzed' means an analysis run exists and produced no findings at all - it
// is never a clean bill of health. A ready clip with no analysis run is still
// 'processing' (fail closed: it was never analyzed, so it can't say so).

export function clipReviewState(row, findings) {
  if (row.status === "failed") return "failed";
  if (row.status !== "ready") return "processing";
  const statuses = (findings ?? []).map((finding) => finding.review_status);
  if (statuses.includes("draft")) return "awaiting_coach";
  if (statuses.length) return "reviewed";
  if (row.analyzed) return "analyzed";
  return "processing";
}

const COACH_LABELS = {
  awaiting_coach: "Waiting for coach review",
  reviewed: "Coach reviewed",
  analyzed: "Analyzed · nothing flagged",
  // The coach page lists ready clips only, where 'processing' means no analysis run yet.
  processing: "Not analyzed",
};

/** The coach page's per-clip review label (player.html "Swing evidence"). */
export function coachReviewLabel(state) {
  return COACH_LABELS[state] ?? "Not analyzed";
}
