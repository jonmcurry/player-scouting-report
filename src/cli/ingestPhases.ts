#!/usr/bin/env node
/**
 * Loads one clip's scripts/pose3d/metrics.py output (pose_2d.json's meta +
 * metrics.json's `phases`) and upserts it into Supabase's video_clips/
 * swing_phases tables - the integration point between the pose3d pipeline's
 * new phase-detection output and this Node/Supabase layer, same "Python side
 * never talks to Supabase directly, this command is what actually loads it"
 * shape as ingest.ts.
 *
 * Which game_log_entries row a physical clip file belongs to is a human
 * judgment call, not something metrics.json knows or this command infers -
 * the report itself documents "filename order may not match the true
 * in-game sequence" (see reports/latham-lady-bison-white-10u/emily_c.html's
 * own pitch-column text). --date/--opponent/--ab is the same natural key
 * migrate.ts already uses to identify a game_log_entries row.
 *
 * No reviewed-by/overwrite-protection gate (unlike checklistUpsert.ts) -
 * swing_phases is pure automated output, re-running this always overwrites
 * with the latest detection.
 *
 * Usage:
 *   npm run ingest-phases -- --team latham-lady-bison-white-10u --player emily_c \
 *     --date 2026-07-25 --opponent "EG Xpress Hurricanes" --ab 1 \
 *     --clipDir "frames/emily_c/Emily_C_AB1 (4)"
 */
import { Command } from "commander";
import fs from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { findPlayerId } from "../services/db/checklistUpsert.js";
import {
  findGameLogEntryId,
  findOrCreateVideoClip,
  loadPhaseTypeSlugToId,
  upsertSwingPhase,
  upsertVideoClipMetrics,
} from "../services/db/videoClipUpsert.js";

const PHASE_SLUGS = ["stance", "load", "stride", "contact", "extension", "follow_through"] as const;

interface RawPhaseEntry {
  frame: number | null;
  time_s: number | null;
  method: string | null;
  confidence: "high" | "low" | null;
  detail?: Record<string, unknown>;
  [extra: string]: unknown;
}

/** metrics.json's "contact" block predates the "phases" key and stores its
 * evidence numbers as flat sibling fields rather than a nested "detail"
 * object (see metrics.py's own result["contact"] construction), while the 5
 * new phase detectors all nest theirs under an explicit "detail" key -
 * normalize both shapes to the same {frame, time_s, method, confidence,
 * detail} this command writes to Supabase, rather than teaching swing_phases
 * about two different row shapes. Destructuring "detail" out explicitly
 * (not just leaving it in `...rest`) is what avoids double-nesting it for
 * the 5 phases that already have one - confirmed as a real bug by directly
 * reading back the first real ingested row, not assumed correct. */
function normalizePhase(raw: RawPhaseEntry): {
  frame: number | null;
  timeS: number | null;
  method: string | null;
  confidence: "high" | "low" | null;
  detail: Record<string, unknown>;
} {
  const { frame, time_s, method, confidence, detail, ...rest } = raw;
  return { frame, timeS: time_s, method, confidence, detail: detail ?? rest };
}

export async function ingestPhases(
  teamSlug: string,
  playerSlug: string,
  date: string,
  opponent: string | null,
  ab: number,
  clipDir: string,
): Promise<void> {
  if (!fs.existsSync(clipDir)) {
    throw new Error(`Clip dir not found: ${clipDir}`);
  }
  const pose2d = JSON.parse(fs.readFileSync(path.join(clipDir, "pose_2d.json"), "utf-8"));
  const metrics = JSON.parse(fs.readFileSync(path.join(clipDir, "metrics.json"), "utf-8"));

  if (!metrics.phases) {
    // metrics.py itself already writes a specific, honest reason to
    // metrics.error whenever it can't compute phases (bad footage quality,
    // no swing found, etc. - see metrics.py's and detect_2d.py's own
    // LowQualityFootageError) - surface that directly rather than the
    // generic message below, which was written assuming a missing "phases"
    // key could only mean a stale pre-migration file. That's no longer the
    // common case; a real, specific reason is almost always already sitting
    // right here.
    if (metrics.error) {
      throw new Error(metrics.error);
    }
    throw new Error(
      `${clipDir}/metrics.json has no "phases" key - was this generated before the phase ` +
        `detectors were added? Re-run: python scripts/pose3d/metrics.py "${clipDir}"`,
    );
  }

  const playerId = await findPlayerId(teamSlug, playerSlug);
  const gameLogEntryId = await findGameLogEntryId(playerId, date, opponent, ab);
  const phaseTypeIds = await loadPhaseTypeSlugToId();

  const clipSlug = path.basename(clipDir);
  const videoClipId = await findOrCreateVideoClip(gameLogEntryId, {
    clipSlug,
    fps: pose2d.meta.fps,
    nFrames: pose2d.meta.n_frames,
    position: 0,
  });

  let written = 0;
  for (const slug of PHASE_SLUGS) {
    // metrics.json's own key is "follow_through" (Python identifier
    // convention); the DB's swing_phase_types slug is "follow-through"
    // (matches the hyphenated convention every other slug in this project
    // uses, e.g. "hip-shoulder-sep", "stance-setup").
    const dbSlug = slug === "follow_through" ? "follow-through" : slug;
    const raw = metrics.phases[slug] as RawPhaseEntry | undefined;
    if (!raw) {
      console.warn(`No "${slug}" key in ${clipDir}/metrics.json's phases - skipping`);
      continue;
    }
    const phaseTypeId = phaseTypeIds.get(dbSlug);
    if (!phaseTypeId) {
      throw new Error(`No swing_phase_types row for slug "${dbSlug}" - was migration 00004 applied?`);
    }
    const normalized = normalizePhase(raw);
    await upsertSwingPhase({ videoClipId, phaseTypeId, ...normalized });
    written++;
  }

  // Surfaces metrics.json's summary fields (bat speed, attack angle, etc.)
  // and the new movement_flags - previously computed but never ingested
  // anywhere (see videoClipUpsert.ts's upsertVideoClipMetrics for the full
  // field mapping). Rides along here rather than a separate CLI command,
  // since this function already has metrics loaded and videoClipId resolved.
  await upsertVideoClipMetrics({ videoClipId, metrics });

  console.log(
    `Ingested ${written} phase(s) for ${playerSlug}'s clip "${clipSlug}" ` +
      `(${date}${opponent ? ` vs ${opponent}` : " practice session"}, AB ${ab}).`,
  );
}

async function main() {
  const program = new Command();
  program
    .requiredOption("--team <slug>", "Team slug")
    .requiredOption("--player <slug>", "Player slug")
    .requiredOption("--date <date>", "Game date (YYYY-MM-DD), matches an existing game_log_entries row")
    .requiredOption("--opponent <name>", "Opponent, matches an existing game_log_entries row")
    .requiredOption("--ab <number>", "At-bat number, matches an existing game_log_entries row")
    .requiredOption("--clipDir <path>", 'Path to the pose3d output dir, e.g. "frames/emily_c/Emily_C_AB1 (4)"');
  program.parse(process.argv);
  const opts = program.opts<{
    team: string;
    player: string;
    date: string;
    opponent: string;
    ab: string;
    clipDir: string;
  }>();

  try {
    await ingestPhases(opts.team, opts.player, opts.date, opts.opponent, Number(opts.ab), opts.clipDir);
  } catch (err) {
    console.error(err instanceof Error ? err.message : err);
    process.exit(1);
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main();
}
