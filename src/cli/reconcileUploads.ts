#!/usr/bin/env node
/**
 * Finds raw video bytes that landed in GCS but have no matching video_clips
 * row pointing at them - the gap in videoUpload.js's own two-step upload
 * (PUT the bytes, then INSERT the row): if a coach's tab or network drops
 * between those two awaits, the bytes are real and billed for, but nothing
 * in Postgres ever references them, and the processing worker only ever
 * scans video_clips rows, so they'd otherwise sit invisibly forever.
 *
 * Report-only by default - deliberately does not delete anything. Real
 * coach-uploaded video shouldn't be destroyed without a human looking first,
 * and an object that looks orphaned right now could just be mid-flight
 * (uploaded seconds ago, INSERT about to happen) - --delete-older-than-days
 * opts into actual deletion, and only for objects past that age.
 *
 * Usage:
 *   npm run reconcile-uploads
 *   npm run reconcile-uploads -- --delete-older-than-days 7
 */
import { Command } from "commander";
import { deleteObject, listRawUploadObjects } from "../services/storage/gcs.js";
import { getSupabaseClient } from "../services/db/supabaseClient.js";
import { pathToFileURL } from "node:url";

function formatBytes(n: number): string {
  if (n < 1024) return `${n}B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)}KB`;
  return `${(n / (1024 * 1024)).toFixed(1)}MB`;
}

export async function reconcileUploads(deleteOlderThanDays?: number): Promise<void> {
  const [objects, dbRows] = await Promise.all([
    listRawUploadObjects(),
    getSupabaseClient()
      .from("video_clips")
      .select("raw_gcs_path")
      .not("raw_gcs_path", "is", null)
      .then(({ data, error }) => {
        if (error) throw new Error(`Loading video_clips.raw_gcs_path: ${error.message}`);
        return new Set((data ?? []).map((r) => r.raw_gcs_path as string));
      }),
  ]);

  const orphans = objects.filter((obj) => !dbRows.has(obj.gcsPath));
  if (orphans.length === 0) {
    console.log(`No orphaned raw uploads found (${objects.length} raw/ object(s) scanned, all referenced).`);
    return;
  }

  console.log(`${orphans.length} orphaned raw upload(s) found (bytes in GCS, no video_clips row references them):`);
  for (const obj of orphans) {
    console.log(`  ${obj.gcsPath}  ${formatBytes(obj.sizeBytes)}  last updated ${obj.updatedAt}`);
  }

  if (deleteOlderThanDays === undefined) {
    console.log(
      "\nReport-only run - nothing deleted. Re-run with --delete-older-than-days N to actually " +
        "delete orphans older than N days (an object uploaded moments ago may just be mid-flight, " +
        "between its own upload and the row insert that would normally reference it).",
    );
    return;
  }

  const cutoff = Date.now() - deleteOlderThanDays * 24 * 60 * 60 * 1000;
  const toDelete = orphans.filter((obj) => obj.updatedAt && new Date(obj.updatedAt).getTime() < cutoff);
  if (toDelete.length === 0) {
    console.log(`\nNone of the above are older than ${deleteOlderThanDays} day(s) - nothing deleted.`);
    return;
  }
  console.log(`\nDeleting ${toDelete.length} orphan(s) older than ${deleteOlderThanDays} day(s)...`);
  for (const obj of toDelete) {
    await deleteObject(obj.gcsPath);
    console.log(`  deleted ${obj.gcsPath}`);
  }
}

async function main() {
  const program = new Command();
  program.option(
    "--delete-older-than-days <n>",
    "Actually delete orphans older than this many days (default: report only, delete nothing)",
  );
  program.parse(process.argv);
  const opts = program.opts<{ deleteOlderThanDays?: string }>();

  try {
    await reconcileUploads(opts.deleteOlderThanDays !== undefined ? Number(opts.deleteOlderThanDays) : undefined);
  } catch (err) {
    console.error(err instanceof Error ? err.message : err);
    process.exit(1);
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main();
}
