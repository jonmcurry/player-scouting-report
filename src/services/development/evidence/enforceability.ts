/**
 * PR17 (Revision 2 S1-12) enforceability contract. Pure and Deno-portable.
 *
 * NOT imported by any production caller: it decides nothing at runtime and cannot
 * activate enforcement. It answers one question for a future governed cut-over:
 * "is every S1-12 precondition evidenced?" Every failing requirement is listed
 * (no short-circuit) and no field is ever defaulted, so an empty input, a favourable
 * unsafe-pass rate alone, a synthetic profile or an assumed approval can never
 * establish enforceability.
 */
import { CLAIM_REQUIREMENTS } from './claimRequirements.ts';
import { requirementSha256 } from './conceptApprovals.ts';
import { validProfileStructure, sameTuple, type ReliabilityProfile } from './reliability.ts';
import { BASELINE_ENGINE, EVIDENCE_REGISTRY, assertEnforceableTuple, isEvidenceTuple, resolveTuple, type EvidenceTuple } from '../evidenceRegistry.ts';
import type { Concept } from './types.ts';

/** A row exactly as stored in public.concept_requirement_approvals (00066). */
export interface ConceptApprovalRecord {
  id: string; concept: string; claims_version: string; requirement_sha256: string;
  reviewer_id: string; decision: 'approved' | 'rejected'; decided_at: string;
}
export interface EnforceabilityInput {
  tuple?: unknown; registry?: readonly unknown[]; profile?: unknown;
  concepts?: readonly unknown[]; captureProfiles?: readonly unknown[];
  approvals?: readonly unknown[]; activeConceptReviewers?: readonly unknown[];
  ownerFlagApproval?: unknown; shadowDiffReviewed?: unknown; sealedTest?: unknown;
}
/** `enforceable` means S1-12 PROVISIONAL enforcement only. Production acceptance (S1-09) is the
 * separate `productionAccepted` flag; a production gate must check that, never `enforceable`. */
export interface EnforceabilityResult { enforceable: boolean; productionAccepted: boolean; level: 'none' | 'provisional' | 'production_accepted'; missing: string[] }

export const ENFORCE_FLAGS = Object.freeze({ EVIDENCE_GATE_MODE: 'enforce', REPORT_EVIDENCE_GATE_MODE: 'enforce',
  REPORT_LEGACY_RUN_POLICY: 'legacy_safe_only' });
const HEX64 = /^[a-f0-9]{64}$/;
const UUID = /^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/;
const OPAQUE = /^[a-zA-Z0-9][a-zA-Z0-9._-]{0,127}$/;
const plain = (v: unknown): v is Record<string, unknown> => !!v && typeof v === 'object' && !Array.isArray(v);
const instant = (v: unknown): v is string => typeof v === 'string'
  && /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,6})?(?:Z|[+-]\d{2}:\d{2})$/.test(v) && Number.isFinite(Date.parse(v));

/** Byte-identical to src/eval/normalize canonicalJson (tested), so digests agree. */
export function portableCanonicalJson(value: unknown): string {
  if (value === null || typeof value === 'string' || typeof value === 'boolean'
    || (typeof value === 'number' && Number.isFinite(value))) return JSON.stringify(value);
  if (Array.isArray(value)) return '[' + Array.from(value, portableCanonicalJson).join(',') + ']';
  if (plain(value)) return '{' + Object.keys(value).sort().map(k => JSON.stringify(k) + ':' + portableCanonicalJson(value[k])).join(',') + '}';
  throw new TypeError('NON_JSON_VALUE');
}
export async function portableSha256(text: string): Promise<string> {
  const bytes = await globalThis.crypto.subtle.digest('SHA-256', new TextEncoder().encode(text));
  return Array.from(new Uint8Array(bytes), b => b.toString(16).padStart(2, '0')).join('');
}
export async function portableProfileDigest(profile: ReliabilityProfile): Promise<string> {
  const { profile_digest: _, ...rest } = profile;
  return portableSha256(portableCanonicalJson(rest));
}

async function profileRequirements(input: EnforceabilityInput, tuple: EvidenceTuple | null, missing: Set<string>) {
  const p = input.profile;
  if (!validProfileStructure(p)) { missing.add('profile_invalid'); return null; }
  let digest: string | null = null;
  try { digest = await portableProfileDigest(p); } catch { digest = null; }
  if (digest !== p.profile_digest) missing.add('profile_integrity_failed');
  if (!tuple || !sameTuple(p.tuple, tuple)) missing.add('profile_tuple_mismatch');
  if (p.data_origin !== 'private_consented') missing.add('profile_synthetic_or_unconsented');
  if (p.split !== 'validation') missing.add('profile_split_invalid');
  const sources = (p.provenance as { sources?: unknown } | undefined)?.sources;
  if (!Array.isArray(sources) || !sources.length || !sources.every(s => plain(s)
    && ['run_id_hash', 'results_digest', 'metrics_inputs_digest', 'registry_sha256', 'annotation_digest']
      .every(k => typeof s[k] === 'string' && HEX64.test(s[k] as string)))) missing.add('dataset_provenance_missing');
  if (!p.coverage_preregistration || p.coverage_preregistration.bound_to_runs !== true) missing.add('coverage_not_preregistered_and_bound');
  return p;
}

function latestApproval(rows: ConceptApprovalRecord[]): ConceptApprovalRecord | null {
  return [...rows].sort((a, b) => Date.parse(b.decided_at) - Date.parse(a.decided_at) || (a.id < b.id ? 1 : a.id > b.id ? -1 : 0))[0] ?? null;
}
function approvalRows(value: readonly unknown[] | undefined): ConceptApprovalRecord[] | null {
  if (!Array.isArray(value)) return null;
  return value.every(r => plain(r) && typeof r.id === 'string' && UUID.test(r.id) && typeof r.concept === 'string'
    && typeof r.claims_version === 'string' && typeof r.requirement_sha256 === 'string' && HEX64.test(r.requirement_sha256)
    && typeof r.reviewer_id === 'string' && UUID.test(r.reviewer_id) && (r.decision === 'approved' || r.decision === 'rejected')
    && instant(r.decided_at)) ? value as ConceptApprovalRecord[] : null;
}

export async function assessEnforceability(input: EnforceabilityInput = {}): Promise<EnforceabilityResult> {
  const missing = new Set<string>();
  // 1. Exact registered tuple, enforced, with reviewer records (existing S0-06 rule, unchanged).
  const tuple = isEvidenceTuple(input.tuple) && input.tuple.reliabilityProfileVersion ? input.tuple : null;
  if (!tuple) missing.add('tuple_invalid_or_without_profile_version');
  const registry = Array.isArray(input.registry) ? input.registry : input.registry === undefined ? EVIDENCE_REGISTRY : null;
  if (!registry) missing.add('registry_invalid');
  if (tuple?.claimsVersion.endsWith('-proposed')) missing.add('claims_version_proposed');
  if (tuple && tuple.engineCodeVersion !== BASELINE_ENGINE) missing.add('engine_not_active');
  if (tuple && registry) {
    const entry = resolveTuple(tuple, registry);
    if (!entry || entry.status !== 'enforced') missing.add('registry_tuple_not_enforced');
    else {
      if (!entry.reliabilityReference || !entry.d7ApprovalReference || !entry.enforcementApprovalReference
        || !entry.approvedBy || !entry.approvedAt) missing.add('registry_reviewer_records_missing');
      // The existing S0-06 rule stays the backstop; any refusal it adds is reported, never overridden.
      // The active engine constant, not the tuple's own field, so an injected unapproved engine cannot pass.
      try { assertEnforceableTuple(tuple, BASELINE_ENGINE, registry); }
      catch { if (!missing.has('claims_version_proposed') && !missing.has('registry_reviewer_records_missing')) missing.add('registry_enforcement_check_failed'); }
    }
    if (!resolveTuple({ ...tuple, reliabilityProfileVersion: null }, registry)) missing.add('base_tuple_not_registered');
  }
  // 2. Validated, integrity-bound, consented, pre-registered reliability profile.
  const profile = await profileRequirements(input, tuple, missing);
  // 3. Enforced concepts and capture profiles: within ceiling with met, bound coverage.
  const concepts = Array.isArray(input.concepts) && input.concepts.length
    && new Set(input.concepts).size === input.concepts.length
    && input.concepts.every(c => typeof c === 'string' && Object.hasOwn(CLAIM_REQUIREMENTS, c)) ? input.concepts as Concept[] : null;
  if (!concepts) missing.add('concepts_invalid_or_missing');
  const profiles = Array.isArray(input.captureProfiles) && input.captureProfiles.length
    && new Set(input.captureProfiles).size === input.captureProfiles.length
    && input.captureProfiles.every(p => typeof p === 'string' && p.trim()) ? input.captureProfiles as string[] : null;
  if (!profiles) missing.add('capture_profiles_invalid_or_missing');
  const rows = approvalRows(input.approvals);
  if (!rows) missing.add('approvals_invalid_or_missing');
  const reviewers = Array.isArray(input.activeConceptReviewers)
    && input.activeConceptReviewers.every(r => typeof r === 'string' && UUID.test(r)) ? new Set(input.activeConceptReviewers as string[]) : null;
  if (!reviewers) missing.add('active_reviewers_invalid_or_missing');
  for (const concept of concepts ?? []) {
    const requirement = CLAIM_REQUIREMENTS[concept];
    if (requirement.disabledReason) { missing.add(`concept_disabled:${concept}`); continue; }
    for (const capture of profiles ?? []) {
      const e = profile?.entries.find(x => x.concept === concept && x.capture_profile === capture);
      if (!e || e.status === 'unmeasured' || e.status === 'not_applicable' || e.status === 'inconclusive') missing.add(`unknown_reliability:${concept}:${capture}`);
      else if (e.status !== 'within_ceiling') missing.add(`reliability_not_within_ceiling:${concept}:${capture}`);
      if (e && e.coverage_gate !== 'meets_preregistered_minimum') missing.add(`coverage_not_met:${concept}:${capture}`);
    }
    // 4. Current D7 approval: the latest decision for this concept and claims version decides.
    if (!rows || !reviewers) continue;
    const current = await requirementSha256(concept);
    const relevant = rows.filter(r => r.concept === concept && r.claims_version === requirement.version);
    const latest = latestApproval(relevant);
    if (!latest) { missing.add(`approval_missing:${concept}`); continue; }
    // decided_at is transaction_timestamp(): decisions sharing the latest instant have no defined order.
    const tied = relevant.filter(r => Date.parse(r.decided_at) === Date.parse(latest.decided_at));
    if (tied.length > 1) missing.add(`approval_conflicting:${concept}`);
    // Judge every row at the latest instant, so codes never depend on id order.
    if (tied.some(r => r.decision !== 'approved')) missing.add(`approval_rejected:${concept}`);
    if (tied.some(r => r.requirement_sha256 !== current)) missing.add(`approval_stale:${concept}`);
    if (tied.some(r => !reviewers.has(r.reviewer_id))) missing.add(`approval_reviewer_unauthorized:${concept}`);
  }
  // Approvals are for the requirement version in code; the enforced tuple must name that same claims version.
  for (const concept of concepts ?? []) if (tuple && tuple.claimsVersion !== CLAIM_REQUIREMENTS[concept].version)
    missing.add(`claims_version_mismatch:${concept}`);
  // 5. Owner decisions recorded outside this function, never assumed.
  const owner = input.ownerFlagApproval;
  if (!plain(owner) || typeof owner.approvedBy !== 'string' || !OPAQUE.test(owner.approvedBy) || !instant(owner.approvedAt)
    || !plain(owner.flags) || portableCanonicalJson(owner.flags) !== portableCanonicalJson(ENFORCE_FLAGS)) missing.add('owner_flag_approval_missing');
  const diff = input.shadowDiffReviewed;
  if (!plain(diff) || typeof diff.diffDigest !== 'string' || !HEX64.test(diff.diffDigest)
    || typeof diff.reviewedBy !== 'string' || !OPAQUE.test(diff.reviewedBy) || !instant(diff.reviewedAt)) missing.add('shadow_diff_not_reviewed');
  // 6. Production acceptance additionally needs S1-09 sealed-test evidence.
  const production = new Set<string>();
  const sealed = input.sealedTest;
  if (!plain(sealed) || sealed.passed !== true || typeof sealed.accessLogSha256 !== 'string' || !HEX64.test(sealed.accessLogSha256)
    || !tuple || sealed.profileVersion !== tuple.reliabilityProfileVersion) production.add('production:sealed_test_missing');
  if (!profile || profile.decision_status !== 'validated_internal') production.add('production:profile_not_validated_internal');
  const provisional = missing.size === 0;
  const level = provisional ? (production.size === 0 ? 'production_accepted' : 'provisional') : 'none';
  return { enforceable: provisional, productionAccepted: level === 'production_accepted', level, missing: [...missing, ...production].sort() };
}
