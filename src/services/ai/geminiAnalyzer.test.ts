import assert from "node:assert/strict";
import test from "node:test";
import { ApiError, type GoogleGenAI } from "@google/genai";
import type { AnalysisInput } from "./analysisContext.js";
import { GEMINI_MAX_ATTEMPTS, analyzeSwing } from "./geminiAnalyzer.js";

const FAKE_KEY = "AQ.test-fake-key-0123456789";
const frames = [{ data: Buffer.from("png"), mimeType: "image/png" }];
const input: AnalysisInput = {
  player: { sport: "softball", level: "10U", ageBand: "8-10", bats: "R", throws: "R" },
  pitch: { location: null, zone: null, count: null, outcome: null, swung: null, pitchType: null },
  coachReviewedDecisions: [],
  swing: { frameNames: ["phase_contact.png"], pipelineVersion: "pose3d-live-1.0.0", metrics: {}, reconstructionSupplied: false, excludedMeasurements: [] },
  knowledgePack: "No approved claims.", knowledgeClaimIds: [], knowledgeVersion: "k-0.2.0",
};
const validNoAction = JSON.stringify({
  noActionNeeded: true, noActionReason: "Stills are too small to judge.",
  summary: "The batter is too small to describe this swing reliably.", strengths: [], issues: [],
});

// Scripted fake client: each step either throws the given error or returns a response with that text.
function harness(steps: (Error | string)[]) {
  let calls = 0;
  const sleeps: number[] = [];
  const logs: string[] = [];
  const client = {
    models: {
      generateContent: async () => {
        const step = steps[Math.min(calls, steps.length - 1)];
        calls++;
        if (step instanceof Error) throw step;
        return { text: step, modelVersion: "gemini-3.8-flash-test" };
      },
    },
  } as unknown as Pick<GoogleGenAI, "models">;
  const deps = { client, sleep: async (ms: number) => { sleeps.push(ms); }, random: () => 0.5, log: (l: string) => logs.push(l) };
  return { deps, get calls() { return calls; }, sleeps, logs };
}
const apiError = (status: number, message = `{"error":{"code":${status}}}`) => new ApiError({ status, message });

const savedEnv = { model: process.env.GEMINI_MODEL, key: process.env.GEMINI_API_KEY,
  paid: process.env.GEMINI_PAID_SERVICE_CONFIRMED };
test.beforeEach(() => {
  process.env.GEMINI_MODEL = "gemini-3.8-flash";
  process.env.GEMINI_API_KEY = FAKE_KEY;
  process.env.GEMINI_PAID_SERVICE_CONFIRMED = "true";
});
test.afterEach(() => {
  for (const [name, value] of [["GEMINI_MODEL", savedEnv.model], ["GEMINI_API_KEY", savedEnv.key],
    ["GEMINI_PAID_SERVICE_CONFIRMED", savedEnv.paid]] as const) {
    if (value === undefined) delete process.env[name]; else process.env[name] = value;
  }
});

test("503 then success retries and returns the validated result with provenance", async () => {
  const h = harness([apiError(503), validNoAction]);
  const result = await analyzeSwing(frames, input, h.deps);
  assert.equal(h.calls, 2);
  assert.equal(result.noActionNeeded, true);
  assert.equal(result.aiModel, "gemini-3.8-flash");
  assert.equal(result.aiModelVersion, "gemini-3.8-flash-test");
  assert.deepEqual(h.sleeps, [1250]); // ~1s base + jitter
  assert.match(h.logs[0] ?? "", /attempt 1\/4 failed: HTTP 503; retrying/);
});

test("repeated 503 stops after max attempts and rethrows the final provider error", async () => {
  const last = apiError(503, "final 503 body");
  const h = harness([apiError(503), apiError(503), apiError(503), last]);
  await assert.rejects(analyzeSwing(frames, input, h.deps), (err) => err === last);
  assert.equal(h.calls, GEMINI_MAX_ATTEMPTS);
  assert.equal(h.sleeps.length, GEMINI_MAX_ATTEMPTS - 1);
  const [s1 = 0, s2 = 0, s3 = 0] = h.sleeps;
  assert.ok(s1 < s2 && s2 < s3, "backoff grows");
  assert.match(h.logs.at(-1)!, /attempt 4\/4 failed: HTTP 503; retries exhausted/);
});

test("429 is retried", async () => {
  const h = harness([apiError(429), apiError(429), validNoAction]);
  const result = await analyzeSwing(frames, input, h.deps);
  assert.equal(h.calls, 3);
  assert.equal(result.noActionNeeded, true);
});

test("every listed transient status is retried; 400/401/402/403 are not", async () => {
  for (const status of [408, 500, 502, 504]) {
    const h = harness([apiError(status), validNoAction]);
    await analyzeSwing(frames, input, h.deps);
    assert.equal(h.calls, 2, `status ${status}`);
  }
  for (const status of [400, 401, 402, 403]) {
    const h = harness([apiError(status), validNoAction]);
    await assert.rejects(analyzeSwing(frames, input, h.deps), (err: { status?: number }) => err.status === status);
    assert.equal(h.calls, 1, `status ${status}`);
    assert.equal(h.sleeps.length, 0);
    assert.match(h.logs[0] ?? "", /not retryable/);
  }
});

test("400 does not retry", async () => {
  const h = harness([apiError(400), validNoAction]);
  await assert.rejects(analyzeSwing(frames, input, h.deps), (err: { status?: number }) => err.status === 400);
  assert.equal(h.calls, 1);
});

test("schema validation failure does not retry", async () => {
  const h = harness([JSON.stringify({ issues: [] }), validNoAction]);
  await assert.rejects(analyzeSwing(frames, input, h.deps), /noActionNeeded/);
  assert.equal(h.calls, 1);
  assert.equal(h.sleeps.length, 0);
});

test("an empty (e.g. safety-blocked) response and a status-less network error do not retry", async () => {
  const blocked = harness(["", validNoAction]);
  await assert.rejects(analyzeSwing(frames, input, blocked.deps), /no text content/);
  assert.equal(blocked.calls, 1);
  const network = harness([new TypeError("fetch failed"), validNoAction]);
  await assert.rejects(analyzeSwing(frames, input, network.deps), /fetch failed/);
  assert.equal(network.calls, 1);
});

test("the API key never appears in retry logs or the final error", async () => {
  const h = harness([apiError(503, `overloaded key=${FAKE_KEY}`), apiError(403, `denied for ${FAKE_KEY}`)]);
  let thrown: unknown;
  await analyzeSwing(frames, input, h.deps).catch((e) => { thrown = e; });
  assert.ok(thrown instanceof ApiError);
  assert.equal(thrown.status, 403);
  assert.ok(!thrown.message.includes(FAKE_KEY));
  assert.match(thrown.message, /\[REDACTED\]/);
  assert.ok(h.logs.length === 2 && h.logs.every((l) => !l.includes(FAKE_KEY)));
});

test("the API key is scrubbed from a stack trace that was materialised before redaction", async () => {
  const err = apiError(401, `bad key ${FAKE_KEY}`);
  assert.ok(err.stack?.includes(FAKE_KEY)); // accessed first, so V8 has already captured the key
  const h = harness([err]);
  await assert.rejects(analyzeSwing(frames, input, h.deps), (e: Error) => e === err && !e.message.includes(FAKE_KEY) && !(e.stack ?? "").includes(FAKE_KEY));
});

test("an unlisted status (404) and malformed JSON do not retry", async () => {
  const notFound = harness([apiError(404), validNoAction]);
  await assert.rejects(analyzeSwing(frames, input, notFound.deps), (e: { status?: number }) => e.status === 404);
  assert.equal(notFound.calls, 1);
  const malformed = harness(["{not json", validNoAction]);
  await assert.rejects(analyzeSwing(frames, input, malformed.deps), SyntaxError);
  assert.equal(malformed.calls, 1);
});
