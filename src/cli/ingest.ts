#!/usr/bin/env node
/**
 * Loads the checklist-shaped JSON scripts/pose3d/pose3d_to_checklist.py
 * emits and upserts it into Supabase with source='pose3d'. This is the
 * integration point between the separate Python pose-estimation pipeline and
 * this Node/Supabase layer - the Python side never talks to Supabase
 * directly (no credentials needed there), it just writes a JSON file; this
 * command is what actually loads it.
 *
 * Shape consumed (exact output of pose3d_to_checklist.py, confirmed by
 * running it for real): a plain object keyed by checkpoint LABEL text (not
 * slug - matches how the checklist_scores<->checkpoints join already works
 * in migrate.ts/generate.ts), each value `{ score, aiDraft, reviewedBy,
 * notes, source_clips } | null`. Only checkpoints pose3d actually produced
 * evidence for are present as keys (today: "Extension" and "Hip-shoulder
 * separation") - this is a PARTIAL, additive update, unlike migrate.ts's
 * full-replace semantics, since pose3d never speaks to the other 9
 * checkpoints at all.
 *
 * Reviewed-checkpoint protection (never overwrite a coach's confirmed score
 * without --force) is shared with analyze.ts via
 * src/services/db/checklistUpsert.ts, so the two automated-draft entry
 * points (pose3d, gemini) can't drift on this safety behavior independently.
 *
 * Usage:
 *   npm run ingest -- --team latham-lady-bison-white-10u --player emily_c --pose3dJson out.json
 */
import { Command } from "commander";
import fs from "node:fs";
import { pathToFileURL } from "node:url";
import { findPlayerId, loadCheckpointLabelToId, upsertChecklistScore } from "../services/db/checklistUpsert.js";
import type { Score } from "../types/scouting.js";

interface Pose3dEntry {
  score: Score | null;
  aiDraft: Score | null;
  reviewedBy: string | null;
  notes: string;
  source_clips: string[];
}
type Pose3dChecklistJson = Record<string, Pose3dEntry | null>;

export async function ingestPose3dJson(
  teamSlug: string,
  playerSlug: string,
  jsonPath: string,
  force = false,
): Promise<void> {
  if (!fs.existsSync(jsonPath)) {
    throw new Error(`pose3d JSON not found: ${jsonPath}`);
  }
  const data = JSON.parse(fs.readFileSync(jsonPath, "utf-8")) as Pose3dChecklistJson;

  const playerId = await findPlayerId(teamSlug, playerSlug);
  const labelToId = await loadCheckpointLabelToId();

  let updated = 0;
  let skipped = 0;
  for (const [label, entry] of Object.entries(data)) {
    if (entry === null) continue;
    const checkpointId = labelToId.get(label);
    if (!checkpointId) {
      console.warn(`Skipping "${label}" - no matching checkpoint (known labels: ${[...labelToId.keys()].join(", ")})`);
      continue;
    }

    const wrote = await upsertChecklistScore(
      {
        playerId,
        checkpointId,
        checkpointLabel: label,
        score: entry.score,
        aiDraft: entry.aiDraft,
        notes: entry.notes,
        source: "pose3d",
      },
      force,
    );
    if (wrote) updated++;
    else skipped++;
  }

  console.log(`Ingested pose3d results for ${playerSlug}: ${updated} checkpoint(s) updated, ${skipped} skipped (already reviewed).`);
}

async function main() {
  const program = new Command();
  program
    .requiredOption("--team <slug>", "Team slug")
    .requiredOption("--player <slug>", "Player slug")
    .requiredOption("--pose3dJson <path>", "Path to pose3d_to_checklist.py's JSON output")
    .option("--force", "Overwrite checkpoints a coach has already reviewed", false);
  program.parse(process.argv);
  const opts = program.opts<{ team: string; player: string; pose3dJson: string; force: boolean }>();

  try {
    await ingestPose3dJson(opts.team, opts.player, opts.pose3dJson, opts.force);
  } catch (err) {
    console.error(err instanceof Error ? err.message : err);
    process.exit(1);
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main();
}
