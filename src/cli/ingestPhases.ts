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
 *
 * For an at-bat with multiple clips (e.g. several pitches), pass --position
 * (0-indexed) for each one, no matter which order you run this and
 * ingest-pose3d-frames in - see this file's own findOrCreateVideoClip call
 * for why passing the real value here matters even though ingest-pose3d-
 * frames also takes --position.
 */
import { Command } from "commander";
import fs from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { findPlayerId } from "../services/db/checklistUpsert.js";
import { computeAnalysisQuality } from "../services/db/analysisQuality.js";
import { getSupabaseClient } from "../services/db/supabaseClient.js";
import { assertV2IngestionRoute, v2IngestionPlan } from "../services/engine/v2Ingestion.js";
import { normalizeBox, subjectBoxAt, SUBJECT_BOX_METHOD, type BatFrame } from "../services/pose3d/subjectBox.js";
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
  reconstruction_reliable: boolean | null;
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
  reconstructionReliable: boolean | null;
  detail: Record<string, unknown>;
} {
  // reconstruction_reliable is destructured out explicitly for the same
  // reason detail is above: it's a metrics.py top-level sibling field (like
  // confidence), not phase-specific evidence, so it must not fall into
  // `...rest` and get silently dropped by `detail ?? rest` below.
  const { frame, time_s, method, confidence, reconstruction_reliable, detail, ...rest } = raw;
  return {
    frame,
    timeS: time_s,
    method,
    confidence,
    reconstructionReliable: reconstruction_reliable ?? null,
    detail: detail ?? rest,
  };
}

export async function ingestPhases(
  teamSlug: string,
  playerSlug: string,
  date: string,
  opponent: string | null,
  ab: number,
  clipDir: string,
  position = 0,
  existingVideoClipId?: string,
): Promise<void> {
  if (!fs.existsSync(clipDir)) {
    throw new Error(`Clip dir not found: ${clipDir}`);
  }
  const pose2d = JSON.parse(fs.readFileSync(path.join(clipDir, "pose_2d.json"), "utf-8"));
  const metrics = JSON.parse(fs.readFileSync(path.join(clipDir, "metrics.json"), "utf-8"));
  assertV2IngestionRoute(metrics, existingVideoClipId);  // before any database access
  const batPath = path.join(clipDir, "bat_path.json");
  const batFrames: BatFrame[] = fs.existsSync(batPath) ? JSON.parse(fs.readFileSync(batPath, "utf-8")).frames ?? [] : [];

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
  // Defaults to 0 (single-clip at-bats, the common case), but a real
  // multi-clip at-bat needs its real position passed here too - findOrCreate
  // VideoClip only PRESERVES an existing row's position, it doesn't fix a
  // wrong one up later. A real bug this caused: ingesting all 4 clips of one
  // at-bat by running this command before ingest-pose3d-frames for each
  // pinned every one of them at position 0 (whichever ingester runs first
  // for a brand-new clip wins the create), scrambling the multi-clip
  // switcher order until manually corrected in the DB.
  const videoClipId = existingVideoClipId ?? await findOrCreateVideoClip(gameLogEntryId, {
    clipSlug,
    fps: pose2d.meta.fps,
    nFrames: pose2d.meta.n_frames,
    position,
  });

  if (existingVideoClipId) {
    const plan = v2IngestionPlan(metrics, pose2d);
    const db = getSupabaseClient();
    const { error: clearError } = await db.from("video_clip_metrics").delete().eq("video_clip_id", videoClipId);
    if (clearError) throw new Error(`Clearing baseline summary: ${clearError.message}`);
    const { error: metaError } = await db.from("video_clips").update(plan.clipMetadata).eq("id", videoClipId);
    if (metaError) throw new Error(`Updating v2 clip metadata: ${metaError.message}`);
  }

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
    const normalized = normalizePhase(existingVideoClipId ? { ...raw, method: raw.method ?? null, confidence: null } : raw);
    // Where the batter is at this phase, for the coach app's "zoom on player"
    // view. Omitted (not guessed) when the tracked person isn't confidently
    // visible around this frame.
    if (normalized.frame !== null) {
      const box = subjectBoxAt(pose2d.frames, batFrames, normalized.frame, pose2d.meta.width, pose2d.meta.height);
      if (box) normalized.detail = { ...normalized.detail, subject_box: { ...normalizeBox(box, pose2d.meta.width, pose2d.meta.height), method: SUBJECT_BOX_METHOD } };
    }
    await upsertSwingPhase({ videoClipId, phaseTypeId, ...normalized });
    written++;
  }

  // Surfaces metrics.json's summary fields (bat speed, attack angle, etc.)
  // and the new movement_flags - previously computed but never ingested
  // anywhere (see videoClipUpsert.ts's upsertVideoClipMetrics for the full
  // field mapping). Rides along here rather than a separate CLI command,
  // since this function already has metrics loaded and videoClipId resolved.
  const pose3dPath = path.join(clipDir, "pose_3d.json");
  const pose3d = fs.existsSync(pose3dPath) ? JSON.parse(fs.readFileSync(pose3dPath, "utf-8")) : null;
  await upsertVideoClipMetrics({
    videoClipId,
    metrics,
    analysisQuality: computeAnalysisQuality({ pose2d, pose3d, metrics }) as unknown as Record<string, unknown>,
  });

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
    .option("--opponent <name>", "Opponent, matches an existing game_log_entries row - omit for a practice session (opponent is a real SQL NULL there, not an empty string)")
    .requiredOption("--ab <number>", "At-bat number, matches an existing game_log_entries row")
    .requiredOption("--clipDir <path>", 'Path to the pose3d output dir, e.g. "frames/emily_c/Emily_C_AB1 (4)"')
    .option("--position <number>", "This clip's position among multiple clips for the same at-bat (0-indexed) - matches ingest-pose3d-frames' own --position, pass the real value here too for a multi-clip at-bat regardless of ingestion order", "0");
  program.parse(process.argv);
  const opts = program.opts<{
    team: string;
    player: string;
    date: string;
    opponent?: string;
    ab: string;
    clipDir: string;
    position: string;
  }>();

  try {
    await ingestPhases(
      opts.team,
      opts.player,
      opts.date,
      opts.opponent ?? null,
      Number(opts.ab),
      opts.clipDir,
      Number(opts.position),
    );
  } catch (err) {
    console.error(err instanceof Error ? err.message : err);
    process.exit(1);
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main();
}
