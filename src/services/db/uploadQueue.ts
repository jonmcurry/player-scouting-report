/**
 * Queue-state helpers for the browser-upload-triggered processing worker
 * (src/cli/processUploadQueue.ts) - a separate concern from
 * videoClipUpsert.ts's phase-ingestion helpers (that file writes phase
 * DATA once a clip is processed; this one only manages the pending ->
 * processing -> ready/failed lifecycle around that).
 */
import { getSupabaseClient } from "./supabaseClient.js";
import type { SwingDetectionState } from "../development/swingDetection.js";
import { heartbeatUpdate } from "../engine/claimHeartbeat.js";

// A clip stuck in 'processing' past this long is assumed to belong to a
// crashed/killed worker, not a slow-but-alive one, and becomes reclaimable -
// closing the "stuck forever, no automatic recovery" gap this file's
// claimNextPendingClip() used to explicitly defer. Configurable since real
// processing time depends on clip length and the machine's GPU/CPU - the
// default is a generous upper bound, not a measured typical duration.
const STALE_CLAIM_MINUTES = Number(process.env.UPLOAD_QUEUE_STALE_CLAIM_MINUTES ?? 15);

// A real, confirmed gap this closes: a failed clip used to require a human
// to notice and tap "Retry" (coach/player.html) - a transient failure (a
// momentary GCS blip, a flaky download) had no automatic recovery at all.
// markClipFailed below re-queues under this cap instead of going straight
// to 'failed'; once exhausted it falls back to exactly today's behavior.
// Backoff (indexed by the retry attempt about to be made, 0-based) - a
// short list, not a real exponential formula, since there are only 3 steps.
const MAX_AUTO_RETRIES = 3;
const RETRY_BACKOFF_MINUTES = [2, 10, 30];

export interface ClipContext {
  claimedAt: string;
  videoClipId: string;
  playerId: string;
  clipSlug: string;
  rawGcsPath: string;
  teamSlug: string;
  playerSlug: string;
  date: string;
  opponent: string | null;
  ab: number;
  pitch: string | null;
  result: string | null;
}

/**
 * Atomically claims the oldest pending clip - OR a clip stuck in
 * 'processing' past STALE_CLAIM_MINUTES (a crashed/killed worker never got
 * to call markClipReady/markClipFailed to move it out of that state).
 * `update ... where id = X and (status = 'pending' or (status = 'processing'
 * and claimed_at < staleCutoff))` only succeeds (returns a row) for
 * whichever caller gets there first - the exact same condition is checked
 * at both select and update time, so this is safe to call from multiple
 * concurrent worker processes (real Postgres row-lock serialization, not
 * just "unlikely to collide") without needing a separate lock table, AND
 * safe against re-claiming a clip a still-alive worker is legitimately
 * still processing. Returns null when there's nothing to do.
 */
export async function claimNextPendingClip(): Promise<ClipContext | null> {
  const supabase = getSupabaseClient();
  const staleCutoff = new Date(Date.now() - STALE_CLAIM_MINUTES * 60_000).toISOString();
  const nowIso = new Date().toISOString();
  // A 'pending' clip is only actually claimable once its retry backoff (if
  // any - see markClipFailed/next_retry_at) has elapsed, so an auto-retried
  // clip isn't immediately re-claimed by the very next poll tick.
  const claimableFilter =
    `and(status.eq.pending,or(next_retry_at.is.null,next_retry_at.lte.${nowIso})),` +
    `and(status.eq.processing,claimed_at.lt.${staleCutoff})`;

  const { data: candidates, error: findErr } = await supabase
    .from("video_clips")
    .select("id")
    .or(claimableFilter)
    .order("created_at", { ascending: true })
    .limit(1);
  if (findErr) throw new Error(`Finding claimable clips: ${findErr.message}`);
  if (!candidates || candidates.length === 0) return null;

  const candidateId = candidates[0]!.id as string;
  const { data: claimed, error: claimErr } = await supabase
    .from("video_clips")
    .update({ status: "processing", claimed_at: new Date().toISOString(), processing_progress: 5 })
    .eq("id", candidateId)
    .or(claimableFilter) // the actual race guard - only succeeds if still claimable
    .select("id, clip_slug, raw_gcs_path, claimed_at")
    .maybeSingle();
  if (claimErr) throw new Error(`Claiming clip ${candidateId}: ${claimErr.message}`);
  if (!claimed) return null; // another run claimed it first

  return findClipContext(claimed.id as string, claimed.clip_slug as string, claimed.raw_gcs_path as string, claimed.claimed_at as string);
}

export async function heartbeatClaim(videoClipId: string, expectedClaimedAt: string): Promise<string | null> {
  const { values, where } = heartbeatUpdate(videoClipId, expectedClaimedAt, new Date().toISOString());
  const { data, error } = await getSupabaseClient().from("video_clips").update(values)
    .eq("id", where.id).eq("status", where.status).eq("claimed_at", where.claimed_at)
    .select("claimed_at").maybeSingle();
  if (error) throw new Error(`Claim heartbeat failed: ${error.message}`);
  return data?.claimed_at ?? null;
}

/** Records completed work, never an elapsed-time estimate or a regression. */
export async function markClipProgress(videoClipId: string, progress: number): Promise<void> {
  if (!Number.isInteger(progress) || progress < 1 || progress > 99) {
    throw new Error(`Invalid processing progress ${progress}; expected an integer from 1 to 99`);
  }
  const supabase = getSupabaseClient();
  const { error } = await supabase.from("video_clips")
    .update({ processing_progress: progress })
    .eq("id", videoClipId)
    .eq("status", "processing")
    .lt("processing_progress", progress);
  if (error) throw new Error(`Updating clip ${videoClipId} progress: ${error.message}`);
}

async function findClipContext(
  videoClipId: string,
  clipSlug: string,
  rawGcsPath: string,
  claimedAt: string,
): Promise<ClipContext> {
  const supabase = getSupabaseClient();
  const { data, error } = await supabase
    .from("video_clips")
    .select(
      "game_log_entries!inner(date, opponent, ab, pitch, result, players!inner(id, slug, teams!inner(slug)))",
    )
    .eq("id", videoClipId)
    .single();
  if (error || !data) {
    throw new Error(`Loading clip context for ${videoClipId}: ${error?.message ?? "not found"}`);
  }
  const entry = data.game_log_entries as unknown as {
    date: string;
    opponent: string | null;
    ab: number;
    pitch: string | null;
    result: string | null;
    players: { id: string; slug: string; teams: { slug: string } };
  };
  return {
    claimedAt,
    videoClipId,
    playerId: entry.players.id,
    clipSlug,
    rawGcsPath,
    teamSlug: entry.players.teams.slug,
    playerSlug: entry.players.slug,
    date: entry.date,
    opponent: entry.opponent,
    ab: entry.ab,
    pitch: entry.pitch,
    result: entry.result,
  };
}

/** With analysisPending the clip is ready (its video result is kept) but holds at
 * 99% with a fresh claimed_at until markClipAnalysisFinished, so the app keeps
 * showing it as processing instead of an unreadable result with no summary yet. */
export async function markClipReady(
  videoClipId: string,
  swingDetectionState: SwingDetectionState,
  { analysisPending = false }: { analysisPending?: boolean } = {},
): Promise<void> {
  const supabase = getSupabaseClient();
  const { error } = await supabase
    .from("video_clips")
    .update({ status: "ready", processing_progress: analysisPending ? 99 : 100,
      ...(analysisPending ? { claimed_at: new Date().toISOString() } : {}),
      swing_detection_state: swingDetectionState, error_message: null, retry_count: 0, next_retry_at: null })
    .eq("id", videoClipId);
  if (error) throw new Error(`Marking clip ${videoClipId} ready: ${error.message}`);
}

/** Ends the post-ready AI diagnosis hold, whether diagnosis succeeded, failed, or was skipped. */
export async function markClipAnalysisFinished(videoClipId: string): Promise<void> {
  const supabase = getSupabaseClient();
  const { error } = await supabase.from("video_clips")
    .update({ processing_progress: 100 })
    .eq("id", videoClipId)
    .eq("status", "ready");
  if (error) throw new Error(`Finishing clip ${videoClipId} analysis: ${error.message}`);
}

/** A deterministic input-policy failure must not consume automatic retries. */
export async function markClipPermanentlyFailed(videoClipId: string, message: string): Promise<void> {
  const supabase = getSupabaseClient();
  const truncated = message.length > 2000 ? `${message.slice(0, 2000)}\n...(truncated)` : message;
  const { error } = await supabase.from("video_clips").update({
    status: "failed", error_message: truncated, next_retry_at: null,
  }).eq("id", videoClipId);
  if (error) throw new Error(`Permanently failing clip ${videoClipId}: ${error.message}`);
}

/** Returns true only when automatic retries are exhausted. */
export async function markClipFailed(videoClipId: string, message: string): Promise<boolean> {
  const supabase = getSupabaseClient();
  // Cap length - stderr from a failed pose3d run can be a full Python
  // traceback; the UI only needs enough to be useful, not the whole dump.
  const truncated = message.length > 2000 ? `${message.slice(0, 2000)}\n...(truncated)` : message;

  const { data: current, error: readErr } = await supabase
    .from("video_clips")
    .select("retry_count")
    .eq("id", videoClipId)
    .single();
  if (readErr) throw new Error(`Reading retry_count for clip ${videoClipId}: ${readErr.message}`);
  const retryCount = current!.retry_count as number;

  const update =
    retryCount < MAX_AUTO_RETRIES
      ? {
          // Auto-retry: back in the pending queue, not terminally failed -
          // the existing manual Retry button (coach/player.html) remains
          // available the whole time too, it just won't be needed yet.
          status: "pending",
          processing_progress: 0,
          error_message: truncated,
          retry_count: retryCount + 1,
          next_retry_at: new Date(Date.now() + RETRY_BACKOFF_MINUTES[retryCount]! * 60_000).toISOString(),
        }
      : {
          // Exhausted - exactly today's pre-existing behavior, human retry only.
          status: "failed",
          error_message: truncated,
        };

  const { error } = await supabase.from("video_clips").update(update).eq("id", videoClipId);
  if (error) throw new Error(`Marking clip ${videoClipId} failed: ${error.message}`);
  return retryCount >= MAX_AUTO_RETRIES;
}
