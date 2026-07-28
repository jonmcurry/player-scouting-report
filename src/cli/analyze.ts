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
 */
import { Command } from "commander";
import fs from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { analyzeSwing, type FrameImage } from "../services/ai/geminiAnalyzer.js";
import { findPlayerId, loadCheckpointSlugToId, upsertChecklistScore } from "../services/db/checklistUpsert.js";
import { getSupabaseClient } from "../services/db/supabaseClient.js";

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
): Promise<void> {
  const frames = loadFrameImages(framesDir);
  console.log(`Sending ${frames.length} frame(s) from ${framesDir} to Gemini...`);
  const result = await analyzeSwing(frames, pitchContext);

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
        source: "gemini",
      },
      force,
    );
    if (wrote) updated++;
    else skipped++;
  }

  if (result.issues.length > 0) {
    const supabase = getSupabaseClient();
    const rows = result.issues.map((i) => ({
      player_id: playerId,
      issue: i.issue,
      seen_in_at_bats: i.seenInAtBats,
      likely_cause: i.likelyCause,
      effect: i.effect,
      reviewed_by: null,
      source: "gemini" as const,
    }));
    const { error } = await supabase.from("issues").insert(rows);
    if (error) throw new Error(`Inserting Gemini-drafted issues: ${error.message}`);
  }

  console.log(
    `Analyzed ${playerSlug}: ${updated} checkpoint(s) updated, ${skipped} skipped (already reviewed), ` +
      `${result.issues.length} issue(s) drafted.`,
  );
}

async function main() {
  const program = new Command();
  program
    .requiredOption("--team <slug>", "Team slug")
    .requiredOption("--player <slug>", "Player slug")
    .requiredOption("--framesDir <path>", "Directory of extracted frame stills (from extract.ts)")
    .requiredOption("--pitchContext <text>", "Pitch location/outcome context for these frames")
    .option("--force", "Overwrite checkpoints a coach has already reviewed", false);
  program.parse(process.argv);
  const opts = program.opts<{
    team: string;
    player: string;
    framesDir: string;
    pitchContext: string;
    force: boolean;
  }>();

  try {
    await analyzeAndSync(opts.team, opts.player, opts.framesDir, opts.pitchContext, opts.force);
  } catch (err) {
    console.error(err instanceof Error ? err.message : err);
    process.exit(1);
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main();
}
