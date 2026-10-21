// History shapes and decisions are independent of the DOM and native plugins.
export const tabState = (tab = "home", scrollY = 0) => ({ hl: "tab", tab, scrollY });
export const playerState = (playerId, scrollY = 0) => ({ hl: "player", playerId, scrollY });
export const reportState = (clipId, fromTab, scrollY, parent = tabState(fromTab, scrollY)) =>
  ({ hl: "report", clipId, fromTab, scrollY, parent: { ...parent } });
const tabOf = (view) => view.hl === "player" ? "home" : view.tab ?? view.fromTab;
const depth = (view) => view.hl === "report" ? depth(view.parent ?? tabState(view.fromTab)) + 1
  : view.hl === "player" || view.tab === "progress" ? 1 : 0;
export const sheetState = (name) => ({ hl: "sheet", name });

export function backDecision({ overlayOpen = false, sheets = [], view = tabState(), shared = false } = {}) {
  if (overlayOpen) return { type: "close-overlay" };
  if (sheets.length > 1) return { type: "previous-sheet", name: sheets.at(-2) };
  if (sheets.length) return { type: "close-sheet" };
  if (shared) return { type: "exit" };
  if (view.hl === "report") return { type: "pop-view", tab: view.fromTab, scrollY: view.scrollY };
  if (view.hl === "player") return { type: "pop-view" };
  if (view.tab === "progress") return { type: "go-home-tab" };
  return { type: "exit" };
}

// All effects are injected so the same history wiring can be exercised without a browser.
export function createNavigation({ history, renderTab, renderReport, renderPlayer, renderSheet, closeSheet,
  getScroll = () => 0, restoreScroll = () => {}, isShared = () => false, overlayOpen = () => false }) {
  let view = tabState();
  let sheets = [];
  let dropping = null;
  history.replaceState(view, "");
  const decision = () => backDecision({ view, sheets, shared: isShared(), overlayOpen: overlayOpen() });
  async function pop(event) {
    // Registered in capture phase: ui.js still owns this pop, even if it removes its overlay
    // before a later bubble listener could inspect the stack.
    if (overlayOpen()) return;
    if (dropping) { const done = dropping; dropping = null; done(); return; }
    const next = event.state;
    if (next?.hl === "sheet") {
      const previousIndex = sheets.lastIndexOf(next.name);
      sheets = previousIndex >= 0 ? sheets.slice(0, previousIndex + 1) : [...sheets, next.name];
      await renderSheet(next.name);
      return;
    }
    if (sheets.length) {
      sheets = [];
      closeSheet();
      // Returning from a sheet preserves the underlying video and tab scroll.
      if (next?.hl === view.hl && (view.hl === "report" ? next.clipId === view.clipId : view.hl === "player" ? next.playerId === view.playerId : next.tab === view.tab)) return;
    }
    if (next?.hl === "report") { view = next; await renderReport(next.clipId); return; }
    const previous = view;
    view = ["tab", "player"].includes(next?.hl) ? next : tabState();
    if (view.hl === "player") await renderPlayer(view.playerId);
    else await renderTab(view.tab);
    restoreScroll(previous.hl === "report" ? previous.scrollY : view.scrollY);
  }
  function drop(count) {
    if (!count) return Promise.resolve();
    return new Promise((resolve) => { dropping = resolve; history.go(-count); });
  }
  return {
    decision, pop,
    get view() { return view; },
    get sheet() { return sheets.at(-1); },
    get busy() { return !!dropping; },
    async openPlayer(playerId) {
      if (isShared() || dropping || sheets.length || view.hl !== "tab" || view.tab !== "home") return;
      history.replaceState({ ...view, scrollY: getScroll() }, "");
      view = playerState(playerId);
      history.pushState(view, "");
      const opened = view;
      await renderPlayer(playerId);
      if (view === opened) restoreScroll(0);
    },
    openReport(clipId) {
      if (isShared() || dropping || view.hl === "report") return;
      const scroll = getScroll();
      const parent = { ...view, scrollY: scroll };
      history.replaceState(parent, "");
      view = reportState(clipId, tabOf(view), scroll, parent);
      history.pushState(view, "");
    },
    openSheet(name) {
      if (dropping || sheets.at(-1) === name) return;
      sheets.push(name);
      history.pushState(sheetState(name), "");
    },
    async dismissSheets() {
      if (dropping) return;
      const count = sheets.length;
      sheets = [];
      closeSheet();
      await drop(count);
    },
    async returnFromReport() {
      if (dropping || view.hl !== "report") return;
      const parent = view.parent ?? tabState(view.fromTab, view.scrollY);
      const count = sheets.length + 1;
      sheets = [];
      closeSheet();
      await drop(count);
      view = { ...parent };
      if (view.hl === "player") await renderPlayer(view.playerId);
      else await renderTab(view.tab);
      restoreScroll(view.scrollY);
    },
    async goTab(tab) {
      if (dropping) return;
      const count = sheets.length + depth(view);
      sheets = [];
      closeSheet();
      await drop(count);
      view = tabState();
      history.replaceState(view, "");
      if (tab === "progress") { view = tabState(tab); history.pushState(view, ""); }
      await renderTab(tab);
      restoreScroll(0);
    },
    back(app = null) {
      if (dropping) return;
      if (decision().type === "exit") { if (app) app.exitApp(); else history.back(); }
      else history.back();
    },
  };
}

const registrations = new WeakMap();
export function initNavigation({ window, navigation, onError = () => {} }) {
  if (registrations.has(window)) return registrations.get(window);
  window.addEventListener("popstate", (event) => { navigation.pop(event).catch(onError); }, true);
  // The unbundled native bridge exposes plugins on Capacitor.Plugins; registerPlugin exists only in
  // @capacitor/core builds. A plugin problem must never stop the app from starting: web history still works.
  let app = null;
  try {
    const capacitor = window.Capacitor;
    if (capacitor?.isPluginAvailable?.("App")) {
      app = capacitor.Plugins?.App ?? (typeof capacitor.registerPlugin === "function" ? capacitor.registerPlugin("App") : null);
    }
  } catch (error) { onError(error); }
  const registration = app?.addListener
    ? Promise.resolve().then(() => app.addListener("backButton", () => navigation.back(app))).catch(onError)
    : Promise.resolve();
  registrations.set(window, registration);
  return registration;
}
