import assert from "node:assert/strict";
import test from "node:test";
import { createHash } from "node:crypto";
import { syncBuiltinESMExports } from "node:module";
import fs, { mkdtemp, writeFile, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { buildEvidencePackage, validateEvidencePackage, describePackageForLog, suppliedEvidenceForV3, type EvidencePackageInput } from "./evidencePackage.ts";
import { BASELINE_ENGINE, LEGACY_PIPELINE_VERSION } from "../development/evidenceRegistry.ts";
import { observedTuple } from "../development/evidence/shadowAssessment.ts";
import { assessClip } from "../development/evidence/assessClip.ts";
import { assessSufficiency } from "../development/evidence/sufficiency.ts";
import { render21, render22 } from "./renderers.ts";

const dirs: string[] = [];
test.after(async () => { for (const dir of dirs) await rm(dir, { recursive: true, force: true }); });
const png = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0, 1, 2]);
const jpeg = Buffer.from([0xff, 0xd8, 0xff, 0, 1, 2]);
const sourceSha256 = "2".repeat(64);
async function fixture(pts = [0, 40, 80]) {
  const imagesDir = await mkdtemp(path.join(os.tmpdir(), "pr12-package-")); dirs.push(imagesDir);
  const frames = pts.map((p, i) => ({ analysis_index: i, raw_frame: i + 10, raw_pts: p,
    raw_time_base: "1/1000", raw_pts_s: p / 1000, status: "verified", reasons: [] }));
  const frameMapJson = JSON.stringify({ schema_version: 1, instrumentation_version: "inst-1", verified: true,
    status: "verified", reasons: [], run_id: "1".repeat(32), input_sha256: sourceSha256, attempt_number: 1, frames });
  const manifest = { schema_version: 1, instrumentation_version: "inst-1", engine_code_version: BASELINE_ENGINE,
    environment_version: "env-synthetic", run_id: "1".repeat(32), input_sha256: sourceSha256, attempt_number: 1,
    pose_decoded_frames: pts.length, bat_decoded_frames: pts.length,
    frame_map_sha256: createHash("sha256").update(frameMapJson).digest("hex") };
  const images: EvidencePackageInput["images"] = [
    { name: "a-late.png", kind: "phase_still", phase: "contact", analysisFrame: 2, assumed: { rawFrame: 999, rawPtsS: 9 } },
    { name: "z-early.jpeg", kind: "swing_sequence", phase: null, analysisFrame: 0, assumed: { rawFrame: 888, rawPtsS: 0 } },
    { name: "zoom.jpg", kind: "zoom", phase: "contact", analysisFrame: 2, assumed: { rawFrame: 777, rawPtsS: 9 } },
  ];
  for (const image of images) await writeFile(path.join(imagesDir, image.name), image.name.endsWith(".png") ? png : jpeg);
  const input: EvidencePackageInput = { imagesDir, images, videoClipId: "synthetic-clip", sourceSha256, manifest, frameMapJson,
    metrics: { pipeline_version: LEGACY_PIPELINE_VERSION, fps: 999, phases: { contact: { frame: 2, time_s: 999, method: "synthetic", confidence: "high" } } },
    capture: { profile: "game_backstop", limitations: ["synthetic_only"] },
    analysisInput: {
      player: { sport: "softball", level: null, ageBand: null, bats: null, throws: null },
      pitch: { location: null, zone: null, count: null, outcome: null, swung: null, pitchType: null },
      swing: { frameNames: images.map(i => i.name), pipelineVersion: LEGACY_PIPELINE_VERSION, metrics: {}, reconstructionSupplied: false, excludedMeasurements: [] },
      coachReviewedDecisions: [], knowledgePack: "No approved claims.", knowledgeClaimIds: [], knowledgeVersion: "synthetic",
    } };
  input.assessment = await assessClip({ tuple: observedTuple(manifest), subject: {}, metrics: input.metrics, frameMap: { frameMapJson, manifest } });
  return { input, manifest, frames };
}
async function built(input: EvidencePackageInput) {
  const result = await buildEvidencePackage(input); assert.equal(result.ok, true, JSON.stringify(result));
  if (!result.ok) throw new Error("fixture failed"); return result;
}
async function rejected(input: EvidencePackageInput, code: string) {
  const result = await buildEvidencePackage(input); assert.equal(result.ok, false);
  if (!result.ok) assert.equal(result.error.code, code);
}
test("deterministic digest ignores object key insertion order and snapshots caller data", async () => {
  const { input } = await fixture();
  const a = await built(input), b = await built(input);
  assert.equal(a.digest, b.digest);
  const reverseKeys = (v: any): any => Array.isArray(v) ? v.map(reverseKeys) : v && typeof v === "object"
    ? Object.fromEntries(Object.entries(v).reverse().map(([k, value]) => [k, reverseKeys(value)])) : v;
  assert.equal(a.digest, (await built(reverseKeys(input))).digest);
  input.analysisInput.knowledgePack = "changed";
  assert.equal(a.pkg.analysisInput.knowledgePack, "No approved claims.");
});
for (const pts of [[0, 40, 80], [0, 31, 97]]) test(`verified ${pts[1] === 40 ? "CFR" : "VFR"} identity and temporal order, equal-PTS kind tie`, async () => {
  const { input, frames } = await fixture(pts), { pkg } = await built(input);
  assert.deepEqual(pkg.images.map(i => i.name), ["z-early.jpeg", "a-late.png", "zoom.jpg"]);
  assert.deepEqual(pkg.images.map(i => i.orderInSwing), [0, 1, 2]);
  assert.deepEqual(pkg.images.map(i => i.rawPtsS), [0, pts[2]! / 1000, pts[2]! / 1000]);
  for (const i of pkg.images) {
    const row = frames[i.analysisFrame!]!;
    assert.equal(i.identity, "verified"); assert.equal(i.rawFrame, row.raw_frame);
    assert.equal(i.rawPts, row.raw_pts); assert.equal(i.rawTimeBase, "1/1000");
    assert.equal(i.depiction, "unverified_by_name");
  }
  assert.equal(pkg.images[1]!.assumed.rawFrame, 999);
  assert.equal(render21(pkg).labels, null);
  assert.deepEqual(render21(pkg).imageOrder, ["a-late.png", "z-early.jpeg", "zoom.jpg"]);
  assert.deepEqual(render22(pkg).imageOrder, pkg.images.map(i => i.name));
  assert.equal(render22(pkg).text, render21(pkg).text);
  assert.match(render22(pkg).labels!["a-late.png"]!, /contact \| verified/);
});
for (const scenario of ["absent", "unverified"] as const) test(`${scenario} frame map never promotes assumptions, filenames, order or fps`, async () => {
  const { input } = await fixture();
  input.frameMapJson = scenario === "absent" ? null : "{}";
  const { pkg } = await built(input);
  assert.equal(pkg.frameMap.status, scenario);
  for (const image of pkg.images) {
    assert.equal(image.identity, "unverified");
    assert.deepEqual([image.rawFrame, image.rawPts, image.rawTimeBase, image.rawPtsS], [null, null, null, null]);
    assert.deepEqual(image.identityReasons, [scenario === "absent" ? "FRAME_MAP_ABSENT" : "FRAME_MAP_UNVERIFIED"]);
  }
  assert.equal(pkg.images[0]!.name, "z-early.jpeg");
  assert.match(render22(pkg).labels!["a-late.png"]!, /unverified$/);
});
test("verified map with null or missing analysis index is unavailable", async () => {
  const { input } = await fixture(); input.images[0]!.analysisFrame = null; input.images[2]!.analysisFrame = 999;
  const { pkg } = await built(input);
  assert.equal(pkg.images.filter(i => i.identity === "unavailable").length, 2);
  assert.ok(suppliedEvidenceForV3(pkg, render21(pkg)).exclusions.every(e => e.reason === "identity_unavailable"));
});
for (const [title, change, code] of [
  ["missing PTS", (i: EvidencePackageInput) => { i.frameMapJson = null; delete i.images[0]!.assumed; }, "MISSING_PTS:a-late.png"],
  ["source mismatch", (i: EvidencePackageInput) => { i.sourceSha256 = "3".repeat(64); }, "SOURCE_MISMATCH"],
  ["attempt tuple mismatch", (i: EvidencePackageInput) => { i.assessment!.tuple = null; }, "ATTEMPT_MISMATCH"],
  ["pipeline version", (i: EvidencePackageInput) => { i.metrics = { pipeline_version: "unknown" }; }, "UNSUPPORTED_VERSION"],
  ["manifest version", (i: EvidencePackageInput) => { (i.manifest as any).schema_version = 2; }, "UNSUPPORTED_VERSION"],
  ["manifest instrumentation", (i: EvidencePackageInput) => { (i.manifest as any).instrumentation_version = "inst-2"; }, "UNSUPPORTED_VERSION"],
  ["manifest engine", (i: EvidencePackageInput) => { (i.manifest as any).engine_code_version = "other"; }, "UNSUPPORTED_VERSION"],
  ["source hash", (i: EvidencePackageInput) => { i.sourceSha256 = "A".repeat(64); }, "INVALID_SOURCE_HASH"],
  ["duplicate", (i: EvidencePackageInput) => { i.images.push({ ...i.images[0]! }); }, "DUPLICATE_IMAGE"],
  ["traversal", (i: EvidencePackageInput) => { i.images[0]!.name = "../escape.png"; }, "INVALID_IMAGE_NAME"],
  ["Windows traversal", (i: EvidencePackageInput) => { i.images[0]!.name = "..\\escape.png"; }, "INVALID_IMAGE_NAME"],
] as const) test(`rejects ${title}`, async () => { const { input } = await fixture(); change(input); await rejected(input, code); });
test("missing image and wrong magic reject", async () => {
  const { input } = await fixture();
  await writeFile(path.join(input.imagesDir, "a-late.png"), jpeg);
  await rejected(input, "MALFORMED_IMAGE:a-late.png");
  await rm(path.join(input.imagesDir, "a-late.png"));
  await rejected(input, "MISSING_IMAGE:a-late.png");
});
test("JPEG magic and regular non-symlink files are required", async t => {
  const { input } = await fixture();
  await writeFile(path.join(input.imagesDir, "zoom.jpg"), png);
  await rejected(input, "MALFORMED_IMAGE:zoom.jpg");
  // A synthetic stat double exercises refusal without requiring Windows symlink privileges.
  const stats = t.mock.method(fs, "lstat", async () => ({ isFile: () => true, isSymbolicLink: () => true }) as any);
  const reads = t.mock.method(fs, "readFile", async () => { throw new Error("must not read symlink"); });
  syncBuiltinESMExports();
  try {
    await rejected(input, "MALFORMED_IMAGE:a-late.png");
    assert.equal(stats.mock.callCount(), 1); assert.equal(reads.mock.callCount(), 0);
  } finally { t.mock.restoreAll(); syncBuiltinESMExports(); }
});
test("equal kind/time uses default name order and V3 sequences follow raw PTS", async () => {
  const { input } = await fixture();
  input.images.push({ name: "B-sequence.png", kind: "swing_sequence", phase: null, analysisFrame: 2 },
    { name: "A-sequence.png", kind: "swing_sequence", phase: null, analysisFrame: 2 });
  await writeFile(path.join(input.imagesDir, "B-sequence.png"), png);
  await writeFile(path.join(input.imagesDir, "A-sequence.png"), png);
  const { pkg } = await built(input);
  assert.deepEqual(pkg.images.map(i => i.name), ["z-early.jpeg", "a-late.png", "zoom.jpg", "A-sequence.png", "B-sequence.png"]);
  const v3 = suppliedEvidenceForV3(pkg, { imageOrder: ["B-sequence.png", "z-early.jpeg"] });
  assert.deepEqual(v3.supplied!.sequence, [{ frame_index: 10, pts: 0 }, { frame_index: 12, pts: 80 }]);
  assert.equal(v3.exclusions.find(e => e.name === "A-sequence.png")!.reason, "not_sent");
});
test("undeclared and not-generated are explicit, omitted files are not assets", async () => {
  const { input } = await fixture();
  await writeFile(path.join(input.imagesDir, "extra.png"), png);
  input.expected = [{ kind: "phase_still", phase: "load", reason: "not_located" }, { kind: "zoom", phase: "contact" }];
  const { pkg, assets } = await built(input);
  assert.deepEqual(pkg.availability.omitted, [{ name: "extra.png", reason: "undeclared" }]);
  assert.deepEqual(pkg.availability.notGenerated, [{ kind: "phase_still", phase: "load", reason: "not_located" }]);
  assert.equal(assets.has("extra.png"), false);
  assert.equal(pkg.availability.generated.length, 4);
  assert.ok(pkg.availability.generated.includes("extra.png"));
});
test("absent provenance is null, never inferred from the pipeline", async () => {
  const { input } = await fixture(); delete input.manifest; input.assessment = null; input.frameMapJson = null;
  const { pkg } = await built(input);
  assert.equal(pkg.attempt, null); assert.equal(pkg.provenance.tuple, null);
  assert.equal(pkg.provenance.engineCodeVersion, null); assert.equal(pkg.events, null);
});
test("serialization and logs are path-free; validation rejects malformed required fields, order and paths", async () => {
  const { input } = await fixture(), { pkg } = await built(input);
  for (const text of [JSON.stringify(pkg), JSON.stringify(describePackageForLog(pkg))]) {
    assert.ok(!text.includes(input.imagesDir)); assert.ok(!text.includes("C:\\")); assert.ok(!text.includes("/tmp"));
  }
  assert.equal(validateEvidencePackage(pkg).valid, true);
  for (const key of Object.keys(pkg)) {
    const copy: any = structuredClone(pkg); delete copy[key];
    assert.equal(validateEvidencePackage(copy).valid, false, `required package field ${key}`);
  }
  for (const key of Object.keys(pkg.images[0]!)) {
    const copy: any = structuredClone(pkg); delete copy.images[0][key];
    assert.equal(validateEvidencePackage(copy).valid, false, `required image field ${key}`);
  }
  const mutations = [
    (p: any) => { p.version = "future"; }, (p: any) => { delete p.clip; },
    (p: any) => { delete p.images[0].sha256; }, (p: any) => { p.images.reverse(); },
    (p: any) => { p.images[0].rawPtsS = 99; }, (p: any) => { p.path = "relative"; },
    (p: any) => { p.analysisInput.knowledgePack = "C:\\private\\image.png"; },
    (p: any) => { p.capture.limitations.push("/tmp/private.png"); },
    (p: any) => { delete p.assessment.subject.status; },
    (p: any) => { p.events.impact_estimate.status = "invented"; },
    (p: any) => { p.analysisInput.pitch.count = {}; },
  ];
  for (const mutate of mutations) { const copy = structuredClone(pkg); mutate(copy); assert.equal(validateEvidencePackage(copy).valid, false); }
  input.analysisInput.knowledgePack = "private /tmp/private.png";
  await rejected(input, "INVALID_PACKAGE");
});
test("V3 distinguishes no package, not supplied and present-but-not-sent; partial sequences", async () => {
  assert.deepEqual(suppliedEvidenceForV3(null, null), { status: "package_unavailable", supplied: null, exclusions: [], approval: "not_coach_reviewed" });
  const { input } = await fixture(), { pkg } = await built(input);
  assert.equal(suppliedEvidenceForV3(pkg, null).status, "not_supplied");
  const output = suppliedEvidenceForV3(pkg, { imageOrder: ["z-early.jpeg"] });
  assert.deepEqual(output.supplied!.sequence, [{ frame_index: 10, pts: 0 }]);
  assert.deepEqual(output.exclusions.map(e => e.reason), ["not_sent", "not_sent"]);
  assert.equal(output.supplied!.captureProfile, "game_backstop");
  assert.equal(output.approval, "not_coach_reviewed");
  pkg.images[0]!.identity = "unverified";
  assert.equal(suppliedEvidenceForV3(pkg, { imageOrder: ["z-early.jpeg"] }).exclusions[0]!.reason, "identity_unverified");
});
test("V3 binds contact only to passing identical impact estimate; visibility stays insufficient", async () => {
  const { input } = await fixture(), { pkg } = await built(input);
  for (const mode of ["fail", "mismatch", "pass"]) {
    const copy = structuredClone(pkg);
    if (mode === "fail") copy.events!.impact_estimate.status = "fail";
    if (mode === "mismatch") copy.events!.impact_estimate.rawFrame = 777;
    const v3 = suppliedEvidenceForV3(copy, render21(copy));
    assert.equal(v3.approval, "not_coach_reviewed");
    assert.equal(v3.supplied!.stills.contact_confirmed, undefined);
    assert.equal(v3.supplied!.zooms.contact_confirmed, undefined);
    if (mode === "pass") {
      assert.deepEqual(v3.supplied!.stills.impact_estimate, { frame_index: 12, pts: 80 });
      assert.deepEqual(v3.supplied!.zooms.impact_estimate, { frame_index: 12, pts: 80 });
    } else {
      assert.equal(v3.supplied!.stills.impact_estimate, undefined);
      assert.ok(v3.exclusions.every(e => e.reason === "not_bound_to_verified_event"));
    }
    assert.equal(assessSufficiency("contact", "contact", v3.supplied, copy.visibility, copy.events).status, "insufficient");
  }
});
