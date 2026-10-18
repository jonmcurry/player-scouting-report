import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { scoreRun } from './scoreRun.ts';
import { compareRunsCli } from './compareRunsCli.ts';
import { disk, repo, writeRun } from './score/testing/fixtures.ts';
test('comparison CLI verifies scored sources and writes private and suppressed summary outside repo', async () => {
  const d = await disk();
  try {
    const base = d.input.run.run_id; await scoreRun(d.root, repo, base);
    d.input.run.run_id = 'run-0000000000000002'; await writeRun(d.input); await scoreRun(d.root, repo, d.input.run.run_id);
    await compareRunsCli(d.root, repo, base, d.input.run.run_id, true);
    for (const name of ['comparison.json', 'report.md', 'summary.md']) { const text = await readFile(join(d.root, 'results', `compare-${base}-${d.input.run.run_id}`, name), 'utf8'); assert.doesNotMatch(text, /[A-Z]:[\\/]|Users|\.(mp4|mov|png)\b/i); }
    await assert.rejects(compareRunsCli(d.root, repo, base, d.input.run.run_id), /EEXIST/);
    const scoredPath = join(d.root, 'results', base, 'metrics.json'), scored = JSON.parse(await readFile(scoredPath, 'utf8'));
    scored.metrics_digest = '0'.repeat(64); await writeFile(scoredPath, JSON.stringify(scored));
    await assert.rejects(compareRunsCli(d.root, repo, base, d.input.run.run_id), /METRICS_DIGEST_MISMATCH/);
  } finally { await d.cleanup(); }
});
