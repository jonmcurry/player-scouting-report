// Where a clip stands in review - the SAME rule as coach/components/clipReviewState.js
// (the coach page's copy). Two copies exist on purpose: the coach app is served
// statically from coach/ and Edge Functions deploy from supabase/functions/, so
// neither can import the other. coach/components/clipReviewState.test.mjs runs
// both copies over one table of cases and compares their function bodies, so
// change both together. Pure, no imports (Node strips the types for that test).
//
// 'analyzed' means an analysis run exists and produced no findings at all - it
// is never a clean bill of health. A ready clip with no analysis run is still
// 'processing' (fail closed: it was never analyzed, so it can't say so).

export type ClipReviewStatus = "processing" | "failed" | "analyzed" | "awaiting_coach" | "reviewed";
export type ClipReviewRow = { status: string; analyzed: boolean };
export type ClipReviewFinding = { review_status: string };

export function clipReviewState(row: ClipReviewRow, findings: ClipReviewFinding[] | null | undefined): ClipReviewStatus {
  if (row.status === "failed") return "failed";
  if (row.status !== "ready") return "processing";
  const statuses = (findings ?? []).map((finding) => finding.review_status);
  if (statuses.includes("draft")) return "awaiting_coach";
  if (statuses.length) return "reviewed";
  if (row.analyzed) return "analyzed";
  return "processing";
}
