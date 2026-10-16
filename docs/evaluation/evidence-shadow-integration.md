# PR10 shadow evidence integration (Revision 2 S0-11, worker side)

PR10 connects the PR8 evidence modules to the existing upload worker in
**shadow mode only**. With every flag at its default (`EVIDENCE_GATE_MODE=off`),
the worker does exactly what it did before: no artifact is read, nothing is
written, nothing is logged. No CV algorithm, model, prompt, report, focus,
notification, review state, `swing_detection_state` or parent-facing path
changes in either mode. Nothing is enforce-eligible.

## Worker integration point

`src/cli/processUploadQueue.ts`, inside the existing per-clip AI-diagnosis
`try`, immediately after `extractAnalysisInputs` and before the unchanged
`analyzeAndSync` call:

1. `prepareEvidenceShadow` (`src/cli/evidenceShadow.ts`) parses the PR7 flags.
   `off` returns immediately. An invalid value, or `enforce` (which the PR7
   parser refuses without an enforced registry tuple), logs one fixed line and
   skips shadow work. It does not affect processing.
2. In `shadow`, it reads only artifacts written during **this** processing
   attempt (mtime ≥ the pipeline start of this attempt; retries reuse the clip
   directory): `pose_2d.json`, `bat_path.json`, PR6 `engine_manifest.json` and
   the exact bytes of `frame_map.json`, plus `extract.ts` image *names*.
3. The pure builder (`src/services/development/evidence/shadowAssessment.ts`)
   derives the observed tuple from the manifest (engine, instrumentation and
   **actual** environment identity, with PR7's gate/claims versions and a null
   reliability profile; nothing inferred), checks that the manifest's
   `input_sha256` equals the worker's own SHA-256 of the downloaded upload, and
   runs `assessClip`. It then inserts one append-only row into
   `clip_evidence_assessments` (PR9) with `mode='shadow'`.
4. `analyzeAndSync` (`src/cli/analyze.ts`) receives an optional handle. Only
   after every legacy write, the readable mark, the focus refresh and the
   notification step, `afterRun` links `analysis_runs.evidence_assessment_id`
   (only while null) to the assessment of the **same attempt**, and writes a
   minimal `issues.claim_decision` (only while null) for each issue of that run.

## Signals (no new measurement or threshold)

`artifactSignals.ts` implements Revision 1 S0-04 `extractClipEvidenceSignals`
over existing artifacts. It does parsing and counting only and reads no 3D field (R2).

- Window: `extract.ts`'s own swing-sequence window, now shared from the pure
  `src/domain/swingWindow.ts`. `extract.ts` calls the same function, and a
  2,000-case test proves it equals the replaced inline formula.
- `batterSelection`: `pose_2d.json` `meta.bat_evidence` (detect_2d), verbatim.
- `batterTrackedFraction`: window frames with keypoints / window frames.
- `identityJumpFraction`: the `subjectBox.ts` rule via PR8 `subjectPolicy.ts`
  (anchor = load frame, else first usable frame). Revision 1 does not state the
  denominator. PR10 uses usable-body frames, the conservative reading. With
  no usable body it is null (unavailable), never 0.
- `coreKeypointFraction` and `batDetectedFraction` are as specified. Contact and
  phases are passed verbatim. An unexpected confidence label is not coerced, so
  the comparator records it as invalid.
- Strict comparator engine name: PR7 `engineCodeForPipelineVersion` and then
  PR8's explicit `strictEngineVersionForComparison`, for observational
  comparison only. Unknown pipelines keep their own name, so G8 fails.
- V1 receives only its authorized subject signals. Crop availability is
  "any batter zoom exists". Window availability is whether the window exists.

## Claim decisions

`issues.claim_decision` is coach-readable through the existing RLS and is never
selected by any Edge Function or coach file (this is tested). It carries statuses and
versions only: no subject signals, frame identities, file names or text.
V4 is recorded as `unmeasured` with a null profile. `displayable` and
`enforceEligible` are always false.

**Deviation recorded:** the plan sequences PR12 (S0-10 evidence package)
before PR10, and PR12 is not implemented. Supplied stills, zooms, sequences and
per-frame visibility therefore do not exist as frame-identity evidence. V3 is
computed without them and the record says so explicitly
(`suppliedEvidence: {status: "unavailable", reason: "evidence_package_not_implemented"}`),
so it cannot be read as a finding that evidence was missing. Every V3 result is
consequently `insufficient` until PR12.

## Failure isolation and edge cases

- Every shadow entry point resolves without throwing. Each database step is
  bounded (15 s). Logs carry fixed codes, the clip UUID and database error codes
  only. Driver messages can echo row values and are never logged.
- Missing migration, missing or stale or foreign manifest, a source-hash mismatch,
  a missing capture hash, an insert or link failure, or a timeout all skip shadow
  work. The legacy report, focus progression and notifications are unaffected.
  Missing pose or bat files still produce an honest withheld assessment.
- Duplicate processing attempts each get their own assessment (append-only).
  Each run links only to its own attempt's assessment, and links and decisions
  are never overwritten.
- Clip deletion: an insert for a deleted clip fails its FK and is skipped. The
  existing `begin/finish_clip_deletion` flow deletes the assessment, clears the
  run link and deletes the clip's issues with their decisions (tested on the
  real schema).
- A timed-out insert may still complete later. That leaves an unlinked
  historical row, which is acceptable for an append-only record.

## Not in PR10 (S0-11 read path)

The S0-11 table also lists **read-path shadow logging** (`would_withhold`,
`would_hide_fix` in `get-simplified-report`) and enforce-mode report behaviour.
PR10 changes no Edge Function. Report output is unchanged by construction.
Read-path shadow logging needs a Deno-capable verification environment, which this
host lacks, and enforce behaviour belongs to S1-12. The `reportAssembly`
off/shadow golden test and `evidenceGateParity` test from S0-11 are therefore
not added. They become meaningful when a read-path gate exists.

## Verification

- `npm run test:evidence-shadow`: 15 tests (pure builder and adapter: off, invalid,
  enforce, provenance, stale files, failures, hangs, deletion).
- `test:evidence-persistence` (guarded disposable DB `pr9_disposable_test`
  in the local container; schema-only clone, then 00063-00065): PR9's 23 tests and
  PR10's 4 real-schema tests. These cover the exact builder row round-trip,
  link/decision write-once, review state and `ai_original` untouched, the deletion
  cascade, client denial, and no parent-facing references.
- PR7 61, PR8 94, privacy 116 (3 platform skips), baseline, migrations,
  instrumentation and build all pass.

## Runtime requirements (unverified here)

- Migration 00065 must be applied before `EVIDENCE_GATE_MODE=shadow` can
  persist anything. Without it, shadow logs `persistence_unavailable` and the worker
  continues as today.
- PR6 instrumentation must run in the production pipeline for a tuple to exist.
  The manifest's actual environment must equal `env-f4ad5b330d0c` for a clip to be
  `eligible`; otherwise it is honestly `analysis_version_unavailable`.
- No production configuration enables shadow. No end-to-end worker run against
  a real clip was performed (that requires the GPU pipeline and real media).
