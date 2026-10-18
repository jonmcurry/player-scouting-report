import test from 'node:test';
import assert from 'node:assert/strict';
import { publish } from './publish.ts';
import { compareRuns } from './compareRuns.ts';
import { assembleMetrics } from '../score/metrics.ts';
import { fixture, input } from '../score/testing/fixtures.ts';
test('summary suppression, dominance, whole-percent/count rounding, no identities or paths', async () => {
  const clips = await Promise.all(Array.from({ length: 23 }, (_, i) => fixture(i + 1)));
  clips.forEach((c, i) => c.registry.athlete_group = `group-${i % 5}`);
  const a = assembleMetrics(input(clips)), comparison = compareRuns(a, a), text = publish(comparison, a, a);
  assert.match(text, /100%/); assert.match(text, /\| O1 \| all profiles \| 25 \| 25 \|/);
  assert.doesNotMatch(text, /eval_[a-f0-9]{16}|group-|[A-Z]:[\\/]|Users|\.(mp4|mov|png)\b/i);
  const small = assembleMetrics(input(clips.slice(0, 4))); assert.match(publish(compareRuns(small, small), small, small), /suppressed \(small sample\)/);
  clips.forEach((c, i) => c.registry.athlete_group = i < 15 ? 'dominant' : `minor-${i}`);
  const dominated = assembleMetrics(input(clips)), out = publish(compareRuns(dominated, dominated), dominated, dominated);
  assert.match(out, /\| O1 \| all profiles \| suppressed \(small sample\)/); assert.doesNotMatch(out, /dominant|minor-/);
});
