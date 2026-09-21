import test from "node:test";
import assert from "node:assert/strict";
import {
  actionSheetMarkup, bottomSheetMarkup, confirmDialogMarkup, icon, overlayHistoryDecision,
  segmentedTabs, snackbarMarkup, statusChip, statusPresentation,
} from "./ui.js";
import { bottomNavState, PLAYER_TABS } from "./shellState.js";

test("icon helper uses the one SVG sprite, currentColor class, and accessible modes", () => {
  assert.match(icon("users"), /class="bt-icon/);
  assert.match(icon("users"), /assets\/icons\.svg#users/);
  assert.match(icon("users"), /aria-hidden="true"/);
  assert.match(icon("users", { label: "Team" }), /role="img" aria-label="Team"/);
  assert.match(icon("not-a-real-icon"), /#circle-help/);
});

test("status presentation maps legacy values without changing storage values", () => {
  assert.deepEqual(statusPresentation("draft", "review"), { label: "Needs review", tone: "warning", icon: "sparkles" });
  assert.equal(statusPresentation("no", "practice").label, "Unchanged");
  assert.equal(statusPresentation("pending", "processing").label, "Waiting to process");
  assert.match(statusChip("worse", { domain: "progress" }), /trending-down/);
  assert.match(statusChip("worse", { domain: "progress" }), />Worse</);
});

test("SegmentedTabs are accessible and Overview keeps the player.html route", () => {
  const items = PLAYER_TABS.map((tab) => ({ ...tab, href: `./${tab.page}.html` }));
  const html = segmentedTabs(items, "report", { label: "Player sections" });
  assert.match(html, /role="tablist"/);
  assert.match(html, /aria-selected="true" aria-current="page" href="\.\/player\.html"[^>]*>Overview</);
  assert.doesNotMatch(html, />Report</);
  assert.equal(items.length, 4);
});

test("BottomSheet markup has dialog semantics, close control, scroll body and sticky footer slot", () => {
  const html = bottomSheetMarkup({ title: "Sample sheet", bodyHtml: "<input>", footerHtml: "<button>Save</button>" });
  assert.match(html, /role="dialog"/);
  assert.match(html, /aria-modal="true"/);
  assert.match(html, /bt-sheet-handle/);
  assert.match(html, /aria-label="Close"/);
  assert.match(html, /bt-sheet-body/);
  assert.match(html, /bt-sheet-footer/);
});

test("overlay history closes only the top overlay before page navigation", () => {
  assert.equal(overlayHistoryDecision(["sheet-1"], { barrelTraceOverlay: "sheet-1" }), null);
  assert.equal(overlayHistoryDecision(["sheet-1", "dialog-2"], { barrelTraceOverlay: "sheet-1" }), "dialog-2");
  assert.equal(overlayHistoryDecision(["sheet-1"], null), "sheet-1");
  assert.equal(overlayHistoryDecision([], null), null);
});

test("ConfirmDialog defaults focus to Cancel and isolates destructive styling", () => {
  const html = confirmDialogMarkup({ title: "Delete pitch?", message: "The video stays.", confirmLabel: "Delete pitch", destructive: true });
  assert.match(html, /role="alertdialog"/);
  assert.match(html, /data-cancel data-overlay-focus/);
  assert.match(html, /bt-button-destructive/);
  assert.match(html, />Delete pitch</);
});

test("Snackbar exposes an optional Undo action", () => {
  assert.equal(snackbarMarkup("Saved"), "<span>Saved</span>");
  assert.match(snackbarMarkup("Finding rejected", "Undo"), /<button type="button">Undo<\/button>/);
});

test("ActionSheet rows have icons, labels, support copy and 56dp component class", () => {
  const html = actionSheetMarkup([{ label: "Log at-bat", icon: "plus", supporting: "Ada Tester" }]);
  assert.match(html, /bt-action-row/);
  assert.match(html, /icons\.svg#plus/);
  assert.match(html, /Log at-bat/);
  assert.match(html, /Ada Tester/);
});

test("bottom nav is Team / Add / Review and Review is always reachable", () => {
  const withoutPlayer = bottomNavState({ teamSlug: "bison", activeTab: "roster" });
  assert.deepEqual(withoutPlayer.map((x) => x.label), ["Team", "Add", "Review"]);
  assert.equal(withoutPlayer[0].active, true);
  assert.equal(withoutPlayer[2].hidden, false);
  const withPlayer = bottomNavState({ teamSlug: "bison", activeTab: "report", playerHref: "./player.html?player=ada" });
  assert.equal(withPlayer[2].hidden, false);
  assert.equal(withPlayer[2].active, false);
  assert.match(withPlayer[2].href, /queue\.html\?team=bison/);
});
