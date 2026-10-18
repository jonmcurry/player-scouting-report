# Evaluation metrics and reports (PR14)

S1-06 and S1-07 implement development diagnostics only. **No empirical accuracy result exists; all results are synthetic tests.** The original video remains the source of truth. This scorer does not open media, decode frames, run the engine, change production thresholds, or provide production acceptance.

## Commands and storage

Set `HITTERLOOP_EVAL_ROOT` to an existing absolute directory outside the repository. Run `npm run eval:score -- --run <run_id> [--seed <uint32>]`, then `npm run eval:compare -- --base <run_id> --candidate <run_id> [--seed <uint32>] [--publish-summary]`. Scoring writes `metrics.json` and private `report.md` beneath the run directory. Comparison writes `comparison.json` and private `report.md` under `results/compare-<base>-<candidate>/`. The optional aggregate `summary.md` stays in that same external directory. Existing outputs are never overwritten. Partial writes after an I/O failure are not automatically deleted or retried over existing files.

The scorer validates PR13 run and clip schema/version, runner version, record identities, clip-list hash, semantic registry hash, and the run's exact canonical digest basis: run minus `timing` and `results_digest`, followed by original per-clip and failure bytes. Test splits are refused. Each annotated record is reloaded using PR13's loader and its selected file hash must match. PR13 stores no annotation filename: its adjudicated-file preference and single-annotator selection rules are retained. Source hashes must match the registry. No media or engine artifact is read. An annotation absent from a PR13 excluded record is not retroactively loaded; its unknown number of swings is never invented. `annotation_unavailable_clips` exposes that limitation.

The metrics schema is `hitterloop.benchmark-metrics` 1.0.0, scorer `score-1.0.0`. It records run and registry digests, annotation hash-map digest, split, versions, partitions, explicit unmeasured entries, verbatim repeatability, private distributions, and seed/config. Its SHA-256 digest excludes only `metrics_digest`. Canonical JSON plus LF is deterministic for identical verified inputs and seed. Outputs reject path-bearing metadata rather than echoing it. CLI error messages suppress arbitrary exception details.

## Partitions and capture constraints

Every metric is scoped to an environment identity `{engineCodeVersion, instrumentationVersion, environmentVersion}`. Paired clips take it from `record.gates.tuple`; the distinct full tuples in each partition are recorded, and a partition with more than one distinct full tuple fails closed (`MIXED_TUPLES_IN_PARTITION`). Paired clips whose gates were `not_evaluated` or whose tuple is null form `tuple_unavailable`. There is no cross-partition pooled estimate. Within each partition there is a one-way `camera.capture_profile` breakdown, plus `annotation_unavailable` where no annotation exists. No sport/age/fps/size/blur cross-tabs are constructed.

Engine-attributable exclusions join the partition of their observed identity, so they stay in coverage denominators (C1, E2, `G1.*.with_failures`). Verified terminal records use their recorded `terminal.environment.environment_version`; other engine-attributable exclusions use the run's preflight `environment_version`; the engine is the run's `engine_version` and the instrumentation is the single `instrumentationVersion` shared by all run tuples. When that instrumentation is absent or ambiguous, the clips form an explicit `failures_unattributed` partition (never dropped or pooled). A record is engine-attributable when it carries engine artifacts, or its code is `ENGINE_EXECUTION_FAILED`, `PIPELINE_FAILED`, `PIPELINE_STATUS_UNAVAILABLE`, `PROCESS_START_FAILED`, `ARTIFACT_INTEGRITY_FAILED` or `ARTIFACT_READ_FAILED`. Every other exclusion (withdrawal, consent, annotation, unsupported annotation schema, media missing or mismatched, annotation-stage source mismatch) is a data or governance exclusion. These are listed in the run-level `data_exclusions` tally and the report section "Data exclusions (not engine coverage)", and they enter no engine denominator. F1 keeps the all-run clip denominator and reports data exclusions separately from engine-attributable failures.

Comparison matches evidence roles after removing engine and environment version fields from the tuple; other tuple fields must match. Null tuples match only null tuples. If more than one partition has the same role on either side, the role is ambiguous: all affected partitions remain explicitly unmatched, with no arbitrary pairing or pooling. Both original tuples remain in the private report. This conservative role interpretation needs orchestrator review if a future run contains multiple environments for the same role.

## Metric contracts

Every metric has an ID, definition, numerator, denominator, unit, eligibility, missing-prediction rule, missing-annotation rule, exclusion counts, swings/clips/athletes, value, and status. Numeric value exists exactly when status is `measured`; `unmeasured` and `not_applicable` have null value and a reason. A measured result with inadequate athlete count is inconclusive, not a fabricated missing observation. Timing numerators are sums of errors and denominators are samples; median/P90 values are the named distribution statistic, not that ratio. O1's scalar value is the classified-swing count, accompanied by the full confusion matrix.

| ID | Numerator / denominator and unit | Eligibility and missing rules |
|---|---|---|
| E1, per v2 event | Absolute engine minus GT-frame error (`gt.frame`, never the annotator uncertainty interval), frames and PTS-derived milliseconds; median, nearest-rank P90; hits within ±1 frame, ±33 ms, ±66 ms / timing samples | Only `eligible` verified pairs with observed GT. Missing predictions omitted from timing and counted as misses in E2. GT missing states excluded with reasons. For impact, “reach the zone” means observed GT `impact_estimate`. |
| E1w, per event | Distance to GT uncertainty interval (zero inside), same units and summaries | Only `eligible_gt_ambiguous` verified pairs. Never mixed into E1. Other GT states or missing predictions excluded with reasons. |
| E2, per event | Eligible verified assigned estimates / observed GT swings; fraction | Includes annotated excluded clips and all nondetected eligibility reasons. Assumed, unmappable, conflict, unassignable, outside-window, unbound source, inconsistent frame and timebase mismatch count as not detected. GT ambiguous/not_visible/not_applicable/not_annotated excluded with counts. |
| E3 precision | Verified contact claims with observed GT confirmed contact / verified `contact_confirmed` claims; fraction | Impact estimates never count. No claims gives N/A `engine_never_claims_contact_confirmed`. Only verified assigned claims count. |
| E3 recall | Verified contact claims on observed GT confirmed contact / observed GT confirmed contact; fraction | Excluded or missing predictions do not count as claims. With no claims the baseline is N/A with the same reason, rather than reporting a misleading baseline recall. |
| E4 | Paired clips with at least one event-order violation / paired clips with at least two verified main events; fraction of clips | Uses `SWING_EVENTS` order within each swing; ties allowed. Auxiliary events excluded. Missing predictions supply no ordering evidence. |
| O1 | GT `SwingOutcome` × raw PR13 engine outcome counts; scalar classified-swing count | Annotated swings in paired clips. Missing raw classification is explicitly `not_recorded`; no inferred outcome. |
| O2 | GT takes with verified launch or impact / GT `no_swing_take` in paired clips; fraction | Excluded clips tallied separately, in neither numerator nor denominator. Missing/unverified prediction is not a false swing. |
| O3 | Verified contact claims on GT miss / GT `swing_miss` in paired clips; fraction | Impact is never contact. Excluded clips tallied separately. Missing/unverified prediction is not a false claim. |
| G1 | V1 pass, each V2 pass, dimensional clip eligible, strict eligible / annotated paired swings; fraction | Gate result is clip-level and applies to each annotated swing. PR13 strict status is `eligible`, not literal `pass`. Missing/not-evaluated gates do not pass. Excluded swings counted separately. `.with_failures` includes all annotated excluded swings as not passing within their own partition. |
| G2 | Dimensional and strict coverages, paired dimensional-minus-strict mean; 2×2 agreement | Identical annotated paired swings. Agreement is both pass / dimensional only / strict only / neither. Missing gate dimensions do not pass. |
| G3, per event | Unsafe verified V2 passes / V2 passes with observed GT and eligible verified pair; fraction | Unsafe means strictly greater than 2 frames for impact or 3 for foot plant (provisional plan tolerances). Exact boundary is safe. GT non-observed passes excluded with counts. Passes without a verified eligible pair are separately unmeasurable, never safe. Other events: `no_approved_tolerance`. |
| G4 | No value | `engine_track_id_unavailable_and_coordinate_transform_unavailable`. |
| G5 | No value | `v3_not_evaluated_in_benchmark`. |
| G6 | No value | `requires_v3_and_reliability_profile_S1_10`. |
| C1 paired | Paired clips / all partition clips; fraction of clips | Includes all failures, including no-annotation failures. |
| C1 per event | Verified assigned event estimates / all annotated partition swings; fraction | Includes annotated excluded clips. GT visibility does not invalidate an otherwise verified estimate for output coverage. Missing or assumed prediction is no output. No-annotation clips are counted as exclusions, never guessed swings. |
| F1 | Each exclusion and failure-stream occurrence / all clips in run | Separate source counts avoid confusing duplicate stream entries with two failed clips. Exact mappings: terminal low-quality → `low_quality_footage`; `PIPELINE_FAILED` → `crash`. All others stay verbatim under `other`. No inferred timeout/identity/contact taxonomy. |
| R1 | Verbatim PR5 aggregate from run | Labelled “run-to-run repeatability, not accuracy”. No scoring or invented accuracy value. |

Only verified estimates in the verified slice can contribute. GT-missing eligibility can still support output/false-claim counting if PR13 verified source, timebase, identity, uniqueness and swing assignment first. It cannot support timing or E2 detection. Coordinates are never compared.

## Statistics

E2/O2/O3/G1/G3 rates use an athlete-cluster percentile bootstrap: 2,000 replicates, groups resampled with replacement, ratio of summed numerators to summed denominators. Empty-denominator replicates are dropped and counted. The 95% interval uses nearest-rank 2.5th and 97.5th percentiles, and the one-sided bound uses the 95th percentile. The generator is Mulberry32, with fixed default unsigned 32-bit seed 1 and optional CLI seed override; arithmetic constants belong to that PRNG, not to product decision thresholds. Percentiles use sorted index `ceil(p*n)-1`, bounded below by zero. Median is the mean of the middle two for an even sample.

For zero numerator, the upper bound instead equals `3/n_eff`, where `n_eff=n/DEFF`, `DEFF=1+(mean units per athlete-1)*ICC`. Binary-response one-way random-effects ANOVA estimates ICC: between and within mean squares, with unequal-size effective cluster size `(N-sum(m_i^2)/N)/(k-1)`. ICC is `max(estimate, 0.1)` and 0.1 when not estimable. This is the conservative interpretation of the plan's floor; the bound is not clipped at one. Mean units, ICC, DEFF and effective sample size accompany the bound.

Fewer than five denominator athletes gives `insufficient_sample` / inconclusive. G3 alone has a diagnostic ceiling decision: fail if point estimate exceeds 0.05; pass only if at least five athletes and upper bound ≤0.05; otherwise inconclusive. The 0.05 ceiling is plan D8 provisional. These are **development-split diagnostics; not production acceptance (§7.4/S1-09)**. No additional sample or effect thresholds are invented.

Private metrics JSON stores opaque per-athlete numerators/denominators and private unit samples for reproducible comparisons. Clip/swing memberships are hashed in that file; they are not raw evaluation IDs. These are private data, not publication material. Reports do not reproduce per-athlete rows. Comparison resamples common athlete groups once per replicate for both runs, then recomputes each statistic (including timing quantiles). Point differences use the same common-group set. Failure codes absent in one run mean zero occurrences, not missing measurement. Every verdict remains `inconclusive: no_preregistered_minimum_effect` because S1-08 does not exist. No difference CI is a release verdict.

## Reports and publication

Private reports include tuples, versions, headline and capture-profile metrics, missing metrics, failure deltas, repeatability and explicit inconclusive verdicts. Profile rows below five athletes say insufficient sample. Comparison regression lists contain only evaluation ID and base/candidate frame indices: observed E1 errors worsening by more than the approved G3 event tolerance. Latency/cost and IAA are not recorded. Reports never contain media paths. A report does not imply source media was revalidated.

Public summary rendering uses an aggregate-only whitelist. Each cell requires at least five athletes, at least twenty distinct swings, and no athlete supplying more than half the swings, checked independently for both runs. Otherwise both comparison cells say `suppressed (small sample)`. Only one-way capture-profile slices appear. Rates round to whole percent; counts below 100 swings round to nearest five. No IDs, athlete keys, per-athlete extremes, or raw tuple metadata are serialized. Clip-only metrics lacking a swing population are conservatively suppressed. The header requires explicit owner approval of the specific file before repository publication; this tool does not publish to the repository.

## Explicitly unmeasured and boundaries

The following entries are never omitted:

- Batter-frame precision/recall, wrong-athlete clip rate, fallback precision: coordinate transform and engine track ID unavailable.
- Identity switches: engine track ID unavailable.
- Bat endpoint error, endpoint swap rate, PCK-bat@0.1/@0.2, bat angle error, bat recall by blur/speed, keypoint PCK@0.2/OKS-AP, left/right swap rate: coordinate transform unavailable.
- Lead-side accuracy, timebase VFR deviation, operations wall time and GPU: not recorded in benchmark record.
- Sport, age, fps, size, blur slices: slice attribute not in scope.
- Risk-coverage curves and selective accuracy across thresholds: threshold sweep is S1-10.
- AI-layer metrics: S1-11.
- G4/G5/G6: reasons listed in the metric table.

No S1-08 pre-registration/anti-tuning, S1-09 sealed test, S1-10 calibration/reliability/threshold sweep, S1-11 AI metric, or §7.4 production acceptance is implemented. Version/package changes are limited to the three requested npm scripts; no product version or changelog bump is authorized in this specification.
