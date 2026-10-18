import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { assessEnforceability, portableCanonicalJson, portableProfileDigest, ENFORCE_FLAGS, type EnforceabilityInput } from './enforceability.ts';
import { requirementSha256 } from './conceptApprovals.ts';
import { CLAIM_REQUIREMENTS } from './claimRequirements.ts';
import { PRODUCTION_RELIABILITY_CATALOG, lookupReliability, type ReliabilityProfile } from './reliability.ts';
import { EVIDENCE_REGISTRY, INITIAL_EVIDENCE_TUPLE, assertEnforceableTuple } from '../evidenceRegistry.ts';
import { canonicalJson } from '../../../eval/normalize/engineObservations.ts';
import { profileDigest } from '../../../eval/calibrate/reliabilityProfile.ts';

const REVIEWER = '00000000-0000-4000-a000-00000000aa01';
const version = `rel-${INITIAL_EVIDENCE_TUPLE.engineCodeVersion}-${INITIAL_EVIDENCE_TUPLE.gateVersion}-2026-10-18`;
const tuple = { ...INITIAL_EVIDENCE_TUPLE, reliabilityProfileVersion: version };
const hex = (c: string) => c.repeat(64);
// Synthetic, injected-only fixture. Labelled private_consented solely to exercise the contract.
async function profile(mutate: (p: ReliabilityProfile) => void = () => {}): Promise<ReliabilityProfile> {
  const p: ReliabilityProfile = { schema: 'hitterloop.reliability-profile', schema_version: '1.2.0', version, tuple: { ...tuple },
    data_origin: 'private_consented', split: 'validation', decision_status: 'experimental',
    coverage_preregistration: { policy_id: 'synthetic-policy', digest: hex('c'), minimum_measurable_coverage: 0.9, bound_to_runs: true },
    provenance: { sources: [{ run_id_hash: hex('1'), results_digest: hex('2'), metrics_inputs_digest: hex('3'), registry_sha256: hex('4'), annotation_digest: hex('5') }],
      diagnostic_run_hashes: [], tuple: { ...INITIAL_EVIDENCE_TUPLE }, gate_version: tuple.gateVersion, claims_version: tuple.claimsVersion,
      seed: 1, replicates: 2000, scorer_version: 'score-1.0.0', calibrator_version: 'calibrate-1.0.0', exclusions: {},
      engine_confidence_present: 0, unmeasurable_causes: {} },
    entries: [{ concept: 'contact', capture_profile: 'game_backstop', measurable_coverage: 1, coverage_gate: 'meets_preregistered_minimum',
      status: 'within_ceiling', observed_unsafe_rate: 0, ci95: [0, 0], upper_bound_95: 0.04, n_swings: 100, n_athletes: 20, n_unmeasurable: 0, reason: null }],
    profile_digest: '' };
  mutate(p); p.profile_digest = await portableProfileDigest(p); return p;
}
const enforcedEntry = { ...tuple, status: 'enforced' as const, reliabilityReference: 'rel-ref-0001', d7ApprovalReference: 'd7-ref-0001',
  enforcementApprovalReference: 's112-ref-0001', approvedBy: 'owner-0001', approvedAt: '2026-10-18T00:00:00.000Z' };
async function approval(over: Record<string, unknown> = {}) {
  return { id: '00000000-0000-4000-a000-00000000bb01', concept: 'contact', claims_version: CLAIM_REQUIREMENTS.contact.version,
    requirement_sha256: await requirementSha256('contact'), reviewer_id: REVIEWER, decision: 'approved', decided_at: '2026-10-17T00:00:00.000Z', ...over };
}
async function maximal(): Promise<EnforceabilityInput> {
  return { tuple, registry: [...EVIDENCE_REGISTRY, enforcedEntry], profile: await profile(), concepts: ['contact'], captureProfiles: ['game_backstop'],
    approvals: [await approval()], activeConceptReviewers: [REVIEWER],
    ownerFlagApproval: { approvedBy: 'owner-0001', approvedAt: '2026-10-18T00:00:00.000Z', flags: { ...ENFORCE_FLAGS } },
    shadowDiffReviewed: { diffDigest: hex('d'), reviewedBy: 'owner-0001', reviewedAt: '2026-10-18T00:00:00.000Z' } };
}
// With every other precondition evidenced, the only blockers are the proposed claims version (D7 must
// first produce approved claims) and the S1-09 sealed test. Nothing is enforceable today.
const BASELINE_MISSING = ['claims_version_proposed', 'production:profile_not_validated_internal', 'production:sealed_test_missing'];
const diffFrom = async (input: EnforceabilityInput) => (await assessEnforceability(input)).missing.filter(c => !BASELINE_MISSING.includes(c));

test('portable canonicalization and digest are byte-identical to the eval implementation', async () => {
  const p = await profile();
  assert.equal(portableCanonicalJson(p), canonicalJson(p));
  assert.equal(await portableProfileDigest(p), profileDigest(p));
  assert.throws(() => portableCanonicalJson({ a: undefined }), /NON_JSON_VALUE/);
});
test('empty input and production defaults are never enforceable; every code is listed', async () => {
  const empty = await assessEnforceability({});
  assert.equal(empty.enforceable, false); assert.equal(empty.level, 'none');
  for (const code of ['tuple_invalid_or_without_profile_version', 'profile_invalid', 'concepts_invalid_or_missing', 'capture_profiles_invalid_or_missing',
    'approvals_invalid_or_missing', 'active_reviewers_invalid_or_missing', 'owner_flag_approval_missing', 'shadow_diff_not_reviewed',
    'production:sealed_test_missing', 'production:profile_not_validated_internal']) assert.ok(empty.missing.includes(code), code);
  const production = await assessEnforceability({ ...(await maximal()), registry: undefined });
  assert.equal(production.enforceable, false); assert.ok(production.missing.includes('registry_tuple_not_enforced'));
  assert.equal(PRODUCTION_RELIABILITY_CATALOG.length, 0);
  for (const entry of EVIDENCE_REGISTRY) assert.throws(() => assertEnforceableTuple(entry, entry.engineCodeVersion));
});
test('maximally evidenced synthetic input is still blocked only by proposed claims and missing sealed test', async () => {
  const r = await assessEnforceability(await maximal());
  assert.equal(r.enforceable, false); assert.equal(r.level, 'none'); assert.deepEqual(r.missing, BASELINE_MISSING);
});
test('a favourable unsafe-pass rate alone never establishes enforceability', async () => {
  const r = await assessEnforceability({ profile: await profile(), tuple, concepts: ['contact'], captureProfiles: ['game_backstop'] });
  assert.equal(r.enforceable, false);
  for (const code of ['registry_tuple_not_enforced', 'approvals_invalid_or_missing', 'owner_flag_approval_missing', 'shadow_diff_not_reviewed'])
    assert.ok(r.missing.includes(code), code);
});
test('approval negatives: missing, rejected latest, approval then rejection, stale hash, wrong reviewer, malformed', async () => {
  const base = await maximal();
  assert.deepEqual(await diffFrom({ ...base, approvals: [] }), ['approval_missing:contact']);
  assert.deepEqual(await diffFrom({ ...base, approvals: [await approval({ decision: 'rejected' })] }), ['approval_rejected:contact']);
  assert.deepEqual(await diffFrom({ ...base, approvals: [await approval(), await approval({ id: '00000000-0000-4000-a000-00000000bb02',
    decision: 'rejected', decided_at: '2026-10-17T12:00:00.000Z' })] }), ['approval_rejected:contact']);
  assert.deepEqual(await diffFrom({ ...base, approvals: [await approval({ decision: 'rejected', decided_at: '2026-10-16T00:00:00.000Z' }),
    await approval({ id: '00000000-0000-4000-a000-00000000bb02' })] }), []);
  assert.deepEqual(await diffFrom({ ...base, approvals: [await approval({ requirement_sha256: hex('e') })] }), ['approval_stale:contact']);
  assert.deepEqual(await diffFrom({ ...base, activeConceptReviewers: ['00000000-0000-4000-a000-00000000aa99'] }), ['approval_reviewer_unauthorized:contact']);
  assert.deepEqual(await diffFrom({ ...base, approvals: [await approval({ claims_version: 'claims-9.9.9' })] }), ['approval_missing:contact']);
  assert.deepEqual(await diffFrom({ ...base, approvals: [await approval({ decided_at: 'yesterday' })] }), ['approvals_invalid_or_missing']);
  assert.deepEqual(await diffFrom({ ...base, approvals: [await approval({ reviewer_id: 'not-a-uuid' })] }), ['approvals_invalid_or_missing']);
});
test('tuple, registry and profile negatives', async () => {
  const base = await maximal();
  for (const key of ['engineCodeVersion', 'instrumentationVersion', 'environmentVersion', 'gateVersion'] as const) {
    const t = { ...tuple, [key]: 'changed-0001' };
    const codes = await diffFrom({ ...base, tuple: t });
    assert.ok(codes.includes('profile_tuple_mismatch') && codes.includes('registry_tuple_not_enforced'), key);
  }
  assert.ok((await diffFrom({ ...base, tuple: INITIAL_EVIDENCE_TUPLE })).includes('tuple_invalid_or_without_profile_version'));
  assert.ok((await diffFrom({ ...base, registry: [...EVIDENCE_REGISTRY, { ...enforcedEntry, status: 'shadow' }] })).includes('registry_tuple_not_enforced'));
  const { approvedBy: _, ...noReviewer } = enforcedEntry;
  assert.ok((await diffFrom({ ...base, registry: [...EVIDENCE_REGISTRY, noReviewer] })).includes('registry_reviewer_records_missing'));
  assert.deepEqual(await diffFrom({ ...base, profile: { ...(await profile()), split: 'dev' } }), ['profile_invalid', 'unknown_reliability:contact:game_backstop']);
  const tampered = await profile(); tampered.entries[0]!.n_swings = 99;
  assert.ok((await diffFrom({ ...base, profile: tampered })).includes('profile_integrity_failed'));
  assert.deepEqual(await diffFrom({ ...base, profile: await profile(p => { p.data_origin = 'synthetic'; }) }), ['profile_synthetic_or_unconsented']);
  assert.ok((await diffFrom({ ...base, profile: await profile(p => { p.provenance.sources = []; }) })).includes('dataset_provenance_missing'));
});
test('coverage, unknown reliability and capture-profile negatives', async () => {
  const base = await maximal();
  const unbound = await profile(p => { p.coverage_preregistration!.bound_to_runs = false;
    Object.assign(p.entries[0]!, { coverage_gate: 'not_bound_to_runs', status: 'inconclusive', reason: 'coverage_not_bound_to_runs' }); });
  assert.deepEqual(await diffFrom({ ...base, profile: unbound }), ['coverage_not_met:contact:game_backstop', 'coverage_not_preregistered_and_bound',
    'unknown_reliability:contact:game_backstop']);
  const unmeasured = await profile(p => { Object.assign(p.entries[0]!, { status: 'unmeasured', coverage_gate: 'not_applicable', measurable_coverage: null,
    observed_unsafe_rate: null, ci95: [null, null], upper_bound_95: null, n_swings: 0, n_athletes: 0, n_unmeasurable: 0, reason: 'no_measurable_claim_passes' }); });
  assert.deepEqual(await diffFrom({ ...base, profile: unmeasured }), ['coverage_not_met:contact:game_backstop', 'unknown_reliability:contact:game_backstop']);
  assert.deepEqual(await diffFrom({ ...base, captureProfiles: ['open_side_practice'] }), ['unknown_reliability:open_side_practice'.replace('unknown_reliability:', 'unknown_reliability:contact:')]);
  assert.deepEqual(await diffFrom({ ...base, concepts: ['timing'] }), ['concept_disabled:timing']);
  assert.ok((await diffFrom({ ...base, concepts: [] })).includes('concepts_invalid_or_missing'));
  assert.ok((await diffFrom({ ...base, concepts: ['contact', 'contact'] })).includes('concepts_invalid_or_missing'));
});
test('owner flag approval, diff review and sealed-test evidence are required, never assumed', async () => {
  const base = await maximal();
  assert.deepEqual(await diffFrom({ ...base, ownerFlagApproval: undefined }), ['owner_flag_approval_missing']);
  assert.deepEqual(await diffFrom({ ...base, ownerFlagApproval: { ...base.ownerFlagApproval as object, flags: { ...ENFORCE_FLAGS, REPORT_LEGACY_RUN_POLICY: 'show_as_before' } } }), ['owner_flag_approval_missing']);
  assert.deepEqual(await diffFrom({ ...base, shadowDiffReviewed: { diffDigest: 'short', reviewedBy: 'owner-0001', reviewedAt: '2026-10-18T00:00:00.000Z' } }), ['shadow_diff_not_reviewed']);
  const sealed = await assessEnforceability({ ...base, sealedTest: { passed: true, accessLogSha256: hex('f'), profileVersion: version } });
  assert.ok(!sealed.missing.includes('production:sealed_test_missing'));
  const failed = await assessEnforceability({ ...base, sealedTest: { passed: false, accessLogSha256: hex('f'), profileVersion: version } });
  assert.ok(failed.missing.includes('production:sealed_test_missing'));
});
test('unknown V4 stays unmeasured and the contract is not wired into production', async () => {
  for (const concept of Object.keys(CLAIM_REQUIREMENTS) as (keyof typeof CLAIM_REQUIREMENTS)[])
    assert.equal(lookupReliability(concept, tuple, 'game_backstop').status, 'unmeasured');
  for (const file of ['src/services/development/evidence/decideClaim.ts', 'src/services/development/focus.ts', 'src/cli/evidenceShadow.ts',
    'supabase/functions/get-simplified-report/index.ts', 'src/services/config/analysisFlags.ts'])
    assert.doesNotMatch(await readFile(file, 'utf8'), /enforceability/, file);
});
test('decisions sharing the latest instant are conflicting, never resolved by id order', async () => {
  const base = await maximal();
  const tied = [await approval(), await approval({ id: '00000000-0000-4000-a000-00000000bb02', decision: 'rejected' })];
  assert.deepEqual(await diffFrom({ ...base, approvals: tied }), ['approval_conflicting:contact', 'approval_rejected:contact']);
  const bothApproved = [await approval(), await approval({ id: '00000000-0000-4000-a000-00000000bb02' })];
  assert.deepEqual(await diffFrom({ ...base, approvals: bothApproved }), ['approval_conflicting:contact']);
});
test('tied latest decisions are judged order-independently; production acceptance is a separate flag', async () => {
  const base = await maximal();
  for (const ids of [['00000000-0000-4000-a000-00000000bb01', '00000000-0000-4000-a000-00000000bb02'], ['00000000-0000-4000-a000-00000000bb02', '00000000-0000-4000-a000-00000000bb01']]) {
    const tied = [await approval({ id: ids[0] }), await approval({ id: ids[1], decision: 'rejected', requirement_sha256: hex('e') })];
    assert.deepEqual(await diffFrom({ ...base, approvals: tied }), ['approval_conflicting:contact', 'approval_rejected:contact', 'approval_stale:contact']);
  }
  const r = await assessEnforceability(base);
  assert.equal(r.productionAccepted, false); assert.equal(r.enforceable, false);
  // An injected enforced entry for an engine other than the active baseline fails the backstop.
  const otherEngine = { ...tuple, engineCodeVersion: 'engine-other-9.9.9' };
  const codes = (await assessEnforceability({ ...base, tuple: otherEngine, registry: [...EVIDENCE_REGISTRY, { ...enforcedEntry, engineCodeVersion: 'engine-other-9.9.9' }] })).missing;
  assert.ok(codes.includes('engine_not_active'), 'engine mismatch is reported on its own, not masked by proposed claims');
});
