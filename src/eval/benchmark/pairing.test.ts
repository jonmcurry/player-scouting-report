import test from 'node:test';
import assert from 'node:assert/strict';
import { pairObservations, reducedTimeBase } from './pairing.ts';
import { annotationFixture, observations, artifacts } from './testing/fixtures.ts';
import { normalizeEngineOutputs } from '../normalize/engineObservations.ts';
import { type EventLabel } from '../schema/annotation.ts';
test('identities only, correct semantic events and spatial withholding', async () => {
  const a = await annotationFixture(), o = await observations(), p = pairObservations(a, o);
  assert.equal(p.verified_slice.find(p => p.event === 'impact_estimate')!.eligibility, 'eligible');
  for (const event of ['contact_confirmed', 'load_start', 'stride_foot_lift', 'swing_launch']) assert.equal(p.verified_slice.find(p => p.event === event)!.eligibility, 'engine_not_produced');
  assert.deepEqual(p.auxiliary.map(p => p.eligibility), ['auxiliary_no_gt_counterpart', 'auxiliary_no_gt_counterpart']);
  assert.equal(p.spatial[0]!.availability, 'engine_frame_verified');
  for (const field of ['keypoints', 'bat', 'bounding_box'] as const) assert.equal(p.spatial[0]![field], 'coordinate_transform_unavailable');
  assert.equal(p.batter_identity[0]!.engine_track_id, null); assert.equal(p.outcomes[0]!.engine, 'unknown');
  assert.doesNotMatch(JSON.stringify(p), /"(?:coordinates|error|delta|accuracy|rate|pass|tolerance_met|rmse|mean)":/);
});
for (const mode of ['assumed', 'unmappable', 'conflict', 'identical', 'inconsistent', 'timebase', 'unbound', 'hash'] as const) test(`pair eligibility: ${mode}`, async () => {
  const a = await annotationFixture(), o = await observations(), event = o.events.impact_estimate;
  if (mode === 'assumed' || mode === 'unmappable') for (const e of event.estimates) {
    e.identity.status = mode; e.identity.assumed = mode === 'assumed' ? e.identity.source : null; e.identity.source = null;
  }
  if (mode === 'conflict') event.estimates[1]!.identity = structuredClone(o.frames[7]!.identity);
  if (mode === 'identical') event.estimates.push(structuredClone(event.estimates[0]!));
  if (mode === 'inconsistent') for (const e of event.estimates) e.identity.source = { frame_index: 6, pts: 999 };
  if (mode === 'timebase') o.source.raw_time_base = '1/999';
  if (mode === 'unbound') o.source.sha256 = null;
  if (mode === 'hash') o.source.sha256 = 'a'.repeat(64);
  const p = pairObservations(a, o), pair = [...p.verified_slice, ...p.assumed_slice].find(p => p.event === 'impact_estimate')!;
  assert.equal(pair.eligibility, { assumed: 'engine_identity_assumed', unmappable: 'engine_identity_unmappable', conflict: 'engine_estimate_conflict',
    identical: 'eligible', inconsistent: 'engine_identity_inconsistent_with_annotation_source', timebase: 'time_base_mismatch', unbound: 'engine_source_unbound', hash: 'source_hash_mismatch' }[mode]);
  if (mode === 'assumed') assert.equal(p.verified_slice.some(p => p.event === 'impact_estimate'), false);
  if (mode === 'identical') assert.equal(pair.engine.estimates.length, 1);
});
for (const status of ['ambiguous', 'not_visible', 'not_applicable', 'not_annotated'] as const) test(`GT status ${status}`, async () => {
  const a = await annotationFixture(), o = await observations();
  a.swings[0]!.events.impact_estimate = { status, frame: null, uncertainty: status === 'ambiguous' ? {
    earliest: { frame_index: 5, pts: 9150 }, latest: { frame_index: 7, pts: 9210 } } : null,
    reason: { ambiguous: 'boundary_unclear', not_visible: 'occluded', not_applicable: 'not_reached', not_annotated: 'not_reviewed' }[status] } as EventLabel;
  assert.equal(pairObservations(a, o).verified_slice.find(p => p.event === 'impact_estimate')!.eligibility,
    { ambiguous: 'eligible_gt_ambiguous', not_visible: 'gt_not_observed', not_applicable: 'gt_not_applicable', not_annotated: 'gt_not_annotated' }[status]);
});
test('multiple swings assign by window, never index; single swing outside window', async () => {
  const a = await annotationFixture(), o = await observations();
  const first = a.swings[0]!, second = structuredClone(first); second.swing_id = 'swg_0000000000000002';
  first.window.latest = { frame_index: 4, pts: 9120 }; second.window.earliest = { frame_index: 5, pts: 9150 }; a.swings.push(second);
  const pairs = pairObservations(a, o).verified_slice.filter(p => p.event === 'impact_estimate');
  assert.deepEqual(pairs.map(p => p.eligibility), ['engine_event_unassignable_to_swing', 'eligible']);
  second.window.earliest = { frame_index: 8, pts: 9240 };
  assert.ok(pairObservations(a, o).verified_slice.filter(p => p.event === 'impact_estimate').every(p => p.eligibility === 'engine_event_unassignable_to_swing'));
  a.swings.pop(); assert.equal(pairObservations(a, o).verified_slice.find(p => p.event === 'impact_estimate')!.eligibility, 'engine_event_outside_gt_window');
});
test('CFR/VFR exact source PTS; reduced rational time bases', async () => {
  assert.equal(reducedTimeBase('2/2000'), '1/1000'); assert.equal(reducedTimeBase('2'), '2/1');
  for (const pts of [Array.from({ length: 12 }, (_, i) => 9000 + 30 * i), Array.from({ length: 12 }, (_, i) => -10 + i * i + i)]) {
    const a = await annotationFixture(); a.source.presentation_timestamps = pts;
    const n = await normalizeEngineOutputs(artifacts(a.source.sha256, pts)); assert.ok(n.ok);
    n.observations.source.raw_time_base = '2/2000';
    assert.equal(pairObservations(a, n.observations).verified_slice.find(p => p.event === 'impact_estimate')!.eligibility, 'eligible');
  }
});
test('partial frame coverage, fragments, missing bat, invalid numbers', async () => {
  const a = await annotationFixture(), input = artifacts();
  input.pose2d.frames[2]!.keypoints = null; input.pose2d.frames[4]!.keypoints = Array(17).fill([NaN, 2, 1]);
  input.batPath.frames[6]!.knob = null; input.batPath.frames[6]!.tip = null;
  const n = await normalizeEngineOutputs(input); assert.ok(n.ok);
  const p = pairObservations(a, n.observations);
  assert.equal(p.batter_identity[0]!.fragment_count, 2); assert.equal(p.counts.invalid_observations, 17);
  assert.equal(p.spatial[0]!.bat_knob_status, 'missing'); assert.equal(p.counts.missing_bat_tip, 1);
  n.observations.frames.splice(6, 1);
  assert.equal(pairObservations(a, n.observations).spatial[0]!.availability, 'engine_frame_absent');
  n.observations.frames[0]!.identity.status = 'unmappable';
  assert.equal(pairObservations(a, n.observations).spatial[0]!.availability, 'engine_frame_unmappable');
});
test('unsupported observation versions reject explicitly', async () => {
  const a = await annotationFixture(), o = await observations(); o.normalizer_version = 'future';
  assert.throws(() => pairObservations(a, o), { message: 'UNSUPPORTED_NORMALIZER_VERSION' });
  o.schema_version = '2'; assert.throws(() => pairObservations(a, o), { message: 'UNSUPPORTED_OBSERVATIONS_SCHEMA' });
});
