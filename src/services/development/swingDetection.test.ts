import test from "node:test";
import assert from "node:assert/strict";
import { swingDetectionState } from "./swingDetection.js";

test("located phase evidence makes a swing readable", () => {
  assert.equal(swingDetectionState({ phases: { contact: { frame: 42, time_s: 1.4 } } }), "readable");
});

test("only an explicit high-confidence detector result confirms no swing", () => {
  assert.equal(swingDetectionState({ swing_detection: { status: "no_swing", confidence: "high" } }), "confirmed_no_swing");
  assert.equal(swingDetectionState({ swing_detection: { status: "no_swing", confidence: "low" } }), "inconclusive");
  assert.equal(swingDetectionState({ swing_detection: { status: "unknown", confidence: "high" } }), "inconclusive");
  assert.equal(swingDetectionState({}), "inconclusive");
});

test("a result label is not part of swing detection", () => {
  const metrics = { result: "walk", phases: {}, swing_detection: null };
  assert.equal(swingDetectionState(metrics), "inconclusive");
});
