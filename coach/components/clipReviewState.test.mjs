// One table of cases, run against BOTH copies of clipReviewState:
//   coach/components/clipReviewState.js           (served to the coach app)
//   supabase/functions/_shared/clipReviewState.ts (bundled into Edge Functions)
// Neither tree can import the other at runtime (static coach/ hosting vs. the
// supabase/functions deploy), so the rule is duplicated and this test keeps
// the copies from drifting. Node (>= 22.18 / 23.6) strips TypeScript types
// natively, so the .ts copy is imported here directly - test-only.
import { test } from "node:test";
import assert from "node:assert/strict";
import { clipReviewState as jsState, coachReviewLabel } from "./clipReviewState.js";

const { clipReviewState: tsState } = await import("../../supabase/functions/_shared/clipReviewState.ts");

const f = (...statuses) => statuses.map((review_status) => ({ review_status }));

const CASES = [
  // [description, row, findings, expected]
  ["pending upload", { status: "pending", analyzed: false }, [], "processing"],
  ["pipeline running", { status: "processing", analyzed: false }, [], "processing"],
  ["pipeline failed", { status: "failed", analyzed: false }, [], "failed"],
  ["failed wins over stray findings", { status: "failed", analyzed: true }, f("approved"), "failed"],
  ["not ready wins over findings", { status: "processing", analyzed: true }, f("draft"), "processing"],
  ["ready, never analyzed", { status: "ready", analyzed: false }, [], "processing"],
  ["ready, analyzed, zero findings", { status: "ready", analyzed: true }, [], "analyzed"],
  ["one draft finding", { status: "ready", analyzed: true }, f("draft"), "awaiting_coach"],
  ["any draft beats reviewed", { status: "ready", analyzed: true }, f("approved", "draft"), "awaiting_coach"],
  ["approved finding", { status: "ready", analyzed: true }, f("approved"), "reviewed"],
  ["edited finding", { status: "ready", analyzed: true }, f("edited"), "reviewed"],
  ["rejected finding (coach decided)", { status: "ready", analyzed: true }, f("rejected"), "reviewed"],
  ["reviewed finding without a run row", { status: "ready", analyzed: false }, f("approved"), "reviewed"],
  ["findings missing (null)", { status: "ready", analyzed: true }, null, "analyzed"],
];

for (const [name, row, findings, expected] of CASES) {
  test(`clipReviewState (js + ts): ${name} -> ${expected}`, () => {
    assert.equal(jsState(row, findings), expected, "js copy");
    assert.equal(tsState(row, findings), expected, "ts copy");
  });
}

/** clipReviewState's body (comments and whitespace removed). Line endings are
 * normalized first: with core.autocrlf=true the checkout is CRLF, and an
 * un-normalized "\n}\n" search would find nothing and compare "" to "". */
function ruleBody(source) {
  const src = source.replace(/\r\n?/g, "\n");
  const start = src.indexOf("export function clipReviewState");
  assert.ok(start >= 0, "clipReviewState definition found");
  const fn = src.slice(start);
  const open = fn.indexOf("{");
  const end = fn.indexOf("\n}\n");
  assert.ok(open > 0 && end > open, "clipReviewState body bounds found");
  const body = fn.slice(open, end + 2).replace(/\/\/.*$/gm, "").replace(/\s+/g, "");
  assert.ok(body.length > 20, "clipReviewState body is non-empty");
  return body;
}

test("the two copies have the same rule source (comments/types aside)", async () => {
  const fs = await import("node:fs");
  const path = await import("node:path");
  const url = await import("node:url");
  const here = path.dirname(url.fileURLToPath(import.meta.url));
  const js = ruleBody(fs.readFileSync(path.join(here, "clipReviewState.js"), "utf8"));
  const ts = ruleBody(fs.readFileSync(path.join(here, "../../supabase/functions/_shared/clipReviewState.ts"), "utf8"));
  assert.equal(js, ts);
});

test("the drift guard catches a drifted copy even with CRLF line endings", async () => {
  const fs = await import("node:fs");
  const lf = fs.readFileSync(new URL("./clipReviewState.js", import.meta.url), "utf8").replace(/\r\n/g, "\n");
  const crlf = (s) => s.replace(/\n/g, "\r\n");
  // Same rule, CRLF vs LF: equal and non-empty.
  assert.equal(ruleBody(crlf(lf)), ruleBody(lf));
  // A drifted copy (CRLF, in memory only) must compare unequal.
  const drifted = crlf(lf.replace('if (row.analyzed) return "analyzed";', 'if (row.analyzed) return "reviewed";'));
  assert.notEqual(drifted, crlf(lf), "the drift was injected");
  assert.notEqual(ruleBody(drifted), ruleBody(crlf(lf)));
  // A source with no body at all fails loudly instead of comparing "" to "".
  assert.throws(() => ruleBody("export function clipReviewState(row) { return 1; }"));
});

test("coachReviewLabel keeps the coach page's labels for ready clips", () => {
  assert.equal(coachReviewLabel("awaiting_coach"), "Waiting for coach review");
  assert.equal(coachReviewLabel("reviewed"), "Coach reviewed");
  assert.equal(coachReviewLabel("analyzed"), "Analyzed · nothing flagged");
  assert.equal(coachReviewLabel("processing"), "Not analyzed");
});

test("player.html uses clipReviewState instead of its own inline rule", async () => {
  const fs = await import("node:fs");
  const src = fs.readFileSync(new URL("../player.html", import.meta.url), "utf8");
  assert.match(src, /from "\.\/components\/clipReviewState\.js"/);
  assert.doesNotMatch(src, /statuses\.includes\("draft"\)/);
  const sw = fs.readFileSync(new URL("../sw.js", import.meta.url), "utf8");
  assert.ok(sw.includes('"./components/clipReviewState.js"'), "precached for the offline shell");
});
