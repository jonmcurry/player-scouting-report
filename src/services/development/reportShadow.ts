/** Read-only, diagnostic shadow observation. No production authorization exists before calibration. */
export interface ReportShadowAssessment {
  clip_status: unknown; family_reason: unknown; mode: unknown; reliability_profile_version: unknown;
}
export interface ReportShadowDecision {
  assessment: "present" | "absent" | "error";
  wouldWithhold: boolean | null; wouldHideFix: boolean | null; reliability: "unmeasured";
}
export function reportShadowDecision(input: {
  assessment: ReportShadowAssessment | null; assessmentError: boolean;
  fixIssueId: string | null; fixClaimDecision: unknown | null;
}): ReportShadowDecision {
  return { assessment: input.assessmentError ? "error" : input.assessment ? "present" : "absent",
    wouldWithhold: input.assessmentError ? null : input.assessment?.clip_status === "withhold" ? true
      : input.assessment?.clip_status === "eligible" ? false : null,
    // A stored Boolean cannot authorize a claim: requirements remain proposed and V4 unmeasured.
    wouldHideFix: input.fixIssueId !== null, reliability: "unmeasured" };
}
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
export function reportShadowLogLine(clipId: string, decision: ReportShadowDecision): string {
  const value = (v: boolean | null) => v === null ? "unknown" : String(v);
  return `[report-shadow] clip=${UUID.test(clipId) ? clipId : "invalid"} assessment=${decision.assessment} would_withhold=${value(decision.wouldWithhold)} would_hide_fix=${value(decision.wouldHideFix)} reliability=unmeasured`;
}
type ReadResult<T> = { data: T | null; error: unknown };
const object = (v: unknown): Record<string, unknown> => v !== null && typeof v === "object" && !Array.isArray(v)
  ? v as Record<string, unknown> : {};
export async function runReportShadow(deps: {
  mode: string; clipId: string; report: unknown;
  readAssessment: () => PromiseLike<ReadResult<ReportShadowAssessment>>;
  readFixDecision: (issueId: string) => PromiseLike<ReadResult<{ claim_decision: unknown }>>;
  log: (line: string) => void; timeoutMs?: number;
}): Promise<void> {
  if (deps.mode !== "shadow") return;
  let timer: ReturnType<typeof setTimeout> | undefined;
  let finished = false;
  try {
    const fixId = object(object(deps.report).fix).id;
    const fixIssueId = typeof fixId === "string" && fixId.length > 0 ? fixId : null;
    const observe = async (): Promise<ReportShadowDecision> => {
      const assessment = await deps.readAssessment();
      if (finished) return reportShadowDecision({ assessment: null, assessmentError: true, fixIssueId, fixClaimDecision: null });
      const fix = fixIssueId === null ? null : await deps.readFixDecision(fixIssueId);
      const decision = reportShadowDecision({ assessment: assessment.data, assessmentError: !!assessment.error,
        fixIssueId, fixClaimDecision: fix?.error ? null : fix?.data?.claim_decision ?? null });
      if (fix?.error) decision.wouldHideFix = null;
      return decision;
    };
    const ms = deps.timeoutMs === undefined || !Number.isFinite(deps.timeoutMs) ? 1500 : Math.max(0, deps.timeoutMs);
    const fallback: ReportShadowDecision = { assessment: "error", wouldWithhold: null,
      wouldHideFix: fixIssueId === null ? false : null, reliability: "unmeasured" };
    const decision = await Promise.race([observe().catch(() => fallback), new Promise<ReportShadowDecision>(resolve => {
      timer = setTimeout(() => resolve(fallback), ms);
    })]);
    finished = true;
    deps.log(reportShadowLogLine(deps.clipId, decision));
  } catch {
    // Logging failures cannot escape into the response path.
  } finally {
    finished = true;
    clearTimeout(timer);
  }
}
