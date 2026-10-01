// Shared page plumbing for the player-development pages (development / review /
// compare / atbat / session): session + player context, the tab bar, modal/toast
// helpers and the small set of Supabase loaders they all reuse. Pure decision
// logic lives in developmentLogic.js (unit-tested); this file only touches the
// DOM and Supabase.
import { supabase, requireSession, getMyDisplayName, qs, escapeHtml } from "../shared.js";
import { getDemoConfig, isDemoMode } from "../demoConfig.js";
import { renderPlayerAppBar, renderBottomNav, loadRosterWithProgress, setLastPlayerSlug } from "./appShell.js";
import {
  confirmDialog, emptyState as emptyStatePrimitive, mountSegmentedTabs, openBottomSheet,
  showSnackbar, statusChip,
} from "./ui.js";
import { PLAYER_TABS } from "./shellState.js";
import * as L from "./developmentLogic.js";
import { readSubjectBox } from "./subjectZoom.js";

export { confirmDialog, escapeHtml, showSnackbar, statusChip, supabase, qs, L };

export function fmtDate(d) {
  if (!d) return "";
  const dt = new Date(String(d).length <= 10 ? `${d}T12:00:00` : d);
  return dt.toLocaleDateString(undefined, { month: "short", day: "numeric" });
}

export function toast(msg) {
  return showSnackbar(msg, { duration: 3200 });
}

export function emptyState(title, body, actionHtml = "") {
  return emptyStatePrimitive(title, body, actionHtml);
}

export function pill(status, text) {
  return statusChip(status, { label: text ?? status });
}

/** Opens a bottom-sheet-ish modal with a form. `html` must contain a .close-btn.
 * Returns the backdrop element; caller wires its own handlers. */
export function openSheet(title, bodyHtml, footerHtml = "") {
  const sheet = openBottomSheet({ title, bodyHtml, footerHtml });
  // Compatibility for existing forms that close themselves after a save.
  sheet.querySelector(".bt-sheet-close")?.classList.add("close-btn");
  return sheet;
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

export const PLAYER_SELECT = "id, name, jersey_number, slug, what_to_check_next, teams!inner(id, slug, name)";

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
  const { roster } = await loadRosterWithProgress(ctx.team.id);
  renderPlayerAppBar(document.getElementById("appBar"), {
    player: ctx.player,
    teamName: ctx.team.name,
    teamSlug: ctx.teamSlug,
    roster,
  });
  const tabs = PLAYER_TABS;
  const el = document.getElementById("devTabs");
  if (el) {
    mountSegmentedTabs(el, tabs.map(({ key, label, page }) => ({ key, label, href: ctx.url(page) })), active, { label: "Player sections" });
  }
  const nav = document.getElementById("bottomNav");
  if (nav) {
    renderBottomNav(nav, {
      teamSlug: ctx.teamSlug,
      activeTab: "report",
      reportHref: ctx.url("player"),
      currentPlayer: ctx.player,
      roster,
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
        createdAt: r.created_at,
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
    .select("frame, time_s, confidence, reconstruction_reliable, detail, swing_phase_types!inner(slug, label, sort_order)")
    .eq("video_clip_id", clipId)
    .order("sort_order", { referencedTable: "swing_phase_types" });
  const order = new Map(["stance", "load", "stride", "contact", "extension", "follow-through"].map((slug, index) => [slug, index]));
  return (data ?? []).map((r) => ({
    slug: r.swing_phase_types.slug,
    label: r.swing_phase_types.label,
    timeS: r.time_s,
    confidence: r.confidence,
    reconstructionReliable: r.reconstruction_reliable,
    subjectBox: readSubjectBox(r.detail),
  })).sort((a, b) => (order.get(a.slug) ?? 99) - (order.get(b.slug) ?? 99));
}

// Seconds to add to an analysis timestamp (swing_phases.time_s, pose frame
// time_s - relative to the pipeline's analysis window) to reach the same
// moment in the video element's own timeline. 0 for production's original
// upload; demo_media_offset_s for a trimmed, curated demo clip.
const videoOffsets = new Map();

/** Public URL of a curated demo clip, or null. Pure: the path is validated
 * against the same safe-filename rule the database enforces, and only ever
 * resolved under the demo's own static media directory - never a bucket or
 * signed URL (get-video-url is deliberately not deployed for the demo). */
export function demoMediaUrl(mediaPath, basePath = getDemoConfig().basePath) {
  if (typeof mediaPath !== "string" || !/^[a-z0-9][a-z0-9._-]{0,120}\.mp4$/.test(mediaPath)) return null;
  return `${String(basePath || "./").replace(/\/?$/, "/")}media/${mediaPath}`;
}

export async function getVideoUrl(clipId) {
  if (isDemoMode()) {
    // Only curated clips exported with a published media file have one;
    // everything else keeps the explicit "no video published" state.
    const { data } = await supabase.from("video_clips").select("demo_media_path, demo_media_offset_s").eq("id", clipId).maybeSingle();
    const url = demoMediaUrl(data?.demo_media_path);
    const offset = Number(data?.demo_media_offset_s);
    if (!url || !Number.isFinite(offset)) return null; // unknown alignment: never show misaligned phase markers
    videoOffsets.set(clipId, offset);
    return url;
  }
  const { data } = await supabase.functions.invoke("get-video-url", { body: { videoClipId: clipId } });
  videoOffsets.set(clipId, 0);
  return data?.url ?? null;
}

// Seek 1 ms INTO the target frame. A frame's analysis time (index / fps) and
// its container timestamp differ by rounding (e.g. frame 142 at 29.871 fps:
// 4.7537317 s vs a stored pts of 4.753732 s), and seeking to the exact value
// lands a hair before the frame's pts, so the browser shows the PREVIOUS
// frame - measured on real demo media: every phase marker was one frame
// early. 1 ms is far below half a frame even at 240 fps (2.08 ms).
export const FRAME_SEEK_EPSILON_S = 0.001;

/** Analysis time -> this clip's video-element time (call after getVideoUrl). */
export function videoTimeFor(clipId, analysisTimeS) {
  return analysisTimeS + (videoOffsets.get(clipId) ?? 0) + FRAME_SEEK_EPSILON_S;
}

export function lastComparisonKey(playerId) {
  return `coach:lastComparison:${playerId}`;
}
