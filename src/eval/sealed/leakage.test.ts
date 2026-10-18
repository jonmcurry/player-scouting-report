import test from 'node:test';
import assert from 'node:assert/strict';
import { checkLeakage, checkTestRegistryMatchesMembership } from './leakage.ts';
import { registryClip } from '../benchmark/testing/fixtures.ts';
import { membership, testClip } from './testing/fixtures.ts';
test('exact membership sets and count required', () => {
  checkTestRegistryMatchesMembership([testClip()], membership());
  for (const key of ['eval_id', 'sha256', 'athlete_group'] as const) {
    const replacement = { eval_id: 'eval_0000000000000002', sha256: 'a'.repeat(64), athlete_group: 'group-00000002' };
    assert.throws(() => checkTestRegistryMatchesMembership([{ ...testClip(), [key]: replacement[key] }], membership()), { message: 'TEST_MEMBERSHIP_MISMATCH' });
  }
  assert.throws(() => checkTestRegistryMatchesMembership([], membership()), { message: 'TEST_MEMBERSHIP_MISMATCH' });
});
for (const [field, code] of [['eval_id', 'TEST_EVAL_ID_IN_CLEAR_REGISTRY'], ['sha256', 'TEST_SOURCE_IN_CLEAR_REGISTRY'], ['athlete_group', 'TEST_ATHLETE_GROUP_IN_CLEAR_REGISTRY']] as const) test(code, () => {
  const clear = { ...registryClip('eval_0000000000000002', 'a'.repeat(64)), athlete_group: 'group-00000002' };
  checkLeakage([clear], membership());
  assert.throws(() => checkLeakage([{ ...clear, [field]: testClip()[field] }], membership()), { message: code });
});
