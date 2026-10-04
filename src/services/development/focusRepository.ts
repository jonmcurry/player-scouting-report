import { getSupabaseClient } from "../db/supabaseClient.js";
import { persistPlayerFocus } from "./focusPersistence.js";

/** Called only after a validated analysis run was stored for a readable game swing. */
export async function refreshPlayerFocus(playerId: string, videoClipId: string): Promise<void> {
  const db = getSupabaseClient();
  const { data: serial, error } = await db.rpc("register_readable_game_swing", { p_clip_id: videoClipId });
  if (error) throw new Error(`Registering readable swing: ${error.message}`);
  if (serial === null) return; // practice never changes game focus
  await persistPlayerFocus(db, playerId);
}
