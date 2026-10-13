import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
import { assessStrictBaseline, strictEngineVersionForComparison, type ClipEvidenceSignals, type StrictRule } from "./strictBaseline.ts";
import { assessSubject, simulateSubject, SUBJECT_THRESHOLDS } from "./subject.ts";
import { isIdentityJump, SUBJECT_SPATIAL_RULE } from "./subjectPolicy.ts";
import { subjectBoxOverFrames, type Pose2dFrame } from "../../pose3d/subjectBox.ts";
import { BASELINE_ENGINE, EVIDENCE_REGISTRY } from "../evidenceRegistry.ts";
import { parseAnalysisFlags } from "../../config/analysisFlags.ts";

function signals(): ClipEvidenceSignals {
  return { engineVersion: "baseline-1.0.0",
    batterSelection: { usedFallback: false, trackFrames: 250, batEvidenceFrames: 5 },
    contact: { frame: 0, confidence: "high" }, phases: {},
    swingWindow: { frames: 20, batterTrackedFraction: 0.9, identityJumpFraction: 0.05,
      coreKeypointFraction: 0, batDetectedFraction: 0 },
    aiInputs: { phaseStills: [], zooms: ["zoom_contact"], sequenceFrames: 0, sequenceSkipped: "synthetic" },
    captureProfile: null };
}
const subject = { usedFallback: false, batEvidenceFrames: 5, trackFrames: 250,
  trackedFraction: 0.9, identityJumpFraction: 0.05, batterCropAvailable: true, windowAvailable: true };
const cases: { rule: StrictRule; change: (s: ClipEvidenceSignals) => void; reason: string; family: string | null }[] = [
  { rule: "G1", change: s => { s.batterSelection.usedFallback = true; }, reason: "batter_selection_fallback", family: "batter_unclear" },
  { rule: "G2", change: s => { s.batterSelection.batEvidenceFrames = 4; }, reason: "insufficient_bat_holding_evidence", family: "batter_unclear" },
  { rule: "G3", change: s => { s.contact.frame = null; }, reason: "contact_not_located", family: "swing_unclear" },
  { rule: "G4", change: s => { s.contact.confidence = "low"; }, reason: "contact_low_confidence", family: "swing_unclear" },
  { rule: "G5", change: s => { s.swingWindow!.batterTrackedFraction = 0.899999; }, reason: "batter_not_tracked_in_swing", family: "swing_unclear" },
  { rule: "G6", change: s => { s.swingWindow!.identityJumpFraction = 0.050001; }, reason: "possible_identity_switch", family: "batter_unclear" },
  { rule: "G7", change: s => { s.aiInputs.zooms = ["zoom_extension"]; }, reason: "no_batter_crop", family: "batter_unclear" },
  { rule: "G8", change: s => { s.engineVersion = "unknown"; }, reason: "engine_unknown", family: null },
];
test("original fixture: exact boundaries pass, no sequence/still/3D requirements added", () => {
  const s = signals(), result = assessStrictBaseline(s);
  assert.equal(result.status, "eligible"); assert.equal(result.evaluated, true);
  assert.equal(result.version, "strict-0.1.0"); assert.equal(result.approvedForProduction, false);
  assert.equal(result.scope, "shadow_comparator_only"); assert.deepEqual(result.reasons, []);
  assert.equal(result.familyReason, null); assert.deepEqual(result.signals, s);
  assert.equal(result.requiredBatEvidenceFrames, 5);
});
for (const row of cases) test(`original ${row.rule} predicate and family mapping`, () => {
  const s = signals(); row.change(s); const result = assessStrictBaseline(s);
  assert.equal(result.status, "withhold"); assert.equal(result.evaluated, true);
  assert.deepEqual(result.failedRules, [row.rule]); assert.deepEqual(result.reasons, [row.reason]);
  assert.equal(result.familyReason, row.family);
  assert.deepEqual(result.unmappedFamilyRules, row.rule === "G8" ? ["G8"] : []);
});
test("all 256 combined-rule masks preserve predicates, mappings and G1-G8 ordering", () => {
  for (let mask = 0; mask < 256; mask++) {
    const s = signals(), selected = cases.filter((_, i) => mask & (1 << i));
    selected.forEach(row => row.change(s));
    const result = assessStrictBaseline(s);
    assert.deepEqual(result.failedRules, selected.map(r => r.rule));
    assert.deepEqual(result.reasons, selected.map(r => r.reason));
    assert.deepEqual(result.familyReasons, [...new Set(selected.map(r => r.family).filter(v => v !== null))]);
    assert.equal(result.familyReason, result.familyReasons[0] ?? null);
    assert.equal(result.status, mask ? "withhold" : "eligible");
  }
});
test("G2 max floor, crossover, exact proportional boundary, and no rounding", () => {
  for (const [tracks, bats, expected] of [[249, 5, true], [250, 5, true], [251, 5, false],
    [251, 6, true], [500, 9, false], [500, 10, true], [500, 11, true]]) {
    const s = signals(); s.batterSelection.trackFrames = tracks as number; s.batterSelection.batEvidenceFrames = bats as number;
    assert.equal(assessStrictBaseline(s).status === "eligible", expected);
    assert.equal(assessSubject({ ...subject, trackFrames: tracks, batEvidenceFrames: bats }).status === "pass", expected);
  }
});
test("G5/G6 adjacent boundary values and null window", () => {
  for (const v of [0.9 - Number.EPSILON, 0.9, 0.9 + Number.EPSILON]) {
    const s = signals(); s.swingWindow!.batterTrackedFraction = v;
    assert.equal(assessStrictBaseline(s).status === "eligible", v >= 0.9);
    assert.equal(assessSubject({ ...subject, trackedFraction: v }).status === "pass", v >= 0.9);
  }
  for (const v of [0.05 - Number.EPSILON, 0.05, 0.05 + Number.EPSILON]) {
    const s = signals(); s.swingWindow!.identityJumpFraction = v;
    assert.equal(assessStrictBaseline(s).status === "eligible", v <= 0.05);
    assert.equal(assessSubject({ ...subject, identityJumpFraction: v }).status === "pass", v <= 0.05);
  }
  const s = signals(); s.swingWindow = null;
  const result = assessStrictBaseline(s);
  assert.deepEqual(result.failedRules, ["G5"]); assert.deepEqual(result.reasons, ["swing_window_unavailable"]);
});
test("G4 null confidence fails; G7 requires exact zoom_contact token", () => {
  const s = signals(); s.contact.confidence = null;
  assert.deepEqual(assessStrictBaseline(s).failedRules, ["G4"]);
  for (const name of ["phase_contact", "zoom_contact.png", "zoom_contact ", "Zoom_contact"]) {
    const s = signals(); s.aiInputs.zooms = [name];
    assert.deepEqual(assessStrictBaseline(s).failedRules, ["G7"]);
  }
});
test("historical engine semantics are unchanged; explicit name projection grants no approval", () => {
  const s = signals(); s.engineVersion = BASELINE_ENGINE;
  assert.deepEqual(assessStrictBaseline(s).failedRules, ["G8"]);
  s.engineVersion = strictEngineVersionForComparison(s.engineVersion)!;
  assert.equal(assessStrictBaseline(s).status, "eligible");
  for (const value of [undefined, null, "", "pose3d-live-1.0.0", "engine-baseline-1.0.1", "baseline-1.0.1"]) {
    assert.equal(strictEngineVersionForComparison(value), null);
  }
  assert.equal(parseAnalysisFlags().engine, BASELINE_ENGINE);
  assert.throws(() => parseAnalysisFlags({ ANALYSIS_ENGINE: "baseline-1.0.0" }));
  assert.ok(EVIDENCE_REGISTRY.every(entry => entry.status !== "enforced"));
});
test("original null-input acceptance: withhold with swing_window_unavailable", () => {
  for (const value of [null, undefined]) {
    const r = assessStrictBaseline(value);
    assert.equal(r.status, "withhold"); assert.equal(r.evaluated, false);
    assert.deepEqual(r.reasons, ["swing_window_unavailable"]); assert.equal(r.familyReason, "swing_unclear");
  }
});
test("malformed consulted values never pass or become a valid measured comparison", () => {
  for (const value of [[], {}, "signals", 0]) assert.equal(assessStrictBaseline(value).status, "withhold");
  const paths = [["batterSelection", "usedFallback"], ["batterSelection", "trackFrames"],
    ["batterSelection", "batEvidenceFrames"], ["swingWindow", "batterTrackedFraction"],
    ["swingWindow", "identityJumpFraction"], ["aiInputs", "zooms"]];
  for (const [section, field] of paths) for (const value of [undefined, null, NaN, Infinity, "1", {}, -1]) {
    const s: any = signals(); s[section!][field!] = value;
    const r = assessStrictBaseline(s); assert.equal(r.status, "withhold"); assert.equal(r.evaluated, false);
    assert.ok(r.invalidSignals.includes(`${section}.${field}`));
  }
});
test("V1 applies subject rules only; contact-specific rules never become universal prerequisites", () => {
  const s = { ...subject, contact: { frame: null, confidence: "low" }, zooms: [], engineVersion: "unknown",
    coreKeypointFraction: 0, batDetectedFraction: 0 };
  assert.equal(assessSubject(s).status, "pass");
  assert.deepEqual(assessSubject({ ...s, usedFallback: true }).reasons, ["batter_selection_fallback"]);
  assert.deepEqual(assessSubject({ ...s, batterCropAvailable: false }).reasons, ["no_batter_crop"]);
  assert.deepEqual(assessSubject({ ...s, windowAvailable: false }).reasons, ["window_unavailable"]);
});
test("unspecified numeric V1 policy still fails closed, never filled by a synthetic default", () => {
  for (const field of ["minBatEvidenceFrames", "minBatEvidenceFraction", "minTrackedFraction", "maxIdentityJumpFraction"]) {
    const result = simulateSubject(subject, { ...SUBJECT_THRESHOLDS, [field]: null });
    assert.equal(result.assessment.status, "fail");
    assert.ok(result.assessment.reasons.includes("subject_thresholds_unavailable"));
  }
  assert.equal(assessSubject(subject).status, "pass");
});
test("MAX_JUMP is exactly anchor-centre distance > 1.0 times anchor height", () => {
  const anchor = { cx: 100, cy: 105, h: 10 };
  assert.equal(isIdentityJump({ cx: 110, cy: 105 }, anchor), false);
  assert.equal(isIdentityJump({ cx: 110.00001, cy: 105 }, anchor), true);
  assert.equal(isIdentityJump({ cx: 100, cy: 115 }, anchor), false);
  assert.equal(isIdentityJump({ cx: 100, cy: 116 }, anchor), true);
  assert.equal(isIdentityJump({ cx: NaN, cy: 105 }, anchor), null);
  assert.equal(isIdentityJump({ cx: 100, cy: 105 }, { ...anchor, h: 0 }), null);
  const pose = (frame: number, dx: number): Pose2dFrame => ({ frame,
    keypoints: Array.from({ length: 8 }, (_, i) => [100 + dx, 100 + (i % 2) * 10, 0.3]) });
  const base = subjectBoxOverFrames([pose(0, 0)], [], 0, 1, 1000, 1000);
  const boundary = subjectBoxOverFrames([pose(0, 0), pose(1, 10)], [], 0, 1, 1000, 1000);
  const outside = subjectBoxOverFrames([pose(0, 0), pose(1, 10.00001)], [], 0, 1, 1000, 1000);
  assert.notDeepEqual(boundary, base); assert.deepEqual(outside, base);
  const source = readFileSync("src/services/pose3d/subjectBox.ts", "utf8");
  assert.match(source, /const MAX_JUMP = 1\.0;/);
  assert.match(source, /Math\.hypot\(cx - anchor\.cx, cy - anchor\.cy\) > MAX_JUMP \* anchor\.h/);
  assert.match(source, /const KEYPOINT_MIN_CONF = 0\.3;/); assert.match(source, /const MIN_RELIABLE_KEYPOINTS = 8;/);
  assert.equal(SUBJECT_SPATIAL_RULE.maxJumpBodyHeights, 1);
});
test("comparison and V1 are deterministic, input-preserving and 3D-independent", () => {
  const s = signals(), snapshot = structuredClone(s), r = assessStrictBaseline(s);
  assert.deepEqual(r, assessStrictBaseline(s)); assert.deepEqual(s, snapshot);
  const degraded = { ...s, pose3d_coverage: 0, reconstruction_reliable: false,
    analysis_quality: { reconstruction: "failed" }, elbowAngle: NaN };
  const { signals: originalSignals, ...a } = r;
  const { signals: degradedSignals, ...b } = assessStrictBaseline(degraded);
  assert.deepEqual(a, b); assert.deepEqual(degradedSignals, degraded);
  assert.deepEqual(assessSubject(subject), assessSubject({ ...subject, ...degraded }));
});
