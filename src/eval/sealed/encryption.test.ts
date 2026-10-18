import test from 'node:test';
import assert from 'node:assert/strict';
import { ageCliEncryptor, tarBundle } from './encryption.ts';
import { FakeEncryptor, tempRoot, cleanup } from './testing/fixtures.ts';
test('deterministic ustar headers, sort, padding, checksum and contents', async () => {
  const a = Buffer.from(tarBundle({ 'z.txt': Buffer.from('z'), 'a.txt': Buffer.from('abc') }));
  assert.deepEqual(a, tarBundle({ 'a.txt': Buffer.from('abc'), 'z.txt': Buffer.from('z') }));
  assert.equal(a.length, 3072); assert.equal(a.subarray(0, 5).toString(), 'a.txt');
  assert.equal(a.subarray(257, 263).toString(), 'ustar\0'); assert.equal(a.subarray(512, 515).toString(), 'abc');
  assert.equal(parseInt(a.subarray(100, 107).toString(), 8), 0o644);
  for (const [start, end] of [[108, 115], [116, 123], [136, 147]]) assert.equal(parseInt(a.subarray(start, end).toString(), 8), 0);
  const header = Buffer.from(a.subarray(0, 512)), checksum = parseInt(header.subarray(148, 154).toString(), 8); header.fill(32, 148, 156);
  assert.equal(header.reduce((n, b) => n + b, 0), checksum); assert.ok(a.subarray(-1024).every(b => b === 0));
  assert.notDeepEqual(await new FakeEncryptor().encrypt(a), a);
  for (const name of ['../x', '/x', 'x/../y', 'a'.repeat(101)]) assert.throws(() => tarBundle({ [name]: a }), { message: 'INVALID_TAR_NAME' });
});
test('age missing from PATH fails closed, invalid recipient refused', async () => {
  assert.throws(() => ageCliEncryptor('bad'), { message: 'INVALID_AGE_RECIPIENT' });
  const empty = await tempRoot();
  try { await assert.rejects(ageCliEncryptor('age1' + 'q'.repeat(58), { PATH: empty }).encrypt(Buffer.from('secret')), { message: 'AGE_UNAVAILABLE' }); }
  finally { await cleanup(empty); }
});
