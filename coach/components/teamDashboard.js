// Team attention summary. Phase 1B changes hierarchy, not data meaning.
import { supabase, escapeHtml } from "../shared.js";
import * as L from "./developmentLogic.js";
import { fmtDate } from "./devUi.js";
import { card, disclosure, emptyState, icon, listRow, statusChip } from "./ui.js";
import { teamAttentionModel } from "./phase1bScreens.js";

const RECENT = 5;
const link = (page, player, extra = {}) => `./${page}.html?${new URLSearchParams({ team: player.teamSlug, player: player.slug, ...extra })}`;

export async function loadTeamDashboard(teamId, teamSlug) {
  const [pri, drafts, sessions, gameEntries, clips, obs] = await Promise.all([
    supabase.from("player_priorities").select("id, title, status, follow_up_kind, follow_up_date, follow_up_swings, follow_up_set_at, follow_up_done_at, priority_order, players!inner(id, name, slug, team_id)").eq("players.team_id", teamId).in("status", ["active", "monitoring"]),
    supabase.from("issues").select("player_id, video_clip_id, created_at, players!inner(team_id)").eq("players.team_id", teamId).eq("review_status", "draft").order("created_at", { ascending: false }),
    supabase.from("practice_sessions").select("id, session_date, outcome, focus_priority_id, players!inner(id, name, slug, team_id), practice_repetitions(id)").eq("players.team_id", teamId).order("session_date", { ascending: false }).limit(60),
    supabase.from("game_log_entries").select("id, date, player_id, players!inner(team_id)").eq("players.team_id", teamId).eq("session_type", "game").order("date", { ascending: false }).limit(300),
    supabase.from("video_clips").select("id, created_at, status, game_log_entries!inner(id, date, ab, session_type, player_id, players!inner(id, name, slug, team_id)), at_bat_pitches(pitch_number)").eq("game_log_entries.players.team_id", teamId).eq("game_log_entries.session_type", "game").eq("status", "ready").order("created_at", { ascending: false }).limit(RECENT),
    supabase.from("player_priority_observations").select("id, status, coach_note, observed_at, player_priorities!inner(title, players!inner(name, slug, team_id))").eq("player_priorities.players.team_id", teamId).order("observed_at", { ascending: false }).limit(RECENT),
  ]);
  for (const result of [pri, drafts, sessions, gameEntries, clips, obs]) if (result.error) throw new Error(result.error.message);
  const withSlug = (p) => ({ ...p, teamSlug });
  const priorities = (pri.data ?? []).map((p) => ({ ...p, player: withSlug(p.players) }));
  const needsReview = new Map();
  for (const draft of drafts.data ?? []) needsReview.set(draft.player_id, (needsReview.get(draft.player_id) ?? 0) + 1);
  const byPlayer = (rows, key, value) => {
    const map = new Map();
    for (const row of rows) { const id = key(row); if (!map.has(id)) map.set(id, []); map.get(id).push(value(row)); }
    return map;
  };
  const practiceDates = byPlayer(sessions.data ?? [], (s) => s.players.id, (s) => s.session_date);
  const gameDates = byPlayer(gameEntries.data ?? [], (g) => g.player_id, (g) => g.date);
  let swingDates = new Map();
  if (priorities.some((p) => p.follow_up_kind === "after_swings")) {
    const { data } = await supabase.from("video_clips").select("created_at, game_log_entries!inner(player_id, players!inner(team_id))").eq("game_log_entries.players.team_id", teamId).limit(2000);
    swingDates = byPlayer(data ?? [], (c) => c.game_log_entries.player_id, (c) => c.created_at);
  }
  const dueFollowUps = priorities.filter((p) => L.isFollowUpDue(p, { now: new Date(), practiceSessionDates: practiceDates.get(p.players.id) ?? [], gameDates: gameDates.get(p.players.id) ?? [], swingDates: swingDates.get(p.players.id) ?? [] }));
  const players = new Map();
  for (const priority of priorities) {
    if (!players.has(priority.players.id)) players.set(priority.players.id, { player: withSlug(priority.players), priorities: [] });
    players.get(priority.players.id).priorities.push(priority);
  }
  for (const group of players.values()) group.priorities = L.orderPriorities(group.priorities);
  return { needsReview: [...needsReview.entries()].map(([id, n]) => ({ id, n })), draftIssues: drafts.data ?? [], players: [...players.values()], dueFollowUps,
    sessions: (sessions.data ?? []).slice(0, RECENT).map((s) => ({ ...s, player: withSlug(s.players) })),
    swings: (clips.data ?? []).map((c) => ({ ...c, player: withSlug(c.game_log_entries.players) })),
    progress: (obs.data ?? []).map((o) => ({ ...o, player: withSlug(o.player_priorities.players) })), teamSlug };
}

export async function renderTeamDashboard(el, teamId, teamSlug, rosterById = new Map()) {
  let data;
  try { data = await loadTeamDashboard(teamId, teamSlug); }
  catch (error) { el.innerHTML = `<p class="error-text">Couldn't load the team summary: ${escapeHtml(error.message)}</p>`; return null; }
  const attention = teamAttentionModel(data);
  const firstDraft = data.draftIssues.find((issue) => issue.video_clip_id);
  const followUps = data.dueFollowUps.slice(0, 3).map((priority) => listRow({ href: link("development", priority.player), title: priority.player.name, supporting: `${priority.title} · ${L.followUpLabel(priority)}`, trailing: icon("chevron-right", { size: 20 }) })).join("");
  const today = card(`<div class="p1b-today-head">${attention.reviewCount || attention.dueCount ? "<h2>Today</h2>" : icon("circle-check", { size: 24 })}<strong>${escapeHtml(attention.headline)}</strong></div>
    ${attention.reviewCount && firstDraft ? `<a class="bt-button bt-button-primary p1b-full-button" href="./review.html?clip=${encodeURIComponent(firstDraft.video_clip_id)}&team=${encodeURIComponent(teamSlug)}">Review pending swings</a>` : ""}
    ${followUps ? `<div class="p1b-followups">${followUps}</div>` : ""}`, { className: "p1b-today" });
  const activity = [];
  for (const item of data.progress) activity.push({ date: item.observed_at, html: listRow({ href: link("development", item.player), title: `${item.player.name} · ${item.player_priorities.title}`, supporting: `${L.OBSERVATION_LABELS[item.status] ?? item.status} · ${fmtDate(item.observed_at)}`, trailing: statusChip(item.status, { domain: "progress" }) }) });
  for (const item of data.sessions) activity.push({ date: item.session_date, html: listRow({ href: link("session", item.player, { session: item.id }), title: `${item.player.name} · Practice`, supporting: `${fmtDate(item.session_date)} · ${item.practice_repetitions.length} reps`, trailing: icon("chevron-right", { size: 20 }) }) });
  for (const item of data.swings) activity.push({ date: item.created_at, html: listRow({ href: `./review.html?clip=${item.id}&team=${encodeURIComponent(teamSlug)}&player=${encodeURIComponent(item.player.slug)}`, title: `${item.player.name} · Game swing`, supporting: `${fmtDate(item.game_log_entries.date)}${item.at_bat_pitches?.pitch_number ? ` · Pitch ${item.at_bat_pitches.pitch_number}` : ""}`, trailing: icon("chevron-right", { size: 20 }) }) });
  activity.sort((a, b) => new Date(b.date) - new Date(a.date));
  const recent = activity.length ? activity.slice(0, RECENT).map((x) => x.html).join("") : emptyState("No recent activity", "Practice and game reviews will appear here.");
  el.innerHTML = today;
  const recentMount = document.getElementById("teamRecent");
  if (recentMount) recentMount.innerHTML = disclosure("Recent activity", `<div class="bt-list p1b-compact-list">${recent}</div>`);
  return data;
}
