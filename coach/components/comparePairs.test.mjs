import test from "node:test";
import assert from "node:assert/strict";
import { sharedPhase, suggestedComparePairs } from "./comparePairs.js";

const row = (clipId, date, extra = {}) => ({ clipId, date, status: "ready", swung: true, ...extra });
test("compare suggestions prioritize practice context and keep A earlier than B", () => {
  const pairs = suggestedComparePairs([
    row("post", "2026-09-20", { context: "practice", sessionId: "s", grouping: "post_drill" }),
    row("base", "2026-09-20", { context: "practice", sessionId: "s", grouping: "baseline" }),
    row("g1", "2026-09-10", { context: "game" }), row("g2", "2026-09-21", { context: "game" }),
  ], { source: "practice" });
  assert.equal(pairs[0].key, "baseline_post");
  assert.equal(pairs[0].a.clipId, "base");
  assert.equal(pairs.at(-1).key, "game_game");
});

test("shared phase prefers contact and safely falls back", () => {
  assert.equal(sharedPhase([{ slug: "contact", timeS: 1 }], [{ slug: "contact", timeS: 2 }]), "contact");
  assert.equal(sharedPhase([{ slug: "load", timeS: 1 }], [{ slug: "load", timeS: 2 }]), "load");
  assert.equal(sharedPhase([{ slug: "load", timeS: 1 }], [{ slug: "finish", timeS: 2 }]), null);
});
