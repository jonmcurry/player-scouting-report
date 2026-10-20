import assert from "node:assert/strict";
import test, { type TestContext } from "node:test";
import childProcess from "node:child_process";
import fs from "node:fs";
import { EventEmitter } from "node:events";
import path from "node:path";
import { PassThrough, Writable } from "node:stream";
import type { AnalysisInput } from "./analysisContext.js";
import { analyzeSwingViaClaudeCli } from "./claudeCliAnalyzer.js";
import { renderSwingAnalysisPrompt, SWING_ANALYSIS_JSON_SHAPE_INSTRUCTIONS, validateSwingAnalysisResult, validationContext } from "./swingAnalysisShared.js";
import { RENDERERS } from "./renderers.js";

const base: AnalysisInput = {
  player: { sport: "softball", level: "10U", ageBand: "8-10", bats: "R", throws: "R" },
  pitch: { location: null, zone: null, count: null, outcome: null, swung: null, pitchType: null },
  coachReviewedDecisions: [],
  swing: { frameNames: ["phase_contact.png", "phase_load.png"], pipelineVersion: "hitterloop-v2-exp-0.3.0", metrics: {}, reconstructionSupplied: false, excludedMeasurements: [] },
  knowledgePack: "No approved claims.", knowledgeClaimIds: [], knowledgeVersion: "synthetic",
};
const v2Input: AnalysisInput = { ...base, swing: { ...base.swing, v2Evidence: { supportedEvents: ["impact_estimate", "load_peak_estimate"] } } };
const issue = (extra: Record<string, unknown> = {}) => ({ issue: "Front shoulder opens early", seenInAtBats: "This swing", likelyCause: "May lead with the shoulder",
  effect: "May pull the barrel", evidence: "phase_contact shows the shoulder turned", coachingCue: "Stay closed", lookForNext: "Closed shoulder",
  confidence: "medium", phase: "contact", concept: "timing", basis: "video", contextExplainsIt: false, emergencySwingSuspected: false,
  knowledgeClaimIds: [], suggestPriority: false, ...extra });
const response = (issues: unknown[], strengths: unknown[] = []) => ({ noActionNeeded: issues.length === 0, noActionReason: issues.length ? null : "None.",
  summary: "A steady swing.", strengths, issues });
const options = (input: AnalysisInput) => ({ source: "claude" as const, aiModel: "double", ...validationContext(input) });

test("production validation and context are unchanged without v2Evidence", () => {
  assert.equal("v2Evidence" in validationContext(base), false);
  const r = validateSwingAnalysisResult(response([issue({ supportingEvents: ["anything"], claimType: "causal" })]), options(base));
  assert.equal("supportingEvents" in r.issues[0]!, false, "extra fields are ignored and not stored in production");
  assert.equal("claimType" in r.issues[0]!, false);
  // render-2.1 stays the only provider-enabled production renderer and still renders the unchanged prompt.
  assert.deepEqual(Object.keys(RENDERERS).sort(), ["render-2.1", "render-2.2"]);
});

test("v2 validation requires and preserves event citations and claim types", () => {
  const ok = validateSwingAnalysisResult(response([issue({ supportingEvents: ["impact_estimate"], claimType: "qualified_interpretation" })],
    [{ text: "Balanced load", evidence: "phase_load", phase: "load", supportingEvents: ["load_peak_estimate"], claimType: "direct_observation" }]), options(v2Input));
  assert.deepEqual([ok.issues[0]!.supportingEvents, ok.issues[0]!.claimType], [["impact_estimate"], "qualified_interpretation"]);
  assert.deepEqual(ok.strengths[0]!.supportingEvents, ["load_peak_estimate"]);
  for (const [extra, pattern] of [
    [{}, /supportingEvents must be a non-empty array/],
    [{ supportingEvents: [], claimType: "direct_observation" }, /supportingEvents must be a non-empty array/],
    [{ supportingEvents: ["swing_launch"], claimType: "direct_observation" }, /cites an event that was not supplied/],
    [{ supportingEvents: ["contact_confirmed"], claimType: "direct_observation" }, /cites an event that was not supplied/],
    [{ supportingEvents: ["impact_estimate", "impact_estimate"], claimType: "direct_observation" }, /must not repeat/],
    [{ supportingEvents: ["impact_estimate"] }, /claimType is invalid/],
    [{ supportingEvents: ["impact_estimate"], claimType: "causal" }, /claimType is invalid/],
  ] as const) assert.throws(() => validateSwingAnalysisResult(response([issue(extra)]), options(v2Input)), pattern);
  assert.throws(() => validateSwingAnalysisResult(response([], [{ text: "t", evidence: "e", phase: "load" }]), options(v2Input)), /strengths\[0\]\.supportingEvents/);
});

const envKeys = ["CLAUDE_CLI_DATA_CONFIRMED", "CLAUDE_CLI_MODEL"] as const;
const saved = Object.fromEntries(envKeys.map(k => [k, process.env[k]]));
test.afterEach(() => { for (const k of envKeys) { if (saved[k] === undefined) delete process.env[k]; else process.env[k] = saved[k]; } });

/** In-memory CLI double: no provider, model, network or real media. */
function cli(t: TestContext, result: unknown) {
  process.env.CLAUDE_CLI_DATA_CONFIRMED = "true";
  process.env.CLAUDE_CLI_MODEL = "synthetic-model";
  t.mock.method(fs, "readdirSync", () => ["phase_contact.png", "phase_load.png"] as any);
  t.mock.method(console, "warn", () => {});
  let prompt = "";
  const child = new EventEmitter() as childProcess.ChildProcessWithoutNullStreams;
  child.stdout = new PassThrough(); child.stderr = new PassThrough(); child.kill = () => true;
  child.stdin = new Writable({ write(chunk, _e, done) { prompt += chunk.toString(); done(); } });
  t.mock.method(childProcess, "spawn", () => {
    queueMicrotask(() => {
      child.stdout.emit("data", JSON.stringify({ is_error: false, result: JSON.stringify(result), modelUsage: { "synthetic-model-id": {} } }));
      child.emit("close", 0);
    });
    return child;
  });
  return { get prompt() { return prompt; } };
}

test("v2 provider path: production prompt + addendum, and an uncited response is rejected before storage", async t => {
  const addendum = "E. EXPERIMENTAL V2 EVENT EVIDENCE (render-v2-1.0.0)\nsynthetic addendum";
  const h = cli(t, response([issue({ supportingEvents: ["impact_estimate"], claimType: "direct_observation" })]));
  const r = await analyzeSwingViaClaudeCli("synthetic-frames", v2Input, { evidenceAddendum: addendum });
  assert.deepEqual(r.issues[0]!.supportingEvents, ["impact_estimate"]);
  assert.equal(h.prompt, [renderSwingAnalysisPrompt(v2Input), "", addendum, "", "Read each of these 2 frame image(s) before answering:",
    `- ${path.join("synthetic-frames", "phase_contact.png")}`, `- ${path.join("synthetic-frames", "phase_load.png")}`, "", SWING_ANALYSIS_JSON_SHAPE_INSTRUCTIONS].join("\n"));
  // The production section of the prompt is byte-identical to a run without v2 evidence.
  assert.equal(renderSwingAnalysisPrompt(v2Input), renderSwingAnalysisPrompt(base));
  cli(t, response([issue()]));
  await assert.rejects(analyzeSwingViaClaudeCli("synthetic-frames", v2Input, { evidenceAddendum: addendum }));
  cli(t, { not: "a report" });
  await assert.rejects(analyzeSwingViaClaudeCli("synthetic-frames", v2Input, { evidenceAddendum: addendum }));
});
