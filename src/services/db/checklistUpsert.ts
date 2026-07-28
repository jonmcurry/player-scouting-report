/**
 * Shared "write one checklist score, respecting an existing coach review"
 * logic - used by both ingest.ts (pose3d source) and analyze.ts (gemini
 * source) so the reviewed-by protection can't quietly drift between the two
 * automated-draft entry points. An automated draft must never silently erase
 * a coach's confirmed judgment (reviewed_by IS NOT NULL) unless the caller
 * explicitly passes force=true.
 */
import { getSupabaseClient } from "./supabaseClient.js";
import type { DraftSource, Score } from "../../types/scouting.js";

export interface ChecklistUpsertInput {
  playerId: string;
  checkpointId: string;
  checkpointLabel: string; // for log messages only
  score: Score | null;
  aiDraft: Score | null;
  notes: string;
  source: DraftSource;
}

/** Returns true if the row was written, false if skipped (already reviewed, no force). */
export async function upsertChecklistScore(
  input: ChecklistUpsertInput,
  force: boolean,
): Promise<boolean> {
  const supabase = getSupabaseClient();

  const { data: existing, error: exErr } = await supabase
    .from("checklist_scores")
    .select("id, reviewed_by")
    .eq("player_id", input.playerId)
    .eq("checkpoint_id", input.checkpointId)
    .maybeSingle();
  if (exErr) throw new Error(`Checking existing score for "${input.checkpointLabel}": ${exErr.message}`);

  if (existing?.reviewed_by && !force) {
    console.log(
      `Skipping "${input.checkpointLabel}" - already reviewed by ${existing.reviewed_by} (use --force to override)`,
    );
    return false;
  }

  const row = {
    player_id: input.playerId,
    checkpoint_id: input.checkpointId,
    score: input.score,
    ai_draft: input.aiDraft,
    reviewed_by: null,
    notes: input.notes,
    source: input.source,
  };
  const { error: upsertErr } = await supabase
    .from("checklist_scores")
    .upsert(row, { onConflict: "player_id,checkpoint_id" });
  if (upsertErr) throw new Error(`Upserting "${input.checkpointLabel}": ${upsertErr.message}`);
  return true;
}

export async function loadCheckpointLabelToId(): Promise<Map<string, string>> {
  const supabase = getSupabaseClient();
  const { data, error } = await supabase.from("checkpoints").select("id, label, slug");
  if (error) throw new Error(`Loading checkpoints: ${error.message}`);
  return new Map((data ?? []).map((c) => [c.label, c.id as string]));
}

export async function loadCheckpointSlugToId(): Promise<Map<string, string>> {
  const supabase = getSupabaseClient();
  const { data, error } = await supabase.from("checkpoints").select("id, slug");
  if (error) throw new Error(`Loading checkpoints: ${error.message}`);
  return new Map((data ?? []).map((c) => [c.slug as string, c.id as string]));
}

export async function findPlayerId(teamSlug: string, playerSlug: string): Promise<string> {
  const supabase = getSupabaseClient();
  const { data: player, error } = await supabase
    .from("players")
    .select("id, teams!inner(slug)")
    .eq("slug", playerSlug)
    .eq("teams.slug", teamSlug)
    .single();
  if (error || !player) {
    throw new Error(
      `No Supabase player found for team=${teamSlug} slug=${playerSlug} - ` +
        `run migrate.ts for this player first. (${error?.message ?? "not found"})`,
    );
  }
  return player.id as string;
}
