/** Pure allowlisted read boundary, shared by Node tests and the Deno edge function. */
export type ExperimentalOutcome = "processing" | "not_assessable" | "analysis_not_enabled" |
  "findings" | "no_supported_issue" | "insufficient_evidence" | "withheld" | "analysis_failed";
export interface ExperimentalEvent {
  id: string; timeS: number; seekS: number; observation: string; estimate: boolean;
}
export interface ExperimentalFinding {
  kind: "strength" | "issue"; issueId: string | null; index: number;
  claimType: "direct_observation" | "qualified_interpretation"; supportingEvents: string[]; phase: string | null;
}
export interface ExperimentalV2Row {
  video_clip_id: string; engine: string; pipeline_version: string; outcome: ExperimentalOutcome;
  reason_codes: string[]; events: ExperimentalEvent[]; findings: ExperimentalFinding[];
  suppressed_count: number; analysis_run_id: string | null; retry_eligible: boolean;
}
const reasons: Record<string, string> = {
  V2_AI_NOT_ENABLED: "Experimental coaching analysis is not enabled.",
  V2_PROVIDER_UNSUPPORTED: "The selected analysis service does not support experimental coaching.",
  ENGINE_NOT_COMPLETE: "Video processing did not finish.",
  NO_SELECTED_BATTER: "The batter could not be identified reliably.",
  IDENTITY_NOT_BAT_GROUNDED: "The bat could not be linked reliably to the batter.",
  POSSIBLE_BATTER_CONFLICT: "The body and bat tracking may refer to different people.",
  UNSUPPORTED_CAMERA_GEOMETRY: "The camera angle does not support this analysis.",
  NO_SWING_CANDIDATE: "A swing could not be identified reliably.",
  NO_SUPPORTED_EVENT: "No swing moment had enough supporting evidence.",
  FRAME_MAPPING_UNAVAILABLE: "The analysis images could not be matched to the original video.",
  EVIDENCE_PACKAGE_UNAVAILABLE: "The images needed to support the analysis were unavailable.",
  NO_SUPPORTED_EVENT_STILL: "No supported swing moment had a usable still image.",
  AI_ANALYSIS_FAILED: "Coaching analysis did not finish. You can try again.",
  ROTATION_MISMATCH: "The video orientation could not be confirmed.",
  UPLOAD_DURATION_UNSUPPORTED: "The video's length is outside what can be analyzed.",
  SOURCE_START_OFFSET_UNSUPPORTED: "This video's timing doesn't start at zero, so still images can't yet be matched to swing moments.",
  PREVIOUSLY_HIDDEN: "An observation hidden after earlier feedback was found again and stays hidden.",
  SUMMARY_UNSUPPORTED_CLAIM: "The summary made an unsupported claim, so the analysis was withheld.",
  EVENT_REFERENCE_INVALID: "A finding cited a swing moment that was not supplied.",
  EVENT_PHASE_MISMATCH: "A finding's phase did not match its cited swing moment.",
  NO_IMAGE_FOR_EVENT: "A finding had no still image for its cited moment.",
  BAT_NOT_DIRECTLY_OBSERVED: "The bat was not directly visible at the cited moment.",
  POSE_NOT_OBSERVED: "The batter's body was not tracked at the cited moment.",
  UNSUPPORTED_BASIS: "A finding relied on evidence other than the video.",
  NUMERIC_CLAIM: "A finding stated a measurement the analysis cannot support.",
  CONTACT_CLAIM: "A finding described ball contact that the analysis cannot confirm.",
  HAND_PATH_CLAIM: "A finding described hand path that the analysis cannot measure reliably.",
  CAUSAL_CLAIM: "A finding stated a cause more certainly than the evidence supports.",
  NOT_SUPPORTED_IN_V2: "This kind of finding is not supported by experimental analysis.",
  BATTER_AMBIGUOUS: "More than one person could be the batter.",
  BATTER_UNAVAILABLE: "The batter could not be tracked.",
  NO_PERSON_DETECTED: "No person could be detected reliably.",
  SEGMENT_TOO_SHORT: "The batter was visible for too little of the video.",
  INSUFFICIENT_GRIP_EVIDENCE: "There was too little evidence linking the bat to the batter's hands.",
  BAT_EVIDENCE_AMBIGUOUS: "The bat observations did not identify a single batter.",
  BAT_EVIDENCE_UNAVAILABLE: "Usable bat observations were unavailable.",
  NO_EXCLUSIVE_BAT_EVIDENCE: "The bat could not be linked to just one person.",
  POSE_BAT_DISAGREEMENT: "The body and bat tracking did not agree on the batter.",
  BAT_MODEL_MISSING: "The bat detection component was unavailable.",
  BAT_MODEL_HASH_MISMATCH: "The bat detection component could not be verified.",
  BAT_CLASS_MAP_MISMATCH: "The bat detection component was not compatible.",
  BAT_MODEL_ERROR: "The bat detection component could not run.",
  DECODE_UNAVAILABLE: "The video could not be opened for analysis.",
  DECODE_ERROR: "The video could not be read completely.",
  NO_VIDEO_STREAM: "No video images were found.",
  CLIP_TOO_LONG: "The video was too long for this analysis.",
  MISSING_PTS: "The video was missing frame timing.",
  NONINCREASING_PTS: "The video frame timing was inconsistent.",
  UNSUPPORTED_ROTATION: "The video orientation is not supported.",
  UNEXPECTED_EXCEPTION: "Video processing stopped unexpectedly.",
};
const headlines: Record<ExperimentalOutcome, string> = {
  processing: "Experimental analysis is processing.",
  not_assessable: "This video could not be assessed experimentally.",
  analysis_not_enabled: "Experimental coaching analysis is not enabled.",
  findings: "Experimental observations are available.",
  no_supported_issue: "No supported issue was found by experimental analysis.",
  insufficient_evidence: "There was not enough evidence to show an issue.",
  withheld: "Experimental analysis was withheld because its claims were unsupported.",
  analysis_failed: "Experimental analysis did not finish.",
};
const labels: Record<string, string> = { stance_set: "Stance set", load_peak_estimate: "Estimated load peak",
  foot_plant: "Foot plant", impact_estimate: "Estimated impact moment", extension: "Extension", finish: "Finish" };
// A withheld run's text reasons come from its summary or no-action reason, not from a finding.
const summaryReasons: Record<string, string> = {
  NUMERIC_CLAIM: "The summary stated a measurement the analysis cannot support.",
  CONTACT_CLAIM: "The summary described ball contact that the analysis cannot confirm.",
  HAND_PATH_CLAIM: "The summary described hand path, which the analysis cannot measure reliably.",
  CAUSAL_CLAIM: "The summary stated a cause more certainly than the evidence supports.",
};
const summaryReason = (outcome: ExperimentalOutcome, code: string) => outcome === "withheld" ? summaryReasons[code] : undefined;
export type ExperimentalIssueRow = Issue;
type Issue = { id: string; analysis_run_id?: string | null; review_status?: string; hidden?: boolean;
  issue: string; evidence: string; coaching_cue?: string; look_for_next?: string };
type Run = { id: string; summary?: string | null; strengths?: unknown };
const object = (v: unknown): Record<string, unknown> =>
  v !== null && typeof v === "object" && !Array.isArray(v) ? v as Record<string, unknown> : {};

export function buildExperimentalReport({ row, clipStatus, issues, run }: {
  row: ExperimentalV2Row; clipStatus: string; issues: Issue[]; run: Run | null;
}) {
  // clipStatus is "processing" while the worker still holds the clip. A "processing" row on a
  // failed clip, or on a ready clip the worker has let go of, was interrupted and never finished.
  const interrupted = row.outcome === "processing" && (clipStatus === "failed" || clipStatus === "ready");
  const outcome = interrupted ? "analysis_failed" : row.outcome;
  const events = row.events.filter(e => labels[e.id] && Number.isFinite(e.timeS) && Number.isFinite(e.seekS))
    .map(e => ({ id: e.id, label: labels[e.id]!, timeS: e.timeS, seekS: e.seekS,
      observation: e.observation === "direct" ? "direct" : "pose", estimate: e.id === "impact_estimate" }));
  const strengths = Array.isArray(run?.strengths) ? run.strengths : [];
  const findings = (["findings", "no_supported_issue", "insufficient_evidence"].includes(outcome) &&
    run?.id === row.analysis_run_id ? row.findings : []).flatMap(f => {
    if (!["direct_observation", "qualified_interpretation"].includes(f.claimType)) return [];
    const cited = events.filter(e => f.supportingEvents.includes(e.id));
    if (!cited.length || cited.length !== f.supportingEvents.length) return [];
    const issue = f.kind === "issue" ? issues.find(i => i.id === f.issueId && i.analysis_run_id === row.analysis_run_id
      && !i.hidden && !["hidden", "rejected"].includes(i.review_status ?? "")) : null;
    const strength = f.kind === "strength" ? object(strengths[f.index]) : {};
    if (f.kind === "issue" && !issue) return [];
    const text = issue?.issue ?? strength.text, evidence = issue?.evidence ?? strength.evidence;
    if (typeof text !== "string" || !text.trim() || typeof evidence !== "string" || !evidence.trim()) return [];
    return [{ kind: f.kind, id: issue?.id ?? null, claimType: f.claimType,
      claimLabel: f.claimType === "direct_observation" ? "Direct observation" : "Qualified interpretation",
      events: cited, phase: f.phase, ...(issue ? { issue: text } : { text }), evidence,
      coachingCue: issue?.coaching_cue ?? null, lookForNext: issue?.look_for_next ?? null }];
  });
  const summary = ["findings", "no_supported_issue", "insufficient_evidence"].includes(outcome)
    && run?.id === row.analysis_run_id && typeof run?.summary === "string" && run.summary.trim() ? run.summary.trim() : null;
  return { label: "Experimental analysis — not yet validated", engine: row.engine, pipelineVersion: row.pipeline_version,
    outcome, headline: headlines[outcome], summary, reasons: [...new Set(interrupted ? [...row.reason_codes, "AI_ANALYSIS_FAILED"] : row.reason_codes)]
      .map(code => ({ code, text: summaryReason(outcome, code) ?? reasons[code] ?? "The available video evidence did not meet an experimental analysis requirement." })),
    events, findings, suppressedCount: row.suppressed_count, retryEligible: interrupted || row.retry_eligible };
}
