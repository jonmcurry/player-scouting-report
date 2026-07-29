#!/usr/bin/env node
/**
 * Loads one clip's already-run pose3d pipeline output (pose_3d.json's real
 * joint trajectory, metrics.json's lead_side_guess) and upserts the SMOOTHED
 * frames into Supabase's video_clip_pose3d table - the piece ingestPhases.ts
 * (swing_phases only) doesn't cover, and processUploadQueue.ts only does as
 * one step of its full download-raw-clip-and-run-the-pipeline loop for a
 * browser-uploaded clip.
 *
 * This command is for the other real case: a clip already processed locally
 * (frames/<player>/<clip>/, e.g. from an earlier pipeline run) being
 * onboarded via CLI rather than a coach's browser upload - the situation
 * when first migrating an already-filmed player/team into Supabase. Reuses
 * findOrCreateVideoClip/upsertPose3dFrames/smoothJoints UNCHANGED from
 * processUploadQueue.ts's own post-pipeline steps, so a CLI-ingested clip and
 * a browser-uploaded one end up in an identical shape.
 *
 * Same "which at-bat a physical clip belongs to is a human judgment call"
 * natural key as ingestPhases.ts (--date/--opponent/--ab) - running this and
 * ingest-phases for the same clip is safe in either order (both call the
 * same idempotent findOrCreateVideoClip).
 *
 * Usage:
 *   npm run ingest-pose3d-frames -- --team latham-lady-bison-white-10u --player emily_c \
 *     --date 2026-07-25 --opponent "EG Xpress Hurricanes" --ab 1 \
 *     --clipDir "frames/emily_c/Emily_C_AB1 (1)" --position 0
 */
import { Command } from "commander";
import fs from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { findPlayerId } from "../services/db/checklistUpsert.js";
import { findGameLogEntryId, findOrCreateVideoClip, upsertPose3dFrames } from "../services/db/videoClipUpsert.js";
import { smoothJoints, SMOOTHING_METHOD_LABEL, type Pose3dFrame } from "../services/pose3d/smoothJoints.js";

export async function ingestPose3dFrames(
  teamSlug: string,
  playerSlug: string,
  date: string,
  opponent: string,
  ab: number,
  clipDir: string,
  position: number,
): Promise<void> {
  if (!fs.existsSync(clipDir)) {
    throw new Error(`Clip dir not found: ${clipDir}`);
  }
  const pose3d = JSON.parse(fs.readFileSync(path.join(clipDir, "pose_3d.json"), "utf-8")) as {
    meta: { joint_names: string[]; fps: number; n_frames: number };
    frames: Pose3dFrame[];
  };
  const metricsPath = path.join(clipDir, "metrics.json");
  // lead_side_guess is absent for a clip metrics.py couldn't fully analyze
  // (e.g. a taken pitch with no swing at all) - null is the honest value,
  // same as processUploadQueue.ts's own `?? null` fallback.
  const metrics = fs.existsSync(metricsPath)
    ? (JSON.parse(fs.readFileSync(metricsPath, "utf-8")) as { lead_side_guess?: "l" | "r" | null })
    : {};

  const playerId = await findPlayerId(teamSlug, playerSlug);
  const gameLogEntryId = await findGameLogEntryId(playerId, date, opponent, ab);
  const clipSlug = path.basename(clipDir);
  const videoClipId = await findOrCreateVideoClip(gameLogEntryId, {
    clipSlug,
    fps: pose3d.meta.fps,
    nFrames: pose3d.meta.n_frames,
    position,
  });

  const smoothedFrames = smoothJoints(pose3d.frames);
  await upsertPose3dFrames({
    videoClipId,
    jointNames: pose3d.meta.joint_names,
    smoothingMethod: SMOOTHING_METHOD_LABEL,
    leadSide: metrics.lead_side_guess ?? null,
    frames: smoothedFrames,
  });

  console.log(
    `Ingested ${smoothedFrames.length} smoothed pose3d frame(s) for ${playerSlug}'s clip "${clipSlug}" ` +
      `(${date} vs ${opponent}, AB ${ab}, position ${position}).`,
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
    .requiredOption("--clipDir <path>", 'Path to the pose3d output dir, e.g. "frames/emily_c/Emily_C_AB1 (4)"')
    .option("--position <number>", "Display order among multiple physical clips for the same at-bat", "0");
  program.parse(process.argv);
  const opts = program.opts<{
    team: string;
    player: string;
    date: string;
    opponent: string;
    ab: string;
    clipDir: string;
    position: string;
  }>();

  try {
    await ingestPose3dFrames(
      opts.team,
      opts.player,
      opts.date,
      opts.opponent,
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
