import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { appendAccess } from './accessLog.ts';
import { sha256 } from '../benchmark/registry.ts';
import { tempRoot, cleanup, clock } from './testing/fixtures.ts';
const input = { operator: 'operator-0001', engine: 'engine-baseline-1.0.0', release_candidate: 'engine-baseline-1.0.0', config_sha256: 'a'.repeat(64), membership_digest: 'b'.repeat(64) };
test('access chain counts repeated executions, public line and tamper refusal', async () => {
  const root = await tempRoot();
  try {
    const first = await appendAccess(root, input, clock); const path = join(root, 'registry/test-access.jsonl');
    const text = await readFile(path, 'utf8'); assert.equal(first.record_sha256, sha256(text.slice(0, -1)));
    assert.equal(first.publicLine, `| ${clock()} | ${input.engine} | ${first.record_sha256} |`);
    const second = await appendAccess(root, input, clock);
    assert.notEqual(second.record_sha256, first.record_sha256);
    const lines = (await readFile(path, 'utf8')).trim().split('\n'); assert.equal(lines.length, 2); assert.equal(JSON.parse(lines[1]!).previous_line_sha256, first.record_sha256);
    await writeFile(path, lines.join('\n').replace('operator-0001', 'operator-0002') + '\n');
    await assert.rejects(appendAccess(root, input, clock), { message: 'ACCESS_LOG_CHAIN_BROKEN' });
  } finally { await cleanup(root); }
});
test('operator and UTC timestamp validation', async () => {
  const root = await tempRoot();
  try { for (const [operator, now] of [['bad', clock], [input.operator, () => 'invalid']] as const) await assert.rejects(appendAccess(root, { ...input, operator }, now), { message: 'ACCESS_INVALID_FIELDS' }); }
  finally { await cleanup(root); }
});
