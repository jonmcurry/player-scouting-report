import { getSupabaseClient } from "./supabaseClient.js";
import { V2_IDENTITY } from "../engine/engineSelection.js";
import type { V2Qualification } from "../engine/v2Coaching.js";
import type { SwingAnalysisResult } from "../ai/swingAnalysisShared.js";
import type { ExperimentalV2Row, ExperimentalEvent } from "../development/experimentalV2Report.js";

export async function upsertExperimentalV2Result(row: ExperimentalV2Row): Promise<void> {
  const { error } = await getSupabaseClient().from("experimental_v2_results")
    .upsert({ ...row, updated_at: new Date().toISOString() }, { onConflict: "video_clip_id" });
  if (error) throw new Error(`Storing experimental analysis: ${error.message}`);
}

export function experimentalResult(clipId: string, patch: Partial<ExperimentalV2Row> = {}): ExperimentalV2Row {
  return { video_clip_id: clipId, ...V2_IDENTITY, outcome: "processing", reason_codes: [],
    events: [], findings: [], suppressed_count: 0, analysis_run_id: null, retry_eligible: false, ...patch };
}

const obj = (v: unknown): Record<string, unknown> =>
  v !== null && typeof v === "object" && !Array.isArray(v) ? v as Record<string, unknown> : {};
const array = (v: unknown): unknown[] => Array.isArray(v) ? v : [];
const finite = (v: unknown): v is number => typeof v === "number" && Number.isFinite(v);

/** Only citable events, with seeks landing in the middle of the event's own frame. The seek is the
 * frame's absolute presentation time: measured on the Android WebView, a video whose first frame is at
 * 1.5 s shows that frame at currentTime 1.5, so subtracting the start time would land early. */
export function experimentalEvents(metrics: unknown, frameMap: unknown): ExperimentalEvent[] {
  const map = obj(frameMap), frames = array(map.frames).map(obj);
  const first = map.first_pts ?? frames[0]?.pts;
  const tb = array(map.time_base ?? frames[0]?.time_base);
  if (!finite(first) || !finite(tb[0]) || !finite(tb[1]) || tb[0] <= 0 || tb[1] <= 0) return [];
  const scale = tb[0] / tb[1];
  const deltas = frames.slice(1).map((f, i) =>
    finite(f.pts) && finite(frames[i]?.pts) ? (f.pts - (frames[i]!.pts as number)) * scale : NaN)
    .filter(d => Number.isFinite(d) && d > 0).sort((a, b) => a - b);
  if (!deltas.length) return [];
  const middle = Math.floor(deltas.length / 2);
  const median = deltas.length % 2 ? deltas[middle]! : (deltas[middle - 1]! + deltas[middle]!) / 2;
  return array(obj(metrics).events).map(obj).flatMap(e => {
    if (e.status !== "available" || e.downstream_use !== "experimental" ||
      typeof e.id !== "string" || !finite(e.pts) || !finite(e.time_s) ||
      !["direct", "pose"].includes(String(e.observation))) return [];
    const seekS = e.pts * scale + median / 2;
    if (seekS < 0) return [];
    return [{ id: e.id, timeS: e.time_s, seekS, observation: String(e.observation), estimate: e.id === "impact_estimate" }];
  });
}

export function storedExperimentalResult(base: ExperimentalV2Row, qualification: V2Qualification,
  result: SwingAnalysisResult, analysisRunId: string, issueIds: Array<string | null>): ExperimentalV2Row {
  const suppressed = qualification.decisions.filter(d => !d.displayed && (d.kind === "strength" || d.kind === "issue"));
  const findings: ExperimentalV2Row["findings"] = [
    ...result.strengths.map((s, index) => ({ kind: "strength" as const, issueId: null, index,
      claimType: s.claimType!, supportingEvents: s.supportingEvents!, phase: s.phase })),
    ...result.issues.flatMap((s, index) => issueIds[index] ? [{ kind: "issue" as const, issueId: issueIds[index]!, index,
      claimType: s.claimType!, supportingEvents: s.supportingEvents!, phase: s.phase ?? null }] : []),
  ];
  // A qualified issue not stored because a coach already hid or reviewed the same finding still
  // counts as supported: the run is "findings", never a misleading "no supported issue".
  const previouslyHidden = result.issues.some((_, index) => !issueIds[index]);
  return { ...base, analysis_run_id: analysisRunId, findings, suppressed_count: suppressed.length,
    reason_codes: [...new Set([...suppressed.flatMap(d => d.reasons), ...(previouslyHidden ? ["PREVIOUSLY_HIDDEN"] : [])])],
    retry_eligible: false,
    outcome: result.issues.length > 0 ? "findings"
      : suppressed.some(d => d.kind === "issue") ? "insufficient_evidence" : "no_supported_issue" };
}
