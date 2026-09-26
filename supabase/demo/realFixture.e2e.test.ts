/**
 * End-to-end LOCAL verification of the real-data demo promotion pipeline
 * (docs/research/demo-real-data-promotion.md):
 *
 *   synthetic "processed + coach-reviewed" player in local public.*
 *     -> loadSourceSnapshot + buildFixture (the exporter's own code)
 *     -> transcodeClip on a generated test video (with planted GPS metadata)
 *     -> demo.load_real_fixture (DB-side canonical clone verification)
 *     -> a demo visitor's start_demo_session clone
 *     -> the real frontend's exact PostgREST query shapes for Team / Player /
 *        At-Bat / Review / Development / Practice / Compare / Report
 *     -> isolation between visitors, reset, deactivation
 *
 * The source player is synthetic on purpose (this is a committed test; no
 * real athlete data belongs in git). Everything it creates is removed in
 * after(), including the loaded fixture.
 *
 * Visitor sessions: a true anonymous sign-in when the local stack allows it
 * (enable_anonymous_sign_ins - see demo.test.ts's header for the toggle),
 * otherwise a throwaway password user. The demo RPCs/RLS key only on
 * auth.uid(), so the clone path exercised is identical; the run prints which
 * mode it used.
 *
 * Run: npx supabase start && node --import tsx --test supabase/demo/realFixture.e2e.test.ts
 *      (or: npm run test:demo-real-fixture)
 */
import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import "dotenv/config";
import { buildFixture, type BuildResult } from "../../src/services/demoExport/buildFixture.js";
import type { CurationManifest } from "../../src/services/demoExport/curationManifest.js";
import { probe, transcodeClip } from "../../src/services/demoExport/media.js";
import { loadSourceSnapshot } from "../../src/services/demoExport/sourceLoader.js";
import { FIXTURE_TABLE_ORDER } from "../../src/services/demoExport/translation.js";
import { hasErrors } from "../../src/services/demoExport/validate.js";
import { shapePlayerReport } from "../functions/get-player-report/shape.js";

const URL_ = process.env.SUPABASE_URL!;
const ANON = process.env.SUPABASE_ANON_KEY!;
const SERVICE = process.env.SUPABASE_SERVICE_ROLE_KEY!;
if (!/127\.0\.0\.1|localhost/.test(URL_ ?? "")) throw new Error("realFixture.e2e.test.ts only runs against the LOCAL stack");

const noSession = { auth: { persistSession: false, autoRefreshToken: false } };
const svc = createClient(URL_, SERVICE, noSession);
const svcDemo = svc.schema("demo");
const stamp = Date.now().toString(36);
const TEAM_SLUG = `e2e-export-${stamp}`;
const FIXTURE_ID = `e2e-real-${stamp}`;
const PUBLIC_SLUG = "e2e-real-player";
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "hl-real-fixture-e2e-"));
const createdUsers: string[] = [];
const src: Record<string, string> = {};
let result: BuildResult;
let visitorMode = "";
let previousCanonical: { mode: string; fixture_id: string | null; fixture_version: string | null } | null = null;
const VERSION = "e2e.1";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function must<T = any>(res: { data: T; error: { message: string } | null }, what: string): T {
  if (res.error) throw new Error(`${what}: ${res.error.message}`);
  return res.data;
}
async function ins(table: string, row: Record<string, unknown>, key: string): Promise<string> {
  const data = must(await svc.from(table).insert(row).select("id").single(), `insert ${table} (${key})`) as { id: string };
  src[key] = data.id;
  return data.id;
}

async function newVisitor(): Promise<{ c: SupabaseClient; teamId: string; userId: string }> {
  const c = createClient(URL_, ANON, { ...noSession, db: { schema: "demo" } });
  const anon = await c.auth.signInAnonymously();
  if (anon.error) {
    visitorMode = "password user (anonymous sign-ins disabled on this local stack)";
    const email = `demo-e2e-${stamp}-${createdUsers.length}@test.local`;
    const created = await svc.auth.admin.createUser({ email, password: "E2e-demo-Pass-123", email_confirm: true });
    if (created.error || !created.data.user) throw new Error(`createUser: ${created.error?.message}`);
    createdUsers.push(created.data.user.id);
    const signed = await c.auth.signInWithPassword({ email, password: "E2e-demo-Pass-123" });
    if (signed.error) throw new Error(`signIn: ${signed.error.message}`);
  } else {
    visitorMode = "anonymous sign-in";
    createdUsers.push(anon.data.user!.id);
  }
  const started = must(await c.rpc("start_demo_session"), "start_demo_session") as Array<{ team_id: string }>;
  const userId = (await c.auth.getUser()).data.user!.id;
  return { c, teamId: started[0]!.team_id, userId };
}

async function realPlayerId(c: SupabaseClient, teamId: string): Promise<string> {
  const rows = must(await c.from("players").select("id").eq("team_id", teamId).eq("slug", PUBLIC_SLUG), "real player") as Array<{ id: string }>;
  assert.equal(rows.length, 1, "the promoted real player must be cloned into the visitor's team exactly once");
  return rows[0]!.id;
}

before(async () => {
  // Whatever is published on this local stack (e.g. a real local-validation
  // fixture) is restored in after().
  previousCanonical = must(await svcDemo.from("demo_canonical").select("mode, fixture_id, fixture_version").single(), "canonical") as typeof previousCanonical;
  // --- a coach identity (needed for share-link created_by, like production) ---
  const coach = await svc.auth.admin.createUser({ email: `coach-e2e-${stamp}@test.local`, password: "E2e-coach-Pass-123", email_confirm: true });
  if (coach.error || !coach.data.user) throw new Error(`coach: ${coach.error?.message}`);
  createdUsers.push(coach.data.user.id);
  const coachId = coach.data.user.id;

  // --- synthetic processed + reviewed source player in local public.* -------
  const teamId = await ins("teams", { slug: TEAM_SLUG, name: "E2E Export Team", sport: "softball", level_label: "10U" }, "team");
  const playerId = await ins("players", { team_id: teamId, slug: "e2e-player", name: "E2E Source Real Name", jersey_number: "8", bats: "R", throws: "R", age_band: "8-10" }, "player");
  const phaseTypes = new Map((must(await svc.from("swing_phase_types").select("id, slug"), "phase types") as Array<{ id: string; slug: string }>).map((p) => [p.slug, p.id]));
  const checkpoints = new Map((must(await svc.from("checkpoints").select("id, slug"), "checkpoints") as Array<{ id: string; slug: string }>).map((p) => [p.slug, p.id]));
  const globalDrill = (must(await svc.from("drill_library").select("id").is("team_id", null).eq("slug", "split-stance-tee").single(), "drill") as { id: string }).id;

  const g1 = await ins("game_log_entries", { player_id: playerId, date: "2026-07-12", opponent: "Eagles", ab: 1, result: "Line drive single", session_type: "game", position: 0 }, "g1");
  const g2 = await ins("game_log_entries", { player_id: playerId, date: "2026-07-19", opponent: "Hawks", ab: 1, result: "Double to the gap", session_type: "game", position: 1 }, "g2");
  const p1 = await ins("game_log_entries", { player_id: playerId, date: "2026-07-15", opponent: null, ab: 1, session_type: "practice" }, "p1");
  const p2 = await ins("game_log_entries", { player_id: playerId, date: "2026-07-15", opponent: null, ab: 2, session_type: "practice" }, "p2");
  await ins("at_bat_pitches", { game_log_entry_id: g1, pitch_number: 1, count_before_balls: 0, count_before_strikes: 0, pitch_type: "fastball", pitch_location: "Away", pitch_zone: 6, pitch_outcome: "ball", swung: false }, "g1p1");
  const g1p2 = await ins("at_bat_pitches", { game_log_entry_id: g1, pitch_number: 2, count_before_balls: 1, count_before_strikes: 0, pitch_type: "fastball", pitch_location: "Middle", pitch_zone: 5, pitch_outcome: "ball_in_play", swung: true }, "g1p2");
  const g2p1 = await ins("at_bat_pitches", { game_log_entry_id: g2, pitch_number: 1, count_before_balls: 0, count_before_strikes: 0, pitch_type: "changeup", pitch_location: "Low", pitch_zone: 8, pitch_outcome: "ball_in_play", swung: true }, "g2p1");
  // Production's ensure_practice_rep_for_entry() trigger (00027) already
  // created the session + reps for p1/p2; the coach then fills them in.
  const s1 = (must(await svc.from("practice_sessions").update({ session_goal: "Front side control", assigned_drill_id: globalDrill, outcome: "mixed", outcome_note: "Better by the end", notes: "10 + 10" }).eq("player_id", playerId).eq("session_date", "2026-07-15").select("id").single(), "session") as { id: string }).id;
  src.s1 = s1;
  const r1 = (must(await svc.from("practice_repetitions").update({ grouping: "baseline", notes: "before" }).eq("game_log_entry_id", p1).select("id").single(), "rep1") as { id: string }).id;
  const r2 = (must(await svc.from("practice_repetitions").update({ grouping: "post_drill", notes: "after" }).eq("game_log_entry_id", p2).select("id").single(), "rep2") as { id: string }).id;
  src.r1 = r1;
  src.r2 = r2;
  const clip = (entry: string, slug: string, extra: Record<string, unknown>) =>
    ins("video_clips", { game_log_entry_id: entry, clip_slug: slug, fps: 30, n_frames: 360, duration_s: 12, status: "ready", raw_gcs_path: `gs://softball-scouting-media/${TEAM_SLUG}/e2e-player/raw/${slug}.mp4`, ...extra }, slug);
  const c1 = await clip(g1, "c1", { at_bat_pitch_id: g1p2 });
  const c2 = await clip(g2, "c2", { at_bat_pitch_id: g2p1 });
  const c3 = await clip(p1, "c3", { practice_repetition_id: r1 });
  const c4 = await clip(p2, "c4", { practice_repetition_id: r2 });
  const c5 = await clip(g1, "c5", { position: 1 });
  const blob = "\\x" + "0000803f".repeat(17 * 3 * 3);
  for (const [k, id] of Object.entries({ c1, c2, c3, c4, c5 })) {
    for (const [slug, t] of [["load", 3.2], ["contact", 5.9]] as const) {
      await ins("swing_phases", { video_clip_id: id, phase_type_id: phaseTypes.get(slug), frame: Math.round(t * 30), time_s: t, method: "metrics.py", confidence: "high", detail: { source: "pose3d" }, reconstruction_reliable: true }, `ph-${k}-${slug}`);
    }
    await ins("video_clip_metrics", { video_clip_id: id, max_bat_speed_value: 41.2, max_bat_speed_unit: "mph", attack_angle_at_contact_deg: 8.5, hip_shoulder_separation_at_contact_deg: 21, lead_side: "l", movement_flags: { early_open: k === "c3" }, analysis_quality: { overall: "good", pose_coverage: 0.93 } }, `m-${k}`);
    await ins("video_clip_pose3d", { video_clip_id: id, joint_order: "h36m17", joint_names: Array.from({ length: 17 }, (_, i) => `j${i}`), smoothing_method: "one_euro+rigid", frames: [0, 1, 2].map((f) => ({ frame: f, time_s: f / 30, tracked: true, angles: {} })), lead_side: "l", joints_blob: blob }, `pose-${k}`);
  }
  // analysis_runs.knowledge_version is an FK into methodology_versions - reuse
  // an existing published label (read-only; this test never writes methodology).
  const knowledgeVersion = (must(await svc.from("methodology_versions").select("version_label").order("version_label").limit(1).single(), "methodology version") as { version_label: string }).version_label;
  const run = await ins("analysis_runs", { video_clip_id: c1, player_id: playerId, backend: "gemini", ai_model: "gemini-2.5-pro", prompt_version: "swing-v7", analysis_policy_version: "policy-3", knowledge_version: knowledgeVersion, pipeline_version: "pose3d-1.4", input_manifest: { swing_evidence: { frames: ["load.jpg", "contact.jpg"] } } }, "run");
  const issue = (key: string, extra: Record<string, unknown>) => ins("issues", {
    player_id: playerId, issue: `${key} finding`, seen_in_at_bats: "AB1 vs Eagles", likely_cause: "cause", effect: "effect", evidence: "evidence", coaching_cue: "cue",
    look_for_next: "next", confidence: "medium", phase: "contact", source: "gemini", analysis_run_id: run, reviewed_by: "Real Coach Name", review_status: "approved",
    video_clip_id: c1, suggested_priority_title: "Keep the front side closed", ...extra,
  }, key);
  const approved = await issue("i-approved", {});
  await issue("i-edited", { review_status: "edited", video_clip_id: c2, ai_original: { issue: "original AI wording" } });
  await issue("i-draft", { review_status: "draft", reviewed_by: null });
  await issue("i-rejected", { review_status: "rejected", video_clip_id: c3, rejection_reason: "incorrect" });
  await issue("i-unselected", { video_clip_id: c5 });
  await ins("checklist_scores", { player_id: playerId, checkpoint_id: checkpoints.get("load"), score: 2, ai_draft: 2, reviewed_by: "Real Coach Name", source: "gemini", analysis_run_id: run }, "sc-load");
  const stride = await ins("checklist_scores", { player_id: playerId, checkpoint_id: checkpoints.get("stride"), score: 2, ai_draft: 2, reviewed_by: null, source: "gemini" }, "sc-stride");
  must(await svc.from("checklist_scores").update({ score: 3, reviewed_by: "Real Coach Name" }).eq("id", stride), "review stride score"); // trigger writes history
  await ins("checklist_scores", { player_id: playerId, checkpoint_id: checkpoints.get("head-eyes"), score: 1, ai_draft: 1, reviewed_by: null, source: "gemini" }, "sc-head-draft");
  const prio = await ins("player_priorities", { player_id: playerId, team_id: teamId, title: "Keep the front side closed", description: "Opens early", category: "front-side-stability", status: "active", source_issue_id: approved, follow_up_kind: "next_game" }, "prio");
  must(await svc.from("practice_sessions").update({ focus_priority_id: prio }).eq("id", s1), "session focus");
  await ins("player_priority_drills", { player_priority_id: prio, drill_id: globalDrill, coach_note: "before every tee round" }, "ppd");
  await ins("player_priority_observations", { player_priority_id: prio, video_clip_id: c3, practice_repetition_id: r1, practice_session_id: s1, status: "unchanged", coach_note: "still opening", confidence: "medium", context: "practice", observed_at: "2026-07-15T17:00:00Z", ai_suggestion: "AI suggestion text" }, "o1");
  await ins("player_priority_observations", { player_priority_id: prio, video_clip_id: c4, practice_repetition_id: r2, practice_session_id: s1, status: "improving", coach_note: "held longer", confidence: "medium", context: "practice", observed_at: "2026-07-15T17:05:00Z" }, "o2");
  await ins("player_priority_observations", { player_priority_id: prio, video_clip_id: c2, status: "improving", coach_note: "carried into the game", confidence: "high", context: "game", observed_at: "2026-07-19T18:00:00Z" }, "o3");
  await ins("player_share_links", { player_id: playerId, token: `sourcetoken${stamp}deadbeefdeadbeef`, created_by: coachId }, "share");

  // --- a source video with planted GPS/device metadata -------------------------
  const video = path.join(tmp, "source.mp4");
  execFileSync("ffmpeg", ["-hide_banner", "-loglevel", "error", "-y", "-f", "lavfi", "-i", "testsrc2=size=1920x1080:rate=30", "-f", "lavfi", "-i", "sine=frequency=440",
    "-t", "12", "-metadata", "location=+40.7128-074.0060/", "-metadata", "make=Apple", "-metadata", "model=iPhone 15", "-movflags", "use_metadata_tags",
    "-c:v", "libx264", "-preset", "ultrafast", "-pix_fmt", "yuv420p", "-c:a", "aac", video]);
  src.video = video;

  // --- the exporter's own code path ---------------------------------------------
  const snapshot = await loadSourceSnapshot(svc, TEAM_SLUG, "e2e-player");
  const manifest: CurationManifest = {
    manifestVersion: 1, fixtureId: FIXTURE_ID, fixtureVersion: "e2e.1",
    source: { teamSlug: TEAM_SLUG, playerSlug: "e2e-player" },
    publication: { consentConfirmedBy: "e2e test (synthetic player)", consentConfirmedAt: "2026-09-22" },
    team: { publicName: "E2E Approved Team", sport: "softball", levelLabel: "10U" },
    player: { publicName: "E2E Real Player", publicSlug: PUBLIC_SLUG },
    reviewerDisplayName: "Coach Demo",
    clips: ["c1", "c2", "c3", "c4"].map((slug) => ({ clipSlug: slug, trim: { startS: 1, endS: 7 }, sourceVideo: video, analysisWindowStartS: 0 })),
    priorities: "all",
    expect: { requirePose3d: true, comparePairs: ["baseline_post", "game_game", "priority_before_after"] },
  };
  result = buildFixture(snapshot, manifest, { mediaMode: "planned" });
});

after(async () => {
  try {
    if (previousCanonical) {
      // Restoring a local-validation fixture needs the (local-only) dev setting; the consent
      // guard otherwise refuses it. Enable it just for the restore, then put it back exactly.
      const prevSetting = (await svcDemo.from("demo_dev_settings").select("allow_unconsented_fixtures").maybeSingle()).data;
      if (prevSetting) await svcDemo.from("demo_dev_settings").update({ allow_unconsented_fixtures: true }).eq("allow_unconsented_fixtures", prevSetting.allow_unconsented_fixtures);
      const restored = await svcDemo.rpc("publish_demo_canonical", previousCanonical.mode === "fixture"
        ? { p_fixture_id: previousCanonical.fixture_id, p_fixture_version: previousCanonical.fixture_version }
        : { p_fixture_id: null, p_fixture_version: null });
      if (prevSetting) await svcDemo.from("demo_dev_settings").update({ allow_unconsented_fixtures: prevSetting.allow_unconsented_fixtures }).eq("allow_unconsented_fixtures", true);
      if (restored.error) throw new Error(`could not restore the canonical pointer: ${restored.error.message}`);
    }
    await svcDemo.from("demo_real_fixtures").delete().like("fixture_id", `${FIXTURE_ID}%`);
    const sessions = (await svcDemo.from("demo_sessions").select("team_id").in("user_id", createdUsers)).data ?? [];
    await svcDemo.from("demo_sessions").delete().in("user_id", createdUsers);
    if (sessions.length) await svcDemo.from("teams").delete().in("id", sessions.map((x) => x.team_id));
    await svcDemo.from("coach_profiles").delete().in("user_id", createdUsers);
    if (src.team) await svc.from("teams").delete().eq("id", src.team); // cascades the whole synthetic source subtree
    for (const id of createdUsers) await svc.auth.admin.deleteUser(id);
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true });
  }
});

// ===========================================================================

test("EXPORT: the synthetic processed+reviewed player exports with zero validation errors", () => {
  const errors = result.findings.filter((f) => f.level === "error");
  assert.deepEqual(errors, [], JSON.stringify(errors, null, 2));
  assert.ok(!hasErrors(result.findings));
  const t = result.fixture.tables;
  assert.equal(t.video_clips.length, 4, "4 allowlisted clips (c5 excluded)");
  assert.equal(t.issues.length, 2, "approved + edited only");
  assert.equal(t.checklist_scores.length, 2, "reviewed scores only");
  assert.equal(t.checklist_score_history.length, 1, "the real trigger-written history row for the reviewed score");
  assert.ok(t.player_priority_status_history.length >= 1, "real trigger-written status history is exported");
  const json = JSON.stringify(result.fixture);
  for (const [key, id] of Object.entries(src)) if (key !== "video") assert.ok(!json.includes(id), `source id for ${key} leaked`);
  for (const secret of ["E2E Source Real Name", "Real Coach Name", `sourcetoken${stamp}`, "gs://", TEAM_SLUG, "AI suggestion text"]) assert.ok(!json.includes(secret), `${secret} leaked`);
});

test("MEDIA: transcoded demo clip is H.264 <=720p, trimmed, silent, and stripped of GPS/device metadata", async () => {
  const before_ = await probe(src.video!);
  assert.ok(Object.keys(before_.tags).some((k) => /location/i.test(k)), "the planted location tag must exist in the source for this check to mean anything");
  const clip = result.clips[0]!;
  const out = await transcodeClip({ src: src.video!, outDir: path.join(tmp, "media"), publicFilename: clip.publicFilename!, trim: clip.trim as { startS: number; endS: number }, includeAudio: false });
  assert.deepEqual(out.problems, []);
  assert.equal(out.videoCodec, "h264");
  assert.equal(out.height, 720);
  assert.equal(out.audioCodec, null);
  assert.ok(Math.abs(out.durationS - 6) < 0.5);
  assert.match(out.sha256, /^[0-9a-f]{64}$/);
  const after_ = await probe(path.join(tmp, "media", clip.publicFilename!));
  assert.ok(!Object.keys(after_.tags).some((k) => /location|make|model/i.test(k)), `metadata survived: ${JSON.stringify(after_.tags)}`);
  assert.ok(fs.existsSync(src.video!), "source video untouched");
});

test("IMPORT: load verifies by cloning into a scratch team, stores an immutable version, and does NOT publish", async () => {
  const loaded = must(await svcDemo.rpc("load_real_fixture", { p_payload: result.fixture, p_content_sha256: result.fixture.contentSha256 }), "load_real_fixture") as { ok: boolean; published: boolean; counts: Record<string, number> };
  assert.equal(loaded.ok, true);
  assert.equal(loaded.published, false);
  assert.deepEqual(loaded.counts, { players: 1, video_clips: 4, issues: 2 });
  const canon = must(await svcDemo.from("demo_canonical").select("mode, fixture_id").single(), "canonical") as { fixture_id: string | null };
  assert.notEqual(canon.fixture_id, FIXTURE_ID, "storing never publishes");
  // Re-loading the identical version is a no-op; different content under the same version is refused.
  const again = must(await svcDemo.rpc("load_real_fixture", { p_payload: result.fixture, p_content_sha256: result.fixture.contentSha256 }), "reload") as { unchanged: boolean };
  assert.equal(again.unchanged, true);
  const edited = structuredClone(result.fixture);
  edited.tables.issues[0]!.issue = "changed after export";
  const immutable = await svcDemo.rpc("load_real_fixture", { p_payload: edited, p_content_sha256: "e".repeat(64) });
  assert.ok(immutable.error && /immutable/.test(immutable.error.message), immutable.error?.message);
  // Anything the DB can't clone is rejected before it's stored.
  const bad = structuredClone(result.fixture);
  bad.fixtureVersion = "e2e.bad";
  (bad.tables.swing_phases[0]!._refs as Record<string, { slug: string }>).phase_type_id!.slug = "no-such-phase";
  const rejected = await svcDemo.rpc("load_real_fixture", { p_payload: bad, p_content_sha256: "f".repeat(64) });
  assert.ok(rejected.error && /unknown swing_phase_types slug "no-such-phase"/.test(rejected.error.message), rejected.error?.message);
  const extraCol = structuredClone(result.fixture);
  extraCol.fixtureVersion = "e2e.bad2";
  extraCol.tables.issues[0]!.surprise = "x";
  const rejected2 = await svcDemo.rpc("load_real_fixture", { p_payload: extraCol, p_content_sha256: "f".repeat(64) });
  assert.ok(rejected2.error && /columns do not match/.test(rejected2.error.message), rejected2.error?.message);
  const noTeam = structuredClone(result.fixture);
  noTeam.fixtureVersion = "e2e.bad3";
  noTeam.team.name = "";
  const rejected3 = await svcDemo.rpc("load_real_fixture", { p_payload: noTeam, p_content_sha256: "f".repeat(64) });
  assert.ok(rejected3.error && /publication-approved team name/.test(rejected3.error.message), rejected3.error?.message);
  const stored = must(await svcDemo.from("demo_real_fixtures").select("fixture_version").eq("fixture_id", FIXTURE_ID), "stored") as unknown[];
  assert.equal(stored.length, 1, "rejected versions are never stored");

  const published = must(await svcDemo.rpc("publish_demo_canonical", { p_fixture_id: FIXTURE_ID, p_fixture_version: VERSION }), "publish") as { current: { mode: string; fixtureId: string } };
  assert.deepEqual([published.current.mode, published.current.fixtureId], ["fixture", FIXTURE_ID]);
  const missing = await svcDemo.rpc("publish_demo_canonical", { p_fixture_id: FIXTURE_ID, p_fixture_version: "never-loaded" });
  assert.ok(missing.error && /load it first/.test(missing.error.message));
});

test("CLIENT BOUNDARY: a demo visitor can't read fixtures/canonical state or call clone/load/publish functions", async () => {
  const { c } = await newVisitor();
  for (const table of ["demo_real_fixtures", "demo_canonical", "demo_dev_settings"]) {
    const read = await c.from(table).select("*");
    assert.ok(read.error || (read.data ?? []).length === 0, `${table} must be unreadable to clients`);
  }
  const zero = "00000000-0000-0000-0000-000000000000";
  for (const [fn, args] of [
    ["clone_demo_dataset", { p_user_id: zero }], ["clone_fictional_dataset", { p_user_id: zero }],
    ["clone_real_fixture", { p_team_id: zero, p_payload: {} }], ["clone_fixture_team", { p_payload: {} }],
    ["load_real_fixture", { p_payload: {}, p_content_sha256: "0".repeat(64) }], ["verify_real_fixture", { p_payload: {} }],
    ["publish_demo_canonical", { p_fixture_id: null, p_fixture_version: null }], ["retire_noncanonical_sessions", {}],
    ["assert_fixture_publishable", { p_payload: {} }],
  ] as const) {
    const res = await c.rpc(fn, args);
    assert.ok(res.error, `${fn} must not be callable by a demo visitor`);
  }
});

test("CLONE: a new visitor gets exactly ONE team with exactly ONE player - the published fixture's, under its approved team name", async () => {
  const { c, teamId, userId } = await newVisitor();
  const players = must(await c.from("players").select("slug, name").eq("team_id", teamId), "players") as Array<{ slug: string; name: string }>;
  assert.deepEqual(players, [{ slug: PUBLIC_SLUG, name: "E2E Real Player" }]);
  const teams = must(await c.from("teams").select("id, name"), "visible teams") as Array<{ id: string; name: string }>;
  assert.deepEqual(teams.map((t) => [t.id, t.name]), [[teamId, "E2E Approved Team"]], "no fictional team, no second team");
  for (const fictional of ["Jordan Lee", "Maya Torres", "Riley Chen"]) {
    assert.equal((must(await c.from("players").select("id").eq("name", fictional), fictional) as unknown[]).length, 0);
  }
  const session = must(await c.from("demo_sessions").select("seed_version").eq("user_id", userId).single(), "session") as { seed_version: string };
  assert.equal(session.seed_version, `fixture:${FIXTURE_ID}@${VERSION}`);
  const reset = must(await c.rpc("reset_demo_session"), "reset") as Array<{ team_id: string }>;
  const after = must(await c.from("players").select("slug").eq("team_id", reset[0]!.team_id), "players after reset") as unknown[];
  assert.equal(after.length, 1, "reset returns to the same single-player canonical dataset");
  console.log(`[realFixture.e2e] visitor mode: ${visitorMode}`);
});

test("TEAM: teamDashboard.js's exact queries include the real player's priority, pending queue, practice and games", async () => {
  const { c, teamId } = await newVisitor();
  const prios = must(await c.from("player_priorities").select("id, title, status, follow_up_kind, follow_up_date, follow_up_swings, follow_up_set_at, follow_up_done_at, priority_order, players!inner(id, name, slug, team_id)").eq("players.team_id", teamId).in("status", ["active", "monitoring"]), "team priorities") as Array<{ players: { slug: string }; follow_up_set_at: string | null }>;
  const mine = prios.find((p) => p.players.slug === PUBLIC_SLUG);
  assert.ok(mine && mine.follow_up_set_at, "real priority visible with its exported follow_up_set_at");
  const queue = await c.from("issues").select("id,issue,review_status,player_id,video_clip_id,created_at,players!inner(id,name,slug,jersey_number,team_id),video_clips(id,status,game_log_entries(date,ab,session_type),at_bat_pitches(pitch_number),practice_repetitions(rep_number,grouping))").eq("players.team_id", teamId).order("created_at", { ascending: true });
  assert.equal(queue.error, null);
  assert.ok((queue.data ?? []).some((i: { players: { slug: string } }) => i.players.slug === PUBLIC_SLUG));
  const sessions = await c.from("practice_sessions").select("id, session_date, outcome, focus_priority_id, players!inner(id, name, slug, team_id), practice_repetitions(id)").eq("players.team_id", teamId).order("session_date", { ascending: false }).limit(60);
  assert.equal(sessions.error, null);
  assert.ok((sessions.data ?? []).some((s: { players: { slug: string }; practice_repetitions: unknown[] }) => s.players.slug === PUBLIC_SLUG && s.practice_repetitions.length === 2));
  const summary = await c.from("team_summary_stats").select("avg_score").eq("team_id", teamId);
  assert.equal(summary.error, null);
});

test("PLAYER: player.html's exact queries (game log incl. `pitch`, priorities, drills, drafts) succeed", async () => {
  const { c, teamId } = await newVisitor();
  const pid = await realPlayerId(c, teamId);
  const log = must(await c.from("game_log_entries").select("id, date, opponent, ab, pitch, result, pitch_zone, pitch_outcome").eq("player_id", pid).eq("session_type", "game").order("position"), "loadGameLog") as Array<{ opponent: string }>;
  assert.deepEqual(log.map((g) => g.opponent), ["Eagles", "Hawks"]);
  const prios = must(await c.from("player_priorities").select("id, title, description, status, follow_up_kind, follow_up_date, follow_up_swings, follow_up_set_at, follow_up_done_at").eq("player_id", pid).in("status", ["active", "monitoring"]).order("priority_order").limit(3), "priorities") as Array<{ id: string }>;
  assert.equal(prios.length, 1);
  const drills = must(await c.from("player_priority_drills").select("player_priority_id, active, drill_library(name, purpose, instructions)").in("player_priority_id", prios.map((p) => p.id)).eq("active", true).order("assigned_at", { ascending: false }), "drills") as Array<{ drill_library: { name: string } }>;
  assert.equal(drills[0]!.drill_library.name, "Split-stance tee drill", "global drill resolved by slug to the demo drill library");
  const drafts = must(await c.from("issues").select("id, video_clip_id, created_at").eq("player_id", pid).eq("review_status", "draft"), "drafts") as unknown[];
  assert.equal(drafts.length, 0, "no unreviewed AI drafts were promoted");
  const runs = await c.from("analysis_runs").select("id").eq("player_id", pid).order("created_at", { ascending: false }).limit(1);
  assert.equal(runs.error, null);
  assert.equal(runs.data?.length, 1);
  // Player history Team Avg: coach-verified scores only (the head-eyes AI draft never counts).
  const teamScores = must(await c.from("checklist_scores").select("checkpoint_id, score, review_status, players!inner(team_id)").eq("players.team_id", teamId).eq("review_status", "verified"), "team avg scores") as Array<{ score: number; review_status: string }>;
  assert.ok(teamScores.every((r) => r.review_status === "verified"));
  assert.deepEqual(teamScores.map((r) => r.score).sort(), [2, 3], "verified load 2 + stride 3; draft head-eyes 1 excluded");
});

test("AT-BAT: atbat.html's exact entry/pitches/clips queries return the real at-bat", async () => {
  const { c, teamId } = await newVisitor();
  const pid = await realPlayerId(c, teamId);
  const entries = must(await c.from("game_log_entries").select("id").eq("player_id", pid).eq("opponent", "Eagles"), "entry") as Array<{ id: string }>;
  const entryId = entries[0]!.id;
  const entry = must(await c.from("game_log_entries").select("id,date,opponent,ab,result,session_type,ai_summary,ai_summary_generated_at,players!inner(id, name, jersey_number, slug, teams!inner(id, slug, name))").eq("id", entryId).single(), "atbat entry") as { players: { name: string } };
  assert.equal(entry.players.name, "E2E Real Player");
  const pitches = must(await c.from("at_bat_pitches").select("*").eq("game_log_entry_id", entryId).order("pitch_number"), "pitches") as Array<{ pitch_outcome: string; count_before_balls: number }>;
  assert.deepEqual(pitches.map((p) => p.pitch_outcome), ["ball", "ball_in_play"]);
  assert.equal(pitches[1]!.count_before_balls, 1);
  const clips = must(await c.from("video_clips").select("id,status,error_message,at_bat_pitch_id,created_at").eq("game_log_entry_id", entryId).order("created_at"), "clips") as Array<{ id: string; status: string; at_bat_pitch_id: string | null }>;
  assert.equal(clips.length, 1, "only the allowlisted clip of this at-bat (the second angle stays local)");
  assert.ok(clips[0]!.at_bat_pitch_id);
  // atbat.html's analyzed lookup: the exported analysis run is visible to the
  // visitor, so the at-bat summary counts this swing as analyzed.
  const readyIds = clips.filter((clip) => clip.status === "ready").map((clip) => clip.id);
  const runs = must(await c.from("analysis_runs").select("video_clip_id").in("video_clip_id", readyIds), "at-bat analysis runs") as Array<{ video_clip_id: string }>;
  assert.deepEqual([...new Set(runs.map((r) => r.video_clip_id))], [clips[0]!.id]);
});

test("REVIEW: review.html/devUi.js/skeletonComparison.js exact queries return real findings, phases, metrics and pose", async () => {
  const { c, teamId } = await newVisitor();
  const pid = await realPlayerId(c, teamId);
  const clips = must(await c.from("video_clips").select("id, clip_slug, demo_media_path, demo_media_offset_s, raw_gcs_path, game_log_entries!inner(player_id)").eq("clip_slug", `${PUBLIC_SLUG}-clip-001`).eq("game_log_entries.player_id", pid), "clip") as Array<{ id: string; demo_media_path: string; demo_media_offset_s: number; raw_gcs_path: null }>;
  const clipId = clips[0]!.id;
  assert.equal(clips[0]!.raw_gcs_path, null);
  assert.equal(clips[0]!.demo_media_path, `${FIXTURE_ID}-${VERSION}-clip-001.mp4`);
  assert.equal((clips[0] as { clip_slug?: string }).clip_slug, `${PUBLIC_SLUG}-clip-001`, "local filename-derived slug replaced by a neutral public alias");
  assert.equal(clips[0]!.demo_media_offset_s, -1, "analysis t=0 at source 0s, media starts at source 1s");
  const issues = must(await c.from("issues").select("*").eq("video_clip_id", clipId).order("created_at", { ascending: true }), "issues") as Array<{ review_status: string; reviewed_by: string; analysis_run_id: string }>;
  assert.deepEqual(issues.map((i) => i.review_status), ["approved"], "draft on the same clip is not promoted");
  assert.equal(issues[0]!.reviewed_by, "Coach Demo");
  const run = must(await c.from("analysis_runs").select("id,no_action_needed,no_action_reason,created_at").eq("video_clip_id", clipId).order("created_at", { ascending: false }).limit(1), "run") as Array<{ id: string }>;
  assert.equal(run[0]!.id, issues[0]!.analysis_run_id, "finding provenance points at its cloned analysis run");
  const phases = must(await c.from("swing_phases").select("frame, time_s, confidence, reconstruction_reliable, swing_phase_types!inner(slug, label, sort_order)").eq("video_clip_id", clipId).order("sort_order", { referencedTable: "swing_phase_types" }), "phases") as Array<{ swing_phase_types: { slug: string } }>;
  // .order({ referencedTable }) orders the embed, not these rows - compare as a set.
  assert.deepEqual(phases.map((p) => p.swing_phase_types.slug).sort(), ["contact", "load"]);
  const quality = must(await c.from("video_clip_metrics").select("analysis_quality").eq("video_clip_id", clipId).maybeSingle(), "quality") as { analysis_quality: { overall: string } };
  assert.equal(quality.analysis_quality.overall, "good");
  const metrics = must(await c.from("video_clip_metrics").select("*").eq("video_clip_id", clipId).maybeSingle(), "metrics") as { attack_angle_at_contact_deg: number };
  assert.equal(metrics.attack_angle_at_contact_deg, 8.5);
  const pose = must(await c.from("video_clip_pose3d").select("joint_names, frames, joints_blob, lead_side").eq("video_clip_id", clipId).maybeSingle(), "pose") as { joints_blob: string; lead_side: string; joint_names: string[] };
  assert.equal(pose.joints_blob, "\\x" + "0000803f".repeat(17 * 3 * 3), "binary joint trajectory survives export + clone byte-for-byte");
  assert.equal(pose.lead_side, "l");
  const edited = must(await c.from("issues").select("*").eq("player_id", pid).eq("review_status", "edited"), "edited") as Array<{ ai_original: { issue: string } }>;
  assert.equal(edited[0]!.ai_original.issue, "original AI wording", "See original draft has something to show");
  const markers = await c.from("player_priority_observations").select("video_clip_id, player_priority_id").in("video_clip_id", [clipId]);
  assert.equal(markers.error, null);
});

test("DEVELOPMENT: development.html's exact timeline/history/metric queries succeed with real content", async () => {
  const { c, teamId } = await newVisitor();
  const pid = await realPlayerId(c, teamId);
  const games = must(await c.from("game_log_entries").select("id, date, opponent, ab, at_bat_pitches(count), video_clips(status)").eq("player_id", pid).eq("session_type", "game").order("date", { ascending: false }).limit(20), "timeline games") as unknown[];
  assert.equal(games.length, 2);
  const sessions = must(await c.from("practice_sessions").select("id, session_date, session_goal, outcome, outcome_note, focus_priority_id, assigned_drill_id, drill_library(name), practice_repetitions(id, game_log_entry_id)").eq("player_id", pid).order("session_date", { ascending: false }).limit(20), "timeline sessions") as Array<{ focus_priority_id: string | null; drill_library: { name: string } }>;
  assert.ok(sessions[0]!.focus_priority_id, "deferred focus_priority_id FK was patched after clone");
  assert.equal(sessions[0]!.drill_library.name, "Split-stance tee drill");
  const prios = must(await c.from("player_priorities").select("*").eq("player_id", pid), "devUi priorities") as Array<{ id: string }>;
  const hist = must(await c.from("player_priority_status_history").select("*").in("player_priority_id", prios.map((p) => p.id)).order("changed_at", { ascending: false }).limit(40), "status history") as unknown[];
  assert.equal(hist.length, result.fixture.tables.player_priority_status_history.length, "exported history replaces the insert trigger's synthetic row (no duplicates)");
  const clips = must(await c.from("video_clips").select("id, game_log_entries!inner(player_id)").eq("game_log_entries.player_id", pid), "clips") as Array<{ id: string }>;
  const metrics = await c.from("video_clip_metrics").select("*").in("video_clip_id", clips.map((x) => x.id));
  assert.equal(metrics.error, null);
  assert.equal(metrics.data?.length, 4);
  const lc = await c.from("swing_phases").select("video_clip_id, time_s, swing_phase_types!inner(slug)").in("video_clip_id", clips.map((x) => x.id)).in("swing_phase_types.slug", ["load", "contact"]);
  assert.equal(lc.error, null);
  assert.equal(lc.data?.length, 8);
});

test("PRACTICE: practicePage.js's exact session/rep queries return baseline + post-drill reps with ready clips", async () => {
  const { c, teamId } = await newVisitor();
  const pid = await realPlayerId(c, teamId);
  const session = must(await c.from("practice_sessions").select("*").eq("player_id", pid).single(), "session") as { id: string };
  const reps = must(await c.from("practice_repetitions").select("*, video_clips(id, status, error_message)").eq("practice_session_id", session.id).order("rep_number"), "reps") as Array<{ grouping: string; video_clips: Array<{ status: string }> }>;
  assert.deepEqual(reps.map((r) => r.grouping), ["baseline", "post_drill"]);
  assert.ok(reps.every((r) => r.video_clips.length === 1 && r.video_clips[0]!.status === "ready"));
  const readyIds = reps.map((r) => (r.video_clips[0] as unknown as { id: string }).id);
  const withMetrics = await c.from("video_clip_metrics").select("video_clip_id").in("video_clip_id", readyIds);
  assert.equal(withMetrics.data?.length, 2);
});

test("COMPARE: the baseline/post-drill pair resolves with phases, metrics and pose via compare.html's detail() shapes", async () => {
  const { c, teamId } = await newVisitor();
  const pid = await realPlayerId(c, teamId);
  const reps = must(await c.from("video_clips").select("id, practice_repetitions!inner(grouping, practice_sessions!inner(player_id))").eq("practice_repetitions.practice_sessions.player_id", pid), "pair") as Array<{ id: string }>;
  assert.equal(reps.length, 2);
  for (const clip of reps) {
    const phases = must(await c.from("swing_phases").select("frame, time_s, confidence, reconstruction_reliable, swing_phase_types!inner(slug, label, sort_order)").eq("video_clip_id", clip.id).order("sort_order", { referencedTable: "swing_phase_types" }), "phases") as unknown[];
    assert.equal(phases.length, 2);
    assert.ok(must(await c.from("video_clip_metrics").select("*").eq("video_clip_id", clip.id).maybeSingle(), "metrics"));
    assert.ok(must(await c.from("video_clip_pose3d").select("id").eq("video_clip_id", clip.id).maybeSingle(), "pose"));
  }
});

test("REPORT: get-demo-player-report's exact query sequence (by the visitor's fresh token) shapes a real report", async () => {
  const { c, teamId } = await newVisitor();
  const pid = await realPlayerId(c, teamId);
  const links = must(await c.from("player_share_links").select("token").eq("player_id", pid), "share link") as Array<{ token: string }>;
  assert.equal(links.length, 1);
  assert.match(links[0]!.token, /^[0-9a-f]{64}$/);
  assert.notEqual(links[0]!.token, `sourcetoken${stamp}deadbeefdeadbeef`);
  // Same queries, same order, same service-role .schema("demo") client as supabase/functions/get-demo-player-report/index.ts.
  const link = must(await svcDemo.from("player_share_links").select("player_id, revoked_at, expires_at").eq("token", links[0]!.token).maybeSingle(), "link") as { player_id: string };
  const player = must(await svcDemo.from("players").select("name, jersey_number, teams!inner(name)").eq("id", link.player_id).single(), "player") as { name: string; jersey_number: string; teams: { name: string } };
  const scores = must(await svcDemo.from("checklist_scores").select("score, reviewed_by, checkpoints!inner(label, sort_order)").eq("player_id", link.player_id).order("sort_order", { referencedTable: "checkpoints" }), "scores");
  const { count } = await svcDemo.from("game_log_entries").select("id", { count: "exact", head: true }).eq("player_id", link.player_id).eq("session_type", "game");
  const priorities = must(await svcDemo.from("player_priorities").select("id, title, description, status, priority_order, first_identified_at, resolved_at, follow_up_kind, follow_up_date, follow_up_swings").eq("player_id", link.player_id).neq("status", "archived"), "priorities") as Array<{ id: string }>;
  const ids = priorities.map((p) => p.id);
  const drills = must(await svcDemo.from("player_priority_drills").select("player_priority_id, active, coach_note, assigned_at, drill_library(name, purpose, instructions, equipment)").in("player_priority_id", ids).order("assigned_at", { ascending: false }), "drills");
  const observations = must(await svcDemo.from("player_priority_observations").select("player_priority_id, status, coach_note, observed_at, video_clip_id, phase").in("player_priority_id", ids), "observations");
  const report = shapePlayerReport({
    player: { name: player.name, jersey_number: player.jersey_number, teamName: player.teams.name },
    scores: scores as never, priorities: priorities as never, drills: drills as never, observations: observations as never, loggedAtBats: count ?? 0,
  });
  assert.equal(report.playerName, "E2E Real Player");
  assert.equal(report.loggedAtBats, 2);
  assert.deepEqual(report.strengths, ["Stride / front-foot plant"], "only coach-confirmed top scores; the AI-draft head-eyes score was never promoted");
  assert.equal(report.priorities.length, 1);
  assert.equal(report.priorities[0]!.title, "Keep the front side closed");
  assert.equal(report.priorities[0]!.statusLabel, "Improving");
});

test("ISOLATION + CONCURRENT RESET: own copies, fresh ids and tokens, one clean clone after 3 simultaneous resets", async () => {
  const a = await newVisitor();
  const b = await newVisitor();
  const aPid = await realPlayerId(a.c, a.teamId);
  const bPid = await realPlayerId(b.c, b.teamId);
  assert.notEqual(aPid, bPid);
  assert.equal(((await b.c.from("issues").select("id").eq("player_id", aPid)).data ?? []).length, 0, "B can't read A's findings");
  await b.c.from("issues").update({ issue: "hacked" }).eq("player_id", aPid);
  const aIssues = must(await a.c.from("issues").select("issue").eq("player_id", aPid), "a issues") as Array<{ issue: string }>;
  assert.ok(aIssues.length > 0 && aIssues.every((i) => i.issue !== "hacked"), "B can't mutate A's findings");
  const tokenA = (must(await a.c.from("player_share_links").select("token").eq("player_id", aPid), "a token") as Array<{ token: string }>)[0]!.token;
  const tokenB = (must(await b.c.from("player_share_links").select("token").eq("player_id", bPid), "b token") as Array<{ token: string }>)[0]!.token;
  assert.notEqual(tokenA, tokenB, "share tokens are regenerated per visitor");
  await Promise.all([a.c.rpc("reset_demo_session"), a.c.rpc("reset_demo_session"), a.c.rpc("reset_demo_session")]);
  const { data: sess } = await a.c.from("demo_sessions").select("team_id").eq("user_id", a.userId).single();
  const players = must(await a.c.from("players").select("id").eq("team_id", sess!.team_id), "players after concurrent resets") as Array<{ id: string }>;
  assert.equal(players.length, 1, "exactly one clean single-player clone after concurrent resets");
  assert.notEqual(players[0]!.id, aPid);
  const aTeams = must(await a.c.from("teams").select("id"), "a teams") as unknown[];
  assert.equal(aTeams.length, 1, "old teams are gone, never merged");
});

test("FAIL CLOSED + ROLLBACK: a broken published fixture errors (never fictional); rollback and stale-session retirement are explicit", async () => {
  // Corrupt the stored, published payload (simulates a bad deploy) - visitors must get an error, not fictional data.
  const original = must(await svcDemo.from("demo_real_fixtures").select("payload").eq("fixture_id", FIXTURE_ID).eq("fixture_version", VERSION).single(), "payload") as { payload: { team: { name: string } } };
  const broken = structuredClone(original.payload);
  broken.team.name = "";
  must(await svcDemo.from("demo_real_fixtures").update({ payload: broken }).eq("fixture_id", FIXTURE_ID).eq("fixture_version", VERSION), "corrupt");
  const c = createClient(URL_, ANON, { ...noSession, db: { schema: "demo" } });
  const signed = await c.auth.signInAnonymously();
  if (!signed.error) createdUsers.push(signed.data.user!.id);
  else {
    const email = `demo-e2e-${stamp}-fc@test.local`;
    const created = await svc.auth.admin.createUser({ email, password: "E2e-demo-Pass-123", email_confirm: true });
    createdUsers.push(created.data.user!.id);
    await c.auth.signInWithPassword({ email, password: "E2e-demo-Pass-123" });
  }
  const failed = await c.rpc("start_demo_session");
  assert.ok(failed.error, "a visitor must get an error, not a silent fallback");
  assert.equal(((await c.from("teams").select("id")).data ?? []).length, 0, "no team (fictional or otherwise) was created");
  must(await svcDemo.from("demo_real_fixtures").update({ payload: original.payload }).eq("fixture_id", FIXTURE_ID).eq("fixture_version", VERSION), "restore");

  // Explicit rollback to the fictional narrative, then forward again, then retire the fictional-era session.
  must(await svcDemo.rpc("publish_demo_canonical", { p_fixture_id: null, p_fixture_version: null }), "rollback fictional");
  const old = await newVisitor();
  assert.equal((must(await old.c.from("players").select("id").eq("team_id", old.teamId), "fictional players") as unknown[]).length, 3);
  must(await svcDemo.rpc("publish_demo_canonical", { p_fixture_id: FIXTURE_ID, p_fixture_version: VERSION }), "republish");
  const retired = must(await svcDemo.rpc("retire_noncanonical_sessions", {}), "retire") as number;
  assert.ok(retired >= 1);
  assert.equal(((await old.c.from("teams").select("id")).data ?? []).length, 0, "the fictional-era session's team is gone");
  const back = must(await old.c.rpc("start_demo_session"), "re-bootstrap") as Array<{ team_id: string }>;
  assert.equal((must(await old.c.from("players").select("slug").eq("team_id", back[0]!.team_id), "players") as unknown[]).length, 1, "the next page load gets the single-player clone");
});
