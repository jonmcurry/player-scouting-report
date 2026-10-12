/** Evaluation-only contract. No production engine, database or media decoder imports. */
import { readFileSync } from "node:fs";
import { Ajv } from "ajv";

export const SCHEMA_VERSION = "1.0.0" as const;
export const SWING_EVENTS = ["stance_set", "load_start", "stride_foot_lift", "foot_plant", "swing_launch", "impact_estimate", "contact_confirmed", "finish"] as const;
export type SwingEventSlug = typeof SWING_EVENTS[number];
export const COCO_17 = ["nose", "left_eye", "right_eye", "left_ear", "right_ear", "left_shoulder", "right_shoulder", "left_elbow", "right_elbow", "left_wrist", "right_wrist", "left_hip", "right_hip", "left_knee", "right_knee", "left_ankle", "right_ankle"] as const;
export type Joint = typeof COCO_17[number];
export interface FrameIdentity { frame_index: number; pts: number }
export interface FrameInterval { earliest: FrameIdentity; latest: FrameIdentity }
export interface SourceMedia {
  sha256: string; video_stream_index: number; width: number; height: number;
  rotation_degrees: 0 | 90 | 180 | 270; mirrored: boolean | "unknown";
  time_base: { numerator: number; denominator: number };
  frame_count: number; presentation_timestamps: number[];
}
export type MissingReason = "occluded" | "out_of_view" | "motion_blur" | "not_in_clip";
export type AmbiguousReason = "occluded" | "motion_blur" | "boundary_unclear" | "identity_uncertain";
export type SpatialLabel<T> =
  | { status: "observed"; coordinates: T; uncertainty_radius: number; reason: null }
  | { status: "ambiguous"; coordinates: T; uncertainty_radius: number; reason: AmbiguousReason }
  | { status: "not_visible"; coordinates: null; uncertainty_radius: null; reason: MissingReason }
  | { status: "not_applicable"; coordinates: null; uncertainty_radius: null; reason: "not_applicable" };
type PointLabel = SpatialLabel<[number, number]>;
export type Landmark =
  | (Extract<PointLabel, { status: "observed" }> & { visibility: 2 })
  | (Extract<PointLabel, { status: "ambiguous" }> & { visibility: 1 | 2 })
  | (Extract<PointLabel, { status: "not_visible" | "not_applicable" }> & { visibility: 0 });
export type EventLabel =
  | { status: "observed"; frame: FrameIdentity; uncertainty: FrameInterval; reason: null }
  | { status: "ambiguous"; frame: null; uncertainty: FrameInterval; reason: AmbiguousReason }
  | { status: "not_visible"; frame: null; uncertainty: null; reason: MissingReason }
  | { status: "not_applicable"; frame: null; uncertainty: null; reason: "no_swing" | "no_stride" | "not_reached" | "no_contact" | "no_distinct_action" }
  | { status: "not_annotated"; frame: null; uncertainty: null; reason: "not_reviewed" };
export interface SubjectLabel {
  track_id: string;
  bounding_box: SpatialLabel<[number, number, number, number]>;
  keypoints: Record<Joint, Landmark>;
  bat: { knob: Landmark; barrel_end: Landmark };
  motion_blur: Record<"body" | "bat", "none" | "mild" | "severe" | "unknown">;
  occlusion: Record<"body" | "bat", "none" | "partial" | "full" | "unknown">;
}
export type SwingOutcome = "contact_confirmed_fair" | "contact_confirmed_foul" | "contact_confirmed_unknown_direction" | "contact_unconfirmed" | "swing_miss" | "checked_swing" | "no_swing_take" | "unknown";
export interface SwingAnnotation {
  swing_id: string; athlete_id: string | null;
  batter_identity_status: "confirmed" | "ambiguous" | "not_visible";
  batter_track_id: string | null; candidate_track_ids: string[];
  window: FrameInterval;
  intent: "conventional_full" | "slap" | "power_slap" | "bunt" | "drag_bunt" | "checked_protective" | "take" | "unknown";
  outcome: SwingOutcome;
  outcome_evidence: ("ball_visible_at_bat" | "ball_deflection" | "audio_crack" | "fielder_reaction" | "none")[];
  batting_side_observed: "L" | "R" | "unknown"; front_leg: "left" | "right" | "unknown";
  hitting_zone: "reached" | "not_reached" | "unknown";
  events: Record<SwingEventSlug, EventLabel>;
}
export interface ClipAnnotation {
  schema_version: typeof SCHEMA_VERSION; eval_clip_id: string;
  sport: "baseball" | "softball" | "unknown";
  data_origin: "synthetic" | "private_consented"; coordinate_space: "source_raster_normalized";
  source: SourceMedia;
  camera: {
    viewpoint: "open_side" | "closed_side" | "behind_plate" | "pitcher_view" | "oblique" | "unknown";
    capture_profile: "game_backstop" | "open_side_practice" | "unknown_imported" | "other";
    obstructions: ("none" | "net" | "fence" | "person" | "equipment" | "other" | "unknown")[];
  };
  athletes: string[]; tracks: { track_id: string; athlete_id: string | null }[];
  frames: { frame: FrameIdentity; subjects: SubjectLabel[] }[];
  swings: SwingAnnotation[];
  annotators: { annotator_id: string; role: "primary" | "reviewer" | "adjudicator"; qualification: "trained_annotator" | "baseball_coach" | "softball_coach" | "pose_specialist" }[];
  annotation: { annotator_id: string; revision: number; review: { status: "draft" | "reviewed" | "adjudicated"; reviewer_ids: string[]; adjudicator_id: string | null; disagreement: "none" | "unresolved" | "resolved" } };
}
export interface ValidationResult { valid: boolean; errors: string[] }
const result = (errors: string[]): ValidationResult => ({ valid: errors.length === 0, errors });
export const annotationSchema = JSON.parse(readFileSync(new URL("../../../eval/schema/annotation.v1.schema.json", import.meta.url), "utf8"));
// One portable schema is the authority for both TS entry points and non-TS tools.
// Conditional subschemas refine types already established in the main definitions.
const ajv = new Ajv({ allErrors: true, strict: true, strictTypes: false, coerceTypes: false });
const checkStructure = ajv.compile<ClipAnnotation>(annotationSchema);
const checkSource = ajv.compile<SourceMedia>({ $ref: "#/definitions/source", definitions: annotationSchema.definitions });
export function validateAnnotationStructure(value: unknown): ValidationResult {
  return result(checkStructure(value) ? [] : (checkStructure.errors ?? []).map(e => `${e.instancePath || "/"}: ${e.message}`));
}
function sourceErrors(source: SourceMedia): string[] {
  const errors: string[] = [];
  if (source.frame_count !== source.presentation_timestamps.length) errors.push("source: frame_count disagrees with PTS inventory");
  source.presentation_timestamps.forEach((pts, i, all) => {
    if (i > 0 && pts <= all[i - 1]!) errors.push(`source: PTS must increase strictly in presentation order at ${i}`);
  });
  return errors;
}
/** Relational document checks, after portable schema validation. No claim of media verification. */
export function validateAnnotation(value: unknown): ValidationResult {
  const structure = validateAnnotationStructure(value);
  if (!structure.valid) return structure;
  const clip = value as ClipAnnotation;
  const errors = sourceErrors(clip.source);
  const fail = (path: string, message: string) => errors.push(`${path}: ${message}`);
  const unique = (ids: string[], path: string) => { if (new Set(ids).size !== ids.length) fail(path, "duplicate identity"); };
  const frame = (f: FrameIdentity, path: string) => {
    if (f.frame_index >= clip.source.frame_count || clip.source.presentation_timestamps[f.frame_index] !== f.pts) fail(path, "frame index/PTS disagrees with source inventory");
  };
  const interval = (r: FrameInterval, path: string) => {
    frame(r.earliest, `${path}/earliest`); frame(r.latest, `${path}/latest`);
    if (r.earliest.frame_index > r.latest.frame_index) fail(path, "reversed frame interval");
  };
  unique(clip.tracks.map(t => t.track_id), "tracks");
  const tracks = new Map(clip.tracks.map(t => [t.track_id, t.athlete_id]));
  clip.tracks.forEach(t => { if (t.athlete_id !== null && !clip.athletes.includes(t.athlete_id)) fail("tracks", "unknown athlete"); });
  clip.frames.forEach((f, i) => {
    frame(f.frame, `frames/${i}`);
    if (i > 0 && f.frame.frame_index <= clip.frames[i - 1]!.frame.frame_index) fail("frames", "samples must be strictly ordered and unique");
    unique(f.subjects.map(s => s.track_id), `frames/${i}/subjects`);
    for (const subject of f.subjects) {
      if (!tracks.has(subject.track_id)) fail(`frames/${i}`, "unknown track");
      if (subject.occlusion.body === "full" && Object.values(subject.keypoints).some(p => p.visibility === 2)) fail(`frames/${i}`, "fully occluded body cannot have visible landmarks");
      if (subject.occlusion.bat === "full" && Object.values(subject.bat).some(p => p.visibility === 2)) fail(`frames/${i}`, "fully occluded bat cannot have visible endpoints");
      const box = subject.bounding_box.coordinates;
      if (box && (box[0] >= box[2] || box[1] >= box[3])) fail(`frames/${i}/bounding_box`, "box must have positive width and height");
    }
  });
  unique(clip.swings.map(s => s.swing_id), "swings");
  // Partial order only: foot plant and launch can overlap or occur in either order.
  // Impact estimate and confirmed contact are independent temporal labels, not synonyms.
  const order: [SwingEventSlug, SwingEventSlug][] = [
    ...SWING_EVENTS.filter(e => e !== "stance_set").map(e => ["stance_set", e] as [SwingEventSlug, SwingEventSlug]),
    ["stride_foot_lift", "foot_plant"], ["load_start", "swing_launch"], ["swing_launch", "impact_estimate"],
    ["swing_launch", "contact_confirmed"], ["swing_launch", "finish"], ["impact_estimate", "finish"], ["contact_confirmed", "finish"],
    ["foot_plant", "finish"], ["stride_foot_lift", "finish"], ["load_start", "finish"],
  ];
  clip.swings.forEach((s, i) => {
    const path = `swings/${i}`;
    interval(s.window, path + "/window");
    if (i > 0 && s.window.earliest.frame_index <= clip.swings[i - 1]!.window.latest.frame_index) fail(path, "attempt windows must be ordered without overlap");
    if (s.athlete_id !== null && !clip.athletes.includes(s.athlete_id)) fail(path, "unknown athlete");
    if (s.batter_track_id !== null && (!tracks.has(s.batter_track_id) || tracks.get(s.batter_track_id) !== s.athlete_id)) fail(path, "batter track/athlete mismatch");
    for (const id of s.candidate_track_ids) if (!tracks.has(id)) fail(path, "unknown candidate track");
    if ((s.batting_side_observed === "R" && s.front_leg === "right") || (s.batting_side_observed === "L" && s.front_leg === "left")) fail(path, "front leg disagrees with observed batting side");
    for (const event of SWING_EVENTS) {
      const e = s.events[event];
      if (e.uncertainty) {
        interval(e.uncertainty, `${path}/${event}`);
        if (e.uncertainty.earliest.frame_index < s.window.earliest.frame_index || e.uncertainty.latest.frame_index > s.window.latest.frame_index) fail(path, "event falls outside attempt window");
        if (e.status === "observed" && (e.frame.frame_index !== e.uncertainty.earliest.frame_index || e.frame.frame_index !== e.uncertainty.latest.frame_index)) fail(path, "observed event must have a singleton uncertainty interval");
        if (e.status === "ambiguous" && e.uncertainty.earliest.frame_index === e.uncertainty.latest.frame_index) fail(path, "ambiguous event needs a non-singleton interval");
      }
      if (e.frame) frame(e.frame, `${path}/${event}/frame`);
      if (clip.annotation.review.status !== "draft" && e.status === "not_annotated") fail(path, "reviewed annotations cannot contain unreviewed events");
    }
    // Propagate earliest feasible times through the partial order. Checking adjacent
    // pairs alone misses impossible chains whose individual uncertainty ranges overlap.
    const lower = Object.fromEntries(SWING_EVENTS.map(e => [e, s.events[e].uncertainty?.earliest.frame_index ?? -Infinity])) as Record<SwingEventSlug, number>;
    for (let pass = 0; pass < SWING_EVENTS.length; pass++) {
      for (const [a, b] of order) lower[b] = Math.max(lower[b], lower[a]);
    }
    for (const e of SWING_EVENTS) if (s.events[e].uncertainty && lower[e] > s.events[e].uncertainty!.latest.frame_index) fail(path, `invalid event order at ${e}`);
  });
  unique(clip.annotators.map(a => a.annotator_id), "annotators");
  const people = new Map(clip.annotators.map(a => [a.annotator_id, a.role]));
  const review = clip.annotation.review;
  if (clip.annotators.filter(a => a.role === "primary").length !== 1 || people.get(clip.annotation.annotator_id) !== "primary") fail("annotation", "exactly one declared primary annotator is required");
  for (const id of review.reviewer_ids) if (people.get(id) !== "reviewer" || id === clip.annotation.annotator_id) fail("review", "reviewer must be a distinct declared reviewer");
  if (review.adjudicator_id !== null && (people.get(review.adjudicator_id) !== "adjudicator" || review.reviewer_ids.includes(review.adjudicator_id) || review.adjudicator_id === clip.annotation.annotator_id)) fail("review", "adjudicator must be distinct and declared");
  return result(errors);
}
export function parseAnnotation(value: unknown): ClipAnnotation {
  const validation = validateAnnotation(value);
  if (!validation.valid) throw new Error(validation.errors.join("\n"));
  return value as ClipAnnotation;
}
/** Compare against facts supplied by an independent source decoder/hash operation.
 * PR3 never opens media, computes PTS from fps, or starts a decoder/benchmark runner. */
export function validateAgainstSourceMedia(value: unknown, observedSource: unknown): ValidationResult {
  const annotation = validateAnnotation(value);
  if (!annotation.valid) return annotation;
  if (!checkSource(observedSource)) return result(["media: invalid independently supplied source inventory"]);
  const errors = sourceErrors(observedSource);
  const expected = (value as ClipAnnotation).source;
  for (const key of ["sha256", "video_stream_index", "width", "height", "rotation_degrees", "mirrored", "frame_count"] as const) {
    if (expected[key] !== observedSource[key]) errors.push(`media: ${key} mismatch`);
  }
  if (expected.time_base.numerator !== observedSource.time_base.numerator || expected.time_base.denominator !== observedSource.time_base.denominator) errors.push("media: original time base mismatch");
  if (expected.presentation_timestamps.length !== observedSource.presentation_timestamps.length || expected.presentation_timestamps.some((pts, i) => pts !== observedSource.presentation_timestamps[i])) errors.push("media: source PTS inventory mismatch");
  return result(errors);
}
