/**
 * Integration tests for the demo backend under the temporary same-project +
 * isolated `demo` Postgres schema architecture
 * (supabase/migrations/00031_demo_shared_project_schema.sql +
 * 00032_demo_seed_v1.sql - see docs/research/demo-shared-project-architecture.md).
 * Unlike the original design, this SQL is now real migrations applied by
 * the normal `supabase start`/`db reset` flow, so no manual SQL-apply step
 * is needed - only `enable_anonymous_sign_ins` still needs a temporary
 * local toggle (off by default; must never be on in supabase/config.toml
 * as committed). NOT part of `npm test`'s normal glob, since it depends on
 * that toggle.
 *
 * Manual run:
 *   1. sed -i '' 's/enable_anonymous_sign_ins = false/enable_anonymous_sign_ins = true/' supabase/config.toml
 *   2. npx supabase stop && npx supabase start   (applies 00031/00032 like any other migration)
 *   3. npm run build && node --import tsx --test supabase/demo/demo.test.ts
 *   4. Revert config.toml, `npx supabase stop && npx supabase start`, then
 *      `npx supabase db reset` to fully restore normal local dev state.
 */
import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import "dotenv/config";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..");

const SUPABASE_URL = process.env.SUPABASE_URL!;
const SUPABASE_ANON_KEY = process.env.SUPABASE_ANON_KEY!;

// The demo-mode client, schema-scoped exactly like coach/shared.js's real
// client construction (db.schema bound to dataNamespace) - every .from()/
// .rpc() call below resolves against the `demo` schema, never `public`.
function demoClient(): SupabaseClient {
  return createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
    auth: { persistSession: false, autoRefreshToken: false },
    db: { schema: "demo" },
  });
}

// The normal, unscoped client (schema: "public", supabase-js's own
// default) - used to prove a demo anonymous JWT can't reach real
// production tables regardless of which client object issues the request;
// the JWT itself, not the client-side schema setting, is what a real
// attacker controls.
function publicClient(): SupabaseClient {
  return createClient(SUPABASE_URL, SUPABASE_ANON_KEY, { auth: { persistSession: false, autoRefreshToken: false } });
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function must(res: { data: any; error: { message: string } | null }, what: string): any {
  if (res.error) throw new Error(`${what}: ${res.error.message}`);
  return res.data;
}

// Since 00037 the public demo clones ONE published real-data fixture; the
// fictional Jordan/Maya/Riley narrative this suite covers is kept only as the
// explicit rollback target. Pin the canonical pointer to it for this run and
// restore whatever was published afterwards.
const svcDemoForCanonical = createClient(SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY!, {
  auth: { persistSession: false, autoRefreshToken: false },
}).schema("demo");
let savedCanonical: { mode: string; fixture_id: string | null; fixture_version: string | null } | null = null;
before(async () => {
  const { data, error } = await svcDemoForCanonical.from("demo_canonical").select("mode, fixture_id, fixture_version").single();
  if (error) throw new Error(`reading demo_canonical: ${error.message}`);
  savedCanonical = data;
  const pinned = await svcDemoForCanonical.rpc("publish_demo_canonical", { p_fixture_id: null, p_fixture_version: null });
  if (pinned.error) throw new Error(`pinning fictional canonical: ${pinned.error.message}`);
});
after(async () => {
  if (savedCanonical?.mode === "fixture") {
    // Restoring a local-validation fixture needs the (local-only) dev setting; the
    // consent guard otherwise refuses it silently. Enable it just for the restore,
    // put it back exactly, and fail loudly if the restore didn't happen.
    const prev = (await svcDemoForCanonical.from("demo_dev_settings").select("allow_unconsented_fixtures").maybeSingle()).data;
    if (prev) await svcDemoForCanonical.from("demo_dev_settings").update({ allow_unconsented_fixtures: true }).eq("allow_unconsented_fixtures", prev.allow_unconsented_fixtures);
    const restored = await svcDemoForCanonical.rpc("publish_demo_canonical", { p_fixture_id: savedCanonical.fixture_id, p_fixture_version: savedCanonical.fixture_version });
    if (prev) await svcDemoForCanonical.from("demo_dev_settings").update({ allow_unconsented_fixtures: prev.allow_unconsented_fixtures }).eq("allow_unconsented_fixtures", true);
    if (restored.error) throw new Error(`could not restore the canonical pointer: ${restored.error.message}`);
  }
});

async function newAnonSession(schema: "demo" | "public" = "demo"): Promise<SupabaseClient> {
  const c = schema === "demo" ? demoClient() : publicClient();
  const { error } = await c.auth.signInAnonymously();
  if (error) throw new Error(`signInAnonymously: ${error.message}`);
  return c;
}

// ===========================================================================
// A. Cross-session isolation (visitor A vs visitor B, within demo.*)
// ===========================================================================

test("anonymous visitor can bootstrap a demo session and receives a cloned team + 3 players, entirely inside the demo schema", async () => {
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

  const bReadsA = await b.from("teams").select("id").eq("id", teamA);
  assert.equal(bReadsA.error, null);
  assert.equal((bReadsA.data ?? []).length, 0, "B must see zero rows for A's team");

  const bReadsAPlayers = await b.from("players").select("id").eq("team_id", teamA);
  assert.equal((bReadsAPlayers.data ?? []).length, 0, "B must see zero of A's players");

  const bMutatesA = await b.from("teams").update({ name: "hacked" }).eq("id", teamA);
  const stillA = must(await a.from("teams").select("name").eq("id", teamA).single(), "a reads own team after b's mutation attempt");
  assert.equal(stillA.name, "Harbor City Hawks 12U — Demo", "B's update attempt must not have changed A's team");
  void bMutatesA;

  const bResetsSelf = must(await b.rpc("reset_demo_session"), "b reset (own session)");
  const bResetRow = Array.isArray(bResetsSelf) ? bResetsSelf[0] : bResetsSelf;
  assert.notEqual(bResetRow.team_id, teamA, "B's reset must never produce or touch A's team id");
});

test("an ordinary authenticated coach cannot enumerate arbitrary demo sessions", async () => {
  const svc = createClient(SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY!, { auth: { persistSession: false, autoRefreshToken: false } });
  const email = `demo-coach-${Date.now()}@test.local`;
  const created = await svc.auth.admin.createUser({ email, password: "TestPass123!coach", email_confirm: true });
  if (created.error || !created.data.user) throw new Error(`createUser: ${created.error?.message}`);
  const coach = createClient(SUPABASE_URL, SUPABASE_ANON_KEY, { auth: { persistSession: false, autoRefreshToken: false }, db: { schema: "demo" } });
  const signed = await coach.auth.signInWithPassword({ email, password: "TestPass123!coach" });
  if (signed.error) throw new Error(`sign in: ${signed.error.message}`);

  const sessions = must(await coach.from("demo_sessions").select("*"), "coach reads demo_sessions");
  assert.equal(sessions.length, 0, "a non-demo authenticated user with no demo_sessions row of their own must see zero rows");

  const teams = must(await coach.from("teams").select("id"), "coach reads demo.teams");
  assert.equal(teams.length, 0, "a non-demo authenticated user must see zero demo teams (no demo.demo_sessions row => is_demo_owner_of_team() is false for every id)");

  await svc.auth.admin.deleteUser(created.data.user.id);
});

test("reset is transactional: produces a fresh team id, wipes prior mutations, and never affects another visitor", async () => {
  const a = await newAnonSession();
  const b = await newAnonSession();
  const startedA = must(await a.rpc("start_demo_session"), "start a");
  const startedB = must(await b.rpc("start_demo_session"), "start b");
  const teamA1 = (Array.isArray(startedA) ? startedA[0] : startedA).team_id;
  const teamB1 = (Array.isArray(startedB) ? startedB[0] : startedB).team_id;

  must(await a.from("teams").update({ level_label: "MUTATED" }).eq("id", teamA1), "mutate a's team");

  const resetA = must(await a.rpc("reset_demo_session"), "reset a");
  const resetARow = Array.isArray(resetA) ? resetA[0] : resetA;
  assert.notEqual(resetARow.team_id, teamA1, "reset must produce a fresh team id");
  assert.equal(resetARow.generation, 2);

  const oldTeam = await a.from("teams").select("id").eq("id", teamA1);
  assert.equal((oldTeam.data ?? []).length, 0, "the pre-reset team must no longer exist");

  const newTeam = must(await a.from("teams").select("level_label").eq("id", resetARow.team_id).single(), "read new team");
  assert.equal(newTeam.level_label, "12U");

  const bTeamStill = must(await b.from("teams").select("id, name").eq("id", teamB1).single(), "b's team after a's reset");
  assert.equal(bTeamStill.id, teamB1);
});

test("concurrent reset calls for the same session leave exactly one valid, non-corrupted dataset", async () => {
  const a = await newAnonSession();
  must(await a.rpc("start_demo_session"), "start a");

  const [r1, r2, r3] = await Promise.all([a.rpc("reset_demo_session"), a.rpc("reset_demo_session"), a.rpc("reset_demo_session")]);
  const results = [r1, r2, r3].filter((r) => !r.error);
  assert.ok(results.length >= 1, "at least one concurrent reset call must succeed");

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

// ===========================================================================
// B. Cross-boundary isolation (demo.* vs public.* - the actual new risk
// introduced by moving from a dedicated project to a shared one)
// ===========================================================================

test("a demo anonymous user cannot read real production tables (public.teams/public.players), via a public-schema client", async () => {
  const c = await newAnonSession("demo"); // signs in anonymously
  // Re-derive a public-schema client bound to the SAME JWT/session, since
  // the real risk is "this JWT reaches public.*", not "this client object
  // has schema:'demo' baked in" - a real attacker controls the request, not
  // the app's client construction.
  const { data: sessionData } = await c.auth.getSession();
  const pub = createClient(SUPABASE_URL, SUPABASE_ANON_KEY, { auth: { persistSession: false, autoRefreshToken: false } });
  await pub.auth.setSession({ access_token: sessionData.session!.access_token, refresh_token: sessionData.session!.refresh_token });

  const teams = must(await pub.from("teams").select("id"), "demo user reads public.teams");
  assert.equal(teams.length, 0, "a demo anonymous user must see zero rows in public.teams - no coach_team_access row exists for them, exactly like any other stranger");

  const players = must(await pub.from("players").select("id"), "demo user reads public.players");
  assert.equal(players.length, 0, "a demo anonymous user must see zero rows in public.players");
});

test("a demo anonymous user cannot mutate real production tables (public.teams)", async () => {
  // Uses the service-role client only to plant one real, non-demo team to
  // attempt to mutate - never to bypass the assertion itself.
  const svc = createClient(SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY!, { auth: { persistSession: false, autoRefreshToken: false } });
  const planted = must(await svc.from("teams").insert({ slug: `boundary-test-${Date.now()}`, name: "Real Team (boundary test)" }).select("id").single(), "plant real team");

  const c = await newAnonSession("demo");
  const { data: sessionData } = await c.auth.getSession();
  const pub = createClient(SUPABASE_URL, SUPABASE_ANON_KEY, { auth: { persistSession: false, autoRefreshToken: false } });
  await pub.auth.setSession({ access_token: sessionData.session!.access_token, refresh_token: sessionData.session!.refresh_token });

  await pub.from("teams").update({ name: "hacked by demo visitor" }).eq("id", planted.id);
  const stillReal = must(await svc.from("teams").select("name").eq("id", planted.id).single(), "verify real team unchanged");
  assert.equal(stillReal.name, "Real Team (boundary test)", "a demo anonymous user's update attempt against public.teams must have zero effect");

  await svc.from("teams").delete().eq("id", planted.id);
});

test("a demo anonymous user cannot invoke production analysis/upload APIs (get-upload-url Edge Function) for a real game_log_entries row", async () => {
  // get-upload-url is JWT-scoped, not service-role (unlike get-player-report,
  // which is intentionally a public token-based endpoint with no auth
  // concept - not a meaningful demo/production boundary to test). It re-
  // queries public.game_log_entries -> players -> teams under the CALLER's
  // own JWT, so RLS (coach_rw_own_team / is_coach_for_team) is the entire
  // boundary - exactly the path a real attacker holding a demo anonymous
  // JWT would try against real production data.
  const svc = createClient(SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY!, { auth: { persistSession: false, autoRefreshToken: false } });
  const planted = must(await svc.from("teams").insert({ slug: `boundary-test-fn-${Date.now()}`, name: "Real Team (fn boundary test)" }).select("id").single(), "plant real team");
  const plantedPlayer = must(
    await svc.from("players").insert({ team_id: planted.id, slug: "real-player", name: "Real Player", jersey_number: "1" }).select("id").single(),
    "plant real player",
  );
  const plantedEntry = must(
    await svc.from("game_log_entries").insert({ player_id: plantedPlayer.id, date: "2026-01-01", opponent: "X", ab: 1, result: "out" }).select("id").single(),
    "plant real game_log_entries row",
  );

  const c = await newAnonSession("demo");
  const { data: sessionData } = await c.auth.getSession();

  const invoked = await fetch(`${SUPABASE_URL}/functions/v1/get-upload-url`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${sessionData.session!.access_token}`,
      apikey: SUPABASE_ANON_KEY,
    },
    body: JSON.stringify({ gameLogEntryId: plantedEntry.id, clipSlug: "attempted-hack", ext: ".mp4" }),
  });
  assert.equal(invoked.status, 404, "a demo anonymous user's JWT must be denied (404, same as any other non-coach) when requesting an upload URL for a real, non-owned game_log_entries row");

  await svc.from("teams").delete().eq("id", planted.id);
});

// ===========================================================================
// C. Phase 4 - expanded narrative content (demo.* schema extension:
// 00033_demo_phase4_schema.sql / 00034_demo_phase4_seed.sql)
// ===========================================================================

async function bootstrappedDemoTeam(): Promise<{ c: SupabaseClient; teamId: string }> {
  const c = await newAnonSession();
  const started = must(await c.rpc("start_demo_session"), "start_demo_session");
  const row = Array.isArray(started) ? started[0] : started;
  return { c, teamId: row.team_id };
}

async function playerId(c: SupabaseClient, teamId: string, slug: string): Promise<string> {
  const row = must(await c.from("players").select("id").eq("team_id", teamId).eq("slug", slug).single(), `read player ${slug}`);
  return row.id as string;
}

test("seed contains exactly the canonical team and three players", async () => {
  const { c, teamId } = await bootstrappedDemoTeam();
  const team = must(await c.from("teams").select("name, sport, level_label").eq("id", teamId).single(), "read team");
  assert.equal(team.name, "Harbor City Hawks 12U — Demo");
  const players = must(await c.from("players").select("name, jersey_number, slug").eq("team_id", teamId).order("name"), "read players");
  assert.deepEqual(
    players.map((p: { name: string; jersey_number: string }) => `${p.name} #${p.jersey_number}`).sort(),
    ["Jordan Lee #7", "Maya Torres #12", "Riley Chen #4"].sort(),
  );
});

test("Jordan's complete development loop clones correctly: resolved priority, drill, observations, share link", async () => {
  const { c, teamId } = await bootstrappedDemoTeam();
  const jordan = await playerId(c, teamId, "jordan-lee");

  const priorities = must(await c.from("player_priorities").select("id, status, title").eq("player_id", jordan), "jordan priorities");
  assert.equal(priorities.length, 1);
  assert.equal(priorities[0].status, "resolved", "Jordan's priority must end resolved - the complete-loop requirement");

  const history = must(await c.from("player_priority_status_history").select("from_status, to_status").eq("player_priority_id", priorities[0].id).order("changed_at"), "status history");
  assert.deepEqual(history.map((h: { to_status: string }) => h.to_status), ["active", "resolved"]);

  const drills = must(await c.from("player_priority_drills").select("active, drill_library(slug)").eq("player_priority_id", priorities[0].id), "jordan drill assignment");
  assert.equal(drills.length, 1);
  assert.equal(drills[0].drill_library.slug, "split-stance-tee");

  const observations = must(await c.from("player_priority_observations").select("status").eq("player_priority_id", priorities[0].id).order("observed_at"), "jordan observations");
  assert.equal(observations.length, 3, "the loop needs at least an early, a practice-progress, and a resolution observation");
  assert.equal(observations.at(-1).status, "resolved");

  const links = must(await c.from("player_share_links").select("token, revoked_at").eq("player_id", jordan), "jordan share links");
  assert.equal(links.length, 1);
  assert.equal(links[0].revoked_at, null);

  const issue = must(await c.from("issues").select("review_status, reviewed_by").eq("player_id", jordan).single(), "jordan issue");
  assert.equal(issue.review_status, "approved");
  assert.ok(issue.reviewed_by, "Jordan's finding must be coach-reviewed, not left as an unreviewed draft");
});

test("Maya has exactly one seeded four-pitch at-bat with a coherent count progression and a pending review draft", async () => {
  const { c, teamId } = await bootstrappedDemoTeam();
  const maya = await playerId(c, teamId, "maya-torres");

  const entries = must(await c.from("game_log_entries").select("id").eq("player_id", maya).eq("session_type", "game"), "maya game entries");
  assert.equal(entries.length, 1, "Maya must have exactly one seeded game at-bat");

  const pitches = must(await c.from("at_bat_pitches").select("pitch_number, count_before_balls, count_before_strikes, pitch_outcome").eq("game_log_entry_id", entries[0].id).order("pitch_number"), "maya pitches");
  assert.equal(pitches.length, 4, "the at-bat must have exactly 4 pitches");
  assert.deepEqual(pitches.map((p: { count_before_balls: number; count_before_strikes: number }) => `${p.count_before_balls}-${p.count_before_strikes}`), ["0-0", "0-1", "1-1", "1-2"]);

  const clips = must(await c.from("video_clips").select("id, at_bat_pitch_id").eq("game_log_entry_id", entries[0].id), "maya clips");
  assert.equal(clips.length, 4, "each pitch should carry its own evidence clip");

  const draft = must(await c.from("issues").select("review_status, reviewed_by").eq("player_id", maya).single(), "maya draft issue");
  assert.equal(draft.review_status, "draft", "Maya's finding must still be an unreviewed pending draft - the review-queue requirement");
  assert.equal(draft.reviewed_by, null);
});

test("Riley has longitudinal development data: a resolved priority, a monitoring priority, and practice history", async () => {
  const { c, teamId } = await bootstrappedDemoTeam();
  const riley = await playerId(c, teamId, "riley-chen");

  const priorities = must(await c.from("player_priorities").select("status").eq("player_id", riley), "riley priorities");
  assert.deepEqual(priorities.map((p: { status: string }) => p.status).sort(), ["monitoring", "resolved"]);

  const sessions = must(await c.from("practice_sessions").select("id").eq("player_id", riley), "riley practice sessions");
  assert.ok(sessions.length >= 2, "Riley needs more than one practice session to be longitudinal");

  const observations = must(await c.from("player_priority_observations").select("id, player_priorities!inner(player_id)").eq("player_priorities.player_id", riley), "riley observations");
  assert.ok(observations.length >= 4, "Riley needs multiple observations over time across both priorities");
});

test("Review page data exists: at least one meaningful pending draft finding for the team", async () => {
  const { c, teamId } = await bootstrappedDemoTeam();
  const drafts = must(
    await c.from("issues").select("id, players!inner(team_id)").eq("players.team_id", teamId).eq("review_status", "draft"),
    "pending drafts for the team",
  );
  assert.ok(drafts.length >= 1, "the review queue must have at least one pending item");
});

test("Development page data exists: active/monitoring/resolved priorities are all represented on the team", async () => {
  const { c, teamId } = await bootstrappedDemoTeam();
  const priorities = must(await c.from("player_priorities").select("status").eq("team_id", teamId), "team priorities");
  const statuses = new Set(priorities.map((p: { status: string }) => p.status));
  assert.ok(statuses.has("resolved"), "must include a resolved priority");
  assert.ok(statuses.has("monitoring"), "must include a monitoring priority");
});

test("Practice page data exists: sessions with assigned drills and repetitions with grouping", async () => {
  const { c, teamId } = await bootstrappedDemoTeam();
  const jordan = await playerId(c, teamId, "jordan-lee");
  const sessions = must(await c.from("practice_sessions").select("id, assigned_drill_id").eq("player_id", jordan), "jordan practice sessions");
  assert.equal(sessions.length, 1);
  assert.ok(sessions[0].assigned_drill_id);
  const reps = must(await c.from("practice_repetitions").select("grouping").eq("practice_session_id", sessions[0].id).order("rep_number"), "jordan reps");
  assert.deepEqual(reps.map((r: { grouping: string }) => r.grouping), ["baseline", "post_drill"]);
});

test("Compare data exists: Jordan's practice session has a baseline and a post-drill rep, each with a ready video clip", async () => {
  const { c, teamId } = await bootstrappedDemoTeam();
  const jordan = await playerId(c, teamId, "jordan-lee");
  const clips = must(
    await c.from("video_clips").select("status, practice_repetitions!inner(grouping, practice_sessions!inner(player_id))").eq("practice_repetitions.practice_sessions.player_id", jordan),
    "jordan practice clips",
  );
  assert.equal(clips.length, 2);
  assert.ok(clips.every((cl: { status: string }) => cl.status === "ready"));
  assert.deepEqual(clips.map((cl: { practice_repetitions: { grouping: string } }) => cl.practice_repetitions.grouping).sort(), ["baseline", "post_drill"]);
});

test("Report data exists: get-demo-player-report renders Jordan's resolved priority, drill, and progress for a real share token", async () => {
  const { c, teamId } = await bootstrappedDemoTeam();
  const jordan = await playerId(c, teamId, "jordan-lee");
  const link = must(await c.from("player_share_links").select("token").eq("player_id", jordan).single(), "jordan share link");

  const { data: sessionData } = await c.auth.getSession();
  const invoked = await fetch(`${SUPABASE_URL}/functions/v1/get-demo-player-report`, {
    method: "POST",
    headers: { "Content-Type": "application/json", apikey: SUPABASE_ANON_KEY, Authorization: `Bearer ${sessionData.session!.access_token}` },
    body: JSON.stringify({ token: link.token }),
  });
  assert.equal(invoked.status, 200);
  const body = await invoked.json();
  assert.equal(body.playerName, "Jordan Lee");
  assert.equal(body.priorities.length, 1);
  assert.equal(body.priorities[0].status, "resolved");
  assert.ok(body.priorities[0].drills.length >= 1, "the report must show the assigned drill");
  assert.ok(body.priorities[0].progress.length >= 1, "the report must show progress history");
});

test("visitor A and visitor B receive independent copies of the entire expanded dataset", async () => {
  const a = await bootstrappedDemoTeam();
  const b = await bootstrappedDemoTeam();
  assert.notEqual(a.teamId, b.teamId);
  const aJordan = await playerId(a.c, a.teamId, "jordan-lee");
  const bJordan = await playerId(b.c, b.teamId, "jordan-lee");
  assert.notEqual(aJordan, bJordan);
  const aPriority = must(await a.c.from("player_priorities").select("id").eq("player_id", aJordan).single(), "a's jordan priority");
  const bReadsAPriority = await b.c.from("player_priorities").select("id").eq("id", aPriority.id);
  assert.equal((bReadsAPriority.data ?? []).length, 0, "B must not see A's priority row at all");
});

test("reset restores the full canonical expanded dataset, and does not affect another visitor's data", async () => {
  const a = await bootstrappedDemoTeam();
  const b = await bootstrappedDemoTeam();
  const aJordanBefore = await playerId(a.c, a.teamId, "jordan-lee");

  const resetA = must(await a.c.rpc("reset_demo_session"), "reset a");
  const resetARow = Array.isArray(resetA) ? resetA[0] : resetA;
  assert.notEqual(resetARow.team_id, a.teamId);

  const aJordanAfter = await playerId(a.c, resetARow.team_id, "jordan-lee");
  assert.notEqual(aJordanAfter, aJordanBefore);
  const priorities = must(await a.c.from("player_priorities").select("status").eq("player_id", aJordanAfter), "post-reset jordan priorities");
  assert.equal(priorities.length, 1);
  assert.equal(priorities[0].status, "resolved", "reset must restore the full canonical resolved-loop story, not a bare team/players clone");

  const oldPriorityGone = await a.c.from("game_log_entries").select("id").eq("player_id", aJordanBefore);
  assert.equal((oldPriorityGone.data ?? []).length, 0, "the pre-reset player row (and everything cascaded from it) must be gone");

  const bJordan = await playerId(b.c, b.teamId, "jordan-lee");
  const bPriorities = must(await b.c.from("player_priorities").select("status").eq("player_id", bJordan), "b's jordan priorities unaffected by a's reset");
  assert.equal(bPriorities.length, 1);
});

test("3 concurrent resets remain safe with the expanded dataset: exactly one complete, non-corrupted clone remains", async () => {
  const { c } = await bootstrappedDemoTeam();
  const [r1, r2, r3] = await Promise.all([c.rpc("reset_demo_session"), c.rpc("reset_demo_session"), c.rpc("reset_demo_session")]);
  const results = [r1, r2, r3].filter((r) => !r.error);
  assert.ok(results.length >= 1);

  const { data: session } = await c.from("demo_sessions").select("team_id").eq("user_id", (await c.auth.getUser()).data.user!.id).single();
  const players = must(await c.from("players").select("id").eq("team_id", session!.team_id), "final players");
  assert.equal(players.length, 3);
  const jordan = await playerId(c, session!.team_id, "jordan-lee");
  const priorities = must(await c.from("player_priorities").select("id").eq("player_id", jordan), "final jordan priorities");
  assert.equal(priorities.length, 1, "exactly one clean, complete clone of the expanded dataset must remain, never a partial/duplicated one");
});

test("Android/Capacitor remains normal mode (no demo config ever set there)", () => {
  const src = fs.readFileSync(path.join(repoRoot, "mobile", "capacitor.config.json"), "utf8");
  assert.doesNotMatch(src, /__HITTERLOOP_DEMO_CONFIG__/);
});

// ===========================================================================
// D. Exact-query compatibility regression tests (2026-09-22 live-audit fix
// pass). The prior test suite proved data EXISTS but never replicated the
// real frontend's exact PostgREST select() shapes - that's how the schema
// gaps below shipped to the live cloud project without a local/cloud test
// catching them. Every test in this section uses the literal column list
// (or a semantically-identical one) copied directly from the real
// coach/*.html source, not a paraphrase.
// ===========================================================================

test("TEAM: teamDashboard.js's exact player_priorities query (incl. follow_up_set_at) succeeds", async () => {
  const { c, teamId } = await bootstrappedDemoTeam();
  // Exact column list from coach/components/teamDashboard.js's loadTeamDashboard().
  const result = await c.from("player_priorities")
    .select("id, title, status, follow_up_kind, follow_up_date, follow_up_swings, follow_up_set_at, follow_up_done_at, priority_order, players!inner(id, name, slug, team_id)")
    .eq("players.team_id", teamId).in("status", ["active", "monitoring"]);
  assert.equal(result.error, null, `team.html's dashboard query must not error: ${result.error?.message}`);
  // Jordan's priority resolves (active->resolved during the loop) so only
  // Riley's monitoring priority should still be active/monitoring team-wide.
  assert.ok((result.data ?? []).length >= 1, "at least Riley's monitoring priority must be visible");
});

test("PLAYER: player.html's exact priority/activity query (incl. follow_up_set_at) succeeds and the trigger stamped it", async () => {
  const { c, teamId } = await bootstrappedDemoTeam();
  const riley = await playerId(c, teamId, "riley-chen");
  const result = await c.from("player_priorities")
    .select("id, title, description, status, follow_up_kind, follow_up_date, follow_up_swings, follow_up_set_at, follow_up_done_at")
    .eq("player_id", riley).in("status", ["active", "monitoring"]).order("priority_order").limit(3);
  assert.equal(result.error, null, `player.html's priority query must not error: ${result.error?.message}`);
  const monitoring = (result.data ?? []).find((p: { follow_up_kind: string | null }) => p.follow_up_kind != null);
  assert.ok(monitoring, "Riley's monitoring priority (follow_up_kind set) must be present");
  assert.ok(monitoring.follow_up_set_at, "follow_up_set_at must be auto-stamped by the trigger, not left null, for a priority with a follow_up_kind");
});

test("AT-BAT: atbat.html's exact entry + four-pitch query shape returns all 4 of Maya's pitches with players!inner embed intact", async () => {
  const { c, teamId } = await bootstrappedDemoTeam();
  const maya = await playerId(c, teamId, "maya-torres");
  const entries = must(await c.from("game_log_entries").select("id").eq("player_id", maya).eq("session_type", "game"), "maya entries");
  const entryId = entries[0].id;

  const PLAYER_SELECT = "id, name, jersey_number, slug, teams!inner(id, slug, name)";
  const entryResult = await c.from("game_log_entries")
    .select(`id,date,opponent,ab,result,session_type,ai_summary,ai_summary_generated_at,players!inner(${PLAYER_SELECT})`)
    .eq("id", entryId).single();
  assert.equal(entryResult.error, null, `atbat.html's entry query must not error: ${entryResult.error?.message}`);
  assert.equal((entryResult.data as { players: { name: string } }).players.name, "Maya Torres");

  const pitchesResult = await c.from("at_bat_pitches").select("*").eq("game_log_entry_id", entryId).order("pitch_number");
  assert.equal(pitchesResult.error, null, `atbat.html's loadPitches() query must not error: ${pitchesResult.error?.message}`);
  assert.equal(pitchesResult.data?.length, 4, "all 4 of Maya's pitches must return from the exact atbat.html query shape");

  const clipsResult = await c.from("video_clips").select("id,status,error_message,at_bat_pitch_id,created_at").eq("game_log_entry_id", entryId).order("created_at");
  assert.equal(clipsResult.error, null);
  assert.equal(clipsResult.data?.length, 4, "all 4 evidence clips must return");
});

test("REVIEW: review.html's exact analysis_runs and swing_phases (incl. reconstruction_reliable) query shapes succeed", async () => {
  const { c } = await bootstrappedDemoTeam();
  // Exact column list from review.html's analysis_runs query.
  const runs = await c.from("analysis_runs").select("id,no_action_needed,no_action_reason,created_at").eq("video_clip_id", "00000000-0000-0000-0000-000000000000").order("created_at", { ascending: false }).limit(1);
  assert.equal(runs.error, null, `review.html's analysis_runs query must not error: ${runs.error?.message}`);
  // Exact column list from devUi.js's loadPhases(), used by review.html/compare.html.
  const phases = await c.from("swing_phases").select("frame, time_s, confidence, reconstruction_reliable, swing_phase_types!inner(slug, label, sort_order)").eq("video_clip_id", "00000000-0000-0000-0000-000000000000").order("sort_order", { referencedTable: "swing_phase_types" });
  assert.equal(phases.error, null, `review.html's swing_phases query must not error: ${phases.error?.message}`);
});

test("DEVELOPMENT/PRACTICE: getMyDisplayName() resolves coach_profiles to \"Coach Demo\", auto-populated by start_demo_session()", async () => {
  const { c } = await bootstrappedDemoTeam();
  const userId = (await c.auth.getUser()).data.user!.id;
  const profile = await c.from("coach_profiles").select("display_name").eq("user_id", userId).single();
  assert.equal(profile.error, null, `coach_profiles lookup must not error: ${profile.error?.message}`);
  assert.equal(profile.data?.display_name, "Coach Demo");
});

test("PRACTICE: practicePage.js's addRep() insert shape (incl. session_note) succeeds against demo.game_log_entries", async () => {
  const { c, teamId } = await bootstrappedDemoTeam();
  const jordan = await playerId(c, teamId, "jordan-lee");
  const inserted = await c.from("game_log_entries").insert({
    player_id: jordan, session_type: "practice", date: new Date().toISOString().slice(0, 10), ab: 99, session_note: "regression test rep", position: 0,
  }).select("id").single();
  assert.equal(inserted.error, null, `addRep()'s exact insert shape (incl. session_note) must not error: ${inserted.error?.message}`);
});

test("COMPARE: compare.html's exact detail() query shapes (phases, metrics, pose3d) succeed for both selected evidence records", async () => {
  const { c, teamId } = await bootstrappedDemoTeam();
  const jordan = await playerId(c, teamId, "jordan-lee");
  const reps = must(
    await c.from("video_clips").select("id, practice_repetitions!inner(grouping, practice_sessions!inner(player_id))").eq("practice_repetitions.practice_sessions.player_id", jordan),
    "jordan's baseline/post-drill clips",
  );
  assert.equal(reps.length, 2, "Compare needs exactly Jordan's baseline + post-drill clips");
  for (const clip of reps) {
    const phases = await c.from("swing_phases").select("frame, time_s, confidence, reconstruction_reliable, swing_phase_types!inner(slug, label, sort_order)").eq("video_clip_id", clip.id).order("sort_order", { referencedTable: "swing_phase_types" });
    assert.equal(phases.error, null, `phases query for clip ${clip.id} must not error: ${phases.error?.message}`);
    const metrics = await c.from("video_clip_metrics").select("*").eq("video_clip_id", clip.id).maybeSingle();
    assert.equal(metrics.error, null, `metrics query for clip ${clip.id} must not error: ${metrics.error?.message}`);
    const pose = await c.from("video_clip_pose3d").select("id").eq("video_clip_id", clip.id).maybeSingle();
    assert.equal(pose.error, null, `pose3d query for clip ${clip.id} must not error: ${pose.error?.message}`);
  }
});

test("production coach behavior remains unchanged: an ordinary signed-in user with no coach_team_access still sees zero public.teams rows", async () => {
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
