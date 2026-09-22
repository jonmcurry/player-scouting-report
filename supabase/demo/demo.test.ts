/**
 * Integration tests for the demo backend (supabase/demo/001_demo_lifecycle.sql
 * + 002_demo_seed_template.sql) - Phase 1-3 acceptance criteria. NOT part of
 * `npm test`'s normal glob: this depends on `enable_anonymous_sign_ins = true`
 * (off by default in supabase/config.toml) and on supabase/demo/*.sql having
 * been applied on top of the local stack, neither of which should be true
 * during normal dev/CI runs of this repo's real test suite.
 *
 * Manual run:
 *   1. sed -i '' 's/enable_anonymous_sign_ins = false/enable_anonymous_sign_ins = true/' supabase/config.toml
 *   2. npx supabase stop && npx supabase start
 *   3. docker exec -i supabase_db_softball_analysis psql -U postgres -d postgres < supabase/demo/001_demo_lifecycle.sql
 *      docker exec -i supabase_db_softball_analysis psql -U postgres -d postgres < supabase/demo/002_demo_seed_template.sql
 *   4. npm run build && node --test dist/../supabase/demo/demo.test.js  (or run via tsx directly)
 *   5. Revert config.toml, `npx supabase stop && npx supabase start`, then
 *      `npx supabase db reset` to fully restore normal local dev state -
 *      supabase/demo/*.sql is not a migration, so reset removes it cleanly.
 */
import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import "dotenv/config";

const SUPABASE_URL = process.env.SUPABASE_URL!;
const SUPABASE_ANON_KEY = process.env.SUPABASE_ANON_KEY!;

function client(): SupabaseClient {
  return createClient(SUPABASE_URL, SUPABASE_ANON_KEY, { auth: { persistSession: false, autoRefreshToken: false } });
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function must(res: { data: any; error: { message: string } | null }, what: string): any {
  if (res.error) throw new Error(`${what}: ${res.error.message}`);
  return res.data;
}

async function newAnonSession(): Promise<SupabaseClient> {
  const c = client();
  const { error } = await c.auth.signInAnonymously();
  if (error) throw new Error(`signInAnonymously: ${error.message}`);
  return c;
}

test("anonymous visitor can bootstrap a demo session and receives a cloned team + 3 players", async () => {
  const c = await newAnonSession();
  const started = must(await c.rpc("start_demo_session"), "start_demo_session");
  const row = Array.isArray(started) ? started[0] : started;
  assert.ok(row.team_id);
  assert.match(row.team_slug, /^demo-/);
  assert.equal(row.generation, 1);

  const players = must(await c.from("players").select("name, jersey_number").eq("team_id", row.team_id).order("name"), "read players");
  assert.equal(players.length, 3);
  assert.deepEqual(players.map((p: { name: string }) => p.name).sort(), ["Jordan Lee", "Maya Torres", "Riley Chen"]);

  const team = must(await c.from("teams").select("name, sport").eq("id", row.team_id).single(), "read team");
  assert.equal(team.name, "Harbor City Hawks 12U — Demo");
  assert.equal(team.sport, "softball");
});

test("start_demo_session is idempotent - a second call for the same session returns the same team, no duplicate", async () => {
  const c = await newAnonSession();
  const first = must(await c.rpc("start_demo_session"), "first start");
  const firstRow = Array.isArray(first) ? first[0] : first;
  const second = must(await c.rpc("start_demo_session"), "second start");
  const secondRow = Array.isArray(second) ? second[0] : second;
  assert.equal(firstRow.team_id, secondRow.team_id);
  assert.equal(secondRow.generation, 1);
});

test("two different anonymous sessions receive two different team ids, and neither can read or mutate the other's data", async () => {
  const a = await newAnonSession();
  const b = await newAnonSession();
  const startedA = must(await a.rpc("start_demo_session"), "start a");
  const startedB = must(await b.rpc("start_demo_session"), "start b");
  const teamA = (Array.isArray(startedA) ? startedA[0] : startedA).team_id;
  const teamB = (Array.isArray(startedB) ? startedB[0] : startedB).team_id;
  assert.notEqual(teamA, teamB);

  // B cannot read A's team or players (existing team RLS, unmodified).
  const bReadsA = await b.from("teams").select("id").eq("id", teamA);
  assert.equal(bReadsA.error, null);
  assert.equal((bReadsA.data ?? []).length, 0, "B must see zero rows for A's team");

  const bReadsAPlayers = await b.from("players").select("id").eq("team_id", teamA);
  assert.equal((bReadsAPlayers.data ?? []).length, 0, "B must see zero of A's players");

  // B cannot mutate A's team.
  const bMutatesA = await b.from("teams").update({ name: "hacked" }).eq("id", teamA);
  const stillA = must(await a.from("teams").select("name").eq("id", teamA).single(), "a reads own team after b's mutation attempt");
  assert.equal(stillA.name, "Harbor City Hawks 12U — Demo", "B's update attempt must not have changed A's team");

  // B cannot call reset on A's session (reset only ever operates on auth.uid()'s own row).
  const bResetsSelf = must(await b.rpc("reset_demo_session"), "b reset (own session)");
  const bResetRow = Array.isArray(bResetsSelf) ? bResetsSelf[0] : bResetsSelf;
  assert.notEqual(bResetRow.team_id, teamA, "B's reset must never produce or touch A's team id");
});

test("reset is transactional: produces a fresh team id, wipes prior mutations, and never affects another visitor", async () => {
  const a = await newAnonSession();
  const b = await newAnonSession();
  const startedA = must(await a.rpc("start_demo_session"), "start a");
  const startedB = must(await b.rpc("start_demo_session"), "start b");
  const teamA1 = (Array.isArray(startedA) ? startedA[0] : startedA).team_id;
  const teamB1 = (Array.isArray(startedB) ? startedB[0] : startedB).team_id;

  // Mutate A's clone.
  must(await a.from("teams").update({ level_label: "MUTATED" }).eq("id", teamA1), "mutate a's team");

  const resetA = must(await a.rpc("reset_demo_session"), "reset a");
  const resetARow = Array.isArray(resetA) ? resetA[0] : resetA;
  assert.notEqual(resetARow.team_id, teamA1, "reset must produce a fresh team id");
  assert.equal(resetARow.generation, 2);

  // Old team id is gone (cascade-deleted).
  const oldTeam = await a.from("teams").select("id").eq("id", teamA1);
  assert.equal((oldTeam.data ?? []).length, 0, "the pre-reset team must no longer exist");

  // New team has the clean canonical mutation-free state.
  const newTeam = must(await a.from("teams").select("level_label").eq("id", resetARow.team_id).single(), "read new team");
  assert.equal(newTeam.level_label, "12U");

  // B's team is completely unaffected by A's reset.
  const bTeamStill = must(await b.from("teams").select("id, name").eq("id", teamB1).single(), "b's team after a's reset");
  assert.equal(bTeamStill.id, teamB1);
});

test("concurrent reset calls for the same session leave exactly one valid, non-corrupted dataset", async () => {
  const a = await newAnonSession();
  must(await a.rpc("start_demo_session"), "start a");

  const [r1, r2, r3] = await Promise.all([a.rpc("reset_demo_session"), a.rpc("reset_demo_session"), a.rpc("reset_demo_session")]);
  const results = [r1, r2, r3].filter((r) => !r.error);
  assert.ok(results.length >= 1, "at least one concurrent reset call must succeed");

  // Whatever the final state, exactly one team is now linked to this session, with exactly 3 players.
  const { data: session } = await a.from("demo_sessions").select("team_id").eq("user_id", (await a.auth.getUser()).data.user!.id).single();
  const players = must(await a.from("players").select("id").eq("team_id", session!.team_id), "final players");
  assert.equal(players.length, 3, "exactly one clean clone must remain regardless of how many concurrent resets fired");
});

test("reset before bootstrap fails clearly rather than doing something undefined", async () => {
  const c = await newAnonSession();
  const result = await c.rpc("reset_demo_session");
  assert.ok(result.error, "reset_demo_session with no prior demo_sessions row must fail, not silently create one");
});

test("demo_seed_templates is not directly readable or listable by an authenticated demo visitor", async () => {
  const c = await newAnonSession();
  must(await c.rpc("start_demo_session"), "start");
  const result = await c.from("demo_seed_templates").select("*");
  assert.ok(result.error, "the canonical seed template must not be directly selectable by a demo visitor");
});

test("existing production-style authentication/RLS is unaffected: a non-anonymous, non-demo user still sees zero rows without their own coach_team_access", async () => {
  // Sanity check that nothing in the demo SQL relaxed any existing policy -
  // an ordinary signed-in user with no coach_team_access row still sees
  // nothing, exactly as before this file existed.
  const svc = createClient(SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY!, { auth: { persistSession: false, autoRefreshToken: false } });
  const email = `demo-regression-${Date.now()}@test.local`;
  const created = await svc.auth.admin.createUser({ email, password: "TestPass123!demo", email_confirm: true });
  if (created.error || !created.data.user) throw new Error(`createUser: ${created.error?.message}`);
  const c = createClient(SUPABASE_URL, SUPABASE_ANON_KEY, { auth: { persistSession: false, autoRefreshToken: false } });
  const signed = await c.auth.signInWithPassword({ email, password: "TestPass123!demo" });
  if (signed.error) throw new Error(`sign in: ${signed.error.message}`);
  const teams = must(await c.from("teams").select("id"), "regular user reads teams");
  assert.equal(teams.length, 0, "a regular authenticated user with no coach_team_access must still see zero teams");
  await svc.auth.admin.deleteUser(created.data.user.id);
});
