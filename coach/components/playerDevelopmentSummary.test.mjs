import test from "node:test";
import assert from "node:assert/strict";
import {
  DEFAULT_CAPTURE_GUIDANCE,
  derivePlayerDevelopmentSummary,
  hasPublishedMetrics,
  reviewFindingState,
} from "./playerDevelopmentSummary.js";

const verified = (slug, label, note) => ({ score: 3, review_status: "verified", notes: note, checkpoints: { slug, label } });
const insufficient = (slug, label) => ({ score: null, review_status: "insufficient_evidence", checkpoints: { slug, label } });

test("player summary exposes only reviewed strengths and keeps sparse state actionable", () => {
  const summary = derivePlayerDevelopmentSummary({
    checklist: [
      verified("stance-setup", "Stance & setup", "Athletic base."),
      verified("load", "Load", "Visible load action."),
      { score: 2, review_status: "verified", notes: "Reviewed but not a positive strength.", checkpoints: { slug: "other", label: "Other" } },
      ...Array.from({ length: 7 }, (_, i) => insufficient(`need-${i}`, `Need ${i}`)),
      { score: 3, review_status: "draft", notes: "Unreviewed", checkpoints: { slug: "draft", label: "Draft" } },
      { score: null, review_status: "rejected", notes: "Rejected", checkpoints: { slug: "extension", label: "Extension" } },
    ],
  });
  assert.deepEqual(summary.strengths.map((row) => row.label), ["Stance & setup", "Load"], "the checkpoint names, never an invented characterization");
  assert.deepEqual(summary.strengths.map((row) => row.scoreWord), ["On Target", "On Target"]);
  assert.equal(summary.currentPriority, null);
  assert.equal(summary.recommendedDrill, null);
  assert.equal(summary.needsBetterEvidence.length, 7);
  assert.equal(summary.nextStep, DEFAULT_CAPTURE_GUIDANCE);
  assert.doesNotMatch(JSON.stringify(summary), /Unreviewed|Rejected/);
});

test("player summary preserves a real priority and its active drill", () => {
  const priority = { id: "p1", title: "Confirmed focus", status: "active" };
  const drill = { player_priority_id: "p1", active: true, drill_library: { name: "Real drill" } };
  const summary = derivePlayerDevelopmentSummary({ priorities: [priority], assignments: [drill] });
  assert.equal(summary.currentPriority, priority);
  assert.equal(summary.recommendedDrill, drill);
  assert.equal(summary.nextStep, null);
});

test("review states distinguish unanalyzed, analyzed-empty, and real findings", () => {
  assert.equal(reviewFindingState(), "unanalyzed");
  assert.equal(reviewFindingState({ hasAnalysisRun: true }), "analyzed-empty");
  assert.equal(reviewFindingState({ hasAnalysisRun: true, issues: [{ review_status: "draft" }] }), "findings");
});

test("metrics require published numeric values", () => {
  assert.equal(hasPublishedMetrics({ analysis_quality: {}, movement_flags: {} }), false);
  assert.equal(hasPublishedMetrics({ attack_angle_at_contact_deg: 12 }), true);
});
