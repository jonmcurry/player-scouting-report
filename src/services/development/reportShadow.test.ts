import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import { reportShadowDecision, reportShadowLogLine, runReportShadow } from "./reportShadow.ts";

const clipId = "11111111-1111-4111-8111-111111111111";
const assessment = { clip_status: "eligible", family_reason: null, mode: "shadow", reliability_profile_version: null };
const report = { state: "ready", fix: { id: "issue-1", issue: "private text" }, summary: "private summary" };
const decision = (patch: Partial<Parameters<typeof reportShadowDecision>[0]> = {}) => reportShadowDecision({
  assessment, assessmentError: false, fixIssueId: "issue-1", fixClaimDecision: null, ...patch,
});

test("pure decisions distinguish present, absent, error and unknown status", () => {
  assert.deepEqual(decision(), { assessment: "present", wouldWithhold: false, wouldHideFix: true, reliability: "unmeasured" });
  assert.equal(decision({ assessment: { ...assessment, clip_status: "withhold" } }).wouldWithhold, true);
  assert.deepEqual(decision({ assessment: null, fixIssueId: null }), {
    assessment: "absent", wouldWithhold: null, wouldHideFix: false, reliability: "unmeasured" });
  assert.equal(decision({ assessmentError: true }).assessment, "error");
  assert.equal(decision({ assessmentError: true }).wouldWithhold, null);
  assert.equal(decision({ assessment: { ...assessment, clip_status: "invalid" } }).wouldWithhold, null);
});

test("stored claims cannot fabricate display authorization before calibration", () => {
  for (const fixClaimDecision of [null, {}, false, { displayable: false }, { displayable: true, reliability: { status: "within_ceiling" } }])
    assert.equal(decision({ fixClaimDecision }).wouldHideFix, true);
});

test("exact line format, validated UUID, and no private/internal payload", () => {
  assert.equal(reportShadowLogLine(clipId, decision()),
    `[report-shadow] clip=${clipId} assessment=present would_withhold=false would_hide_fix=true reliability=unmeasured`);
  const line = reportShadowLogLine("private-name\nsecret", decision({ assessment: null }));
  assert.equal(line, "[report-shadow] clip=invalid assessment=absent would_withhold=unknown would_hide_fix=true reliability=unmeasured");
  assert.doesNotMatch(line, /private|secret|subject|events|signals|issue-1|summary/);
});

for (const mode of ["off", "enforce", "", "SHADOW", "invalid"]) test(`${mode || "empty"} mode reads and logs nothing`, async () => {
  let reads = 0, logs = 0;
  const result = await runReportShadow({ mode, clipId, report,
    readAssessment: async () => { reads++; throw new Error("must not run"); },
    readFixDecision: async () => { reads++; throw new Error("must not run"); }, log: () => logs++ });
  assert.equal(result, undefined);
  assert.equal(reads, 0); assert.equal(logs, 0);
});

for (const state of ["present", "absent", "error", "throw", "timeout"] as const)
  test(`shadow ${state}: one diagnostic line, no report mutation or returned data`, async () => {
    const clone = structuredClone(report), logs: string[] = [];
    let fixReads = 0;
    const result = await runReportShadow({ mode: "shadow", clipId, report: clone, timeoutMs: 10,
      readAssessment: async () => {
        if (state === "throw") throw new Error("private driver text");
        if (state === "timeout") return new Promise(() => {});
        return { data: state === "present" ? assessment : null, error: state === "error" ? "private driver text" : null };
      },
      readFixDecision: async id => { fixReads++; assert.equal(id, "issue-1"); return { data: { claim_decision: null }, error: null }; },
      log: line => logs.push(line) });
    assert.equal(result, undefined); assert.deepEqual(clone, report); assert.equal(logs.length, 1);
    assert.ok(logs[0]!.includes(`assessment=${["throw", "timeout"].includes(state) ? "error" : state}`));
    assert.doesNotMatch(logs.join(), /private|driver|subject|events|signals/);
    assert.equal(fixReads, ["throw", "timeout"].includes(state) ? 0 : 1);
  });

test("late assessment after timeout starts no fix query and emits no second log", async () => {
  let resolve!: (v: { data: typeof assessment; error: null }) => void;
  let reads = 0; const logs: string[] = [];
  await runReportShadow({ mode: "shadow", clipId, report, timeoutMs: 5,
    readAssessment: () => new Promise(r => { resolve = r; }),
    readFixDecision: async () => { reads++; return { data: null, error: null }; }, log: l => logs.push(l) });
  resolve({ data: assessment, error: null });
  await new Promise(r => setTimeout(r, 5));
  assert.equal(reads, 0); assert.equal(logs.length, 1);
});

test("missing fix skips issue query; fix error/timeout and logger throws never escape", async () => {
  const lines: string[] = [];
  await runReportShadow({ mode: "shadow", clipId, report: { state: "unreadable" },
    readAssessment: async () => ({ data: null, error: null }),
    readFixDecision: async () => { assert.fail("no fix query"); }, log: l => lines.push(l) });
  assert.match(lines[0]!, /would_hide_fix=false/);
  for (const behavior of ["error", "throw", "timeout"]) {
    await runReportShadow({ mode: "shadow", clipId, report, timeoutMs: 5,
      readAssessment: async () => ({ data: assessment, error: null }),
      readFixDecision: async () => {
        if (behavior === "throw") throw new Error("private");
        if (behavior === "timeout") return new Promise(() => {});
        return { data: null, error: "private" };
      }, log: l => lines.push(l) });
    assert.match(lines.at(-1)!, /would_hide_fix=unknown/);
  }
  await assert.doesNotReject(runReportShadow({ mode: "shadow", clipId, report,
    readAssessment: async () => ({ data: null, error: null }), readFixDecision: async () => ({ data: null, error: null }),
    log: () => { throw new Error("logger failed"); } }));
});

test("Edge integration isolates private reads after redaction; default-off and demo never call shadow", () => {
  const source = fs.readFileSync(new URL("../../../supabase/functions/get-simplified-report/index.ts", import.meta.url), "utf8").replaceAll("\r\n", "\n");
  const start = source.indexOf('    if (!demo) {\n      let mode = "off";');
  assert.ok(start > source.indexOf("const report = assembleReport("));
  assert.ok(start > source.indexOf("report.drills = report.drills.map"));
  const end = source.indexOf("    return reply(", start);
  assert.ok(end > start);
  const block = source.slice(start, end);
  assert.match(block, /if \(mode === "shadow"\) await runReportShadow\(\{ mode, clipId, report: structuredClone\(report\)/);
  assert.match(block, /readAnalysisFlags\(\(k\) => Deno.env.get\(k\)\)\.reportGateMode/);
  assert.match(block, /catch \{\s+console.log\("\[report-shadow\] skipped: invalid_flags"\)/);
  assert.match(source, /import \{ readAnalysisFlags \} from "\.\.\/_shared\/analysisFlags.ts"/);
  const queries = [
    'service.from("clip_evidence_assessments")\n          .select("clip_status, family_reason, mode, reliability_profile_version").eq("video_clip_id", clipId)\n          .order("created_at", { ascending: false }).limit(1).maybeSingle()',
    'service.from("issues").select("claim_decision").eq("id", id).maybeSingle()',
  ];
  let scrubbed = source;
  for (const query of queries) { assert.ok(block.includes(query)); scrubbed = scrubbed.replace(query, ""); }
  assert.doesNotMatch(scrubbed, /claim_decision|evidence_assessment|clip_evidence_assessments/);
  assert.doesNotMatch(source.slice(end), /shadow|wouldWithhold|wouldHideFix|claim_decision|evidence_assessment/i);
  assert.match(source.slice(end), /report: shared \? sharedReportPayload\(report, sharedText\) : report/);
  assert.equal(source.match(/await runReportShadow/g)?.length, 1);
});
