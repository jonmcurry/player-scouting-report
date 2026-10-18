import test from 'node:test';
import assert from 'node:assert/strict';
import { buildMembership, validateMembership, parseTestRegistry, saltedHash } from './membership.ts';
import { sha256, canonicalJson, parseRegistry } from '../benchmark/registry.ts';
import { membership, testClip } from './testing/fixtures.ts';
test('membership canonical digest, domain separation and round trip', () => {
  const m = membership(); assert.deepEqual(validateMembership(JSON.parse(canonicalJson(m))), m);
  const { digest, ...body } = m; assert.equal(digest, sha256(canonicalJson(body)));
  assert.equal(saltedHash(m.salt, 'eval_id', testClip().eval_id), m.eval_id_hashes[0]);
  assert.notEqual(saltedHash(m.salt, 'eval_id', 'x'), saltedHash(m.salt, 'source_sha256', 'x'));
  assert.equal(buildMembership([], m.salt).count, 0);
});
for (const [field, value, code] of [
  ['schema', 'bad', 'MEMBERSHIP_INVALID_SCHEMA'], ['salt', 'A'.repeat(64), 'MEMBERSHIP_INVALID_SALT'],
  ['count', -1, 'MEMBERSHIP_INVALID_COUNT'], ['count', 2, 'MEMBERSHIP_INVALID_COUNT'],
  ['eval_id_hashes', ['b'.repeat(64), 'a'.repeat(64)], 'MEMBERSHIP_INVALID_HASHES'],
  ['source_sha256_hashes', ['a'.repeat(64), 'a'.repeat(64)], 'MEMBERSHIP_INVALID_HASHES'],
  ['athlete_group_hashes', ['bad'], 'MEMBERSHIP_INVALID_HASHES'], ['digest', '0'.repeat(64), 'MEMBERSHIP_DIGEST_MISMATCH'],
] as const) test(`membership rejects ${field}: ${code}`, () => {
  assert.throws(() => validateMembership({ ...membership(), [field]: value }), { message: code });
});
test('test parser enforces PR13 contract without weakening clear registry', () => {
  const line = (v: unknown[]) => v.map(canonicalJson).join('\n'); const header = { registry_version: 1 }, clip = testClip();
  assert.deepEqual(parseTestRegistry(line([header, clip])), [clip]);
  assert.throws(() => parseRegistry(line([header, clip])), { message: 'TEST_SPLIT_IN_CLEAR_REGISTRY' });
  for (const split of ['dev', 'validation', null]) assert.throws(() => parseTestRegistry(line([header, { ...clip, split }])), { message: 'TEST_REGISTRY_SPLIT_REQUIRED' });
  assert.throws(() => parseTestRegistry(line([header, clip, clip])), { message: 'DUPLICATE_EVAL_ID' });
  assert.throws(() => parseTestRegistry(line([header, clip, { ...clip, eval_id: 'eval_0000000000000002' }])), { message: 'DUPLICATE_SHA256' });
  assert.throws(() => parseTestRegistry(line([header, { ...clip, extra: true }])), { message: 'REGISTRY_UNKNOWN_KEYS' });
  assert.throws(() => parseTestRegistry(line([header, { ...clip, consent: {} }])), { message: 'REGISTRY_UNKNOWN_KEYS' });
  assert.throws(() => parseTestRegistry(line([{ registry_version: 2 }, clip])), { message: 'UNSUPPORTED_REGISTRY_VERSION' });
  assert.throws(() => parseTestRegistry('not json'), { message: 'REGISTRY_INVALID_JSON' });
});
