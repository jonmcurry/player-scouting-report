// Browser-side raw video upload for the coach app's new "upload from a
// phone, processing starts automatically" flow. Shared by both the
// "Log New At-Bat" form and the per-game-log-card "Attach Video" control in
// player.html.
//
// Never inserts a video_clips row for an upload that didn't actually land
// (see step ordering below) - a dangling pending row for bytes that never
// arrived would just confuse the worker and the coach.
import { supabase } from "../shared.js";

function sanitizeForSlug(name) {
  return name.replace(/[^A-Za-z0-9_-]/g, "");
}

/**
 * @param {string} gameLogEntryId
 * @param {File} file
 * @returns {Promise<void>}
 */
export async function uploadRawClip(gameLogEntryId, file) {
  const dotIndex = file.name.lastIndexOf(".");
  const stem = dotIndex > 0 ? file.name.slice(0, dotIndex) : file.name;
  const ext = dotIndex > 0 ? file.name.slice(dotIndex) : ".mp4";
  // Must stay byte-identical everywhere it's used downstream (GCS object
  // name -> inserted row -> the worker's local frames/<player>/<clipSlug>/
  // output dir -> ingestPhases's upsert key) - see the approved plan's
  // note on why this can't be recomputed independently at each step.
  const clipSlug = `${sanitizeForSlug(stem)}-${Date.now()}`;
  const contentType = file.type || "video/mp4";

  const { data: fnResult, error: fnError } = await supabase.functions.invoke("get-upload-url", {
    body: { gameLogEntryId, clipSlug, ext, contentType },
  });
  if (fnError || !fnResult?.uploadUrl) {
    throw new Error(`Couldn't get an upload destination: ${fnError?.message ?? "no URL returned"}`);
  }

  const uploadResp = await fetch(fnResult.uploadUrl, {
    method: fnResult.method,
    headers: { "Content-Type": fnResult.contentType },
    body: file,
  });
  if (!uploadResp.ok) {
    throw new Error(`Upload failed (HTTP ${uploadResp.status}) - nothing was recorded, try again.`);
  }

  // Only reached once the bytes actually landed - matches wireAddAtBat()'s
  // own position-by-count pattern for game_log_entries.
  const { count } = await supabase
    .from("video_clips")
    .select("id", { count: "exact", head: true })
    .eq("game_log_entry_id", gameLogEntryId);

  const { error: insertError } = await supabase.from("video_clips").insert({
    game_log_entry_id: gameLogEntryId,
    clip_slug: clipSlug,
    raw_gcs_path: fnResult.gcsPath,
    status: "pending",
    position: count ?? 0,
  });
  if (insertError) {
    throw new Error(`Video uploaded, but couldn't record it: ${insertError.message}`);
  }
}
