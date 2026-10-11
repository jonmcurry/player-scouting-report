import { getSupabaseClient } from "./supabaseClient.js";
import { assessCapture, CAPTURE_ASSESSMENT_VERSION, type CaptureAssessment,
  type CaptureMediaFacts, type CaptureVisualSignals } from "../analysisDepth/captureAssessment.js";

type Pose2d = Parameters<typeof assessCapture>[0]["pose2d"];
type BatFrames = Parameters<typeof assessCapture>[0]["batFrames"];
type Phases = Parameters<typeof assessCapture>[0]["phases"];

/** Service-only. A missing declaration remains unknown; game is not a camera angle. */
export async function captureDeclaration(clipId: string): Promise<{
  slug: CaptureAssessment["declaredProfile"]; version: string | null;
}> {
  const { data, error } = await getSupabaseClient().from("clip_capture_declarations")
    .select("profile_slug,profile_version").eq("video_clip_id", clipId)
    .order("created_at", { ascending: false }).order("id", { ascending: false }).limit(1).maybeSingle();
  if (error) throw new Error(`Capture declaration lookup: ${error.message}`);
  const slug = data?.profile_slug;
  return { slug: slug === "game_backstop" || slug === "open_side_practice" || slug === "unknown_imported"
    ? slug : null, version: data?.profile_version ?? null };
}

export async function persistCaptureAssessment(input: {
  clipId: string; sourceHash: string; media: CaptureMediaFacts;
  visual?: CaptureVisualSignals | null; pose2d?: Pose2d; batFrames?: BatFrames; phases?: Phases;
}): Promise<CaptureAssessment> {
  const declaration = await captureDeclaration(input.clipId);
  const assessment = assessCapture({ media: input.media, visual: input.visual,
    declaredProfile: declaration.slug, pose2d: input.pose2d,
    batFrames: input.batFrames, phases: input.phases });
  const service = getSupabaseClient();
  const row = {
    video_clip_id: input.clipId, assessment_version: CAPTURE_ASSESSMENT_VERSION,
    stage: assessment.stage, source_sha256: input.sourceHash,
    declared_profile_slug: declaration.slug, declared_profile_version: declaration.slug ? declaration.version : null,
    inferred_profile_slug: assessment.inferredProfile, inferred_profile_version: "1.0.0",
    inference_status: assessment.inferenceStatus,
    frame_width: assessment.media.width, frame_height: assessment.media.height,
    rotation_degrees: assessment.media.rotationDegrees, orientation: assessment.media.orientation,
    reported_fps: assessment.media.reportedFps, actual_fps: assessment.media.actualFps,
    duration_s: assessment.media.durationS, camera_motion: assessment.cameraMotion,
    blur: assessment.blur, exposure: assessment.exposure,
    athlete_ambiguity: assessment.athleteAmbiguity, obstructions: assessment.obstructions,
    phase_visibility: assessment.phaseVisibility, profile_plausibility: assessment.profilePlausibility,
    setup_fingerprint: assessment.setupFingerprint, recommendations: assessment.recommendations,
  };
  const { error } = await service.from("clip_capture_assessments").insert(row);
  if (error?.code === "23505") {
    const { data: prior, error: lookupError } = await service.from("clip_capture_assessments")
      .select("source_sha256").eq("video_clip_id", input.clipId)
      .eq("assessment_version", CAPTURE_ASSESSMENT_VERSION).eq("stage", assessment.stage).maybeSingle();
    if (lookupError || prior?.source_sha256 !== input.sourceHash)
      throw new Error("Capture assessment version reused for different source media");
  } else if (error) throw new Error(`Capture assessment insert: ${error.message}`);
  return assessment;
}
