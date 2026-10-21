type NotificationDb = { rpc(name: string, args: Record<string, unknown>): PromiseLike<{ data: unknown; error: { message: string } | null }> };

async function enqueue(db: NotificationDb, args: Record<string, unknown>): Promise<string | null> {
  const { data, error } = await db.rpc("enqueue_notification_event", args);
  if (error) throw new Error(`Enqueuing notification: ${error.message}`);
  return typeof data === "string" ? data : null;
}

export function reportHasShownFix(issues: Array<{ concept: string; basis: string; confidence: string | null;
  contextExplainsIt: boolean; emergencySwingSuspected: boolean }>): boolean {
  return issues.some((issue) => issue.basis === "video" && issue.confidence === "medium"
    && !["swing_decision", "pitch_location_adjustment", "game_approach"].includes(issue.concept)
    && !issue.contextExplainsIt && !issue.emergencySwingSuspected);
}

export const enqueueReportReady = (db: NotificationDb, playerId: string, clipId: string, hasFix: boolean) => enqueue(db, {
  p_event_kind: "report_ready", p_player_id: playerId, p_source_id: clipId, p_report_has_fix: hasFix,
});

export const enqueueAnalysisFailed = (db: NotificationDb, playerId: string, clipId: string) => enqueue(db, {
  p_event_kind: "analysis_failed", p_player_id: playerId, p_source_id: clipId,
});

export const enqueueFocusStatus = (db: NotificationDb, playerId: string, focusId: string,
  status: "improving" | "fixed", concept: string, seen: number, windowSize: number) => enqueue(db, {
  p_event_kind: "focus_status", p_player_id: playerId, p_source_id: focusId,
  p_focus_status: status, p_focus_concept: concept, p_focus_seen: seen, p_focus_window_size: windowSize,
});

export interface PendingNotificationEvent {
  id: string;
  eventKind: "report_ready" | "analysis_failed" | "focus_status";
  playerId: string;
  reportHasFix?: boolean | null;
  focusStatus?: "improving" | "fixed" | null;
  focusConcept?: string | null;
  focusSeen?: number | null;
  focusWindowSize?: number | null;
}

export interface NotificationDelivery {
  recipientId: string;
  playerId: string;
  eventIds: string[];
  idempotencyKey: string;
  body: string;
}

function fnv1a64(value: string, seed: bigint): string {
  let hash = seed;
  for (const character of value) {
    hash ^= BigInt(character.codePointAt(0) ?? 0);
    hash = BigInt.asUintN(64, hash * 0x100000001b3n);
  }
  return hash.toString(16).padStart(16, "0");
}

/** Compact opaque provider key; raw account/player/event ids never leave in
 * an email header, and large bulk batches stay below provider key limits. */
function deliveryKey(parts: string[]): string {
  const value = parts.join(":");
  return `hl-${fnv1a64(value, 0xcbf29ce484222325n)}${fnv1a64(value, 0x84222325cbf29ce4n)}`;
}

/** Pure provider boundary: one child per delivery, with report events batched per recipient/player. */
export function buildNotificationDeliveries(events: PendingNotificationEvent[], recipients: Map<string, string[]>,
  playerNames: Map<string, string>): NotificationDelivery[] {
  const groups = new Map<string, { recipientId: string; playerId: string; kind: PendingNotificationEvent["eventKind"]; events: PendingNotificationEvent[] }>();
  for (const event of events) for (const recipientId of recipients.get(event.id) ?? []) {
    const key = `${recipientId}:${event.playerId}:${event.eventKind}`;
    const group = groups.get(key) ?? { recipientId, playerId: event.playerId, kind: event.eventKind, events: [] };
    group.events.push(event);
    groups.set(key, group);
  }
  return [...groups.values()].map((group) => {
    const name = playerNames.get(group.playerId);
    if (!name) throw new Error(`Missing player name for notification ${group.playerId}`);
    const eventIds = group.events.map((event) => event.id);
    const idempotencyKey = deliveryKey([group.recipientId, group.playerId, group.kind, ...[...eventIds].sort()]);
    if (group.kind === "report_ready") {
      const body = group.events.length > 1
        ? `${group.events.length} at-bat reports are ready for ${name}.`
        : `${name}'s at-bat report is ready${group.events[0]!.reportHasFix ? ": 1 thing to work on." : "."}`;
      return { recipientId: group.recipientId, playerId: group.playerId, eventIds, idempotencyKey, body };
    }
    if (group.kind === "analysis_failed") return { recipientId: group.recipientId, playerId: group.playerId, eventIds, idempotencyKey,
      body: `We couldn't analyze ${name}'s at-bat. Tap for a filming tip.` };
    const focus = group.events.at(-1)!;
    const concept = (focus.focusConcept ?? "the current focus").replaceAll("_", " ");
    const detail = focus.focusStatus === "fixed" ? "hasn't shown up in the last 4 readable game swings"
      : `is showing up less (${focus.focusSeen} of the last ${focus.focusWindowSize})`;
    return { recipientId: group.recipientId, playerId: group.playerId, eventIds, idempotencyKey,
      body: `Good news for ${name}: ${concept} ${detail}.` };
  });
}
