# HitterLoop engine v2 M5: Android integration and end-to-end testing (development-only)

M5 makes the experimental v2 engine testable in the Android app on a local stack. It is an
experimental development build: nothing here is validated, calibrated or accuracy-certified, and the
production engine, prompts, report gate and empty V4 reliability catalog are unchanged.

Implementation: Codex implemented the backend (migration, worker persistence, read model, Edge
additions) from Claude's spec; Claude reviewed and corrected it, and implemented the Android UI and the
end-to-end harness directly. Gemini reviewed the result independently.

## Upload-to-report flow (as traced and run)

Android app (`coach/simple.html` in the Capacitor shell) → `#chooseFiles` → confirm sheet →
`captureQueue` (IndexedDB) → `get-upload-url` → private storage (GCS; fake-GCS locally) →
`video_clips` row `pending` → worker `processOnePendingClip` with `ANALYSIS_ENGINE=v2-exp` (loopback
Supabase and non-production only) → `scripts/engine_v2/run_engine.py` → artifact identity check →
v2 phase ingestion → `v2CoachingEligibility` → (eligible only) still extraction, `evpkg-v2` package,
CLI provider with the render-v2 addendum, validation, `qualifyV2Findings`, `analysis_runs`/`issues` →
`experimental_v2_results` row → `get-simplified-report` → `experimental` block → app report screen.

Wiring that was missing and was added in M5:

- Gate and skip reasons were only logged; the app could not explain them. Every v2 clip now has one
  `experimental_v2_results` row (migration `00067`, service-role only, cascades with the clip).
- The production fix gate needs AI confidence "medium", so a qualified v2 issue with "low" confidence
  became a "ready, nothing to fix" report. v2 clips now render their own experimental report.
- Experimental findings fed the player's focus and progress. v2 clips are now excluded from focus,
  progress and practice evidence.
- A share link could open a v2 clip as a production report. Shared reads of a v2 clip now return
  not-found and the shared feed omits v2 clips.
- The clip response also carried a production-shaped `report` built from the v2 run. For v2 clips it
  is now `{ state: "experimental" }`; v2 findings appear only in the labelled `experimental` block.
- v2 runs queued a "report ready" notification. They no longer do (verified: the same flow queued
  `report_ready` before the fix and nothing after).
- If the `00067` table does not exist, reports load as before with no v2 data (verified by renaming the
  table locally); any other read error still fails closed.

## Outcomes and what the app shows

Every v2 report carries "Experimental analysis — not yet validated".

| Outcome | When | App |
| --- | --- | --- |
| `processing` | claimed or re-queued; worker still holds the clip | "Analyzing…" with progress |
| `not_assessable` | engine unavailable (codes), rotation mismatch, unsupported upload length, gate reasons, no frame mapping, no package, no supported still | "This swing couldn't be assessed" + each reason in plain English |
| `analysis_not_enabled` | only `V2_AI_NOT_ENABLED` / `V2_PROVIDER_UNSUPPORTED` | "Swing moments found" + the moments |
| `findings` | at least one qualified issue (stored, or matching a finding a coach already hid, which stays hidden) | issues and strengths with claim type, moments, "See it", held-back reasons; "hidden after feedback" when no issue remains visible |
| `insufficient_evidence` | issues were proposed but every one was suppressed | "Not enough evidence to show a finding … isn't a verified clean swing" |
| `no_supported_issue` | the AI proposed no issue | "No supported coaching issue … isn't a verified clean swing" |
| `withheld` | summary or no-action reason made an unsupported claim | "Analysis withheld", reasons attributed to the summary |
| `analysis_failed` | provider/diagnosis failure, or a `processing` row on a failed or released clip | "didn't finish" + "Try the analysis again" |

The storage semantics from M4 are unchanged (an all-suppressed run is stored as no-action-needed with
`NO_QUALIFIED_ISSUE_REASON`); the distinction between `insufficient_evidence` and `no_supported_issue`
is carried by the result row, so the UI never presents either as a verified clean swing. Provider
confidence is never shown. Estimated impact is always labelled "Estimated impact (not confirmed contact)".

The Edge response adds `experimental` (outcome, plain-English reasons, events with `timeS`/`seekS`,
qualified findings with claim type and cited events, held-back count, retry eligibility) and
`experimental: true` on feed rows. It contains no paths, prompts, provider diagnostics or confidence.

## Retry and deletion

`retry_experimental_v2_clip` (security definer): a coach of the team or a guardian with current consent
may re-queue a clip only when its row is `retry_eligible` or is `processing` on a failed clip or on a
ready clip the worker has released (the same 15-minute hold the report uses). It sets the clip to
`pending` with fresh retries and the row to `processing`, atomically; a second call is refused.
Deterministic outcomes (`not_assessable`, `withheld`, …) are not retryable. A retry overwrites the one
result row and the report reads the latest run, so no duplicate report appears.

Deletion uses the existing flow: the result row cascades with the clip; the worker purge removes
`frames/<player>/<clip>/` (stills, `evidence_package_v2.json`, `coaching_qualification.json`).
`analysis_runs` rows are retained with the clip link cleared, as for baseline runs.

## Video seek

`seekS` = the event frame's presentation timestamp (`pts × time_base`) plus half the median frame
duration, so the seek lands mid-frame. Measured on the Android WebView: a stream whose first frame is
at 1.5 s shows that frame at `currentTime` 1.5, so the timestamp is not shifted to start at 0 (an
earlier start-relative design landed 1.5 s early and was corrected).

## End-to-end verification (2026-10-20, local)

Real: Android debug app on emulator (sign-in form, file input, confirm sheet, capture queue, report
screen, "See it", retry and delete buttons), local Supabase auth/DB/RLS, `functions serve` Edge
functions, fake-GCS storage, the real worker, ffmpeg still extraction, evidence package, validation,
qualification, persistence, purge, and the real v2 CV engine (synthetic no-person video; authorized local footage).
Controlled doubles: the CV stage for the findings paths (a `sitecustomize` double that decodes the real
upload and writes real-schema artifacts) and the provider (a local `claude` shim with no network code,
verified first on `PATH` before every AI-enabled run). Synthetic barcode videos only, except the authorized local footage check below.

| Scenario | Result |
| --- | --- |
| Findings | 1 qualified issue + 1 strength shown, 1 numeric issue held back; 1 provider call (addendum present); 1 run |
| All suppressed | `insufficient_evidence`; strength shown; not presented as clean |
| Withheld | `withheld`; 0 runs |
| Provider failure → in-app retry | `analysis_failed` + retry button; retry re-queued; second retry refused; re-run → `findings`, 1 run, 1 row |
| Real CV, no person | `not_assessable` (`BATTER_UNAVAILABLE`, `NO_PERSON_DETECTED`); 0 provider calls |
| AI disabled | `analysis_not_enabled`; 0 provider calls |
| Seek (zero start and 1.5 s start) | 6/6 "See it" taps showed the exact source frame (decoded from screenshots) |
| Delete in app + purge | clip, issues, phases, result row, storage object and local folder removed |
| Share link to v2 clip | 404 |

Found by the end-to-end run, not by unit tests: the start-relative seek, a stale "processing" state
after a worker crash, an unguarded result write after "ready", the share-link exposure, and missing
held-back/withheld wording. Found by Gemini review and confirmed: report-ready notifications for v2
runs, the production-shaped `report` on v2 clips, the result row written after the readable mark,
retryable deterministic upload rejections, and the previously-hidden finding misreported as "no
supported issue".

## Authorized local footage check

A small set of authorized real clips went through the real app upload, fake-GCS, the worker and the
real v2 CV engine with `ENGINE_V2_AI` disabled, `AI_ANALYZER=none` and provider confirmations off.
Footage reached the emulator only through the adb DevTools tunnel, never the LAN. Every clip completed
and located swing events; the only reasons coaching did not run were `V2_AI_NOT_ENABLED` and
`V2_PROVIDER_UNSUPPORTED`. There were no provider calls and no analysis runs, and every clip was then
deleted in the app and purged. These local checks are not validation; event accuracy was not assessed.

## M5.1: debug-build video playback (2026-10-20)

The debug WebView origin was `https://localhost`, which would not load plain-HTTP media from the local
storage emulator into `<video>`. Debug builds now use `server.androidScheme: "http"` through a generated
`app/src/debug/assets/capacitor.config.json` (rewritten by `mobile/scripts/debug-scheme-override.mjs`
on every `cap copy/sync`, gitignored), and the LAN cleartext exception moved to
`app/src/debug/res/xml/network_security_config.xml`. The base config no longer sets
`allowMixedContent`, and the main network security config denies cleartext. Checked inside the built
APKs: debug has the http scheme and the single-host exception; release has neither (default https
scheme, `base-config cleartextTrafficPermitted="false"`). The origin change resets the debug app's
login and local upload queue once.

Verified in the real app player (no blob substitution, storage-emulator URL over http):

- An authorized local clip uploaded through the app (AI disabled) loaded and played; real touch input
  played it, paused it (no drift), resumed it, played to the end and restarted it.
- "See it" set `currentTime` to each event's stored seek target exactly; a numeric comparison of the
  on-screen picture with the source (no frames viewed or kept) matched the event frame wherever
  neighbouring frames differ.
- A synthetic barcode clip in the same player showed the exact event frame for 3/3 events.
- Sign-in, upload, the provider-double findings path, retry and deletion all worked on the new origin.

Found during M5.1 and guarded: still extraction (`src/cli/extract.ts`, shared with the baseline path)
seeks with ffmpeg `-ss`, which is offset by the container start time, while frame timestamps are
absolute. On a synthetic file starting at 1.5 s, `phase_load.png` labelled frame 20 contained frame 65.
All 11 local real clips start at 0 s. v2 coaching now refuses files more than 1 ms from a zero start,
or whose start can't be read within 30 s (`SOURCE_START_OFFSET_UNSUPPORTED`); the shared extractor itself is unchanged and needs a decision
because it is also used by the baseline path.

## Known gaps

- Report-video playback is verified on the Android emulator debug build only; release builds use
  signed HTTPS URLs and must be checked on a device.
- No real provider has been run with v2 evidence. iOS is unverified.
- The per-user limit of 10 uploads per rolling day applies to testers too.
- `00067` is a new migration file: it must not reach a hosted database without an explicit release decision.
