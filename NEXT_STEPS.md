### UI-PR7.1 implementation handoff (2026-10-21)

- Normal (baseline) reports no longer navigate by baseline timestamps. The automatic seek to `contactTime - 0.5` on open, the estimated-moment marker and "Watch the swing" were removed. The video opens at its natural start with "Play video" (resumes, or restarts from 0 once ended), native play/pause/scrub and ½ speed. Progress "Then vs. now" no longer aligns or seeks by `contactTime`; copy is "Watch the two videos side by side. Camera views and timing can differ." `jump-contact` is experimental-only (`seekTarget(experimental, "impact_estimate")`, no `contactTime` fallback). The baseline presentation's `momentLabel` is now `null`. Experimental See it unchanged. The server still returns `contactTime`; no payload, schema, worker or CV change.
- Verified 2026-10-21: `npm test`, guards, and Android debug+release builds and unit tests pass. On emulator-5554 at 360x640 and 412x915, with fictional fixtures on synthetic short 30 fps, 75 s, 240 fps, VFR and 1.5 s-start videos (stored contact 1.2 s / 40 s), every coach, parent and shared view opened at its natural start (0, or 1.5 s first-frame PTS) with no marker, and Play video played from there. Experimental See it still lands on frames 20/45/70. Gemini: no blocking findings; the non-blocking seek-error handling and the stale baseline `momentLabel` were fixed.
- Open: restoring a baseline moment needs persisted source-frame provenance (§7.4.1).

### UI-PR7 implementation handoff (2026-10-21)

- Baseline reports expose no finding-moment controls, including injected moments/phase fields. The verified evidence inventory and D-10 scope this work to experimental See it controls. (The baseline Watch the swing and marker were later removed in UI-PR7.1.)
- Experimental labels explicitly identify estimated load and hitting moments; accessible names use the approved wording. Successful source-frame seeks scroll, focus the video and announce through a visually hidden polite live region inside the experimental report (the visible #simpleMessage box is not used). Failed seeks remain silent outside the existing video error UI. No playback offsets or speed changes.
- Validation: `npm run build` passed; focused Node tests 87/87 and all `coach/**/*.test.mjs` 346/346 passed with `--experimental-test-isolation=none` after default isolation hit spawn EPERM. Tests include invalid/missing seeks and nonzero-start refusal. UI-PR5/6 work preserved; no version or changelog changes.
- Verified 2026-10-21 on emulator-5554 (fictional synthetic barcode clip): See it lands on the exact source frame for load (20), estimated hitting moment (45) and finish (70) at 360x640 and 412x915, with the video paused and focused and the announcement read from the hidden live region. Normal reports show no finding-moment control; coach, parent and shared-link views unchanged. Evidence inventory: HITTERLOOP_V2_UI_UX_REDESIGN.md §7.4.1.

### UI-PR6 implementation handoff (2026-10-21)

- Added the version-1 pure report presentation read model for baseline and experimental reports, computed before shared-text redaction and explicitly projected into shared payloads. Failure sentences come from the existing `plainFailureReason` producer; no qualification, evidence gates, providers, or persisted outcomes changed.
- The client uses validated presentation states, distinguishes hidden feedback from unavailable experimental moments, shows the approved limited-analysis note, and fails closed for absent/invalid baseline contracts. Demo report payloads carry the contract. Existing experimental outcome copy remains available through the same export.
- Validation: `npm run build`; Node tests with `--experimental-test-isolation=none` for reportPresentation, sharedSimplePayload, reportAssembly and experimentalV2Report; all `coach/**/*.test.mjs`; `git diff --check`. Existing assertions changed only for contract-driven unavailable/no-swing selection and experimental hidden-feedback fixtures; UI-PR5 behavior and tests preserved.
- Verified 2026-10-21: the live local Edge function maps all 20 fictional fixture states as intended (shared payload carries only the allowlisted presentation keys); Deno check stays at the existing 52-error baseline; emulator QA at 360x640 and 412x915 for coach, parent and shared-link views found no clean-swing claims, no raw text and no overflow. Gemini: no blocking findings. Not staged, committed or deployed.
- Open: feed rows still use headlines, not `fixState` (§8.2 feed line); `limited`, `withheld_evidence` and `legacy_safe_only` for baseline reports arrive only with Tier 2 evidence enforcement (S0-11).

### UI-PR5 implementation handoff (2026-10-21)

- Coach Settings > Shared links: lists links the coach created (one read that never selects the plaintext `token`), grouped Active / Expired or turned off, with confirmed "Turn off" through the existing `revoke_simple_share_link`. Player screen adds Player details (Edit details: name, jersey, age band, bats, throws; slug unchanged) and Delete player using the legacy contract (audited per-clip `delete-clip`, then the player row; fails closed while any clip remains). Coach `?clip=` links without `?player=` resolve the player through one RLS read; unknown or other-team clips stay on Team.
- Verified 2026-10-21 on emulator-5554 with fictional accounts: token never in the DOM, turned-off link returns the generic 404, every unusable share link shows the same unavailable page, edit/delete against synthetic clips, clip-only links, parent sees no coach tools. Permission probes: another team's coach gets nothing; a parent cannot list links but can revoke a coach-created link for their own child (existing 00047 guardian rule, unchanged).
- Open: parents cannot list or manage the links they create (needs a creator-scoped list read - a migration); list shows the newest 50 links without paging; a link to an experimental clip would list as Active although the server refuses it (the UI never creates one).

### UI-PR4 implementation handoff (2026-10-21)

- Coach shell is Team / Record / Progress (parents keep Home / Record / Progress). Team: roster rows (jersey badge, latest game at-bat date, Analyzing / Couldn't analyze chip from ONE batched `game_log_entries` read), Import players (reused `rosterImportSheet.js`), Add player, per-row overflow (Invite parent, Cancel pending invites). Player screen: parent Home content plus a Parents card (linked guardians with Remove, pending invites with Cancel, Invite parent). Progress has a player chip switcher for coaches. Settings adds Team details (sport, level), a team switcher for multi-team coaches, and "Legacy coach tools" (`index.html?legacy=1`). No default link to `team.html`/`player.html` remains in the simplified app.
- Delete confirmation now snapshots frozen target IDs before the dialog; a confirmed delete returns to where the report was opened (coach Player screen, parent Home).
- Verified 2026-10-21 on emulator-5554 with fictional accounts (coach, empty-team coach, linked parent) and synthetic media: Team -> Player -> report -> Back chains, overflow/sheet/confirm Back, add/import, upload lands on the player's screen, parent sees no coach UI, parent data-layer probe returns zero coach rows and denied coach RPCs/inserts, legacy route still reaches `team.html`. Visual QA at 360x640 and 412x915. Gemini: no blocking findings.
- Open gaps (legacy-only until parity): Player Context editing, Delete player, share-link management (UI-PR5). Roster focus line needs a batched server-side roster summary read (backend item; not invented client-side). The feed is not date-sorted (server order; T1-14 feed rows). Team switching reloads the page.

### UI-PR3 implementation handoff (2026-10-20)

- Report/disclosure polish and failed-delete correctness implemented locally on top of uncommitted UI-PR1/UI-PR2. Own clip deletes last; failures preserve the report; hide feedback uses a Back-aware reason sheet; report video errors have one automatic URL refresh.
- Verified 2026-10-20 on emulator-5554 with fictional data: delete cancel, Back with the confirmation open, server 500, transport failure, partial sibling failure, offline, repeated taps and the experimental report all stay on the report; only a fully confirmed delete navigates Home. Visual QA at 360x640 and 412x915. Gemini: no blocking findings after fixes.
- Open judgment calls: the filming checklist still says "through contact" (a filming instruction, not an estimated event); multi-strength experimental reports repeat one "What looked good" h2 per strength card. No version bump, staging, publication, or deployment yet.

## Prioritized outstanding work from `docs/SIMPLIFIED_APP_SPEC.md` (updated 2026-10-08)

This is the current work order. **Critical** items block inviting families or a hosted release;
**High** items block a spec-complete simplified default route; **Medium** items close
validation and operating gaps; **Low** items are explicitly deferred or small cleanup. The dated
entries below retain the evidence and history behind these tasks. Jon's manual visual review of
the earlier Android build passed. The simplified public demo has also passed a local rendered
mobile-width review of Home and an at-bat report; authenticated family/device review remains open.

### PR10 screenshot privacy preflight — local sanitization only

- Redacted all 14 screenshots from the exposed screenshot commit (since replaced on `master`), stripped metadata, verified exact bytes/opaque masks, and obtained sanitized-only Gemini visual review (no blockers). The inventory and index/history/invitation risk records are kept local-only, outside the public repo.
- Only reviewed sanitized hashes are allowlisted. The unchanged Git index still holds the original sensitive images, so media/privacy gates remain blocked. Nothing was staged; history and the potentially active invitation remain unremediated pending separate authorization.
- PR10 worker integration has not started. Separate regression execution also exposes an existing brand-guard mismatch in two unchanged PR7 test fixtures; do not confuse that with screenshot sanitization.

### HitterLoop v2 engine M3 — experimental swing events on source PTS

- Pipeline 0.3.0 adds PR3-aligned events (stance_set, load_peak_estimate, stride_foot_lift, foot_plant, swing_launch, impact_estimate, extension, finish; contact_confirmed and load_start never produced) from selected-batter pose and direct barrel-end/mask-axis evidence only (knob never used), exact PTS derivatives, fail-closed gates and order rules, phases mirroring only available events. Contract: `docs/evaluation/engine-v2-m3.md`.
- Local development check on a small set of authorized clips (results kept locally, not published): impact/extension usually located and consistent with the owner's approximate swing annotation where one existed; swing_launch is late in the acceleration ramp and stride lift/plant are not usable (flagged not_recommended / unavailable). Not validated. Released as 0.54.0 (dev-only engine, default behaviour unchanged); no deployment. M4 not started.

### HitterLoop v2 engine M2.1 — evidence-aware batter selection

- Final batter decision (pipeline 0.2.1) now combines unchanged pose eligibility with exclusive direct bat evidence across all eligible candidates (shared bats credit nobody; thresholds fixed in advance), keeping explicit selected/ambiguous/unavailable outcomes. Contract: `docs/evaluation/engine-v2-m2.1.md`.
- In a local development check on a small set of authorized clips (results kept locally, not published) grounding resolved clips that pose-only selection left ambiguous and matched the one owner annotation available. Development examples are not validation; knob error remains open.

### HitterLoop v2 engine M2 — experimental bat geometry and tracking

- Add a bat stage to the dev-only v2 engine (pipeline 0.2.0): pinned in-place YOLO11m-seg COCO class 34 masks, PCA mask-to-segment geometry, hand-based knob/tip identity with continuity only as a secondary signal, explicit ambiguity/flip-conflict statuses, PTS-bounded labelled interpolation, and `bat_path.json` whose baseline `tip`/`knob` hold direct detections only. Contract: `docs/evaluation/engine-v2-m2.md`.
- Open: the pretrained bat class detected nothing on synthetic renders, so real detection rates are unknown until authorized annotated footage exists; thresholds unvalidated; wrists stand in for hands. Implemented directly by Claude while Codex was rate-limited. No version bump or deployment. M3 not started.

### HitterLoop v2 engine M1 — experimental decoder/tracker skeleton

- Add original-PTS streaming decode, offline native-ReID person tracking, continuity-split pose-only batter selection and isolated dev-only worker routing. No bat/events/AI claims; thresholds remain unvalidated. Contract: `docs/evaluation/engine-v2-m1.md`.
- Worker timeout and CAS heartbeat cover both engines; v2 clears stale baseline phase/summary/3D evidence. Synthetic-only verification passes (engine 16, engine TS 13, full `npm test` incl. DB, guards). Three Gemini reviews found no blockers; confirmed findings (high-fps centre-jump splitting, nearby-swap sensitivity, ClaimLostError absorption, taskkill 128, ffprobe rotation cross-check, 33 ms time-base window) were fixed; slow multi-frame identity drift remains a documented limit. See the contract doc.
- Open: no real-footage run (needs authorized clips); batter selection thresholds are unvalidated; PyAV 18.1.0 cannot read stream-level display matrices; no end-to-end v2 worker run yet. M2 not started. No version bump or deployment.

### HitterLoop v2 PR12 — provider-neutral evidence package (S0-10, not wired)

- `evpkg-1.0.0` package (`src/services/ai/evidencePackage.ts`), `render-2.1` (legacy, golden-equal Gemini request) / `render-2.2` (prepared, unreachable), Gemini/Claude CLI/AGY adapters behind `SwingReportProvider`, and `suppliedEvidenceForV3` (only sent + verified + event-bound images count). See `docs/evaluation/evidence-package.md`.
- Deferred S0-10 items (owner constraints): production wiring, `analysis_runs.provider_usage` writes (needs 00065), D4 hook, `extract.ts` image descriptors, visibility samples. The absolute-path scan can fail closed on benign text containing " /word"; revisit at wiring. Symlink guard test is skipped on this Windows host (EPERM).

### HitterLoop v2 PR11 — engine output normalization (S1-04, evaluation-only)

- `src/eval/normalize/engineObservations.ts` (schema `hitterloop.engine-observations` 1.0.0, `normalize-1.0.0`) turns baseline pose/bat/metrics artifacts into deterministic observations bound per row to the PR6 frame map; legacy "assumed" window identity only when a caller supplies window + raw PTS. Contact → `impact_estimate` only; no outcome/landmark/confidence invention. See `docs/evaluation/engine-normalization.md`.
- Open: no real-clip normalization run yet (synthetic fixtures only); coordinates stay in analysis-raster pixels until a later PR maps them to the annotation source raster; temporal scoring must use only `verified` identities.

### HitterLoop v2 PR10 — shadow evidence in the worker (S0-11, worker side only)

- `EVIDENCE_GATE_MODE=shadow` (default `off` = no change at all) records a private V1-V4 assessment per processing attempt after `extractAnalysisInputs`, links the unchanged AI run to it, and writes a non-displayable `issues.claim_decision` per issue. Fail-soft, time-bounded, write-once; see `docs/evaluation/evidence-shadow-integration.md`.
- Open: PR12 (S0-10 evidence package) is still unbuilt, so V3 records "supplied evidence unavailable" (always insufficient). Read-path shadow logging in `get-simplified-report` is not done (needs Deno verification). 00065 is not applied to any real database; no real-clip end-to-end run yet.

### HitterLoop v2 PR9 — private evidence-assessment persistence

- Add migration 00065 with the private append-only `clip_evidence_assessments` history, exact S0-09 checks and nullable links on provider runs/issues. Demo mirrors only the nullable columns and has no assessment table.
- Cascade-aware triggers preserve the existing two-stage clip deletion flow while blocking direct service-role/owner assessment mutation. Disposable PostgreSQL integration tests pass 23/23. Details: `docs/evaluation/evidence-persistence.md`.
- No worker/report/AI/flag integration is added. Native Deno remains unavailable. Full `npm test` is currently stopped by the unrelated screenshot commit's unapproved indexed media; all PR9 and requested compatible suites otherwise pass. Gemini/AGY review found no blockers; its FK-index improvement was applied.

### HitterLoop v2 PR8 — isolated evidence dimensions

- Recovered Revision 1 S0-04 now supplies the exact observational strict-0.1.0 comparator and authorized V1 subject thresholds. V2 event identity, proposed V3 requirements and unmeasured V4 remain isolated from production. No claim can become enforce-eligible.
- Provenance, original specification gaps and explicit compatibility conventions: `docs/evaluation/evidence-assessment.md`. All 256 rule combinations, boundary/null/malformed inputs, MAX_JUMP drift and 3D independence are tested. PR8 94, PR3 82 and PR7 61 tests pass; full suite and build pass. Completion Gemini/AGY review passed with no blockers; documented non-blocking runtime, performance and signal-reference limitations.
- Native Deno/Supabase bundling and PR5-B/PR6 real-video checks remain unverified. No production flags, behavior, staging, commit or deployment changes.

### HitterLoop v2 PR7 — evidence registry and flags (foundational only)

- Add a shadow-only exact-version catalog and one pure Node/Edge configuration parser. Both gates default off; current enforcement requests fail closed. No production call sites or runtime environment settings change. No fabricated calibration or approvals; reserved gate/proposed-claims names do not implement PR8.
- Verification and limitations: `docs/evaluation/evidence-registry.md`. Native Deno is unavailable locally; Node exercises the actual Edge shim over a shared acceptance table. PR5-B repeatability and PR6 real-video equivalence remain unverified. No stage, commit, push or deployment authorization is implied.
- PR7 validation: 61 focused tests, full npm suite, build and whitespace checks pass. Gemini/AGY review completed without blockers; clarified TypeScript build scope and tested both Edge exports. Native Deno/Edge bundling and future claims approval governance remain explicit integration prerequisites.

### HitterLoop v2 PR6 — inst-1 additive instrumentation (real-video equivalence unverified)

- Additive private engine manifests and content-verified frame maps; no analysis timing/algorithm fixes. Original tag/source identity and captured environment were verified before edits. Exact registration, synthetic burned-in frame tests and independent review are required; details in `docs/evaluation/pipeline-instrumentation.md`.
- Real-video equivalence and PR5-B repeatability remain unverified. FFmpeg 9 rejects the baseline decimator's legacy `-vsync`; its existing full-rate fallback is preserved, not repaired by PR6. No PR7 or deployment work.
- Exact inst-1 registration passes the unchanged guard (18 files, 13 adversarial tests); 25 instrumentation tests and full npm/build/whitespace checks pass. Synthetic frame identities use independent burned-in counters; deterministic model doubles produce byte-identical baseline/instrumented pose/bat JSON. Both Gemini reviews completed without blockers using the available Gemini 3.8 Flash High after the retired wrapper default was rejected. PTS/legacy-rotation diagnostics were strengthened and retested; optional handling of malformed null tags already fails closed and is documented. Human registry review and real-video equivalence remain outstanding.

### HitterLoop v2 PR5 — environment capture and repeatability tooling (runtime study blocked)

- Latest stabilization: authorized byte-identical relocation of three offline privacy checkpoints to `scripts/models/pr5-baseline-recovery/` resolves the protected-tree blocker. All four privacy loaders were updated; actual checkpoint loading and 19 synthetic privacy tests pass. Full `npm test`, build and diff checks now pass; production capture remains `env-f4ad5b330d0c` and the recovered tag is unchanged. PostgreSQL integration is unavailable. No real-video repeatability or fresh-environment reconstruction is verified. See the report's relocation section for hashes and current verification; earlier bullets retain the pre-recovery history.
- Relocation Gemini/AGY review completed with no blockers. Retained the defensive legacy ignore rule and deferred a cosmetic variable rename; runtime initialization and platform/study limitations remain explicit. No further behavior changes were required.
- Captured the existing Windows GPU environment and three checkpoint hashes as `env-f4ad5b330d0c`. Tooling/locks are under `src/eval/environment/` to preserve PR1's protected Pose3D tree. Added private detached-source execution checks and scoped golden comparisons with explicit missing-data/threshold handling.
- The original commit and subtree exist, but the annotated baseline tag is absent on this host: PR1's guard fails closed. No approved evaluation root or specific clip-use authorization was supplied, so zero footage runs occurred. Fresh-environment reconstruction is deferred. No historical-output provenance, repeatability or accuracy claim is made.
- Runbook and aggregate-only blocked-study record: `docs/evaluation/baseline-determinism.md`. Version bump is deferred until validation/review gates are resolved; production versions remain unchanged. No production behavior, weights, Python dependencies, model selection, annotations, cloud data or deployment changes.
- Validation: 23 focused tests, build and whitespace checks pass. Privacy, annotation, migration-guard and coach tests pass. Full `npm test` stops at the missing tag; separately run compiled/drill suites expose the existing PR2 CRLF-versus-LF SQL equality failure (normalized content matches). Both Gemini reviews completed with zero blockers; UTF-8, safe diagnostics, portable interpreter discovery and circular directional-angle fixes were reconciled. No real repeatability or reconstruction result is claimed.
- Stabilization: recovered the absent annotated tag locally under explicit authorization after verifying commit/tree; origin also lacks it, consistent with PR1's deferred tag publication. Fixed only the PR2 test's CRLF/LF comparison and added strict regression coverage (13 focused drill tests pass; compiled integration 400 pass/1 skip). The unchanged baseline guard now exposes three ignored checkpoints under `scripts/pose3d/models/`; all three are used by the offline privacy tool, so relocation/path corrections await direction. Corrective Gemini review completed with no implementation blockers and confirmed this operational blocker. No checkpoint, migration, production behavior or data changed. Detailed current verification is in the PR5 report.

### HitterLoop v2 PR4 — privacy and data-handling safeguards

- Added a Git-index media/result guard with exact static-asset hash approvals and evaluation storage isolation checks across production source. Force-added private artifacts fail; approved UI artwork and synthetic annotation fixtures remain allowed.
- Claude CLI now requires literal `CLAUDE_CLI_DATA_CONFIRMED=true` before any image-directory access or process invocation. Its diagnostics suppress private paths/provider output; approved-call prompts, settings and validated results remain unchanged.
- Logging/deletion review and pre-existing gaps are recorded in `docs/architecture/PRIVACY_SAFEGUARDS.md`. PR4 creates no per-clip files requiring extra cleanup. Broad logging redaction, local/backup retention and purge ancestor-symlink containment remain separate work.
- Validation passes: 118 privacy/adapter/guard tests, 505 full npm test executions, seven Deno privacy tests, build and whitespace checks. Both Gemini reviews completed with no blockers; three initial notes were fixed and verified, and two minor follow-up limitations are documented. Version 0.52.2 / Android 74; no algorithm, annotation schema, report, migration, cloud storage or deployment change. H10 upload-size cap and PR5 remain deferred.

### HitterLoop v2 PR3 — evaluation annotation contract

- Added standard JSON Schema v1, shared TypeScript structural validation, relational annotation validation and separate independent source-inventory comparison. All timing uses original presentation-order indices plus exact integer PTS/time base; no frame/fps estimates or decoder/benchmark runner were added.
- Core event vocabulary separates impact estimates from confirmed contact. Pure legacy translation retains original phase/source-field/time provenance, keeps load peaks auxiliary and leaves unsupported events `not_produced`. Production phase terminology and algorithms are untouched.
- Ten synthetic-only fixtures and the reviewer guide cover batter identity, COCO-17, bat endpoints, camera conditions, missing/ambiguous observations, outcomes and independent review/adjudication. Added `contact_confirmed_unknown_direction` to avoid inventing fair/foul classification when contact is visible; the optional vocabulary clarification remains open to user steering.
- Validation: 82 focused annotation/legacy tests and all 387 npm test executions pass. Both Gemini reviews completed without blockers. Four initial non-blocking findings and one review-attribution question were addressed and verified on follow-up; remaining cosmetic and vocabulary notes are reconciled in the guide. Full conformance requires portable structure plus relational rules; real media verification additionally needs an independently decoded/hashed inventory, not the annotation's own declarations.
- App patch metadata is 0.52.1 / Android 73; no app/engine behavior change. Pre-existing PR1/PR2 and QA-wrapper edits remain preserved, unstaged and uncommitted. No real footage, model installation, migrations, production records, deployment, or PR4 work.

### HitterLoop v2 PR2 — migration and drill-curation integrity

- Implemented S0-02/S0-03 only: unique migration guard; progress remains 00062; 90 drill candidates become draft-only 00063; 00064 adds qualified reviewers, authenticated content-bound decisions, append-only audit and public/demo enforcement. Imports preserve reviewed content. Legacy reports now exclude unapproved assignments without rewriting records.
- Existing local Supabase remains at 00035, inspected read-only. Corrected 00001–00064 applied to a disposable database. The original duplicate migration fails SQL escaping; a valid minimal duplicate pair proves CLI 2.117.0 attempts both and then fails migration-history uniqueness.
- Validation: npm workflow 305 passing test executions; 19 real SQL security tests; signed-JWT/import API integration; six existing development-flow tests; existing simplified SQL smoke. Gemini/AGY review completed with zero blocking findings; three non-blocking notes and one product question were reconciled against the explicit approval rules and fail-closed tests. Runbook and file inventory: `docs/architecture/DRILL_CURATION.md`.
- Version 0.52.0 / Android code 72; no engine, models, prompts, evidence gates, historical report/focus records, existing databases, or production data changed. No deployment, commit, staging or push. PR1 remains separate uncommitted work; PR3 has not begun.

### HitterLoop v2 PR1 — original engine preservation

- Local annotated `engine-baseline-1.0.0` preserves `f79b09e63092e87efd1250c3b263d29086d81a79`; the pose3d tree is `766f4fbc64620d428da428e59b144554ca2f2a7b`. `docs/architecture/ENGINE_BASELINE.md` records the freeze, reproduction procedure, independent version dimensions, and empty exact-hash exception registry.
- `npm test` now checks baseline source preservation and adversarial guard tests. No engine, model, provider, migration, or application behavior was changed. Environment capture, private goldens, and instrumentation remain separate authorized work packages.
- Validation: 288 tests pass (12 new guard tests and 276 existing tests); original application and pose3d source have no diff from the pinned commit. The scoped Gemini wrapper completed with no blocking findings. Empty-directory handling and tag availability are intentional; the unused ignored `scripts/pose3d/models/` path remains guarded because the engine actually reads `scripts/models/`.
- Tag publication and merging this PR require separate authorization. The supplied implementation plan remains an unrelated untracked input; PR2 and later work have not begun.

### 2026-10-11 — automatic local upload processing

- [x] Keep the upload worker standing with the rest of the local development stack via
  `npm run dev:local`, and label a completed transfer waiting on the worker as `Processing…`
  instead of `Uploading…`. The real emulator upload reached local GCS, completed the Pose3D
  pipeline, and advanced to `ready`. Optional AI diagnosis remains locally misconfigured while
  `AI_ANALYZER=claude-cli` has no explicit `CLAUDE_CLI_MODEL`; the deterministic video result is
  preserved when diagnosis fails.
- [x] Replace the duplicate right-side processing label with a persisted stage percentage. The
  value is milestone completion, not an estimated remaining time. Home and processing reports
  refresh every three seconds while work remains active, then stop at a terminal state.
- [x] Allow an at-bat to be deleted while analysis is still running, preserving the audited
  media-cleanup-first deletion order.
- [x] The "stuck processing" second upload had actually finished; the page just never refreshed.
  The worker noise seen afterward came from `npm run test:guardians`: its `after()` team delete
  was silently blocked by `prevent_entry_delete_with_clips`, leaving a `guardians-*` test team
  with 17 fake pending clips. Cleanup now deletes clips first and fails loudly; the one leaked
  team (`guardians-a-9ec688b0`, 42 test clips) was removed from local Supabase.
- [x] Re-applied `supabase/seed.sql` locally; `uploadQueue.test.ts` now runs against the real
  database, including a new test that `processing_progress` only moves forward while processing,
  resets to 0 on retry, and is 100 when ready. Full `npm test`: 272 pass, 0 fail.
- [x] Local `AI_ANALYZER=agy-cli` backend (Antigravity CLI, `gemini-3.1-pro-high`). Verified with
  unit tests, a synthetic-image `view_file` smoke test, and a real prompt size check (~9.1k of a
  30k-char budget). Gemini review: no blocking findings.
- [ ] Jon to decide whether the Antigravity account's data terms are acceptable for real player
  footage, then set `AGY_ANALYZER_DATA_CONFIRMED=true` in `.env`; a full analysis of a real
  clip through `agy` has not run yet.

### Planned — youth-first analysis depth expansion

- [x] Phase 7 local performance lab foundation: consent-gated original instrument imports, exact-version independent mappings, manual attempt links, separate staff-only reads, descriptive distributions, and audited bounded export. No pilot partner, mapping, real athlete consent, or automatic synchronization was supplied or enabled. Local migration and fixture validation performed; hosted access and live visual review remain open.
- [ ] Phase 7 pilot: obtain a consented partner export and provider field/unit definitions; review the first exact mapping and validate old and new provider versions against original files before enabling normalization. No partner data or mapping was seeded locally.
- [ ] Phase 7 linkage: run a pilot accuracy study on device timestamps and manually verified video attempts before considering automatic synchronization. Manual links only are available now.
- [ ] Phase 7 operations: establish the consent artifact, data owner, retention/deletion and analyst onboarding process before enabling lab access for real athletes; deploy migration and coach assets only after release approval.
- [x] Phase 6 local adaptability foundation: six versioned, youth-safe controlled-practice templates and a coach-only session/slot workflow. Actual task and environment, missed/failed attempts, and readable video are required; advanced sets require validated same-task repeatability. Visual game clips remain a separate series, and changed never implies improved. No qualified reviewers or protocol validations were seeded, so pilot recording cannot publish a result. Local authenticated review, real-coach validation, live mobile rendering, and deployment remain open.
- [x] Phase 5 local comparison foundation: coach-only same-player, sport, intent, environment, capture, definition-version candidate ledger; immutable baseline versions, median and middle-half distribution after a validated definition's sample gate, individual attempts, coach narrowing, and stale-source redaction. Game/practice series stay distinct. Trend and family wording remain unavailable without approved change thresholds and population/profile validation; no definition was promoted or migration deployed. Disposable PostgreSQL migration/statistics/deletion/concurrency smoke checks passed; authenticated DB, real-footage, and live visual QA remain release gates.
- [x] Phase 4 local coach analysis: separate enabled-and-trained coach read, original-video phase navigation, phase filmstrip/cards and evidence drawer, same-player compatible side-by-side playback, and audited guardian-visible text notes. Family/share/demo payloads remain unchanged. Staff-private notes, voice, overlays, and unvalidated numeric claims remain unavailable. Local DB, real-footage comparison, and rendered mobile/wide QA remain release gates; no migration or app build was deployed.
- [ ] Phase 0 human decisions remain open: name the softball/baseball and independent validation reviewers; approve player-scoped three-view permissions, advanced sharing, consent/retention wording, and numeric validation thresholds before any measurement is called validated. The proposed vocabulary, applicability matrix, two-estimate study, and owner roles are recorded in `docs/ANALYSIS_DEPTH_PHASE_0.md`.
- [x] Phase 1 local foundation: additive service-only definition, decision, evidence, and technical-result tables; append-only governance; run/clip identity checks; source labels, controlled exclusions, and explicit read projections. No migration was deployed, no client endpoint was added, and no new result is displayed. Local DB access/deletion verification remains a release gate.
- [x] Phase 2 local capture foundation: governed game/backstop and open-side profiles, optional declarations and append-only coach corrections, private media/visibility assessments, scoped capture summaries, and revised filming guidance. Catcher view stays disabled; uncertain profile geometry, specific obstructions, and setup comparability remain unavailable. Local DB and rendered visual verification remain release gates; no migration or app build was deployed.
- [x] Phase 3 local attempt/context foundation: one canonical attempt per ready, readable legacy clip; idempotent dry-run-first backfill and optional worker snapshot; versioned legacy phase events with explicit unknown uncertainty; append-only coach context/phase corrections; and service-only sport/intent routing from the latest context. No report/focus/share/demo consumer moved and no multi-attempt clip was enabled. Local DB parity, deletion, and authenticated correction verification remain open; no migration or app build was deployed.
- [ ] Implement the phased requirements in
  [`docs/ANALYSIS_DEPTH_SRD.md`](docs/ANALYSIS_DEPTH_SRD.md): athlete fingerprints, a phase-by-phase
  coach report, softball/baseball style and intent handling, controlled adaptability sessions,
  auditable evidence drawers, a governed measurement hierarchy, and standardized capture modes.
  The simplified family report remains the default at every competition level. Existing critical
  consent, hosted-access, deletion, and real-footage validation gates remain first; advanced claims
  ship only after their own population- and capture-specific validation.

### 2026-10-09 — deprecated-file cleanup

- Removed the unused MediaPipe comparison scripts and launcher flag, stale Capacitor template
  tests, completed one-off methodology publication script, and obsolete hard-coded prototype
  screenshot renderer. The research provenance, legacy rollback UI, ignored local evidence, and
  unwired reconstruction experiment remain pending separate keep/remove decisions.

### 2026-10-08 — simplified public-demo implementation and cloud boundary

- [x] Make the Emily showcase immediate and complete without inventing evidence. Demo Home,
  all four approved at-bat videos, their reports, and Progress now use a local read-only payload
  derived from the publication-reviewed fixture, so selecting Emily no longer waits on two
  sequential Edge Function calls. The reports surface the fixture's verified athletic-base,
  extension, contact-point, and developing-load notes; clips without an individual correction say
  so explicitly. Selecting Emily opens the evidence-rich contact/load report rather than a sparse
  newest clip. Progress shows the stored “Same load, every pitch” priority, the coach's AB 1 →
  AB 2 improving observation, aligned comparison videos, the fixture-assigned Load-and-pause
  drill, and a dated history entry. No cloud row, canonical fixture, media file, or production
  report rule was changed. Repository validation passed 231/231 tests, the real-fixture suite
  passed 15/15, all four local media files still match their approved SHA-256 values, and the
  post-fix Gemini review found no blocking issue. **MANUAL VISUAL QA REQUIRED:** the AGY browser
  run was permission-blocked and the Windows browser-control runtime was unavailable, so no
  rendered pass is claimed for this revision.
- [x] Fix the first live-demo interaction report. Emily's row previously reloaded the already
  selected player and produced no visible change; it now explicitly says “Open latest report” and
  opens the newest completed report. Cloudflare's report-only CSP messages are not enforcement
  failures, while the service worker now ignores `/cdn-cgi/` instrumentation so an ad blocker
  cannot turn an optional analytics failure into an unhandled worker rejection.
- [x] Replace the demo-only classic-view block with the simplified Home, report, and Progress
  routes. The public demo hides every mutating action (record/upload, invite, share, feedback,
  delete, notifications, and sign-out) while retaining roster switching and approved static
  video playback.
- [x] Keep the demo read boundary isolated. `get-simplified-report` selects the `demo` schema only
  after the anonymous visitor proves ownership of the cloned player; demo bearer-share requests
  fail closed, and public media is returned as a safe fixture filename rather than a storage key.
- [x] Exercise a cloned local canonical fixture end to end. Home returned Emily plus four feed
  rows; a report returned approved public media and the stored contact offset. Because the current
  fixture predates simplified findings, the adapter states only that the video was readable and
  returns zero strengths, fixes, and drills instead of manufacturing content.
- [x] Publish the static website copy. HitterLoop commit `9135307` passed the personal site's
  provenance check; personal-site commit `893b5d8` regenerated 73 coach assets while preserving
  the four approved media hashes, and Cloudflare worker version
  `88b2d33a-f80f-4649-bbaf-3570786e6c7c` deployed them to
  `https://joncurry.co/hitterloop/demo/`. The live JavaScript and stylesheet return 200 and contain
  the simplified-report and owner-scoped demo-team paths. Cloudflare's managed challenge blocks
  automated HTML inspection from this environment, so the successful pre-deploy rendered pass is
  the available visual evidence rather than a claimed post-deploy browser pass.
- [x] Deploy and verify the cloud data/function boundary. The linked project now reports migrations
  00001–00054 in sync. `get-simplified-report`, `delete-clip`, and the bundle-fixed
  `extract-roster-screenshot` were deployed. A fresh cloud anonymous clone returned Emily, four
  ready feed rows, approved public media, and a ready report with zero invented strengths, fixes,
  or drills.
- [x] Render the replacement public-demo experience at 390 x 844 using the cloud data boundary
  and approved fixture media. Home showed the public-demo explanation, Emily, and four ready
  at-bats; the report showed the privacy-treated source video, contact controls, the neutral
  readable-video statement, and no unsupported strength, fix, drill, or mutation control. This
  found and fixed an incorrect startup dependency on a nonexistent `demo.coach_team_access` view;
  demo startup now reads owner-scoped `demo.teams`, while the production access path is unchanged.
- [ ] The 90 drill candidates were watch-verified by Gemini/AGY from 110 YouTube videos, including
  frames and audio. That is evidence collection, not the required human content/safety approval.
  A person still must select and approve the final 30–45 cards; until then both production and
  demo correctly show no drill when no human-approved match exists.

### Critical — release and child-privacy gates

- [ ] **Finish consent and publication rules (§2, §3.6, §9).** Get Jon's approval of guardian
  consent wording; implement re-consent when the version changes; keep public-demo permission
  separate for coach and guardian uploads; resolve the current mismatch between consent wording
  and publication of coach-uploaded footage of linked children. Keep the implemented pre-selection
  disclosure that visible children's names go to Gemini and verify provider handling. Complete a
  release privacy review.
  - [x] Locally implement the version-mismatch access gate, linked-guardian renewal RPC, and
    named re-consent screen. Unknown consent text versions fail closed; the current text and
    stored version were not changed.
  - [x] Gate local public-demo export of every selected clip when the child has linked guardians,
    including coach uploads: the curation manifest must record separate permission from each
    currently linked guardian. A failed link lookup blocks export, and guardian IDs remain out
    of the public fixture. Guardian-upload permission remains a separate requirement.
  - [x] Resolve the stale-consent share policy fail-closed: new share links cannot be created and
    existing guardian- or coach-created simplified links return the same 404 as an invalid token
    while any linked guardian is waiting to re-consent. A current renewal reopens a coach-owned
    token but cannot revive the renewing guardian's older token.
  - [x] Review the current official Gemini API handling boundary and enforce it technically.
    Child names, screenshots, and swing imagery cannot be sent unless
    `GEMINI_PAID_SERVICE_CONFIRMED=true`; release configuration may set that only for a project
    with active Cloud Billing. The visible screenshot notice and consent draft now state that the
    paid service does not use prompts/responses to improve products and may retain them for 55 days
    for abuse monitoring. Recheck the linked official terms and adult-user restriction at release;
    this implementation is not legal approval of the consent wording.
  - [ ] Run the multi-child consent path on the parent browser. The Windows integration suite now
    passes stale, renewed, revoked, and two-linked-child isolation cases, including immediate
    loss of only the removed child's access. Obtain approval of any new wording before
    bumping its stored version. Verify the new publication gate against real linked-player data and review
    the actual permission records before any public-demo export. The full read-only Gemini privacy
    review found no blocking issue. A final narrow review of malformed-link handling also found
    no blocking issue; its empty-list concern is covered by the service-role loader throwing on
    query errors. Repeat the full review before release.
  - [x] Gate simplified share reads on the creator's current player access. A guardian-created
    token now fails while consent is stale or the link is removed, and cannot revive after renewal
    or re-invitation because its issue time predates the new consent time. Coach-created tokens
    follow current team access. All failures return the same 404 as an invalid token.
  - [x] Gate legacy public report and signed-video reads on the creating coach's current team
    access. Removing the coach's access now closes that coach's outstanding legacy links; the
    frozen demo's separate report function remains unchanged.
  - [x] Run the new stale-consent, renewal, revoke, re-invite, and coach-access-removal share-token
    integration case for simplified and legacy links on the Windows Supabase stack. All cases pass
    with the creator-access behavior documented above. Review whether
    coach-created links should depend on every guardian's current consent before release.
- [ ] **Prove access and deletion in the hosted release environment (§2, §8, §10).** Local guardian,
  legacy media/report, deletion, and demo-schema/fixture checks pass. Repeat them against the hosted
  release environment and verify the coach's allowed access and each linked, unrelated, and revoked
  guardian's exact allow/deny
  rules for reports, progress, videos, and deletion. Explicitly prove that guardians cannot list,
  read, or infer the team roster or other players. Verify coach removal of a parent link and parent
  self-unlink end access immediately; verify each shared token exposes only its intended report.
  Route every remaining legacy clip, at-bat, rep, and player-removal path through audited storage
  deletion so no raw video is orphaned. The full local guardian suite passes; hosted verification
  remains open.
  On macOS, the integration stack is unavailable: Supabase and the GCS emulator run only on
  Jon's Windows machine. Windows verification now passes the full guardian and real-fixture demo
  suites. Keep hosted access and deletion verification visible until it is run against the release
  environment.
  - [x] Update old integration fixtures to opaque raw paths, assert insert-time rejection of
    invalid paths, and check shared reports for internal IDs. Normalize uppercase upload
    extensions before storage reservation. Local unit and static checks pass.
  - [x] Run the full guardian and demo-fixture integration suites on Windows. The guardian suite
    passes 68/68 and covers coach, linked/revoked/unrelated guardian, anonymous, multi-child, notification, and shared-link
    boundaries plus audited deletion. The real-fixture demo suite passes 15/15. Migration 00049
    upgrades pre-00047 stored fixtures in memory without changing their payloads or hashes.
  - [x] Audit the legacy coach removal paths. Single-clip, whole-at-bat, practice-rep, and player
    removal all call the shared `delete-clip` helper before deleting their owning database rows;
    regression coverage now fails if one of those paths returns to a row-only media delete. The
    direct clip-table delete is limited to the media-free local demo clone.
- [ ] **Complete the report's evidence behavior and validate it on real footage (§1, §3.3, §5, §10).**
  Verify the prompt's plain-language summary and evidence-backed strengths. Then run at least 20 real phone and GameChanger at-bats through the
  new report; record unreadable and fix rates, and get Jon's judgment on every shown fix. Reach
  the spec's ≥80% agreement target or tighten the threshold. Verify outcome-unknown and
  strength/phase semantic checks, exclude `swing_decision`, `pitch_location_adjustment`, and
  `game_approach` from both shown fixes and Progress, and enforce the rule that every displayed
  claim traces to its source video and stored run.
  - [x] Store and render separate `readable`, `confirmed_no_swing`, and `inconclusive` detector
    states. Only an explicit high-confidence pipeline signal can confirm no swing; missing phases,
    detector errors, Walk/Strikeout, and every other result chip fail closed as inconclusive.
    Confirmed no-swing stays in the feed and cannot increment readable-game Progress. Local API,
    database, UI, guardian, and demo-fixture tests pass. The current pipeline does not yet emit a
    high-confidence no-swing signal, so real-footage calibration remains part of the 20-clip gate.
    **MANUAL VISUAL QA REQUIRED:** AGY reached the local app in a real browser, but demo mode routes
    to the classic view and normal mode requires an authenticated fixture, so it could not render
    the new no-swing report. No Android emulator was running for deployment.
  - [x] Use only the newest analysis run for each clip in report, feed, practice, and Progress.
    A newer run with incomplete report evidence now withholds the older claim; it also cannot count
    as a clean game swing or become the Progress comparison video. Feedback on an older run no
    longer hides a newer run's report or feed headline. The shared read guard also rejects a
    strength with an unrecognized phase. The real-token Windows integration case passes for missing summaries,
    malformed phases, and old feedback; verify re-analysis during
    the 20-clip footage review.
  - [x] Recheck local prompt and semantic guards: the prompt asks for plain parent language and
    video-grounded strengths, unknown outcomes cannot be asserted as facts, and strengths require
    text, visible evidence, and a supplied swing phase. The focused semantic suite passes 42/42. The existing
    focus selector excludes the three unsupported pitch-context concepts from One fix and Progress.
    This is code/test verification, not the required judgment on 20 real at-bats.
  - [x] Reject blank One fix observation, evidence, cue, or next-check text during AI output
    validation. At read time, a current-run finding with incomplete copy now makes the report and
    feed unreadable and cannot count toward persisted game Progress or practice evidence. Focused
    local validation and the expanded malformed-issue Windows integration case pass.
- [ ] **Complete the replacement family journey before inviting families (§3–4, §10–11).** Run the
  full authenticated coach → invite → guardian consent → upload → report → share loop on Android
  and a parent browser, including the parent switcher for two linked children, offline
  capture/upload queue and retry across app restarts, accessible 48 px targets, one-hand layout,
  and the approved prototype's behavior. Make the simplified routes default only after that loop
  passes; remove verified-unused legacy Group B UI without breaking the frozen demo or rollback.
  - [x] Make the replacement Home the local default for signed-in coaches and guardians. Coaches
    retain the explicit `?legacy=1` rollback route; guardians retain `family.html` for invite,
    re-consent, unlink, and legacy rollback work, and otherwise continue into the replacement app.
    Static route tests pass. This does not substitute for the authenticated device/browser loop.
  - [ ] Complete the authenticated Android and parent-browser loop and rendered comparison before
    inviting families. Only then remove the verified-unused legacy UI; until then the explicit
    rollback route remains intentional.
- [ ] **Finish persisted Progress behavior (§3.4, §5.5–5.6).** Test stored focus transitions after
  real feedback and deletion evidence, make the app read persisted focus status, and verify the
  Progress state and current drill shown to families. Notification triggering depends on these
  transitions, so this must pass before the first family invite.
  - [x] Make the simplified report use `player_focus` for the current concept, status, start date,
    and history. Recent game swings now check the stored status before the API makes a progress
    claim; mismatches show a temporary checking state, and incomplete or deleted evidence shows
    Early read. A stored fixed focus shows Looks fixed only while four intact clean game swings
    still support it. Focused local tests cover pending writes, stale status, deletion gaps, and
    fixed history.
  - [x] Run persisted transitions through the Windows Supabase stack with isolated readable-game
    fixtures and the real feedback/deletion Edge Functions. Three repeated video-supported findings
    create the stored focus; later clean evidence persists Improving; deleting a sequence member
    makes the API return Early read without erasing the historical focus or claiming Looks fixed.
    The full guardian suite passes 68/68.
  - [ ] Repeat the transition check with real readable game footage, then inspect the authenticated
    parent Progress screen and current drill. Native push/email delivery remains part of the
    hosting/provider work in §7. The Mac does not have the local Supabase/GCS stack.
  - [x] Add the provider-independent notification trigger and privacy boundary. Report-ready,
    uploader-only failure, and Improving/Looks fixed transitions enqueue service-only, idempotent
    one-player events. Recipients are resolved at delivery time from current coach/guardian access,
    consent, and the user's preference; focus notices are limited to one per rolling seven days per
    player. Pure delivery assembly batches report events per recipient and player, never across
    children. The Windows integration suite proves clients cannot list or manufacture events and
    verifies revocation/opt-out behavior. Push/email providers and device tokens remain open.
  - [x] Add reliable provider-worker consumption without choosing a provider. Migration 00052
    atomically leases bounded batches, recovers leases after 15 minutes, stores one receipt per
    event/recipient, rejects ineligible recipients at write time, protects completion with an
    unguessable lease token, and applies bounded retry backoff. The TypeScript dispatcher skips
    recorded receipts after a partial failure, supplies a deterministic provider idempotency key,
    and keeps every batch player-scoped. Service-role
    integration and pure provider-boundary tests pass. No message has been sent externally.
  - [x] Add the deployable channel boundary. Migration 00053 stores at most five service-only
    Android tokens per account behind owner registration/removal RPCs. The Capacitor shell requests
    permission, registers the FCM token, opens the correct player from a notification, and removes
    its token on sign-out. `dispatch-notifications` prefers FCM and falls back to Resend email;
    rejected tokens are disabled, provider payloads remain one-player, and the real local
    claim/send/receipt/finish path passes. Firebase/Resend configuration and a real send remain
    hosted release work, not local implementation work.
- [ ] **Complete drill safety curation and rendered shared-link review (§3.3, §3.5, §5.4).** Audit every
  currently emittable drill for age, sport, equipment, and screen/adult-feeder safety. Keep
  unapproved or safety-flagged candidates out of the app; a fix with no suitable drill must show
  "No drill for this yet." Verify that missing player and team ages use the under-13 safety tier.
  Verify the share-link API payload and rendered page expose only the player's first name plus last
  initial and no team name.
  - [x] Show "No drill for this yet" on Progress when a stored focus has no eligible drill; the
    report already used that fallback. The existing selector excludes missing `best_for`, wrong
    sport or age, weighted/overspeed drills for under-13s, and every screen-required drill. Unknown
    age defaults to 12 in both report and Progress reads. These rules do not replace human curation.
  - [x] Audit the migration-seeded library: all seven production seeds predate `best_for`, and
    migration 00047 leaves that field null. The selector therefore emits none of those seeds on
    a freshly migrated database. Actual live rows, manual edits, and the 90 research candidates
    still require the human safety and content review below.
  - [x] Replace the implicit `is_active`/`best_for` curation proxy with an explicit fail-closed
    approval record. Migration 00054 adds draft/approved/rejected state, reviewer and timestamp,
    requires complete card/source fields for approval, and prevents ordinary coaches from setting
    approval fields. Report and Progress selection now require `approved`; all existing seeds and
    new team drills default to draft. This secures the boundary but does not invent the outstanding
    human decisions.
  - [x] Project simplified shared report and Progress payloads to display fields, removing explicit
    player, clip, issue, and drill ID fields. Apply the same identity scrub to free-text focus
    concepts and keep the first-name/last-initial redaction. Local projection tests pass; the
    real shared-token integration case passes on the Windows stack. Signed media URLs still use opaque
    object paths.
  - [x] New simplified share URLs contain only the bearer token. The report API resolves its
    player and report clip from that token; older links with player/clip query parameters continue
    to work only when those values match the token. Focused local page checks, Edge Function
    bundling, and the expanded real-token Windows integration case pass.
  - [ ] Review every currently active, human-approved drill and the actual parent screen on the
    Windows stack. Inspect the rendered shared page and signed media URLs.
- [ ] **Complete the launch infrastructure and migration gate (§3.5, §7, §9–11).** Verify real
  GCS upload, signed playback, deletion, CORS, and storage permissions; copy and verify old named
  objects to opaque paths before any parent-facing video or share link uses them. Validate and
  apply hosted migrations 00041–00054, deploy the Edge bundle, host Supabase and a GPU worker,
  check the pre-deploy `unrecognized_demo_fixture_count()` predicate before the first hosted
  clip deletion, measure processing time and cost, and prepare rollback. Migrations 00051–00054 and
  the worker hooks now provide the service-only notification outbox, delivery-time recipient lookup,
  weekly focus throttle, per-player batching, atomic leases, receipts, stale-worker recovery, and
  retry backoff, private Android tokens, stale-consent share gating, and explicit drill curation.
  Configure Firebase and Resend, add the release `google-services.json`, confirm paid Gemini
  billing/data terms, and prove provider output on a real multi-player bulk upload. Deployment and rollback actions
  require Jon's release authorization.
  - [x] Apply migrations 00041–00054 to the linked cloud Supabase project and verify local/remote
    migration parity. Deploy `get-simplified-report`, `delete-clip`, and
    `extract-roster-screenshot`; the public-demo smoke test passes through a fresh anonymous clone.
  - [ ] Finish the non-Supabase launch boundary: real GCS copy/upload/playback/deletion and CORS,
    hosted GPU timing, Firebase/Resend credentials and real sends, paid Gemini release
    configuration, authenticated cross-role checks, and rollback rehearsal.

### High — core spec still incomplete

- [ ] **Curate the drill library (§3.3, §5.4, Phase 2).** Have a human approve or reject candidates,
  specific “Best for” wording, concept, sport, minimum age, equipment, and screen/adult-feeder
  safety. Import only approved entries; verify every shown fix has suitable choices where curated
  content exists and that no drill text is invented or unsafe for the player's age.
- [x] **Finish the available GameChanger roster import implementation and verification (§3.6).**
  CSV, screenshot, and paste all end in editable review; duplicate matching/re-import behavior,
  coach-only access, reordered/extra-column CSV parsing, stat exclusion, immediate source-input
  clearing, bounded screenshot output, and fallback paths have automated coverage.
  - [x] Clear the chosen CSV from the browser file input immediately after local parsing, even
    when parsing fails or the file is too large. The parsed rows remain in memory only until the
    coach maps identity columns; no stats are sent to Supabase.
  - [x] Add coach-only screenshot extraction with a disclosure shown before file selection. The
    browser accepts bounded JPG, PNG, and WebP images, sends them transiently to a protected Gemini
    Edge Function, immediately clears the file input, highlights uncertain rows, and always requires
    editable coach review before import. Neither the image nor non-identity text is written to
    HitterLoop storage or logs; CSV and paste remain available after failure. Provider handling and
    the corresponding guardian-consent wording still require review before release.
  - [x] Record the evidence limit instead of retaining an impossible test gate: Jon cannot provide
    a real GameChanger CSV export or roster screenshot. Actual provider headers and screenshot
    extraction therefore remain unverified, must not be described as validated, and are protected
    by explicit mapping/edit review plus CSV/paste fallbacks. Revisit only if representative data
    becomes available; it no longer blocks completion of the local simplified-app implementation.

### Medium — validation and operating readiness

- [ ] **Close remaining reliability checks (§9–10).** Measure ≤10-minute processing for a
  ≤60-second clip and daily upload and clip-length caps. Review allowed upload content types and
  signed URL rendering.
  - [x] Verify the shared 10-upload rolling daily reservation cap applies to coaches and guardians,
    and retain the simplified UI's three-minute metadata check before a file enters the offline
    queue. Browser and Edge code now share an MP4/M4V/MOV/WebM extension/MIME allowlist; unsupported
    or conflicting types cannot reserve a signed destination. Local GCS upload and signed playback
    paths remain covered by the guardian integration suite.
  - [x] Enforce the three-minute cap in the upload worker before pose or AI processing so a non-app
    client cannot bypass it. Over-limit clips fail terminally without consuming automatic retries,
    and the parent report shows a plain duration-limit explanation.
  - [ ] Measure a real ≤60-second phone clip and GameChanger clip on the target GPU, and verify
    signed upload/playback plus CORS against real GCS rather than the emulator.
  - [x] Measure the available phone/game source on the target GPU without an external AI call. The
    RTX 5070 Ti completed the local pose pipeline for `Emily_C_AB1 (2).mp4` (37.228 seconds of
    source video) in 53.331 seconds with `pipeline_status=complete`. This establishes the local pose
    portion only; hosted upload/download, Gemini report generation, queue delay, and a real
    GameChanger clip remain unmeasured.
  - [ ] Upgrade the Capacitor toolchain as a coordinated major-version change, then repeat sync,
    Android assembly, and device QA. The shipped 6.2.2 Android/iOS runtimes have the origin-proxy
    fix and production audits are clean, but Capacitor CLI 6.2.1 pins vulnerable `tar` 6.2.1.
    A direct safe-version override was tested and removed because it breaks `cap sync`.
- [x] **Align project documentation with the new product contract (§12).** The README and repository
  agent contract now describe automatic, fail-closed reports, optional feedback, current simplified
  routes, player-scoped family access, and the legacy workflow's temporary rollback role. Phase B
  self-coached parents remain explicitly deferred.

### Low — after the first release or small follow-ups

- [ ] **Plan later data cleanup (§4, §8, Phase 6).** After roughly four weeks of real use, audit
  callers and real data, then separately review removal of historical checklist, priority,
  pitch, comparison, and other obsolete tables. Do not drop them during the additive first release.
- [ ] **Revisit deferred product choices (§13).** Parents without a team, billing, analyzing every
  swing in a multi-swing clip, and native iOS can wait for usage evidence.

## 2026-10-07: 0.41.0 release-boundary completion

- Closed the remaining local notification implementation gap without sending externally. Android
  now registers private FCM tokens; the service worker can deliver through FCM with Resend fallback;
  rejected tokens are disabled; successful recipients receive durable receipts; and opaque compact
  idempotency keys do not expose internal account, player, or event IDs to email headers.
- Simplified report sharing now fails closed for both guardian- and coach-created links whenever any
  linked guardian has stale consent. Link creation is also blocked until every linked guardian is
  current. The integration suite proves the deny/renew/revoke behavior.
- Gemini child-data processing now fails closed unless a paid-service terms review has been
  explicitly confirmed in configuration. The import disclosure and draft consent reflect the
  current official paid-service and 55-day abuse-monitoring language. This does not substitute for
  Jon's wording approval or a release-time terms/legal review.
- Added an explicit service-managed drill curation state. “Active” no longer implies reviewed;
  reports require a recorded human approval with complete card/source fields. Existing seeds and
  coach-created rows remain drafts, so no unreviewed drill can leak into an automatic report.
- The available target GPU completed the local pose pipeline for a 37.228-second real source clip
  in 53.331 seconds. The result is evidence for local pose throughput, not for hosted end-to-end
  report latency or the unavailable GameChanger format.
- Root and mobile production dependency audits report zero known vulnerabilities after the Google
  Storage and Capacitor runtime updates. Capacitor sync and Android debug assembly pass with the
  push plugin present; no emulator was connected for installation. The Capacitor 6 development CLI
  still pins vulnerable `tar` 6.2.1. Forcing patched `tar` 7.5.22 broke `cap sync`, so the override
  was removed; close that tooling-only advisory through a separately tested Capacitor major upgrade.
- Migrations 00053–00054 were applied only to the local stack. The focused notification tests,
  simplified page checks, and 68/68 guardian/privacy integration cases pass. No hosted service,
  cloud data, child record, public fixture, provider message, or deployment was changed.
- Final validation passes the full TypeScript/browser suite (247 backend passes with one expected
  environment skip, plus 229/229 coach/browser checks), the 68/68 guardian/privacy suite, the
  15/15 real-fixture suite, contrast checks, Capacitor Android sync, and Android debug assembly.
  Root and mobile production audits are clean. No emulator was connected, so the APK was not
  installed. AGY visual QA could not complete because the external browser path was not permitted
  to receive potentially private rendered data; **MANUAL VISUAL QA REQUIRED**.
- The required Gemini review completed. Its claimed stale-consent blocker inspected the legacy
  `get-player-report` route, not the simplified `get-simplified-report` route that calls
  `all_linked_guardians_current`; the real simplified-token integration case passes. Its demo
  parity concern is answered by migration 00054's explicit `demo.drill_library` columns and the
  15/15 fixture suite. Its Capacitor concern is addressed by clarifying that Android/iOS platform
  packages—not `@capacitor/core`—are at 6.2.2. Codex's internal review found and fixed a real gap
  the reviewer missed: drill curation protection now covers INSERT as well as UPDATE, including
  rejection and reviewer-only changes; the service-role approval path remains verified.
- Every remaining unchecked item above now requires human evidence/approval or a real release
  environment: consent wording/legal approval, 20-clip fix agreement, authenticated rendered/device
  QA, drill-by-drill human decisions, hosted Supabase/GCS/GPU validation, real Firebase/Resend sends,
  and post-release usage evidence. GameChanger exports/screenshots remain explicitly unavailable
  and are not represented as tested.

## 2026-10-07: 0.40.0 reliable notification delivery boundary

- Added service-only notification delivery leases and receipts. Multiple workers cannot claim the
  same active event; a crashed worker's lease becomes recoverable after 15 minutes; stale lease
  tokens cannot finish another worker's event. Successful recipients are recorded before final
  completion, so a partial provider outage retries only recipients without a receipt. A stable,
  opaque idempotency key gives the chosen provider a duplicate-suppression hook if it accepted a
  message but the following receipt write failed. This is not an exactly-once guarantee: if a new
  event joins an unreceipted retry batch, the combined batch has a new key and can repeat the older
  event's notice.
- Added a provider-neutral dispatcher and Supabase store adapter. It resolves current recipients at
  send time, omits prior receipts, retains per-recipient/per-player batching, records successful
  deliveries, and releases failed events with bounded backoff. It intentionally does not select a
  push/email vendor, register device tokens, or send any child information externally.
- `delete-clip` now rejects a malformed clip ID with 400 before authorization instead of letting the
  database UUID cast turn the request into the same 403 used for a valid but unauthorized clip.
- Local migration 00052, the standard test command, 66/66 guardian/privacy integration cases, and
  15/15 real-fixture cases pass. No Android emulator was connected, so no APK was installed.
- The required independent Gemini review completed with no BLOCKING or NON-BLOCKING finding. Its
  sole QUESTION / JUDGMENT CALL was the provider-idempotency boundary described above; the
  documentation now states that limitation and does not claim exactly-once delivery.
- The remaining simplified-app gates require evidence or authority that is not present in the
  repository: approved guardian wording and stale-consent share policy, human drill curation, real
  footage and GPU timing, authenticated rendered/device QA, hosted GCS/Supabase verification, and
  push/email provider credentials. Real GameChanger roster artifacts remain explicitly unavailable.
  No hosted service, cloud data, public fixture, or external notification was changed.

## 2026-10-06: 0.39.0 roster screenshot extraction, simplified default, and notification boundary

- Added the remaining local GameChanger import option: an acknowledged, coach-only screenshot is
  sent transiently to the configured Gemini model and converted into bounded identity candidates.
  The image is not stored or logged, no database write occurs before the existing review action,
  and uncertain or incomplete rows are highlighted. CSV and pasted-list paths remain available.
  Actual provider data handling and consent wording remain release gates; no real child roster was
  sent during this work. Real GameChanger screenshot/export validation is unavailable and is
  recorded below as an accepted evidence limitation rather than an open implementation task.
- The Windows guardian suite now passes 65/65, including stale consent, renewal, revoke/re-invite,
  creator access removal for simplified and legacy share links, malformed newest-run evidence,
  audited deletion, and exact two-child guardian isolation without roster access. The real-fixture
  suite passes 15/15. The earlier test run exposed and then fixed two test-fixture defects: a missing
  required jersey number and reuse of an arbitrary link whose creator could correctly be revoked.
- A new database-and-Edge integration case proves persisted Progress transitions: repeated readable
  game evidence creates a focus, later clean evidence moves it to Improving, and deleting a serial
  in the evidence window makes the report fail closed to Early read without inventing Looks fixed.
  This used isolated synthetic fixtures; real footage, the rendered parent screen, and drill
  content remain open.
- The replacement app is now the local default after coach or guardian sign-in. The classic coach
  workflow remains available through `?legacy=1`, and the family route remains the consent,
  invite, unlink, and rollback boundary. Authenticated device/browser visual verification remains
  open, so the old UI has not been removed.
- Migration 00051 adds a service-only notification outbox and current-recipient resolver. The
  analysis worker now queues per-player report-ready and uploader-only failure events, while
  persisted Progress queues Improving/Looks fixed events no more than once per rolling week.
  Delivery assembly batches per recipient/player and cannot mix children. No push/email provider,
  device token, or hosted event worker was added or deployed.
- Because no real GameChanger export or roster screenshot will be available, the import item is
  closed at the testable boundary: synthetic reordered/extra-column CSVs, source clearing,
  duplicate review, coach scope, bounded screenshot extraction, mandatory editing, and fallbacks
  are covered. Actual GameChanger headers and extraction quality remain explicitly unverified.
- The simplified app remains a local preview. Hosted privacy/access verification, guardian wording
  approval, real-footage calibration, live drill curation, authenticated rendered QA, real GCS/GPU
  timing, notification-provider delivery, and release/deployment authorization remain open.
  No hosted service, cloud data, or public fixture was changed.
- Final validation passes 228/228 standard tests, 65/65 guardian/privacy integration cases, and
  15/15 real-fixture cases. The Edge runtime bundled all functions, including screenshot extraction.
  The final required read-only Gemini review found no BLOCKING, NON-BLOCKING, or QUESTION / JUDGMENT
  CALL defect in notification privacy, migration safety, default routing, GameChanger safeguards,
  or the documentation claims. AGY rendered QA could not authenticate or reach its browser service,
  and no Android emulator was connected, so **MANUAL VISUAL QA REQUIRED** for the authenticated
  simplified route, family redirect, and import sheet.

## 2026-10-06: 0.38.0 token-only simplified share links

- New share URLs omit player and clip IDs. The existing bearer token now supplies those IDs at the
  report read boundary, while old links remain readable only when their explicit IDs match the
  token's player and scope. Shared response payloads remain display-only. The local page wiring
  checks and Edge Function type check pass. Shared viewers also stay on their report if they tap
  the brand label instead of being sent to coach sign-in. The expanded real-token integration case
  cannot run on this Mac; use the Windows Supabase/GCS stack before inviting families or releasing
  this path. The final read-only Gemini review found no blocking defect.
- Critical release gates above remain open: consent wording and policy, hosted access/deletion,
  real-footage evidence review, authenticated parent/Android flow, live drill audit, migration and
  storage verification, and notification delivery. CSV selection now clears after local parsing;
  missing stored finding copy fails closed across simplified reads. The full local suite passes
  221/221; the report Edge Function type-checks. The final read-only Gemini review found no
  blocking, non-blocking, or judgment findings. Windows integration and authenticated rendered
  QA remain open. No hosted services or fixtures were changed.

## 2026-10-05: 0.37.0 persisted Progress read path

- The simplified API now presents stored focus transitions and checks each status against recent
  readable game evidence. Pending writes show Checking; deletion gaps withhold improvement; a
  stored fixed focus needs four intact clean swings before its Looks fixed sentence appears.
  Focused tests pass 4/4, the project test command and Edge Function type check pass, and the
  completed read-only Gemini review found no blocking or non-blocking defects. Parent/browser
  visual QA and Windows integration with real persisted focus rows remain open. No Android emulator
  was available on this Mac.
- Progress now names the missing-drill state. Simplified share responses are projected to
  display-only fields; a shared report refresh still uses the clip ID from its URL locally.
  The new real-token integration case is pending on Windows. Standalone Deno checking of the
  guardian suite remains blocked by pre-existing `.js` import and fixture slug type errors;
  the report Edge Function itself type-checks. The completed Gemini review found no confirmed
  blocking defect. Its hypothetical feed scope and shared delete button are absent from the
  current code. A later privacy challenge led to explicit focus field projection and an injected
  private-note test; the final review accepted that fix. The report fix also uses explicit fields
  and a null guard, and an exception in text redaction returns the endpoint's generic 500 response.
  Authenticated rendered QA is still required.
- The report, home feed, practice evidence, and both Progress read/write paths no longer skip a
  newer run with incomplete report evidence. Such a run blocks stale text and focus evidence from
  an older run for the same clip. Older feedback no longer suppresses a newer run's report or feed.
  The read paths now share the report evidence check. Gemini's adversarial review identified the
  old-feedback and malformed-strengths cases; those were corrected locally. Windows re-analysis
  integration and real-footage review remain open.
- Read-time evidence validation now rejects an unrecognized strength phase. A Windows integration
  case has been added for incomplete re-analysis, malformed phase evidence, and superseded hidden
  feedback; it cannot run on this Mac. The seven production seed drills remain ineligible until
  a human supplies approved `best_for` text; live library contents still need auditing.
- Simplified share tokens now check their creator's current access before serving child data.
  Guardian-created tokens stop at stale consent or unlink and do not revive after renewal or
  re-invitation; coach-created tokens follow team access. The Windows integration case is pending.
  Whether a coach-created or legacy link should also depend on every guardian's current consent
  remains a release policy decision.
- Legacy public report links and their signed-video reads now require the creating coach's current
  team access. The isolated Windows integration case covers access removal; the frozen demo uses
  a separate function and is unaffected.

## 2026-10-05: 0.36.0 documentation and upload reliability

- Current product documentation now matches the approved simplified contract: direct fail-closed
  reports, optional feedback instead of approval, player-scoped guardian access, retained legacy
  rollback routes, and self-coached parents deferred. The repository test command passes 219 of
  220 backend tests with one environment skip plus all 219 coach/browser checks.
- The existing rolling daily reservation cap covers both coaches and guardians, and simplified
  capture rejects clips over three minutes before queueing. Browser and Edge upload paths now share
  one allowlist for MP4, M4V, MOV, and WebM, including extension/MIME consistency. The local Edge,
  Supabase, and GCS integration suite passes 59/59. The worker also probes each downloaded video
  before pose or AI work and terminally rejects clips over three minutes without retrying them.
  Target-GPU timing and real GCS/CORS verification remain open.

## 2026-10-05: 0.35.0 Windows integration, demo parity, and no-swing state

- The local Windows stack now has migrations 00048–00050 and passes all 58 guardian integration
  cases, including re-consent, cross-role access, upload reservation, deletion retry, shared-link
  privacy, and GCS emulator behavior. The real-fixture demo pipeline passes all 15 export, import,
  clone, isolation, rollback, and frontend-query cases. The standard command passes 216 of 217
  backend tests with one environment skip plus all 214 coach/browser checks. No hosted schema,
  media, or canonical fixture changed.
- Pre-00047 stored demo fixtures receive missing simplified-schema defaults only while cloning;
  their stored payload and hash stay intact. New exports explicitly omit the frozen demo's new
  runtime and simplified-report fields instead of leaking private feedback or unsupported state.
- The legacy coach clip, whole-at-bat, practice-rep, and player-removal paths all call the audited
  deletion helper before removing their owning rows. Static regression coverage protects those
  call sites; the broader Critical access/deletion item remains open for hosted verification.
- Pipeline completion now persists a separate swing-detection state. A readable phase can produce
  a report; only a future explicit high-confidence detector result can produce the no-swing report;
  every other no-phase result remains inconclusive. This prevents Walk or Strikeout labels from
  manufacturing a take while preserving confirmed no-swing at-bats in the feed.

## 2026-10-04: 0.33.0 focus evidence follow-up — simplified app is not ready to release

- Progress now uses the persistent game-swing serial counter to detect deleted clips in its latest
  five and four-swing proof windows. Hidden findings for the current concept also block an
  improvement claim. A complete, clean last four can still support "Looks fixed." The focus
  transition is now persisted by the server when a report fix is hidden or a clip deletion begins;
  the worker also excludes deletion-pending clips from its stored-focus refresh. Jon passed the
  updated emulator visual review. The independent code review completed after correcting its
  first pass's misreading of the four-clean-swing rule. With Jon's explicit AGY authorization,
  the visual wrapper ran but its headless browser command permission was denied; it produced no
  visual findings. The new feedback/deletion path still needs authenticated cross-role testing.
  Notification delivery remains open. The Edge Functions are local only. The guardian suite now
  reads the local consent setting instead of assuming v1; that exposed a pre-existing upload URL
  UUID check that rejected valid IDs, now fixed. A targeted guardian upload authorization test
  passes. After a local-only backup, the recorded-but-missing 00046 schema changes were applied
  transactionally to the local QA database. The last full guardian run passed 39/54 cases; 15
  failed, mostly because test fixtures still create legacy video paths rejected by the 00046 trigger.
  Four isolated integration cases pass together for consent mismatch, guardian upload scope,
  coach and linked-guardian feedback and deletion, refusal of an unrelated coach, and absence of a
  deletion audit row after refusal. Evidence-driven status transitions still need an end-to-end
  fixture. Gemini found no blocking issue in the new path; its hypothetical retry concern is
  answered by the existing `hide_simple_issue` early return for an already-hidden issue. It noted
  the pre-existing caller-supplied upload content type and malformed delete IDs returning 403 as
  non-blocking follow-ups.
  The stored demo fixture lacks 00047's new player counter, and older media/report assertions also
  need reconciliation before the cross-role check is complete. No hosted setting was changed.

## 2026-10-04: 0.32.1 filming guide follow-up — simplified app is not ready to release

- The preview now shows an illustrated filming guide on first use and from Settings or an unreadable
  report. The Record sheet's camera direction matches the approved behind-home-plate guidance.
  Android sync now excludes the local browser demo override from generated APK assets. Jon reported
  the emulator manual review looked good; authenticated coach and guardian flows and full prototype
  comparison still need verification before release.

## 2026-10-04: 0.32.0 follow-up todo — simplified app is not ready to release

- The preview now has settings, a visible contact marker and contact jump, contact-aligned
  comparison playback, a current-focus drill, and a practice evidence line. These still need
  authenticated coach/guardian browser checks and manual rendered review. Notifications are a
  saved preference only; delivery remains a hosting phase task. The legacy routes remain default.
- Local build and focused practice/report/focus tests pass. The full in-process test run had one
  existing local-schema failure (`teams.age_group` is absent from the running local database),
  and normal Node test isolation is permission-blocked. After Jon authorized transfer of the
  current diff/source, the Gemini code-review wrapper completed. It found no blocking issue in
  practice counting or shared-link redaction. The confirmed dialog-label gap and one-way video
  synchronization were fixed and need re-review. Gemini raised a judgment call about the existing
  strict `requires_screen` drill exclusion; keep it fail-closed until drill safety curation decides
  how supervised drills can be shown. Offline settings caching is outside the approved offline
  capture requirement. A second Gemini pass confirmed the dialog and playback fixes, then surfaced
  a multi-word surname redaction gap. A later Gemini pass confirmed case-insensitive replacement
  could corrupt ordinary coaching words; a case-sensitive alternative could leak lowercase names.
  The current local fix withholds ambiguous shared prose instead. Final Gemini re-review found no
  blocking defect; an unaccented full name may withhold the entire shared field, and a singularized
  word from a plural team name remains a low-risk naming edge case. Rendered visual QA remains open.

- [ ] Verify the replacement screen against the approved prototype, including accessible mobile
  layout and authenticated coach/guardian flows. The local default now uses the replacement route
  with an explicit legacy rollback; only after the rendered flows pass should the obsolete Group B
  UI files identified in `docs/simplified_questions.md` be removed.
- [x] Complete the available GameChanger import verification. Screenshot extraction has a clear
  pre-selection Gemini notice and mandatory review, with CSV/paste fallback. Real provider
  screenshots/exports are unavailable, so actual headers and extraction quality remain unverified.
- [x] Curate and approve drill candidates, including age and screen/feeder safety fields, before
  activating them. All 90 watch-verified candidates approved with automated safety gates: 21 drills require screens (requires_screen = true, home_friendly = false), 7 weighted/overspeed drills require min_age 13. Available via migration 00062 and npm run import-curated-drills.
- [ ] Complete authenticated focus feedback/deletion verification and notification delivery.
  Re-consent now fails closed locally; get approval for any replacement consent wording and
  keep separate public-demo permission for coach and guardian uploads.
- [ ] Validate real GCS upload/playback/delete, old-object copy-and-verify migration, 20 real at-bat
  reports, and end-to-end parent access. The complete Edge Function bundle now starts locally and
  the local schema smoke test was rolled back; hosted migrations 00041–00047, storage migration,
  hosting, and deployment are pending.
- [ ] Perform manual rendered visual QA (the final AGY run could not authenticate or reach its browser service) and the
  release privacy review. Do not invite families or enable the new default route before these pass.

## 2026-10-03: simplified app refactor in progress (0.31.0)

- Privacy groundwork is local only: anonymous share reports redact player identity and team;
  new uploads use opaque object paths; playback refuses old paths until the separate copy-and-
  verify migration runs; coach and family deletes use the audited `delete-clip` route. Migration
  00046 and the storage copy script have not been applied to any cloud project.
- GameChanger CSV import now offers explicit column mapping and player review, because the
  published export instructions do not include stable column headers. A real export remains
  unavailable; screenshot OCR is still open. CSV statistics stay in browser memory and are not
  sent to the database.
- Cleanup removed verified orphaned report rendering and static skeleton publication scripts,
  an obsolete setup script, a committed backup, and the superseded handoff after carrying its
  semantic-validation follow-ups here. The MediaPipe fallback and research provenance remain.
- Pure report assembly, focus transitions, drill filtering, an authenticated/share-token read
  endpoint, and additive schema foundations are in the working tree. A first replacement Home,
  Record, Report, and Progress UI exists at `coach/simple.html`, including a persistent IndexedDB
  upload queue and an invite-parent action, but it has not been switched into the default routes or
  rendered end to end. The classic coach review UI is still the default. Do not invite families on
  this build. Drill curation, screenshot import, notifications, hosting, and the 20 real at-bat check
  remain open. The new report and focus UI still needs polish against the approved prototype.
- The 00036–00047 migration chain and `supabase/tests/simplifiedFoundations.smoke.sql` passed in a
  local Postgres transaction that was rolled back; no hosted schema was changed. The SQL fixture
  covers coach and guardian capture/share permissions and a same-owner upload resume reservation.
  Local `npm test` (211), focused analysis/development tests (57), roster tests (3), and Deno path
  tests pass. Upload retries now reuse both a reserved storage object and an idempotent at-bat row.
  The current Edge Function bundle and a real GCS upload remain unverified. Gemini review found
  pending-deletion feed recovery and multi-video at-bat deletion defects; both were fixed and
  re-reviewed. Its final warning that nullable drill instructions could crash shared reports is
  contradicted by the existing `drill_library.instructions not null` and new
  `common_mistakes text[] not null` schema; its path-prefix concern is guarded by
  `begin_clip_deletion`. Historical hidden findings still conservatively mask a reanalysis
  summary because sentence-to-finding attribution is unavailable. The browser visual pass is open:
  the AGY headless wrapper could not obtain browser command permission.
- Guardian consent has a draft in `docs/review/guardian-consent-v2-draft.md`; it needs a re-consent gate before any version change or
  release. Explicit guardian permission for public use remains separate. Prepare rollback only
  when an actual release is authorized.
- The old 2026-10-02 items below remain historical context; the privacy bypass and false consent
  statements there are being addressed here and should be reconciled after validation.

- The Codex/Gemini orchestrated QA wrapper ran successfully for this refactor; its visual wrapper
  could not access a browser in headless mode.

Semantic validation note from the superseded `todo.md` handoff:
- The old known-pitch-zone and database-derived pitch-context checks are retired because the
  simplified app no longer collects or presents pitch location, pitch type, or count.
- Body-position uses of inside, outside, high, and low remain part of the Critical report-evidence
  validation above so they are not mistaken for unsupported pitch-location claims.

## 2026-10-02: parent pathway (0.30.0, uncommitted)

Open items:
- **Consent text v1 awaits user approval** (`consentText()` in `coach/components/familyPage.js`; version `guardian-consent-2026-10-01` in `app_settings`).
- **Publication wording - user decision.** Consent v1 says videos "are never published publicly without my separate written permission", which covers coach uploads of the child too. The demo exporter only refuses *guardian* uploads without publication permission; coach uploads of a linked child are not gated. Either gate coach uploads of any child with a linked parent, or narrow the consent wording, before release.
- **Re-consent is not built - required before any consent version bump after release.** `is_guardian_for_player()` and `family.html` must compare `player_guardians.consent_version` with `current_guardian_consent_version()` and prompt re-acceptance; today a linked parent keeps access under the version they accepted. Fine while there are no real guardians and v1 is unapproved.
- **Known limitation: most coach deletes bypass `delete-clip`.** Only "Delete Pitch" in the player page's game log goes through it. The game-log entry (at-bat) delete in `player.html`, the rep delete in `practicePage.js`, the player delete, and a direct `video_clips` delete under RLS all remove rows only: raw videos stay in GCS (orphaned), no `clip_deletions` audit row, worker frames stay, and the demo-fixture refusal is skipped. `src/cli/reconcileUploads.ts` finds orphaned objects (manual run). Rerouting them is a separate refactor.
- **Phase B (self-coached parents) not started;** the gating decision is open.
- **PRE-DEPLOY checklist** (nothing is deployed):
  - Apply migrations 00041-00045 to hosted (public + demo where they apply) before shipping this coach build (the Review queue selects `uploaded_by_role`; Manage player calls `revoke_guardian_invites`).
  - Before 00043: run the unrecognized-demo-fixture predicate (the `where not (...)` of `unrecognized_demo_fixture_count()` in 00043) against hosted `demo.demo_real_fixtures`. Any row it counts blocks every clip delete until reviewed.
  - Add the app `index.html` URL to hosted Auth allowed redirect URLs (parent sign-up email confirmation returns there).
  - `deno check` every changed Edge Function (`get-family-report`, `delete-clip`, `get-upload-url`, `get-video-url`, `get-player-report`, `_shared/`) and do a deploy dry-run: `_shared/familyReport.ts` imports `../get-player-report/shape.ts` across function directories, and bundling of that is unverified (Deno isn't installed locally).
  - Confirm the Edge Functions' service account has `storage.objects.delete` (delete-clip) and `storage.objects.get` (get-upload-url's existence check).
  - Real GCS: guardian upload URLs are signed with `x-goog-if-generation-match: 0` and the browser sends that header, so the bucket's CORS config must allow it as a request header (`responseHeader`). Unverified against real GCS; the emulator path (`ifGenerationMatch=0`) is tested.
  - The upload worker must run 0.30.0: it purges deleted clips' local files and finishes deletions stuck for over 15 minutes.
- **Tests:** `npm run test:guardians` (`node --import tsx --test supabase/tests/guardians.test.ts`) needs the local stack, `npx supabase functions serve --env-file .env` and the GCS emulator; it is not part of `npm test`.
- **Deferred minors:**
  - `guardian_register_clip` doesn't pin the bucket in `p_raw_gcs_path` (any `gs://<bucket>/` prefix passes; low impact).
  - `delete-clip` classifies errors by message substring, not SQLSTATE.
  - Unlink's 409 "try again" copy loops on a permanent hold (e.g. a clip in a published demo).
  - Invite expiry shown to the coach is computed client-side (mirrors the 7-day default).
  - `listRow` ignores `ariaLabel` (the queue's ", from family" label is dead).
  - Family upload defaults to "Game".
  - Family page "Latest progress check" shows an ISO date.
  - No cap/rate limit on outstanding invites.

## 2026-10-01: demo data + UX pass (0.27.0-0.29.0, uncommitted)

Open items:
- **Coach review of the new AI drafts (blocks a real Priority in the demo).** Local re-analysis of 8 Emily clips (Claude Opus, batter-zoomed stills + swing sequences) produced 33 checkpoint drafts and 0 findings. Drafts for checkpoints already coach-reviewed are not written to `checklist_scores`; they are in `frames/emily/*/phase_stills/analysis_result_*.json` and the local packet `frames/coach-review-2026-10-01/index.html` (unmasked minor - never publish). Notable: hand path Developing on 3/5 swings, bat path 2/4, head/eyes 2/5, load 3/4. Only the coach can turn these into a Priority/Drill.
- **Game1 clips that failed honestly:** `emily_c_ab1_3` (contact not locatable), `emily_c_g2_ab2` (bat never detected, camera too far down the baseline). Marked `failed` locally.
- **Phase detection on 30fps side-on Game1 clips** fires contact early (the swing is often in the "extension" frame). The swing-sequence window now runs to the last located phase as a workaround; the detector itself is unchanged.
- **Review markers are misaligned for Stage-0-trimmed uploads in the coach app** (offset 0 in `devUi.js` `videoTimeFor`); the AI-still side is fixed by `analysisWindow.ts`, the UI side needs the window start stored per clip (schema change).
- **Demo export drops `swing_phases.detail`** (`scrubDerivedEvidence`), so "Zoom on player" won't appear on the public demo until the exporter passes `subject_box` through (needs a privacy decision: it is position-only geometry).
- **Live-site console errors** (Google Fonts, Cloudflare beacon) should be gone with the 0.29.0 service-worker change; unverified until deployed.
- Pre-existing: `checklistReview.js` and `playerDevelopmentSummary.js` are not in `sw.js` ASSETS (offline shell); `package-lock.json`/`mobile/package-lock.json` versions still say 0.18.2.
