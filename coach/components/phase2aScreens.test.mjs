import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  developmentFocusModel, existingSessionForDate, practicePrimaryAction,
  practiceProgression, practiceStartDefaults, repPrimaryAction, transferModel,
} from "./phase2aScreens.js";

const coach = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const read = (file) => fs.readFileSync(path.join(coach, file), "utf8");

test("Development next focus includes the active drill without changing priority logic", () => {
  const priorities = [{ id: "p1", title: "Front-side stability", status: "active", priority_order: 0 }];
  const model = developmentFocusModel({ priorities, progressById: { p1: { status: "improving" } }, assignments: [{ player_priority_id: "p1", drill_id: "d1", active: true }] });
  assert.equal(model.priority.id, "p1");
  assert.equal(model.assignment.drill_id, "d1");
  assert.equal(developmentFocusModel(), null);
});

test("Game transfer copy only reports coach-authored evidence", () => {
  assert.equal(transferModel([]).label, "Not observed yet");
  const waiting = transferModel([{ context: "practice", observed_at: "2026-09-16T12:00:00Z", status: "improving" }]);
  assert.equal(waiting.label, "Waiting for next game");
  const confirmed = transferModel([
    { context: "practice", observed_at: "2026-09-16T12:00:00Z", status: "improving" },
    { context: "game", observed_at: "2026-09-19T12:00:00Z", status: "unchanged" },
  ]);
  assert.equal(confirmed.label, "Coach confirmed");
  assert.equal(confirmed.status, "unchanged");
});

test("Practice start prepopulates focus, active drill and goal and detects today's session", () => {
  const priorities = [{ id: "p", status: "active", description: "Stay closed through plant" }];
  const assignments = [{ player_priority_id: "p", drill_id: "d", active: true }];
  assert.deepEqual(practiceStartDefaults({ priorities, assignments }), { priorityId: "p", drillId: "d", goal: "Stay closed through plant" });
  assert.equal(existingSessionForDate([{ id: "s", session_date: "2026-09-20" }], "2026-09-20").id, "s");
  assert.equal(existingSessionForDate([], "2026-09-20"), null);
});

test("Baseline, Drill and Post-drill form a deterministic progression", () => {
  assert.equal(practiceProgression([]).current, "baseline");
  assert.equal(practiceProgression([{ grouping: "baseline", usable: true }]).current, "drill");
  const progressed = practiceProgression([{ grouping: "baseline", usable: true }, { grouping: "drill", usable: true }]);
  assert.equal(progressed.current, "post_drill");
  assert.deepEqual(progressed.steps.map((step) => step.label), ["Baseline", "Drill", "Post-drill"]);
});

test("Practice primary action advances without fabricating assessment", () => {
  assert.equal(practicePrimaryAction(), "add_rep");
  assert.equal(practicePrimaryAction({ hasPostDrill: true }), "compare");
  assert.equal(practicePrimaryAction({ hasPostDrill: true, assessing: true }), "finish");
  assert.equal(practicePrimaryAction({ hasPostDrill: true, assessmentSelected: true }), "finish");
  assert.equal(practicePrimaryAction({ assessmentSaved: true }), "next_step");
  assert.equal(repPrimaryAction({ clip: { status: "ready" } }).key, "review");
  assert.equal(repPrimaryAction({ clip: null }).key, "attach");
});

test("Phase 2A pages use guided hierarchy, shared sheets and no native dialogs", () => {
  const development = read("development.html");
  const practice = read("session.html");
  const practicePage = read("components/practicePage.js");
  assert.ok(development.indexOf('id="nextFocus"') < development.indexOf('id="priorities"'));
  assert.match(development, /Observations to review/);
  assert.doesNotMatch(development, /<h2>Game transfer<\/h2>/);
  assert.match(practice, /id="practiceStepper"/);
  assert.match(practicePage, /Compare baseline/);
  assert.doesNotMatch(`${development}\n${practice}\n${practicePage}`, /\b(?:confirm|alert)\s*\(/);
});
