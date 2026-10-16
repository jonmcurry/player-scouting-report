# Engine observations normalization (PR11 / S1-04)

Evaluation-only adapter: `src/eval/normalize/engineObservations.ts`.
Schema `hitterloop.engine-observations`, schema version `1.0.0`, normalizer
`normalize-1.0.0`. No production caller, engine change, application version bump,
3D input, scoring, calibration, outcome classifier or persistence is introduced.

## Contract

`normalizeEngineOutputs` accepts unknown parsed baseline artifacts and optional
exact frame-map text. It performs no I/O; async is solely Web Crypto SHA-256.
`normalizeEngineOutputDirectory` reads only pose_2d, bat_path, metrics,
pipeline_status, engine_manifest and frame_map JSON. The last three are optional;
missing required files, malformed JSON and other read errors return the fixed
`ARTIFACT_READ_FAILED` code without paths or exception messages. It never reads
pose_3d or writes files. Callers must associate all artifacts with one attempt;
legacy pose/bat/metrics do not themselves carry cryptographic run bindings.

The pipeline stamp must map to the registered baseline; COCO order and inst-1
versions must match. Artifact metadata and sequential analysis indices are
validated. Pose and bat raster/fps must agree. Pose and bat `meta.n_frames` must
also agree: shorter or longer bat artifacts return `MALFORMED_ARTIFACT` with
detail `['FRAME_COUNT_MISMATCH']`. `detect_2d` writes both from one meta object,
so differing counts indicate artifacts that do not belong together. Individual
bat frames with null tip/knob still produce missing endpoints and, when both are
null, `not_observed`. Sparse/null frame rows are malformed artifacts.
Zero-frame artifacts are allowed by the supplied contract.

All output fields exist, unavailable scalars are null, and arrays preserve
analysis/COCO/legacy-source order. Unknown phase names are sorted. `canonicalJson`
recursively sorts object keys, preserves array order and rejects non-JSON values.
The digest hashes its UTF-8 bytes. Input objects are not mutated. Copying the
COCO name list with a type-only annotation dependency avoids that module's schema
file read; a test checks the list against the authoritative PR3 constant.

Provenance uses actual manifest fields, never expected-environment substitution.
Tuple construction matches `shadowAssessment.observedTuple`; exact registry lookup
can return null. The tuple's gate/claims versions are the existing shared constants.
Coordinates remain **analysis_raster_pixels**, not source-raster coordinates.
Scores remain uncalibrated engine metadata; low scores and outside-raster points
are retained without smoothing, rounding or thresholding. Missing/invalid points
stay explicit. A valid 17-slot array is an observed batter row even if some/all
joints are missing/invalid. Track fragments are maximal runs of those observed
rows, not evidence of continuous person identity; no person track ID is invented.
Bat track IDs include the baseline's -1 sentinel verbatim. Missing endpoints are
independent; invalid endpoints/confidence/track IDs make the bat row malformed.

## Identity

Exact frame-map text is bound by SHA-256, run ID, input hash, attempt and both
decode counts. Missing manifest, binding/count failures, malformed row structure
or differing time bases among accepted verified rows reject the whole map.
Malformed structure means non-object row, wrong analysis index, unknown status,
non-string reasons, absent raw fields, or malformed processed identity fields.
Raw identity validity is instead per row: verified status, no reasons, safe
integer indices/PTS, positive rational time base, seconds within 1e-9 and strict
increase against the previous accepted verified row. Negative integer PTS are
permitted. Intermediate/analysis identities are retained verbatim, including nulls.
Rejected maps retain no trusted processed identity and never trigger fallback.

Unlike PR8's production all-or-nothing gate, this evaluation adapter retains
individual verified rows from a bound map despite aggregate/other-row failures.
`partially_verified` means a structurally accepted map with at least one unusable
row, including zero verified rows; in that case identity mode is `unavailable`.
Otherwise `verified_frame_map` means at least one verified identity exists.
Map-level reasons summarize row reasons; they do not assert model accuracy.
Per-row verification is evaluation-only. Temporal scoring against annotations
MUST use only identities with status `verified`; `assumed` is a separate,
lower-trust slice per S1-04, and `unmappable` is never scored.

Without a map, an explicit legacy window uses `rawFrameIndices` over raw integer
PTS converted by the supplied rational time base. It sets only `assumed`, never
`source`. Legacy seconds are available as explicitly assumed metadata. Invalid
window/PTS inputs reject; out-of-range indices are individually unmappable.
Neither legacy time_s nor i/fps supplies source identity.
`source.raw_time_base` comes only from a `verified` identity and is null in
`legacy_assumed_window` and `unavailable` modes. Each assumed per-frame identity
retains its own `raw_time_base` as assumed metadata.

## Events and limitations

Only known legacy fields' frame/time_s pairs enter PR3 translation. Conflicting
contact aliases remain separate estimates; malformed aliases mark the event
invalid without discarding other valid estimates. Null/null is not produced;
missing properties are malformed. Out-of-range event frames have unmappable
identity but remain estimates. Methods/confidence labels are retained as metadata;
uncertainty is unquantified. Contact maps only to impact_estimate; load maps only
to auxiliary load_peak_estimate (the explicit PR11/PR3 rule supersedes the older
plan table's load_start wording). Other unsupported baseline events remain
not_produced, and outcome always remains unknown.

`invalid_observation_count` counts malformed batter rows, invalid individual
joints in valid-length rows, malformed bat rows (once, regardless of endpoint
count), and invalid events (once, regardless of alias count). Missing observations,
unmappable identity and outside-raster observations are not counted as invalid.

Only named metadata fields are copied; video/path/name/URL fields, arbitrary
nested metadata, exception text and 3D fields are excluded. A single `engineLabel`
helper protects detector version, source commit, event engine method/confidence,
swing detection status/confidence, pipeline status/outcome, manifest status and
each manifest reason. Non-strings return null; strings longer than 512 characters,
containing a backslash, a drive pattern (`[A-Za-z]:/`), a URL scheme
(`[a-z][a-z0-9+.-]*://`, case-insensitive), `/Users/`, `/home/`, or a control
character (U+0000–U+001F or U+007F), or starting with `/` or `~`, become the literal
`REDACTED_UNSAFE_LABEL`. Other labels, including ordinary method descriptions,
are unchanged. Manifest reasons retain their existing string-array validation.
This is defense-in-depth, not a general privacy guarantee. **Contract tension:**
other metadata strings, reason arrays and unknown phase names could
contain private text if supplied by a hostile/nonconforming producer. This adapter
is not a general-purpose PII scrubber and cannot guarantee arbitrary strings are
not athlete names while preserving them verbatim. Inputs must be baseline/inst-1
artifacts under the existing private-artifact policy; publication requires a
separate privacy gate. No public-output guarantee or real-video accuracy is claimed.

Run `npm run test:normalize`. Tests construct synthetic JSON inline; the directory
test uses a temporary synthetic directory and deliberately invalid pose_3d JSON.
No real media or dataset is accessed. Independent Gemini review belongs to the
Claude orchestrator; this delegated implementation did not invoke network tools.
