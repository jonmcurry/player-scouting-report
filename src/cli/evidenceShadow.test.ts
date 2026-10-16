import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { aiInputNames, prepareEvidenceShadow } from "./evidenceShadow.js";
import type { EvidenceShadowDb } from "../services/db/evidenceAssessmentStore.js";
import { BASELINE_ENGINE, INITIAL_EVIDENCE_TUPLE } from "../services/development/evidenceRegistry.js";

// Synthetic artifacts in a temporary directory; no real clip, media or DB.
const SHA = "c".repeat(64), N = 12, CLIP = "11111111-1111-4111-8111-111111111111";
const tempDirs: string[] = [];
test.after(() => { for (const d of tempDirs) fs.rmSync(d, { recursive: true, force: true }); });
const body = () => Array.from({ length: 17 }, (_, k) => [200 + (k % 3), 200 + k * 5, 0.9]);
const phase = (frame: number, confidence = "high") => ({ frame, time_s: frame / 30, method: "synthetic", confidence });
const metrics = { pipeline_version: "pose3d-live-1.0.0", contact: phase(5),
  phases: { load: phase(2, "low"), contact: phase(5), follow_through: phase(9, "low") } };

async function workspace(opts: { manifestPatch?: Record<string, unknown>; skip?: string[] } = {}) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "pr10-shadow-"));
  tempDirs.push(dir);
  const stills = path.join(dir, "phase_stills");
  fs.mkdirSync(stills);
  for (const f of ["phase_contact.png", "zoom_contact.png", "swing_seq_01.png", "notes.txt"]) fs.writeFileSync(path.join(stills, f), "x");
  const meta = { fps: 30, n_frames: N, width: 640, height: 480, bat_evidence: { track_frames: N, bat_evidence_frames: 10, used_fallback: false } };
  const map = { schema_version: 1, instrumentation_version: "inst-1", verified: true, status: "verified", reasons: [],
    run_id: "1".repeat(32), input_sha256: SHA, attempt_number: 1,
    frames: Array.from({ length: N }, (_, i) => ({ analysis_index: i, raw_frame: i, raw_pts: i * 33, raw_time_base: "1/1000",
      raw_pts_s: i * 33 / 1000, status: "verified", reasons: [] })) };
  const frameMapJson = JSON.stringify(map);
  const digest = [...new Uint8Array(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(frameMapJson)))]
    .map(v => v.toString(16).padStart(2, "0")).join("");
  const files: Record<string, string> = {
    "pose_2d.json": JSON.stringify({ meta, frames: Array.from({ length: N }, (_, i) => ({ frame: i, keypoints: body() })) }),
    "bat_path.json": JSON.stringify({ meta, frames: Array.from({ length: N }, (_, i) => ({ frame: i, tip: [1, 1], knob: null, conf: 0.8 })) }),
    "frame_map.json": frameMapJson,
    "engine_manifest.json": JSON.stringify({ schema_version: 1, engine_code_version: BASELINE_ENGINE, instrumentation_version: "inst-1",
      environment_version: INITIAL_EVIDENCE_TUPLE.environmentVersion, run_id: "1".repeat(32), input_sha256: SHA, attempt_number: 1,
      pose_decoded_frames: N, bat_decoded_frames: N, frame_map_sha256: digest, ...opts.manifestPatch }),
  };
  const startedAt = Date.now() - 5_000;
  for (const [name, text] of Object.entries(files)) if (!opts.skip?.includes(name)) fs.writeFileSync(path.join(dir, name), text);
  return { dir, stills, startedAt };
}
function fakeDb(overrides: Partial<EvidenceShadowDb> = {}) {
  const calls: { op: string; args: unknown[] }[] = [];
  const db: EvidenceShadowDb = {
    async insertAssessment(row) { calls.push({ op: "insert", args: [row] }); return "assess-1"; },
    async linkRun(...args) { calls.push({ op: "link", args }); },
    async runIssues(runId) { calls.push({ op: "issues", args: [runId] }); return [{ id: "i1", concept: "contact", phase: "contact" }, { id: "i2", concept: "load", phase: "load" }]; },
    async recordClaimDecision(...args) { calls.push({ op: "decision", args }); },
    ...overrides,
  };
  return { db, calls };
}
async function run(env: Record<string, string>, opts: Parameters<typeof workspace>[0] = {}, dbOverrides: Partial<EvidenceShadowDb> = {}, extra: { sha?: string | null; timeoutMs?: number; startShift?: number } = {}) {
  const ws = await workspace(opts), { db, calls } = fakeDb(dbOverrides), logs: string[] = [];
  const handle = await prepareEvidenceShadow({ videoClipId: CLIP, outDir: ws.dir, stillsDir: ws.stills, metrics,
    sourceSha256: extra.sha === undefined ? SHA : extra.sha, pipelineStartedAt: ws.startedAt + (extra.startShift ?? 0),
    extraction: { sequenceFrames: 1, sequenceSkipped: null }, env: (k) => env[k], db, log: (l) => logs.push(l), timeoutMs: extra.timeoutMs });
  return { handle, calls, logs, ws };
}

test("off (default) does nothing: no artifact read, no write, no log", async () => {
  const r = await run({});
  assert.equal(r.handle, null);
  assert.deepEqual(r.calls, []);
  assert.deepEqual(r.logs, []);
  assert.equal((await run({ EVIDENCE_GATE_MODE: "off" })).handle, null);
});

test("invalid flags and enforce (no enforced tuple) skip shadow without touching the database", async () => {
  const envs: Record<string, string>[] = [{ EVIDENCE_GATE_MODE: "SHADOW" }, { EVIDENCE_GATE_MODE: "enforce" },
    { REPORT_EVIDENCE_GATE_MODE: "enforce" }, { EVIDENCE_GATE_MODE: "shadow", ANALYSIS_ENGINE: "other" }];
  for (const env of envs) {
    const r = await run(env);
    assert.equal(r.handle, null);
    assert.deepEqual(r.calls, []);
    assert.deepEqual(r.logs, [`[evidence-shadow] skipped: invalid_or_unauthorized_flags (clip ${CLIP})`]);
  }
});

test("shadow records one assessment, then links the same attempt's run and records a decision per issue", async () => {
  const r = await run({ EVIDENCE_GATE_MODE: "shadow" });
  assert.ok(r.handle);
  assert.equal(r.handle.assessmentId, "assess-1");
  assert.deepEqual(r.calls.map(c => c.op), ["insert"]);
  const row = r.calls[0]!.args[0] as Record<string, unknown>;
  assert.equal(row.mode, "shadow");
  assert.equal(row.video_clip_id, CLIP);
  assert.equal(row.source_sha256, SHA);
  assert.equal(row.clip_status, "eligible");
  await r.handle.afterRun("run-9");
  assert.deepEqual(r.calls.map(c => c.op), ["insert", "link", "issues", "decision", "decision"]);
  assert.deepEqual(r.calls[1]!.args, ["run-9", "assess-1"]);
  const decision = r.calls[3]!.args[2] as Record<string, unknown>;
  assert.equal(r.calls[3]!.args[0], "i1");
  assert.equal(decision.displayable, false);
  assert.equal(decision.enforceEligible, false);
  assert.deepEqual(decision.reliability, { status: "unmeasured", profileVersion: null });
  // Logs: fixed codes + clip UUID only.
  for (const line of r.logs) assert.ok(!line.includes(r.ws.dir) && !line.includes("phase_stills"), line);
});

test("stale, missing or foreign artifacts never become this attempt's provenance", async () => {
  const stale = await run({ EVIDENCE_GATE_MODE: "shadow" }, {}, {}, { startShift: 60_000 });
  assert.equal(stale.handle, null);
  assert.deepEqual(stale.calls, []);
  assert.match(stale.logs.join(), /skipped: tuple_unavailable/);
  const noManifest = await run({ EVIDENCE_GATE_MODE: "shadow" }, { skip: ["engine_manifest.json"] });
  assert.equal(noManifest.handle, null);
  assert.match(noManifest.logs.join(), /tuple_unavailable/);
  const otherInput = await run({ EVIDENCE_GATE_MODE: "shadow" }, { manifestPatch: { input_sha256: "d".repeat(64) } });
  assert.equal(otherInput.handle, null);
  assert.match(otherInput.logs.join(), /source_hash_mismatch/);
  const noHash = await run({ EVIDENCE_GATE_MODE: "shadow" }, {}, {}, { sha: null });
  assert.equal(noHash.handle, null);
  assert.match(noHash.logs.join(), /source_hash_unavailable/);
  // Missing pose/bat files still yield an honest (withheld) assessment.
  const noPose = await run({ EVIDENCE_GATE_MODE: "shadow" }, { skip: ["pose_2d.json", "bat_path.json"] });
  assert.ok(noPose.handle);
  assert.equal((noPose.calls[0]!.args[0] as Record<string, unknown>).clip_status, "withhold");
});

test("persistence failures, hangs and a deleted clip only skip shadow work - nothing throws", async () => {
  const missingTable = await run({ EVIDENCE_GATE_MODE: "shadow" }, {}, {
    async insertAssessment() { throw new Error("evidence assessment insert failed (42P01)"); } });
  assert.equal(missingTable.handle, null);
  assert.match(missingTable.logs.join(), /persistence_unavailable evidence assessment insert failed \(42P01\)/);
  const hang = await run({ EVIDENCE_GATE_MODE: "shadow" }, {}, { insertAssessment: () => new Promise<string>(() => {}) }, { timeoutMs: 20 });
  assert.equal(hang.handle, null);
  assert.match(hang.logs.join(), /persistence_unavailable timeout/);
  const deletedClip = await run({ EVIDENCE_GATE_MODE: "shadow" }, {}, {
    async insertAssessment() { throw new Error("evidence assessment insert failed (23503)"); } });
  assert.equal(deletedClip.handle, null);

  const linkFails = await run({ EVIDENCE_GATE_MODE: "shadow" }, {}, { async linkRun() { throw new Error("analysis run evidence link failed (23503)"); } });
  assert.ok(linkFails.handle);
  await linkFails.handle.afterRun("run-1"); // resolves
  assert.deepEqual(linkFails.calls.map(c => c.op), ["insert"]);
  assert.match(linkFails.logs.join(), /run linkage incomplete/);
  const decisionHangs = await run({ EVIDENCE_GATE_MODE: "shadow" }, {}, { recordClaimDecision: () => new Promise<void>(() => {}) }, { timeoutMs: 20 });
  await decisionHangs.handle!.afterRun("run-2");
  assert.match(decisionHangs.logs.join(), /run linkage incomplete: timeout/);
  // Slow (not hung) steps share ONE budget: with many issues, afterRun stops
  // starting writes once 2 x timeoutMs is spent instead of N x timeoutMs.
  const many = Array.from({ length: 20 }, (_, i) => ({ id: `i${i}`, concept: "contact", phase: "contact" }));
  const slow = await run({ EVIDENCE_GATE_MODE: "shadow" }, {}, {
    async runIssues() { return many; },
    recordClaimDecision: () => new Promise<void>(resolve => setTimeout(resolve, 15)) }, { timeoutMs: 40 });
  const startedAt = Date.now();
  await slow.handle!.afterRun("run-3");
  assert.ok(Date.now() - startedAt < 200, `afterRun took ${Date.now() - startedAt}ms`);
  assert.match(slow.logs.join(), /run linkage incomplete: timeout/);
});

test("AI input names are image names only, never paths or other files", () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "pr10-names-"));
  tempDirs.push(dir);
  for (const f of ["phase_load.png", "phase_contact.png", "zoom_contact.png", "swing_seq_01.png", "analysis_result_x.json"]) fs.writeFileSync(path.join(dir, f), "x");
  assert.deepEqual(aiInputNames(dir, { sequenceFrames: 1, sequenceSkipped: null }),
    { phaseStills: ["phase_contact", "phase_load"], zooms: ["zoom_contact"], sequenceFrames: 1, sequenceSkipped: null });
  assert.deepEqual(aiInputNames(path.join(dir, "missing"), { sequenceFrames: 0, sequenceSkipped: "s" }).zooms, []);
});
