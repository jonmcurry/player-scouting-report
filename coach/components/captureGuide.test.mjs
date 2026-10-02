// The capture guide is the family's only filming instruction - it must carry
// the three things that decide whether a swing can be analyzed at all.
import test from "node:test";
import assert from "node:assert/strict";
import { captureChecklist, captureGuideHtml } from "./captureGuide.js";

test("capture checklist covers framing, distance/angle and a steady sideways phone", () => {
  const items = captureChecklist();
  assert.ok(Array.isArray(items) && items.length >= 3);
  const all = items.join("\n");
  assert.match(all, /whole body and bat in frame through contact/);
  assert.match(all, /from the side, about 10–15 ft away/);
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
  }
});
