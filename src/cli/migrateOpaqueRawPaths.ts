/**
 * Move existing raw video references to opaque object names before family or
 * share-link playback is enabled. Dry run by default. Copies bytes, verifies
 * the copy, then updates the row only if it still points at the old object.
 * The old object is retained for rollback and a separate reviewed purge.
 */
import "dotenv/config";
import { Storage } from "@google-cloud/storage";
import { getSupabaseClient } from "../services/db/supabaseClient.js";

type ClipRow = {
  id: string;
  clip_slug: string;
  game_log_entry_id: string;
  raw_gcs_path: string | null;
  game_log_entries: { players: { slug: string; teams: { slug: string } } };
};

function destinationFor(row: ClipRow, bucketName: string): { oldObject: string; newObject: string } | null {
  if (!row.raw_gcs_path?.startsWith(`gs://${bucketName}/`)) return null;
  const oldObject = row.raw_gcs_path.slice(`gs://${bucketName}/`.length);
  const player = row.game_log_entries.players;
  const prefix = `${player.teams.slug}/${player.slug}/raw/${row.clip_slug}.`;
  if (!oldObject.startsWith(prefix)) return null;
  const ext = oldObject.slice(prefix.length);
  if (!/^[A-Za-z0-9]{1,10}$/.test(ext)) return null;
  return { oldObject, newObject: `${row.game_log_entry_id}/raw/${row.id}.${ext}` };
}

async function main() {
  const apply = process.argv.includes("--apply");
  const bucketName = process.env.GCS_BUCKET_NAME;
  if (!bucketName) throw new Error("GCS_BUCKET_NAME is required");
  const db = getSupabaseClient();
  const storage = new Storage({
    projectId: process.env.GCP_PROJECT_ID,
    ...(process.env.GCS_EMULATOR_HOST ? { apiEndpoint: process.env.GCS_EMULATOR_HOST } : {}),
  });
  const bucket = storage.bucket(bucketName);
  let scanned = 0;
  let candidates = 0;
  let moved = 0;
  let alreadyOpaque = 0;
  let refused = 0;
  for (let from = 0;; from += 500) {
    const { data, error } = await db.from("video_clips")
      .select("id, clip_slug, game_log_entry_id, raw_gcs_path, game_log_entries!inner(players!inner(slug, teams!inner(slug)))")
      .order("id").range(from, from + 499);
    if (error) throw new Error(error.message);
    const rows = (data ?? []) as unknown as ClipRow[];
    const { data: deleting, error: deletingError } = rows.length
      ? await db.from("clip_deletions").select("clip_id").in("clip_id", rows.map((row) => row.id))
      : { data: [], error: null };
    if (deletingError) throw new Error(`Reading deletion holds: ${deletingError.message}`);
    const deletingIds = new Set((deleting ?? []).map((row) => row.clip_id));
    for (const row of rows) {
      if (!row.raw_gcs_path) continue;
      scanned++;
      if (deletingIds.has(row.id)) continue; // finish the audited delete; never move its object mid-delete
      const opaquePrefix = `gs://${bucketName}/${row.game_log_entry_id}/raw/`;
      const opaqueFile = row.raw_gcs_path.startsWith(opaquePrefix) ? row.raw_gcs_path.slice(opaquePrefix.length) : "";
      if ([row.id, row.clip_slug].some((id) => new RegExp(`^${id}\\.[A-Za-z0-9]{1,10}$`).test(opaqueFile))) {
        alreadyOpaque++;
        continue;
      }
      const path = destinationFor(row, bucketName);
      if (!path) { refused++; continue; }
      candidates++;
      if (!apply) continue;
      const source = bucket.file(path.oldObject);
      const target = bucket.file(path.newObject);
      const [sourceMeta] = await source.getMetadata();
      const [targetExists] = await target.exists();
      if (!targetExists) await source.copy(target, { preconditionOpts: { ifGenerationMatch: 0 } });
      const [targetMeta] = await target.getMetadata();
      const checksumMatches = sourceMeta.crc32c && sourceMeta.crc32c === targetMeta.crc32c;
      if (sourceMeta.size !== targetMeta.size || !checksumMatches) {
        throw new Error(`Copied object for clip ${row.id} did not match its source`);
      }
      const { data: updated, error: updateError } = await db.from("video_clips")
        .update({ raw_gcs_path: `gs://${bucketName}/${path.newObject}` })
        .eq("id", row.id).eq("raw_gcs_path", row.raw_gcs_path).select("id");
      if (updateError || updated?.length !== 1) throw new Error(`Clip ${row.id} changed during migration: ${updateError?.message ?? "stale path"}`);
      moved++;
    }
    if (rows.length < 500) break;
  }
  console.log(JSON.stringify({ mode: apply ? "apply" : "dry-run", scanned, candidates, moved, alreadyOpaque, refused }));
  if (refused) throw new Error(`${refused} raw paths could not be verified; review them before enabling family playback`);
}

main().catch((error) => { console.error(error); process.exitCode = 1; });
