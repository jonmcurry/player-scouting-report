import test from "node:test";
import assert from "node:assert/strict";
import { selectDrills, type CuratedDrill } from "./drillSelection.js";

const drill = (id: string, extra: Partial<CuratedDrill> = {}): CuratedDrill => ({
  id, name: id, targetTags: ["front-side-stability"], bestFor: "Front side opens early",
  isActive: true, minAge: 8, sport: "both", homeFriendly: true, equipment: id,
  phase: "stride", requiresScreen: false, weightedOrOverspeed: false, ...extra,
});
const context = { concept: "front_side_stability", phase: "stride", sport: "softball" as const, age: 12 };

test("drills fail closed on unknown sport or uncurated content and cap at three", () => {
  assert.deepEqual(selectDrills([drill("a")], { ...context, sport: null }), []);
  assert.deepEqual(selectDrills([drill("a", { bestFor: " " })], context), []);
  assert.equal(selectDrills(["a", "b", "c", "d"].map((id) => drill(id)), context).length, 3);
});

test("age, sport, equipment safety and screen needs exclude unsafe drills", () => {
  const rows = [drill("safe"), drill("older", { minAge: 13 }), drill("weighted", { weightedOrOverspeed: true }), drill("baseball", { sport: "baseball" }), drill("screen", { requiresScreen: true })];
  assert.deepEqual(selectDrills(rows, { ...context, age: null }).map((d) => d.id), ["safe"]);
});

test("previous drill leads and equipment variety precedes duplicate setups", () => {
  const rows = [drill("tee-a", { equipment: "tee" }), drill("tee-b", { equipment: "tee" }), drill("no-ball", { equipment: "none" }), drill("toss", { equipment: "toss" })];
  assert.deepEqual(selectDrills(rows, { ...context, previousDrillId: "tee-b" }).map((d) => d.id), ["tee-b", "no-ball", "toss"]);
});
