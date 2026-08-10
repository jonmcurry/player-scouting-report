/**
 * Integration tests for claimNextPendingClip()'s race guard and stale-claim
 * recovery - the queue-claim logic src/cli/processUploadQueue.ts's worker
 * loop depends on to never double-process a clip. Deliberately NOT mocked:
 * this project's own standard (see auto-memory) is that DB-interaction code
 * gets verified against a real database, not a mock that can't reproduce
 * real Postgres row-lock serialization.
 *
 * Precondition: local Supabase running (`npx supabase start`), with
 * supabase/seed.sql applied (provides the 'thunder-10u'/'ava-t' fixture
 * this test reuses) - same .env/getSupabaseClient() setup every CLI script
 * in this repo already relies on. Without it, these tests fail loudly with
 * a clear connection/lookup error rather than silently skipping - a
 * misconfigured environment should never look like a passing test run.
 *
 * Assumes no OTHER 'pending' or 'processing' video_clips rows exist in the
 * local DB at test time (true for a normal local dev setup with no upload
 * worker mid-flight) - each test inserts its own throwaway row and cleans
 * up in `after`.
 */
import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { getSupabaseClient } from "./supabaseClient.js";
import { claimNextPendingClip } from "./uploadQueue.js";

let gameLogEntryId: string;
const insertedClipIds: string[] = [];

before(async () => {
  const supabase = getSupabaseClient();
  const { data: player, error: playerErr } = await supabase
    .from("players").select("id").eq("slug", "ava-t").single();
  if (playerErr || !player) {
    throw new Error(
      `Seed fixture 'ava-t' not found (${playerErr?.message ?? "no row"}) - ` +
        "has supabase/seed.sql been applied to this local instance?",
    );
  }
  const { data: entries, error: entriesErr } = await supabase
    .from("game_log_entries").select("id").eq("player_id", player.id).limit(1);
  if (entriesErr || !entries || entries.length === 0) {
    throw new Error(`No game_log_entries for seed fixture 'ava-t' (${entriesErr?.message ?? "none found"})`);
  }
  gameLogEntryId = entries[0]!.id as string;
});

after(async () => {
  if (insertedClipIds.length === 0) return;
  const supabase = getSupabaseClient();
  const { error } = await supabase.from("video_clips").delete().in("id", insertedClipIds);
  if (error) console.error(`Cleanup failed for test video_clips rows: ${error.message}`);
});

test("claimNextPendingClip: only one of two concurrent callers claims the same pending row", async () => {
  const supabase = getSupabaseClient();
  const { data: clip, error } = await supabase
    .from("video_clips")
    .insert({
      game_log_entry_id: gameLogEntryId,
      clip_slug: `test-race-${Date.now()}`,
      status: "pending",
      raw_gcs_path: "gs://test-bucket/fake.mp4",
    })
    .select("id")
    .single();
  assert.equal(error, null, error?.message);
  insertedClipIds.push(clip!.id as string);

  const [a, b] = await Promise.all([claimNextPendingClip(), claimNextPendingClip()]);
  const winners = [a, b].filter((r) => r?.videoClipId === clip!.id);
  assert.equal(winners.length, 1, "exactly one of two concurrent claims should win the race for the same row");
});

test("claimNextPendingClip: a stale 'processing' clip becomes reclaimable", async () => {
  const supabase = getSupabaseClient();
  const staleClaimedAt = new Date(Date.now() - 20 * 60_000).toISOString(); // older than the default 15min stale window
  const { data: clip, error } = await supabase
    .from("video_clips")
    .insert({
      game_log_entry_id: gameLogEntryId,
      clip_slug: `test-stale-${Date.now()}`,
      status: "processing",
      claimed_at: staleClaimedAt,
      raw_gcs_path: "gs://test-bucket/fake.mp4",
    })
    .select("id")
    .single();
  assert.equal(error, null, error?.message);
  insertedClipIds.push(clip!.id as string);

  const claimed = await claimNextPendingClip();
  assert.equal(claimed?.videoClipId, clip!.id, "the stale processing clip should have been reclaimed");
});
