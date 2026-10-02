// Browser-side raw video upload for the coach app's new "upload from a
// phone, processing starts automatically" flow. Shared by both the
// "Log New At-Bat" form and the per-game-log-card "Attach Video" control in
// player.html.
//
// Never inserts a video_clips row for an upload that didn't actually land
// (see step ordering below) - a dangling pending row for bytes that never
// arrived would just confuse the worker and the coach.
import { supabase } from "../shared.js";
import { getDemoConfig } from "../demoConfig.js";

function sanitizeForSlug(name) {
  return name.replace(/[^A-Za-z0-9_-]/g, "");
}

/**
 * @param {string} gameLogEntryId
 * @param {File} file
 * @param {{ pitchId?: string, repId?: string }} [link] attach the clip to a specific pitch / practice rep
 *   (coach uploads only - a guardian clip is linked by the database's default pitch/rep trigger)
 * @param {{ asGuardian?: boolean }} [options] asGuardian: record the clip through the
 *   guardian_register_clip RPC (00042) instead of a direct video_clips insert
 * @returns {Promise<string>} created clip id
 */
export async function uploadRawClip(gameLogEntryId, file, link = {}, { asGuardian = false } = {}) {
  // The one real functional chokepoint for uploads (get-upload-url is the
  // only path that ever produces a writable destination) - centralized
  // capability check here, per the demo architecture's "uploads disabled
  // in demo mode" requirement, rather than only hiding a button in the UI.
  if (!getDemoConfig().capabilities.uploads) {
    throw new Error("Uploads are disabled in this demo. Explore the pre-seeded swings instead.");
  }
  if (asGuardian && (link.pitchId || link.repId)) {
    throw new Error("A guardian upload can't be attached to a specific pitch or rep.");
  }
  const dotIndex = file.name.lastIndexOf(".");
  const stem = dotIndex > 0 ? file.name.slice(0, dotIndex) : file.name;
  const rawExt = dotIndex > 0 ? file.name.slice(dotIndex) : ".mp4";
  // guardian_register_clip only accepts a plain alphanumeric extension; the
  // coach path keeps its original behavior.
  const ext = asGuardian ? `.${sanitizeForSlug(rawExt.slice(1)).replace(/[_-]/g, "").slice(0, 10) || "mp4"}` : rawExt;
  // Must stay byte-identical everywhere it's used downstream (GCS object
  // name -> inserted row -> the worker's local frames/<player>/<clipSlug>/
  // output dir -> ingestPhases's upsert key) - see the approved plan's
  // note on why this can't be recomputed independently at each step.
  const clipSlug = `${asGuardian ? sanitizeForSlug(stem).slice(0, 150) : sanitizeForSlug(stem)}-${Date.now()}`;
  const contentType = file.type || "video/mp4";

  const { data: fnResult, error: fnError } = await supabase.functions.invoke("get-upload-url", {
    body: { gameLogEntryId, clipSlug, ext, contentType },
  });
  if (fnError || !fnResult?.uploadUrl) {
    // The function's own reason (e.g. the guardian daily limit) rides in the response body.
    let detail = null;
    try { detail = (await fnError?.context?.json?.())?.error ?? null; } catch { /* no body */ }
    throw new Error(`Couldn't get an upload destination: ${detail ?? fnError?.message ?? "no URL returned"}`);
  }

  const uploadResp = await fetch(fnResult.uploadUrl, {
    method: fnResult.method,
    // fnResult.headers: signed extension headers the URL requires (guardian create-only precondition).
    headers: { ...(fnResult.headers ?? {}), "Content-Type": fnResult.contentType },
    body: file,
  });
  if (!uploadResp.ok) {
    throw new Error(`Upload failed (HTTP ${uploadResp.status}) - nothing was recorded, try again.`);
  }

  // Only reached once the bytes actually landed.
  if (asGuardian) {
    // Guardians have no table access: the RPC validates the path against
    // the entry's own team/player, applies the per-guardian rate limit, and
    // inserts the same pending row (position-by-count, uploaded_by_role).
    const { data: clipId, error: rpcError } = await supabase.rpc("guardian_register_clip", {
      p_entry_id: gameLogEntryId,
      p_clip_slug: clipSlug,
      p_raw_gcs_path: fnResult.gcsPath,
    });
    if (rpcError || !clipId) {
      throw new Error(`Video uploaded, but couldn't record it: ${rpcError?.message ?? "no clip id returned"}`);
    }
    return clipId;
  }

  // Coach path - matches wireAddAtBat()'s own position-by-count pattern for
  // game_log_entries.
  const { count } = await supabase
    .from("video_clips")
    .select("id", { count: "exact", head: true })
    .eq("game_log_entry_id", gameLogEntryId);

  const { data: created, error: insertError } = await supabase.from("video_clips").insert({
    game_log_entry_id: gameLogEntryId,
    clip_slug: clipSlug,
    raw_gcs_path: fnResult.gcsPath,
    status: "pending",
    position: count ?? 0,
    ...(link.pitchId ? { at_bat_pitch_id: link.pitchId } : {}),
    ...(link.repId ? { practice_repetition_id: link.repId } : {}),
  }).select("id").single();
  if (insertError) {
    throw new Error(`Video uploaded, but couldn't record it: ${insertError.message}`);
  }
  return created.id;
}
