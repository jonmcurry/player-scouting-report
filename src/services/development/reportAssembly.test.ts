import test from "node:test";
import assert from "node:assert/strict";
import { assembleReport, plainFailureReason, type ReportIssue } from "./reportAssembly.js";

const issue: ReportIssue = { id: "i1", concept: "load", phase: "load", basis: "video", confidence: "medium",
  contextExplainsIt: false, emergencySwingSuspected: false, hidden: false, issue: "Starts late", evidence: "Load begins after stride",
  coachingCue: "Start early", lookForNext: "Load before the step" };
const base = { run: { id: "r1", summary: "She sets up well and starts the load late.", strengths: [{ text: "Balanced setup", evidence: "Stance frame", phase: "stance" }] },
  issues: [issue], drills: [], qualityPassed: true, currentFocus: null, drillContext: { sport: "softball" as const, age: 12 } };

test("report uses stored run and shows at most one qualifying fix", () => {
  const report = assembleReport(base);
  assert.equal(report.state, "ready");
  if (report.state === "ready") { assert.equal(report.fix?.id, "i1"); assert.deepEqual(report.strengths, ["Balanced setup"]); assert.deepEqual(report.drills, []); }
});

test("hidden and low confidence fixes fail closed", () => {
  const hidden = assembleReport({ ...base, issues: [{ ...issue, hidden: true }] });
  const low = assembleReport({ ...base, issues: [{ ...issue, confidence: "low" }] });
  assert.equal(hidden.state, "ready");
  if (hidden.state === "ready") {
    assert.equal(hidden.fix, null);
    assert.doesNotMatch(hidden.summary, /starts the load late/i);
  }
  if (low.state === "ready") assert.equal(low.fix, null);
});

test("a hidden first fix does not reveal another candidate from the disputed run", () => {
  const report = assembleReport({ ...base, issues: [{ ...issue, hidden: true }, { ...issue, id: "i2", concept: "posture" }] });
  if (report.state === "ready") assert.equal(report.fix, null);
});

test("historical run without simplified output is not shown", () => {
  assert.equal(assembleReport({ ...base, run: { ...base.run, summary: null } }).state, "unreadable");
  const report = assembleReport({ ...base, run: { ...base.run, strengths: [] } });
  assert.equal(report.state, "ready");
  if (report.state === "ready") assert.deepEqual(report.strengths, []);
});

test("a failed quality gate never shows a partial summary or strength", () => {
  assert.equal(assembleReport({ ...base, qualityPassed: false }).state, "unreadable");
});

test("internal failure details never leak into parent copy", () => {
  assert.equal(plainFailureReason("GCS token abc123 expired"), "We couldn't analyze this video.");
  assert.match(plainFailureReason("batter not found: /tmp/private.mp4"), /batter clearly/);
});
