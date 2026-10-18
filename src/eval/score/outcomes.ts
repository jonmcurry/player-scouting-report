import type { InputClip } from './inputs.ts';
import { metric, pair, prediction, tally, unit, type Unit } from './events.ts';
export function outcomes(clips: InputClip[], seed: number) {
  const matrix: Record<string, Record<string, number>> = {}, entries: Unit[] = [];
  const take: Unit[] = [], miss: Unit[] = [], takeEx: Record<string, number> = {}, missEx: Record<string, number> = {};
  for (const c of clips) for (const s of c.annotation?.swings ?? []) {
    if (c.record.status !== 'paired') {
      if (s.outcome === 'no_swing_take') tally(takeEx, c.record.exclusion ?? 'excluded');
      if (s.outcome === 'swing_miss') tally(missEx, c.record.exclusion ?? 'excluded');
      continue;
    }
    const raw = c.record.pairing?.outcomes.find(o => o.swing_id === s.swing_id)?.engine ?? 'not_recorded';
    tally(matrix[s.outcome] ??= {}, raw); entries.push(unit(c, s, 1));
    if (s.outcome === 'no_swing_take') take.push(unit(c, s, Number(!!prediction(pair(c, s, 'swing_launch')) || !!prediction(pair(c, s, 'impact_estimate')))));
    if (s.outcome === 'swing_miss') miss.push(unit(c, s, Number(!!prediction(pair(c, s, 'contact_confirmed')))));
  }
  return [metric('O1', 'GT swing outcome × raw engine classification; value is number of classified swings', entries, { matrix, aggregation: 'sum', unit: 'swings', eligibility: 'annotated swings in paired clips' }),
    metric('O2', 'Verified launch or impact on GT no_swing_take / GT no_swing_take in paired clips', take, { exclusions: takeEx, eligibility: 'GT no_swing_take in paired clips' }, seed),
    metric('O3', 'Verified contact_confirmed on GT swing_miss / GT swing_miss in paired clips', miss, { exclusions: missEx, eligibility: 'GT swing_miss in paired clips; impact_estimate never a claim' }, seed)];
}
