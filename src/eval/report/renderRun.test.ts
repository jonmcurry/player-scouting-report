import test from 'node:test';
import assert from 'node:assert/strict';
import { renderRun, assertOutputSafe } from './renderRun.ts';
import { assembleMetrics } from '../score/metrics.ts';
import { input, fixture } from '../score/testing/fixtures.ts';
test('private run report explicit missing measurements and no clip/group IDs or media paths', async () => {
  const m = assembleMetrics(input([await fixture()])), r = renderRun(m);
  assert.match(r, /Not measured/); assert.match(r, /not production acceptance/); assert.doesNotMatch(r, /eval_[a-f0-9]{16}|group-\d|[A-Z]:[\\/]|Users|\.(mp4|mov|png)\b/i);
  assert.throws(() => renderRun(m, true), /USE_PUBLISH_SUMMARY/);
});
test('path-bearing metadata is refused before rendering or writing outputs', () => {
  for (const path of ['C:/Users/private', '/private/athlete/file', String.raw`\\server\share`, 'secret.mp4']) assert.throws(() => assertOutputSafe(JSON.stringify({ path })), /OUTPUT_PRIVACY_VIOLATION/);
});
