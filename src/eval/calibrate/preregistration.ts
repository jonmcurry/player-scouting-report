import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { canonicalJson, sha256 } from '../benchmark/registry.ts';
import { safePath } from '../score/inputs.ts';
import { isEvidenceTuple, resolveTuple, type EvidenceTuple } from '../../services/development/evidenceRegistry.ts';

/** Fixed before results; only the owner supplies the minimum. No numeric default. */
export const COVERAGE_DEFINITIONS = Object.freeze({
  stratum: '(concept, capture_profile, tuple)',
  denominator: 'claim-pass-path observations classified safe, unsafe or unmeasurable; failed and not_applicable excluded',
  numerator: 'measurable passes (safe + unsafe)',
  unknown_handling: 'every unknown on the pass path is unmeasurable and counts in the denominator, never in the numerator',
  exclusions: 'data/governance exclusions excluded before observation construction',
  // PR17 owner exception: early engine failures are pre-registered opportunities, not omissions.
  engine_failures: 'engine-attributable excluded clips with eligible annotations contribute one unmeasurable opportunity per annotated swing and enabled concept; they are never claim passes',
  run_binding: 'every profile source run must carry this policy digest in run.json config.coverage_preregistration_sha256, fixed before execution',
});
export interface CoveragePreregistration {
  schema: 'hitterloop.coverage-preregistration'; schema_version: '1.0.0'; policy_id: string;
  tuple: EvidenceTuple; definitions: typeof COVERAGE_DEFINITIONS; minimum_measurable_coverage: number;
  registered_at: string; approved_by: string; digest: string;
}
export function preregistrationDigest(p: CoveragePreregistration): string {
  const { digest: _, ...rest } = p; return sha256(canonicalJson(rest));
}
export function utcInstant(value: unknown): value is string {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{3})?Z$/.test(value)) return false;
  return Number.isFinite(Date.parse(value)) && new Date(value).toISOString() === value.replace(/(?<=:\d{2})Z$/, '.000Z');
}
/** Tuple-independent checks shared by the PR13 runner (before execution) and calibration. */
export function validatePreregistrationStructure(value: unknown): CoveragePreregistration {
  if (!value || typeof value !== 'object') throw new Error('INVALID_PREREGISTRATION');
  const p = value as CoveragePreregistration;
  if (p.schema !== 'hitterloop.coverage-preregistration' || p.schema_version !== '1.0.0'
    || typeof p.policy_id !== 'string' || !/^[a-z0-9][a-z0-9-]{7,63}$/.test(p.policy_id)
    || typeof p.approved_by !== 'string' || !/^[a-zA-Z0-9][a-zA-Z0-9_-]{7,63}$/.test(p.approved_by)
    || !utcInstant(p.registered_at)) throw new Error('INVALID_PREREGISTRATION');
  if (!Number.isFinite(p.minimum_measurable_coverage) || p.minimum_measurable_coverage <= 0
    || p.minimum_measurable_coverage > 1) throw new Error('INVALID_COVERAGE_MINIMUM');
  if (canonicalJson(p.definitions) !== canonicalJson(COVERAGE_DEFINITIONS)) throw new Error('PREREGISTRATION_DEFINITIONS_MISMATCH');
  if (!isEvidenceTuple(p.tuple) || p.tuple.reliabilityProfileVersion !== null || !resolveTuple(p.tuple)) throw new Error('PREREGISTRATION_TUPLE_MISMATCH');
  if (p.digest !== preregistrationDigest(p)) throw new Error('PREREGISTRATION_DIGEST_MISMATCH');
  return p;
}
export function validatePreregistration(value: unknown, tuple: EvidenceTuple, sourceStarts: readonly unknown[]): CoveragePreregistration {
  const p = validatePreregistrationStructure(value);
  if (canonicalJson(p.tuple) !== canonicalJson(tuple)) throw new Error('PREREGISTRATION_TUPLE_MISMATCH');
  if (!sourceStarts.length || sourceStarts.some(start => !utcInstant(start)
    || Date.parse(p.registered_at) >= Date.parse(start))) throw new Error('PREREGISTRATION_NOT_BEFORE_RESULTS');
  return p;
}
/** Accept absolute paths or EVAL_ROOT-relative paths, always inside preregistration/. */
export async function loadPreregistration(root: string, path: string): Promise<unknown> {
  const directory = await safePath(root, 'preregistration');
  return JSON.parse(await readFile(await safePath(directory, resolve(root, path)), 'utf8'));
}
