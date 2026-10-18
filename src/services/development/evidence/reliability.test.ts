import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { lookupReliability, PRODUCTION_RELIABILITY_CATALOG, type ReliabilityProfile } from './reliability.ts';
import { CLAIM_REQUIREMENTS } from './claimRequirements.ts';
import type { Concept } from './types.ts';
import { INITIAL_EVIDENCE_TUPLE, ENGINE_RUNTIME_EVIDENCE_TUPLE, EVIDENCE_REGISTRY, assertEnforceableTuple } from '../evidenceRegistry.ts';
import { decideClaim } from './decideClaim.ts';

function profile(): ReliabilityProfile {
  const version = `rel-${INITIAL_EVIDENCE_TUPLE.engineCodeVersion}-${INITIAL_EVIDENCE_TUPLE.gateVersion}-2026-10-18`;
  return { schema: 'hitterloop.reliability-profile', schema_version: '1.2.0', version,
    tuple: { ...INITIAL_EVIDENCE_TUPLE, reliabilityProfileVersion: version }, data_origin: 'private_consented',
    split: 'validation', decision_status: 'experimental',
    coverage_preregistration: { policy_id: 'synthetic-policy', digest: 'b'.repeat(64), minimum_measurable_coverage: 0.9, bound_to_runs: true }, provenance: {} as ReliabilityProfile['provenance'], profile_digest: 'a'.repeat(64),
    entries: [{ measurable_coverage: 1, coverage_gate: 'meets_preregistered_minimum', concept: 'contact', capture_profile: 'game_backstop', status: 'within_ceiling', observed_unsafe_rate: 0,
      ci95: [0, 0], upper_bound_95: 0.04, n_swings: 100, n_athletes: 20, n_unmeasurable: 0, reason: null }] };
}
const empty = (concept: Concept) => ({ concept, status: 'unmeasured', profileVersion: null,
  observedUnsafeRate: null, upperBound95: null, sampleSwings: null, sampleAthletes: null });
test('production catalog is empty/frozen and every three-argument lookup is unchanged', () => {
  assert.ok(Object.isFrozen(PRODUCTION_RELIABILITY_CATALOG)); assert.equal(PRODUCTION_RELIABILITY_CATALOG.length, 0);
  for (const concept of Object.keys(CLAIM_REQUIREMENTS) as Concept[]) assert.deepEqual(lookupReliability(concept, profile().tuple, 'game_backstop'), empty(concept));
  let comparisons = 0;
  for (const concept of Object.keys(CLAIM_REQUIREMENTS) as Concept[]) {
    for (const base of [INITIAL_EVIDENCE_TUPLE, ENGINE_RUNTIME_EVIDENCE_TUPLE]) {
      for (const tuple of [base, { ...base, reliabilityProfileVersion: profile().version }, null, { ...base, extra: true }]) {
        for (const capture of [null, '', 'game_backstop']) {
          assert.equal(JSON.stringify(lookupReliability(concept, tuple, capture)), JSON.stringify(empty(concept)));
          comparisons++;
        }
      }
    }
  }
  assert.equal(comparisons, 408);
  for (const entry of EVIDENCE_REGISTRY) {
    assert.equal(entry.reliabilityProfileVersion, null);
    const { status: _, ...tuple } = entry;
    assert.throws(() => assertEnforceableTuple(tuple, entry.engineCodeVersion));
  }
});
test('well-formed private injection returns measured fields', () => {
  const p = profile(); assert.deepEqual(lookupReliability('contact', p.tuple, 'game_backstop', [p]), {
    concept: 'contact', status: 'within_ceiling', profileVersion: p.version, observedUnsafeRate: 0,
    upperBound95: 0.04, sampleSwings: 100, sampleAthletes: 20,
  });
});
for (const [label, mutate] of Object.entries<Record<string, (p: ReliabilityProfile) => void>[string]>({
  synthetic: p => { p.data_origin = 'synthetic'; }, split: p => { (p as any).split = 'test'; },
  version: p => { p.version += '-bad'; }, schema: p => { (p as any).schema_version = '2.0.0'; },
  tuple: p => { p.tuple = { ...p.tuple, environmentVersion: 'env-000000000001' }; },
  duplicate: p => { p.entries.push(structuredClone(p.entries[0]!)); },
  nan: p => { p.entries[0]!.observed_unsafe_rate = NaN; }, range: p => { p.entries[0]!.upper_bound_95 = 1.1; },
  negative: p => { p.entries[0]!.n_swings = -1; }, fractional: p => { p.entries[0]!.n_athletes = 1.5; },
  ci: p => { p.entries[0]!.ci95 = [0.8, 0.2]; }, status: p => { p.entries[0]!.status = 'exceeds_ceiling'; },
  emptyCapture: p => { p.entries[0]!.capture_profile = ''; },
})) test(`lookup fails closed: ${label}`, () => {
  const p = profile(), tuple = structuredClone(p.tuple); mutate(p);
  assert.deepEqual(lookupReliability('contact', tuple, 'game_backstop', [p]), empty('contact'));
});
test('missing/null camera, duplicate versions, malformed tuples fail closed', () => {
  const p = profile();
  for (const c of [null, '', 'other']) assert.deepEqual(lookupReliability('contact', p.tuple, c, [p]), empty('contact'));
  assert.deepEqual(lookupReliability('contact', p.tuple, 'game_backstop', [p, p]), empty('contact'));
  assert.deepEqual(lookupReliability('contact', { ...p.tuple, extra: true }, 'game_backstop', [p]), empty('contact'));
});
test('decideClaim matches snapshots captured before PR15 for both registered tuples', async () => {
  const expected = ['b0bf05c75849d5698d86bd75777ebd8316db78c524e00a4dd10d013bcbecd249', '271ea51fc0c0450cd17fd3a002c33138b006452e48d34f348edf0f696467d758'];
  for (const [index, tuple] of [INITIAL_EVIDENCE_TUPLE, ENGINE_RUNTIME_EVIDENCE_TUPLE].entries()) {
    const decisions = [];
    for (const concept of Object.keys(CLAIM_REQUIREMENTS) as Concept[]) decisions.push(await decideClaim({ tuple, concept, phase: null,
      subject: null, metrics: null, frameMap: null, supplied: null, visibility: null, mode: 'shadow' }));
    assert.equal(createHash('sha256').update(JSON.stringify(decisions)).digest('hex'), expected[index]);
  }
});

test('coverage alone cannot activate enforcement or validate a profile', () => {
  const p = profile(); assert.equal(p.decision_status, 'experimental');
  assert.throws(() => assertEnforceableTuple(p.tuple, p.tuple.engineCodeVersion));
  assert.ok(EVIDENCE_REGISTRY.every(e => e.status !== 'enforced'));
  const entry = p.entries[0]!;
  entry.coverage_gate = 'not_preregistered';
  assert.deepEqual(lookupReliability('contact', p.tuple, 'game_backstop', [p]), empty('contact'));
});
