/** Local Supabase integration test; requires migrations through 00057. */
import { before, after, test } from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import "dotenv/config";

const url = process.env.SUPABASE_URL ?? "";
if (!/^https?:\/\/(localhost|127\.0\.0\.1)(:\d+)?\/?$/.test(url))
  throw new Error("Attempt integration tests require a local Supabase URL");
const anonKey = process.env.SUPABASE_ANON_KEY;
const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
if (!anonKey || !serviceKey) throw new Error("Local Supabase keys are required");
const db = createClient(url, serviceKey, { auth: { persistSession: false } });
const marker = randomUUID().slice(0, 8);
const users: string[] = [];
let teamId: string, entryId: string, readableId: string, noSwingId: string, unknownId: string;
let coach: SupabaseClient, guardian: SupabaseClient, outsider: SupabaseClient;

async function user(label: string) {
  const password = `pw-${randomUUID()}`;
  const made = await db.auth.admin.createUser({ email: `attempt-${label}-${marker}@example.test`, password, email_confirm: true });
  if (made.error) throw made.error;
  users.push(made.data.user.id);
  const client = createClient(url, anonKey!, { auth: { persistSession: false } });
  const login = await client.auth.signInWithPassword({ email: made.data.user.email!, password });
  if (login.error) throw login.error;
  return { id: made.data.user.id, client };
}
async function insert(table: string, row: Record<string, unknown>): Promise<string> {
  const { data, error } = await db.from(table).insert(row).select("id").single();
  if (error) throw error;
  return data.id;
}

before(async () => {
  const c = await user("coach"), g = await user("guardian"), o = await user("outsider");
  coach = c.client; guardian = g.client; outsider = o.client;
  teamId = await insert("teams", { slug: `attempt-${marker}`, name: "Attempt test", sport: "softball" });
  const grant = await db.from("coach_team_access").insert({ coach_id: c.id, team_id: teamId, role: "head_coach" });
  if (grant.error) throw grant.error;
  const player = await insert("players", { team_id: teamId, slug: `p-${marker}`, name: "Attempt player", jersey_number: "0" });
  const consent = await db.from("app_settings").select("value").eq("key", "guardian_consent_version").single();
  if (consent.error) throw consent.error;
  const link = await db.from("player_guardians").insert({ user_id: g.id, player_id: player,
    relationship: "parent", consent_version: consent.data.value, invited_by: c.id });
  if (link.error) throw link.error;
  entryId = await insert("game_log_entries", { player_id: player, date: "2026-10-10", opponent: "Test", ab: 1, result: "Out" });
  readableId = await insert("video_clips", { game_log_entry_id: entryId, clip_slug: `readable-${marker}`,
    status: "ready", swing_detection_state: "readable" });
  noSwingId = await insert("video_clips", { game_log_entry_id: entryId, clip_slug: `no-swing-${marker}`,
    status: "ready", swing_detection_state: "confirmed_no_swing" });
  unknownId = await insert("video_clips", { game_log_entry_id: entryId, clip_slug: `unknown-${marker}`,
    status: "ready", swing_detection_state: "inconclusive" });
});

after(async () => {
  if (teamId) await db.from("teams").delete().eq("id", teamId);
  for (const id of users) await db.auth.admin.deleteUser(id);
});

test("only readable clips resolve; retries and duplicate insertion cannot double count", async () => {
  const beforeRead = await db.rpc("resolve_legacy_swing_attempt", { p_clip_id: readableId, p_create: false });
  assert.ifError(beforeRead.error);
  assert.equal(beforeRead.data, null);
  for (const clipId of [noSwingId, unknownId]) {
    const result = await db.rpc("resolve_legacy_swing_attempt", { p_clip_id: clipId, p_create: true });
    assert.ifError(result.error);
    assert.equal(result.data, null);
  }
  const first = await db.rpc("resolve_legacy_swing_attempt", { p_clip_id: readableId, p_create: true });
  assert.ifError(first.error);
  const retry = await db.rpc("resolve_legacy_swing_attempt", { p_clip_id: readableId, p_create: true });
  assert.ifError(retry.error);
  assert.equal(first.data, retry.data);
  const duplicate = await db.from("swing_attempts").insert({ video_clip_id: readableId,
    source_detection_state: "readable" });
  assert.ok(duplicate.error);
  const classified = await db.from("swing_attempt_context_history").select("sport,environment,intent,revision")
    .eq("swing_attempt_id", first.data).single();
  assert.ifError(classified.error);
  assert.deepEqual(classified.data, { sport: "softball", environment: "game", intent: "unknown", revision: 1 });
  const missingVersion = await db.from("swing_attempt_context_history").insert({
    swing_attempt_id: first.data, revision: 2, source: "classified", sport: "softball",
    environment: "game", intent: "unknown", classifier_version: null,
  });
  assert.ok(missingVersion.error);
  const changedSource = await db.from("game_log_entries").update({ session_type: "practice" }).eq("id", entryId);
  assert.ifError(changedSource.error);
  const reclassified = await db.rpc("resolve_legacy_swing_attempt", { p_clip_id: readableId, p_create: true });
  assert.ifError(reclassified.error);
  const latest = await db.from("swing_attempt_context_history").select("revision,environment")
    .eq("swing_attempt_id", first.data).order("revision", { ascending: false }).limit(1).single();
  assert.ifError(latest.error);
  assert.deepEqual(latest.data, { revision: 2, environment: "unknown" });
  const restored = await db.from("game_log_entries").update({ session_type: "game" }).eq("id", entryId);
  assert.ifError(restored.error);
  const reclassifiedAgain = await db.rpc("resolve_legacy_swing_attempt", { p_clip_id: readableId, p_create: true });
  assert.ifError(reclassifiedAgain.error);
});

test("snapshot and coach corrections append; unrelated roles and direct reads fail", async () => {
  const phaseType = await db.from("swing_phase_types").select("id").eq("slug", "contact").single();
  assert.ifError(phaseType.error);
  const legacy = await db.from("swing_phases").insert({ video_clip_id: readableId,
    phase_type_id: phaseType.data.id, frame: 40, time_s: 1.3, confidence: "low" });
  assert.ifError(legacy.error);
  for (let i = 0; i < 2; i++) {
    const backfill = await db.rpc("record_legacy_attempt_snapshot", {
      p_clip_id: readableId, p_source_revision: "legacy-backfill-v1", p_events: null });
    assert.ifError(backfill.error);
  }
  const payload = [{ event_slug: "contact_estimate", frame: 42, time_s: 1.4,
    pipeline_version: "pipeline-v1", detector_version: "detector-v1",
    visibility: "partial", confidence: "low" },
  { event_slug: "legacy_load", frame: null, time_s: null, visibility: "unavailable" }];
  for (let i = 0; i < 2; i++) {
    const result = await db.rpc("record_legacy_attempt_snapshot", {
      p_clip_id: readableId, p_source_revision: "pipeline:fixture-v1", p_events: payload });
    assert.ifError(result.error);
  }
  const attempt = await db.from("swing_attempts").select("id").eq("video_clip_id", readableId).single();
  assert.ifError(attempt.error);
  const attemptId = attempt.data.id;
  const events = await db.from("swing_phase_events").select("id,event_slug,uncertainty_status,pipeline_version,detector_version")
    .eq("swing_attempt_id", attemptId);
  assert.ifError(events.error);
  assert.equal(events.data.length, 3);
  assert.ok(events.data.some((row) => row.event_slug === "legacy_load" && row.uncertainty_status === "unavailable"));
  assert.ok(events.data.some((row) => row.event_slug === "contact_estimate"
    && row.pipeline_version === "pipeline-v1" && row.detector_version === "detector-v1"));
  for (const client of [coach, guardian, outsider]) {
    const direct = await client.from("swing_attempts").select("id");
    assert.ok(direct.error || direct.data?.length === 0);
  }
  for (const client of [guardian, outsider]) {
    const denied = await client.rpc("correct_swing_attempt_context", {
      p_attempt_id: attemptId, p_sport: "softball", p_environment: "game", p_intent: "slap",
      p_approach: {}, p_reason: "Reviewed source video" });
    assert.ok(denied.error);
  }
  const corrected = await coach.rpc("correct_swing_attempt_context", {
    p_attempt_id: attemptId, p_sport: "softball", p_environment: "game", p_intent: "slap",
    p_approach: {}, p_reason: "Reviewed source video" });
  assert.ifError(corrected.error);
  const context = await db.from("swing_attempt_context_history").select("revision,intent,source")
    .eq("swing_attempt_id", attemptId).order("revision", { ascending: false });
  assert.ifError(context.error);
  assert.deepEqual(context.data.map((row) => row.intent), ["slap", "unknown", "unknown", "unknown"]);
  const phaseCorrection = await coach.rpc("correct_swing_phase_event", {
    p_attempt_id: attemptId, p_event_slug: "contact_estimate", p_frame: 43, p_time_s: 1.43,
    p_uncertainty_frames: 2, p_visibility: "visible", p_reason: "Frame review" });
  assert.ifError(phaseCorrection.error);
  const reprocessed = await db.rpc("record_legacy_attempt_snapshot", {
    p_clip_id: readableId, p_source_revision: "pipeline:fixture-v2",
    p_events: [{ event_slug: "contact_estimate", frame: 44, time_s: 1.44,
      visibility: "partial", detector_version: "pipeline-v2" }],
  });
  assert.ifError(reprocessed.error);
  const effective = await db.from("effective_swing_phase_events").select("source,frame")
    .eq("swing_attempt_id", attemptId).eq("event_slug", "contact_estimate").single();
  assert.ifError(effective.error);
  assert.deepEqual(effective.data, { source: "coach_correction", frame: 43 });
  const changed = await db.from("swing_attempt_context_history").update({ intent: "bunt" }).eq("id", corrected.data);
  assert.ok(changed.error);
  const downgraded = await db.from("video_clips").update({ swing_detection_state: "inconclusive" }).eq("id", readableId);
  assert.ifError(downgraded.error);
  const inactive = await db.from("active_legacy_swing_attempts").select("id").eq("video_clip_id", readableId);
  assert.ifError(inactive.error);
  assert.equal(inactive.data.length, 0);
  const noLongerResolved = await db.rpc("resolve_legacy_swing_attempt", { p_clip_id: readableId, p_create: false });
  assert.ifError(noLongerResolved.error);
  assert.equal(noLongerResolved.data, null);
  const deleted = await db.from("video_clips").delete().eq("id", readableId);
  assert.ifError(deleted.error);
  const remaining = await db.from("swing_attempts").select("id").eq("id", attemptId);
  assert.ifError(remaining.error);
  assert.equal(remaining.data.length, 0);
});
