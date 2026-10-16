# PR12: provider-neutral evidence package

`evpkg-1.0.0` is an offline, serializable evidence contract. No production caller imports it or the prepared providers. `buildEvidencePackage` returns the package, its SHA-256 digest over recursively key-sorted JSON, and a runtime-only `Map<string, string>` of image names to absolute file paths. Arrays retain their semantic order. The returned package snapshots caller data. No paths belong in serialized fields, including the unchanged `AnalysisInput`; validation rejects path fields and absolute-path-looking strings rather than stripping or rewriting that input.

The caller declares image kind, legacy phase, analysis index and optional assumed raw frame/seconds. Names and array positions never establish identity or depiction. Each declared file must be a regular non-symlink PNG/JPEG with matching magic bytes; its bytes are read once for hash and size. Missing or malformed files fail the build. `generated` lists present image entries, including undeclared entries also listed as omitted; undeclared entries are never included as assets. Directories with image suffixes are not generated images. Expected-but-absent kind/phase pairs use the caller's reason, or `not_generated`.

The source hash must be lowercase SHA-256. Supplied manifests must match that hash and the supported schema, instrumentation and baseline engine. The pipeline stamp must map to that engine. An assessment must have the exact observed manifest tuple. This comparison checks the tuple, not a run identifier: PR8 assessments do not carry attempt IDs. Callers remain responsible for associating the assessment with the same attempt. Missing provenance fields stay null; a pipeline stamp does not fill them in.

PR8's existing all-or-nothing, hash-bound frame-map verifier supplies raw frame, integer PTS, time base and seconds. A verified map without an image's analysis row yields `unavailable`; a failed map yields `unverified` for every image; an absent map yields `unverified` with `FRAME_MAP_ABSENT`. Assumed legacy values never populate verified fields. Ordering uses verified seconds, otherwise assumed seconds; missing/nonfinite ordering time rejects the package. Ties sort by phase still, zoom, sequence, then JavaScript string order. Equal times are valid. `orderInSwing` is the contiguous rank.

## Semantic boundaries

- **Not generated:** the caller expected a kind/phase but supplied no matching image.
- **Unavailable identity:** a verified map has no row for a declared image.
- **Unverified identity:** no usable map establishes source-frame identity.
- **Omitted:** an undeclared image entry is present in the directory but excluded from the package.
- **Available versus supplied:** only names in the actual renderer's image order can contribute to V3. Other package images are excluded as `not_sent`.
- **Name versus depiction:** even verified frame identity does not establish what an image depicts. Every depiction remains `unverified_by_name`.
- **Estimated versus verified:** source identity verification does not prove event accuracy. Stills and zooms bind only to a passing package event with identical raw frame and PTS. Contact always maps to `impact_estimate`, never `contact_confirmed`.
- **Missing package versus missing evidence:** a null package returns `package_unavailable`; absent rendering returns `not_supplied`. Neither invents missing observations.
- **Approval:** every package and V3 result remains `not_coach_reviewed`.

Verified rendered sequence images become PR8 `FrameIdentity` values sorted by integer PTS, including partial sequences. Capture profile passes through unchanged. Visibility remains null (`visibility_samples_not_defined`), so image availability alone cannot make V3 sufficient for claims requiring visibility. Logging returns only counts and fixed statuses, without image names, IDs, paths or free text.

## Legacy equivalence and provider boundaries

`render-2.1` uses the existing prompt function unchanged and JavaScript default filename sort, matching `analyze.ts`. `render-2.2` prepares temporal ordering and labels but all adapters reject it with `RENDER_NOT_ENABLED`; there is no environment selector. The renderer map contains only explicit version keys.

Gemini reads only rendered assets, verifies their package hashes, and calls existing `analyzeSwing` once. Existing internal retry behavior is unchanged. Its synthetic golden test separately loads frames with the CLI's readdir/filter/sort/read/mime rule and compares the complete captured request (model, contents with base64 and text, and config), one successful fake-client call per path.

Claude and AGY run their existing account confirmation as the first operation, before rendering or filesystem access. A shared CLI preflight checks one absolute asset directory, exact legacy sorted image order, regular non-symlink files and every hash. Any difference fails with `PACKAGE_DIRECTORY_MISMATCH` before the backend. The legacy analyzer receives exactly directory and analysis input, without an addendum. The directory must remain stable until the legacy analyzer finishes: preflight does not make the subsequent legacy reopen atomic. Ancestor symlink/race hardening is outside this refactor. Result model metadata comes from the existing validated result; usage is null with `not_captured_legacy_adapter`.

## Documented deviations from S0-10

1. Adapters are prepared but not wired into production (owner constraint; PR10-B/PR13 wiring).
2. Usage is not recorded to `analysis_runs.provider_usage`: that changes the production insert and requires migration 00065, which is not applied in production. A usage reason is recorded instead.
3. The D4 hook is not added: it requires modifying `analyzeAndSync` and is unreachable while enforce is refused.
4. `extract.ts` is unchanged. Image descriptors, analysis frames and assumed raw indices/PTS remain caller-declared until wiring.
5. Local paths live in the runtime assets map instead of the Revision 1 serialized `path` field.
6. Visibility samples are not computed without an approved definition; V3 remains insufficient for visibility-dependent claims.

All new tests use synthetic byte buffers in temporary directories and injected providers. No real media, model call, migration or cloud operation is required. Version/changelog changes are outside this specification's permitted files. Independent Gemini review must be performed by the orchestrator when network use is authorized; offline tests are not independent review.
