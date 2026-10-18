import { validatePreregistration, type CoveragePreregistration } from './preregistration.ts';
import { readFile } from 'node:fs/promises';
import { canonicalJson, sha256 } from '../benchmark/registry.ts';
import { loadInputs, safePath, type Inputs, type InputClip } from '../score/inputs.ts';
import { assembleMetrics, metricsDigest, type Metrics } from '../score/metrics.ts';
import { validateAnnotation } from '../schema/annotation.ts';
import { isEvidenceTuple, resolveTuple, type EvidenceTuple } from '../../services/development/evidenceRegistry.ts';
import { sameTuple, type ReliabilityProfile } from '../../services/development/evidence/reliability.ts';

export interface EligibleDataset {
  coverage_preregistration: CoveragePreregistration | null;
  inputs: Inputs[]; tuple: EvidenceTuple; data_origin: ReliabilityProfile['data_origin'];
  exclusions: Record<string, number>; sources: ReliabilityProfile['provenance']['sources']; diagnostic_run_hashes: string[];
}
/** No scoring writes: require an existing, reproducible PR14 metrics artifact. */
export async function loadScoredInputs(root: string, repo: string, id: string): Promise<Inputs> {
  const input = await loadInputs(root, repo, id);
  let m: Metrics;
  try { m = JSON.parse(await readFile(await safePath(input.root, 'results', id, 'metrics.json'), 'utf8')); }
  catch { throw new Error('SCORED_RUN_REQUIRED'); }
  if (!m.config || m.metrics_digest !== metricsDigest(m)
    || canonicalJson(m) !== canonicalJson(assembleMetrics(input, m.config.seed))) throw new Error('METRICS_INPUTS_MISMATCH');
  return input;
}
export function annotationExclusion(c: InputClip): string | null {
  // Keep the recorded PR13 code (e.g. withdrawn, consent) rather than relabelling it.
  if (!c.annotation) return c.record.exclusion ?? 'annotation_missing';
  if (!validateAnnotation(c.annotation).valid) return 'annotation_invalid';
  if (c.annotation.eval_clip_id !== c.registry.eval_id || c.annotation.source.sha256 !== c.registry.sha256) return 'annotation_invalid';
  if (c.annotation.annotation.review.disagreement === 'unresolved') return 'annotation_disagreement_unresolved';
  if (!['reviewed', 'adjudicated'].includes(c.annotation.annotation.review.status)) return 'annotation_not_reviewed';
  return null;
}
/** Pure layer for verified inputs and synthetic tests. The CLI always enters via
 * loadScoredInputs, which rechecks run/registry/annotation and metrics digests. */
export function eligibleDataset(profile: Inputs[], diagnostic: Inputs[] = [], preregistration?: unknown): EligibleDataset {
  if (!profile.length) throw new Error('PROFILE_RUN_REQUIRED');
  const runs = new Set<string>(), ids = new Set<string>(), sourceHashes = new Set<string>();
  for (const i of [...profile, ...diagnostic]) {
    if (i.run.config.split === 'test') throw new Error('TEST_SPLIT_REQUIRES_SEALED_ENVIRONMENT');
    if (runs.has(i.run.run_id)) throw new Error('DUPLICATE_SOURCE_RUN');
    runs.add(i.run.run_id);
  }
  if (profile.some(i => i.run.config.split !== 'validation')) throw new Error('PROFILE_SPLIT_MUST_BE_VALIDATION');
  if (diagnostic.some(i => i.run.config.split !== 'dev')) throw new Error('DIAGNOSTIC_SPLIT_MUST_BE_DEV');
  const devAthletes = new Set(diagnostic.flatMap(i => i.clips.map(c => c.registry.athlete_group)));
  let tuple: EvidenceTuple | undefined;
  for (const i of profile) {
    for (const c of i.clips) {
      if (ids.has(c.registry.eval_id)) throw new Error('DUPLICATE_EVAL_ID');
      ids.add(c.registry.eval_id);
      if (sourceHashes.has(c.registry.sha256)) throw new Error('DUPLICATE_SOURCE_CLIP');
      sourceHashes.add(c.registry.sha256);
      if (devAthletes.has(c.registry.athlete_group)) throw new Error('ATHLETE_GROUP_LEAKAGE');
      if (c.record.terminal && c.record.terminal.environment.environment_version !== i.run.preflight.environment_version) throw new Error('MIXED_TUPLES');
    }
    const tuples = [...(i.run.tuples ?? []), ...i.clips.flatMap(c => c.record.gates?.tuple ? [c.record.gates.tuple] : [])];
    if (!tuples.length) throw new Error('TUPLE_UNAVAILABLE');
    for (const t of tuples) {
      if (!isEvidenceTuple(t)) throw new Error('INVALID_EVIDENCE_TUPLE');
      if (tuple && !sameTuple(tuple, t)) throw new Error('MIXED_TUPLES');
      tuple = t;
      if (t.engineCodeVersion !== i.run.engine_version || t.environmentVersion !== i.run.preflight.environment_version) throw new Error('MIXED_TUPLES');
    }
  }
  if (!tuple || tuple.reliabilityProfileVersion !== null || !resolveTuple(tuple)) throw new Error('TUPLE_NOT_REGISTERED');
  const coverage_preregistration = preregistration === undefined ? null : validatePreregistration(preregistration, tuple,
    profile.map(i => (i.run as typeof i.run & { timing?: { start?: unknown } }).timing?.start));
  const exclusions: Record<string, number> = {}, origins = new Set<ReliabilityProfile['data_origin']>();
  const inputs = [...profile].sort((a, b) => a.run.run_id.localeCompare(b.run.run_id)).map(i => ({ ...i, clips: i.clips.filter(c => {
    const code = annotationExclusion(c);
    if (code) { exclusions[code] = (exclusions[code] ?? 0) + 1; return false; }
    origins.add(c.annotation!.data_origin); return true;
  }) }));
  if (origins.size > 1) throw new Error('MIXED_DATA_ORIGIN');
  if (!origins.size) throw new Error('NO_ELIGIBLE_ANNOTATIONS');
  const sources = [...profile].sort((a, b) => a.run.run_id.localeCompare(b.run.run_id)).map(i => ({
    run_id_hash: sha256(i.run.run_id), results_digest: i.run.results_digest, registry_sha256: i.run.registry_sha256,
    annotation_digest: i.annotation_digest, metrics_inputs_digest: sha256(canonicalJson({ results_digest: i.run.results_digest,
      registry_sha256: i.run.registry_sha256, annotation_digest: i.annotation_digest, clip_list_sha256: i.run.clip_list_sha256 })),
  }));
  return { coverage_preregistration, inputs, tuple, data_origin: [...origins][0]!, exclusions, sources,
    diagnostic_run_hashes: diagnostic.map(i => sha256(i.run.run_id)).sort() };
}
