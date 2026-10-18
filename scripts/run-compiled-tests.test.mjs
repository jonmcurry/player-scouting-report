import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import test from "node:test";
import { EXPLICIT_TEST_PATHS, SERIAL_TEST_PATHS, listTestFiles, partitionTests, runCompiledTests } from "./run-compiled-tests.mjs";

const root = fileURLToPath(new URL("../", import.meta.url));
const sourceTests = listTestFiles(root, "src", ".test.ts");
const compiledPath = source => source.replace(/^src\//, "dist/").replace(/\.ts$/, ".js");
const dbReference = /getSupabaseClient|createClient|SUPABASE_URL|SUPABASE_SERVICE_ROLE_KEY/;

test("every source test referencing Supabase is serialized", () => {
  const missing = sourceTests.filter(source => dbReference.test(readFileSync(new URL(`../${source}`, import.meta.url), "utf8")))
    .map(compiledPath).filter(compiled => !SERIAL_TEST_PATHS.includes(compiled));
  assert.deepEqual(missing, [], "Add DB-backed tests to SERIAL_TEST_PATHS");
});

test("serial test paths are unique and have existing source tests", () => {
  const compiled = new Set(sourceTests.map(compiledPath));
  assert.equal(new Set(SERIAL_TEST_PATHS).size, SERIAL_TEST_PATHS.length);
  assert.deepEqual(SERIAL_TEST_PATHS.filter(file => !compiled.has(file)), [], "Stale serial test path");
});

test("partition covers every compiled test once, including former explicit files", () => {
  const files = sourceTests.map(compiledPath);
  const { parallel, serial } = partitionTests(files);
  assert.deepEqual([...parallel, ...serial].sort(), files.sort());
  assert.ok(EXPLICIT_TEST_PATHS.every(file => parallel.includes(file)));
  assert.deepEqual(parallel, [...parallel].sort());
  assert.deepEqual(serial, [...serial].sort());
});

test("partition refuses missing required files and duplicate inputs before execution", () => {
  const files = sourceTests.map(compiledPath);
  for (const required of [...SERIAL_TEST_PATHS, ...EXPLICIT_TEST_PATHS]) {
    assert.throws(() => partitionTests(files.filter(file => file !== required)), /Required compiled test missing/);
  }
  assert.throws(() => partitionTests([...files, files[0]]), /Duplicate compiled test path/);
});

test("runner executes both stages in order and propagates either failure without DB access", t => {
  const fixture = mkdtempSync(path.join(os.tmpdir(), "compiled-tests-"));
  t.after(() => rmSync(fixture, { recursive: true, force: true }));
  const files = [...SERIAL_TEST_PATHS, ...EXPLICIT_TEST_PATHS, "dist/nested/example.test.js"];
  for (const file of files) {
    mkdirSync(path.dirname(path.join(fixture, file)), { recursive: true });
    writeFileSync(path.join(fixture, file), "");
  }
  for (const [results, expected] of [
    [[{ status: 0 }, { status: 0 }], 0],
    [[{ status: 1 }, { status: 0 }], 1],
    [[{ status: 0 }, { status: 1 }], 1],
    [[{ status: null, error: { code: "EPERM" } }, { status: 0 }], 1],
    [[{ status: 0 }, { status: null, signal: "SIGTERM" }], 1],
  ]) {
    const calls = [];
    const result = runCompiledTests(fixture, (executable, args, options) => {
      calls.push({ executable, args, options });
      return results[calls.length - 1];
    });
    assert.equal(result, expected);
    assert.equal(calls.length, 2);
    assert.equal(calls[0].executable, process.execPath);
    assert.deepEqual(calls[0].options, { cwd: fixture, stdio: "inherit" });
    assert.deepEqual(calls[0].args, ["--test", ...files.filter(file => !SERIAL_TEST_PATHS.includes(file)).sort()]);
    assert.deepEqual(calls[1].args, ["--test", "--test-concurrency=1", ...SERIAL_TEST_PATHS]);
  }
});
