// 1-tap 3-segment score stepper. Tapping a segment writes score+reviewed_by
// directly to Supabase - this is a real, persisted write, not local-only
// state. Upserts on (player_id, checkpoint_id) rather than updating by row
// id, since a checkpoint with no AI/pose3d draft yet has no existing row -
// a coach can score it directly, no video required (checklist_scores.source
// allows NULL for exactly this case; see 00001_initial_schema.sql's column
// comment). ai_draft/notes/source are explicitly passed through from the
// existing row on every write, not just score/reviewed_by - Supabase's
// upsert only touches columns present in the payload, so omitting them
// would silently null out a real AI draft the moment a coach confirms it.
import { supabase } from "../shared.js";

/**
 * @param {HTMLElement} container - element to render the stepper into
 * @param {object} row - a checklist_scores row (or a not-yet-scored
 *   placeholder): {id, score, ai_draft, notes, source, reviewed_by,
 *   playerId, checkpointId}
 * @param {string} coachDisplayName
 * @param {(newRow: object) => void} onChange - called with the updated row after a successful write
 */
export function renderStepper(container, row, coachDisplayName, onChange) {
  container.innerHTML = `
    <div class="stepper">
      ${[1, 2, 3]
        .map(
          (s) => `
        <button type="button" class="tap-target" data-score="${s}" data-active="${row.score === s}">
          ${s}: ${s === 1 ? "Needs Work" : s === 2 ? "Developing" : "On Target"}
        </button>
      `,
        )
        .join("")}
    </div>
  `;

  container.querySelectorAll("button[data-score]").forEach((btn) => {
    btn.addEventListener("click", async () => {
      const newScore = Number(btn.dataset.score);
      btn.disabled = true;
      const { data, error } = await supabase
        .from("checklist_scores")
        .upsert(
          {
            player_id: row.playerId,
            checkpoint_id: row.checkpointId,
            score: newScore,
            ai_draft: row.ai_draft ?? null,
            notes: row.notes ?? "",
            source: row.source ?? null,
            reviewed_by: coachDisplayName,
          },
          { onConflict: "player_id,checkpoint_id" },
        )
        .select()
        .single();
      btn.disabled = false;
      if (error) {
        alert(`Couldn't save score: ${error.message}`);
        return;
      }
      onChange(data);
    });
  });
}
