import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { scoreRun, argumentsFor } from './scoreRun.ts';
import { disk, repo } from './score/testing/fixtures.ts';
test('score CLI writes deterministic safe outputs and refuses overwrite', async () => {
  const a = await disk(), b = await disk();
  try {
    await scoreRun(a.root, repo, a.input.run.run_id); await scoreRun(b.root, repo, b.input.run.run_id);
    for (const name of ['metrics.json', 'report.md']) { const bytes = await readFile(join(a.input.directory, name), 'utf8'); assert.equal(bytes, await readFile(join(b.input.directory, name), 'utf8')); assert.doesNotMatch(bytes, /[A-Z]:[\\/]|Users|\.(mp4|mov|png)\b/i); }
    await assert.rejects(scoreRun(a.root, repo, a.input.run.run_id), /RESULT_ALREADY_EXISTS/);
    assert.throws(() => argumentsFor(['--run', 'x', '--run', 'y'], ['--run']), /INVALID_ARGUMENTS/);
  } finally { await a.cleanup(); await b.cleanup(); }
});
