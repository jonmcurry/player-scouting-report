/** Practice is a separate observation about the current game focus. */
export function practiceEvidence(
  clipIdsNewestFirst: string[],
  runsNewestFirst: { id: string; video_clip_id: string | null; summary: string | null; strengths: unknown }[],
  issues: { video_clip_id: string; analysis_run_id: string | null; concept: string | null; basis: string | null;
    review_status: string | null; context_explains_it: boolean; emergency_swing_suspected: boolean }[],
  concept: string,
): { seen: number; total: number } {
  const latest = new Map<string, typeof runsNewestFirst[number]>();
  for (const run of runsNewestFirst) if (run.video_clip_id && !latest.has(run.video_clip_id)) latest.set(run.video_clip_id, run);
  const readable = clipIdsNewestFirst.filter((id) => {
    const run = latest.get(id);
    return !!run?.summary?.trim() && Array.isArray(run.strengths)
      && run.strengths.every((strength: { text?: string; evidence?: string; phase?: string }) =>
        strength && typeof strength.text === "string" && !!strength.text.trim()
        && typeof strength.evidence === "string" && !!strength.evidence.trim()
        && typeof strength.phase === "string");
  }).slice(0, 4);
  return { total: readable.length, seen: readable.filter((id) => issues.some((issue) =>
    issue.video_clip_id === id && issue.analysis_run_id === latest.get(id)?.id
    && issue.concept === concept && issue.basis === "video"
    && issue.review_status !== "hidden" && issue.review_status !== "rejected"
    && !issue.context_explains_it && !issue.emergency_swing_suspected)).length };
}
