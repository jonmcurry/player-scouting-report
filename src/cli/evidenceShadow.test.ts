import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import { createHash } from "node:crypto";
import { analysisImageDescriptors } from "./extract.js";
import { loadFrameImages } from "./analyze.js";
import type { AnalysisInput } from "../services/ai/analysisContext.js";
import type { AnalysisImageDescriptor } from "./extract.js";
import type { ShadowTransmission } from "./evidenceShadow.js";
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
  assert.match(missingTable.logs.join(), /persistence_unavailable database_error/);
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

const png = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0, 1, 2]);
const digest = (b: Buffer) => createHash("sha256").update(b).digest("hex");
const descriptors = (): AnalysisImageDescriptor[] => [
  { name: "phase_contact.png", kind: "phase_still", phase: "contact", analysisFrame: 5, assumed: { rawFrame: 5, rawPtsS: 0.165 } },
  { name: "zoom_contact.png", kind: "zoom", phase: "contact", analysisFrame: 5, assumed: { rawFrame: 5, rawPtsS: 0.165 } },
  { name: "swing_seq_01.png", kind: "swing_sequence", phase: null, analysisFrame: 2, assumed: { rawFrame: 2, rawPtsS: 0.066 } },
];
const input = (): AnalysisInput => ({
  player: { sport: "softball", level: null, ageBand: null, bats: null, throws: null },
  pitch: { location: null, zone: null, count: null, outcome: null, swung: null, pitchType: null },
  swing: { frameNames: descriptors().map(i => i.name), pipelineVersion: "pose3d-live-1.0.0", metrics: {},
    reconstructionSupplied: false, excludedMeasurements: [] },
  coachReviewedDecisions: [], knowledgePack: "Synthetic", knowledgeClaimIds: [], knowledgeVersion: "synthetic",
});
const attested = (): ShadowTransmission => ({ mode: "attested", images: descriptors().map(i => ({ name: i.name, sha256: digest(png) })) });
async function packageRun(options: {
  images?: AnalysisImageDescriptor[] | null; transmission?: ShadowTransmission; noContext?: boolean;
  manifestPatch?: Record<string, unknown>; metrics?: unknown; missing?: boolean; mutateArtifacts?: boolean;
} = {}) {
  const ws = await workspace({ manifestPatch: options.manifestPatch });
  for (const d of descriptors()) fs.writeFileSync(path.join(ws.stills, d.name), png);
  if (options.missing) fs.unlinkSync(path.join(ws.stills, "phase_contact.png"));
  const { db, calls } = fakeDb(), logs: string[] = [];
  const handle = await prepareEvidenceShadow({ videoClipId: CLIP, outDir: ws.dir, stillsDir: ws.stills,
    metrics: options.metrics ?? metrics, sourceSha256: SHA, pipelineStartedAt: ws.startedAt,
    extraction: { sequenceFrames: 1, sequenceSkipped: null }, images: options.images === null ? undefined : options.images ?? descriptors(),
    env: k => k === "EVIDENCE_GATE_MODE" ? "shadow" : undefined, db, log: l => logs.push(l) });
  assert.ok(handle);
  if (options.mutateArtifacts) {
    fs.writeFileSync(path.join(ws.dir, "engine_manifest.json"), "{}");
    fs.writeFileSync(path.join(ws.dir, "frame_map.json"), "{}");
  }
  await handle.afterRun("run-package", options.noContext ? undefined : { input: input(), transmission: options.transmission ?? attested() });
  const records = calls.filter(c => c.op === "decision").map(c => c.args[2] as any);
  assert.equal(records.length, 2);
  for (const record of records) {
    assert.equal(record.schema, "claim-decision-shadow-2");
    assert.equal(record.visibility, null);
    assert.deepEqual(record.reliability, { status: "unmeasured", profileVersion: null });
    assert.equal(record.displayable, false);
    assert.equal(record.enforceEligible, false);
    assert.doesNotMatch(JSON.stringify(record), /phase_contact|zoom_contact|swing_seq|rawFrame|analysisFrame|frame_index|rawPts|sha256|[A-Z]:\\/);
    assert.ok(!JSON.stringify(record).includes(digest(png)));
  }
  return { records, logs };
}

test("extraction metadata preserves write order and labels raw identity assumed", () => {
  const written = [
    { name: "phase_contact.png", kind: "phase_still" as const, phase: "contact", analysisFrame: 2, rawFrame: 3 },
    { name: "zoom_contact.png", kind: "zoom" as const, phase: "contact", analysisFrame: 2, rawFrame: 3 },
    { name: "swing_seq_01.png", kind: "swing_sequence" as const, phase: null, analysisFrame: 1, rawFrame: 1 },
  ];
  const original = structuredClone(written);
  const images = analysisImageDescriptors(written, [0, 0.031, 0.061, 0.099]);
  assert.deepEqual(images, written.map(({ rawFrame, ...rest }) => ({ ...rest, assumed: { rawFrame, rawPtsS: rawFrame === 3 ? 0.099 : 0.031 } })));
  assert.deepEqual(written, original);
  assert.deepEqual(analysisImageDescriptors([], []), []);
  assert.equal(analysisImageDescriptors(written.slice(0, 1), [0, 0.031, 0.061, 0.099]).length, 1);
});

test("extraction grab calls, ordering and legacy return fields are unchanged", () => {
  const source = fs.readFileSync(path.resolve(process.cwd(), "src/cli/extract.ts"), "utf8").replaceAll("\r\n", "\n");
  const grabs = source.split("\n").filter(l => l.includes("await grabFrame("));
  assert.deepEqual(grabs.map(l => l.trim()), [
    'await grabFrame(src.videoPath, seek, [], path.join(outDir, `phase_${phase.slug}.png`));',
    'await grabFrame(src.videoPath, seek, [cropScaleFilter(box, src)], path.join(outDir, `zoom_${phase.slug}.png`));',
    'await grabFrame(src.videoPath, seekBefore(pts, raw[i]!), [cropScaleFilter(box, src)], path.join(outDir, `swing_seq_${String(i + 1).padStart(2, "0")}.png`));',
  ]);
  assert.match(source, /return \{ phaseStills: phases.length, zooms, sequenceFrames, sequenceSkipped, images: analysisImageDescriptors\(written, pts\) \}/);
  for (const call of grabs) assert.match(source.slice(source.indexOf(call) + call.length), /^\n\s+written.push\(/);
});

test("Gemini loader is byte/order/MIME equal to the legacy loader; no hash without hook", () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "pr10-loader-")); tempDirs.push(dir);
  for (const [name, bytes] of [["z.PNG", png], ["a.jpg", Buffer.from([255, 216, 255])], ["b.JPEG", Buffer.from([1])], ["ignored.json", Buffer.from("{}")] ] as const)
    fs.writeFileSync(path.join(dir, name), bytes);
  const names = fs.readdirSync(dir).filter(f => new Set([".png", ".jpg", ".jpeg"]).has(path.extname(f).toLowerCase())).sort();
  const legacy = names.map(f => ({ data: fs.readFileSync(path.join(dir, f)), mimeType: path.extname(f).toLowerCase() === ".png" ? "image/png" : "image/jpeg" }));
  assert.deepEqual(loadFrameImages(dir), { frames: legacy, names });
  const source = fs.readFileSync(path.resolve(process.cwd(), "src/cli/analyze.ts"), "utf8").replaceAll("\r\n", "\n");
  const gemini = source.slice(source.indexOf('const { frames, names } = loadFrameImages'), source.indexOf('// Both backends'));
  assert.match(gemini, /if \(evidenceShadow\) \{[\s\S]*createHash\("sha256"\)\.update\(frame.data\)/);
  assert.equal(source.match(/createHash\("sha256"\)/g)?.length, 1);
  assert.match(gemini, /analyzeSwing\(frames, input\)/);
  assert.match(source, /reason: claudeDraftPath \? "draft_file_no_transmission" : "cli_backend_reads_directory"/);
});

test("off hook performs zero filesystem reads", async t => {
  const fail = () => { throw new Error("unexpected filesystem read"); };
  const reads = [t.mock.method(fs, "existsSync", fail), t.mock.method(fs, "statSync", fail),
    t.mock.method(fs, "readFileSync", fail), t.mock.method(fs, "readdirSync", fail)];
  const logs: string[] = [];
  try {
    assert.equal(await prepareEvidenceShadow({ videoClipId: CLIP, outDir: "unused", stillsDir: "unused", metrics: {},
      sourceSha256: SHA, pipelineStartedAt: 0, extraction: { sequenceFrames: 0, sequenceSkipped: null }, env: () => undefined,
      log: l => logs.push(l) }), null);
    assert.deepEqual(reads.map(r => r.mock.callCount()), [0, 0, 0, 0]);
    assert.deepEqual(logs, []);
  } finally { t.mock.restoreAll(); }
});

test("attested exact buffers count V3 and reuse captured artifacts, never re-read", async () => {
  const { records } = await packageRun({ mutateArtifacts: true });
  assert.equal(records[0].package.status, "built");
  assert.equal(records[0].package.frameMap, "verified");
  assert.match(records[0].package.digest, /^[a-f0-9]{64}$/);
  assert.deepEqual(records[0].supplied, { status: "supplied", sent: 3, counted: { stills: 1, zooms: 1, sequence: 1 }, exclusionReasons: [] });
  assert.ok(records[0].sufficiency.missing.some((s: string) => s.includes("visibility")));
});
for (const mismatch of ["name", "hash"] as const) test(`attestation ${mismatch} mismatch never counts supply`, async () => {
  const transmission = attested(); assert.equal(transmission.mode, "attested");
  if (transmission.mode === "attested") {
    if (mismatch === "name") transmission.images[0]!.name = "not_in_package.png";
    else transmission.images[0]!.sha256 = "0".repeat(64);
  }
  const { records } = await packageRun({ transmission });
  assert.equal(records[0].supplied.status, "transmission_mismatch");
  assert.deepEqual(records[0].supplied.counted, { stills: 0, zooms: 0, sequence: 0 });
});
for (const reason of ["cli_backend_reads_directory", "draft_file_no_transmission"] as const)
  test(`unattested ${reason} never counts a generated package as transmission`, async () => {
    const { records } = await packageRun({ transmission: { mode: "unattested", reason } });
    assert.equal(records[0].package.status, "built");
    assert.equal(records[0].supplied.status, "unattested");
    assert.equal(records[0].supplied.sent, 0);
    assert.deepEqual(records[0].supplied.counted, { stills: 0, zooms: 0, sequence: 0 });
  });
for (const options of [{ images: null }, { noContext: true }, { missing: true }])
  test(`package unavailable ${JSON.stringify(options)} fails closed with fixed code`, async () => {
    const { records, logs } = await packageRun(options);
    assert.equal(records[0].package.status, "package_unavailable");
    assert.equal(records[0].package.errorCode, "missing" in options ? "MISSING_IMAGE" : "MISSING_CONTEXT_OR_DESCRIPTORS");
    assert.equal(records[0].supplied.status, "package_unavailable");
    assert.doesNotMatch(logs.join(), /phase_contact|\.png|phase_stills/);
  });

test("unverified map counts nothing, even with matching transmitted bytes", async () => {
  const { records } = await packageRun({ manifestPatch: { frame_map_sha256: "f".repeat(64) } });
  assert.equal(records[0].package.frameMap, "unverified");
  assert.deepEqual(records[0].supplied.counted, { stills: 0, zooms: 0, sequence: 0 });
  assert.deepEqual(records[0].supplied.exclusionReasons, ["identity_unverified"]);
});
for (const state of ["failed", "different_frame"]) test(`event binding ${state} excludes still and zoom`, async () => {
  const changed = structuredClone(metrics);
  if (state === "failed") { changed.contact.confidence = "low"; changed.phases.contact.confidence = "low"; }
  else { changed.contact.frame = 6; changed.phases.contact.frame = 6; }
  const { records } = await packageRun({ metrics: changed });
  assert.deepEqual(records[0].supplied.counted, { stills: 0, zooms: 0, sequence: 1 });
  assert.deepEqual(records[0].supplied.exclusionReasons, ["not_bound_to_verified_event"]);
});

test("arbitrary database messages never reach logs", async () => {
  const r = await run({ EVIDENCE_GATE_MODE: "shadow" }, {}, { async insertAssessment() { throw new Error("private-name C:/private/image.png"); } });
  assert.deepEqual(r.logs, [`[evidence-shadow] skipped: persistence_unavailable database_error (clip ${CLIP})`]);
  const link = await run({ EVIDENCE_GATE_MODE: "shadow" }, {}, { async linkRun() { throw new Error("private-name C:/private/image.png"); } });
  await link.handle!.afterRun("run");
  assert.equal(link.logs.at(-1), `[evidence-shadow] run linkage incomplete: database_error (clip ${CLIP})`);
});

test("partial attestation counts only sent images and sorts unique exclusion codes", async () => {
  const transmission = attested();
  if (transmission.mode === "attested") transmission.images = transmission.images.slice(0, 1);
  const { records } = await packageRun({ transmission });
  assert.deepEqual(records[0].supplied, { status: "supplied", sent: 1,
    counted: { stills: 1, zooms: 0, sequence: 0 }, exclusionReasons: ["not_sent"] });
  assert.equal(records[0].requiredEvents.impact_estimate, "pass");
  assert.equal(records[0].requiredEvents.contact_confirmed, undefined);
});

test("throwing diagnostic sink never escapes prepare or afterRun", async () => {
  const ws = await workspace();
  const { db } = fakeDb({ async linkRun() { throw new Error("private driver text"); } });
  const handle = await prepareEvidenceShadow({ videoClipId: CLIP, outDir: ws.dir, stillsDir: ws.stills, metrics,
    sourceSha256: SHA, pipelineStartedAt: ws.startedAt, extraction: { sequenceFrames: 1, sequenceSkipped: null },
    env: k => k === "EVIDENCE_GATE_MODE" ? "shadow" : undefined, db, log: () => { throw new Error("broken sink"); } });
  assert.ok(handle);
  await assert.doesNotReject(handle.afterRun("run"));
});
