// Team dashboard: the value-first summary a coach wants on opening a team -
// who needs review, what everyone is working on, what's due, what happened
// recently. Deliberately not analytics: every block is a short list that links
// into the player-level pages (which own all the real work).
import { supabase, escapeHtml } from "../shared.js";
import * as L from "./developmentLogic.js";
import { emptyState, pill, fmtDate } from "./devUi.js";

const RECENT = 5;

function link(page, player, extra = {}) {
  const q = new URLSearchParams({ team: player.teamSlug, player: player.slug, ...extra });
  return `./${page}.html?${q}`;
}

/** Loads every dashboard block in a handful of batched queries (no per-player round trips). */
export async function loadTeamDashboard(teamId, teamSlug) {
  const [pri, drafts, sessions, gameEntries, clips, obs] = await Promise.all([
    supabase.from("player_priorities")
      .select("id, title, status, follow_up_kind, follow_up_date, follow_up_swings, follow_up_set_at, follow_up_done_at, priority_order, players!inner(id, name, slug, team_id)")
      .eq("players.team_id", teamId).in("status", ["active", "monitoring"]),
    supabase.from("issues").select("player_id, players!inner(team_id)").eq("players.team_id", teamId).eq("review_status", "draft"),
    supabase.from("practice_sessions")
      .select("id, session_date, outcome, focus_priority_id, players!inner(id, name, slug, team_id), practice_repetitions(id)")
      .eq("players.team_id", teamId).order("session_date", { ascending: false }).limit(60),
    supabase.from("game_log_entries").select("id, date, player_id, players!inner(team_id)").eq("players.team_id", teamId).eq("session_type", "game").order("date", { ascending: false }).limit(300),
    supabase.from("video_clips")
      .select("id, created_at, status, game_log_entries!inner(id, date, session_type, player_id, players!inner(id, name, slug, team_id)), at_bat_pitches(pitch_number)")
      .eq("game_log_entries.players.team_id", teamId).eq("game_log_entries.session_type", "game").eq("status", "ready")
      .order("created_at", { ascending: false }).limit(RECENT),
    supabase.from("player_priority_observations")
      .select("id, status, coach_note, observed_at, player_priorities!inner(title, players!inner(name, slug, team_id))")
      .eq("player_priorities.players.team_id", teamId).order("observed_at", { ascending: false }).limit(RECENT),
  ]);
  for (const r of [pri, drafts, sessions, gameEntries, clips, obs]) if (r.error) throw new Error(r.error.message);

  const withSlug = (p) => ({ ...p, teamSlug });
  const priorities = (pri.data ?? []).map((p) => ({ ...p, player: withSlug(p.players) }));

  const needsReview = new Map();
  for (const d of drafts.data ?? []) needsReview.set(d.player_id, (needsReview.get(d.player_id) ?? 0) + 1);

  // Follow-ups: a player's own practice/game/swing dates decide "due".
  const byPlayer = (rows, key, f) => {
    const m = new Map();
    for (const r of rows) { const k = key(r); if (!m.has(k)) m.set(k, []); m.get(k).push(f(r)); }
    return m;
  };
  const practiceDates = byPlayer(sessions.data ?? [], (s) => s.players.id, (s) => s.session_date);
  const gameDates = byPlayer(gameEntries.data ?? [], (g) => g.player_id, (g) => g.date);
  let swingDates = new Map();
  if (priorities.some((p) => p.follow_up_kind === "after_swings")) {
    const { data } = await supabase.from("video_clips").select("created_at, game_log_entries!inner(player_id, players!inner(team_id))").eq("game_log_entries.players.team_id", teamId).limit(2000);
    swingDates = byPlayer(data ?? [], (c) => c.game_log_entries.player_id, (c) => c.created_at);
  }
  const now = new Date();
  const dueFollowUps = priorities.filter((p) => L.isFollowUpDue(p, {
    now, practiceSessionDates: practiceDates.get(p.players.id) ?? [], gameDates: gameDates.get(p.players.id) ?? [], swingDates: swingDates.get(p.players.id) ?? [],
  }));

  // Players grouped with their active priorities, those with any priority first.
  const players = new Map();
  for (const p of priorities) {
    if (!players.has(p.players.id)) players.set(p.players.id, { player: withSlug(p.players), priorities: [] });
    players.get(p.players.id).priorities.push(p);
  }
  for (const g of players.values()) g.priorities = L.orderPriorities(g.priorities);

  return {
    needsReview: [...needsReview.entries()].map(([id, n]) => ({ id, n })),
    players: [...players.values()],
    dueFollowUps,
    sessions: (sessions.data ?? []).slice(0, RECENT).map((s) => ({ ...s, player: withSlug(s.players) })),
    swings: (clips.data ?? []).map((c) => ({ ...c, player: withSlug(c.game_log_entries.players) })),
    progress: (obs.data ?? []).map((o) => ({ ...o, player: withSlug(o.player_priorities.players) })),
    teamSlug,
  };
}

export async function renderTeamDashboard(el, teamId, teamSlug, rosterById = new Map()) {
  let d;
  try { d = await loadTeamDashboard(teamId, teamSlug); }
  catch (e) { el.innerHTML = `<p class="error-text">Couldn't load the team summary: ${escapeHtml(e.message)}</p>`; return; }

  const nameFor = (id) => rosterById.get(id);
  const block = (title, body) => `<div class="dev-card"><h3>${title}</h3>${body}</div>`;
  const list = (rows, empty) => rows.length ? `<ul style="margin:6px 0 0;padding-left:18px;">${rows.join("")}</ul>` : `<p class="hint" style="margin:6px 0 0;">${empty}</p>`;

  const review = d.needsReview
    .map((r) => ({ ...r, player: nameFor(r.id) })).filter((r) => r.player)
    .sort((a, b) => b.n - a.n)
    .map((r) => `<li><a href="${link("development", r.player)}">${escapeHtml(r.player.name)}</a> <span class="hint">· ${r.n} AI observation${r.n === 1 ? "" : "s"}</span></li>`);

  const active = d.players.map((g) => `<li><a href="${link("development", g.player)}">${escapeHtml(g.player.name)}</a>: ${g.priorities.slice(0, 2).map((p) => escapeHtml(p.title)).join(", ")}${g.priorities.length > 2 ? ` <span class="hint">+${g.priorities.length - 2}</span>` : ""}</li>`);

  const due = d.dueFollowUps.map((p) => `<li><a href="${link("development", p.player)}">${escapeHtml(p.player.name)}</a> — ${escapeHtml(p.title)} <span class="hint">· ${escapeHtml(L.followUpLabel(p))}</span></li>`);

  const practice = d.sessions.map((s) => `<li><a href="${link("session", s.player, { session: s.id })}">${escapeHtml(s.player.name)} · ${fmtDate(s.session_date)}</a> <span class="hint">· ${s.practice_repetitions.length} rep${s.practice_repetitions.length === 1 ? "" : "s"}${s.outcome ? " · " + L.OUTCOME_LABELS[s.outcome] : ""}</span></li>`);

  const swings = d.swings.map((c) => {
    const e = c.game_log_entries;
    const pn = c.at_bat_pitches?.pitch_number;
    return `<li><a href="./review.html?clip=${c.id}&team=${encodeURIComponent(teamSlug)}&player=${encodeURIComponent(c.player.slug)}">${escapeHtml(c.player.name)} · ${fmtDate(e.date)}</a> <span class="hint">· AB ${escapeHtml(e.ab)}${pn ? ` · pitch ${pn}` : ""}</span></li>`;
  });

  const progress = d.progress.map((o) => `<li><a href="${link("development", o.player)}">${escapeHtml(o.player.name)}</a> — ${escapeHtml(o.player_priorities.title)}: ${pill(o.status, L.OBSERVATION_LABELS[o.status] ?? o.status)} <span class="hint">${fmtDate(o.observed_at)}</span></li>`);

  el.innerHTML = `
    <div class="dev-grid">
      ${block("Needs review", list(review, "No AI observations are waiting for you."))}
      ${block("Follow-ups due", list(due, "Nothing is due."))}
      ${block("Active priorities", list(active, "No active priorities yet. Review a swing and promote an observation to begin tracking development."))}
      ${block("Recent progress", list(progress, "No progress notes yet."))}
      ${block("Recent practice", list(practice, "No practice sessions yet."))}
      ${block("Recent game swings", list(swings, "No analyzed game swings yet."))}
    </div>`;
}
