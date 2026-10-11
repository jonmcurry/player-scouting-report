import test from "node:test";
import assert from "node:assert/strict";
import { loadCandidateDrills } from "./drillCandidateParser.js";
import { selectDrills } from "./drillSelection.js";

test("loads and validates all 90 watch-verified candidate drills", () => {
  const drills = loadCandidateDrills();
  assert.equal(drills.length, 90, "exactly 90 candidate drills are parsed");

  const safetyFlagged = drills.filter((d) => d.requiresScreen);
  assert.equal(safetyFlagged.length, 21, "exactly 21 safety-flagged drills require a screen");

  const ageFlagged = drills.filter((d) => d.weightedOrOverspeed);
  assert.equal(ageFlagged.length, 7, "exactly 7 age-flagged drills are marked weighted or overspeed");

  for (const d of ageFlagged) {
    assert.equal(d.minAge, 13, `drill ${d.id} has minAge 13`);
  }

  for (const d of drills) {
    assert.ok(d.id.startsWith("D"), `drill ${d.id} has valid ID`);
    assert.ok(d.slug.length > 3, `drill ${d.id} has valid slug: ${d.slug}`);
    assert.ok(d.name.length > 0, `drill ${d.id} has valid name`);
    assert.ok(d.concept.length > 0, `drill ${d.id} has concept`);
    assert.ok(d.targetTags.length > 0, `drill ${d.id} has targetTags`);
    assert.ok(d.bestFor.length > 0, `drill ${d.id} has bestFor`);
    assert.ok(d.instructions.length > 0, `drill ${d.id} has instructions`);
    assert.ok(d.cue.length > 0, `drill ${d.id} has cue`);
    assert.ok(d.looksRightWhen.length > 0, `drill ${d.id} has looksRightWhen`);
    assert.ok(d.sourceCredit.length > 0, `drill ${d.id} has sourceCredit`);
    assert.ok(/^https:\/\/(www\.)?youtube\.com\/watch\?v=[a-zA-Z0-9_-]+/.test(d.demoUrl), `drill ${d.id} has valid YouTube URL: ${d.demoUrl}`);
    assert.equal(d.curationStatus, "approved", `drill ${d.id} has curationStatus approved`);
    assert.ok(["softball", "baseball", "both"].includes(d.sport), `drill ${d.id} has valid sport: ${d.sport}`);
  }
});

test("selectDrills integrates with parsed drills and respects safety filters", () => {
  const drills = loadCandidateDrills();
  const adapted = drills.map((d) => ({
    ...d,
    isActive: true,
    phase: null,
  }));

  // Context for under-13 softball player at home (no screen)
  const homeYouthContext = {
    concept: "load",
    phase: null,
    sport: "softball" as const,
    age: 10,
  };

  const selected = selectDrills(adapted, homeYouthContext);
  assert.ok(selected.length > 0, "selects drills for load");
  assert.ok(selected.length <= 3, "caps selection at 3");

  for (const s of selected) {
    assert.equal(s.requiresScreen, false, "screen-requiring drills excluded for home youth");
    assert.equal(s.weightedOrOverspeed, false, "weighted/overspeed drills excluded for under 13");
  }
});
