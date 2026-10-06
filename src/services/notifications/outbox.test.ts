import test from "node:test";
import assert from "node:assert/strict";
import { buildNotificationDeliveries, reportHasShownFix, type PendingNotificationEvent } from "./outbox.js";

test("report notification fix copy follows the same mechanical display threshold", () => {
  const base = { concept: "posture", basis: "video", confidence: "medium", contextExplainsIt: false, emergencySwingSuspected: false };
  assert.equal(reportHasShownFix([base]), true);
  assert.equal(reportHasShownFix([{ ...base, confidence: "low" }]), false);
  assert.equal(reportHasShownFix([{ ...base, concept: "swing_decision" }]), false);
  assert.equal(reportHasShownFix([{ ...base, contextExplainsIt: true }]), false);
});

test("delivery batching is recipient- and player-scoped, never a mixed-child message", () => {
  const events: PendingNotificationEvent[] = [
    { id: "a1", eventKind: "report_ready", playerId: "a", reportHasFix: true },
    { id: "a2", eventKind: "report_ready", playerId: "a", reportHasFix: false },
    { id: "b1", eventKind: "report_ready", playerId: "b", reportHasFix: false },
  ];
  const recipients = new Map([["a1", ["coach", "parent-a"]], ["a2", ["coach", "parent-a"]], ["b1", ["coach", "parent-b"]]]);
  const deliveries = buildNotificationDeliveries(events, recipients, new Map([["a", "Maya"], ["b", "Jordan"]]));
  assert.equal(deliveries.length, 4);
  for (const delivery of deliveries) {
    assert.ok(delivery.eventIds.every((id) => id.startsWith(delivery.playerId)), "one player per delivery");
    if (delivery.playerId === "a") assert.doesNotMatch(delivery.body, /Jordan/);
    if (delivery.playerId === "b") assert.doesNotMatch(delivery.body, /Maya/);
  }
  assert.match(deliveries.find((row) => row.recipientId === "parent-a")!.body, /2 at-bat reports/);
});

test("failure and focus copy stay within their single player event", () => {
  const events: PendingNotificationEvent[] = [
    { id: "failure", eventKind: "analysis_failed", playerId: "a" },
    { id: "focus", eventKind: "focus_status", playerId: "a", focusStatus: "improving",
      focusConcept: "front_side_stability", focusSeen: 2, focusWindowSize: 5 },
  ];
  const recipients = new Map([["failure", ["uploader"]], ["focus", ["uploader", "coach"]]]);
  const deliveries = buildNotificationDeliveries(events, recipients, new Map([["a", "Maya"]]));
  assert.match(deliveries.find((row) => row.eventIds.includes("failure"))!.body, /couldn't analyze Maya/);
  assert.match(deliveries.find((row) => row.eventIds.includes("focus"))!.body, /2 of the last 5/);
});
