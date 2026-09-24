import test from "node:test";
import assert from "node:assert/strict";
import { checklistState, isPendingDraft, showsNote, stateLabel, reviewPayload, verifiedHistory } from "./checklistReview.js";

test("review state: explicit status wins; pre-00040 rows derive from reviewed_by + score", () => {
  assert.equal(checklistState({ review_status: "insufficient_evidence", score: null, reviewed_by: "Coach" }), "insufficient_evidence");
  assert.equal(checklistState({ review_status: "rejected", score: null, reviewed_by: "Coach" }), "rejected");
  assert.equal(checklistState({ score: 3, reviewed_by: "Coach" }), "verified");
  assert.equal(checklistState({ score: 2, reviewed_by: null }), "ai_draft");
  assert.equal(checklistState({ score: null, reviewed_by: null }), null);
});

test("only an unreviewed scored draft is pending; insufficient/rejected are not AI Draft - Unconfirmed", () => {
  assert.equal(isPendingDraft({ review_status: "ai_draft", score: 2, reviewed_by: null }), true);
  for (const s of ["verified", "insufficient_evidence", "rejected"]) {
    assert.equal(isPendingDraft({ review_status: s, score: s === "verified" ? 3 : null, reviewed_by: "Coach" }), false, s);
  }
  assert.equal(stateLabel("insufficient_evidence"), "Insufficient evidence");
  assert.equal(stateLabel("rejected"), "Rejected");
  assert.equal(stateLabel("ai_draft"), "AI Draft — Unconfirmed");
});

test("the AI note is not shown as coaching text once a checkpoint is insufficient or rejected", () => {
  assert.equal(showsNote({ review_status: "verified", score: 3, reviewed_by: "Coach" }), true);
  assert.equal(showsNote({ review_status: "ai_draft", score: 2 }), true);
  assert.equal(showsNote({ review_status: "insufficient_evidence", score: null, reviewed_by: "Coach" }), false);
  assert.equal(showsNote({ review_status: "rejected", score: null, reviewed_by: "Coach" }), false);
});

test("mark insufficient / reject: clears only the current score, keeps the AI draft and provenance", () => {
  const row = { playerId: "p", checkpointId: "c", score: 3, ai_draft: 3, notes: "AI note", source: "claude" };
  const ins = reviewPayload(row, "insufficient", "Coach");
  assert.deepEqual(ins, { player_id: "p", checkpoint_id: "c", score: null, ai_draft: 3, notes: "AI note", source: "claude", reviewed_by: "Coach", review_status: "insufficient_evidence" });
  assert.equal(reviewPayload(row, "reject", "Coach").review_status, "rejected");
  assert.throws(() => reviewPayload(row, "approve", "Coach"));
  assert.throws(() => reviewPayload(row, "reject", ""));
});

test("trend history counts coach-verified scores only (an AI draft then a coach score is not progress)", () => {
  const h = [
    { score: 2, changed_by: null, review_status: "ai_draft" },
    { score: 3, changed_by: "Coach", review_status: "verified" },
    { score: null, changed_by: "Coach", review_status: "insufficient_evidence" },
    { score: 2, changed_by: "Coach" }, // pre-00040 coach entry
    { score: 1, changed_by: null }, // pre-00040 AI entry
  ];
  assert.deepEqual(verifiedHistory(h).map((x) => x.score), [3, 2]);
});
