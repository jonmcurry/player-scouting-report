import { BenchmarkError, canonicalJson, sha256, HASH, parseRegistry, type RegistryClip } from '../benchmark/registry.ts';
export type TestClip = Omit<RegistryClip, 'split'> & { split: 'test' };
export type HashKind = 'eval_id' | 'source_sha256' | 'athlete_group';
export interface Membership {
  schema: 'hitterloop.test-membership'; schema_version: '1.0.0'; salt: string; count: number;
  eval_id_hashes: string[]; source_sha256_hashes: string[]; athlete_group_hashes: string[]; digest: string;
}
export const saltedHash = (salt: string, kind: HashKind, value: string) => sha256(salt + ':' + kind + ':' + value);
export function parseTestRegistry(text: string): TestClip[] {
  let values: unknown[];
  try { values = text.replace(/\r\n/g, '\n').replace(/\n$/, '').split('\n').map(line => JSON.parse(line)); }
  catch { throw new BenchmarkError('REGISTRY_INVALID_JSON'); }
  // Delegate every PR13 field/header/duplicate rule after checking the actual split.
  const converted = values.map((v, i) => {
    if (!i) return v;
    if (!v || typeof v !== 'object' || Array.isArray(v)) throw new BenchmarkError('REGISTRY_INVALID_FIELDS');
    if ((v as { split?: unknown }).split !== 'test') throw new BenchmarkError('TEST_REGISTRY_SPLIT_REQUIRED');
    return { ...v, split: 'dev' };
  });
  return parseRegistry(converted.map(canonicalJson).join('\n')).map(c => ({ ...c, split: 'test' }));
}
export function buildMembership(clips: TestClip[], salt: string): Membership {
  if (!HASH.test(salt)) throw new BenchmarkError('MEMBERSHIP_INVALID_SALT');
  const validated = parseTestRegistry([{ registry_version: 1 }, ...clips].map(canonicalJson).join('\n'));
  const hashes = (kind: HashKind, key: 'eval_id' | 'sha256' | 'athlete_group') =>
    [...new Set(validated.map(c => saltedHash(salt, kind, c[key])))].sort();
  const body = { schema: 'hitterloop.test-membership' as const, schema_version: '1.0.0' as const, salt, count: validated.length,
    eval_id_hashes: hashes('eval_id', 'eval_id'), source_sha256_hashes: hashes('source_sha256', 'sha256'), athlete_group_hashes: hashes('athlete_group', 'athlete_group') };
  return { ...body, digest: sha256(canonicalJson(body)) };
}
export function validateMembership(value: unknown): Membership {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new BenchmarkError('MEMBERSHIP_INVALID_SCHEMA');
  const m = value as Membership;
  if (m.schema !== 'hitterloop.test-membership' || m.schema_version !== '1.0.0' ||
    Object.keys(m).sort().join(',') !== 'athlete_group_hashes,count,digest,eval_id_hashes,salt,schema,schema_version,source_sha256_hashes') throw new BenchmarkError('MEMBERSHIP_INVALID_SCHEMA');
  if (typeof m.salt !== 'string' || !HASH.test(m.salt)) throw new BenchmarkError('MEMBERSHIP_INVALID_SALT');
  if (!Number.isSafeInteger(m.count) || m.count < 0) throw new BenchmarkError('MEMBERSHIP_INVALID_COUNT');
  for (const a of [m.eval_id_hashes, m.source_sha256_hashes, m.athlete_group_hashes]) {
    if (!Array.isArray(a) || a.some((h, i) => typeof h !== 'string' || !HASH.test(h) || (i > 0 && a[i - 1]! >= h))) throw new BenchmarkError('MEMBERSHIP_INVALID_HASHES');
  }
  if (m.eval_id_hashes.length !== m.count || m.source_sha256_hashes.length !== m.count || m.athlete_group_hashes.length > m.count || (m.count > 0 && !m.athlete_group_hashes.length)) throw new BenchmarkError('MEMBERSHIP_INVALID_COUNT');
  const { digest, ...body } = m;
  if (typeof digest !== 'string' || !HASH.test(digest) || sha256(canonicalJson(body)) !== digest) throw new BenchmarkError('MEMBERSHIP_DIGEST_MISMATCH');
  return m;
}
