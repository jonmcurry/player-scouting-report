/**
 * Fail-closed validation of a built demo fixture. Pure (no DB, no fs) so the
 * exporter, the importer, and unit tests all run the exact same checks. The
 * database adds its own independent layer on import (demo.verify_real_fixture:
 * real constraints, triggers, exact column sets, a full canonical clone).
 */
import { ENTITY_SPECS, FIXTURE_TABLE_ORDER, targetColumns, type FixtureTable, type Row } from "./translation.js";

export type Level = "error" | "warning";
export interface Finding { level: Level; code: string; message: string; table?: string; id?: string }

export const FIXTURE_FORMAT = "hitterloop-demo-fixture";
export const FIXTURE_FORMAT_VERSION = 1;
export const DEMO_MEDIA_FILENAME = /^[a-z0-9][a-z0-9._-]{0,120}\.mp4$/;
/** Soft ceiling: every visitor clone copies the whole payload. */
export const FIXTURE_SIZE_WARN_BYTES = 25 * 1024 * 1024;

export interface Fixture {
  format: typeof FIXTURE_FORMAT;
  formatVersion: typeof FIXTURE_FORMAT_VERSION;
  fixtureId: string;
  fixtureVersion: string;
  teamPlaceholderId: string;
  /** The publication-approved team the clone creates for each visitor. */
  team: { name: string; sport: string | null; level_label: string | null };
  exporter: { name: string; version: number };
  curation: {
    consentRecorded: boolean;
    /** Set only by a localValidationOnly manifest - never storable/publishable outside a local stack. */
    localValidationOnly?: boolean;
    consentConfirmedAt: string;
    includeDrafts: boolean;
    includeRejectedChecklistStates?: boolean;
    /** Fixture clip ids of guardian-uploaded clips whose guardian separately permitted publication. Absent when none. */
    guardianPublicationPermissions?: Array<{ clipId: string; confirmedAt: string }>;
    reviewerAliasApplied: boolean;
    overrides: Array<{ table: string; id: string; column: string; from: unknown; to: unknown }>;
    expect: { comparePairs: string[] };
  };
  tables: Record<FixtureTable, Row[]>;
  contentSha256?: string;
}

// ---------------------------------------------------------------------------
// Leak patterns: local paths, bucket internals, local-stack hosts, secrets.
// ---------------------------------------------------------------------------
const LEAK_PATTERNS: Array<{ code: string; re: RegExp; what: string }> = [
  { code: "LEAK_LOCAL_PATH", re: /(^|[^A-Za-z])[A-Za-z]:[\\/]/, what: "a Windows absolute path" },
  { code: "LEAK_LOCAL_PATH", re: /\\\\[A-Za-z0-9._-]+\\/, what: "a UNC path" },
  { code: "LEAK_LOCAL_PATH", re: /(^|[\s"'(=])\/(Users|home|tmp|var|mnt|private|root|opt)\//, what: "a POSIX absolute path" },
  { code: "LEAK_LOCAL_PATH", re: /(^|[\s"'(\\/])(frames|videos|_uploads|demo-export)[\\/]/, what: "a repo-local media/output directory" },
  { code: "LEAK_BUCKET", re: /gs:\/\//i, what: "a GCS bucket URL" },
  { code: "LEAK_BUCKET", re: /\/raw\/[^/\s"]+\.(mp4|mov|m4v|avi|mkv)/i, what: "a raw-upload bucket key" },
  { code: "LEAK_BUCKET", re: /storage\.googleapis\.com|storage\.cloud\.google\.com/i, what: "a GCS URL" },
  { code: "LEAK_LOCAL_HOST", re: /127\.0\.0\.1|localhost:\d|host\.docker\.internal|gcs-emulator/i, what: "a local-stack host" },
  { code: "LEAK_SECRET", re: /eyJ[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}/, what: "a JWT" },
  { code: "LEAK_SECRET", re: /sb_(secret|publishable)_[A-Za-z0-9_-]+/, what: "a Supabase API key" },
  { code: "LEAK_SECRET", re: /AIza[0-9A-Za-z_-]{20,}/, what: "a Google API key" },
  { code: "LEAK_SECRET", re: /sk-(ant-)?[A-Za-z0-9_-]{20,}/, what: "an API secret key" },
  { code: "LEAK_SECRET", re: /-----BEGIN [A-Z ]*PRIVATE KEY-----/, what: "a private key" },
];
const FORBIDDEN_KEY = /^(token|password|passwd|secret|api_?key|apikey|authorization|access_token|refresh_token|service_role(_key)?|jwt|private_key|gcs_path|clip_gcs_path|raw_gcs_path|local_path|source_video)$/i;
const UUID_IN_TEXT = /[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/gi;

/** Columns whose top-level value is allowed to be null under a forbidden-looking key. */
const NULL_ONLY_TOP_LEVEL: Record<string, string[]> = {
  video_clips: ["raw_gcs_path"],
  player_share_links: ["token"],
};

function scanValue(
  value: unknown, path: string, out: Finding[], table: string, id: string, sourceIds: Set<string> | null, depth: number,
): void {
  if (typeof value === "string") {
    // joints_blob hex is huge and pure [0-9a-f]; skip pattern work on it.
    if (/^\\x[0-9a-f]*$/i.test(value)) return;
    for (const p of LEAK_PATTERNS) {
      if (p.re.test(value)) {
        out.push({ level: "error", code: p.code, table, id, message: `${table}.${path} contains ${p.what}: "${value.slice(0, 80)}"` });
      }
    }
    if (sourceIds) {
      for (const m of value.match(UUID_IN_TEXT) ?? []) {
        if (sourceIds.has(m.toLowerCase())) {
          out.push({ level: "error", code: "LEAK_SOURCE_ID", table, id, message: `${table}.${path} carries a local source row id (${m}) - the fixture must be self-contained` });
        }
      }
    }
    return;
  }
  if (Array.isArray(value)) {
    value.forEach((v, i) => scanValue(v, `${path}[${i}]`, out, table, id, sourceIds, depth + 1));
    return;
  }
  if (value && typeof value === "object") {
    for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
      const allowedNull = depth === 0 && (NULL_ONLY_TOP_LEVEL[table] ?? []).includes(k);
      if (FORBIDDEN_KEY.test(k) && !(allowedNull && v === null)) {
        out.push({ level: "error", code: "LEAK_FORBIDDEN_KEY", table, id, message: `${table}.${path ? `${path}.` : ""}${k} is a private/secret field and must not be exported` });
      }
      scanValue(v, path ? `${path}.${k}` : k, out, table, id, sourceIds, depth + 1);
    }
  }
}

export interface ValidateOptions {
  /** Every local source row id (lowercase). When given, any appearance in the fixture is an error. */
  sourceIds?: Set<string>;
  /** Fixture clip ids the curation manifest selected (allowlist check). */
  selectedClipIds?: Set<string>;
  /** Case-insensitive terms that must not appear in any fixture string value. */
  forbiddenTerms?: string[];
  /** "planned" = every clip must carry a demo_media_path; "skipped" = none may. */
  mediaMode?: "planned" | "skipped";
}

export function validateFixture(fx: Fixture, opts: ValidateOptions = {}): Finding[] {
  const out: Finding[] = [];
  const err = (code: string, message: string, table?: string, id?: string) => out.push({ level: "error", code, message, table, id });
  const warn = (code: string, message: string, table?: string, id?: string) => out.push({ level: "warning", code, message, table, id });

  if (fx.format !== FIXTURE_FORMAT || fx.formatVersion !== FIXTURE_FORMAT_VERSION) err("FORMAT", `unsupported fixture format ${fx.format}/${fx.formatVersion}`);
  if (!/^[a-z0-9][a-z0-9-]{1,62}$/.test(fx.fixtureId ?? "")) err("FORMAT", "fixtureId must be a lowercase slug");
  if (!fx.fixtureVersion) err("FORMAT", "fixtureVersion is required");
  if (!fx.team || typeof fx.team.name !== "string" || !fx.team.name.trim()) err("HUMAN_TEAM_NAME_MISSING", "the fixture has no publication-approved team name");
  if (!fx.curation?.consentRecorded) (fx.curation?.localValidationOnly ? warn : err)("HUMAN_CONSENT_MISSING", "publication consent was not recorded for this fixture");
  if (!fx.tables || typeof fx.tables !== "object") {
    err("FORMAT", "fixture has no tables");
    return out;
  }
  for (const t of Object.keys(fx.tables)) {
    if (!(FIXTURE_TABLE_ORDER as readonly string[]).includes(t)) err("FORMAT", `table "${t}" is not allowed in a real-data fixture`, t);
  }
  const rows = (t: FixtureTable): Row[] => fx.tables[t] ?? [];

  // --- ids: present, unique across the WHOLE fixture -----------------------
  const idsByTable = new Map<FixtureTable, Set<string>>();
  const allIds = new Set<string>([fx.teamPlaceholderId]);
  for (const t of FIXTURE_TABLE_ORDER) {
    const set = new Set<string>();
    for (const r of rows(t)) {
      const id = r.id;
      if (typeof id !== "string" || !id) { err("ID_MISSING", `${t} row without id`, t); continue; }
      if (allIds.has(id)) err("ID_DUPLICATE", `duplicate fixture id ${id}`, t, id);
      allIds.add(id);
      set.add(id);
    }
    idsByTable.set(t, set);
  }

  // --- per-row: exact columns, required fields, FKs, refs -------------------
  for (const t of FIXTURE_TABLE_ORDER) {
    const spec = ENTITY_SPECS[t];
    const cols = targetColumns(t);
    for (const r of rows(t)) {
      const id = String(r.id ?? "?");
      const keys = Object.keys(r).filter((k) => k !== "_refs").sort();
      const missing = cols.filter((c) => !keys.includes(c));
      const extra = keys.filter((k) => !cols.includes(k));
      if (missing.length) err("SCHEMA_MISSING_COLUMN", `${t} row is missing target column(s): ${missing.join(", ")}`, t, id);
      if (extra.length) err("SCHEMA_UNKNOWN_COLUMN", `${t} row has column(s) demo.${t} does not define: ${extra.join(", ")}`, t, id);
      for (const c of spec.required) {
        if (r[c] === null || r[c] === undefined) err("REQUIRED_FIELD", `${t}.${c} is required (NOT NULL in demo.${t})`, t, id);
      }
      for (const [c, refTable] of Object.entries(spec.fk)) {
        const v = r[c];
        if (v === null || v === undefined) continue;
        const ok = refTable === "team" ? v === fx.teamPlaceholderId : idsByTable.get(refTable)?.has(String(v));
        if (!ok) err("FK_DANGLING", `${t}.${c} = ${String(v)} does not resolve to a ${refTable} row in this fixture`, t, id);
      }
      const refs = (r._refs ?? {}) as Record<string, { table?: string; slug?: string }>;
      for (const [c, refTable] of Object.entries(spec.refs ?? {})) {
        if (r[c] !== null) err("REF_NOT_BY_SLUG", `${t}.${c} must be null and resolved by slug at clone time`, t, id);
        const ref = refs[c];
        if (!ref || ref.table !== refTable || !ref.slug) err("REF_MISSING", `${t}.${c} needs a ${refTable} slug reference`, t, id);
      }
      for (const c of Object.keys(refs)) {
        const declared = spec.refs?.[c] ?? (c === "drill_id" || c === "assigned_drill_id" ? "drill_library" : undefined);
        if (!declared) err("REF_UNEXPECTED", `${t}._refs.${c} is not a reference column`, t, id);
        if (r[c] !== null) err("REF_NOT_BY_SLUG", `${t}.${c} has both a value and a slug reference`, t, id);
      }
      scanValue(r, "", out, t, id, opts.sourceIds ?? null, 0);
    }
  }

  // --- approval / curation rules ---------------------------------------------
  const allowedStatus = new Set(["approved", "edited", ...(fx.curation?.includeDrafts ? ["draft"] : [])]);
  for (const i of rows("issues")) {
    const status = String(i.review_status);
    if (!allowedStatus.has(status)) {
      err("UNAPPROVED_FINDING", `issue with review_status="${status}" must not be exported${status === "draft" ? " (drafts need findings.includeDrafts)" : ""}`, "issues", String(i.id));
    }
    if (status === "draft" && i.reviewed_by !== null) err("UNAPPROVED_FINDING", "a draft finding must not carry a reviewer", "issues", String(i.id));
  }
  for (const r of rows("analysis_runs")) {
    if (r.no_action_needed === true && !String(r.no_action_reason ?? "").trim()) err("NO_ACTION_REASON_REQUIRED", "an analysis run marked no_action_needed must carry its reason (the database rejects it otherwise)", "analysis_runs", String(r.id));
  }
  for (const s of rows("checklist_scores")) {
    const id = String(s.id);
    if (!s.reviewed_by) err("UNAPPROVED_SCORE", "checklist score without a coach review (AI draft) must not be exported", "checklist_scores", id);
    if (s.review_status === "rejected") {
      if (!fx.curation?.includeRejectedChecklistStates || s.score != null || s.ai_draft != null || (s.notes ?? "") !== "" || s.source != null || s.analysis_run_id != null) {
        err("REJECTED_SCORE", "a rejected checklist state may export only as a scrubbed, coach-reviewed no-score marker", "checklist_scores", id);
      }
    }
    else if (s.review_status === "verified") { if (s.score == null) err("UNAPPROVED_SCORE", "a verified checklist score must carry a score", "checklist_scores", id); }
    else if (s.review_status === "insufficient_evidence") {
      if (s.score != null || s.ai_draft != null || (s.notes ?? "") !== "") err("INSUFFICIENT_LEAKS_DRAFT", "an insufficient-evidence checkpoint must export no score, AI draft or AI note", "checklist_scores", id);
    } else err("UNAPPROVED_SCORE", `checklist score has review_status ${String(s.review_status)} (must be verified or insufficient_evidence)`, "checklist_scores", id);
  }
  for (const h of rows("checklist_score_history")) {
    if (h.review_status !== "verified" || h.score == null) err("UNAPPROVED_SCORE", "only coach-verified score history may be exported", "checklist_score_history", String(h.id));
  }
  for (const l of rows("player_share_links")) {
    if (l.token !== null) err("LEAK_SECRET", "share-link token must be null in the fixture (generated per clone)", "player_share_links", String(l.id));
  }

  // --- media / allowlist -------------------------------------------------------
  const clipIds = idsByTable.get("video_clips") ?? new Set();
  if (opts.selectedClipIds) {
    for (const id of clipIds) if (!opts.selectedClipIds.has(id)) err("CLIP_NOT_ALLOWLISTED", `video clip ${id} was not selected by the curation manifest`, "video_clips", id);
    for (const id of opts.selectedClipIds) if (!clipIds.has(id)) err("CLIP_MISSING", `selected clip ${id} is absent from the fixture`, "video_clips", id);
  }
  // A guardian upload is publishable only with that guardian's own recorded permission
  // for that clip (the guardian consent text promises this) - team consent isn't enough.
  const guardianPermitted = new Set(
    (fx.curation?.guardianPublicationPermissions ?? [])
      .filter((p) => typeof p?.clipId === "string" && /^\d{4}-\d{2}-\d{2}$/.test(String(p?.confirmedAt ?? "")))
      .map((p) => p.clipId),
  );
  for (const c of rows("video_clips")) {
    if (c.uploaded_by_role === "guardian" && !guardianPermitted.has(String(c.id))) {
      err("GUARDIAN_PERMISSION_MISSING", `video clip ${String(c.id)} was uploaded by a parent/guardian and the curation manifest records no separate publication permission from that guardian`, "video_clips", String(c.id));
    }
  }
  const mediaNames = new Set<string>();
  for (const c of rows("video_clips")) {
    const id = String(c.id);
    if (c.raw_gcs_path !== null) err("LEAK_BUCKET", "video_clips.raw_gcs_path must be null", "video_clips", id);
    if (c.status !== "ready") err("CLIP_NOT_READY", `video clip status "${String(c.status)}" - only fully processed clips are publishable`, "video_clips", id);
    const media = c.demo_media_path;
    if (media !== null && (typeof media !== "string" || !DEMO_MEDIA_FILENAME.test(media))) err("MEDIA_PATH", `demo_media_path "${String(media)}" is not a safe public filename`, "video_clips", id);
    if (typeof media === "string") {
      if (mediaNames.has(media)) err("MEDIA_PATH", `demo_media_path "${media}" is used twice`, "video_clips", id);
      mediaNames.add(media);
    }
    if (opts.mediaMode === "planned" && media === null) err("MEDIA_MISSING", "clip has no demo media file", "video_clips", id);
    if (opts.mediaMode === "skipped" && media !== null) err("MEDIA_PATH", "media was skipped but the clip names a media file", "video_clips", id);
    if (c.at_bat_pitch_id !== null && c.practice_repetition_id !== null) err("LINKAGE", "a clip cannot belong to both a pitch and a practice rep", "video_clips", id);
  }

  // --- practice / at-bat linkage ----------------------------------------------
  const entryById = new Map(rows("game_log_entries").map((e) => [String(e.id), e]));
  const pitchById = new Map(rows("at_bat_pitches").map((p) => [String(p.id), p]));
  const repById = new Map(rows("practice_repetitions").map((r) => [String(r.id), r]));
  for (const c of rows("video_clips")) {
    const id = String(c.id);
    const entry = entryById.get(String(c.game_log_entry_id));
    if (c.at_bat_pitch_id !== null) {
      const pitch = pitchById.get(String(c.at_bat_pitch_id));
      if (pitch && pitch.game_log_entry_id !== c.game_log_entry_id) err("LINKAGE", "clip's pitch belongs to a different at-bat", "video_clips", id);
      if (entry && entry.session_type !== "game") err("LINKAGE", "a pitch-linked clip must sit on a game entry", "video_clips", id);
    }
    if (c.practice_repetition_id !== null) {
      const rep = repById.get(String(c.practice_repetition_id));
      if (rep && rep.game_log_entry_id !== c.game_log_entry_id) err("LINKAGE", "clip's practice rep points at a different entry", "video_clips", id);
      if (entry && entry.session_type !== "practice") err("LINKAGE", "a rep-linked clip must sit on a practice entry", "video_clips", id);
    }
  }
  for (const r of rows("practice_repetitions")) {
    const entry = entryById.get(String(r.game_log_entry_id));
    if (entry && entry.session_type !== "practice") err("LINKAGE", "practice rep's entry is not session_type=practice", "practice_repetitions", String(r.id));
  }
  const referencedEntries = new Set([
    ...rows("video_clips").map((c) => String(c.game_log_entry_id)),
    ...rows("practice_repetitions").map((r) => String(r.game_log_entry_id)),
  ]);
  for (const e of rows("game_log_entries")) {
    if (!referencedEntries.has(String(e.id))) err("ORPHAN", "game log entry has no exported clip or practice rep", "game_log_entries", String(e.id));
  }
  for (const t of ["video_clip_metrics", "video_clip_pose3d"] as const) {
    const seen = new Set<string>();
    for (const r of rows(t)) {
      const k = String(r.video_clip_id);
      if (seen.has(k)) err("DUPLICATE", `two ${t} rows for one clip`, t, String(r.id));
      seen.add(k);
    }
  }

  // --- report / compare completeness -------------------------------------------
  if (rows("players").length !== 1) err("PLAYER", `a fixture must carry exactly one player (found ${rows("players").length})`, "players");
  if (rows("player_share_links").length === 0) warn("REPORT_NO_SHARE_LINK", "no share link - report.html will have nothing to open for this player");
  if (rows("checklist_scores").length === 0 && rows("player_priorities").length === 0) {
    warn("REPORT_EMPTY", "no coach-reviewed scores and no priorities - the public report will be nearly empty");
  }
  for (const kind of fx.curation?.expect?.comparePairs ?? []) {
    if (!comparePairAvailable(fx, kind)) err("COMPARE_PAIR_MISSING", `expected a "${kind}" Compare pair but the exported clips can't form one`);
  }

  if (opts.forbiddenTerms?.length) {
    const walk = (v: unknown, where: string): void => {
      if (typeof v === "string") {
        const low = v.toLowerCase();
        opts.forbiddenTerms!.forEach((t, k) => {
          if (low.includes(t.toLowerCase())) err("LEAK_FORBIDDEN_TERM", `${where} contains forbidden public term #${k + 1}`);
        });
      } else if (Array.isArray(v)) v.forEach((x, k) => walk(x, `${where}[${k}]`));
      else if (v && typeof v === "object") for (const [k, x] of Object.entries(v as Row)) walk(x, where ? `${where}.${k}` : k);
    };
    walk({ team: fx.team, curation: fx.curation, tables: fx.tables }, "");
  }

  const bytes = Buffer.byteLength(JSON.stringify(fx.tables));
  if (bytes > FIXTURE_SIZE_WARN_BYTES) warn("FIXTURE_LARGE", `fixture tables are ${(bytes / 1048576).toFixed(1)} MB - every visitor clone copies this`);
  return out;
}

/** Mirrors coach/components/comparePairs.js's suggestedComparePairs() eligibility rules. */
export function comparePairAvailable(fx: Fixture, kind: string): boolean {
  const rows = (t: FixtureTable): Row[] => fx.tables[t] ?? [];
  const entryById = new Map(rows("game_log_entries").map((e) => [String(e.id), e]));
  const pitchById = new Map(rows("at_bat_pitches").map((p) => [String(p.id), p]));
  const repById = new Map(rows("practice_repetitions").map((r) => [String(r.id), r]));
  const ready = rows("video_clips").filter((c) => {
    if (c.status !== "ready") return false;
    const pitch = c.at_bat_pitch_id ? pitchById.get(String(c.at_bat_pitch_id)) : null;
    return pitch?.swung !== false;
  });
  if (kind === "baseline_post") {
    const bySession = new Map<string, Set<string>>();
    for (const c of ready) {
      const rep = c.practice_repetition_id ? repById.get(String(c.practice_repetition_id)) : null;
      if (!rep) continue;
      const set = bySession.get(String(rep.practice_session_id)) ?? new Set<string>();
      set.add(String(rep.grouping));
      bySession.set(String(rep.practice_session_id), set);
    }
    return [...bySession.values()].some((g) => g.has("baseline") && g.has("post_drill"));
  }
  if (kind === "game_game") {
    const dates = new Set(ready.map((c) => entryById.get(String(c.game_log_entry_id))).filter((e) => e?.session_type === "game").map((e) => String(e!.date)));
    return dates.size >= 2;
  }
  if (kind === "priority_before_after") {
    const readyIds = new Set(ready.map((c) => String(c.id)));
    const perPriority = new Map<string, Set<string>>();
    for (const o of rows("player_priority_observations")) {
      if (!o.video_clip_id || !readyIds.has(String(o.video_clip_id))) continue;
      const set = perPriority.get(String(o.player_priority_id)) ?? new Set<string>();
      set.add(String(o.video_clip_id));
      perPriority.set(String(o.player_priority_id), set);
    }
    return [...perPriority.values()].some((s) => s.size >= 2);
  }
  return false;
}

export function hasErrors(findings: Finding[]): boolean {
  return findings.some((f) => f.level === "error");
}
