import type { Inputs, InputClip } from './inputs.ts';
import { metric, unit } from './events.ts';
const ENGINE_FAILURE_CODES = new Set(['ENGINE_EXECUTION_FAILED', 'PIPELINE_FAILED', 'PIPELINE_STATUS_UNAVAILABLE',
  'PROCESS_START_FAILED', 'ARTIFACT_INTEGRITY_FAILED', 'ARTIFACT_READ_FAILED']);
export function engineAttributable(c: InputClip) {
  return c.record.status === 'paired' || c.record.artifacts !== undefined || ENGINE_FAILURE_CODES.has(c.record.exclusion ?? '');
}
export function failures(input: Inputs, clips: InputClip[]) {
  const taxonomy = (code: string) => code === 'engine_terminal_low_quality_footage' ? 'low_quality_footage' : code === 'PIPELINE_FAILED' ? 'crash' : 'other';
  const codes = [...new Set([...input.clips.flatMap(c => c.record.exclusion ? [c.record.exclusion] : []), ...input.failures.map(f => f.code)])].sort();
  return codes.flatMap(code => ['exclusions', 'failures'].map(source => {
    const units = input.clips.map(c => {
      const count = !clips.includes(c) ? 0 : source === 'exclusions' ? Number(c.record.exclusion === code) : input.failures.filter(f => f.eval_id === c.record.eval_id && f.code === code).length;
      return unit(c, null, count);
    });
    const m = metric(`F1.${source}.${taxonomy(code)}.${code}`, `${source} occurrences of ${code} / all clips in run; partition-specific numerator`, units, { aggregation: 'rate', unit: 'occurrences per run clip', eligibility: 'all clips in run denominator; numerator from this partition only' });
    m.denominator = input.clips.length; m.value = m.denominator ? m.numerator / m.denominator : null;
    m.status = m.value === null ? 'unmeasured' : 'measured'; if (m.value !== null) delete m.reason;
    return m;
  }));
}
