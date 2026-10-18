import { readFile } from 'node:fs/promises';
import { canonicalJson, BenchmarkError } from '../benchmark/registry.ts';
import { loadInputs, safePath, type Inputs } from '../score/inputs.ts';
import { metricsDigest, metricKey, type Metrics, type Partition, type PublicMetric } from '../score/metrics.ts';
import { aggregate, metric, type Unit } from '../score/events.ts';
import { bootstrap, DEFAULT_SEED } from '../stats/clusterBootstrap.ts';
import { timing } from '../score/events.ts';
import { TOLERANCES } from '../score/gate.ts';
import { cell } from './renderRun.ts';
export interface ComparisonRow {
  base_partition: string; candidate_partition: string; capture_profile: string | null; id: string;
  base: number | null; candidate: number | null; difference: number | null; ci95: (number | null)[];
  dropped_replicates: number; verdict: 'inconclusive'; reason: string; sample_status: string;
  n_athletes: number; n_swings: number; unit: string; base_n_swings: number; candidate_n_swings: number;
}
export interface Comparison {
  schema: string; schema_version: string; base_run: string; candidate_run: string; split: string;
  versions: { base: Metrics['versions']; candidate: Metrics['versions'] }; tuples: { base: unknown[]; candidate: unknown[] };
  provenance: { base: Metrics['provenance']; candidate: Metrics['provenance'] }; population: { base: Metrics['population']; candidate: Metrics['population'] };
  rows: ComparisonRow[]; not_measured: string[]; failure_deltas: ComparisonRow[];
  repeatability: { base: unknown; candidate: unknown }; latency: string; cost: string;
  private: { regressions: { eval_id: string; base_frame: number; candidate_frame: number }[] };
  config: { seed: number; replicates: number }; unmatched_partitions: { base: string[]; candidate: string[] };
}
export async function loadScored(root: string, repo: string, id: string) {
  const input = await loadInputs(root, repo, id);
  const m: Metrics = JSON.parse(await readFile(await safePath(input.root, 'results', id, 'metrics.json'), 'utf8'));
  if (m.schema !== 'hitterloop.benchmark-metrics' || m.schema_version !== '1.0.0' || m.scorer_version !== 'score-1.0.0' || metricsDigest(m) !== m.metrics_digest) throw new BenchmarkError('METRICS_DIGEST_MISMATCH');
  if (m.run_id !== id || m.results_digest !== input.run.results_digest || m.annotation_file_hashes_digest !== input.annotation_digest || m.registry_sha256 !== input.run.registry_sha256 || m.split !== input.run.config.split || m.clip_list_sha256 !== input.run.clip_list_sha256) throw new BenchmarkError('METRICS_SOURCE_MISMATCH');
  return { input, metrics: m };
}
/** Compare the same evidence role while permitting engine/environment versions to differ.
 * Multiple tuples for one role are ambiguous and deliberately left unmatched. */
export function role(p: Partition) {
  if (!p.tuple) return p.key === 'tuple_unavailable' || p.key === 'failures_unattributed' ? p.key : canonicalJson({ failure_identity: p.identity });
  const t = { ...p.tuple as Record<string, unknown> };
  for (const k of ['engine', 'engineVersion', 'engineCodeVersion', 'engine_version', 'environmentVersion', 'environment_version']) delete t[k];
  return canonicalJson(t);
}
function pairedUnits(base: Unit[], candidate: Unit[]) {
  const ids = [...new Set(base.map(x => x.athlete))].filter(id => candidate.some(x => x.athlete === id)).sort();
  return ids.map(id => ({ base: base.filter(x => x.athlete === id), candidate: candidate.filter(x => x.athlete === id) }));
}
export function compareRuns(base: Metrics, candidate: Metrics, seed = DEFAULT_SEED): Comparison {
  if (base.split !== candidate.split) throw new BenchmarkError('SPLIT_MISMATCH');
  if (base.clip_list_sha256 !== candidate.clip_list_sha256) throw new BenchmarkError('CLIP_LIST_MISMATCH');
  const rows: ComparisonRow[] = [], unmatched = { base: [] as string[], candidate: [] as string[] }, matched = new Set<string>();
  const absent = new Set([...base.unmeasured, ...candidate.unmeasured].map(m => `${m.id}: ${m.reason}`));
  for (const m of [base, candidate]) for (const p of m.partitions) for (const x of [...p.metrics, ...p.slices.flatMap(s => s.metrics)]) if (x.status !== 'measured') absent.add(`${x.id}: ${x.reason}`);
  // An absent failure code means zero occurrences, not an unmeasured failure rate.
  const zeroFailure = (m: Metrics, id: string): PublicMetric => {
    const units = m.private.failure_denominator;
    const { _units, ...result } = metric(id, 'Zero occurrences / all run clips', units, { unit: 'occurrences per run clip' });
    return result;
  };
  const samples = (m: Metrics, p: string, profile: string | null, id: string) => m.private.samples[metricKey(p, profile, id)] ?? (id.startsWith('F1.') ? m.private.failure_denominator : []);
  for (const p of base.partitions) {
    const matches = candidate.partitions.filter(q => role(q) === role(p));
    if (matches.length !== 1 || base.partitions.filter(q => role(q) === role(p)).length !== 1) { unmatched.base.push(p.key); continue; }
    const q = matches[0]!; matched.add(q.key);
    const profiles = [null, ...new Set([...p.slices, ...q.slices].map(s => s.capture_profile))];
    for (const profile of profiles) {
      const bm = profile === null ? p.metrics : p.slices.find(s => s.capture_profile === profile)?.metrics ?? [];
      const cm = profile === null ? q.metrics : q.slices.find(s => s.capture_profile === profile)?.metrics ?? [];
      for (const id of [...new Set([...bm, ...cm].map(m => m.id))].sort()) {
        const b = bm.find(m => m.id === id) ?? (id.startsWith('F1.') ? zeroFailure(base, id) : undefined), c = cm.find(m => m.id === id) ?? (id.startsWith('F1.') ? zeroFailure(candidate, id) : undefined);
        if (!b || !c || b.status !== 'measured' || c.status !== 'measured') { absent.add(`${id}: ${b?.reason ?? c?.reason ?? 'metric_missing_in_one_run'}`); continue; }
        const groups = pairedUnits(samples(base, p.key, profile, id), samples(candidate, q.key, profile, id));
        const statistic = (sample: typeof groups) => {
          const bv = aggregate(sample.flatMap(g => g.base.map(u => u.value)), b.aggregation);
          const cv = aggregate(sample.flatMap(g => g.candidate.map(u => u.value)), c.aggregation);
          return bv === null || cv === null ? null : cv - bv;
        };
        const ci = bootstrap(groups, statistic, seed);
        rows.push({ base_partition: p.key, candidate_partition: q.key, capture_profile: profile, id,
          base: b.value, candidate: c.value, difference: statistic(groups), ci95: ci.ci95, dropped_replicates: ci.dropped_replicates,
          verdict: 'inconclusive', reason: 'no_preregistered_minimum_effect', sample_status: groups.length < 5 ? 'insufficient_sample' : 'adequate',
          n_athletes: groups.length, n_swings: Math.min(b.n_swings, c.n_swings), base_n_swings: b.n_swings, candidate_n_swings: c.n_swings, unit: b.unit });
      }
    }
  }
  unmatched.candidate = candidate.partitions.filter(p => !matched.has(p.key)).map(p => p.key);
  return { schema: 'hitterloop.benchmark-comparison', schema_version: '1.0.0', base_run: base.run_id, candidate_run: candidate.run_id,
    split: base.split, versions: { base: base.versions, candidate: candidate.versions }, tuples: { base: base.partitions.map(p => p.tuple), candidate: candidate.partitions.map(p => p.tuple) },
    provenance: { base: base.provenance, candidate: candidate.provenance }, population: { base: base.population, candidate: candidate.population },
    rows, not_measured: [...absent].sort(), failure_deltas: rows.filter(r => r.id.startsWith('F1.')),
    repeatability: { base: base.repeatability, candidate: candidate.repeatability }, latency: 'not_recorded', cost: 'not_recorded',
    private: { regressions: [] }, config: { seed, replicates: 2000 }, unmatched_partitions: unmatched };
}
export function regressions(base: Inputs, candidate: Inputs) {
  const results: Comparison['private']['regressions'] = [];
  for (const b of base.clips) {
    const c = candidate.clips.find(c => c.record.eval_id === b.record.eval_id); if (!c) continue;
    for (const s of b.annotation?.swings ?? []) {
      const cs = c.annotation?.swings.find(x => x.swing_id === s.swing_id); if (!cs) continue;
      for (const event of ['impact_estimate', 'foot_plant'] as const) {
        const bt = timing(b, s, event), ct = timing(c, cs, event);
        if (bt && ct && ct.frames - bt.frames > TOLERANCES[event]!) results.push({ eval_id: b.record.eval_id, base_frame: bt.frame, candidate_frame: ct.frame });
      }
    }
  }
  return results;
}
export function renderComparison(c: Comparison, template: string) {
  const rows = ['| Base tuple → candidate tuple | Metric | Profile | Base | Candidate | Paired difference | 95% CI | Verdict |', '|---|---|---|---:|---:|---:|---|---|',
    ...c.rows.map(r => r.sample_status === 'insufficient_sample' && r.capture_profile !== null ? `| ${cell(r.base_partition)} → ${cell(r.candidate_partition)} | ${cell(r.id)} | ${cell(r.capture_profile)} | insufficient sample | | | | inconclusive |` : `| ${cell(r.base_partition)} → ${cell(r.candidate_partition)} | ${cell(r.id)} | ${cell(r.capture_profile ?? 'partition')} | ${r.base} | ${r.candidate} | ${r.difference} | ${cell(canonicalJson(r.ci95))} | inconclusive: ${r.reason} |`)].join('\n');
  const replacements: Record<string, string> = { header: canonicalJson({ base: c.base_run, candidate: c.candidate_run, split: c.split, versions: c.versions, tuples: c.tuples, provenance: c.provenance, population: c.population }), rows,
    failures: canonicalJson(c.failure_deltas), repeatability: canonicalJson(c.repeatability), not_measured: c.not_measured.map(x => `- ${cell(x)}`).join('\n'),
    regressions: c.private.regressions.map(x => `- ${x.eval_id}: ${x.base_frame} → ${x.candidate_frame}`).join('\n') || 'None', unmatched: canonicalJson(c.unmatched_partitions) };
  return template.replace(/\{\{(\w+)\}\}/g, (_, name: string) => replacements[name] ?? 'not_recorded').trimEnd() + '\n';
}
