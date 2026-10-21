import test from "node:test";
import assert from "node:assert/strict";
import { backDecision, tabState, playerState, reportState, sheetState, createNavigation, initNavigation } from "./simpleNavigation.js";

function harness({ shared = false, native = false } = {}) {
  const entries = [null], listeners = new Map(), calls = [], rendered = [];
  let index = 0, overlay = false, exits = 0, scroll = 123, listener;
  const history = {
    get state() { return entries[index]; },
    replaceState(value) { entries[index] = value; },
    pushState(value) { entries.splice(++index); entries[index] = value; calls.push(["push", value]); },
    go(delta) { calls.push(["go", delta]); queueMicrotask(async () => {
      index += delta;
      await nav.pop({ state: entries[index] });
    }); },
    back() { this.go(-1); },
  };
  const nav = createNavigation({ history, isShared: () => shared, overlayOpen: () => overlay,
    getScroll: () => scroll, restoreScroll: (y) => rendered.push(["scroll", y]),
    renderPlayer: (id) => rendered.push(["player", id]),
    renderTab: (tab) => rendered.push(["tab", tab]), renderReport: (id) => rendered.push(["report", id]),
    renderSheet: (name) => { rendered.push(["sheet", name]); nav.openSheet(name); },
    closeSheet: () => rendered.push(["close-sheet"]),
  });
  const app = { addListener(name, fn) { calls.push(["native", name]); listener = fn; }, exitApp() { exits++; } };
  const window = { history, addEventListener(name, fn, capture) { listeners.set(name, fn); calls.push(["web", name, capture]); },
    // Shape of the real unbundled Android bridge: plugins on Capacitor.Plugins, no registerPlugin.
    Capacitor: native ? { isPluginAvailable: (name) => name === "App", Plugins: { App: app } } : undefined };
  return { nav, history, calls, rendered, entries, window, setOverlay: (value) => { overlay = value; },
    nativeBack: () => listener(), exits: () => exits, setScroll: (value) => { scroll = value; } };
}
const tick = () => new Promise((resolve) => setImmediate(resolve));

test("back decisions follow overlay, sheet, report, Progress, Home and shared priorities", () => {
  assert.deepEqual(backDecision({ overlayOpen: true, sheets: ["choice"], view: reportState("c", "home", 9) }), { type: "close-overlay" });
  assert.deepEqual(backDecision({ sheets: ["choice", "confirm"] }), { type: "previous-sheet", name: "choice" });
  assert.deepEqual(backDecision({ sheets: ["settings", "guide"] }), { type: "previous-sheet", name: "settings" });
  assert.deepEqual(backDecision({ sheets: ["choice"] }), { type: "close-sheet" });
  assert.deepEqual(backDecision({ view: reportState("c", "progress", 321) }), { type: "pop-view", tab: "progress", scrollY: 321 });
  assert.deepEqual(backDecision({ view: tabState("progress") }), { type: "go-home-tab" });
  assert.deepEqual(backDecision(), { type: "exit" });
  assert.deepEqual(backDecision({ shared: true, view: reportState("c", "home", 0) }), { type: "exit" });
  assert.deepEqual(sheetState("guide"), { hl: "sheet", name: "guide" });
});

test("report refresh never pushes; popping restores both originating tabs and scroll", async () => {
  for (const tab of ["home", "progress"]) {
    const h = harness();
    if (tab === "progress") await h.nav.goTab(tab);
    h.setScroll(456);
    h.nav.openReport("clip");
    assert.deepEqual(h.history.state, reportState("clip", tab, 456));
    const pushes = h.calls.length;
    h.nav.openReport("clip"); h.nav.openReport("clip");
    assert.equal(h.calls.length, pushes);
    h.nav.back(); await tick();
    assert.deepEqual(h.rendered.slice(-2), [["tab", tab], ["scroll", 456]]);
  }
});

test("sheet Back restores previous sheet without creating another history entry", async () => {
  for (const stack of [["choice", "confirm"], ["settings", "guide"], ["choice", "guide"]]) {
    const h = harness();
    h.nav.openReport("clip");
    stack.forEach((name) => h.nav.openSheet(name));
    h.nav.back(); await tick();
    assert.equal(h.nav.sheet, stack[0]);
    assert.deepEqual(h.rendered.at(-1), ["sheet", stack[0]]);
    assert.equal(h.calls.filter(([name]) => name === "push").length, 3);
    h.nav.back(); await tick();
    assert.equal(h.nav.sheet, undefined);
    assert.equal(h.nav.view.hl, "report");
    assert.deepEqual(h.rendered.at(-1), ["close-sheet"]);
  }
});

test("own close drops the entire sheet stack without navigating the underlying report", async () => {
  const h = harness();
  h.nav.openReport("clip"); h.nav.openSheet("choice"); h.nav.openSheet("confirm");
  await h.nav.dismissSheets();
  assert.deepEqual(h.history.state, reportState("clip", "home", 123));
  assert.deepEqual(h.rendered, [["close-sheet"]]);
  h.nav.back(); await tick();
  assert.deepEqual(h.rendered.slice(-2), [["tab", "home"], ["scroll", 123]]);
});

test("overlay pop is consumed only by ui.js, leaving report and sheet intact", async () => {
  const h = harness(); h.nav.openReport("clip"); h.nav.openSheet("choice");
  h.setOverlay(true);
  await h.nav.pop({ state: sheetState("choice") });
  assert.equal(h.nav.sheet, "choice");
  assert.equal(h.rendered.length, 0);
  h.setOverlay(false);
  h.nav.back(); await tick();
  assert.equal(h.nav.view.hl, "report");
});

test("init is idempotent and native exits only at Home or the shared viewer", async () => {
  const h = harness({ native: true });
  await initNavigation({ window: h.window, navigation: h.nav });
  await initNavigation({ window: h.window, navigation: h.nav });
  assert.deepEqual(h.calls, [["web", "popstate", true], ["native", "backButton"]]);
  await h.nav.goTab("progress"); h.nav.openReport("clip"); h.nav.openSheet("choice");
  for (let i = 0; i < 3; i++) { h.nativeBack(); await tick(); assert.equal(h.exits(), 0); }
  h.nativeBack(); assert.equal(h.exits(), 1);
  const shared = harness({ shared: true, native: true });
  await initNavigation({ window: shared.window, navigation: shared.nav });
  shared.nav.openReport("shared");
  assert.equal(shared.calls.filter(([name]) => name === "push").length, 0);
  shared.nativeBack(); assert.equal(shared.exits(), 1);
});

test("a missing or broken native bridge never stops start-up; web history still registers", async () => {
  const errors = [];
  for (const Capacitor of [
    { isPluginAvailable: () => true },                                   // plugin reported but not exposed
    { isPluginAvailable: () => { throw new Error("bridge not ready"); } }, // bridge throws
    { isPluginAvailable: () => true, Plugins: { App: { addListener() { throw new Error("listener failed"); } } } },
  ]) {
    const h = harness();
    h.window.Capacitor = Capacitor;
    await assert.doesNotReject(() => initNavigation({ window: h.window, navigation: h.nav, onError: (e) => errors.push(e.message) }));
    assert.deepEqual(h.calls.filter(([kind]) => kind === "web"), [["web", "popstate", true]]);
  }
  assert.deepEqual(errors, ["bridge not ready", "listener failed"]);
});

test("tab buttons remove report history so Back does not reopen the report", async () => {
  const h = harness(); await h.nav.goTab("progress"); h.nav.openReport("clip");
  await h.nav.goTab("home");
  assert.deepEqual(h.history.state, tabState());
  assert.equal(h.nav.decision().type, "exit");
});

test("browser Forward restores a sheet and subsequent Back closes only that sheet", async () => {
  const h = harness(); h.nav.openReport("clip"); h.nav.openSheet("choice"); h.nav.openSheet("confirm");
  h.nav.back(); await tick();
  h.history.go(1); await tick();
  assert.equal(h.nav.sheet, "confirm");
  h.nav.back(); await tick();
  assert.equal(h.nav.sheet, "choice");
  h.nav.back(); await tick();
  assert.equal(h.nav.view.clipId, "clip");
  assert.equal(h.nav.sheet, undefined);
  assert.equal(h.calls.filter(([name]) => name === "push").length, 3);
});


test("Team → Player → report → Back restores Player scroll, then Team scroll", async () => {
  const h = harness();
  h.setScroll(80); await h.nav.openPlayer("p");
  assert.deepEqual(h.nav.view, playerState("p"));
  assert.deepEqual(h.nav.decision(), { type: "pop-view" });
  h.setScroll(420); h.nav.openReport("c");
  assert.deepEqual(h.nav.view.parent, playerState("p", 420));
  h.nav.back(); await tick();
  assert.deepEqual(h.rendered.slice(-2), [["player", "p"], ["scroll", 420]]);
  h.nav.back(); await tick();
  assert.deepEqual(h.rendered.slice(-2), [["tab", "home"], ["scroll", 80]]);
});

test("goTab drops report-over-player depth plus sheets, preserving Progress push", async () => {
  const h = harness(); await h.nav.openPlayer("p"); h.nav.openReport("c");
  h.nav.openSheet("settings"); h.nav.openSheet("guide");
  await h.nav.goTab("progress");
  assert.ok(h.calls.some(([kind, delta]) => kind === "go" && delta === -4));
  assert.deepEqual(h.nav.view, tabState("progress"));
  h.nav.back(); await tick();
  assert.equal(h.nav.decision().type, "exit");
});

test("returnFromReport closes sheets and restores parent, and otherwise is a no-op", async () => {
  for (const player of [false, true]) {
    const h = harness();
    if (player) await h.nav.openPlayer("p");
    h.setScroll(321); h.nav.openReport("c"); h.nav.openSheet("guide");
    await h.nav.returnFromReport();
    assert.ok(h.calls.some(([kind, delta]) => kind === "go" && delta === -2));
    assert.deepEqual(h.rendered.slice(-2), [[player ? "player" : "tab", player ? "p" : "home"], ["scroll", 321]]);
    const count = h.calls.length; await h.nav.returnFromReport(); assert.equal(h.calls.length, count);
  }
});

test("Player cannot open from shared, Progress, or a sheet; overlay Back preserves Player", async () => {
  const shared = harness({ shared: true }); await shared.nav.openPlayer("p"); assert.equal(shared.nav.view.hl, "tab");
  const h = harness(); await h.nav.goTab("progress"); await h.nav.openPlayer("p"); assert.equal(h.nav.view.tab, "progress");
  await h.nav.goTab("home"); h.nav.openSheet("choice"); await h.nav.openPlayer("p"); assert.equal(h.nav.view.hl, "tab");
  await h.nav.dismissSheets(); await h.nav.openPlayer("p"); h.setOverlay(true);
  assert.equal(h.nav.decision().type, "close-overlay");
  await h.nav.pop({ state: tabState() }); assert.equal(h.nav.view.hl, "player");
});
