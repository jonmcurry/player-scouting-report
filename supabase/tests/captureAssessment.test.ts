/** Local Supabase integration test; requires migrations through 00056. */
import { before, after, test } from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import "dotenv/config";

const url = process.env.SUPABASE_URL ?? "";
if (!/^https?:\/\/(localhost|127\.0\.0\.1)(:\d+)?\/?$/.test(url))
  throw new Error("Capture integration tests require a local Supabase URL");
const anonKey = process.env.SUPABASE_ANON_KEY;
const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
if (!anonKey || !serviceKey) throw new Error("Local Supabase keys are required");
const service = createClient(url, serviceKey, { auth: { persistSession: false } });
const marker = randomUUID().slice(0, 8);
const users: string[] = [];
let teamId: string, playerId: string, clipId: string, coach: SupabaseClient,
  guardian: SupabaseClient, outsider: SupabaseClient, admin: SupabaseClient;

async function makeUser(label: string) {
  const password = `pw-${randomUUID()}`;
  const created = await service.auth.admin.createUser({ email: `capture-${label}-${marker}@example.test`, password, email_confirm: true });
  if (created.error) throw created.error;
  users.push(created.data.user.id);
  const client = createClient(url, anonKey!, { auth: { persistSession: false } });
  const login = await client.auth.signInWithPassword({ email: created.data.user.email!, password });
  if (login.error) throw login.error;
  return { id: created.data.user.id, client };
}

async function insert(table: string, row: Record<string, unknown>) {
  const { data, error } = await service.from(table).insert(row).select("id").single();
  if (error) throw error;
  return data.id as string;
}

before(async () => {
  const c = await makeUser("coach"), g = await makeUser("guardian"),
    o = await makeUser("other"), a = await makeUser("admin");
  coach = c.client; guardian = g.client; outsider = o.client; admin = a.client;
  const adminGrant = await service.from("methodology_admins").insert({ user_id: a.id });
  if (adminGrant.error) throw adminGrant.error;
  teamId = await insert("teams", { slug: `capture-${marker}`, name: "Capture test", sport: "softball" });
  const coachGrant = await service.from("coach_team_access").insert({ coach_id: c.id, team_id: teamId, role: "head_coach" });
  if (coachGrant.error) throw coachGrant.error;
  playerId = await insert("players", { team_id: teamId, slug: `player-${marker}`, name: "Capture player", jersey_number: "0" });
  const { data: consent, error: consentError } = await service.from("app_settings").select("value")
    .eq("key", "guardian_consent_version").single();
  if (consentError) throw consentError;
  const link = await service.from("player_guardians").insert({ user_id: g.id, player_id: playerId,
    relationship: "parent", consent_version: consent.value, invited_by: c.id });
  if (link.error) throw link.error;
  const entry = await insert("game_log_entries", { player_id: playerId, date: "2026-10-10", opponent: "Test", ab: 1, result: "Out" });
  clipId = await insert("video_clips", { game_log_entry_id: entry, clip_slug: `capture-${marker}`,
    status: "ready", uploaded_by: g.id, uploaded_by_role: "guardian" });
});

after(async () => {
  if (clipId) await service.from("video_clips").delete().eq("id", clipId);
  if (teamId) await service.from("teams").delete().eq("id", teamId);
  if (users[3]) await service.from("methodology_admins").delete().eq("user_id", users[3]);
  for (const id of users) await service.auth.admin.deleteUser(id);
});

test("guardian declares their own upload; coach correction appends; unrelated roles fail", async () => {
  const initial = await guardian.rpc("record_clip_capture_profile", {
    p_clip_id: clipId, p_profile_slug: "game_backstop", p_kind: "declared" });
  assert.ifError(initial.error);
  const retry = await guardian.rpc("record_clip_capture_profile", {
    p_clip_id: clipId, p_profile_slug: "game_backstop", p_kind: "declared" });
  assert.ifError(retry.error);
  assert.equal(retry.data, initial.data);
  for (const client of [guardian, outsider, admin]) {
    const correction = await client.rpc("record_clip_capture_profile", {
      p_clip_id: clipId, p_profile_slug: "open_side_practice", p_kind: "coach_correction" });
    assert.ok(correction.error);
  }
  const disabled = await coach.rpc("record_clip_capture_profile", {
    p_clip_id: clipId, p_profile_slug: "catcher_view_practice", p_kind: "coach_correction" });
  assert.ok(disabled.error);
  const corrected = await coach.rpc("record_clip_capture_profile", {
    p_clip_id: clipId, p_profile_slug: "open_side_practice", p_kind: "coach_correction" });
  assert.ifError(corrected.error);
  const rows = await service.from("clip_capture_declarations").select("kind,profile_slug").eq("video_clip_id", clipId);
  assert.ifError(rows.error);
  assert.equal(rows.data?.length, 2);
});

test("assessment is private, summary is player scoped, and deletion removes metadata", async () => {
  const row = { video_clip_id: clipId, assessment_version: "capture-v1", stage: "full",
    source_sha256: "a".repeat(64), declared_profile_slug: "open_side_practice", declared_profile_version: "1.0.0",
    inferred_profile_slug: "unknown_imported", inferred_profile_version: "1.0.0",
    inference_status: "unavailable", orientation: "landscape", frame_width: 1920, frame_height: 1080,
    camera_motion: "unavailable", blur: "unavailable", exposure: "unavailable", athlete_ambiguity: "unavailable",
    obstructions: { fence: "unavailable", catcher: "unavailable", umpire: "unavailable", generic: "unavailable" },
    phase_visibility: { contact: { body: "visible", bat: "partial" } },
    profile_plausibility: "unavailable", recommendations: ["bat_arc"] };
  const assessmentId = await insert("clip_capture_assessments", row);
  for (const client of [coach, guardian, outsider, admin]) {
    const direct = await client.from("clip_capture_assessments").select("source_sha256");
    assert.ok(direct.error || direct.data?.length === 0);
  }
  for (const client of [coach, guardian]) {
    const result = await client.rpc("get_clip_capture_summary", { p_clip_id: clipId });
    assert.ifError(result.error);
    assert.equal(result.data.state, "checked");
    assert.deepEqual(result.data.recommendations, ["bat_arc"]);
    assert.equal(JSON.stringify(result.data).includes("a".repeat(64)), false);
  }
  for (const client of [outsider, admin]) {
    const result = await client.rpc("get_clip_capture_summary", { p_clip_id: clipId });
    assert.ok(result.error);
  }
  const changed = await service.from("clip_capture_assessments").update({ blur: "possible_issue" }).eq("id", assessmentId);
  assert.ok(changed.error);
  const deleted = await service.from("video_clips").delete().eq("id", clipId);
  assert.ifError(deleted.error);
  const remaining = await service.from("clip_capture_assessments").select("id").eq("id", assessmentId);
  assert.ifError(remaining.error);
  assert.equal(remaining.data?.length, 0);
});
