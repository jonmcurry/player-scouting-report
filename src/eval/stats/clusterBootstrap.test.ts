import test from 'node:test';
import assert from 'node:assert/strict';
import { clusterBootstrap } from './clusterBootstrap.ts';
test('cluster bootstrap reproducible, seed-sensitive, zero-denominator counted', () => {
  const g = [{ numerator: 0, denominator: 1 }, { numerator: 1, denominator: 3 }, { numerator: 9, denominator: 10 }];
  assert.deepEqual(clusterBootstrap(g, 7), clusterBootstrap(g, 7)); assert.notDeepEqual(clusterBootstrap(g, 7), clusterBootstrap(g, 8));
  assert.equal(clusterBootstrap([], 1).dropped_replicates, 2000); assert.equal(clusterBootstrap(g).sample_status, 'insufficient_sample');
});
