import test from "node:test";
import assert from "node:assert/strict";
import { baselinePresentation as baseline, experimentalPresentation as experimental, FAILURE_FAMILY_REASONS } from "./reportPresentation.ts";
import { plainFailureReason } from "./reportAssembly.ts";
import { buildExperimentalReport, type ExperimentalV2Row } from "./experimentalV2Report.ts";
const ready = { state: "ready", summary: "Visible swing.", strengths: ["Balanced setup"], fix: null };
const b = (report: unknown = ready, issues: unknown = []) => baseline({ status: "ready", report, issues });
const e = (outcome: string, extra = {}, storedIssueFindings: unknown = []) => experimental({ report: {
  outcome, findings: [], events: [], reasons: [], summary: null, suppressedCount: 0, ...extra }, storedIssueFindings });
test("baseline pending and every failure family use producer sentences", () => {
  for (const status of ["pending", "processing"]) assert.equal(baseline({ status }).analysisState, "processing");
  for (const [internal, reason] of [["batter", "batter_unclear"], ["no swing", "swing_unclear"], ["too short", "clip_too_short"], ["blur", "video_blurry"], ["3-minute upload limit", "duration_limit"], ["unexpected", "unknown"]]) {
    const sentence = plainFailureReason(internal);
    assert.equal(FAILURE_FAMILY_REASONS[sentence], reason);
    const p = baseline({ status: "failed", report: { reason: sentence } });
    assert.equal(p.familyReason, reason);
    assert.equal(p.analysisState, reason === "unknown" ? "technical_failure" : "unable_to_analyze");
    assert.equal(p.fixState, "not_applicable"); assert.equal(p.momentLabel, null);
  }
});
test("baseline ready sections distinguish shown, hidden, not confident and absent", () => {
  for (const [report, issues, fixState] of [[{ ...ready, fix: {} }, [], "shown"], [ready, [{ hidden: true }], "hidden_after_feedback"],
    [ready, [{ hidden: false }], "not_confident"], [ready, [], "none_found"]] as const) {
    const p = b(report, issues);
    assert.equal(p.fixState, fixState); assert.equal(p.analysisState, fixState === "shown" ? "supported_finding" : "no_supported_issue");
    assert.equal(p.summaryState, fixState === "hidden_after_feedback" ? "replaced_after_feedback" : "shown");
    assert.equal(p.strengthsState, "shown"); assert.equal(p.momentLabel, null); assert.equal(p.limited, false);
  }
  assert.equal(b({ ...ready, strengths: [] }).strengthsState, "none_found");
  assert.equal(b({ ...ready, fix: {} }, [{ hidden: true }]).fixState, "hidden_after_feedback");
});
test("non-ready and malformed baseline inputs fail closed", () => {
  for (const [state, analysisState] of [["no_swing", "no_swing"], ["unreadable", "insufficient_evidence"]]) {
    const p = b({ state }); assert.equal(p.analysisState, analysisState); assert.equal(p.familyReason, null);
    for (const key of ["fixState", "strengthsState", "summaryState"] as const) assert.equal(p[key], "not_applicable");
  }
  for (const input of [null, {}, { status: "unknown", report: ready, issues: [] }, { status: "ready", report: null },
    { status: "ready", report: { ...ready, strengths: undefined }, issues: [] }, { status: "ready", report: ready },
    { status: "ready", report: ready, issues: [null] }]) {
    const p = baseline(input); assert.equal(p.analysisState, "technical_failure"); assert.equal(p.familyReason, "unknown");
    assert.equal(p.fixState, "not_applicable");
  }
});
test("experimental outcomes preserve engine result and section applicability", () => {
  for (const [outcome, state, fix, reason] of [
    ["processing", "processing", "not_applicable", null], ["findings", "supported_finding", "withheld_evidence", null],
    ["no_supported_issue", "no_supported_issue", "none_found", null], ["insufficient_evidence", "insufficient_evidence", "withheld_evidence", null],
    ["withheld", "insufficient_evidence", "not_applicable", "evidence_unsupported"], ["not_assessable", "unable_to_analyze", "not_applicable", "unknown"],
    ["analysis_not_enabled", "unable_to_analyze", "not_applicable", "not_enabled"], ["analysis_failed", "technical_failure", "not_applicable", "unknown"],
    ["invalid", "technical_failure", "not_applicable", "unknown"]]) {
    const p = e(outcome!); assert.equal(p.engineOutcome, outcome); assert.equal(p.analysisState, state);
    assert.equal(p.fixState, fix); assert.equal(p.familyReason, reason); assert.equal(p.momentLabel, null);
  }
  for (const input of [null, {}, { report: null }]) assert.equal(experimental(input).analysisState, "technical_failure");
});
test("experimental displayed findings, suppression, hidden flags and lost evidence stay distinct", () => {
  assert.equal(e("findings", { findings: [{ kind: "issue" }] }).fixState, "shown");
  for (const outcome of ["findings", "no_supported_issue"]) {
    const p = e(outcome, { suppressedCount: 2, findings: outcome === "findings" ? [{ kind: "issue" }] : [] });
    assert.equal(p.analysisState, "limited"); assert.equal(p.limited, true);
    assert.equal(p.fixState, outcome === "findings" ? "shown" : "none_found");
  }
  assert.equal(e("findings", { reasons: [{ code: "PREVIOUSLY_HIDDEN" }] }).fixState, "hidden_after_feedback");
  for (const flag of [{ hidden: true }, { review_status: "hidden" }, { review_status: "rejected" }])
    assert.equal(e("findings", {}, [flag]).fixState, "hidden_after_feedback");
  assert.equal(e("findings", {}, [{ hidden: false }]).fixState, "withheld_evidence");
  for (const outcome of ["findings", "no_supported_issue", "insufficient_evidence"]) {
    const p = e(outcome, { summary: "Visible swing", findings: [{ kind: "strength" }], events: [{ id: "impact_estimate" }], reasons: [{ code: "A" }, { code: "A" }, { code: "B" }] });
    assert.equal(p.summaryState, "shown"); assert.equal(p.strengthsState, "shown"); assert.equal(p.momentLabel, "impact_estimate");
    assert.deepEqual(p.reasonCodes, ["A", "B"]);
  }
});
test("read-model integration: interrupted processing and unavailable cited moments", () => {
  const row: ExperimentalV2Row = { video_clip_id: "clip", engine: "experimental_v2", pipeline_version: "test", outcome: "processing",
    reason_codes: [], events: [], findings: [], suppressed_count: 0, analysis_run_id: "run", retry_eligible: false };
  for (const clipStatus of ["failed", "ready"]) {
    const report = buildExperimentalReport({ row, clipStatus, issues: [], run: null });
    assert.equal(experimental({ report }).engineOutcome, "analysis_failed");
    assert.equal(experimental({ report }).analysisState, "technical_failure");
  }
  row.outcome = "findings"; row.findings = [{ kind: "issue", issueId: "issue", index: 0, claimType: "direct_observation", supportingEvents: ["impact_estimate"], phase: null }];
  const issues = [{ id: "issue", analysis_run_id: "run", issue: "Visible issue", evidence: "At impact", hidden: false }];
  const report = buildExperimentalReport({ row, clipStatus: "ready", issues, run: { id: "run", summary: "Visible swing" } });
  assert.equal(report.findings.length, 0);
  assert.equal(experimental({ report, storedIssueFindings: issues }).fixState, "withheld_evidence");
});
test("confidence is never accessed and hostile inputs never throw", () => {
  const issue = { kind: "issue", hidden: false, get confidence() { throw Error("Do not read confidence"); } };
  assert.equal(b(ready, [issue]).fixState, "not_confident");
  assert.equal(e("findings", { findings: [issue] }, [issue]).fixState, "shown");
  const hostile = new Proxy({}, { get() { throw Error("malformed"); } });
  assert.equal(baseline(hostile).analysisState, "technical_failure");
  assert.equal(experimental(hostile).analysisState, "technical_failure");
});
