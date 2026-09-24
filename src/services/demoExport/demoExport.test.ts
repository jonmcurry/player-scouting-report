import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { buildFixture, fixtureContentSha256, mediaVersionTag, type SourceSnapshot } from "./buildFixture.js";
import { parseCurationManifest, type CurationManifest } from "./curationManifest.js";
import { fixtureUuid } from "./ids.js";
import { buildFfmpegArgs, readStage0Context } from "./media.js";
import { ENTITY_SPECS, FIXTURE_TABLE_ORDER, targetColumns, type Row } from "./translation.js";
import { comparePairAvailable, hasErrors, validateFixture, type Finding } from "./validate.js";

// ---------------------------------------------------------------------------
// Realistic source snapshot: exactly the column shapes public.* has today
// (00001-00030), for one player with two game at-bats, a baseline/post-drill
// practice session, a non-allowlisted clip, every review state, and a real
// analysis-run provenance record.
// ---------------------------------------------------------------------------
let n = 0;
const uid = () => `00000000-0000-4000-a000-${String(++n).padStart(12, "0")}`;
const T0 = "2026-07-12T18:00:00+00:00";

function snapshot(): SourceSnapshot & { ids: Record<string, string> } {
  n = 0;
  const ids: Record<string, string> = {};
  const id = (k: string) => (ids[k] = uid());
  const coach = uid();
  const team = { id: id("team"), slug: "local-team", name: "Local Team 10U", created_at: T0, sport: "softball", level_label: "10U" };
  const player = {
    id: id("player"), team_id: team.id, slug: "local-player", name: "Real Athlete Name", jersey_number: "8", created_at: T0,
    refilm_by: null, what_to_check_next: "Front side at plant", age_band: "8-10", bats: "R", throws: "R",
  };
  const checkpoints = [
    { id: id("cp-load"), slug: "load", label: "Load", sort_order: 1 },
    { id: id("cp-stride"), slug: "stride", label: "Stride / front-foot plant", sort_order: 2 },
    { id: id("cp-head"), slug: "head-eyes", label: "Head/eyes", sort_order: 8 },
  ];
  const phaseTypes = ["stance", "load", "stride", "contact", "extension", "follow-through"].map((slug, i) => ({ id: id(`pt-${slug}`), slug, label: slug, sort_order: i }));
  const drills = [
    { id: id("drill-global"), team_id: null, slug: "split-stance-tee", name: "Split-stance tee drill", purpose: "p", target_tags: ["front-side-stability"], instructions: "i", equipment: "e", age_notes: "a", coach_notes: "", reference_url: null, is_active: true, created_at: T0 },
    { id: id("drill-team"), team_id: team.id, slug: "our-fence-drill", name: "Fence drill", purpose: "p", target_tags: [], instructions: "i", equipment: "", age_notes: "", coach_notes: "team only", reference_url: null, is_active: true, created_at: T0 },
  ];
  const entry = (k: string, over: Row) => ({
    id: id(k), player_id: player.id, date: "2026-07-12", opponent: "Eagles", ab: 1, pitch: null, result: "Line drive single", clip_gcs_path: null,
    position: 0, created_at: T0, pitch_zone: null, pitch_outcome: null, outcome: null, session_type: "game", session_note: null,
    ai_summary: null, ai_summary_generated_at: null, ...over,
  });
  const entries = [
    entry("g1", { clip_gcs_path: "gs://bucket/local-team/local-player/raw/legacy.mp4" }),
    entry("g2", { date: "2026-07-19", opponent: "Hawks", ab: 1, result: "Double to the gap", position: 1, created_at: "2026-07-19T18:00:00+00:00" }),
    entry("p1", { date: "2026-07-15", opponent: null, ab: 1, result: null, session_type: "practice", created_at: "2026-07-15T17:00:00+00:00" }),
    entry("p2", { date: "2026-07-15", opponent: null, ab: 2, result: null, session_type: "practice", created_at: "2026-07-15T17:05:00+00:00" }),
  ];
  const pitch = (k: string, entryK: string, num: number, over: Row) => ({
    id: id(k), game_log_entry_id: ids[entryK], pitch_number: num, count_before_balls: 0, count_before_strikes: 0,
    pitch_type: "fastball", pitch_location: "Middle", pitch_zone: 5, pitch_outcome: "ball", swung: false, notes: null,
    created_at: T0, updated_at: T0, ...over,
  });
  const pitches = [
    pitch("g1p1", "g1", 1, {}),
    pitch("g1p2", "g1", 2, { count_before_balls: 1, pitch_outcome: "ball_in_play", swung: true }),
    pitch("g2p1", "g2", 1, { pitch_outcome: "ball_in_play", swung: true }),
  ];
  const session = {
    id: id("s1"), player_id: player.id, session_date: "2026-07-15", session_goal: "Front side control", focus_priority_id: null as string | null,
    assigned_drill_id: ids["drill-global"], outcome: "mixed", outcome_note: "Better by the end", notes: "10 + 10 reps", created_at: T0, updated_at: T0,
  };
  const reps = [
    { id: id("r1"), practice_session_id: session.id, game_log_entry_id: ids.p1, rep_number: 1, grouping: "baseline", usable: true, notes: "before", created_at: T0, updated_at: T0 },
    { id: id("r2"), practice_session_id: session.id, game_log_entry_id: ids.p2, rep_number: 2, grouping: "post_drill", usable: true, notes: "after", created_at: T0, updated_at: T0 },
  ];
  const clip = (k: string, entryK: string, over: Row) => ({
    id: id(k), game_log_entry_id: ids[entryK], clip_slug: `${k}-slug`, fps: 30, n_frames: 360, duration_s: 12, position: 0, created_at: T0,
    status: "ready", error_message: null, raw_gcs_path: `gs://bucket/local-team/local-player/raw/${k}.mp4`, claimed_at: T0, retry_count: 0,
    next_retry_at: null, at_bat_pitch_id: null, practice_repetition_id: null, ...over,
  });
  const clips = [
    clip("c1", "g1", { at_bat_pitch_id: ids.g1p2, error_message: "C:\\Users\\coach\\frames\\x failed once" }),
    clip("c2", "g2", { at_bat_pitch_id: ids.g2p1 }),
    clip("c3", "p1", { practice_repetition_id: ids.r1 }),
    clip("c4", "p2", { practice_repetition_id: ids.r2 }),
    clip("c5", "g1", { position: 1 }), // second angle of g1 - NOT allowlisted
  ];
  const clipKeys = ["c1", "c2", "c3", "c4", "c5"];
  const metrics = clipKeys.map((k) => ({
    id: id(`m-${k}`), video_clip_id: ids[k], max_bat_speed_value: 41.2, max_bat_speed_unit: "mph", max_bat_speed_search_window_s: 0.4,
    max_bat_speed_frame: 201, max_bat_speed_full_rate_value: null, max_bat_speed_full_rate_source_fps: null, attack_angle_at_contact_deg: 8.5,
    hip_shoulder_separation_at_contact_deg: 21, torso_tilt_at_contact_deg: 12, pelvis_tilt_at_contact_deg: 4, lead_side: "l",
    lead_side_method: "2d_heuristic", lead_elbow_angle_at_contact_deg: 140, front_knee_angle_at_contact_deg: 160,
    l_elbow_angle_at_contact_deg: 140, r_elbow_angle_at_contact_deg: 95, stride_length_hip_widths: 2.1, stride_direction_deg: -4,
    stride_note: null, movement_flags: { early_open: true }, created_at: T0, analysis_quality: { overall: "good", pose_coverage: 0.93 },
  }));
  const blob = "\\x" + "0000803f".repeat(17 * 3 * 2); // 2 frames x 17 joints x xyz float32 LE (1.0)
  const pose = clipKeys.map((k) => ({
    id: id(`pose-${k}`), video_clip_id: ids[k], joint_order: "h36m17", joint_names: Array.from({ length: 17 }, (_, i) => `j${i}`),
    smoothing_method: "one_euro+rigid", frames: [{ frame: 0, time_s: 0, tracked: true, angles: {} }, { frame: 1, time_s: 0.033, tracked: true, angles: {} }],
    created_at: T0, lead_side: "l", joints_blob: blob,
  }));
  const phases = clipKeys.flatMap((k) => ["load", "contact"].map((slug, i) => ({
    id: id(`ph-${k}-${slug}`), video_clip_id: ids[k], phase_type_id: ids[`pt-${slug}`], frame: 100 + i * 80, time_s: 3.3 + i * 2.7,
    method: "metrics.py", confidence: "high", detail: { source: "pose3d" }, created_at: T0, reconstruction_reliable: true,
  })));
  const run = {
    id: id("run1"), video_clip_id: ids.c1, player_id: player.id, backend: "gemini", ai_model: "gemini-2.5-pro", ai_model_version: null,
    prompt_version: "swing-v7", analysis_policy_version: "policy-3", knowledge_version: "k-0.2.0", pipeline_version: "pose3d-1.4",
    input_manifest: { swing_evidence: { frames: ["load.jpg", "contact.jpg"] } }, no_action_needed: false, no_action_reason: null, created_at: T0,
  };
  const issue = (k: string, over: Row) => ({
    id: id(k), player_id: player.id, issue: `${k} finding`, seen_in_at_bats: "AB1 vs Eagles", likely_cause: "cause", effect: "effect",
    reviewed_by: "Real Coach Name", source: "gemini", created_at: T0, at_bats: ["AB1"], review_status: "approved", evidence: "evidence", coaching_cue: "cue",
    suggested_drill: "Split-stance tee drill", look_for_next: "next", confidence: "medium", video_clip_id: ids.c1, phase: "contact",
    suggested_priority_title: "Keep the front side closed", analysis_run_id: run.id, concept: "front_side_stability", basis: "video",
    context_explains_it: false, emergency_swing_suspected: false, knowledge_claim_ids: ["claim-1"], suggest_priority: true, finding_key: `fk-${k}`,
    ai_original: null, rejection_reason: null, ...over,
  });
  const issues = [
    issue("i-approved", {}),
    issue("i-edited", { review_status: "edited", video_clip_id: ids.c2, ai_original: { issue: "original AI wording" } }),
    issue("i-draft", { review_status: "draft", reviewed_by: null }),
    issue("i-rejected", { review_status: "rejected", video_clip_id: ids.c3, rejection_reason: "incorrect" }),
    issue("i-unselected", { video_clip_id: ids.c5 }),
  ];
  const scores = [
    { id: id("sc-load"), player_id: player.id, checkpoint_id: ids["cp-load"], score: 2, ai_draft: 2, reviewed_by: "Real Coach Name", notes: "", source: "gemini", updated_at: T0, at_bats: [], analysis_run_id: run.id },
    { id: id("sc-stride"), player_id: player.id, checkpoint_id: ids["cp-stride"], score: 3, ai_draft: 2, reviewed_by: "Real Coach Name", notes: "coach bumped", source: "gemini", updated_at: T0, at_bats: [], analysis_run_id: null },
    { id: id("sc-head"), player_id: player.id, checkpoint_id: ids["cp-head"], score: 1, ai_draft: 1, reviewed_by: null, notes: "", source: "gemini", updated_at: T0, at_bats: [], analysis_run_id: run.id },
  ];
  const history = [
    { id: id("h1"), checklist_score_id: ids["sc-stride"], score: 2, changed_at: T0, changed_by: null },
    { id: id("h2"), checklist_score_id: ids["sc-stride"], score: 3, changed_at: "2026-07-20T00:00:00+00:00", changed_by: "Real Coach Name" },
    { id: id("h3"), checklist_score_id: ids["sc-head"], score: 1, changed_at: T0, changed_by: null },
  ];
  const priority = {
    id: id("prio"), player_id: player.id, team_id: team.id, title: "Keep the front side closed", description: "Opens early", category: "front-side-stability",
    status: "active", priority_order: 0, first_identified_at: T0, last_observed_at: "2026-07-19T18:00:00+00:00", resolved_at: null,
    source_issue_id: ids["i-approved"], created_by_coach_id: coach, coach_notes: "", follow_up_kind: "next_game", follow_up_date: null,
    follow_up_swings: null, follow_up_note: null, follow_up_done_at: null, follow_up_set_at: T0, created_at: T0, updated_at: T0,
  };
  const archived = { ...priority, id: id("prio-archived"), title: "Old thing", status: "archived", source_issue_id: null };
  session.focus_priority_id = priority.id;
  const statusHistory = [{ id: id("psh1"), player_priority_id: priority.id, from_status: null, to_status: "active", changed_by: coach, note: null, changed_at: T0 }];
  const prioDrills = [
    { id: id("ppd1"), player_priority_id: priority.id, drill_id: ids["drill-global"], assigned_by: coach, assigned_at: T0, active: true, coach_note: "before every tee round" },
    { id: id("ppd2"), player_priority_id: priority.id, drill_id: ids["drill-team"], assigned_by: coach, assigned_at: "2026-07-13T00:00:00+00:00", active: true, coach_note: "" },
  ];
  const obs = (k: string, over: Row) => ({
    id: id(k), player_priority_id: priority.id, video_clip_id: null, practice_repetition_id: null, at_bat_pitch_id: null, practice_session_id: null,
    phase: "contact", observed_at: T0, status: "unchanged", coach_note: "note", ai_suggestion: "AI thinks X", confidence: "medium", context: "practice",
    created_by: coach, created_at: T0, ...over,
  });
  const observations = [
    obs("o1", { video_clip_id: ids.c3, practice_repetition_id: ids.r1, practice_session_id: session.id, observed_at: "2026-07-15T17:00:00+00:00" }),
    obs("o2", { video_clip_id: ids.c4, practice_repetition_id: ids.r2, practice_session_id: session.id, status: "improving", observed_at: "2026-07-15T17:05:00+00:00" }),
    obs("o3", { video_clip_id: ids.c5, context: "game", status: "improving", observed_at: "2026-07-19T18:00:00+00:00" }),
  ];
  return {
    ids, team, player,
    rows: {
      game_log_entries: entries, at_bat_pitches: pitches, video_clips: clips, video_clip_metrics: metrics, video_clip_pose3d: pose,
      swing_phases: phases, analysis_runs: [run], checklist_scores: scores, checklist_score_history: history, issues,
      player_priorities: [priority, archived], player_priority_status_history: statusHistory, player_priority_drills: prioDrills,
      player_priority_observations: observations, practice_sessions: [session], practice_repetitions: reps, drill_library: drills,
      checkpoints, swing_phase_types: phaseTypes,
    },
  };
}

function manifest(over: Partial<CurationManifest> = {}): CurationManifest {
  return {
    manifestVersion: 1, fixtureId: "real-test-player", fixtureVersion: "2026-09-22.1",
    source: { teamSlug: "local-team", playerSlug: "local-player" },
    publication: { consentConfirmedBy: "Parent/guardian via coach", consentConfirmedAt: "2026-09-20" },
    team: { publicName: "Approved Team Name", sport: "softball", levelLabel: "10U" },
    player: { publicName: "Player A.", publicSlug: "player-a" },
    reviewerDisplayName: "Coach Demo",
    clips: ["c1", "c2", "c3", "c4"].map((k) => ({ clipSlug: `${k}-slug`, trim: { startS: 1, endS: 9 }, analysisWindowStartS: 1 })),
    priorities: "all",
    expect: { comparePairs: ["baseline_post", "game_game", "priority_before_after"] },
    ...over,
  };
}

const errors = (f: Finding[]) => f.filter((x) => x.level === "error");
const codes = (f: Finding[]) => new Set(f.map((x) => x.code));
const build = (snap = snapshot(), m = manifest(), mediaMode: "planned" | "skipped" = "planned") => ({ snap, ...buildFixture(snap, m, { mediaMode }) });

// 1 ---------------------------------------------------------------------------
test("minimal player export: one allowlisted clip produces a valid, self-contained fixture", () => {
  const { fixture, findings } = build(snapshot(), manifest({ clips: [{ clipSlug: "c2-slug", trim: { startS: 0, endS: 8 }, analysisWindowStartS: 0 }], priorities: "none", expect: {} }));
  assert.deepEqual(errors(findings), []);
  assert.equal(fixture.tables.players.length, 1);
  assert.equal(fixture.tables.players[0]!.name, "Player A.");
  assert.equal(fixture.tables.players[0]!.slug, "player-a");
  assert.equal(fixture.tables.video_clips.length, 1);
  assert.equal(fixture.tables.game_log_entries.length, 1);
  assert.equal(fixture.tables.player_share_links.length, 1);
  assert.ok(!JSON.stringify(fixture).includes("Real Athlete Name"), "the real name must never be exported");
});

// 2 ---------------------------------------------------------------------------
test("approved and edited findings are exported with provenance and an aliased reviewer", () => {
  const { fixture } = build();
  const byIssue = new Map(fixture.tables.issues.map((i) => [String(i.issue), i]));
  assert.deepEqual([...byIssue.keys()].sort(), ["i-approved finding", "i-edited finding"]);
  const edited = byIssue.get("i-edited finding")!;
  assert.equal(edited.review_status, "edited");
  assert.deepEqual(edited.ai_original, { issue: "original AI wording" });
  assert.equal(edited.reviewed_by, "Coach Demo");
  assert.equal(edited.concept, "front_side_stability");
  const run = fixture.tables.analysis_runs[0]!;
  assert.equal(byIssue.get("i-approved finding")!.analysis_run_id, run.id);
  assert.equal(run.knowledge_version, "k-0.2.0");
  assert.equal(run.prompt_version, "swing-v7");
  assert.ok(!JSON.stringify(fixture).includes("Real Coach Name"), "real coach name must be replaced");
});

// 3 ---------------------------------------------------------------------------
test("draft and rejected findings are excluded by default; drafts only on opt-in and still marked draft", () => {
  const { fixture, exclusions } = build();
  assert.ok(!fixture.tables.issues.some((i) => i.review_status === "draft" || i.review_status === "rejected"));
  const reasons = exclusions.filter((e) => e.table === "issues").map((e) => e.reason);
  assert.ok(reasons.some((r) => /unreviewed AI draft/.test(r)));
  assert.ok(reasons.some((r) => /rejected/.test(r)));
  assert.ok(!fixture.tables.checklist_scores.some((s) => s.reviewed_by === null), "AI-draft checklist scores are never exported");

  const withDrafts = build(snapshot(), manifest({ findings: { includeDrafts: true } }));
  const draft = withDrafts.fixture.tables.issues.find((i) => i.issue === "i-draft finding")!;
  assert.equal(draft.review_status, "draft");
  assert.equal(draft.reviewed_by, null);
  assert.ok(!withDrafts.fixture.tables.issues.some((i) => i.review_status === "rejected"), "rejected is never exported, even with drafts on");

  // Tampering a draft into a no-drafts fixture fails validation.
  const tampered = structuredClone(fixture);
  tampered.tables.issues.push({ ...tampered.tables.issues[0]!, id: fixtureUuid("x", "issues", "y"), review_status: "draft", reviewed_by: null });
  assert.ok(codes(validateFixture(tampered)).has("UNAPPROVED_FINDING"));
});

// 4 ---------------------------------------------------------------------------
test("UUID remap: no source id survives anywhere, fixture ids are unique v8 UUIDs", () => {
  const { fixture, snap } = build();
  const json = JSON.stringify(fixture).toLowerCase();
  for (const sourceId of Object.values(snap.ids)) assert.ok(!json.includes(sourceId), `source id ${sourceId} leaked`);
  const all = FIXTURE_TABLE_ORDER.flatMap((t) => fixture.tables[t].map((r) => String(r.id)));
  assert.equal(new Set(all).size, all.length);
  for (const id of all) assert.match(id, /^[0-9a-f]{8}-[0-9a-f]{4}-8[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/);
  assert.equal(fixtureUuid("f", "t", "s"), fixtureUuid("f", "t", "s"));
  assert.notEqual(fixtureUuid("f", "t", "s"), fixtureUuid("g", "t", "s"), "different fixtures never share ids");
});

// 5 ---------------------------------------------------------------------------
test("FK relationships are preserved through the remap", () => {
  const { fixture, snap } = build();
  const fx = (table: string, key: string) => fixtureUuid("real-test-player", table, snap.ids[key]!);
  const c1 = fixture.tables.video_clips.find((c) => c.id === fx("video_clips", "c1"))!;
  assert.equal(c1.at_bat_pitch_id, fx("at_bat_pitches", "g1p2"));
  assert.equal(c1.game_log_entry_id, fx("game_log_entries", "g1"));
  const c3 = fixture.tables.video_clips.find((c) => c.id === fx("video_clips", "c3"))!;
  assert.equal(c3.practice_repetition_id, fx("practice_repetitions", "r1"));
  const prio = fixture.tables.player_priorities.find((p) => p.title === "Keep the front side closed")!;
  assert.equal(prio.source_issue_id, fx("issues", "i-approved"));
  assert.equal(prio.team_id, fixture.teamPlaceholderId);
  assert.equal(fixture.tables.practice_sessions[0]!.focus_priority_id, prio.id);
  assert.deepEqual(errors(validateFixture(fixture)).filter((f) => f.code === "FK_DANGLING"), []);

  const broken = structuredClone(fixture);
  broken.tables.swing_phases[0]!.video_clip_id = fixtureUuid("x", "video_clips", "nope");
  assert.ok(codes(validateFixture(broken)).has("FK_DANGLING"));
});

// 6 ---------------------------------------------------------------------------
test("schema translation: exact target columns, explicit omissions, and drift fails closed", () => {
  const { fixture } = build();
  for (const t of FIXTURE_TABLE_ORDER) {
    for (const r of fixture.tables[t]) {
      assert.deepEqual(Object.keys(r).filter((k) => k !== "_refs").sort(), targetColumns(t), `${t} row shape`);
    }
  }
  const json = JSON.stringify(fixture);
  for (const omitted of ["clip_gcs_path", "created_by_coach_id", "ai_suggestion", "knowledge_claim_ids", "rejection_reason", "assigned_by"]) {
    assert.ok(!json.includes(`"${omitted}"`), `${omitted} must not be exported`);
  }
  assert.ok(Object.keys(ENTITY_SPECS.video_clips.omitted).includes("raw_gcs_path"));

  const drifted = snapshot();
  (drifted.rows.issues[0] as Row).brand_new_column = "x";
  const res = buildFixture(drifted, manifest(), { mediaMode: "planned" });
  const drift = errors(res.findings).find((f) => f.code === "SCHEMA_DRIFT");
  assert.ok(drift && /brand_new_column/.test(drift.message));
});

// 7 ---------------------------------------------------------------------------
test("missing human metadata is surfaced as errors, and explicit overrides fix + record it", () => {
  const snap = snapshot();
  (snap.rows.game_log_entries.find((e) => e.id === snap.ids.g2)! as Row).opponent = null;
  (snap.rows.at_bat_pitches.find((p) => p.id === snap.ids.g1p2)! as Row).count_before_strikes = null;
  const m = manifest();
  delete (m.clips[1] as { trim?: unknown }).trim;
  const res = buildFixture(snap, m, { mediaMode: "planned" });
  const msgs = errors(res.findings).map((f) => `${f.code}: ${f.message}`);
  assert.ok(msgs.some((x) => /HUMAN_METADATA_MISSING.*opponent/.test(x)));
  assert.ok(msgs.some((x) => /HUMAN_METADATA_MISSING.*count_before_strikes/.test(x)));
  assert.ok(msgs.some((x) => /HUMAN_TRIM_MISSING/.test(x)));

  const fixed = manifest();
  fixed.clips[0]!.overrides = { atBatPitch: { count_before_strikes: 1 } };
  fixed.clips[1]!.overrides = { gameLogEntry: { opponent: "Hawks" } };
  const ok = buildFixture(snap, fixed, { mediaMode: "planned" });
  assert.deepEqual(errors(ok.findings), []);
  assert.deepEqual(ok.fixture.curation.overrides.map((o) => `${o.table}.${o.column}:${String(o.from)}->${String(o.to)}`).sort(),
    ["at_bat_pitches.count_before_strikes:null->1", "game_log_entries.opponent:null->Hawks"]);

  const noConsent = parseCurationManifest({ ...manifest(), publication: { consentConfirmedBy: "", consentConfirmedAt: "" } });
  assert.equal(noConsent.manifest, null);
  assert.ok(noConsent.problems.some((p) => p.path === "publication"));
  const noName = parseCurationManifest({ ...manifest(), player: { publicSlug: "x-y" } });
  assert.ok(noName.problems.some((p) => p.path === "player.publicName"));
});

// 8 ---------------------------------------------------------------------------
test("clip allowlist: only selected clips export; unrelated clips and their findings stay local", () => {
  const { fixture, exclusions, snap } = build();
  assert.equal(fixture.tables.video_clips.length, 4);
  assert.ok(exclusions.some((e) => e.table === "video_clips" && e.sourceId === snap.ids.c5));
  assert.ok(exclusions.some((e) => e.table === "issues" && e.sourceId === snap.ids["i-unselected"] && /not allowlisted/.test(e.reason)));
  assert.equal(fixture.tables.video_clip_pose3d.length, 4, "pose for the unselected clip is not exported");

  // A clip belonging to someone else is simply not found - never exported.
  const other = build(snapshot(), manifest({ clips: [{ sourceClipId: "11111111-2222-4333-8444-555555555555", trim: "full" }] }));
  assert.ok(codes(other.findings).has("CLIP_NOT_FOUND"));

  // Validation catches a clip smuggled in after selection.
  const smuggled = structuredClone(fixture);
  smuggled.tables.video_clips.push({ ...smuggled.tables.video_clips[0]!, id: fixtureUuid("x", "video_clips", "smuggled"), demo_media_path: "x-clip-999.mp4" });
  const selectedClipIds = new Set(fixture.tables.video_clips.map((c) => String(c.id)));
  assert.ok(codes(validateFixture(smuggled, { selectedClipIds })).has("CLIP_NOT_ALLOWLISTED"));
});

// 9 ---------------------------------------------------------------------------
test("private/local fields are stripped and any leak fails closed", () => {
  const { fixture } = build();
  for (const c of fixture.tables.video_clips) {
    assert.equal(c.raw_gcs_path, null);
    assert.equal(c.error_message, null, "worker diagnostics (which carried a local path) are dropped");
    assert.equal(c.claimed_at, null);
  }
  assert.equal(fixture.tables.player_share_links[0]!.token, null);
  const json = JSON.stringify(fixture);
  assert.ok(!/gs:\/\/|C:\\\\|frames\\\\/.test(json));

  const leaky = structuredClone(fixture);
  leaky.tables.swing_phases[0]!.detail = { debug: "C:\\Users\\jonmc\\dev\\softball_analysis\\frames\\x\\overlay.mp4" };
  leaky.tables.analysis_runs[0]!.input_manifest = { auth: ["eyJ", "hbGciOiJIUzI1NiJ9", ".eyJ", "yb2xlIjoic2VydmljZV9yb2xlIn0", ".sig"].join("") }; // fake, assembled so scanners do not flag it
  leaky.tables.video_clip_metrics[0]!.analysis_quality = { api_key: "abc" };
  const found = codes(validateFixture(leaky));
  assert.ok(found.has("LEAK_LOCAL_PATH"));
  assert.ok(found.has("LEAK_SECRET"));
  assert.ok(found.has("LEAK_FORBIDDEN_KEY"));
});

// 10 --------------------------------------------------------------------------
test("pose / metrics / phase data export intact, with phase types resolved by slug", () => {
  const { fixture, snap } = build();
  const srcPose = snap.rows.video_clip_pose3d[0]!;
  const pose = fixture.tables.video_clip_pose3d.find((p) => p.video_clip_id === fixtureUuid("real-test-player", "video_clips", snap.ids.c1!))!;
  assert.equal(pose.joints_blob, srcPose.joints_blob, "binary joint trajectory is copied byte-for-byte");
  assert.deepEqual(pose.joint_names, srcPose.joint_names);
  assert.equal(pose.lead_side, "l");
  const m = fixture.tables.video_clip_metrics[0]!;
  assert.deepEqual(m.analysis_quality, { overall: "good", pose_coverage: 0.93 });
  assert.equal(m.attack_angle_at_contact_deg, 8.5);
  assert.equal(fixture.tables.swing_phases.length, 8);
  for (const ph of fixture.tables.swing_phases) {
    assert.equal(ph.phase_type_id, null);
    assert.equal((ph._refs as Record<string, { table: string }>).phase_type_id!.table, "swing_phase_types");
  }
  const scoreRefs = fixture.tables.checklist_scores.map((s) => (s._refs as Record<string, { slug: string }>).checkpoint_id!.slug).sort();
  assert.deepEqual(scoreRefs, ["load", "stride"]);
});

// 11 --------------------------------------------------------------------------
test("report-related records: share link, reviewed scores + history, priority drills and observations", () => {
  const { fixture, findings } = build();
  assert.equal(fixture.tables.player_share_links.length, 1);
  assert.equal(fixture.tables.checklist_scores.length, 2);
  // Only coach-verified history of exported verified scores: the AI-draft entry
  // (changed_by null) would read as a score change (progress) in public trends.
  assert.equal(fixture.tables.checklist_score_history.length, 1, "only coach-verified history is exported");
  assert.deepEqual(fixture.tables.checklist_score_history.map((h) => [h.changed_by, h.review_status]), [["Coach Demo", "verified"]]);
  assert.equal(fixture.tables.player_priorities.length, 1, "archived priority is not included by \"all\"");
  assert.equal(fixture.tables.player_priority_status_history.length, 1);
  const drills = fixture.tables.player_priority_drills;
  assert.equal(drills.length, 2);
  const global = drills.find((d) => d.drill_id === null)!;
  assert.deepEqual(global._refs, { drill_id: { table: "drill_library", slug: "split-stance-tee" } });
  assert.equal(fixture.tables.drill_library.length, 1, "team-scoped drill is carried into the fixture");
  assert.equal(drills.find((d) => d.drill_id !== null)!.drill_id, fixture.tables.drill_library[0]!.id);
  const o3 = fixture.tables.player_priority_observations.find((o) => o.context === "game")!;
  assert.equal(o3.video_clip_id, null, "observation evidence on a non-allowlisted clip is unlinked...");
  assert.ok(findings.some((f) => f.code === "REF_DROPPED" && f.table === "player_priority_observations"), "...and that is reported, not silent");

  const empty = build(snapshot(), manifest({ priorities: "none", clips: [{ clipSlug: "c2-slug", trim: "full" }], expect: {} }));
  const snapNoScores = snapshot();
  snapNoScores.rows.checklist_scores = [];
  const bare = buildFixture(snapNoScores, manifest({ priorities: "none", clips: [{ clipSlug: "c2-slug", trim: "full" }], expect: {} }), { mediaMode: "planned" });
  assert.ok(!codes(empty.findings).has("REPORT_EMPTY"));
  assert.ok(codes(bare.findings).has("REPORT_EMPTY"));
});

// 12 --------------------------------------------------------------------------
test("Compare records: every expected pair kind is formable, and a missing one fails", () => {
  const { fixture, findings } = build();
  assert.deepEqual(errors(findings), []);
  for (const k of ["baseline_post", "game_game", "priority_before_after"]) assert.ok(comparePairAvailable(fixture, k), k);

  const noPost = build(snapshot(), manifest({ clips: ["c1", "c2", "c3"].map((k) => ({ clipSlug: `${k}-slug`, trim: { startS: 1, endS: 9 }, analysisWindowStartS: 1 })) }));
  const missing = errors(noPost.findings).filter((f) => f.code === "COMPARE_PAIR_MISSING").map((f) => f.message);
  assert.ok(missing.some((m) => /baseline_post/.test(m)));
  assert.ok(missing.some((m) => /priority_before_after/.test(m)));
});

// 13 --------------------------------------------------------------------------
test("Practice records: session/rep/entry linkage, focus priority, drill, and grouping overrides", () => {
  const { fixture } = build();
  const session = fixture.tables.practice_sessions[0]!;
  assert.deepEqual(session._refs, { assigned_drill_id: { table: "drill_library", slug: "split-stance-tee" } });
  const reps = fixture.tables.practice_repetitions;
  assert.deepEqual(reps.map((r) => r.grouping).sort(), ["baseline", "post_drill"]);
  for (const r of reps) {
    assert.equal(r.practice_session_id, session.id);
    const entry = fixture.tables.game_log_entries.find((e) => e.id === r.game_log_entry_id)!;
    assert.equal(entry.session_type, "practice");
  }

  const snap = snapshot();
  (snap.rows.practice_repetitions[1] as Row).grouping = "free_swing";
  const m = manifest();
  m.clips[3]!.overrides = { practiceRepetition: { grouping: "post_drill" } };
  const fixed = buildFixture(snap, m, { mediaMode: "planned" });
  assert.deepEqual(errors(fixed.findings), []);
  assert.ok(fixed.fixture.curation.overrides.some((o) => o.column === "grouping" && o.to === "post_drill"));

  const broken = snapshot();
  (broken.rows.video_clips.find((c) => c.id === broken.ids.c3)! as Row).practice_repetition_id = broken.ids.r2;
  assert.ok(codes(buildFixture(broken, manifest(), { mediaMode: "planned" }).findings).has("LINKAGE"));
});

// 14 --------------------------------------------------------------------------
test("deterministic re-export: identical inputs (in any row order) give a byte-identical fixture", () => {
  const a = build().fixture;
  const shuffled = snapshot();
  for (const rows of Object.values(shuffled.rows)) rows.reverse();
  const b = buildFixture(shuffled, manifest(), { mediaMode: "planned" }).fixture;
  assert.equal(JSON.stringify(a), JSON.stringify(b));
  assert.equal(a.contentSha256, fixtureContentSha256(a));
  const tampered = structuredClone(a);
  tampered.tables.issues[0]!.issue = "hand edited";
  assert.notEqual(fixtureContentSha256(tampered), a.contentSha256, "hand edits are detectable");
});

// 15 --------------------------------------------------------------------------
test("invalid source data fails closed", () => {
  const unprocessed = snapshot();
  (unprocessed.rows.video_clips.find((c) => c.id === unprocessed.ids.c2)! as Row).status = "failed";
  unprocessed.rows.swing_phases = unprocessed.rows.swing_phases.filter((p) => p.video_clip_id !== unprocessed.ids.c1);
  unprocessed.rows.video_clip_pose3d = unprocessed.rows.video_clip_pose3d.filter((p) => p.video_clip_id !== unprocessed.ids.c3);
  (unprocessed.rows.analysis_runs[0] as Row).ai_model = null;
  (unprocessed.rows.issues[0] as Row).review_status = "maybe";
  const res = buildFixture(unprocessed, manifest(), { mediaMode: "planned" });
  const found = codes(errors(res.findings));
  for (const code of ["CLIP_NOT_PROCESSED", "CLIP_NO_PHASES", "CLIP_NO_POSE3D", "REQUIRED_FIELD", "REVIEW_STATE_UNKNOWN"]) assert.ok(found.has(code), code);
  assert.ok(hasErrors(res.findings));

  const noAlias = buildFixture(snapshot(), manifest({ reviewerDisplayName: undefined }), { mediaMode: "planned" });
  assert.ok(codes(noAlias.findings).has("HUMAN_REVIEWER_ALIAS_MISSING"));
});

// --- media + manifest helpers -------------------------------------------------
test("ffmpeg invocation is H.264/yuv420p/faststart, strips metadata, and drops audio unless opted in", () => {
  const args = buildFfmpegArgs({ src: "in.mp4", out: "out.mp4", trim: { startS: 1.5, endS: 7.25 }, includeAudio: false });
  const joined = args.join(" ");
  assert.match(joined, /-ss 1\.500 -to 7\.250 -i in\.mp4/);
  for (const needle of ["out_range=tv", "-color_range tv", "-c:v libx264", "-pix_fmt yuv420p", "-movflags +faststart", "-map_metadata -1", "-an", "-fpsmax 60"]) assert.ok(joined.includes(needle), needle);
  assert.ok(!joined.includes("aac"));
  const withAudio = buildFfmpegArgs({ src: "in.mp4", out: "out.mp4", trim: "full", includeAudio: true }).join(" ");
  assert.ok(withAudio.includes("-c:a aac") && !withAudio.includes("-ss"));
  assert.equal(args.at(-1), "out.mp4");
});

test("stage0.json alignment: untrimmed -> 0, single window -> its start, multiple candidates -> ambiguous", () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "stage0-"));
  const put = (clip: string, body: unknown) => {
    fs.mkdirSync(path.join(root, "p", clip), { recursive: true });
    fs.writeFileSync(path.join(root, "p", clip, "stage0.json"), JSON.stringify(body));
  };
  put("a", { trimmed: false, video_path_for_pipeline: "videos\\_uploads\\a.mp4" });
  put("b", { trimmed: true, trim_start_s: 213.072, candidate_windows: null });
  put("c", { trimmed: true, trim_start_s: 142.192, candidate_windows: [{}, {}, {}] });
  assert.deepEqual(readStage0Context(root, "p", "a"), { analysisWindowStartS: 0 });
  assert.deepEqual(readStage0Context(root, "p", "b"), { analysisWindowStartS: 213.072, analysisWindowAmbiguous: false });
  assert.equal(readStage0Context(root, "p", "c")!.analysisWindowAmbiguous, true);
  assert.equal(readStage0Context(root, "p", "missing"), null);
  fs.rmSync(root, { recursive: true, force: true });

  const snap = snapshot();
  const ctx = new Map([[snap.ids.c1!, { analysisWindowStartS: 10 }]]);
  const m = manifest();
  delete m.clips[0]!.analysisWindowStartS; // let stage0.json supply it
  const res = buildFixture(snap, m, { mediaMode: "planned", clipContext: ctx });
  const c1 = res.fixture.tables.video_clips.find((c) => c.clip_slug === "player-a-clip-001")!;
  assert.equal(c1.demo_media_offset_s, 9, "analysis t=0 at source 10s, media starts at source 1s -> +9s");
  assert.equal(c1.demo_media_path, "real-test-player-2026-09-22.1-clip-001.mp4");

  const unknown = manifest();
  delete unknown.clips[1]!.analysisWindowStartS;
  const bad = buildFixture(snapshot(), unknown, { mediaMode: "planned" });
  assert.ok(errors(bad.findings).some((f) => f.code === "MEDIA_ALIGNMENT_UNKNOWN"), "published media with unknown phase alignment fails closed");
});

test("media can be skipped explicitly; the fixture then names no media files", () => {
  const m = manifest();
  for (const c of m.clips) delete (c as { trim?: unknown }).trim;
  const res = buildFixture(snapshot(), m, { mediaMode: "skipped" });
  assert.deepEqual(errors(res.findings), []);
  assert.ok(res.fixture.tables.video_clips.every((c) => c.demo_media_path === null && c.demo_media_offset_s === null));
});

test("Emily-only fixture carries its own publication-approved team; a missing team name fails closed", () => {
  const { fixture, findings } = build();
  assert.deepEqual(fixture.team, { name: "Approved Team Name", sport: "softball", level_label: "10U" });
  assert.equal(fixture.tables.players.length, 1);
  assert.deepEqual(errors(findings), []);
  const noTeam = parseCurationManifest({ ...manifest(), team: { publicName: "" } });
  assert.ok(noTeam.problems.some((p) => p.path === "team.publicName"));
  const tampered = structuredClone(fixture);
  tampered.team.name = " ";
  assert.ok(codes(validateFixture(tampered)).has("HUMAN_TEAM_NAME_MISSING"));
});

test("media filenames are version-stamped so a new fixture version never collides with cached old media", () => {
  assert.equal(mediaVersionTag("2026-09-23.1"), "2026-09-23.1");
  assert.equal(mediaVersionTag("Release 2/Final"), "release-2-final");
  const v1 = build(snapshot(), manifest({ fixtureVersion: "2026-09-23.1" })).fixture;
  const v2 = build(snapshot(), manifest({ fixtureVersion: "2026-09-23.2" })).fixture;
  const names = (fx: typeof v1) => new Set(fx.tables.video_clips.map((c) => String(c.demo_media_path)));
  for (const n of names(v1)) assert.ok(!names(v2).has(n));
});

test("local-validation mode: unconfirmed human facts become labelled warnings, the fixture is stamped, and it can't pose as consented", () => {
  const snap = snapshot();
  (snap.rows.game_log_entries.find((e) => e.id === snap.ids.g2)! as Row).opponent = null;
  const m = manifest({ localValidationOnly: true, fixtureId: "local-real-test", publication: undefined });
  const parsed = parseCurationManifest(JSON.parse(JSON.stringify(m)));
  assert.deepEqual(parsed.problems, []);
  const res = buildFixture(snap, m, { mediaMode: "planned" });
  assert.deepEqual(errors(res.findings), []);
  const unconfirmed = res.findings.filter((f) => f.message.startsWith("UNCONFIRMED"));
  assert.ok(unconfirmed.some((f) => f.code === "HUMAN_METADATA_MISSING"));
  assert.equal(res.fixture.curation.localValidationOnly, true);
  assert.equal(res.fixture.curation.consentRecorded, false);
  // Non-human errors still fail closed in this mode.
  const broken = snapshot();
  (broken.rows.video_clips.find((c) => c.id === broken.ids.c1)! as Row).status = "failed";
  assert.ok(codes(errors(buildFixture(broken, m, { mediaMode: "planned" }).findings)).has("CLIP_NOT_PROCESSED"));
  // The local- prefix is reserved in both directions.
  assert.ok(parseCurationManifest({ ...m, fixtureId: "real-x" }).problems.some((p) => p.path === "fixtureId"));
  assert.ok(parseCurationManifest({ ...manifest(), fixtureId: "local-x" }).problems.some((p) => p.path === "fixtureId"));
});

test("unfilled worksheet placeholders are rejected everywhere in the manifest", () => {
  const r = parseCurationManifest({ ...manifest(), team: { publicName: "REQUIRED FROM USER" }, publication: { consentConfirmedBy: "REQUIRED FROM USER", consentConfirmedAt: "2026-09-23" } });
  assert.ok(r.problems.some((p) => p.path === "team.publicName" && /placeholder/.test(p.message)));
  assert.ok(r.problems.some((p) => p.path === "publication.consentConfirmedBy"));
  assert.equal(r.manifest, null);
});

test("clip slugs are neutral public aliases, and forbidden public terms anywhere in the fixture fail closed", () => {
  const { fixture, findings } = build();
  assert.deepEqual(errors(findings), []);
  const slugs = fixture.tables.video_clips.map((c) => c.clip_slug).sort();
  assert.ok(slugs.every((s) => /^player-a-clip-\d{3}$/.test(String(s))), `local filename-derived slugs must not be published: ${slugs.join(", ")}`);
  assert.ok(!JSON.stringify(fixture).includes("-slug"), "no local clip slug survives anywhere in the fixture");

  const m = manifest();
  m.forbiddenPublicTerms = ["approved team"];
  const leak = buildFixture(snapshot(), m, { mediaMode: "planned" });
  const hit = errors(leak.findings).filter((f) => f.code === "LEAK_FORBIDDEN_TERM");
  assert.ok(hit.length > 0 && hit.every((f) => !f.message.toLowerCase().includes("approved team")), "found, and the message never echoes the term itself");
  assert.ok(parseCurationManifest({ ...manifest(), forbiddenPublicTerms: ["ab"] }).problems.some((p) => p.path === "forbiddenPublicTerms"));
});

test("checklist review states: verified exports, insufficient exports without AI draft/note, rejected and ai_draft never export", () => {
  const snap = snapshot();
  const [load, stride, head] = snap.rows.checklist_scores as Row[];
  load!.review_status = "verified";
  stride!.review_status = "insufficient_evidence"; stride!.score = null; stride!.notes = "AI rationale that must not be published";
  head!.review_status = "rejected"; head!.score = null; head!.reviewed_by = "Real Coach Name"; head!.notes = "rejected AI text";
  const { fixture, findings } = buildFixture(snap, manifest(), { mediaMode: "planned" });
  assert.deepEqual(errors(findings), []);
  const byState = Object.fromEntries(fixture.tables.checklist_scores.map((r) => [r.review_status, r]));
  assert.deepEqual(Object.keys(byState).sort(), ["insufficient_evidence", "verified"], "rejected is never exported");
  assert.equal(byState.insufficient_evidence!.score, null);
  assert.equal(byState.insufficient_evidence!.ai_draft, null, "the AI's number is not published for an insufficient checkpoint");
  assert.equal(byState.insufficient_evidence!.notes, "", "the AI's rationale is not published for an insufficient checkpoint");
  assert.ok(!JSON.stringify(fixture).includes("rejected AI text") && !JSON.stringify(fixture).includes("AI rationale that must not be published"));

  const leak = structuredClone(fixture);
  leak.tables.checklist_scores.push({ ...byState.verified!, id: fixtureUuid("x", "y", "leak"), review_status: "rejected", score: null });
  assert.ok(validateFixture(leak).some((f) => f.code === "REJECTED_SCORE"), "a rejected draft in a fixture fails closed");
  const drafty = structuredClone(fixture);
  drafty.tables.checklist_scores.find((r) => r.review_status === "insufficient_evidence")!.ai_draft = 2;
  assert.ok(validateFixture(drafty).some((f) => f.code === "INSUFFICIENT_LEAKS_DRAFT"));
});

test("publishAsUnknown: declared-unverified fields export as null with a warning; undeclared missing fields still fail", () => {
  const snap = snapshot();
  const m = manifest();
  (m.clips[0] as { publishAsUnknown?: unknown }).publishAsUnknown = { gameLogEntry: ["opponent", "result"] };
  const { fixture, findings } = buildFixture(snap, m, { mediaMode: "planned" });
  const entry = fixture.tables.game_log_entries.find((e) => e.opponent === null && e.result === null);
  assert.ok(entry, "the declared fields are published as unknown (null), not as the local value");
  assert.ok(!JSON.stringify({ entries: fixture.tables.game_log_entries, overrides: fixture.curation.overrides }).includes("Eagles"),
    "the local opponent name is published neither in the at-bat nor in the override log (free text elsewhere is guarded by forbiddenPublicTerms)");
  assert.ok(findings.some((f) => f.code === "HUMAN_METADATA_DECLARED_UNKNOWN"));
  assert.ok(!errors(findings).some((f) => f.code === "HUMAN_METADATA_MISSING" && f.table === "game_log_entries" && f.id === entry!.id));

  const bad = parseCurationManifest({ ...manifest(), clips: [{ ...manifest().clips[0], publishAsUnknown: { gameLogEntry: ["date"] } }] });
  assert.ok(bad.problems.some((p) => p.path.endsWith("publishAsUnknown")), "only the listed fields may be declared unknown");
  const both = parseCurationManifest({ ...manifest(), clips: [{ ...manifest().clips[0], overrides: { gameLogEntry: { opponent: "X" } }, publishAsUnknown: { gameLogEntry: ["opponent"] } }] });
  assert.ok(both.problems.some((p) => p.message.includes("both overridden and declared unknown")));
});
