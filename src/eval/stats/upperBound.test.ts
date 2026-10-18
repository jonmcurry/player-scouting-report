import test from 'node:test';
import assert from 'node:assert/strict';
import { upperBound } from './upperBound.ts';
test('rule of three with ICC floor and unequal-cluster ANOVA', () => {
  const z = upperBound(Array.from({ length: 5 }, () => ({ numerator: 0, denominator: 5 })));
  assert.equal(z.icc, 0.1); assert.equal(z.deff, 1.4); assert.equal(z.n_eff, 25 / 1.4); assert.equal(z.upper, 3 / (25 / 1.4));
  const separated = upperBound([{ numerator: 0, denominator: 2 }, { numerator: 2, denominator: 2 }]); assert.equal(separated.icc, 1); assert.equal(separated.deff, 2);
  const mixed = upperBound([{ numerator: 1, denominator: 2 }, { numerator: 1, denominator: 2 }]); assert.equal(mixed.icc, 0.1); assert.equal(upperBound([]).upper, null);
});
