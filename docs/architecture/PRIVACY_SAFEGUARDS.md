# PR4 — privacy and data handling (S0-12)

PR4 implements C1 (Git protection), C2 (evaluation isolation checks), C3 (Claude data-terms confirmation), and reviews C5/C6 (logs/deletion). It does not implement C4 evidence enforcement, C7 assessment storage, the optional C8 upload-size cap (H10), or PR5. No child footage, evaluation results, or production records were read or copied for implementation or tests. Existing approved static assets were hashed for the allowlist.

## Git safeguards

Run `npm run check:no-media` before staging/publishing and after staging. `npm test` runs it before the existing baseline and migration guards. The checker reads the Git index, including force-added ignored files; restoring or removing a working file cannot conceal its indexed version.

- `.gitignore` excludes evaluation inputs, results and nested goldens, including mixed-case directory spellings. Existing footage/derived-output ignores remain in place.
- No indexed files are permitted under `videos`, `frames`, `eval-data`, `eval-results`, `golden`, `demo-export`, or `pose_out` path segments, or under `eval/media`, `eval/data`, `eval/results`, or `coach/media`. Only the existing, empty `videos/.gitkeep` and `frames/.gitkeep` are exceptions.
- Video, image and audio suffixes are rejected anywhere unless explicitly approved; checks ignore case and catch backup/double suffixes. `.ts` is reserved for TypeScript source; transport-stream footage remains covered by the private-directory rule.
- Recognizable per-clip output names (analysis results, pose JSON/arrays, metrics, manifests, frame maps, privacy summaries/validation output, real curation/validation manifests) are also prohibited outside those directories.
- Static assets are exact path + SHA-256 entries in `scripts/media-asset-allowlist.json`. This carries forward existing icons, Android artwork, the approved **fictional** prototype screenshots identified in `docs/SIMPLIFIED_APP_SPEC.md` §3.0, and two synthetic example manifests. There are no directory/wildcard asset exemptions. Both indexed content and working copies must match. CRLF-only text checkout conversion is supported for SVG/JSON; binary hashes are exact.
- New or changed static assets require a human privacy review and an explicit hash update. Do not regenerate the allowlist from whatever happens to be staged. A file placed beside an approved icon gains no approval. Symlinks cannot replace approved assets; submodules fail closed because their content is not inspected.
- The guard does not open rejected media/results. Errors contain policy codes and opaque path-hash references, never child names, private paths or content. Resolve a reference locally by hashing the repository-relative path with SHA-256 and taking its first 12 hex characters. Remove an accidental index addition with `git rm --cached -- <path>` to keep the local file; do not paste it into a PR or agent conversation.

Synthetic JSON annotation examples remain valid repository content; schema v1.0.0 is unchanged. This is a deterministic filename/index control, not a media-content classifier or Git-history scrubber. Arbitrarily renamed private data, private text pasted into otherwise legitimate documents, and modifications to the policy/checker itself still require human review. Private artifacts belong outside the repository. No new CI or deployment infrastructure is introduced; running the test gate is part of release review.

## Claude CLI confirmation and diagnostics

`analyzeSwingViaClaudeCli` first requires `CLAUDE_CLI_DATA_CONFIRMED` to equal the literal string `true`. Missing values, `false`, alternate capitalization, whitespace, numbers and malformed values fail before directory reads, prompt construction or process launch. Gemini and AGY confirmations do not cover this account's terms. The template `.env.example` defaults to `false`; PR4 does not change anyone's real environment or enable the provider.

Set the flag only after the authorized operator reviews the logged-in Claude account's terms for the footage. A flag records explicit configuration, not proof of terms, consent or account status. The original prompt, image order, model selection, CLI arguments, timeout and report validator are preserved. A mock-process regression test checks the exact approved-call request and validated result without contacting a provider.

Claude adapter errors/logs no longer echo filesystem paths, process stderr/stdout, failed envelopes, permission details, response JSON or trailing provider prose. Warnings retain only fixed messages and numeric counts. Structural/semantic failures remain failures; their private content is not forwarded into worker logs. No raw diagnostic file is created.

## Evaluation isolation

`HITTERLOOP_EVAL_ROOT` is reserved for separately authorized local evaluation tooling. It must point outside the repository and production media/frames directories. Production must not receive this configuration or evaluation credentials. If cloud evaluation is later authorized, it requires a separate project/bucket and access policy; do not reuse `GCS_BUCKET_NAME` or automatically copy production recordings. No evaluation store/configuration loader is introduced in PR4.

`npm run check:eval-isolation` inspects all production TypeScript/JavaScript in `src` (excluding `src/eval` and test/spec files), `supabase/functions`, and `coach`. This includes shared helpers used transitively by workers and Edge Functions. It rejects reserved evaluation configuration identifiers/strings and evaluation module/storage paths, including bracket access, destructuring, dynamic imports and literal string concatenation/template expressions. Tests verify Node, Deno and shared-helper cases. Evaluation code and tests may reference evaluation configuration; production may not import evaluation code.

This static architectural boundary does not prove cloud IAM separation, determine arbitrary runtime-computed configuration names, or police externally supplied aliases/credentials. Those require deployment/configuration review when evaluation storage is actually provisioned. The current application code has no evaluation storage path, and no bucket, media copy, importer or benchmark runner was added.

## Logging and deletion review

Existing flows reviewed: `processUploadQueue.ts`, `analyze.ts`, all three AI adapters, `purgeDeletedClips.ts`, `src/services/storage/gcs.ts`, and `supabase/functions/delete-clip/index.ts`.

Current deletion sequence authorizes the caller, records the deletion, removes the verified raw object, finishes the database deletion, and lets the worker recursively purge `frames/<player>/<clip>/`. The worker retries unfinished deletions after 15 minutes; already-absent objects/directories are idempotent. Raw worker downloads are removed in `finally`. Existing tests cover retry ordering, traversal refusal, unfinished deletion handling, opaque-object ownership, recursion and repeat execution.

PR4 creates no per-clip artifacts, so no new deletion branch is necessary. Future manifests/frame maps inside an existing clip directory are covered by its recursive purge; future evaluation copies need their own consent/withdrawal workflow before use.

Pre-existing risks recorded for separate work:

| Area | Observed gap / limitation |
| --- | --- |
| Worker/CLI logging | `processUploadQueue.ts` logs slugs, local paths and GCS paths; `analyze.ts` logs frame paths and player slugs. These can carry identity. Keep these logs private; PR4 does not claim all historical logging is sanitized. |
| Other adapters / Edge errors | AGY errors/prose can include provider output and paths; Gemini redacts its API key but can still propagate other provider error text. `delete-clip` can return raw storage/DB errors. This merits a separate shared diagnostic-redaction change. |
| Local retention | Derived files remain until a running worker observes deletion. A stopped/crashed worker, failed `finally` cleanup, extra workstation copies or backups can retain footage. There is no repository-defined backup purge. |
| Filesystem trust | Purge validates path segments lexically, but does not verify ancestor symlinks. The frames root and parent directories must remain controlled by the worker operator; filesystem containment hardening is separate work. |
| Cloud/provider retention | No cloud lifecycle/retention policy is defined here (H8). Provider submissions are not recalled by deleting a clip. Account/provider terms and a retention decision remain necessary. |
| Future evaluation storage | Withdrawal propagation and evaluation artifact deletion require later authorized registry/storage tooling; PR4 creates neither evaluation copies nor storage. |

No real deletion, database operation, migration, external AI analysis, deployment or publication was performed in PR4. Automated tests use temporary synthetic files and in-memory process/database doubles. Version metadata is 0.52.2 / Android 74; no mobile code changed or emulator deployment is needed.

## Validation and independent review

Commands: `npm run test:privacy`, `npm test`, `npm run build`, `deno test supabase/tests/sharedText.test.ts supabase/tests/simplifiedVisibility.test.ts`, and `git diff --check`. The privacy command includes the new guards and Claude tests, existing Gemini/AGY terms/adapter tests, demo publication privacy, shared payload/identity, opaque storage ownership, and local deletion tests. None needs a live database or real footage.

Results on macOS: 56 guard tests and 62 adapter/privacy/deletion tests pass (`npm run test:privacy`, 118 total); the full `npm test` workflow passes 505 test executions, including baseline/migration checks; the build, seven Deno privacy/visibility tests, and whitespace checks pass. Windows execution was not available; platform-specific filename/symlink cases are skipped there, while ordinary checks and CRLF compatibility remain covered. ML-dependent anonymization integration and live database tests were not run; PR4 uses no models or database changes.

Initial Gemini/AGY review completed without blocking findings. Codex verified and fixed three non-blocking notes: mixed-case `eval/media`, `eval/data` and `eval/results` ignore rules; underscore/hyphen/other punctuation after media suffixes; and repository-anchored defaults for imported guard functions. Regression tests cover each fix. The follow-up review completed successfully and verified all three fixes with zero blockers.

Two follow-up non-blocking notes remain as documented limitations: the `eval/media`, `eval/data`, and `eval/results` ignore rules apply at the repository root, while the index guard rejects those paths at any depth; and the isolation checker also conservatively flags an identifier named `eval`, although no current production code uses it. Neither is an existing production regression or an acceptance blocker. No Git pre-commit hook was installed: the enforcement point is `npm test` / the explicit checker, not an automatic promise that Git itself prevents commits. Review artifacts: `.git/gemini-review/review-20261012-073403-5c1a05.md` and `.git/gemini-review/review-20261012-073959-80ab95.md`.

Two judgment notes were reconciled: standalone development scripts remain outside the production isolation scan (no production imports of those scripts were found; revisiting this boundary is necessary if scripts become production entry points), and all npm/Android metadata is consistently 0.52.2 / code 74 as required by AGENTS.md. No version drift remains.

Exact PR4 files: `.env.example`, `.gitignore`, `CHANGELOG.md`, `NEXT_STEPS.md`, `package.json`, `package-lock.json`, `mobile/package.json`, `mobile/package-lock.json`, `mobile/android/app/build.gradle`, `src/services/ai/claudeCliAnalyzer.ts`, `src/services/ai/claudeCliAnalyzer.test.ts`, `scripts/check-no-media.mjs`, `scripts/check-no-media.test.mjs`, `scripts/media-asset-allowlist.json`, `scripts/check-eval-isolation.mjs`, `scripts/check-eval-isolation.test.mjs`, and this document.
