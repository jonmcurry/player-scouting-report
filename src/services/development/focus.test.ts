import test from "node:test";
import assert from "node:assert/strict";
import { advanceFocus, dismissFocus, shownFix, type Finding, type FocusRecord, type ReadableSwing } from "./focus.js";

const finding = (concept: string, extra: Partial<Finding> = {}): Finding => ({
  id: `${concept}-id`, concept, phase: "stride", basis: "video", confidence: "low",
  contextExplainsIt: false, emergencySwingSuspected: false, hidden: false, ...extra,
});
const swing = (serial: number, concepts: string[], extra: Partial<ReadableSwing> = {}): ReadableSwing => ({
  id: `s${serial}`, serial, date: `2026-10-${String(serial).padStart(2, "0")}`,
  sessionType: "game", readable: true, findings: concepts.map((c) => finding(c)), ...extra,
});
const focus = (concept = "posture"): FocusRecord => ({ concept, status: "active", startedAt: "2026-10-03", endedAt: null, qualifiedAtSerial: 3, dismissedAtSerial: null, dismissedBy: null });

test("one shown fix requires video basis, medium confidence, a mechanical concept and quality", () => {
  const issues = [finding("posture", { confidence: "medium" }), finding("load", { confidence: "low" })];
  assert.equal(shownFix(issues, true, null)?.concept, "posture");
  assert.equal(shownFix(issues, false, null), null);
  assert.equal(shownFix([finding("swing_decision", { confidence: "medium" })], true, null), null);
  assert.equal(shownFix([finding("posture", { confidence: "medium", hidden: true })], true, null), null);
  assert.equal(shownFix([finding("posture", { confidence: "medium", basis: "metric" })], true, null), null);
});

test("current concept wins over earlier phase when two fixes qualify", () => {
  const issues = [finding("load", { id: "a", phase: "load", confidence: "medium" }), finding("posture", { id: "b", phase: "contact", confidence: "medium" })];
  assert.equal(shownFix(issues, true, "posture")?.id, "b");
  assert.equal(shownFix(issues, true, null)?.id, "a");
});

test("early read, qualifying pattern, improving and fixed use readable game swings only", () => {
  assert.equal(advanceFocus([swing(1, ["posture"]), swing(2, ["posture"])], null, []).status, "early_read");
  const game = [swing(1, ["posture"]), swing(2, ["posture"]), swing(3, ["posture"])];
  assert.equal(advanceFocus(game, null, []).current?.concept, "posture");
  const practice = swing(0, ["posture"], { sessionType: "practice" });
  const improving = advanceFocus([...game, practice, swing(4, []), swing(5, []), swing(6, [])], focus(), []);
  assert.equal(improving.status, "improving");
  assert.equal(improving.seen, 2);
  const fixed = advanceFocus([...game, swing(4, []), swing(5, []), swing(6, []), swing(7, [])], focus(), []);
  assert.equal(fixed.current, null);
  assert.equal(fixed.history[0]?.status, "fixed");
});

test("hidden, non-video and non-mechanical findings do not count", () => {
  const rows = [1, 2, 3].map((n) => swing(n, [], { findings: [
    finding("posture", { hidden: true }), finding("load", { basis: "metric" }), finding("swing_decision"),
  ] }));
  assert.equal(advanceFocus(rows, null, []).status, "no_pattern");
});

test("dismissed focus stays out for six later readable game swings", () => {
  const dismissed = dismissFocus(focus(), "guardian-1", 3, "2026-10-03");
  const firstNine = Array.from({ length: 9 }, (_, i) => swing(i + 1, ["posture"]));
  assert.equal(advanceFocus(firstNine, null, [dismissed]).current, null);
  assert.equal(advanceFocus([...firstNine, swing(10, ["posture"])], null, [dismissed]).current?.concept, "posture");
});

test("deleted history cannot create an improvement claim from a tiny retained window", () => {
  const result = advanceFocus([swing(8, ["posture"]), swing(9, ["posture"])], focus(), []);
  assert.equal(result.status, "early_read");
  assert.equal(result.current?.status, "active");
});

test("deleted serials do not pull older evidence into the last five or prove progress", () => {
  const retained = [swing(1, ["posture"]), swing(2, ["posture"]), swing(3, ["posture"]),
    swing(5, []), swing(6, [])];
  assert.equal(advanceFocus(retained, null, [], 6).status, "no_pattern");
  const afterDeletion = advanceFocus([...retained, swing(7, [])], focus(), [], 7);
  assert.equal(afterDeletion.status, "early_read");
  assert.equal(afterDeletion.current?.concept, "posture");
  const latestDeleted = advanceFocus([...retained, swing(7, [])], focus(), [], 8);
  assert.equal(latestDeleted.status, "early_read");
  assert.equal(latestDeleted.history.length, 0);
});

test("disputed evidence cannot claim improvement or a fix", () => {
  const game = [swing(1, ["posture"]), swing(2, ["posture"]), swing(3, ["posture"]),
    swing(4, [], { findings: [finding("posture", { hidden: true })] }), swing(5, []), swing(6, [])];
  assert.equal(advanceFocus(game, focus(), [], 6).status, "early_read");
  assert.equal(advanceFocus([...game, swing(7, [])], focus(), [], 7).status, "early_read");
  const fourClean = advanceFocus([...game, swing(7, []), swing(8, [])], focus(), [], 8);
  assert.equal(fourClean.status, "looks_fixed");
});
