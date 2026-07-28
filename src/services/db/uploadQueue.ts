/**
 * Queue-state helpers for the browser-upload-triggered processing worker
 * (src/cli/processUploadQueue.ts) - a separate concern from
 * videoClipUpsert.ts's phase-ingestion helpers (that file writes phase
 * DATA once a clip is processed; this one only manages the pending ->
 * processing -> ready/failed lifecycle around that).
 */
import { getSupabaseClient } from "./supabaseClient.js";

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
 * Atomically claims the oldest pending clip: `update ... where status =
 * 'pending'` only succeeds (returns a row) for whichever caller gets there
 * first - safe against the worker accidentally being run twice at once,
 * without needing a separate lock table. Returns null when there's nothing
 * to do.
 */
export async function claimNextPendingClip(): Promise<ClipContext | null> {
  const supabase = getSupabaseClient();

  const { data: candidates, error: findErr } = await supabase
    .from("video_clips")
    .select("id")
    .eq("status", "pending")
    .order("created_at", { ascending: true })
    .limit(1);
  if (findErr) throw new Error(`Finding pending clips: ${findErr.message}`);
  if (!candidates || candidates.length === 0) return null;

  const candidateId = candidates[0]!.id as string;
  const { data: claimed, error: claimErr } = await supabase
    .from("video_clips")
    .update({ status: "processing", claimed_at: new Date().toISOString() })
    .eq("id", candidateId)
    .eq("status", "pending") // the actual race guard - only succeeds if still pending
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
