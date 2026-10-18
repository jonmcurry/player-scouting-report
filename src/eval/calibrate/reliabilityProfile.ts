import { validatePreregistration, type CoveragePreregistration } from './preregistration.ts';
import { canonicalJson, sha256 } from '../benchmark/registry.ts';
import { clusterBootstrap, random, REPLICATES } from '../stats/clusterBootstrap.ts';
import { resolveTuple } from '../../services/development/evidenceRegistry.ts';
import { CLAIM_REQUIREMENTS } from '../../services/development/evidence/claimRequirements.ts';
import type { Concept } from '../../services/development/evidence/types.ts';
import { validProfileStructure, type ReliabilityProfile, type ReliabilityEntry } from '../../services/development/evidence/reliability.ts';
import { classifyObservation, validateObservations, observationsFromInputs, type Observation } from './observations.ts';
import type { EligibleDataset } from './eligibility.ts';

export const CALIBRATOR_VERSION = 'calibrate-1.0.0';
export function validateDate(date: string) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date) || !Number.isFinite(Date.parse(date))
    || new Date(date).toISOString().slice(0, 10) !== date) throw new Error('INVALID_DATE');
}
export function profileDigest(p: ReliabilityProfile) {
  const { profile_digest: _, ...rest } = p; return sha256(canonicalJson(rest));
}
export function verifyProfile(value: unknown): { valid: true; registration: 'registered' | 'not_registered' } {
  if (!validProfileStructure(value)) throw new Error('INVALID_PROFILE');
  if (profileDigest(value) !== value.profile_digest) throw new Error('PROFILE_DIGEST_MISMATCH');
  const base = { ...value.tuple, reliabilityProfileVersion: null };
  if (!resolveTuple(base)) throw new Error('TUPLE_NOT_REGISTERED');
  const p = value.provenance;
  if (!p || canonicalJson(p.tuple) !== canonicalJson(base) || p.gate_version !== base.gateVersion || p.claims_version !== base.claimsVersion
    || p.replicates !== REPLICATES || p.calibrator_version !== CALIBRATOR_VERSION || p.scorer_version !== 'score-1.0.0'
    || !Array.isArray(p.sources) || !p.sources.length || p.sources.some(s => Object.values(s).some(v => !/^[a-f0-9]{64}$/.test(v)))
    || !Array.isArray(p.diagnostic_run_hashes) || p.diagnostic_run_hashes.some(h => !/^[a-f0-9]{64}$/.test(h))) throw new Error('INVALID_PROVENANCE');
  random(p.seed);
  return { valid: true, registration: resolveTuple(value.tuple) ? 'registered' : 'not_registered' };
}
export function estimateEntries(observations: Observation[], seed = 1, captureProfiles: string[] = [], policy: CoveragePreregistration | null = null,
  boundToRuns = false) {
  validateObservations(observations); random(seed);
  const entries: ReliabilityEntry[] = [], causes: Record<string, Record<string, number>> = {};
  for (const capture_profile of [...new Set([...captureProfiles, ...observations.map(o => o.capture_profile)])].sort()) {
    for (const concept of (Object.keys(CLAIM_REQUIREMENTS) as Concept[]).sort()) {
      const rows = observations.filter(o => o.concept === concept && o.capture_profile === capture_profile)
        .sort((a, b) => a.athlete_group.localeCompare(b.athlete_group) || a.clip_hash.localeCompare(b.clip_hash) || a.swing_hash.localeCompare(b.swing_hash));
      const groups = new Map<string, { numerator: number; denominator: number }>();
      const reasons: Record<string, number> = {}; let n_unmeasurable = 0;
      for (const o of rows) {
        const c = classifyObservation(o);
        if (c.status === 'unmeasurable') { n_unmeasurable++; for (const r of c.causes) reasons[r] = (reasons[r] ?? 0) + 1; }
        if (c.status === 'safe' || c.status === 'unsafe') {
          const g = groups.get(o.athlete_group) ?? { numerator: 0, denominator: 0 };
          g.denominator++; g.numerator += Number(c.status === 'unsafe'); groups.set(o.athlete_group, g);
        }
      }
      causes[JSON.stringify([concept, capture_profile])] = reasons;
      const n_swings = [...groups.values()].reduce((n, g) => n + g.denominator, 0), n_athletes = groups.size;
      const disabled = CLAIM_REQUIREMENTS[concept].disabledReason;
      const denominator = n_swings + n_unmeasurable;
      const measurable_coverage = denominator ? n_swings / denominator : null;
      // PR17: a policy only counts when every source run bound its digest before execution.
      const coverage_gate = disabled || !denominator ? 'not_applicable' : !policy ? 'not_preregistered' : !boundToRuns ? 'not_bound_to_runs'
        : measurable_coverage! >= policy.minimum_measurable_coverage ? 'meets_preregistered_minimum' : 'below_preregistered_minimum';
      if (!n_swings) {
        entries.push({ concept, capture_profile, measurable_coverage, coverage_gate, status: disabled ? 'not_applicable' : 'unmeasured',
          observed_unsafe_rate: null, ci95: [null, null], upper_bound_95: null, n_swings, n_athletes, n_unmeasurable,
          reason: disabled ?? 'no_measurable_claim_passes' }); continue;
      }
      const observed_unsafe_rate = [...groups.values()].reduce((n, g) => n + g.numerator, 0) / n_swings;
      const stats = clusterBootstrap([...groups.values()], seed);
      // A probability bound is capped at 1 when rule-of-three exceeds 100%.
      const upper_bound_95 = Math.min(1, stats.upper95!);
      // D8 provisional ceiling; no tuning or threshold selection occurs here.
      const d8Status = observed_unsafe_rate > 0.05 ? 'exceeds_ceiling'
        : upper_bound_95 <= 0.05 && n_athletes >= 5 ? 'within_ceiling' : 'inconclusive';
      const gated = d8Status === 'within_ceiling' && coverage_gate !== 'meets_preregistered_minimum';
      const status = gated ? 'inconclusive' : d8Status;
      entries.push({ concept, capture_profile, measurable_coverage, coverage_gate, status, observed_unsafe_rate, ci95: [stats.ci95[0]!, stats.ci95[1]!],
        upper_bound_95, n_swings, n_athletes, n_unmeasurable, reason: gated ? (coverage_gate === 'not_preregistered' ? 'coverage_not_preregistered'
          : coverage_gate === 'not_bound_to_runs' ? 'coverage_not_bound_to_runs' : 'coverage_below_preregistered_minimum') : status === 'exceeds_ceiling' ? 'point_estimate_exceeds_ceiling'
          : status === 'within_ceiling' ? null : n_athletes < 5 ? 'insufficient_sample' : 'upper_bound_above_ceiling' });
    }
  }
  return { entries, causes, engine_confidence_present: observations.filter(o => Object.hasOwn(o, 'engine_confidence')).length };
}
/** Observation injection is restricted to synthetic estimator tests. Real inputs
 * always use the PR13 adapter, which cannot manufacture V3 or identity truth. */
export function buildProfile(dataset: EligibleDataset, date: string, seed = 1, syntheticObservations?: Observation[]): ReliabilityProfile {
  validateDate(date);
  if (syntheticObservations && dataset.data_origin !== 'synthetic') throw new Error('SYNTHETIC_INJECTION_ONLY');
  if (dataset.coverage_preregistration) validatePreregistration(dataset.coverage_preregistration, dataset.tuple,
    dataset.inputs.map(i => (i.run as typeof i.run & { timing?: { start?: unknown } }).timing?.start));
  const observations = syntheticObservations ?? dataset.inputs.flatMap(observationsFromInputs);
  const captures = dataset.inputs.flatMap(i => i.clips.flatMap(c => c.annotation ? [c.annotation.camera.capture_profile] : []));
  const policy = dataset.coverage_preregistration;
  const bound = !!policy && dataset.inputs.length > 0 && dataset.inputs.every(i =>
    (i.run.config as { coverage_preregistration_sha256?: unknown }).coverage_preregistration_sha256 === policy.digest);
  const estimate = estimateEntries(observations, seed, captures, policy, bound), version = `rel-${dataset.tuple.engineCodeVersion}-${dataset.tuple.gateVersion}-${date}`;
  const profile: ReliabilityProfile = { schema: 'hitterloop.reliability-profile', schema_version: '1.2.0', version,
    tuple: { ...dataset.tuple, reliabilityProfileVersion: version }, data_origin: dataset.data_origin,
    split: 'validation', decision_status: 'experimental',
    coverage_preregistration: dataset.coverage_preregistration ? {
      policy_id: dataset.coverage_preregistration.policy_id, digest: dataset.coverage_preregistration.digest,
      minimum_measurable_coverage: dataset.coverage_preregistration.minimum_measurable_coverage, bound_to_runs: bound } : null,
    provenance: { sources: dataset.sources, diagnostic_run_hashes: dataset.diagnostic_run_hashes, tuple: dataset.tuple,
      gate_version: dataset.tuple.gateVersion, claims_version: dataset.tuple.claimsVersion, seed, replicates: REPLICATES,
      scorer_version: 'score-1.0.0', calibrator_version: CALIBRATOR_VERSION, exclusions: dataset.exclusions,
      engine_confidence_present: estimate.engine_confidence_present, unmeasurable_causes: estimate.causes },
    entries: estimate.entries, profile_digest: '' };
  profile.profile_digest = profileDigest(profile); verifyProfile(profile); return profile;
}
