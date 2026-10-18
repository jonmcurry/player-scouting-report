import test from 'node:test';
import assert from 'node:assert/strict';
import { gates } from './gate.ts';
import { fixture, exclude } from './testing/fixtures.ts';
import { pair } from './events.ts';
test('G1/G2 same swings, failures variant and agreement', async () => {
  const c = await fixture(), d = exclude(await fixture(2));
  if (c.record.gates!.status === 'evaluated') c.record.gates!.strict.status = 'withhold';
  const m = gates([c, d], 1), get = (id: string) => m.find(m => m.id === id)!;
  assert.equal(get('G1.v1').value, 1); assert.equal(get('G1.v1.with_failures').value, 0.5); assert.equal(get('G1.v1').exclusions.PIPELINE_FAILED, 1);
  assert.equal(get('G2.difference').value, 1); assert.equal(get('G2.difference').agreement!.dimensional_only, 1);
});
test('G3 exact provisional boundaries, unsupported tolerances, missing passes not safe', async () => {
  for (const [event, safe] of [['impact_estimate', 2], ['foot_plant', 3]] as const) {
    const c = await fixture(), s = c.annotation!.swings[0]!, p = pair(c, s, event)!;
    if (!p.engine.estimates.length) { s.events[event] = { status: 'observed', frame: { frame_index: 4, pts: 9120 }, uncertainty: { earliest: { frame_index: 4, pts: 9120 }, latest: { frame_index: 4, pts: 9120 } }, reason: null }; p.eligibility = 'eligible'; p.engine.estimates = [{ status: 'verified', frame: { frame_index: 4, pts: 9120 } }]; }
    const gt = s.events[event].frame!;
    // Both the safe and unsafe predictions are inside the annotator interval.
    s.events[event].uncertainty = { earliest: { frame_index: gt.frame_index - 1, pts: gt.pts - 30 }, latest: { frame_index: gt.frame_index + safe + 1, pts: gt.pts + (safe + 1) * 30 } };
    p.gt = structuredClone(s.events[event]);
    p.engine.estimates[0]!.frame!.frame_index = gt.frame_index + safe;
    assert.equal(gates([c], 1).find(m => m.id === `G3.${event}`)!.value, 0);
    p.engine.estimates[0]!.frame!.frame_index++;
    assert.ok(p.engine.estimates[0]!.frame!.frame_index <= s.events[event].uncertainty!.latest.frame_index);
    assert.equal(gates([c], 1).find(m => m.id === `G3.${event}`)!.value, 1);
    p.eligibility = 'engine_identity_unmappable'; const m = gates([c], 1).find(m => m.id === `G3.${event}`)!;
    assert.equal(m.value, null); assert.equal(m.exclusions.pass_without_verified_pair, 1);
  }
  assert.equal(gates([await fixture()], 1).find(m => m.id === 'G3.finish')!.reason, 'no_approved_tolerance');
});
test('G3 sample adequacy and upper-bound ceiling; nonobserved GT passes excluded', async () => {
  const clips = await Promise.all(Array.from({ length: 60 }, (_, i) => fixture(i + 1)));
  let m = gates(clips, 1).find(x => x.id === 'G3.impact_estimate')!; assert.equal(m.outcome, 'pass'); assert.equal(m.statistics!.upper95, 0.05);
  m = gates(clips.slice(0, 4), 1).find(x => x.id === 'G3.impact_estimate')!; assert.equal(m.outcome, 'inconclusive'); assert.equal(m.sample_status, 'insufficient_sample');
  clips[0]!.annotation!.swings[0]!.events.impact_estimate.status = 'not_visible';
  m = gates(clips, 1).find(x => x.id === 'G3.impact_estimate')!; assert.equal(m.denominator, 59); assert.equal(m.exclusions.gt_not_visible, 1);
});
