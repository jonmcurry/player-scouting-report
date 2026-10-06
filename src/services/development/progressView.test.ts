import test from "node:test";
import assert from "node:assert/strict";
import { advanceFocus, type FocusRecord, type ReadableSwing } from "./focus.js";
import { storedProgress } from "./progressView.js";

const finding = (serial: number) => ({ id: `finding-${serial}`, concept: "balance", phase: "load", basis: "video",
  confidence: "low", contextExplainsIt: false, emergencySwingSuspected: false, hidden: false });
const swing = (serial: number, seen: boolean): ReadableSwing => ({ id: `clip-${serial}`, serial,
  date: "2026-10-05", sessionType: "game", readable: true, findings: seen ? [finding(serial)] : [] });
const focus = (status: FocusRecord["status"] = "active"): FocusRecord => ({ concept: "balance", status,
  startedAt: "2026-10-01", endedAt: null, qualifiedAtSerial: 3, dismissedAtSerial: null, dismissedBy: null });

test("a qualifying computed focus is withheld until it is stored", () => {
  const swings = [swing(1, true), swing(2, true), swing(3, true)];
  const view = storedProgress(null, [], advanceFocus(swings, null, [], 3), swings, 3);
  assert.equal(view.current, null);
  assert.equal(view.status, "checking");
});

test("a stored focus supplies the displayed status only when recent evidence agrees", () => {
  const swings = [swing(1, true), swing(2, true), swing(3, true), swing(4, false), swing(5, false), swing(6, false)];
  const computed = advanceFocus(swings, focus(), [], 6);
  assert.equal(computed.status, "improving");
  assert.equal(storedProgress(focus(), [], computed, swings, 6).status, "checking");
  const view = storedProgress(focus("improving"), [], computed, swings, 6);
  assert.equal(view.current?.concept, "balance");
  assert.equal(view.status, "improving");
  assert.equal(view.seen, 2);
});

test("deleted evidence withholds an improving claim from a stored focus", () => {
  const swings = [swing(4, true), swing(6, false), swing(7, false)];
  const computed = advanceFocus(swings, focus("improving"), [], 7);
  assert.equal(computed.status, "early_read");
  assert.equal(storedProgress(focus("improving"), [], computed, swings, 7).status, "early_read");
});

test("a stored fixed focus shows Looks fixed only while four intact clean swings prove it", () => {
  const fixed = { ...focus("fixed"), endedAt: "2026-10-05" };
  const clean = [swing(4, false), swing(5, false), swing(6, false), swing(7, false)];
  const view = storedProgress(null, [fixed], advanceFocus(clean, null, [fixed], 7), clean, 7);
  assert.equal(view.status, "looks_fixed");
  const recurred = [...clean.slice(1), swing(8, true)];
  assert.equal(storedProgress(null, [fixed], advanceFocus(recurred, null, [fixed], 8), recurred, 8).status, "no_pattern");
});
