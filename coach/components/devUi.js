// Shared page plumbing for the player-development pages (development / review /
// compare / atbat / session): session + player context, the tab bar, modal/toast
// helpers and the small set of Supabase loaders they all reuse. Pure decision
// logic lives in developmentLogic.js (unit-tested); this file only touches the
// DOM and Supabase.
import { supabase, requireSession, getMyDisplayName, qs, escapeHtml } from "../shared.js";
import { renderPlayerAppBar, renderBottomNav, loadRosterWithProgress, setLastPlayerSlug } from "./appShell.js";
import { closeableModal } from "./compModal.js";
import * as L from "./developmentLogic.js";

export { escapeHtml, supabase, qs, L };

export function fmtDate(d) {
  if (!d) return "";
  const dt = new Date(String(d).length <= 10 ? `${d}T12:00:00` : d);
  return dt.toLocaleDateString(undefined, { month: "short", day: "numeric" });
}

export function toast(msg) {
  const el = document.createElement("div");
  el.setAttribute("role", "status");
  el.style.cssText =
    "position:fixed;left:50%;bottom:84px;transform:translateX(-50%);background:var(--surface-2);color:var(--text-primary);border:1px solid var(--border);padding:10px 16px;border-radius:24px;z-index:9999;font-weight:600;max-width:90vw;";
  el.textContent = msg;
  document.body.appendChild(el);
  setTimeout(() => el.remove(), 2600);
}

export function emptyState(title, body, actionHtml = "") {
  return `<div class="dev-empty"><b>${escapeHtml(title)}</b>${escapeHtml(body)}${actionHtml ? `<div class="dev-btns" style="justify-content:center;">${actionHtml}</div>` : ""}</div>`;
}

export function pill(status, text) {
  const cls = String(status ?? "").replace(/_/g, "-");
  return `<span class="pill ${escapeHtml(cls)}">${escapeHtml(text ?? status)}</span>`;
}

/** Opens a bottom-sheet-ish modal with a form. `html` must contain a .close-btn.
 * Returns the backdrop element; caller wires its own handlers. */
export function openSheet(title, bodyHtml) {
  return closeableModal(
    `<div class="modal"><button class="close-btn tap-target" aria-label="Close">✕</button><h2 style="margin-top:0;">${escapeHtml(title)}</h2>${bodyHtml}</div>`,
  );
}

/** Shapes the page context object from an already-loaded player row (with its
 * team embedded as `teams`). Pages that start from a clip/entry id (review,
 * atbat, session) use this after resolving the player themselves. */
export function buildContext(session, coachName, player) {
  const teamSlug = player.teams.slug;
  const playerSlug = player.slug;
  setLastPlayerSlug(teamSlug, playerSlug);
  return {
    session,
    coachId: session.user.id,
    coachName,
    player,
    team: player.teams,
    teamSlug,
    playerSlug,
    url: (page, extra = {}) => {
      const q = new URLSearchParams({ team: teamSlug, player: playerSlug, ...extra });
      return `./${page}.html?${q}`;
    },
  };
}

export const PLAYER_SELECT = "id, name, jersey_number, slug, teams!inner(id, slug, name)";

/** Loads session, current player/team, coach name from ?team=&player=. Redirects when signed out. */
export async function loadContext() {
  const session = await requireSession();
  if (!session) return null;
  const coachName = await getMyDisplayName(session.user.id);
  const { data: player, error } = await supabase
    .from("players")
    .select(PLAYER_SELECT)
    .eq("slug", qs("player"))
    .eq("teams.slug", qs("team"))
    .single();
  if (error || !player) {
    showNotFound();
    return null;
  }
  return buildContext(session, coachName, player);
}

export function showNotFound(message = "This link may be wrong, or you don't have access to it.") {
  document.querySelector(".wrap").innerHTML = emptyState(
    "Not found",
    message,
    `<a class="dev-btn" href="./index.html">Back to My Teams</a>`,
  );
}

/** App bar + tab bar + bottom nav. `active` is one of report|development|compare|practice. */
export async function renderHeader(ctx, active) {
  const { roster, confirmedCount, totalCount } = await loadRosterWithProgress(ctx.team.id);
  renderPlayerAppBar(document.getElementById("appBar"), {
    player: ctx.player,
    teamName: ctx.team.name,
    teamSlug: ctx.teamSlug,
    roster,
    confirmedCount,
    totalCount,
  });
  const tabs = [
    ["report", "Report", "player"],
    ["development", "Development", "development"],
    ["compare", "Compare", "compare"],
    ["practice", "Practice", "session"],
  ];
  const el = document.getElementById("devTabs");
  if (el) {
    el.className = "dev-tabs";
    el.innerHTML = tabs
      .map(([key, label, page]) => `<a href="${ctx.url(page)}" ${key === active ? 'aria-current="page"' : ""}>${label}</a>`)
      .join("");
  }
  const nav = document.getElementById("bottomNav");
  if (nav) {
    renderBottomNav(nav, {
      teamSlug: ctx.teamSlug,
      activeTab: "report",
      reportHref: ctx.url("player"),
      logAbHref: ctx.url("player"),
    });
  }
}

// ---------------------------------------------------------------------------
// Loaders
// ---------------------------------------------------------------------------

export async function loadPriorities(playerId, statuses = null) {
  let q = supabase.from("player_priorities").select("*").eq("player_id", playerId);
  if (statuses) q = q.in("status", statuses);
  const { data, error } = await q;
  if (error) throw new Error(`Couldn't load priorities: ${error.message}`);
  return L.orderPriorities(data ?? []);
}

export async function loadObservations(priorityIds, limit = 300) {
  if (!priorityIds.length) return [];
  const { data, error } = await supabase
    .from("player_priority_observations")
    .select("*")
    .in("player_priority_id", priorityIds)
    .order("observed_at", { ascending: false })
    .limit(limit);
  if (error) throw new Error(`Couldn't load observations: ${error.message}`);
  return data ?? [];
}

export async function loadDrillLibrary(teamId) {
  const { data, error } = await supabase
    .from("drill_library")
    .select("*")
    .eq("is_active", true)
    .or(`team_id.is.null,team_id.eq.${teamId}`)
    .order("name");
  if (error) throw new Error(`Couldn't load drills: ${error.message}`);
  return data ?? [];
}

export async function loadDrillAssignments(priorityIds) {
  if (!priorityIds.length) return [];
  const { data, error } = await supabase
    .from("player_priority_drills")
    .select("*, drill_library(id, name, purpose, instructions, equipment, age_notes)")
    .in("player_priority_id", priorityIds)
    .order("assigned_at", { ascending: false });
  if (error) throw new Error(`Couldn't load drill assignments: ${error.message}`);
  return data ?? [];
}

/** Lightweight swing list (no pose3d, no metrics): one row per clip with the
 * pitch / practice-rep context needed for filters and pickers. Paginated. */
export async function loadSwingRecords(playerId, { limit = 40, offset = 0 } = {}) {
  const { data, error } = await supabase
    .from("video_clips")
    .select(
      "id, status, created_at, game_log_entry_id, at_bat_pitch_id, practice_repetition_id, " +
        "game_log_entries!inner(id, date, opponent, ab, session_type, player_id), " +
        "at_bat_pitches(id, pitch_number, pitch_outcome, swung, count_before_balls, count_before_strikes, pitch_type, pitch_location), " +
        "practice_repetitions(id, rep_number, grouping, usable, practice_session_id, practice_sessions(assigned_drill_id))",
    )
    .eq("game_log_entries.player_id", playerId)
    .order("created_at", { ascending: false })
    .range(offset, offset + limit - 1);
  if (error) throw new Error(`Couldn't load swings: ${error.message}`);
  const rows = data ?? [];
  const ids = rows.map((r) => r.id);
  const [{ data: obs }, { data: iss }] = ids.length
    ? await Promise.all([
        supabase.from("player_priority_observations").select("video_clip_id, player_priority_id").in("video_clip_id", ids),
        supabase.from("issues").select("id, video_clip_id, review_status").in("video_clip_id", ids),
      ])
    : [{ data: [] }, { data: [] }];
  return rows
    .map((r) => {
      const e = r.game_log_entries;
      const p = r.at_bat_pitches;
      const rep = r.practice_repetitions;
      const clipObs = (obs ?? []).filter((o) => o.video_clip_id === r.id);
      const clipIssues = (iss ?? []).filter((i) => i.video_clip_id === r.id);
      return {
        clipId: r.id,
        status: r.status,
        context: e.session_type,
        date: e.date,
        opponent: e.opponent,
        ab: e.ab,
        entryId: e.id,
        pitchId: p?.id ?? null,
        pitchNumber: p?.pitch_number ?? null,
        repId: rep?.id ?? null,
        repNumber: rep?.rep_number ?? null,
        sessionId: rep?.practice_session_id ?? null,
        grouping: rep?.grouping ?? null,
        usable: rep?.usable ?? null,
        swung: p ? p.swung ?? L.swungFromOutcome(p.pitch_outcome) : e.session_type === "practice" ? true : null,
        balls: p?.count_before_balls ?? null,
        strikes: p?.count_before_strikes ?? null,
        pitchType: p?.pitch_type ?? null,
        pitchLocation: p?.pitch_location ?? null,
        priorityIds: [...new Set(clipObs.map((o) => o.player_priority_id))],
        issueIds: clipIssues.map((i) => i.id),
        drillIds: rep?.practice_sessions?.assigned_drill_id ? [rep.practice_sessions.assigned_drill_id] : [],
        reviewed: clipObs.length > 0 || clipIssues.some((i) => i.review_status !== "draft"),
      };
    })
    .sort((a, b) => String(b.date).localeCompare(String(a.date)) || (b.pitchNumber ?? b.repNumber ?? 0) - (a.pitchNumber ?? a.repNumber ?? 0));
}

export async function loadPhases(clipId) {
  const { data } = await supabase
    .from("swing_phases")
    .select("frame, time_s, confidence, reconstruction_reliable, swing_phase_types!inner(slug, label, sort_order)")
    .eq("video_clip_id", clipId)
    .order("sort_order", { referencedTable: "swing_phase_types" });
  return (data ?? []).map((r) => ({
    slug: r.swing_phase_types.slug,
    label: r.swing_phase_types.label,
    timeS: r.time_s,
    confidence: r.confidence,
    reconstructionReliable: r.reconstruction_reliable,
  }));
}

export async function getVideoUrl(clipId) {
  const { data } = await supabase.functions.invoke("get-video-url", { body: { videoClipId: clipId } });
  return data?.url ?? null;
}

export function lastComparisonKey(playerId) {
  return `coach:lastComparison:${playerId}`;
}
