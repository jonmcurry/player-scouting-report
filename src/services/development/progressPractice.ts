/** Practice is a separate observation about the current game focus. */
import { hasIssueEvidence, hasReportEvidence, latestRunsByClip } from "./latestRuns.ts";

export function practiceEvidence(
  clipIdsNewestFirst: string[],
  runsNewestFirst: { id: string; video_clip_id: string | null; summary: string | null; strengths: unknown }[],
  issues: { video_clip_id: string; analysis_run_id: string | null; concept: string | null; basis: string | null;
    review_status: string | null; context_explains_it: boolean; emergency_swing_suspected: boolean;
    issue: string | null; evidence: string | null; coaching_cue: string | null; look_for_next: string | null }[],
  concept: string,
): { seen: number; total: number } {
  const latest = latestRunsByClip(runsNewestFirst);
  const readable = clipIdsNewestFirst.filter((id) => {
    const run = latest.get(id);
    return hasReportEvidence(run) && !issues.some((issue) => issue.video_clip_id === id
      && issue.analysis_run_id === run?.id
      && !hasIssueEvidence({ ...issue, coachingCue: issue.coaching_cue, lookForNext: issue.look_for_next }));
  }).slice(0, 4);
  return { total: readable.length, seen: readable.filter((id) => issues.some((issue) =>
    issue.video_clip_id === id && issue.analysis_run_id === latest.get(id)?.id
    && issue.concept === concept && issue.basis === "video"
    && issue.review_status !== "hidden" && issue.review_status !== "rejected"
    && !issue.context_explains_it && !issue.emergency_swing_suspected)).length };
}
