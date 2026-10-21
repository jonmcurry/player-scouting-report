import { plainFailureReason } from "./reportAssembly.ts";

export type AnalysisState = "processing" | "supported_finding" | "no_supported_issue" | "limited" | "insufficient_evidence" | "unable_to_analyze" | "no_swing" | "technical_failure";
export type FixState = "shown" | "none_found" | "not_confident" | "hidden_after_feedback" | "withheld_evidence" | "not_applicable";
export type SectionState = "shown" | "none_found" | "replaced_after_feedback" | "not_applicable";
export type FamilyReason = "batter_unclear" | "swing_unclear" | "clip_too_short" | "video_blurry" | "duration_limit" | "evidence_unsupported" | "not_enabled" | "unknown" | null;
export interface ReportPresentation {
  version: 1;
  engine: "baseline" | "experimental_v2";
  engineOutcome: string;
  analysisState: AnalysisState;
  fixState: FixState;
  strengthsState: SectionState;
  summaryState: SectionState;
  familyReason: FamilyReason;
  limited: boolean;
  reasonCodes: string[];
  momentLabel: "impact_estimate" | null;
}

// Use the producer's actual sentences without changing its failure classification.
export const FAILURE_FAMILY_REASONS: Readonly<Record<string, FamilyReason>> = Object.freeze({
  [plainFailureReason("batter")]: "batter_unclear",
  [plainFailureReason("no swing")]: "swing_unclear",
  [plainFailureReason("too short")]: "clip_too_short",
  [plainFailureReason("blur")]: "video_blurry",
  [plainFailureReason("3-minute upload limit")]: "duration_limit",
  [plainFailureReason(null)]: "unknown",
});
const object = (value: unknown): Record<string, unknown> =>
  value !== null && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : {};
const base = (engine: ReportPresentation["engine"], engineOutcome: unknown): ReportPresentation => ({
  version: 1, engine, engineOutcome: typeof engineOutcome === "string" ? engineOutcome : "unknown",
  analysisState: "technical_failure", fixState: "not_applicable", strengthsState: "not_applicable",
  summaryState: "not_applicable", familyReason: "unknown", limited: false, reasonCodes: [], momentLabel: null,
});

export function baselinePresentation(input: unknown): ReportPresentation {
  const fallback = base("baseline", "unknown");
  try {
    const { status, report: raw, issues } = object(input), report = object(raw);
    const p = base("baseline", status === "ready" ? report.state : status);
    if (status === "pending" || status === "processing") return { ...p, analysisState: "processing", familyReason: null };
    if (status === "failed") {
      const familyReason = typeof report.reason === "string" && Object.hasOwn(FAILURE_FAMILY_REASONS, report.reason)
        ? FAILURE_FAMILY_REASONS[report.reason]! : "unknown";
      return { ...p, familyReason, analysisState: familyReason === "unknown" ? "technical_failure" : "unable_to_analyze" };
    }
    if (status !== "ready") return p;
    if (report.state === "no_swing") return { ...p, analysisState: "no_swing", familyReason: null };
    if (report.state === "unreadable") return { ...p, analysisState: "insufficient_evidence", familyReason: null };
    if (report.state !== "ready" || !Array.isArray(report.strengths) || !Array.isArray(issues)
      || !Array.from(report.strengths).every(s => typeof s === "string") || !Array.from(issues).every(i => i !== null && typeof i === "object" && !Array.isArray(i))
      || !(report.fix === null || (typeof report.fix === "object" && !Array.isArray(report.fix)))
      || typeof report.summary !== "string") return p;
    const hidden = issues.some(i => object(i).hidden === true);
    const fixState: FixState = hidden ? "hidden_after_feedback" : report.fix ? "shown" : issues.length ? "not_confident" : "none_found";
    return { ...p, analysisState: fixState === "shown" ? "supported_finding" : "no_supported_issue", fixState,
      strengthsState: report.strengths.length ? "shown" : "none_found", summaryState: hidden ? "replaced_after_feedback" : "shown",
      // Baseline phase times are not source-frame positions (§7.4.1), so a normal report names no moment.
      familyReason: null, momentLabel: null };
  } catch { return fallback; }
}

/** storedIssueFindings contains only issue-kind findings from the persisted run,
 * with the linked issue's hidden/review_status flags. No confidence is consulted. */
export function experimentalPresentation(input: unknown): ReportPresentation {
  const fallback = base("experimental_v2", "unknown");
  try {
    const { report: raw, storedIssueFindings } = object(input), report = object(raw);
    const p = base("experimental_v2", report.outcome);
    p.reasonCodes = [...new Set((Array.isArray(report.reasons) ? report.reasons : [])
      .map(r => object(r).code).filter((c): c is string => typeof c === "string"))];
    p.momentLabel = Array.isArray(report.events) && report.events.some(e => object(e).id === "impact_estimate") ? "impact_estimate" : null;
    const findings = Array.isArray(report.findings) ? report.findings : [];
    switch (report.outcome) {
      case "processing": p.analysisState = "processing"; p.familyReason = null; break;
      case "findings":
        p.analysisState = typeof report.suppressedCount === "number" && report.suppressedCount > 0 ? "limited" : "supported_finding";
        p.fixState = findings.some(f => object(f).kind === "issue") ? "shown"
          : p.reasonCodes.includes("PREVIOUSLY_HIDDEN") || (Array.isArray(storedIssueFindings) && storedIssueFindings.some(f =>
            object(f).hidden === true || ["hidden", "rejected"].includes(String(object(f).review_status))))
            ? "hidden_after_feedback" : "withheld_evidence";
        break;
      case "no_supported_issue":
        p.analysisState = typeof report.suppressedCount === "number" && report.suppressedCount > 0 ? "limited" : "no_supported_issue";
        p.fixState = "none_found"; break;
      case "insufficient_evidence": p.analysisState = "insufficient_evidence"; p.fixState = "withheld_evidence"; break;
      case "withheld": p.analysisState = "insufficient_evidence"; p.familyReason = "evidence_unsupported"; break;
      case "not_assessable": p.analysisState = "unable_to_analyze"; break;
      case "analysis_not_enabled": p.analysisState = "unable_to_analyze"; p.familyReason = "not_enabled"; break;
    }
    if (["findings", "no_supported_issue", "insufficient_evidence"].includes(String(report.outcome))) {
      p.familyReason = null;
      p.strengthsState = findings.some(f => object(f).kind === "strength") ? "shown" : "none_found";
      p.summaryState = typeof report.summary === "string" && report.summary ? "shown" : "not_applicable";
    }
    p.limited = p.analysisState === "limited";
    return p;
  } catch { return fallback; }
}
