import test from "node:test";
import assert from "node:assert/strict";
import { comparableSetup, syncPoints, phaseAvailability } from "./coachAnalysisModel.js";

const report = { clipId: "a", sport: "softball", environment: "game",
  context: { intent: "slap", environment: "game" }, capture: { profile: "game_backstop", orientation: "portrait", state: "supported" },
  phases: [{ slug: "contact_estimate", frame: 40, time: 1.2, visibility: "partial" }] };
const candidate = { clipId: "b", sport: "softball", environment: "game", intent: "slap",
  contextEnvironment: "game", profile: "game_backstop", orientation: "portrait", captureState: "supported", phases: { contact_estimate: 1.5 } };

test("phase sync accepts only a compatible located pair", () => {
  assert.deepEqual(syncPoints(report, candidate, "contact_estimate"), [1.2, 1.5]);
  assert.equal(syncPoints(report, { ...candidate, phases: {} }, "contact_estimate"), null);
  assert.equal(syncPoints(report, { ...candidate, intent: "bunt" }, "contact_estimate"), null);
});

test("unknown setup and game/practice mismatch cannot enter a numeric comparison", () => {
  assert.equal(comparableSetup({ ...report, context: { intent: "unknown" } }, candidate).compatible, false);
  assert.equal(comparableSetup(report, { ...candidate, environment: "practice" }).compatible, false);
  assert.equal(comparableSetup(report, { ...candidate, contextEnvironment: "tee" }).compatible, false);
  assert.equal(comparableSetup(report, { ...candidate, sport: "baseball" }).compatible, false);
  assert.equal(comparableSetup(report, { ...candidate, orientation: null }).compatible, false);
  assert.equal(comparableSetup(report, { ...candidate, captureState: "needs_recheck" }).compatible, false);
});

test("missing phase remains unavailable and partial visibility stays qualified", () => {
  assert.equal(phaseAvailability(null), "Unavailable in this video");
  assert.equal(phaseAvailability({ frame: null, time: null }), "Unavailable in this video");
  assert.equal(phaseAvailability(report.phases[0]), "Partly visible");
});
