import { supabase, escapeHtml } from "../shared.js";
import { openBottomSheet, showSnackbar } from "./ui.js";
import { nextAtBatNumber } from "./pitchEntry.js";

const today = () => new Date().toISOString().slice(0, 10);

export async function openLogAtBatSheet({ player, teamSlug, trigger = null }) {
  const { data: recent } = await supabase.from("game_log_entries")
    .select("date, opponent, ab").eq("player_id", player.id).eq("session_type", "game")
    .order("date", { ascending: false }).order("ab", { ascending: false }).limit(50);
  const defaultOpponent = (recent ?? []).find((row) => row.opponent)?.opponent ?? "";
  const sheet = openBottomSheet({
    title: "Log at-bat",
    returnFocus: trigger,
    bodyHtml: `<div class="dev-field"><label for="quickOpponent">Opponent</label><input id="quickOpponent" autocomplete="off" value="${escapeHtml(defaultOpponent)}" placeholder="Opponent"></div>
      <button class="bt-button bt-button-tertiary" id="quickChangeDate" type="button">Change date</button>
      <div class="dev-field" id="quickDateWrap" hidden><label for="quickDate">Date</label><input id="quickDate" type="date" value="${today()}"></div>
      <p class="error-text" id="quickAtBatError" role="alert"></p>`,
    footerHtml: '<button class="bt-button bt-button-primary" id="quickStartAtBat" type="button">Start at-bat</button>',
  });
  sheet.querySelector("#quickChangeDate").onclick = () => {
    sheet.querySelector("#quickDateWrap").hidden = false;
    sheet.querySelector("#quickChangeDate").hidden = true;
  };
  sheet.querySelector("#quickStartAtBat").onclick = async () => {
    const opponent = sheet.querySelector("#quickOpponent").value.trim();
    const date = sheet.querySelector("#quickDate").value;
    const errorEl = sheet.querySelector("#quickAtBatError");
    if (!opponent) { errorEl.textContent = "Enter an opponent."; return; }
    if (!date) { errorEl.textContent = "Choose a date."; return; }
    errorEl.textContent = "";
    const number = nextAtBatNumber(recent ?? [], { date, opponent });
    const { data, error } = await supabase.from("game_log_entries").insert({
      player_id: player.id, session_type: "game", date, opponent, ab: number, result: null,
    }).select("id").single();
    if (error) { showSnackbar("Couldn't start the at-bat. Try again."); return; }
    sheet.remove();
    await sheet.whenClosed;
    location.href = `./atbat.html?${new URLSearchParams({ team: teamSlug, player: player.slug, entry: data.id })}`;
  };
  return sheet;
}
