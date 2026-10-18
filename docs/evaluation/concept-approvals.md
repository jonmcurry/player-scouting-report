# D7 concept requirement review

Migration 00066 adds an append-only concept_requirement_approvals audit and approve_concept_requirement RPC. Existing migrations are unchanged. No reviewers or approvals are seeded; all 17 CLAIM_REQUIREMENTS entries remain proposed with reviewApproval null.

A provisioned, active concept_reviewer signs the exact canonical requirement they reviewed. Authentication and reviewer membership are checked in the security-definer RPC, with a shared row lock to serialize revocation. A drill_curator cannot approve concepts. reviewer_id always comes from auth.uid(), never a caller parameter. Only authenticated callers can execute the RPC. Only service_role can read the audit table; no client read RPC or parent/family/coach visibility is added. Updates, deletes and truncation are blocked.

Canonical JSON includes the concept and every requirement field except reviewApproval, with recursively sorted object keys and preserved array order. SHA-256 uses portable Web Crypto. The server cannot recompute the requirement hash. Consumers must compare the recorded hash with the current requirement; edits invalidate stale references. validateConceptApproval checks only reference structure, decision, version, current hash and disabled status. It does not prove that an unseen database row exists: the database row remains authoritative, and future consumers must verify it through an authorized service. No production caller uses these helpers yet.

The generated docs/architecture/CONCEPT_EVIDENCE_REQUIREMENTS.md contains all requirements, hashes and synthetic text diagrams. A read-only drift test regenerates the full content for comparison. Rationale comes only from plan section 3.2; absent rationale is explicitly pending D7.

The enforcementApprovalGaps audit takes a registry and references keyed by claims version then concept. Each enforced entry requires structurally valid references for all enabled concepts and a non-null reliabilityProfileVersion. Production has no enforced entries, so that audit currently passes vacuously; synthetic tests prove missing references are reported. This audit is diagnostic only and does not modify assertEnforceableTuple or authenticate reviewer records.

Unsafe-pass rate alone never authorizes enforcement. S1-09 sealed testing, D7 approvals for every enforced concept, a registered enforced tuple with reviewer records, and explicit owner flag approval (S1-12/PR17) are still required. No enforcement, profile registration or activation is performed.

The approvals table is an append-only audit trail and has no uniqueness constraint: a reviewer may record several decisions for the same concept, claims version and requirement hash. Consumers resolving an approval must take the latest decision deterministically (`decided_at desc, id desc`) and must re-check the requirement hash against the current requirement.
