// 9-zone strike-zone quick picker + outcome buttons (ux.md Step 3B / 5.2),
// used by player.html's Log AB modal. Zones read 1-9 left-to-right, top-to-
// bottom (1-3 high, 4-6 middle, 7-9 low; each row In/Mid/Out) - how a coach
// standing behind the plate visualizes the zone. Written to
// game_log_entries.pitch_zone/pitch_outcome (migration 00009) as real
// structured fields, alongside (not replacing) the existing freeform
// pitch/result text.
const ROWS = ["High", "Middle", "Low"];
const COLS = ["In", "Mid", "Out"];

export function zoneLabel(zone) {
  if (!zone) return null;
  const row = Math.floor((zone - 1) / 3);
  const col = (zone - 1) % 3;
  return `${ROWS[row]}, ${COLS[col]}`;
}

export function outcomeLabel(outcome) {
  return { take: "Take", foul: "Foul", ball_in_play: "Ball in Play" }[outcome] ?? null;
}

/**
 * @param {HTMLElement} container
 * @param {{ zone: number|null, outcome: string|null, onChange: (state: {zone: number|null, outcome: string|null}) => void }} opts
 */
export function renderZonePicker(container, { zone = null, outcome = null, onChange }) {
  const state = { zone, outcome };

  container.innerHTML = `
    <div class="zone-picker">
      ${Array.from({ length: 9 }, (_, i) => i + 1)
        .map((z) => `<button type="button" data-zone="${z}" data-active="${z === state.zone}">${z}</button>`)
        .join("")}
    </div>
    <div class="zone-row-labels"><span>In</span><span>Mid</span><span>Out</span></div>
    <div class="outcome-row">
      <button type="button" data-outcome="take" data-active="${state.outcome === "take"}">Take</button>
      <button type="button" data-outcome="foul" data-active="${state.outcome === "foul"}">Foul</button>
      <button type="button" data-outcome="ball_in_play" data-active="${state.outcome === "ball_in_play"}">Ball in Play</button>
    </div>
  `;

  container.querySelectorAll("[data-zone]").forEach((btn) => {
    btn.addEventListener("click", () => {
      state.zone = Number(btn.dataset.zone);
      container.querySelectorAll("[data-zone]").forEach((b) => (b.dataset.active = String(b === btn)));
      onChange({ ...state });
    });
  });

  container.querySelectorAll("[data-outcome]").forEach((btn) => {
    btn.addEventListener("click", () => {
      state.outcome = btn.dataset.outcome;
      container.querySelectorAll("[data-outcome]").forEach((b) => (b.dataset.active = String(b === btn)));
      onChange({ ...state });
    });
  });
}
