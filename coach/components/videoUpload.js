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
 * @param {{ asGuardian?: boolean, clipSlug?: string, uploadedGcsPath?: string|null,
 *   onUploaded?: (details: {clipSlug:string,gcsPath:string}) => Promise<void>|void }} [options]
 * @returns {Promise<string>} created clip id
 */
export async function uploadRawClip(gameLogEntryId, file, link = {}, { asGuardian = false, clipSlug: savedSlug, uploadedGcsPath = null, onUploaded } = {}) {
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
  const rawExt = dotIndex > 0 ? file.name.slice(dotIndex) : ".mp4";
  const ext = `.${sanitizeForSlug(rawExt.slice(1)).replace(/[_-]/g, "").slice(0, 10) || "mp4"}`;
  // Must stay byte-identical everywhere it's used downstream (GCS object
  // name -> inserted row -> the worker's local frames/<player>/<clipSlug>/
  // output dir -> ingestPhases's upsert key) - see the approved plan's
  // note on why this can't be recomputed independently at each step.
  // Object keys and worker directory names contain opaque ids, never a file
  // name, player name, or team name.
  const clipSlug = savedSlug ?? crypto.randomUUID();
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(clipSlug)) throw new Error("Invalid clip ID");
  const contentType = file.type || "video/mp4";
  let gcsPath = uploadedGcsPath;
  if (!gcsPath) {
    const { data: fnResult, error: fnError } = await supabase.functions.invoke("get-upload-url", {
      body: { gameLogEntryId, clipSlug, ext, contentType },
    });
    if (fnError || (!fnResult?.uploadUrl && !fnResult?.alreadyUploaded)) {
      let detail = null;
      try { detail = (await fnError?.context?.json?.())?.error ?? null; } catch { /* no body */ }
      throw new Error(`Couldn't get an upload destination: ${detail ?? fnError?.message ?? "no URL returned"}`);
    }
    if (!fnResult.alreadyUploaded) {
      const uploadResp = await fetch(fnResult.uploadUrl, {
        method: fnResult.method,
        headers: { ...(fnResult.headers ?? {}), "Content-Type": fnResult.contentType },
        body: file,
      });
      if (!uploadResp.ok) throw new Error(`Upload failed (HTTP ${uploadResp.status}) - nothing was recorded, try again.`);
    }
    gcsPath = fnResult.gcsPath;
    if (onUploaded) await onUploaded({ clipSlug, gcsPath });
  }

  // Only reached once the bytes actually landed.
  if (asGuardian) {
    // Guardians have no table access: the RPC validates the opaque entry path,
    // applies the per-guardian rate limit, and
    // inserts the same pending row (position-by-count, uploaded_by_role).
    const { data: clipId, error: rpcError } = await supabase.rpc("guardian_register_clip", {
      p_entry_id: gameLogEntryId,
      p_clip_slug: clipSlug,
      p_raw_gcs_path: gcsPath,
    });
    if (rpcError || !clipId) {
      throw new Error(`Video uploaded, but couldn't record it: ${rpcError?.message ?? "no clip id returned"}`);
    }
    return clipId;
  }

  // Coach path - matches wireAddAtBat()'s own position-by-count pattern for
  // game_log_entries.
  const { data: existingClip, error: existingError } = await supabase.from("video_clips")
    .select("id, raw_gcs_path").eq("game_log_entry_id", gameLogEntryId).eq("clip_slug", clipSlug).maybeSingle();
  if (existingError) throw new Error(`Couldn't check this upload: ${existingError.message}`);
  if (existingClip) {
    if (existingClip.raw_gcs_path !== gcsPath) throw new Error("Existing clip has a different storage path");
    return existingClip.id;
  }
  const { count } = await supabase
    .from("video_clips")
    .select("id", { count: "exact", head: true })
    .eq("game_log_entry_id", gameLogEntryId);

  const { data: created, error: insertError } = await supabase.from("video_clips").insert({
    game_log_entry_id: gameLogEntryId,
    clip_slug: clipSlug,
    raw_gcs_path: gcsPath,
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
