/** Local integration regression; migrations through 00059 and local Auth required. */
import { before, after, test } from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import "dotenv/config";

const url = process.env.SUPABASE_URL ?? "";
if (!/^https?:\/\/(localhost|127\.0\.0\.1)(:\d+)?\/?$/.test(url))
  throw new Error("Comparison integration tests require local Supabase");
const anonKey = process.env.SUPABASE_ANON_KEY, serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
if (!anonKey || !serviceKey) throw new Error("Local Supabase keys are required");
const service = createClient(url, serviceKey, { auth: { persistSession: false } });
const marker = randomUUID().slice(0, 8);
const users: string[] = [], clips: string[] = [];
let coach: SupabaseClient, guardian: SupabaseClient, outsider: SupabaseClient;
let coachId: string, teamId: string, playerId: string, definitionId: string;
let methodologyVersion: string;

async function user(label: string) {
  const password = `pw-${randomUUID()}`;
  const made = await service.auth.admin.createUser({ email: `comparison-${label}-${marker}@example.test`, password, email_confirm: true });
  if (made.error) throw made.error;
  users.push(made.data.user.id);
  const client = createClient(url, anonKey!, { auth: { persistSession: false } });
  const login = await client.auth.signInWithPassword({ email: made.data.user.email!, password });
  if (login.error) throw login.error;
  return { id: made.data.user.id, client };
}
async function insert(table: string, row: Record<string, unknown>): Promise<string> {
  const { data, error } = await service.from(table).insert(row).select("id").single();
  if (error) throw error;
  return data.id;
}
async function addRun(clipId: string, revision: string, value: number | null) {
  const runId = await insert("analysis_runs", { player_id: playerId, video_clip_id: clipId,
    backend: "gemini", ai_model: "test-model", ai_model_version: "model-1",
    prompt_version: "prompt-1", analysis_policy_version: "policy-1",
    knowledge_version: methodologyVersion, pipeline_version: revision, input_manifest: {} });
  if (value === null) return;
  const attempt = await service.from("swing_attempts").select("id").eq("video_clip_id", clipId).single();
  assert.ifError(attempt.error);
  const packageId = await insert("analysis_evidence_packages", { analysis_run_id: runId,
    player_id: playerId, video_clip_id: clipId, swing_attempt_id: attempt.data.id,
    result_key: "phase_pct", pipeline_version: revision, detector_version: "detector-1",
    measurement_version: "1.0.0", methodology_version: methodologyVersion, prompt_version: "prompt-1",
    model_version: "model-1", source_manifest_hash: "a".repeat(64) });
  await insert("analysis_evidence_items", { package_id: packageId, item_order: 0,
    kind: "frame", role: "included", source_frame_start: 30,
    source_fps: 60, visibility: "visible" });
  await insert("analysis_technical_results", { package_id: packageId, definition_id: definitionId,
    source_class: "video_estimated", value, uncertainty: { status: "frame_bounded" } });
}

before(async () => {
  const c = await user("coach"), g = await user("guardian"), o = await user("outsider");
  coachId = c.id; coach = c.client; guardian = g.client; outsider = o.client;
  const method = await service.from("methodology_versions").select("version_label")
    .order("created_at", { ascending: false }).limit(1).single();
  assert.ifError(method.error);
  methodologyVersion = method.data.version_label;
  teamId = await insert("teams", { slug: `comparison-${marker}`, name: "Comparison test", sport: "softball" });
  const grant = await service.from("coach_team_access").insert({ coach_id: coachId, team_id: teamId, role: "head_coach" });
  assert.ifError(grant.error);
  playerId = await insert("players", { team_id: teamId, slug: `player-${marker}`, name: "Test hitter", jersey_number: "0" });
  const access = await service.from("coach_analysis_access").insert({ team_id: teamId, coach_id: coachId,
    enabled_at: new Date().toISOString(), training_acknowledged_at: new Date().toISOString() });
  assert.ifError(access.error);
  definitionId = await insert("measurement_definitions", { slug: `phase_pct_${marker}`, version: "1.0.0",
    display_name: "Test phase percentage", plain_definition: "Fixture percentage only",
    source_class: "video_estimated", sports: ["softball"], intents: ["conventional_full"],
    capture_profiles: ["game_backstop"], unit: "%", aggregate_min_sample: 5,
    trend_min_sample: 10, uncertainty_method: "frame bounds", visibility: ["coach"],
    limitations: "Local fixture only", prohibited_interpretations: ["No clinical claim"], created_by: coachId });
  const decisionId = await insert("measurement_validation_decisions", { definition_id: definitionId,
    status: "validated_internal", rationale: "Local fixture only", decided_by: coachId });
  for (let i = 0; i < 5; i++) {
    const entry = await insert("game_log_entries", { player_id: playerId,
      date: `2026-10-${String(i + 1).padStart(2, "0")}`, opponent: "Test", ab: i + 1, result: "Out" });
    const clip = await insert("video_clips", { game_log_entry_id: entry, clip_slug: `comparison-${marker}-${i}`,
      status: "ready", swing_detection_state: "readable" });
    clips.push(clip);
    const snapshot = await service.rpc("record_legacy_attempt_snapshot", { p_clip_id: clip,
      p_source_revision: "fixture-v1", p_events: [] });
    assert.ifError(snapshot.error);
    const attempt = await service.from("swing_attempts").select("id").eq("video_clip_id", clip).single();
    assert.ifError(attempt.error);
    await insert("swing_attempt_context_history", { swing_attempt_id: attempt.data.id,
      revision: 2, source: "coach_correction", sport: "softball", environment: "game",
      intent: "conventional_full", actor_id: coachId, reason: "Fixture context reviewed" });
    await insert("clip_capture_assessments", { video_clip_id: clip, assessment_version: "fixture-v1",
      stage: "full", source_sha256: "b".repeat(64), declared_profile_slug: "game_backstop",
      declared_profile_version: "1.0.0", inferred_profile_slug: "unknown_imported",
      inferred_profile_version: "1.0.0", inference_status: "unavailable", orientation: "portrait",
      camera_motion: "unavailable", blur: "unavailable", exposure: "unavailable",
      athlete_ambiguity: "unavailable", obstructions: {}, phase_visibility: {},
      profile_plausibility: "supported" });
    await addRun(clip, "pipe-1", i + 1);
  }
  const beforeRelease = await coach.rpc("list_comparison_definitions", { p_clip_id: clips[0] });
  assert.ifError(beforeRelease.error);
  assert.deepEqual(beforeRelease.data, []);
  const selfRelease = await service.from("comparison_definition_releases").insert({
    definition_id: definitionId, validation_decision_id: decisionId, approved_by: coachId,
    approval_record: "Self approval must fail" });
  assert.ok(selfRelease.error);
  await insert("comparison_definition_releases", { definition_id: definitionId,
    validation_decision_id: decisionId, approved_by: g.id,
    approval_record: "Disposable fixture only; no real definition released" });
});

after(async () => {
  if (teamId) await service.from("teams").delete().eq("id", teamId);
  if (definitionId) {
    await service.from("comparison_definition_releases").delete().eq("definition_id", definitionId);
    await service.from("measurement_validation_decisions").delete().eq("definition_id", definitionId);
    await service.from("measurement_definitions").delete().eq("id", definitionId);
  }
  for (const id of users) await service.auth.admin.deleteUser(id);
});

test("coach-only version captures five attempts, statistics, and transparent ledger", async () => {
  for (const client of [guardian, outsider]) {
    const denied = await client.rpc("build_comparison_set", { p_reference_clip_id: clips[0],
      p_definition_id: definitionId, p_omit_attempts: [] });
    assert.ok(denied.error);
  }
  const direct = await coach.from("comparison_set_members").select("value_numeric");
  assert.ok(direct.error || direct.data?.length === 0);
  const made = await coach.rpc("build_comparison_set", { p_reference_clip_id: clips[0],
    p_definition_id: definitionId, p_omit_attempts: [] });
  assert.ifError(made.error);
  const read = await coach.rpc("get_comparison_set", { p_set_id: made.data });
  assert.ifError(read.error);
  assert.equal(read.data.status, "descriptive");
  assert.equal(read.data.aggregate.count, 5);
  assert.equal(read.data.aggregate.median, 3);
  assert.equal(read.data.aggregate.q1, 2);
  assert.equal(read.data.aggregate.q3, 4);
  assert.equal(read.data.aggregate.iqr, 2);
  assert.equal(read.data.trend, null);
  assert.equal(read.data.members.length, 5);
  const rewrite = await service.from("comparison_sets").update({ version: 999 }).eq("id", made.data);
  assert.ok(rewrite.error);
  const rewriteMember = await service.from("comparison_set_members").update({ value_numeric: 100 })
    .eq("comparison_set_id", made.data).eq("clip_id", clips[0]);
  assert.ok(rewriteMember.error);
  const otherRead = await outsider.rpc("get_comparison_set", { p_set_id: made.data });
  assert.ok(otherRead.error);
});

test("coach narrowing creates a new insufficient version; concurrent builders get distinct versions", async () => {
  const attempt = await service.from("swing_attempts").select("id").eq("video_clip_id", clips[4]).single();
  assert.ifError(attempt.error);
  const narrowed = await coach.rpc("build_comparison_set", { p_reference_clip_id: clips[0],
    p_definition_id: definitionId, p_omit_attempts: [attempt.data.id] });
  assert.ifError(narrowed.error);
  const read = await coach.rpc("get_comparison_set", { p_set_id: narrowed.data });
  assert.ifError(read.error);
  assert.equal(read.data.status, "insufficient_sample");
  assert.equal(read.data.aggregate, null);
  assert.equal(read.data.members.find((m: { reason: string }) => m.reason === "coach_excluded")?.value, null);
  const parallel = await Promise.all([0, 1].map(() => coach.rpc("build_comparison_set", {
    p_reference_clip_id: clips[0], p_definition_id: definitionId, p_omit_attempts: [] })));
  parallel.forEach((result) => assert.ifError(result.error));
  const versions = await Promise.all(parallel.map((result) => coach.rpc("get_comparison_set", { p_set_id: result.data })));
  versions.forEach((result) => assert.ifError(result.error));
  assert.notEqual(versions[0].data.version, versions[1].data.version);
});

test("reprocessing and deletion withhold an old aggregate and redact retained values", async () => {
  const made = await coach.rpc("build_comparison_set", { p_reference_clip_id: clips[0],
    p_definition_id: definitionId, p_omit_attempts: [] });
  assert.ifError(made.error);
  await addRun(clips[1], "pipe-2", null);
  const stale = await coach.rpc("get_comparison_set", { p_set_id: made.data });
  assert.ifError(stale.error);
  assert.equal(stale.data.status, "stale");
  assert.equal(stale.data.aggregate, null);
  const deletion = await service.from("clip_deletions").insert({ clip_id: clips[2],
    player_slug: `player-${marker}`, clip_slug: `comparison-${marker}-2`,
    requested_by: coachId, requested_by_role: "coach" });
  assert.ifError(deletion.error);
  const retained = await service.from("comparison_set_members").select("value_numeric,exclusion_reason")
    .eq("comparison_set_id", made.data).eq("clip_id", clips[2]).single();
  assert.ifError(retained.error);
  assert.equal(retained.data.value_numeric, null);
  assert.equal(retained.data.exclusion_reason, "deleted_media");
});

test("evidence-package or attempt removal strips its numeric member", async () => {
  const made = await coach.rpc("build_comparison_set", { p_reference_clip_id: clips[0],
    p_definition_id: definitionId, p_omit_attempts: [] });
  assert.ifError(made.error);
  const packageRow = await service.from("analysis_evidence_packages").select("id")
    .eq("video_clip_id", clips[3]).single();
  assert.ifError(packageRow.error);
  const removePackage = await service.from("analysis_evidence_packages").delete().eq("id", packageRow.data.id);
  assert.ifError(removePackage.error);
  const afterPackage = await service.from("comparison_set_members").select("value_numeric,exclusion_reason")
    .eq("comparison_set_id", made.data).eq("clip_id", clips[3]).single();
  assert.ifError(afterPackage.error);
  assert.equal(afterPackage.data.value_numeric, null);
  assert.equal(afterPackage.data.exclusion_reason, "missing_result");
  const attempt = await service.from("swing_attempts").select("id").eq("video_clip_id", clips[4]).single();
  assert.ifError(attempt.error);
  const removeAttempt = await service.from("swing_attempts").delete().eq("id", attempt.data.id);
  assert.ifError(removeAttempt.error);
  const afterAttempt = await service.from("comparison_set_members").select("value_numeric,exclusion_reason")
    .eq("comparison_set_id", made.data).eq("clip_id", clips[4]).single();
  assert.ifError(afterAttempt.error);
  assert.equal(afterAttempt.data.value_numeric, null);
  const stale = await coach.rpc("get_comparison_set", { p_set_id: made.data });
  assert.ifError(stale.error);
  assert.equal(stale.data.status, "stale");
});

test("a newer validation decision withdraws availability and stales saved sets", async () => {
  const existing = await service.from("comparison_sets").select("id").eq("player_id", playerId)
    .order("version", { ascending: false }).limit(1).single();
  assert.ifError(existing.error);
  await insert("measurement_validation_decisions", { definition_id: definitionId,
    status: "retired", rationale: "Fixture withdrawal", decided_by: coachId });
  const available = await coach.rpc("list_comparison_definitions", { p_clip_id: clips[0] });
  assert.ifError(available.error);
  assert.deepEqual(available.data, []);
  const stale = await coach.rpc("get_comparison_set", { p_set_id: existing.data.id });
  assert.ifError(stale.error);
  assert.equal(stale.data.status, "stale");
  assert.equal(stale.data.aggregate, null);
});
