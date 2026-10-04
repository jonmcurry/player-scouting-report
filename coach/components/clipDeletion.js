import { supabase } from "../shared.js";
import { isDemoMode } from "../demoConfig.js";

/** The demo clone has no GCS media; real clips must use the audited function. */
export async function deleteClip(clipId) {
  if (isDemoMode()) {
    const { error } = await supabase.from("video_clips").delete().eq("id", clipId);
    if (error) throw new Error(error.message);
    return;
  }
  const { error } = await supabase.functions.invoke("delete-clip", { body: { clipId } });
  if (error) {
    let message = error.message;
    try { message = (await error.context?.json())?.error ?? message; } catch { /* keep original */ }
    throw new Error(message);
  }
}

export async function deleteClipsForEntry(entryId) {
  for (;;) {
    const { data, error } = await supabase.from("video_clips").select("id").eq("game_log_entry_id", entryId).limit(100);
    if (error) throw new Error(error.message);
    if (!data?.length) return;
    for (const clip of data) await deleteClip(clip.id);
  }
}

export async function deleteClipsForPlayer(playerId) {
  let from = 0;
  for (;;) {
    const { data, error } = await supabase.from("game_log_entries").select("id").eq("player_id", playerId).order("id").range(from, from + 199);
    if (error) throw new Error(error.message);
    for (const entry of data ?? []) await deleteClipsForEntry(entry.id);
    if (!data || data.length < 200) return;
    from += data.length;
  }
}
