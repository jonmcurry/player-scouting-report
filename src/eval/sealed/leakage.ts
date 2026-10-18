import { BenchmarkError, canonicalJson, type RegistryClip } from '../benchmark/registry.ts';
import { buildMembership, validateMembership, saltedHash, type Membership, type TestClip } from './membership.ts';
export function checkLeakage(clips: RegistryClip[], value: Membership) {
  const m = validateMembership(value);
  for (const c of clips) {
    if (m.eval_id_hashes.includes(saltedHash(m.salt, 'eval_id', c.eval_id))) throw new BenchmarkError('TEST_EVAL_ID_IN_CLEAR_REGISTRY');
    if (m.source_sha256_hashes.includes(saltedHash(m.salt, 'source_sha256', c.sha256))) throw new BenchmarkError('TEST_SOURCE_IN_CLEAR_REGISTRY');
    if (m.athlete_group_hashes.includes(saltedHash(m.salt, 'athlete_group', c.athlete_group))) throw new BenchmarkError('TEST_ATHLETE_GROUP_IN_CLEAR_REGISTRY');
  }
}
export function checkTestRegistryMatchesMembership(clips: TestClip[], value: Membership) {
  const m = validateMembership(value);
  if (canonicalJson(buildMembership(clips, m.salt)) !== canonicalJson(m)) throw new BenchmarkError('TEST_MEMBERSHIP_MISMATCH');
}
