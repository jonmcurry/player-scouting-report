/**
 * Tests for the pieces layered on the player-development schema: the legacy-flow triggers
 * (migration 00027), the public-report whitelist (get-player-report/shape.ts) and the ingest-time
 * analysis-quality summary. Same real-local-Supabase standard as development.test.ts; the report and
 * quality tests are pure. Requires `npx supabase start` and .env.
 */
import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import path from "node:path";
import { pathToFileURL } from "node:url";
import "dotenv/config";
import { getSupabaseClient } from "./supabaseClient.js";
import { computeAnalysisQuality } from "./analysisQuality.js";

const suffix = `${Date.now()}`;
const svc = getSupabaseClient();
let teamId: string;
let playerId: string;

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function must(res: { data: any; error: { message: string } | null }, what: string): any {
  if (res.error) throw new Error(`${what}: ${res.error.message}`);
  return res.data;
}

before(async () => {
  const team = must(await svc.from("teams").insert({ slug: `flowtest-${suffix}`, name: "Flow test" }).select("id").single(), "team");
  teamId = team.id;
  const player = must(await svc.from("players").insert({ team_id: teamId, slug: `fp-${suffix}`, name: "Flow P", jersey_number: "9" }).select("id").single(), "player");
  playerId = player.id;
});

after(async () => {
  if (teamId) await svc.from("teams").delete().eq("id", teamId);
});

test("a clip uploaded through the old flow lands on a pitch; explicit links are left alone", async () => {
  const entry = must(
    await svc.from("game_log_entries").insert({ player_id: playerId, date: "2026-09-20", opponent: "Legacy", ab: 1, session_type: "game" }).select("id").single(),
    "entry",
  ).id as string;
  const mk = async (extra: Record<string, unknown> = {}) =>
    must(
      await svc.from("video_clips").insert({ game_log_entry_id: entry, clip_slug: `legacy-${Math.random().toString(36).slice(2)}`, raw_gcs_path: "gs://b/x.mp4", status: "ready", ...extra }).select("id, at_bat_pitch_id").single(),
      "clip",
    );
  const c1 = await mk();
  assert.ok(c1.at_bat_pitch_id, "first legacy clip gets a pitch");
  const c2 = await mk();
  assert.notEqual(c2.at_bat_pitch_id, c1.at_bat_pitch_id, "second clip gets the next pitch, not the first one's");
  const pitches = must(await svc.from("at_bat_pitches").select("pitch_number").eq("game_log_entry_id", entry).order("pitch_number"), "pitches");
  assert.deepEqual(pitches.map((p: { pitch_number: number }) => p.pitch_number), [1, 2]);
  const explicit = must(await svc.from("at_bat_pitches").insert({ game_log_entry_id: entry, pitch_number: 3 }).select("id").single(), "pitch 3");
  const c3 = await mk({ at_bat_pitch_id: explicit.id });
  assert.equal(c3.at_bat_pitch_id, explicit.id, "an explicit pitch is never overridden");
  const all = must(await svc.from("at_bat_pitches").select("id").eq("game_log_entry_id", entry), "all pitches");
  assert.equal(all.length, 3, "no extra pitch created for the explicit link");
});

test("a practice entry created through the old flow gets its session and rep; its clip links to the rep", async () => {
  const entry = must(
    await svc.from("game_log_entries").insert({ player_id: playerId, date: "2026-09-21", opponent: null, ab: 1, session_type: "practice", session_note: "tee" }).select("id").single(),
    "entry",
  ).id as string;
  const rep = must(await svc.from("practice_repetitions").select("id, rep_number, practice_sessions(session_date)").eq("game_log_entry_id", entry).single(), "rep");
  assert.equal(rep.rep_number, 1);
  assert.equal(rep.practice_sessions.session_date, "2026-09-21");
  const clip = must(
    await svc.from("video_clips").insert({ game_log_entry_id: entry, clip_slug: `pl-${suffix}`, raw_gcs_path: "gs://b/y.mp4", status: "ready" }).select("practice_repetition_id, at_bat_pitch_id").single(),
    "clip",
  );
  assert.equal(clip.practice_repetition_id, rep.id);
  assert.equal(clip.at_bat_pitch_id, null);
  const entry2 = must(
    await svc.from("game_log_entries").insert({ player_id: playerId, date: "2026-09-21", opponent: null, ab: 2, session_type: "practice" }).select("id").single(),
    "entry2",
  ).id as string;
  const reps = must(await svc.from("practice_repetitions").select("practice_session_id").in("game_log_entry_id", [entry, entry2]), "reps");
  assert.equal(new Set(reps.map((s: { practice_session_id: string }) => s.practice_session_id)).size, 1, "second rep reuses the day's session");
});

test("player report shaping exposes only coach-confirmed content and no internal diagnostics", async () => {
  const { shapePlayerReport } = (await import(pathToFileURL(path.resolve("supabase/functions/get-player-report/shape.ts")).href)) as {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    shapePlayerReport: (i: unknown) => any;
  };
  const report = shapePlayerReport({
    player: { name: "P", jersey_number: "7", teamName: "T" },
    scores: [
      { score: 3, reviewed_by: "Coach", checkpoints: { label: "Balance" } },
      { score: 3, reviewed_by: null, checkpoints: { label: "Unreviewed AI draft" } },
      { score: 1, reviewed_by: "Coach", checkpoints: { label: "Hands" } },
      { score: null, reviewed_by: "Coach", review_status: "insufficient_evidence", checkpoints: { label: "Head" } },
      { score: null, reviewed_by: "Coach", review_status: "rejected", checkpoints: { label: "Rejected AI draft" } },
    ],
    priorities: [
      { id: "p1", title: "Front side", description: "stay closed", status: "active", priority_order: 0, first_identified_at: "2026-09-01", resolved_at: null },
      { id: "p2", title: "Old one", description: "", status: "archived", priority_order: 1, first_identified_at: "2026-08-01", resolved_at: null },
      { id: "p3", title: "Fixed", description: "", status: "resolved", priority_order: 0, first_identified_at: "2026-07-01", resolved_at: "2026-08-01" },
    ],
    drills: [
      { player_priority_id: "p1", active: true, coach_note: "slow", drill_library: { name: "Split stance", purpose: "p", instructions: "i", equipment: "tee" } },
      { player_priority_id: "p1", active: false, coach_note: "", drill_library: { name: "Retired drill", purpose: "", instructions: "", equipment: "" } },
    ],
    observations: [
      { player_priority_id: "p1", status: "improving", coach_note: "Much better", observed_at: "2026-09-19T10:00:00Z", video_clip_id: "clip-1", phase: "contact" },
      { player_priority_id: "p1", status: "unclear", coach_note: "cant tell", observed_at: "2026-09-12T10:00:00Z", video_clip_id: null, phase: null },
      { player_priority_id: "p1", status: "unchanged", coach_note: "", observed_at: "2026-09-05T10:00:00Z", video_clip_id: null, phase: null },
    ],
    loggedAtBats: 3,
  });
  assert.deepEqual(report.strengths, ["Balance"], "only coach-reviewed top scores");
  assert.deepEqual(report.checkpoints, [
    { label: "Balance", score: 3, state: "verified" },
    { label: "Hands", score: 1, state: "verified" },
    { label: "Head", score: null, state: "insufficient_evidence" },
  ], "unconfirmed and rejected checkpoint rows are removed; insufficient evidence is shown as such, with no score");
  assert.deepEqual(report.priorities.map((p: { title: string }) => p.title), ["Front side", "Fixed"], "archived hidden, resolved last");
  const p = report.priorities[0];
  assert.deepEqual(p.progress.map((o: { label: string }) => o.label), ["Improving", "Holding steady"], "newest first, 'unclear' dropped");
  assert.equal(p.statusLabel, "Improving");
  assert.deepEqual(p.drills.map((d: { name: string }) => d.name), ["Split stance"], "inactive drills hidden");
  assert.deepEqual(p.clips, [{ clipId: "clip-1", date: "2026-09-19", phase: "contact" }]);
  assert.equal(report.priorities[1].statusLabel, "Got it");
  const json = JSON.stringify(report);
  assert.ok(!json.includes("Unreviewed AI draft"), "unconfirmed AI-draft scores never reach the public JSON");
  assert.ok(!json.includes("reviewedBy"), "review workflow fields are not public");
  for (const banned of ["pose_coverage", "bone", "reconstruction", "ai_suggestion", "confidence", "analysis_quality"]) {
    assert.ok(!json.includes(banned), `report must not expose ${banned}`);
  }
});

test("public report: active outranks monitoring, drills and progress are deterministic", async () => {
  const { shapePlayerReport } = (await import(pathToFileURL(path.resolve("supabase/functions/get-player-report/shape.ts")).href)) as {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    shapePlayerReport: (i: unknown) => any;
  };
  const pri = (id: string, status: string, order: number) => ({ id, title: id, description: "", status, priority_order: order, first_identified_at: "2026-09-01", resolved_at: null });
  const drill = (name: string, assigned_at: string | null) => ({ player_priority_id: "act", active: true, coach_note: "", assigned_at, drill_library: { name, purpose: "", instructions: "", equipment: "" } });
  const input = {
    player: { name: "P", jersey_number: "1", teamName: "T" },
    scores: [{ score: 3, reviewed_by: null, checkpoints: { label: "Draft only" } }],
    priorities: [pri("mon", "monitoring", 0), pri("res", "resolved", 0), pri("act", "active", 5)],
    drills: [drill("Older", "2026-09-01T00:00:00Z"), drill("Newest", "2026-09-10T00:00:00Z"), drill("Middle", "2026-09-05T00:00:00Z")],
    observations: [
      { player_priority_id: "act", status: "unchanged", coach_note: "", observed_at: "2026-09-01T00:00:00Z", video_clip_id: "c1", phase: null },
      { player_priority_id: "act", status: "improving", coach_note: "", observed_at: "2026-09-15T00:00:00Z", video_clip_id: "c2", phase: null },
      { player_priority_id: "act", status: "unchanged", coach_note: "", observed_at: "2026-09-08T00:00:00Z", video_clip_id: "c3", phase: null },
    ],
    loggedAtBats: 0,
  };
  const a = shapePlayerReport(input);
  assert.deepEqual(a.priorities.map((p: { title: string }) => p.title), ["act", "mon", "res"], "active > monitoring > resolved despite priority_order");
  assert.deepEqual(a.priorities[0].drills.map((d: { name: string }) => d.name), ["Newest", "Middle", "Older"]);
  assert.deepEqual(a.priorities[0].progress.map((o: { date: string }) => o.date), ["2026-09-15", "2026-09-08", "2026-09-01"], "newest first");
  assert.equal(a.priorities[0].statusLabel, "Improving", "latest observation drives the label");
  assert.deepEqual(a.priorities[0].clips.map((c: { clipId: string }) => c.clipId), ["c2", "c3", "c1"]);
  const b = shapePlayerReport({ ...input, drills: [...input.drills].reverse(), priorities: [...input.priorities].reverse() });
  assert.deepEqual(b.priorities, a.priorities, "input row order never changes the output");
  assert.ok(!JSON.stringify(a).includes("Draft only"), "unconfirmed checklist rows stay out");
});

test("public report strengths follow canonical checkpoint order despite reversed score rows", async () => {
  const { shapePlayerReport } = await import(pathToFileURL(path.resolve("supabase/functions/get-player-report/shape.ts")).href);
  const report = shapePlayerReport({
    player: { name: "P", jersey_number: null, teamName: "T" },
    scores: [
      { score: null, reviewed_by: "Coach", review_status: "insufficient_evidence", checkpoints: { label: "Stride", sort_order: 2 } },
      { score: 3, reviewed_by: "Coach", review_status: "verified", checkpoints: { label: "Load", sort_order: 1 } },
      { score: 3, reviewed_by: "Coach", review_status: "verified", checkpoints: { label: "Stance & setup", sort_order: 0 } },
    ],
    priorities: [], drills: [], observations: [], loggedAtBats: 0,
  });
  assert.deepEqual(report.strengths, ["Stance & setup", "Load"]);
  assert.deepEqual(report.checkpoints.map((row: { label: string }) => row.label), ["Stance & setup", "Load", "Stride"]);
});

test("analysis quality: real coverage numbers, honest nulls, no fabricated handedness certainty", () => {
  const kp = (c: number) => Array.from({ length: 17 }, () => [0, 0, c]);
  const frames = [...Array(8)].map(() => ({ keypoints: kp(0.9) })).concat([...Array(2)].map(() => ({ keypoints: kp(0.05) })));
  const q = computeAnalysisQuality({
    pose2d: { meta: { bat_evidence: { track_frames: 10, bat_evidence_frames: 2 } }, frames },
    pose3d: { frames: frames.map((_, i) => ({ tracked: i < 9 })) },
    metrics: { phases: { contact: { frame: 5, confidence: "high", reconstruction_reliable: true }, load: { frame: 2, reconstruction_reliable: false } }, lead_side_guess: "l" },
  });
  assert.equal(q.pose_coverage, 0.8);
  assert.equal(q.bat_coverage, 0.2);
  assert.equal(q.pose3d_coverage, 0.9);
  assert.equal(q.contact_confidence, "good");
  assert.equal(q.reconstruction, "limited", "a flagged phase caps an otherwise good reconstruction");
  assert.equal(q.occlusion, "limited");
  assert.equal(q.handedness, "limited", "handedness is only ever a heuristic");
  const none = computeAnalysisQuality({ pose2d: { frames: [] }, pose3d: null, metrics: {} });
  assert.equal(none.pose_coverage, null);
  assert.equal(none.reconstruction, null);
  assert.equal(none.contact_confidence, "poor");
  assert.equal(none.handedness, null);
});
