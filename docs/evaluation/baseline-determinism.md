# PR5 baseline reproducibility status

Status: environment captured; real-footage study and reconstruction not performed.
No repeatability or model-accuracy claim is established by this change.

## Source and runtime capture

On the Windows GPU host, the original commit
`f79b09e63092e87efd1250c3b263d29086d81a79` exists and its Pose3D tree is
`766f4fbc64620d428da428e59b144554ca2f2a7b`. The annotated tag
`engine-baseline-1.0.0` was absent at initial capture. During stabilization it was
recreated locally as an annotated tag under explicit user authorization, after
rechecking both identities. The annotation records the PR1 baseline definition,
pipeline version and freeze rule, and identifies itself as a recovery annotation;
it does not claim the original tag-object identity, tagger or timestamp. No tag
was overwritten or pushed. See the stabilization record below for the remaining
guard blocker exposed after recovery.

The captured existing environment is `env-f4ad5b330d0c`: Python 3.12.10,
PyTorch 2.11.0+cu128, CUDA 12.8, cuDNN 91900, NVIDIA RTX 5070 Ti, driver 617.42,
Windows 11, Ultralytics 8.4.107, OpenCV module 5.0.0 (distribution 5.0.0.93),
and FFmpeg 9.0.2. VideoPose3D source commit:
`1afb1ca0f1237776518469876342fc8669d3f6a9`.

The three required checkpoint identities and byte counts are in
`src/eval/environment/models.lock.json`. `requirements.lock.txt` captures all
75 installed distributions, including pip and setuptools. No Python environment
or weights were installed, updated or downloaded. This identifies the installed
environment at capture time, not the unknown historical environment that produced
earlier production outputs. Successful model inference has not been tested here.

S0-04's proposed `scripts/pose3d/environment/` location conflicts with PR1's
protected source tree and this task's explicit no-modification constraint.
PR5 tooling and locks instead live in `src/eval/environment/`; the baseline guard
and its exception registry are unchanged. The exact two comparator TypeScript
source paths are exempted from the privacy directory rule; neighboring golden
artifacts remain ignored and prohibited by the index guard.

## Portable capture contract

Run the capture script using the existing engine Python executable with
`--source <existing-checkout> --output <new-capture-directory>`. It never loads
checkpoint objects. It hashes their bytes and rejects absent/empty files.
VideoPose3D must have unchanged tracked source and no extra source files;
the exact checkpoint and normal Python cache files are permitted.

The Python manifest validator is the executable schema: exact keys, field types,
model set, positive byte counts, lowercase SHA-256 and full source commit.
Runtime strings have a restricted character set; freeze entries must be portable
`name==version` pins. Editable installs, URLs and paths fail capture rather than
silently disappearing. No hostname, username, device UUID, serial number,
environment dump, installation path or credential is emitted.

Environment identity uses UTF-8 of normalized/sorted package pins, a NUL separator,
and JSON with sorted keys and compact separators, then SHA-256 truncated to 12
hex digits with `env-`. Whitespace, newline and dictionary insertion order do not
change it. Both locks are inputs; the version is not embedded recursively.
Exclusive output creation prevents replacing an existing capture.

Reproducibility-critical settings include CUDA/cuDNN versions, driver, GPU model,
thread counts, TF32, deterministic flags and selected numeric runtime environment
settings. These are fresh-process defaults, not an assertion that Ultralytics
leaves them unchanged during inference. Transient temperature, utilization,
timestamps and unrelated diagnostics are deliberately excluded. Package pins do
not identify wheel bytes or package-index provenance; reconstruction needs a
separately reviewed wheel source (especially the CUDA PyTorch build).

## Private execution procedure

1. Require the locally recovered annotated tag to resolve to the exact recorded
   commit/tree and `npm run check:baseline` to pass. Other checkouts need an
   authorized transfer; never overwrite an existing tag or silently recreate one.
2. Have the operator approve an access-controlled `HITTERLOOP_EVAL_ROOT` outside
   every repository and production media directory, with a retention/withdrawal
   plan. Place only authorized local evaluation copies there. No copy or consent
   inference is performed by this tooling.
3. Provision a separate detached checkout at the original commit, using existing
   locked dependencies and weights at the original relative locations. The runner
   does not create worktrees, copy weights, install dependencies or download data.
4. Enforce OS-level network denial for the Python process and children before
   passing `--offline-host-confirmed`. This flag is an operator attestation, not a
   firewall. Existing third-party imports must run on a trusted provisioned host.
5. Invoke `baseline_runner.py` with the engine Python, `--source <detached-checkout>`,
   `--repository <development-checkout>`, `--video <private-evaluation-copy>`,
   `--locks <capture-directory>`, `--local-evaluation-authorized` and
   `--offline-host-confirmed`. Run twice for each of at least five distinct,
   representative, permitted inputs. No AI adapter or production worker is used.
6. Each run creates a fresh UUID directory beneath the private root's
   `golden/engine-baseline-1.0.0/<environment>/<input-hash>/`. Logs, videos, hashes,
   run records and per-clip comparisons remain private. Never pass these to Gemini.
   No output is reused. Completion, actual exit code, source/input/environment
   identities and output hashes are recorded. A documented native Windows
   teardown exit may be nonzero even when the legacy status reports success.
7. Use `compareBaselineRuns` for paired comparisons. It checks distinct directories,
   matching input/environment and complete runner attestations, then verifies
   artifact byte hashes. These are local audit records, not signed proof of
   execution. `compareEngineOutputDirectories` also supports existing artifacts,
   but explicitly leaves provenance unverified.

## Comparison interpretation

Required JSON artifacts: pose 2D, bat path, pose 3D, metrics and successful pipeline
status. Missing, invalid, zero-frame, nonfinite and mismatched-domain artifacts
cannot pass. COCO-17 distances match frame/joint indices with confidence at least
0.5 in both runs; changed confidence eligibility is reported as a disagreement.
Timestamp, frame-count, image-size and fps mismatches block coordinate comparison.
These checks do not establish original-video PTS correspondence (PR6 work).

Every result records effective tolerances. Provisional defaults: exact contact,
phases within one frame, keypoint median 1 px/P99 8 px, endpoint presence 99%,
bat-coordinate median 1 px/P99 8 px, numeric relative difference 1%, degree
difference 0.5. Bat-coordinate thresholds are explicit conservative additions,
not measured tolerances from S0-04. Quantiles use nearest rank. Relative difference
is symmetric: absolute difference divided by the larger absolute magnitude;
two zeros yield zero, zero versus nonzero yields one. Degrees use absolute
difference (shortest circular distance for stride direction and attack direction,
linear for joint/tilt angles); the raw absolute difference is also retained.
Missing values have no numeric difference. Both-unavailable values
produce an inconclusive comparison rather than equivalence. Optional full-rate
speed may be absent in both runs when the baseline never decimated.

Comparison scope is contact, phase frame indices, confident COCO-17 points, bat
availability/coordinates, and the documented summary numeric metric fields.
Pose3D is structurally checked, not assigned a 3D coordinate tolerance. Textual
method strings, categorical movement flags and rendered overlay equivalence are
not measured. A within-tolerance result is limited to the declared scope.

## Study and reconstruction blockers

Paired clips processed: **0**. Repeatability measurements: **none**.
Empirical tolerances: **not established**. Unexpected nondeterminism: **unmeasured**.

The approved private evaluation root is unconfigured, and no specific footage
authorization was supplied. No private footage was opened or
processed. Do not select production clips merely because they are available.

After authorized runs, inspect each metric's differences privately and propose
2 x observed run-to-run P99 with units and sample counts. Do not pool incompatible
units or treat a percentile of clip-level percentiles as an observation-level P99.
`aggregateRepeatability` provides aggregate counts and contact/phase summaries;
it deliberately does not adopt tolerances. Public aggregates additionally require
human publication review and the architecture plan's cohort suppression rules;
five clips alone are not sufficient for public cohort claims.

Fresh-environment reconstruction remains deferred: it needs separate explicit
authorization for an isolated environment and any package installation/download.
The working environment and installed weights must remain intact. Repeatability
would still not establish accuracy.

## Initial PR5 validation and handoff inventory (before stabilization)

- PR5 synthetic tests: 23 pass (9 Python, 14 TypeScript), including safe diagnostics,
  provenance/artifact binding and circular-angle regression coverage.
- `npm run build` and `git diff --check` pass. A second live read-only capture
  reproduces the same environment version and all checkpoint hashes.
- `npm test` was run: PR5 and privacy checks pass, then PR1 stops on the absent
  annotated tag. This is **not a full-suite pass**.
- Separately exercised remaining groups: migration guard tests 3 pass; annotation
  tests 82 pass; drill tests 9 pass/1 fail; compiled tests 395 pass/1 fail/1 skip;
  coach/component tests 248 pass. The drill and compiled failures are the same
  existing PR2 SQL equality test: LF-generated SQL versus CRLF checkout content.
  A read-only comparison confirms exact equality after CRLF normalization.
  No SQL/migration or unrelated test was changed.
- Existing Node dependencies were restored to run the build after `ajv` was
  found missing. No npm manifest dependency or lockfile changed. Python/model
  installation and fresh-environment reconstruction were not performed.
- Initial orchestrated Gemini/AGY review completed with zero blockers. Confirmed
  notes led to explicit UTF-8 reads, safe preflight error codes, portable Python
  discovery and circular directional-angle handling. The 3D scope limitation is
  retained explicitly; absolute tolerances for near-zero timing remain a future
  empirical decision. Follow-up independent review also completed with zero
  blockers and confirmed the fixes. Its attack-angle representation question
  is resolved against original `metrics.py:331`: the stored value is
  `degrees(atan2(dy, dx))`, so circular comparison is appropriate for this legacy
  image-plane velocity direction. This is not validation of a biomechanical
  attack-angle measurement. Review records:
  `.git/gemini-review/review-20261012-123642-aeda1d.md` and
  `.git/gemini-review/review-20261012-124340-04c242.md`.
- No rendered UI changed, so visual QA is not applicable. Version metadata is
  unchanged while the baseline/test gates remain unresolved. Nothing is staged.
  Windows tests were exercised; macOS interpreter selection was code-reviewed
  but not executed on a macOS host.

Exact PR5 file inventory:

1. `.gitignore`
2. `NEXT_STEPS.md`
3. `package.json`
4. `scripts/check-no-media.mjs`
5. `scripts/check-no-media.test.mjs`
6. `scripts/run-eval-baseline-tests.mjs`
7. `src/eval/environment/capture_environment.py`
8. `src/eval/environment/baseline_runner.py`
9. `src/eval/environment/test_environment.py`
10. `src/eval/environment/requirements.lock.txt`
11. `src/eval/environment/models.lock.json`
12. `src/eval/golden/compareEngineOutputs.ts`
13. `src/eval/golden/compareEngineOutputs.test.ts`
14. `docs/evaluation/baseline-determinism.md`

Production engine source, algorithms, prompts, reports, annotation schema,
Supabase migrations and production data/storage are unchanged. No deployment,
stage, commit, push or PR6 work was performed.

## PR5 stabilization verification (before authorized relocation)

The checkout is the main `master` worktree at `fa9b652`, with its own `.git`
directory and no linked worktrees. Existing uncommitted PR5 work was preserved.
No local tags existed; a read-only query found no baseline tag on `origin` either.
The reflog records PR1 arriving through `pull --tags origin master`, while PR1's
documentation says its tag was created locally and publication was deferred.
These facts support an untransferred local-only tag as the explanation. No local
unreachable tag object was found. The original creation/deletion history cannot
be reconstructed from this checkout, so deletion is not asserted.

The expected commit exists, the expected tree matches, and the recovered ref has
Git object type `tag` (object `47ac6ef85cdfca186c23a0ebcc644c4bf4b5e3ae`).
The guard and exception registry were not edited.
Recovery exposed three previously hidden, ignored files under
`scripts/pose3d/models/`: `yolo11m-pose.pt`, `yolo11m-seg.pt`, and `yolov8m.pt`.
PR1 intentionally rejects extra files there. The pose/detection weights duplicate
the production files in `scripts/models/`, and all three paths are referenced by
the offline privacy tool (`MODEL`, `MODEL2`, `SEG_MODEL`). No checkpoints were moved
or modified; relocation plus all affected privacy-loader path corrections awaits
explicit direction. Weakening the baseline guard is not an accepted workaround.

The PR2 failure was reproduced in the generated-migration equality assertion in
`src/cli/importCuratedDrills.test.ts`. With `core.autocrlf=true` and no SQL-specific
EOL attribute, Git checks this migration out as CRLF while the generator emits LF.
The test intends exact generated SQL content equality, not a file checksum. Its
test-local assertion now normalizes only CRLF pairs to LF on both sides. Regression
tests accept LF/CRLF and still reject changed draft approval values, SQL commands,
extra whitespace and lone carriage returns. Migration bytes and security policy
were not changed.

Pre-relocation stabilization checks (superseded by the relocation verification below):

| Check | Result |
| --- | --- |
| Baseline guard | Fails on the three ignored checkpoint files; recovered tag identity passes |
| Baseline adversarial suite | 11 pass, 1 real-checkout failure (same checkpoint blocker) |
| Migration numbering guard/tests | 64 unique migrations; 3 tests pass |
| PR2 drill/curation unit tests | 13 pass |
| PR5 environment/comparator tests | 23 pass (9 Python, 14 TypeScript) |
| Privacy guards/tests through `npm test` | 54 pass/3 platform skips, then 62 pass |
| Compiled integration suite, run separately | 400 pass, 1 skip, no failures |
| `npm test` | Run; stops at baseline checkpoint blocker after PR5/privacy checks |
| `npm run build` | Pass |
| `git diff --check` | Pass |

Real PostgreSQL curation tests are unavailable because the required disposable
`codex-pr2-sql` container does not exist. No existing database was used or changed.
Corrective Gemini/AGY review completed successfully with zero implementation
blockers; record `.git/gemini-review/review-20261012-172008-efb902.md`. It confirmed
the newline fix and identified the unchanged checkpoint paths as an operational
blocker. Its suggestion to also test an entirely lone-CR file is non-blocking:
the current single-lone-CR regression already proves that any such difference
is rejected. Source inspection confirmed its useful clarification that all three
privacy model paths need updating if relocation is authorized. A guard exception
was suggested as an alternative but rejected because the user requires the guard
to remain unchanged and unweakened. Visual QA is not applicable to this correction.

Stabilization edits so far: `src/cli/importCuratedDrills.test.ts`, this document,
and the existing PR5 entry in `NEXT_STEPS.md`; plus the local annotated tag (Git
metadata, not a commit). No version bump is needed for this test/documentation
correction. Real-video runs remain **zero**, repeatability remains **unverified**,
and fresh-environment reconstruction remains deferred. The authorization,
private-storage, paired-run and reconstruction requirements above still apply.

## Authorized offline checkpoint relocation (2026-10-12)

The subsequently authorized relocation resolves the checkpoint blocker without
changing the baseline guard, exception registry, annotated tag, or production
engine. Each file moved from `scripts/pose3d/models/` to
`scripts/models/pr5-baseline-recovery/`. The destination did not previously exist.
All three were regular ignored files; the destination is covered by the existing
`scripts/models/` Git ignore rule. This protects ordinary adds, not deliberate
`git add -f`. No weights were staged or committed. The old empty directory is
harmless and its ignore rule remains as a defensive legacy rule.

| Checkpoint | Bytes before = after | SHA-256 before = after |
| --- | ---: | --- |
| `yolo11m-pose.pt` | 42459307 | `29b17eaf3a3117cbea906090dbedf9159f7c6a49db58ec8b99ed2dfde1cf6eb2` |
| `yolo11m-seg.pt` | 45400152 | `eb9a06f63e2206c35d68d839b08c362429ebecf933ad54c1ad68b2fd001c17cf` |
| `yolov8m.pt` | 52136884 | `5d4a90cdc7a21786cc59cd19778e9eafff836df9e2da32524737c7ee6efe4fe5` |

Reference inventory: `scripts/privacy/anonymize_clip.py` (pose, detection,
segmentation), `audit_subject.py` (pose), `compare_torso_pose.py` (pose), and
`validate_privacy.py` (pose/detection) are the only executable consumers of the
old locations. All four loaders now resolve the new directory. The privacy test
setup documentation, `.gitignore` comment and `NEXT_STEPS.md` were updated.
Historical mentions in `ENGINE_BASELINE.md`, `CHANGELOG.md`, and the earlier
sections of this report describe the former state, not active loader settings.
Production `detect_2d.py` and its consumers use the separate files directly in
`scripts/models/`; VideoPose3D uses its separate research checkpoint. PR5 model
locks and reconstruction depend on those unchanged production locations, not
these offline copies. No protected engine source was edited.

Actual checkpoint smoke loading succeeded for all three files with their expected
Ultralytics tasks (pose, segment, detect), using the existing environment with
socket connections blocked and auto-install disabled. The 19 privacy Python tests
passed, including loader-path/ignore regressions and a synthetic-video end-to-end
test. Existing unclosed-file ResourceWarnings in that synthetic test remain;
they did not cause failures. No real footage was processed.

A fresh-process capture still matches `env-f4ad5b330d0c`, and production model
hash verification passes. An initial capture in the *same process after model
loading* correctly differed: Ultralytics sets `CUBLAS_WORKSPACE_CONFIG=:4096:8`
and `OMP_NUM_THREADS=1`. A separate diagnostic reproduced those two changes.
This is process-local initialization, not a checkpoint relocation or installed
environment change; it reinforces the need to measure actual run-time behavior
before claiming repeatability. The lock was not rewritten to hide the difference.

The full `npm test` now passes, including the baseline guard/adversarial tests,
PR2 migration/curation unit tests, PR4 privacy tests, and PR5 environment/comparator
tests. `npm run build` and `git diff --check` pass. The annotated tag object remains
`47ac6ef85cdfca186c23a0ebcc644c4bf4b5e3ae`; the original commit/tree verification
passes across all 13 protected files. PostgreSQL integration remains **unverified**:
the required disposable `codex-pr2-sql` container is still absent; no other database
was used. Windows was tested; macOS execution remains unverified.

| Suite in successful `npm test` | Passed | Skipped | Failed |
| --- | ---: | ---: | ---: |
| PR5 Python environment / TypeScript comparator | 9 / 14 | 0 | 0 |
| PR4 privacy guard / adapter suites | 54 / 62 | 3 / 0 | 0 |
| Baseline adversarial tests | 12 | 0 | 0 |
| PR2 migration guard / drill-curation units | 3 / 13 | 0 | 0 |
| Evaluation annotations | 82 | 0 | 0 |
| Compiled integration/unit suite | 400 | 1 | 0 |
| Coach/brand regression suite | 248 | 0 | 0 |

The separate offline privacy Python suite passed all 19 tests. The three real
checkpoint loads passed; this verifies deserialization and expected task types,
not real-footage quality or repeatability. The synthetic end-to-end test exercises
pose/detection inference, not the optional segmentation treatment end to end.

Relocation file edits: `.gitignore`, `NEXT_STEPS.md`, this report, and
`scripts/privacy/{anonymize_clip,audit_subject,compare_torso_pose,validate_privacy,test_privacy}.py`,
plus the three ignored binary moves listed above. All prior uncommitted work was
preserved. No production behavior, algorithms, checkpoint contents, migration SQL,
prompts, production data or cloud state changed. No staging, commit, push,
deployment, download, environment reconstruction, or PR6 work occurred.
Real-video runs remain **zero** and repeatability remains **unverified**; authorized
private footage/root, at least five paired baseline runs, measured tolerances and
separately authorized fresh-environment reconstruction are still required.

Independent Gemini/AGY review completed successfully through the repository
orchestrated QA wrapper (tests were run separately, so `-SkipTests` was used).
Record: `.git/gemini-review/review-20261012-173425-2c3983.md`. No blocking findings.
Non-blocking notes were reconciled: retain the defensive legacy ignore rule;
leave the cosmetic `HERE` variable rename out of this narrow relocation. Review
questions reaffirm the documented Windows-only execution, unavailable PostgreSQL
integration and deferred study/reconstruction. The process-local Ultralytics
settings are a real observed condition: use fresh capture/runner processes and
account for model initialization when later measuring repeatability, rather than
assuming the pre-load capture describes every subsequent runtime setting. No
algorithm or lock change is justified by this observation alone. Visual QA is
not applicable; no UI changed.
