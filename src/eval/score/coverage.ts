import { SWING_EVENTS } from '../schema/annotation.ts';
import type { InputClip } from './inputs.ts';
import { metric, pair, prediction, tally, unit } from './events.ts';
export function coverage(clips: InputClip[]) {
  const exclusions: Record<string, number> = {};
  for (const c of clips) if (c.record.status === 'excluded') tally(exclusions, c.record.exclusion ?? 'excluded');
  return [metric('C1.paired', 'Paired clips / all clips in partition including failures', clips.map(c => unit(c, null, Number(c.record.status === 'paired'))), { exclusions, eligibility: 'all clips', unit: 'fraction of clips' }),
    ...SWING_EVENTS.map(e => metric(`C1.${e}`, 'Swings with verified assigned event estimate / all annotated swings including failures', clips.flatMap(c => (c.annotation?.swings ?? []).map(s => unit(c, s, Number(c.record.status === 'paired' && !!prediction(pair(c, s, e)))))), { exclusions, eligibility: 'all annotated swings including excluded clips' }))];
}
