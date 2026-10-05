/**
 * Reads everything the local database holds for ONE player into a
 * SourceSnapshot. Deliberately loads the player's whole subtree (not just the
 * allowlisted clips) so buildFixture() can report what was excluded and why;
 * nothing unselected ever reaches the fixture.
 */
import type { SupabaseClient } from "@supabase/supabase-js";
import type { SourceSnapshot } from "./buildFixture.js";
import type { Row } from "./translation.js";

const PAGE = 1000;

async function all(client: SupabaseClient, table: string, build: (q: any) => any): Promise<Row[]> { // eslint-disable-line @typescript-eslint/no-explicit-any
  const out: Row[] = [];
  for (let from = 0; ; from += PAGE) {
    const { data, error } = await build(client.from(table).select("*")).order("id").range(from, from + PAGE - 1);
    if (error) throw new Error(`loading public.${table}: ${error.message}`);
    out.push(...((data ?? []) as Row[]));
    if (!data || data.length < PAGE) return out;
  }
}

async function inList(client: SupabaseClient, table: string, column: string, ids: string[]): Promise<Row[]> {
  const out: Row[] = [];
  for (let i = 0; i < ids.length; i += 200) {
    const chunk = ids.slice(i, i + 200);
    out.push(...(await all(client, table, (q) => q.in(column, chunk))));
  }
  return out;
}

export async function loadSourceSnapshot(client: SupabaseClient, teamSlug: string, playerSlug: string): Promise<SourceSnapshot> {
  const { data: team, error: teamErr } = await client.from("teams").select("*").eq("slug", teamSlug).maybeSingle();
  if (teamErr) throw new Error(`loading team "${teamSlug}": ${teamErr.message}`);
  if (!team) throw new Error(`no local team with slug "${teamSlug}"`);
  const { data: player, error: playerErr } = await client.from("players").select("*").eq("team_id", team.id).eq("slug", playerSlug).maybeSingle();
  if (playerErr) throw new Error(`loading player "${playerSlug}": ${playerErr.message}`);
  if (!player) throw new Error(`no player "${playerSlug}" on team "${teamSlug}"`);
  const playerId = player.id as string;

  // Read the current guardian links with the service-role client. A failed
  // lookup must never be interpreted as "no linked guardians" for publication.
  const linkedGuardianUserIds: string[] = [];
  for (let from = 0; ; from += PAGE) {
    const { data, error } = await client.from("player_guardians").select("user_id")
      .eq("player_id", playerId).order("user_id").range(from, from + PAGE - 1);
    if (error) throw new Error(`loading linked guardians: ${error.message}`);
    linkedGuardianUserIds.push(...(data ?? []).map((row) => row.user_id));
    if (!data || data.length < PAGE) break;
  }

  const game_log_entries = await all(client, "game_log_entries", (q) => q.eq("player_id", playerId));
  const entryIds = game_log_entries.map((e) => e.id as string);
  const [at_bat_pitches, video_clips] = await Promise.all([
    inList(client, "at_bat_pitches", "game_log_entry_id", entryIds),
    inList(client, "video_clips", "game_log_entry_id", entryIds),
  ]);
  const clipIds = video_clips.map((c) => c.id as string);
  const [video_clip_metrics, video_clip_pose3d, swing_phases, analysis_runs, checklist_scores, issues, player_priorities, practice_sessions] = await Promise.all([
    inList(client, "video_clip_metrics", "video_clip_id", clipIds),
    inList(client, "video_clip_pose3d", "video_clip_id", clipIds),
    inList(client, "swing_phases", "video_clip_id", clipIds),
    all(client, "analysis_runs", (q) => q.eq("player_id", playerId)),
    all(client, "checklist_scores", (q) => q.eq("player_id", playerId)),
    all(client, "issues", (q) => q.eq("player_id", playerId)),
    all(client, "player_priorities", (q) => q.eq("player_id", playerId)),
    all(client, "practice_sessions", (q) => q.eq("player_id", playerId)),
  ]);
  const priorityIds = player_priorities.map((p) => p.id as string);
  const [checklist_score_history, player_priority_status_history, player_priority_drills, player_priority_observations, practice_repetitions, drill_library, checkpoints, swing_phase_types] = await Promise.all([
    inList(client, "checklist_score_history", "checklist_score_id", checklist_scores.map((x) => x.id as string)),
    inList(client, "player_priority_status_history", "player_priority_id", priorityIds),
    inList(client, "player_priority_drills", "player_priority_id", priorityIds),
    inList(client, "player_priority_observations", "player_priority_id", priorityIds),
    inList(client, "practice_repetitions", "practice_session_id", practice_sessions.map((x) => x.id as string)),
    // Global drills + this team's own; another team's drills are never loaded.
    all(client, "drill_library", (q) => q.or(`team_id.is.null,team_id.eq.${team.id}`)),
    all(client, "checkpoints", (q) => q),
    all(client, "swing_phase_types", (q) => q),
  ]);

  return {
    team: team as Row,
    player: player as Row,
    linkedGuardianUserIds,
    rows: {
      game_log_entries, at_bat_pitches, video_clips, video_clip_metrics, video_clip_pose3d, swing_phases, analysis_runs,
      checklist_scores, checklist_score_history, issues, player_priorities, player_priority_status_history,
      player_priority_drills, player_priority_observations, practice_sessions, practice_repetitions, drill_library,
      checkpoints, swing_phase_types,
    },
  };
}
