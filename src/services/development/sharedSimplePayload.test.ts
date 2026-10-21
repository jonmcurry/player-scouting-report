import test from "node:test";
import assert from "node:assert/strict";
import type { assembleReport } from "./reportAssembly.js";
import { sharedProgressPayload, sharedReportPayload } from "./sharedSimplePayload.js";

const drill = { id: "private-drill-id", name: "Tee drill", bestFor: "Staying balanced",
  equipment: "tee", homeFriendly: true, requiresScreen: false, instructions: "Use a tee.",
  cue: null, looksRightWhen: null, commonMistakes: [], demoUrl: null,
  demoTimestamp: null, sourceCredit: null };

test("shared Progress includes only display fields, not internal player/clip/drill IDs", () => {
  const source = { current: { concept: "balance", status: "improving", startedAt: "2026-10-01", seen: 1, windowSize: 5,
    privateNote: "private-current-note" },
    status: "improving", windowSize: 5,
    history: [{ concept: "balance", status: "fixed", startedAt: "2026-09-01", endedAt: "2026-09-30",
      privateNote: "private-history-note" }], practice: { seen: 1, total: 2 },
    focusDrill: drill, thenClipId: "private-then-id", nowClipId: "private-now-id",
    thenVideo: { clipId: "private-then-id", url: "https://example.test/then", contactTime: 1 },
    nowVideo: { clipId: "private-now-id", url: "https://example.test/now", contactTime: 2 } };
  const result = sharedProgressPayload(source, (text) => text);
  assert.equal(result.current?.concept, "balance");
  assert.equal(result.focusDrill?.name, "Tee drill");
  assert.deepEqual(result.thenVideo, { url: "https://example.test/then", contactTime: 1 });
  assert.doesNotMatch(JSON.stringify(result), /private-/);
});

test("shared report keeps coaching text but removes issue and drill IDs", () => {
  const report = { state: "ready", summary: "Balanced through contact.", strengths: ["Steady head"],
    fix: { id: "private-issue-id", concept: "balance", issue: "Front side opens",
      evidence: "Visible at contact", coachingCue: "Stay balanced", lookForNext: "Steady finish" },
    drills: [drill] } as unknown as ReturnType<typeof assembleReport>;
  const result = sharedReportPayload(report, (text) => text);
  assert.equal(result.state, "ready");
  assert.doesNotMatch(JSON.stringify(result), /private-/);
  assert.match(JSON.stringify(result), /Steady finish/);
});

test("shared ready reports with no supported fix keep a null fix", () => {
  const report = { state: "ready", summary: "A swing was visible.", strengths: [],
    fix: null, drills: [] } as unknown as ReturnType<typeof assembleReport>;
  assert.equal(sharedReportPayload(report, (text) => text).fix, null);
});

test("shared focus and fix concepts pass through identity redaction", () => {
  const progress = sharedProgressPayload({ current: { concept: "Private Team", status: "improving",
    startedAt: "2026-10-01", seen: 1, windowSize: 5 }, status: "improving", windowSize: 5,
    history: [{ concept: "Private Team", status: "fixed", startedAt: "2026-09-01", endedAt: "2026-09-30" }],
    practice: null, focusDrill: null, thenVideo: null, nowVideo: null },
  (text) => text.replaceAll("Private Team", "the team"));
  assert.equal(progress.current?.concept, "the team");
  assert.equal(progress.history[0]?.concept, "the team");
  const report = { state: "ready", summary: "A swing was visible.", strengths: [],
    fix: { id: "private-issue-id", concept: "Private Team", issue: "Front side opens",
      evidence: "Visible at contact", coachingCue: "Stay balanced", lookForNext: "Steady finish" },
    drills: [] } as unknown as ReturnType<typeof assembleReport>;
  assert.equal(sharedReportPayload(report, (text) => text.replaceAll("Private Team", "the team")).fix?.concept, "the team");
});

test("shared presentation copies exactly the contract and drops reason codes and extras", async () => {
  const { sharedPresentation } = await import("./sharedSimplePayload.ts");
  const { baselinePresentation } = await import("./reportPresentation.ts");
  const source = baselinePresentation({ status: "ready", report: { state: "ready", summary: "Swing", strengths: [], fix: null }, issues: [] });
  const result = sharedPresentation({ ...source, reasonCodes: ["PRIVATE"], privateNote: "private" } as typeof source);
  assert.deepEqual(result, source);
  assert.deepEqual(Object.keys(result).sort(), ["version", "engine", "engineOutcome", "analysisState", "fixState", "strengthsState", "summaryState", "familyReason", "limited", "reasonCodes", "momentLabel"].sort());
});

test("shared presentation has parity for every baseline branch", async () => {
  const { sharedPresentation } = await import("./sharedSimplePayload.ts");
  const { baselinePresentation, FAILURE_FAMILY_REASONS } = await import("./reportPresentation.ts");
  const ready = { state: "ready", summary: "Swing", strengths: [], fix: null };
  for (const input of [
    ...["pending", "processing"].map(status => ({ status })),
    ...Object.keys(FAILURE_FAMILY_REASONS).map(reason => ({ status: "failed", report: { reason } })),
    ...["no_swing", "unreadable"].map(state => ({ status: "ready", report: { state } })),
    ...[[], [{ hidden: true }], [{ hidden: false }]].map(issues => ({ status: "ready", report: ready, issues })),
    { status: "ready", report: { ...ready, fix: {}, strengths: ["Visible strength"] }, issues: [] }, null,
  ]) {
    const p = baselinePresentation(input);
    assert.deepEqual(sharedPresentation(p), p);
  }
});
