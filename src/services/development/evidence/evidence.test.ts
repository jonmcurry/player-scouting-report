import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
import { resolve, dirname } from "node:path";
import ts from "typescript";
import { SWING_EVENTS as PR3_EVENTS } from "../../../eval/schema/annotation.ts";
import { translateLegacyPhases as pr3Translate } from "../../../eval/schema/legacyMapping.ts";
import { CONCEPTS } from "../../knowledge/knowledgePack.ts";
import { BASELINE_ENGINE, INITIAL_EVIDENCE_TUPLE, EVIDENCE_REGISTRY } from "../evidenceRegistry.ts";
import { parseAnalysisFlags } from "../../config/analysisFlags.ts";
import { assessSubject, simulateSubject, type SubjectThresholds } from "./subject.ts";
import { assessStrictBaseline } from "./strictBaseline.ts";
import { localiseEvents, emptyEvents } from "./events.ts";
import { translateLegacyPhases, SWING_EVENTS } from "./eventMapping.ts";
import { CLAIM_REQUIREMENTS } from "./claimRequirements.ts";
import { assessSufficiency } from "./sufficiency.ts";
import { lookupReliability } from "./reliability.ts";
import { assessClip } from "./assessClip.ts";
import { decideClaim, simulateClaimDecision } from "./decideClaim.ts";
import type { Concept, EventAssessments, EvidenceEvent, FrameIdentity } from "./types.ts";

const fixture = JSON.parse(readFileSync("src/services/development/evidence/fixtures/baseline.json", "utf8"));
// These numbers exercise a configurable evaluator, NOT recovered Revision 1 thresholds.
const syntheticPolicy: SubjectThresholds = { version: "synthetic-only", minBatEvidenceFrames: 2,
  minBatEvidenceFraction: 0, minTrackedFraction: 0.8, maxIdentityJumpFraction: 0.1 };
const syntheticSubject = (patch = {}) => simulateSubject({ ...fixture.subject, ...patch }, syntheticPolicy).assessment;
function mapFixture(): any {
  return { schema_version: 1, instrumentation_version: "inst-1", verified: true, status: "verified", reasons: [],
    run_id: "1".repeat(32), input_sha256: "2".repeat(64), attempt_number: 1,
    frames: fixture.sourceFrames.map((f: FrameIdentity, i: number) => ({ analysis_index: i,
      raw_frame: f.frame_index, raw_pts: f.pts, raw_time_base: "1/1000", raw_pts_s: f.pts / 1000,
      status: "verified", reasons: [] })) };
}
async function envelope(map = mapFixture(), patch = {}) {
  const frameMapJson = JSON.stringify(map);
  const hash = [...new Uint8Array(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(frameMapJson)))]
    .map(v => v.toString(16).padStart(2, "0")).join("");
  return { frameMapJson, manifest: { schema_version: 1, instrumentation_version: "inst-1",
    engine_code_version: BASELINE_ENGINE, environment_version: INITIAL_EVIDENCE_TUPLE.environmentVersion,
    run_id: "1".repeat(32), input_sha256: "2".repeat(64),
    attempt_number: 1, pose_decoded_frames: 12, bat_decoded_frames: 12, frame_map_sha256: hash, ...patch } };
}
function hypotheticalEvents(): EventAssessments {
  const result = emptyEvents();
  const locations: Partial<Record<EvidenceEvent, number>> = { stance_set: 0, load_start: 1,
    foot_plant: 2, stride_foot_lift: 1, swing_launch: 3, impact_estimate: 5, contact_confirmed: 5,
    extension: 8, finish: 11 };
  for (const [event, i] of Object.entries(locations)) {
    const key = event as EvidenceEvent, identity = fixture.sourceFrames[i];
    result[key] = { ...result[key], status: "pass", rawFrame: identity.frame_index, rawPts: identity.pts,
      rawTimeBase: "1/1000", rawPtsS: identity.pts / 1000, reasons: [] };
  }
  return result;
}
const allParts = { batter: true, bat: true, arms: true, hands: true, feet: true, head: true,
  lower_body: true, torso: true, lead_leg: true };
function evidence(events = hypotheticalEvents()) {
  const stills = Object.fromEntries(Object.entries(events).filter(([, v]) => v.status === "pass")
    .map(([k, v]) => [k, { frame_index: v.rawFrame, pts: v.rawPts }]));
  return { supplied: { stills, zooms: { ...stills }, sequence: structuredClone(fixture.sourceFrames), captureProfile: "game_backstop" },
    visibility: fixture.sourceFrames.map((f: FrameIdentity) => ({ ...f, parts: { ...allParts } })) };
}
const sufficient = (concept: Concept, media = evidence(), events = hypotheticalEvents()) =>
  assessSufficiency(concept, null, media.supplied, media.visibility, events);

test("PR3 vocabulary, frame types and legacy translation remain shared", () => {
  assert.equal(SWING_EVENTS, PR3_EVENTS);
  assert.equal(translateLegacyPhases, pr3Translate);
  const result = translateLegacyPhases({ "phases.load": { frame: 1, time_s: 0.1 }, "phases.contact": { frame: 5, time_s: 0.5 } });
  assert.equal(result.events.load_start.status, "not_produced");
  assert.equal(result.auxiliary.load_peak_estimate.status, "legacy_estimate");
  assert.equal(result.events.contact_confirmed.status, "not_produced");
});
test("recovered subject thresholds pass available evidence without asserting calibration", () => {
  assert.equal(syntheticSubject().status, "pass");
  assert.equal(assessSubject(fixture.subject).status, "pass");
  assert.equal(assessSubject({ ...fixture.subject, trackedFraction: 0.8 }).status, "fail");
});
for (const [patch, reason] of [
  [{ usedFallback: true }, "batter_selection_fallback"],
  [{ batEvidenceFrames: 1 }, "insufficient_bat_holding_evidence"],
  [{ trackedFraction: 0.799 }, "batter_not_tracked_in_window"],
  [{ identityJumpFraction: 0.101 }, "possible_identity_switch"],
  [{ batterCropAvailable: false }, "no_batter_crop"], [{ windowAvailable: false }, "window_unavailable"],
] as const) test(`V1 synthetic policy: ${reason}`, () => { assert.ok(syntheticSubject(patch).reasons.includes(reason)); });
test("V1 inclusive boundaries under explicit hypothetical thresholds", () => {
  assert.equal(syntheticSubject({ batEvidenceFrames: 2, trackedFraction: 0.8, identityJumpFraction: 0.1 }).status, "pass");
});
for (const field of Object.keys(fixture.subject)) {
  test(`V1 missing/malformed ${field} never passes`, () => {
    for (const value of [undefined, null, "true", {}, [], NaN, Infinity, -1]) {
      assert.equal(syntheticSubject({ [field]: value }).status, "fail");
    }
  });
}
test("V1 invalid fractions, counts and absent objects fail", () => {
  for (const input of [null, [], {}, "subject"]) assert.equal(assessSubject(input).status, "fail");
  for (const patch of [{ trackFrames: 0 }, { batEvidenceFrames: 100 }, { batEvidenceFrames: 2.2 },
    { trackedFraction: 1.01 }, { identityJumpFraction: 1.01 }]) assert.equal(syntheticSubject(patch).status, "fail");
});
test("all baseline phase mappings preserve method and exact raw identity, never legacy seconds", async () => {
  const events = await localiseEvents(fixture.metrics, await envelope());
  for (const [event, phase] of Object.entries({ stance_set: "stance", load_peak_estimate: "load", foot_plant: "stride",
    impact_estimate: "contact", extension: "extension", finish: "follow_through" })) {
    const value = events[event as EvidenceEvent], legacy = fixture.metrics.phases[phase];
    assert.equal(value.status, "pass"); assert.equal(value.method, legacy.method);
    assert.equal(value.engineConfidence, legacy.confidence);
    assert.equal(value.rawFrame, fixture.sourceFrames[legacy.frame].frame_index);
    assert.equal(value.rawPts, fixture.sourceFrames[legacy.frame].pts);
    assert.equal(value.rawTimeBase, "1/1000"); assert.equal(value.uncertaintyMs, null);
    assert.notEqual(value.rawPtsS, legacy.time_s);
  }
  for (const event of ["load_start", "swing_launch", "stride_foot_lift", "contact_confirmed"] as const) {
    assert.equal(events[event].status, "not_produced"); assert.equal(events[event].rawPts, null);
  }
});
test("top-level contact alias maps to impact, conflicts fail without alias priority", async () => {
  const frameMap = await envelope(), phase = fixture.metrics.phases.contact;
  assert.equal((await localiseEvents({ contact: phase }, frameMap)).impact_estimate.status, "pass");
  assert.equal((await localiseEvents({ ...fixture.metrics, contact: phase }, frameMap)).impact_estimate.status, "pass");
  const conflict = await localiseEvents({ ...fixture.metrics, contact: { ...phase, frame: 4 } }, frameMap);
  assert.equal(conflict.impact_estimate.status, "fail");
  assert.deepEqual(conflict.impact_estimate.reasons, ["conflicting_legacy_aliases"]);
});
for (const patch of [{ verified: false }, { status: "unmappable" }, { schema_version: 2 },
  { instrumentation_version: "unknown" }, { run_id: "3".repeat(32) }, { input_sha256: "4".repeat(64) },
  { attempt_number: 2 }, { reasons: ["CONTENT_AMBIGUOUS"] }, { frames: [] }]) {
  test(`V2 invalid frame-map metadata ${JSON.stringify(patch)}`, async () => {
    const events = await localiseEvents(fixture.metrics, await envelope({ ...mapFixture(), ...patch }));
    assert.equal(events.impact_estimate.status, "unmappable"); assert.equal(events.impact_estimate.rawPts, null);
  });
}
for (const patch of [{ raw_pts: null }, { raw_pts: 1.5 }, { raw_frame: -1 }, { raw_time_base: "0/1" },
  { raw_time_base: "1/0" }, { raw_pts_s: 88 }, { analysis_index: 99 }, { status: "unmappable" }, { reasons: ["bad"] }]) {
  test(`V2 invalid row ${JSON.stringify(patch)}`, async () => {
    const map = mapFixture(); Object.assign(map.frames[5], patch);
    const events = await localiseEvents(fixture.metrics, await envelope(map));
    assert.equal(events.impact_estimate.status, "unmappable");
  });
}
test("V2 validates bytes, paired manifest, counts and monotonic frame/PTS", async () => {
  for (const patch of [{ frame_map_sha256: "0".repeat(64) }, { bat_decoded_frames: 11 },
    { engine_code_version: "unknown" }, { run_id: undefined }, { attempt_number: undefined }]) {
    assert.equal((await localiseEvents(fixture.metrics, await envelope(mapFixture(), patch))).finish.status, "unmappable");
  }
  for (const key of ["raw_frame", "raw_pts"]) {
    const map = mapFixture(); map.frames[5][key] = map.frames[4][key];
    assert.equal((await localiseEvents(fixture.metrics, await envelope(map))).finish.status, "unmappable");
  }
  const e = await envelope(); e.frameMapJson += " ";
  assert.equal((await localiseEvents(fixture.metrics, e)).finish.status, "unmappable");
});
test("V2 absent/malformed inputs do not manufacture timestamps", async () => {
  for (const map of [undefined, null, {}, { frameMapJson: "{", manifest: {} }]) {
    assert.equal((await localiseEvents(fixture.metrics, map)).impact_estimate.status, "unmappable");
  }
  const frameMap = await envelope();
  for (const phase of [null, {}, { frame: true }, { frame: 100, time_s: 0.5 }]) {
    const event = (await localiseEvents({ phases: { contact: phase } }, frameMap)).impact_estimate;
    assert.notEqual(event.status, "pass"); assert.equal(event.rawPts, null);
  }
  const absent = await localiseEvents({ phases: { contact: { frame: null, time_s: null } } }, frameMap);
  assert.equal(absent.impact_estimate.status, "not_produced");
});
test("V2 low impact confidence does not invalidate foot plant or finish", async () => {
  const metrics = structuredClone(fixture.metrics); metrics.phases.contact.confidence = "low";
  const events = await localiseEvents(metrics, await envelope());
  assert.equal(events.impact_estimate.status, "fail");
  assert.equal(events.foot_plant.status, "pass"); assert.equal(events.finish.status, "pass");
  assert.equal(sufficient("contact", evidence(events), events).status, "insufficient");
  assert.equal(sufficient("stride_plant", evidence(events), events).status, "sufficient");
  assert.equal(sufficient("finish_balance", evidence(events), events).status, "sufficient");
});
test("requirements cover the existing concept union and never contain approvals", () => {
  assert.deepEqual(Object.keys(CLAIM_REQUIREMENTS).sort(), [...CONCEPTS].sort());
  for (const rule of Object.values(CLAIM_REQUIREMENTS)) {
    assert.equal(rule.status, "proposed"); assert.equal(rule.reviewApproval, null); assert.ok(Object.isFrozen(rule));
  }
});
for (const concept of CONCEPTS) {
  test(`V3 proposed ${concept} requirement`, () => {
    const rule = CLAIM_REQUIREMENTS[concept];
    assert.equal(sufficient(concept).status, rule.disabledReason ? "insufficient" : "sufficient");
    if (rule.disabledReason) {
      assert.ok(sufficient(concept).missing.includes(rule.disabledReason)); return;
    }
    for (const alternatives of rule.events) {
      const events = hypotheticalEvents();
      for (const event of alternatives) events[event].status = "not_produced";
      assert.equal(sufficient(concept, evidence(), events).status, "insufficient");
    }
    assert.equal(assessSufficiency(concept, null, {}, [], hypotheticalEvents()).status, "insufficient");
  });
}
test("V3 missing still/zoom/sequence and exact identity mismatches fail", () => {
  const media = evidence(); delete media.supplied.stills.impact_estimate;
  assert.ok(sufficient("contact", media).missing.includes("still"));
  const noZoom = evidence(); noZoom.supplied.zooms = {};
  assert.ok(sufficient("contact", noZoom).missing.includes("zoom"));
  assert.ok(sufficient("extension", noZoom).missing.includes("zoom:extension"));
  const wrong = evidence(); wrong.supplied.zooms.impact_estimate!.pts = 999;
  assert.equal(sufficient("contact", wrong).status, "insufficient");
  const short = evidence(); short.supplied.sequence = short.supplied.sequence.slice(2, 9);
  assert.ok(sufficient("extension", short).missing.includes("sequence"));
  const boundary = evidence(); boundary.supplied.sequence = boundary.supplied.sequence.slice(1, 9);
  assert.equal(sufficient("extension", boundary).status, "sufficient");
  const outside = evidence(); outside.supplied.sequence = outside.supplied.sequence.slice(0, 8);
  assert.ok(sufficient("extension", outside).missing.includes("sequence_coverage"));
  const duplicate = evidence(); duplicate.supplied.sequence[1] = duplicate.supplied.sequence[0];
  assert.equal(sufficient("extension", duplicate).status, "insufficient");
});
test("V3 finish accepts still OR sequence; event ordering and time base cannot conflict", () => {
  const media = evidence(); media.supplied.stills = {};
  assert.equal(sufficient("finish_balance", media).status, "sufficient");
  media.supplied.sequence = [];
  assert.equal(sufficient("finish_balance", media).status, "insufficient");
  const events = hypotheticalEvents(); events.extension.rawTimeBase = "1/999";
  assert.equal(sufficient("extension", evidence(), events).status, "insufficient");
  const reversed = hypotheticalEvents(); reversed.extension.rawFrame = 100;
  assert.equal(sufficient("extension", evidence(), reversed).status, "insufficient");
  const sameIndex = hypotheticalEvents(); sameIndex.extension.rawFrame = sameIndex.impact_estimate.rawFrame;
  assert.equal(sufficient("extension", evidence(), sameIndex).status, "insufficient");
  const inconsistent = evidence();
  inconsistent.supplied.sequence = [
    { frame_index: 100, pts: 1000 }, { frame_index: 104, pts: 1600 }, { frame_index: 111, pts: 2100 },
  ];
  assert.equal(sufficient("hand_path", inconsistent).status, "insufficient");
});
for (const [concept, part, threshold] of [["contact", "bat", 0.5], ["stride_plant", "feet", 0.8],
  ["head_visual_stability", "head", 0.8]] as const) {
  test(`V3 ${part} visibility threshold is inclusive, malformed/missing never passes`, () => {
    for (const value of [threshold, threshold - 0.001, null, undefined, "1", NaN, Infinity, 2, -1]) {
      const media = evidence(); media.visibility.forEach((v: any) => { v.parts[part] = value; });
      assert.equal(sufficient(concept, media).status, value === threshold ? "sufficient" : "insufficient");
    }
    const media = evidence(); media.visibility = [];
    assert.equal(sufficient(concept, media).status, "insufficient");
  });
}
test("V3 qualitative visibility is explicit, not a guessed numeric threshold", () => {
  for (const [concept, part] of [["extension", "arms"], ["load", "hands"], ["finish_balance", "lower_body"],
    ["posture", "torso"], ["front_side_stability", "lead_leg"], ["contact", "batter"]] as const) {
    const media = evidence(); media.visibility.forEach((v: any) => { v.parts[part] = false; });
    assert.ok(sufficient(concept, media).missing.includes(`${part}_visibility`));
  }
});
test("no sequence bounds replace baseline's missing load_start/swing_launch", async () => {
  const events = await localiseEvents(fixture.metrics, await envelope());
  assert.equal(sufficient("load", evidence(events), events).status, "insufficient");
  assert.equal(sufficient("hand_path", evidence(events), events).status, "insufficient");
});
test("disallowed concepts stay ineligible in every camera profile", () => {
  for (const captureProfile of ["game_backstop", "open_side_practice", "other", "unknown_imported", null]) {
    const media = evidence(); media.supplied.captureProfile = captureProfile as any;
    for (const concept of ["hip_shoulder_sequencing", "stance_setup", "timing", "swing_decision"] as const) {
      assert.equal(sufficient(concept, media).status, "insufficient");
    }
  }
});
test("V4 remains unmeasured regardless of version, profile or detector/AI confidence", () => {
  for (const concept of CONCEPTS) {
    const result = lookupReliability(concept, { ...INITIAL_EVIDENCE_TUPLE, reliabilityProfileVersion: "synthetic" }, "open_side_practice");
    assert.equal(result.status, "unmeasured");
    for (const field of ["profileVersion", "observedUnsafeRate", "upperBound95", "sampleSwings", "sampleAthletes"] as const) {
      assert.equal(result[field], null);
    }
  }
});
test("hypothetical composition requires all dimensions and records unmeasured shadow reliability", () => {
  const base = { subjectPass: true, requiredEventsPass: true, sufficient: true, reliabilityStatus: "within_ceiling" as const, mode: "enforce" as const };
  assert.equal(simulateClaimDecision(base).wouldDisplay, true);
  assert.equal(simulateClaimDecision(base).authorizedForProduction, false);
  for (const key of ["subjectPass", "requiredEventsPass", "sufficient"]) {
    assert.equal(simulateClaimDecision({ ...base, [key]: false }).wouldDisplay, false);
  }
  for (const reliabilityStatus of ["unmeasured", "inconclusive", "exceeds_ceiling"] as const) {
    assert.equal(simulateClaimDecision({ ...base, reliabilityStatus }).wouldDisplay, false);
  }
  const shadow = simulateClaimDecision({ ...base, mode: "shadow", reliabilityStatus: "unmeasured" });
  assert.equal(shadow.wouldDisplay, true); assert.equal(shadow.reliabilityStatus, "unmeasured");
  assert.equal(simulateClaimDecision({ ...base, mode: "off" }).wouldDisplay, false);
});
test("production decisions never gain enforcement authorization; registry and flags unchanged", async () => {
  const frameMap = await envelope(), media = evidence();
  for (const mode of ["off", "shadow", "enforce"] as const) {
    const result = await decideClaim({ tuple: INITIAL_EVIDENCE_TUPLE, subject: fixture.subject,
      metrics: fixture.metrics, frameMap, concept: "finish_balance", phase: "follow_through", ...media, mode });
    assert.equal(result.displayable, false); assert.equal(result.enforceEligible, false);
    assert.equal(result.reliability.status, "unmeasured");
  }
  assert.ok(EVIDENCE_REGISTRY.every(entry => entry.status !== "enforced"));
  assert.throws(() => parseAnalysisFlags({ EVIDENCE_GATE_MODE: "enforce" }, INITIAL_EVIDENCE_TUPLE));
  assert.equal(parseAnalysisFlags().evidenceGateMode, "off");
});
test("unknown version and absent strict signals cannot be reported as eligibility", async () => {
  const input = { tuple: { ...INITIAL_EVIDENCE_TUPLE, engineCodeVersion: "unknown" },
    subject: fixture.subject, metrics: fixture.metrics, frameMap: await envelope() };
  const result = await assessClip(input);
  assert.equal(result.clipStatus, "withhold"); assert.equal(result.familyReason, "analysis_version_unavailable");
  const strict = assessStrictBaseline(input);
  assert.equal(strict.version, "strict-0.1.0"); assert.equal(strict.evaluated, false);
  assert.equal(strict.approvedForProduction, false); assert.equal(strict.status, "withhold");
});
test("requested tuple must agree with observed manifest versions", async () => {
  for (const field of ["engine_code_version", "instrumentation_version", "environment_version"]) {
    const result = await assessClip({ tuple: INITIAL_EVIDENCE_TUPLE, subject: fixture.subject,
      metrics: fixture.metrics, frameMap: await envelope(mapFixture(), { [field]: "unknown" }) });
    assert.equal(result.familyReason, "analysis_version_unavailable");
    assert.equal(result.clipStatus, "withhold");
  }
});
test("recovered V1 permits clip availability, but not report enforcement", async () => {
  const result = await assessClip({ tuple: INITIAL_EVIDENCE_TUPLE, subject: fixture.subject,
    metrics: fixture.metrics, frameMap: await envelope() });
  assert.equal(result.familyReason, null);
  assert.equal(result.clipStatus, "eligible");
  assert.deepEqual(result.subject.reasons, []);
  assert.equal(result.strictBaseline.evaluated, false);
  const strictSignals = { engineVersion: "baseline-1.0.0",
    batterSelection: { usedFallback: false, trackFrames: 250, batEvidenceFrames: 5 },
    contact: { frame: null, confidence: "low" },
    swingWindow: { batterTrackedFraction: 0.9, identityJumpFraction: 0.05 },
    aiInputs: { zooms: ["zoom_contact"] } };
  const compared = await assessClip({ tuple: INITIAL_EVIDENCE_TUPLE, subject: fixture.subject,
    metrics: fixture.metrics, frameMap: await envelope(), strictSignals });
  assert.equal(compared.clipStatus, "eligible");
  assert.equal(compared.strictBaseline.evaluated, true);
  assert.equal(compared.strictBaseline.status, "withhold");
  assert.deepEqual(compared.strictBaseline.failedRules, ["G3", "G4"]);
  assert.deepEqual(compared.strictBaseline.signals, strictSignals);
});
test("deterministic and insensitive to absent/degraded 3D fields", async () => {
  const input = { tuple: INITIAL_EVIDENCE_TUPLE, subject: fixture.subject, metrics: fixture.metrics, frameMap: await envelope() };
  const before = JSON.stringify(input), a = await assessClip(input), b = await assessClip(input);
  assert.deepEqual(a, b); assert.equal(JSON.stringify(input), before);
  assert.deepEqual(a, await assessClip({ ...input, metrics: { ...input.metrics, reconstruction_reliable: false,
    pose3d_coverage: 0, angles: { elbow: NaN } } }));
  const media = evidence();
  assert.deepEqual(sufficient("extension", media), sufficient("extension", structuredClone(media)));
});
test("shared runtime and type imports have no Node/evaluation/3D dependencies or cycles", () => {
  const visited = new Set<string>(), stack = new Set<string>();
  function visit(file: string) {
    assert.ok(!stack.has(file), `circular import: ${file}`);
    if (visited.has(file)) return;
    stack.add(file);
    const source = readFileSync(file, "utf8"), ast = ts.createSourceFile(file, source, ts.ScriptTarget.Latest, true);
    for (const node of ast.statements) {
      if (!ts.isImportDeclaration(node) && !ts.isExportDeclaration(node)) continue;
      if (!node.moduleSpecifier || !ts.isStringLiteral(node.moduleSpecifier)) continue;
      const name = node.moduleSpecifier.text;
      assert.ok(name.startsWith(".") && name.endsWith(".ts"), `nonportable dependency ${name}`);
      assert.ok(!/node:|\/eval\/|\/pose3d\/|\/reconstruction\//.test(name), name);
      visit(resolve(dirname(file), name));
    }
    stack.delete(file); visited.add(file);
  }
  visit(resolve("src/services/development/evidence/decideClaim.ts"));
  visit(resolve("src/services/development/evidence/eventMapping.ts"));
});
