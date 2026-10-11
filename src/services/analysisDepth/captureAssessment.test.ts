import { test } from "node:test";
import assert from "node:assert/strict";
import { assessCapture, captureAvailability, type CaptureMediaFacts } from "./captureAssessment.js";
import { parseCaptureProbe, analyzeVisualSamples } from "./captureMedia.js";

const media: CaptureMediaFacts = { width: 1920, height: 1080, rotationDegrees: 0,
  orientation: "landscape", reportedFps: 60, actualFps: 59.94, durationS: 12 };

test("ffprobe parsing records decoded rate and display rotation without device tags", () => {
  const parsed = parseCaptureProbe({ format: { duration: "10", tags: { location: "private GPS" } }, streams: [{
    codec_type: "video", width: 1080, height: 1920, avg_frame_rate: "30000/1001",
    nb_read_frames: "300", side_data_list: [{ rotation: -90 }], tags: { make: "private phone" },
  }] });
  assert.deepEqual(parsed, { width: 1920, height: 1080, rotationDegrees: 270,
    orientation: "landscape", reportedFps: 29.97, actualFps: 30, durationS: 10 });
  assert.equal(JSON.stringify(parsed).includes("private"), false);
  assert.equal(parseCaptureProbe({ streams: [] }).actualFps, null);
  const variable = parseCaptureProbe({ format: { duration: "10" }, streams: [{
    codec_type: "video", width: 1280, height: 720, r_frame_rate: "60/1",
    avg_frame_rate: "30/1", nb_read_frames: "280",
  }] });
  assert.equal(variable.reportedFps, 60);
  assert.equal(variable.actualFps, 28);
});

test("sampled visual proxies flag only extreme dark footage and keep unmeasured checks unavailable", () => {
  const black = new Uint8Array(96 * 54 * 4).fill(10);
  const result = analyzeVisualSamples(black);
  assert.equal(result.exposure, "possible_dark");
  assert.equal(result.cameraMotion, "unavailable");
  assert.equal(analyzeVisualSamples(new Uint8Array(96 * 54)).exposure, "unavailable");
});

test("phase visibility requires actual event frames and real body/bat detections", () => {
  const keypoints = Array.from({ length: 17 }, () => [10, 10, 0.8]);
  const assessed = assessCapture({ media, declaredProfile: "game_backstop",
    pose2d: { meta: { bat_evidence: { used_fallback: true } }, frames: [{ frame: 42, keypoints }] },
    batFrames: [{ frame: 42, tip: [10, 10], knob: [11, 10], conf: 0.9 }],
    phases: { contact: { frame: 42 }, load: { frame: null } } });
  assert.equal(assessed.stage, "full");
  assert.equal(assessed.phaseVisibility.contact.body, "visible");
  assert.equal(assessed.phaseVisibility.contact.bat, "visible");
  assert.equal(assessed.phaseVisibility.load.body, "unavailable");
  assert.equal(assessed.athleteAmbiguity, "possible_issue");
  assert.equal(assessed.obstructions.catcher, "unavailable");
  assert.equal(assessed.inferredProfile, "unknown_imported");
  assert.equal(assessed.setupFingerprint, null);
});

test("missing bat and body produce at most two actionable capture tips", () => {
  const assessment = assessCapture({ media, pose2d: { frames: [] }, batFrames: [],
    phases: { contact: { frame: 5 } }, visual: { exposure: "possible_dark", blur: "possible_issue", cameraMotion: "possible_issue" } });
  assert.deepEqual(assessment.recommendations, [
    "whole_hitter", "bat_arc",
  ]);
  assert.equal(assessment.phaseVisibility.contact.body, "unavailable");
  assert.equal(assessment.phaseVisibility.contact.bat, "unavailable");
});

test("per-definition gate refuses unvalidated, uncertain setup and missing evidence", () => {
  const assessment = assessCapture({ media, pose2d: { frames: [] }, phases: {} });
  const generic = { status: "validated_internal" as const, captureProfiles: [],
    requiredLandmarks: [], requiredPhases: [], minimumQuality: { min_actual_fps: 30 } };
  assert.deepEqual(captureAvailability(generic, assessment), { available: true, reasons: [] });
  assert.deepEqual(captureAvailability({ ...generic, captureProfiles: ["game_backstop"] }, assessment).reasons,
    ["capture_profile_unconfirmed"]);
  assert.ok(captureAvailability({ ...generic, requiredPhases: ["contact"], requiredLandmarks: ["feet"] }, assessment)
    .reasons.includes("phase_unavailable:contact"));
  assert.ok(captureAvailability({ ...generic, status: "experimental" }, assessment).reasons.includes("definition_unvalidated"));
  assert.ok(captureAvailability({ ...generic, minimumQuality: { unknown_gate: 1 } }, assessment)
    .reasons.includes("quality_unavailable:unknown_gate"));
  assert.equal(captureAvailability(generic, null).available, false);
});
