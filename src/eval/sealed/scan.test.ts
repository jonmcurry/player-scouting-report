import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdir, writeFile, symlink } from 'node:fs/promises';
import { join, dirname } from 'node:path';
import { scanSealed, scanText } from './scan.ts';
import { tempRoot, cleanup, membership, testClip } from './testing/fixtures.ts';
test('scan every clear location, skip only sealed age files, redact values', async () => {
  const root = await tempRoot();
  try {
    const files = ['results/a.txt', 'cache/a', 'work/a', 'a.md', 'a.json', 'nested/deep/a', 'sealed/plain.txt', 'outside.age'];
    for (const file of [...files, 'sealed/results/x.tar.age']) { await mkdir(dirname(join(root, file)), { recursive: true }); await writeFile(join(root, file), testClip().eval_id + ' ' + testClip().sha256); }
    await writeFile(join(root, 'dev.txt'), 'eval_0000000000000002');
    const result = await scanSealed(root, membership()); assert.equal(result.clean, false); assert.equal(result.findings.length, files.length * 2);
    assert.ok(result.findings.every(f => files.includes(f.file) && f.count === 1));
    assert.ok(!JSON.stringify(result).includes(testClip().eval_id)); assert.ok(!JSON.stringify(result).includes(testClip().sha256));
  } finally { await cleanup(root); }
});
test('symlink refused even under encrypted exception', async () => {
  const root = await tempRoot(), target = await tempRoot();
  try { await mkdir(join(root, 'sealed')); await symlink(target, join(root, 'sealed/link.age'), 'junction');
    await assert.rejects(scanSealed(root, membership()), { message: 'SEALED_SYMLINK_REFUSED' });
  } finally { await cleanup(root); await cleanup(target); }
});

test('athlete-group content findings contain counts only; dev groups are clean', async () => {
  const root = await tempRoot(), group = testClip().athlete_group;
  try {
    await writeFile(join(root, 'dev.json'), JSON.stringify({ athlete_group: 'group-00000002' }));
    assert.deepEqual(await scanSealed(root, membership()), { clean: true, findings: [] });
    await writeFile(join(root, 'planted.md'), `"${group}" (${group})`);
    const result = await scanSealed(root, membership());
    assert.deepEqual(result, { clean: false, findings: [{ file: 'planted.md', kind: 'athlete_group', count: 2 }] });
    assert.ok(!JSON.stringify(result).includes(group));
  } finally { await cleanup(root); }
});
test('athlete-group scanning respects whole identifier boundaries', () => {
  const group = testClip().athlete_group;
  for (const token of [`prefix-${group}`, `${group}-suffix`, `X${group}`, `${group}X`, `_${group}`, `${group}_`]) {
    assert.deepEqual(scanText(token, 'boundary.txt', membership()), []);
  }
  assert.deepEqual(scanText(`${group}/${group}.${group}`, 'boundary.txt', membership()), [
    { file: 'boundary.txt', kind: 'athlete_group', count: 3 },
  ]);
});
test('athlete group in clear filename is refused without exposing the value', async () => {
  const root = await tempRoot(), group = testClip().athlete_group;
  try {
    await writeFile(join(root, group + '.json'), '{}');
    await assert.rejects(scanSealed(root, membership()), error => {
      assert.equal((error as Error).message, 'TEST_IDENTIFIER_IN_PATH');
      assert.ok(!String(error).includes(group)); return true;
    });
  } finally { await cleanup(root); }
});

for (const kind of ['eval_id', 'sha256', 'athlete_group'] as const) {
  for (const layout of ['empty', 'nested', 'sealed-empty', 'sealed-nested'] as const) {
    test(`directory name ${kind} refused without disclosure: ${layout}`, async () => {
      const root = await tempRoot(), identifier = testClip()[kind];
      try {
        const prefix = layout.startsWith('sealed-') ? 'sealed' : 'clear';
        const directory = join(root, prefix, identifier);
        await mkdir(directory, { recursive: true });
        if (layout.endsWith('nested')) {
          await mkdir(join(directory, 'nested'));
          // A sealed archive exception must not hide the parent directory name.
          await writeFile(join(directory, 'nested', 'output.tar.age'), 'synthetic');
        }
        await assert.rejects(scanSealed(root, membership()), error => {
          assert.equal((error as Error).message, 'TEST_IDENTIFIER_IN_PATH');
          assert.ok(!String(error).includes(identifier));
          assert.ok(!JSON.stringify(error).includes(identifier)); return true;
        });
      } finally { await cleanup(root); }
    });
  }
}
test('direct scanText callers still reject invalid membership', () => {
  assert.throws(() => scanText('safe text', 'safe.txt', { ...membership(), digest: '0'.repeat(64) }),
    { message: 'MEMBERSHIP_DIGEST_MISMATCH' });
});
