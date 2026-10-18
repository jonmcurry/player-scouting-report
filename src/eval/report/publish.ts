import type { Comparison } from './compareRuns.ts';
import { metricKey, type Metrics } from '../score/metrics.ts';
/** Whitelist-only aggregate renderer. Never serialize arbitrary input metadata. */
export function publish(comparison: Comparison, base: Metrics, candidate: Metrics) {
  const lines = ['# Aggregate comparison summary', '', 'Repository publication requires explicit owner approval of this specific file.',
    'Development split, not production acceptance (§7.4/S1-09). All verdicts are inconclusive: no_preregistered_minimum_effect.', '',
    '| Metric | Capture profile | Base | Candidate |', '|---|---|---:|---:|'];
  const allowedProfiles = new Set(['game_backstop', 'open_side_practice', 'unknown_imported', 'other']);
  let roleIndex = 0, last = '';
  for (const row of comparison.rows) {
    if (!/^(E[1-4]|O[1-3]|G[1-3]|C1)(\.[a-z0-9_.]+)?$/.test(row.id)) continue;
    if (row.capture_profile !== null && !allowedProfiles.has(row.capture_profile)) continue;
    const role = JSON.stringify([row.base_partition, row.candidate_partition]);
    if (role !== last) { lines.push(`| Partition ${++roleIndex} | | | |`); last = role; }
    const safe = (m: Metrics, key: string) => {
      const samples = m.private.samples[metricKey(key, row.capture_profile, row.id)] ?? [];
      const swings = new Map<string, Set<string>>();
      for (const u of samples.filter(u => u.swing)) { const set = swings.get(u.athlete) ?? new Set<string>(); set.add(u.clip + ':' + u.swing); swings.set(u.athlete, set); }
      const n = [...swings.values()].reduce((s, g) => s + g.size, 0);
      return { eligible: swings.size >= 5 && n >= 20 && Math.max(0, ...[...swings.values()].map(x => x.size)) <= n / 2, n };
    };
    const b = safe(base, row.base_partition), c = safe(candidate, row.candidate_partition);
    const display = (v: number | null, n: number) => v === null ? 'not measured' : row.unit === 'fraction' ? `${Math.round(v * 100)}%` : row.unit === 'swings' && n < 100 ? String(Math.round(v / 5) * 5) : String(v);
    lines.push(`| ${row.id} | ${row.capture_profile ?? 'all profiles'} | ${b.eligible && c.eligible ? display(row.base, b.n) : 'suppressed (small sample)'} | ${b.eligible && c.eligible ? display(row.candidate, c.n) : 'suppressed (small sample)'} |`);
  }
  lines.push('', 'Latency and cost: not_recorded.', 'Not measured: coordinate and identity accuracy, V1/V3/V4 safety, threshold sweeps, and AI-layer metrics.');
  return lines.join('\n') + '\n';
}
