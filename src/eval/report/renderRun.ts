import type { Metrics, PublicMetric } from '../score/metrics.ts';
import { canonicalJson } from '../benchmark/registry.ts';
export const cell = (s: unknown) => String(s).replace(/[|\r\n]/g, ' ');
/** Fail closed rather than echo unexpected path-bearing input metadata. */
export function assertOutputSafe(text: string) {
  if (/[a-z]:[\\/]|(?:^|[\s"'])\/(?:[^/\s"']+\/)+[^\s"']+|\\\\[a-z0-9_-]+\\|\bUsers[\\/]|\.(?:mp4|mov|m4v|avi|webm|png|jpe?g)\b/i.test(text)) throw new Error('OUTPUT_PRIVACY_VIOLATION');
  return text;
}
export function table(metrics: PublicMetric[]) {
  return ['| Metric | Value | Numerator / denominator | Swings | Clips | Athletes | Status | 95% CI; upper |', '|---|---:|---:|---:|---:|---:|---|---|',
    ...metrics.map(m => `| ${cell(m.id)} | ${m.value ?? '—'} | ${m.numerator} / ${m.denominator} | ${m.n_swings} | ${m.n_clips} | ${m.n_athletes} | ${cell(m.reason ?? m.outcome ?? m.status)}; ${m.sample_status ?? ''} | ${m.statistics ? cell(canonicalJson(m.statistics)) : '—'} |`),
    '', ...metrics.flatMap(m => [
      ...(m.matrix ? [`${m.id} confusion matrix: ${canonicalJson(m.matrix)}`] : []),
      ...(m.agreement ? [`${m.id} agreement: ${canonicalJson(m.agreement)}`] : []),
      ...(Object.keys(m.exclusions).length ? [`${m.id} exclusions / nondetection reasons: ${canonicalJson(m.exclusions)}`] : []),
    ]) ].join('\n');
}
export function renderRun(m: Metrics, publicMode = false) {
  // Public output must use the dedicated suppression pipeline, never this private renderer.
  if (publicMode) throw new Error('USE_PUBLISH_SUMMARY');
  const lines = ['# Evaluation report (private)', '', `Run: ${m.run_id}; split: ${m.split}`, `Versions: ${canonicalJson(m.versions)}`, '',
    'Development split, not production acceptance (§7.4/S1-09). Validation-split inputs are also development diagnostics.', '',
    '## Data exclusions (not engine coverage)', '', canonicalJson(m.data_exclusions), '', table(m.data_failure_metrics), '',
    ...m.partitions.flatMap(p => [`## Partition ${cell(p.key)}`, `Full tuples: ${canonicalJson(p.tuples)}`, '', table(p.metrics),
      ...p.slices.flatMap(s => ['', `### Capture profile: ${s.capture_profile}`, '', table(s.metrics)])]),
    '', '## Not measured', '', ...m.unmeasured.map(x => `- ${x.id}: ${x.reason}`),
    ...m.partitions.flatMap(p => p.metrics.filter(x => x.status !== 'measured').map(x => `- ${x.id} (${cell(p.key)}): ${x.reason}`)),
    '', '## Repeatability', '', m.repeatability_label, '', canonicalJson(m.repeatability), '',
    'Private per-athlete distributions are stored only in metrics.json. No empirical accuracy result is implied by synthetic tests.'];
  return assertOutputSafe(lines.join('\n') + '\n');
}
