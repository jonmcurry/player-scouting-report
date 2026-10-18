# PR17 enforcement safeguards (Revision 2 S1-12)

Status: **infrastructure only. Nothing is enforceable today, and nothing here activates
enforcement, registers a profile, grants a reviewer role or changes a report.**

PR17 implements the fail-closed checks a future, owner-authorized S1-12 cut-over must
pass (plan lines 864-884, D2, D7, line 499, §7.4). None of the new modules is imported by a
production caller. `decideClaim`, `lookupReliability` (production V4 stays `unmeasured`),
`assertEnforceableTuple`, `focus.ts`, the report and the Edge functions are unchanged.

## Enforceability contract

`assessEnforceability` in `src/services/development/evidence/enforceability.ts` is pure and
Deno-portable. It lists **every** failing requirement as a sorted fixed code; it never
short-circuits and never defaults a field. An empty input, a favourable unsafe-pass rate
alone, a synthetic profile or an assumed approval cannot establish enforceability.

| Requirement | Codes when unmet |
| --- | --- |
| Exact tuple with a reliability profile version, for the active baseline engine | `tuple_invalid_or_without_profile_version`, `engine_not_active` |
| Claims are no longer proposed (D7 produced approved claims) | `claims_version_proposed` |
| Registry entry exactly matches and is `enforced` | `registry_tuple_not_enforced`, `registry_invalid` |
| Reviewer records on that entry (reliability, D7, S1-12, approver, time) | `registry_reviewer_records_missing`, `registry_enforcement_check_failed` (existing S0-06 backstop) |
| Base tuple (no profile version) registered | `base_tuple_not_registered` |
| Profile structurally valid, digest re-verified, tuple matches | `profile_invalid`, `profile_integrity_failed`, `profile_tuple_mismatch` |
| Consented validation data with dataset provenance | `profile_synthetic_or_unconsented`, `profile_split_invalid`, `dataset_provenance_missing` |
| Coverage pre-registered **and bound to every source run** | `coverage_not_preregistered_and_bound` |
| Every enforced concept x capture profile within the D8 ceiling with met coverage | `unknown_reliability:<c>:<p>`, `reliability_not_within_ceiling:<c>:<p>`, `coverage_not_met:<c>:<p>`, `concept_disabled:<c>` |
| Current D7 approval per enforced concept | `approval_missing`, `approval_rejected`, `approval_stale`, `approval_conflicting`, `approval_reviewer_unauthorized` (each `:<c>`), `claims_version_mismatch:<c>` |
| Explicit owner approval of the exact enforce flags | `owner_flag_approval_missing` |
| Product-owner review of the dry-run diff, bound to its digest | `shadow_diff_not_reviewed` |
| Production acceptance only: S1-09 sealed test and `validated_internal` | `production:sealed_test_missing`, `production:profile_not_validated_internal` |

Levels: `provisional` (S1-12) needs every non-`production:` requirement and sets `enforceable`; `production_accepted`
additionally needs the sealed-test evidence and sets `productionAccepted`. A production gate must check `productionAccepted`, never `enforceable`. With the production registry nothing resolves
to `enforced`. Even a fully evidenced synthetic input stays blocked by
`claims_version_proposed` (every requirement is `claims-0.1.0-proposed` until D7) and by the
missing sealed test.

### Approval rules

Approvals are rows exactly as stored in 00066, read with service-role privileges, plus the
set of active `concept_reviewer` ids. For each concept, only rows for the current claims
version count, and the decision with the **latest** `decided_at` decides. It must be
`approved`, carry the current requirement hash and come from an active concept reviewer. The
RPC stamps `transaction_timestamp()`, so decisions sharing the latest instant have no defined
order and fail closed as `approval_conflicting`. A row the caller cannot see is never assumed.

### Provenance rules

The profile digest is recomputed with `portableCanonicalJson`, which is byte-identical to
the eval canonicalization (tested). Provenance must list hashed source runs with result,
metrics-input, registry and annotation digests. `data_origin` must be `private_consented`
and the split `validation`. Environment identity is compatibility, not accuracy.

## Read model and dry-run diff

`enforcementReadModel.ts` holds read-only SQL and mappers: approvals, active concept
reviewers, and aggregate diff inputs that return no clip, player, run or issue identifiers.
It was tested only on the disposable `pr17_disposable_test` database. 00064's
`reviewer_self_read` policy lets an authenticated reviewer see only their own row, and a
client cannot read approvals.

`enforcementDiff.ts` computes the aggregate effect of a hypothetical cut-over:
- runs assessed vs legacy;
- withheld clips by family reason;
- per concept, issues that would display vs disappear (display needs an assessed, eligible
  clip, an enforced concept and the shadow `hypothetical.wouldDisplay`);
- open focus records kept but re-checking;
- legacy runs that `legacy_safe_only` would show without an AI summary or fix.

Cells under five are suppressed, and the digest is what the owner records after review.
`npm run enforcement:diff` is dry-run only. It needs `--confirm-dry-run`, writes only outside
the repository, never overwrites, and its built-in reader accepts only a database named
`*_disposable_test`. Reading a hosted project needs a separately authorized reader.

## Cut-over rules (unwired)

`src/services/development/enforcementCutover.ts` implements the S1-12 focus rules as a pure
module. It is not imported by `focus.ts`, `focusPersistence.ts`, `progressView.ts`, the report
or any Edge function (tested). It needs two owner decisions and fails closed
(`policy_undecided`) without them: H5 (safe legacy evidence) and H6 (coach-attested
findings). Stored status is never demoted. Transitions freeze ("re-checking with the latest
analysis") until three eligible enforced game swings exist after cut-over. Then the unchanged
`advanceFocus` runs on counted findings only: displayable findings from enforced tuples, plus
coach-attested findings when H6 allows. History is never rewritten. H7 (family wording for
`impact_estimate`) is still open.

## Owner-approved scoped exceptions

- **Pre-registration bound to run identity.** `eval:run --coverage-preregistration <path>`
  validates the policy before execution and requires `registered_at` before the run starts. It
  records `config.coverage_preregistration_sha256`, which flows into `config_sha256`, the cache
  key, `run_id` and `results_digest`. Without the flag the key is absent and existing run
  identities are byte-identical (tested). Calibration accepts a policy as met only when
  **every** source run carries its digest; otherwise `coverage_gate: not_bound_to_runs`.
- **Early failures in the coverage denominator.** Engine-attributable excluded clips with
  eligible annotations contribute one unmeasurable opportunity per annotated swing and enabled
  concept (`engine_failure_before_claims`). They are never passes, so unsafe-pass rates are
  unchanged. This also fixed a PR16 defect that dropped *paired* clips merely because
  `failures.jsonl` listed a non-exclusion code for them (`cache_integrity_failed`,
  `repeatability_*`).

## Rollback

Plan line 1000 still applies: flags back to `shadow`, the registry entry back to
`enforce_candidate`, and withheld clips re-queued. Focus records are preserved because the
cut-over never rewrites history. PR17 itself changes no runtime behaviour, so it needs no
rollback.
