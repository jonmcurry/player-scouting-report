// The capture guide is the family's only filming instruction - it must carry
// the three things that decide whether a swing can be analyzed at all.
import test from "node:test";
import assert from "node:assert/strict";
import { captureChecklist, captureGuideHtml, captureModeHtml, captureSummaryHtml } from "./captureGuide.js";

test("capture checklist covers framing, safe angle and a steady sideways phone", () => {
  const items = captureChecklist();
  assert.ok(Array.isArray(items) && items.length >= 3);
  const all = items.join("\n");
  assert.match(all, /whole body and bat in frame through contact/);
  assert.match(all, /behind the backstop/);
  assert.match(all, /hold the phone still/i);
  assert.match(all, /sideways/i);
});

test("capture checklist is plain copy: no scores, metrics or AI wording", () => {
  for (const item of captureChecklist()) {
    assert.doesNotMatch(item, /AI|score|issue|metric/i, item);
  }
});

test("capture guide is open the first time and collapsible after that", () => {
  const first = captureGuideHtml({ open: true });
  const later = captureGuideHtml({ open: false });
  assert.match(first, /<details[^>]*\sopen/);
  assert.doesNotMatch(later, /<details[^>]*\sopen/);
  for (const html of [first, later]) {
    assert.match(html, /<summary>/);
    for (const item of captureChecklist()) assert.ok(html.includes(item.replace(/'/g, "&#039;")), `guide shows: ${item}`);
    assert.match(html, /Open-side practice/);
    assert.match(html, /protected position/);
  }
});

test("sport and camera modes render labeled framing illustrations without calibration claims", () => {
  assert.match(captureModeHtml("game_backstop", "softball"), /Softball · Game \/ backstop/);
  assert.match(captureModeHtml("open_side_practice", "baseball"), /Baseball · Open-side practice/);
  assert.match(captureModeHtml("game_backstop"), /role="img" aria-label=/);
  assert.doesNotMatch(captureModeHtml("open_side_practice"), /calibrated/i);
});

test("capture states remain secondary and suggestions are escaped and capped", () => {
  assert.match(captureSummaryHtml({ state: "pending" }), /still pending/);
  assert.match(captureSummaryHtml({ state: "partial", profile: "Unknown", recommendations: [] }), /visibility is still unavailable/);
  assert.match(captureSummaryHtml({ state: "needs_recheck" }), /new check is needed/);
  const checked = captureSummaryHtml({ state: "checked", profile: "<private>", recommendations: ["<bad>", "whole_hitter", "bat_arc", "Third"] }, { canCorrect: true });
  assert.match(checked, /Correct camera view/);
  assert.doesNotMatch(checked, /<private>|<bad>|Third/);
  assert.match(checked, /whole hitter/);
  assert.match(checked, /<details/);
});
