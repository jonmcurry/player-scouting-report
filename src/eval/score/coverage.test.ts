import test from 'node:test';
import assert from 'node:assert/strict';
import { coverage } from './coverage.ts';
import { fixture, exclude } from './testing/fixtures.ts';
test('C1 retains failed clips and annotated swings', async () => { const m = coverage([await fixture(), exclude(await fixture(2))]); assert.equal(m[0]!.value, 0.5); assert.equal(m.find(x => x.id === 'C1.impact_estimate')!.value, 0.5); });
