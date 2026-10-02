/**
 * Explicit public.* -> demo.* translation spec for the real-data demo
 * promotion pipeline (see docs/research/demo-real-data-promotion.md).
 *
 * Every SOURCE column must be accounted for in exactly one of `copy`,
 * `transformed`, or `omitted` - a source column with no rule is a hard error
 * (schema drift fails closed instead of being silently dropped or silently
 * copied). Every TARGET column must be produced by `copy`, `transformed`, or
 * `defaulted`, and the demo-side clone (demo.clone_real_fixture, migration
 * 00036) independently rejects any row whose key set doesn't exactly match
 * the real demo table - two independent checks on the same contract.
 */

export type Row = Record<string, unknown>;

export type FixtureTable =
  | "players" | "drill_library" | "game_log_entries" | "at_bat_pitches" | "practice_sessions"
  | "practice_repetitions" | "video_clips" | "video_clip_metrics" | "video_clip_pose3d" | "swing_phases"
  | "analysis_runs" | "checklist_scores" | "checklist_score_history" | "issues" | "player_priorities"
  | "player_priority_status_history" | "player_priority_drills" | "player_priority_observations"
  | "player_share_links";

/** Insert/dependency order - must match demo.clone_real_fixture()'s table_order. */
export const FIXTURE_TABLE_ORDER: readonly FixtureTable[] = [
  "players", "drill_library", "game_log_entries", "at_bat_pitches", "practice_sessions",
  "practice_repetitions", "video_clips", "video_clip_metrics", "video_clip_pose3d", "swing_phases",
  "analysis_runs", "checklist_scores", "checklist_score_history", "issues", "player_priorities",
  "player_priority_status_history", "player_priority_drills", "player_priority_observations",
  "player_share_links",
];

export type RefTable = "checkpoints" | "swing_phase_types" | "drill_library";

export interface EntitySpec {
  source: string;
  target: FixtureTable;
  /** Copied verbatim (same name both sides). */
  copy: readonly string[];
  /** target column -> how it's produced from source/curation data. */
  transformed: Readonly<Record<string, string>>;
  /** source column -> why it never leaves the local machine. */
  omitted: Readonly<Record<string, string>>;
  /** target column (no source counterpart) -> the value it gets. */
  defaulted: Readonly<Record<string, string>>;
  /** target FK column -> the fixture table it must resolve to ("team" = the per-clone team). */
  fk: Readonly<Record<string, FixtureTable | "team">>;
  /** target column resolved at clone time by slug against demo reference data. */
  refs?: Readonly<Record<string, RefTable>>;
  /** Target columns that are NOT NULL in demo.* and have no default the clone can rely on. */
  required: readonly string[];
}

const AUTH_UUID = "a real auth.users id (private identity; no demo counterpart)";
const AI_UNREVIEWED = "unreviewed AI output with no coach review state of its own";

export const ENTITY_SPECS: Readonly<Record<FixtureTable, EntitySpec>> = {
  players: {
    source: "public.players", target: "players",
    copy: ["refilm_by", "created_at"],
    transformed: {
      id: "deterministic fixture id",
      team_id: "per-clone demo team (placeholder)",
      name: "curation manifest player.publicName (never defaulted to the real name)",
      slug: "curation manifest player.publicSlug",
      jersey_number: "curation manifest player.jerseyNumber, else source",
      age_band: "curation manifest player.ageBand, else source",
      bats: "curation manifest player.bats, else source",
      throws: "curation manifest player.throws, else source",
      what_to_check_next: "curation manifest player.whatToCheckNext, else source",
    },
    omitted: {},
    defaulted: {},
    fk: { team_id: "team" },
    required: ["id", "team_id", "slug", "name", "jersey_number", "created_at"],
  },
  drill_library: {
    source: "public.drill_library (team-scoped rows only; global drills are referenced by slug)", target: "drill_library",
    copy: ["slug", "name", "purpose", "target_tags", "instructions", "equipment", "age_notes", "coach_notes", "reference_url", "is_active", "created_at"],
    transformed: { id: "deterministic fixture id", team_id: "per-clone demo team (placeholder)" },
    omitted: {},
    defaulted: {},
    fk: { team_id: "team" },
    required: ["id", "slug", "name", "purpose", "target_tags", "instructions", "equipment", "age_notes", "coach_notes", "is_active", "created_at"],
  },
  game_log_entries: {
    source: "public.game_log_entries", target: "game_log_entries",
    copy: ["position", "session_type", "session_note", "pitch_zone", "pitch_outcome", "ai_summary", "ai_summary_generated_at", "created_at"],
    transformed: {
      id: "deterministic fixture id", player_id: "fixture player",
      date: "source, or curation override (human-verified)", opponent: "source, or curation override",
      ab: "source, or curation override", result: "source, or curation override",
      pitch: "source legacy free-text pitch note, or curation override",
    },
    omitted: {
      clip_gcs_path: "legacy private bucket path",
      outcome: "legacy pre-00009 outcome column; not read by any demo page (pitch_outcome carries the current value)",
    },
    defaulted: {},
    fk: { player_id: "players" },
    required: ["id", "player_id", "date", "ab", "position", "session_type", "created_at"],
  },
  at_bat_pitches: {
    source: "public.at_bat_pitches", target: "at_bat_pitches",
    copy: ["pitch_number", "notes", "created_at", "updated_at"],
    transformed: {
      id: "deterministic fixture id", game_log_entry_id: "fixture entry",
      count_before_balls: "source, or curation override", count_before_strikes: "source, or curation override",
      pitch_type: "source, or curation override", pitch_location: "source, or curation override",
      pitch_zone: "source, or curation override", pitch_outcome: "source, or curation override",
      swung: "source, or curation override",
    },
    omitted: {},
    defaulted: {},
    fk: { game_log_entry_id: "game_log_entries" },
    required: ["id", "game_log_entry_id", "pitch_number", "created_at", "updated_at"],
  },
  practice_sessions: {
    source: "public.practice_sessions", target: "practice_sessions",
    copy: ["session_date", "session_goal", "outcome", "outcome_note", "notes", "created_at", "updated_at"],
    transformed: {
      id: "deterministic fixture id", player_id: "fixture player",
      focus_priority_id: "fixture priority, or null (warned) when that priority isn't exported",
      assigned_drill_id: "team drill -> fixture id; global drill -> resolved by slug at clone time",
    },
    omitted: {},
    defaulted: {},
    fk: { player_id: "players", focus_priority_id: "player_priorities", assigned_drill_id: "drill_library" },
    required: ["id", "player_id", "session_date", "session_goal", "outcome_note", "notes", "created_at", "updated_at"],
  },
  practice_repetitions: {
    source: "public.practice_repetitions", target: "practice_repetitions",
    copy: ["rep_number", "usable", "notes", "created_at", "updated_at"],
    transformed: {
      id: "deterministic fixture id", practice_session_id: "fixture session", game_log_entry_id: "fixture entry",
      grouping: "source, or curation override (baseline/post-drill is a human classification)",
    },
    omitted: {},
    defaulted: {},
    fk: { practice_session_id: "practice_sessions", game_log_entry_id: "game_log_entries" },
    required: ["id", "practice_session_id", "game_log_entry_id", "rep_number", "grouping", "usable", "notes", "created_at", "updated_at"],
  },
  video_clips: {
    source: "public.video_clips (allowlisted by the curation manifest only)", target: "video_clips",
    copy: ["fps", "n_frames", "duration_s", "position", "status", "created_at"],
    transformed: {
      id: "deterministic fixture id", game_log_entry_id: "fixture entry",
      at_bat_pitch_id: "fixture pitch", practice_repetition_id: "fixture rep",
      clip_slug: "neutral <publicSlug>-clip-NNN (local slugs are derived from original filenames and can carry the athlete's name/initial)",
      demo_media_path: "generated public media filename, or null when media was skipped",
      demo_media_offset_s: "analysis-window start minus media trim start, or null when unknown",
      uploaded_by_role: "source (coach/guardian), or \"coach\" for rows read before 00042 (the only upload path then)",
    },
    omitted: {
      raw_gcs_path: "private bucket path to the untrimmed original",
      uploaded_by: AUTH_UUID,
      error_message: "worker diagnostics (may contain local paths)",
      claimed_at: "worker queue bookkeeping", retry_count: "worker queue bookkeeping", next_retry_at: "worker queue bookkeeping",
    },
    defaulted: {
      raw_gcs_path: "null (no private media reference in the demo)",
      error_message: "null", claimed_at: "null", retry_count: "0", next_retry_at: "null",
      uploaded_by: "null (never a real auth identity in a fixture; demo.upgrade_fixture_payload refuses one)",
    },
    fk: { game_log_entry_id: "game_log_entries", at_bat_pitch_id: "at_bat_pitches", practice_repetition_id: "practice_repetitions" },
    required: ["id", "game_log_entry_id", "clip_slug", "position", "status", "retry_count", "created_at"],
  },
  video_clip_metrics: {
    source: "public.video_clip_metrics", target: "video_clip_metrics",
    copy: [
      "max_bat_speed_value", "max_bat_speed_unit", "max_bat_speed_search_window_s", "max_bat_speed_frame",
      "max_bat_speed_full_rate_value", "max_bat_speed_full_rate_source_fps", "attack_angle_at_contact_deg",
      "hip_shoulder_separation_at_contact_deg", "torso_tilt_at_contact_deg", "pelvis_tilt_at_contact_deg",
      "lead_side", "lead_side_method", "lead_elbow_angle_at_contact_deg", "front_knee_angle_at_contact_deg",
      "l_elbow_angle_at_contact_deg", "r_elbow_angle_at_contact_deg", "stride_length_hip_widths",
      "stride_direction_deg", "stride_note", "movement_flags", "analysis_quality", "created_at",
    ],
    transformed: { id: "deterministic fixture id", video_clip_id: "fixture clip" },
    omitted: {},
    defaulted: {},
    fk: { video_clip_id: "video_clips" },
    required: ["id", "video_clip_id", "movement_flags", "created_at"],
  },
  video_clip_pose3d: {
    source: "public.video_clip_pose3d", target: "video_clip_pose3d",
    copy: ["joint_order", "joint_names", "smoothing_method", "frames", "lead_side", "joints_blob", "created_at"],
    transformed: { id: "deterministic fixture id", video_clip_id: "fixture clip" },
    omitted: {},
    defaulted: {},
    fk: { video_clip_id: "video_clips" },
    required: ["id", "video_clip_id", "joint_order", "joint_names", "smoothing_method", "frames", "created_at"],
  },
  swing_phases: {
    source: "public.swing_phases", target: "swing_phases",
    copy: ["created_at"],
    transformed: {
      id: "deterministic fixture id", video_clip_id: "fixture clip",
      phase_type_id: "resolved by swing_phase_types slug at clone time",
      frame: "source, or human-audited phase correction",
      time_s: "source, or human-audited phase correction",
      method: "source, or human-audited phase correction",
      confidence: "source, or human-audited phase correction",
      detail: "source, or empty for a corrected phase",
      reconstruction_reliable: "source, or human-audited phase correction",
    },
    omitted: {},
    defaulted: {},
    fk: { video_clip_id: "video_clips" },
    refs: { phase_type_id: "swing_phase_types" },
    required: ["id", "video_clip_id", "detail", "created_at"],
  },
  analysis_runs: {
    source: "public.analysis_runs", target: "analysis_runs",
    copy: [
      "backend", "ai_model", "ai_model_version", "prompt_version", "analysis_policy_version", "knowledge_version",
      "pipeline_version", "input_manifest", "no_action_needed", "no_action_reason", "created_at",
    ],
    transformed: { id: "deterministic fixture id", video_clip_id: "fixture clip", player_id: "fixture player" },
    omitted: {},
    defaulted: {},
    fk: { video_clip_id: "video_clips", player_id: "players" },
    // Production-required provenance (00028) - a promoted run missing any of
    // these fails closed rather than being published without provenance.
    required: ["id", "player_id", "backend", "ai_model", "prompt_version", "analysis_policy_version", "knowledge_version", "input_manifest", "no_action_needed", "created_at"],
  },
  checklist_scores: {
    source: "public.checklist_scores (verified and insufficient_evidence rows; optionally scrubbed rejected state; ai_draft never)", target: "checklist_scores",
    copy: ["score", "review_status", "updated_at"],
    transformed: {
      id: "deterministic fixture id", player_id: "fixture player",
      ai_draft: "source for verified rows; null for insufficient_evidence and rejected states",
      notes: "source for verified rows; empty for insufficient_evidence and rejected states",
      source: "source for verified/insufficient rows; null for rejected states",
      checkpoint_id: "resolved by checkpoints slug at clone time",
      reviewed_by: "curation manifest reviewerDisplayName (null-ness preserved)",
      analysis_run_id: "fixture run, or null (warned) when that run isn't exported",
    },
    omitted: { at_bats: "legacy free-text at-bat labels; not read by any demo page" },
    defaulted: {},
    fk: { player_id: "players", analysis_run_id: "analysis_runs" },
    refs: { checkpoint_id: "checkpoints" },
    required: ["id", "player_id", "notes", "updated_at"],
  },
  checklist_score_history: {
    source: "public.checklist_score_history (verified entries of exported verified scores only)", target: "checklist_score_history",
    copy: ["score", "changed_at"],
    transformed: {
      review_status: "always \"verified\" (only coach-verified entries are exported)",
      id: "deterministic fixture id", checklist_score_id: "fixture score",
      changed_by: "curation manifest reviewerDisplayName (null-ness preserved)",
    },
    omitted: {},
    defaulted: {},
    fk: { checklist_score_id: "checklist_scores" },
    required: ["id", "checklist_score_id", "score", "changed_at"],
  },
  issues: {
    source: "public.issues (approved/edited; drafts only on explicit opt-in; rejected never)", target: "issues",
    copy: [
      "issue", "seen_in_at_bats", "likely_cause", "effect", "source", "review_status", "evidence", "coaching_cue",
      "suggested_drill", "look_for_next", "confidence", "phase", "suggested_priority_title", "finding_key",
      "concept", "basis", "ai_original", "created_at",
    ],
    transformed: {
      id: "deterministic fixture id", player_id: "fixture player", video_clip_id: "fixture clip",
      analysis_run_id: "fixture run, or null (warned) when that run isn't exported",
      reviewed_by: "curation manifest reviewerDisplayName (null-ness preserved)",
    },
    omitted: {
      at_bats: "legacy free-text at-bat labels; not read by any demo page",
      knowledge_claim_ids: "ids into public methodology tables, which have no demo counterpart",
      rejection_reason: "only meaningful on rejected findings, which are never exported",
      context_explains_it: "internal analysis flag; not rendered by any demo page",
      emergency_swing_suspected: "internal analysis flag; not rendered by any demo page",
      suggest_priority: "internal analysis flag; not rendered by any demo page",
    },
    defaulted: {},
    fk: { player_id: "players", video_clip_id: "video_clips", analysis_run_id: "analysis_runs" },
    required: ["id", "player_id", "issue", "seen_in_at_bats", "likely_cause", "effect", "review_status", "evidence", "coaching_cue", "look_for_next", "created_at"],
  },
  player_priorities: {
    source: "public.player_priorities", target: "player_priorities",
    copy: [
      "title", "description", "category", "status", "priority_order", "first_identified_at", "last_observed_at",
      "resolved_at", "coach_notes", "follow_up_kind", "follow_up_date", "follow_up_swings", "follow_up_note",
      "follow_up_done_at", "follow_up_set_at", "created_at", "updated_at",
    ],
    transformed: {
      id: "deterministic fixture id", player_id: "fixture player", team_id: "per-clone demo team (placeholder)",
      source_issue_id: "fixture issue, or null (warned) when that issue isn't exported",
    },
    omitted: { created_by_coach_id: AUTH_UUID },
    defaulted: {},
    fk: { player_id: "players", team_id: "team", source_issue_id: "issues" },
    required: ["id", "player_id", "team_id", "title", "description", "status", "priority_order", "first_identified_at", "coach_notes", "created_at", "updated_at"],
  },
  player_priority_status_history: {
    source: "public.player_priority_status_history", target: "player_priority_status_history",
    copy: ["from_status", "to_status", "note", "changed_at"],
    transformed: { id: "deterministic fixture id", player_priority_id: "fixture priority" },
    omitted: { changed_by: AUTH_UUID },
    defaulted: {},
    fk: { player_priority_id: "player_priorities" },
    required: ["id", "player_priority_id", "to_status", "changed_at"],
  },
  player_priority_drills: {
    source: "public.player_priority_drills", target: "player_priority_drills",
    copy: ["assigned_at", "active", "coach_note"],
    transformed: {
      id: "deterministic fixture id", player_priority_id: "fixture priority",
      drill_id: "team drill -> fixture id; global drill -> resolved by slug at clone time",
    },
    omitted: { assigned_by: AUTH_UUID },
    defaulted: {},
    fk: { player_priority_id: "player_priorities", drill_id: "drill_library" },
    required: ["id", "player_priority_id", "assigned_at", "active", "coach_note"],
  },
  player_priority_observations: {
    source: "public.player_priority_observations", target: "player_priority_observations",
    copy: ["phase", "observed_at", "status", "coach_note", "confidence", "context", "created_at"],
    transformed: {
      id: "deterministic fixture id", player_priority_id: "fixture priority",
      video_clip_id: "fixture clip, or null (warned) when that clip isn't allowlisted",
      practice_repetition_id: "fixture rep, or null (warned)",
      at_bat_pitch_id: "fixture pitch, or null (warned)",
      practice_session_id: "fixture session, or null (warned)",
    },
    omitted: { ai_suggestion: AI_UNREVIEWED, created_by: AUTH_UUID },
    defaulted: {},
    fk: {
      player_priority_id: "player_priorities", video_clip_id: "video_clips", practice_repetition_id: "practice_repetitions",
      at_bat_pitch_id: "at_bat_pitches", practice_session_id: "practice_sessions",
    },
    required: ["id", "player_priority_id", "observed_at", "status", "coach_note", "created_at"],
  },
  player_share_links: {
    source: "(synthesized - never copied from public.player_share_links)", target: "player_share_links",
    copy: [],
    transformed: { id: "deterministic fixture id", player_id: "fixture player" },
    omitted: {
      token: "a real share token is a bearer secret", created_by: AUTH_UUID,
      created_at: "regenerated per clone", expires_at: "regenerated per clone", revoked_at: "regenerated per clone",
    },
    defaulted: {
      token: "null in the fixture; a fresh random token per visitor clone",
      created_at: "clone time", expires_at: "clone time + 90 days", revoked_at: "null",
    },
    fk: { player_id: "players" },
    required: ["id", "player_id"],
  },
};

/** Every target column a fixture row for `table` must carry (must equal the real demo.* column set). */
export function targetColumns(table: FixtureTable): string[] {
  const spec = ENTITY_SPECS[table];
  return [...new Set([...spec.copy, ...Object.keys(spec.transformed), ...Object.keys(spec.defaulted)])].sort();
}

export class TranslationError extends Error {}

/**
 * Checks a raw source row against the spec's accounting rules: every source
 * column must be copied, transformed, or explicitly omitted. Returns the
 * unaccounted-for column names (empty = OK). Callers turn a non-empty result
 * into a validation error - never a silent drop.
 */
export function unaccountedSourceColumns(table: FixtureTable, sourceRow: Row): string[] {
  const spec = ENTITY_SPECS[table];
  const known = new Set([...spec.copy, ...Object.keys(spec.transformed), ...Object.keys(spec.omitted)]);
  // Transformed-by-reference columns keep their source name (checkpoint_id,
  // phase_type_id) and are listed in `transformed`, so they're covered above.
  return Object.keys(sourceRow).filter((col) => !known.has(col)).sort();
}

/**
 * Builds one target row: verbatim copies from `sourceRow`, then `values`
 * for every transformed/defaulted column. Throws if `values` doesn't supply
 * exactly the transformed+defaulted set (a spec/implementation mismatch is a
 * programming error, not a data problem).
 */
export function buildTargetRow(table: FixtureTable, sourceRow: Row | null, values: Row, refs?: Record<string, { table: RefTable; slug: string }>): Row {
  const spec = ENTITY_SPECS[table];
  const expected = [...new Set([...Object.keys(spec.transformed), ...Object.keys(spec.defaulted)])].sort();
  const given = Object.keys(values).sort();
  if (expected.join(",") !== given.join(",")) {
    throw new TranslationError(`${table}: transformed/defaulted values mismatch - expected [${expected.join(", ")}], got [${given.join(", ")}]`);
  }
  const out: Row = {};
  for (const col of spec.copy) {
    if (!sourceRow || !(col in sourceRow)) {
      throw new TranslationError(`${table}: source row is missing copied column "${col}"`);
    }
    out[col] = sourceRow[col];
  }
  Object.assign(out, values);
  if (refs && Object.keys(refs).length) out._refs = refs;
  return out;
}
