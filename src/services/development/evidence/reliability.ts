import type { ClaimReliability, Concept, EvidenceTuple } from './types.ts';
import { isEvidenceTuple } from '../evidenceRegistry.ts';
import { CLAIM_REQUIREMENTS } from './claimRequirements.ts';

export interface ReliabilityEntry {
  measurable_coverage: number | null;
  coverage_gate: 'not_preregistered' | 'not_bound_to_runs' | 'below_preregistered_minimum' | 'meets_preregistered_minimum' | 'not_applicable';
  concept: Concept; capture_profile: string;
  status: ClaimReliability['status'] | 'not_applicable';
  observed_unsafe_rate: number | null; ci95: [number | null, number | null]; upper_bound_95: number | null;
  n_swings: number; n_athletes: number; n_unmeasurable: number; reason: string | null;
}
export interface ReliabilityProfile {
  schema: 'hitterloop.reliability-profile'; schema_version: '1.2.0'; version: string;
  tuple: EvidenceTuple; data_origin: 'private_consented' | 'synthetic'; split: 'validation';
  decision_status: 'experimental' | 'validated_internal';
  /** bound_to_runs: every source run.json config carried this digest before execution (PR17). */
  coverage_preregistration: { policy_id: string; digest: string; minimum_measurable_coverage: number; bound_to_runs: boolean } | null;
  provenance: {
    sources: { run_id_hash: string; results_digest: string; metrics_inputs_digest: string;
      registry_sha256: string; annotation_digest: string }[];
    diagnostic_run_hashes: string[]; tuple: EvidenceTuple; gate_version: string; claims_version: string;
    seed: number; replicates: number; scorer_version: string; calibrator_version: string;
    exclusions: Record<string, number>; engine_confidence_present: number;
    unmeasurable_causes: Record<string, Record<string, number>>;
  };
  entries: ReliabilityEntry[]; profile_digest: string;
}
export const PRODUCTION_RELIABILITY_CATALOG: readonly ReliabilityProfile[] = Object.freeze([]);
export const sameTuple = (a: EvidenceTuple, b: EvidenceTuple) =>
  (Object.keys(a) as (keyof EvidenceTuple)[]).every(k => a[k] === b[k]);
const rate = (n: unknown): n is number => typeof n === 'number' && Number.isFinite(n) && n >= 0 && n <= 1;
const count = (n: unknown): n is number => Number.isSafeInteger(n) && (n as number) >= 0;
/** Portable structural checks; offline evaluation owns cryptographic verification.
 * This API does not authenticate an injected catalog. */
export function validReliabilityEntry(value: unknown): value is ReliabilityEntry {
  if (!value || typeof value !== 'object') return false;
  const e = value as ReliabilityEntry;
  if (!Object.hasOwn(CLAIM_REQUIREMENTS, e.concept) || typeof e.capture_profile !== 'string' || !e.capture_profile.trim()
    || ![e.n_swings, e.n_athletes, e.n_unmeasurable].every(count) || e.n_athletes > e.n_swings
    || !Array.isArray(e.ci95) || e.ci95.length !== 2 || !(e.reason === null || typeof e.reason === 'string')) return false;
  const disabled = CLAIM_REQUIREMENTS[e.concept].disabledReason !== null;
  const denominator = e.n_swings + e.n_unmeasurable;
  if (e.measurable_coverage !== (denominator ? e.n_swings / denominator : null)
    || !['not_preregistered', 'not_bound_to_runs', 'below_preregistered_minimum', 'meets_preregistered_minimum', 'not_applicable'].includes(e.coverage_gate)
    || (e.coverage_gate === 'not_applicable') !== (disabled || denominator === 0)) return false;
  if (e.status === 'unmeasured' || e.status === 'not_applicable') return disabled === (e.status === 'not_applicable')
    && e.n_swings === 0 && e.n_athletes === 0 && !!e.reason
    && [e.observed_unsafe_rate, e.upper_bound_95, ...e.ci95].every(n => n === null);
  if (disabled || !e.n_swings || !e.n_athletes || !rate(e.observed_unsafe_rate) || !rate(e.upper_bound_95)
    || !rate(e.ci95[0]) || !rate(e.ci95[1]) || e.ci95[0] > e.ci95[1]) return false;
  const expected = e.observed_unsafe_rate > 0.05 ? 'exceeds_ceiling'
    : e.upper_bound_95 <= 0.05 && e.n_athletes >= 5 ? 'within_ceiling' : 'inconclusive';
  if (expected !== 'within_ceiling') return e.status === expected;
  if (e.coverage_gate === 'meets_preregistered_minimum') return e.status === 'within_ceiling' && e.reason === null;
  return e.status === 'inconclusive' && e.reason === (e.coverage_gate === 'not_preregistered' ? 'coverage_not_preregistered'
    : e.coverage_gate === 'not_bound_to_runs' ? 'coverage_not_bound_to_runs' : 'coverage_below_preregistered_minimum');
}
export function validProfileStructure(value: unknown): value is ReliabilityProfile {
  if (!value || typeof value !== 'object') return false;
  const p = value as ReliabilityProfile;
  if (p.schema !== 'hitterloop.reliability-profile' || p.schema_version !== '1.2.0' || !isEvidenceTuple(p.tuple)
    || typeof p.version !== 'string' || p.tuple.reliabilityProfileVersion !== p.version
    || !p.version.startsWith(`rel-${p.tuple.engineCodeVersion}-${p.tuple.gateVersion}-`)
    || !/^\d{4}-\d{2}-\d{2}$/.test(p.version.slice(-10))
    || !['private_consented', 'synthetic'].includes(p.data_origin) || p.split !== 'validation'
    || !['experimental', 'validated_internal'].includes(p.decision_status)
    || typeof p.profile_digest !== 'string' || !/^[a-f0-9]{64}$/.test(p.profile_digest)
    || !Array.isArray(p.entries) || !p.entries.every(validReliabilityEntry)) return false;
  const policy = p.coverage_preregistration;
  if (policy !== null && (!policy || typeof policy.policy_id !== 'string' || !/^[a-z0-9][a-z0-9-]{7,63}$/.test(policy.policy_id)
    || typeof policy.digest !== 'string' || !/^[a-f0-9]{64}$/.test(policy.digest)
    || !rate(policy.minimum_measurable_coverage) || policy.minimum_measurable_coverage === 0
    || typeof policy.bound_to_runs !== 'boolean')) return false;
  if (p.entries.some(e => e.coverage_gate !== (e.status === 'not_applicable' || e.measurable_coverage === null
    ? 'not_applicable' : policy === null ? 'not_preregistered' : !policy.bound_to_runs ? 'not_bound_to_runs'
      : e.measurable_coverage >= policy.minimum_measurable_coverage
      ? 'meets_preregistered_minimum' : 'below_preregistered_minimum'))) return false;
  const date = p.version.slice(-10);
  if (!Number.isFinite(Date.parse(date)) || new Date(date).toISOString().slice(0, 10) !== date
    || p.version !== `rel-${p.tuple.engineCodeVersion}-${p.tuple.gateVersion}-${date}`) return false;
  return new Set(p.entries.map(e => JSON.stringify([e.concept, e.capture_profile]))).size === p.entries.length;
}
/** Validation/calibration belongs to Stage 1. A profile version alone is never
 * measurement. Production uses a frozen empty catalog; offline injection cannot
 * activate enforcement or certify per-clip correctness. */
export interface ReliabilityQuery { concept: Concept; tuple: EvidenceTuple; captureProfile: string | null }
export type ReliabilityLookup = (query: ReliabilityQuery) => ClaimReliability;
export function lookupReliability(concept: Concept, tuple: unknown, captureProfile: unknown,
  catalog: readonly ReliabilityProfile[] = PRODUCTION_RELIABILITY_CATALOG): ClaimReliability {
  const unmeasured: ClaimReliability = { concept, status: 'unmeasured', profileVersion: null,
    observedUnsafeRate: null, upperBound95: null, sampleSwings: null, sampleAthletes: null };
  if (!isEvidenceTuple(tuple) || !tuple.reliabilityProfileVersion || typeof captureProfile !== 'string'
    || !captureProfile.trim() || !Array.isArray(catalog)) return unmeasured;
  const matches = catalog.filter(p => p?.version === tuple.reliabilityProfileVersion);
  if (matches.length !== 1) return unmeasured;
  const p = matches[0]!;
  if (!validProfileStructure(p) || !sameTuple(p.tuple, tuple) || p.data_origin !== 'private_consented') return unmeasured;
  const e = p.entries.find(e => e.concept === concept && e.capture_profile === captureProfile);
  if (!e || e.status === 'unmeasured' || e.status === 'not_applicable'
    || (e.status === 'within_ceiling' && e.coverage_gate !== 'meets_preregistered_minimum')) return unmeasured;
  return { concept, status: e.status, profileVersion: p.version, observedUnsafeRate: e.observed_unsafe_rate,
    upperBound95: e.upper_bound_95, sampleSwings: e.n_swings, sampleAthletes: e.n_athletes };
}
