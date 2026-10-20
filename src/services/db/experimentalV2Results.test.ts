import { test } from "node:test";
import assert from "node:assert/strict";
import { experimentalEvents, experimentalResult, storedExperimentalResult } from "./experimentalV2Results.js";
import { syntheticArtifacts } from "../ai/v2EvidencePackage.fixtures.js";
import type { SwingAnalysisResult } from "../ai/swingAnalysisShared.js";
import type { V2Qualification } from "../engine/v2Coaching.js";

test("event seeks use the frame's absolute PTS plus half the median frame duration, preserving event time", () => {
  // A stream that starts 0.5 s in: the WebView shows frame 8 at 0.5 + 8/30 s, not at 8/30 s.
  const a = syntheticArtifacts();
  const frameMap = { ...a.frameMap, first_pts: 45000, time_base: [1, 90000],
    frames: a.frameMap.frames.map(f => ({ ...f, pts: f.pts + 45000 })) };
  const metrics = { ...a.metrics, events: a.metrics.events.map(e => ({ ...e,
    pts: typeof e.pts === "number" ? e.pts + 45000 : e.pts })) };
  const events = experimentalEvents(metrics, frameMap);
  assert.deepEqual(events.map(e => e.id), ["load_peak_estimate", "impact_estimate", "finish"]);
  assert.ok(Math.abs(events[1]!.seekS - (0.5 + 8.5 / 30)) < 1e-10);
  assert.equal(events[1]!.timeS, 0.266667);
  assert.equal(events[1]!.estimate, true);
  assert.equal(events[0]!.estimate, false);
  assert.deepEqual(experimentalEvents(metrics, {}), []);
});

const citation = { claimType: "direct_observation" as const, supportingEvents: ["load_peak_estimate"], phase: "load" as const };
const result = { strengths: [{ ...citation, text: "Steady load", evidence: "Body centered" }],
  issues: [{ ...citation }, { ...citation }] } as SwingAnalysisResult;
const qualification = { decisions: [
  { kind: "strength", displayed: false, reasons: ["NUMERIC_CLAIM"] },
  { kind: "issue", displayed: false, reasons: ["NUMERIC_CLAIM", "CONTACT_CLAIM"] },
  { kind: "drill", displayed: false, reasons: ["NOT_SUPPORTED_IN_V2"] },
] } as V2Qualification;

test("stored result aligns issue ids, excludes protected issues and counts only suppressed findings", () => {
  const stored = storedExperimentalResult(experimentalResult("clip"), qualification, result, "run", [null, "second"]);
  assert.equal(stored.outcome, "findings");
  assert.equal(stored.analysis_run_id, "run");
  assert.equal(stored.suppressed_count, 2);
  // The first qualified issue matched a finding a coach already hid, so it was not stored again.
  assert.deepEqual(stored.reason_codes, ["NUMERIC_CLAIM", "CONTACT_CLAIM", "PREVIOUSLY_HIDDEN"]);
  assert.deepEqual(stored.findings.map(f => [f.kind, f.issueId, f.index]), [["strength", null, 0], ["issue", "second", 1]]);
  // Qualified issues that all stayed hidden are still supported findings, never "no supported issue".
  const allHidden = storedExperimentalResult(stored, qualification, result, "run", [null, null]);
  assert.deepEqual([allHidden.outcome, allHidden.findings.filter(f => f.kind === "issue").length], ["findings", 0]);
  const noIssues = { ...result, issues: [] } as SwingAnalysisResult;
  assert.equal(storedExperimentalResult(stored, qualification, noIssues, "run", []).outcome, "insufficient_evidence");
  assert.equal(storedExperimentalResult(stored, { ...qualification, decisions: [] }, noIssues, "run", []).outcome, "no_supported_issue");
});
