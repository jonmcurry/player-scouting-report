import { SWING_EVENTS, type ClipAnnotation, type FrameIdentity } from '../schema/annotation.ts';
import { ENGINE_OBSERVATIONS_SCHEMA, ENGINE_OBSERVATIONS_VERSION, NORMALIZER_VERSION, type EngineObservations, type ObservationIdentity } from '../normalize/engineObservations.ts';
import { BenchmarkError, canonicalJson } from './registry.ts';

export const ELIGIBILITIES = ['eligible', 'eligible_gt_ambiguous', 'gt_not_observed', 'gt_not_applicable', 'gt_not_annotated',
  'engine_not_produced', 'engine_identity_unmappable', 'engine_identity_assumed', 'engine_estimate_conflict',
  'engine_event_unassignable_to_swing', 'engine_event_outside_gt_window', 'time_base_mismatch', 'source_hash_mismatch',
  'engine_source_unbound', 'engine_identity_inconsistent_with_annotation_source'] as const;
export type Eligibility = typeof ELIGIBILITIES[number];
export function reducedTimeBase(value: string | null): string | null {
  if (!value || !/^[1-9]\d*(\/[1-9]\d*)?$/.test(value)) return null;
  const [n, d = '1'] = value.split('/');
  let a = BigInt(n!), b = BigInt(d);
  while (b) [a, b] = [b, a % b];
  return `${BigInt(n!) / a}/${BigInt(d) / a}`;
}
export function assertObservationVersion(o: EngineObservations): void {
  if (o.schema !== ENGINE_OBSERVATIONS_SCHEMA || o.schema_version !== ENGINE_OBSERVATIONS_VERSION) throw new BenchmarkError('UNSUPPORTED_OBSERVATIONS_SCHEMA');
  if (o.normalizer_version !== NORMALIZER_VERSION) throw new BenchmarkError('UNSUPPORTED_NORMALIZER_VERSION');
}
export function pairObservations(a: ClipAnnotation, o: EngineObservations) {
  assertObservationVersion(o);
  const consistent = (f: FrameIdentity | null) => !!f && f.frame_index >= 0 && f.frame_index < a.source.frame_count && a.source.presentation_timestamps[f.frame_index] === f.pts;
  const sourceReason: Eligibility | null = o.source.sha256 === null ? 'engine_source_unbound' : o.source.sha256 !== a.source.sha256 ? 'source_hash_mismatch' : null;
  const timeReason: Eligibility | null = reducedTimeBase(o.source.raw_time_base) !== reducedTimeBase(`${a.source.time_base.numerator}/${a.source.time_base.denominator}`) ? 'time_base_mismatch' : null;
  const preconditions = [sourceReason, timeReason].filter(v => v !== null);
  const inconsistentFrames = o.frames.filter(f => f.identity.status === 'verified' && !consistent(f.identity.source))
    .map(f => ({ analysis_index: f.analysis_index, reason: 'engine_identity_inconsistent_with_annotation_source' }));
  const within = (f: FrameIdentity, s: ClipAnnotation['swings'][number]) => f.frame_index >= s.window.earliest.frame_index && f.frame_index <= s.window.latest.frame_index;
  const identity = (i: ObservationIdentity) => ({ status: i.status, frame: i.status === 'verified' ? i.source : i.status === 'assumed' ? i.assumed : null });
  const pairs = a.swings.flatMap(swing => SWING_EVENTS.map(event => {
    const gt = swing.events[event], e = o.events[event];
    const estimates = [...new Map(e.estimates.map(v => [canonicalJson(identity(v.identity)), identity(v.identity)])).values()];
    let eligibility: Eligibility;
    const first = estimates[0];
    if (estimates.length > 1) eligibility = 'engine_estimate_conflict';
    else if (e.status === 'invalid') eligibility = 'engine_identity_unmappable';
    else if (!first) eligibility = 'engine_not_produced';
    else if (first.status === 'assumed') eligibility = 'engine_identity_assumed';
    else if (first.status !== 'verified' || !first.frame) eligibility = 'engine_identity_unmappable';
    else if (sourceReason) eligibility = sourceReason;
    else if (timeReason) eligibility = timeReason;
    else if (!consistent(first.frame)) eligibility = 'engine_identity_inconsistent_with_annotation_source';
    else if (a.swings.length > 1 && (a.swings.filter(s => within(first.frame!, s)).length !== 1 || !within(first.frame, swing))) eligibility = 'engine_event_unassignable_to_swing';
    else if (!within(first.frame, swing)) eligibility = 'engine_event_outside_gt_window';
    else if (gt.status === 'not_annotated') eligibility = 'gt_not_annotated';
    else if (gt.status === 'not_applicable') eligibility = 'gt_not_applicable';
    else if (gt.status === 'not_visible') eligibility = 'gt_not_observed';
    else eligibility = gt.status === 'ambiguous' ? 'eligible_gt_ambiguous' : 'eligible';
    return { swing_id: swing.swing_id, event, gt, engine: { status: e.status, estimates }, eligibility };
  }));
  const unavailable = 'coordinate_transform_unavailable' as const;
  return {
    preconditions, inconsistent_engine_frames: inconsistentFrames,
    verified_slice: pairs.filter(p => p.eligibility !== 'engine_identity_assumed').map(p => ({ ...p,
      engine: { ...p.engine, estimates: p.engine.estimates.filter(e => e.status !== 'assumed') } })),
    assumed_slice: pairs.filter(p => p.engine.estimates.some(e => e.status === 'assumed')).map(p => ({ ...p,
      eligibility: 'engine_identity_assumed' as const, engine: { ...p.engine, estimates: p.engine.estimates.filter(e => e.status === 'assumed') } })),
    auxiliary: (['load_peak_estimate', 'extension'] as const).map(event => ({ event, eligibility: 'auxiliary_no_gt_counterpart',
      status: o.events[event].status, estimates: o.events[event].estimates.map(e => identity(e.identity)) })),
    outcomes: a.swings.map(s => ({ swing_id: s.swing_id, gt: s.outcome, engine: o.outcome.classification })),
    spatial: a.frames.map(f => {
      const match = !sourceReason && !timeReason ? o.frames.find(e => e.identity.status === 'verified' && consistent(e.identity.source)
        && e.identity.source!.frame_index === f.frame.frame_index && e.identity.source!.pts === f.frame.pts) : undefined;
      return { frame: f.frame, keypoints: unavailable, bat: unavailable, bounding_box: unavailable,
        availability: match ? 'engine_frame_verified' : sourceReason || timeReason || o.frames.some(e => e.identity.status === 'unmappable'
          || (e.identity.source?.frame_index === f.frame.frame_index && !consistent(e.identity.source))) ? 'engine_frame_unmappable' : 'engine_frame_absent',
        batter_status: match?.batter.status ?? null, bat_knob_status: match?.bat.knob.status ?? null, bat_tip_status: match?.bat.tip.status ?? null,
        annotated_subject_count: f.subjects.length };
    }),
    batter_identity: a.swings.map(s => ({ swing_id: s.swing_id, gt_track_id: s.batter_track_id, gt_status: s.batter_identity_status,
      engine_track_id: null, eligibility: 'engine_track_id_unavailable', fragment_count: o.batter_track.fragments.length })),
    counts: { invalid_observations: o.failures.invalid_observation_count,
      missing_bat_knob: o.frames.filter(f => f.bat.knob.status === 'missing').length,
      missing_bat_tip: o.frames.filter(f => f.bat.tip.status === 'missing').length,
      unmappable_frames: o.frames.filter(f => f.identity.status === 'unmappable').length },
  };
}
