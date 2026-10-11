/** Local Supabase integration test; requires migrations through 00058. */
import { before, after, test } from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import "dotenv/config";

const url = process.env.SUPABASE_URL ?? "";
if (!/^https?:\/\/(localhost|127\.0\.0\.1)(:\d+)?\/?$/.test(url))
  throw new Error("Coach analysis tests require a local Supabase URL");
const anonKey = process.env.SUPABASE_ANON_KEY;
const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
if (!anonKey || !serviceKey) throw new Error("Local Supabase keys are required");
const service = createClient(url, serviceKey, { auth: { persistSession: false } });
const marker = randomUUID().slice(0, 8);
const users: string[] = [];
let coach: SupabaseClient, guardian: SupabaseClient, outsider: SupabaseClient;
let coachId: string, teamId: string, playerId: string, clipId: string, otherClipId: string, noSwingId: string;

async function user(label: string) {
  const password = `pw-${randomUUID()}`;
  const made = await service.auth.admin.createUser({ email: `phase4-${label}-${marker}@example.test`, password, email_confirm: true });
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

before(async () => {
  const c = await user("coach"), g = await user("guardian"), o = await user("outsider");
  coachId = c.id; coach = c.client; guardian = g.client; outsider = o.client;
  teamId = await insert("teams", { slug: `phase4-${marker}`, name: "Phase 4 test", sport: "softball" });
  const grant = await service.from("coach_team_access").insert({ coach_id: coachId, team_id: teamId, role: "head_coach" });
  if (grant.error) throw grant.error;
  playerId = await insert("players", { team_id: teamId, slug: `p-${marker}`, name: "Test hitter", jersey_number: "0" });
  const consent = await service.from("app_settings").select("value").eq("key", "guardian_consent_version").single();
  if (consent.error) throw consent.error;
  const link = await service.from("player_guardians").insert({ user_id: g.id, player_id: playerId,
    relationship: "parent", consent_version: consent.data.value, invited_by: coachId });
  if (link.error) throw link.error;
  const entry = await insert("game_log_entries", { player_id: playerId, date: "2026-10-10", opponent: "Test", ab: 1, result: "Out" });
  clipId = await insert("video_clips", { game_log_entry_id: entry, clip_slug: `main-${marker}`,
    status: "ready", swing_detection_state: "readable" });
  otherClipId = await insert("video_clips", { game_log_entry_id: entry, clip_slug: `other-${marker}`,
    status: "ready", swing_detection_state: "readable" });
  noSwingId = await insert("video_clips", { game_log_entry_id: entry, clip_slug: `no-${marker}`,
    status: "ready", swing_detection_state: "confirmed_no_swing" });
  for (const id of [clipId, otherClipId]) {
    const snapshot = await service.rpc("record_legacy_attempt_snapshot", { p_clip_id: id,
      p_source_revision: "pipeline:test-v1", p_events: [{ event_slug: "contact_estimate",
        frame: 30, time_s: 1.0, visibility: "partial", pipeline_version: "test-v1" }] });
    assert.ifError(snapshot.error);
  }
  await insert("analysis_runs", { player_id: playerId, video_clip_id: clipId, backend: "gemini",
    ai_model: "test-model", ai_model_version: "test-model-1", prompt_version: "prompt-1",
    analysis_policy_version: "policy-1", knowledge_version: "method-1", pipeline_version: "pipe-1", input_manifest: {} });
});

after(async () => {
  if (teamId) await service.from("teams").delete().eq("id", teamId);
  for (const id of users) await service.auth.admin.deleteUser(id);
});

test("coach analysis stays gated, player scoped, and excludes no-swing", async () => {
  const beforeGate = await coach.rpc("coach_analysis_available", { p_clip_id: clipId });
  assert.ifError(beforeGate.error);
  assert.equal(beforeGate.data, false);
  const denied = await coach.rpc("get_coach_analysis", { p_clip_id: clipId });
  assert.ok(denied.error);
  const enable = await service.from("coach_analysis_access").insert({ team_id: teamId, coach_id: coachId,
    enabled_at: new Date().toISOString(), training_acknowledged_at: new Date().toISOString() });
  assert.ifError(enable.error);
  const available = await coach.rpc("coach_analysis_available", { p_clip_id: clipId });
  assert.ifError(available.error);
  assert.equal(available.data, true);
  for (const client of [guardian, outsider]) {
    const privateRead = await client.rpc("get_coach_analysis", { p_clip_id: clipId });
    assert.ok(privateRead.error);
    const flag = await client.rpc("coach_analysis_available", { p_clip_id: clipId });
    assert.ifError(flag.error);
    assert.equal(flag.data, false);
  }
  const noSwing = await coach.rpc("get_coach_analysis", { p_clip_id: noSwingId });
  assert.ok(noSwing.error);
  const result = await coach.rpc("get_coach_analysis", { p_clip_id: clipId });
  assert.ifError(result.error);
  assert.equal(result.data.phases[0].slug, "contact_estimate");
  assert.equal(result.data.phases[0].uncertaintyStatus, "unquantified");
  assert.equal(result.data.candidates.length, 1);
  assert.equal(result.data.candidates[0].clipId, otherClipId);
  assert.equal(JSON.stringify(result.data).includes("raw_gcs_path"), false);
  assert.deepEqual(result.data.evidencePackages, []);
});

test("coach text notes are guardian-visible only, audited, and removable", async () => {
  for (const client of [guardian, outsider]) {
    const denied = await client.rpc("add_coach_text_annotation", { p_clip_id: clipId,
      p_event_slug: "contact_estimate", p_body: "See the front side", p_visibility: "guardian_visible" });
    assert.ok(denied.error);
  }
  const privateNote = await coach.rpc("add_coach_text_annotation", { p_clip_id: clipId,
    p_event_slug: "contact_estimate", p_body: "Private thought", p_visibility: "staff_private" });
  assert.ok(privateNote.error);
  const added = await coach.rpc("add_coach_text_annotation", { p_clip_id: clipId,
    p_event_slug: "contact_estimate", p_body: "Watch the original front side", p_visibility: "guardian_visible" });
  assert.ifError(added.error);
  const direct = await coach.from("coach_annotation_events").select("body");
  assert.ok(direct.error || direct.data?.length === 0);
  const read = await coach.rpc("get_coach_analysis", { p_clip_id: clipId });
  assert.ifError(read.error);
  assert.equal(read.data.annotations.length, 1);
  assert.equal(read.data.annotations[0].visibility, "guardian_visible");
  const guardianRead = await guardian.rpc("get_guardian_coach_annotations", { p_clip_id: clipId });
  assert.ifError(guardianRead.error);
  assert.equal(guardianRead.data.length, 1);
  const outsiderRead = await outsider.rpc("get_guardian_coach_annotations", { p_clip_id: clipId });
  assert.ok(outsiderRead.error);
  const gone = await coach.rpc("delete_coach_text_annotation", { p_annotation_id: added.data });
  assert.ifError(gone.error);
  const reread = await coach.rpc("get_coach_analysis", { p_clip_id: clipId });
  assert.ifError(reread.error);
  assert.equal(reread.data.annotations.length, 0);
  const guardianAfterDelete = await guardian.rpc("get_guardian_coach_annotations", { p_clip_id: clipId });
  assert.ifError(guardianAfterDelete.error);
  assert.deepEqual(guardianAfterDelete.data, []);
  const history = await service.from("coach_annotation_events").select("action").eq("annotation_id", added.data);
  assert.ifError(history.error);
  assert.deepEqual(history.data.map((row) => row.action).sort(), ["create", "delete"]);
  const missingEvidence = await coach.rpc("get_analysis_evidence", { p_package_id: randomUUID() });
  assert.ok(missingEvidence.error);
});
