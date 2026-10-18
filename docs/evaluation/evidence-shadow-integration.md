# PR10-B shadow evidence integration (Revision 2 S0-11)

PR10-B connects PR12 package accounting to the existing worker shadow hook and
adds diagnostic report read-path observations. Defaults remain off. No provider
adapter is activated; image selection, image bytes, ordering, prompt, model,
provider request, report JSON, eligibility, focus and notifications remain on the
legacy path. No migration, configuration change, backfill or deployment occurs.

## Extraction and worker integration

`extractAnalysisInputs` retains its existing four return fields and adds `images`.
A descriptor is recorded immediately after each successful phase, zoom or sequence
write, in write order. `analysisImageDescriptors` attaches the raw frame index and
probed PTS seconds already used by the existing seek, under `assumed`. These are
analysisWindow mappings, not PR6 verified identities. Absent zooms and skipped
sequence files receive no descriptors. FFmpeg calls and their order are unchanged.

`processUploadQueue` passes `inputs.images` as one additional argument to
`prepareEvidenceShadow`. Off mode returns before artifact reads, database access
or logging. Existing invalid/enforce flag handling remains a fixed diagnostic and
skip; the parser still refuses enforcement. In shadow mode the worker reads only
artifacts fresh for this attempt (mtime at least the pipeline start): pose, bat,
manifest and exact frame-map JSON. The worker's source capture hash must match the
manifest. Existing PR8 signal extraction and assessment behavior are retained.

The assessment is appended using migration 00065 unchanged. The handle closes
over that assessment ID and those fresh artifacts. After the legacy analysis,
report writes, readable mark, focus and notification work, it links only a null
run link and sets only null per-issue decisions for that run. Retries cannot link
a different attempt. Existing deletion cascade semantics remain unchanged.

## Attestation and V3 accounting

The Gemini loader now returns `{ frames, names }` from the same sorted file list.
Frames use the legacy read/MIME rules. Only with a non-null shadow handle, inside
the Gemini branch, SHA-256 is computed over the exact buffers passed to
`analyzeSwing`. No second image read is used for transmission attestation. CLI
backends carry `cli_backend_reads_directory`; draft files carry
`draft_file_no_transmission`. Both are unattested because no transmitted buffers
are observed. There is no hashing when the handle is null.

Within the existing afterRun deadline, `buildEvidencePackage` receives the
extraction descriptors, worker source hash, captured manifest/frame-map text,
metrics, same-attempt assessment, unchanged analysis input and null capture
profile. Artifacts are never re-read for this build. Package image reads are
compared to the earlier transmitted-buffer hashes, detecting intervening changes.

Only an attested transmission whose every name and hash matches a package image
is passed to `suppliedEvidenceForV3`, in actual sent order. Partial transmission
counts only sent images. A generated package alone never proves supply.
Unattested and mismatched transmissions yield null V3 supply. Missing context or
descriptors and package-build errors yield `package_unavailable` with fixed,
allowlisted codes; filename suffixes and error details are discarded.

PR12 alone determines verified identities and event bindings. Unverified maps
count no images; stills and zooms count only at an identical passing event frame
and PTS. Legacy contact maps to `impact_estimate`, not `contact_confirmed`.
Visibility is always null. V4 stays unmeasured; displayable/enforceEligible stay
false, independent of generated or supplied counts.

`claim-decision-shadow-2` adds package version/digest/status, frame-map status,
generated/omitted counts, supply status, sent/countable counts and sorted unique
exclusion codes. Image names, image hashes, paths, raw frame identities and free
text are excluded. The package digest is intentionally retained by the specified
contract. V1 remains exported unchanged for compatibility and existing persistence
callers; the worker uses V2. `provider_usage` remains untouched/deferred because
there is no trustworthy captured usage.

## Report read path

`get-simplified-report` reads flags through the existing Edge shim only for
non-demo at-bat requests, after report assembly and shared-text redaction. Invalid
flags emit the fixed `invalid_flags` skip line and behave as off. Off mode does not
call the helper, clone the report, query private evidence or log anything.

Shadow mode passes `structuredClone(report)` to the Deno-portable `reportShadow`
module. It reads only the latest assessment's clip status, family reason, mode
and reliability version, and the displayed fix's claim decision. It logs exactly
one UUID-validated line of statuses/booleans and unmeasured reliability. It returns
no data; the existing response expression remains unchanged. The persistence
privacy test allows only these two exact queries inside the guarded call and
continues forbidding private evidence references elsewhere.

Decision conventions: absent/error/invalid-status assessment means unknown
withhold status; an eligible assessment means false and withhold means true.
No fix means false for hide-fix. An existing fix means true before calibration,
even if a stored claim fabricates `displayable: true`: no record can authorize
production display. Issue-query errors mean unknown hide-fix; rejected queries or
a timeout produce an error observation with unknown values (no-fix remains false).
The diagnostic never changes the actual report. Family reason, mode and profile
are not emitted, and neither subject/events/signals nor report prose is logged.

The helper has a shared 1500 ms default deadline; all other modes, including
`enforce`, return immediately. Late assessment completion starts no issue query
and produces no second log. Active reads cannot be cancelled by Promise.race.
Worker package reads likewise may finish after their deadline, but no subsequent
write starts after the budget expires. Logging failures cannot escape either
helper. These are observational timeouts, not transaction cancellation.

## Validation and outstanding gates

All fixtures are synthetic and temporary directories are cleaned. Tests cover
extraction metadata/call preservation, loader equality and guarded hashing, V2
matched, partial, mismatched/unattested/missing-package supply, map/event exclusion,
privacy, stale retries, DB failures, timeouts, report isolation and Edge placement.
Database verification used disposable local PostgreSQL; no real media, live
provider or cloud operation was used.

The orchestrator verified these results:

| Suite | Pass | Fail | Skip |
| --- | ---: | ---: | ---: |
| `test:evidence-shadow` | 33 | 0 | 0 |
| report-shadow | 16 | 0 | 0 |
| `test:evidence-package` | 44 | 0 | 1 (Windows symlink) |
| evidence dimensions | 94 | 0 | 0 |
| analysis flags | 61 | 0 | 0 |
| normalize | 75 | 0 | 0 |
| existing analyzer tests | 37 | 0 | 0 |
| full `npm test` compiled stage | 723 | 0 | 2 |
| disposable local PostgreSQL PR9 plus PR10 database tests | 27 | 0 | 0 |

The only full-suite failure is the pre-existing PR7 brand check. One pre-existing
shared local database methodology test race was observed once; it passed in
isolation and on rerun and is unrelated to PR10-B. Gemini review returned
**APPROVE** with zero blocking findings.

`npx tsc -p tsconfig.json --noEmit`, `npm run check:eval-isolation`, and
`git diff --check` pass (exit 0; no test-case counts).

**Resolved NO-ACTIVATION contract:** the owner authorized PR10-B to make
`src/cli/evidenceShadow.ts` the single shadow-only importer of the evidence
package. The PR12 NO-ACTIVATION providers test now allows exactly that one import
edge. It still forbids any production import of renderers or providers, any other
production import of the evidence package, and any `PROMPT_RENDER_VERSION` read.
It also asserts that the parsed evidence gate mode must be `shadow` before any
package is built.

Native Deno and the Supabase Edge bundler were not available. The Edge read path
is provisionally verified only, not production ready. Live extraction,
end-to-end worker/provider execution and rendered visual QA were not run. No
user-visible rendering changed.
Version/changelog updates are outside the permitted files; no version bump occurs.
