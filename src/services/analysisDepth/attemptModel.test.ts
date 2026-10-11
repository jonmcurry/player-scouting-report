import { test } from "node:test";
import assert from "node:assert/strict";
import { classifyAttemptContext, legacyAttemptParity, legacyPhaseEvents,
  methodologyAvailability, attemptSourceRevision, type AttemptContext } from "./attemptModel.js";

test("only a readable stored detection yields a canonical context candidate", () => {
  assert.equal(classifyAttemptContext({ sport: "softball", sessionType: "game", detectionState: "confirmed_no_swing" }), null);
  assert.equal(classifyAttemptContext({ sport: "baseball", sessionType: "practice", detectionState: "inconclusive" }), null);
  assert.deepEqual(classifyAttemptContext({ sport: "softball", sessionType: "game", detectionState: "readable" }),
    { sport: "softball", environment: "game", intent: "unknown" });
  assert.deepEqual(classifyAttemptContext({ sport: "baseball", sessionType: "practice", detectionState: "readable" }),
    { sport: "baseball", environment: "unknown", intent: "unknown" });
});

test("legacy phase snapshot preserves missing events and unknown uncertainty", () => {
  const events = legacyPhaseEvents({
    contact: { frame: 40, time_s: 1.2, method: "detector", confidence: "low" },
    load: { frame: null, time_s: null },
  }, "pipeline-v1", { contact: { body: "partial" } });
  assert.deepEqual(events.map((event) => [event.event_slug, event.frame, event.time_s, event.visibility]), [
    ["legacy_load", null, null, "unavailable"], ["contact_estimate", 40, 1.2, "partial"],
  ]);
  assert.equal(attemptSourceRevision("pipeline-v1", events), attemptSourceRevision("pipeline-v1", events));
  assert.notEqual(attemptSourceRevision("pipeline-v1", events), attemptSourceRevision("pipeline-v2", events));
});

test("canonical legacy attempt is counted once and phase parity fails closed", () => {
  const clip = { id: "clip-1", status: "ready", swing_detection_state: "readable" };
  const events = legacyPhaseEvents({ contact: { frame: 42, time_s: 1.4 } }, "v1");
  const attempt = { id: "attempt-1", video_clip_id: "clip-1", attempt_index: 0 };
  assert.deepEqual(legacyAttemptParity(clip, [attempt], events, events).reasons, []);
  assert.equal(legacyAttemptParity(clip, [attempt], events, events).swingCount, 1);
  assert.deepEqual(legacyAttemptParity(clip, [attempt, attempt], events, events).reasons,
    ["canonical_attempt_mismatch"]);
  assert.deepEqual(legacyAttemptParity(clip, [attempt], events, []).reasons, ["phase_event_mismatch"]);
  assert.deepEqual(legacyAttemptParity(clip, [attempt],
    legacyPhaseEvents({ contact: { frame: 0, time_s: 0 } }, "v1"),
    [{ event_slug: "contact_estimate", frame: 0, time_s: null }]).reasons,
  ["phase_event_mismatch"]);
  assert.equal(legacyAttemptParity({ ...clip, swing_detection_state: "inconclusive" }, [], [], []).swingCount, 0);
});

test("sport and intent routing excludes unsupported softball styles and unknown context", () => {
  const conventional = { status: "validated_internal", sports: ["softball"], intents: ["conventional_full"], environments: ["game"] };
  const base: AttemptContext = { sport: "softball", environment: "game", intent: "conventional_full" };
  assert.equal(methodologyAvailability(conventional, base).available, true);
  for (const intent of ["slap", "power_slap", "bunt", "drag_bunt", "take", "checked_protective", "unknown"] as const) {
    assert.ok(methodologyAvailability(conventional, { ...base, intent }).reasons.includes("intent_unavailable"), intent);
  }
  assert.ok(methodologyAvailability(conventional, { ...base, sport: "baseball" }).reasons.includes("sport_unavailable"));
  assert.ok(methodologyAvailability(conventional, { ...base, environment: "unknown" }).reasons.includes("environment_unavailable"));
  assert.ok(methodologyAvailability({ ...conventional, status: "experimental" }, base).reasons.includes("definition_unvalidated"));
  const unknownOnly = { ...conventional, intents: ["unknown"] };
  assert.ok(methodologyAvailability(unknownOnly, { ...base, intent: "unknown" }).reasons.includes("intent_unavailable"));
  assert.ok(methodologyAvailability({ ...conventional, intents: ["unknown", "conventional_full"] },
    { ...base, intent: "unknown" }).reasons.includes("intent_unavailable"));
  const acrossIntents = { ...conventional, intents: ["unknown", "conventional_full", "slap",
    "power_slap", "bunt", "drag_bunt", "checked_protective", "take"] };
  assert.equal(methodologyAvailability(acrossIntents, { ...base, intent: "unknown" }).available, true);
});
