import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { evaluatePrivacyGate, loadPrivacyGateInput, sha256OfFile, type PrivacyApproval, type PrivacyGateInput, type PrivacySummary, type PrivacyValidation } from "./privacy.js";
import { parseCurationManifest } from "./curationManifest.js";

const SHA = "a".repeat(64), SRC = "b".repeat(64);
const summary = (over: Partial<PrivacySummary> = {}): PrivacySummary => ({
  name: "clip", status: "PASS_CANDIDATE", output: "clip.mp4", output_sha256: SHA, source_video_sha256: SRC,
  frames: 168, analysis_frames: 168, fps: 29.87, scale_from_analysis_px: 1 / 3, treatment: { method: "inverse-mask" },
  reject_reasons: [], review_reasons: [], ...over,
});
const validation = (over: Partial<PrivacyValidation> = {}): PrivacyValidation => ({
  output: "clip.mp4", verdict: "CLEAN", hard_failures: [], frames_with_findings: [],
  timing: { frames: 168, fps: 29.87, duration: 5.62 }, alignment: { median_err_frac: 0.013 }, ...over,
});
const approval = (over: Partial<PrivacyApproval> = {}): PrivacyApproval => ({
  clip: "clip", outputSha256: SHA, decision: "approve", reviewedBy: "Parent/coach", reviewedAt: "2026-09-24", ...over,
});
const gate = (over: Partial<PrivacyGateInput> = {}) => evaluatePrivacyGate({
  summary: summary(), validation: validation(), fileSha256: SHA, approval: approval(), expectedFrames: 168,
  localValidationOnly: false, analysisWindowStartS: 0, mediaTrimStartS: 0, ...over,
});
const has = (r: ReturnType<typeof gate>, re: RegExp) => r.errors.some((e) => re.test(e));

test("privacy gate: a validated, human-approved, aligned treated clip is publishable", () => {
  const r = gate();
  assert.deepEqual(r.errors, []);
  assert.equal(r.record.publishable, true);
  assert.equal((r.record.humanApproval as { reviewedBy: string }).reviewedBy, "Parent/coach");
});

test("missing privacy approval blocks export (and approval is never implied)", () => {
  const r = gate({ approval: null });
  assert.equal(r.ok, false);
  assert.ok(has(r, /no human publication approval/));
  assert.ok(has(gate({ approval: approval({ decision: "reject" }) }), /decision is "reject"/));
  assert.ok(has(gate({ approval: approval({ reviewedBy: " " }) }), /name the reviewer/));
});

test("tampered or changed media: file hash vs summary, and approval for a different file", () => {
  assert.ok(has(gate({ fileSha256: "c".repeat(64) }), /does not match the privacy summary/));
  assert.ok(has(gate({ approval: approval({ outputSha256: "d".repeat(64) }) }), /approval is for a different file/));
  assert.ok(has(gate({ fileSha256: null }), /does not match/));
});

test("rejected clips can never be approved; a FAILED independent validation blocks too", () => {
  const r = gate({ summary: summary({ status: "REJECT", reject_reasons: ["identity: wrong subject"] }) });
  assert.ok(has(r, /REJECTED: identity: wrong subject/));
  assert.equal(r.record.publishable, false);
  assert.ok(has(gate({ validation: validation({ verdict: "FAIL", hard_failures: ["fail-closed frames keep detail"] }) }), /validation FAILED/));
  assert.ok(has(gate({ validation: null }), /no independent validation/));
  assert.ok(has(gate({ summary: null }), /not been privacy-treated/));
});

test("manual-review items (unknown intervals, overlaps, validator findings) need an explicit resolution", () => {
  const review = summary({ status: "NEEDS_MANUAL_REVIEW", review_reasons: ["identity: track switches at frame 217; later frames obscured"] });
  assert.ok(has(gate({ summary: review }), /resolvedReviewItems: true/));
  assert.deepEqual(gate({ summary: review, approval: approval({ resolvedReviewItems: true }) }).errors, []);
  assert.ok(has(gate({ validation: validation({ verdict: "FINDINGS", frames_with_findings: [33] }) }), /resolvedReviewItems/));
});

test("frame-timing preservation: treated media must have exactly the analyzed frame count", () => {
  assert.ok(has(gate({ summary: summary({ frames: 167 }) }), /167 frames, the analysis has 168/));
  assert.ok(has(gate({ expectedFrames: 170 }), /the clip record has 170/));
  assert.ok(has(gate({ validation: validation({ timing: { frames: 160, fps: 29.87, duration: 5.3 } }) }), /validator decoded 160/));
});

test("analysis/overlay alignment: trim must start at the analysis window (offset 0), and must be known", () => {
  assert.deepEqual(gate({ analysisWindowStartS: 32.864, mediaTrimStartS: 32.864 }).errors, []);
  assert.ok(has(gate({ analysisWindowStartS: 32.864, mediaTrimStartS: 30 }), /misaligned/));
  assert.ok(has(gate({ analysisWindowStartS: null }), /alignment can't be proven/));
});

test("original-file exclusion: the source recording itself is never accepted as demo media", () => {
  assert.ok(has(gate({ fileSha256: SRC, summary: summary({ output_sha256: SRC }), approval: approval({ outputSha256: SRC }) }), /IS the original recording/));
});

test("local-validation fixtures skip human approval but are recorded as never publishable; REJECT still blocks", () => {
  const r = gate({ approval: null, localValidationOnly: true });
  assert.equal(r.ok, true);
  assert.equal(r.record.publishable, false);
  assert.match(String(r.record.approvalState), /never publishable/);
  assert.equal(gate({ approval: null, localValidationOnly: true, summary: summary({ status: "REJECT" }) }).ok, false);
});

test("manifest: untreated raw-transcode media is only allowed in local-validation manifests", () => {
  const base = {
    manifestVersion: 1, fixtureId: "emily", fixtureVersion: "v1", source: { teamSlug: "t", playerSlug: "p" },
    publication: { consentConfirmedBy: "Parent", consentConfirmedAt: "2026-09-24" }, team: { publicName: "Team" },
    player: { publicName: "Player A.", publicSlug: "player-a" }, clips: [{ clipSlug: "c", privacy: { name: "clip" } }], priorities: "none",
  };
  assert.deepEqual(parseCurationManifest(base).problems, []);
  assert.ok(parseCurationManifest({ ...base, mediaPolicy: "raw-transcode" }).problems.some((p) => p.path === "mediaPolicy"));
  assert.deepEqual(parseCurationManifest({ ...base, localValidationOnly: true, fixtureId: "local-x", mediaPolicy: "raw-transcode" }).problems, []);
  assert.ok(parseCurationManifest({ ...base, clips: [{ clipSlug: "c", privacy: { name: "../escape" } }] }).problems.some((p) => p.path === "clips[0].privacy"));
});

test("loader: reads the treated file's real hash and the matching approval from disk", () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "privacy-gate-"));
  fs.writeFileSync(path.join(dir, "clip.mp4"), "treated-bytes");
  const sha = sha256OfFile(path.join(dir, "clip.mp4"))!;
  fs.writeFileSync(path.join(dir, "clip.summary.json"), JSON.stringify(summary({ output_sha256: sha })));
  fs.writeFileSync(path.join(dir, "clip.validation.json"), JSON.stringify(validation()));
  fs.writeFileSync(path.join(dir, "approvals.json"), JSON.stringify({ approvals: [approval({ outputSha256: sha })] }));
  const input = loadPrivacyGateInput({ dir, name: "clip", approvalsFile: path.join(dir, "approvals.json"), expectedFrames: 168, localValidationOnly: false });
  assert.deepEqual(evaluatePrivacyGate({ ...input, analysisWindowStartS: 0, mediaTrimStartS: 0 }).errors, []);
  fs.appendFileSync(path.join(dir, "clip.mp4"), "x"); // tamper after approval
  const tampered = loadPrivacyGateInput({ dir, name: "clip", approvalsFile: path.join(dir, "approvals.json"), expectedFrames: 168, localValidationOnly: false });
  assert.equal(evaluatePrivacyGate({ ...tampered, analysisWindowStartS: 0, mediaTrimStartS: 0 }).ok, false);
  fs.rmSync(dir, { recursive: true, force: true });
});
