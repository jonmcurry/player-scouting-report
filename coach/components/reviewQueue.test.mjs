import test from "node:test";
import assert from "node:assert/strict";
import { buildReviewQueue, distinctPendingSwingCount, findingSequence, queueRemaining } from "./reviewQueue.js";

const issue = (id, clipId, status, player, date, extra = {}) => ({
  id, video_clip_id: clipId, review_status: status, created_at: `${date}T12:00:00Z`,
  video_clip: clipId ? { id: clipId, status: "ready", game_log_entries: { date, ab: extra.ab ?? 1, session_type: extra.session_type ?? "game", players: player }, at_bat_pitches: extra.pitch ? { pitch_number: extra.pitch } : null, practice_repetitions: extra.rep ? { rep_number: extra.rep, grouping: extra.grouping } : null } : null,
});

test("review queue counts distinct ready swings, groups by oldest player and classifies partial/reviewed", () => {
  const ada = { id: "a", name: "Ada" }; const bea = { id: "b", name: "Bea" };
  const model = buildReviewQueue([
    issue("1", "late", "draft", ada, "2026-09-20", { pitch: 2 }),
    issue("2", "late", "approved", ada, "2026-09-20", { pitch: 2 }),
    issue("3", "early", "draft", bea, "2026-09-18", { pitch: 1 }),
    issue("4", "done", "edited", ada, "2026-09-17", { pitch: 1 }),
    issue("5", null, "draft", ada, "2026-09-01"),
  ]);
  assert.equal(model.pendingSwingCount, 2);
  assert.equal(model.playerCount, 2);
  assert.equal(model.groups[0].player.name, "Bea");
  assert.equal(model.pending.find((row) => row.clipId === "late").partial, true);
  assert.deepEqual(model.reviewed.map((row) => row.clipId), ["done"]);
  assert.equal(model.orphanDraftCount, 1);
  assert.equal(distinctPendingSwingCount([issue("1", "same", "draft", ada, "2026-09-20"), issue("2", "same", "draft", ada, "2026-09-20")]), 1);
});

test("skips affect next only and one finding is actionable", () => {
  const p = { id: "p", name: "Player" };
  const model = buildReviewQueue([issue("1", "a", "draft", p, "2026-09-18"), issue("2", "b", "draft", p, "2026-09-19")], { skippedClipIds: ["a"] });
  assert.equal(model.next.clipId, "b");
  assert.equal(model.pending.length, 2);
  assert.equal(queueRemaining(model, "a"), 1);
  const sequence = findingSequence([{ id: "x", review_status: "approved" }, { id: "y", review_status: "draft" }, { id: "z", review_status: "draft" }]);
  assert.deepEqual(sequence.map((row) => row.actionable), [false, true, false]);
});

test("queue items carry fromFamily when a guardian uploaded the clip", () => {
  const p = { id: "p", name: "Player" };
  const fam = issue("1", "fam", "draft", p, "2026-09-18");
  fam.video_clip.uploaded_by_role = "guardian";
  const coach = issue("2", "coach", "draft", p, "2026-09-19");
  coach.video_clip.uploaded_by_role = "coach";
  const legacy = issue("3", "legacy", "approved", p, "2026-09-17");
  const model = buildReviewQueue([fam, coach, legacy]);
  assert.equal(model.pending.find((row) => row.clipId === "fam").fromFamily, true);
  assert.equal(model.pending.find((row) => row.clipId === "coach").fromFamily, false);
  assert.equal(model.reviewed.find((row) => row.clipId === "legacy").fromFamily, false, "missing role is not a family upload");
});
