/**
 * Queue-state helpers for the browser-upload-triggered processing worker
 * (src/cli/processUploadQueue.ts) - a separate concern from
 * videoClipUpsert.ts's phase-ingestion helpers (that file writes phase
 * DATA once a clip is processed; this one only manages the pending ->
 * processing -> ready/failed lifecycle around that).
 */
import { getSupabaseClient } from "./supabaseClient.js";

// A clip stuck in 'processing' past this long is assumed to belong to a
// crashed/killed worker, not a slow-but-alive one, and becomes reclaimable -
// closing the "stuck forever, no automatic recovery" gap this file's
// claimNextPendingClip() used to explicitly defer. Configurable since real
// processing time depends on clip length and the machine's GPU/CPU - the
// default is a generous upper bound, not a measured typical duration.
const STALE_CLAIM_MINUTES = Number(process.env.UPLOAD_QUEUE_STALE_CLAIM_MINUTES ?? 15);

export interface ClipContext {
  videoClipId: string;
  clipSlug: string;
  rawGcsPath: string;
  teamSlug: string;
  playerSlug: string;
  date: string;
  opponent: string;
  ab: number;
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
  const claimableFilter = `status.eq.pending,and(status.eq.processing,claimed_at.lt.${staleCutoff})`;

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
    .update({ status: "processing", claimed_at: new Date().toISOString() })
    .eq("id", candidateId)
    .or(claimableFilter) // the actual race guard - only succeeds if still claimable
    .select("id, clip_slug, raw_gcs_path")
    .maybeSingle();
  if (claimErr) throw new Error(`Claiming clip ${candidateId}: ${claimErr.message}`);
  if (!claimed) return null; // another run claimed it first

  return findClipContext(claimed.id as string, claimed.clip_slug as string, claimed.raw_gcs_path as string);
}

async function findClipContext(
  videoClipId: string,
  clipSlug: string,
  rawGcsPath: string,
): Promise<ClipContext> {
  const supabase = getSupabaseClient();
  const { data, error } = await supabase
    .from("video_clips")
    .select(
      "game_log_entries!inner(date, opponent, ab, players!inner(slug, teams!inner(slug)))",
    )
    .eq("id", videoClipId)
    .single();
  if (error || !data) {
    throw new Error(`Loading clip context for ${videoClipId}: ${error?.message ?? "not found"}`);
  }
  const entry = data.game_log_entries as unknown as {
    date: string;
    opponent: string;
    ab: number;
    players: { slug: string; teams: { slug: string } };
  };
  return {
    videoClipId,
    clipSlug,
    rawGcsPath,
    teamSlug: entry.players.teams.slug,
    playerSlug: entry.players.slug,
    date: entry.date,
    opponent: entry.opponent,
    ab: entry.ab,
  };
}

export async function markClipReady(videoClipId: string): Promise<void> {
  const supabase = getSupabaseClient();
  const { error } = await supabase
    .from("video_clips")
    .update({ status: "ready", error_message: null })
    .eq("id", videoClipId);
  if (error) throw new Error(`Marking clip ${videoClipId} ready: ${error.message}`);
}

export async function markClipFailed(videoClipId: string, message: string): Promise<void> {
  const supabase = getSupabaseClient();
  // Cap length - stderr from a failed pose3d run can be a full Python
  // traceback; the UI only needs enough to be useful, not the whole dump.
  const truncated = message.length > 2000 ? `${message.slice(0, 2000)}\n...(truncated)` : message;
  const { error } = await supabase
    .from("video_clips")
    .update({ status: "failed", error_message: truncated })
    .eq("id", videoClipId);
  if (error) throw new Error(`Marking clip ${videoClipId} failed: ${error.message}`);
}
