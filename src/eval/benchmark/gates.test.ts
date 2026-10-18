import test from 'node:test';
import assert from 'node:assert/strict';
import { artifacts } from './testing/fixtures.ts';
import { benchmarkAiInputs, runGates } from './gates.ts';
import { assessClip } from '../../services/development/evidence/assessClip.ts';
import { extractClipEvidenceSignals, subjectSignalsFrom } from '../../services/development/evidence/artifactSignals.ts';
import { observedTuple } from '../../services/development/evidence/shadowAssessment.ts';
test('pure zoom availability, no decoding, correct gate projection', async () => {
  const a = artifacts(), snapshot = structuredClone(a), aiInputs = benchmarkAiInputs(a);
  assert.ok(aiInputs.zooms.includes('zoom_contact')); assert.equal(aiInputs.sequenceFrames, 0);
  const strictSignals = extractClipEvidenceSignals({ ...a, aiInputs, captureProfile: 'open_side_practice' });
  const expected = await assessClip({ tuple: observedTuple(a.manifest), subject: subjectSignalsFrom(strictSignals), metrics: a.metrics,
    frameMap: { frameMapJson: a.frameMapJson, manifest: a.manifest }, strictSignals });
  const gates = await runGates(a, 'open_side_practice');
  assert.equal(gates.status, 'evaluated'); assert.equal(gates.strict!.status, expected.strictBaseline.status);
  assert.deepEqual(gates.strict!.failedRules, expected.strictBaseline.failedRules);
  assert.deepEqual(gates.v1!.reasons, expected.subject.reasons); assert.equal(gates.aiInputs_source, 'subject_box_replica_no_media');
  assert.deepEqual(a, snapshot); assert.doesNotMatch(JSON.stringify(gates), /"(?:coordinates|thresholds|signals|accuracy|rate)":/);
});
test('unknown tuple is not evaluated; missing body means no crop', async () => {
  const a = artifacts(); a.pose2d.frames.forEach(f => { f.keypoints = null; });
  assert.deepEqual(benchmarkAiInputs(a).zooms, []);
  const g = await runGates({ ...a, manifest: null }, null);
  assert.equal(g.status, 'not_evaluated'); assert.equal(g.reason, 'tuple_unavailable');
});
