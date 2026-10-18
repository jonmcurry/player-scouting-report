import test from 'node:test';
import assert from 'node:assert/strict';
import { failures } from './failures.ts';
import { fixture, exclude, input } from './testing/fixtures.ts';
test('exact taxonomy only, both exclusion and failure streams, run denominator', async () => {
  const a = exclude(await fixture(), 'engine_terminal_low_quality_footage'), b = exclude(await fixture(2), 'PIPELINE_FAILED'), c = exclude(await fixture(3), 'unknown_code');
  const i = input([a, b, c]), m = failures(i, [a, b, c]);
  assert.equal(m.length, 6); assert.ok(m.some(x => x.id === 'F1.failures.other.unknown_code')); assert.ok(m.some(x => x.id === 'F1.exclusions.crash.PIPELINE_FAILED')); assert.equal(m[0]!.denominator, 3); assert.equal(m[0]!.value, 1 / 3);
});
