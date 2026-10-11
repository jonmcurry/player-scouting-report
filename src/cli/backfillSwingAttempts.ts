#!/usr/bin/env node
/** Idempotent legacy backfill. Dry-run unless --apply is explicitly passed. */
import { Command } from "commander";
import { getSupabaseClient } from "../services/db/supabaseClient.js";

async function main() {
  const program = new Command();
  program.option("--apply", "write canonical attempts and legacy phase snapshots")
    .option("--limit <count>", "maximum eligible clips to inspect", "1000000");
  program.parse(process.argv);
  const options = program.opts<{ apply?: boolean; limit: string }>();
  const limit = Number(options.limit);
  if (!Number.isSafeInteger(limit) || limit < 1) throw new Error("--limit must be a positive integer");
  const db = getSupabaseClient();
  let cursor: string | null = null;
  let examined = 0, resolved = 0;
  while (examined < limit) {
    let query = db.from("video_clips").select("id").eq("status", "ready")
      .eq("swing_detection_state", "readable").order("id").limit(Math.min(200, limit - examined));
    if (cursor) query = query.gt("id", cursor);
    const { data, error } = await query;
    if (error) throw new Error(`Backfill clip list: ${error.message}`);
    if (!data?.length) break;
    for (const clip of data) {
      cursor = clip.id;
      examined++;
      if (!options.apply) continue;
      const { data: attemptId, error: snapshotError } = await db.rpc("record_legacy_attempt_snapshot", {
        p_clip_id: clip.id, p_source_revision: "legacy-backfill-v1", p_events: null,
      });
      if (snapshotError) throw new Error(`Backfill ${clip.id}: ${snapshotError.message}`);
      if (attemptId) resolved++;
    }
  }
  console.log(`${options.apply ? "Applied" : "Dry run"}: ${examined} readable clip(s) examined; ${resolved} canonical attempt(s) resolved.`);
}

main().catch((error) => { console.error(error instanceof Error ? error.message : error); process.exitCode = 1; });
