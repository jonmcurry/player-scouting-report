/**
 * Shared "write one video_clips row + its swing_phases" logic for
 * ingestPhases.ts - same "small upsert helpers, one CLI orchestrates them"
 * shape as checklistUpsert.ts, but a new file rather than an extension of it:
 * different tables, different shape (video_clips/swing_phases vs.
 * checklist_scores), no reviewed-by overwrite-protection concept here since
 * these are pure automated pose3d output, never a coach judgment call.
 */
import { getSupabaseClient } from "./supabaseClient.js";

export async function findGameLogEntryId(
  playerId: string,
  date: string,
  opponent: string,
  ab: number,
): Promise<string> {
  const supabase = getSupabaseClient();
  const { data, error } = await supabase
    .from("game_log_entries")
    .select("id")
    .eq("player_id", playerId)
    .eq("date", date)
    .eq("opponent", opponent)
    .eq("ab", ab)
    .single();
  if (error || !data) {
    throw new Error(
      `No game_log_entries row found for player_id=${playerId} date=${date} ` +
        `opponent="${opponent}" ab=${ab} - which at-bat a physical clip belongs to is a human ` +
        `judgment call (see migrate.ts's own note: "filename order may not match the true ` +
        `in-game sequence"), so this must match an existing row exactly, not infer one. ` +
        `(${error?.message ?? "not found"})`,
    );
  }
  return data.id as string;
}

export async function loadPhaseTypeSlugToId(): Promise<Map<string, string>> {
  const supabase = getSupabaseClient();
  const { data, error } = await supabase.from("swing_phase_types").select("id, slug");
  if (error) throw new Error(`Loading swing_phase_types: ${error.message}`);
  return new Map((data ?? []).map((p) => [p.slug as string, p.id as string]));
}

export interface VideoClipMeta {
  clipSlug: string;
  fps: number;
  nFrames: number;
  position: number;
}

export async function findOrCreateVideoClip(
  gameLogEntryId: string,
  meta: VideoClipMeta,
): Promise<string> {
  const supabase = getSupabaseClient();

  // If this row already exists (e.g. created by a browser upload, which
  // sets a real position among possibly-multiple clips for the same
  // at-bat - see coach/components/videoUpload.js), preserve its position
  // rather than clobbering it back to meta.position (which every current
  // caller just hardcodes to 0) - real bug found while designing the
  // upload-processing worker: without this, running ingestPhases() after a
  // browser upload would silently reset a correctly-ordered multi-clip
  // at-bat's position back to 0.
  const { data: existing } = await supabase
    .from("video_clips")
    .select("position")
    .eq("game_log_entry_id", gameLogEntryId)
    .eq("clip_slug", meta.clipSlug)
    .maybeSingle();

  const { data, error } = await supabase
    .from("video_clips")
    .upsert(
      {
        game_log_entry_id: gameLogEntryId,
        clip_slug: meta.clipSlug,
        fps: meta.fps,
        n_frames: meta.nFrames,
        duration_s: meta.nFrames / meta.fps,
        position: existing ? existing.position : meta.position,
      },
      { onConflict: "game_log_entry_id,clip_slug" },
    )
    .select("id")
    .single();
  if (error || !data) throw new Error(`Upserting video_clips row for ${meta.clipSlug}: ${error?.message}`);
  return data.id as string;
}

export interface PhaseUpsertInput {
  videoClipId: string;
  phaseTypeId: string;
  frame: number | null;
  timeS: number | null;
  method: string | null;
  confidence: "high" | "low" | null;
  detail: Record<string, unknown>;
}

export interface Pose3dFramesUpsertInput {
  videoClipId: string;
  jointNames: string[];
  smoothingMethod: string;
  leadSide: "l" | "r" | null;
  frames: unknown[]; // Pose3dFrame[] from src/services/pose3d/smoothJoints.ts
}

/** Real per-frame shape written by src/services/pose3d/smoothJoints.ts -
 * input.frames is typed loosely (unknown[]) at the call site, but this is
 * what's actually there at runtime. */
interface SmoothedFrame {
  frame: number;
  time_s: number;
  tracked: boolean;
  joints: number[][]; // N joints x [x, y, z]
  angles: Record<string, number | null>;
}

/**
 * Packs every frame's joints into one Float32 (little-endian) buffer,
 * frame-major - a real ~5x size reduction over the equivalent nested-array
 * JSON text (verified against this project's own real clip data: Emily C's
 * largest real clip has ~14,000 frames), decoded browser-side by
 * skeletonComparison.js's matching unpack function. `frames` keeps
 * everything else (frame/time_s/tracked/angles - small, worth staying
 * human-inspectable) as JSONB, with `joints` omitted since it now lives in
 * joints_blob instead.
 */
export async function upsertPose3dFrames(input: Pose3dFramesUpsertInput): Promise<void> {
  const supabase = getSupabaseClient();
  const frames = input.frames as SmoothedFrame[];
  const jointsPerFrame = input.jointNames.length;

  const packed = new Float32Array(frames.length * jointsPerFrame * 3);
  frames.forEach((f, frameIdx) => {
    const base = frameIdx * jointsPerFrame * 3;
    f.joints.forEach((xyz, jointIdx) => {
      packed[base + jointIdx * 3] = xyz[0]!;
      packed[base + jointIdx * 3 + 1] = xyz[1]!;
      packed[base + jointIdx * 3 + 2] = xyz[2]!;
    });
  });
  // Postgres/PostgREST's bytea wire format, confirmed empirically against
  // this project's real local stack before relying on it (not assumed from
  // docs) - hex text prefixed with "\x", both for reading AND writing.
  const jointsBlobHex = `\\x${Buffer.from(packed.buffer, packed.byteOffset, packed.byteLength).toString("hex")}`;

  const framesWithoutJoints = frames.map(({ frame, time_s, tracked, angles }) => ({
    frame,
    time_s,
    tracked,
    angles,
  }));

  const { error } = await supabase.from("video_clip_pose3d").upsert(
    {
      video_clip_id: input.videoClipId,
      joint_names: input.jointNames,
      smoothing_method: input.smoothingMethod,
      lead_side: input.leadSide,
      frames: framesWithoutJoints,
      joints_blob: jointsBlobHex,
    },
    { onConflict: "video_clip_id" },
  );
  if (error) throw new Error(`Upserting video_clip_pose3d row: ${error.message}`);
}

/** Removes a clip's stored pose3d data (if any) - used when a re-run
 * decides there isn't enough real tracked data to justify storing/showing
 * a skeleton at all (see src/services/pose3d/trackedFrames.ts), including
 * cleaning up a stale row from before that decision existed. Not an error
 * if no row exists. */
export async function deletePose3dFrames(videoClipId: string): Promise<void> {
  const supabase = getSupabaseClient();
  const { error } = await supabase.from("video_clip_pose3d").delete().eq("video_clip_id", videoClipId);
  if (error) throw new Error(`Deleting video_clip_pose3d row for ${videoClipId}: ${error.message}`);
}

export async function upsertSwingPhase(input: PhaseUpsertInput): Promise<void> {
  const supabase = getSupabaseClient();
  const { error } = await supabase.from("swing_phases").upsert(
    {
      video_clip_id: input.videoClipId,
      phase_type_id: input.phaseTypeId,
      frame: input.frame,
      time_s: input.timeS,
      method: input.method,
      confidence: input.confidence,
      detail: input.detail,
    },
    { onConflict: "video_clip_id,phase_type_id" },
  );
  if (error) throw new Error(`Upserting swing_phases row: ${error.message}`);
}
