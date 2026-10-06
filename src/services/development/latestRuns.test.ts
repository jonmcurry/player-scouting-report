import test from "node:test";
import assert from "node:assert/strict";
import { belongsToRun, hasIssueEvidence, hasReportEvidence, latestRunsByClip } from "./latestRuns.js";

test("newest incomplete run replaces an older complete run for the same clip", () => {
  const rows = [
    { id: "new", video_clip_id: "clip", summary: null },
    { id: "other", video_clip_id: "other-clip", summary: "Current" },
    { id: "old", video_clip_id: "clip", summary: "Stale claim" },
  ];
  const latest = latestRunsByClip(rows);
  assert.equal(latest.get("clip")?.id, "new");
  assert.equal(latest.get("clip")?.summary, null);
  assert.equal(latest.get("other-clip")?.id, "other");
});

test("a summary alone cannot make an incomplete run count as a clean swing", () => {
  const valid = { summary: "Balanced setup.", strengths: [{ text: "Balanced", evidence: "Stance still", phase: "stance" }] };
  assert.equal(hasReportEvidence(valid), true);
  assert.equal(hasReportEvidence({ ...valid, strengths: [] }), true);
  assert.equal(hasReportEvidence({ ...valid, strengths: null }), false);
  assert.equal(hasReportEvidence({ ...valid, strengths: [{ ...valid.strengths[0], evidence: "" }] }), false);
  assert.equal(hasReportEvidence({ ...valid, strengths: [{ ...valid.strengths[0], phase: "invented_phase" }] }), false);
  assert.equal(hasReportEvidence({ ...valid, summary: null }), false);
});

test("feedback from an older run cannot dispute a newer report or feed claim", () => {
  const current = { id: "new" };
  assert.equal(belongsToRun({ analysis_run_id: "old" }, current), false);
  assert.equal(belongsToRun({ analysis_run_id: "new" }, current), true);
  assert.equal(belongsToRun({ analysis_run_id: "old" }, null), false);
});

test("stored findings need complete nonblank copy before supporting a claim", () => {
  const complete = { issue: "Late load", evidence: "Hands move after stride", coachingCue: "Start earlier", lookForNext: "Load before step" };
  assert.equal(hasIssueEvidence(complete), true);
  for (const field of Object.keys(complete)) assert.equal(hasIssueEvidence({ ...complete, [field]: " " }), false);
  assert.equal(hasIssueEvidence({ ...complete, evidence: null }), false);
});
