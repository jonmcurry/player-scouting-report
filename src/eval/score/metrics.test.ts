import test from 'node:test';
import assert from 'node:assert/strict';
import { assembleMetrics, metricsDigest } from './metrics.ts';
import { canonicalJson } from '../benchmark/registry.ts';
import { fixture, input, exclude } from './testing/fixtures.ts';
import { renderRun } from '../report/renderRun.ts';
import type { InputClip } from './inputs.ts';
const terminal = (c: InputClip, environment = 'env-000000000001') => {
  exclude(c, 'engine_terminal_low_quality_footage'); c.record.artifacts = [];
  c.record.terminal = { environment: { environment_version: environment } }; return c;
};
test('terminal and pipeline failures share paired environment and lower coverage/detection exactly', async () => {
  const clips = [await fixture(), terminal(await fixture(2)), exclude(await fixture(3))];
  const i = input(clips), a = assembleMetrics(i), b = assembleMetrics(i);
  assert.equal(a.partitions.length, 1); const p = a.partitions[0]!;
  assert.deepEqual(p.identity, { engineCodeVersion: 'synthetic-1', instrumentationVersion: 'inst-1', environmentVersion: 'env-000000000001' });
  assert.equal(p.tuples.length, 1);
  for (const id of ['C1.paired', 'E2.impact_estimate', 'G1.v1.with_failures']) {
    const m = p.metrics.find(x => x.id === id)!;
    assert.equal(m.numerator, 1, id); assert.equal(m.denominator, 3, id); assert.equal(m.value, 1 / 3, id);
    assert.equal(p.slices[0]!.metrics.find(x => x.id === id)!.value, 1 / 3);
  }
  assert.equal(p.metrics.find(m => m.id === 'G1.v1')!.value, 1);
  assert.equal(canonicalJson(a), canonicalJson(b)); assert.equal(a.metrics_digest, metricsDigest(a));
  for (const m of [...p.metrics, ...p.slices.flatMap(s => s.metrics)]) assert.equal(m.status === 'measured', m.value !== null, m.id);
  assert.deepEqual(a.repeatability, i.run.repeatability); assert.equal('metrics' in a, false);
});
test('terminal recorded environment overrides preflight; different paired environments never pool', async () => {
  const clips = [await fixture(), terminal(await fixture(2), 'env-000000000002'), await fixture(3)];
  const gates = clips[2]!.record.gates!;
  gates.tuple = { ...gates.tuple!, environmentVersion: 'env-000000000002' };
  const m = assembleMetrics(input(clips)); assert.equal(m.partitions.length, 2);
  const first = m.partitions.find(p => p.key.includes('env-000000000001'))!;
  const second = m.partitions.find(p => p.key.includes('env-000000000002'))!;
  assert.equal(first.metrics.find(x => x.id === 'C1.paired')!.value, 1);
  assert.equal(second.metrics.find(x => x.id === 'C1.paired')!.value, 0.5);
});
test('data/governance exclusions only in data tally/taxonomy, never engine denominators', async () => {
  const codes = ['withdrawn', 'consent_eval_annotation_missing', 'annotation_missing', 'annotation_invalid', 'UNSUPPORTED_ANNOTATION_SCHEMA', 'media_missing', 'media_hash_mismatch', 'source_hash_mismatch'];
  const clips = [await fixture(), ...await Promise.all(codes.map(async (code, i) => exclude(await fixture(i + 2), code)))];
  const m = assembleMetrics(input(clips)); assert.equal(m.partitions.length, 1);
  assert.deepEqual(m.data_exclusions, Object.fromEntries(codes.map(c => [c, 1])));
  for (const id of ['C1.paired', 'E2.impact_estimate', 'G1.v1.with_failures']) assert.equal(m.partitions[0]!.metrics.find(x => x.id === id)!.denominator, 1);
  for (const code of codes) {
    const f = m.data_failure_metrics.find(x => x.id === `F1.exclusions.other.${code}`)!;
    assert.equal(f.numerator, 1); assert.equal(f.denominator, clips.length);
    assert.equal(m.partitions[0]!.metrics.find(x => x.id === f.id)!.numerator, 0);
  }
  assert.match(renderRun(m), /Data exclusions \(not engine coverage\)/);
  assert.match(renderRun(m), /consent_eval_annotation_missing/);
});
test('artifacts make otherwise ambiguous exclusion codes engine-attributable', async () => {
  const c = exclude(await fixture(2), 'source_hash_mismatch'); c.record.artifacts = [];
  const m = assembleMetrics(input([await fixture(), c]));
  assert.deepEqual(m.data_exclusions, {}); assert.equal(m.partitions[0]!.metrics.find(x => x.id === 'C1.paired')!.value, 0.5);
});
test('missing or ambiguous run instrumentation leaves failures explicitly unattributed', async () => {
  for (const versions of [[], ['inst-1', 'inst-2']]) {
    const i = input([await fixture(), exclude(await fixture(2))]);
    i.run.tuples = versions.map(instrumentationVersion => ({ instrumentationVersion }));
    const m = assembleMetrics(i), p = m.partitions.find(p => p.key === 'failures_unattributed')!;
    assert.equal(m.partitions.length, 2); assert.equal(p.metrics.find(x => x.id === 'C1.paired')!.value, 0);
    assert.equal(p.metrics.find(x => x.id === 'E2.impact_estimate')!.denominator, 1);
  }
});
test('not-evaluated paired clips retain tuple_unavailable', async () => {
  const c = await fixture(); c.record.gates = { status: 'not_evaluated', tuple: null, reason: 'tuple_unavailable' } as never;
  assert.equal(assembleMetrics(input([c])).partitions[0]!.key, 'tuple_unavailable');
});
test('distinct full tuples for one environment fail closed', async () => {
  for (const field of ['gateVersion', 'claimsVersion', 'reliabilityVersion']) {
    const clips = [await fixture(), await fixture(2)];
    (clips[1]!.record.gates!.tuple as unknown as Record<string, string>)[field] = 'different';
    assert.throws(() => assembleMetrics(input(clips)), /MIXED_TUPLES_IN_PARTITION/);
  }
});