import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const coach = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const root = path.resolve(coach, "..");
const read = (rel) => fs.readFileSync(path.resolve(root, rel), "utf8");

test("review queue and queue-mode review enforce one decision at a time", () => {
  const queue = read("coach/queue.html"); const review = read("coach/review.html");
  assert.match(queue, /buildReviewQueue/);
  assert.match(queue, /Start with/);
  assert.match(queue, /loadRosterWithProgress\(team\.id\)/);
  assert.doesNotMatch(queue, /activeTab: "queue", roster: \[\]/);
  assert.match(review, /findingSequence\(issues\)/);
  assert.match(review, /Decide the finding above first/);
  assert.match(review, /Next swing/);
  assert.doesNotMatch(review, /all\.slice\(0, 5\)/);
});

test("pitch capture creates a pitch only after a real file is returned", () => {
  const atbat = read("coach/atbat.html");
  assert.match(read("coach/coach.css"), /\[hidden\]\s*\{\s*display:\s*none\s*!important/);
  const choose = atbat.indexOf("const file = input.files?.[0]");
  const create = atbat.indexOf("const pitch = await createPitch()", choose);
  assert.ok(choose >= 0 && create > choose);
  assert.match(atbat, /if \(file\) onFile\(file\)/);
  assert.match(atbat, /capture = "environment"/);
  assert.match(atbat, /insertPitchCollisionSafe/);
  assert.doesNotMatch(atbat, /Pitch type \(optional\)|id="eLoc"/);
});

test("pitch deletion relies on the existing ON DELETE SET NULL relationship", () => {
  const migration = read("supabase/migrations/00025_player_development_model.sql");
  assert.match(migration, /at_bat_pitch_id uuid references at_bat_pitches \(id\) on delete set null/i);
  assert.match(read("coach/atbat.html"), /video will stay on this at-bat as unassigned evidence/);
});

test("Compare uses suggestions and the Video, Frames, Progress, Metrics hierarchy", () => {
  const compare = read("coach/compare.html");
  assert.match(compare, /suggestedComparePairs/);
  assert.match(compare, />Video<.*>Frames<.*>Progress<.*>Metrics</s);
  assert.doesNotMatch(compare, /id="fSwung"|id="fReviewed"|id="fGrouping"/);
  assert.match(compare, /Explain in 3D/);
  assert.match(compare, /Original video is the source of truth/);
});

test("public report is coach-confirmed, summary-first and has the approved empty strengths copy", () => {
  const report = read("coach/report.html"); const shape = read("supabase/functions/get-player-report/shape.ts");
  assert.match(report, /Current focus/); assert.match(report, /Your drill/); assert.match(report, /What’s going well/);
  assert.match(report, /Strengths will appear here as your coach reviews more swings\./);
  assert.doesNotMatch(report, /reviewedBy|bg-score-|confidence|analysis_quality/);
  assert.match(shape, /confirmedScores/);
  assert.match(shape, /Still developing/);
});

test("new and replaced Phase 2B paths contain no native dialogs", () => {
  const files = ["coach/queue.html","coach/review.html","coach/atbat.html","coach/compare.html","coach/report.html","coach/components/logAtBatSheet.js","coach/components/devActions.js"];
  for (const file of files) assert.doesNotMatch(read(file), /\b(?:confirm|alert)\s*\(/, file);
});
