import type { ClaimedNotificationEvent, NotificationDispatchStore } from "./dispatcher.js";

type DbError = { message: string } | null;
type RpcDb = {
  rpc(name: string, args: Record<string, unknown>): PromiseLike<{ data: unknown; error: DbError }>;
  from(name: string): any;
};

const firstName = (name: string): string => name.trim().split(/\s+/u)[0] ?? "Player";

/** Service-role adapter for a future hosted push/email worker. */
export function createSupabaseNotificationDispatchStore(db: RpcDb): NotificationDispatchStore {
  return {
    async claim(limit) {
      const { data, error } = await db.rpc("claim_notification_events", { p_limit: limit });
      if (error) throw new Error(`Claiming notifications: ${error.message}`);
      return ((data ?? []) as Array<Record<string, unknown>>).map((row): ClaimedNotificationEvent => ({
        id: String(row.id),
        eventKind: row.event_kind as ClaimedNotificationEvent["eventKind"],
        playerId: String(row.player_id),
        reportHasFix: row.report_has_fix as boolean | null,
        focusStatus: row.focus_status as ClaimedNotificationEvent["focusStatus"],
        focusConcept: row.focus_concept as string | null,
        focusSeen: row.focus_seen as number | null,
        focusWindowSize: row.focus_window_size as number | null,
        claimToken: String(row.claim_token),
      }));
    },
    async recipients(eventId) {
      const { data, error } = await db.rpc("notification_event_recipients", { p_event_id: eventId });
      if (error) throw new Error(`Resolving notification recipients: ${error.message}`);
      return ((data ?? []) as Array<{ user_id: string }>).map((row) => row.user_id);
    },
    async playerNames(playerIds) {
      if (!playerIds.length) return new Map();
      const { data, error } = await db.from("players").select("id, name").in("id", playerIds);
      if (error) throw new Error(`Loading notification player names: ${error.message}`);
      return new Map(((data ?? []) as Array<{ id: string; name: string }>).map((row) => [row.id, firstName(row.name)]));
    },
    async deliveredRecipients(eventIds) {
      if (!eventIds.length) return new Map();
      const { data, error } = await db.from("notification_delivery_receipts")
        .select("event_id, user_id").in("event_id", eventIds);
      if (error) throw new Error(`Loading notification receipts: ${error.message}`);
      const result = new Map<string, Set<string>>();
      for (const row of (data ?? []) as Array<{ event_id: string; user_id: string }>) {
        const users = result.get(row.event_id) ?? new Set<string>();
        users.add(row.user_id);
        result.set(row.event_id, users);
      }
      return result;
    },
    async record(eventIds, recipientId) {
      const { error } = await db.rpc("record_notification_delivery", {
        p_event_ids: eventIds, p_user_id: recipientId,
      });
      if (error) throw new Error(`Recording notification delivery: ${error.message}`);
    },
    async finish(eventId, claimToken, errorMessage) {
      const { data, error } = await db.rpc("finish_notification_event", {
        p_event_id: eventId, p_claim_token: claimToken, p_error: errorMessage ?? null,
      });
      if (error) throw new Error(`Finishing notification event: ${error.message}`);
      return data === true;
    },
  };
}
