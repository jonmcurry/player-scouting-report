# Offline reliability calibration groundwork

This implements the bounded S1-10 groundwork from the Rev 2 implementation plan. It does not implement S1-08 threshold selection, S1-09 sealed testing, or S1-12 enforcement. PR8 gate thresholds remain unchanged. Environment identity establishes compatibility, not accuracy.

Run an already-scored PR13 validation run through the offline CLI:

```text
npm run eval:calibrate -- --profile-run run-0123456789abcdef --date 2026-10-18 --seed 1
```

`HITTERLOOP_EVAL_ROOT` must be an existing absolute directory outside the repository, following PR14 `evalRoot` and symlink checks. Comma-separated profile runs and optional `--diagnostic-run` dev runs are supported. All runs must already have PR14 metrics. Loading re-verifies run, registry, annotation and metrics inputs, including deterministic recomputation of existing metrics; it neither runs the engine nor writes scores. Test split is always refused. No network, database client, publication, registry mutation, flags, threshold sweeps or production caller changes are involved.

Outputs are private files beneath `calibration/rel-<engine>-<gate>-<date>/`: `profile.json`, `measurement-payloads.json`, and `report.md`. Date is mandatory and calendar-validated; it never comes from the wall clock. Existing output directories are refused, including incomplete prior writes. An interrupted write can leave a partial directory; inspect it manually before retrying with another destination/date. Each file uses exclusive creation. The CLI emits fixed error codes rather than exception paths. Reports contain aggregate rows and numbered capture slices, with no run IDs, evaluation IDs, athlete groups or paths. Profile provenance contains SHA-256 run identifiers and input digests, never raw membership. Synthetic profiles carry an explicit banner and cannot match V4 lookup. This command does not publish even aggregate reports to the repository.

## Eligibility and missing evidence

Source runs must share one exact registered source tuple with a null reliability profile. Both the initial and engine-runtime environment tuples are eligible as separate profiles; they cannot be pooled. Dev diagnostics never contribute observations. Any athlete group shared with diagnostic data, duplicate run, duplicate evaluation ID, or duplicate source-media digest is refused. Leakage checks include excluded clips. Annotations must validate and be reviewed/adjudicated without unresolved disagreement. Missing, invalid, draft and unresolved annotations are counted separately when those states are schema-valid. A previously hashed annotation that changes or disappears is a PR14 integrity error, not a silently excluded replacement. Mixed synthetic/private contributing annotations are refused. With no eligible annotations, calibration refuses `NO_ELIGIBLE_ANNOTATIONS`, rather than inventing a data origin. Invalid sport is refused when constructing payloads.

A claim passes only with V1 pass, V3 sufficient and an AND of the concept's OR event groups satisfied. A known failed requirement excludes a claim from the pass denominator; an unknown needed to establish a pass is counted unmeasurable. For passing claims, any known wrong required evidence makes the claim unsafe and measurable, even when another component is unknown; an unknown never masks a known error (that would bias the unsafe-pass rate toward zero). Otherwise any unknown required evidence makes the claim unmeasurable. The PR16 coverage policy does not change this precedence: a known-wrong pass counts in both the coverage numerator and the unsafe count. A safe claim needs correct identity, required visibility and timing for all passing alternatives used by its requirements. This conservatively requires both alternatives' evidence when both pass; an unknown unused alternative does not block a known passing alternative. No substitution turns impact estimate into confirmed contact.

Timing uses PR14 verified eligible pairs and GT frame indices. Its imported tolerances are impact estimate ±2 frames and foot plant ±3 frames. Every other event's timing correctness remains unknown even if a synthetic caller supplies a correctness label. Disabled concepts are `not_applicable`. Unsupported per-event reliability profiles are not generated: the estimator is concept-level, separately for each capture profile and tuple.

PR13 does not evaluate V3 or expose engine track identity. Its adapter explicitly records `v3_not_evaluated_in_benchmark` and `engine_track_id_unavailable`; GT identity cannot substitute for engine identity. Consequently real-shaped PR13 inputs produce zero measurable claim passes: active entries remain `unmeasured`, disabled entries `not_applicable`. Optional finite engine confidence in [0,1] is counted only. It cannot alter the estimator, status or uncertainty. Malformed confidence rejects the observation set. Arbitrary observation injection into a profile builder is restricted to synthetic datasets; the CLI always uses the PR13 adapter.

## Estimation and integrity

The estimator imports PR14 athlete-cluster bootstrap (2,000 replicates, explicit seed). Zero unsafe passes use its cluster-adjusted rule of three via `clusterBootstrap`/`upperBound`. Probability upper bounds above 1 are capped at 1, without changing ceiling decisions. Each denominator contains measurable passing swings only; unmeasurable counts and cause counts remain separate. Cause counts may overlap for one observation. Bootstrap group ordering is deterministic. The D8 provisional ceiling in plan S1-10 and §7 is 0.05:

- No measurable passes: `unmeasured`, with `no_measurable_claim_passes` and provenance cause counts.
- Point estimate above 0.05: `exceeds_ceiling`, reason `point_estimate_exceeds_ceiling`.
- Upper bound at most 0.05 and at least five athletes: D8 would be `within_ceiling`; the pre-registered coverage gate below must also pass.
- Otherwise: `inconclusive`, reason `insufficient_sample` with fewer than five athletes, else `upper_bound_above_ceiling`.

The explicit S1-10 point-estimate rule takes precedence when the point exceeds the ceiling, even for fewer than five athletes; such an entry reports `point_estimate_exceeds_ceiling`, and its athlete count stays visible. There are no tuned thresholds or additional minimum-sample thresholds. The rule-of-three bound itself enforces effective-sample adequacy for zero unsafe passes.

Profiles always have decision status `experimental`. Identical verified inputs, seed and date produce identical canonical JSON bytes. `profile_digest` is SHA-256 of canonical JSON excluding that field. Provenance records hashed source run IDs, results, registry and annotation digests, a digest of the PR14 metrics input identities, source tuple, gate/claims versions, seed, replicates, scorer/calibrator versions, exclusions and confidence presence. Source-file changes are detected on reloading inputs; the pure `verifyProfile` verifies the stored artifact, not unseen external files.

Verification checks the schema, calendar version, tuple/version relationship, numerical structure and digest. The source tuple must be registered. The generated tuple adds its own profile version and is intentionally **not registered**; `verifyProfile` returns `registration: "not_registered"` instead of rejecting that expected state. Nothing registers it here.

Production `reliability.ts` is pure and Deno-portable. Its frozen production catalog is empty. Every existing three-argument lookup therefore preserves its original all-null unmeasured object. Offline injected catalogs require a unique matching version, exact tuple, supported schema, validation split, private-consented origin and structurally valid entries. Structural checks do not cryptographically authenticate a catalog; SHA-256 verification is deliberately on the eval side only. A profile version alone is never measurement. Production never imports eval code, and injection cannot make a tuple enforceable.

## Measurement payload decisions and limits

Each entry produces a `measurement_definition` (slug `reliability_<concept>_<capture_profile>`, unique per `(slug, version)` as 00055 requires) plus an experimental `validation_decision`. Definition version is deterministically the profile schema semver, currently `1.1.0`. Sports and known intents come from eligible annotations in that capture slice; absent intents become `unknown`. `required_phases` is the deduplicated requirement event vocabulary (including OR alternatives), not an invented mapping to legacy phase names. Compatibility retains the full tuple and profile version. Visibility is empty. Both `created_by` and `decided_by` remain null and the enclosing payload requires human reviewer IDs at persistence. The output is a preparation artifact; actual database constraints and any future persistence mapping require separate review. No UUID or reviewer approval is fabricated.

## Validation and handoff

Synthetic tests cover estimator arithmetic, CI reproducibility, tuple/split/leakage exclusions, confidence independence, adapter unknowns, digest tampering, payloads, output privacy and exclusive file creation. Production tests capture both registered tuples' `decideClaim` results as SHA-256 snapshots obtained before this change. No version bump or changelog change is included because this task explicitly permits only the listed files and package scripts.

The orchestrator re-ran every suite outside the implementation sandbox (`test:calibrate` 28/28, `test:evidence-dimensions` 111/111 with the new reliability tests). It also compared all 408 three-argument production lookups (every concept, both registered tuples, profile-versioned and malformed tuples, null/empty/real capture profiles) against the committed pre-PR15 `reliability.ts`, and found 0 differences. Independent Gemini review found no blocking defects. Its confirmed findings were fixed:

- definition slugs are `reliability_<concept>_<capture_profile>`, so `(slug, version)` is unique per 00055's constraint;
- `exceeds_ceiling` carries `point_estimate_exceeds_ceiling` instead of `insufficient_sample`;
- the private report includes a capture-slice legend;
- the small-sample exceedance case is tested.

Open judgment call: the unsafe-pass denominator contains measurable passes only. If unmeasurable evidence is informative (missing not at random), a slice could reach `within_ceiling` on a biased measurable subset. No approved minimum measurable-coverage rule exists (§7.4/H4), so none is invented here; one must be pre-registered (S1-08) before any `within_ceiling` entry is relied on.

## PR16 review notes

- Coverage is measured over clips the engine processed: engine-attributable failures emit no claim and are excluded before observations are built. It is conditional on execution completing, not overall intake availability; PR14 C1/F1 report pipeline availability separately.
- `registered_at` is compared with each source run's `timing.start`. PR13 deliberately excludes timing from `results_digest`, so this ordering is a procedural check, not a cryptographic proof. A tamper-evident version would bind the pre-registration digest into the run configuration before execution (a PR13 change, deferred).

## PR17 changes (owner-approved scoped exceptions)

- Profile schema is now `1.2.0`. `coverage_preregistration` records `bound_to_runs`, and entries may carry `coverage_gate: not_bound_to_runs` (reason `coverage_not_bound_to_runs`). A policy is met only if every profile source run's `run.json` config carries `coverage_preregistration_sha256` equal to the policy digest, fixed before execution with `eval:run --coverage-preregistration`. The timing comparison remains as an additional check.
- Coverage denominator: engine-attributable excluded clips with eligible annotations now contribute unmeasurable opportunities (`engine_failure_before_claims`), so coverage is no longer conditional on the engine completing. Data and governance exclusions still contribute nothing. Paired clips are never dropped because `failures.jsonl` lists a non-exclusion code for them (PR16 defect, fixed).
- The fixed `COVERAGE_DEFINITIONS` changed accordingly (`engine_failures`, new `run_binding`). No pre-registration existed, so nothing is invalidated.
- Enforceability checks live in `docs/evaluation/enforcement-safeguards.md`.
