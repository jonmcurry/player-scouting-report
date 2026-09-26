import { test } from "node:test";
import assert from "node:assert/strict";
import * as L from "./developmentLogic.js";

const pitch = (n, extra = {}) => ({ id: `p${n}`, pitch_number: n, ...extra });

test("pitch ordering: sorts by pitch_number, flags duplicates and invalid numbers", () => {
  const shuffled = [pitch(3), pitch(1), pitch(2)];
  assert.deepEqual(L.sortPitches(shuffled).map((p) => p.pitch_number), [1, 2, 3]);
  assert.deepEqual(L.validatePitchOrder(shuffled), []);
  assert.equal(L.validatePitchOrder([pitch(1), pitch(1)]).length, 1);
  assert.equal(L.validatePitchOrder([pitch(0)]).length, 1);
  assert.equal(L.nextPitchNumber(shuffled), 4);
  assert.equal(L.nextPitchNumber([]), 1);
});

test("count progression: inferred from known outcomes, never guessed past an unknown one", () => {
  const rows = L.inferCounts([
    pitch(1, { pitch_outcome: "called_strike" }),
    pitch(2, { pitch_outcome: "ball" }),
    pitch(3, { pitch_outcome: "foul" }),
    pitch(4, { pitch_outcome: "take" }), // generic take: ball or strike unknown
    pitch(5, { pitch_outcome: "ball" }),
  ]);
  assert.deepEqual(rows.map((r) => L.countLabel(r.balls, r.strikes)), ["0-0", "0-1", "1-1", "1-2", "count unknown"]);
  // A stored count re-anchors the sequence.
  const anchored = L.inferCounts([pitch(1, { pitch_outcome: "take" }), pitch(2, { count_before_balls: 2, count_before_strikes: 1 })]);
  assert.equal(L.countLabel(anchored[1].balls, anchored[1].strikes), "2-1");
  assert.equal(anchored[1].inferred, false);
  // foul with two strikes does not add a strike
  const fouls = L.inferCounts([pitch(1, { count_before_balls: 0, count_before_strikes: 2, pitch_outcome: "foul" }), pitch(2, { pitch_outcome: "ball" })]);
  assert.equal(L.countLabel(fouls[1].balls, fouls[1].strikes), "0-2");
});

test("swung defaults come from outcome only when the outcome implies it", () => {
  assert.equal(L.swungFromOutcome("foul"), true);
  assert.equal(L.swungFromOutcome("called_strike"), false);
  assert.equal(L.swungFromOutcome("other"), null);
  assert.equal(L.swungFromOutcome(undefined), null);
});

test("at-bat summary: counts swings/takes/analyzed swings and video status per pitch", () => {
  const pitches = [pitch(1, { pitch_outcome: "called_strike" }), pitch(2, { pitch_outcome: "foul" }), pitch(3, { pitch_outcome: "ball" })];
  const clips = [{ id: "c1", at_bat_pitch_id: "p2", status: "ready", analyzed: true }];
  const s = L.summarizeAtBat({ result: "Walk" }, pitches, clips);
  assert.equal(s.pitchCount, 3);
  assert.equal(s.swings, 1);
  assert.equal(s.takes, 2);
  assert.equal(s.analyzedSwings, 1);
  assert.equal(s.rows[1].videoStatus, "ready");
  assert.equal(s.rows[0].videoStatus, "none");
  assert.match(L.atBatFactsSummary(s), /Only one swing was analyzed/);
  const none = L.summarizeAtBat({}, pitches, []);
  assert.match(L.atBatFactsSummary(none), /No video in this at-bat has been analyzed yet/);
  assert.match(L.atBatFactsSummary(none), /3 pitch(es)? recorded/);
  assert.doesNotMatch(L.atBatFactsSummary(s), /pitch type|location|intent|strategy/i);
});

test("markClipsAnalyzed: analysis_runs ids decide analyzed; a failed lookup is unknown, not false", () => {
  const clips = [{ id: "c1", status: "ready" }, { id: "c2", status: "ready" }, { id: "c3", status: "processing" }];
  assert.deepEqual(L.markClipsAnalyzed(clips, ["c1"]).map((c) => c.analyzed), [true, false, false]);
  assert.deepEqual(L.markClipsAnalyzed(clips, null).map((c) => c.analyzed), [null, null, false]);
  assert.deepEqual(L.markClipsAnalyzed(null, ["c1"]), []);
});

const analyzedClips = (pitchIds, analyzedIds = pitchIds.map((pid) => `c-${pid}`)) =>
  L.markClipsAnalyzed(pitchIds.map((pid) => ({ id: `c-${pid}`, at_bat_pitch_id: pid, status: "ready" })), analyzedIds);
const SWING_CLAIM = /swing was analyzed|swings were analyzed|analyzed swing/i;

test("at-bat summary A: an explicitly recorded swing with an analysis run is an analyzed swing", () => {
  const s = L.summarizeAtBat({}, [pitch(1, { swung: true }), pitch(2, { pitch_outcome: "foul" })], analyzedClips(["p1", "p2"]));
  assert.equal(s.analyzedSwings, 2);
  assert.equal(s.analyzedUnrecorded, 0);
  assert.match(L.atBatFactsSummary(s), /2 pitches recorded: 2 swings, 0 takes\. 2 swings were analyzed/);
});

test("at-bat summary B: an explicitly recorded take with an analysis run is never an analyzed swing", () => {
  const s = L.summarizeAtBat({}, [pitch(1, { swung: false })], analyzedClips(["p1"]));
  assert.equal(s.takes, 1);
  assert.equal(s.analyzedSwings, 0);
  assert.equal(s.analyzedTakes, 1);
  const text = L.atBatFactsSummary(s);
  assert.doesNotMatch(text, SWING_CLAIM);
  assert.doesNotMatch(text, /No video in this at-bat has been analyzed/);
  assert.match(text, /1 pitch recorded: 0 swings, 1 take\. 1 pitch recorded as a take has analyzed video\./);
});

test("at-bat summary C: unknown swing/take with analyzed video (live AB shape) gets neutral wording, not zero", () => {
  const s = L.summarizeAtBat({}, [pitch(1), pitch(2), pitch(3)], analyzedClips(["p1", "p2", "p3"]));
  assert.equal(s.analyzedSwings, 0);
  assert.equal(s.analyzedUnrecorded, 3);
  assert.equal(s.swingUnknown, 3);
  assert.equal(L.atBatSummaryComplete(s), true);
  const text = L.atBatFactsSummary(s);
  assert.equal(text, "3 pitches recorded. Swing or take is not recorded for these pitches. 3 pitches have analyzed video. 3 pitch outcomes are not recorded.");
  assert.doesNotMatch(text, SWING_CLAIM);
  assert.doesNotMatch(text, /0 swings|0 takes|No video in this at-bat has been analyzed/);
  assert.doesNotMatch(text, /\bhit\b|\bout\b|walk|strikeout|single|double/i, "no batting-outcome inference");
  const one = L.atBatFactsSummary(L.summarizeAtBat({}, [pitch(1), pitch(2)], analyzedClips(["p2"])));
  assert.match(one, /1 pitch has analyzed video\./);
  assert.doesNotMatch(one, SWING_CLAIM);
});

test("at-bat summary D: unknown-pitch video is never merged into the explicit swing count", () => {
  const pitches = [pitch(1, { swung: true }), pitch(2, { swung: true }), pitch(3)];
  const s = L.summarizeAtBat({}, pitches, analyzedClips(["p1", "p2", "p3"]));
  assert.equal(s.swings, 2);
  assert.equal(s.analyzedSwings, 2);
  assert.equal(s.analyzedUnrecorded, 1);
  const text = L.atBatFactsSummary(s);
  assert.match(text, /3 pitches recorded: 2 swings, 0 takes; swing or take not recorded for 1\. 2 swings were analyzed - .* 1 pitch has analyzed video\./);
  assert.doesNotMatch(text, /3 swings were analyzed/);
});

test("at-bat summary E: unknown swing/take without analysis stays unknown, never zero", () => {
  const pitches = [pitch(1)];
  // Analysis lookup failed: withheld, not saveable.
  const failed = L.summarizeAtBat({}, pitches, analyzedClips(["p1"], null));
  assert.equal(failed.analyzedUnrecorded, null);
  assert.equal(failed.analyzedSwings, null);
  assert.equal(L.atBatSummaryComplete(failed), false);
  assert.doesNotMatch(L.atBatFactsSummary(failed), /analyzed|0 swings|0 takes/);
  // Known not analyzed: swing/take is still "not recorded", never "0 swings".
  const notAnalyzed = L.summarizeAtBat({}, pitches, analyzedClips(["p1"], []));
  assert.equal(notAnalyzed.analyzedUnrecorded, 0);
  assert.equal(L.atBatFactsSummary(notAnalyzed), "1 pitch recorded. Swing or take is not recorded for it. No video in this at-bat has been analyzed yet. 1 pitch outcome is not recorded.");
});

test("at-bat summary: a no-video pitch stays no-video, not a swing, alongside one analyzed swing", () => {
  const s = L.summarizeAtBat({}, [pitch(1), pitch(2, { swung: true })], analyzedClips(["p2"]));
  assert.equal(s.rows[0].videoStatus, "none");
  assert.equal(s.rows[0].swung, null);
  assert.equal(s.rows[0].videoAnalyzed, false);
  assert.equal(s.swings, 1);
  assert.equal(s.analyzedSwings, 1);
  assert.match(L.atBatFactsSummary(s), /Only one swing was analyzed/);
});

test("at-bat summary: takes and swings are counted only from recorded data; partial knowledge says so", () => {
  const pitches = [pitch(1, { pitch_outcome: "called_strike" }), pitch(2, { swung: false }), pitch(3, { swung: true }), pitch(4)];
  const s = L.summarizeAtBat({}, pitches, []);
  assert.equal(s.takes, 2);
  assert.equal(s.swings, 1);
  assert.equal(s.swingUnknown, 1);
  assert.match(L.atBatFactsSummary(s), /4 pitches recorded: 1 swing, 2 takes; swing or take not recorded for 1\./);
});

test("at-bat summary: missing analysis data withholds the analyzed claim and blocks saving", () => {
  const pitches = [pitch(1, { swung: true })];
  // Ready clip whose analyzed state was never loaded (undefined) or is unknown (null).
  for (const analyzed of [undefined, null]) {
    const s = L.summarizeAtBat({}, pitches, [{ id: "c1", at_bat_pitch_id: "p1", status: "ready", analyzed }]);
    assert.equal(s.analyzedSwings, null);
    assert.equal(L.atBatSummaryComplete(s), false);
    assert.doesNotMatch(L.atBatFactsSummary(s), /analyzed/);
  }
  // Clip rows failed to load at all - including on an at-bat with no pitches.
  for (const ps of [pitches, []]) {
    const noClips = L.summarizeAtBat({}, ps, null);
    assert.equal(noClips.analyzedSwings, null);
    assert.equal(L.atBatSummaryComplete(noClips), false);
    assert.doesNotMatch(L.atBatFactsSummary(noClips), /analyzed/);
  }
  // Known state with no ready clips is a real, saveable "none analyzed".
  const pending = L.summarizeAtBat({}, pitches, [{ id: "c1", at_bat_pitch_id: "p1", status: "processing" }]);
  assert.equal(pending.analyzedSwings, 0);
  assert.equal(L.atBatSummaryComplete(pending), true);
});

test("at-bat summary: analyzed video not attached to a pitch is reported, never hidden behind 'none analyzed'", () => {
  const pitches = [pitch(1)];
  const s = L.summarizeAtBat({}, pitches, L.markClipsAnalyzed([{ id: "c9", at_bat_pitch_id: null, status: "ready" }], ["c9"]));
  assert.equal(s.unassignedAnalyzed, 1);
  const text = L.atBatFactsSummary(s);
  assert.doesNotMatch(text, /No video in this at-bat has been analyzed/);
  assert.doesNotMatch(text, SWING_CLAIM);
  assert.match(text, /1 analyzed video is not attached to a pitch/);
  // Unassigned clip whose analysis state is unknown withholds the claim and blocks saving.
  const unknown = L.summarizeAtBat({}, pitches, L.markClipsAnalyzed([{ id: "c9", at_bat_pitch_id: null, status: "ready" }], null));
  assert.equal(unknown.analyzedSwings, null);
  assert.equal(L.atBatSummaryComplete(unknown), false);
});

test("averageValidScores: only finite numeric scores participate; missing stays missing", () => {
  assert.equal(L.averageValidScores(["9".repeat(400)]), null, "numeric string overflowing to Infinity is rejected");
  assert.equal(L.averageValidScores([3, 2, 1]), 2);
  assert.equal(L.averageValidScores([3, null, 3, null, null]), 3, "nulls skipped, not zero");
  assert.equal(L.averageValidScores([3, 3, ...Array(9).fill(null)]), 3, "the live 0.5 case");
  assert.equal(L.averageValidScores(["2.50", 1.5]), 2, "numeric strings from Postgres numeric");
  assert.equal(L.averageValidScores([null, null]), null);
  assert.equal(L.averageValidScores([]), null);
  assert.equal(L.averageValidScores(null), null);
  assert.equal(L.averageValidScores([undefined, "", "  ", NaN, Infinity, -Infinity, "abc", "3x", {}, [], true, false]), null);
  assert.equal(L.averageValidScores([2, undefined, "", NaN, Infinity, "abc", false]), 2, "malformed values never become 0");
});

test("teamAverageFromChecklistRows: only coach-verified scores participate, averaged per checkpoint", () => {
  const row = (checkpoint_id, score, review_status) => ({ checkpoint_id, score, review_status });
  // 1. reviewed score participates
  assert.equal(L.teamAverageFromChecklistRows([row("load", 3, "verified")]), 3);
  // 2. unreviewed AI draft does not participate
  assert.equal(L.teamAverageFromChecklistRows([row("load", 1, "ai_draft")]), null);
  // 3. rejected does not participate, even if a score were somehow present
  assert.equal(L.teamAverageFromChecklistRows([row("load", null, "rejected"), row("stride", 1, "rejected")]), null);
  // 4. insufficient evidence / null do not participate
  assert.equal(L.teamAverageFromChecklistRows([row("load", null, "insufficient_evidence"), row("stride", 2, "insufficient_evidence"), row("hand-path", null, "verified")]), null);
  // 5. mixed reviewed + draft averages only reviewed (per-checkpoint mean, then mean across checkpoints)
  assert.equal(L.teamAverageFromChecklistRows([
    row("load", 3, "verified"), row("load", 2, "verified"), row("stride", 2, "verified"),
    row("stride", 1, "ai_draft"), row("head-eyes", 1, "ai_draft"), row("extension", null, "rejected"),
  ]), 2.25);
  // 6. no reviewed scores -> null (rendered as "—")
  assert.equal(L.teamAverageFromChecklistRows([]), null);
  assert.equal(L.teamAverageFromChecklistRows(null), null);
  // 7. valid numeric strings still work; malformed/non-finite values never become 0
  assert.equal(L.teamAverageFromChecklistRows([row("load", "3.00", "verified"), row("stride", "2", "verified")]), 2.5);
  assert.equal(L.teamAverageFromChecklistRows([row("load", "", "verified"), row("stride", "abc", "verified"), row("bat-path", Infinity, "verified")]), null);
  // Review state is never inferred from the score: a missing review_status is not verified.
  assert.equal(L.teamAverageFromChecklistRows([{ checkpoint_id: "load", score: 3 }, row("stride", 3, undefined)]), null);
});

test("priority status transitions: coach only, real statuses only, no no-ops", () => {
  assert.equal(L.canTransitionPriority("active", "monitoring"), true);
  assert.equal(L.canTransitionPriority("resolved", "active"), true); // reopen
  assert.equal(L.canTransitionPriority("active", "active"), false);
  assert.equal(L.canTransitionPriority("active", "fixed"), false);
  assert.equal(L.canTransitionPriority("active", "resolved", "ai"), false);
  // An observation of "resolved" only *suggests* resolving.
  assert.equal(L.suggestedPriorityStatus("resolved"), "resolved");
  assert.equal(L.suggestedPriorityStatus("improving"), null);
});

test("progress derives from the latest coach observation; none means needs review", () => {
  assert.equal(L.deriveProgress([]).label, "Needs review");
  const p = L.deriveProgress([
    { observed_at: "2026-09-02T00:00:00Z", status: "unchanged" },
    { observed_at: "2026-09-19T00:00:00Z", status: "improving" },
    { observed_at: "2026-08-12T00:00:00Z", status: "worse" },
  ]);
  assert.equal(p.label, "Improving");
  assert.equal(p.count, 3);
});

test("priorities order: active, then monitoring, then closed; by explicit order", () => {
  const ordered = L.orderPriorities([
    { id: "a", status: "monitoring", priority_order: 0, first_identified_at: "2026-01-01" },
    { id: "b", status: "active", priority_order: 2, first_identified_at: "2026-01-01" },
    { id: "c", status: "active", priority_order: 1, first_identified_at: "2026-02-01" },
    { id: "d", status: "resolved", priority_order: 0, first_identified_at: "2026-01-01" },
  ]);
  assert.deepEqual(ordered.map((p) => p.id), ["c", "b", "a", "d"]);
});

test("drill assignment suggestions come from tag mapping and skip already-assigned drills", () => {
  const lib = [
    { id: "1", target_tags: ["front-side-stability"], is_active: true },
    { id: "2", target_tags: ["hand-path"], is_active: true },
    { id: "3", target_tags: ["front-side-stability", "stride-consistency"], is_active: true },
    { id: "4", target_tags: ["front-side-stability"], is_active: false },
  ];
  const s = L.suggestDrills({ category: "front-side-stability" }, lib, ["3"]);
  assert.deepEqual(s.map((d) => d.id), ["1"]);
  assert.deepEqual(L.suggestDrills({ category: "other" }, lib), []);
  assert.deepEqual(L.suggestDrills({ category: null }, lib), []);
  assert.equal(L.guessCategory("Front side opens early"), "front-side-stability");
  assert.equal(L.guessCategory("Ball flight trending to high fly balls"), "loft-fly-ball");
});

test("follow-ups: due only after the qualifying event happened after they were set", () => {
  const base = { status: "active", follow_up_set_at: "2026-09-10T12:00:00Z" };
  const ctx = { now: new Date("2026-09-19T12:00:00Z"), practiceSessionDates: ["2026-09-08"], gameDates: [], swingDates: [] };
  assert.equal(L.isFollowUpDue({ ...base, follow_up_kind: "next_practice" }, ctx), false); // practice was before
  assert.equal(L.isFollowUpDue({ ...base, follow_up_kind: "next_practice" }, { ...ctx, practiceSessionDates: ["2026-09-16"] }), true);
  assert.equal(L.isFollowUpDue({ ...base, follow_up_kind: "next_game" }, { ...ctx, gameDates: ["2026-09-19"] }), true);
  assert.equal(L.isFollowUpDue({ ...base, follow_up_kind: "date", follow_up_date: "2026-09-18" }, ctx), true);
  assert.equal(L.isFollowUpDue({ ...base, follow_up_kind: "date", follow_up_date: "2026-09-30" }, ctx), false);
  const swings = { ...ctx, swingDates: ["2026-09-11T00:00:00Z", "2026-09-12T00:00:00Z", "2026-09-01T00:00:00Z"] };
  assert.equal(L.isFollowUpDue({ ...base, follow_up_kind: "after_swings", follow_up_swings: 2 }, swings), true);
  assert.equal(L.isFollowUpDue({ ...base, follow_up_kind: "after_swings", follow_up_swings: 3 }, swings), false);
  assert.equal(L.isFollowUpDue({ ...base, status: "resolved", follow_up_kind: "date", follow_up_date: "2026-01-01" }, ctx), false);
  assert.equal(L.isFollowUpDue({ ...base, follow_up_kind: "date", follow_up_date: "2026-01-01", follow_up_done_at: "2026-09-12" }, ctx), false);
});

test("game transfer: practice observation is paired with the next game observation, coach statuses only", () => {
  const obs = [
    { observed_at: "2026-09-16T10:00:00Z", context: "practice", status: "improving" },
    { observed_at: "2026-09-19T10:00:00Z", context: "game", status: "improving" },
    { observed_at: "2026-09-25T10:00:00Z", context: "practice", status: "improving" },
  ];
  const t = L.gameTransfer(obs);
  assert.equal(t.length, 2);
  assert.equal(t[0].result, "carried_over");
  assert.equal(t[0].game.observed_at, "2026-09-19T10:00:00Z");
  assert.equal(t[1].result, "awaiting_game");
  assert.equal(L.gameTransfer([{ observed_at: "2026-09-16T00:00:00Z", context: "practice", status: "improving" }, { observed_at: "2026-09-19T00:00:00Z", context: "game", status: "worse" }])[0].result, "not_carried_over");
  assert.equal(L.gameTransfer([{ observed_at: "2026-09-16T00:00:00Z", context: "practice", status: "improving" }, { observed_at: "2026-09-19T00:00:00Z", context: "game", status: "unchanged" }])[0].result, "partly_carried_over");
});

test("practice grouping and before/after: usable vs rejected counted, before/after needs both sets", () => {
  const reps = [
    { id: 1, grouping: "baseline", usable: true, hasClip: true },
    { id: 2, grouping: "baseline", usable: false, hasClip: true },
    { id: 3, grouping: "drill", usable: true, hasClip: true },
    { id: 4, grouping: "drill", usable: true, hasClip: true },
    { id: 5, grouping: "post_drill", usable: true, hasClip: true },
    { id: 6, grouping: "post_drill", usable: true, hasClip: false },
  ];
  const s = L.summarizePracticeSession({ outcome: null }, reps, { title: "Front-side stability", status: "active" });
  assert.equal(s.captured, 5);
  assert.equal(s.usable, 4);
  assert.equal(s.rejected, 1);
  assert.deepEqual(s.byGrouping, { baseline: 1, drill: 2, post_drill: 1, free_swing: 0, other: 0 });
  assert.equal(s.hasBeforeAfter, true);
  assert.equal(s.coachAssessment, null); // improvement is never fabricated
  assert.equal(L.beforeAfterSets(reps).ready, true);
  assert.equal(L.beforeAfterSets(reps.filter((r) => r.grouping !== "post_drill")).ready, false);
  assert.equal(L.summarizePracticeSession({ outcome: "mixed", outcome_note: "n" }, reps, null).coachAssessment, "Mixed");
});

test("comparison selection: needs two different swings; any source pairing allowed", () => {
  assert.equal(L.validateComparisonSelection(null, { clipId: "b" }).ok, false);
  assert.equal(L.validateComparisonSelection({ clipId: "a" }, { clipId: "a" }).ok, false);
  const practiceVsGame = L.validateComparisonSelection({ clipId: "a", context: "practice" }, { clipId: "b", context: "game" });
  assert.equal(practiceVsGame.ok, true);
});

test("phase alignment: same phase instant in both swings; null when a phase is missing", () => {
  const a = [{ slug: "contact", timeS: 5 }, { slug: "load", timeS: 3 }];
  const b = [{ slug: "contact", timeS: 9.5 }];
  const al = L.alignAroundPhase(a, b, "contact", 0.5);
  assert.deepEqual([al.startA, al.startB], [4.5, 9]);
  assert.equal(L.alignAroundPhase(a, b, "load"), null);
  assert.equal(L.phaseTime([{ slug: "follow-through", time_s: 2 }], "follow_through"), 2);
  assert.deepEqual(L.FRAME_PRESETS.map((p) => p.id), ["load-contact", "plant-contact", "contact-finish"]);
});

test("metric comparison never shows single-camera 3D reconstructions, whatever the quality label says", () => {
  const A = { max_bat_speed_value: 10, hip_shoulder_separation_at_contact_deg: 30, torso_tilt_at_contact_deg: 20, front_knee_angle_at_contact_deg: 140 };
  const rows = L.metricComparison(A, A, { reconstruction: "good" }, { reconstruction: "good" });
  assert.deepEqual(rows.map((r) => r.label), ["Bat speed (2D, body-relative)"], "3D joint angles are never rows, even when rated good");
  assert.ok(rows.every((r) => !/3D|reconstruct/i.test(`${r.source} ${r.note}`)));
});

test("metric comparison never labels an uncalibrated value a direct measurement, and every row carries a unit", () => {
  const A = { max_bat_speed_value: 10, attack_angle_at_contact_deg: -8, stride_length_hip_widths: 1.5, torso_tilt_at_contact_deg: 20 };
  const rows = L.metricComparison(A, A);
  assert.equal(rows.length, 3, "torso tilt (a 3D reconstruction) is not a row");
  for (const r of rows) {
    assert.doesNotMatch(r.source, /direct/i, r.label);
    assert.ok(r.unit, `${r.label} has a unit`);
  }
  const bat = rows.find((r) => r.label.startsWith("Bat speed"));
  assert.equal(bat.source, L.METRIC_SOURCE_2D);
  assert.match(bat.note, /not mph/);
  assert.deepEqual(L.metricComparison({ max_bat_speed_value: null }, {}), [], "withheld metrics produce no rows");
});

test("swing filters: two-strike swings, practice groups, reviewed state, no fabricated metadata", () => {
  const swings = [
    { clipId: "1", context: "game", date: "2026-09-19", swung: true, strikes: 2, balls: 1, reviewed: false, priorityIds: ["x"] },
    { clipId: "2", context: "game", date: "2026-09-19", swung: false, strikes: 2, balls: 0, reviewed: true },
    { clipId: "3", context: "practice", date: "2026-09-16", swung: true, strikes: null, balls: null, grouping: "post_drill", reviewed: true, drillIds: ["d"] },
    { clipId: "4", context: "game", date: "2026-09-12", swung: true, strikes: null, balls: null, reviewed: false, batConfidence: "poor" },
  ];
  const ids = (f) => L.filterSwings(swings, f).map((s) => s.clipId);
  assert.deepEqual(ids({ strikes: 2, swung: "swing" }), ["1"]);
  assert.deepEqual(ids({ context: "practice" }), ["3"]);
  assert.deepEqual(ids({ grouping: "post_drill" }), ["3"]);
  assert.deepEqual(ids({ priorityId: "x" }), ["1"]);
  assert.deepEqual(ids({ drillId: "d" }), ["3"]);
  assert.deepEqual(ids({ reviewed: "unreviewed" }), ["1", "4"]);
  assert.deepEqual(ids({ lowBatConfidence: true }), ["4"]);
  assert.deepEqual(ids({ dateFrom: "2026-09-15", dateTo: "2026-09-18" }), ["3"]);
  assert.deepEqual(ids({ strikes: 2 }), ["1", "2"]); // unknown counts are excluded, not matched
});

test("AI draft preservation: coach-reviewed issues are never replaced; review patches stamp the coach", () => {
  assert.equal(L.aiMayReplaceIssue({ review_status: "draft", reviewed_by: null }), true);
  assert.equal(L.aiMayReplaceIssue({ review_status: "approved", reviewed_by: "Coach" }), false);
  assert.equal(L.aiMayReplaceIssue({ review_status: "rejected", reviewed_by: "Coach" }), false);
  assert.equal(L.aiMayReplaceIssue({ review_status: "draft", reviewed_by: "Coach" }), false);
  assert.deepEqual(L.issueReviewPatch("approve", "Coach K"), { review_status: "approved", reviewed_by: "Coach K" });
  assert.equal(L.issueReviewPatch("edit", "Coach K", { issue: "x" }).review_status, "edited");
  assert.throws(() => L.issueReviewPatch("promote", "Coach K"));
});

test("player report filtering: only coach-confirmed strengths; progress from coach observations", () => {
  const rows = [
    { slug: "stance-setup", label: "Stance & setup", score: 3, reviewed_by: "Coach" },
    { slug: "load", label: "Load", score: 3, reviewed_by: null }, // unreviewed AI draft: never shown to a player
    { slug: "stride", label: "Stride", score: 2, reviewed_by: "Coach" },
  ];
  assert.deepEqual(L.strengthsFromChecklist(rows), ["Stance & setup"]);
  const series = L.progressSeries([
    { observed_at: "2026-09-19T00:00:00Z", status: "improving", coach_note: "Much more stable" },
    { observed_at: "2026-08-12T00:00:00Z", status: "worse", coach_note: "" },
  ]);
  assert.deepEqual(series.map((s) => s.label), ["Worse", "Improving"]);
  assert.equal(series[1].note, "Much more stable");
});

test("timeline: mixes games, practice, priorities, drills, status changes newest-first", () => {
  const t = L.buildTimeline({
    games: [{ id: "g", date: "2026-09-19", opponent: "Riverside", swingsAnalyzed: 2 }, { id: "g2", date: "2026-09-19", opponent: "Riverside", swingsAnalyzed: 0 }],
    practiceSessions: [{ id: "s", session_date: "2026-09-16", swingCount: 8, drillName: "Split-stance tee", outcome: "yes", outcome_note: "Much better" }],
    priorities: [{ title: "Front-side stability", first_identified_at: "2026-09-12T10:00:00Z" }],
    drillAssignments: [{ assigned_at: "2026-09-13T10:00:00Z", drillName: "Split-stance tee", priorityTitle: "Front-side stability" }],
    statusHistory: [
      { changed_at: "2026-09-12T10:00:00Z", from_status: null, to_status: "active", priorityTitle: "Front-side stability" },
      { changed_at: "2026-09-18T10:00:00Z", from_status: "active", to_status: "monitoring", priorityTitle: "Front-side stability" },
    ],
    observations: [{ observed_at: "2026-09-16T18:00:00Z", status: "improving", priorityTitle: "Front-side stability", coach_note: "Much better", context: "practice" }],
  });
  const kinds = t.map((e) => e.kind);
  assert.equal(kinds[0], "game"); // Sep 19
  assert.ok(t[0].detail.includes("2 at-bats") && t[0].detail.includes("2 swings analyzed"));
  assert.ok(kinds.indexOf("game") < kinds.indexOf("priority_status"));
  for (let i = 1; i < t.length; i++) assert.ok(new Date(t[i - 1].at) >= new Date(t[i].at), "newest first");
  // creation row is not double-reported as a status change
  assert.equal(t.filter((e) => e.kind === "priority_status").length, 1);
  assert.match(t.find((e) => e.kind === "practice").detail, /Coach: Improved/);
});

test("analysis quality labels: plain-language good/limited/poor, null when unavailable", () => {
  assert.equal(L.analysisQualityLabels(null), null);
  const q = L.analysisQualityLabels({ pose_coverage: 0.9, bat_coverage: 0.3, pose3d_coverage: 0.5, contact_confidence: "limited" });
  assert.equal(q.pose, "good");
  assert.equal(q.bat, "limited");
  assert.equal(q.reconstruction, "poor");
  assert.equal(q.contact, "limited");
});

test("coaching loop: each step's state comes from real rows; first open step is 'now'", () => {
  const p = { status: "active" };
  const l0 = L.coachingLoop(p, [], []);
  assert.deepEqual(l0.map((s) => s.state), ["done", "done", "now", "todo", "todo", "todo"]);
  const l1 = L.coachingLoop(p, [{ observed_at: "2026-09-16T10:00:00Z", context: "practice" }], [{ active: true }]);
  assert.deepEqual(l1.map((s) => s.state), ["done", "done", "done", "done", "now", "todo"]);
  const l2 = L.coachingLoop({ status: "resolved" }, [
    { observed_at: "2026-09-16T10:00:00Z", context: "practice" },
    { observed_at: "2026-09-19T10:00:00Z", context: "game" },
  ], [{ active: true }]);
  assert.ok(l2.every((s) => s.state === "done"));
  // an inactive (removed) assignment doesn't count as assigned
  assert.equal(L.coachingLoop(p, [], [{ active: false }])[2].done, false);
});

test("next focus: due follow-up, then unobserved, then worse/unchanged, then top priority", () => {
  const pr = [
    { id: "a", status: "active", priority_order: 0, first_identified_at: "2026-01-01" },
    { id: "b", status: "active", priority_order: 1, first_identified_at: "2026-01-01" },
    { id: "c", status: "resolved", priority_order: 0, first_identified_at: "2026-01-01" },
  ];
  const improving = { status: "improving" };
  assert.equal(L.nextFocus(pr, { a: improving, b: improving }, ["b"]).priority.id, "b");
  assert.equal(L.nextFocus(pr, { a: improving, b: { status: null } }).reason, "No coach observation yet");
  assert.equal(L.nextFocus(pr, { a: improving, b: { status: "worse" } }).reason, "Reported worse");
  assert.equal(L.nextFocus(pr, { a: improving, b: improving }).priority.id, "a");
  assert.equal(L.nextFocus([{ id: "z", status: "resolved" }], {}), null);
});

test("quality fallback: derived only from phase confidence and reconstruction flags, unknowns stay null", () => {
  const q = L.deriveQualityFromPhases([
    { slug: "contact", timeS: 5, confidence: "low" },
    { slug: "load", timeS: 3, reconstructionReliable: false },
    { slug: "stride", timeS: 4, reconstructionReliable: true },
  ], true);
  assert.equal(q.contact_confidence, "limited");
  assert.equal(q.reconstruction, "limited");
  assert.equal(q.pose_coverage, null);
  assert.equal(L.deriveQualityFromPhases([], false).reconstruction, "poor");
  assert.equal(L.deriveQualityFromPhases([{ slug: "contact", timeS: null }], true).contact_confidence, "poor");
  const labels = L.analysisQualityLabels(q);
  assert.equal(labels.pose, null);
  assert.equal(labels.reconstruction, "limited");
});

test("metric trends: only direct/coverage metrics, poor-quality clips dropped, needs 2+ points to show", () => {
  const rows = [
    { date: "2026-09-01", clipId: "a", metrics: { max_bat_speed_value: 10, stride_length_hip_widths: 2, hip_shoulder_separation_at_contact_deg: 40 }, quality: { bat_coverage: 0.9, pose_coverage: 0.9, contact_confidence: "good" }, loadToContactS: 0.6 },
    { date: "2026-09-08", clipId: "b", metrics: { max_bat_speed_value: 99 }, quality: { bat_coverage: 0.1, pose_coverage: 0.9, contact_confidence: "good" }, loadToContactS: 0.5 },
    { date: "2026-09-15", clipId: "c", metrics: { max_bat_speed_value: 12 }, quality: null, loadToContactS: null },
  ];
  const t = Object.fromEntries(L.robustMetricTrends(rows).map((x) => [x.key, x]));
  assert.equal(t.max_bat_speed.points.length, 2); // clip b has poor bat coverage -> its 99 is dropped
  assert.deepEqual(t.max_bat_speed.points.map((p) => p.value), [10, 12]);
  assert.equal(t.swing_duration_s.points.length, 2);
  assert.equal(t.stride_length_hip_widths.shown, false);
  assert.equal(t.bat_coverage.points[0].value, 90);
  assert.ok(!L.TREND_METRICS.some((m) => /separation|tilt|knee/.test(m.key)), "no reconstructed angles");
});
