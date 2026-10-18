import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile, mkdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { COVERAGE_DEFINITIONS, preregistrationDigest, validatePreregistration, loadPreregistration, type CoveragePreregistration } from './preregistration.ts';
import { INITIAL_EVIDENCE_TUPLE, ENGINE_RUNTIME_EVIDENCE_TUPLE, assertEnforceableTuple } from '../../services/development/evidenceRegistry.ts';
import { validProfileStructure, validReliabilityEntry } from '../../services/development/evidence/reliability.ts';
import { inputs, observations, observation } from './testing/fixtures.ts';
import { eligibleDataset } from './eligibility.ts';
import { buildProfile, estimateEntries } from './reliabilityProfile.ts';
import { disk, writeRun, repo } from '../score/testing/fixtures.ts';
import { loadInputs } from '../score/inputs.ts';
import { assembleMetrics } from '../score/metrics.ts';
import { canonicalJson } from '../benchmark/registry.ts';
import { calibrate } from '../calibrateCli.ts';

// Synthetic owner choice only; production has no default or seeded policy.
function policy(minimum: number): CoveragePreregistration {
  const p: CoveragePreregistration = { schema: 'hitterloop.coverage-preregistration', schema_version: '1.0.0',
    policy_id: 'synthetic-policy', tuple: { ...INITIAL_EVIDENCE_TUPLE }, definitions: { ...COVERAGE_DEFINITIONS },
    minimum_measurable_coverage: minimum, registered_at: '2026-10-01T00:00:00.000Z', approved_by: 'reviewer-test', digest: '' };
  p.digest = preregistrationDigest(p); return p;
}
const start = '2026-10-02T00:00:00.000Z';
function withStart<T extends { run: object }>(i: T, value: unknown = start): T {
  Object.assign(i.run, { timing: { start: value } }); return i;
}
// Estimator-level helper: a supplied policy is treated as bound to the source runs.
const contact = (rows: ReturnType<typeof observations>, p: CoveragePreregistration | null, bound = p !== null) =>
  estimateEntries(rows, 1, [], p, bound).entries.find(e => e.concept === 'contact')!;
function bind<T extends { run: { config: object } }>(i: T, p: CoveragePreregistration): T {
  Object.assign(i.run.config, { coverage_preregistration_sha256: p.digest }); return i;
}

test('coverage hand computation includes unknowns, excludes failed and disabled observations', () => {
  const rows = observations(20, 5);
  rows[0]!.evidence.identity = 'wrong'; rows[1]!.evidence.identity = 'unknown';
  rows[2]!.v1 = 'unknown'; rows[3]!.v3 = 'unknown'; rows[4]!.v2 = {};
  rows.push(observation(1000, { v1: 'fail' }), observation(1001, { concept: 'timing' }));
  const e = contact(rows, policy(0.9));
  assert.equal(e.n_swings, 96); assert.equal(e.n_unmeasurable, 4);
  assert.equal(e.measurable_coverage, 96 / 100); assert.equal(e.observed_unsafe_rate, 1 / 96);
  assert.equal(e.coverage_gate, 'meets_preregistered_minimum');
  const empty = contact([observation(1, { v1: 'fail' })], policy(0.9));
  assert.equal(empty.measurable_coverage, null); assert.equal(empty.coverage_gate, 'not_applicable');
  const unknown = contact([observation(1, { v1: 'unknown' })], policy(0.9));
  assert.equal(unknown.measurable_coverage, 0); assert.equal(unknown.status, 'unmeasured');
});
test('known wrong evidence is a measurable unsafe pass even when another component is unknown', () => {
  const o = observation(); o.evidence.identity = 'unknown'; o.evidence.visibility = 'wrong';
  const e = contact([o], policy(0.9)); assert.equal(e.n_swings, 1); assert.equal(e.n_unmeasurable, 0);
  assert.equal(e.observed_unsafe_rate, 1); assert.equal(e.status, 'exceeds_ceiling');
  const u = observation(); u.evidence.identity = 'unknown';
  const f = contact([u], policy(0.9)); assert.equal(f.n_swings, 0); assert.equal(f.n_unmeasurable, 1);
});
test('coverage gates only downgrade D8 within_ceiling, never rescue other statuses', () => {
  const rows = observations(20, 5);
  const missing = contact(rows, null); assert.equal(missing.status, 'inconclusive');
  assert.equal(missing.reason, 'coverage_not_preregistered'); assert.equal(missing.coverage_gate, 'not_preregistered');
  const meets = contact(rows, policy(1)); assert.equal(meets.status, 'within_ceiling'); assert.equal(meets.reason, null);
  rows.push(observation(1000, { v3: 'unknown' }));
  const below = contact(rows, policy(1)); assert.equal(below.status, 'inconclusive');
  assert.equal(below.reason, 'coverage_below_preregistered_minimum'); assert.equal(below.measurable_coverage, 100 / 101);
  assert.equal(contact(rows, policy(100 / 101)).status, 'within_ceiling');
  const small = contact(observations(4, 1), policy(0.5)); assert.equal(small.status, 'inconclusive'); assert.equal(small.reason, 'insufficient_sample');
  const bad = observations(20, 5); bad.slice(0, 10).forEach(o => o.evidence.identity = 'wrong');
  for (const p of [null, policy(0.5)]) assert.equal(contact(bad, p).status, 'exceeds_ceiling');
  for (const e of [missing, meets, below, small]) assert.equal(validReliabilityEntry(e), true);
  for (const e of [missing, below]) assert.equal(validReliabilityEntry({ ...e, status: 'within_ceiling' }), false);
  assert.equal(validReliabilityEntry({ ...meets, status: 'inconclusive', reason: 'coverage_not_preregistered' }), false);
});
test('policy validation: digest, tuple, definitions, minimum and schema fail closed', () => {
  const good = policy(0.8); assert.deepEqual(validatePreregistration(good, INITIAL_EVIDENCE_TUPLE, [start]), good);
  assert.throws(() => validatePreregistration({ ...good, digest: 'b'.repeat(64) }, INITIAL_EVIDENCE_TUPLE, [start]), /DIGEST_MISMATCH/);
  assert.throws(() => validatePreregistration(good, ENGINE_RUNTIME_EVIDENCE_TUPLE, [start]), /TUPLE_MISMATCH/);
  assert.throws(() => validatePreregistration({ ...good, definitions: { ...good.definitions, numerator: 'safe only' } }, INITIAL_EVIDENCE_TUPLE, [start]), /DEFINITIONS_MISMATCH/);
  for (const minimum of [undefined, null, 0, -1, 1.1, NaN, Infinity, '0.8']) assert.throws(() =>
    validatePreregistration({ ...good, minimum_measurable_coverage: minimum }, INITIAL_EVIDENCE_TUPLE, [start]), /INVALID_COVERAGE_MINIMUM/);
  for (const patch of [{ schema_version: '9.0.0' }, { policy_id: 'email@example.com' }, { approved_by: 'name@example.com' },
    { registered_at: '2026-02-30T00:00:00.000Z' }]) assert.throws(() => validatePreregistration({ ...good, ...patch }, INITIAL_EVIDENCE_TUPLE, [start]), /INVALID_PREREGISTRATION/);
});
test('registration strictly precedes every source start; missing timing fails closed', async () => {
  const p = policy(0.9), i = withStart(await inputs());
  assert.equal(eligibleDataset([i], [], p).coverage_preregistration?.digest, p.digest);
  for (const time of [undefined, 'invalid', p.registered_at, '2026-09-30T00:00:00.000Z']) {
    const j = withStart(await inputs(2), time);
    // undefined passed explicitly to withStart uses its default; overwrite for this case.
    if (time === undefined) Object.assign(j.run, { timing: {} });
    assert.throws(() => eligibleDataset([i, j], [], p), /PREREGISTRATION_NOT_BEFORE_RESULTS/);
  }
});
test('profile 1.2.0 is deterministic, consistent and never enforceable; older schemas rejected', async () => {
  const d = eligibleDataset([bind(withStart(await inputs()), policy(0.9))], [], policy(0.9));
  const a = buildProfile(d, '2026-10-18', 1, observations());
  assert.equal(canonicalJson(a), canonicalJson(buildProfile(d, '2026-10-18', 1, observations())));
  assert.equal(a.entries.find(e => e.concept === 'contact')!.status, 'within_ceiling');
  assert.equal(a.schema_version, '1.2.0'); assert.equal(a.decision_status, 'experimental');
  assert.equal(a.coverage_preregistration?.bound_to_runs, true);
  assert.equal(validProfileStructure(a), true);
  for (const v of ['1.0.0', '1.1.0']) assert.equal(validProfileStructure({ ...a, schema_version: v }), false);
  assert.equal(validProfileStructure({ ...a, coverage_preregistration: null }), false);
  assert.throws(() => assertEnforceableTuple(a.tuple, a.tuple.engineCodeVersion));
  d.coverage_preregistration!.digest = 'b'.repeat(64);
  assert.throws(() => buildProfile(d, '2026-10-18', 1, observations()), /DIGEST_MISMATCH/);
});
test('production preregistration module exports no numeric coverage default', async () => {
  const source = await readFile('src/eval/calibrate/preregistration.ts', 'utf8');
  assert.doesNotMatch(source, /export\s+const\s+\w*(?:DEFAULT|MINIMUM)\w*\s*=\s*\d/i);
  assert.doesNotMatch(source, /minimum_measurable_coverage\s*(?:=|\?\?|\|\|)\s*\d/);
});
test('CLI reads policy only under preregistration and verifies source run.json timing', async () => {
  const v = withStart(await inputs()), f = await disk(v.clips);
  try {
    f.input.run = v.run; await writeRun(f.input);
    const loaded = await loadInputs(f.root, repo, v.run.run_id);
    await writeFile(join(loaded.directory, 'metrics.json'), canonicalJson(assembleMetrics(loaded, 1)));
    await mkdir(join(f.root, 'preregistration'));
    const path = join(f.root, 'preregistration', 'policy.json');
    await writeFile(path, canonicalJson(policy(0.9)));
    await assert.rejects(loadPreregistration(f.root, 'results/policy.json'), /EVAL_PATH_ESCAPE/);
    const p = await calibrate(f.root, repo, [v.run.run_id], [], '2026-10-18', 1, path);
    assert.equal(p.coverage_preregistration?.policy_id, 'synthetic-policy');
    const late = policy(0.9); late.registered_at = start; late.digest = preregistrationDigest(late);
    await writeFile(path, canonicalJson(late));
    await assert.rejects(calibrate(f.root, repo, [v.run.run_id], [], '2026-10-19', 1, path), /PREREGISTRATION_NOT_BEFORE_RESULTS/);
  } finally { await f.cleanup(); }
});

test('PR17: a policy not bound into every source run config never meets, so within_ceiling downgrades', async () => {
  const p = policy(0.9);
  const unbound = buildProfile(eligibleDataset([withStart(await inputs())], [], p), '2026-10-18', 1, observations());
  const e = unbound.entries.find(x => x.concept === 'contact')!;
  assert.equal(unbound.coverage_preregistration?.bound_to_runs, false);
  assert.equal(e.coverage_gate, 'not_bound_to_runs'); assert.equal(e.status, 'inconclusive'); assert.equal(e.reason, 'coverage_not_bound_to_runs');
  assert.equal(validReliabilityEntry(e), true); assert.equal(validReliabilityEntry({ ...e, status: 'within_ceiling', reason: null }), false);
  const other = policy(0.9); other.policy_id = 'other-synthetic-policy'; other.digest = preregistrationDigest(other);
  const wrong = buildProfile(eligibleDataset([bind(withStart(await inputs()), other)], [], p), '2026-10-18', 1, observations());
  assert.equal(wrong.entries.find(x => x.concept === 'contact')!.coverage_gate, 'not_bound_to_runs');
  const one = bind(withStart(await inputs()), p), two = withStart(await inputs(2));
  const partial = buildProfile(eligibleDataset([one, two], [], p), '2026-10-18', 1, observations());
  assert.equal(partial.entries.find(x => x.concept === 'contact')!.coverage_gate, 'not_bound_to_runs');
  assert.equal(contact(observations(20, 5), p, false).status, 'inconclusive');
});
