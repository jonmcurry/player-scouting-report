import test from "node:test";
import assert from "node:assert/strict";
import { visibleFocusClips } from "./focusPersistence.js";
import { advanceFocus, type FocusRecord, type ReadableSwing } from "./focus.js";

test("pending deletion is excluded before focus transitions, without replacing its serial", () => {
  const focus: FocusRecord = { concept: "posture", status: "active", startedAt: "2026-10-01",
    endedAt: null, qualifiedAtSerial: 3, dismissedAtSerial: null, dismissedBy: null };
  const clips: ReadableSwing[] = Array.from({ length: 8 }, (_, i) => ({
    id: `clip-${i + 1}`, serial: i + 1, date: "2026-10-04", sessionType: "game", readable: true,
    findings: i < 4 ? [{ id: `finding-${i}`, concept: "posture", phase: "load", basis: "video",
      confidence: "low", contextExplainsIt: false, emergencySwingSuspected: false, hidden: false }] : [],
  }));
  assert.equal(advanceFocus(clips, focus, [], 8).status, "looks_fixed");
  const retained = visibleFocusClips(clips, ["clip-8"]);
  assert.equal(advanceFocus(retained, focus, [], 8).status, "early_read");
  assert.equal(retained.at(-1)?.serial, 7);
});
