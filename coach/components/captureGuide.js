// How to film a swing - the family page's capture guide (coach/family.html).
// Plain, short copy for parents and kids. These are the conditions the swing
// analysis needs to see the swing at all: the whole body and the bat, from the
// side, with a steady phone.
import { disclosure } from "./ui.js";

const CHECKLIST = Object.freeze([
  "Get the whole body and bat in frame through contact.",
  "Film from the side, about 10–15 ft away.",
  "Hold the phone still and sideways.",
  "Start recording before the swing and stop after the follow-through.",
]);

/** The capture checklist, one short sentence per item. */
export function captureChecklist() {
  return [...CHECKLIST];
}

function esc(value) {
  return String(value ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

/** The guide as a disclosure: open the first time, collapsed (but still there) after that. */
export function captureGuideHtml({ open = false } = {}) {
  const items = CHECKLIST.map((item) => `<li>${esc(item)}</li>`).join("");
  return disclosure("How to film a swing", `<ol class="hl-capture-list">${items}</ol>`, { open });
}
