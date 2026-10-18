import { SWING_EVENTS } from '../schema/annotation.ts';
import type { InputClip } from './inputs.ts';
import { metric, timing, pair, prediction, tally, unit, type Unit, type Metric } from './events.ts';
export const TOLERANCES: Partial<Record<typeof SWING_EVENTS[number], number>> = { impact_estimate: 2, foot_plant: 3 };
export function gates(clips: InputClip[], seed: number): Metric[] {
  const result: Metric[] = [], agreement = { both_pass: 0, dimensional_only: 0, strict_only: 0, neither: 0 }, differences: Unit[] = [];
  for (const dimension of ['v1', ...SWING_EVENTS.map(e => `v2.${e}`), 'dimensional', 'strict']) {
    const eligible: Unit[] = [], all: Unit[] = [], exclusions: Record<string, number> = {};
    for (const c of clips) for (const s of c.annotation?.swings ?? []) {
      const g = c.record.gates;
      const passing = !!g && g.status === 'evaluated' && (dimension === 'v1' ? g.v1.status === 'pass' : dimension === 'strict' ? g.strict.status === 'eligible' : dimension === 'dimensional' ? g.clip_status === 'eligible' : g.v2[dimension.slice(3)]?.status === 'pass');
      all.push(unit(c, s, Number(c.record.status === 'paired' && passing)));
      if (c.record.status === 'paired') eligible.push(unit(c, s, Number(passing)));
      else tally(exclusions, c.record.exclusion ?? 'excluded');
    }
    result.push(metric(`G1.${dimension}`, `${dimension} passes / annotated swings in paired clips`, eligible, { exclusions, eligibility: 'all annotated swings in paired clips' }, seed));
    result.push(metric(`G1.${dimension}.with_failures`, `${dimension} passes / all annotated swings in this partition including excluded clips`, all, { exclusions, eligibility: 'all annotated swings in partition' }, seed));
  }
  for (const c of clips.filter(c => c.record.status === 'paired')) for (const s of c.annotation?.swings ?? []) {
    const g = c.record.gates, d = g?.status === 'evaluated' && g.clip_status === 'eligible', strict = g?.status === 'evaluated' && g.strict.status === 'eligible';
    agreement[d ? strict ? 'both_pass' : 'dimensional_only' : strict ? 'strict_only' : 'neither']++;
    differences.push(unit(c, s, Number(d) - Number(strict)));
  }
  result.push(metric('G2.difference', 'Dimensional minus strict coverage on identical annotated paired swings', differences, { aggregation: 'mean', agreement }));
  for (const name of ['dimensional', 'strict']) {
    const original = result.find(m => m.id === `G1.${name}`)!;
    result.push({ ...original, id: `G2.${name}`, agreement });
  }
  for (const e of SWING_EVENTS) {
    const tolerance = TOLERANCES[e], units: Unit[] = [], exclusions: Record<string, number> = {};
    for (const c of clips) for (const s of c.annotation?.swings ?? []) {
      const g = c.record.gates;
      if (g?.status !== 'evaluated' || g.v2[e]?.status !== 'pass') continue;
      if (s.events[e].status !== 'observed') { tally(exclusions, 'gt_' + s.events[e].status); continue; }
      const t = timing(c, s, e);
      if (!t || !prediction(pair(c, s, e))) { tally(exclusions, 'pass_without_verified_pair'); continue; }
      if (tolerance !== undefined) units.push(unit(c, s, Number(t.frames > tolerance)));
    }
    const m = metric(`G3.${e}`, 'Unsafe verified V2 passes / V2 passes with observed GT and eligible verified pair', units,
      { exclusions, eligibility: 'V2 pass and eligible verified pair; observed GT', missing_prediction_rule: 'pass_without_verified_pair; unmeasurable, never safe', ...(tolerance === undefined ? { reason: 'no_approved_tolerance' } : {}) }, seed);
    m.diagnostic = 'development-split diagnostic; not production acceptance (§7.4/S1-09); ceiling 0.05 provisional D8';
    m.outcome = m.value !== null && m.value > 0.05 ? 'fail' : m.n_athletes >= 5 && m.statistics?.upper95 !== null && m.statistics?.upper95 !== undefined && m.statistics.upper95 <= 0.05 ? 'pass' : 'inconclusive';
    result.push(m);
  }
  return result;
}
