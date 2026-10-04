import { shownFix, type Finding } from "./focus.ts";
import { selectDrills, type CuratedDrill, type DrillContext } from "./drillSelection.ts";

export interface ReportIssue extends Finding {
  issue: string;
  evidence: string;
  coachingCue: string;
  lookForNext: string;
  hiddenBy?: string | null;
}
export interface ReportRun {
  id: string;
  summary: string | null;
  strengths: { text: string; evidence: string; phase: string }[];
}
export interface ReportDrill extends CuratedDrill {
  instructions: string;
  cue: string | null;
  looksRightWhen: string | null;
  commonMistakes: string[];
  demoUrl: string | null;
  demoTimestamp: string | null;
  sourceCredit: string | null;
}

/** Internal worker errors are never sent verbatim to a family. */
export function plainFailureReason(internal: string | null | undefined): string {
  const value = internal?.toLowerCase() ?? "";
  if (/batter|subject|player not found/.test(value)) return "We couldn't find the batter clearly.";
  if (/no swing|swing not|contact not|no contact/.test(value)) return "We couldn't find a swing in this clip. If it was a take or walk, there's no swing to analyze.";
  if (/too short|short clip|duration/.test(value)) return "This clip was too short to see the swing.";
  if (/blur|out of focus/.test(value)) return "The video was too blurry to see the swing clearly.";
  return "We couldn't analyze this video.";
}

/** Only validated, stored output is eligible. A legacy run without the new
 * summary/strength contract cannot become a parent-facing report. */
export function assembleReport(input: {
  run: ReportRun | null;
  issues: ReportIssue[];
  drills: ReportDrill[];
  qualityPassed: boolean;
  currentFocus: string | null;
  drillContext: Omit<DrillContext, "concept" | "phase">;
}) {
  const { run } = input;
  if (!input.qualityPassed || !run || !run.summary?.trim() || !Array.isArray(run.strengths)
    || run.strengths.some((s) => !s || typeof s.text !== "string" || !s.text.trim()
      || typeof s.evidence !== "string" || !s.evidence.trim() || typeof s.phase !== "string")) {
    return { state: "unreadable" as const, reason: "We couldn't analyze this video." };
  }
  // A flagged issue may also have been described in the run-level summary.
  // Without a reliable sentence-to-finding map, replace that prose and do
  // not surface a different runner-up fix from the same disputed run.
  const disputed = input.issues.some((issue) => issue.hidden);
  const fix = disputed ? null : shownFix(input.issues, input.qualityPassed, input.currentFocus) as ReportIssue | null;
  const drills = fix ? selectDrills(input.drills, { ...input.drillContext, concept: fix.concept, phase: fix.phase }) : [];
  return {
    state: "ready" as const,
    summary: disputed ? "An observation from this at-bat was hidden after feedback. Watch the video for what happened." : run.summary.trim(),
    strengths: run.strengths.slice(0, 2).map(({ text }) => text),
    fix: fix ? { id: fix.id, concept: fix.concept, issue: fix.issue, evidence: fix.evidence,
      coachingCue: fix.coachingCue, lookForNext: fix.lookForNext } : null,
    drills: drills.map(({ id, name, bestFor, equipment, homeFriendly, instructions, cue,
      looksRightWhen, commonMistakes, demoUrl, demoTimestamp, sourceCredit, requiresScreen }) => ({
      id, name, bestFor, equipment, homeFriendly, instructions, cue, looksRightWhen,
      commonMistakes, demoUrl, demoTimestamp, sourceCredit, requiresScreen,
    })),
  };
}
