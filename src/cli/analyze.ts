#!/usr/bin/env node
/**
 * Runs Gemini vision analysis over a directory of extracted frame stills
 * (see extract.ts) and writes the results into Supabase - the "Supabase
 * Sync" half of the AI vision pipeline (src/services/ai/geminiAnalyzer.ts
 * is the analysis half).
 *
 * VERIFICATION STATUS: unverified end-to-end (see geminiAnalyzer.ts's own
 * docstring for why - no rotated API key was available while this was
 * built). The Supabase-writing half reuses upsertChecklistScore, the exact
 * same helper ingest.ts uses, which IS fully verified (including its
 * reviewed-by protection) - only the Gemini call itself is unverified.
 *
 * Usage:
 *   npm run analyze -- --team latham-lady-bison-white-10u --player emily_c \
 *     --framesDir frames/emily_c/Emily_C_AB1_1 --pitchContext "Outside, low"
 *
 * --claudeDraft <path> bypasses the Gemini call entirely and loads a
 * pre-written GeminiAnalysisResult-shaped JSON file instead (a coach asking
 * Claude to directly analyze the frame stills itself when no working Gemini
 * key is available - see migration 00024's own note). Writes go through the
 * exact same upsertChecklistScore/issues-insert path as a real Gemini run,
 * just tagged source="claude" instead of "gemini" so the provenance stays
 * honest - never silently attributed to Gemini when Gemini never ran.
 *
 * --claudeCli does the same thing LIVE instead of from a pre-written file -
 * shells out to the locally-installed `claude` CLI (claudeCliAnalyzer.ts),
 * authenticated via the coach's own Claude subscription rather than a
 * separate API key. This is what processUploadQueue.ts's AI_ANALYZER=
 * claude-cli uses for automatic local-testing runs; production stays on
 * the default Gemini path.
 */
import { Command } from "commander";
import fs from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { analyzeSwing, type FrameImage, type GeminiAnalysisResult } from "../services/ai/geminiAnalyzer.js";
import { analyzeSwingViaClaudeCli } from "../services/ai/claudeCliAnalyzer.js";
import { findPlayerId, loadCheckpointSlugToId, upsertChecklistScore } from "../services/db/checklistUpsert.js";
import { getSupabaseClient } from "../services/db/supabaseClient.js";
import type { DraftSource } from "../types/scouting.js";

const IMAGE_EXTENSIONS = new Set([".png", ".jpg", ".jpeg"]);

function loadFrameImages(framesDir: string): FrameImage[] {
  const files = fs
    .readdirSync(framesDir)
    .filter((f) => IMAGE_EXTENSIONS.has(path.extname(f).toLowerCase()))
    .sort();
  if (files.length === 0) {
    throw new Error(`No image files found in ${framesDir} (expected .png/.jpg from extract.ts)`);
  }
  return files.map((f) => {
    const ext = path.extname(f).toLowerCase();
    const mimeType = ext === ".png" ? "image/png" : "image/jpeg";
    return { data: fs.readFileSync(path.join(framesDir, f)), mimeType };
  });
}

export async function analyzeAndSync(
  teamSlug: string,
  playerSlug: string,
  framesDir: string,
  pitchContext: string,
  force = false,
  claudeDraftPath: string | null = null,
  useClaudeCli = false,
  videoClipId: string | null = null,
): Promise<void> {
  let result: Pick<GeminiAnalysisResult, "checklist" | "issues" | "comps" | "compNotes" | "drills">;
  let source: DraftSource;
  if (claudeDraftPath) {
    console.log(`Loading Claude-drafted analysis from ${claudeDraftPath} (Gemini not called)...`);
    const draft = JSON.parse(fs.readFileSync(claudeDraftPath, "utf-8"));
    result = { comps: [], compNotes: [], drills: [], ...draft };
    source = "claude";
  } else if (useClaudeCli) {
    console.log(`Running analysis via the local claude CLI on ${framesDir} (Gemini not called)...`);
    result = await analyzeSwingViaClaudeCli(framesDir, pitchContext);
    source = "claude";
  } else {
    const frames = loadFrameImages(framesDir);
    console.log(`Sending ${frames.length} frame(s) from ${framesDir} to Gemini...`);
    result = await analyzeSwing(frames, pitchContext);
    source = "gemini";
  }

  const playerId = await findPlayerId(teamSlug, playerSlug);
  const slugToId = await loadCheckpointSlugToId();

  let updated = 0;
  let skipped = 0;
  for (const entry of result.checklist) {
    const checkpointId = slugToId.get(entry.checkpointSlug);
    if (!checkpointId) {
      console.warn(`Skipping unknown checkpoint slug "${entry.checkpointSlug}" from Gemini response`);
      continue;
    }
    const wrote = await upsertChecklistScore(
      {
        playerId,
        checkpointId,
        checkpointLabel: entry.checkpointSlug,
        score: entry.score,
        aiDraft: entry.score,
        notes: entry.notes,
        source,
      },
      force,
    );
    if (wrote) updated++;
    else skipped++;
  }

  const supabase = getSupabaseClient();

  // issues has no per-row identity to upsert against (unlike checklist_scores,
  // keyed by checkpoint_id) - re-analyzing the same player with plain INSERT
  // would just pile up a duplicate row per run forever, confirmed as a real
  // bug (two identical rows from re-running this command twice on the same
  // clip while testing). Fixed the same way checklist_scores already
  // protects a coach's confirmed work: only clear UNREVIEWED issues before
  // inserting the fresh batch - a coach-reviewed issue survives every future
  // automated run untouched, matching upsertChecklistScore's own
  // reviewed-by-wins-over-force-refresh rule.
  const { error: delIssuesErr } = await supabase
    .from("issues")
    .delete()
    .eq("player_id", playerId)
    .is("reviewed_by", null)
    .eq("review_status", "draft");
  if (delIssuesErr) throw new Error(`Clearing old unreviewed issues: ${delIssuesErr.message}`);

  // A finding a coach already approved/edited/rejected is a decision, not a
  // draft: never duplicate an approved one and never resurrect a rejected one
  // as a fresh unreviewed draft just because the model saw it again.
  const { data: decided, error: decidedErr } = await supabase
    .from("issues")
    .select("issue")
    .eq("player_id", playerId);
  if (decidedErr) throw new Error(`Reading coach-reviewed issues: ${decidedErr.message}`);
  const norm = (t: string) => t.trim().toLowerCase().replace(/\s+/g, " ");
  const alreadyDecided = new Set((decided ?? []).map((r) => norm(String(r.issue))));
  const freshIssues = result.issues.filter((i) => !alreadyDecided.has(norm(i.issue)));

  if (freshIssues.length > 0) {
    const rows = freshIssues.map((i) => ({
      player_id: playerId,
      issue: i.issue,
      seen_in_at_bats: i.seenInAtBats,
      likely_cause: i.likelyCause,
      effect: i.effect,
      evidence: i.evidence ?? "",
      coaching_cue: i.coachingCue ?? "",
      suggested_drill: i.suggestedDrill ?? null,
      look_for_next: i.lookForNext ?? "",
      confidence: i.confidence ?? null,
      phase: i.phase ?? null,
      video_clip_id: videoClipId,
      suggested_priority_title: i.issue,
      review_status: "draft",
      reviewed_by: null,
      source,
    }));
    const { error } = await supabase.from("issues").insert(rows);
    if (error) throw new Error(`Inserting ${source}-drafted issues: ${error.message}`);
  }

  // comp_recommendations/comp_notes/drill_recommendations have no reviewed_by
  // or source column at all (see 00003_diagnosis_comps_plan.sql) - unlike
  // checklist_scores/issues, there's no "a coach already confirmed this,
  // don't clobber it" concept for these tables today. Full replace (delete
  // this player's rows, insert the fresh set) is the only sane behavior for
  // a re-run: piling up every past run's comps/drills forever with no way to
  // tell which are current would make the report worse, not better.
  const { error: delCompsErr } = await supabase.from("comp_recommendations").delete().eq("player_id", playerId);
  if (delCompsErr) throw new Error(`Clearing old comp_recommendations: ${delCompsErr.message}`);
  if (result.comps.length > 0) {
    const rows = result.comps.map((c, i) => ({ player_id: playerId, comp_name: c.compName, cue: c.cue, position: i }));
    const { error } = await supabase.from("comp_recommendations").insert(rows);
    if (error) throw new Error(`Inserting ${source}-drafted comp_recommendations: ${error.message}`);
  }

  const { error: delNotesErr } = await supabase.from("comp_notes").delete().eq("player_id", playerId);
  if (delNotesErr) throw new Error(`Clearing old comp_notes: ${delNotesErr.message}`);
  if (result.compNotes.length > 0) {
    const rows = result.compNotes.map((note, i) => ({ player_id: playerId, note, position: i }));
    const { error } = await supabase.from("comp_notes").insert(rows);
    if (error) throw new Error(`Inserting ${source}-drafted comp_notes: ${error.message}`);
  }

  const { error: delDrillsErr } = await supabase.from("drill_recommendations").delete().eq("player_id", playerId);
  if (delDrillsErr) throw new Error(`Clearing old drill_recommendations: ${delDrillsErr.message}`);
  if (result.drills.length > 0) {
    const rows = result.drills.map((d, i) => ({ player_id: playerId, title: d.title, description: d.description, position: i }));
    const { error } = await supabase.from("drill_recommendations").insert(rows);
    if (error) throw new Error(`Inserting ${source}-drafted drill_recommendations: ${error.message}`);
  }

  console.log(
    `Analyzed ${playerSlug}: ${updated} checkpoint(s) updated, ${skipped} skipped (already reviewed), ` +
      `${freshIssues.length} new issue draft(s), ${result.comps.length} comp(s), ${result.drills.length} drill(s) drafted.`,
  );
}

async function main() {
  const program = new Command();
  program
    .requiredOption("--team <slug>", "Team slug")
    .requiredOption("--player <slug>", "Player slug")
    .option("--framesDir <path>", "Directory of extracted frame stills (from extract.ts) - required unless --claudeDraft is given")
    .option("--pitchContext <text>", "Pitch location/outcome context for these frames - required unless --claudeDraft is given")
    .option("--force", "Overwrite checkpoints a coach has already reviewed", false)
    .option("--claudeDraft <path>", "Skip the Gemini call and load a pre-written GeminiAnalysisResult-shaped JSON file instead, tagged source=\"claude\"")
    .option("--claudeCli", "Skip the Gemini call and run the analysis live via the local claude CLI instead, tagged source=\"claude\"", false);
  program.parse(process.argv);
  const opts = program.opts<{
    team: string;
    player: string;
    framesDir?: string;
    pitchContext?: string;
    force: boolean;
    claudeDraft?: string;
    claudeCli: boolean;
  }>();

  if (!opts.claudeDraft && !opts.claudeCli && (!opts.framesDir || !opts.pitchContext)) {
    console.error("Either --claudeDraft, --claudeCli, or both --framesDir and --pitchContext, are required");
    process.exit(1);
  }
  if (opts.claudeCli && !opts.framesDir) {
    console.error("--claudeCli still needs --framesDir (it reads real files, just via the CLI instead of Gemini)");
    process.exit(1);
  }

  try {
    await analyzeAndSync(
      opts.team,
      opts.player,
      opts.framesDir ?? "",
      opts.pitchContext ?? "No pitch/result details provided.",
      opts.force,
      opts.claudeDraft ?? null,
      opts.claudeCli,
    );
  } catch (err) {
    console.error(err instanceof Error ? err.message : err);
    process.exit(1);
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main();
}
