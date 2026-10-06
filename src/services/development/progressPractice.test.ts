import { strict as assert } from "node:assert";
import { test } from "node:test";
import { practiceEvidence } from "./progressPractice.js";

const valid = (id: string, clip: string) => ({ id, video_clip_id: clip, summary: "Balanced finish.",
  strengths: [{ text: "Balanced", evidence: "Visible at contact", phase: "contact" }] });
const issue = (clip: string, run: string, overrides = {}) => ({ video_clip_id: clip, analysis_run_id: run,
  concept: "balance", basis: "video", review_status: "draft", context_explains_it: false,
  emergency_swing_suspected: false, issue: "Balance changes", evidence: "Visible at load",
  coaching_cue: "Stay centered", look_for_next: "Balanced finish", ...overrides });

test("practice counts the latest four readable clips and only current, visible evidence", () => {
  const clips = ["c6", "c5", "c4", "c3", "c2", "c1"];
  const runs = [valid("r6", "c6"), valid("r5", "c5"), valid("r4", "c4"),
    valid("r3", "c3"), valid("r2", "c2"), valid("r1", "c1")];
  const issues = [issue("c6", "r6"), issue("c5", "r5", { review_status: "hidden" }),
    issue("c4", "r4", { basis: "context" }), issue("c3", "r3"), issue("c2", "r2")];
  assert.deepEqual(practiceEvidence(clips, runs, issues, "balance"), { seen: 2, total: 4 });
});

test("invalid latest run cannot fall back to an older run or stale issue", () => {
  const invalid = { ...valid("new", "clip"), strengths: [{ text: "", evidence: "frame", phase: "contact" }] };
  assert.deepEqual(practiceEvidence(["clip"], [invalid, valid("old", "clip")], [issue("clip", "old")], "balance"),
    { seen: 0, total: 0 });
  assert.deepEqual(practiceEvidence(["clip"], [valid("new", "clip"), valid("old", "clip")], [issue("clip", "old")], "balance"),
    { seen: 0, total: 1 });
  assert.deepEqual(practiceEvidence(["clip"], [{ ...valid("new", "clip"), summary: null }, valid("old", "clip")],
    [issue("clip", "old")], "balance"), { seen: 0, total: 0 });
});

test("practice does not count a current run with missing finding evidence", () => {
  const runs = [valid("new", "clip")];
  assert.deepEqual(practiceEvidence(["clip"], runs, [issue("clip", "new", { evidence: " " })], "balance"),
    { seen: 0, total: 0 });
});
