import { getSupabaseClient } from "./supabaseClient.js";
import { attemptSourceRevision, legacyAttemptParity, legacyPhaseEvents,
  type LegacyPhase } from "../analysisDepth/attemptModel.js";

/** One service-side dual-write boundary. It never changes legacy reads. */
export async function recordAttemptSnapshot(input: {
  clipId: string; detectionState: "readable" | "confirmed_no_swing" | "inconclusive";
  phases: Record<string, LegacyPhase> | null | undefined; pipelineVersion: string | null;
  detectorVersion?: string | null;
  phaseVisibility?: Record<string, { body?: string }> | null;
}): Promise<string | null> {
  const db = getSupabaseClient();
  const events = legacyPhaseEvents(input.phases, input.detectorVersion ?? null, input.phaseVisibility)
    .map((event) => ({ ...event, pipeline_version: input.pipelineVersion }));
  const revision = attemptSourceRevision(input.pipelineVersion, events);
  const { data: attemptId, error } = await db.rpc("record_legacy_attempt_snapshot", {
    p_clip_id: input.clipId, p_source_revision: revision, p_events: events,
  });
  if (error) throw new Error(`Attempt snapshot: ${error.message}`);
  if (process.env.ANALYSIS_ATTEMPT_PARITY === "1") {
    const attempts = await db.from("active_legacy_swing_attempts")
      .select("id,video_clip_id,attempt_index").eq("video_clip_id", input.clipId);
    if (attempts.error) throw new Error(`Attempt parity read: ${attempts.error.message}`);
    const phaseRows = attemptId
      ? await db.from("swing_phase_events").select("event_slug,frame,time_s")
        .eq("swing_attempt_id", attemptId).eq("source_revision", revision)
      : { data: [], error: null };
    if (phaseRows.error) throw new Error(`Phase parity read: ${phaseRows.error.message}`);
    const parity = legacyAttemptParity({ id: input.clipId, status: "ready",
      swing_detection_state: input.detectionState }, attempts.data ?? [], events, phaseRows.data ?? []);
    if (!parity.matches) throw new Error(`Attempt parity failed: ${parity.reasons.join(",")}`);
  }
  return attemptId;
}
