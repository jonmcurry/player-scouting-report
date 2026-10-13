import assert from "node:assert/strict";
import test from "node:test";
import { execFileSync } from "node:child_process";
import { ANALYSIS_FLAG_KEYS, parseAnalysisFlags, readAnalysisFlags } from "./analysisFlags.ts";
import { flagCases } from "./analysisFlags.cases.ts";
import { INITIAL_EVIDENCE_TUPLE } from "../development/evidenceRegistry.ts";

for (const row of flagCases) {
  test(`flags: ${row.name}`, () => {
    if (row.expected === null) {
      assert.throws(() => parseAnalysisFlags(row.config));
      assert.throws(() => readAnalysisFlags(key => row.config[key]));
    } else {
      assert.deepEqual(parseAnalysisFlags(row.config), row.expected);
      assert.deepEqual(readAnalysisFlags(key => row.config[key]), row.expected);
    }
  });
}

test("Edge shim exposes the identical parser; acceptance table parity under Node", () => {
  // tsx keeps this test compatible with Node 20, which cannot load TS natively.
  const result = execFileSync(process.execPath, ["--import", "tsx", "--input-type=module", "-e", `
    import { parseAnalysisFlags, readAnalysisFlags } from './supabase/functions/_shared/analysisFlags.ts';
    import { flagCases } from './src/services/config/analysisFlags.cases.ts';
    console.log(JSON.stringify(flagCases.map(row =>
      [() => parseAnalysisFlags(row.config), () => readAnalysisFlags(key => row.config[key])]
        .map(parse => { try { return parse(); } catch { return null; } })
    )));
  `], { encoding: "utf8" });
  assert.deepEqual(JSON.parse(result), flagCases.map(row => [row.expected, row.expected]));
});

test("enforcement has no environment approval bypass and requires an exact observed tuple", () => {
  for (const key of ["EVIDENCE_GATE_MODE", "REPORT_EVIDENCE_GATE_MODE"]) {
    for (const tuple of [undefined, INITIAL_EVIDENCE_TUPLE, { ...INITIAL_EVIDENCE_TUPLE, reliabilityProfileVersion: "synthetic" }]) {
      assert.throws(() => parseAnalysisFlags({ [key]: "enforce", ALLOW_ENFORCE: "true",
        EVIDENCE_REGISTRY: "enforced", REVIEWER_APPROVED: "true" }, tuple));
    }
  }
});

test("reader requests only explicit keys, propagates read failures, and returns frozen flags", () => {
  const keys: string[] = [];
  assert.ok(Object.isFrozen(readAnalysisFlags(key => { keys.push(key); return undefined; })));
  assert.deepEqual(keys, ANALYSIS_FLAG_KEYS);
  assert.throws(() => readAnalysisFlags(() => { throw new Error("permission denied"); }), /permission denied/);
});

test("malformed objects fail; errors do not reflect private config values", () => {
  for (const value of [null, [], "off", new Date()]) {
    assert.throws(() => parseAnalysisFlags(value as never));
  }
  assert.throws(() => parseAnalysisFlags({ ANALYSIS_ENGINE: "secret-private-location" }), error =>
    error instanceof Error && !error.message.includes("secret-private-location"));
});
