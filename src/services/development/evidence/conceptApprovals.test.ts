import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { CLAIM_REQUIREMENTS, type ClaimRequirement } from './claimRequirements.ts';
import { canonicalRequirement, requirementSha256, validateConceptApproval, missingConceptApprovals, enforcementApprovalGaps } from './conceptApprovals.ts';
import { EVIDENCE_REGISTRY, INITIAL_EVIDENCE_TUPLE, assertEnforceableTuple } from '../evidenceRegistry.ts';
import { renderConceptRequirementsDoc } from '../../../eval/concepts/renderDoc.ts';
import type { Concept } from './types.ts';

const concepts = Object.keys(CLAIM_REQUIREMENTS) as Concept[];
const reference = async () => ({ approvalId: '00000000-0000-4000-a000-000000000016',
  claimsVersion: CLAIM_REQUIREMENTS.contact.version, requirementSha256: await requirementSha256('contact'), decision: 'approved' as const });
test('all 17 requirements remain proposed without fabricated approvals', async () => {
  assert.equal(concepts.length, 17);
  for (const r of Object.values(CLAIM_REQUIREMENTS)) { assert.equal(r.status, 'proposed'); assert.equal(r.reviewApproval, null); }
  assert.deepEqual(await missingConceptApprovals(concepts), concepts.filter(c => !CLAIM_REQUIREMENTS[c].disabledReason));
});
test('canonical hash is deterministic, sorted, includes concept and excludes only reviewApproval', async () => {
  const r = CLAIM_REQUIREMENTS.contact, hash = await requirementSha256('contact');
  assert.equal(await requirementSha256('contact'), hash);
  assert.equal(canonicalRequirement('contact'), canonicalRequirement('contact', Object.fromEntries(Object.entries(r).reverse()) as unknown as ClaimRequirement));
  assert.equal(await requirementSha256('contact', { ...r, reviewApproval: await reference() }), hash);
  const mutations = { version: 'claims-9.0.0', status: 'changed', events: [['finish']], images: 'none',
    minSequenceFrames: 9, visibility: { bat: 0.9 }, disabledReason: 'disabled', cameraProfiles: ['other'] };
  for (const [key, value] of Object.entries(mutations)) assert.notEqual(await requirementSha256('contact', { ...r, [key]: value } as ClaimRequirement), hash, key);
  assert.notEqual(await requirementSha256('extension', r), hash);
});
test('stale, wrong version, rejected and malformed references fail closed', async () => {
  const ref = await reference(); assert.deepEqual(await validateConceptApproval('contact', ref), { valid: true, reason: null });
  for (const [patch, reason] of [
    [{ requirementSha256: 'b'.repeat(64) }, 'requirement_changed'], [{ claimsVersion: 'claims-9.0.0' }, 'claims_version_mismatch'],
    [{ decision: 'rejected' }, 'not_approved'], [{ approvalId: 'reviewer' }, 'invalid_approval_id'],
    [{ requirementSha256: 'Z'.repeat(64) }, 'invalid_requirement_hash'],
  ] as const) assert.deepEqual(await validateConceptApproval('contact', { ...ref, ...patch }), { valid: false, reason });
  assert.equal((await validateConceptApproval('contact', null)).valid, false);
  for (const c of concepts.filter(c => CLAIM_REQUIREMENTS[c].disabledReason)) assert.equal((await validateConceptApproval(c, ref)).reason, 'concept_disabled');
});
test('enforced registry audit is vacuous in production and catches synthetic missing references', async () => {
  assert.deepEqual(await enforcementApprovalGaps(EVIDENCE_REGISTRY, {}), []);
  for (const { status: _, ...tuple } of EVIDENCE_REGISTRY) assert.throws(() => assertEnforceableTuple(tuple, tuple.engineCodeVersion));
  const gaps = await enforcementApprovalGaps([{ ...INITIAL_EVIDENCE_TUPLE, status: 'enforced' }], {});
  assert.equal(gaps.length, concepts.filter(c => !CLAIM_REQUIREMENTS[c].disabledReason).length + 1);
  assert.ok(gaps.some(g => g.reason === 'reliability_profile_missing'));
});
test('generated document rows, hashes and diagrams match the committed document without writing it', async () => {
  assert.equal(await readFile('docs/architecture/CONCEPT_EVIDENCE_REQUIREMENTS.md', 'utf8'), await renderConceptRequirementsDoc());
});
