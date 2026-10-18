import test from 'node:test';
import assert from 'node:assert/strict';
import { eligibleDataset } from './eligibility.ts';
import { inputs } from './testing/fixtures.ts';

const awaitedDev = await inputs(3, 'dev');
test('only validation profiles and dev diagnostics; test always refused', async () => {
  assert.throws(() => eligibleDataset([]), /PROFILE_RUN_REQUIRED/);
  assert.throws(() => eligibleDataset([awaitedDev]), /PROFILE_SPLIT_MUST_BE_VALIDATION/);
  const validation = await inputs(), sealed = await inputs(2, 'test');
  assert.throws(() => eligibleDataset([sealed]), /TEST_SPLIT_REQUIRES_SEALED_ENVIRONMENT/);
  assert.throws(() => eligibleDataset([validation], [sealed]), /TEST_SPLIT_REQUIRES_SEALED_ENVIRONMENT/);
  assert.throws(() => eligibleDataset([validation], [structuredClone({ ...validation, run: { ...validation.run, run_id: 'run-0000000000000003' } })]), /DIAGNOSTIC_SPLIT_MUST_BE_DEV/);
});
test('athlete leakage, duplicate runs, IDs and source clips rejected', async () => {
  const v = await inputs(), d = await inputs(2, 'dev'); d.clips[0]!.registry.athlete_group = v.clips[0]!.registry.athlete_group;
  assert.throws(() => eligibleDataset([v], [d]), /ATHLETE_GROUP_LEAKAGE/);
  assert.throws(() => eligibleDataset([v, v]), /DUPLICATE_SOURCE_RUN/);
  const second = structuredClone(v); second.run.run_id = 'run-0000000000000002';
  assert.throws(() => eligibleDataset([v, second]), /DUPLICATE_EVAL_ID/);
  const alias = await inputs(4); alias.clips[0]!.registry.sha256 = v.clips[0]!.registry.sha256;
  assert.throws(() => eligibleDataset([v, alias]), /DUPLICATE_SOURCE_CLIP/);
});
test('mixed engine/environment/gate/claims tuples and unregistered source refused', async () => {
  for (const field of ['engineCodeVersion', 'environmentVersion', 'gateVersion', 'claimsVersion'] as const) {
    const v = await inputs(), other = await inputs(2);
    other.clips[0]!.record.gates!.tuple = { ...other.clips[0]!.record.gates!.tuple!, [field]: 'other-1' };
    assert.throws(() => eligibleDataset([v, other]), /MIXED_TUPLES/);
  }
  const v = await inputs(); v.run.tuples = []; v.clips[0]!.record.gates!.tuple = null;
  assert.throws(() => eligibleDataset([v]), /TUPLE_UNAVAILABLE/);
});
test('missing/invalid/draft/unresolved annotations excluded and counted', async () => {
  const good = await inputs(); const cases = await Promise.all([2, 3, 4, 5].map(n => inputs(n)));
  cases[0]!.clips[0]!.annotation = null;
  (cases[1]!.clips[0]!.annotation as any).sport = 'invalid';
  cases[2]!.clips[0]!.annotation!.annotation.review.status = 'draft';
  cases[3]!.clips[0]!.annotation!.annotation.review.status = 'draft';
  cases[3]!.clips[0]!.annotation!.annotation.review.disagreement = 'unresolved';
  const dataset = eligibleDataset([good, ...cases]);
  assert.deepEqual(dataset.exclusions, { annotation_missing: 1, annotation_invalid: 1, annotation_not_reviewed: 1, annotation_disagreement_unresolved: 1 });
  assert.equal(dataset.inputs.flatMap(i => i.clips).length, 1);
});
test('mixed origins refused; diagnostics contribute no entries or origins', async () => {
  const synthetic = await inputs(), privateRun = await inputs(2); privateRun.clips[0]!.annotation!.data_origin = 'private_consented';
  assert.throws(() => eligibleDataset([synthetic, privateRun]), /MIXED_DATA_ORIGIN/);
  const diagnostic = await inputs(3, 'dev'); diagnostic.clips[0]!.annotation!.data_origin = 'private_consented';
  assert.equal(eligibleDataset([synthetic], [diagnostic]).data_origin, 'synthetic');
  synthetic.clips[0]!.annotation = null;
  assert.throws(() => eligibleDataset([synthetic]), /NO_ELIGIBLE_ANNOTATIONS/);
});
test('excluded clip terminal environment cannot hide a mixed tuple', async () => {
  const i = await inputs();
  i.clips[0]!.record.status = 'excluded';
  i.clips[0]!.record.terminal = { environment: { environment_version: 'env-000000000001' } };
  assert.throws(() => eligibleDataset([i]), /MIXED_TUPLES/);
});
