import { CLAIM_REQUIREMENTS, type ClaimRequirement } from './claimRequirements.ts';
import type { Concept } from './types.ts';
import type { ActiveTuple } from '../evidenceRegistry.ts';

import type { ConceptApprovalReference } from './conceptApprovalTypes.ts';
export type { ConceptApprovalReference } from './conceptApprovalTypes.ts';
function canonical(value: unknown): string {
  if (Array.isArray(value)) return '[' + value.map(canonical).join(',') + ']';
  if (value && typeof value === 'object') return '{' + Object.entries(value).sort(([a], [b]) => a < b ? -1 : a > b ? 1 : 0)
    .map(([k, v]) => JSON.stringify(k) + ':' + canonical(v)).join(',') + '}';
  return JSON.stringify(value);
}
/** Optional requirement is for offline drift tests; production uses the current entry. */
export function canonicalRequirement(concept: Concept, requirement: ClaimRequirement = CLAIM_REQUIREMENTS[concept]): string {
  const { reviewApproval: _, ...fields } = requirement;
  return canonical({ ...fields, concept });
}
export async function requirementSha256(concept: Concept, requirement: ClaimRequirement = CLAIM_REQUIREMENTS[concept]): Promise<string> {
  const bytes = await globalThis.crypto.subtle.digest('SHA-256', new TextEncoder().encode(canonicalRequirement(concept, requirement)));
  return Array.from(new Uint8Array(bytes), b => b.toString(16).padStart(2, '0')).join('');
}
/** Structural reference check only. The unseen database row is authoritative;
 * a valid reference does not assert that a row exists or authorize enforcement. */
export async function validateConceptApproval(concept: Concept, ref: unknown): Promise<{ valid: boolean; reason: string | null }> {
  const invalid = (reason: string) => ({ valid: false, reason });
  const requirement = CLAIM_REQUIREMENTS[concept];
  if (requirement.disabledReason !== null) return invalid('concept_disabled');
  if (!ref || typeof ref !== 'object') return invalid('approval_missing');
  const r = ref as ConceptApprovalReference;
  if (r.decision !== 'approved') return invalid('not_approved');
  if (typeof r.approvalId !== 'string' || !/^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/i.test(r.approvalId)) return invalid('invalid_approval_id');
  if (r.claimsVersion !== requirement.version) return invalid('claims_version_mismatch');
  if (typeof r.requirementSha256 !== 'string' || !/^[a-f0-9]{64}$/.test(r.requirementSha256)) return invalid('invalid_requirement_hash');
  if (r.requirementSha256 !== await requirementSha256(concept)) return invalid('requirement_changed');
  return { valid: true, reason: null };
}
export async function missingConceptApprovals(concepts: readonly Concept[]): Promise<string[]> {
  const missing: string[] = [];
  for (const c of concepts) if (!CLAIM_REQUIREMENTS[c].disabledReason
    && !(await validateConceptApproval(c, CLAIM_REQUIREMENTS[c].reviewApproval)).valid) missing.push(c);
  return missing;
}
/** References are keyed by claims version then concept; each enforced tuple is
 * checked separately. This audit does not alter assertEnforceableTuple. */
export async function enforcementApprovalGaps(registry: readonly ActiveTuple[],
  references: Readonly<Record<string, Partial<Record<Concept, ConceptApprovalReference>>>>) {
  const gaps: { registryIndex: number; reason: string; concept?: Concept }[] = [];
  for (const [registryIndex, entry] of registry.entries()) {
    if (entry.status !== 'enforced') continue;
    if (entry.reliabilityProfileVersion === null) gaps.push({ registryIndex, reason: 'reliability_profile_missing' });
    for (const concept of Object.keys(CLAIM_REQUIREMENTS) as Concept[]) {
      if (CLAIM_REQUIREMENTS[concept].disabledReason) continue;
      const ref = references[entry.claimsVersion]?.[concept];
      const result = await validateConceptApproval(concept, ref);
      if (!result.valid || ref?.claimsVersion !== entry.claimsVersion) gaps.push({ registryIndex, concept,
        reason: result.reason ?? 'claims_version_mismatch' });
    }
  }
  return gaps;
}
