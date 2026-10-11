/** Run only against an already running LOCAL Supabase stack after migration 00055. */
import { before, after, test } from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import "dotenv/config";

const url = process.env.SUPABASE_URL ?? "";
if (!/^https?:\/\/(localhost|127\.0\.0\.1)(:\d+)?\/?$/.test(url))
  throw new Error("Evidence integration tests require a local Supabase URL");
const anonKey = process.env.SUPABASE_ANON_KEY;
const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
if (!anonKey || !serviceKey) throw new Error("Local Supabase keys are required");

const service = createClient(url, serviceKey, { auth: { persistSession: false } });
const marker = randomUUID().slice(0, 8);
const users: string[] = [];
let teamId: string;
let playerId: string;
let clipId: string;
let runId: string;
let definitionId: string;
let adminUser: SupabaseClient;
let coach: SupabaseClient;
let outsider: SupabaseClient;

async function user(label: string) {
  const password = `test-${randomUUID()}`;
  const created = await service.auth.admin.createUser({ email: `evidence-${label}-${marker}@example.test`, password, email_confirm: true });
  if (created.error) throw created.error;
  const id = created.data.user.id;
  users.push(id);
  const client = createClient(url, anonKey!, { auth: { persistSession: false } });
  const login = await client.auth.signInWithPassword({ email: created.data.user.email!, password });
  if (login.error) throw login.error;
  return { id, client };
}

async function inserted(table: string, values: Record<string, unknown>): Promise<string> {
  const { data, error } = await service.from(table).insert(values).select("id").single();
  if (error) throw error;
  return data.id as string;
}

before(async () => {
  const a = await user("admin");
  const c = await user("coach");
  const o = await user("other");
  adminUser = a.client; coach = c.client; outsider = o.client;
  const adminGrant = await service.from("methodology_admins").insert({ user_id: a.id });
  if (adminGrant.error) throw adminGrant.error;
  teamId = await inserted("teams", { slug: `evidence-${marker}`, name: "Evidence test", sport: "softball" });
  const coachGrant = await service.from("coach_team_access").insert({ coach_id: c.id, team_id: teamId, role: "head_coach" });
  if (coachGrant.error) throw coachGrant.error;
  playerId = await inserted("players", { team_id: teamId, slug: `player-${marker}`, name: "Evidence test", jersey_number: "0" });
  const entryId = await inserted("game_log_entries", { player_id: playerId, date: "2026-10-10", opponent: "Test", ab: 1, result: "Out" });
  clipId = await inserted("video_clips", { game_log_entry_id: entryId, clip_slug: `evidence-${marker}`, status: "ready" });
  runId = await inserted("analysis_runs", { player_id: playerId, video_clip_id: clipId, backend: "gemini",
    ai_model: "test-model", ai_model_version: "test-model-1", prompt_version: "prompt-1",
    analysis_policy_version: "policy-1", knowledge_version: "method-1", pipeline_version: "pipe-1", input_manifest: {} });
});

after(async () => {
  if (teamId) await service.from("teams").delete().eq("id", teamId);
  if (definitionId) {
    await service.from("measurement_validation_decisions").delete().eq("definition_id", definitionId);
    await service.from("measurement_definitions").delete().eq("id", definitionId);
  }
  if (users[0]) await service.from("methodology_admins").delete().eq("user_id", users[0]);
  for (const id of users) await service.auth.admin.deleteUser(id);
});

test("only methodology admins register definitions and cannot read media evidence", async () => {
  const definition = { slug: `plant_${marker}`, version: "0.1.0", display_name: "Plant visible",
    plain_definition: "A visible front-foot plant", source_class: "video_observed",
    sports: ["softball"], intents: ["conventional_full"], unit: "boolean",
    uncertainty_method: "frame bounds", limitations: "Hidden feet are unavailable",
    prohibited_interpretations: ["No physical force inference"] };
  const denied = await coach.rpc("register_measurement_definition", { p_definition: definition });
  assert.ok(denied.error);
  const accepted = await adminUser.rpc("register_measurement_definition", { p_definition: definition });
  assert.ifError(accepted.error);
  assert.ok(accepted.data);
  definitionId = accepted.data as string;
  const { data: decisions, error } = await service.from("measurement_validation_decisions")
    .select("status").eq("definition_id", accepted.data);
  assert.ifError(error);
  assert.deepEqual(decisions?.map((d) => d.status), ["experimental"]);
  for (const client of [adminUser, coach, outsider]) {
    const read = await client.from("analysis_evidence_packages").select("id");
    assert.ok(read.error || read.data?.length === 0);
  }
  const adminDefinitions = await adminUser.from("measurement_definitions").select("id").eq("id", accepted.data);
  assert.ifError(adminDefinitions.error);
  assert.equal(adminDefinitions.data?.length, 1);
  for (const client of [coach, outsider]) {
    const definitions = await client.from("measurement_definitions").select("id");
    assert.ok(definitions.error || definitions.data?.length === 0);
  }
  const { error: changed } = await service.from("measurement_definitions").update({ display_name: "Changed" }).eq("id", accepted.data);
  assert.ok(changed);
});

test("package linkage rejects another player's clip and deletion cascades evidence", async () => {
  const packageRow = { analysis_run_id: runId, player_id: playerId, video_clip_id: clipId,
    result_key: "test-result", pipeline_version: "pipe-1", detector_version: "detector-1",
    measurement_version: "0.1.0", methodology_version: "method-1", prompt_version: "prompt-1",
    model_version: "test-model-1", source_manifest_hash: "a".repeat(64) };
  const wrong = await service.from("analysis_evidence_packages").insert({ ...packageRow, player_id: randomUUID() });
  assert.ok(wrong.error);
  const packageId = await inserted("analysis_evidence_packages", packageRow);
  const emptyPackageId = await inserted("analysis_evidence_packages", { ...packageRow, result_key: "empty-result" });
  const emptyResult = await service.from("analysis_technical_results").insert({ package_id: emptyPackageId,
    definition_id: definitionId, source_class: "video_observed", value: true, uncertainty: { status: "unknown" } });
  assert.ok(emptyResult.error);
  const itemId = await inserted("analysis_evidence_items", { package_id: packageId, item_order: 0,
    kind: "frame", role: "included", source_frame_start: 42, source_frame_end: 43,
    source_fps: 60, uncertainty_frames: 1, visibility: "visible" });
  assert.ok(itemId);
  const mismatched = await service.from("analysis_technical_results").insert({ package_id: packageId,
    definition_id: definitionId, source_class: "external_device", value: true, uncertainty: { status: "frame_bounded" } });
  assert.ok(mismatched.error);
  const versionPackageId = await inserted("analysis_evidence_packages", { ...packageRow,
    result_key: "wrong-version", measurement_version: "9.9.9" });
  await inserted("analysis_evidence_items", { package_id: versionPackageId, item_order: 0,
    kind: "frame", role: "included", source_frame_start: 1, source_fps: 60, visibility: "visible" });
  const versionMismatch = await service.from("analysis_technical_results").insert({ package_id: versionPackageId,
    definition_id: definitionId, source_class: "video_observed", value: true, uncertainty: { status: "frame_bounded" } });
  assert.ok(versionMismatch.error);
  const accepted = await service.from("analysis_technical_results").insert({ package_id: packageId,
    definition_id: definitionId, source_class: "video_observed", value: true, uncertainty: { status: "frame_bounded" } });
  assert.ifError(accepted.error);
  const orphan = await service.from("analysis_evidence_items").delete().eq("id", itemId);
  assert.ok(orphan.error);
  const deleted = await service.from("video_clips").delete().eq("id", clipId);
  assert.ifError(deleted.error);
  const remaining = await service.from("analysis_evidence_packages").select("id").eq("id", packageId);
  assert.ifError(remaining.error);
  assert.equal(remaining.data?.length, 0);
});
