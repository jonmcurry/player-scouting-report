import { test } from "node:test";
import assert from "node:assert/strict";
import { buildExperimentalReport, type ExperimentalV2Row } from "./experimentalV2Report.js";

const row: ExperimentalV2Row = {
  video_clip_id: "clip", engine: "v2-exp", pipeline_version: "test", outcome: "findings",
  reason_codes: [], suppressed_count: 0, retry_eligible: false, analysis_run_id: "run",
  events: [{ id: "impact_estimate", timeS: 1, seekS: 1.02, observation: "direct", estimate: true }],
  findings: [
    { kind: "strength", issueId: null, index: 0, claimType: "direct_observation", supportingEvents: ["impact_estimate"], phase: "contact" },
    { kind: "issue", issueId: "issue", index: 0, claimType: "qualified_interpretation", supportingEvents: ["impact_estimate"], phase: "contact" },
  ],
};
const run = { id: "run", strengths: [{ text: "Steady head", evidence: "Head stays level", confidence: 0.99, path: "private" }] };
const issue = { id: "issue", analysis_run_id: "run", review_status: "draft", issue: "Shoulder opens",
  evidence: "Shoulder is turned", coaching_cue: "Stay closed", look_for_next: "Closed shoulder", confidence: "high", prompt: "private" };
const build = (patch: Partial<ExperimentalV2Row> = {}, issues = [issue], selectedRun: typeof run | null = run, clipStatus = "ready") =>
  buildExperimentalReport({ row: { ...row, ...patch }, clipStatus, issues, run: selectedRun });

test("read model allowlists fields, labels estimates and binds findings to evidence", () => {
  const report = build();
  assert.equal(report.label, "Experimental analysis — not yet validated");
  assert.equal(report.findings.length, 2);
  assert.equal(report.findings[1]!.claimLabel, "Qualified interpretation");
  assert.equal(report.events[0]!.label, "Estimated hitting moment");
  assert.equal(report.events[0]!.estimate, true);
  assert.equal(report.events[0]!.seekS, 1.02);
  assert.doesNotMatch(JSON.stringify(report), /confidence|private|prompt|path/);
});
test("hidden, rejected, missing and wrong-run issues never reappear", () => {
  for (const review_status of ["hidden", "rejected"]) assert.equal(build({}, [{ ...issue, review_status }]).findings.length, 1);
  assert.equal(build({}, []).findings.length, 1);
  assert.equal(build({}, [{ ...issue, analysis_run_id: "old" }]).findings.length, 1);
  assert.equal(build({}, [issue], { ...run, id: "old" }).findings.length, 0);
  assert.equal(build({}, [issue], null).findings.length, 0);
  assert.equal(build({ events: [] }).findings.length, 0);
});
test("interrupted processing becomes a retryable failure; retry clears old findings from view", () => {
  const failed = build({ outcome: "processing" }, [issue], run, "failed");
  assert.equal(failed.outcome, "analysis_failed");
  assert.equal(failed.retryEligible, true);
  assert.equal(failed.findings.length, 0);
  assert.equal(failed.reasons[0]!.code, "AI_ANALYSIS_FAILED");
  assert.equal(build({ outcome: "processing" }).findings.length, 0);
  // Still held by the worker: processing, not a failure. Released while still "processing": interrupted.
  const held = build({ outcome: "processing" }, [issue], run, "processing");
  assert.deepEqual([held.outcome, held.retryEligible], ["processing", false]);
  const released = build({ outcome: "processing" }, [issue], run, "ready");
  assert.deepEqual([released.outcome, released.retryEligible], ["analysis_failed", true]);
});
test("every outcome has a headline and every reason has plain English, including unknown codes", () => {
  for (const outcome of ["processing", "not_assessable", "analysis_not_enabled", "findings",
    "no_supported_issue", "insufficient_evidence", "withheld", "analysis_failed"] as const) {
    const report = build({ outcome, reason_codes: ["NUMERIC_CLAIM", "FRAME_MAPPING_UNAVAILABLE", "FUTURE_CODE"] }, [issue], run, "processing");
    assert.ok(report.headline);
    assert.ok(report.reasons.every(r => r.text.length > 20 && !r.text.includes(r.code)));
    assert.equal(report.retryEligible, false);
  }
});
test("a withheld run attributes its text reasons to the summary, not to a finding", () => {
  const withheld = build({ outcome: "withheld", reason_codes: ["SUMMARY_UNSUPPORTED_CLAIM", "NUMERIC_CLAIM"] }, [issue], run, "ready");
  assert.deepEqual(withheld.reasons.map(r => r.text), ["The summary made an unsupported claim, so the analysis was withheld.",
    "The summary stated a measurement the analysis cannot support."]);
  assert.match(build({ outcome: "insufficient_evidence", reason_codes: ["NUMERIC_CLAIM"] }).reasons[0]!.text, /^A finding/);
});
