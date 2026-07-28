// 1-tap 3-segment score stepper. Tapping a segment writes score+ai_draft
// (ai_draft only if this is the FIRST score ever set, so a real AI draft
// value already on the row isn't overwritten by the act of confirming it)
// and reviewed_by = the signed-in coach's display name, directly to
// Supabase - this is a real, persisted write, not local-only state.
import { supabase } from "../shared.js";

/**
 * @param {HTMLElement} container - element to render the stepper into
 * @param {object} row - a checklist_scores row: {id, score, ai_draft, reviewed_by}
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
        .update({
          score: newScore,
          reviewed_by: coachDisplayName,
        })
        .eq("id", row.id)
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
