import test from "node:test";
import assert from "node:assert/strict";
import { inferCounts, swungFromOutcome } from "./developmentLogic.js";
import { insertPitchCollisionSafe, likelyAtBatOver, nextAtBatNumber, pitchCountTitle, pitchMetaParts, pitchPatchForCountOverride, pitchPatchForOutcome } from "./pitchEntry.js";

test("pitch helpers preserve count and likely-at-bat-over rules", () => {
  const pitches = [
    { pitch_number: 1, pitch_outcome: "ball" },
    { pitch_number: 2, pitch_outcome: "called_strike" },
  ];
  assert.equal(pitchCountTitle(3, pitches), "Pitch 3 · 1-1");
  assert.equal(pitchCountTitle(2, [{ pitch_number: 1, pitch_outcome: null }]), "Pitch 2 · count unknown");
  assert.equal(likelyAtBatOver([...Array(4)].map((_, i) => ({ pitch_number: i + 1, pitch_outcome: "ball" }))), true);
  assert.equal(likelyAtBatOver([{ pitch_number: 1, count_before_strikes: 2, count_before_balls: 0, pitch_outcome: "foul" }]), false);
  assert.equal(likelyAtBatOver([{ pitch_number: 1, count_before_strikes: 2, count_before_balls: 0, pitch_outcome: "swinging_strike" }]), true);
});

test("standard outcome save never writes count_before_*; only an explicit override does", () => {
  assert.deepEqual(pitchPatchForOutcome("foul", 3), { pitch_outcome: "foul", swung: true, pitch_zone: 3 });
  assert.deepEqual(pitchPatchForOutcome("ball"), { pitch_outcome: "ball", swung: false });
  for (const o of ["ball", "called_strike", "swinging_strike", "foul", "ball_in_play", "hit_by_pitch"]) {
    const patch = pitchPatchForOutcome(o);
    assert.ok(!("count_before_balls" in patch) && !("count_before_strikes" in patch), o);
    assert.notEqual(patch.pitch_outcome, "take", "new entries never create take rows");
  }
  assert.deepEqual(pitchPatchForCountOverride(2, 1), { count_before_balls: 2, count_before_strikes: 1 });
  assert.deepEqual(pitchPatchForCountOverride(1, 0, { balls: 1, strikes: 0 }), {}, "saving an unchanged count adds no override");
});

test("editing an earlier outcome re-derives downstream counts unless a later pitch has an override", () => {
  const mk = (o1, extra2 = {}) => [{ id: "a", pitch_number: 1, pitch_outcome: o1 }, { id: "b", pitch_number: 2, pitch_outcome: "ball", ...extra2 }, { id: "c", pitch_number: 3, pitch_outcome: null }];
  const label = (rows, i) => `${rows[i].balls}-${rows[i].strikes}`;
  assert.equal(label(inferCounts(mk("ball")), 1), "1-0");
  assert.equal(label(inferCounts(mk("called_strike")), 1), "0-1", "pitch 1 corrected ball -> called strike");
  assert.equal(label(inferCounts(mk("called_strike")), 2), "1-1");
  const anchored = inferCounts(mk("called_strike", { count_before_balls: 2, count_before_strikes: 2 }));
  assert.equal(label(anchored, 1), "2-2", "explicit override still wins");
  assert.equal(label(anchored, 2), "3-2");
});

test("foul at two strikes stays at two strikes; terminal outcomes are recognised", () => {
  const rows = inferCounts([{ id: "1", pitch_number: 1, pitch_outcome: "called_strike" }, { id: "2", pitch_number: 2, pitch_outcome: "swinging_strike" }, { id: "3", pitch_number: 3, pitch_outcome: "foul" }, { id: "4", pitch_number: 4, pitch_outcome: null }]);
  assert.equal(`${rows[3].balls}-${rows[3].strikes}`, "0-2");
  assert.equal(likelyAtBatOver([{ pitch_number: 1, pitch_outcome: "ball_in_play" }]), true);
  assert.equal(likelyAtBatOver([{ pitch_number: 1, pitch_outcome: "hit_by_pitch" }]), true);
  assert.equal(swungFromOutcome("hit_by_pitch"), false);
});

test("legacy take rows stay readable: count becomes unknown, label is not duplicated", () => {
  const rows = inferCounts([{ id: "1", pitch_number: 1, pitch_outcome: "take" }, { id: "2", pitch_number: 2, pitch_outcome: "ball" }]);
  assert.equal(rows[1].balls, null);
  assert.deepEqual(pitchMetaParts("Take", false), ["Take"]);
  assert.deepEqual(pitchMetaParts("Ball", false, "Zone 5"), ["Ball", "Take", "Zone 5"]);
});

test("pitch numbering retries a unique collision and at-bat numbering is scoped", async () => {
  let loads = 0; const tried = [];
  const result = await insertPitchCollisionSafe({
    loadPitches: async () => (++loads === 1 ? [{ pitch_number: 1 }] : [{ pitch_number: 1 }, { pitch_number: 2 }]),
    insertPitch: async (number) => { tried.push(number); if (number === 2) throw Object.assign(new Error("duplicate"), { code: "23505" }); return { pitch_number: number }; },
  });
  assert.deepEqual(tried, [2, 3]);
  assert.equal(result.pitch_number, 3);
  assert.equal(nextAtBatNumber([{ date: "2026-09-21", opponent: "Rivals", ab: 2 }, { date: "2026-09-21", opponent: "Other", ab: 9 }], { date: "2026-09-21", opponent: "rivals" }), 3);
});
