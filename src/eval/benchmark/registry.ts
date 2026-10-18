import { createHash } from 'node:crypto';
import { canonicalJson } from '../normalize/engineObservations.ts';

export { canonicalJson };
export const sha256 = (bytes: string | Uint8Array): string => createHash('sha256').update(bytes).digest('hex');
export const OPAQUE_ID = /^[a-z0-9][a-z0-9-]{7,63}$/;
export const EVAL_ID = /^eval_[a-f0-9]{16}$/;
export const HASH = /^[a-f0-9]{64}$/;
export class BenchmarkError extends Error {
  constructor(readonly code: string) { super(code); }
}
export interface RegistryClip {
  eval_id: string; sha256: string; split: 'dev' | 'validation'; athlete_group: string;
  consent: { consent_ref: string; eval_annotation: boolean; eval_external_ai: boolean };
  status: 'active' | 'withdrawn'; media_ext: 'mp4' | 'mov' | 'm4v';
}
const object = (v: unknown): v is Record<string, unknown> => !!v && typeof v === 'object' && !Array.isArray(v);
const keys = (v: Record<string, unknown>, expected: string[]) => Object.keys(v).sort().join(',') === expected.sort().join(',');
export function parseRegistry(text: string): RegistryClip[] {
  const lines = text.replace(/\r\n/g, '\n').replace(/\n$/, '').split('\n');
  let values: unknown[];
  try { values = lines.map(line => JSON.parse(line)); } catch { throw new BenchmarkError('REGISTRY_INVALID_JSON'); }
  const header = values.shift();
  if (!object(header) || header.registry_version !== 1) throw new BenchmarkError('UNSUPPORTED_REGISTRY_VERSION');
  if (!keys(header, ['registry_version'])) throw new BenchmarkError('REGISTRY_UNKNOWN_KEYS');
  const ids = new Set<string>(), hashes = new Set<string>(), groups = new Map<string, string>();
  for (const value of values) {
    if (!object(value)) throw new BenchmarkError('REGISTRY_INVALID_FIELDS');
    if (value.split === 'test') throw new BenchmarkError('TEST_SPLIT_IN_CLEAR_REGISTRY');
    if (!keys(value, ['eval_id', 'sha256', 'split', 'athlete_group', 'consent', 'status', 'media_ext']) ||
        (object(value.consent) && !keys(value.consent, ['consent_ref', 'eval_annotation', 'eval_external_ai']))) throw new BenchmarkError('REGISTRY_UNKNOWN_KEYS');
    const c = value.consent;
    if (typeof value.eval_id !== 'string' || !EVAL_ID.test(value.eval_id) ||
        typeof value.athlete_group !== 'string' || !OPAQUE_ID.test(value.athlete_group) ||
        typeof value.sha256 !== 'string' || !HASH.test(value.sha256) || !['dev', 'validation'].includes(String(value.split)) ||
        !['active', 'withdrawn'].includes(String(value.status)) || !['mp4', 'mov', 'm4v'].includes(String(value.media_ext)) ||
        !object(c) || typeof c.consent_ref !== 'string' || !OPAQUE_ID.test(c.consent_ref) ||
        typeof c.eval_annotation !== 'boolean' || typeof c.eval_external_ai !== 'boolean') throw new BenchmarkError('REGISTRY_INVALID_FIELDS');
    const clip = value as unknown as RegistryClip;
    if (ids.has(clip.eval_id)) throw new BenchmarkError('DUPLICATE_EVAL_ID');
    if (hashes.has(clip.sha256)) throw new BenchmarkError('DUPLICATE_SHA256');
    if (groups.has(clip.athlete_group) && groups.get(clip.athlete_group) !== clip.split) throw new BenchmarkError('ATHLETE_GROUP_SPANS_SPLITS');
    ids.add(clip.eval_id); hashes.add(clip.sha256); groups.set(clip.athlete_group, clip.split);
  }
  return (values as RegistryClip[]).sort((a, b) => a.eval_id.localeCompare(b.eval_id));
}
export function registryExclusion(clip: RegistryClip): string | null {
  return clip.status === 'withdrawn' ? 'withdrawn' : !clip.consent.eval_annotation ? 'consent_eval_annotation_missing' : null;
}
