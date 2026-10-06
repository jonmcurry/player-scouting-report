import { PHASE_ORDER } from "./focus.ts";

/** Rows must be ordered newest first. An incomplete newest run must not reveal an older claim. */
export function latestRunsByClip<T extends { video_clip_id: string | null }>(rows: T[]): Map<string, T> {
  const latest = new Map<string, T>();
  for (const row of rows) if (row.video_clip_id && !latest.has(row.video_clip_id)) latest.set(row.video_clip_id, row);
  return latest;
}

/** A stored run can support a simplified claim only when its report evidence is intact. */
export function hasReportEvidence(run: { summary: string | null; strengths: unknown } | null | undefined): boolean {
  return !!run?.summary?.trim() && Array.isArray(run.strengths)
    && run.strengths.every((strength) => strength && typeof strength.text === "string" && !!strength.text.trim()
      && typeof strength.evidence === "string" && !!strength.evidence.trim()
      && typeof strength.phase === "string"
      && PHASE_ORDER.includes(strength.phase as typeof PHASE_ORDER[number]));
}

/** A current-run finding cannot support a report or progress claim with missing display evidence. */
export function hasIssueEvidence(issue: { issue: unknown; evidence: unknown; coachingCue: unknown; lookForNext: unknown }): boolean {
  return [issue.issue, issue.evidence, issue.coachingCue, issue.lookForNext]
    .every((value) => typeof value === "string" && !!value.trim());
}

export function belongsToRun(issue: { analysis_run_id: string | null }, run: { id: string } | null | undefined): boolean {
  return !!run && issue.analysis_run_id === run.id;
}
