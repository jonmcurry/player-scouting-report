import { getSupabaseClient } from "../db/supabaseClient.js";
import { advanceFocus, type Finding, type FocusRecord, type ReadableSwing } from "./focus.js";

type Clip = { id: string; readable_game_serial: number; game_log_entries: { date: string; session_type: string } };
type Issue = { id: string; video_clip_id: string; analysis_run_id: string | null; concept: string | null; phase: string | null; basis: string | null; confidence: string | null; context_explains_it: boolean; emergency_swing_suspected: boolean; review_status: string };
type StoredFocus = { id: string; concept: string; status: FocusRecord["status"]; started_at: string; ended_at: string | null; qualified_at_serial: number; dismissed_at_serial: number | null; dismissed_by: string | null };

const model = (row: StoredFocus): FocusRecord => ({
  concept: row.concept, status: row.status, startedAt: row.started_at, endedAt: row.ended_at,
  qualifiedAtSerial: row.qualified_at_serial, dismissedAtSerial: row.dismissed_at_serial, dismissedBy: row.dismissed_by,
});

/** Called only after a validated analysis run was stored for a readable game swing. */
export async function refreshPlayerFocus(playerId: string, videoClipId: string): Promise<void> {
  const db = getSupabaseClient();
  const { data: serial, error: registerError } = await db.rpc("register_readable_game_swing", { p_clip_id: videoClipId });
  if (registerError) throw new Error(`Registering readable swing: ${registerError.message}`);
  if (serial === null) return; // practice never changes game focus
  const [{ data: player, error: playerError }, { data: clips, error: clipsError }, { data: focuses, error: focusError }] = await Promise.all([
    db.from("players").select("readable_game_swing_count").eq("id", playerId).single(),
    db.from("video_clips").select("id, readable_game_serial, game_log_entries!inner(date, session_type, player_id)")
      .eq("game_log_entries.player_id", playerId).not("readable_game_serial", "is", null)
      .order("readable_game_serial", { ascending: false }).limit(5),
    db.from("player_focus").select("id, concept, status, started_at, ended_at, qualified_at_serial, dismissed_at_serial, dismissed_by")
      .eq("player_id", playerId).order("started_at", { ascending: false }),
  ]);
  if (playerError || clipsError || focusError || !player) throw new Error(`Loading focus inputs: ${playerError?.message ?? clipsError?.message ?? focusError?.message}`);
  const recent = (clips ?? []) as unknown as Clip[];
  const ids = recent.map((c) => c.id);
  const { data: runs, error: runError } = ids.length
    ? await db.from("analysis_runs").select("id, video_clip_id, created_at").in("video_clip_id", ids)
      .not("summary", "is", null).order("created_at", { ascending: false })
    : { data: [], error: null };
  if (runError) throw new Error(`Loading focus runs: ${runError.message}`);
  const latestRun = new Map<string, string>();
  for (const run of runs ?? []) if (run.video_clip_id && !latestRun.has(run.video_clip_id)) latestRun.set(run.video_clip_id, run.id);
  const { data: issues, error: issueError } = ids.length
    ? await db.from("issues").select("id, video_clip_id, analysis_run_id, concept, phase, basis, confidence, context_explains_it, emergency_swing_suspected, review_status").in("video_clip_id", ids)
    : { data: [], error: null };
  if (issueError) throw new Error(`Loading focus findings: ${issueError.message}`);
  const byClip = new Map<string, Finding[]>();
  for (const issue of (issues ?? []) as Issue[]) {
    if (issue.analysis_run_id !== latestRun.get(issue.video_clip_id)) continue;
    const items = byClip.get(issue.video_clip_id) ?? [];
    items.push({ id: issue.id, concept: issue.concept ?? "", phase: issue.phase, basis: issue.basis ?? "", confidence: issue.confidence,
      contextExplainsIt: issue.context_explains_it, emergencySwingSuspected: issue.emergency_swing_suspected,
      hidden: issue.review_status === "hidden" || issue.review_status === "rejected" });
    byClip.set(issue.video_clip_id, items);
  }
  const swings: ReadableSwing[] = recent.map((c) => ({ id: c.id, serial: c.readable_game_serial, date: c.game_log_entries.date,
    sessionType: "game", readable: true, findings: byClip.get(c.id) ?? [] }));
  // The counter survives deleted clips. This empty marker preserves the total
  // for the early-read threshold without asserting that a deleted swing had a finding.
  const total = player.readable_game_swing_count as number;
  if (total >= 3 && swings.length < 3) {
    // With too few retained clips there is insufficient evidence for a focus.
    return;
  }
  const records = (focuses ?? []) as StoredFocus[];
  const old = records.find((f) => f.ended_at === null) ?? null;
  const history = records.filter((f) => f.ended_at !== null).map(model);
  const result = advanceFocus(swings, old ? model(old) : null, history);
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
