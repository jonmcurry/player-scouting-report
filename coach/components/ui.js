// BarrelTrace shared Phase-1A UI primitives. This module is framework-free so
// every static coach page can use the same components without a build step.

const ICONS = new Set([
  "users", "user-round", "plus", "circle-check", "layout-list", "trending-up",
  "trending-down", "columns-2", "repeat", "target", "video", "camera", "clock", "link",
  "sparkles", "check", "pencil", "x", "triangle-alert", "info", "ellipsis-vertical",
  "chevron-left", "chevron-down", "chevron-right", "trash-2", "minus", "circle-help",
  "eye", "archive", "upload",
]);

function esc(value) {
  return String(value ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

/** SVG icon helper. Icon-only controls must pass their accessible label on the button. */
export function icon(name, { size = 20, label = null, className = "" } = {}) {
  const safe = ICONS.has(name) ? name : "circle-help";
  const accessibility = label
    ? `role="img" aria-label="${esc(label)}"`
    : 'aria-hidden="true" focusable="false"';
  return `<svg class="bt-icon ${esc(className)}" width="${Number(size)}" height="${Number(size)}" ${accessibility}><use href="./assets/icons.svg#${safe}"></use></svg>`;
}

export const STATUS_PRESENTATION = Object.freeze({
  review: {
    draft: { label: "Needs review", tone: "warning", icon: "sparkles" },
    approved: { label: "Approved", tone: "success", icon: "check" },
    edited: { label: "Edited", tone: "neutral", icon: "pencil" },
    rejected: { label: "Rejected", tone: "muted", icon: "x" },
  },
  priority: {
    active: { label: "Active", tone: "plain", icon: null },
    monitoring: { label: "Keeping an eye on it", tone: "neutral", icon: "eye" },
    resolved: { label: "Resolved", tone: "success", icon: "check" },
    archived: { label: "Archived", tone: "muted", icon: "archive" },
  },
  progress: {
    improving: { label: "Improving", tone: "success", icon: "trending-up" },
    unchanged: { label: "Unchanged", tone: "warning", icon: "minus" },
    worse: { label: "Worse", tone: "danger", icon: "trending-down" },
    unclear: { label: "Unclear", tone: "neutral", icon: "circle-help" },
    resolved: { label: "Resolved", tone: "success", icon: "check" },
  },
  practice: {
    yes: { label: "Improved", tone: "success", icon: "trending-up" },
    no: { label: "Unchanged", tone: "warning", icon: "minus" },
    mixed: { label: "Mixed", tone: "warning", icon: "circle-help" },
    unclear: { label: "Unclear", tone: "neutral", icon: "circle-help" },
  },
  processing: {
    pending: { label: "Waiting to process", tone: "neutral", icon: "clock" },
    processing: { label: "Processing", tone: "neutral", icon: null },
    ready: { label: "Ready", tone: "success", icon: "check" },
    failed: { label: "Failed", tone: "danger", icon: "triangle-alert" },
    uploading: { label: "Uploading", tone: "neutral", icon: "upload" },
  },
  quality: {
    good: { label: "Good", tone: "success-text", icon: null },
    limited: { label: "Limited", tone: "warning-text", icon: null },
    poor: { label: "Poor", tone: "danger-text", icon: null },
  },
});

const LEGACY_STATUS = Object.freeze({
  good: ["quality", "good"], limited: ["quality", "limited"], poor: ["quality", "poor"],
  needs_review: ["review", "draft"], "needs-review": ["review", "draft"],
  draft: ["review", "draft"], approved: ["review", "approved"], edited: ["review", "edited"], rejected: ["review", "rejected"],
  active: ["priority", "active"], monitoring: ["priority", "monitoring"], archived: ["priority", "archived"],
  improving: ["progress", "improving"], unchanged: ["progress", "unchanged"], worse: ["progress", "worse"], unclear: ["progress", "unclear"], resolved: ["progress", "resolved"],
  yes: ["practice", "yes"], no: ["practice", "no"], mixed: ["practice", "mixed"],
  pending: ["processing", "pending"], processing: ["processing", "processing"], ready: ["processing", "ready"], failed: ["processing", "failed"], uploading: ["processing", "uploading"],
  due: ["quality", "limited"],
});

export function statusPresentation(value, domain = null) {
  const key = String(value ?? "").replaceAll("-", "_").toLowerCase();
  if (domain && STATUS_PRESENTATION[domain]?.[key]) return STATUS_PRESENTATION[domain][key];
  const mapped = LEGACY_STATUS[key] ?? LEGACY_STATUS[String(value ?? "").toLowerCase()];
  if (mapped) return STATUS_PRESENTATION[mapped[0]][mapped[1]];
  return { label: String(value ?? ""), tone: "neutral", icon: null };
}

export function statusChip(value, { domain = null, label = null } = {}) {
  const state = statusPresentation(value, domain);
  if (state.tone === "plain") return `<span class="bt-status-plain">${esc(label ?? state.label)}</span>`;
  return `<span class="bt-status-chip bt-status-${state.tone}" data-status="${esc(value)}">${state.icon ? icon(state.icon, { size: 16 }) : ""}<span>${esc(label ?? state.label)}</span></span>`;
}

export function segmentedTabs(items, activeKey, { label = "Sections", className = "" } = {}) {
  return `<div class="bt-segmented-tabs ${esc(className)}" role="tablist" aria-label="${esc(label)}">${items.map((item) => {
    const active = item.key === activeKey;
    return `<a role="tab" aria-selected="${active}" ${active ? 'aria-current="page"' : ""} href="${esc(item.href)}" data-key="${esc(item.key)}">${esc(item.label)}</a>`;
  }).join("")}</div>`;
}

export function mountSegmentedTabs(container, items, activeKey, options) {
  container.className = "";
  container.innerHTML = segmentedTabs(items, activeKey, options);
}

export function card(content, { compact = false, className = "" } = {}) {
  return `<section class="bt-card${compact ? " bt-card-compact" : ""} ${esc(className)}">${content}</section>`;
}

export function listRow({ href = null, leading = "", title, supporting = "", trailing = "", className = "" }) {
  const tag = href ? "a" : "div";
  const attr = href ? ` href="${esc(href)}"` : "";
  return `<${tag} class="bt-list-row ${esc(className)}"${attr}>${leading ? `<span class="bt-list-row-leading">${leading}</span>` : ""}<span class="bt-list-row-copy"><span class="bt-list-row-title">${esc(title)}</span>${supporting ? `<span class="bt-list-row-supporting">${esc(supporting)}</span>` : ""}</span>${trailing ? `<span class="bt-list-row-trailing">${trailing}</span>` : ""}</${tag}>`;
}

export function filterChip(label, { selected = false, value = "" } = {}) {
  return `<button type="button" class="bt-filter-chip" aria-pressed="${selected}" data-value="${esc(value)}">${esc(label)}</button>`;
}

export function button(label, { variant = "secondary", iconName = null, type = "button", className = "", attrs = "" } = {}) {
  return `<button type="${esc(type)}" class="bt-button bt-button-${esc(variant)} ${esc(className)}" ${attrs}>${iconName ? icon(iconName, { size: 20 }) : ""}<span>${esc(label)}</span></button>`;
}

export function iconButton(iconName, label, { className = "", attrs = "" } = {}) {
  return `<button type="button" class="bt-icon-button ${esc(className)}" aria-label="${esc(label)}" ${attrs}>${icon(iconName, { size: 24 })}</button>`;
}

export function disclosure(summary, bodyHtml, { open = false, chipHtml = "" } = {}) {
  return `<details class="bt-disclosure" ${open ? "open" : ""}><summary><span>${esc(summary)}</span>${chipHtml}<span class="bt-disclosure-chevron">${icon("chevron-down", { size: 20 })}</span></summary><div class="bt-disclosure-body">${bodyHtml}</div></details>`;
}

export function emptyState(title, body, actionHtml = "", iconName = null) {
  return `<div class="bt-state bt-empty-state">${iconName ? icon(iconName, { size: 24 }) : ""}<strong>${esc(title)}</strong><span>${esc(body)}</span>${actionHtml ? `<div class="bt-state-action">${actionHtml}</div>` : ""}</div>`;
}

export function errorState(title = "Couldn't load this", body = "Check your connection and try again.", actionHtml = "") {
  return `<div class="bt-state bt-error-state">${icon("triangle-alert", { size: 24 })}<strong>${esc(title)}</strong><span>${esc(body)}</span>${actionHtml ? `<div class="bt-state-action">${actionHtml}</div>` : ""}</div>`;
}

export function processingState(label, detail = "", { retryHtml = "" } = {}) {
  return `<div class="bt-processing-state" role="status"><span class="bt-spinner" aria-hidden="true"></span><span><strong>${esc(label)}</strong>${detail ? `<small>${esc(detail)}</small>` : ""}</span>${retryHtml}</div>`;
}

export function stickyActionBar(content) {
  return `<div class="bt-sticky-action-bar">${content}</div>`;
}

// ---------------------------------------------------------------------------
// Overlay stack: BottomSheet, ActionSheet, menus and dialogs all share one
// browser-history contract. Browser/Android Back closes only the top overlay.
// ---------------------------------------------------------------------------

const overlayStack = [];
let overlaySerial = 0;
let pageInertState = null;
let historyBound = false;

export function topOverlayId() {
  return overlayStack.at(-1)?.id ?? null;
}

export function overlayHistoryDecision(stackIds, nextState) {
  const top = stackIds.at(-1) ?? null;
  return top && nextState?.barrelTraceOverlay !== top ? top : null;
}

function ensureHost() {
  let host = document.getElementById("btOverlayHost");
  if (!host) {
    host = document.createElement("div");
    host.id = "btOverlayHost";
    host.className = "bt-overlay-host";
    document.body.appendChild(host);
  }
  return host;
}

function setBackgroundInert(active) {
  const host = document.getElementById("btOverlayHost");
  if (active && !pageInertState) {
    pageInertState = [...document.body.children]
      .filter((node) => node !== host)
      .map((node) => ({ node, inert: node.inert }));
    pageInertState.forEach(({ node }) => { node.inert = true; });
    document.body.classList.add("bt-overlay-open");
  } else if (!active && pageInertState) {
    pageInertState.forEach(({ node, inert }) => { node.inert = inert; });
    pageInertState = null;
    document.body.classList.remove("bt-overlay-open");
  }
}

function finalizeOverlay(record, reason = "close") {
  if (!record || record.closed) return;
  record.closed = true;
  const index = overlayStack.indexOf(record);
  if (index >= 0) overlayStack.splice(index, 1);
  record.nativeRemove();
  record.onClose?.(reason);
  if (!overlayStack.length) setBackgroundInert(false);
  else overlayStack.at(-1).element.querySelector("[data-overlay-focus], button, a, input, select, textarea")?.focus();
  record.returnFocus?.focus?.();
  record.resolveClosed?.(reason);
}

function requestOverlayClose(record, reason = "close") {
  if (!record || record.closed) return;
  if (history.state?.barrelTraceOverlay === record.id) history.back();
  else finalizeOverlay(record, reason);
}

function bindHistory() {
  if (historyBound) return;
  historyBound = true;
  window.addEventListener("popstate", (event) => {
    const closeId = overlayHistoryDecision(overlayStack.map((x) => x.id), event.state);
    if (closeId) finalizeOverlay(overlayStack.find((x) => x.id === closeId), "history");
  });
}

function updateViewportHeight() {
  const height = window.visualViewport?.height ?? window.innerHeight;
  document.documentElement.style.setProperty("--visual-viewport-height", `${height}px`);
}

function trapFocus(event, record) {
  if (event.key === "Escape") {
    event.preventDefault();
    requestOverlayClose(record, "escape");
    return;
  }
  if (event.key !== "Tab") return;
  const focusable = [...record.element.querySelectorAll('button:not([disabled]), a[href], input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])')]
    .filter((node) => !node.hidden && node.offsetParent !== null);
  if (!focusable.length) return;
  const first = focusable[0];
  const last = focusable.at(-1);
  if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last.focus(); }
  else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first.focus(); }
}

function registerOverlay(element, { onClose = null, initialFocus = null } = {}) {
  bindHistory();
  updateViewportHeight();
  let resolveClosed;
  element.whenClosed = new Promise((resolve) => { resolveClosed = resolve; });
  const record = {
    id: `bt-overlay-${++overlaySerial}`,
    element,
    onClose,
    closed: false,
    returnFocus: document.activeElement,
    nativeRemove: element.remove.bind(element),
    resolveClosed,
  };
  overlayStack.push(record);
  element.dataset.overlayId = record.id;
  element.addEventListener("keydown", (event) => trapFocus(event, record));
  element.remove = () => requestOverlayClose(record);
  ensureHost().appendChild(element);
  setBackgroundInert(true);
  history.pushState({ ...(history.state ?? {}), barrelTraceOverlay: record.id }, "", location.href);
  requestAnimationFrame(() => (initialFocus ? element.querySelector(initialFocus) : element.querySelector("[data-overlay-focus], button, input, select, textarea, a"))?.focus());
  return { record, close: (reason) => requestOverlayClose(record, reason) };
}

/** Gives an existing full-screen/centred viewer modal the shared history,
 * focus and inert-background behavior without changing its screen content. */
export function registerModalOverlay(element, { onClose = null, closeSelector = ".close-btn" } = {}) {
  const { close } = registerOverlay(element, { onClose, initialFocus: closeSelector });
  element.querySelector(closeSelector)?.addEventListener("click", () => close("button"));
  element.addEventListener("pointerdown", (event) => { if (event.target === element) close("scrim"); });
  return element;
}

if (typeof window !== "undefined" && window.visualViewport) {
  window.visualViewport.addEventListener("resize", updateViewportHeight);
}

export function bottomSheetMarkup({ title, bodyHtml = "", footerHtml = "", ariaLabel = null }) {
  return `<section class="bt-sheet" role="dialog" aria-modal="true" aria-label="${esc(ariaLabel ?? title)}">
    <div class="bt-sheet-handle" aria-hidden="true"></div>
    <header class="bt-sheet-header"><h2>${esc(title)}</h2>${iconButton("x", "Close", { className: "bt-sheet-close", attrs: "data-overlay-focus" })}</header>
    <div class="bt-sheet-body">${bodyHtml}</div>
    ${footerHtml ? `<footer class="bt-sheet-footer">${footerHtml}</footer>` : ""}
  </section>`;
}

export function openBottomSheet({ title, bodyHtml = "", footerHtml = "", onClose = null, ariaLabel = null, className = "" }) {
  const overlay = document.createElement("div");
  overlay.className = `bt-overlay bt-sheet-overlay ${className}`;
  overlay.innerHTML = bottomSheetMarkup({ title, bodyHtml, footerHtml, ariaLabel });
  const { close } = registerOverlay(overlay, { onClose, initialFocus: ".bt-sheet-close" });
  overlay.querySelector(".bt-sheet-close").addEventListener("click", () => close("button"));
  overlay.addEventListener("pointerdown", (event) => { if (event.target === overlay) close("scrim"); });
  return overlay;
}

export function actionSheetMarkup(actions = []) {
  return `<div class="bt-action-list">${actions.map((action, index) => `<button type="button" class="bt-action-row" data-action-index="${index}" ${action.disabled ? "disabled" : ""}>${icon(action.icon ?? "plus", { size: 22 })}<span><strong>${esc(action.label)}</strong>${action.supporting ? `<small>${esc(action.supporting)}</small>` : ""}</span>${icon("chevron-right", { size: 20 })}</button>`).join("")}</div>`;
}

export function openActionSheet({ title = "Add", actions = [], onClose = null }) {
  const body = actionSheetMarkup(actions);
  const sheet = openBottomSheet({ title, bodyHtml: body, onClose, className: "bt-action-sheet" });
  sheet.querySelectorAll("[data-action-index]").forEach((buttonEl) => buttonEl.addEventListener("click", () => {
    const action = actions[Number(buttonEl.dataset.actionIndex)];
    if (action?.keepOpen) action.onSelect?.(sheet);
    else {
      sheet.remove();
      sheet.whenClosed.then(() => {
        if (action?.onSelect) action.onSelect(sheet);
        else if (action?.href) location.href = action.href;
      });
    }
  }));
  return sheet;
}

export function confirmDialogMarkup({ title, message, confirmLabel = "Confirm", cancelLabel = "Cancel", destructive = false, id = "dialog" }) {
  return `<section class="bt-confirm-dialog" role="alertdialog" aria-modal="true" aria-labelledby="btConfirmTitle-${esc(id)}" aria-describedby="btConfirmBody-${esc(id)}">
      <h2 id="btConfirmTitle-${esc(id)}">${esc(title)}</h2><p id="btConfirmBody-${esc(id)}">${esc(message)}</p>
      <div class="bt-dialog-actions">${button(cancelLabel, { variant: "secondary", attrs: "data-cancel data-overlay-focus" })}${button(confirmLabel, { variant: destructive ? "destructive" : "primary", attrs: "data-confirm" })}</div>
    </section>`;
}

export function confirmDialog({ title, message, confirmLabel = "Confirm", cancelLabel = "Cancel", destructive = false }) {
  return new Promise((resolve) => {
    let decided = false;
    const overlay = document.createElement("div");
    overlay.className = "bt-overlay bt-dialog-overlay";
    overlay.innerHTML = confirmDialogMarkup({ title, message, confirmLabel, cancelLabel, destructive, id: overlaySerial + 1 });
    const { close } = registerOverlay(overlay, { onClose: () => { if (!decided) resolve(false); }, initialFocus: "[data-cancel]" });
    overlay.querySelector("[data-cancel]").addEventListener("click", () => { decided = true; resolve(false); close("cancel"); });
    overlay.querySelector("[data-confirm]").addEventListener("click", () => { decided = true; resolve(true); close("confirm"); });
    overlay.addEventListener("pointerdown", (event) => { if (event.target === overlay) close("scrim"); });
  });
}

export function snackbarMarkup(message, actionLabel = null) {
  return `<span>${esc(message)}</span>${actionLabel ? `<button type="button">${esc(actionLabel)}</button>` : ""}`;
}

export function showSnackbar(message, { actionLabel = null, onAction = null, duration = 5000 } = {}) {
  let host = document.getElementById("btSnackbarHost");
  if (!host) {
    host = document.createElement("div");
    host.id = "btSnackbarHost";
    host.className = "bt-snackbar-host";
    document.body.appendChild(host);
  }
  const bar = document.createElement("div");
  bar.className = "bt-snackbar";
  bar.setAttribute("role", "status");
  bar.setAttribute("aria-live", "polite");
  bar.innerHTML = snackbarMarkup(message, actionLabel);
  host.replaceChildren(bar);
  let timer = setTimeout(() => bar.remove(), duration);
  bar.querySelector("button")?.addEventListener("click", () => {
    clearTimeout(timer);
    bar.remove();
    onAction?.();
  });
  return { close: () => { clearTimeout(timer); bar.remove(); }, element: bar };
}

export function openOverflowMenu({ title = "More", items = [], anchor = null }) {
  const narrow = window.matchMedia("(max-width: 599px)").matches;
  if (narrow || !anchor) return openActionSheet({ title, actions: items });
  const overlay = document.createElement("div");
  overlay.className = "bt-overlay bt-menu-overlay";
  const rect = anchor.getBoundingClientRect();
  overlay.innerHTML = `<div class="bt-overflow-menu" role="menu" style="top:${Math.min(rect.bottom + 4, innerHeight - 280)}px;right:${Math.max(8, innerWidth - rect.right)}px">${items.map((item, index) => `<button type="button" role="menuitem" data-menu-index="${index}" class="${item.destructive ? "danger" : ""}">${icon(item.icon ?? "chevron-right", { size: 20 })}<span>${esc(item.label)}</span></button>`).join("")}</div>`;
  const { close } = registerOverlay(overlay, { initialFocus: "[role=menuitem]" });
  overlay.addEventListener("pointerdown", (event) => { if (event.target === overlay) close("scrim"); });
  overlay.querySelectorAll("[data-menu-index]").forEach((buttonEl) => buttonEl.addEventListener("click", () => {
    const item = items[Number(buttonEl.dataset.menuIndex)];
    close("select");
    overlay.whenClosed.then(() => item?.onSelect?.());
  }));
  return overlay;
}
