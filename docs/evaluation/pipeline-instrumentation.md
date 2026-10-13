# PR6: additive instrumentation inst-1

Status: implementation and synthetic verification; private real-video equivalence
and PR5-B repeatability remain unverified. No accuracy claim. This does not fix
the baseline's timing assumptions or authorize PR7.

## Preservation and authorization

Preflight verified the original annotated tag object
`47ac6ef85cdfca186c23a0ebcc644c4bf4b5e3ae`, commit
`f79b09e63092e87efd1250c3b263d29086d81a79`, protected tree
`766f4fbc64620d428da428e59b144554ca2f2a7b`, all 13 original files, and fresh-process
environment `env-f4ad5b330d0c`. Existing PR5 work and unrelated local files were
preserved. The engine and `PIPELINE_VERSION` identities are unchanged.

The PR1 exact-file transition registry in `ENGINE_BASELINE.md` registers inst-1.
Its guard implementation is unchanged. Authorization and reviewed-content hashes
are recorded in `docs/architecture/engine-approvals/inst-1.md`. Registration is
source governance, not empirical evidence of equivalent GPU outputs. Human
review of the registry/approval record remains required before publication.
The one approval record is pinned to LF by `.gitattributes`, because the unchanged
PR1 guard hashes approval bytes exactly; Windows checkout conversion must not
invalidate its recorded SHA-256. This is not a repository-wide newline rewrite.

Only two legacy files contain observer hooks: `run_pipeline.py` and
`detect_2d.py`. Removing the exact hooks recovers their original ASTs; a synthetic
algorithm edit is rejected by that test. Algorithms, model calls and their
arguments, iteration order, timestamps supplied to smoothing, metrics, phases,
legacy artifacts and schemas, AI requests and reports are unchanged. All other
original protected source is byte-identical modulo Git's CRLF handling.

Observers consume `Results.orig_img` after the existing iterator yields each
pose/bat result. They allocate grayscale signatures without changing that image.
No frame is returned to the analysis code. Candidate attempts are independently
recorded before the next decimation can overwrite an intermediate file. Final
diagnostics run before the existing cleanup removes intermediates, on success,
low-quality exit, and the CLI exception cleanup path. The existing status writer
and exception behavior are unchanged. Instrumentation exceptions are caught and
reported as fixed codes; an unwritable output directory emits only
`[inst-1] ARTIFACT_WRITE_FAILED`. No diagnostic can make a failed pipeline succeed.

## Artifact contract (schema_version 1)

Both artifacts are private per-run data, written beside the existing clip
outputs, covered by PR4's result-name prohibition and existing recursive deletion.
They must never be committed or sent to coding-agent review. Tests use temporary
synthetic videos only. No pixels, signatures, athlete names, input basenames,
absolute paths, URLs, Git filenames, usernames or raw exception text are emitted.

`engine_manifest.json` contains:

- Original engine/tag, original commit/tree, `instrumentation_version: inst-1`.
- Current source commit and dirty Boolean; source registration verification.
- Input SHA-256, opaque run ID, final attempt number, and exact SHA-256 of the
  companion frame-map bytes. Consumers must check both run ID and hash; the two
  atomic file replacements are not one filesystem transaction.
- Expected environment identity and actual isolated-process environment identity,
  capture scope/status, and per-checkpoint hash/byte/status results. No installation
  or download occurs. Registered production-local snapshots of PR5 capture code
  and both locks avoid a production import of evaluation tooling; a regression
  checks the snapshots equal PR5's canonical contents.
- Original/intermediate/analysis decoded timing: frame counts, nominal fps,
  actual algorithm fps where observed, exact rational time base, first/last PTS,
  missing/nonincreasing PTS counts, delta range, observed fps and maximum absolute
  `PTS_seconds - frame_index/fps` deviation. No initial-PTS subtraction conceals
  timestamp rebasing. Missing or invalid timing yields null, not an estimate.
- Actual pose and bat `detect_2d` iterator counts (not detection-presence counts;
  quality-check samples, overlay decodes and optional full-rate refinement are
  outside these two-pass counters); final
  in-process PyTorch settings; verification status, scope and fixed failure codes.
  Instrumentation verification does not assert pipeline success or model accuracy.

`frame_map.json` contains:

- Schema/instrumentation versions, run ID, input hash, attempt number, aggregate
  `verified`/`status`/`reasons`, recorded comparison settings and transformation
  metadata (trim boundaries and decimation factor, explicitly declared-only).
- One row per observed pose result: analyzed index, original presentation-order
  index, integer original PTS and rational time base, convenience PTS seconds,
  intermediate index/PTS/time base, analysis PTS/time base, content MSE scores,
  row status and reasons. Identity fields are null when unmappable.
- `attempt_history`: separately scoped maps/counts/timing for all attempted
  candidates, including abandoned or low-quality candidates. Top-level rows refer
  to the final attempted candidate, matching the baseline's final output behavior.
  Earlier candidate indices must never be treated as final-output indices.

Environment provenance and frame correspondence have separate statuses. A changed
runtime environment makes the manifest unverified without erasing independently
established content correspondence. Consumers must check all relevant statuses,
not infer full validity from the frame-map flag alone.

## Identity verification and limitations

FFprobe supplies decoded presentation-order integer PTS and the stream time base.
FFmpeg independently decodes content with `-fps_mode passthrough`; its count must
equal the FFprobe count. No `best_effort_timestamp`, `i/fps`, trim-offset formula
or decimation-factor formula supplies missing original PTS.

Every observed model frame is content-matched against the entire original and
intermediate inventory. The intermediate-to-original match must agree with the
direct original match. Pose and bat observations must each uniquely match the
same analyzed index. Counts and order must agree. Missing/duplicate/nonincreasing
PTS, repeated or ambiguous content, absent matches, incorrect composition,
reordered observations and decoder disagreements fail closed.

Comparison uses 32x32 grayscale area-resized content, MSE <= 16 in 8-bit units,
with exactly one candidate meeting the threshold. This is a provisional
conservative content criterion, not a universal proof against perceptual
collisions. Slowly changing/repeated real frames may be unmappable. Thresholds
are recorded, not empirically calibrated against real footage. The tests cover
the equality boundary and ambiguous near-matches. No timing-based tie-breaker
resolves ambiguous content.

Bounds: 20,000 frames per inventory/observation stream, 5,000,000 pair comparisons
per matching operation, 16,777,216 pixels per frame, and 120-second external
command/decode timeouts. Exceeding limits reports unverified/unmappable; it does
not change baseline processing. Diagnostic decoding/hashing adds CPU, I/O, memory
and elapsed time. No production latency or GPU equivalence benchmark is claimed.
Native process termination/power loss can leave an explicitly incomplete artifact
or a mismatched artifact pair; the run/hash checks are required.

Rotation is read from display metadata; standard right-angle autorotation is
content-verified against OpenCV observations. Arbitrary rotations are rejected.
Nonzero legacy tag-only rotation is detected and explicitly rejected as
`LEGACY_ROTATION_TAG_UNVERIFIED`, not silently reshaped. Explicit `N/A`/null PTS
values become missing; noninteger/Boolean/malformed PTS are rejected, never
truncated or guessed.
The relevant FFmpeg semantics are documented in the official
[framerate/rotation reference](https://ffmpeg.org/ffmpeg.html) and
[FFprobe frame inventory reference](https://ffmpeg.org/ffprobe.html). Decoding
counts alone are not treated as evidence of frame correspondence.

Actionable reason families:

| Reason | Required follow-up |
| --- | --- |
| `CONTENT_AMBIGUOUS`, `CONTENT_NO_MATCH` | Inspect private decode/content evidence; do not guess a frame |
| `MISSING_PTS`, `NONINCREASING_PTS` | Inspect original packet/decoded PTS; no nominal-fps repair in PR6 |
| `MODEL_DECODER_CONTENT_DISAGREEMENT`, `DECODER_COUNT_DISAGREEMENT` | Inspect decoder versions, truncated input and both pass counts |
| `TRANSFORM_COMPOSITION_UNVERIFIED`, `NONUNIQUE_OR_REORDERED_CORRESPONDENCE` | Inspect actual intermediate content, not trim/decimation arithmetic |
| `MATCH_BUDGET_EXCEEDED`, `OBSERVATION_LIMIT`, inventory/dimension limits | Run separately reviewed higher-capacity diagnostics; do not bypass verification |
| `SOURCE_NOT_REGISTERED` | Restore or explicitly register the exact authorized source; never weaken the guard |
| `MODEL_INTEGRITY_FAILED`, `ENVIRONMENT_DIFFERS_FROM_CAPTURE` | Compare private hashes/runtime with the approved capture before interpreting results |
| `INSTRUMENTATION_*_FAILED`, `COMMAND_FAILED` | Check local dependencies, permissions and decodability; diagnostics contain no raw paths |
| `INPUT_CHANGED` | Reject the run and use a stable authorized input copy |

## Synthetic evidence

Fixtures have a visible counter and separately readable binary burn-in cells.
They are authored before encoding. The mapping implementation neither reads the
counter nor uses its encoding. The oracle decodes the cells from OpenCV frames
and compares each recovered original index and PTS against the authored identity.
No test validates only an alternative implementation of the mapping formula.

| Case | Exercise |
| --- | --- |
| CFR 30 fps | Every identity and exact PTS; near-zero nominal-time deviation |
| VFR jitter | Encoded nonuniform PTS; observed delta/deviation is nonzero |
| 240 fps | Independent selected-frame fixture and real baseline decimator behavior |
| Long trim | 65-second input with synthetic audio pulse; real Stage 0 selects a 12-second re-encoded window |
| Trim + decimation | Re-encoded intermediate plus separately selected frames; composed identity verification |
| Missing frames | Independently remove frames 5 and 9; content recovers the remaining identities |
| Duplicate content | Repeated encoded frame fails as ambiguous |
| PTS rebasing | Original and trimmed PTS differ; recovered original PTS remains correct |
| Rotation | Actual 90-degree display metadata; independent counter decoder undoes display rotation |
| Decoder mismatch | Missing bat frame, same-count reorder and corrupt content fail closed |

Additional tests cover missing/duplicate PTS, empty data, threshold boundaries,
resource limits, frame non-mutation, exact original AST preservation, byte-identical
detector output with deterministic model doubles, capture snapshot identity,
private diagnostics, candidate lifecycle, artifact binding and unsafe temp targets.

Host discovery: installed FFmpeg 9.0.2 removed the legacy `-vsync` option. The
original decimator consequently returns its existing full-rate fallback on this
host. PR6 does **not** repair that algorithm/execution path. HFR and combined
transformation tests separately create decimated synthetic fixtures with supported
FFmpeg syntax; these are not evidence that the production decimator succeeded.
Likewise rotation fixtures use `-display_rotation`, because this host no longer
adds display metadata through the historical `-metadata rotate=90` spelling.

Fresh isolated provenance matches `env-f4ad5b330d0c`. The pipeline imports
Ultralytics before instrumentation starts; inherited `OMP_NUM_THREADS` and
`CUBLAS_WORKSPACE_CONFIG` can change its observed environment identity. The
manifest records the actual identity and mismatch rather than falsely stamping
the pre-import lock identity. Parent-process torch settings at finish are separate
from the isolated capture. This does not establish historical output provenance.

## Verification and remaining gates

Run `npm run test:instrumentation` (also in `npm test` pretest). It discovers an
existing Python environment with OpenCV/NumPy/SciPy and requires FFmpeg/FFprobe;
it never installs anything. Tests are synthetic and need no model inference,
production credentials, real footage or database. Build/PR1/PR5/privacy/full-suite
and independent-review outcomes are recorded below after execution.

Local Windows verification (2026-10-13):

| Check | Result |
| --- | --- |
| New instrumentation suite, including all ten video-identity cases | 25 pass after review fixes |
| PR1 guard and adversarial tests | 18 registered files; 13 tests pass |
| PR5 environment / comparator | 9 / 14 pass |
| PR4 privacy guard / adapter suites | 54 pass, 3 platform skips / 62 pass |
| Migration guard / drill-curation units | 3 / 13 pass |
| Annotation tests | 82 pass |
| Compiled suite | 400 pass, 1 skip |
| Coach/brand regression suite | 248 pass |
| Full `npm test` | Pass |
| `npm run build`, `git diff --check` | Pass |

A separate 24-frame synthetic lifecycle exercise used the **actual** source guard,
environment capture and model byte checks (not test doubles): manifest verified,
frame map verified, capture `env-f4ad5b330d0c`, and companion artifact hash verified.
This exercise observes synthetic decoder frames; it does not run the actual CV
models. The detector baseline comparison uses deterministic model doubles and
compares pose/bat JSON bytes; it does not claim four-output real-GPU equivalence.

Exact PR6 file inventory (separate from pre-existing PR5/unrelated changes):

1. `.gitattributes`
2. `NEXT_STEPS.md`
3. `package.json`
4. `docs/architecture/ENGINE_BASELINE.md`
5. `docs/architecture/engine-approvals/inst-1.md`
6. `docs/evaluation/pipeline-instrumentation.md`
7. `scripts/check-baseline-tree.test.mjs`
8. `scripts/run-instrumentation-tests.mjs`
9. `scripts/tests/inst1/test_instrumentation.py`
10. `scripts/pose3d/run_pipeline.py`
11. `scripts/pose3d/detect_2d.py`
12. `scripts/pose3d/instrumentation/inst1.py`
13. `scripts/pose3d/instrumentation/provenance_v1.py`
14. `scripts/pose3d/instrumentation/capture_environment_v1.py`
15. `scripts/pose3d/instrumentation/models.lock.json`
16. `scripts/pose3d/instrumentation/requirements.lock.txt`

Private baseline-vs-inst-1 comparison remains **not performed**: no authorized
evaluation footage/root was supplied. Preserve the original detached source for
PR5-B goldens; never generate those goldens from this instrumented checkout.
Run the PR5 comparator on separately authorized instrumented and original runs
once available. Real-video equivalence, repeatability, empirical tolerances,
fresh-environment reconstruction, macOS execution and production performance
remain unverified. PostgreSQL integration remains outside this instrumentation
change and unavailable on the previously checked disposable test host.

No application version bump: instrumentation is separately versioned as inst-1;
application/engine algorithm versions remain unchanged. No deployment, staging,
commit, push, model change, production data change or PR7 work is authorized.

## Independent review and reconciliation

The repository wrapper's default `gemini-3.1-pro-high` was rejected by the local
AGY model catalog; that invocation did not produce a review. The available
`Gemini 3.8 Flash (High)` completed the independent review successfully:
`.git/gemini-review/review-20261013-074254-674668.md`. No blocking findings.
Production AI models/prompts and wrapper defaults were not changed.

Confirmed diagnostic improvements were implemented and tested: accept explicit
`N/A`/null as missing PTS, reject noninteger PTS rather than coercing them, and
detect unsupported legacy tag-only rotation with a specific reason. FFprobe's
exact representation of missing optional fields depends on output/version; the
reviewer's categorical claim that JSON always emits `N/A` is not needed for this
defensive parser. No orientation is inferred from unverified metadata.

Other findings were reconciled as explicit limitations/prerequisites: source
provenance requires Git history plus Node for the guard (archives fail closed);
the full npm gate intentionally requires existing Python/OpenCV/NumPy/SciPy and
FFmpeg/FFprobe (focused Node suites remain separately callable); the MSE threshold
is provisional; real-video equivalence and human registry review remain open.
No opt-out silently converts missing instrumentation tests into a passing gate.
Follow-up review covers these fixes and the LF approval-record policy.

Follow-up completed successfully with no blockers:
`.git/gemini-review/review-20261013-075213-4e94a6.md`. It confirmed the parser,
rotation, VFR ground-truth and LF-policy changes. One optional defensive note
remains: nonstandard probe JSON with `tags: null` produces a generic safe
instrumentation failure rather than treating null tags as an empty dictionary.
Standard FFprobe omits absent tags; malformed metadata already fails closed.
No change is needed to infer an orientation from that malformed input.
The full suite, build and whitespace checks passed after the material fixes;
subsequent edits only record these outcomes. No UI changed, so visual QA is not
applicable. Neither independent review nor synthetic tests replace the outstanding
private-video comparison and human registration review.
