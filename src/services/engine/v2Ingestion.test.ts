import test from "node:test";
import assert from "node:assert/strict";
import { assertV2IngestionRoute, v2IngestionPlan, M1_PHASES } from "./v2Ingestion.js";
import { V2_IDENTITY } from "./engineSelection.js";
import { swingDetectionState } from "../development/swingDetection.js";

test("v2 plan clears prior summaries, uses PTS duration, and requires every phase", () => {
  const metrics = { ...V2_IDENTITY, phases: Object.fromEntries(M1_PHASES.map(p => [p,
    { frame: null, time_s: null, reason: "not_produced_in_m1" }])), swing_detection: { status: "not_produced", confidence: null } };
  const pose = { meta: { ...V2_IDENTITY, fps: 30 }, frames: [{ time_s: 5 }, { time_s: 5.2 }, { time_s: 5.6 }] };
  const plan = v2IngestionPlan(metrics, pose);
  assert.equal(plan.deleteSummary, true);
  assert.equal(plan.clipMetadata.n_frames, 3);
  assert.ok(Math.abs(plan.clipMetadata.duration_s! - .6) < 1e-9);
  assert.equal(swingDetectionState(metrics), "inconclusive");
  for (const slug of M1_PHASES) {
    assert.throws(() => v2IngestionPlan({ ...metrics, phases: { ...metrics.phases, [slug]: undefined } }, pose));
    assert.throws(() => v2IngestionPlan({ ...metrics, phases: { ...metrics.phases, [slug]: { frame: 0, time_s: 0 } } }, pose));
  }
});

test("M3 phases preserve source time and method; candidate states never confirm a take", () => {
  assert.equal(V2_IDENTITY.pipeline_version, "hitterloop-v2-exp-0.3.0");
  const phases = Object.fromEntries(M1_PHASES.map(p => [p, { frame: null, time_s: null, reason: "NO_SWING_CANDIDATE" }]));
  const pose = { meta: { ...V2_IDENTITY, fps: 30 }, frames: [{ frame: 4, time_s: -.25 }, { frame: 8, time_s: .125 }] };
  const metrics = { ...V2_IDENTITY, phases, swing_detection: { status: "no_swing_candidate", confidence: "low" } };
  assert.equal(swingDetectionState(metrics), "inconclusive");
  const available = { frame: 8, time_s: .125, method: "v2:impact_estimate", reason: null };
  const withPhase = { ...metrics, phases: { ...phases, contact: available } };
  assert.doesNotThrow(() => v2IngestionPlan(withPhase, pose));
  assert.equal(swingDetectionState(withPhase), "readable");
  for (const bad of [
    { ...available, frame: 1 }, { ...available, frame: 8.5 }, { ...available, frame: "8" },
    { ...available, time_s: .12501 }, { ...available, time_s: NaN },
    { ...available, method: "baseline" }, { ...available, method: null },
    { frame: null, time_s: null }, { frame: null, time_s: .125, reason: "missing" },
    { frame: null, time_s: null, reason: "missing", method: "v2:impact_estimate" },
  ]) assert.throws(() => v2IngestionPlan({ ...metrics, phases: { ...phases, contact: bad } }, pose));
  assert.throws(() => v2IngestionPlan({ ...withPhase, pipeline_version: "stale" }, pose));
  assert.throws(() => v2IngestionPlan(withPhase, { ...pose, meta: {} }));
});

test("v2 artifacts cannot be ingested outside the worker v2 path", () => {
  assert.throws(() => assertV2IngestionRoute({ ...V2_IDENTITY }), /worker v2 path/);
  assert.doesNotThrow(() => assertV2IngestionRoute({ ...V2_IDENTITY }, "clip-id"));
  assert.doesNotThrow(() => assertV2IngestionRoute({ pipeline_version: "pose3d-live-1.0.0" }));
});
