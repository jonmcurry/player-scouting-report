// Checklist review state (00040_checklist_review_status.sql). Pure helpers so
// the Player checklist, its actions and tests share one definition.
//
//   ai_draft               unreviewed automated draft - "AI Draft - Unconfirmed"
//   verified               coach-confirmed score
//   insufficient_evidence  coach-reviewed: not judgeable from the evidence (no score)
//   rejected               coach-reviewed: the AI draft is wrong (no score)
//
// Verify / edit+verify are the existing score stepper (tapping the AI's score or
// another one); the database derives "verified" from that write.

export const REVIEW_STATES = ["ai_draft", "verified", "insufficient_evidence", "rejected"];

/** The row's review state; derives it for rows read before 00040 / placeholders. */
export function checklistState(row) {
  if (!row) return null;
  if (REVIEW_STATES.includes(row.review_status)) return row.review_status;
  if (row.reviewed_by) return row.score != null ? "verified" : null;
  return row.score != null ? "ai_draft" : null;
}

/** True only for an automated draft still waiting on a coach decision. */
export function isPendingDraft(row) {
  return checklistState(row) === "ai_draft" && row.score != null;
}

/** Short coach-facing label; never exposes model/provenance detail. */
export function stateLabel(state) {
  return {
    verified: "Verified",
    ai_draft: "AI Draft — Unconfirmed",
    insufficient_evidence: "Insufficient evidence",
    rejected: "Rejected",
  }[state] ?? "";
}

/** Whether the row's note is current coaching text. A rejected or
 * insufficient checkpoint keeps its AI note in the database (provenance) but
 * it is not shown as if it were a conclusion. */
export function showsNote(row) {
  const s = checklistState(row);
  return s === "ai_draft" || s === "verified";
}

/** Upsert payload for "Mark insufficient evidence" / "Reject AI draft". Keeps
 * the AI draft value, note, source and run link untouched (provenance); clears
 * only the current score. */
export function reviewPayload(row, action, coachName) {
  const status = { insufficient: "insufficient_evidence", reject: "rejected" }[action];
  if (!status) throw new Error(`unknown checklist review action: ${action}`);
  if (!coachName) throw new Error("a reviewer name is required");
  return {
    player_id: row.playerId,
    checkpoint_id: row.checkpointId,
    score: null,
    ai_draft: row.ai_draft ?? null,
    notes: row.notes ?? "",
    source: row.source ?? null,
    reviewed_by: coachName,
    review_status: status,
  };
}

/** Score history entries that reflect coach-confirmed scores only - used by
 * trend displays, which must never present an AI draft (or an insufficient /
 * rejected transition) as a player's progress. Rows written before 00040
 * without review_status count as verified only when a coach made the change. */
export function verifiedHistory(entries) {
  return (entries ?? []).filter((h) => h.score != null && (h.review_status ? h.review_status === "verified" : Boolean(h.changed_by)));
}
