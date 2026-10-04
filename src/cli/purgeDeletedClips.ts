/**
 * Worker purge step for deleted clips (Task 2b). The delete-clip Edge
 * Function removes the database rows and the raw GCS object, and queues a
 * public.clip_deletions row (supabase/migrations/00043_clip_deletion.sql).
 * The worker's own derived files - frames/<player>/<clipSlug>/ (the outDir
 * processUploadQueue.ts builds: phase stills, batter zooms,
 * analysis_result_*.json, pose/metrics JSON, overlay) - live only on the
 * worker machine, so this step removes them and stamps local_purged_at.
 *
 * Only FINISHED deletions are purged: gcs_deleted_at is stamped in the same
 * transaction that deletes the video_clips row (finish_clip_deletion), so a
 * deletion that failed part-way (clip row still there, retry pending) keeps
 * its local files.
 *
 * Idempotent: only rows with local_purged_at null are touched, a missing
 * directory still counts as purged, and a re-run finds nothing to do.
 *
 * Retry of stuck deletions (retryUnfinishedDeletions): a delete-clip call that
 * failed after begin_clip_deletion (storage step or finish step) leaves a
 * clip_deletions row with gcs_deleted_at null and the clip row in place. The
 * parent/coach can retry from the app, but nothing guarantees they will (e.g.
 * a parent who unlinked and kept their videos). Rows older than 15 minutes
 * are finished here with the service role: delete the raw object recorded in
 * the audit row (already-absent counts as deleted; the path must still be this
 * bucket's verified legacy or opaque raw path - begin_clip_deletion verified it
 * when the row was written), then finish_clip_deletion() - the same SQL
 * function the Edge Function calls. Both steps are idempotent, so a retry
 * racing a user's own retry is harmless. begin_clip_deletion is NOT re-run: it
 * already committed (the audit row only exists if it did) and it re-checks the
 * requester's access, which a parent who has since unlinked no longer has.
 */
import fs from "node:fs";
import path from "node:path";
import type { SupabaseClient } from "@supabase/supabase-js";

export interface PendingPurge { clip_id: string; player_slug: string; clip_slug: string; gcs_deleted_at: string | null }

/** The two clip_deletions queries the purge needs (a fake in tests). */
export interface PurgeDb {
  pendingPurges(): Promise<PendingPurge[]>;
  markPurged(clipId: string): Promise<void>;
}

export function supabasePurgeDb(client: SupabaseClient): PurgeDb {
  return {
    async pendingPurges() {
      const { data, error } = await client
        .from("clip_deletions")
        .select("clip_id, player_slug, clip_slug, gcs_deleted_at")
        .is("local_purged_at", null)
        .not("gcs_deleted_at", "is", null)
        .order("requested_at");
      if (error) throw new Error(`Reading clip deletions: ${error.message}`);
      return (data ?? []) as PendingPurge[];
    },
    async markPurged(clipId: string) {
      const { error } = await client
        .from("clip_deletions")
        .update({ local_purged_at: new Date().toISOString() })
        .eq("clip_id", clipId)
        .is("local_purged_at", null);
      if (error) throw new Error(`Stamping clip deletion ${clipId}: ${error.message}`);
    },
  };
}

/** A single path segment that can't escape frames/<player>/ (slugs come from the database). */
function safeSegment(s: string): boolean {
  return typeof s === "string" && s.length > 0 && s !== "." && s !== ".." && !/[\\/\0]/.test(s) && !path.isAbsolute(s);
}

/** frames/<player>/<clipSlug>/ for a deletion, or null when the slugs aren't a safe path. */
export function clipFramesDir(framesRoot: string, playerSlug: string, clipSlug: string): string | null {
  if (!safeSegment(playerSlug) || !safeSegment(clipSlug)) return null;
  const root = path.resolve(framesRoot);
  const dir = path.resolve(root, playerSlug, clipSlug);
  return path.dirname(path.dirname(dir)) === root ? dir : null;
}

/** Removes local derived files for every not-yet-purged deletion. Returns how many were purged. */
export async function purgeDeletedClips(db: PurgeDb, framesRoot: string): Promise<number> {
  let purged = 0;
  for (const row of await db.pendingPurges()) {
    if (!row.gcs_deleted_at) continue; // deletion not finished - the clip still exists
    const dir = clipFramesDir(framesRoot, row.player_slug, row.clip_slug);
    if (!dir) {
      console.error(
        `[purge-deleted-clips] Clip ${row.clip_id}: unsafe frames path segments ` +
          `(${JSON.stringify(row.player_slug)}/${JSON.stringify(row.clip_slug)}) - left for a human, not stamped.`,
      );
      continue;
    }
    fs.rmSync(dir, { recursive: true, force: true });
    await db.markPurged(row.clip_id);
    purged++;
  }
  return purged;
}

// ---------------------------------------------------------------------------
// Retry of deletions that failed part-way (see the header).
// ---------------------------------------------------------------------------

/** How long a started deletion may sit unfinished before the worker finishes it. */
export const UNFINISHED_RETRY_AFTER_MS = 15 * 60 * 1000;

export interface UnfinishedDeletion {
  clip_id: string;
  player_slug: string;
  clip_slug: string | null;
  game_log_entry_id: string | null;
  raw_gcs_path: string | null;
}

/** The two queries the retry needs (a fake in tests). */
export interface RetryDb {
  /** clip_deletions rows with gcs_deleted_at null requested before `before`. */
  staleUnfinished(before: Date): Promise<UnfinishedDeletion[]>;
  /** public.finish_clip_deletion(clipId): stamps gcs_deleted_at and deletes the video_clips row. */
  finishDeletion(clipId: string): Promise<void>;
}

export function supabaseRetryDb(client: SupabaseClient): RetryDb {
  return {
    async staleUnfinished(before: Date) {
      const { data, error } = await client
        .from("clip_deletions")
        .select("clip_id, player_slug, clip_slug, game_log_entry_id, raw_gcs_path")
        .is("gcs_deleted_at", null)
        .lt("requested_at", before.toISOString())
        .order("requested_at");
      if (error) throw new Error(`Reading unfinished clip deletions: ${error.message}`);
      return (data ?? []) as UnfinishedDeletion[];
    },
    async finishDeletion(clipId: string) {
      const { error } = await client.rpc("finish_clip_deletion", { p_clip_id: clipId });
      if (error) throw new Error(`finish_clip_deletion ${clipId}: ${error.message}`);
    },
  };
}

/** True when gcsPath is gs://<bucket>/<team>/<playerSlug>/raw/<file> (one segment each, no traversal). */
export function isOwnRawObject(gcsPath: string, bucket: string, playerSlug: string): boolean {
  if (!bucket || !safeSegment(playerSlug)) return false;
  const prefix = `gs://${bucket}/`;
  if (!gcsPath.startsWith(prefix)) return false;
  const parts = gcsPath.slice(prefix.length).split("/");
  return parts.length === 4 && safeSegment(parts[0]!) && parts[1] === playerSlug && parts[2] === "raw" && safeSegment(parts[3]!);
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
function isDeletionRawObject(row: UnfinishedDeletion, bucket: string): boolean {
  if (!row.raw_gcs_path) return true;
  if (isOwnRawObject(row.raw_gcs_path, bucket, row.player_slug)) return true;
  if (!bucket || !row.game_log_entry_id || !UUID.test(row.game_log_entry_id)) return false;
  for (const id of [row.clip_slug, row.clip_id]) {
    if (!id || !UUID.test(id)) continue;
    const prefix = `gs://${bucket}/${row.game_log_entry_id}/raw/${id}.`;
    if (row.raw_gcs_path.startsWith(prefix) && /^[A-Za-z0-9]{1,10}$/.test(row.raw_gcs_path.slice(prefix.length))) return true;
  }
  return false;
}

/**
 * Finishes deletions stuck for longer than UNFINISHED_RETRY_AFTER_MS. `deleteRawObject` must treat an
 * already-absent object as deleted. Returns how many were finished; a failure on one row is logged
 * and left for the next loop (never stops the others).
 */
export async function retryUnfinishedDeletions(
  db: RetryDb,
  deleteRawObject: (gcsPath: string) => Promise<void>,
  bucket: string,
  now: Date = new Date(),
): Promise<number> {
  let finished = 0;
  for (const row of await db.staleUnfinished(new Date(now.getTime() - UNFINISHED_RETRY_AFTER_MS))) {
    try {
      if (row.raw_gcs_path) {
        if (!isDeletionRawObject(row, bucket)) {
          console.error(
            `[purge-deleted-clips] Clip ${row.clip_id}: stuck deletion's stored path ${JSON.stringify(row.raw_gcs_path)} ` +
              `isn't this clip's verified raw object in the configured bucket - left for a human.`,
          );
          continue;
        }
        await deleteRawObject(row.raw_gcs_path);
      }
      await db.finishDeletion(row.clip_id);
      finished++;
    } catch (err) {
      console.error(
        `[purge-deleted-clips] Clip ${row.clip_id}: retrying the unfinished deletion failed (next loop retries):`,
        err instanceof Error ? err.message : err,
      );
    }
  }
  return finished;
}
