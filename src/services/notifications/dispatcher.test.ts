import test from "node:test";
import assert from "node:assert/strict";
import { dispatchNotificationBatch, type ClaimedNotificationEvent, type NotificationDispatchStore } from "./dispatcher.js";
import type { NotificationDelivery } from "./outbox.js";

function fakeStore(events: ClaimedNotificationEvent[], recipientRows: Map<string, string[]>, alreadySent = new Map<string, Set<string>>()) {
  const recorded: Array<{ eventIds: string[]; recipientId: string }> = [];
  const finished: Array<{ eventId: string; token: string; error?: string }> = [];
  const store: NotificationDispatchStore = {
    claim: async () => events,
    recipients: async (id) => recipientRows.get(id) ?? [],
    playerNames: async () => new Map([["p1", "Maya"], ["p2", "Jordan"]]),
    deliveredRecipients: async () => alreadySent,
    record: async (eventIds, recipientId) => { recorded.push({ eventIds, recipientId }); },
    finish: async (eventId, token, error) => { finished.push({ eventId, token, error }); return true; },
  };
  return { store, recorded, finished };
}

test("dispatcher batches one player's reports and records before finalizing", async () => {
  const events: ClaimedNotificationEvent[] = [
    { id: "e1", eventKind: "report_ready", playerId: "p1", reportHasFix: true, claimToken: "t1" },
    { id: "e2", eventKind: "report_ready", playerId: "p1", reportHasFix: false, claimToken: "t2" },
  ];
  const { store, recorded, finished } = fakeStore(events, new Map([["e1", ["parent"]], ["e2", ["parent"]]]));
  const sent: NotificationDelivery[] = [];
  const result = await dispatchNotificationBatch(store, { send: async (delivery) => { sent.push(delivery); } });
  assert.deepEqual(result, { claimed: 2, delivered: 1, failed: 0 });
  assert.match(sent[0]!.body, /2 at-bat reports/);
  assert.deepEqual(recorded, [{ eventIds: ["e1", "e2"], recipientId: "parent" }]);
  assert.deepEqual(finished, [{ eventId: "e1", token: "t1", error: undefined }, { eventId: "e2", token: "t2", error: undefined }]);
});

test("dispatcher skips receipts and retries only the failed event recipients", async () => {
  const events: ClaimedNotificationEvent[] = [
    { id: "e1", eventKind: "report_ready", playerId: "p1", reportHasFix: true, claimToken: "t1" },
    { id: "e2", eventKind: "report_ready", playerId: "p2", reportHasFix: false, claimToken: "t2" },
  ];
  const { store, recorded, finished } = fakeStore(events,
    new Map([["e1", ["coach", "parent1"]], ["e2", ["coach", "parent2"]]]),
    new Map([["e1", new Set(["parent1"])]]));
  const result = await dispatchNotificationBatch(store, { send: async (delivery) => {
    if (delivery.playerId === "p2") throw new Error("provider unavailable");
  } });
  assert.deepEqual(result, { claimed: 2, delivered: 1, failed: 1 });
  assert.deepEqual(recorded, [{ eventIds: ["e1"], recipientId: "coach" }]);
  assert.deepEqual(finished, [
    { eventId: "e1", token: "t1", error: undefined },
    { eventId: "e2", token: "t2", error: "provider unavailable" },
  ]);
});

test("events with no current recipients finish without sending", async () => {
  const events: ClaimedNotificationEvent[] = [
    { id: "e1", eventKind: "analysis_failed", playerId: "p1", claimToken: "t1" },
  ];
  const { store, finished } = fakeStore(events, new Map([["e1", []]]));
  const result = await dispatchNotificationBatch(store, { send: async () => { throw new Error("must not send"); } });
  assert.deepEqual(result, { claimed: 1, delivered: 0, failed: 0 });
  assert.deepEqual(finished, [{ eventId: "e1", token: "t1", error: undefined }]);
});

test("a recipient race releases the lease for retry instead of waiting for stale recovery", async () => {
  const events: ClaimedNotificationEvent[] = [
    { id: "e1", eventKind: "report_ready", playerId: "p1", reportHasFix: false, claimToken: "t1" },
  ];
  const attempts: Array<{ error?: string }> = [];
  const store = fakeStore(events, new Map([["e1", ["parent"]]])).store;
  store.finish = async (_eventId, _token, error) => {
    attempts.push({ error });
    if (!error) throw new Error("new current recipient needs delivery");
    return true;
  };
  const result = await dispatchNotificationBatch(store, { send: async () => undefined });
  assert.deepEqual(result, { claimed: 1, delivered: 1, failed: 1 });
  assert.deepEqual(attempts, [{ error: undefined }, { error: "new current recipient needs delivery" }]);
});
