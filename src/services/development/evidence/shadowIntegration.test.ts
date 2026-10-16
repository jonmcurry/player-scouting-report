import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
import { resolve, dirname } from "node:path";
import ts from "typescript";
import { swingSequenceWindow } from "../../../domain/swingWindow.ts";
import { extractClipEvidenceSignals, subjectSignalsFrom, type AiInputNames } from "./artifactSignals.ts";
import { buildClaimDecisionRecord, buildShadowAssessment, observedTuple, type ShadowArtifacts } from "./shadowAssessment.ts";
import { assessStrictBaseline } from "./strictBaseline.ts";
import { BASELINE_ENGINE, INITIAL_EVIDENCE_TUPLE } from "../evidenceRegistry.ts";

// Synthetic artifacts only (no real clip, media or athlete data).
const SHA = "a".repeat(64);
const N = 12, FPS = 30;
const body = (cx: number, cy: number, conf = 0.9) =>
  Array.from({ length: 17 }, (_, k) => [cx + (k % 3), cy - 40 + k * 5, conf]);
function pose2d(patch: (frame: number) => unknown = () => undefined) {
  return { meta: { fps: FPS, n_frames: N, width: 640, height: 480,
    bat_evidence: { track_frames: N, bat_evidence_frames: 10, used_fallback: false } },
    frames: Array.from({ length: N }, (_, i) => { const v = patch(i); return { frame: i, keypoints: v === undefined ? body(200, 240) : v }; }) };
}
const batPath = { frames: Array.from({ length: N }, (_, i) => ({ frame: i, tip: i < 9 ? [210, 200] : null, knob: null, conf: 0.8 })) };
const phase = (frame: number | null, confidence: string | null = "high") => ({ frame, time_s: frame === null ? null : frame / FPS,
  method: "synthetic", confidence });
function metrics(patch: Record<string, unknown> = {}) {
  return { pipeline_version: "pose3d-live-1.0.0", contact: phase(5),
    phases: { stance: phase(0, "low"), load: phase(2, "low"), stride: phase(3, "low"), contact: phase(5),
      extension: phase(7), follow_through: phase(9, "low") }, ...patch };
}
const ai: AiInputNames = { phaseStills: ["phase_contact", "phase_load"], zooms: ["zoom_contact", "zoom_load"],
  sequenceFrames: 12, sequenceSkipped: null };

async function frameMapPair(env = INITIAL_EVIDENCE_TUPLE.environmentVersion) {
  const map = { schema_version: 1, instrumentation_version: "inst-1", verified: true, status: "verified", reasons: [],
    run_id: "1".repeat(32), input_sha256: SHA, attempt_number: 1,
    frames: Array.from({ length: N }, (_, i) => ({ analysis_index: i, raw_frame: 100 + i, raw_pts: 1000 + i * 33,
      raw_time_base: "1/1000", raw_pts_s: (1000 + i * 33) / 1000, status: "verified", reasons: [] })) };
  const frameMapJson = JSON.stringify(map);
  const digest = [...new Uint8Array(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(frameMapJson)))]
    .map(v => v.toString(16).padStart(2, "0")).join("");
  return { frameMapJson, manifest: { schema_version: 1, engine_code_version: BASELINE_ENGINE, instrumentation_version: "inst-1",
    environment_version: env, run_id: "1".repeat(32), input_sha256: SHA, attempt_number: 1,
    pose_decoded_frames: N, bat_decoded_frames: N, frame_map_sha256: digest } };
}
async function artifacts(patch: Partial<ShadowArtifacts> = {}): Promise<ShadowArtifacts> {
  const pair = await frameMapPair();
  return { metrics: metrics(), pose2d: pose2d(), batPath, manifest: pair.manifest, frameMapJson: pair.frameMapJson,
    aiInputs: ai, captureProfile: null, ...patch };
}

test("shared swing window is byte-for-byte the extract.ts formula it replaced", () => {
  const legacy = (phases: { slug: string; frame: number }[], fps: number, nFrames: number) => {
    const load = phases.find(p => p.slug === "load"), contact = phases.find(p => p.slug === "contact");
    if (!load || !contact || contact.frame <= load.frame) return null;
    const last = Math.max(...phases.filter(p => ["contact", "extension", "follow_through"].includes(p.slug)).map(p => p.frame));
    const start = Math.max(0, load.frame - Math.round(0.1 * fps));
    const end = Math.min(nFrames - 1, last + Math.round(0.4 * fps), start + Math.round(3 * fps));
    return { start, end };
  };
  let seed = 7;
  const rand = (n: number) => (seed = (seed * 1103515245 + 12345) % 2147483648) % n;
  for (let i = 0; i < 2000; i++) {
    const fps = [24, 29.97, 30, 59.94, 60, 120, 240][rand(7)]!, nFrames = 1 + rand(2000);
    const phases = ["stance", "load", "stride", "contact", "extension", "follow_through"]
      .filter(() => rand(5) > 0).map(slug => ({ slug, frame: rand(nFrames) }));
    const shared = swingSequenceWindow(phases, fps, nFrames), old = legacy(phases, fps, nFrames);
    assert.deepEqual(shared.available ? { start: shared.start, end: shared.end } : null, old);
    if (shared.available) assert.equal(shared.anchorFrame, phases.find(p => p.slug === "load")!.frame);
  }
});

test("Revision 1 signals: window fractions, subjectBox jump rule, verbatim inputs, explicit engine projection", () => {
  // Frame 10 jumps far from the load anchor; frame 11 is untracked.
  const p = pose2d(i => i === 10 ? body(600, 240) : i === 11 ? null : undefined);
  const s = extractClipEvidenceSignals({ pose2d: p, batPath, metrics: metrics(), aiInputs: ai, captureProfile: null });
  assert.equal(s.engineVersion, "baseline-1.0.0");
  assert.deepEqual(s.batterSelection, { usedFallback: false, trackFrames: N, batEvidenceFrames: 10 });
  assert.deepEqual(s.contact, { frame: 5, confidence: "high" });
  assert.deepEqual(s.swingWindow, { frames: 12, batterTrackedFraction: Math.round(11 / 12 * 1e6) / 1e6,
    identityJumpFraction: Math.round(1 / 11 * 1e6) / 1e6, coreKeypointFraction: Math.round(11 / 12 * 1e6) / 1e6,
    batDetectedFraction: 0.75 });
  assert.deepEqual(subjectSignalsFrom(s), { usedFallback: false, batEvidenceFrames: 10, trackFrames: N,
    trackedFraction: s.swingWindow!.batterTrackedFraction, identityJumpFraction: s.swingWindow!.identityJumpFraction,
    batterCropAvailable: true, windowAvailable: true });
  const unknown = extractClipEvidenceSignals({ pose2d: p, batPath, metrics: metrics({ pipeline_version: "other-9" }), aiInputs: ai, captureProfile: null });
  assert.equal(unknown.engineVersion, "other-9");
  assert.deepEqual(assessStrictBaseline(unknown).failedRules.includes("G8"), true);
});

test("missing/malformed artifacts fail closed instead of being defaulted", () => {
  const noLoad = metrics({ phases: { contact: phase(5) } });
  const s = extractClipEvidenceSignals({ pose2d: pose2d(), batPath, metrics: noLoad, aiInputs: ai, captureProfile: null });
  assert.equal(s.swingWindow, null);
  assert.equal(subjectSignalsFrom(s).windowAvailable, false);
  const empty = extractClipEvidenceSignals({ pose2d: null, batPath: null, metrics: null,
    aiInputs: { phaseStills: [], zooms: [], sequenceFrames: 0, sequenceSkipped: "x" }, captureProfile: null });
  assert.deepEqual(empty.batterSelection, { usedFallback: null, trackFrames: null, batEvidenceFrames: null });
  assert.equal(empty.swingWindow, null);
  const strict = assessStrictBaseline(empty);
  assert.equal(strict.status, "withhold");
  assert.equal(strict.evaluated, false);
  // An unexpected confidence label is recorded as invalid, not coerced.
  const odd = extractClipEvidenceSignals({ pose2d: pose2d(), batPath, metrics: metrics({ contact: phase(5, "medium") }), aiInputs: ai, captureProfile: null });
  assert.equal(odd.contact.confidence, "medium" as never);
  assert.ok(assessStrictBaseline(odd).invalidSignals.includes("contact.confidence"));
  // Phase frames beyond the decoded frame count: window unavailable, not NaN fractions.
  const beyond = extractClipEvidenceSignals({ pose2d: pose2d(), batPath,
    metrics: metrics({ phases: { load: phase(40), contact: phase(45) } }), aiInputs: ai, captureProfile: null });
  assert.equal(beyond.swingWindow, null);
  // No usable bodies: jump fraction is unavailable, not zero.
  const blind = extractClipEvidenceSignals({ pose2d: pose2d(() => body(200, 240, 0.1)), batPath, metrics: metrics(), aiInputs: ai, captureProfile: null });
  assert.equal(blind.swingWindow!.identityJumpFraction, null);
});

test("R2: 3D fields in artifacts never change the signals", () => {
  const plain = extractClipEvidenceSignals({ pose2d: pose2d(), batPath, metrics: metrics(), aiInputs: ai, captureProfile: null });
  const with3d = extractClipEvidenceSignals({ pose2d: { ...pose2d(), pose3d_coverage: 0 }, batPath,
    metrics: metrics({ reconstruction_reliable: false, pose3d_coverage: 0, torso_tilt_at_contact_deg: 80 }), aiInputs: ai, captureProfile: null });
  assert.deepEqual(with3d, plain);
});

test("provenance gates: no source hash, no observed tuple, or a different input -> no row", async () => {
  const base = await artifacts();
  assert.deepEqual(await buildShadowAssessment({ videoClipId: "c", sourceSha256: null, artifacts: base }), { ok: false, reason: "source_hash_unavailable" });
  assert.deepEqual(await buildShadowAssessment({ videoClipId: "c", sourceSha256: "XYZ", artifacts: base }), { ok: false, reason: "source_hash_unavailable" });
  assert.deepEqual(await buildShadowAssessment({ videoClipId: "c", sourceSha256: SHA, artifacts: { ...base, manifest: null } }), { ok: false, reason: "tuple_unavailable" });
  const nullEnv = { ...(base.manifest as object), environment_version: null };
  assert.deepEqual(await buildShadowAssessment({ videoClipId: "c", sourceSha256: SHA, artifacts: { ...base, manifest: nullEnv } }), { ok: false, reason: "tuple_unavailable" });
  assert.deepEqual(await buildShadowAssessment({ videoClipId: "c", sourceSha256: "b".repeat(64), artifacts: base }), { ok: false, reason: "source_hash_mismatch" });
  assert.equal(observedTuple({ engine_code_version: BASELINE_ENGINE, instrumentation_version: "inst-1", environment_version: "env x" }), null);
});

test("registered tuple + complete signals + verified frame map -> eligible shadow row matching the PR9 contract", async () => {
  const built = await buildShadowAssessment({ videoClipId: "clip-1", sourceSha256: SHA, artifacts: await artifacts() });
  assert.ok(built.ok);
  const row = built.row;
  assert.deepEqual({ ...row, subject: undefined, events: undefined, strict_baseline: undefined }, {
    video_clip_id: "clip-1", engine_code_version: BASELINE_ENGINE, instrumentation_version: "inst-1",
    environment_version: INITIAL_EVIDENCE_TUPLE.environmentVersion, gate_version: "gate-1.0.0",
    claims_version: "claims-0.1.0-proposed", reliability_profile_version: null, mode: "shadow",
    clip_status: "eligible", family_reason: null, source_sha256: SHA, backfilled: false,
    subject: undefined, events: undefined, strict_baseline: undefined });
  assert.equal(built.assessment.events.impact_estimate.status, "pass");
  assert.equal(built.assessment.events.contact_confirmed.status, "not_produced");
  assert.equal(built.assessment.events.impact_estimate.rawFrame, 105);
  assert.equal((row.strict_baseline as { approvedForProduction: boolean }).approvedForProduction, false);
  const text = JSON.stringify(row);
  for (const forbidden of ["videos/", "frames/", ".png", "http", "\\\\", "pose3d_coverage"]) assert.ok(!text.includes(forbidden), forbidden);
});

test("unregistered environment or missing frame map is recorded honestly, never upgraded", async () => {
  const pair = await frameMapPair("env-000000000000");
  const other = await buildShadowAssessment({ videoClipId: "c", sourceSha256: SHA,
    artifacts: await artifacts({ manifest: pair.manifest, frameMapJson: pair.frameMapJson }) });
  assert.ok(other.ok);
  assert.equal(other.row.environment_version, "env-000000000000");
  assert.equal(other.row.clip_status, "withhold");
  assert.equal(other.row.family_reason, "analysis_version_unavailable");
  const noMap = await buildShadowAssessment({ videoClipId: "c", sourceSha256: SHA, artifacts: await artifacts({ frameMapJson: null }) });
  assert.ok(noMap.ok);
  assert.equal(noMap.assessment.events.impact_estimate.status, "unmappable");
});

test("claim decision record: minimal, V4 unmeasured, never displayable or enforce-eligible", async () => {
  const built = await buildShadowAssessment({ videoClipId: "c", sourceSha256: SHA, artifacts: await artifacts() });
  assert.ok(built.ok);
  for (const issue of [{ concept: "contact", phase: "contact" }, { concept: "stride_plant", phase: "stride" },
    { concept: "not_a_concept", phase: "nonsense" }, { concept: null, phase: null }]) {
    const d = await buildClaimDecisionRecord(built.input, issue, "assess-1");
    assert.equal(d.displayable, false);
    assert.equal(d.enforceEligible, false);
    assert.equal(d.hypothetical.authorizedForProduction, false);
    assert.equal(d.reliability.status, "unmeasured");
    assert.equal(d.reliability.profileVersion, null);
    assert.equal(d.mode, "shadow");
    assert.equal(d.assessmentId, "assess-1");
    assert.deepEqual(d.suppliedEvidence, { status: "unavailable", reason: "evidence_package_not_implemented" });
    assert.equal(d.sufficiency.status, "insufficient");
    if (issue.phase === "nonsense") assert.equal(d.phase, null);
    if (issue.concept === "not_a_concept") assert.ok(d.sufficiency.missing.includes("unknown_concept"));
    const text = JSON.stringify(d);
    for (const forbidden of ["signals", "trackedFraction", "usedFallback", "rawFrame", "zoom_", "phase_"]) assert.ok(!text.includes(forbidden), forbidden);
  }
  const contact = await buildClaimDecisionRecord(built.input, { concept: "contact", phase: "contact" }, "a");
  assert.deepEqual(contact.requiredEvents, { impact_estimate: "pass" });
});

test("new shadow modules keep the shared-evidence import rules (no Node, eval, pose3d or 3D imports)", () => {
  const visited = new Set<string>();
  function visit(file: string) {
    if (visited.has(file)) return;
    visited.add(file);
    const ast = ts.createSourceFile(file, readFileSync(file, "utf8"), ts.ScriptTarget.Latest, true);
    for (const node of ast.statements) {
      if (!ts.isImportDeclaration(node) && !ts.isExportDeclaration(node)) continue;
      if (!node.moduleSpecifier || !ts.isStringLiteral(node.moduleSpecifier)) continue;
      const name = node.moduleSpecifier.text;
      assert.ok(name.startsWith(".") && name.endsWith(".ts"), `nonportable dependency ${name} in ${file}`);
      assert.ok(!/node:|\/eval\/|\/pose3d\/|\/reconstruction\//.test(name), name);
      visit(resolve(dirname(file), name));
    }
  }
  visit(resolve("src/services/development/evidence/shadowAssessment.ts"));
  visit(resolve("src/services/development/evidence/artifactSignals.ts"));
  assert.ok(visited.has(resolve("src/domain/swingWindow.ts")));
});
