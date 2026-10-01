// "Zoom on player": shows the part of the original video where the batter is,
// using the per-phase batter box the pipeline stores in
// swing_phases.detail.subject_box (src/services/pose3d/subjectBox.ts). Game
// footage is filmed wide, so the hitter is often a small figure in the frame;
// on a phone that makes the swing hard to see.
//
// Display only: object-view-box crops what the <video> element shows - same
// original pixels, native controls untouched, nothing re-encoded. Browsers
// without object-view-box (Safari, Firefox today) simply don't get the
// toggle; clips without a stored box don't either.

const PREF_KEY = "hitterloop.zoomOnPlayer";
const MIN_ASPECT = 0.75; // never narrower than 3:4 portrait
const MAX_ASPECT = 16 / 9;

const valid = (b) => b && [b.x, b.y, b.w, b.h].every((v) => typeof v === "number" && Number.isFinite(v))
  && b.x >= 0 && b.y >= 0 && b.w > 0 && b.h > 0 && b.x + b.w <= 1.0001 && b.y + b.h <= 1.0001;

/** A stored subject_box, or null when absent or malformed. */
export function readSubjectBox(detail) {
  const b = detail?.subject_box;
  return valid(b) ? { x: b.x, y: b.y, w: b.w, h: b.h } : null;
}

/** Union of the given normalized boxes (nulls ignored), or null. */
export function unionBox(boxes) {
  const ok = (boxes ?? []).filter(valid);
  if (!ok.length) return null;
  const x0 = Math.min(...ok.map((b) => b.x)), y0 = Math.min(...ok.map((b) => b.y));
  const x1 = Math.min(1, Math.max(...ok.map((b) => b.x + b.w))), y1 = Math.min(1, Math.max(...ok.map((b) => b.y + b.h)));
  return { x: x0, y: y0, w: x1 - x0, h: y1 - y0 };
}

/**
 * The visible region for a box on a videoW x videoH video, grown (never
 * shrunk) around its centre so its shape stays between 3:4 and 16:9, then
 * kept inside the frame. Returns inset percentages for object-view-box and
 * the region's aspect ratio for the element; null for no box or no size.
 */
export function viewRegion(box, videoW, videoH) {
  if (!valid(box) || !(videoW > 0) || !(videoH > 0)) return null;
  let w = box.w * videoW, h = box.h * videoH;
  const cx = (box.x + box.w / 2) * videoW, cy = (box.y + box.h / 2) * videoH;
  if (w / h < MIN_ASPECT) w = h * MIN_ASPECT;
  if (w / h > MAX_ASPECT) h = w / MAX_ASPECT;
  w = Math.min(w, videoW); h = Math.min(h, videoH);
  const x0 = Math.min(Math.max(0, cx - w / 2), videoW - w), y0 = Math.min(Math.max(0, cy - h / 2), videoH - h);
  const pct = (v) => Math.round(v * 10000) / 100;
  return {
    inset: { top: pct(y0 / videoH), right: pct(1 - (x0 + w) / videoW), bottom: pct(1 - (y0 + h) / videoH), left: pct(x0 / videoW) },
    aspect: Math.round((w / h) * 1000) / 1000,
  };
}

export const insetCss = (inset) => `inset(${inset.top}% ${inset.right}% ${inset.bottom}% ${inset.left}%)`;

export function zoomSupported() {
  try { return typeof CSS !== "undefined" && CSS.supports("object-view-box", "inset(0% 0% 0% 0%)"); } catch { return false; }
}

export function zoomPreferred() {
  try { return localStorage.getItem(PREF_KEY) !== "off"; } catch { return true; }
}

function rememberZoom(on) {
  try { localStorage.setItem(PREF_KEY, on ? "on" : "off"); } catch { /* per-viewer convenience only */ }
}

/** Applies or clears the player zoom on one <video> for a normalized box. */
export function setVideoZoom(video, box, on) {
  if (!video) return;
  const apply = () => {
    const region = on ? viewRegion(box, video.videoWidth, video.videoHeight) : null;
    video.style.objectViewBox = region ? insetCss(region.inset) : "";
    video.style.aspectRatio = region ? String(region.aspect) : "";
    video.classList.toggle("is-player-zoom", !!region);
  };
  video.readyState >= 1 ? apply() : video.addEventListener("loadedmetadata", apply, { once: true });
}

export function zoomToggleHtml(on) {
  return `<button type="button" class="bt-zoom-toggle tap-target" data-zoom-toggle aria-pressed="${on}">${on ? "Show full field" : "Zoom on player"}</button>`;
}

/**
 * Wires a zoom toggle button to a set of [video, box] pairs. Returns the
 * current state; the toggle and the zoom are skipped entirely when the
 * browser can't crop video or no pair has a box.
 */
export function wireZoomToggle(button, pairs) {
  const usable = pairs.filter(([video, box]) => video && box);
  if (!button) return false;
  if (!zoomSupported() || !usable.length) { button.hidden = true; return false; }
  let on = zoomPreferred();
  const render = () => {
    usable.forEach(([video, box]) => setVideoZoom(video, box, on));
    button.setAttribute("aria-pressed", String(on));
    button.textContent = on ? "Show full field" : "Zoom on player";
  };
  button.addEventListener("click", () => { on = !on; rememberZoom(on); render(); });
  render();
  return on;
}
