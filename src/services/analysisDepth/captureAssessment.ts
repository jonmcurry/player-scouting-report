/** Phase 2 capture facts. Unknown means unavailable, never a passing check. */
export const CAPTURE_ASSESSMENT_VERSION = "capture-v1";
export const CAPTURE_PHASES = ["stance", "load", "stride", "contact", "extension", "follow_through"] as const;
export type CapturePhase = typeof CAPTURE_PHASES[number];
export type Visibility = "visible" | "partial" | "unavailable";
export type Indicator = "possible_issue" | "unavailable";
export type CaptureRecommendation = "whole_hitter" | "bat_arc" | "brighter_light" | "avoid_backlight" | "stable_focus";

export interface CaptureMediaFacts {
  width: number | null;
  height: number | null;
  rotationDegrees: number | null;
  orientation: "landscape" | "portrait" | "square" | "unknown";
  reportedFps: number | null;
  actualFps: number | null;
  durationS: number | null;
}

export interface CaptureVisualSignals {
  exposure: "possible_dark" | "possible_bright" | "unavailable";
  blur: Indicator;
  cameraMotion: Indicator;
}

export interface CaptureAssessment {
  stage: "media" | "full";
  declaredProfile: "game_backstop" | "open_side_practice" | "unknown_imported" | null;
  inferredProfile: "unknown_imported";
  inferenceStatus: "unavailable";
  media: CaptureMediaFacts;
  cameraMotion: Indicator;
  blur: Indicator;
  exposure: CaptureVisualSignals["exposure"];
  athleteAmbiguity: Indicator;
  obstructions: { fence: "unavailable"; catcher: "unavailable"; umpire: "unavailable"; generic: Indicator };
  phaseVisibility: Record<CapturePhase, { body: Visibility; bat: Visibility; landmarks: string[] }>;
  profilePlausibility: "supported" | "questionable" | "unavailable";
  setupFingerprint: null;
  recommendations: CaptureRecommendation[];
}

interface PoseFrame { frame: number; keypoints: number[][] | null }
interface BatFrame { frame: number; tip: number[] | null; knob: number[] | null; conf: number | null }
interface Phase { frame?: number | null }
interface Pose2d { meta?: { bat_evidence?: { used_fallback?: boolean } }; frames?: PoseFrame[] }

const reliable = (point: number[] | undefined) => Array.isArray(point) && Number.isFinite(point[2]) && point[2]! >= 0.3;
const positioned = (point: number[] | null | undefined) => Array.isArray(point)
  && Number.isFinite(point[0]) && Number.isFinite(point[1]);
// Side views can hide the far eye, wrist, and ankle. One detected point in
// each region is enough to say the region is visible; this is not proof that
// both sides of the body are measurable.
const groups = { head: [0, 1, 2, 3, 4], trunk: [5, 6, 11, 12], hands: [9, 10], feet: [15, 16] } as const;

function atPhase(pose: PoseFrame | undefined, bat: BatFrame | undefined): { body: Visibility; bat: Visibility; landmarks: string[] } {
  const k = pose?.keypoints ?? [];
  const landmarks = Object.entries(groups).filter(([, indices]) =>
    indices.some((index) => reliable(k[index]))).map(([name]) => name);
  const body: Visibility = landmarks.includes("head") && landmarks.includes("trunk") && landmarks.includes("feet")
    ? "visible" : k.filter(reliable).length >= 4 ? "partial" : "unavailable";
  const batVisibility: Visibility = (bat?.conf ?? 0) >= 0.3 && positioned(bat?.tip) && positioned(bat?.knob)
    ? "visible" : positioned(bat?.tip) || positioned(bat?.knob) ? "partial" : "unavailable";
  if (batVisibility === "visible") landmarks.push("bat");
  return { body, bat: batVisibility, landmarks };
}

export function assessCapture(input: {
  media: CaptureMediaFacts;
  visual?: CaptureVisualSignals | null;
  declaredProfile?: CaptureAssessment["declaredProfile"];
  pose2d?: Pose2d | null;
  batFrames?: BatFrame[] | null;
  phases?: Record<string, Phase | undefined> | null;
}): CaptureAssessment {
  const full = !!input.pose2d && !!input.phases;
  const pose = new Map((input.pose2d?.frames ?? []).map((f) => [f.frame, f]));
  const bat = new Map((input.batFrames ?? []).map((f) => [f.frame, f]));
  const phaseVisibility = Object.fromEntries(CAPTURE_PHASES.map((name) => {
    const frame = input.phases?.[name]?.frame;
    return [name, Number.isInteger(frame) && frame! >= 0
      ? atPhase(pose.get(frame!), bat.get(frame!))
      : { body: "unavailable", bat: "unavailable", landmarks: [] }];
  })) as CaptureAssessment["phaseVisibility"];
  const visibleFrames = (input.pose2d?.frames ?? []).filter((f) => f.keypoints).length;
  const trackedFraction = input.pose2d?.frames?.length ? visibleFrames / input.pose2d.frames.length : null;
  const genericOcclusion: Indicator = trackedFraction !== null && trackedFraction < 0.5 ? "possible_issue" : "unavailable";
  const visual = input.visual ?? { exposure: "unavailable", blur: "unavailable", cameraMotion: "unavailable" };
  const recommendations: CaptureRecommendation[] = [];
  if (full && phaseVisibility.contact.body !== "visible") recommendations.push("whole_hitter");
  if (full && phaseVisibility.contact.bat !== "visible") recommendations.push("bat_arc");
  if (visual.exposure === "possible_dark") recommendations.push("brighter_light");
  if (visual.exposure === "possible_bright") recommendations.push("avoid_backlight");
  if (visual.blur === "possible_issue" || visual.cameraMotion === "possible_issue")
    recommendations.push("stable_focus");
  return {
    stage: full ? "full" : "media", declaredProfile: input.declaredProfile ?? null,
    inferredProfile: "unknown_imported", inferenceStatus: "unavailable", media: input.media,
    cameraMotion: visual.cameraMotion, blur: visual.blur, exposure: visual.exposure,
    athleteAmbiguity: input.pose2d?.meta?.bat_evidence?.used_fallback === true ? "possible_issue" : "unavailable",
    obstructions: { fence: "unavailable", catcher: "unavailable", umpire: "unavailable", generic: genericOcclusion },
    phaseVisibility, profilePlausibility: "unavailable", setupFingerprint: null,
    recommendations: [...new Set(recommendations)].slice(0, 2),
  };
}

/** Per-definition capture gate. Unknown requirements fail closed; no total quality score. */
export function captureAvailability(definition: {
  status: "experimental" | "validated_internal" | "validated_external" | "retired";
  captureProfiles: string[]; requiredLandmarks: string[]; requiredPhases: string[];
  minimumQuality: Record<string, unknown>;
}, assessment: CaptureAssessment | null): { available: boolean; reasons: string[] } {
  const reasons: string[] = [];
  if (!assessment || assessment.stage !== "full") reasons.push("capture_assessment_unavailable");
  if (definition.status !== "validated_internal" && definition.status !== "validated_external") reasons.push("definition_unvalidated");
  if (!assessment) return { available: false, reasons };
  if (definition.captureProfiles.length && (!assessment.declaredProfile
    || !definition.captureProfiles.includes(assessment.declaredProfile)
    || assessment.profilePlausibility !== "supported")) {
    // Plausibility cannot be confirmed from the current detector, so a
    // declaration alone never unlocks a camera-specific measurement.
    reasons.push("capture_profile_unconfirmed");
  }
  for (const phase of definition.requiredPhases) {
    const visibility = assessment.phaseVisibility[phase as CapturePhase];
    if (!visibility || visibility.body !== "visible") reasons.push(`phase_unavailable:${phase}`);
    for (const landmark of definition.requiredLandmarks)
      if (!visibility?.landmarks.includes(landmark)) reasons.push(`landmark_unavailable:${phase}:${landmark}`);
  }
  if (definition.requiredLandmarks.length && !definition.requiredPhases.length)
    reasons.push("required_phase_unspecified");
  for (const [key, value] of Object.entries(definition.minimumQuality)) {
    const actual = key === "min_width_px" ? assessment.media.width
      : key === "min_height_px" ? assessment.media.height
      : key === "min_actual_fps" ? assessment.media.actualFps : null;
    if (!Number.isFinite(value) || typeof value !== "number" || value <= 0 || actual === null || actual < value)
      reasons.push(`quality_unavailable:${key}`);
  }
  return { available: reasons.length === 0, reasons };
}
