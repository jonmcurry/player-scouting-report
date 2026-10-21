// Game/backstop and open-side practice guidance. Camera framing helps but is
// never described as calibrated or as a guarantee that analysis will work.
import { disclosure, icon } from "./ui.js";

const BASE = ["Get the whole body and bat in frame through contact.",
  "Hold the phone still and sideways.",
  "Start recording before the swing and stop after the follow-through."];
const MODE = {
  game_backstop: { label: "Game / backstop", angle: "Film from a safe spot behind the backstop. Keep the plate area visible; a fence is fine if the lens is close to it.",
    note: "The catcher, umpire, or fence may hide the feet or bat. If they do, try a clearer view next time." },
  open_side_practice: { label: "Open-side practice", angle: "Set a fixed phone roughly side-on to the plate, far enough back to fit the whole hitter and bat arc.",
    note: "Keep people clear of the swing and ball path. This view is different from a game/backstop view." },
};

/** The capture checklist, one short sentence per item. */
export function captureChecklist(profile = "game_backstop") {
  const mode = MODE[profile] ?? MODE.game_backstop;
  return [BASE[0], mode.angle, ...BASE.slice(1)];
}

function esc(value) {
  return String(value ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

function illustration(profile) {
  return profile === "game_backstop"
    ? `<svg viewBox="0 0 112 72" role="img" aria-label="Phone behind backstop, plate and whole hitter in frame"><rect x="4" y="3" width="104" height="66" rx="7"/><path d="M4 48h104M17 48l39-30 39 30M48 53l8 8 8-8-8-8z"/><circle cx="62" cy="22" r="4"/><path d="M62 26v14m0-9-12 7m12-7 12 7m-12 2-9 11m9-11 9 11"/></svg>`
    : `<svg viewBox="0 0 112 72" role="img" aria-label="Fixed phone side-on to plate with full hitter and bat arc"><rect x="4" y="3" width="104" height="66" rx="7"/><path d="M9 59h94M19 54l9 5-9 5-9-5z"/><circle cx="56" cy="16" r="5"/><path d="M56 21v25m0-14-12 7m12-7 18-9M56 46l-10 13m10-13 11 13M74 23l16-10"/></svg>`;
}

export function captureModeHtml(profile = "game_backstop", sport = null) {
  const mode = MODE[profile] ?? MODE.game_backstop;
  const heading = sport === "baseball" || sport === "softball"
    ? `${sport[0].toUpperCase()}${sport.slice(1)} · ${mode.label}` : mode.label;
  const items = captureChecklist(profile).map((item) => `<li>${esc(item)}</li>`).join("");
  return `<div class="hl-capture-mode">${illustration(profile)}<div><strong>${esc(heading)}</strong><ol class="hl-capture-list">${items}</ol><p>${esc(mode.note)}</p></div></div>`;
}

/** Family disclosure is optional; ordinary upload needs no profile selection. */
export function captureGuideHtml({ open = false, sport = null } = {}) {
  return disclosure("How to film a swing", `${captureModeHtml("game_backstop", sport)}
    ${captureModeHtml("open_side_practice", sport)}
    <p>Use a steady phone, even light, and the highest regular frame rate your camera offers. You can always choose an existing video. Camera alignment is a guide, not a calibration.</p>
    <p><strong>Catcher view:</strong> Only film from a protected position. Never place a person or unsecured phone behind the plate in a live, unprotected path.</p>`, { open });
}

export function captureSummaryHtml(summary, { canCorrect = false } = {}) {
  const correction = canCorrect ? `<button class="simple-action link" data-action="correct-capture-view" type="button">Correct camera view</button>` : "";
  const disclosureStart = (line) => `<details class="simple-card simple-disclosure"><summary><span>About this video<small class="simple-disclosure-summary">${esc(line)}</small></span>${icon("chevron-down", { className: "simple-disclosure-chevron" })}</summary>`;
  if (!summary || summary.state === "pending") return `${disclosureStart("Check still pending")}<p>Capture check is still pending.</p>${correction}</details>`;
  if (summary.state === "needs_recheck") return `${disclosureStart("Camera view corrected · new check needed")}<p>The camera view was corrected. A new check is needed before using it for comparisons.</p>${correction}</details>`;
  const state = summary.state === "checked" ? "Video and swing visibility checked." : "Video facts checked; swing visibility is still unavailable.";
  const guidance = { whole_hitter: "Keep the whole hitter, head to feet, in frame.",
    bat_arc: "Leave room for the full bat arc.", brighter_light: "Move to brighter, even light.",
    avoid_backlight: "Avoid filming into strong light.", stable_focus: "Set the phone on a stable mount and check focus." };
  const recommendations = Array.isArray(summary.recommendations)
    ? summary.recommendations.filter((code) => Object.hasOwn(guidance, code)).slice(0, 2).map((code) => guidance[code]) : [];
  const visibility = { visible: "visible", partial: "partly visible", unavailable: "not clear" };
  const body = visibility[summary.bodyVisibility] ?? visibility.unavailable;
  const bat = visibility[summary.batVisibility] ?? visibility.unavailable;
  const profile = MODE[summary.profile]?.label ?? summary.profile ?? "Unknown";
  const line = `Camera view: ${profile} · Hitter ${body} · Bat ${bat}`;
  return `${disclosureStart(line)}<p>${esc(state)} Camera view: ${esc(profile)}.</p>
    ${summary.state === "checked" ? `<p>At the estimated hitting moment: hitter ${body}; bat ${bat}.</p>` : ""}
    ${recommendations.length ? `<ul>${recommendations.map((item) => `<li>${esc(item)}</li>`).join("")}</ul>`
      : `<p>No specific filming change identified from this check.</p>`}${correction}</details>`;
}
