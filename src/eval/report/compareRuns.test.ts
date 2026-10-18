import test from 'node:test';
import assert from 'node:assert/strict';
import { compareRuns, regressions } from './compareRuns.ts';
import { assembleMetrics } from '../score/metrics.ts';
import { pair } from '../score/events.ts';
import { fixture, input } from '../score/testing/fixtures.ts';
test('comparison refuses split/list mismatch; signed differences and CIs, all verdicts inconclusive', async () => {
  const clips = await Promise.all([1, 2, 3, 4, 5].map(fixture)), i = input(clips), base = assembleMetrics(i);
  assert.throws(() => compareRuns(base, { ...base, split: 'validation' }), /SPLIT_MISMATCH/);
  assert.throws(() => compareRuns(base, { ...base, clip_list_sha256: 'x' }), /CLIP_LIST_MISMATCH/);
  const candidateInput = structuredClone(i);
  for (const c of candidateInput.clips) pair(c, c.annotation!.swings[0]!, 'impact_estimate')!.engine.estimates[0]!.frame!.frame_index += 3;
  const candidate = assembleMetrics(candidateInput);
  for (const [b, c, sign] of [[base, candidate, 1], [candidate, base, -1]] as const) {
    const comparison = compareRuns(b, c), row = comparison.rows.find(r => r.id === 'E1.impact_estimate.frames.median')!;
    assert.equal(row.difference, 3 * sign); assert.deepEqual(row.ci95, [3 * sign, 3 * sign]);
    assert.ok(comparison.rows.every(r => r.verdict === 'inconclusive' && r.reason === 'no_preregistered_minimum_effect'));
  }
  assert.equal(regressions(i, candidateInput).length, 5);
});
test('ambiguous role match is not silently pooled or arbitrarily matched', async () => {
  const a = assembleMetrics(input([await fixture()])); const b = structuredClone(a); b.partitions.push({ ...structuredClone(b.partitions[0]!), key: 'another' });
  const c = compareRuns(a, b); assert.equal(c.rows.length, 0); assert.equal(c.unmatched_partitions.base.length, 1);
});
test('engine/environment version changes compare by role; failure absence is a real zero', async () => {
  const i = input(await Promise.all([1, 2, 3, 4, 5].map(fixture))), j = structuredClone(i);
  for (const c of j.clips) (c.record.gates!.tuple as unknown as Record<string, string>).engineCodeVersion = 'synthetic-2';
  j.failures = [{ eval_id: j.clips[0]!.record.eval_id, code: 'PIPELINE_FAILED' }];
  const result = compareRuns(assembleMetrics(i), assembleMetrics(j));
  const delta = result.failure_deltas.find(x => x.id === 'F1.failures.crash.PIPELINE_FAILED' && x.capture_profile === null)!;
  assert.equal(delta.base, 0); assert.equal(delta.candidate, 0.2); assert.equal(delta.difference, 0.2); assert.equal(result.unmatched_partitions.base.length, 0);
});
