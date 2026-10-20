/** Synthetic local integration test; apply 00067 locally before running. Never applies migrations. */
import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import "dotenv/config";

const url = process.env.SUPABASE_URL ?? "";
if (!["localhost", "127.0.0.1", "[::1]"].includes(new URL(url).hostname)) throw new Error("Local Supabase required");
const service = createClient(url, process.env.SUPABASE_SERVICE_ROLE_KEY!, { auth: { persistSession: false } });
const anonymous = createClient(url, process.env.SUPABASE_ANON_KEY!, { auth: { persistSession: false } });
const marker = randomUUID();
const users: string[] = [];
let teamId: string, playerId: string, clipId: string, guardianId: string, currentConsent: string;
let coach: SupabaseClient, guardian: SupabaseClient, outsider: SupabaseClient;
function must<T>(result: { data: T; error: { message: string } | null }): T {
  if (result.error) throw new Error(result.error.message);
  return result.data;
}
async function insert(table: string, values: Record<string, unknown>) {
  return must(await service.from(table).insert(values).select("id").single()).id as string;
}
async function user(label: string) {
  const password = randomUUID();
  const created = must(await service.auth.admin.createUser({ email: `v2-${label}-${marker}@example.test`, password, email_confirm: true }));
  users.push(created.user.id);
  const client = createClient(url, process.env.SUPABASE_ANON_KEY!, { auth: { persistSession: false } });
  must(await client.auth.signInWithPassword({ email: created.user.email!, password }));
  return { client, id: created.user.id };
}
before(async () => {
  // Fail before creating fixtures if the local migration is missing.
  must(await service.from("experimental_v2_results").select("video_clip_id").limit(0));
  const c = await user("coach"), g = await user("guardian"), o = await user("other");
  coach = c.client; guardian = g.client; outsider = o.client;
  teamId = await insert("teams", { slug: `v2-${marker}`, name: "Synthetic v2 team" });
  playerId = await insert("players", { team_id: teamId, slug: `v2-${marker}`, name: "Synthetic player", jersey_number: "0" });
  must(await service.from("coach_team_access").insert({ team_id: teamId, coach_id: c.id, role: "coach" }));
  const consent = must(await service.from("app_settings").select("value").eq("key", "guardian_consent_version").single()).value as string;
  must(await service.from("player_guardians").insert({ player_id: playerId, user_id: g.id, relationship: "parent", consent_version: consent }));
  guardianId = g.id; currentConsent = consent;
  const entryId = await insert("game_log_entries", { player_id: playerId, date: "2026-10-20", ab: 1, opponent: "Synthetic" });
  clipId = await insert("video_clips", { game_log_entry_id: entryId, clip_slug: `v2-${marker}`, status: "failed" });
});
after(async () => {
  if (teamId) must(await service.from("teams").delete().eq("id", teamId));
  for (const id of users) must(await service.auth.admin.deleteUser(id));
});
const retry = (client: SupabaseClient) => client.rpc("retry_experimental_v2_clip", { p_clip_id: clipId });
async function setResult(outcome: string, retry_eligible: boolean, status = "failed", claimed_at: string | null = null) {
  must(await service.from("video_clips").update({ status, processing_progress: 98, error_message: "Synthetic failure",
    retry_count: 3, next_retry_at: "2099-01-01T00:00:00Z", claimed_at }).eq("id", clipId));
  must(await service.from("experimental_v2_results").upsert({ video_clip_id: clipId, engine: "v2-exp",
    pipeline_version: "synthetic", outcome, retry_eligible, reason_codes: ["AI_ANALYSIS_FAILED"] }));
}
test("table is service-only; retry requires coach or guardian and eligibility", async () => {
  await setResult("analysis_failed", true);
  for (const client of [anonymous, coach, guardian, outsider]) {
    assert.ok((await client.from("experimental_v2_results").select("*")).error, "table reads denied");
    assert.ok((await client.from("experimental_v2_results").update({ retry_eligible: true }).eq("video_clip_id", clipId)).error, "table writes denied");
  }
  assert.ok((await retry(anonymous)).error);
  assert.ok((await retry(outsider)).error);
  for (const client of [coach, guardian]) {
    await setResult("analysis_failed", true);
    must(await retry(client));
    const clip = must(await service.from("video_clips").select("status, processing_progress, error_message, retry_count, next_retry_at").eq("id", clipId).single());
    assert.deepEqual(clip, { status: "pending", processing_progress: 0, error_message: null, retry_count: 0, next_retry_at: null });
    const row = must(await service.from("experimental_v2_results").select("outcome, retry_eligible, reason_codes").eq("video_clip_id", clipId).single());
    assert.deepEqual(row, { outcome: "processing", retry_eligible: false, reason_codes: [] });
    assert.ok((await retry(client)).error, "retry consumed atomically");
  }
  for (const outcome of ["not_assessable", "analysis_not_enabled", "withheld", "findings", "analysis_failed"]) {
    await setResult(outcome, false);
    assert.ok((await retry(coach)).error, outcome);
  }
  // A ready clip the worker still holds (fresh claim, below 100%) is not retryable; one it let go of is.
  await setResult("processing", false, "ready", new Date().toISOString());
  assert.ok((await retry(coach)).error, "held by the worker");
  await setResult("processing", false, "ready", new Date(Date.now() - 20 * 60_000).toISOString());
  must(await retry(coach));
  // A guardian whose consent is stale is refused like an outsider.
  must(await service.from("player_guardians").update({ consent_version: "stale-consent" }).eq("user_id", guardianId));
  await setResult("analysis_failed", true);
  assert.ok((await retry(guardian)).error, "stale consent");
  must(await service.from("player_guardians").update({ consent_version: currentConsent }).eq("user_id", guardianId));
  await setResult("processing", false, "failed");
  must(await retry(guardian));
  must(await service.from("experimental_v2_results").delete().eq("video_clip_id", clipId));
  assert.ok((await retry(coach)).error, "no result is not retryable");
});
test("outcome constraint and clip cascade are enforced", async () => {
  await setResult("processing", false);
  assert.ok((await service.from("experimental_v2_results").update({ outcome: "invented" }).eq("video_clip_id", clipId)).error);
  must(await service.from("video_clips").delete().eq("id", clipId));
  assert.deepEqual(must(await service.from("experimental_v2_results").select("video_clip_id").eq("video_clip_id", clipId)), []);
});
