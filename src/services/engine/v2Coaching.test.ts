import assert from "node:assert/strict";
import test from "node:test";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { NO_QUALIFIED_ISSUE_REASON, qualifiedResult, qualifyV2Findings, SUPPRESSION_EXPLANATIONS, v2CoachingEligibility } from "./v2Coaching.js";
import { buildV2EvidencePackage, type V2EvidencePackage } from "../ai/v2EvidencePackage.js";
import { syntheticArtifacts, syntheticImages } from "../ai/v2EvidencePackage.fixtures.js";
import type { IssueDraft, StrengthDraft, SwingAnalysisResult } from "../ai/swingAnalysisShared.js";
import { PRODUCTION_RELIABILITY_CATALOG } from "../development/evidence/reliability.js";

const ENV = { ENGINE_V2_AI: "enabled", AI_ANALYZER: "agy-cli" } as NodeJS.ProcessEnv;
const artifactsFor = (a = syntheticArtifacts()) => ({ "pipeline_status.json": a.status, "metrics.json": a.metrics, "tracks.json": a.tracks });

test("eligible only with the explicit opt-in, a CLI provider and a bat-grounded swing candidate", () => {
  assert.deepEqual(v2CoachingEligibility(artifactsFor(), ENV), { eligible: true, reasons: [], provider: "agy" });
  assert.equal(v2CoachingEligibility(artifactsFor(), { ...ENV, AI_ANALYZER: "claude-cli" }).provider, "claude");
  const cases: Array<[string, NodeJS.ProcessEnv, ReturnType<typeof syntheticArtifacts>]> = [];
  const off = { ...ENV }; delete off.ENGINE_V2_AI;
  cases.push(["V2_AI_NOT_ENABLED", off, syntheticArtifacts()]);
  cases.push(["V2_AI_NOT_ENABLED", { ...ENV, ENGINE_V2_AI: "true" }, syntheticArtifacts()]);
  cases.push(["V2_PROVIDER_UNSUPPORTED", { ...ENV, AI_ANALYZER: "gemini" }, syntheticArtifacts()]);
  cases.push(["V2_PROVIDER_UNSUPPORTED", { ENGINE_V2_AI: "enabled" }, syntheticArtifacts()]);
  cases.push(["NO_SELECTED_BATTER", ENV, syntheticArtifacts({ decision: { status: "ambiguous", basis: "pose_and_bat", reason_codes: ["BAT_EVIDENCE_AMBIGUOUS"] } })]);
  cases.push(["IDENTITY_NOT_BAT_GROUNDED", ENV, syntheticArtifacts({ decision: { status: "selected", basis: "pose_only", reason_codes: [] } })]);
  cases.push(["POSSIBLE_BATTER_CONFLICT", ENV, syntheticArtifacts({ decision: { status: "selected", basis: "pose_and_bat", reason_codes: ["POSE_BAT_DISAGREEMENT"] } })]);
  for (const [reason, env, a] of cases) {
    const gate = v2CoachingEligibility(artifactsFor(a), env);
    assert.equal(gate.eligible, false, reason);
    assert.ok(gate.reasons.includes(reason), `${reason}: ${gate.reasons}`);
  }
  const inconclusive = syntheticArtifacts();
  inconclusive.metrics.swing_detection = { status: "no_swing_candidate", confidence: "low" };
  assert.ok(v2CoachingEligibility(artifactsFor(inconclusive), ENV).reasons.includes("NO_SWING_CANDIDATE"));
  const camera = syntheticArtifacts();
  camera.metrics.diagnostics = { reason_codes: ["SMALL_BATTER"], possible_batter_selection_conflict: false };
  assert.ok(v2CoachingEligibility(artifactsFor(camera), ENV).reasons.includes("UNSUPPORTED_CAMERA_GEOMETRY"));
  const incomplete = syntheticArtifacts();
  incomplete.status = { status: "analysis_unavailable" };
  assert.ok(v2CoachingEligibility(artifactsFor(incomplete), ENV).reasons.includes("ENGINE_NOT_COMPLETE"));
  const nothing = syntheticArtifacts();
  for (const phase of Object.values(nothing.metrics.phases)) (phase as { frame: unknown }).frame = null;
  assert.ok(v2CoachingEligibility(artifactsFor(nothing), ENV).reasons.includes("NO_SUPPORTED_EVENT"));
});

async function pkgFor(t: test.TestContext, batStatus: Record<number, string> = {}): Promise<V2EvidencePackage> {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "v2coach-"));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  const images = syntheticImages(dir, [["phase_load.png", "phase_still", "load", 3], ["phase_contact.png", "phase_still", "contact", 8],
    ["phase_follow_through.png", "phase_still", "follow_through", 10]]);
  const a = syntheticArtifacts({ batStatus });
  const built = await buildV2EvidencePackage({ videoClipId: "synthetic-clip", sourceSha256: "a".repeat(64), imagesDir: dir, images,
    metrics: a.metrics, frameMap: a.frameMap, batPath: a.batPath, pose2d: a.pose2d, tracks: a.tracks });
  assert.ok(built.ok);
  return (built as { pkg: V2EvidencePackage }).pkg;
}

const issue = (overrides: Partial<IssueDraft> = {}): IssueDraft => ({
  issue: "Front shoulder opens early", seenInAtBats: "This swing", likelyCause: "Front side may lead the turn",
  effect: "It may pull the barrel off line", evidence: "In phase_contact the front shoulder appears turned toward first base",
  coachingCue: "Keep the front shoulder in", lookForNext: "Shoulder stays closed longer", confidence: "medium", phase: "contact",
  concept: "early_shoulder_rotation" as IssueDraft["concept"], basis: "video", contextExplainsIt: false, emergencySwingSuspected: false,
  knowledgeClaimIds: [], suggestPriority: false, supportingEvents: ["impact_estimate"], claimType: "direct_observation", ...overrides,
});
const strength = (overrides: Partial<StrengthDraft> = {}): StrengthDraft => ({
  text: "Balanced load", evidence: "phase_load shows weight centred over the back leg", phase: "load",
  supportingEvents: ["load_peak_estimate"], claimType: "direct_observation", ...overrides,
});
const resultWith = (issues: IssueDraft[], strengths: StrengthDraft[] = [], extra: Partial<SwingAnalysisResult> = {}): SwingAnalysisResult => ({
  summary: "A steady swing with a balanced load.", strengths, noActionNeeded: issues.length === 0, noActionReason: issues.length ? null : "None.",
  checklist: [], issues, comps: [], compNotes: [], drills: [], source: "claude", aiModel: "double", aiModelVersion: null, ...extra,
});

test("a supported, evidence-backed finding is displayed; the AI's confidence plays no part", async t => {
  const pkg = await pkgFor(t);
  for (const confidence of ["low", "medium", "high"] as const) {
    const q = qualifyV2Findings(resultWith([issue({ confidence })], [strength()]), pkg);
    assert.equal(q.withheld, null);
    assert.deepEqual(q.decisions.map(d => [d.kind, d.displayed, d.reasons]), [["strength", true, []], ["issue", true, []]]);
    assert.equal(q.displayedIssues[0]!.confidence, confidence, "never upgraded");
  }
  assert.equal(PRODUCTION_RELIABILITY_CATALOG.length, 0, "the V4 production catalog stays empty");
});

test("each unsupported finding is suppressed with a stable code and a plain-English reason", async t => {
  const pkg = await pkgFor(t, { 10: "interpolated" });
  const cases: Array<[string, IssueDraft]> = [
    ["EVENT_REFERENCE_INVALID", issue({ supportingEvents: ["swing_launch"] })],
    ["EVENT_REFERENCE_INVALID", issue({ supportingEvents: [] })],
    ["EVENT_PHASE_MISMATCH", issue({ phase: "load" })],
    ["BAT_NOT_DIRECTLY_OBSERVED", issue({ phase: "follow_through", supportingEvents: ["finish"] })],
    ["UNSUPPORTED_BASIS", issue({ basis: "metric" })],
    ["NUMERIC_CLAIM", issue({ evidence: "The bat reached 45 mph in phase_contact" })],
    ["NUMERIC_CLAIM", issue({ effect: "Shoulders open about 30 degrees early" })],
    ["CONTACT_CLAIM", issue({ evidence: "She made contact out in front" })],
    ["CONTACT_CLAIM", issue({ lookForNext: "Solid contact next time" })],
    ["HAND_PATH_CLAIM", issue({ issue: "Long hand path to the ball" })],
    ["CAUSAL_CLAIM", issue({ effect: "This causes a weak swing" })],
  ];
  for (const [reason, finding] of cases) {
    const q = qualifyV2Findings(resultWith([finding]), pkg);
    const decision = q.decisions.find(d => d.kind === "issue")!;
    assert.equal(decision.displayed, false, reason);
    assert.ok(decision.reasons.includes(reason), `${reason}: ${decision.reasons}`);
    assert.ok(decision.explanation && decision.explanation.includes(SUPPRESSION_EXPLANATIONS[reason]!), reason);
    assert.deepEqual(q.displayedIssues, []);
  }
  const strengthQ = qualifyV2Findings(resultWith([], [strength({ supportingEvents: ["impact_estimate"] })]), pkg);
  assert.deepEqual(strengthQ.decisions[0]!.reasons, ["EVENT_PHASE_MISMATCH"]);
});

test("numbers, outcomes and certainty are caught; cited image names are not numbers", async t => {
  const pkg = await pkgFor(t);
  const reasons = (finding: IssueDraft) => qualifyV2Findings(resultWith([finding]), pkg).decisions.find(d => d.kind === "issue")!.reasons;
  // Any number is a measurement the engine never supplied, unit or not.
  for (const evidence of ["She rotated 30 early", "Bat angle was 45", "1 in 3 swings look like this"]) {
    assert.deepEqual(reasons(issue({ evidence })), ["NUMERIC_CLAIM"], evidence);
  }
  assert.deepEqual(reasons(issue({ evidence: "phase_contact and swing_seq_04.png show the front shoulder turned" })), []);
  for (const evidence of ["It became a ground ball", "A swing and miss", "She swung and missed", "A slow grounder", "She popped up", "It went into the gap"]) {
    assert.deepEqual(reasons(issue({ evidence })), ["CONTACT_CLAIM"], evidence);
  }
  const causalStrength = qualifyV2Findings(resultWith([], [strength({ text: "A stable base definitely causes good rotation" })]), pkg);
  assert.deepEqual(causalStrength.decisions[0]!.reasons, ["CAUSAL_CLAIM"]);
  assert.deepEqual(reasons(issue({ coachingCue: "Staying closed guarantees a straight barrel" })), ["CAUSAL_CLAIM"]);
});

test("when every issue is suppressed the stored run is no-action-needed, never an empty needs-attention report", async t => {
  const pkg = await pkgFor(t);
  const original = resultWith([issue({ evidence: "The bat reached 45 mph" })], [strength()]);
  assert.equal(original.noActionNeeded, false);
  const stored = qualifiedResult(original, qualifyV2Findings(original, pkg));
  assert.deepEqual([stored.issues, stored.noActionNeeded, stored.noActionReason], [[], true, NO_QUALIFIED_ISSUE_REASON]);
  assert.equal(stored.strengths.length, 1);
  const kept = resultWith([issue()]);
  const storedKept = qualifiedResult(kept, qualifyV2Findings(kept, pkg));
  assert.deepEqual([storedKept.issues.length, storedKept.noActionNeeded, storedKept.noActionReason], [1, false, null]);
});

test("pose-timed events need the batter's pose at that frame; bat-timed events need a direct bat", async t => {
  const pkg = await pkgFor(t, { 8: "not_observed" });
  pkg.images.find(i => i.eventId === "load_peak_estimate")!.batterPose = false;
  const q = qualifyV2Findings(resultWith([issue()], [strength()]), pkg);
  assert.deepEqual(q.decisions.map(d => d.reasons), [["POSE_NOT_OBSERVED"], ["BAT_NOT_DIRECTLY_OBSERVED"]]);
});

test("a summary asserting contact or numbers withholds the whole run; uncited outputs are never stored", async t => {
  const pkg = await pkgFor(t);
  for (const [extra, reason] of [
    [{ summary: "She hit the ball hard to left." }, "CONTACT_CLAIM"], [{ summary: "Bat speed was 50 mph." }, "NUMERIC_CLAIM"],
    [{ summary: "Her early turn definitely causes a late barrel." }, "CAUSAL_CLAIM"],
    [{ noActionNeeded: true, noActionReason: "Clean hand path to the ball." }, "HAND_PATH_CLAIM"],
    [{ noActionNeeded: true, noActionReason: "Good swing at 45 mph." }, "NUMERIC_CLAIM"],
  ] as const) {
    const q = qualifyV2Findings(resultWith([issue()], [], extra), pkg);
    assert.deepEqual([q.withheld, q.displayedIssues, q.displayedStrengths], ["SUMMARY_UNSUPPORTED_CLAIM", [], []]);
    // The reason is recorded (locally; a withheld run writes nothing to the database).
    assert.deepEqual(q.decisions.map(d => [d.kind, d.displayed, d.reasons]), [["summary", false, [reason]]]);
    assert.ok(q.decisions[0]!.explanation!.startsWith(SUPPRESSION_EXPLANATIONS.SUMMARY_UNSUPPORTED_CLAIM!));
  }
  const extra = resultWith([issue()], [strength()], { checklist: [{ checkpointSlug: "x", score: 2, notes: "n" }],
    comps: [{ compName: "Alo", cue: "c" }], compNotes: ["note"], drills: [{ title: "t", description: "d" }] });
  const q = qualifyV2Findings(extra, pkg);
  assert.deepEqual(q.decisions.filter(d => !d.displayed).map(d => [d.kind, d.reasons]),
    [["checklist", ["NOT_SUPPORTED_IN_V2"]], ["comp", ["NOT_SUPPORTED_IN_V2"]], ["compNote", ["NOT_SUPPORTED_IN_V2"]], ["drill", ["NOT_SUPPORTED_IN_V2"]]]);
  const stored = qualifiedResult(extra, q);
  assert.deepEqual([stored.checklist, stored.comps, stored.compNotes, stored.drills], [[], [], [], []]);
  assert.equal(stored.issues.length, 1);
  assert.equal(q.label, "experimental_qualification");
  assert.doesNotMatch(JSON.stringify(q), /reliab|calibrat/i, "never presented as reliability");
});
