import { advanceFocus, type Finding, type FocusRecord, type ReadableSwing } from "./focus.ts";
import { hasIssueEvidence, hasReportEvidence, latestRunsByClip } from "./latestRuns.ts";

type Clip = { id: string; readable_game_serial: number; game_log_entries: { date: string; session_type: string } };
type Issue = { id: string; video_clip_id: string; analysis_run_id: string | null; concept: string | null; phase: string | null; basis: string | null; confidence: string | null; context_explains_it: boolean; emergency_swing_suspected: boolean; review_status: string; issue: string | null; evidence: string | null; coaching_cue: string | null; look_for_next: string | null };
type StoredFocus = { id: string; concept: string; status: FocusRecord["status"]; started_at: string; ended_at: string | null; qualified_at_serial: number; dismissed_at_serial: number | null; dismissed_by: string | null };

const model = (row: StoredFocus): FocusRecord => ({
  concept: row.concept, status: row.status, startedAt: row.started_at, endedAt: row.ended_at,
  qualifiedAtSerial: row.qualified_at_serial, dismissedAtSerial: row.dismissed_at_serial, dismissedBy: row.dismissed_by,
});

export function visibleFocusClips<T extends { id: string }>(clips: T[], deletionIds: string[]): T[] {
  const deleting = new Set(deletionIds);
  return clips.filter((clip) => !deleting.has(clip.id));
}

/** Shared by the analysis worker and authenticated mutation Edge Functions. */
export async function persistPlayerFocus(db: any, playerId: string): Promise<void> {
  const [{ data: player, error: playerError }, { data: clips, error: clipsError }, { data: focuses, error: focusError }] = await Promise.all([
    db.from("players").select("readable_game_swing_count").eq("id", playerId).single(),
    db.from("video_clips").select("id, readable_game_serial, game_log_entries!inner(date, session_type, player_id)")
      .eq("game_log_entries.player_id", playerId).not("readable_game_serial", "is", null)
      .order("readable_game_serial", { ascending: false }).limit(5),
    db.from("player_focus").select("id, concept, status, started_at, ended_at, qualified_at_serial, dismissed_at_serial, dismissed_by")
      .eq("player_id", playerId).order("started_at", { ascending: false }),
  ]);
  if (playerError || clipsError || focusError || !player) throw new Error(`Loading focus inputs: ${playerError?.message ?? clipsError?.message ?? focusError?.message}`);
  const candidateClips = (clips ?? []) as Clip[];
  const { data: deletions, error: deletionError } = candidateClips.length
    ? await db.from("clip_deletions").select("clip_id").in("clip_id", candidateClips.map((clip) => clip.id))
    : { data: [], error: null };
  if (deletionError) throw new Error(`Loading pending clip deletions: ${deletionError.message}`);
  const recent = visibleFocusClips(candidateClips, (deletions ?? []).map((row: { clip_id: string }) => row.clip_id));
  const ids = recent.map((c) => c.id);
  const { data: runs, error: runError } = ids.length
    ? await db.from("analysis_runs").select("id, video_clip_id, summary, strengths, created_at").in("video_clip_id", ids)
      .order("created_at", { ascending: false })
    : { data: [], error: null };
  if (runError) throw new Error(`Loading focus runs: ${runError.message}`);
  const latestRun = latestRunsByClip((runs ?? []) as { id: string; video_clip_id: string | null; summary: string | null; strengths: unknown }[]);
  const { data: issues, error: issueError } = ids.length
    ? await db.from("issues").select("id, video_clip_id, analysis_run_id, concept, phase, basis, confidence, context_explains_it, emergency_swing_suspected, review_status, issue, evidence, coaching_cue, look_for_next").in("video_clip_id", ids)
    : { data: [], error: null };
  if (issueError) throw new Error(`Loading focus findings: ${issueError.message}`);
  const byClip = new Map<string, Finding[]>();
  const invalidClipIds = new Set<string>();
  for (const issue of (issues ?? []) as Issue[]) {
    const run = latestRun.get(issue.video_clip_id);
    if (!hasReportEvidence(run) || issue.analysis_run_id !== run?.id) continue;
    if (!hasIssueEvidence({ ...issue, coachingCue: issue.coaching_cue, lookForNext: issue.look_for_next })) {
      invalidClipIds.add(issue.video_clip_id);
      continue;
    }
    const items = byClip.get(issue.video_clip_id) ?? [];
    items.push({ id: issue.id, concept: issue.concept ?? "", phase: issue.phase, basis: issue.basis ?? "", confidence: issue.confidence,
      contextExplainsIt: issue.context_explains_it, emergencySwingSuspected: issue.emergency_swing_suspected,
      hidden: issue.review_status === "hidden" || issue.review_status === "rejected" });
    byClip.set(issue.video_clip_id, items);
  }
  const swings: ReadableSwing[] = recent.map((c) => ({ id: c.id, serial: c.readable_game_serial, date: c.game_log_entries.date,
    sessionType: "game", readable: hasReportEvidence(latestRun.get(c.id)) && !invalidClipIds.has(c.id), findings: byClip.get(c.id) ?? [] }));
  // The counter survives deleted clips, so their missing serials remain visible
  // to advanceFocus without asserting that a deleted swing had any finding.
  const total = player.readable_game_swing_count as number;
  const records = (focuses ?? []) as StoredFocus[];
  const old = records.find((f) => f.ended_at === null) ?? null;
  const history = records.filter((f) => f.ended_at !== null).map(model);
  const result = advanceFocus(swings, old ? model(old) : null, history, total);
  if (old && (!result.current || result.current.concept !== old.concept)) {
    const retired = result.history.find((f) => f.concept === old.concept && f.startedAt === old.started_at);
    if (!retired) throw new Error("Focus transition lacked its retired record");
    const { error } = await db.from("player_focus").update({ status: retired.status, ended_at: retired.endedAt }).eq("id", old.id).is("ended_at", null);
    if (error) throw new Error(`Retiring focus: ${error.message}`);
  } else if (old && result.current && result.current.status !== old.status) {
    const { error } = await db.from("player_focus").update({ status: result.current.status }).eq("id", old.id).is("ended_at", null);
    if (error) throw new Error(`Updating focus: ${error.message}`);
  }
  if (result.current && (!old || result.current.concept !== old.concept)) {
    const { error } = await db.from("player_focus").insert({ player_id: playerId, concept: result.current.concept, status: "active",
      started_at: result.current.startedAt, qualified_at_serial: result.current.qualifiedAtSerial });
    if (error) throw new Error(`Creating focus: ${error.message}`);
  }
}
