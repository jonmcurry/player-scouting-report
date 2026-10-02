/**
 * Pure core of the real-data demo promotion pipeline: (local source
 * snapshot + human curation manifest) -> demo-shaped fixture + findings.
 * No DB, no fs, no ffmpeg - see sourceLoader.ts / media.ts / the CLIs for
 * those. Everything here is deterministic: the same inputs always produce a
 * byte-identical fixture.
 *
 * Curation rules (docs/research/demo-real-data-promotion.md):
 *   - A clip is exported only if the manifest selects it, it belongs to the
 *     manifest's player, and it's fully processed.
 *   - Findings: approved/edited always; drafts only on explicit opt-in (and
 *     then still review_status='draft', rendered as "Draft from analysis");
 *     rejected never. A finding whose evidence clip isn't allowlisted is
 *     excluded, never re-pointed.
 *   - Checklist scores: coach-reviewed (reviewed_by set) only.
 *   - Coach names are replaced by the manifest's reviewerDisplayName; auth
 *     user ids, share tokens, bucket paths, and worker diagnostics never
 *     leave the machine.
 *   - Human metadata (dates, opponents, counts, outcomes, trim bounds,
 *     publication consent) is taken from the local DB or the manifest's
 *     explicit overrides - missing values are errors, never guesses.
 */
import { createHash } from "node:crypto";
import type { CuratedClip, CurationManifest, TrimBounds } from "./curationManifest.js";
import { IdRemapper } from "./ids.js";
import { buildTargetRow, FIXTURE_TABLE_ORDER, unaccountedSourceColumns, type FixtureTable, type RefTable, type Row } from "./translation.js";
import { FIXTURE_FORMAT, FIXTURE_FORMAT_VERSION, validateFixture, type Finding, type Fixture } from "./validate.js";

/**
 * The only part of a phase's derived evidence a scrubbed (public) export keeps: the batter's
 * normalized position in the frame (swing_phases.detail.subject_box, from the pose pipeline), which
 * drives the app's "Zoom on player" view. It is geometry only - where the batter already visibly is
 * in the published video - and is validated strictly; every other detail field (detector signals,
 * paths, methods) stays withheld.
 */
export function publicPhaseDetail(detail: unknown): Record<string, unknown> {
  const b = (detail as { subject_box?: Record<string, unknown> } | null)?.subject_box;
  const n = (v: unknown) => typeof v === "number" && Number.isFinite(v);
  if (!b || ![b.x, b.y, b.w, b.h].every(n)) return {};
  const x = b.x as number, y = b.y as number, w = b.w as number, h = b.h as number;
  if (x < 0 || y < 0 || w <= 0 || h <= 0 || x + w > 1.0001 || y + h > 1.0001) return {};
  return { subject_box: { x, y, w, h, ...(typeof b.method === "string" && /^[a-z0-9.+-]{1,40}$/.test(b.method) ? { method: b.method } : {}) } };
}

export const EXPORTER = { name: "hitterloop-export-demo-fixture", version: 1 } as const;

/** Everything the local DB holds for ONE player (see sourceLoader.ts), keyed by public table name. */
export interface SourceSnapshot {
  team: Row;
  player: Row;
  rows: {
    game_log_entries: Row[]; at_bat_pitches: Row[]; video_clips: Row[]; video_clip_metrics: Row[];
    video_clip_pose3d: Row[]; swing_phases: Row[]; analysis_runs: Row[]; checklist_scores: Row[];
    checklist_score_history: Row[]; issues: Row[]; player_priorities: Row[]; player_priority_status_history: Row[];
    player_priority_drills: Row[]; player_priority_observations: Row[]; practice_sessions: Row[];
    practice_repetitions: Row[]; drill_library: Row[]; checkpoints: Row[]; swing_phase_types: Row[];
  };
}

export interface ClipContext {
  /** Where analysis time 0 sits in the source video (from stage0.json), or null if unknown. */
  analysisWindowStartS: number | null;
  analysisWindowAmbiguous?: boolean;
}

export interface BuildOptions {
  mediaMode: "planned" | "skipped";
  /** keyed by source clip id */
  clipContext?: Map<string, ClipContext>;
}

export interface Exclusion { table: string; sourceId: string; reason: string }
export interface SelectedClip {
  manifestIndex: number;
  sourceClipId: string;
  clipSlug: string;
  fixtureClipId: string;
  publicFilename: string | null;
  trim: TrimBounds | "full" | null;
  includeAudio: boolean;
  allowLongMedia: boolean;
  analysisWindowStartS: number | null;
  /** Local-only media-stage inputs - never written to fixture.json. */
  local: { sourceVideo: string | null; rawGcsPath: string | null };
  /** Privacy-treated media reference (local only). */
  privacy: { name: string; dir: string | null } | null;
  /** The analyzed clip's frame count (treated media must match it exactly). */
  nFrames: number | null;
}

export interface BuildResult {
  fixture: Fixture;
  findings: Finding[];
  exclusions: Exclusion[];
  clips: SelectedClip[];
  sourceIds: Set<string>;
}

const GAME_PITCH_OUTCOMES = new Set(["take", "foul", "ball_in_play"]);
const AB_PITCH_OUTCOMES = new Set(["ball", "called_strike", "swinging_strike", "foul", "ball_in_play", "hit_by_pitch", "take", "other"]);
const GROUPINGS = new Set(["baseline", "drill", "post_drill", "free_swing", "other"]);
const DATE = /^\d{4}-\d{2}-\d{2}$/;

const s = (v: unknown): string => String(v);
const nonEmpty = (v: unknown): boolean => typeof v === "string" && v.trim().length > 0;

/** Stable-key JSON, so the content hash doesn't depend on property insertion order. */
export function canonicalJson(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(",")}]`;
  if (value && typeof value === "object") {
    return `{${Object.keys(value as Row).sort().map((k) => `${JSON.stringify(k)}:${canonicalJson((value as Row)[k])}`).join(",")}}`;
  }
  return JSON.stringify(value ?? null);
}

export function fixtureContentSha256(fx: Fixture): string {
  const { contentSha256: _ignored, ...rest } = fx;
  return createHash("sha256").update(canonicalJson(rest)).digest("hex");
}

export function buildFixture(snapshot: SourceSnapshot, manifest: CurationManifest, opts: BuildOptions): BuildResult {
  const findings: Finding[] = [];
  const exclusions: Exclusion[] = [];
  const overrides: Fixture["curation"]["overrides"] = [];
  const err = (code: string, message: string, table?: string, id?: string) => findings.push({ level: "error", code, message, table, id });
  const warn = (code: string, message: string, table?: string, id?: string) => findings.push({ level: "warning", code, message, table, id });
  const ids = new IdRemapper(manifest.fixtureId);
  const R = snapshot.rows;
  const player = snapshot.player;
  const playerId = s(player.id);

  // ---- 0. Source-schema drift: every source column must have a rule ------------
  const driftCheck: Array<[FixtureTable, Row[]]> = [
    ["players", [player]], ["drill_library", R.drill_library], ["game_log_entries", R.game_log_entries],
    ["at_bat_pitches", R.at_bat_pitches], ["practice_sessions", R.practice_sessions], ["practice_repetitions", R.practice_repetitions],
    ["video_clips", R.video_clips], ["video_clip_metrics", R.video_clip_metrics], ["video_clip_pose3d", R.video_clip_pose3d],
    ["swing_phases", R.swing_phases], ["analysis_runs", R.analysis_runs], ["checklist_scores", R.checklist_scores],
    ["checklist_score_history", R.checklist_score_history], ["issues", R.issues], ["player_priorities", R.player_priorities],
    ["player_priority_status_history", R.player_priority_status_history], ["player_priority_drills", R.player_priority_drills],
    ["player_priority_observations", R.player_priority_observations],
  ];
  for (const [table, rows] of driftCheck) {
    const unknownCols = new Set(rows.flatMap((r) => unaccountedSourceColumns(table, r)));
    if (unknownCols.size) {
      err("SCHEMA_DRIFT", `public.${table} has column(s) with no translation rule: ${[...unknownCols].join(", ")} - add them to ENTITY_SPECS (copy/transform/omit) before exporting`, table);
    }
  }

  // ---- 1. Player / identity ---------------------------------------------------
  if (snapshot.team.slug !== manifest.source.teamSlug || player.slug !== manifest.source.playerSlug || player.team_id !== snapshot.team.id) {
    err("SOURCE_MISMATCH", `source snapshot is ${s(snapshot.team.slug)}/${s(player.slug)}, manifest says ${manifest.source.teamSlug}/${manifest.source.playerSlug}`);
  }

  // ---- 2. Clip allowlist ------------------------------------------------------
  const requirePose3d = manifest.expect?.requirePose3d !== false;
  const includePose3d = manifest.analysis?.includePose3d !== false;
  const requireMetrics = manifest.expect?.requireMetrics === true;
  const clipById = new Map(R.video_clips.map((c) => [s(c.id), c]));
  const phasesByClip = groupBy(R.swing_phases, "video_clip_id");
  const poseByClip = groupBy(R.video_clip_pose3d, "video_clip_id");
  const metricsByClip = groupBy(R.video_clip_metrics, "video_clip_id");
  const selected: Array<{ mc: CuratedClip; clip: Row; index: number }> = [];

  manifest.clips.forEach((mc, index) => {
    const label = mc.sourceClipId ?? mc.clipSlug ?? "?";
    const matches = mc.sourceClipId ? [clipById.get(mc.sourceClipId)].filter(Boolean) as Row[] : R.video_clips.filter((c) => c.clip_slug === mc.clipSlug);
    if (matches.length === 0) {
      err("CLIP_NOT_FOUND", `clips[${index}] "${label}" is not a clip of ${manifest.source.teamSlug}/${manifest.source.playerSlug} in the local database - only this player's own clips can be selected`);
      return;
    }
    if (matches.length > 1) {
      err("CLIP_AMBIGUOUS", `clips[${index}] clipSlug "${label}" matches ${matches.length} clips - select by sourceClipId instead`);
      return;
    }
    const clip = matches[0]!;
    if (selected.some((x) => x.clip.id === clip.id)) {
      err("CLIP_DUPLICATE", `clips[${index}] selects clip "${s(clip.clip_slug)}" twice`);
      return;
    }
    const id = s(clip.id);
    if (clip.status !== "ready") {
      err("CLIP_NOT_PROCESSED", `clip "${s(clip.clip_slug)}" has status "${s(clip.status)}" - run it through the local pipeline (npm run process-upload-queue) until it's ready before exporting`, "video_clips", id);
    }
    if (!(phasesByClip.get(id)?.length)) err("CLIP_NO_PHASES", `clip "${s(clip.clip_slug)}" has no swing phases - the pose3d pipeline hasn't produced analysis for it`, "video_clips", id);
    if (!(poseByClip.get(id)?.length)) {
      (requirePose3d ? err : warn)("CLIP_NO_POSE3D", `clip "${s(clip.clip_slug)}" has no stored 3D pose${requirePose3d ? " (expect.requirePose3d)" : ""}`, "video_clips", id);
    }
    if (!(metricsByClip.get(id)?.length)) {
      (requireMetrics ? err : warn)("CLIP_NO_METRICS", `clip "${s(clip.clip_slug)}" has no swing metrics row`, "video_clips", id);
    }
    if (opts.mediaMode === "planned" && mc.trim === undefined) {
      err("HUMAN_TRIM_MISSING", `clip "${s(clip.clip_slug)}" needs explicit media trim bounds ({startS,endS} in source-video seconds) or "full"`, "video_clips", id);
    }
    selected.push({ mc, clip, index });
  });
  const selectedIds = new Set(selected.map((x) => s(x.clip.id)));
  for (const c of R.video_clips) {
    if (!selectedIds.has(s(c.id))) exclusions.push({ table: "video_clips", sourceId: s(c.id), reason: "not in the curation allowlist" });
  }

  // ---- 3. Entries / pitches / practice reps + human metadata overrides --------
  const entryById = new Map(R.game_log_entries.map((e) => [s(e.id), { ...e }]));
  const pitchById = new Map(R.at_bat_pitches.map((p) => [s(p.id), { ...p }]));
  const repById = new Map(R.practice_repetitions.map((r) => [s(r.id), { ...r }]));
  const sessionById = new Map(R.practice_sessions.map((x) => [s(x.id), x]));
  const entryIds = new Set<string>();
  const repIds = new Set<string>();
  const sessionIds = new Set<string>();
  const overrideSeen = new Map<string, unknown>();
  const declaredUnknown = new Set<string>(); // `${table}:${sourceId}:${column}` the human declared unverified

  const applyOverride = (table: string, row: Row, column: string, to: unknown, withholdFrom = false) => {
    const key = `${table}:${s(row.id)}:${column}`;
    if (overrideSeen.has(key) && overrideSeen.get(key) !== to) {
      err("HUMAN_OVERRIDE_CONFLICT", `two clips override ${table}.${column} for the same row with different values`, table, s(row.id));
      return;
    }
    overrideSeen.set(key, to);
    if (row[column] !== to) {
      // A declared-unverified field's local value is exactly what must not be
      // published, so its "from" is withheld from the fixture's override log.
      overrides.push({ table, id: ids.idFor(table, s(row.id)), column, from: withholdFrom && row[column] != null ? "<withheld: unverified>" : row[column] ?? null, to });
      row[column] = to;
    }
  };

  for (const { mc, clip } of selected) {
    const clipId = s(clip.id);
    const entry = entryById.get(s(clip.game_log_entry_id));
    if (!entry || entry.player_id !== playerId) {
      err("LINKAGE", `clip "${s(clip.clip_slug)}" is attached to an at-bat that isn't this player's`, "video_clips", clipId);
      continue;
    }
    entryIds.add(s(entry.id));
    for (const [col, v] of Object.entries(mc.overrides?.gameLogEntry ?? {})) applyOverride("game_log_entries", entry, col, v);
    for (const col of mc.publishAsUnknown?.gameLogEntry ?? []) {
      applyOverride("game_log_entries", entry, col, null, true);
      declaredUnknown.add(`game_log_entries:${s(entry.id)}:${col}`);
    }

    if (clip.at_bat_pitch_id && clip.practice_repetition_id) err("LINKAGE", `clip "${s(clip.clip_slug)}" is linked to both a pitch and a practice rep`, "video_clips", clipId);
    if (entry.session_type === "game") {
      if (clip.practice_repetition_id) err("LINKAGE", `game clip "${s(clip.clip_slug)}" is linked to a practice rep`, "video_clips", clipId);
      const pitch = clip.at_bat_pitch_id ? pitchById.get(s(clip.at_bat_pitch_id)) : undefined;
      if (clip.at_bat_pitch_id && (!pitch || pitch.game_log_entry_id !== entry.id)) {
        err("LINKAGE", `clip "${s(clip.clip_slug)}"'s pitch is not part of its at-bat`, "video_clips", clipId);
      } else if (pitch) {
        for (const [col, v] of Object.entries(mc.overrides?.atBatPitch ?? {})) applyOverride("at_bat_pitches", pitch, col, v);
        for (const col of mc.publishAsUnknown?.atBatPitch ?? []) {
          applyOverride("at_bat_pitches", pitch, col, null, true);
          declaredUnknown.add(`at_bat_pitches:${s(pitch.id)}:${col}`);
        }
      } else {
        if (mc.overrides?.atBatPitch || mc.publishAsUnknown?.atBatPitch) err("HUMAN_OVERRIDE_TARGET", `clip "${s(clip.clip_slug)}" has atBatPitch overrides but isn't linked to a pitch - link it in the coach app first`, "video_clips", clipId);
        warn("HUMAN_PITCH_LINK_MISSING", `game clip "${s(clip.clip_slug)}" isn't linked to a specific pitch - which pitch this swing belongs to is unrecorded (link it on the at-bat page if known)`, "video_clips", clipId);
      }
    } else {
      if (clip.at_bat_pitch_id) err("LINKAGE", `practice clip "${s(clip.clip_slug)}" is linked to a game pitch`, "video_clips", clipId);
      const rep = clip.practice_repetition_id ? repById.get(s(clip.practice_repetition_id)) : undefined;
      if (!rep) {
        err("HUMAN_PRACTICE_LINK_MISSING", `practice clip "${s(clip.clip_slug)}" isn't linked to a practice rep/session`, "video_clips", clipId);
      } else {
        if (rep.game_log_entry_id !== entry.id) err("LINKAGE", `practice clip "${s(clip.clip_slug)}"'s rep belongs to a different entry`, "video_clips", clipId);
        const session = sessionById.get(s(rep.practice_session_id));
        if (!session || session.player_id !== playerId) err("LINKAGE", `practice rep for "${s(clip.clip_slug)}" has no session for this player`, "practice_repetitions", s(rep.id));
        for (const [col, v] of Object.entries(mc.overrides?.practiceRepetition ?? {})) applyOverride("practice_repetitions", rep, col, v);
        repIds.add(s(rep.id));
        sessionIds.add(s(rep.practice_session_id));
      }
    }
  }
  // Practice reps whose entry is exported through another selected clip are included too.
  for (const rep of repById.values()) {
    if (entryIds.has(s(rep.game_log_entry_id)) && sessionById.has(s(rep.practice_session_id))) {
      repIds.add(s(rep.id));
      sessionIds.add(s(rep.practice_session_id));
    }
  }

  // Human-metadata completeness (post-override).
  for (const id of entryIds) {
    const e = entryById.get(id)!;
    const missing: string[] = [];
    if (!DATE.test(s(e.date))) missing.push("date");
    if (typeof e.ab !== "number" || e.ab < 1) missing.push("ab");
    if (e.session_type === "game") {
      if (!nonEmpty(e.opponent) && !declaredUnknown.has(`game_log_entries:${id}:opponent`)) missing.push("opponent");
      if (!nonEmpty(e.result) && !declaredUnknown.has(`game_log_entries:${id}:result`)) missing.push("result");
      const unk = ["opponent", "result"].filter((c) => declaredUnknown.has(`game_log_entries:${id}:${c}`));
      if (unk.length) warn("HUMAN_METADATA_DECLARED_UNKNOWN", `at-bat ${s(e.date)} AB ${s(e.ab)}: ${unk.join(", ")} declared unverified - published as unknown`, "game_log_entries", id);
      if (e.pitch_outcome !== null && e.pitch_outcome !== undefined && !GAME_PITCH_OUTCOMES.has(s(e.pitch_outcome))) err("HUMAN_METADATA_INVALID", `pitch_outcome "${s(e.pitch_outcome)}" is invalid`, "game_log_entries", id);
    }
    if (missing.length) err("HUMAN_METADATA_MISSING", `at-bat ${s(e.date)} vs ${s(e.opponent)} AB ${s(e.ab)} is missing human-verified ${missing.join(", ")} (set it in the coach app or as a curation override)`, "game_log_entries", id);
  }
  const includedPitches = R.at_bat_pitches.filter((p) => entryIds.has(s(p.game_log_entry_id))).map((p) => pitchById.get(s(p.id))!);
  const clipPitchIds = new Set(selected.map((x) => x.clip.at_bat_pitch_id).filter(Boolean).map(s));
  for (const p of includedPitches) {
    const id = s(p.id);
    if (p.pitch_outcome != null && !AB_PITCH_OUTCOMES.has(s(p.pitch_outcome))) err("HUMAN_METADATA_INVALID", `pitch_outcome "${s(p.pitch_outcome)}" is invalid`, "at_bat_pitches", id);
    if (p.count_before_balls != null && !(Number(p.count_before_balls) >= 0 && Number(p.count_before_balls) <= 3)) err("HUMAN_METADATA_INVALID", "count_before_balls must be 0-3", "at_bat_pitches", id);
    if (p.count_before_strikes != null && !(Number(p.count_before_strikes) >= 0 && Number(p.count_before_strikes) <= 2)) err("HUMAN_METADATA_INVALID", "count_before_strikes must be 0-2", "at_bat_pitches", id);
    if (!clipPitchIds.has(id)) continue;
    const missing = ["count_before_balls", "count_before_strikes", "pitch_outcome", "swung"].filter((c) => (p[c] === null || p[c] === undefined) && !declaredUnknown.has(`at_bat_pitches:${id}:${c}`));
    const unkP = ["count_before_balls", "count_before_strikes", "pitch_outcome", "swung"].filter((c) => declaredUnknown.has(`at_bat_pitches:${id}:${c}`));
    if (unkP.length) warn("HUMAN_METADATA_DECLARED_UNKNOWN", `pitch #${s(p.pitch_number)}: ${unkP.join(", ")} declared unverified - published as unknown`, "at_bat_pitches", id);
    if (missing.length) err("HUMAN_METADATA_MISSING", `pitch #${s(p.pitch_number)} (has a selected clip) is missing human-entered ${missing.join(", ")}`, "at_bat_pitches", id);
    const soft = ["pitch_type", "pitch_location"].filter((c) => p[c] === null || p[c] === undefined || p[c] === "");
    if (soft.length) warn("HUMAN_METADATA_OPTIONAL", `pitch #${s(p.pitch_number)} has no ${soft.join("/")} - left blank, not inferred`, "at_bat_pitches", id);
  }
  for (const id of repIds) {
    const rep = repById.get(id)!;
    if (!GROUPINGS.has(s(rep.grouping))) err("HUMAN_METADATA_INVALID", `grouping "${s(rep.grouping)}" is invalid`, "practice_repetitions", id);
    if (rep.grouping === "free_swing") warn("HUMAN_GROUPING_DEFAULT", `practice rep ${s(rep.rep_number)} is still the default "free_swing" grouping - set baseline/post_drill explicitly if it's meant to show a before/after`, "practice_repetitions", id);
  }

  // ---- 4. Findings / scores / runs --------------------------------------------
  const includeDrafts = manifest.findings?.includeDrafts === true;
  const includeRejectedChecklistStates = manifest.checklist?.includeRejectedStates === true;
  const exportedIssues: Row[] = [];
  for (const i of R.issues) {
    const id = s(i.id);
    const status = s(i.review_status);
    if (status === "rejected") { exclusions.push({ table: "issues", sourceId: id, reason: "coach rejected this finding" }); continue; }
    if (status === "draft" && !includeDrafts) { exclusions.push({ table: "issues", sourceId: id, reason: "unreviewed AI draft (findings.includeDrafts is off)" }); continue; }
    if (!["draft", "approved", "edited"].includes(status)) { err("REVIEW_STATE_UNKNOWN", `issue has unknown review_status "${status}"`, "issues", id); continue; }
    if (i.video_clip_id && !selectedIds.has(s(i.video_clip_id))) { exclusions.push({ table: "issues", sourceId: id, reason: "its evidence clip is not allowlisted" }); continue; }
    if (status !== "draft" && !i.reviewed_by) warn("REVIEWER_MISSING", `${status} finding has no reviewed_by - exported as ${status} with no reviewer name`, "issues", id);
    if (status === "edited" && i.ai_original == null) warn("PROVENANCE_MISSING", "edited finding has no ai_original - review.html can't show the original draft", "issues", id);
    exportedIssues.push(i);
  }
  const exportedScores: Row[] = [];
  for (const sc of R.checklist_scores) {
    // 00040 review state. Rows read before it carry no review_status: fall back to reviewed_by.
    const state = sc.review_status ?? (sc.reviewed_by ? "verified" : "ai_draft");
    if (state === "ai_draft") { exclusions.push({ table: "checklist_scores", sourceId: s(sc.id), reason: "AI draft score, not coach-reviewed" }); continue; }
    if (state === "rejected" && !includeRejectedChecklistStates) { exclusions.push({ table: "checklist_scores", sourceId: s(sc.id), reason: "coach rejected the AI draft - never exported as a coaching conclusion" }); continue; }
    if (!["verified", "insufficient_evidence", "rejected"].includes(String(state))) { exclusions.push({ table: "checklist_scores", sourceId: s(sc.id), reason: `unknown review state ${String(state)}` }); continue; }
    exportedScores.push({ ...sc, review_status: state });
  }
  const exportedScoreIds = new Set(exportedScores.map((x) => s(x.id)));
  const runIds = new Set<string>();
  for (const r of R.analysis_runs) if (r.video_clip_id && selectedIds.has(s(r.video_clip_id))) runIds.add(s(r.id));
  for (const i of exportedIssues) {
    if (!i.analysis_run_id) continue;
    const run = R.analysis_runs.find((r) => r.id === i.analysis_run_id);
    if (run && (!run.video_clip_id || selectedIds.has(s(run.video_clip_id)))) runIds.add(s(run.id));
  }

  // ---- 5. Priorities and their subtree ----------------------------------------
  let priorities: Row[];
  if (manifest.priorities === "none") priorities = [];
  else if (manifest.priorities === "all") priorities = R.player_priorities.filter((p) => p.status !== "archived");
  else {
    const want = new Set(manifest.priorities);
    priorities = R.player_priorities.filter((p) => want.has(s(p.id)));
    for (const id of want) if (!priorities.some((p) => p.id === id)) err("PRIORITY_NOT_FOUND", `priority ${id} is not one of this player's priorities`);
  }
  for (const p of R.player_priorities) {
    if (!priorities.includes(p)) exclusions.push({ table: "player_priorities", sourceId: s(p.id), reason: p.status === "archived" ? "archived" : "not selected by the manifest" });
  }
  const priorityIds = new Set(priorities.map((p) => s(p.id)));
  const observations = R.player_priority_observations.filter((o) => priorityIds.has(s(o.player_priority_id)));
  for (const o of observations) if (o.practice_session_id && sessionById.has(s(o.practice_session_id))) sessionIds.add(s(o.practice_session_id));
  for (const x of R.practice_sessions) if (x.focus_priority_id && priorityIds.has(s(x.focus_priority_id))) sessionIds.add(s(x.id));

  // Assign every fixture id up front (order-independent determinism).
  ids.idFor("players", playerId);
  for (const id of entryIds) ids.idFor("game_log_entries", id);
  for (const p of includedPitches) ids.idFor("at_bat_pitches", s(p.id));
  for (const id of sessionIds) ids.idFor("practice_sessions", id);
  for (const id of repIds) ids.idFor("practice_repetitions", id);
  for (const { clip } of selected) ids.idFor("video_clips", s(clip.id));
  for (const id of runIds) ids.idFor("analysis_runs", id);
  for (const sc of exportedScores) ids.idFor("checklist_scores", s(sc.id));
  for (const i of exportedIssues) ids.idFor("issues", s(i.id));
  for (const p of priorities) ids.idFor("player_priorities", s(p.id));

  const reviewer = manifest.reviewerDisplayName ?? null;
  let reviewerNeeded = false;
  const alias = (v: unknown): string | null => {
    if (v === null || v === undefined || v === "") return null;
    reviewerNeeded = true;
    return reviewer;
  };
  /** FK to an optional exported row: mapped id, or null + a warning when the source pointed at something not exported. */
  const softRef = (table: FixtureTable, sourceVal: unknown, ctx: { table: string; id: string; column: string }): string | null => {
    if (!sourceVal) return null;
    const mapped = ids.lookup(table, s(sourceVal));
    if (!mapped) warn("REF_DROPPED", `${ctx.table}.${ctx.column} pointed at a ${table} row that isn't exported - set to null in the fixture`, ctx.table, ctx.id);
    return mapped;
  };

  const drillById = new Map(R.drill_library.map((d) => [s(d.id), d]));
  const teamDrills = new Map<string, Row>();
  const drillRef = (drillId: unknown, ctx: { table: string; id: string; column: string }): { value: string | null; ref?: { table: RefTable; slug: string } } => {
    if (!drillId) return { value: null };
    const d = drillById.get(s(drillId));
    if (!d) { err("REF_MISSING", `${ctx.table}.${ctx.column} references a drill that isn't in the local drill library`, ctx.table, ctx.id); return { value: null }; }
    if (d.team_id === null) return { value: null, ref: { table: "drill_library", slug: s(d.slug) } };
    if (d.team_id !== snapshot.team.id) { err("REF_MISSING", `${ctx.table}.${ctx.column} references another team's drill`, ctx.table, ctx.id); return { value: null }; }
    teamDrills.set(s(d.id), d);
    return { value: ids.idFor("drill_library", s(d.id)) };
  };

  // ---- 6. Translate ---------------------------------------------------------------
  const out = Object.fromEntries(FIXTURE_TABLE_ORDER.map((t) => [t, [] as Row[]])) as unknown as Record<FixtureTable, Row[]>;
  const team = ids.teamPlaceholder();
  const fxPlayer = ids.idFor("players", playerId);

  if (player.bats == null && manifest.player.bats === undefined) warn("HUMAN_METADATA_OPTIONAL", "player handedness (bats) is unknown - left blank, not inferred", "players", fxPlayer);
  out.players.push(buildTargetRow("players", player, {
    id: fxPlayer, team_id: team, name: manifest.player.publicName, slug: manifest.player.publicSlug,
    jersey_number: manifest.player.jerseyNumber ?? player.jersey_number,
    age_band: manifest.player.ageBand ?? player.age_band ?? null,
    bats: manifest.player.bats ?? player.bats ?? null,
    throws: manifest.player.throws ?? player.throws ?? null,
    what_to_check_next: manifest.player.whatToCheckNext ?? player.what_to_check_next ?? null,
  }));
  if (manifest.player.whatToCheckNext !== undefined && manifest.player.whatToCheckNext !== player.what_to_check_next) {
    overrides.push({ table: "players", id: fxPlayer, column: "what_to_check_next", from: player.what_to_check_next ?? null, to: manifest.player.whatToCheckNext });
  }

  for (const e of R.game_log_entries.filter((x) => entryIds.has(s(x.id))).sort(byCreated)) {
    const src = entryById.get(s(e.id))!;
    out.game_log_entries.push(buildTargetRow("game_log_entries", src, {
      id: ids.idFor("game_log_entries", s(e.id)), player_id: fxPlayer,
      date: src.date, opponent: src.opponent ?? null, ab: src.ab, result: src.result ?? null, pitch: src.pitch ?? null,
    }));
  }
  for (const p of includedPitches.sort(byCreated)) {
    out.at_bat_pitches.push(buildTargetRow("at_bat_pitches", p, {
      id: ids.idFor("at_bat_pitches", s(p.id)), game_log_entry_id: ids.idFor("game_log_entries", s(p.game_log_entry_id)),
      count_before_balls: p.count_before_balls ?? null, count_before_strikes: p.count_before_strikes ?? null,
      pitch_type: p.pitch_type ?? null, pitch_location: p.pitch_location ?? null, pitch_zone: p.pitch_zone ?? null,
      pitch_outcome: p.pitch_outcome ?? null, swung: p.swung ?? null,
    }));
  }
  for (const x of R.practice_sessions.filter((y) => sessionIds.has(s(y.id))).sort(byCreated)) {
    const id = ids.idFor("practice_sessions", s(x.id));
    const drill = drillRef(x.assigned_drill_id, { table: "practice_sessions", id, column: "assigned_drill_id" });
    out.practice_sessions.push(buildTargetRow("practice_sessions", x, {
      id, player_id: fxPlayer,
      focus_priority_id: softRef("player_priorities", x.focus_priority_id, { table: "practice_sessions", id, column: "focus_priority_id" }),
      assigned_drill_id: drill.value,
    }, drill.ref ? { assigned_drill_id: drill.ref } : undefined));
  }
  for (const r of R.practice_repetitions.filter((y) => repIds.has(s(y.id))).sort(byCreated)) {
    const src = repById.get(s(r.id))!;
    out.practice_repetitions.push(buildTargetRow("practice_repetitions", src, {
      id: ids.idFor("practice_repetitions", s(r.id)),
      practice_session_id: ids.idFor("practice_sessions", s(r.practice_session_id)),
      game_log_entry_id: ids.idFor("game_log_entries", s(r.game_log_entry_id)),
      grouping: src.grouping,
    }));
  }

  const clipsOut: SelectedClip[] = [];
  const guardianPermissions: Array<{ clipId: string; confirmedAt: string }> = [];
  for (const { mc, clip, index } of [...selected].sort((a, b) => a.index - b.index)) {
    const sourceClipId = s(clip.id);
    const fxClip = ids.idFor("video_clips", sourceClipId);
    // validateFixture refuses a guardian upload without this (GUARDIAN_PERMISSION_MISSING).
    if (clip.uploaded_by_role === "guardian" && mc.guardianPublicationPermission) {
      guardianPermissions.push({ clipId: fxClip, confirmedAt: mc.guardianPublicationPermission.confirmedAt });
    }
    const publicFilename = opts.mediaMode === "planned" ? `${manifest.fixtureId}-${mediaVersionTag(manifest.mediaFileVersion ?? manifest.fixtureVersion)}-clip-${String(index + 1).padStart(3, "0")}.mp4` : null;
    const ctx = opts.clipContext?.get(sourceClipId);
    const windowStart = mc.analysisWindowStartS ?? (ctx && !ctx.analysisWindowAmbiguous ? ctx.analysisWindowStartS : null);
    if (opts.mediaMode === "planned" && mc.analysisWindowStartS === undefined && ctx?.analysisWindowAmbiguous) {
      err("MEDIA_ALIGNMENT_UNKNOWN", `clip "${s(clip.clip_slug)}": the pipeline tried several candidate windows, so where analysis time 0 falls in the source video is ambiguous - set analysisWindowStartS to align phase times with the demo media`, "video_clips", fxClip);
    } else if (opts.mediaMode === "planned" && (windowStart === null || windowStart === undefined)) {
      err("MEDIA_ALIGNMENT_UNKNOWN", `clip "${s(clip.clip_slug)}": no stage0.json and no analysisWindowStartS - demo_media_offset_s left null`, "video_clips", fxClip);
    }
    const trimStart = mc.trim === undefined ? null : mc.trim === "full" ? 0 : mc.trim.startS;
    const offset = publicFilename && windowStart !== null && windowStart !== undefined && trimStart !== null ? round6(windowStart - trimStart) : null;
    out.video_clips.push(buildTargetRow("video_clips", clip, {
      id: fxClip, game_log_entry_id: ids.idFor("game_log_entries", s(clip.game_log_entry_id)),
      at_bat_pitch_id: ids.lookup("at_bat_pitches", clip.at_bat_pitch_id as string | null),
      practice_repetition_id: ids.lookup("practice_repetitions", clip.practice_repetition_id as string | null),
      clip_slug: `${manifest.player.publicSlug}-clip-${String(index + 1).padStart(3, "0")}`,
      demo_media_path: publicFilename, demo_media_offset_s: offset,
      raw_gcs_path: null, error_message: null, claimed_at: null, retry_count: 0, next_retry_at: null,
      uploaded_by: null, uploaded_by_role: clip.uploaded_by_role === "guardian" ? "guardian" : "coach",
    }));
    clipsOut.push({
      manifestIndex: index, sourceClipId, clipSlug: s(clip.clip_slug), fixtureClipId: fxClip, publicFilename,
      trim: mc.trim ?? null, includeAudio: mc.includeAudio === true, allowLongMedia: mc.allowLongMedia === true,
      analysisWindowStartS: windowStart ?? null,
      local: { sourceVideo: mc.sourceVideo ?? null, rawGcsPath: (clip.raw_gcs_path as string | null) ?? null },
      privacy: mc.privacy ? { name: mc.privacy.name, dir: mc.privacy.dir ?? manifest.privacyDir ?? null } : null,
      nFrames: typeof clip.n_frames === "number" ? clip.n_frames : null,
    });

    for (const m of metricsByClip.get(sourceClipId) ?? []) {
      const withheld = mc.publishAsUnknown?.videoClipMetrics ?? [];
      for (const col of withheld) applyOverride("video_clip_metrics", m, col, col === "movement_flags" ? {} : null, true);
      if (withheld.length) warn("HUMAN_METADATA_DECLARED_UNKNOWN", `clip "${s(clip.clip_slug)}": ${withheld.length} swing metric field(s) withheld as unverified`, "video_clip_metrics", ids.idFor("video_clip_metrics", s(m.id)));
      const metricRow = buildTargetRow("video_clip_metrics", m, { id: ids.idFor("video_clip_metrics", s(m.id)), video_clip_id: fxClip });
      if (manifest.analysis?.scrubDerivedEvidence) metricRow.analysis_quality = {};
      out.video_clip_metrics.push(metricRow);
    }
    if (!includePose3d) for (const p of poseByClip.get(sourceClipId) ?? []) exclusions.push({ table: "video_clip_pose3d", sourceId: s(p.id), reason: "3D excluded by the reviewed manifest" });
    for (const p of includePose3d ? poseByClip.get(sourceClipId) ?? [] : []) {
      out.video_clip_pose3d.push(buildTargetRow("video_clip_pose3d", p, { id: ids.idFor("video_clip_pose3d", s(p.id)), video_clip_id: fxClip }));
    }
    const phaseSlug = new Map(R.swing_phase_types.map((t) => [s(t.id), s(t.slug)]));
    const approvedPhases = mc.phaseReview?.include ? new Set(mc.phaseReview.include) : null;
    for (const ph of (phasesByClip.get(sourceClipId) ?? []).slice().sort((a, b) => s(phaseSlug.get(s(a.phase_type_id))).localeCompare(s(phaseSlug.get(s(b.phase_type_id)))))) {
      const slug = phaseSlug.get(s(ph.phase_type_id));
      if (approvedPhases && (!slug || !approvedPhases.has(slug))) { exclusions.push({ table: "swing_phases", sourceId: s(ph.id), reason: "phase not in the human-audited allowlist" }); continue; }
      const id = ids.idFor("swing_phases", s(ph.id));
      if (!slug) err("REF_MISSING", "swing phase has an unknown phase type", "swing_phases", id);
      const correction = slug ? mc.phaseReview?.overrides?.[slug] : undefined;
      if (correction) for (const [column, to] of Object.entries({ frame: correction.frame, time_s: correction.timeS, method: correction.method ?? ph.method, confidence: correction.confidence ?? ph.confidence, reconstruction_reliable: correction.reconstructionReliable ?? ph.reconstruction_reliable, detail: {} })) {
        if (JSON.stringify(ph[column]) !== JSON.stringify(to)) overrides.push({ table: "swing_phases", id, column, from: column === "detail" ? "<withheld: superseded phase detail>" : ph[column] ?? null, to });
      }
      out.swing_phases.push(buildTargetRow("swing_phases", ph, {
        id, video_clip_id: fxClip, phase_type_id: null,
        frame: correction?.frame ?? ph.frame,
        time_s: correction?.timeS ?? ph.time_s,
        method: correction?.method ?? ph.method,
        confidence: correction?.confidence ?? ph.confidence,
        reconstruction_reliable: correction?.reconstructionReliable ?? ph.reconstruction_reliable,
        // A corrected phase's stored detail (including its batter box) describes the superseded frame.
        detail: correction ? {} : manifest.analysis?.scrubDerivedEvidence ? publicPhaseDetail(ph.detail) : ph.detail,
      },
        { phase_type_id: { table: "swing_phase_types", slug: slug ?? "" } }));
    }
    if (approvedPhases) for (const slug of approvedPhases) if (!out.swing_phases.some((p) => p.video_clip_id === fxClip && (p._refs as Record<string, { slug: string }> | undefined)?.phase_type_id?.slug === slug)) err("REF_MISSING", `approved phase ${slug} has no source row`, "swing_phases", fxClip);
  }

  const manifestClipBySource = new Map(selected.map(({ mc, clip }) => [s(clip.id), mc]));
  for (const r of R.analysis_runs.filter((x) => runIds.has(s(x.id))).sort(byCreated)) {
    for (const col of manifestClipBySource.get(s(r.video_clip_id))?.publishAsUnknown?.analysisRun ?? []) applyOverride("analysis_runs", r, col, col === "no_action_needed" ? false : null, true);
    const runRow = buildTargetRow("analysis_runs", r, {
      id: ids.idFor("analysis_runs", s(r.id)), player_id: fxPlayer,
      video_clip_id: ids.lookup("video_clips", r.video_clip_id as string | null),
    });
    if (manifest.analysis?.scrubInputManifest) runRow.input_manifest = {};
    out.analysis_runs.push(runRow);
  }

  const checkpointSlug = new Map(R.checkpoints.map((c) => [s(c.id), s(c.slug)]));
  for (const sc of exportedScores.slice().sort((a, b) => s(checkpointSlug.get(s(a.checkpoint_id))).localeCompare(s(checkpointSlug.get(s(b.checkpoint_id)))))) {
    const id = ids.idFor("checklist_scores", s(sc.id));
    const slug = checkpointSlug.get(s(sc.checkpoint_id));
    if (!slug) err("REF_MISSING", "checklist score has an unknown checkpoint", "checklist_scores", id);
    const verified = sc.review_status === "verified";
    out.checklist_scores.push(buildTargetRow("checklist_scores", sc, {
      id, player_id: fxPlayer, checkpoint_id: null, reviewed_by: alias(sc.reviewed_by),
      ai_draft: verified ? sc.ai_draft : null,
      notes: verified ? sc.notes : "",
      source: sc.review_status === "rejected" ? null : sc.source,
      analysis_run_id: sc.review_status === "rejected" ? null : softRef("analysis_runs", sc.analysis_run_id, { table: "checklist_scores", id, column: "analysis_run_id" }),
    }, { checkpoint_id: { table: "checkpoints", slug: slug ?? "" } }));
  }
  // Only coach-verified history of verified scores: AI-draft entries and
  // insufficient/rejected transitions would otherwise read as score changes
  // (progress) in the public trend displays.
  const verifiedScoreIds = new Set(exportedScores.filter((x) => x.review_status === "verified").map((x) => s(x.id)));
  const historyVerified = (h: Row) => (h.review_status ? h.review_status === "verified" : Boolean(h.changed_by)) && h.score != null;
  for (const h of R.checklist_score_history.filter((x) => verifiedScoreIds.has(s(x.checklist_score_id)) && historyVerified(x)).sort((a, b) => s(a.changed_at).localeCompare(s(b.changed_at)) || s(a.id).localeCompare(s(b.id)))) {
    out.checklist_score_history.push(buildTargetRow("checklist_score_history", h, {
      id: ids.idFor("checklist_score_history", s(h.id)), checklist_score_id: ids.idFor("checklist_scores", s(h.checklist_score_id)),
      changed_by: alias(h.changed_by), review_status: "verified",
    }));
  }
  for (const i of exportedIssues.slice().sort(byCreated)) {
    const id = ids.idFor("issues", s(i.id));
    out.issues.push(buildTargetRow("issues", i, {
      id, player_id: fxPlayer, video_clip_id: ids.lookup("video_clips", i.video_clip_id as string | null),
      analysis_run_id: softRef("analysis_runs", i.analysis_run_id, { table: "issues", id, column: "analysis_run_id" }),
      reviewed_by: i.review_status === "draft" ? null : alias(i.reviewed_by),
    }));
  }
  for (const p of priorities.slice().sort(byCreated)) {
    const id = ids.idFor("player_priorities", s(p.id));
    out.player_priorities.push(buildTargetRow("player_priorities", p, {
      id, player_id: fxPlayer, team_id: team,
      source_issue_id: softRef("issues", p.source_issue_id, { table: "player_priorities", id, column: "source_issue_id" }),
    }));
  }
  for (const h of R.player_priority_status_history.filter((x) => priorityIds.has(s(x.player_priority_id))).sort((a, b) => s(a.changed_at).localeCompare(s(b.changed_at)) || s(a.id).localeCompare(s(b.id)))) {
    out.player_priority_status_history.push(buildTargetRow("player_priority_status_history", h, {
      id: ids.idFor("player_priority_status_history", s(h.id)), player_priority_id: ids.idFor("player_priorities", s(h.player_priority_id)),
    }));
  }
  for (const d of R.player_priority_drills.filter((x) => priorityIds.has(s(x.player_priority_id))).sort((a, b) => s(a.assigned_at).localeCompare(s(b.assigned_at)) || s(a.id).localeCompare(s(b.id)))) {
    const id = ids.idFor("player_priority_drills", s(d.id));
    const drill = drillRef(d.drill_id, { table: "player_priority_drills", id, column: "drill_id" });
    out.player_priority_drills.push(buildTargetRow("player_priority_drills", d, {
      id, player_priority_id: ids.idFor("player_priorities", s(d.player_priority_id)), drill_id: drill.value,
    }, drill.ref ? { drill_id: drill.ref } : undefined));
  }
  for (const o of observations.slice().sort((a, b) => s(a.observed_at).localeCompare(s(b.observed_at)) || s(a.id).localeCompare(s(b.id)))) {
    const id = ids.idFor("player_priority_observations", s(o.id));
    const ctx = (column: string) => ({ table: "player_priority_observations", id, column });
    out.player_priority_observations.push(buildTargetRow("player_priority_observations", o, {
      id, player_priority_id: ids.idFor("player_priorities", s(o.player_priority_id)),
      video_clip_id: softRef("video_clips", o.video_clip_id, ctx("video_clip_id")),
      practice_repetition_id: softRef("practice_repetitions", o.practice_repetition_id, ctx("practice_repetition_id")),
      at_bat_pitch_id: softRef("at_bat_pitches", o.at_bat_pitch_id, ctx("at_bat_pitch_id")),
      practice_session_id: softRef("practice_sessions", o.practice_session_id, ctx("practice_session_id")),
    }));
  }
  // Team drills are discovered while translating sessions/priority drills above.
  for (const d of [...teamDrills.values()].sort((a, b) => s(a.slug).localeCompare(s(b.slug)))) {
    out.drill_library.push(buildTargetRow("drill_library", d, { id: ids.idFor("drill_library", s(d.id)), team_id: team }));
  }
  if (manifest.report?.shareLink !== false) {
    out.player_share_links.push(buildTargetRow("player_share_links", null, {
      id: ids.idFor("player_share_links", `${playerId}:report`), player_id: fxPlayer,
      token: null, created_at: null, expires_at: null, revoked_at: null,
    }));
  }

  if (reviewerNeeded && !reviewer) {
    err("HUMAN_REVIEWER_ALIAS_MISSING", "reviewed rows carry a coach's name - set reviewerDisplayName in the manifest (the real coach name is never exported)");
  }

  const fixture: Fixture = {
    format: FIXTURE_FORMAT,
    formatVersion: FIXTURE_FORMAT_VERSION,
    fixtureId: manifest.fixtureId,
    fixtureVersion: manifest.fixtureVersion,
    teamPlaceholderId: team,
    team: { name: manifest.team?.publicName ?? "", sport: manifest.team?.sport ?? null, level_label: manifest.team?.levelLabel ?? null },
    exporter: { ...EXPORTER },
    curation: {
      consentRecorded: !manifest.localValidationOnly && Boolean(manifest.publication?.consentConfirmedBy && manifest.publication?.consentConfirmedAt),
      ...(manifest.localValidationOnly ? { localValidationOnly: true } : {}),
      consentConfirmedAt: manifest.publication?.consentConfirmedAt ?? "",
      includeDrafts,
      includeRejectedChecklistStates,
      // Only present when used, so fixtures without guardian uploads stay byte-identical.
      ...(guardianPermissions.length ? { guardianPublicationPermissions: guardianPermissions } : {}),
      reviewerAliasApplied: reviewerNeeded,
      overrides,
      expect: { comparePairs: [...(manifest.expect?.comparePairs ?? [])] },
    },
    tables: out,
  };
  fixture.contentSha256 = fixtureContentSha256(fixture);

  const sourceIds = collectSourceIds(snapshot);
  findings.push(...validateFixture(fixture, {
    sourceIds, selectedClipIds: new Set(clipsOut.map((c) => c.fixtureClipId)), mediaMode: opts.mediaMode,
    forbiddenTerms: manifest.forbiddenPublicTerms,
  }));
  if (manifest.localValidationOnly) {
    // Human facts are knowingly unconfirmed in this mode: surface every one,
    // but as warnings, so the pipeline can be exercised end to end locally.
    for (const f of findings) {
      if (f.level === "error" && f.code.startsWith("HUMAN_")) {
        f.level = "warning";
        f.message = `UNCONFIRMED (local validation only): ${f.message}`;
      }
    }
  }
  return { fixture, findings, exclusions, clips: clipsOut, sourceIds };
}

/** Every uuid that exists on the source side (row ids + auth-user references), lowercased. */
export function collectSourceIds(snapshot: SourceSnapshot): Set<string> {
  const out = new Set<string>();
  const addRow = (r: Row) => {
    for (const [k, v] of Object.entries(r)) {
      if ((k === "id" || k.endsWith("_id") || k === "created_by" || k === "assigned_by" || k === "changed_by") && typeof v === "string" && /^[0-9a-f-]{36}$/i.test(v)) out.add(v.toLowerCase());
    }
  };
  addRow(snapshot.team);
  addRow(snapshot.player);
  for (const [table, rows] of Object.entries(snapshot.rows)) {
    // Reference tables are resolved by slug, never by id, but their ids are
    // still source-side ids that must not leak.
    void table;
    for (const r of rows) addRow(r);
  }
  return out;
}

/** Version-stamped media names: a new fixture version never overwrites (or is served from the cache of) an older one's files. */
export function mediaVersionTag(fixtureVersion: string): string {
  return fixtureVersion.toLowerCase().replace(/[^a-z0-9.-]+/g, "-").replace(/^[-.]+|[-.]+$/g, "") || "v";
}

function groupBy(rows: Row[], key: string): Map<string, Row[]> {
  const m = new Map<string, Row[]>();
  for (const r of rows) {
    const k = s(r[key]);
    const list = m.get(k) ?? [];
    list.push(r);
    m.set(k, list);
  }
  return m;
}
function byCreated(a: Row, b: Row): number {
  return s(a.created_at).localeCompare(s(b.created_at)) || s(a.id).localeCompare(s(b.id));
}
function round6(n: number): number {
  return Math.round(n * 1e6) / 1e6;
}
