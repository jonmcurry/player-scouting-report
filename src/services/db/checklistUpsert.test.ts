/**
 * Integration test for upsertChecklistScore()'s reviewed-by overwrite
 * protection - the one thing standing between an automated draft (pose3d/
 * Gemini) and silently erasing a coach's confirmed judgment. Deliberately
 * NOT mocked, same rationale as uploadQueue.test.ts.
 *
 * Precondition: local Supabase running with supabase/seed.sql applied.
 * Uses the 'maddie-r' seed fixture specifically because she has zero
 * checklist_scores rows in the seed data (confirmed at write time) - this
 * test can insert/delete its own throwaway row without touching any other
 * fixture's real seeded state.
 */
import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { getSupabaseClient } from "./supabaseClient.js";
import { upsertChecklistScore } from "./checklistUpsert.js";

let playerId: string;
let checkpointId: string;

before(async () => {
  const supabase = getSupabaseClient();
  const { data: player, error: playerErr } = await supabase
    .from("players").select("id").eq("slug", "maddie-r").single();
  if (playerErr || !player) {
    throw new Error(
      `Seed fixture 'maddie-r' not found (${playerErr?.message ?? "no row"}) - ` +
        "has supabase/seed.sql been applied to this local instance?",
    );
  }
  playerId = player.id as string;

  const { data: checkpoint, error: cpErr } = await supabase
    .from("checkpoints").select("id").eq("slug", "stance-setup").single();
  if (cpErr || !checkpoint) {
    throw new Error(`Reference checkpoint 'stance-setup' not found (${cpErr?.message ?? "no row"})`);
  }
  checkpointId = checkpoint.id as string;

  const { data: existing } = await supabase
    .from("checklist_scores").select("id").eq("player_id", playerId).eq("checkpoint_id", checkpointId).maybeSingle();
  if (existing) {
    throw new Error(
      "maddie-r already has a stance-setup checklist_scores row - this test's assumption (a clean " +
        "fixture with no existing rows) no longer holds, refusing to run and risk mutating real state.",
    );
  }
});

after(async () => {
  const supabase = getSupabaseClient();
  const { error } = await supabase
    .from("checklist_scores").delete().eq("player_id", playerId).eq("checkpoint_id", checkpointId);
  if (error) console.error(`Cleanup failed for test checklist_scores row: ${error.message}`);
});

test("upsertChecklistScore: a reviewed row is left untouched without force", async () => {
  const supabase = getSupabaseClient();
  const { error: insertErr } = await supabase.from("checklist_scores").insert({
    player_id: playerId,
    checkpoint_id: checkpointId,
    score: 3,
    ai_draft: 3,
    reviewed_by: "Coach Test",
    notes: "real coach note",
    source: "gemini",
  });
  assert.equal(insertErr, null, insertErr?.message);

  const wrote = await upsertChecklistScore(
    {
      playerId,
      checkpointId,
      checkpointLabel: "Stance & setup",
      score: 1,
      aiDraft: 1,
      notes: "a NEW automated draft that must not overwrite the coach's real review",
      source: "pose3d",
    },
    false,
  );
  assert.equal(wrote, false, "should report skipped, not written");

  const { data: row } = await supabase
    .from("checklist_scores").select("score, reviewed_by, notes").eq("player_id", playerId).eq("checkpoint_id", checkpointId).single();
  assert.equal(row!.score, 3, "score must stay the coach's real value, not the new draft's");
  assert.equal(row!.reviewed_by, "Coach Test", "reviewed_by must be preserved");
  assert.equal(row!.notes, "real coach note", "notes must be preserved");
});

test("upsertChecklistScore: force=true does overwrite a reviewed row", async () => {
  const supabase = getSupabaseClient();
  const wrote = await upsertChecklistScore(
    {
      playerId,
      checkpointId,
      checkpointLabel: "Stance & setup",
      score: 2,
      aiDraft: 2,
      notes: "an intentional force overwrite",
      source: "pose3d",
    },
    true,
  );
  assert.equal(wrote, true, "should report written");

  const { data: row } = await supabase
    .from("checklist_scores").select("score, reviewed_by, notes").eq("player_id", playerId).eq("checkpoint_id", checkpointId).single();
  assert.equal(row!.score, 2);
  assert.equal(row!.reviewed_by, null, "force overwrite resets reviewed_by, matching upsertChecklistScore's own row shape");
  assert.equal(row!.notes, "an intentional force overwrite");
});

// ---------------------------------------------------------------------------
// 00040 review state (review_status): derived for legacy writers, explicit
// for "insufficient evidence" / "reject", enforced by constraints, recorded in
// history, and protected from automated re-drafting.
// ---------------------------------------------------------------------------
async function resetRow() {
  const supabase = getSupabaseClient();
  await supabase.from("checklist_scores").delete().eq("player_id", playerId).eq("checkpoint_id", checkpointId);
}
async function current() {
  const { data, error } = await getSupabaseClient().from("checklist_scores")
    .select("id, score, ai_draft, reviewed_by, review_status, notes, source").eq("player_id", playerId).eq("checkpoint_id", checkpointId).single();
  if (error) throw new Error(error.message);
  return data as { id: string; score: number | null; ai_draft: number | null; reviewed_by: string | null; review_status: string; notes: string; source: string | null };
}

test("review_status is derived: an AI draft is ai_draft, a coach score is verified", async () => {
  await resetRow();
  await upsertChecklistScore({ playerId, checkpointId, checkpointLabel: "Stance", score: 2, aiDraft: 2, notes: "AI note", source: "claude" }, false);
  assert.equal((await current()).review_status, "ai_draft");
  const { error } = await getSupabaseClient().from("checklist_scores").update({ score: 3, reviewed_by: "Coach" }).eq("player_id", playerId).eq("checkpoint_id", checkpointId);
  assert.equal(error, null);
  assert.equal((await current()).review_status, "verified");
});

test("mark insufficient evidence: no score, AI draft + note + source kept, history records the transition", async () => {
  await resetRow();
  const supabase = getSupabaseClient();
  await upsertChecklistScore({ playerId, checkpointId, checkpointLabel: "Stance", score: 3, aiDraft: 3, notes: "AI note", source: "claude" }, false);
  const { error } = await supabase.from("checklist_scores").update({ score: null, reviewed_by: "Coach", review_status: "insufficient_evidence" })
    .eq("player_id", playerId).eq("checkpoint_id", checkpointId);
  assert.equal(error, null);
  const row = await current();
  assert.deepEqual([row.review_status, row.score, row.ai_draft, row.notes, row.source], ["insufficient_evidence", null, 3, "AI note", "claude"]);
  const { data: hist } = await supabase.from("checklist_score_history").select("score, review_status, changed_by").eq("checklist_score_id", row.id).order("changed_at");
  assert.deepEqual(hist!.at(-1), { score: null, review_status: "insufficient_evidence", changed_by: "Coach" });
});

test("an automated re-draft never overwrites an insufficient/rejected review", async () => {
  await resetRow();
  const supabase = getSupabaseClient();
  await upsertChecklistScore({ playerId, checkpointId, checkpointLabel: "Stance", score: 2, aiDraft: 2, notes: "AI", source: "claude" }, false);
  await supabase.from("checklist_scores").update({ score: null, reviewed_by: "Coach", review_status: "rejected" }).eq("player_id", playerId).eq("checkpoint_id", checkpointId);
  const wrote = await upsertChecklistScore({ playerId, checkpointId, checkpointLabel: "Stance", score: 3, aiDraft: 3, notes: "new AI", source: "claude" }, false);
  assert.equal(wrote, false);
  assert.equal((await current()).review_status, "rejected");
});

test("inconsistent review states are refused by the database", async () => {
  await resetRow();
  const supabase = getSupabaseClient();
  await upsertChecklistScore({ playerId, checkpointId, checkpointLabel: "Stance", score: 2, aiDraft: 2, notes: "AI", source: "claude" }, false);
  const noState = await supabase.from("checklist_scores").update({ score: null, reviewed_by: "Coach" }).eq("player_id", playerId).eq("checkpoint_id", checkpointId);
  assert.ok(noState.error, "a reviewed checkpoint with no score must be insufficient_evidence or rejected");
  // (On an unreviewed row the trigger always derives ai_draft, so an invalid
  // status can only be attempted on a reviewed, score-less row.)
  const badState = await supabase.from("checklist_scores").update({ score: null, reviewed_by: "Coach", review_status: "superseded" }).eq("player_id", playerId).eq("checkpoint_id", checkpointId);
  assert.ok(badState.error, "superseded is not a checklist review state");
  const rejectedWithScore = await supabase.from("checklist_scores").update({ reviewed_by: "Coach", score: 2, review_status: "rejected" }).eq("player_id", playerId).eq("checkpoint_id", checkpointId);
  assert.equal(rejectedWithScore.error, null);
  assert.equal((await current()).review_status, "verified", "a coach-set score is a verification; a rejected row carries no score");
});
