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
import { randomUUID } from "node:crypto";
import { getSupabaseClient } from "./supabaseClient.js";
import { claimNextPendingClip, markClipFailed, markClipPermanentlyFailed, markClipProgress, markClipReady } from "./uploadQueue.js";

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
  const clipSlug = randomUUID();
  const { data: clip, error } = await supabase
    .from("video_clips")
    .insert({
      game_log_entry_id: gameLogEntryId,
      clip_slug: clipSlug,
      status: "pending",
      raw_gcs_path: `gs://test-bucket/${gameLogEntryId}/raw/${clipSlug}.mp4`,
      created_at: "1900-01-01T00:00:00Z",
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
  const clipSlug = randomUUID();
  const staleClaimedAt = new Date(Date.now() - 20 * 60_000).toISOString(); // older than the default 15min stale window
  const { data: clip, error } = await supabase
    .from("video_clips")
    .insert({
      game_log_entry_id: gameLogEntryId,
      clip_slug: clipSlug,
      status: "processing",
      claimed_at: staleClaimedAt,
      raw_gcs_path: `gs://test-bucket/${gameLogEntryId}/raw/${clipSlug}.mp4`,
      created_at: "1900-01-02T00:00:00Z",
    })
    .select("id")
    .single();
  assert.equal(error, null, error?.message);
  insertedClipIds.push(clip!.id as string);

  const claimed = await claimNextPendingClip();
  assert.equal(claimed?.videoClipId, clip!.id, "the stale processing clip should have been reclaimed");
});

test("markClipPermanentlyFailed: deterministic policy failures do not consume a retry", async () => {
  const supabase = getSupabaseClient();
  const clipSlug = randomUUID();
  const { data: clip, error } = await supabase
    .from("video_clips")
    .insert({
      game_log_entry_id: gameLogEntryId,
      clip_slug: clipSlug,
      status: "processing",
      retry_count: 2,
      next_retry_at: new Date(Date.now() + 60_000).toISOString(),
      raw_gcs_path: `gs://test-bucket/${gameLogEntryId}/raw/${clipSlug}.mp4`,
      created_at: "1900-01-03T00:00:00Z",
    })
    .select("id")
    .single();
  assert.equal(error, null, error?.message);
  insertedClipIds.push(clip!.id as string);

  await markClipPermanentlyFailed(clip!.id as string, "This video is longer than the 3-minute upload limit.");

  const { data: failed, error: readError } = await supabase
    .from("video_clips")
    .select("status, error_message, retry_count, next_retry_at")
    .eq("id", clip!.id)
    .single();
  assert.equal(readError, null, readError?.message);
  assert.deepEqual(failed, {
    status: "failed",
    error_message: "This video is longer than the 3-minute upload limit.",
    retry_count: 2,
    next_retry_at: null,
  });
});

test("processing_progress only moves forward while processing, resets on retry, and is 100 when ready", async () => {
  const supabase = getSupabaseClient();
  const clipSlug = randomUUID();
  const { data: clip, error } = await supabase
    .from("video_clips")
    .insert({
      game_log_entry_id: gameLogEntryId,
      clip_slug: clipSlug,
      status: "processing",
      claimed_at: new Date().toISOString(),
      processing_progress: 5,
      raw_gcs_path: `gs://test-bucket/${gameLogEntryId}/raw/${clipSlug}.mp4`,
      created_at: "1900-01-04T00:00:00Z",
    })
    .select("id")
    .single();
  assert.equal(error, null, error?.message);
  const id = clip!.id as string;
  insertedClipIds.push(id);
  const progress = async () => {
    const { data, error: readError } = await supabase.from("video_clips").select("status, processing_progress").eq("id", id).single();
    assert.equal(readError, null, readError?.message);
    return data as { status: string; processing_progress: number };
  };

  await markClipProgress(id, 45);
  await markClipProgress(id, 30); // a late, lower milestone never moves it backwards
  assert.deepEqual(await progress(), { status: "processing", processing_progress: 45 });
  await assert.rejects(markClipProgress(id, 100), /expected an integer from 1 to 99/);

  await markClipFailed(id, "transient test failure");
  assert.deepEqual(await progress(), { status: "pending", processing_progress: 0 });
  await markClipProgress(id, 65); // not processing any more, so nothing changes
  assert.deepEqual(await progress(), { status: "pending", processing_progress: 0 });

  const { error: reclaimError } = await supabase.from("video_clips").update({ status: "processing", processing_progress: 5 }).eq("id", id);
  assert.equal(reclaimError, null, reclaimError?.message);
  await markClipReady(id, "readable");
  assert.deepEqual(await progress(), { status: "ready", processing_progress: 100 });
});
