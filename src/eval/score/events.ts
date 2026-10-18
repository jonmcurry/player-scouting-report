import { SWING_EVENTS, type SwingEventSlug, type SwingAnnotation } from '../schema/annotation.ts';
import type { InputClip, Pairing } from './inputs.ts';
import { clusterBootstrap, percentile } from '../stats/clusterBootstrap.ts';
export interface Unit { athlete: string; clip: string; swing: string; value: number }
export type Aggregation = 'rate' | 'median' | 'p90' | 'sum' | 'mean';
export interface Metric {
  id: string; definition: string; numerator: number; denominator: number; unit: string;
  eligibility: string; missing_prediction_rule: string; missing_annotation_rule: string;
  exclusions: Record<string, number>; n_swings: number; n_clips: number; n_athletes: number;
  value: number | null; status: 'measured' | 'unmeasured' | 'not_applicable'; reason?: string;
  aggregation: Aggregation; statistics?: ReturnType<typeof clusterBootstrap>; outcome?: string;
  sample_status?: 'insufficient_sample' | 'adequate';
  diagnostic?: string; agreement?: Record<string, number>; matrix?: Record<string, Record<string, number>>;
  _units: Unit[];
}
export const tally = (counts: Record<string, number>, code: string, n = 1) => { counts[code] = (counts[code] ?? 0) + n; };
export const unit = (c: InputClip, s: SwingAnnotation | null, value: number): Unit => ({ athlete: c.registry.athlete_group, clip: c.record.eval_id, swing: s?.swing_id ?? '', value });
export function aggregate(values: number[], kind: Aggregation): number | null {
  if (!values.length) return null;
  if (kind === 'median') { const a = [...values].sort((x, y) => x - y), i = Math.floor(a.length / 2); return a.length % 2 ? a[i]! : (a[i - 1]! + a[i]!) / 2; }
  if (kind === 'p90') return percentile(values, 0.9);
  const sum = values.reduce((s, v) => s + v, 0);
  return kind === 'sum' ? sum : sum / values.length;
}
export function athleteCounts(units: Unit[]) {
  const groups: Record<string, { numerator: number; denominator: number }> = {};
  for (const u of units) { const g = groups[u.athlete] ??= { numerator: 0, denominator: 0 }; g.numerator += u.value; g.denominator++; }
  return groups;
}
export function metric(id: string, definition: string, units: Unit[], options: Partial<Metric> = {}, seed = 1): Metric {
  const aggregation = options.aggregation ?? 'rate', value = aggregate(units.map(u => u.value), aggregation);
  const m: Metric = { id, definition, numerator: units.reduce((s, u) => s + u.value, 0), denominator: units.length,
    unit: 'fraction', eligibility: 'verified identities assigned to annotated swings', missing_prediction_rule: 'not passing',
    missing_annotation_rule: 'excluded with reason', exclusions: {}, n_swings: new Set(units.filter(u => u.swing).map(u => u.clip + ':' + u.swing)).size,
    n_clips: new Set(units.map(u => u.clip)).size, n_athletes: new Set(units.map(u => u.athlete)).size,
    value, status: value === null ? 'unmeasured' : 'measured', ...(value === null ? { reason: 'zero_eligible' } : {}), aggregation, _units: units, ...options };
  if (aggregation === 'rate' && /^(E2|O2|O3|G1|G3)/.test(id)) m.statistics = clusterBootstrap(Object.values(athleteCounts(units)), seed);
  if (m.n_athletes < 5 && m.status === 'measured') m.outcome = 'inconclusive';
  m.sample_status = m.n_athletes < 5 ? 'insufficient_sample' : 'adequate';
  return m;
}
export type Pair = Pairing['verified_slice'][number];
export function pair(c: InputClip, s: SwingAnnotation, e: SwingEventSlug) { return c.record.pairing?.verified_slice.find(p => p.swing_id === s.swing_id && p.event === e); }
/** GT visibility does not invalidate an otherwise verified prediction for coverage/false claims. */
export function prediction(p: Pair | undefined) {
  if (!p || !['eligible', 'eligible_gt_ambiguous', 'gt_not_observed', 'gt_not_applicable', 'gt_not_annotated'].includes(p.eligibility) || p.engine.estimates.length !== 1) return null;
  const estimate = p.engine.estimates[0]!;
  return estimate.status === 'verified' ? estimate.frame : null;
}
export function missing(c: InputClip, s: SwingAnnotation, e: SwingEventSlug) {
  return c.record.exclusion ?? pair(c, s, e)?.eligibility ?? c.record.pairing?.assumed_slice.find(p => p.swing_id === s.swing_id && p.event === e)?.eligibility ?? 'engine_not_produced';
}
export function timing(c: InputClip, s: SwingAnnotation, e: SwingEventSlug, ambiguous = false) {
  const p = pair(c, s, e), pred = prediction(p), gt = s.events[e];
  if (!pred || p?.eligibility !== (ambiguous ? 'eligible_gt_ambiguous' : 'eligible')) return null;
  const interval = gt.uncertainty;
  if (!interval || gt.status !== (ambiguous ? 'ambiguous' : 'observed')) return null;
  const distance = (v: number, lo: number, hi: number) => Math.max(lo - v, 0, v - hi);
  const frames = gt.status === 'observed' ? Math.abs(pred.frame_index - gt.frame.frame_index)
    : distance(pred.frame_index, interval.earliest.frame_index, interval.latest.frame_index);
  const pts = gt.status === 'observed' ? Math.abs(pred.pts - gt.frame.pts)
    : distance(pred.pts, interval.earliest.pts, interval.latest.pts);
  const tb = c.annotation!.source.time_base;
  return { frames, ms: pts * tb.numerator * 1000 / tb.denominator, frame: pred.frame_index, gt_frame: gt.frame?.frame_index ?? null };
}
export function events(clips: InputClip[], seed: number): Metric[] {
  const result: Metric[] = [];
  for (const e of SWING_EVENTS) {
    const detection: Unit[] = [], exclusions: Record<string, number> = {};
    for (const c of clips) for (const s of c.annotation?.swings ?? []) {
      if (s.events[e].status !== 'observed') { tally(exclusions, 'gt_' + s.events[e].status); continue; }
      const found = c.record.status === 'paired' && pair(c, s, e)?.eligibility === 'eligible' && !!prediction(pair(c, s, e));
      detection.push(unit(c, s, Number(found))); if (!found) tally(exclusions, missing(c, s, e));
    }
    result.push(metric(`E2.${e}`, 'Verified assigned event estimates / observed GT events, including annotated excluded clips', detection, { exclusions, eligibility: 'GT event observed; all annotated clips' }, seed));
    for (const ambiguous of [false, true]) {
      const samples = clips.flatMap(c => (c.annotation?.swings ?? []).flatMap(s => { const t = timing(c, s, e, ambiguous); return t ? [{ c, s, t }] : []; }));
      const excluded: Record<string, number> = {};
      for (const c of clips) for (const s of c.annotation?.swings ?? []) if (!timing(c, s, e, ambiguous)) tally(excluded, s.events[e].status !== (ambiguous ? 'ambiguous' : 'observed') ? 'gt_' + s.events[e].status : missing(c, s, e));
      const prefix = `${ambiguous ? 'E1w' : 'E1'}.${e}`;
      const common = { exclusions: excluded, missing_prediction_rule: 'omitted from timing; counted in E2', eligibility: ambiguous ? 'eligible_gt_ambiguous verified pair; interval distance' : 'eligible verified pair; GT observed' };
      for (const axis of ['frames', 'ms'] as const) for (const aggregation of ['median', 'p90'] as const)
        result.push(metric(`${prefix}.${axis}.${aggregation}`, `Absolute ${axis} error; ${aggregation === 'p90' ? 'nearest-rank P90' : 'median'}`, samples.map(x => unit(x.c, x.s, x.t[axis])), { ...common, aggregation, unit: axis }));
      for (const [axis, bound] of [['frames', 1], ['ms', 33], ['ms', 66]] as const)
        result.push(metric(`${prefix}.hit_${bound}_${axis}`, `Error within ±${bound} ${axis}`, samples.map(x => unit(x.c, x.s, Number(x.t[axis] <= bound))), common));
    }
  }
  const claims: Unit[] = [], recall: Unit[] = [];
  for (const c of clips) for (const s of c.annotation?.swings ?? []) {
    const claim = c.record.status === 'paired' && !!prediction(pair(c, s, 'contact_confirmed'));
    if (claim) claims.push(unit(c, s, Number(s.events.contact_confirmed.status === 'observed')));
    if (s.events.contact_confirmed.status === 'observed') recall.push(unit(c, s, Number(claim)));
  }
  const na: Partial<Metric> = claims.length ? {} : { status: 'not_applicable', reason: 'engine_never_claims_contact_confirmed', value: null };
  result.push(metric('E3.precision', 'Observed GT confirmed contact / verified contact_confirmed claims', claims, na), metric('E3.recall', 'Verified confirmed contact claims / observed GT confirmed contacts', recall, na));
  const order: Unit[] = [];
  for (const c of clips.filter(c => c.record.status === 'paired')) {
    let eligible = false, violation = false;
    for (const s of c.annotation?.swings ?? []) {
      const frames = SWING_EVENTS.map(e => prediction(pair(c, s, e))?.frame_index).filter((x): x is number => x !== undefined);
      if (frames.length >= 2) eligible = true;
      if (frames.some((f, i) => i > 0 && f < frames[i - 1]!)) violation = true;
    }
    if (eligible) order.push(unit(c, null, Number(violation)));
  }
  result.push(metric('E4', 'Paired clips with an event order violation / paired clips with at least two verified main events', order, { eligibility: 'paired clips; SWING_EVENTS order within each swing' }));
  return result;
}
