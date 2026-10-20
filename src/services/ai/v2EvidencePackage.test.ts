import assert from "node:assert/strict";
import test from "node:test";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { buildV2EvidencePackage, renderV2Addendum, v2PhaseFrames, validateV2EvidencePackage, V2_STATEMENTS,
  type V2ImageDescriptor, type V2PackageInput } from "./v2EvidencePackage.js";
import { syntheticArtifacts, syntheticImages, SYNTHETIC_SOURCE_SHA as SHA } from "./v2EvidencePackage.fixtures.js";

function packageInput(dir: string, images: V2ImageDescriptor[], a = syntheticArtifacts()): V2PackageInput {
  return { videoClipId: "synthetic-clip", sourceSha256: SHA, imagesDir: dir, images, metrics: a.metrics, frameMap: a.frameMap,
    batPath: a.batPath, pose2d: a.pose2d, tracks: a.tracks };
}

function tempDir(t: test.TestContext) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "v2pkg-"));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  return dir;
}

test("only supported (available, experimental, phase-mapped) events become extraction phases", () => {
  assert.deepEqual(v2PhaseFrames(syntheticArtifacts().metrics), [{ slug: "load", frame: 3 }, { slug: "contact", frame: 8 }, { slug: "follow_through", frame: 10 }]);
});

test("package orders images by source PTS, labels events and never calls interpolation an observation", async t => {
  const dir = tempDir(t);
  // Names sort differently from time: z_ sequence frame is earliest.
  const images = syntheticImages(dir, [["phase_follow_through.png", "phase_still", "follow_through", 10], ["phase_contact.png", "phase_still", "contact", 8],
    ["swing_seq_01.png", "swing_sequence", null, 2], ["phase_load.png", "phase_still", "load", 3], ["zoom_contact.png", "zoom", "contact", 8]]);
  const built = await buildV2EvidencePackage(packageInput(dir, images, syntheticArtifacts({ batStatus: { 10: "interpolated" } })));
  assert.ok(built.ok, built.ok ? "" : built.error);
  if (!built.ok) return;
  const pkg = built.pkg;
  assert.deepEqual(pkg.images.map(i => i.name), ["swing_seq_01.png", "phase_load.png", "phase_contact.png", "zoom_contact.png", "phase_follow_through.png"]);
  assert.deepEqual(pkg.images.map(i => i.order), [0, 1, 2, 3, 4]);
  const contact = pkg.images.find(i => i.name === "phase_contact.png")!;
  assert.deepEqual([contact.eventId, contact.sourceFrame, contact.pts, contact.batObservation], ["impact_estimate", 8, 24000, "direct"]);
  assert.equal(pkg.images.find(i => i.name === "phase_follow_through.png")!.batObservation, "interpolated");
  assert.deepEqual(pkg.supportedEvents, ["load_peak_estimate", "impact_estimate", "finish"]);
  // Launch is not supplied; unavailable events carry their reasons.
  const launch = pkg.events.find(e => e.id === "swing_launch")!;
  assert.deepEqual([launch.supported, launch.reasons], [false, ["NOT_A_COACHING_PHASE"]]);
  assert.equal(pkg.events.find(e => e.id === "contact_confirmed")!.supported, false);
  assert.deepEqual(pkg.statements, V2_STATEMENTS);
  assert.deepEqual(validateV2EvidencePackage(pkg), []);
  assert.equal(JSON.stringify(pkg).includes(dir), false, "no local paths in the package");
  const again = await buildV2EvidencePackage(packageInput(dir, images, syntheticArtifacts({ batStatus: { 10: "interpolated" } })));
  assert.ok(again.ok && again.digest === built.digest, "deterministic digest");
});

test("images not at their event frame, with wrong PTS or a missing file are excluded, never relabelled", async t => {
  const dir = tempDir(t);
  const images = syntheticImages(dir, [["phase_contact.png", "phase_still", "contact", 9], ["phase_load.png", "phase_still", "load", 3],
    ["phase_extension.png", "phase_still", "extension", 5]]);
  images[1]!.assumed.rawPtsS = 0.5;  // PTS that disagrees with the frame map
  images.push({ name: "phase_follow_through.png", kind: "phase_still", phase: "follow_through", analysisFrame: 10, assumed: { rawFrame: 10, rawPtsS: 10 / 30 } });
  const built = await buildV2EvidencePackage(packageInput(dir, images));
  assert.ok(built.ok);
  if (!built.ok) return;
  assert.deepEqual(built.pkg.excludedImages, [{ name: "phase_contact.png", reason: "IMAGE_NOT_AT_EVENT_FRAME" },
    { name: "phase_load.png", reason: "PTS_MISMATCH" }, { name: "phase_extension.png", reason: "NO_SUPPORTED_EVENT_FOR_PHASE" },
    { name: "phase_follow_through.png", reason: "UNREADABLE_IMAGE" }]);
  assert.deepEqual(built.pkg.supportedEvents, [], "an event without its own still is not citable");
});

test("package refuses non-grounded identity and mismatched source", async t => {
  const dir = tempDir(t);
  const images = syntheticImages(dir, [["phase_contact.png", "phase_still", "contact", 8]]);
  for (const decision of [{ status: "ambiguous", basis: "pose_and_bat" }, { status: "selected", basis: "pose_only" }]) {
    const built = await buildV2EvidencePackage(packageInput(dir, images, syntheticArtifacts({ decision })));
    assert.deepEqual(built, { ok: false, error: "BATTER_NOT_BAT_GROUNDED" });
  }
  const a = syntheticArtifacts();
  a.frameMap.input_sha256 = "b".repeat(64);
  assert.deepEqual(await buildV2EvidencePackage(packageInput(dir, images, a)), { ok: false, error: "SOURCE_MISMATCH" });
});

test("addendum lists images chronologically, marks the impact estimate and forbids contact, numbers and hand path", async t => {
  const dir = tempDir(t);
  const images = syntheticImages(dir, [["phase_contact.png", "phase_still", "contact", 8], ["phase_load.png", "phase_still", "load", 3]]);
  const built = await buildV2EvidencePackage(packageInput(dir, images, syntheticArtifacts({ batStatus: { 3: "interpolated" } })));
  assert.ok(built.ok);
  if (!built.ok) return;
  const { version, text } = renderV2Addendum(built.pkg);
  assert.equal(version, "render-v2-1.0.0");
  assert.ok(text.indexOf("phase_load.png") < text.indexOf("phase_contact.png"), "earliest first");
  assert.match(text, /phase_load\.png \| load_peak_estimate \| source frame 3 \| t=0\.100000s \| bat: INTERPOLATED, not observed/);
  assert.match(text, /phase_contact\.png \| impact_estimate \| source frame 8 .*bat: directly observed/);
  assert.match(text, /IMPACT ESTIMATE only\. Never state or imply bat-ball contact/);
  assert.match(text, /No numbers/);
  assert.match(text, /No hand-path, knob or bat-angle measurements/);
  assert.match(text, /"supportingEvents"/);
  assert.match(text, /Supported events you may cite \(id -> phase still\): load_peak_estimate -> phase_load, impact_estimate -> phase_contact\./);
});
