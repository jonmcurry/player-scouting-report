/**
 * Computes analysis_quality for clips ingested before it existed, from their on-disk pipeline output.
 * Usage: npm run backfill-analysis-quality -- <clipDir> [<clipDir> ...]
 * A clip dir's basename is the video_clips.clip_slug. Clips with no metrics row are skipped.
 */
import fs from "node:fs";
import path from "node:path";
import { getSupabaseClient } from "../services/db/supabaseClient.js";
import { computeAnalysisQuality } from "../services/db/analysisQuality.js";

async function main() {
  const dirs = process.argv.slice(2);
  if (!dirs.length) {
    console.error("Usage: backfill-analysis-quality <clipDir> [<clipDir> ...]");
    process.exit(1);
  }
  const supabase = getSupabaseClient();
  for (const dir of dirs) {
    const slug = path.basename(dir);
    const read = (f: string) => (fs.existsSync(path.join(dir, f)) ? JSON.parse(fs.readFileSync(path.join(dir, f), "utf-8")) : null);
    const pose2d = read("pose_2d.json");
    const metrics = read("metrics.json");
    if (!pose2d || !metrics) { console.warn(`${slug}: missing pose_2d.json/metrics.json - skipped`); continue; }
    const { data: clip } = await supabase.from("video_clips").select("id").eq("clip_slug", slug).maybeSingle();
    if (!clip) { console.warn(`${slug}: no video_clips row - skipped`); continue; }
    const quality = computeAnalysisQuality({ pose2d, pose3d: read("pose_3d.json"), metrics });
    const { data, error } = await supabase.from("video_clip_metrics").update({ analysis_quality: quality }).eq("video_clip_id", clip.id).select("video_clip_id");
    if (error) throw new Error(`${slug}: ${error.message}`);
    console.log(data?.length ? `${slug}: analysis_quality written` : `${slug}: no video_clip_metrics row - skipped`);
  }
}
main().catch((e) => { console.error(e); process.exit(1); });
