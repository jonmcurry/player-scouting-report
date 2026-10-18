# PR13 benchmark runner

Evaluation-only S1-05 implementation. Runner `bench-1.0.0`; clip schema
`hitterloop.benchmark-clip` / `1.0.0`; run schema `hitterloop.benchmark-run` /
`1.0.0`. Inputs are PR3 annotation `1.0.0`, registry contract `1`, and PR11
`hitterloop.engine-observations` / `1.0.0` / `normalize-1.0.0`.
Unsupported versions fail explicitly. No production import or application version
change is introduced. No real clip was processed, no real engine was run, and no
actual environment verification or inference was performed during this PR.

## Invocation and storage

```text
npm run eval:run -- --engine engine-baseline-1.0.0 --split dev
  [--repeat N] [--clips eval_0123456789abcdef,eval_fedcba9876543210]
  [--no-cache] [--allow-dirty] [--allow-unverified-environment]
  [--release-candidate]
```

The command is implemented for later separately authorized execution. Tests use
`FakeEngineAdapter` and tiny synthetic bytes; they neither decode media nor start
`BaselineAdapter.run`. `--repeat` must be an integer at least 2; omission means 1.
Only dev and validation are available. Test always returns
`TEST_SPLIT_REQUIRES_SEALED_ENVIRONMENT`, including with `--release-candidate`.
That flag grants no access or authority. Unknown engines and clip IDs are refused.

`HITTERLOOP_EVAL_ROOT` must already exist, be absolute, and resolve outside the
repository. Repository-contained roots return `EVAL_ROOT_INSIDE_REPOSITORY`.
Storage beneath the root uses these private locations:

- `registry/clips.jsonl`
- `annotations/1.0.0/<eval_id>/<annotator_id>.json` or `adjudicated.json`
- `media/<eval_id>.<media_ext>`
- `cache/<cacheKey>/`
- `work/benchmark-<temporary suffix>/` (removed after the attempt)
- `results/<run_id>/run.json`, `per_clip.jsonl`, `failures.jsonl`

Path containment and link checks prevent input/output paths escaping this root.
Fixed artifact filenames are used, and linked/nonregular artifact files are
rejected. Result directories are created exclusively; existing results are never
replaced. Because run identity includes engine bytes, a duplicate may only be
detected after execution. A failed write may leave an incomplete result directory;
it is not silently replaced on retry. Raw engine artifacts in private cache may
retain legacy metadata; the path/name/coordinate exclusion guarantee applies to
the three benchmark result files and benchmark logs, not legacy engine files.

## Registry and annotations

The first JSONL line is exactly the registry-version header. Clip objects have
only `eval_id`, `sha256`, `split`, `athlete_group`, `consent`, `status`, and
`media_ext`. Consent has only `consent_ref`, `eval_annotation`, and
`eval_external_ai`. Booleans must be booleans. Extensions are mp4/mov/m4v;
statuses active/withdrawn; splits dev/validation. Hashes are lowercase SHA-256.

The owner resolved the original ID conflict: registry `eval_id` now uses PR3's
exact `^eval_[a-f0-9]{16}$` pattern. Athlete groups use
`^[a-z0-9][a-z0-9-]{7,63}$`; consent references use that same opaque pattern.
Unknown keys, malformed fields/JSON, duplicate IDs/hashes, and groups spanning
splits fail closed. A clear-registry test row returns
`TEST_SPLIT_IN_CLEAR_REGISTRY`. Withdrawn clips and absent annotation consent
are excluded before annotations/media/engine access. External-AI consent is
recorded in the registry contract but never consumed: this runner sends nothing.

Adjudicated filename selection takes precedence; otherwise exactly one PR3
`ann_<16 lowercase hex>.json` is required. The filename selects the basis; the
validated annotation's actual review status is separately retained, not upgraded
from its filename. Missing, several unadjudicated, malformed, clip-mismatched,
and source-mismatched annotations receive fixed codes. Both PR3 validation and
parsing are used without echoing their diagnostics. Selected-file exact-byte hash,
schema, clip ID, revision, review status, origin, and selection basis are recorded.
Media bytes must match the registry hash before execution and again afterward.

This is an input contract, not S1-01 governance implementation. Seeded split
assignment, contamination lists, salted test-membership hashes, signed consent
verification, and withdrawal propagation remain deferred.

## Baseline and environment preflight

Baseline execution targets the **current protected tree**, not a new worktree at
the historical tag. `engine-baseline-1.0.0` predates inst-1; Revision 2 needs inst-1
in its observed evidence tuple. The unchanged PR1 guard certifies original tree
`766f4fbc64620d428da428e59b144554ca2f2a7b` plus registered observer changes.
No worktree, installation, download, or baseline alteration is performed.

Preflight obtains git commit/dirty facts, requires the PR1 guard to exit zero,
and hashes both PR5 locks exactly. Dirty trees require `--allow-dirty` on dev.
Either override flag is rejected on validation even when it would be unnecessary.
Adapter facts are checked again by the runner, including injected adapters.

**Environment path chosen:** `capture_environment.py` has no verification CLI,
but exposes usable noninteractive `capture(root)` and
`environment_version(requirements, manifest)` functions. A fresh Python process
imports those functions with bytecode writes disabled, computes the expected
identity from `src/eval/environment/locks/env-9a6a8510dec8/` (UTF-8), captures
actual packages/model hashes/runtime, and requires identities to match. The child
inherits `process.env`, with `OMP_NUM_THREADS="1"` only when absent or empty;
preset values pass through unchanged and mismatches fail closed. Only a successful
`env-<12 lowercase hex>` runtime identity that resolves to a registered tuple is
accepted. Facts in `run.json` record
`environment_capture_boundary: "engine_runtime_inherited_omp"`, required whenever
`environment_verified` is true. The lock hash facts above continue to identify the
original PR5 locks. Separate `environment_lock_models_sha256` and
`environment_lock_requirements_sha256` facts hash the exact bytes of the runtime
lock pair above and flow unchanged into `run.json`'s `preflight` object. Both must
be 64 lowercase hexadecimal characters when the environment is verified; missing
or malformed values produce `ENVIRONMENT_UNVERIFIED`, even with a dev override.
The cache key remains unchanged: it already includes the observed environment
identity, and adding these facts would change existing cache identities.
Inst-1 still compares manifests against the unchanged PR5
identity; registry resolution uses the observed identity. Output equivalence
between the thread settings is unmeasured. This checks more than package versions: model bytes,
VideoPose3D commit/cleanliness, GPU/driver/runtime and recorded settings matter.
It does not load models or run inference. Command output/errors are suppressed;
failure/mismatch becomes `ENVIRONMENT_UNVERIFIED`. Dev may explicitly use
`--allow-unverified-environment`, recording false/null verification facts.
No expected environment is substituted for an unobserved one. Tests inject all
checks and a throwing spawn spy; actual host verification is still unverified.

Python selection matches the worker: `POSE3D_PYTHON`, otherwise the repository's
Windows `.venv_pose3d/Scripts/python.exe` or macOS/Linux `.venv_pose3d/bin/python`.
The pipeline receives array arguments and `PYTHONUNBUFFERED=1`. The work directory
is created exclusively and empty, so any status file was written by this run; no
mtime comparison is used (it would only add false failures on coarse-timestamp
filesystems). `complete` is accepted even after nonzero teardown exit; `crashed`
fails. Unlike the worker's legacy exit-zero fallback, absent/malformed status fails
closed here. Tests drive this contract and the default preflight commands through
an injected spawn spy only; the real pipeline is intentionally not executed in this PR.

## Terminal engine outcomes

Before normalization, after artifact integrity checks and repeat comparisons, the
pure evaluation-only `classifyTerminal` recognizes `complete` /
`low_quality_footage`. It binds the exact frame-map bytes to the manifest hash,
checks supported engine/instrumentation versions, source hash and run/attempt
identity, and requires matching valid pose/bat metadata with empty frame arrays.
The orchestrator confirmed the contract against the real output of the person-free
synthetic smoke run (scratchpad only): it classifies as a verified terminal, and the
same real status file with outcome `ok` is not terminal.
Metrics must have exactly the early-stop shape, and the unmappable frame map must
contain `NO_ANALYZED_FRAMES`, no analyzed frames, and a last-attempt decoded count
matching the metadata. Manifest analyzed counts must both be zero.

Verified terminals use the existing exclusion accounting with
`engine_terminal_low_quality_footage`. Their sorted `terminal` record contains only
outcome, decoded/analyzed counts, run/attempt identity, frame-map hash, bound
provenance and verbatim nullable environment identity/verification. No diagnostic,
media path, coordinates, pairing, gates or eligibility is produced. Environment
identifiers and verification values are validated before serialization; unknown
values fail closed rather than being rewritten. Cache and repeat behavior is unchanged.

Fixed rejection codes are evaluated in this order (the first failing check wins):

1. `terminal_status_malformed`: unknown status/detail keys, malformed status fields
   (including a `written_at` that is not a finite JSON number; the engine writes
   `time.time()`, `run_pipeline.py:92`), or a non-complete claimed terminal.
2. `terminal_outcome_unsupported`: complete with an unsupported outcome string.
3. `terminal_frame_map_missing`: absent exact frame-map text.
4. `terminal_manifest_missing`: absent/invalid manifest object.
5. `terminal_frame_map_hash_mismatch`: exact-byte hash does not match the manifest.
6. `terminal_version_unsupported`: unsupported engine or instrumentation version.
7. `terminal_source_hash_mismatch`: manifest source differs from the registry hash.
8. `terminal_identity_mismatch`: invalid opaque run/attempt identity or disagreement
   between frame map and manifest (including input hash).
9. `terminal_artifacts_inconsistent`: malformed frame-map JSON, inconsistent or
   invalid metadata/metrics/frame arrays/counts, or unsafe environment fields.
   Malformed map JSON is rejected immediately after the version check, before
   source/identity checks can inspect it.

The PR11 normalizer is unchanged. Absent status or ordinary `ok` outcomes continue
through its existing path (unknown status/detail keys are rejected when status is
present). An ordinary output with frame-count mismatch still excludes as
`normalization_failed:MALFORMED_ARTIFACT`; terminal classification does not relax
normalization. Rejected terminals also use existing exclusion counts/failures and
never proceed to normalization, gates or pairing.

## Pairing and gates

Pairing is pure. Temporal records contain original integer frame index/PTS and
GT status/uncertainty/reason, never errors or differences. Time bases reduce by
integer GCD (`n` equals `n/1`). A verified identity must match annotation PTS at
the exact source index and lie within frame count. Inconsistencies are recorded
per engine frame and on affected pairs, never repaired.

Each swing has records in SWING_EVENTS order. Exactly one eligibility is assigned
per record, with engine ambiguity/availability checked before source/timebase,
source-frame consistency, swing assignment, and GT availability:

```text
eligible
eligible_gt_ambiguous
gt_not_observed
gt_not_applicable
gt_not_annotated
engine_not_produced
engine_identity_unmappable
engine_identity_assumed
engine_estimate_conflict
engine_event_unassignable_to_swing
engine_event_outside_gt_window
time_base_mismatch
source_hash_mismatch
engine_source_unbound
engine_identity_inconsistent_with_annotation_source
```

Clip preconditions retain source/timebase reasons even when a pair's primary
reason is unavailable engine output. `verified_slice` is the main eligibility
ledger, including ineligible/missing/unmappable pairs; its name does not assert
that every entry is eligible. Assumed estimates appear only in `assumed_slice`.
Mixed aliases retain a conflict on the main record and assumed identities in the
separate slice. Identical identities deduplicate; different aliases conflict.
Single-swing events still record outside-window failures; multiple swings require
exactly one containing window. No assignment by swing index is attempted.

Legacy contact pairs only with impact_estimate. Contact_confirmed, swing_launch,
stride_foot_lift, and load_start remain not_produced. Load_peak_estimate and
extension are separate `auxiliary_no_gt_counterpart` records. Outcomes are raw
GT/unknown pairs, with no inferred classifications.

Every spatial comparison is `coordinate_transform_unavailable`: source-normalized
GT and analysis-pixel engine output have no approved rotation/mirroring/crop/scale
transform. Per annotated frame, record exact verified-frame availability and
batter/bat endpoint statuses, without coordinates. If no exact match exists but
unmappable rows remain, `engine_frame_unmappable` means availability cannot be
resolved; it does not assign any particular unknown row to that source frame.
Without unknown rows, use `engine_frame_absent`. Invalid source/timebase also
withholds spatial availability. Record fragments, missing endpoints and invalid
observation counts. Engine track identity stays null/unavailable; no identity
match is claimed.

Gates call existing assessClip, extractClipEvidenceSignals, subjectSignalsFrom,
observedTuple, and subjectBoxAt. Unknown or malformed observed environment identity
produces `not_evaluated: tuple_unavailable`; arbitrary strings cannot enter result
tuple version fields. Known-format but unregistered environments retain the
existing gate's withholding behavior. Located legacy phases supply phase-still
names and the pure subjectBoxAt crop-availability replica. No images are created:
`aiInputs_source` is `subject_box_replica_no_media`, sequence count is 0, and its
skip reason is `not_generated_in_benchmark`. Results retain clip/family status,
V1 reasons, V2 status per event, and strict-0.1.0 status/failedRules. Gate thresholds,
signal fractions, reliability and gate metrics are not serialized.

## Cache, repeats, and deterministic results

Cache SHA-256 covers canonical JSON of source hash, engine, inst-1, original
baseline tree, both exact lock hashes, the verified environment version and config
hash. A run whose environment is unverified (`--allow-unverified-environment`) has no
identity to bind artifacts to, so it never reads or writes the cache; run.json records
`cache_used`. Cache verification compares
the complete fixed artifact inventory against cache metadata, including absence
markers; required pose/bat/metrics must exist. A failed check records
`cache_integrity_failed` and executes again. `--no-cache` executes directly.
The optional pose_3d artifact is additionally hashed/copied solely because PR5's
repeatability comparator requires it; it is never normalized or paired with GT.

For N repeats, only the first may use cache. Consecutive artifacts use PR5
compareEngineOutputs with provisionalTolerances. Per-clip comparisons and fixed
repeatability failure codes are retained; run.json contains aggregateRepeatability.
`provenanceVerified` stays false: these are not compareBaselineRuns' historical
tagged golden attestations. The explicit PR5 repeatability requirement is treated
as an exception to the prohibition on new numeric accuracy/error calculations:
its existing numeric run-to-run differences/tolerances remain only under
`repeatability`. No comparison to GT, new threshold, or empirical accuracy is
computed. Missing 3D or other comparator inputs remain failures/inconclusive,
never fabricated completeness.

Configuration and clip processing are sorted independently of registry or CLI ID
order. `registry_sha256` hashes the **validated canonical sorted registry**, with
`registry_hash_basis: canonical_validated_registry`. This resolves the conflict
between a byte-level registry digest and required line-order independence.
Annotation and engine hashes remain exact-byte hashes.

Run ID is `run-` plus 16 hex characters of the canonical config/registry/
annotation-hashes/artifact-hashes/versions digest. Versions include engine,
normalizer, schema, locks, environment, and git provenance facts. Operational cache
hit/miss is omitted so successful reuse does not change results. Cache-integrity
failures are intentionally retained and can change results_digest even when
re-execution recovers identical artifact bytes and therefore the same run ID.
Existing output still cannot be overwritten in that case.

Results digest covers canonical run metadata followed by exact per_clip.jsonl and
failures.jsonl bytes. Both `timing` and the digest field itself are omitted (a
self-containing digest cannot be calculated). Only timing contains wall-clock
start/end. Object keys are sorted; arrays retain defined order. Files have LF
endings and a single final newline when nonempty; an empty JSONL stream is empty.
No metrics.json or report.md is generated in the results directory.

## Validation and deferred work

`npm run test:benchmark` lists all seven test files explicitly for Windows portability.
Synthetic tests cover identities/CFR/VFR, aliases/windows, missing/ambiguous labels,
spatial withholding, fragments, invalid/missing observations, version/schema/source
rejections, registry/consent, cache and repeat execution, deterministic results,
CLI refusals, privacy and preflight overrides. Existing normalization, baseline,
evidence dimensions/shadow/package suites and repository guards are also requested.

The orchestrator re-ran the requested commands outside the implementation sandbox:

| Suite | Pass | Fail | Skip |
| --- | ---: | ---: | ---: |
| `test:benchmark` | 129 | 0 | 0 |
| `test:normalize` | 75 | 0 | 0 |
| `test:eval-baseline` (Python) | 13 | 0 | 0 |
| `test:evidence-dimensions` | 94 | 0 | 0 |
| `test:evidence-shadow` | 33 | 0 | 0 |
| `test:evidence-package` | 44 | 0 | 1 (Windows symlink) |

`npx tsc -p tsconfig.json --noEmit`, `check:eval-isolation`, `check:no-media`,
`check:baseline` and `git diff --check` pass (exit 0). No real clip was processed
and the BaselineAdapter was never executed. Independent Gemini review found no
blocking defects; its confirmed findings (lock-file encoding, environment binding of
the cache, coarse-mtime status check, untested default preflight) were fixed and
re-reviewed with an APPROVE verdict.

Deferred: full S1-01 registry/governance, S1-06 accuracy/coverage/rates, S1-07
reports, S1-10 calibration/AI work, sealed test environment, actual host environment
verification, real baseline execution/repeatability, and the GPU smoke run on at
least three authorized dev clips. No UI changed; rendered QA does not apply.

## Coverage pre-registration binding (PR17)

`--coverage-preregistration <path>` reads a policy only from beneath `$EVAL_ROOT/preregistration/`. Before any engine work it checks the schema, fixed definitions, owner-supplied minimum and digest. It requires `registered_at` strictly before the run starts, and the policy tuple must match the engine, `inst-1` and the preflight environment. It then adds `coverage_preregistration_sha256` to the run config. That changes `config_sha256`, the cache key, `run_id` and `results_digest`, so the binding is part of the tamper-evident run identity. Without the flag the key is absent, and existing run identities and digests are byte-identical. Refusals: `PREREGISTRATION_UNREADABLE`, `INVALID_PREREGISTRATION`, `INVALID_COVERAGE_MINIMUM`, `PREREGISTRATION_DEFINITIONS_MISMATCH`, `PREREGISTRATION_DIGEST_MISMATCH`, `PREREGISTRATION_TUPLE_MISMATCH`, `PREREGISTRATION_NOT_BEFORE_RESULTS`, `EVAL_PATH_ESCAPE`.
