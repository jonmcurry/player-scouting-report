import test from 'node:test';
import assert from 'node:assert/strict';
import { outcomes } from './outcomes.ts';
import { fixture, exclude } from './testing/fixtures.ts';
import { pair } from './events.ts';
test('O1 raw confusion; O2 false swing and excluded tally; O3 only confirmed contact', async () => {
  const c = await fixture(), d = exclude(await fixture(2)), e = await fixture(3);
  c.annotation!.swings[0]!.outcome = d.annotation!.swings[0]!.outcome = 'no_swing_take'; e.annotation!.swings[0]!.outcome = 'swing_miss';
  e.record.pairing!.verified_slice = e.record.pairing!.verified_slice.filter(p => p.event !== 'contact_confirmed');
  let m = outcomes([c, d, e], 1); assert.equal(m[0]!.matrix!.no_swing_take!.contact_unconfirmed, 1); assert.equal(m[1]!.value, 1); assert.equal(m[1]!.denominator, 1); assert.equal(m[1]!.exclusions.PIPELINE_FAILED, 1); assert.equal(m[2]!.value, 0);
  const p = structuredClone(pair(e, e.annotation!.swings[0]!, 'impact_estimate')!); p.event = 'contact_confirmed'; e.record.pairing!.verified_slice.push(p);
  m = outcomes([e], 1); assert.equal(m[2]!.value, 1);
});
