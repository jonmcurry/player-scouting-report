/**
 * Integration tests for the guardian (parent) link: coach-issued invites,
 * one-time acceptance with a recorded consent version, and revocation
 * (supabase/migrations/00041_guardians.sql).
 *
 * Runs against the local Supabase stack (SUPABASE_URL / SUPABASE_ANON_KEY /
 * SUPABASE_SERVICE_ROLE_KEY from .env). Creates its own throwaway team,
 * player, and users with the service-role client and deletes them in
 * after() - it never touches existing local data. NOT part of `npm test`'s
 * glob (it needs the running local stack).
 *
 * Run: npm run test:guardians  (node --import tsx --test supabase/tests/guardians.test.ts)
 */
import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { randomUUID, createHash } from "node:crypto";
import { execFileSync } from "node:child_process";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import "dotenv/config";
import { fixtureUuid } from "../../src/services/demoExport/ids.js";
import { persistPlayerFocus } from "../../src/services/development/focusPersistence.js";

const SUPABASE_URL = process.env.SUPABASE_URL!;
const SUPABASE_ANON_KEY = process.env.SUPABASE_ANON_KEY!;
const SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY!;
// Follow the configured consent version so permission tests survive a local
// version change without rewriting the server's consent setting.
let CONSENT: string;

const admin = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, {
  auth: { persistSession: false, autoRefreshToken: false },
});

const run = randomUUID().slice(0, 8);
const userIds: string[] = [];
const teamIds: string[] = [];
const mutationDeletionIds: string[] = [];

let coachA: SupabaseClient;
let coachB: SupabaseClient;
let parent: SupabaseClient;
let parent2: SupabaseClient;
let parentUserId: string;
let coachAUserId: string;
let emily: string;

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function must(res: { data: any; error: { message: string } | null }, what: string): any {
  if (res.error) throw new Error(`${what}: ${res.error.message}`);
  return res.data;
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
async function rpc(client: SupabaseClient, fn: string, args: Record<string, unknown>): Promise<any> {
  const { data, error } = await client.rpc(fn, args);
  if (error) throw new Error(`${fn}: ${error.message}`);
  return data;
}

async function makeUser(label: string): Promise<{ client: SupabaseClient; id: string }> {
  const email = `guardians-test-${label}-${run}@example.test`;
  const password = `pw-${randomUUID()}`;
  const created = must(await admin.auth.admin.createUser({ email, password, email_confirm: true }), `create ${label}`);
  userIds.push(created.user.id);
  const client = createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
  must(await client.auth.signInWithPassword({ email, password }), `sign in ${label}`);
  return { client, id: created.user.id };
}

async function makeTeam(label: string, coachId: string): Promise<string> {
  const team = must(
    await admin.from("teams").insert({ slug: `guardians-${label}-${run}`, name: `Guardians ${label}` }).select("id").single(),
    `team ${label}`,
  );
  teamIds.push(team.id);
  must(await admin.from("coach_team_access").insert({ coach_id: coachId, team_id: team.id, role: "head_coach" }), `access ${label}`);
  return team.id;
}

before(async () => {
  const consent = must(await admin.from("app_settings").select("value")
    .eq("key", "guardian_consent_version").single(), "current consent version");
  assert.equal(typeof consent.value, "string");
  CONSENT = consent.value;
  const a = await makeUser("coach-a");
  const b = await makeUser("coach-b");
  const p = await makeUser("parent");
  const p2 = await makeUser("parent2");
  coachA = a.client;
  coachB = b.client;
  parent = p.client;
  parent2 = p2.client;
  parentUserId = p.id;
  coachAUserId = a.id;

  const teamA = await makeTeam("a", a.id);
  await makeTeam("b", b.id);
  const player = must(
    await admin
      .from("players")
      .insert({ team_id: teamA, slug: `emily-${run}`, name: "Test Player", jersey_number: "0" })
      .select("id")
      .single(),
    "player",
  );
  emily = player.id;
  await setupUploads();
});

after(async () => {
  // Teams first (cascades players -> guardian_invites / player_guardians),
  // then the users those rows referenced.
  for (const id of teamIds) await admin.from("teams").delete().eq("id", id);
  for (const id of mutationDeletionIds) must(await admin.from("clip_deletions").delete().eq("clip_id", id), "mutation audit cleanup");
  for (const id of userIds) await admin.auth.admin.deleteUser(id);
});

test("coach of the team can invite; parent accepts once and is linked", async () => {
  const token = await rpc(coachA, "create_guardian_invite", { p_player_id: emily, p_relationship: "parent" });
  assert.equal(typeof token, "string");

  // Only the hash is stored - the plaintext token never appears in the table.
  const stored = must(await admin.from("guardian_invites").select("token_hash").eq("player_id", emily), "invites");
  assert.ok(stored.length >= 1);
  for (const row of stored) assert.notEqual(row.token_hash, token);

  const playerId = await rpc(parent, "accept_guardian_invite", { p_token: token, p_consent_version: CONSENT });
  assert.equal(playerId, emily);
  assert.equal(await rpc(parent, "is_guardian_for_player", { target_player_id: emily }), true);
  await assert.rejects(rpc(parent2, "accept_guardian_invite", { p_token: token, p_consent_version: CONSENT }), /already used/);
  assert.equal(await rpc(parent2, "is_guardian_for_player", { target_player_id: emily }), false);

  const link = must(await parent.from("player_guardians").select("*").eq("player_id", emily), "own link");
  assert.equal(link.length, 1);
  assert.equal(link[0].consent_version, CONSENT);
  assert.equal(link[0].relationship, "parent");
});

test("coach of another team cannot invite", async () => {
  await assert.rejects(rpc(coachB, "create_guardian_invite", { p_player_id: emily, p_relationship: "parent" }), /not allowed/);
});

test("a parent cannot create an invite", async () => {
  await assert.rejects(rpc(parent, "create_guardian_invite", { p_player_id: emily, p_relationship: "parent" }), /not allowed/);
});

test("accept rejects a consent version other than the stored one", async () => {
  const token = await rpc(coachA, "create_guardian_invite", { p_player_id: emily, p_relationship: "guardian" });
  await assert.rejects(rpc(parent2, "accept_guardian_invite", { p_token: token, p_consent_version: `${CONSENT}-wrong` }), /consent/);
  // The failed attempt must not have consumed the invite.
  const playerId = await rpc(parent2, "accept_guardian_invite", { p_token: token, p_consent_version: CONSENT });
  assert.equal(playerId, emily);
  await rpc(coachA, "revoke_guardian", { p_player_id: emily, p_user_id: (await parent2.auth.getUser()).data.user!.id });
});

test("an unknown token is rejected", async () => {
  await assert.rejects(rpc(parent2, "accept_guardian_invite", { p_token: "not-a-real-token", p_consent_version: CONSENT }), /invalid invite/);
});

test("expired or revoked invites are rejected", async () => {
  const expired = await rpc(coachA, "create_guardian_invite", { p_player_id: emily, p_relationship: "parent" });
  const revoked = await rpc(coachA, "create_guardian_invite", { p_player_id: emily, p_relationship: "parent" });
  // Most recent two invites for this player, newest last.
  const rows = must(
    await admin.from("guardian_invites").select("id").eq("player_id", emily).order("created_at", { ascending: false }).limit(2),
    "recent invites",
  );
  const [revokedRow, expiredRow] = rows;
  must(await admin.from("guardian_invites").update({ expires_at: new Date(Date.now() - 60_000).toISOString() }).eq("id", expiredRow.id), "expire");
  must(await admin.from("guardian_invites").update({ revoked_at: new Date().toISOString() }).eq("id", revokedRow.id), "revoke");

  await assert.rejects(rpc(parent2, "accept_guardian_invite", { p_token: expired, p_consent_version: CONSENT }), /expired/);
  await assert.rejects(rpc(parent2, "accept_guardian_invite", { p_token: revoked, p_consent_version: CONSENT }), /revoked/);
});

test("revoke_guardian_invites: a coach of the team cancels pending invites (unusable after); other coach, guardian and anon are denied", async () => {
  const t1 = await rpc(coachA, "create_guardian_invite", { p_player_id: emily, p_relationship: "parent" });
  const t2 = await rpc(coachA, "create_guardian_invite", { p_player_id: emily, p_relationship: "guardian" });
  // An already-used invite and an expired one are not "pending" and are left alone.
  const used = await rpc(coachA, "create_guardian_invite", { p_player_id: emily, p_relationship: "parent" });
  const u = await makeUser("cancel-used");
  await rpc(u.client, "accept_guardian_invite", { p_token: used, p_consent_version: CONSENT });
  const expired = await rpc(coachA, "create_guardian_invite", { p_player_id: emily, p_relationship: "parent" });
  sql(`update public.guardian_invites set expires_at = now() - interval '1 minute' where token_hash = encode(extensions.digest('${expired}', 'sha256'), 'hex')`);

  await assert.rejects(rpc(coachB, "revoke_guardian_invites", { p_player_id: emily }), /not allowed/);
  await assert.rejects(rpc(parent2, "revoke_guardian_invites", { p_player_id: emily }), /not allowed/);
  await assert.rejects(rpc(u.client, "revoke_guardian_invites", { p_player_id: emily }), /not allowed/, "a linked guardian is not a coach");
  await assert.rejects(rpc(coachA, "revoke_guardian_invites", { p_player_id: randomUUID() }), /not allowed/);
  const anon = createClient(SUPABASE_URL, SUPABASE_ANON_KEY, { auth: { persistSession: false, autoRefreshToken: false } });
  assert.ok((await anon.rpc("revoke_guardian_invites", { p_player_id: emily })).error, "anon must not execute revoke_guardian_invites");
  // Nothing was cancelled by the denied calls.
  assert.equal(await rpc(parent2, "guardian_invite_preview", { p_token: t1 }), "Test");

  const cancelled = await rpc(coachA, "revoke_guardian_invites", { p_player_id: emily });
  assert.ok(cancelled >= 2, `cancelled ${cancelled}`);
  for (const t of [t1, t2]) {
    await assert.rejects(rpc(parent2, "accept_guardian_invite", { p_token: t, p_consent_version: CONSENT }), /revoked/);
    assert.equal(await rpc(parent2, "guardian_invite_preview", { p_token: t }), null);
  }
  const hash = (t: string) => `encode(extensions.digest('${t}', 'sha256'), 'hex')`;
  assert.equal(sql(`select revoked_at is null from public.guardian_invites where token_hash = ${hash(used)}`), "t", "used invite untouched");
  assert.equal(sql(`select revoked_at is null from public.guardian_invites where token_hash = ${hash(expired)}`), "t", "expired invite untouched");
  assert.equal(await rpc(u.client, "is_guardian_for_player", { target_player_id: emily }), true, "accepted links are untouched");
  // Re-running finds nothing left to cancel.
  assert.equal(await rpc(coachA, "revoke_guardian_invites", { p_player_id: emily }), 0);
  await rpc(coachA, "revoke_guardian", { p_player_id: emily, p_user_id: u.id });
});

test("guardian_invite_preview: first name for a usable invite, the same null for every other case", async () => {
  const anon = createClient(SUPABASE_URL, SUPABASE_ANON_KEY, { auth: { persistSession: false, autoRefreshToken: false } });
  const valid = await rpc(coachA, "create_guardian_invite", { p_player_id: emily, p_relationship: "parent" });
  // First word of players.name only ("Test Player" -> "Test"); previewing never consumes the invite.
  assert.equal(await rpc(parent2, "guardian_invite_preview", { p_token: valid }), "Test");
  assert.equal(await rpc(parent2, "guardian_invite_preview", { p_token: valid }), "Test");
  // anon may not execute it at all.
  const denied = await anon.rpc("guardian_invite_preview", { p_token: valid });
  assert.ok(denied.error, "anon must not execute guardian_invite_preview");
  assert.equal(denied.data, null);

  const used = await rpc(coachA, "create_guardian_invite", { p_player_id: emily, p_relationship: "parent" });
  const expired = await rpc(coachA, "create_guardian_invite", { p_player_id: emily, p_relationship: "parent" });
  const revoked = await rpc(coachA, "create_guardian_invite", { p_player_id: emily, p_relationship: "parent" });
  const rows = must(
    await admin.from("guardian_invites").select("id").eq("player_id", emily).order("created_at", { ascending: false }).limit(2),
    "recent invites",
  );
  const [revokedRow, expiredRow] = rows;
  must(await admin.from("guardian_invites").update({ expires_at: new Date(Date.now() - 60_000).toISOString() }).eq("id", expiredRow.id), "expire");
  must(await admin.from("guardian_invites").update({ revoked_at: new Date().toISOString() }).eq("id", revokedRow.id), "revoke");
  const parent2Id = (await parent2.auth.getUser()).data.user!.id;
  await rpc(parent2, "accept_guardian_invite", { p_token: used, p_consent_version: CONSENT });

  for (const [label, token] of [["used", used], ["expired", expired], ["revoked", revoked], ["garbage", "not-a-real-token"], ["empty", ""], ["upper-cased", valid.toUpperCase()]]) {
    const { data, error } = await parent.rpc("guardian_invite_preview", { p_token: token });
    assert.equal(error, null, `${label}: no error (no oracle)`);
    assert.equal(data, null, `${label}: null`);
  }
  // Still usable after all the previews above.
  assert.equal(await rpc(parent2, "guardian_invite_preview", { p_token: valid }), "Test");
  await rpc(coachA, "revoke_guardian", { p_player_id: emily, p_user_id: parent2Id });
});

test("a coach on the team cannot accept an invite for their own player", async () => {
  const token = await rpc(coachA, "create_guardian_invite", { p_player_id: emily, p_relationship: "parent" });
  await assert.rejects(rpc(coachA, "accept_guardian_invite", { p_token: token, p_consent_version: CONSENT }), /coach/);
});

test("guardian has no direct table access to development data", async () => {
  assert.equal(await rpc(parent, "is_guardian_for_player", { target_player_id: emily }), true);
  for (const t of ["checklist_scores", "issues", "player_priorities", "video_clips", "players"]) {
    const { data } = await parent.from(t).select("*").limit(1);
    assert.deepEqual(data, [], t);
  }
});

test("a guardian linked to two children can read exactly those two without gaining roster access", async () => {
  const hadPrimaryLink = await rpc(parent, "is_guardian_for_player", { target_player_id: emily });
  if (!hadPrimaryLink) {
    const primaryToken = await rpc(coachA, "create_guardian_invite", { p_player_id: emily, p_relationship: "parent" });
    await rpc(parent, "accept_guardian_invite", { p_token: primaryToken, p_consent_version: CONSENT });
  }
  const second = must(await admin.from("players").insert({ team_id: teamIds[0],
    slug: `second-child-${run}`, name: "Second Child", jersey_number: "92" }).select("id").single(), "second child");
  const token = await rpc(coachA, "create_guardian_invite", { p_player_id: second.id, p_relationship: "parent" });
  await rpc(parent, "accept_guardian_invite", { p_token: token, p_consent_version: CONSENT });
  try {
    const links = must(await parent.from("player_guardians").select("player_id").eq("user_id", parentUserId), "own child links");
    assert.deepEqual(links.map((row: { player_id: string }) => row.player_id).sort(), [emily, second.id].sort());
    assert.equal((await callFn("get-family-report", parent, { playerId: emily })).status, 200);
    assert.equal((await callFn("get-family-report", parent, { playerId: second.id })).status, 200);
    assert.deepEqual((await parent.from("players").select("id,name")).data ?? [], [], "no team roster rows");
  } finally {
    await rpc(coachA, "revoke_guardian", { p_player_id: second.id, p_user_id: parentUserId });
  }
  assert.equal((await callFn("get-family-report", parent, { playerId: second.id })).status, 404,
    "removing one child link ends only that child's access");
  assert.equal((await callFn("get-family-report", parent, { playerId: emily })).status, 200,
    "the guardian keeps access to the other linked child");
  if (!hadPrimaryLink) await rpc(coachA, "revoke_guardian", { p_player_id: emily, p_user_id: parentUserId });
});

test("guardian cannot write the link or invite tables directly", async () => {
  const ins = await parent2.from("player_guardians").insert({
    user_id: (await parent2.auth.getUser()).data.user!.id,
    player_id: emily,
    relationship: "parent",
    consent_version: CONSENT,
  });
  assert.ok(ins.error, "direct insert into player_guardians must fail");
  assert.equal(await rpc(parent2, "is_guardian_for_player", { target_player_id: emily }), false);

  const invites = await parent.from("guardian_invites").select("*");
  assert.deepEqual(invites.data ?? [], []);
});

test("coach of the team can see the team's guardian links; other coach cannot", async () => {
  const mine = must(await coachA.from("player_guardians").select("user_id").eq("player_id", emily), "coachA links");
  assert.ok(mine.some((r: { user_id: string }) => r.user_id === parentUserId));
  const theirs = must(await coachB.from("player_guardians").select("user_id").eq("player_id", emily), "coachB links");
  assert.deepEqual(theirs, []);
});

test("family-link check filtered to the signed-in user: a coach whose team has a linked parent sees no family links", async () => {
  // The coach app's queries (coach/index.html hasFamilyLinks, coach/family.html loadFamily):
  // RLS alone (coach_read_team_guardians) returns the team's guardian rows to the coach.
  const unfiltered = must(await coachA.from("player_guardians").select("player_id").limit(1), "coachA unfiltered");
  assert.equal(unfiltered.length, 1, "precondition: RLS lets the coach read the team's guardian rows");
  const own = must(await coachA.from("player_guardians").select("player_id").eq("user_id", coachAUserId).limit(1), "coachA own links");
  assert.deepEqual(own, [], "the coach is not a guardian of anyone");
  const family = must(await coachA.from("player_guardians").select("player_id, consented_at").eq("user_id", coachAUserId).order("consented_at"), "coachA family page");
  assert.deepEqual(family, []);
  // The linked parent still finds their own link with the same filter.
  const parentOwn = must(await parent.from("player_guardians").select("player_id").eq("user_id", parentUserId).limit(1), "parent own");
  assert.equal(parentOwn.length, 1);
});

test("revoke removes access immediately", async () => {
  await assert.rejects(rpc(coachB, "revoke_guardian", { p_player_id: emily, p_user_id: parentUserId }), /not allowed/);
  assert.equal(await rpc(parent, "is_guardian_for_player", { target_player_id: emily }), true);
  await rpc(coachA, "revoke_guardian", { p_player_id: emily, p_user_id: parentUserId });
  assert.equal(await rpc(parent, "is_guardian_for_player", { target_player_id: emily }), false);
});

test("a guardian can revoke their own link", async () => {
  const token = await rpc(coachA, "create_guardian_invite", { p_player_id: emily, p_relationship: "parent" });
  await rpc(parent, "accept_guardian_invite", { p_token: token, p_consent_version: CONSENT });
  assert.equal(await rpc(parent, "is_guardian_for_player", { target_player_id: emily }), true);
  await rpc(parent, "revoke_guardian", { p_player_id: emily, p_user_id: parentUserId });
  assert.equal(await rpc(parent, "is_guardian_for_player", { target_player_id: emily }), false);
});

// ---------------------------------------------------------------------------
// Task 2: guardian uploads (supabase/migrations/00042_guardian_uploads.sql,
// supabase/functions/get-upload-url). The get-upload-url tests need the Edge
// Functions served locally: `npx supabase functions serve --env-file .env`.
// SQL-level checks run through psql inside the local db container.
// ---------------------------------------------------------------------------

const DB_CONTAINER = process.env.SUPABASE_DB_CONTAINER ?? "supabase_db_softball_analysis";

function sql(query: string): string {
  return execFileSync("docker", ["exec", "-i", DB_CONTAINER, "psql", "-U", "postgres", "-d", "postgres", "-At", "-v", "ON_ERROR_STOP=1", "-c", query], {
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"],
  }).trim();
}

let guardian: SupabaseClient;
let guardianId: string;
let limited: SupabaseClient;
let teamASlug: string;
let emilySlug: string;
let sibling: string; // another player on team A the guardian is NOT linked to
let siblingEntry: string;

// Called at the end of the main before() (root hooks are not awaited in order).
async function setupUploads(): Promise<void> {
  const g = await makeUser("uploader");
  const l = await makeUser("limited");
  guardian = g.client;
  guardianId = g.id;
  limited = l.client;
  const team = must(await admin.from("teams").select("id, slug").eq("id", teamIds[0]!).single(), "team a");
  teamASlug = team.slug;
  const em = must(await admin.from("players").select("slug").eq("id", emily).single(), "emily slug");
  emilySlug = em.slug;
  const sib = must(
    await admin.from("players").insert({ team_id: team.id, slug: `sib-${run}`, name: "Sibling", jersey_number: "1" }).select("id").single(),
    "sibling",
  );
  sibling = sib.id;
  const se = must(
    await admin.from("game_log_entries").insert({ player_id: sibling, session_type: "game", date: "2026-09-30", opponent: "X", ab: 1 }).select("id").single(),
    "sibling entry",
  );
  siblingEntry = se.id;
  for (const c of [guardian, limited]) {
    const token = await rpc(coachA, "create_guardian_invite", { p_player_id: emily, p_relationship: "parent" });
    await rpc(c, "accept_guardian_invite", { p_token: token, p_consent_version: CONSENT });
  }
}

function opaqueTestSlug(entryId: string, label: string): string {
  const hex = createHash("sha256").update(`${entryId}:${label}`).digest("hex");
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20, 32)}`;
}

async function callUploadUrl(client: SupabaseClient, gameLogEntryId: string, label = randomUUID(), ext = ".mp4", rawSlug = false, contentType = "video/mp4") {
  const clipSlug = rawSlug ? label : opaqueTestSlug(gameLogEntryId, label);
  const token = (await client.auth.getSession()).data.session!.access_token;
  const res = await fetch(`${SUPABASE_URL}/functions/v1/get-upload-url`, {
    method: "POST",
    headers: { Authorization: `Bearer ${token}`, apikey: SUPABASE_ANON_KEY, "Content-Type": "application/json" },
    body: JSON.stringify({ gameLogEntryId, clipSlug, ext, contentType }),
  });
  return { status: res.status, body: { ...(await res.json().catch(() => ({}))), clipSlug } };
}

test("public.video_clips and demo.video_clips have the same columns (demo adds only its media columns)", () => {
  const cols = (schema: string) =>
    sql(`select column_name || ':' || data_type from information_schema.columns where table_schema = '${schema}' and table_name = 'video_clips' order by column_name`)
      .split("\n");
  const pub = cols("public");
  const demo = cols("demo");
  assert.ok(pub.includes("uploaded_by:uuid"), "public.uploaded_by");
  assert.ok(pub.includes("uploaded_by_role:text"), "public.uploaded_by_role");
  // demo.video_clips intentionally carries two demo-only media columns (00036).
  const demoOnly = ["demo_media_offset_s:double precision", "demo_media_path:text"];
  assert.deepEqual(demo.filter((c) => !demoOnly.includes(c)), pub);
});

test("demo.load_real_fixture / clone still accept the current Emily fixture", (t) => {
  const has = sql(`select count(*) from demo.demo_real_fixtures where fixture_id = 'emily' and fixture_version = '2026-10-01.1'`);
  if (has !== "1") {
    t.skip("emily@2026-10-01.1 is not loaded on this local stack");
    return;
  }
  // verify_real_fixture runs the exact clone every demo visitor gets, then rolls it back.
  const verified = sql(
    `select demo.verify_real_fixture(payload)->>'ok' from demo.demo_real_fixtures where fixture_id = 'emily' and fixture_version = '2026-10-01.1'`,
  );
  assert.equal(verified, "true");
  // The full load path (consent guard + verify + store) for a re-versioned copy, rolled back.
  const loaded = sql(
    `begin; select (demo.load_real_fixture(jsonb_set(payload, '{fixtureVersion}', '"t00042-check"'), repeat('a', 64)))->>'ok' from demo.demo_real_fixtures where fixture_id = 'emily' and fixture_version = '2026-10-01.1'; rollback;`,
  );
  assert.match(loaded, /^BEGIN\s+true\s+ROLLBACK$/);
  // A fixture must never smuggle a real uploader identity into the demo.
  assert.throws(() =>
    sql(
      `select demo.verify_real_fixture(jsonb_set(payload, '{tables,video_clips,0,uploaded_by}', to_jsonb(gen_random_uuid()::text))) from demo.demo_real_fixtures where fixture_id = 'emily' and fixture_version = '2026-10-01.1'`,
    ),
  );
});

test("current_guardian_consent_version returns the stored version to signed-in users only", async () => {
  assert.equal(await rpc(parent2, "current_guardian_consent_version", {}), CONSENT);
  const anon = createClient(SUPABASE_URL, SUPABASE_ANON_KEY, { auth: { persistSession: false, autoRefreshToken: false } });
  const { error } = await anon.rpc("current_guardian_consent_version", {});
  assert.ok(error, "anon must not execute current_guardian_consent_version");
});

test("stale consent blocks family access until the linked guardian renews it", async () => {
  const clipId = await mutationClip("reconsent gate");
  const staleVersion = `${CONSENT}-previous`;
  must(await admin.from("player_guardians").update({ consent_version: staleVersion })
    .eq("user_id", guardianId).eq("player_id", emily), "make guardian consent stale");
  try {
    assert.equal(await rpc(guardian, "is_guardian_for_player", { target_player_id: emily }), false);
    assert.equal(await rpc(guardian, "can_delete_clip", { p_clip_id: clipId }), false);
    assert.equal((await callFn("get-family-report", guardian, { playerId: emily })).status, 404);
    assert.equal(await rpc(guardian, "guardian_consent_preview", { p_player_id: emily }), "Test");
    assert.equal(await rpc(parent2, "guardian_consent_preview", { p_player_id: emily }), null);
    await assert.rejects(rpc(parent2, "renew_guardian_consent", { p_player_id: emily, p_consent_version: CONSENT }), /not allowed/);
    await assert.rejects(rpc(guardian, "renew_guardian_consent", { p_player_id: emily, p_consent_version: staleVersion }), /consent version/);
    assert.equal(await rpc(guardian, "is_guardian_for_player", { target_player_id: emily }), false);
    await rpc(guardian, "renew_guardian_consent", { p_player_id: emily, p_consent_version: CONSENT });
    assert.equal(await rpc(guardian, "is_guardian_for_player", { target_player_id: emily }), true);
    assert.equal((await callFn("get-family-report", guardian, { playerId: emily })).status, 200);
  } finally {
    must(await admin.from("player_guardians").update({ consent_version: CONSENT })
      .eq("user_id", guardianId).eq("player_id", emily), "restore guardian consent");
  }
});

test("anon cannot execute any guardian upload function", async () => {
  const anon = createClient(SUPABASE_URL, SUPABASE_ANON_KEY, { auth: { persistSession: false, autoRefreshToken: false } });
  const calls: Array<[string, Record<string, unknown>]> = [
    ["can_upload_for_entry", { p_entry_id: siblingEntry }],
    ["guardian_create_entry", { p_player_id: emily, p_kind: "game", p_date: "2026-09-30" }],
    ["guardian_register_clip", { p_entry_id: siblingEntry, p_clip_slug: "x", p_raw_gcs_path: "gs://b/x" }],
    ["guardian_can_view_clip", { p_clip_id: randomUUID() }],
  ];
  for (const [fn, args] of calls) {
    const { error } = await anon.rpc(fn, args);
    assert.ok(error, `${fn} must not be executable by anon`);
  }
});

test("guardian can create a game or practice entry for their own child only", async () => {
  const gameId = await rpc(guardian, "guardian_create_entry", { p_player_id: emily, p_kind: "game", p_date: "2026-09-30" });
  const game = must(await admin.from("game_log_entries").select("*").eq("id", gameId).single(), "game entry");
  assert.equal(game.player_id, emily);
  assert.equal(game.session_type, "game");
  assert.equal(game.date, "2026-09-30");
  assert.ok(game.ab >= 1);
  const game2 = await rpc(guardian, "guardian_create_entry", { p_player_id: emily, p_kind: "game", p_date: "2026-09-30" });
  const g2 = must(await admin.from("game_log_entries").select("ab").eq("id", game2).single(), "game entry 2");
  assert.equal(g2.ab, game.ab + 1, "next at-bat number on the same day");

  const p1 = await rpc(guardian, "guardian_create_entry", { p_player_id: emily, p_kind: "practice", p_date: "2026-09-29" });
  const p2 = await rpc(guardian, "guardian_create_entry", { p_player_id: emily, p_kind: "practice", p_date: "2026-09-29" });
  const reps = must(
    await admin.from("practice_repetitions").select("game_log_entry_id, rep_number").in("game_log_entry_id", [p1, p2]).order("rep_number"),
    "practice reps",
  );
  assert.deepEqual(reps.map((r: { game_log_entry_id: string }) => r.game_log_entry_id), [p1, p2]);

  await assert.rejects(rpc(guardian, "guardian_create_entry", { p_player_id: sibling, p_kind: "game", p_date: "2026-09-30" }), /not allowed/);
  await assert.rejects(rpc(coachB, "guardian_create_entry", { p_player_id: emily, p_kind: "game", p_date: "2026-09-30" }), /not allowed/);
  await assert.rejects(rpc(coachA, "guardian_create_entry", { p_player_id: emily, p_kind: "game", p_date: "2026-09-30" }), /not allowed/);
  await assert.rejects(rpc(guardian, "guardian_create_entry", { p_player_id: emily, p_kind: "lesson", p_date: "2026-09-30" }), /invalid kind/);
  await assert.rejects(rpc(guardian, "guardian_create_entry", { p_player_id: emily, p_kind: "game", p_date: null }), /invalid date/);
});

test("can_upload_for_entry: coach of the team or guardian of the player only", async () => {
  const entry = await rpc(guardian, "guardian_create_entry", { p_player_id: emily, p_kind: "game", p_date: "2026-09-28" });
  assert.equal(await rpc(guardian, "can_upload_for_entry", { p_entry_id: entry }), true);
  assert.equal(await rpc(coachA, "can_upload_for_entry", { p_entry_id: entry }), true);
  assert.equal(await rpc(coachB, "can_upload_for_entry", { p_entry_id: entry }), false);
  assert.equal(await rpc(parent2, "can_upload_for_entry", { p_entry_id: entry }), false);
  assert.equal(await rpc(guardian, "can_upload_for_entry", { p_entry_id: siblingEntry }), false);
  assert.equal(await rpc(guardian, "can_upload_for_entry", { p_entry_id: randomUUID() }), false);
});

test("get-upload-url: guardian gets a URL for their own child's entry, 404 for another player's", async () => {
  const entry = await rpc(guardian, "guardian_create_entry", { p_player_id: emily, p_kind: "game", p_date: "2026-09-27" });
  const ok = await callUploadUrl(guardian, entry, "g-clip-1");
  assert.equal(ok.status, 200, JSON.stringify(ok.body));
  assert.equal(ok.body.gcsPath, `gs://${BUCKET}/${entry}/raw/${ok.body.clipSlug}.mp4`);
  assert.ok(ok.body.uploadUrl);

  assert.equal((await callUploadUrl(guardian, siblingEntry)).status, 404);
  assert.equal((await callUploadUrl(parent2, entry)).status, 404);
  assert.equal((await callUploadUrl(coachB, entry)).status, 404);
  assert.equal((await callUploadUrl(guardian, randomUUID())).status, 404);
  assert.equal((await callUploadUrl(guardian, "not-a-uuid")).status, 404);
});

test("get-upload-url: coach also receives an opaque path", async () => {
  const res = await callUploadUrl(coachA, siblingEntry, "c-clip-1");
  assert.equal(res.status, 200, JSON.stringify(res.body));
  assert.equal(res.body.gcsPath, `gs://${BUCKET}/${siblingEntry}/raw/${res.body.clipSlug}.mp4`);
  assert.equal((await callUploadUrl(coachB, siblingEntry)).status, 404);
});

test("guardian_register_clip validates the path and creates a pending guardian clip the worker picks up", async () => {
  const entry = await rpc(guardian, "guardian_create_entry", { p_player_id: emily, p_kind: "game", p_date: "2026-09-26" });
  const res = await callUploadUrl(guardian, entry, "reg-clip-1");
  assert.equal(res.status, 200, JSON.stringify(res.body));
  const good = res.body.gcsPath as string;
  const clipSlug = res.body.clipSlug as string;
  const bucket = good.split("/")[2];

  for (const bad of [
    `gs://${bucket}/${teamASlug}/sib-${run}/raw/reg-clip-1.mp4`, // another player's prefix
    `gs://${bucket}/other-team/${emilySlug}/raw/reg-clip-1.mp4`, // another team's prefix
    `gs://${bucket}/${teamASlug}/${emilySlug}/processed/reg-clip-1.mp4`, // not raw/
    `gs://${bucket}/${teamASlug}/${emilySlug}/raw/../../x/raw/reg-clip-1.mp4`, // traversal
    `gs://${bucket}/${teamASlug}/${emilySlug}/raw/other-slug.mp4`, // path does not match the slug
    `gs://${bucket}/${teamASlug}/${emilySlug}/raw/reg-clip-1.mp4/x.mp4`, // nested object
    `${teamASlug}/${emilySlug}/raw/reg-clip-1.mp4`, // not a gs:// url
    `gs://${bucket}/${randomUUID()}/raw/${clipSlug}.mp4`, // a different entry's opaque folder
    `gs://${bucket}/${entry}/raw/${randomUUID()}.mp4`, // a different clip id
  ]) {
    await assert.rejects(rpc(guardian, "guardian_register_clip", { p_entry_id: entry, p_clip_slug: clipSlug, p_raw_gcs_path: bad }), /invalid/, bad);
  }
  await assert.rejects(rpc(guardian, "guardian_register_clip", { p_entry_id: entry, p_clip_slug: "../reg", p_raw_gcs_path: good }), /invalid/);
  // Not this guardian's child / not a guardian at all.
  await assert.rejects(
    rpc(guardian, "guardian_register_clip", { p_entry_id: siblingEntry, p_clip_slug: clipSlug, p_raw_gcs_path: good }),
    /not allowed/,
  );
  await assert.rejects(rpc(parent2, "guardian_register_clip", { p_entry_id: entry, p_clip_slug: clipSlug, p_raw_gcs_path: good }), /not allowed/);
  await assert.rejects(rpc(coachB, "guardian_register_clip", { p_entry_id: entry, p_clip_slug: clipSlug, p_raw_gcs_path: good }), /not allowed/);

  const clipId = await rpc(guardian, "guardian_register_clip", { p_entry_id: entry, p_clip_slug: clipSlug, p_raw_gcs_path: good });
  const clip = must(await admin.from("video_clips").select("*").eq("id", clipId).single(), "clip");
  assert.equal(clip.status, "pending");
  assert.equal(clip.uploaded_by_role, "guardian");
  assert.equal(clip.uploaded_by, guardianId);
  assert.equal(clip.raw_gcs_path, good);
  assert.equal(clip.clip_slug, clipSlug);
  assert.equal(clip.game_log_entry_id, entry);
  assert.ok(clip.at_bat_pitch_id, "linked to a pitch exactly like a coach upload");

  // The worker's exact claimable filter (src/services/db/uploadQueue.ts claimNextPendingClip).
  const nowIso = new Date().toISOString();
  const staleCutoff = new Date(Date.now() - 30 * 60_000).toISOString();
  const claimableFilter =
    `and(status.eq.pending,or(next_retry_at.is.null,next_retry_at.lte.${nowIso})),` +
    `and(status.eq.processing,claimed_at.lt.${staleCutoff})`;
  const found = must(await admin.from("video_clips").select("id").or(claimableFilter).eq("id", clipId), "worker query");
  assert.equal(found.length, 1);
  // Same join the worker's findClipContext uses.
  const ctx = must(
    await admin
      .from("video_clips")
      .select("game_log_entries!inner(date, opponent, ab, pitch, result, players!inner(slug, teams!inner(slug)))")
      .eq("id", clipId)
      .single(),
    "worker context",
  );
  assert.equal(ctx.game_log_entries.players.slug, emilySlug);
  assert.equal(ctx.game_log_entries.players.teams.slug, teamASlug);
});

test("guardians cannot write video_clips directly; coach writes cannot forge guardian provenance", async () => {
  const entry = await rpc(guardian, "guardian_create_entry", { p_player_id: emily, p_kind: "game", p_date: "2026-09-25" });
  const direct = await guardian.from("video_clips").insert({ game_log_entry_id: entry, clip_slug: "direct", raw_gcs_path: "gs://b/x", status: "pending" });
  assert.ok(direct.error, "guardian direct insert must fail");

  const forged = must(
    await coachA
      .from("video_clips")
      .insert({ game_log_entry_id: entry, clip_slug: opaqueTestSlug(entry, `forged-${run}`), status: "pending", uploaded_by_role: "guardian", uploaded_by: guardianId })
      .select("id")
      .single(),
    "coach insert",
  );
  const coachAId = (await coachA.auth.getUser()).data.user!.id;
  const row = must(await admin.from("video_clips").select("uploaded_by, uploaded_by_role").eq("id", forged.id).single(), "forged row");
  assert.equal(row.uploaded_by_role, "coach");
  assert.equal(row.uploaded_by, coachAId);
  await coachA.from("video_clips").update({ uploaded_by_role: "guardian", uploaded_by: guardianId }).eq("id", forged.id);
  const after = must(await admin.from("video_clips").select("uploaded_by, uploaded_by_role").eq("id", forged.id).single(), "after update");
  assert.equal(after.uploaded_by_role, "coach");
  assert.equal(after.uploaded_by, coachAId);
});

test("guardian_register_clip is rate limited per guardian (10 a day)", async () => {
  const entry = await rpc(limited, "guardian_create_entry", { p_player_id: emily, p_kind: "practice", p_date: "2026-09-24" });
  const probe = await callUploadUrl(limited, entry, "probe");
  assert.equal(probe.status, 200, JSON.stringify(probe.body));
  const prefix = `gs://${BUCKET}/${entry}/raw/`;
  for (let i = 0; i < 10; i++) {
    const slug = opaqueTestSlug(entry, `rl-${i}`);
    await rpc(limited, "guardian_register_clip", { p_entry_id: entry, p_clip_slug: slug, p_raw_gcs_path: `${prefix}${slug}.mp4` });
  }
  const overSlug = opaqueTestSlug(entry, "rl-10");
  await assert.rejects(
    rpc(limited, "guardian_register_clip", { p_entry_id: entry, p_clip_slug: overSlug, p_raw_gcs_path: `${prefix}${overSlug}.mp4` }),
    /rate limit/,
  );
  // get-upload-url enforces the same limit before minting (read-only: no event is recorded).
  const events = sql(`select count(*) from public.guardian_upload_events where user_id = (select id from auth.users where email like 'guardians-test-limited-${run}@%')`);
  const over = await callUploadUrl(limited, entry, "rl-over");
  assert.equal(over.status, 429, JSON.stringify(over.body));
  assert.match(over.body.error, /rate limited/);
  assert.equal(sql(`select count(*) from public.guardian_upload_events where user_id = (select id from auth.users where email like 'guardians-test-limited-${run}@%')`), events, "the mint-time check records nothing");
  // A coach of the team is never subject to it.
  assert.equal((await callUploadUrl(coachA, entry, "rl-coach")).status, 200);
});

test("get-upload-url: both roles require an opaque clip id and safe extension", async () => {
  const entry = await rpc(guardian, "guardian_create_entry", { p_player_id: emily, p_kind: "game", p_date: "2026-09-25" });
  const validSlug = opaqueTestSlug(entry, "extension-check");
  for (const [slug, ext] of [
    ["bad slug", ".mp4"], ["../escape", ".mp4"], ["a/b", ".mp4"], ["x".repeat(201), ".mp4"], ["", ".mp4"],
    [validSlug, "mp4"], [validSlug, ".mp4/x"], [validSlug, ".mp4.exe1234567"], [validSlug, ".m-p4"], [validSlug, "."],
  ]) {
    const res = await callUploadUrl(guardian, entry, slug, ext, true);
    assert.ok(res.status === 400, `${JSON.stringify(slug)}${ext} -> ${res.status}`);
  }
  const uppercaseExt = await callUploadUrl(guardian, entry, validSlug, ".MOV", true, "video/quicktime");
  assert.equal(uppercaseExt.status, 200, JSON.stringify(uppercaseExt.body));
  assert.equal(uppercaseExt.body.gcsPath, `gs://${BUCKET}/${entry}/raw/${validSlug}.mov`);
  assert.equal((await callUploadUrl(coachA, entry, "coach slug (1)", ".mp4", true)).status, 400);
  assert.equal((await callUploadUrl(coachA, entry, opaqueTestSlug(entry, "coach-opaque"), ".mp4", true)).status, 200);
});

test("get-upload-url: only supported video extension and MIME pairs receive a destination", async () => {
  const entry = await rpc(guardian, "guardian_create_entry", { p_player_id: emily, p_kind: "game", p_date: "2026-09-25" });
  for (const [label, ext, contentType] of [
    ["avi", ".avi", "video/avi"], ["fake-mp4", ".mp4", "text/plain"], ["mov-as-mp4", ".mov", "video/mp4"],
  ]) {
    const res = await callUploadUrl(coachA, entry, opaqueTestSlug(entry, label), ext, true, contentType);
    assert.equal(res.status, 415, `${label}: ${JSON.stringify(res.body)}`);
    assert.match(res.body.error, /MP4.*MOV.*WebM/);
  }
  const webm = await callUploadUrl(coachA, entry, opaqueTestSlug(entry, "webm"), ".webm", true, "video/webm");
  assert.equal(webm.status, 200, JSON.stringify(webm.body));
  assert.equal(webm.body.contentType, "video/webm");
});

test("get-upload-url resumes only the caller's reservation when an object already exists; the URL itself is create-only", async () => {
  const entry = await rpc(guardian, "guardian_create_entry", { p_player_id: emily, p_kind: "game", p_date: "2026-09-25" });
  const slug = `exists-${run}`;
  const first = await callUploadUrl(guardian, entry, slug);
  assert.equal(first.status, 200, JSON.stringify(first.body));
  const object = (first.body.gcsPath as string).replace(`gs://${BUCKET}/`, "");
  createdObjects.push(object);
  // Upload through the minted URL itself, exactly as the browser does.
  const put = await fetch(first.body.uploadUrl, { method: first.body.method, headers: { ...(first.body.headers ?? {}), "Content-Type": "video/mp4" }, body: "first" });
  await put.body?.cancel();
  assert.ok(put.ok, `first upload ${put.status}`);
  // A second upload through the same URL can't overwrite it (create-only precondition).
  const again = await fetch(first.body.uploadUrl, { method: first.body.method, headers: { ...(first.body.headers ?? {}), "Content-Type": "video/mp4" }, body: "overwrite" });
  await again.body?.cancel();
  assert.equal(again.status, 412, "create-only precondition refuses an overwrite");
  // The original caller may resume registration without receiving another URL.
  const second = await callUploadUrl(guardian, entry, slug);
  assert.equal(second.status, 200, JSON.stringify(second.body));
  assert.equal(second.body.alreadyUploaded, true);
  assert.equal(second.body.gcsPath, first.body.gcsPath);
  assert.ok(!second.body?.uploadUrl);
  // Another caller has no reservation and cannot claim the existing object.
  assert.equal((await callUploadUrl(coachA, entry, slug)).status, 409);
});

test("guardian_can_view_clip: own child's clip only", async () => {
  const entry = await rpc(guardian, "guardian_create_entry", { p_player_id: emily, p_kind: "game", p_date: "2026-09-23" });
  const own = must(
    await admin.from("video_clips").insert({ game_log_entry_id: entry, clip_slug: `own-${run}`, status: "ready" }).select("id").single(),
    "own clip",
  );
  const other = must(
    await admin.from("video_clips").insert({ game_log_entry_id: siblingEntry, clip_slug: `oth-${run}`, status: "ready" }).select("id").single(),
    "other clip",
  );
  assert.equal(await rpc(guardian, "guardian_can_view_clip", { p_clip_id: own.id }), true);
  assert.equal(await rpc(guardian, "guardian_can_view_clip", { p_clip_id: other.id }), false);
  assert.equal(await rpc(parent2, "guardian_can_view_clip", { p_clip_id: own.id }), false);
  assert.equal(await rpc(guardian, "guardian_can_view_clip", { p_clip_id: randomUUID() }), false);
});

test("notification outbox is service-only and resolves current, opted-in, player-scoped recipients", async () => {
  const entry = await rpc(guardian, "guardian_create_entry", { p_player_id: emily, p_kind: "game", p_date: "2026-10-05" });
  const clip = must(await admin.from("video_clips").insert({
    game_log_entry_id: entry, clip_slug: randomUUID(), status: "ready",
    uploaded_by: guardianId, uploaded_by_role: "guardian",
  }).select("id").single(), "notification clip");
  const args = { p_event_kind: "report_ready", p_player_id: emily, p_source_id: clip.id, p_report_has_fix: true };
  const eventId = await rpc(admin, "enqueue_notification_event", args);
  assert.equal(await rpc(admin, "enqueue_notification_event", args), eventId, "same report is idempotent");
  assert.ok((await coachA.rpc("enqueue_notification_event", args)).error, "clients cannot manufacture events");
  assert.deepEqual((await guardian.from("notification_events").select("*")).data ?? [], [], "guardians cannot list the outbox");

  const coachBId = (await coachB.auth.getUser()).data.user!.id;
  const limitedId = (await limited.auth.getUser()).data.user!.id;
  let recipients = must(await admin.rpc("notification_event_recipients", { p_event_id: eventId }), "report recipients")
    .map((row: { user_id: string }) => row.user_id);
  assert.ok(recipients.includes(coachAUserId), "current team coach included");
  assert.ok(recipients.includes(guardianId), "current linked guardian included");
  assert.ok(recipients.includes(limitedId), "another current linked guardian included");
  assert.ok(!recipients.includes(coachBId), "other team coach excluded");

  must(await admin.from("user_settings").upsert({ user_id: limitedId, notify_reports: false }), "notification opt-out");
  recipients = must(await admin.rpc("notification_event_recipients", { p_event_id: eventId }), "opted-in recipients")
    .map((row: { user_id: string }) => row.user_id);
  assert.ok(!recipients.includes(limitedId), "preference applies at delivery time");

  const failedId = await rpc(admin, "enqueue_notification_event", {
    p_event_kind: "analysis_failed", p_player_id: emily, p_source_id: clip.id,
  });
  assert.deepEqual(must(await admin.rpc("notification_event_recipients", { p_event_id: failedId }), "failure recipients"),
    [{ user_id: guardianId }], "analysis failure goes only to its still-authorized uploader");
  must(await admin.from("player_guardians").update({ consent_version: `${CONSENT}-stale` })
    .eq("user_id", guardianId).eq("player_id", emily), "stale notification consent");
  assert.deepEqual(must(await admin.rpc("notification_event_recipients", { p_event_id: failedId }), "stale failure recipients"), [],
    "stale consent removes the uploader before delivery");
  must(await admin.from("player_guardians").update({ consent_version: CONSENT })
    .eq("user_id", guardianId).eq("player_id", emily), "restore notification consent");
});

// ---------------------------------------------------------------------------
// Task 2b: real clip deletion (supabase/migrations/00043_clip_deletion.sql,
// supabase/functions/delete-clip). Needs the Edge Functions served locally
// (`npx supabase functions serve --env-file .env`) and the GCS emulator.
// ---------------------------------------------------------------------------

const GCS_HOST = process.env.GCS_EMULATOR_HOST!;
const BUCKET = process.env.GCS_BUCKET_NAME!;
const deletionClipIds: string[] = [];
// analysis_runs.knowledge_version must reference a real methodology version.
let kv: string | null = null;
const knowledgeVersion = () => (kv ??= sql("select version_label from public.methodology_versions order by version_label limit 1"));
const demoFixtureIds: string[] = [];
const createdObjects: string[] = [];

after(() => {
  // Throwaway test fixtures first (never the canonical one), so a later failure can't strand them.
  for (const f of demoFixtureIds) sql(`delete from demo.demo_real_fixtures where fixture_id = '${f}' and fixture_version = 't1'`);
  // clip_deletions rows outlive their clips by design (audit trail); remove this run's.
  if (deletionClipIds.length) sql(`delete from public.clip_deletions where clip_id in (${deletionClipIds.map((id) => `'${id}'`).join(",")})`);
});
after(async () => {
  // Emulator objects this run uploaded that a test intentionally left in place.
  for (const o of createdObjects) {
    const res = await fetch(`${GCS_HOST}/storage/v1/b/${BUCKET}/o/${encodeURIComponent(o)}`, { method: "DELETE" });
    await res.body?.cancel();
  }
});

/** A stored fixture in exactly the shape the exporter writes (format v1, exporter v1). */
function fixturePayload(fixtureId: string, clipIds: string[]): Record<string, unknown> {
  return {
    fixtureId, format: "hitterloop-demo-fixture", formatVersion: 1,
    exporter: { name: "hitterloop-export-demo-fixture", version: 1 },
    tables: { video_clips: clipIds.map((id) => ({ id })) },
  };
}

function storeFixture(fixtureId: string, payload: unknown): void {
  demoFixtureIds.push(fixtureId);
  sql(`insert into demo.demo_real_fixtures (fixture_id, fixture_version, content_sha256, payload) values ('${fixtureId}', 't1', '${"0".repeat(64)}', '${JSON.stringify(payload)}'::jsonb)`);
}

async function putObject(object: string): Promise<void> {
  createdObjects.push(object);
  const res = await fetch(`${GCS_HOST}/upload/storage/v1/b/${BUCKET}/o?uploadType=media&name=${encodeURIComponent(object)}`, {
    method: "POST",
    headers: { "Content-Type": "video/mp4" },
    body: "not really a video",
  });
  await res.body?.cancel();
  assert.ok(res.ok, `emulator upload ${object}: ${res.status}`);
}

async function objectExists(object: string): Promise<boolean> {
  const res = await fetch(`${GCS_HOST}/storage/v1/b/${BUCKET}/o/${encodeURIComponent(object)}`);
  await res.body?.cancel();
  return res.status === 200;
}

async function callDeleteClip(client: SupabaseClient | null, clipId: string) {
  const token = client ? (await client.auth.getSession()).data.session!.access_token : SUPABASE_ANON_KEY;
  const res = await fetch(`${SUPABASE_URL}/functions/v1/delete-clip`, {
    method: "POST",
    headers: { Authorization: `Bearer ${token}`, apikey: SUPABASE_ANON_KEY, "Content-Type": "application/json" },
    body: JSON.stringify({ clipId }),
  });
  return { status: res.status, body: await res.json().catch(() => null) };
}

async function callHideSimpleIssue(client: SupabaseClient | null, issueId: string) {
  const token = client ? (await client.auth.getSession()).data.session!.access_token : SUPABASE_ANON_KEY;
  const res = await fetch(`${SUPABASE_URL}/functions/v1/hide-simple-issue`, {
    method: "POST",
    headers: { Authorization: `Bearer ${token}`, apikey: SUPABASE_ANON_KEY, "Content-Type": "application/json" },
    body: JSON.stringify({ issueId, reason: "other" }),
  });
  return { status: res.status, body: await res.json().catch(() => null) };
}

async function mutationClip(label: string): Promise<string> {
  const entry = must(await admin.from("game_log_entries")
    .insert({ player_id: emily, session_type: "game", date: "2026-10-04", opponent: label, ab: 1 })
    .select("id").single(), `${label} entry`);
  const clip = must(await admin.from("video_clips")
    .insert({ game_log_entry_id: entry.id, clip_slug: randomUUID(), status: "ready", position: 0 })
    .select("id").single(), `${label} clip`);
  return clip.id;
}

test("hide-simple-issue denies another coach and lets a linked guardian hide the report fix", async () => {
  const clipId = await mutationClip("hide feedback");
  const run = must(await admin.from("analysis_runs").insert({
    video_clip_id: clipId, player_id: emily, backend: "gemini", ai_model: "test", prompt_version: "t",
    analysis_policy_version: "t", knowledge_version: knowledgeVersion(), input_manifest: {}, summary: "Test summary",
  }).select("id").single(), "feedback run");
  const issue = must(await admin.from("issues").insert({
    player_id: emily, video_clip_id: clipId, analysis_run_id: run.id, issue: "Test finding",
    concept: "posture", basis: "video", confidence: "medium", source: "gemini", review_status: "draft",
  }).select("id").single(), "feedback issue");
  assert.equal((await callHideSimpleIssue(null, issue.id)).status, 401);
  assert.equal((await callHideSimpleIssue(coachB, issue.id)).status, 403);
  assert.equal((await admin.from("issues").select("review_status").eq("id", issue.id).single()).data?.review_status, "draft");
  const accepted = await callHideSimpleIssue(guardian, issue.id);
  assert.equal(accepted.status, 200, JSON.stringify(accepted.body));
  const hidden = must(await admin.from("issues").select("review_status, hidden_by, hidden_reason")
    .eq("id", issue.id).single(), "hidden issue");
  assert.deepEqual(hidden, { review_status: "hidden", hidden_by: guardianId, hidden_reason: "other" });
  const second = must(await admin.from("issues").insert({
    player_id: emily, video_clip_id: clipId, analysis_run_id: run.id, issue: "Second test finding",
    concept: "load", basis: "video", confidence: "medium", source: "gemini", review_status: "draft",
  }).select("id").single(), "second feedback issue");
  assert.equal((await callHideSimpleIssue(coachA, second.id)).status, 200);
  assert.equal((await admin.from("issues").select("hidden_by").eq("id", second.id).single()).data?.hidden_by, coachAUserId);
});

test("delete-clip denies another coach before audit and lets a linked guardian delete", async () => {
  const clipId = await mutationClip("delete feedback");
  mutationDeletionIds.push(clipId);
  assert.equal((await callDeleteClip(null, clipId)).status, 403);
  assert.equal((await callDeleteClip(coachB, clipId)).status, 403);
  assert.equal((await admin.from("clip_deletions").select("clip_id").eq("clip_id", clipId)).data?.length, 0);
  const accepted = await callDeleteClip(guardian, clipId);
  assert.equal(accepted.status, 200, JSON.stringify(accepted.body));
  assert.equal((await admin.from("clip_deletions").select("clip_id").eq("clip_id", clipId)).data?.length, 1);
  assert.equal((await admin.from("video_clips").select("id").eq("id", clipId)).data?.length, 0);
  const coachClipId = await mutationClip("coach delete feedback");
  mutationDeletionIds.push(coachClipId);
  assert.equal((await callDeleteClip(coachA, coachClipId)).status, 200);
  assert.equal((await admin.from("video_clips").select("id").eq("id", coachClipId)).data?.length, 0);
});

test("persisted Progress follows later game evidence and deletion gaps without inventing a fix", async () => {
  const player = must(await admin.from("players").insert({
    team_id: teamIds[0], slug: `progress-${run}`, name: "Progress Test Player", jersey_number: "9",
  }).select("id").single(), "progress player");
  const issueIds: string[] = [];

  const addReadableSwing = async (serialLabel: number, concept: "posture" | "load" | null) => {
    const entry = must(await admin.from("game_log_entries").insert({
      player_id: player.id, session_type: "game", date: `2026-10-${String(serialLabel).padStart(2, "0")}`,
      opponent: `Progress ${serialLabel}`, ab: 1,
    }).select("id").single(), `progress entry ${serialLabel}`);
    const clip = must(await admin.from("video_clips").insert({
      game_log_entry_id: entry.id, clip_slug: randomUUID(), status: "ready", position: 0,
      swing_detection_state: "readable",
    }).select("id").single(), `progress clip ${serialLabel}`);
    const analysis = must(await admin.from("analysis_runs").insert({
      video_clip_id: clip.id, player_id: player.id, backend: "gemini", ai_model: "test",
      prompt_version: "t", analysis_policy_version: "t", knowledge_version: knowledgeVersion(),
      input_manifest: {}, summary: `Readable game swing ${serialLabel}`,
      strengths: [{ text: "Stayed balanced", evidence: "Balance remained visible through contact.", phase: "contact" }],
    }).select("id").single(), `progress run ${serialLabel}`);
    if (concept) {
      const issue = must(await admin.from("issues").insert({
        player_id: player.id, video_clip_id: clip.id, analysis_run_id: analysis.id,
        issue: concept === "posture" ? "Posture changed before contact" : "Load timing changed",
        evidence: "The visible movement repeats before contact.", coaching_cue: "Stay centered and move smoothly.",
        look_for_next: "Look for the same movement through contact.", concept, phase: "stride", basis: "video",
        confidence: "medium", source: "gemini", review_status: "draft",
      }).select("id").single(), `progress issue ${serialLabel}`);
      issueIds.push(issue.id);
    }
    const registered = must(await admin.rpc("register_readable_game_swing", { p_clip_id: clip.id }), `register swing ${serialLabel}`);
    assert.equal(registered, serialLabel);
    return clip.id;
  };

  // The worker persists a focus once the same video-supported concept appears
  // in three readable game swings.
  for (let serial = 1; serial <= 3; serial++) {
    await addReadableSwing(serial, "posture");
    await persistPlayerFocus(admin, player.id);
  }
  assert.deepEqual(must(await admin.from("player_focus").select("concept, status, qualified_at_serial")
    .eq("player_id", player.id).is("ended_at", null).single(), "qualified focus"),
  { concept: "posture", status: "active", qualified_at_serial: 3 });

  // Three later readable swings leave posture in only two of the latest five.
  // Hiding an unrelated finding runs the real Edge refresh and catches the
  // persisted state up to that evidence without treating the hidden finding
  // itself as proof of improvement.
  await addReadableSwing(4, null);
  await addReadableSwing(5, null);
  const deletedClipId = await addReadableSwing(6, "load");
  const hidden = await callHideSimpleIssue(coachA, issueIds.at(-1)!);
  assert.equal(hidden.status, 200, JSON.stringify(hidden.body));
  assert.equal((await admin.from("player_focus").select("status").eq("player_id", player.id)
    .is("ended_at", null).single()).data?.status, "improving");
  const focusEvent = must(await admin.from("notification_events")
    .select("id, event_kind, player_id, focus_status, focus_seen, focus_window_size")
    .eq("player_id", player.id).eq("event_kind", "focus_status").single(), "focus notification");
  assert.deepEqual({ ...focusEvent, id: undefined }, { id: undefined, event_kind: "focus_status", player_id: player.id,
    focus_status: "improving", focus_seen: 2, focus_window_size: 5 });
  const currentFocusId = (await admin.from("player_focus").select("id").eq("player_id", player.id)
    .is("ended_at", null).single()).data!.id;
  assert.equal(await rpc(admin, "enqueue_notification_event", { p_event_kind: "focus_status", p_player_id: player.id,
    p_source_id: currentFocusId, p_focus_status: "fixed", p_focus_concept: "posture",
    p_focus_seen: 0, p_focus_window_size: 5 }), null, "focus delivery is throttled for a rolling week");
  const improvedReport = await callFn("get-simplified-report", coachA, { playerId: player.id });
  assert.equal(improvedReport.status, 200, improvedReport.text);
  assert.equal(improvedReport.body.progress.status, "improving");
  assert.equal(improvedReport.body.progress.current.status, "improving");

  // Deleting serial 6 creates a stable sequence gap. The deletion Edge
  // function refreshes Progress before removing the clip; the parent/coach
  // surface must return to an early read, never claim "looks fixed."
  mutationDeletionIds.push(deletedClipId);
  const deleted = await callDeleteClip(coachA, deletedClipId);
  assert.equal(deleted.status, 200, JSON.stringify(deleted.body));
  const afterDeletion = await callFn("get-simplified-report", coachA, { playerId: player.id });
  assert.equal(afterDeletion.status, 200, afterDeletion.text);
  assert.equal(afterDeletion.body.progress.status, "early_read");
  assert.equal(afterDeletion.body.progress.current.status, "early_read");
  assert.notEqual(afterDeletion.body.progress.status, "looks_fixed");
  assert.equal((await admin.from("player_focus").select("status").eq("player_id", player.id)
    .is("ended_at", null).single()).data?.status, "improving", "stored evidence is retained while the visible state fails closed");
});

/** A guardian upload through the real path: entry -> get-upload-url -> emulator object -> guardian_register_clip. */
async function guardianUpload(slug: string): Promise<{ clipId: string; object: string; clipSlug: string }> {
  // These tests exercise upload/deletion behavior, not the quota itself. Keep
  // their shared fixture account isolated from the dedicated rate-limit case.
  sql(`delete from public.upload_reservations where user_id = '${guardianId}'`);
  sql(`delete from public.guardian_upload_events where user_id = '${guardianId}'`);
  const entry = await rpc(guardian, "guardian_create_entry", { p_player_id: emily, p_kind: "game", p_date: "2026-09-20" });
  const up = await callUploadUrl(guardian, entry, slug);
  assert.equal(up.status, 200, JSON.stringify(up.body));
  const object = (up.body.gcsPath as string).replace(`gs://${BUCKET}/`, "");
  await putObject(object);
  const clipId = await rpc(guardian, "guardian_register_clip", { p_entry_id: entry, p_clip_slug: up.body.clipSlug, p_raw_gcs_path: up.body.gcsPath });
  deletionClipIds.push(clipId);
  return { clipId, object, clipSlug: up.body.clipSlug };
}

/** A coach upload on any player of team A (the coach app's own insert shape). */
async function coachUpload(playerId: string, slug: string): Promise<{ clipId: string; object: string }> {
  const e = must(
    await admin.from("game_log_entries").insert({ player_id: playerId, session_type: "game", date: "2026-09-19", opponent: `Opp ${slug}`, ab: 1 }).select("id").single(),
    "coach entry",
  );
  const clipSlug = opaqueTestSlug(e.id, slug);
  const object = `${e.id}/raw/${clipSlug}.mp4`;
  await putObject(object);
  const clip = must(
    await coachA.from("video_clips").insert({ game_log_entry_id: e.id, clip_slug: clipSlug, raw_gcs_path: `gs://${BUCKET}/${object}`, status: "ready", position: 0 }).select("id").single(),
    "coach clip",
  );
  deletionClipIds.push(clip.id);
  return { clipId: clip.id, object };
}

/** What the analyzer leaves behind for a clip: a run, draft + reviewed findings, AI checklist drafts, comps/notes/drills. */
async function analyzeClip(clipId: string) {
  const run = must(
    await admin.from("analysis_runs").insert({
      video_clip_id: clipId, player_id: emily, backend: "gemini", ai_model: "test", prompt_version: "t", analysis_policy_version: "t",
      knowledge_version: knowledgeVersion(), input_manifest: {},
    }).select("id").single(),
    "run",
  );
  const finding = (status: string, text: string) => ({
    player_id: emily, issue: text, video_clip_id: clipId, analysis_run_id: run.id, review_status: status, source: "gemini",
    reviewed_by: status === "draft" ? null : "Coach A",
  });
  const issues = must(
    await admin.from("issues").insert([finding("draft", `draft-${clipId}`), finding("approved", `approved-${clipId}`)]).select("id, review_status"),
    "issues",
  );
  const cps = must(await admin.from("checkpoints").select("id").order("sort_order").limit(2), "checkpoints");
  // Fresh checkpoints for this player each time (unique player_id+checkpoint_id).
  await admin.from("checklist_scores").delete().eq("player_id", emily);
  const scores = must(
    await admin.from("checklist_scores").insert([
      { player_id: emily, checkpoint_id: cps[0].id, score: 2, ai_draft: 2, notes: "ai", source: "gemini", analysis_run_id: run.id },
      { player_id: emily, checkpoint_id: cps[1].id, score: 3, ai_draft: 2, notes: "coach", source: "gemini", analysis_run_id: run.id, reviewed_by: "Coach A" },
    ]).select("id, review_status"),
    "scores",
  );
  must(await admin.from("comp_recommendations").insert({ player_id: emily, position: 0, analysis_run_id: run.id, comp_name: "Comp", cue: "cue" }), "comps");
  must(await admin.from("drill_recommendations").insert({ player_id: emily, position: 0, analysis_run_id: run.id, title: "Drill", description: "d" }), "drills");
  must(await admin.from("comp_notes").insert({ player_id: emily, note: "n", position: 0, analysis_run_id: run.id }), "comp_notes");
  return {
    runId: run.id as string,
    draftId: issues.find((i: { review_status: string }) => i.review_status === "draft").id as string,
    approvedId: issues.find((i: { review_status: string }) => i.review_status === "approved").id as string,
    aiScoreId: scores.find((s: { review_status: string }) => s.review_status === "ai_draft").id as string,
    verifiedScoreId: scores.find((s: { review_status: string }) => s.review_status === "verified").id as string,
  };
}

test("can_delete_clip: coach or any linked guardian of the child, nobody else", async () => {
  const own = await guardianUpload(`cd-own-${run}`);
  const coachClip = await coachUpload(emily, `cd-coach-${run}`);
  assert.equal(await rpc(guardian, "can_delete_clip", { p_clip_id: own.clipId }), true);
  assert.equal(await rpc(coachA, "can_delete_clip", { p_clip_id: own.clipId }), true);
  assert.equal(await rpc(coachA, "can_delete_clip", { p_clip_id: coachClip.clipId }), true);
  assert.equal(await rpc(guardian, "can_delete_clip", { p_clip_id: coachClip.clipId }), true);
  assert.equal(await rpc(limited, "can_delete_clip", { p_clip_id: own.clipId }), true, "another guardian of the same child");
  assert.equal(await rpc(coachB, "can_delete_clip", { p_clip_id: own.clipId }), false);
  assert.equal(await rpc(parent2, "can_delete_clip", { p_clip_id: own.clipId }), false);
  assert.equal(await rpc(guardian, "can_delete_clip", { p_clip_id: randomUUID() }), false);
  const anon = createClient(SUPABASE_URL, SUPABASE_ANON_KEY, { auth: { persistSession: false, autoRefreshToken: false } });
  assert.ok((await anon.rpc("can_delete_clip", { p_clip_id: own.clipId })).error, "anon must not execute can_delete_clip");
  // clip_deletions is service-role only.
  assert.deepEqual((await coachA.from("clip_deletions").select("*")).data ?? [], []);
  assert.ok((await coachA.from("clip_deletions").insert({ clip_id: randomUUID() })).error);
  assert.deepEqual((await guardian.from("clip_deletions").select("*")).data ?? [], []);
});

test("delete-clip: a guardian deletes their child's upload - video, drafts and run-derived AI output go, coach conclusions stay", async () => {
  const { clipId, object, clipSlug } = await guardianUpload(`gd-del-${run}`);
  const a = await analyzeClip(clipId);
  // AI output from a DIFFERENT run must survive.
  const otherRun = must(
    await admin.from("analysis_runs").insert({
      player_id: emily, backend: "gemini", ai_model: "test", prompt_version: "t", analysis_policy_version: "t", knowledge_version: knowledgeVersion(), input_manifest: {},
    }).select("id").single(),
    "other run",
  );
  const otherComp = must(await admin.from("comp_recommendations").insert({ player_id: emily, comp_name: "Keep", cue: "c", position: 1, analysis_run_id: otherRun.id }).select("id").single(), "other comp");
  assert.equal(await objectExists(object), true);

  const res = await callDeleteClip(guardian, clipId);
  assert.equal(res.status, 200, JSON.stringify(res.body));
  assert.deepEqual(res.body, { ok: true });

  assert.equal((await admin.from("video_clips").select("id").eq("id", clipId)).data!.length, 0, "clip row gone");
  assert.equal(await objectExists(object), false, "GCS object gone");
  assert.equal((await admin.from("issues").select("id").eq("id", a.draftId)).data!.length, 0, "draft finding gone");
  const approved = must(await admin.from("issues").select("id, video_clip_id, issue").eq("id", a.approvedId).single(), "approved");
  assert.equal(approved.video_clip_id, null, "reviewed finding kept, clip link nulled");
  assert.equal(approved.issue, `approved-${clipId}`);
  assert.equal((await admin.from("checklist_scores").select("id").eq("id", a.aiScoreId)).data!.length, 0, "ai_draft score gone");
  assert.equal((await admin.from("checklist_scores").select("id").eq("id", a.verifiedScoreId)).data!.length, 1, "coach-verified score kept");
  for (const t of ["comp_recommendations", "comp_notes", "drill_recommendations"]) {
    assert.equal((await admin.from(t).select("id").eq("analysis_run_id", a.runId)).data!.length, 0, `${t} from the clip's run gone`);
  }
  assert.equal((await admin.from("comp_recommendations").select("id").eq("id", otherComp.id)).data!.length, 1, "other run's output kept");

  const audit = must(await admin.from("clip_deletions").select("*").eq("clip_id", clipId).single(), "audit row");
  assert.equal(audit.requested_by, guardianId);
  assert.equal(audit.requested_by_role, "guardian");
  assert.equal(audit.player_slug, emilySlug);
  assert.equal(audit.clip_slug, clipSlug);
  assert.equal(audit.raw_gcs_path, `gs://${BUCKET}/${object}`);
  assert.ok(audit.gcs_deleted_at);
  assert.equal(audit.local_purged_at, null, "the worker purges local files later");

  // Coaches see who removed the video behind the reviewed finding; other coaches and anon don't.
  const removals = await rpc(coachA, "clip_removals_for_player", { p_player_id: emily });
  assert.ok(removals.some((r: { issue_id: string; removed_by_role: string }) => r.issue_id === a.approvedId && r.removed_by_role === "guardian"));
  await assert.rejects(rpc(coachB, "clip_removals_for_player", { p_player_id: emily }), /not allowed/);
  const anon = createClient(SUPABASE_URL, SUPABASE_ANON_KEY, { auth: { persistSession: false, autoRefreshToken: false } });
  assert.ok((await anon.rpc("clip_removals_for_player", { p_player_id: emily })).error);
});

test("delete-clip: guardian can delete a coach upload of their child, but not another child's clip", async () => {
  const coachClip = await coachUpload(emily, `gd-403a-${run}`);
  const sibClip = await coachUpload(sibling, `gd-403b-${run}`);
  const own = await guardianUpload(`gd-403c-${run}`);
  assert.equal((await callDeleteClip(guardian, coachClip.clipId)).status, 200);
  assert.equal(await objectExists(coachClip.object), false);
  assert.equal((await callDeleteClip(guardian, sibClip.clipId)).status, 403);
  assert.equal(await rpc(limited, "can_delete_clip", { p_clip_id: own.clipId }), true, "another guardian of the same child");
  assert.equal((await callDeleteClip(parent2, own.clipId)).status, 403);
  assert.equal((await callDeleteClip(coachB, own.clipId)).status, 403);
  assert.equal((await callDeleteClip(guardian, randomUUID())).status, 403);
  assert.equal((await callDeleteClip(null, own.clipId)).status, 403, "the anon key is not a user");
  for (const c of [sibClip, own]) {
    assert.equal((await admin.from("video_clips").select("id").eq("id", c.clipId)).data!.length, 1, "nothing deleted");
    assert.equal(await objectExists(c.object), true);
    assert.equal((await admin.from("clip_deletions").select("clip_id").eq("clip_id", c.clipId)).data!.length, 0, "no audit row for a refused call");
  }
});

test("delete-clip: a coach can delete any clip on their team (coach- or guardian-uploaded)", async () => {
  const coachClip = await coachUpload(sibling, `cd-any-a-${run}`);
  const famClip = await guardianUpload(`cd-any-b-${run}`);
  for (const c of [coachClip, famClip]) {
    const res = await callDeleteClip(coachA, c.clipId);
    assert.equal(res.status, 200, JSON.stringify(res.body));
    assert.equal((await admin.from("video_clips").select("id").eq("id", c.clipId)).data!.length, 0);
    assert.equal(await objectExists(c.object), false);
    const audit = must(await admin.from("clip_deletions").select("requested_by_role").eq("clip_id", c.clipId).single(), "audit");
    assert.equal(audit.requested_by_role, "coach");
  }
});

test("delete-clip: a retry after a failure at the GCS step completes without a key error", async () => {
  const { clipId, object } = await guardianUpload(`gd-retry-${run}`);
  const a = await analyzeClip(clipId);
  // Simulate a first call that finished steps 1-4 and then failed at step 5:
  // its audit row exists, drafts are gone, the object and the clip row remain.
  sql(
    `insert into public.clip_deletions (clip_id, player_slug, clip_slug, raw_gcs_path, requested_by, requested_by_role)
     values ('${clipId}', '${emilySlug}', 'gd-retry-${run}', 'gs://${BUCKET}/${object}', '${guardianId}', 'guardian')`,
  );
  sql(`delete from public.issues where id = '${a.draftId}'`);
  const res = await callDeleteClip(guardian, clipId);
  assert.equal(res.status, 200, JSON.stringify(res.body));
  assert.equal((await admin.from("video_clips").select("id").eq("id", clipId)).data!.length, 0);
  assert.equal(await objectExists(object), false);
  const audit = must(await admin.from("clip_deletions").select("*").eq("clip_id", clipId).single(), "audit");
  assert.ok(audit.gcs_deleted_at);
});

test("video_clips rejects a new coach clip pointing at another player's footage", async () => {
  // The opaque-path trigger rejects this before deletion is ever needed.
  const victim = `${teamASlug}/sib-${run}/raw/victim-${run}.mp4`;
  const e = must(await admin.from("game_log_entries").insert({ player_id: emily, session_type: "game", date: "2026-09-18", opponent: "Z", ab: 1 }).select("id").single(), "entry");
  const clipId = randomUUID();
  const { error } = await coachA.from("video_clips").insert({ id: clipId, game_log_entry_id: e.id, clip_slug: randomUUID(), raw_gcs_path: `gs://${BUCKET}/${victim}`, status: "ready", position: 0 });
  assert.match(error?.message ?? "", /invalid raw video path/);
  assert.equal((await admin.from("video_clips").select("id").eq("id", clipId)).data!.length, 0);
  assert.equal((await admin.from("clip_deletions").select("clip_id").eq("clip_id", clipId)).data!.length, 0);
});

test("delete-clip refuses a clip that is in a stored demo fixture", async () => {
  const { clipId, object } = await guardianUpload(`gd-demo-${run}`);
  const fixtureId = `t2b-${run}`;
  demoFixtureIds.push(fixtureId);
  // The exporter's deterministic fixture clip id (src/services/demoExport/ids.ts).
  const payload = fixturePayload(fixtureId, [fixtureUuid(fixtureId, "video_clips", clipId)]);
  sql(`insert into demo.demo_real_fixtures (fixture_id, fixture_version, content_sha256, payload) values ('${fixtureId}', 't1', '${"0".repeat(64)}', '${JSON.stringify(payload)}'::jsonb)`);

  const res = await callDeleteClip(guardian, clipId);
  assert.equal(res.status, 409, JSON.stringify(res.body));
  assert.equal(res.body.error, "This swing is in the public demo — retire the demo version first");
  assert.equal((await admin.from("video_clips").select("id").eq("id", clipId)).data!.length, 1, "clip kept");
  assert.equal(await objectExists(object), true, "object kept");
  assert.equal((await admin.from("clip_deletions").select("clip_id").eq("clip_id", clipId)).data!.length, 0);

  // Once the demo version is retired, the same call goes through.
  sql(`delete from demo.demo_real_fixtures where fixture_id = '${fixtureId}'`);
  assert.equal((await callDeleteClip(guardian, clipId)).status, 200);
});

// ---------------------------------------------------------------------------
// Task 2b fix round 1.
// ---------------------------------------------------------------------------

test("delete-clip: an ai_draft score whose history holds a coach decision is kept (draft values cleared) and the delete succeeds", async () => {
  const { clipId } = await guardianUpload(`gd-hist-${run}`);
  const a = await analyzeClip(clipId);
  // A coach decision in the history of a row that is ai_draft again (a forced re-analysis overwrote it).
  sql(`insert into public.checklist_score_history (checklist_score_id, score, changed_by, review_status) values ('${a.aiScoreId}', 3, 'Coach A', 'verified')`);
  // A priority promoted from the draft finding: its source_issue_id is set null when the draft goes (fires player_priorities triggers).
  const team = must(await admin.from("players").select("team_id").eq("id", emily).single(), "team");
  const prio = must(
    await admin.from("player_priorities").insert({ player_id: emily, team_id: team.team_id, title: `p-${run}`, source_issue_id: a.draftId }).select("id").single(),
    "priority",
  );

  const res = await callDeleteClip(guardian, clipId);
  assert.equal(res.status, 200, JSON.stringify(res.body));
  const kept = must(await admin.from("checklist_scores").select("score, ai_draft, notes, source, analysis_run_id, review_status").eq("id", a.aiScoreId).single(), "kept score");
  assert.deepEqual(kept, { score: null, ai_draft: null, notes: "", source: null, analysis_run_id: null, review_status: "ai_draft" });
  const history = sql(`select count(*) from public.checklist_score_history where checklist_score_id = '${a.aiScoreId}' and changed_by = 'Coach A'`);
  assert.equal(history, "1", "the coach's history entry survives");
  const p = must(await admin.from("player_priorities").select("source_issue_id").eq("id", prio.id).single(), "priority after");
  assert.equal(p.source_issue_id, null);
  assert.equal((await admin.from("video_clips").select("id").eq("id", clipId)).data!.length, 0);
});

test("clip_removals_for_player is coach-only: a linked guardian is denied", async () => {
  await assert.rejects(rpc(guardian, "clip_removals_for_player", { p_player_id: emily }), /not allowed/);
  await assert.rejects(rpc(parent2, "clip_removals_for_player", { p_player_id: emily }), /not allowed/);
  assert.ok(Array.isArray(await rpc(coachA, "clip_removals_for_player", { p_player_id: emily })));
});

test("delete-clip fails closed while any stored demo fixture is in a shape it can't check", async () => {
  const { clipId, object } = await guardianUpload(`gd-unrec-${run}`);
  const variants: Array<[string, (p: Record<string, unknown>) => void]> = [
    ["clips-not-array", (p) => { p.tables = { video_clips: { id: "x" } }; }],
    ["no-clips", (p) => { p.tables = {}; }],
    ["format-v2", (p) => { p.formatVersion = 2; }],
    ["other-format", (p) => { p.format = "something-else"; }],
    ["other-exporter", (p) => { p.exporter = { name: "hitterloop-export-demo-fixture", version: 2 }; }],
    ["no-exporter", (p) => { delete p.exporter; }],
    ["no-fixture-id", (p) => { delete p.fixtureId; }],
    ["clip-id-not-string", (p) => { p.tables = { video_clips: [{ id: 42 }] }; }],
  ];
  for (const [label, mutate] of variants) {
    const fixtureId = `t2b-${label}-${run}`;
    const payload = fixturePayload(fixtureId, []);
    mutate(payload);
    storeFixture(fixtureId, payload);
    const res = await callDeleteClip(guardian, clipId);
    assert.equal(res.status, 409, `${label}: ${JSON.stringify(res.body)}`);
    assert.match(res.body.error, /demo fixture couldn't be checked/, label);
    sql(`delete from demo.demo_real_fixtures where fixture_id = '${fixtureId}' and fixture_version = 't1'`);
  }
  assert.equal((await admin.from("video_clips").select("id").eq("id", clipId)).data!.length, 1, "nothing deleted");
  assert.equal(await objectExists(object), true);
  assert.equal((await admin.from("clip_deletions").select("clip_id").eq("clip_id", clipId)).data!.length, 0);
  // A well-formed fixture that doesn't contain the clip doesn't block it.
  storeFixture(`t2b-ok-${run}`, fixturePayload(`t2b-ok-${run}`, [randomUUID()]));
  assert.equal((await callDeleteClip(guardian, clipId)).status, 200);
});

test("worker purge (real clip_deletions queries) only purges finished deletions", async () => {
  const { supabasePurgeDb, purgeDeletedClips } = await import("../../src/cli/purgeDeletedClips.js");
  const fs = await import("node:fs");
  const os = await import("node:os");
  const path = await import("node:path");
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "purge-int-"));
  const finished = randomUUID();
  const unfinished = randomUUID();
  deletionClipIds.push(finished, unfinished);
  const player = `purge-${run}`;
  for (const id of [finished, unfinished]) fs.mkdirSync(path.join(root, player, id), { recursive: true });
  sql(
    `insert into public.clip_deletions (clip_id, player_slug, clip_slug, requested_by_role, gcs_deleted_at) values
     ('${finished}', '${player}', '${finished}', 'coach', now()), ('${unfinished}', '${player}', '${unfinished}', 'coach', null)`,
  );
  const db = supabasePurgeDb(admin);
  const pending = (await db.pendingPurges()).map((r) => r.clip_id);
  assert.ok(pending.includes(finished));
  assert.ok(!pending.includes(unfinished), "the real query excludes unfinished deletions");
  await purgeDeletedClips(db, root);
  assert.equal(fs.existsSync(path.join(root, player, finished)), false);
  assert.equal(fs.existsSync(path.join(root, player, unfinished)), true, "an unfinished deletion keeps its local files");
  assert.equal(sql(`select local_purged_at is null from public.clip_deletions where clip_id = '${unfinished}'`), "t");
  assert.equal(sql(`select local_purged_at is not null from public.clip_deletions where clip_id = '${finished}'`), "t");
  fs.rmSync(root, { recursive: true, force: true });
});

// ---------------------------------------------------------------------------
// Task 3: family read surface (supabase/functions/get-family-report,
// supabase/functions/_shared/familyReport.ts, get-video-url guardian branch).
// Needs the Edge Functions served locally.
// ---------------------------------------------------------------------------

async function callFn(name: string, client: SupabaseClient | null, body: unknown) {
  const token = client ? (await client.auth.getSession()).data.session!.access_token : SUPABASE_ANON_KEY;
  const res = await fetch(`${SUPABASE_URL}/functions/v1/${name}`, {
    method: "POST",
    headers: { Authorization: `Bearer ${token}`, apikey: SUPABASE_ANON_KEY, "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  const text = await res.text();
  let json: any = null; // eslint-disable-line @typescript-eslint/no-explicit-any
  try {
    json = JSON.parse(text);
  } catch {
    /* not json */
  }
  return { status: res.status, text, body: json };
}

/** A clip on an existing entry, inserted as the service role (worker-shaped). */
async function famClip(entryId: string, slug: string, status: string, rawPath: string | null = null): Promise<string> {
  const clipSlug = opaqueTestSlug(entryId, slug);
  const clip = must(
    await admin.from("video_clips").insert({ game_log_entry_id: entryId, clip_slug: clipSlug, status, raw_gcs_path: rawPath, position: 0 }).select("id").single(),
    `clip ${slug}`,
  );
  return clip.id;
}

async function famRun(clipId: string, playerId = emily): Promise<string> {
  const r = must(
    await admin.from("analysis_runs").insert({
      video_clip_id: clipId, player_id: playerId, backend: "gemini", ai_model: "test", prompt_version: "t", analysis_policy_version: "t",
      knowledge_version: knowledgeVersion(), input_manifest: {},
    }).select("id").single(),
    "fam run",
  );
  return r.id;
}

async function famIssue(clipId: string, status: string, text: string, playerId = emily, runId: string | null = null): Promise<string> {
  return must(
    await admin.from("issues").insert({
      player_id: playerId, issue: text, likely_cause: `${text}-cause`, effect: `${text}-effect`, video_clip_id: clipId,
      analysis_run_id: runId, review_status: status, source: "gemini", reviewed_by: status === "draft" ? null : "Coach A",
    }).select("id").single(),
    `issue ${text}`,
  ).id;
}

const fam: Record<string, string> = {};
let famEntry: string;

test("get-family-report: coach-confirmed content only; drafts never appear", async () => {
  const entry = await rpc(guardian, "guardian_create_entry", { p_player_id: emily, p_kind: "game", p_date: "2026-09-15" });
  famEntry = entry;
  const rawFor = (slug: string) => `gs://${BUCKET}/${entry}/raw/${opaqueTestSlug(entry, slug)}.mp4`;
  fam.draft = await famClip(entry, `fam-draft-${run}`, "ready", rawFor(`fam-draft-${run}`));
  fam.analyzed = await famClip(entry, `fam-an-${run}`, "ready", rawFor(`fam-an-${run}`));
  fam.reviewed = await famClip(entry, `fam-rev-${run}`, "ready", rawFor(`fam-rev-${run}`));
  fam.pending = await famClip(entry, `fam-pend-${run}`, "pending", rawFor(`fam-pend-${run}`));
  fam.failed = await famClip(entry, `fam-fail-${run}`, "failed", rawFor(`fam-fail-${run}`));
  must(
    await admin.from("video_clips").update({ error_message: "This video is longer than the 3-minute upload limit." }).eq("id", fam.failed),
    "duration failure",
  );
  const draftRun = await famRun(fam.draft);
  await famRun(fam.analyzed);
  const revRun = await famRun(fam.reviewed);
  await famIssue(fam.draft, "draft", `FAMDRAFT-${run}`, emily, draftRun);
  await famIssue(fam.reviewed, "approved", `FAMAPPROVED-${run}`, emily, revRun);

  const cps = must(await admin.from("checkpoints").select("id, label").order("sort_order").limit(2), "checkpoints");
  const draftLabel: string = cps[0].label;
  const verifiedLabel: string = cps[1].label;
  await admin.from("checklist_scores").delete().eq("player_id", emily);
  must(
    await admin.from("checklist_scores").insert([
      { player_id: emily, checkpoint_id: cps[0].id, score: 1, ai_draft: 1, notes: `FAMDRAFTNOTE-${run}`, source: "gemini", analysis_run_id: draftRun },
      { player_id: emily, checkpoint_id: cps[1].id, score: 3, ai_draft: 2, notes: `FAMCOACHNOTE-${run}`, source: "gemini", reviewed_by: "Coach A" },
    ]),
    "scores",
  );
  const kinds = must(await admin.from("checklist_scores").select("review_status").eq("player_id", emily), "score kinds");
  assert.deepEqual(kinds.map((k: { review_status: string }) => k.review_status).sort(), ["ai_draft", "verified"]);

  const res = await callFn("get-family-report", guardian, { playerId: emily });
  assert.equal(res.status, 200, res.text);
  // Serialized: no draft finding, no draft checkpoint (label or score), no notes/source/AI fields.
  assert.ok(!res.text.includes(`FAMDRAFT-${run}`), "draft finding must not appear");
  assert.doesNotMatch(res.text, /FAMDRAFTNOTE|FAMCOACHNOTE/);
  assert.ok(!res.text.includes(draftLabel), "draft checkpoint label must not appear");
  assert.doesNotMatch(res.text, /ai_draft|"source"|"notes"|gemini|analysis_run|confidence|raw_gcs_path|gs:\/\//);
  assert.deepEqual(res.body.strengths, [verifiedLabel]);
  assert.ok(!res.body.checkpoints.some((c: { label: string }) => c.label === draftLabel), "no draft score");

  // The coach-reviewed finding is there.
  assert.ok(res.body.findings.some((x: { title: string; clipId: string }) => x.title === `FAMAPPROVED-${run}` && x.clipId === fam.reviewed));
  // Same payload as get-player-report, plus clips + findings.
  for (const k of ["playerName", "jerseyNumber", "teamName", "nextStep", "loggedAtBats", "strengths", "priorities", "checkpoints", "clips", "findings"]) {
    assert.ok(k in res.body, k);
  }
});

test("get-family-report: clip statuses use the coach page's rule; clips expose no AI fields", async () => {
  const res = await callFn("get-family-report", guardian, { playerId: emily });
  assert.equal(res.status, 200, res.text);
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const byId = new Map<string, any>(res.body.clips.map((c: { id: string }) => [c.id, c]));
  assert.equal(byId.get(fam.draft!)?.status, "awaiting_coach");
  assert.equal(byId.get(fam.analyzed!)?.status, "analyzed", "analyzed with zero findings is 'analyzed', not 'awaiting_coach'");
  assert.equal(byId.get(fam.reviewed!)?.status, "reviewed");
  assert.equal(byId.get(fam.pending!)?.status, "processing");
  assert.equal(byId.get(fam.failed!)?.status, "failed");
  assert.equal(byId.get(fam.failed!)?.failureReason, "duration_limit");
  for (const c of res.body.clips) {
    assert.deepEqual(Object.keys(c).sort(), ["deleteUnfinished", "failureReason", "id", "recordedAt", "status", "uploadedByYou"]);
  }
  assert.equal(byId.get(fam.reviewed!)?.recordedAt, "2026-09-15");
  // Another player's clips never appear.
  const sibClip = await famClip(siblingEntry, `fam-sib-list-${run}`, "ready");
  const again = await callFn("get-family-report", guardian, { playerId: emily });
  assert.ok(!again.body.clips.some((c: { id: string }) => c.id === sibClip));
});

test("get-simplified-report: confirmed no-swing stays in the feed while uncertainty is unreadable", async () => {
  const entry = await rpc(guardian, "guardian_create_entry", { p_player_id: emily, p_kind: "game", p_date: "2026-09-16" });
  const rawFor = (slug: string) => `gs://${BUCKET}/${entry}/raw/${opaqueTestSlug(entry, slug)}.mp4`;
  const noSwing = await famClip(entry, `simple-no-swing-${run}`, "ready", rawFor(`simple-no-swing-${run}`));
  const uncertain = await famClip(entry, `simple-uncertain-${run}`, "ready", rawFor(`simple-uncertain-${run}`));
  must(await admin.from("video_clips").update({ swing_detection_state: "confirmed_no_swing" }).eq("id", noSwing), "confirm no swing");
  must(await admin.from("video_clips").update({ swing_detection_state: "inconclusive" }).eq("id", uncertain), "mark inconclusive");

  const report = await callFn("get-simplified-report", guardian, { playerId: emily, clipId: noSwing });
  assert.equal(report.status, 200, report.text);
  assert.deepEqual(report.body.report, { state: "no_swing", reason: "No swing to analyze in this at-bat." });

  const home = await callFn("get-simplified-report", guardian, { playerId: emily });
  assert.equal(home.status, 200, home.text);
  const byId = new Map(home.body.feed.map((row: { id: string }) => [row.id, row]));
  assert.equal((byId.get(noSwing) as { status: string; headline: string }).status, "no_swing");
  assert.equal((byId.get(noSwing) as { status: string; headline: string }).headline, "No swing to analyze in this at-bat.");
  assert.equal((byId.get(uncertain) as { status: string }).status, "unreadable");
});

test("get-simplified-report: incomplete re-analysis blocks stale claims; older feedback cannot hide a newer run", async () => {
  const entry = await rpc(guardian, "guardian_create_entry", { p_player_id: emily, p_kind: "game", p_date: "2026-09-17" });
  const slug = `simple-rerun-${run}`;
  const clipId = await famClip(entry, slug, "ready", `gs://${BUCKET}/${entry}/raw/${opaqueTestSlug(entry, slug)}.mp4`);
  must(await admin.from("video_clips").update({ swing_detection_state: "readable" }).eq("id", clipId), "readable rerun clip");
  const analysisRun = async (summary: string | null, strengths: unknown, createdAt: string) => must(
    await admin.from("analysis_runs").insert({ video_clip_id: clipId, player_id: emily, backend: "gemini",
      ai_model: "test", prompt_version: "t", analysis_policy_version: "t", knowledge_version: knowledgeVersion(),
      input_manifest: {}, summary, strengths, created_at: createdAt }).select("id").single(), "rerun analysis",
  ).id as string;
  const oldId = await analysisRun("Old observation about the swing.", [], "2026-09-17T10:00:00Z");
  must(await admin.from("issues").insert({ player_id: emily, video_clip_id: clipId, analysis_run_id: oldId,
    issue: "Old hidden finding", concept: "posture", basis: "video", confidence: "medium",
    source: "gemini", review_status: "hidden" }), "old hidden issue");
  await analysisRun(null, [], "2026-09-17T10:01:00Z");

  const incompleteReport = await callFn("get-simplified-report", guardian, { playerId: emily, clipId });
  assert.equal(incompleteReport.status, 200, incompleteReport.text);
  assert.equal(incompleteReport.body.report.state, "unreadable");
  const incompleteHome = await callFn("get-simplified-report", guardian, { playerId: emily });
  assert.equal(incompleteHome.status, 200, incompleteHome.text);
  const incompleteRow = incompleteHome.body.feed.find((row: { id: string }) => row.id === clipId);
  assert.equal(incompleteRow?.status, "unreadable");
  assert.equal(incompleteRow?.headline, null);

  await analysisRun("Unverified newer observation.", [{ text: "Claim", evidence: "Frame", phase: "invented_phase" }],
    "2026-09-17T10:01:30Z");
  const malformedReport = await callFn("get-simplified-report", guardian, { playerId: emily, clipId });
  assert.equal(malformedReport.status, 200, malformedReport.text);
  assert.equal(malformedReport.body.report.state, "unreadable");
  const malformedHome = await callFn("get-simplified-report", guardian, { playerId: emily });
  assert.equal(malformedHome.status, 200, malformedHome.text);
  assert.equal(malformedHome.body.feed.find((row: { id: string }) => row.id === clipId)?.status, "unreadable");

  const currentId = await analysisRun("New observation about the swing.", [], "2026-09-17T10:02:00Z");
  const currentReport = await callFn("get-simplified-report", guardian, { playerId: emily, clipId });
  assert.equal(currentReport.status, 200, currentReport.text);
  assert.equal(currentReport.body.report.state, "ready");
  assert.equal(currentReport.body.report.summary, "New observation about the swing.");
  const currentHome = await callFn("get-simplified-report", guardian, { playerId: emily });
  assert.equal(currentHome.status, 200, currentHome.text);
  const currentRow = currentHome.body.feed.find((row: { id: string }) => row.id === clipId);
  assert.equal(currentRow?.status, "ready");
  assert.equal(currentRow?.headline, "New observation about the swing.");
  must(await admin.from("issues").insert({ player_id: emily, video_clip_id: clipId, analysis_run_id: currentId,
    issue: "Incomplete stored finding", evidence: " ", coaching_cue: "Keep steady", look_for_next: "Steady setup",
    concept: "posture", basis: "video", confidence: "medium", source: "gemini", review_status: "draft" }),
  "malformed current issue");
  const incompleteCopy = await callFn("get-simplified-report", guardian, { playerId: emily, clipId });
  assert.equal(incompleteCopy.body.report.state, "unreadable");
  const incompleteCopyHome = await callFn("get-simplified-report", guardian, { playerId: emily });
  assert.equal(incompleteCopyHome.body.feed.find((row: { id: string }) => row.id === clipId)?.status, "unreadable");
});

test("get-family-report: 404 for a player the caller is not linked to; 401 without a session", async () => {
  assert.equal((await callFn("get-family-report", guardian, { playerId: sibling })).status, 404);
  assert.equal((await callFn("get-family-report", parent2, { playerId: emily })).status, 404);
  assert.equal((await callFn("get-family-report", coachA, { playerId: emily })).status, 404, "coaches use the coach app, not this surface");
  assert.equal((await callFn("get-family-report", guardian, { playerId: randomUUID() })).status, 404);
  assert.equal((await callFn("get-family-report", guardian, { playerId: "not-a-uuid" })).status, 404);
  assert.equal((await callFn("get-family-report", null, { playerId: emily })).status, 404, "the anon key is not a guardian");
  const noAuth = await fetch(`${SUPABASE_URL}/functions/v1/get-family-report`, {
    method: "POST",
    headers: { apikey: SUPABASE_ANON_KEY, "Content-Type": "application/json" },
    body: JSON.stringify({ playerId: emily }),
  });
  await noAuth.body?.cancel();
  assert.equal(noAuth.status, 401);
});

test("get-family-report: a reviewed finding whose video was removed carries videoRemovedBy", async () => {
  const { clipId } = await guardianUpload(`fam-rm-${run}`);
  await famIssue(clipId, "approved", `FAMREMOVED-${run}`);
  const coachClip = await coachUpload(emily, `fam-rmc-${run}`);
  await famIssue(coachClip.clipId, "edited", `FAMREMOVEDC-${run}`);
  assert.equal((await callDeleteClip(guardian, clipId)).status, 200);
  assert.equal((await callDeleteClip(coachA, coachClip.clipId)).status, 200);
  const res = await callFn("get-family-report", guardian, { playerId: emily });
  assert.equal(res.status, 200, res.text);
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const find = (title: string) => res.body.findings.find((x: any) => x.title === title);
  assert.deepEqual({ clipId: find(`FAMREMOVED-${run}`).clipId, by: find(`FAMREMOVED-${run}`).videoRemovedBy }, { clipId: null, by: "family" });
  assert.deepEqual({ clipId: find(`FAMREMOVEDC-${run}`).clipId, by: find(`FAMREMOVEDC-${run}`).videoRemovedBy }, { clipId: null, by: "coach" });
  assert.equal(find(`FAMAPPROVED-${run}`).videoRemovedBy, null, "a finding that still has its clip has no marker");
});

async function callVideoUrl(client: SupabaseClient | null, videoClipId: string) {
  return callFn("get-video-url", client, { videoClipId });
}

test("get-video-url: guardian gets a URL for their own child's reviewed or analyzed clip only", async () => {
  const ok = await callVideoUrl(guardian, fam.reviewed!);
  assert.equal(ok.status, 200, ok.text);
  assert.match(ok.body.url, new RegExp(`${opaqueTestSlug(famEntry, `fam-rev-${run}`)}\\.mp4`));
  assert.equal((await callVideoUrl(guardian, fam.analyzed!)).status, 200);
  for (const id of [fam.draft!, fam.pending!, fam.failed!]) {
    assert.equal((await callVideoUrl(guardian, id)).status, 403, `status-gated: ${id}`);
  }
});

test("get-video-url: guardian gets 403 for another player's reviewed clip", async () => {
  const sibSlug = opaqueTestSlug(siblingEntry, `fam-sib-${run}`);
  const sibClip = await famClip(siblingEntry, `fam-sib-${run}`, "ready", `gs://${BUCKET}/${siblingEntry}/raw/${sibSlug}.mp4`);
  const r = await famRun(sibClip, sibling);
  await famIssue(sibClip, "approved", `FAMSIB-${run}`, sibling, r);
  assert.equal((await callVideoUrl(guardian, sibClip)).status, 403);
  assert.equal((await callVideoUrl(parent2, fam.reviewed!)).status, 403, "not a guardian of anyone");
  assert.equal((await callVideoUrl(guardian, randomUUID())).status, 403);
  // A coach can read any current-format clip on their team, regardless of review status.
  assert.equal((await callVideoUrl(coachA, sibClip)).status, 200);
  assert.equal((await callVideoUrl(coachA, fam.draft!)).status, 200);
});

test("video_clips rejects a guardian-visible clip whose stored path is outside its own raw folder", async () => {
  const entry = await rpc(guardian, "guardian_create_entry", { p_player_id: emily, p_kind: "game", p_date: "2026-09-14" });
  const clipId = randomUUID();
  const { error } = await admin.from("video_clips").insert({ id: clipId, game_log_entry_id: entry, clip_slug: randomUUID(), status: "ready", raw_gcs_path: `gs://${BUCKET}/${siblingEntry}/raw/${randomUUID()}.mp4`, position: 0 });
  assert.match(error?.message ?? "", /invalid raw video path/);
  assert.equal((await admin.from("video_clips").select("id").eq("id", clipId)).data!.length, 0);
});

test("get-video-url and get-family-report: 403/404 after revoke_guardian", async () => {
  assert.equal((await callVideoUrl(limited, fam.reviewed!)).status, 200, "linked before revoke");
  assert.equal((await callFn("get-family-report", limited, { playerId: emily })).status, 200);
  const limitedId = (await limited.auth.getUser()).data.user!.id;
  await rpc(coachA, "revoke_guardian", { p_player_id: emily, p_user_id: limitedId });
  assert.equal((await callVideoUrl(limited, fam.reviewed!)).status, 403);
  assert.equal((await callFn("get-family-report", limited, { playerId: emily })).status, 404);
});

test("get-player-report redacts the seeded player's identity and team", async (t) => {
  const links = must(
    await admin
      .from("player_share_links")
      .select("token, players!inner(slug, teams!inner(slug))")
      .eq("players.slug", "emily")
      .eq("players.teams.slug", "latham-lady-bison-white-10u")
      .is("revoked_at", null)
      .gt("expires_at", new Date().toISOString())
      .order("created_at")
      .limit(1),
    "emily share link",
  );
  if (!links.length) {
    t.skip("no live share link for the seeded Emily player on this local stack");
    return;
  }
  const res = await callFn("get-player-report", null, { token: links[0].token });
  assert.equal(res.status, 200, res.text);
  // Some already-redacted seeded players carry only a first name. Never
  // invent a last initial; full stored names reduce to first + last initial.
  assert.match(res.body.playerName, /^[^\s]+(?: [^\s]\.)?$/u);
  assert.equal(res.body.teamName, "");
  assert.equal(res.body.jerseyNumber, null);
  assert.ok(!res.text.includes("latham-lady-bison-white-10u"), "team slug must not be in the payload");
  assert.doesNotMatch(res.text, /"(?:player_id|team_id|playerId|teamId)"\s*:/, "internal roster ids must not be shared");
  assert.ok(!("clips" in res.body) && !("findings" in res.body), "the share-link payload gains no family-only fields");
});

test("simplified share payload keeps only the private player name and display fields", async () => {
  const progressToken = await rpc(guardian, "create_simple_share_link", {
    p_player_id: emily, p_scope: "progress", p_clip_id: null,
  });
  const tokenOnlyProgress = await callFn("get-simplified-report", null, { token: progressToken });
  assert.equal(tokenOnlyProgress.status, 200, tokenOnlyProgress.text);
  assert.ok(!("playerId" in tokenOnlyProgress.body));
  assert.ok("progress" in tokenOnlyProgress.body);
  const progress = await callFn("get-simplified-report", null, { playerId: emily, token: progressToken });
  assert.equal(progress.status, 200, progress.text);
  assert.match(progress.body.playerName, /^[^\s]+(?: [^\s]\.)?$/u);
  assert.ok(!("playerId" in progress.body));
  assert.ok(!("thenClipId" in progress.body.progress) && !("nowClipId" in progress.body.progress));
  assert.ok(!("clipId" in (progress.body.progress.thenVideo ?? {})));
  assert.ok(!("id" in (progress.body.progress.focusDrill ?? {})));
  assert.ok(!progress.text.includes("Guardians a"), "team name must not appear in shared text");

  const reportToken = await rpc(guardian, "create_simple_share_link", {
    p_player_id: emily, p_scope: "report", p_clip_id: fam.reviewed!,
  });
  const tokenOnlyReport = await callFn("get-simplified-report", null, { token: reportToken });
  assert.equal(tokenOnlyReport.status, 200, tokenOnlyReport.text);
  assert.ok("report" in tokenOnlyReport.body);
  assert.ok(!("clipId" in tokenOnlyReport.body));
  const report = await callFn("get-simplified-report", null, {
    playerId: emily, clipId: fam.reviewed, token: reportToken,
  });
  assert.equal(report.status, 200, report.text);
  assert.match(report.body.playerName, /^[^\s]+(?: [^\s]\.)?$/u);
  for (const key of ["playerId", "clipId", "entryId", "entryClipIds"]) assert.ok(!(key in report.body));
  assert.ok(!("id" in (report.body.report?.fix ?? {})));
  assert.ok((report.body.report?.drills ?? []).every((drill: Record<string, unknown>) => !("id" in drill)));
  assert.ok(!report.text.includes("Guardians a"), "team name must not appear in shared report");
  assert.equal((await callFn("get-simplified-report", null, { token: reportToken, playerId: crypto.randomUUID() })).status, 404);
  assert.equal((await callFn("get-simplified-report", null, { token: reportToken, clipId: crypto.randomUUID() })).status, 404);
  assert.equal((await callFn("get-simplified-report", null, { token: progressToken, clipId: fam.reviewed })).status, 404);
});

test("simplified share token follows its creator's current consent and player access", async () => {
  const player = must(await admin.from("players").insert({ team_id: teamIds[0],
    slug: `share-access-${run}`, name: "Share Access Child", jersey_number: "91" }).select("id").single(), "share access player");
  const family = await makeUser("share-access");
  const temporaryCoach = await makeUser("share-coach");
  must(await admin.from("coach_team_access").insert({ coach_id: temporaryCoach.id,
    team_id: teamIds[0], role: "head_coach" }), "temporary share coach access");
  const invite = await rpc(coachA, "create_guardian_invite", { p_player_id: player.id, p_relationship: "parent" });
  await rpc(family.client, "accept_guardian_invite", { p_token: invite, p_consent_version: CONSENT });
  const familyToken = await rpc(family.client, "create_simple_share_link", {
    p_player_id: player.id, p_scope: "progress", p_clip_id: null,
  });
  const coachToken = await rpc(coachA, "create_simple_share_link", {
    p_player_id: player.id, p_scope: "progress", p_clip_id: null,
  });
  const temporaryCoachToken = await rpc(temporaryCoach.client, "create_simple_share_link", {
    p_player_id: player.id, p_scope: "progress", p_clip_id: null,
  });
  const legacyToken = randomUUID();
  must(await admin.from("player_share_links").insert({ player_id: player.id, token: legacyToken,
    created_by: temporaryCoach.id }), "temporary coach legacy share link");
  const open = (token: string) => callFn("get-simplified-report", null, { playerId: player.id, token });
  assert.equal((await open(familyToken)).status, 200);
  assert.equal((await open(coachToken)).status, 200);
  assert.equal((await open(temporaryCoachToken)).status, 200);
  assert.equal((await callFn("get-player-report", null, { token: legacyToken })).status, 200);

  must(await admin.from("coach_team_access").delete().eq("coach_id", temporaryCoach.id)
    .eq("team_id", teamIds[0]), "remove temporary share coach access");
  assert.equal((await open(temporaryCoachToken)).status, 404, "removed coach access closes that coach's token");
  assert.equal((await callFn("get-player-report", null, { token: legacyToken })).status, 404,
    "removed coach access closes the legacy report token too");

  must(await admin.from("player_guardians").update({ consent_version: "stale-consent-test" })
    .eq("player_id", player.id).eq("user_id", family.id), "stale share consent");
  assert.equal((await open(familyToken)).status, 404, "stale consent closes a family-created link");
  assert.equal((await open(coachToken)).status, 200, "a coach-created link follows coach access");
  await rpc(family.client, "renew_guardian_consent", { p_player_id: player.id, p_consent_version: CONSENT });
  assert.equal((await open(familyToken)).status, 404, "renewal cannot revive a token issued under older consent");
  const renewedToken = await rpc(family.client, "create_simple_share_link", {
    p_player_id: player.id, p_scope: "progress", p_clip_id: null,
  });
  assert.equal((await open(renewedToken)).status, 200);
  await rpc(coachA, "revoke_guardian", { p_player_id: player.id, p_user_id: family.id });
  assert.equal((await open(familyToken)).status, 404, "removing the creator's link closes their share token");
  assert.equal((await open(renewedToken)).status, 404);
  assert.equal((await open(coachToken)).status, 200);
  const reinvite = await rpc(coachA, "create_guardian_invite", { p_player_id: player.id, p_relationship: "parent" });
  await rpc(family.client, "accept_guardian_invite", { p_token: reinvite, p_consent_version: CONSENT });
  assert.equal((await open(renewedToken)).status, 404, "rejoining cannot revive an old token");
});

// ---------------------------------------------------------------------------
// Task 3 fix round 1: uploadedByYou, clips mid-deletion.
// ---------------------------------------------------------------------------

test("get-family-report: uploadedByYou is true only for the caller's own uploads, and no uploader id is exposed", async () => {
  // This run's earlier tests used up the guardian's 10-a-day upload quota (test users only).
  sql(`delete from public.guardian_upload_events where user_id = '${guardianId}'`);
  const own = await guardianUpload(`fam-mine-${run}`);
  const coachClip = await coachUpload(emily, `fam-coachup-${run}`);
  // A second guardian of the same child uploads through the real path.
  const other = await makeUser("guardian3");
  await rpc(other.client, "accept_guardian_invite", {
    p_token: await rpc(coachA, "create_guardian_invite", { p_player_id: emily, p_relationship: "guardian" }),
    p_consent_version: CONSENT,
  });
  const entry = await rpc(other.client, "guardian_create_entry", { p_player_id: emily, p_kind: "game", p_date: "2026-09-13" });
  const up = await callUploadUrl(other.client, entry, `fam-other-${run}`);
  assert.equal(up.status, 200, JSON.stringify(up.body));
  const otherClip = await rpc(other.client, "guardian_register_clip", { p_entry_id: entry, p_clip_slug: up.body.clipSlug, p_raw_gcs_path: up.body.gcsPath });

  const res = await callFn("get-family-report", guardian, { playerId: emily });
  assert.equal(res.status, 200, res.text);
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const byId = new Map<string, any>(res.body.clips.map((c: { id: string }) => [c.id, c]));
  assert.equal(byId.get(own.clipId)?.uploadedByYou, true, "own upload");
  assert.equal(byId.get(coachClip.clipId)?.uploadedByYou, false, "coach upload");
  assert.equal(byId.get(otherClip)?.uploadedByYou, false, "another guardian's upload");
  for (const c of res.body.clips) assert.deepEqual(Object.keys(c).sort(), ["deleteUnfinished", "failureReason", "id", "recordedAt", "status", "uploadedByYou"]);
  for (const uid of [guardianId, other.id, (await coachA.auth.getUser()).data.user!.id]) {
    assert.ok(!res.text.includes(uid), "no uploader / user id in the payload");
  }
  assert.doesNotMatch(res.text, /uploaded_by/);
  // The other guardian sees the mirror image.
  const theirs = await callFn("get-family-report", other.client, { playerId: emily });
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const theirById = new Map<string, any>(theirs.body.clips.map((c: { id: string }) => [c.id, c]));
  assert.equal(theirById.get(otherClip)?.uploadedByYou, true);
  assert.equal(theirById.get(own.clipId)?.uploadedByYou, false);
  // A request-body user id is ignored.
  const spoof = await callFn("get-family-report", guardian, { playerId: emily, userId: other.id, viewerUserId: other.id });
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  assert.equal(spoof.body.clips.find((c: any) => c.id === otherClip)?.uploadedByYou, false);
});

test("get-player-report (share link) does not gain uploadedByYou or clips", async (t) => {
  // Always create a link with a coach who currently owns the team. Reusing an
  // arbitrary earlier token can legitimately select one whose creator was
  // revoked by the creator-access tests above.
  const token = randomUUID();
  const creator = (await coachA.auth.getUser()).data.user!.id;
  must(await admin.from("player_share_links").insert({ player_id: emily, token, created_by: creator }), "share link");
  const res = await callFn("get-player-report", null, { token });
  assert.equal(res.status, 200, res.text);
  assert.doesNotMatch(res.text, /uploadedByYou|"clips":\[\{"id"|"findings"/);
  assert.ok(!res.text.includes(emily), "the linked player's internal id must not be shared");
  t.diagnostic("share link payload checked");
});

test("someone else's clip mid-deletion is hidden from the family list and get-video-url refuses it", async () => {
  const entry = await rpc(guardian, "guardian_create_entry", { p_player_id: emily, p_kind: "game", p_date: "2026-09-12" });
  const slug = `fam-middel-${run}`;
  const clipSlug = opaqueTestSlug(entry, slug);
  const rawPath = `gs://${BUCKET}/${entry}/raw/${clipSlug}.mp4`;
  const clipId = await famClip(entry, slug, "ready", rawPath);
  await famRun(clipId);
  assert.equal((await callVideoUrl(guardian, clipId)).status, 200, "visible before deletion starts");
  const before = await callFn("get-family-report", guardian, { playerId: emily });
  assert.ok(before.body.clips.some((c: { id: string }) => c.id === clipId));

  // A deletion that finished steps 1-4 but not the storage/row steps.
  deletionClipIds.push(clipId);
  sql(
    `insert into public.clip_deletions (clip_id, player_slug, clip_slug, raw_gcs_path, requested_by, requested_by_role)
     values ('${clipId}', '${emilySlug}', '${clipSlug}', '${rawPath}', '${guardianId}', 'guardian')`,
  );
  const after = await callFn("get-family-report", guardian, { playerId: emily });
  assert.equal(after.status, 200, after.text);
  assert.ok(!after.body.clips.some((c: { id: string }) => c.id === clipId), "hidden from the family list");
  const v = await callVideoUrl(guardian, clipId);
  assert.ok(v.status === 403 || v.status === 404, `guardian refused, got ${v.status}`);
  assert.ok(!v.body?.url);
});

// ---------------------------------------------------------------------------
// Final review fix wave: a delete of the guardian's OWN upload that failed
// part-way stays visible (and retryable); the worker finishes stuck deletions.
// ---------------------------------------------------------------------------

/** A guardian-uploaded clip (service-role insert with the provenance guardian_register_clip writes) + its emulator object. */
async function ownStuckClip(slug: string, requestedAgo: string): Promise<{ clipId: string; object: string; gcsPath: string }> {
  const entry = await rpc(guardian, "guardian_create_entry", { p_player_id: emily, p_kind: "game", p_date: "2026-09-11" });
  const clipSlug = opaqueTestSlug(entry, slug);
  const object = `${entry}/raw/${clipSlug}.mp4`;
  const gcsPath = `gs://${BUCKET}/${object}`;
  await putObject(object);
  const clip = must(
    await admin.from("video_clips").insert({
      game_log_entry_id: entry, clip_slug: clipSlug, status: "ready", raw_gcs_path: gcsPath, position: 0,
      uploaded_by: guardianId, uploaded_by_role: "guardian",
    }).select("id").single(),
    `own clip ${slug}`,
  );
  deletionClipIds.push(clip.id);
  // begin_clip_deletion committed (audit row), then the storage/finish step failed.
  sql(
    `insert into public.clip_deletions (clip_id, player_slug, clip_slug, game_log_entry_id, raw_gcs_path, requested_by, requested_by_role, requested_at)
     values ('${clip.id}', '${emilySlug}', '${clipSlug}', '${entry}', '${gcsPath}', '${guardianId}', 'guardian', now() - interval '${requestedAgo}')`,
  );
  return { clipId: clip.id, object, gcsPath };
}

test("the guardian's own upload mid-deletion stays listed as deleteUnfinished (others don't see it) and a retry finishes it", async () => {
  const { clipId, object } = await ownStuckClip(`fam-ownstuck-${run}`, "1 minute");
  const mine = await callFn("get-family-report", guardian, { playerId: emily });
  assert.equal(mine.status, 200, mine.text);
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const row = mine.body.clips.find((c: any) => c.id === clipId);
  assert.ok(row, "own mid-deletion upload is listed");
  assert.equal(row.deleteUnfinished, true);
  assert.equal(row.uploadedByYou, true);
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  assert.ok(mine.body.clips.filter((c: any) => c.id !== clipId).every((c: any) => c.deleteUnfinished === false));
  // Another guardian of the same child never sees it (`limited` was unlinked by an earlier test).
  const other = await makeUser("stuck-other");
  await rpc(other.client, "accept_guardian_invite", {
    p_token: await rpc(coachA, "create_guardian_invite", { p_player_id: emily, p_relationship: "guardian" }),
    p_consent_version: CONSENT,
  });
  const theirs = await callFn("get-family-report", other.client, { playerId: emily });
  assert.equal(theirs.status, 200, theirs.text);
  assert.ok(!theirs.body.clips.some((c: { id: string }) => c.id === clipId), "hidden from everyone else");
  // Still not watchable while it's being deleted.
  assert.ok([403, 404].includes((await callVideoUrl(guardian, clipId)).status));

  // "Try again" = delete-clip again: every step is idempotent.
  const retry = await callDeleteClip(guardian, clipId);
  assert.equal(retry.status, 200, JSON.stringify(retry.body));
  assert.equal(await objectExists(object), false);
  assert.equal((await admin.from("video_clips").select("id").eq("id", clipId)).data!.length, 0);
  const after = await callFn("get-family-report", guardian, { playerId: emily });
  assert.ok(!after.body.clips.some((c: { id: string }) => c.id === clipId));
});

test("worker retry finishes deletions stuck over 15 minutes (real clip_deletions + finish_clip_deletion + emulator), leaves recent ones", async () => {
  const { supabaseRetryDb, retryUnfinishedDeletions } = await import("../../src/cli/purgeDeletedClips.js");
  const { deleteObjectIfExists } = await import("../../src/services/storage/gcs.js");
  const stale = await ownStuckClip(`fam-stale-${run}`, "20 minutes");
  const recent = await ownStuckClip(`fam-recent-${run}`, "2 minutes");
  // Only this run's rows (never finish someone's real local deletions from a test).
  const real = supabaseRetryDb(admin);
  const mineOnly = new Set([stale.clipId, recent.clipId]);
  const db = { ...real, staleUnfinished: async (before: Date) => (await real.staleUnfinished(before)).filter((r) => mineOnly.has(r.clip_id)) };

  assert.equal(await retryUnfinishedDeletions(db, deleteObjectIfExists, BUCKET), 1);
  assert.equal(await objectExists(stale.object), false, "stale: object deleted");
  assert.equal((await admin.from("video_clips").select("id").eq("id", stale.clipId)).data!.length, 0, "stale: clip row deleted");
  assert.equal(sql(`select gcs_deleted_at is not null from public.clip_deletions where clip_id = '${stale.clipId}'`), "t");
  assert.equal(await objectExists(recent.object), true, "recent: left for the user's own retry");
  assert.equal((await admin.from("video_clips").select("id").eq("id", recent.clipId)).data!.length, 1);
  assert.equal(sql(`select gcs_deleted_at is null from public.clip_deletions where clip_id = '${recent.clipId}'`), "t");

  // Idempotent: a second pass (and an already-absent object) is a no-op.
  assert.equal(await retryUnfinishedDeletions(db, deleteObjectIfExists, BUCKET), 0);
  // finish_clip_deletion itself tolerates a re-run on an already-finished deletion.
  await real.finishDeletion(stale.clipId);
});
