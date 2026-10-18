import assert from "node:assert/strict";
import { readdirSync } from "node:fs";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { spawnSync } from "node:child_process";

export const SERIAL_TEST_PATHS = Object.freeze([
  "dist/services/db/checklistUpsert.test.js",
  "dist/services/db/development.test.js",
  "dist/services/db/developmentFlows.test.js",
  "dist/services/db/methodology.test.js",
  "dist/services/db/uploadQueue.test.js",
  "dist/services/knowledge/methodologyRepository.test.js",
]);

// Preserve the explicit files from the original npm test command, exactly once.
export const EXPLICIT_TEST_PATHS = Object.freeze([
  "dist/services/analysisDepth/evidence.test.js",
  "dist/services/analysisDepth/captureAssessment.test.js",
  "dist/services/analysisDepth/attemptModel.test.js",
  "dist/services/analysisDepth/fingerprint.test.js",
  "dist/services/instruments/envelope.test.js",
]);

const repoRoot = fileURLToPath(new URL("../", import.meta.url));

export function listTestFiles(root, directory, suffix) {
  const files = [];
  for (const entry of readdirSync(path.join(root, directory), { withFileTypes: true })) {
    const relative = `${directory}/${entry.name}`;
    if (entry.isDirectory()) files.push(...listTestFiles(root, relative, suffix));
    else if (entry.isFile() && entry.name.endsWith(suffix)) files.push(relative);
  }
  return files.sort();
}

export function partitionTests(files) {
  assert.equal(new Set(files).size, files.length, "Duplicate compiled test path");
  assert.equal(new Set(SERIAL_TEST_PATHS).size, SERIAL_TEST_PATHS.length, "Duplicate serial test path");
  const all = new Set(files);
  for (const file of [...SERIAL_TEST_PATHS, ...EXPLICIT_TEST_PATHS]) {
    assert.ok(all.has(file), `Required compiled test missing: ${file}`);
  }
  const serialSet = new Set(SERIAL_TEST_PATHS);
  const parallel = files.filter(file => !serialSet.has(file)).sort();
  const serial = [...SERIAL_TEST_PATHS];
  assert.ok(parallel.every(file => !serialSet.has(file)), "Test appears in both stages");
  assert.equal(parallel.length + serial.length, all.size, "Test partition is incomplete");
  return { parallel, serial };
}

export function runCompiledTests(root = repoRoot, spawn = spawnSync) {
  const { parallel, serial } = partitionTests(listTestFiles(root, "dist", ".test.js"));
  let failed = false;
  for (const [stage, files, options] of [
    ["parallel", parallel, []],
    ["serial", serial, ["--test-concurrency=1"]],
  ]) {
    // An empty argument list would make Node discover tests outside this partition.
    if (files.length === 0) continue;
    console.log(`Compiled tests: ${stage} (${files.length} files)`);
    const result = spawn(process.execPath, ["--test", ...options, ...files], {
      cwd: root, stdio: "inherit",
    });
    if (result.error || result.status !== 0) {
      failed = true;
      console.error(`Compiled tests: ${stage} stage failed (${result.error?.code ?? result.signal ?? result.status})`);
    }
  }
  return failed ? 1 : 0;
}

if (process.argv[1] && pathToFileURL(path.resolve(process.argv[1])).href === import.meta.url) {
  try {
    process.exitCode = runCompiledTests();
  } catch (error) {
    console.error(`Compiled tests: discovery/partition stage failed: ${error.message}`);
    process.exitCode = 1;
  }
}
