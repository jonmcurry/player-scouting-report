import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { checkEvaluationIsolation, inspectProductionSource } from './check-eval-isolation.mjs';

test('production source has no evaluation configuration or module access', () => {
  const result = checkEvaluationIsolation();
  assert.ok(result.checked > 100);
  assert.deepEqual(result.violations, []);
});

for (const source of [
  'process.env.HITTERLOOP_EVAL_ROOT',
  'process.env["HITTERLOOP_EVAL_BUCKET"]',
  'const { HITTERLOOP_EVAL_ROOT: root } = process.env;',
  'Deno.env.get("EVAL_STORAGE_BUCKET")',
  'Deno.env.get("HITTERLOOP_" + "EVAL_ROOT")',
  'Deno.env.get(`HITTERLOOP_${"EVAL_ROOT"}`)',
  'const key = "EVALUATION_PROJECT_ID"; process.env[key]',
  'import { run } from "../eval/runner.js";',
  'export * from "../../src/eval/config.ts";',
  'await import("../eval/" + "config.js");',
  'require("../eval/config.cjs")',
  'fs.readFileSync("EVAL-DATA/clip.json")',
  'const dir = "eval-results";',
]) test(`isolation detects syntax case ${JSON.stringify(source)}`, () => {
  assert.ok(inspectProductionSource(source).length > 0);
});

test('ordinary production storage and commentary about evaluation are allowed', () => {
  assert.deepEqual(inspectProductionSource('// HITTERLOOP_EVAL_ROOT is forbidden here\nprocess.env.GCS_BUCKET_NAME; Deno.env.get("SUPABASE_URL");'), []);
});

test('imported isolation guard defaults to its own checkout regardless of caller directory', t => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'eval-isolation-cwd-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const url = new URL('./check-eval-isolation.mjs', import.meta.url).href;
  const script = `const {checkEvaluationIsolation}=await import(${JSON.stringify(url)}); console.log(checkEvaluationIsolation().checked);`;
  assert.ok(Number(execFileSync(process.execPath, ['--input-type=module', '-e', script], { cwd: root, encoding: 'utf8' })) > 100);
});

test('scans shared dependencies and Edge code while evaluation and tests stay separate', t => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'eval-isolation-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const put = (name, source) => { fs.mkdirSync(path.dirname(path.join(root, name)), { recursive: true }); fs.writeFileSync(path.join(root, name), source); };
  put('src/cli/worker.ts', 'import "../shared/storage.js";');
  put('src/shared/storage.ts', 'process.env.HITTERLOOP_EVAL_ROOT');
  put('supabase/functions/_shared/storage.ts', 'Deno.env.get("HITTERLOOP_EVAL_BUCKET")');
  put('coach/app.js', 'const bucket = "production";');
  put('src/eval/config.ts', 'process.env.HITTERLOOP_EVAL_ROOT');
  put('src/shared/storage.test.ts', 'process.env.HITTERLOOP_EVAL_ROOT');
  assert.deepEqual(checkEvaluationIsolation(root).violations.map(v => v.file), ['src/shared/storage.ts', 'supabase/functions/_shared/storage.ts']);
  put('src/cli/worker.ts', 'import "../eval/config.js";');
  assert.equal(checkEvaluationIsolation(root).violations.length, 3);
});
