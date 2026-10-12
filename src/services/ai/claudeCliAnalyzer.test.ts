import assert from "node:assert/strict";
import test, { type TestContext } from "node:test";
import childProcess from "node:child_process";
import fs from "node:fs";
import { EventEmitter } from "node:events";
import { PassThrough, Writable } from "node:stream";
import type { AnalysisInput } from "./analysisContext.js";
import { analyzeSwingViaClaudeCli, requireClaudeDataConfirmation, resolvedModelIds } from "./claudeCliAnalyzer.js";
import { renderSwingAnalysisPrompt, SWING_ANALYSIS_JSON_SHAPE_INSTRUCTIONS } from "./swingAnalysisShared.js";
import path from "node:path";

test("resolvedModelIds records every concrete model the CLI reported, sorted", () => {
  assert.equal(
    resolvedModelIds({ modelUsage: { "claude-sonnet-5": {}, "claude-haiku-4-5-20251001": {} } }),
    "claude-haiku-4-5-20251001,claude-sonnet-5",
  );
});

test("resolvedModelIds is null, not the alias, when the CLI reported no usage", () => {
  assert.equal(resolvedModelIds({}), null);
  assert.equal(resolvedModelIds({ modelUsage: {} }), null);
});

const input: AnalysisInput = {
  player: { sport: "softball", level: "10U", ageBand: "8-10", bats: "R", throws: "R" },
  pitch: { location: null, zone: null, count: null, outcome: null, swung: null, pitchType: null },
  coachReviewedDecisions: [],
  swing: { frameNames: ["phase_contact.png"], pipelineVersion: "pose3d-live-1.0.0", metrics: {}, reconstructionSupplied: false, excludedMeasurements: [] },
  knowledgePack: "No approved claims.", knowledgeClaimIds: [], knowledgeVersion: "synthetic",
};
const privateMarker = "SYNTHETIC_PRIVATE_NAME https://example.invalid/clip?signature=SYNTHETIC_SECRET /private/synthetic-child/frame.png";
const validResult = JSON.stringify({ noActionNeeded: true, noActionReason: "Insufficient detail.", summary: "The batter is too small to assess.", strengths: [], issues: [] });
const envKeys = ["CLAUDE_CLI_DATA_CONFIRMED", "CLAUDE_CLI_MODEL", "GEMINI_PAID_SERVICE_CONFIRMED", "AGY_ANALYZER_DATA_CONFIRMED"] as const;
const originalEnv = Object.fromEntries(envKeys.map(key => [key, process.env[key]]));
test.afterEach(() => {
  for (const key of envKeys) {
    if (originalEnv[key] === undefined) delete process.env[key]; else process.env[key] = originalEnv[key];
  }
});

for (const flag of [undefined, "", "false", "TRUE", "True", " true", "true ", "1", "yes", privateMarker]) {
  test(`Claude gate rejects invalid confirmation case ${JSON.stringify(flag)?.length ?? 0}:${flag === undefined ? 'unset' : flag.slice(0, 5)}`, async t => {
    if (flag === undefined) delete process.env.CLAUDE_CLI_DATA_CONFIRMED; else process.env.CLAUDE_CLI_DATA_CONFIRMED = flag;
    process.env.GEMINI_PAID_SERVICE_CONFIRMED = "true";
    process.env.AGY_ANALYZER_DATA_CONFIRMED = "true";
    const reads = t.mock.method(fs, "readdirSync", () => { throw new Error(privateMarker); });
    const calls = t.mock.method(childProcess, "spawn", () => { throw new Error(privateMarker); });
    assert.throws(() => requireClaudeDataConfirmation(), /CLAUDE_CLI_DATA_CONFIRMED=true/);
    await assert.rejects(analyzeSwingViaClaudeCli(privateMarker, input, { evidenceAddendum: privateMarker }), (error: Error) => {
      assert.match(error.message, /CLAUDE_CLI_DATA_CONFIRMED=true/);
      assert.ok(!error.message.includes(privateMarker));
      return true;
    });
    assert.equal(reads.mock.callCount(), 0);
    assert.equal(calls.mock.callCount(), 0);
  });
}

/** An in-memory process double: no provider, files, model or real media is used. */
function cliHarness(t: TestContext, options: { stdout?: string; stderr?: string; code?: number; failure?: "spawn" | "stdin" | "sync" } = {}) {
  process.env.CLAUDE_CLI_DATA_CONFIRMED = "true";
  process.env.CLAUDE_CLI_MODEL = "synthetic-model";
  t.mock.method(fs, "readdirSync", () => ["phase_contact.png"] as any);
  const logs: string[] = [];
  t.mock.method(console, "warn", (...args: unknown[]) => logs.push(args.join(" ")));
  let prompt = "";
  const child = new EventEmitter() as childProcess.ChildProcessWithoutNullStreams;
  child.stdout = new PassThrough(); child.stderr = new PassThrough();
  child.kill = () => true;
  child.stdin = new Writable({ write(chunk, _encoding, callback) { prompt += chunk.toString(); callback(); } });
  const spawn = t.mock.method(childProcess, "spawn", (..._args: unknown[]) => {
    if (options.failure === "sync") throw new Error(privateMarker);
    queueMicrotask(() => {
      if (options.failure === "spawn") child.emit("error", new Error(privateMarker));
      else if (options.failure === "stdin") child.stdin.emit("error", new Error(privateMarker));
      else {
        child.stdout.emit("data", options.stdout ?? JSON.stringify({ is_error: false, result: validResult, modelUsage: { "synthetic-model-id": {} } }));
        child.stderr.emit("data", options.stderr ?? privateMarker);
        child.emit("close", options.code ?? 0);
      }
    });
    return child;
  });
  return { spawn, logs, get prompt() { return prompt; } };
}

test("explicit Claude confirmation preserves the request, CLI settings and validated result", async t => {
  const h = cliHarness(t);
  const result = await analyzeSwingViaClaudeCli("synthetic-frames", input);
  assert.equal(result.noActionNeeded, true);
  assert.equal(result.aiModel, "synthetic-model");
  assert.equal(result.aiModelVersion, "synthetic-model-id");
  assert.equal(h.spawn.mock.callCount(), 1);
  assert.deepEqual(h.spawn.mock.calls[0]!.arguments, ["claude", ["-p", "--output-format", "json", "--allowedTools", "Read", "--model", "synthetic-model"], { cwd: process.cwd(), shell: process.platform === "win32" }]);
  assert.equal(h.prompt, [renderSwingAnalysisPrompt(input), "", "Read each of these 1 frame image(s) before answering:", `- ${path.join("synthetic-frames", "phase_contact.png")}`, "", SWING_ANALYSIS_JSON_SHAPE_INSTRUCTIONS].join("\n"));
  assert.deepEqual(h.logs, []);
});

for (const options of [
  { code: 1, stdout: privateMarker, stderr: privateMarker },
  { stdout: privateMarker },
  { stdout: "null" },
  { stdout: JSON.stringify({ is_error: true, result: privateMarker }) },
  { stdout: JSON.stringify({ is_error: false, result: privateMarker }) },
  { stdout: JSON.stringify({ is_error: false, result: JSON.stringify({ issues: privateMarker }) }) },
  { failure: "spawn" as const }, { failure: "stdin" as const }, { failure: "sync" as const },
]) test("CLI failures do not expose private diagnostics", async t => {
  const h = cliHarness(t, options);
  await assert.rejects(analyzeSwingViaClaudeCli("synthetic-frames", input), (error: Error) => {
    assert.ok(!error.message.includes(privateMarker)); assert.ok(!error.stack?.includes("SYNTHETIC_SECRET")); return true;
  });
  assert.ok(!h.logs.join("\n").includes(privateMarker));
});

test("provider prose and permission details never enter logs", async t => {
  const h = cliHarness(t, { stdout: JSON.stringify({ is_error: false, result: `\`\`\`json\n${validResult}\n\`\`\`\n${privateMarker}`, permission_denials: [{ payload: privateMarker }] }) });
  assert.equal((await analyzeSwingViaClaudeCli("synthetic-frames", input)).noActionNeeded, true);
  assert.equal(h.logs.length, 2);
  assert.ok(h.logs.every(line => !line.includes(privateMarker) && /privacy/.test(line)));
});

test("filesystem errors and empty directories never reveal private paths", async t => {
  const h = cliHarness(t);
  t.mock.method(fs, "readdirSync", () => { throw new Error(privateMarker); });
  await assert.rejects(analyzeSwingViaClaudeCli(privateMarker, input), (error: Error) => !error.message.includes(privateMarker));
  t.mock.method(fs, "readdirSync", () => []);
  await assert.rejects(analyzeSwingViaClaudeCli(privateMarker, input), /No image files found in the local analysis frames directory/);
  assert.equal(h.spawn.mock.callCount(), 0);
});
