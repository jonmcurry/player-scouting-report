import { buildNotificationDeliveries, type NotificationDelivery, type PendingNotificationEvent } from "./outbox.js";

export interface ClaimedNotificationEvent extends PendingNotificationEvent {
  claimToken: string;
}

export interface NotificationDispatchStore {
  claim(limit: number): Promise<ClaimedNotificationEvent[]>;
  recipients(eventId: string): Promise<string[]>;
  playerNames(playerIds: string[]): Promise<Map<string, string>>;
  deliveredRecipients(eventIds: string[]): Promise<Map<string, Set<string>>>;
  record(eventIds: string[], recipientId: string): Promise<void>;
  finish(eventId: string, claimToken: string, error?: string): Promise<boolean>;
}

export interface NotificationProvider {
  send(delivery: NotificationDelivery): Promise<void>;
}

/**
 * Claims and dispatches one bounded batch. Successful recipient sends are
 * recorded before an event is finalized, so a later provider failure skips
 * recipients whose successful send was durably receipted. The provider should
 * also honor idempotencyKey for the send/receipt failure boundary.
 */
export async function dispatchNotificationBatch(store: NotificationDispatchStore, provider: NotificationProvider,
  limit = 50): Promise<{ claimed: number; delivered: number; failed: number }> {
  const claimed = await store.claim(limit);
  if (!claimed.length) return { claimed: 0, delivered: 0, failed: 0 };

  const recipients = new Map<string, string[]>();
  for (const event of claimed) recipients.set(event.id, await store.recipients(event.id));
  const receipts = await store.deliveredRecipients(claimed.map((event) => event.id));
  for (const event of claimed) {
    const sent = receipts.get(event.id) ?? new Set<string>();
    recipients.set(event.id, (recipients.get(event.id) ?? []).filter((userId) => !sent.has(userId)));
  }
  const names = await store.playerNames([...new Set(claimed.map((event) => event.playerId))]);
  const deliveries = buildNotificationDeliveries(claimed, recipients, names);
  const failedEvents = new Map<string, string>();
  let delivered = 0;
  for (const delivery of deliveries) {
    try {
      await provider.send(delivery);
      await store.record(delivery.eventIds, delivery.recipientId);
      delivered += 1;
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      for (const eventId of delivery.eventIds) failedEvents.set(eventId, message);
    }
  }
  for (const event of claimed) {
    const deliveryError = failedEvents.get(event.id);
    if (deliveryError) {
      await store.finish(event.id, event.claimToken, deliveryError);
      continue;
    }
    try {
      const finished = await store.finish(event.id, event.claimToken);
      if (!finished) failedEvents.set(event.id, "notification lease was no longer current");
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      failedEvents.set(event.id, message);
      // A recipient can become eligible between resolution and completion.
      // Release the still-current lease promptly instead of waiting 15 minutes.
      try { await store.finish(event.id, event.claimToken, message); } catch { /* stale/unknown lease recovers by timeout */ }
    }
  }
  return { claimed: claimed.length, delivered, failed: failedEvents.size };
}
