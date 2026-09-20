/**
 * Integration tests for the player-development schema (migrations 00025/00026):
 * pitches, clip links, priorities, observations, drill assignment, practice
 * grouping, RLS isolation between teams, the data-migration SQL, and AI-draft
 * preservation. Real local Supabase, no mocks - same standard as the other
 * *.test.ts files here. Requires `npx supabase start` and .env with
 * SUPABASE_URL / SUPABASE_ANON_KEY / SUPABASE_SERVICE_ROLE_KEY.
 *
 * Every test creates throwaway teams/coaches with a unique suffix and deletes
 * them in `after` (teams cascade to players -> entries -> pitches/priorities).
 */
import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import "dotenv/config";
import { getSupabaseClient } from "./supabaseClient.js";
import { analyzeAndSync } from "../../cli/analyze.js";

const suffix = `${Date.now()}`;
const password = "TestPass123!dev";
const svc = getSupabaseClient();

interface Coach { id: string; email: string; client: SupabaseClient }
let coachA: Coach;
let coachB: Coach;
let teamA: { id: string; slug: string };
let teamB: { id: string; slug: string };
let playerA: { id: string; slug: string };
let playerB: { id: string; slug: string };
let gameEntryA: string;
let practiceEntryA: string;
let gameEntryB: string;
const createdUserIds: string[] = [];
const createdTeamIds: string[] = [];

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function must(res: { data: any; error: { message: string } | null }, what: string): any {
  if (res.error) throw new Error(`${what}: ${res.error.message}`);
  return res.data;
}

async function makeCoach(label: string, teamId: string): Promise<Coach> {
  const email = `dev-${label}-${suffix}@test.local`;
  const created = await svc.auth.admin.createUser({ email, password, email_confirm: true });
  if (created.error || !created.data.user) throw new Error(`createUser: ${created.error?.message}`);
  createdUserIds.push(created.data.user.id);
  must(await svc.from("coach_team_access").insert({ coach_id: created.data.user.id, team_id: teamId, role: "coach" }), "grant access");
  const client = createClient(process.env.SUPABASE_URL!, process.env.SUPABASE_ANON_KEY!, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
  const signed = await client.auth.signInWithPassword({ email, password });
  if (signed.error) throw new Error(`sign in: ${signed.error.message}`);
  return { id: created.data.user.id, email, client };
}

async function makeTeam(label: string) {
  const team = must(
    await svc.from("teams").insert({ slug: `devtest-${label}-${suffix}`, name: `Dev ${label}` }).select("id, slug").single(),
    "team",
  );
  createdTeamIds.push(team.id as string);
  const player = must(
    await svc.from("players").insert({ team_id: team.id, slug: `dp-${label}-${suffix}`, name: `Player ${label}`, jersey_number: "7" }).select("id, slug").single(),
    "player",
  );
  return { team: team as { id: string; slug: string }, player: player as { id: string; slug: string } };
}

before(async () => {
  const a = await makeTeam("a");
  const b = await makeTeam("b");
  teamA = a.team; playerA = a.player; teamB = b.team; playerB = b.player;
  coachA = await makeCoach("a", teamA.id);
  coachB = await makeCoach("b", teamB.id);
  gameEntryA = (must(await svc.from("game_log_entries").insert({ player_id: playerA.id, date: "2026-09-19", opponent: "Rival", ab: 1, session_type: "game" }).select("id").single(), "entry") as { id: string }).id;
  practiceEntryA = (must(await svc.from("game_log_entries").insert({ player_id: playerA.id, date: "2026-09-16", opponent: null, ab: 1, session_type: "practice" }).select("id").single(), "practice entry") as { id: string }).id;
  gameEntryB = (must(await svc.from("game_log_entries").insert({ player_id: playerB.id, date: "2026-09-19", opponent: "Other", ab: 1, session_type: "game" }).select("id").single(), "entry b") as { id: string }).id;
});

after(async () => {
  if (createdTeamIds.length) await svc.from("teams").delete().in("id", createdTeamIds);
  for (const id of createdUserIds) await svc.auth.admin.deleteUser(id);
});

// ---------------------------------------------------------------------------
// Pitches
// ---------------------------------------------------------------------------

test("one at-bat supports many pitches; pitch numbers are unique per at-bat and ordered", async () => {
  const c = coachA.client;
  // insert out of order on purpose
  for (const n of [3, 1, 2]) {
    must(await c.from("at_bat_pitches").insert({ game_log_entry_id: gameEntryA, pitch_number: n, pitch_outcome: n === 2 ? "foul" : "ball" }), `pitch ${n}`);
  }
  const rows = must(await c.from("at_bat_pitches").select("pitch_number").eq("game_log_entry_id", gameEntryA).order("pitch_number"), "list");
  assert.deepEqual((rows as { pitch_number: number }[]).map((r) => r.pitch_number), [1, 2, 3]);
  const dup = await c.from("at_bat_pitches").insert({ game_log_entry_id: gameEntryA, pitch_number: 2 });
  assert.ok(dup.error, "duplicate pitch_number must be rejected");
  const bad = await c.from("at_bat_pitches").insert({ game_log_entry_id: gameEntryA, pitch_number: 0 });
  assert.ok(bad.error, "pitch_number must be positive");
  const badCount = await c.from("at_bat_pitches").insert({ game_log_entry_id: gameEntryA, pitch_number: 9, count_before_strikes: 3 });
  assert.ok(badCount.error, "a count with 3 strikes before the pitch is invalid");
});

test("each pitch supports its own clip; a clip cannot point at another at-bat's pitch or at both a pitch and a rep", async () => {
  const p1 = must(await svc.from("at_bat_pitches").select("id").eq("game_log_entry_id", gameEntryA).eq("pitch_number", 1).single(), "p1") as { id: string };
  const p2 = must(await svc.from("at_bat_pitches").select("id").eq("game_log_entry_id", gameEntryA).eq("pitch_number", 2).single(), "p2") as { id: string };
  const c1 = must(await coachA.client.from("video_clips").insert({ game_log_entry_id: gameEntryA, clip_slug: `t-c1-${suffix}`, status: "ready", at_bat_pitch_id: p1.id }).select("id").single(), "c1") as { id: string };
  must(await coachA.client.from("video_clips").insert({ game_log_entry_id: gameEntryA, clip_slug: `t-c2-${suffix}`, status: "ready", at_bat_pitch_id: p2.id }), "c2");
  // a second clip on the same pitch is allowed (pitch -> video_clips[])
  must(await coachA.client.from("video_clips").insert({ game_log_entry_id: gameEntryA, clip_slug: `t-c1b-${suffix}`, status: "ready", at_bat_pitch_id: p1.id }), "second clip on pitch");
  const onPitch = must(await coachA.client.from("video_clips").select("id").eq("at_bat_pitch_id", p1.id), "clips of pitch") as unknown[];
  assert.equal(onPitch.length, 2);

  // other at-bat's pitch
  const otherPitch = must(await svc.from("at_bat_pitches").insert({ game_log_entry_id: gameEntryB, pitch_number: 1 }).select("id").single(), "b pitch") as { id: string };
  const crossed = await svc.from("video_clips").insert({ game_log_entry_id: gameEntryA, clip_slug: `t-bad-${suffix}`, status: "ready", at_bat_pitch_id: otherPitch.id });
  assert.ok(crossed.error && /different at-bat/.test(crossed.error.message), `expected cross-at-bat rejection, got ${crossed.error?.message}`);

  // migration 00027 creates the session + rep for a practice entry automatically
  const repRow = must(await svc.from("practice_repetitions").select("id").eq("game_log_entry_id", practiceEntryA).single(), "rep") as { id: string };
  const both = await svc.from("video_clips").insert({ game_log_entry_id: gameEntryA, clip_slug: `t-both-${suffix}`, status: "ready", at_bat_pitch_id: p1.id, practice_repetition_id: repRow.id });
  assert.ok(both.error, "a clip is evidence for a pitch OR a practice rep, not both");
  assert.ok(c1.id);
});

// ---------------------------------------------------------------------------
// Priorities, observations, drills
// ---------------------------------------------------------------------------

test("priority creation derives team_id, rejects a mismatched team, and records status history", async () => {
  const c = coachA.client;
  const created = must(await c.from("player_priorities").insert({ player_id: playerA.id, title: "Front-side stability", category: "front-side-stability" }).select("*").single(), "create") as Record<string, unknown>;
  assert.equal(created.team_id, teamA.id);
  assert.equal(created.status, "active");
  const mismatch = await c.from("player_priorities").insert({ player_id: playerA.id, team_id: teamB.id, title: "x" });
  assert.ok(mismatch.error, "team_id must match the player's real team");

  const id = created.id as string;
  must(await c.from("player_priorities").update({ status: "monitoring" }).eq("id", id), "to monitoring");
  const resolved = must(await c.from("player_priorities").update({ status: "resolved" }).eq("id", id).select("resolved_at").single(), "resolve") as { resolved_at: string | null };
  assert.ok(resolved.resolved_at, "resolved_at is stamped when resolved");
  const reopened = must(await c.from("player_priorities").update({ status: "active" }).eq("id", id).select("resolved_at").single(), "reopen") as { resolved_at: string | null };
  assert.equal(reopened.resolved_at, null, "reopening clears resolved_at");
  const hist = must(await c.from("player_priority_status_history").select("from_status, to_status").eq("player_priority_id", id).order("changed_at"), "history") as { from_status: string | null; to_status: string }[];
  assert.deepEqual(hist.map((h) => `${h.from_status}>${h.to_status}`), ["null>active", "active>monitoring", "monitoring>resolved", "resolved>active"]);
  const badStatus = await c.from("player_priorities").update({ status: "fixed" }).eq("id", id);
  assert.ok(badStatus.error, "invalid status is rejected");
});

test("observations link to evidence, derive game/practice context, and update last_observed_at", async () => {
  const c = coachA.client;
  const pr = must(await c.from("player_priorities").insert({ player_id: playerA.id, title: "Hand path" }).select("id").single(), "priority") as { id: string };
  const pitch = must(await svc.from("at_bat_pitches").select("id").eq("game_log_entry_id", gameEntryA).eq("pitch_number", 1).single(), "pitch") as { id: string };
  const clip = must(await svc.from("video_clips").select("id").eq("at_bat_pitch_id", pitch.id).limit(1).single(), "clip") as { id: string };
  const rep = must(await svc.from("practice_repetitions").select("id").eq("game_log_entry_id", practiceEntryA).single(), "rep") as { id: string };

  const g = must(await c.from("player_priority_observations").insert({ player_priority_id: pr.id, at_bat_pitch_id: pitch.id, video_clip_id: clip.id, status: "improving", coach_note: "cleaner" }).select("context").single(), "game obs") as { context: string };
  assert.equal(g.context, "game");
  const p = must(await c.from("player_priority_observations").insert({ player_priority_id: pr.id, practice_repetition_id: rep.id, status: "unchanged" }).select("context").single(), "practice obs") as { context: string };
  assert.equal(p.context, "practice");
  const bad = await c.from("player_priority_observations").insert({ player_priority_id: pr.id, status: "fixed" });
  assert.ok(bad.error, "observation status is a closed set");
  const after = must(await c.from("player_priorities").select("last_observed_at").eq("id", pr.id).single(), "last observed") as { last_observed_at: string | null };
  assert.ok(after.last_observed_at);
});

test("drill assignment: global library readable, assignment unique per priority, team drills are team-scoped", async () => {
  const c = coachA.client;
  const lib = must(await c.from("drill_library").select("id, slug, team_id").is("team_id", null), "library") as { id: string; slug: string }[];
  assert.ok(lib.length >= 5, "curated global library is seeded");
  const pr = must(await c.from("player_priorities").insert({ player_id: playerA.id, title: "Stride" }).select("id").single(), "priority") as { id: string };
  must(await c.from("player_priority_drills").insert({ player_priority_id: pr.id, drill_id: lib[0]!.id }), "assign");
  const dup = await c.from("player_priority_drills").insert({ player_priority_id: pr.id, drill_id: lib[0]!.id });
  assert.ok(dup.error, "same drill can't be assigned twice");

  // Coaches can't edit the global library, but can add team-owned drills.
  const editGlobal = await c.from("drill_library").update({ name: "hacked" }).eq("id", lib[0]!.id).select();
  assert.equal((editGlobal.data ?? []).length, 0, "global drill is not writable by coaches");
  const teamDrill = must(await c.from("drill_library").insert({ team_id: teamA.id, slug: `mine-${suffix}`, name: "Mine", target_tags: ["hand-path"] }).select("id").single(), "team drill") as { id: string };
  const seenByB = must(await coachB.client.from("drill_library").select("id").eq("id", teamDrill.id), "b sees") as unknown[];
  assert.equal(seenByB.length, 0, "another team's custom drill is invisible");
});

// ---------------------------------------------------------------------------
// Practice
// ---------------------------------------------------------------------------

test("practice sessions group reps as baseline/drill/post_drill and enforce ownership", async () => {
  const c = coachA.client;
  const sess = must(await c.from("practice_sessions").select("id").eq("player_id", playerA.id).eq("session_date", "2026-09-16").single(), "session") as { id: string };
  // extra reps need their own backing practice entries
  // (each new practice entry gets its rep automatically - migration 00027 - so just tag it)
  for (const [n, grouping] of [[2, "drill"], [3, "post_drill"]] as const) {
    must(await c.from("game_log_entries").insert({ player_id: playerA.id, date: "2026-09-16", opponent: null, ab: n, session_type: "practice" }), `entry ${n}`);
    must(await c.from("practice_repetitions").update({ grouping }).eq("practice_session_id", sess.id).eq("rep_number", n), `rep ${n}`);
  }
  must(await c.from("practice_repetitions").update({ grouping: "baseline" }).eq("practice_session_id", sess.id).eq("rep_number", 1), "baseline");
  const reps = must(await c.from("practice_repetitions").select("rep_number, grouping").eq("practice_session_id", sess.id).order("rep_number"), "reps") as { rep_number: number; grouping: string }[];
  assert.deepEqual(reps.map((r) => r.grouping), ["baseline", "drill", "post_drill"]);
  assert.ok((await c.from("practice_repetitions").update({ grouping: "warmup" }).eq("practice_session_id", sess.id)).error, "grouping is a closed set");

  const dupRep = await c.from("practice_repetitions").insert({ practice_session_id: sess.id, game_log_entry_id: gameEntryA, rep_number: 2 });
  assert.ok(dupRep.error, "rep numbers are unique per session (and entry must be that player's)");
  // the session's coach outcome is set by the coach
  must(await c.from("practice_sessions").update({ outcome: "mixed", outcome_note: "better after drill" }).eq("id", sess.id), "outcome");
  assert.ok((await c.from("practice_sessions").update({ outcome: "amazing" }).eq("id", sess.id)).error);
});

// ---------------------------------------------------------------------------
// RLS: a coach must not reach another team's development history by UUID
// ---------------------------------------------------------------------------

test("RLS: coach B cannot read, write or delete team A's pitches, priorities, observations, drills, sessions or history", async () => {
  const b = coachB.client;
  const pitch = must(await svc.from("at_bat_pitches").select("id").eq("game_log_entry_id", gameEntryA).limit(1).single(), "pitch") as { id: string };
  const aPriorities = must(await svc.from("player_priorities").select("id").eq("player_id", playerA.id), "priorities") as { id: string }[];
  const aIds = aPriorities.map((p) => p.id);
  const obs = must(await svc.from("player_priority_observations").select("id, player_priority_id").in("player_priority_id", aIds).limit(1).single(), "obs") as { id: string; player_priority_id: string };
  const pr = { id: obs.player_priority_id };
  const asg = must(await svc.from("player_priority_drills").select("id, drill_id").in("player_priority_id", aIds).limit(50), "asg") as { id: string; drill_id: string }[];
  const sess = must(await svc.from("practice_sessions").select("id").eq("player_id", playerA.id).limit(1).single(), "sess") as { id: string };
  const rep = must(await svc.from("practice_repetitions").select("id").eq("practice_session_id", sess.id).limit(1).single(), "rep") as { id: string };
  const hist = must(await svc.from("player_priority_status_history").select("id").eq("player_priority_id", pr.id).limit(1).single(), "hist") as { id: string };

  const tables: [string, string][] = [
    ["at_bat_pitches", pitch.id], ["player_priorities", pr.id], ["player_priority_observations", obs.id],
    ["practice_sessions", sess.id], ["practice_repetitions", rep.id], ["player_priority_status_history", hist.id],
  ];
  if (asg.length) tables.push(["player_priority_drills", asg[0]!.id]);
  for (const [table, id] of tables) {
    const read = must(await b.from(table).select("id").eq("id", id), `b read ${table}`) as unknown[];
    assert.equal(read.length, 0, `${table}: B must not read A's row`);
    const upd = await b.from(table).update({ created_at: new Date().toISOString() }).eq("id", id).select();
    assert.equal((upd.data ?? []).length, 0, `${table}: B must not update A's row`);
    const del = await b.from(table).delete().eq("id", id).select();
    assert.equal((del.data ?? []).length, 0, `${table}: B must not delete A's row`);
  }
  // inserts into A's data are rejected
  assert.ok((await b.from("at_bat_pitches").insert({ game_log_entry_id: gameEntryA, pitch_number: 40 })).error, "B can't add pitches to A's at-bat");
  assert.ok((await b.from("player_priorities").insert({ player_id: playerA.id, title: "sneaky" })).error, "B can't create priorities for A's player");
  assert.ok((await b.from("player_priority_observations").insert({ player_priority_id: pr.id, status: "improving" })).error, "B can't observe A's priorities");
  assert.ok((await b.from("player_priority_drills").insert({ player_priority_id: pr.id, drill_id: asg[0]?.drill_id ?? (must(await svc.from("drill_library").select("id").is("team_id", null).limit(1).single(), "d") as { id: string }).id })).error, "B can't assign drills on A's priorities");
  assert.ok((await b.from("practice_sessions").insert({ player_id: playerA.id, session_date: "2026-01-01" })).error, "B can't create A's practice sessions");
  // and a coach's own data is still fully visible to them
  assert.ok((must(await coachA.client.from("player_priorities").select("id").eq("player_id", playerA.id), "a own") as unknown[]).length > 0);
});

// ---------------------------------------------------------------------------
// Data migration SQL (00025's "Data migration" section) against fixtures
// ---------------------------------------------------------------------------

test("existing clips are migrated onto pitches / practice reps without losing anything", async (t) => {
  let psql = "psql";
  try { execFileSync(psql, ["--version"], { stdio: "ignore" }); } catch { t.skip("psql not on PATH"); return; }
  const sql = fs.readFileSync(path.resolve("supabase/migrations/00025_player_development_model.sql"), "utf-8");
  const marker = "-- Data migration:";
  const section = sql.slice(sql.indexOf(marker));
  assert.ok(section.length > marker.length, "migration data section found");

  const s = `mig${suffix}`;
  const script = `
begin;
-- simulate pre-00025 data: the legacy-flow triggers (00027) must not auto-link these fixtures
alter table video_clips disable trigger video_clips_default_link;
alter table game_log_entries disable trigger game_log_entries_practice_rep;
insert into teams (slug, name) values ('${s}', 'Mig');
insert into players (team_id, slug, name, jersey_number) select id, 'p-${s}', 'P', '1' from teams where slug = '${s}';
-- game at-bat with 2 clips (legacy tabs Pitch 1/2 by position), one with legacy pitch metadata
insert into game_log_entries (player_id, date, opponent, ab, pitch, pitch_zone, pitch_outcome, result, session_type)
  select id, '2026-08-01', 'X', 1, 'Outside, low', 7, 'foul', 'Foul out', 'game' from players where slug = 'p-${s}';
insert into game_log_entries (player_id, date, opponent, ab, session_type)
  select id, '2026-08-01', 'X', 2, 'game' from players where slug = 'p-${s}';
insert into video_clips (game_log_entry_id, clip_slug, position, status)
  select id, 'g-b', 1, 'ready' from game_log_entries where ab = 1 and opponent = 'X' and player_id = (select id from players where slug='p-${s}');
insert into video_clips (game_log_entry_id, clip_slug, position, status)
  select id, 'g-a', 0, 'ready' from game_log_entries where ab = 1 and opponent = 'X' and player_id = (select id from players where slug='p-${s}');
-- practice: two entries same day -> one session, two reps
insert into game_log_entries (player_id, date, ab, session_type, session_note)
  select id, '2026-08-02', 1, 'practice', 'tee work' from players where slug = 'p-${s}';
insert into game_log_entries (player_id, date, ab, session_type)
  select id, '2026-08-02', 2, 'practice' from players where slug = 'p-${s}';
insert into video_clips (game_log_entry_id, clip_slug, position, status)
  select g.id, 'pr-1', 0, 'ready' from game_log_entries g where g.session_type = 'practice' and g.ab = 1 and g.player_id = (select id from players where slug='p-${s}');
${section}
select 'pitches=' || count(*) from at_bat_pitches p join game_log_entries g on g.id = p.game_log_entry_id join players pl on pl.id = g.player_id where pl.slug = 'p-${s}';
select 'clip ' || vc.clip_slug || ' -> pitch ' || p.pitch_number from video_clips vc join at_bat_pitches p on p.id = vc.at_bat_pitch_id join game_log_entries g on g.id = vc.game_log_entry_id join players pl on pl.id = g.player_id where pl.slug = 'p-${s}' order by vc.clip_slug;
select 'meta last pitch: ' || coalesce(p.pitch_location,'-') || '/' || coalesce(p.pitch_zone::text,'-') || '/' || coalesce(p.pitch_outcome,'-') || '/' || coalesce(p.swung::text,'-') from at_bat_pitches p join game_log_entries g on g.id = p.game_log_entry_id join players pl on pl.id = g.player_id where pl.slug = 'p-${s}' and p.pitch_number = 2;
select 'meta first pitch: ' || coalesce(p.pitch_location,'-') || '/' || coalesce(p.pitch_outcome,'-') from at_bat_pitches p join game_log_entries g on g.id = p.game_log_entry_id join players pl on pl.id = g.player_id where pl.slug = 'p-${s}' and p.pitch_number = 1;
select 'noclip entry pitches=' || count(*) from at_bat_pitches p join game_log_entries g on g.id = p.game_log_entry_id join players pl on pl.id = g.player_id where pl.slug = 'p-${s}' and g.ab = 2 and g.session_type = 'game';
select 'sessions=' || count(*) from practice_sessions ps join players pl on pl.id = ps.player_id where pl.slug = 'p-${s}';
select 'reps=' || count(*) from practice_repetitions r join practice_sessions ps on ps.id = r.practice_session_id join players pl on pl.id = ps.player_id where pl.slug = 'p-${s}';
select 'practice clip on rep=' || count(*) from video_clips vc join practice_repetitions r on r.id = vc.practice_repetition_id where vc.clip_slug = 'pr-1';
rollback;`;
  const out = execFileSync(psql, ["-h", "127.0.0.1", "-p", "54322", "-U", "postgres", "-d", "postgres", "-v", "ON_ERROR_STOP=1", "-At"], {
    input: script,
    env: { ...process.env, PGPASSWORD: "postgres" },
    encoding: "utf-8",
  });
  assert.match(out, /pitches=2/, "one pitch per legacy clip, none for the clipless at-bat");
  assert.match(out, /clip g-a -> pitch 1/, "lower position becomes pitch 1");
  assert.match(out, /clip g-b -> pitch 2/);
  assert.match(out, /meta last pitch: Outside, low\/7\/foul\/true/, "legacy pitch metadata lands on the last pitch");
  assert.match(out, /meta first pitch: -\/-/, "earlier pitches get no invented metadata");
  assert.match(out, /noclip entry pitches=0/);
  assert.match(out, /sessions=1/, "same-day practice rows collapse into one session");
  assert.match(out, /reps=2/);
  assert.match(out, /practice clip on rep=1/);
  const left = must(await svc.from("teams").select("id").eq("slug", s), "rolled back") as unknown[];
  assert.equal(left.length, 0, "fixture transaction was rolled back");
});

// ---------------------------------------------------------------------------
// AI-draft approval preservation (analyze.ts re-run)
// ---------------------------------------------------------------------------

test("re-running AI analysis replaces unreviewed drafts but never a coach-reviewed issue", async () => {
  const draft = {
    noActionNeeded: false,
    noActionReason: null,
    checklist: [],
    issues: [{
      issue: "AI: front side opens early", seenInAtBats: "AB1", likelyCause: "c", effect: "e",
      evidence: "visible in the original video", coachingCue: "stay closed", lookForNext: "front side at plant",
      confidence: "low", concept: "front_side_stability", basis: "video", contextExplainsIt: false,
      emergencySwingSuspected: false, knowledgeClaimIds: [], suggestPriority: false,
    }],
    comps: [], compNotes: [], drills: [],
  };
  const file = path.join(os.tmpdir(), `ai-draft-${suffix}.json`);
  fs.writeFileSync(file, JSON.stringify(draft));
  try {
    await analyzeAndSync(teamA.slug, playerA.slug, "", "", false, file, false);
    let issues = must(await svc.from("issues").select("id, review_status, reviewed_by").eq("player_id", playerA.id), "issues") as { id: string; review_status: string; reviewed_by: string | null }[];
    assert.equal(issues.length, 1);
    assert.equal(issues[0]!.review_status, "draft");

    // Coach approves it; a later AI run must leave it alone and must not duplicate it.
    must(await coachA.client.from("issues").update({ review_status: "approved", reviewed_by: "Coach A" }).eq("id", issues[0]!.id), "approve");
    await analyzeAndSync(teamA.slug, playerA.slug, "", "", false, file, false);
    issues = must(await svc.from("issues").select("id, review_status, reviewed_by").eq("player_id", playerA.id), "issues 2") as typeof issues;
    assert.equal(issues.length, 1, "approved issue survives and is not duplicated by an identical AI finding");
    assert.equal(issues[0]!.review_status, "approved");
    assert.equal(issues[0]!.reviewed_by, "Coach A");

    // A different finding is a fresh draft; the coach rejects it; the AI must not resurrect it.
    const file2 = path.join(os.tmpdir(), `ai-draft2-${suffix}.json`);
    fs.writeFileSync(file2, JSON.stringify({ ...draft, issues: [{
      issue: "AI: hands drop", seenInAtBats: "AB1", likelyCause: "c", effect: "e", evidence: "frame 3",
      coachingCue: "stay on top", lookForNext: "hands at load", confidence: "low", concept: "hand_path",
      basis: "video", contextExplainsIt: false, emergencySwingSuspected: false, knowledgeClaimIds: [], suggestPriority: false,
    }] }));
    try {
      await analyzeAndSync(teamA.slug, playerA.slug, "", "", false, file2, false);
      issues = must(await svc.from("issues").select("id, issue, review_status, evidence, confidence, coaching_cue").eq("player_id", playerA.id), "issues 3") as typeof issues;
      const fresh = (issues as unknown as { issue: string; review_status: string; evidence: string; confidence: string; coaching_cue: string }[]).find((i) => i.issue === "AI: hands drop")!;
      assert.equal(fresh.review_status, "draft");
      assert.equal(fresh.evidence, "frame 3", "structured coaching fields are stored");
      assert.equal(fresh.confidence, "low");
      assert.equal(fresh.coaching_cue, "stay on top");
      must(await coachA.client.from("issues").update({ review_status: "rejected", reviewed_by: "Coach A" }).eq("issue", "AI: hands drop").eq("player_id", playerA.id), "reject");
      await analyzeAndSync(teamA.slug, playerA.slug, "", "", false, file2, false);
      const final = must(await svc.from("issues").select("issue, review_status").eq("player_id", playerA.id), "issues 4") as { issue: string; review_status: string }[];
      assert.equal(final.length, 2, "rejected decision preserved and not resurrected as a new draft");
      assert.equal(final.find((i) => i.issue === "AI: hands drop")!.review_status, "rejected");
      assert.equal(final.find((i) => i.issue === "AI: front side opens early")!.review_status, "approved");
    } finally {
      fs.rmSync(file2, { force: true });
    }
  } finally {
    fs.rmSync(file, { force: true });
  }
});
