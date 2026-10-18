import test from 'node:test';
import assert from 'node:assert/strict';
import { classifyObservation, observationsFromInputs, validateObservations } from './observations.ts';
import { observation, inputs } from './testing/fixtures.ts';
import { sha256 } from '../benchmark/registry.ts';

test('AND of OR events, known failure, and unknown pass path', () => {
  assert.equal(classifyObservation(observation()).status, 'safe');
  assert.equal(classifyObservation(observation(1, { v2: { impact_estimate: 'fail', contact_confirmed: 'fail' } })).status, 'failed');
  assert.equal(classifyObservation(observation(1, { v2: { impact_estimate: 'unknown' } })).status, 'unmeasurable');
  assert.equal(classifyObservation(observation(1, { concept: 'posture' })).status, 'unmeasurable');
  assert.equal(classifyObservation(observation(1, { v3: 'unknown' })).status, 'unmeasurable');
  assert.equal(classifyObservation(observation(1, { v1: 'unknown' })).status, 'unmeasurable');
  assert.equal(classifyObservation(observation(1, { v1: 'fail' })).status, 'failed');
  assert.equal(classifyObservation(observation(1, { concept: 'timing' })).status, 'not_applicable');
});
test('wrong evidence is unsafe; unknown is never safe; unsupported tolerances stay unknown', () => {
  for (const part of ['identity', 'visibility', 'timing'] as const) {
    const o = observation(); if (part === 'timing') o.evidence.timing.impact_estimate = 'wrong'; else o.evidence[part] = 'wrong';
    assert.equal(classifyObservation(o).status, 'unsafe');
  }
  const o = observation(); o.evidence.identity = 'unknown'; assert.equal(classifyObservation(o).status, 'unmeasurable');
  // A known-wrong component is never masked by an unknown one.
  o.evidence.visibility = 'wrong'; assert.equal(classifyObservation(o).status, 'unsafe');
  const contact = observation(1, { v2: { contact_confirmed: 'pass' } });
  contact.evidence.timing.contact_confirmed = 'correct'; assert.equal(classifyObservation(contact).status, 'unmeasurable');
  assert.equal(classifyObservation(observation(1, { concept: 'finish_balance', v2: { finish: 'pass' } })).status, 'unmeasurable');
});
for (const value of [NaN, -0.1, 1.5, '0.5', Infinity]) test(`reject invalid confidence ${String(value)}`, () => {
  assert.throws(() => validateObservations([observation(1, { engine_confidence: value as number })]), /INVALID_ENGINE_CONFIDENCE/);
});
test('adapter uses PR14 verified timing/tolerances and never invents V3 or identity', async () => {
  const i = await inputs(), c = i.clips[0]!;
  for (const event of ['impact_estimate', 'foot_plant'] as const) {
    const p = c.record.pairing!.verified_slice.find(p => p.event === event)!;
    const estimate = p.engine.estimates[0]!;
    assert.equal(estimate.status, 'verified'); if (estimate.status !== 'verified' || !estimate.frame) throw new Error('fixture');
    const frame = estimate.frame.frame_index, limit = event === 'impact_estimate' ? 2 : 3;
    estimate.frame.frame_index = frame + limit;
    assert.equal(observationsFromInputs(i)[0]!.evidence.timing[event], 'correct');
    estimate.frame.frame_index++;
    assert.equal(observationsFromInputs(i)[0]!.evidence.timing[event], 'wrong');
    p.eligibility = 'engine_not_produced';
    assert.equal(observationsFromInputs(i)[0]!.evidence.timing[event], 'unknown');
  }
  const rows = observationsFromInputs(i);
  assert.ok(rows.every(o => ['unmeasurable', 'not_applicable', 'failed'].includes(classifyObservation(o).status)));
  assert.ok(rows.every(o => o.v3 === 'unknown' && o.evidence.identity === 'unknown' && o.evidence.visibility === 'unknown'));
  assert.ok(rows.every(o => o.evidence.timing.contact_confirmed === 'unknown'));
});
test('duplicate observations refused', () => assert.throws(() => validateObservations([observation(), observation()]), /DUPLICATE_OBSERVATION/));

test('a failures.jsonl code alone never drops a paired clip (PR16 regression)', async () => {
  const i = await inputs(), before = observationsFromInputs(i);
  i.failures.push({ eval_id: i.clips[0]!.registry.eval_id, code: 'engine_failure' });
  assert.ok(before.length > 0); assert.deepEqual(observationsFromInputs(i), before);
});
test('PR17: paired clips listed in failures.jsonl are kept; early engine failures are unmeasurable opportunities', async () => {
  const { fixture, input, exclude } = await import('../score/testing/fixtures.ts');
  const { INITIAL_EVIDENCE_TUPLE } = await import('../../services/development/evidenceRegistry.ts');
  const { CLAIM_REQUIREMENTS } = await import('../../services/development/evidence/claimRequirements.ts');
  const { estimateEntries } = await import('./reliabilityProfile.ts');
  const paired = await fixture(1); paired.record.gates!.tuple = { ...INITIAL_EVIDENCE_TUPLE };
  const crashed = exclude(await fixture(2), 'PIPELINE_FAILED');
  const terminal = exclude(await fixture(3), 'engine_terminal_low_quality_footage'); terminal.record.artifacts = [];
  const consent = exclude(await fixture(4), 'consent_eval_annotation_missing');
  const media = exclude(await fixture(5), 'media_hash_mismatch');
  const i = input([paired, crashed, terminal, consent, media]);
  i.failures.push({ eval_id: paired.record.eval_id, code: 'cache_integrity_failed' }, { eval_id: paired.record.eval_id, code: 'repeatability_out_of_tolerance' });
  const rows = observationsFromInputs(i), byClip = (c: typeof paired) => rows.filter(o => o.clip_hash === sha256(c.registry.eval_id));
  const concepts = Object.keys(CLAIM_REQUIREMENTS).length, swings = (c: typeof paired) => c.annotation!.swings.length;
  assert.equal(byClip(paired).length, swings(paired) * concepts, 'paired clip with non-exclusion failure codes is retained');
  for (const c of [crashed, terminal]) {
    assert.equal(byClip(c).length, swings(c) * concepts);
    for (const o of byClip(c)) {
      const k = classifyObservation(o);
      if (CLAIM_REQUIREMENTS[o.concept].disabledReason) assert.equal(k.status, 'not_applicable');
      else assert.deepEqual(k, { status: 'unmeasurable', causes: ['engine_failure_before_claims'] });
    }
  }
  assert.equal(byClip(consent).length, 0); assert.equal(byClip(media).length, 0);
  // Failures add opportunities to the coverage denominator but never passes, so rates are unchanged.
  const withFailures = estimateEntries(rows), pairedOnly = estimateEntries(byClip(paired));
  for (const e of withFailures.entries.filter(x => !CLAIM_REQUIREMENTS[x.concept].disabledReason)) {
    const p = pairedOnly.entries.find(x => x.concept === e.concept)!;
    assert.equal(e.n_swings, p.n_swings); assert.equal(e.observed_unsafe_rate, p.observed_unsafe_rate);
    assert.equal(e.n_unmeasurable, p.n_unmeasurable + swings(crashed) + swings(terminal));
  }
});
