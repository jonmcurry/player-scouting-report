import { canonicalJson, sha256, BenchmarkError } from '../benchmark/registry.ts';
import { events, athleteCounts, type Metric, type Unit } from './events.ts';
import { outcomes } from './outcomes.ts';
import { gates } from './gate.ts';
import { coverage } from './coverage.ts';
import { failures, engineAttributable } from './failures.ts';
import { unmeasured } from './unmeasured.ts';
import type { Inputs, InputClip } from './inputs.ts';
import { DEFAULT_SEED, REPLICATES, random } from '../stats/clusterBootstrap.ts';
import { NORMALIZER_VERSION } from '../normalize/engineObservations.ts';
export type PublicMetric = Omit<Metric, '_units'>;
export interface Slice { capture_profile: string | null; metrics: PublicMetric[] }
export interface Partition { key: string; identity: unknown; tuple: unknown; tuples: unknown[]; metrics: PublicMetric[]; slices: Slice[] }
export interface Metrics {
  schema: string; schema_version: string; scorer_version: string; run_id: string; results_digest: string;
  registry_sha256: string; annotation_file_hashes_digest: string; clip_list_sha256: string; split: string;
  versions: { runner: string; normalizer: string; annotation_schema: string; record_schema: string };
  provenance: { engine: string; environment_version: string | null; models_lock_sha256: string | null; requirements_lock_sha256: string | null; git_commit: string | null };
  population: { clips: number; athletes: number; swings: number };
  partitions: Partition[]; unmeasured: PublicMetric[]; repeatability: unknown; repeatability_label: string;
  data_exclusions: Record<string, number>; data_failure_metrics: PublicMetric[];
  private: { per_athlete: Record<string, Record<string, { numerator: number; denominator: number }>>; samples: Record<string, Unit[]>;
    unsafe_pass_distribution: Record<string, { athletes_with_unsafe_pass: number; maximum_per_athlete_unsafe_rate: number | null }>; failure_denominator: Unit[] };
  config: { seed: number; replicates: number }; metrics_digest: string;
}
export const metricKey = (partition: string, profile: string | null, id: string) => canonicalJson([partition, profile, id]);
export function partition(c: InputClip, input: Inputs): { key: string; identity: unknown; tuple: unknown } {
  const g = c.record.gates;
  if (c.record.status === 'paired') {
    if (!g || g.status === 'not_evaluated' || !g.tuple) return { key: 'tuple_unavailable', identity: null, tuple: null };
    const { engineCodeVersion, instrumentationVersion, environmentVersion } = g.tuple;
    const identity = { engineCodeVersion, instrumentationVersion, environmentVersion };
    return { key: canonicalJson(identity), identity, tuple: g.tuple };
  }
  const versions = [...new Set((input.run.tuples ?? []).map(t => t.instrumentationVersion))];
  if (versions.length !== 1 || typeof versions[0] !== 'string' || !versions[0]) return { key: 'failures_unattributed', identity: null, tuple: null };
  const identity = { engineCodeVersion: input.run.engine_version, instrumentationVersion: versions[0],
    environmentVersion: c.record.terminal ? c.record.terminal.environment.environment_version : input.run.preflight.environment_version };
  return { key: canonicalJson(identity), identity, tuple: null };
}
export function metricsDigest(m: Omit<Metrics, 'metrics_digest'> | Metrics) {
  const { metrics_digest: _, ...rest } = m as Metrics; return sha256(canonicalJson(rest));
}
export function assembleMetrics(input: Inputs, seed = DEFAULT_SEED): Metrics {
  random(seed);
  const groups = new Map<string, { identity: unknown; tuples: Map<string, unknown>; clips: InputClip[] }>();
  const dataClips = input.clips.filter(c => !engineAttributable(c)), data_exclusions: Record<string, number> = {};
  for (const c of dataClips) { const code = c.record.exclusion ?? 'excluded'; data_exclusions[code] = (data_exclusions[code] ?? 0) + 1; }
  for (const c of input.clips.filter(engineAttributable)) {
    const p = partition(c, input);
    if (!groups.has(p.key)) groups.set(p.key, { identity: p.identity, tuples: new Map(), clips: [] });
    const group = groups.get(p.key)!;
    if (p.tuple) group.tuples.set(canonicalJson(p.tuple), p.tuple);
    if (group.tuples.size > 1) throw new BenchmarkError('MIXED_TUPLES_IN_PARTITION');
    group.clips.push(c);
  }
  const privateData: Metrics['private'] = { per_athlete: {}, samples: {}, unsafe_pass_distribution: {},
    failure_denominator: input.clips.map(c => ({ athlete: c.registry.athlete_group, clip: sha256(c.record.eval_id), swing: '', value: 0 })) };
  const partitions = [...groups].sort(([a], [b]) => a.localeCompare(b)).map(([key, group]) => {
    const compute = (clips: InputClip[], profile: string | null) => {
      const raw = [...events(clips, seed), ...outcomes(clips, seed), ...gates(clips, seed), ...coverage(clips), ...failures(input, clips)];
      return raw.map(({ _units, ...m }) => {
        const missingAnnotations = clips.filter(c => !c.annotation).length;
        if (missingAnnotations) m.exclusions = { ...m.exclusions, annotation_unavailable_clips: missingAnnotations };
        const k = metricKey(key, profile, m.id);
        // Comparison needs unit membership, never raw evaluation or swing identifiers.
        privateData.samples[k] = _units.map(u => ({ ...u, clip: sha256(u.clip), swing: u.swing ? sha256(u.swing) : '' }));
        privateData.per_athlete[k] = athleteCounts(_units);
        if (m.id.startsWith('G3.')) {
          const groups = Object.values(privateData.per_athlete[k]!);
          privateData.unsafe_pass_distribution[k] = { athletes_with_unsafe_pass: groups.filter(g => g.numerator > 0).length,
            maximum_per_athlete_unsafe_rate: groups.length ? Math.max(...groups.map(g => g.numerator / g.denominator)) : null };
        }
        return m;
      });
    };
    const tuples = [...group.tuples.values()];
    return { key, identity: group.identity, tuple: tuples[0] ?? null, tuples, metrics: compute(group.clips, null), slices: [...new Set(group.clips.map(c => c.annotation?.camera.capture_profile ?? 'annotation_unavailable'))].sort().map(profile => ({ capture_profile: profile, metrics: compute(group.clips.filter(c => (c.annotation?.camera.capture_profile ?? 'annotation_unavailable') === profile), profile) })) };
  });
  const m: Metrics = { schema: 'hitterloop.benchmark-metrics', schema_version: '1.0.0', scorer_version: 'score-1.0.0',
    run_id: input.run.run_id, results_digest: input.run.results_digest, registry_sha256: input.run.registry_sha256,
    annotation_file_hashes_digest: input.annotation_digest, clip_list_sha256: input.run.clip_list_sha256, split: input.run.config.split,
    versions: { runner: input.run.runner_version, normalizer: NORMALIZER_VERSION, annotation_schema: '1.0.0', record_schema: '1.0.0' },
    provenance: { engine: input.run.engine_version, environment_version: input.run.preflight.environment_version, models_lock_sha256: input.run.models_lock_sha256 ?? null, requirements_lock_sha256: input.run.requirements_lock_sha256 ?? null, git_commit: input.run.git_commit ?? null },
    population: { clips: input.clips.length, athletes: new Set(input.clips.map(c => c.registry.athlete_group)).size, swings: input.clips.reduce((n, c) => n + (c.annotation?.swings.length ?? 0), 0) },
    partitions, data_exclusions, data_failure_metrics: failures(input, dataClips).map(({ _units, ...m }) => m),
    unmeasured: unmeasured(), repeatability: input.run.repeatability, repeatability_label: 'run-to-run repeatability, not accuracy',
    private: privateData, config: { seed, replicates: REPLICATES }, metrics_digest: '' };
  m.metrics_digest = metricsDigest(m); return m;
}
