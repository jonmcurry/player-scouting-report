# Changelog

## [0.26.1] - 2026-09-26

No fixture, schema or data changes. Public demo fixture stays `emily@2026-09-26.1`.

### Fixed

- At-bat summary said "0 swings, 0 takes. No swings in this at-bat have been analyzed yet" for every at-bat, because the page never loaded analysis state. "Analyzed" now comes from `analysis_runs`, and the summary only states what the data supports:
  - only a pitch recorded as a swing counts as an analyzed swing; video on a recorded take, a pitch with swing/take not recorded, or an unattached clip reads as "analyzed video";
  - unrecorded swing/take reads as not recorded, never as 0;
  - if the clip or analysis lookup fails, the analysis claim is withheld, Save summary is blocked, and pitch rows say "Video status unavailable" instead of "No video".
- Player history "Team Avg" showed 0.5 for a team with two verified 3s (null scores were averaged as 0), and counted unreviewed AI draft scores. It now averages coach-verified checklist scores only, per checkpoint and then across checkpoints, and shows "—" when there are none.

### Changed

- Verified checkpoints are listed in standard checklist order (Stance & setup before Load) in player summaries and reports.

### Security

- Removed the local-validation demo clips from `coach/media/` (byte-identical copies remain in `demo-export/`). `coach/` ships into native builds, so it is gitignored and a test now fails if any video file appears under `coach/`.
- The website demo sync (`personal/scripts/sync-hitterloop-demo.mjs`) now fails closed:
  - `--media` must be `demo-export/public-<date>/<fixtureId>`, `--fixture <id@version>` (the live fixture) is required, and changing the published media set also needs `--allow-media-change`;
  - local-only or unconsented exports, links in the media path or `media/` directory, and unapproved, superseded or hash-mismatched media are refused before anything is written, using the same approval rule as the exporter's privacy gate;
  - only `coach/` files committed to HitterLoop's git, with no uncommitted changes, ship, and their bytes are read from `HEAD`, not the working tree. `coach/media/` and symlinks are never copied, and any file that isn't html/js/css/json/svg/fbx (video included) fails the sync;
  - the new tree is staged and verified, then swapped in, with the previous tree restored on failure;
  - `--dry-run` runs the source checks without writing.

## [0.26.0] - 2026-09-24

### Changed

- The coach app and public demo lead with player development.
  - Player Overview shows What's working, then the current Priority, Next step, Development plan, Progress and swing evidence. At-bat logging is a secondary action.
  - Verified strengths use the checkpoint's own name with "On Target" and the coach's note.
- Review distinguishes an unanalyzed swing ("This swing has not been analyzed.") from an analyzed swing with nothing found ("No reviewed observation from this swing."). Player-level strengths are labelled as not being an independent check of the open clip.
- Detailed checklist:
  - Insufficient-evidence checkpoints hide the 1/2/3 controls until the coach chooses "Score manually anyway", which is labelled as a manual score.
  - Unscored checkpoints need a deliberate "Add a score".
- Development shows one development state instead of stacked empty sections. History, earlier Priorities and Insights appear only when real history exists.
- Practice can't start without a confirmed Priority and an active Drill, and shows one "No practice plan yet" state otherwise.
- Compare offers only the modes the data supports (Video and Frames for most swings). Progress and Metrics appear only with tracked-Priority progress or published metrics.
- At-bat: each recorded swing has a visible "Review swing" action. Unknown count, outcome and swing/take no longer fill the page or read as "0 swings".
- Report: What's going well, Current Priority, Next step, Drill, Progress, then the full checklist, in plain parent-readable copy. Scores read On Target, Developing and Needs Work (never "Solid").
- Terminology across the UI: Observation (not "finding"), Priority (not "focus"), Drill, Development plan.
- The demo banner is one compact row.

### Removed

- The single-camera 3D skeleton viewer and "Explain in 3D" from coach and demo screens (Overview game log, Review, Compare), plus the "3D reconstruction" quality row and reconstructed joint-angle metrics. The reconstruction can look visibly wrong even when its quality label says good.
- The Measurements drawer and metric tabs when a swing has no published metric values. There is no empty metrics card.

### Fixed

- Player Overview threw `loadSwingEvidence is not defined` on load. A function had been nested inside `renderStats` by an earlier edit, so the swing-evidence list and share links never rendered. A test now parses every page's inline script.

## [0.25.1] - 2026-09-24

### Fixed

- The Review summary labelled every swing with no approved finding "Draft from analysis · Not reviewed", including swings with zero findings (unanalyzed, or analyzed with no draft). It now reads "0 findings" in those cases. The draft label appears only when at least one unreviewed AI draft finding exists.

## [0.25.0] - 2026-09-24

### Added

- Exporter `publishAsUnknown.videoClipMetrics` and `publishAsUnknown.analysisRun`. Swing metrics that can't be truthfully labelled, and an unreviewed AI "no action needed" conclusion, can be withheld per clip. The prior values are withheld from the override log.
  - The two analysis-run fields must be withheld together, because the schema requires a reason whenever `no_action_needed` is true. The validator now catches that case (`NO_ACTION_REASON_REQUIRED`).
- Exporter `mediaFileVersion`. A new fixture version can keep an earlier version's public media filenames, so byte-identical media keep the same URLs and the earlier version stays restorable.

### Changed

- Compare and Review no longer label any metric "Direct video measurement". Bat speed, attack angle and stride are 2D estimates from one uncalibrated camera, and now say so.
  - Bat speed is shown as body-relative shoulder-widths/s, "not mph".
  - Stride is described as whole-clip front-ankle travel.
  - Every value shows its unit.
- Compare's Metrics tab and Review's Swing Metrics panel now show an honest "No reliable measurements" state for processed swings that have no publishable values.
- Review no longer headlines "No meaningful mechanical issue is supported by this swing." A swing with no findings now reads "No reviewed findings for this swing", with a note that this is not a judgment that the swing has no issues. An AI no-action reason, when present, is labelled "Analysis draft note (not reviewed)".
- Report: "Your coach will add a drill here." now explains that HitterLoop can recommend a drill for the coach to choose once the coach confirms a development priority.

## [0.24.1] - 2026-09-24

### Fixed

- Player-page share links pointed back at the Player page on hosts that serve extensionless URLs (the live demo at joncurry.co redirects `player.html` to `player`), so a copied link never reached the report. The link is now built for both URL forms.

## [0.24.0] - 2026-09-23

### Added

- Explicit checklist review states (migration `00040_checklist_review_status.sql`, applied to `public` and `demo`). A checkpoint is now `ai_draft`, `verified`, `insufficient_evidence` or `rejected`.
  - A trigger derives the state for every existing writer, so AI and pose3d drafts, the score stepper, seeds and clones need no change.
  - A constraint keeps the states consistent: insufficient and rejected rows carry a reviewer and no score.
  - Score history now records review-state transitions.
  - The AI draft value, note, source and run link are never altered by a review.
- Coach checklist actions "Insufficient evidence" and "Reject draft", beside the existing tap-to-verify score stepper. Insufficient and rejected checkpoints show a compact state label instead of "AI Draft — Unconfirmed", and the AI note is not shown as coaching text.
- Exporter `publishAsUnknown` (per curated clip). Specific game or pitch fields the human declares unverified are published as null, with a warning and the prior value withheld, instead of failing as missing.

### Changed

- The report (`get-player-report`, `get-demo-player-report`) shows verified scores, plus insufficient-evidence checkpoints labelled as such. Rejected drafts never appear.
- The exporter exports verified scores and insufficient-evidence checkpoints; the latter carry no AI number or note. Rejected and unreviewed drafts are never exported, and only coach-verified score history is. The validator fails closed on any rejected or leaking row.

### Fixed

- The Player page "Trending Up" banner, and the per-checkpoint trend chart, treated an AI draft followed by a coach's score as the player's progress. They now compare coach-verified scores only.
- `demo.test.ts` silently failed to restore a local-validation canonical demo fixture after its run. It now restores it, or fails loudly.

## [0.23.0] - 2026-09-24

### Added

- The batter's own jersey lettering (back name bar and chest team name) is now masked in privacy-treated demo video. The band follows the torso's shoulder-to-hip axis through turns and follow-through. Only the head is carved out: limb carve-outs exposed lettering fragments on real footage. Helmet decals (surname on the back, team wordmark on the front) are masked too. Only a small face window below the brim stays visible, and the whole helmet is masked when the batter faces away. Frames with no reliable shoulders use a flagged fallback band that forces manual review. The validator reports surviving upper-torso detail.
- `scripts/privacy/ocr_check.py`: a frame-by-frame OCR check (full frame plus an upscaled subject crop) for words that must not appear, with an extra upscaled head crop for helmet decals. It runs on the source as a sensitivity baseline and on the treated output, and the words are never stored in the repo.
- Prototype `--lettering-mode precise` for the privacy anonymizer. It masks only the detected jersey and helmet lettering (segmented silhouette, stroke detection, whole-word outlines, tracked across neighbouring frames) instead of the whole torso band. It is opt-in, and the default broad output is byte-identical. New review tools: `check_lettering.py` (independent residual-lettering check), `compare_torso_pose.py`, `review_all_frames.py` and `compare_treatments.py`.
- Precise lettering mode can keep the jersey number visible (`classify_numbers.py`). It is used for the four navy-jersey demo clips and needs a components cache plus number labels from `anonymize_clip.py`.
  - An outline stays visible only if OCR reads digits of the given number at every scale, on the lower torso, in a roughly square outline outside the glove/bat area, or if it is tracked from such a read through outlines that show no name letters.
  - Everything else stays masked, including lettering inside the glove and bat areas.
  - New tools: `review_numbers.py` (a local-only sheet of every exempted outline) and `review_lettering.py`. `check_lettering.py` records deliberately visible number clusters separately.
- Exporter `forbiddenPublicTerms` (local manifest only): any fixture value containing one of these terms fails the export closed, and the error message never echoes the term.

### Changed

- Exported `video_clips.clip_slug` is now a neutral `<publicSlug>-clip-NNN`. Local slugs come from original filenames and can carry the athlete's name.
- Coach app placeholders, examples and source comments no longer use real team or player names.
- The analyzer records the concrete model IDs a Claude CLI alias resolved to (`analysis_runs.ai_model_version`). `analyzeAndSync` also accepts per-clip excluded measurements, which are recorded in the run's input manifest and shown to the model.
- `analyzeSwingViaClaudeCli` accepts an optional evidence addendum, off by default, so the production prompt is unchanged. Callers that use it must record their own prompt version. `buildAnalysisInput` is now exported for local experiments that must not write drafts to the database.
- The methodology DB test now restores whichever methodology version was active before it ran. Previously it always reactivated `k-0.1.0`, which silently replaced a locally published `k-0.2.0`.
- The real-fixture e2e test now restores the canonical demo pointer even when it names a local-validation fixture, and fails loudly if it can't. Previously the restore failed silently and left the local demo pointing at the test fixture.
- All earlier privacy-treated clip approvals are void. Every regenerated clip needs fresh human approval of its new hash.

## [0.22.0] - 2026-09-24

### Added

- Privacy treatment for real demo footage (`scripts/privacy/`, `docs/research/demo-privacy-video.md`). Everyone except the analyzed batter is pixelated and blurred. The keep region comes from the pipeline's own tracked batter (keypoints + bat), and other people are masked even inside it using two detector architectures at 1920 px with track holding. Frames stay exactly as analyzed: CFR at the analysis fps, frame i = analysis frame i, no crop.
- Identity gates: a clip whose tracked "batter" doesn't hold the bat is rejected. A track switch (body-size or position jump) obscures every later frame, and rejects the clip if it falls inside the analysis phase window. The post-swing tail is obscured.
- Independent validator on the encoded file: timing, per-person detail destruction (two detectors at 2560 px), fail-closed frames really obscured, and re-detected pose alignment against the stored analysis. Local-only review tooling covers source-vs-output zooms and a subject-identity audit.
- Publication gate (`evaluatePrivacyGate`). Exported media must be the treated file, with a non-REJECT summary, a non-FAIL validation, matching hashes, analyzed frame count, trim at the analysis window, and a separate human approval bound to the exact sha256 (`resolvedReviewItems` for manual-review clips). Treated media is copied byte for byte. Untreated transcodes are only allowed in local-validation manifests.

### Fixed

- Phase-marker and Compare seeks showed the previous frame. Container timestamps round up (e.g. 4.753732 s vs 142/fps = 4.7537317 s), so seeks now target 1 ms inside the frame.
- The player game log showed "vs null" for an at-bat with no recorded opponent.

## [0.21.0] - 2026-09-23

### Added

- Single-player canonical demo (migration `00037`). Every new or reset demo visitor gets exactly one team, built from ONE explicitly published, immutable fixture version (`demo.demo_canonical` pointer, `publish_demo_canonical()`). A broken or missing published fixture fails closed, with no silent fallback to the fictional team. The fictional narrative remains only as an explicit rollback target. `retire_noncanonical_sessions()` ends stale sessions after a switch.
- Database-level publication-consent guard (`00038`). Fixtures without recorded consent, or exported in the new local-validation mode, can't be stored or published except on a local stack with an explicit dev setting.
- Exporter local-validation mode, for exercising the pipeline on real footage before the consent checkpoint. Missing human facts become labelled "UNCONFIRMED" warnings, and the fixture is stamped and refused everywhere else. Unfilled worksheet placeholders are rejected in manifests. A publication-approved team block is now required. Media filenames are version-stamped, and unknown phase-to-media alignment fails closed.
- Real demo video playback: demo mode resolves curated clips to static `/hitterloop/demo/media/<file>` (never a signing function), and every seek site (Review phase markers, Compare, skeleton sync) applies the clip's analysis-to-media offset.
- Import CLI: `--publish`, `--status`, `--rollback-to <id>@<version>`, `--rollback-fictional`, `--retire-stale`.

### Changed

- Demo banner no longer says "fictional players and data". Demo "no video" states now say "No video published for this swing".
- Transcodes convert full-range phone video to limited-range `yuv420p` for consistent browser playback.

### Fixed

- The upload worker created a phantom blank pitch for every processed game clip. The BEFORE INSERT auto-link trigger fired on `ingestPhases`' upsert of an already-existing clip (`00039`).
- The first visit to the app reloaded the page when the service worker first took control, aborting in-flight work, such as the demo's session bootstrap.
- `player.html` called `get-video-url` directly, bypassing demo-mode handling. Compare applied start times by position in a filtered list, so one missing video shifted the other's start.

## [0.20.0] - 2026-09-22

### Added

- Real-footage demo promotion pipeline (`docs/research/demo-real-data-promotion.md`). A human-authored curation manifest serves as the clip allowlist and supplies all human-only metadata. It is paired with `npm run export-demo-fixture`, which exports a coach-reviewed local player into a deterministic, content-hashed, demo-shaped fixture, with browser-ready H.264 media that has its metadata stripped. `npm run import-demo-fixture` loads that fixture into a new canonical clone source, `demo.demo_real_fixtures`, after the database verifies it with a full rolled-back canonical clone. Every new demo visitor then gets the fictional team plus each active real fixture.
- Fail-closed curation rules. Only allowlisted, fully processed clips are exported. Findings must be approved or edited: drafts need an explicit opt-in and stay marked as drafts, and rejected findings are never exported. Checklist scores must be coach-reviewed. Coach names are aliased. Missing dates, opponents, counts, outcomes, trim bounds, or publication consent cause errors rather than guesses. A leak scan blocks local paths, bucket keys, secrets, and source row ids.
- Migration `00036_demo_real_fixture_promotion.sql`, additive. `demo.*` now matches production for real metrics, pose (`joints_blob`, `lead_side`), analysis provenance, and edited-finding originals. It also adds demo media columns and a generic, whitelisted, JSON-driven `demo.clone_real_fixture()`.
- Unit tests (18) and a local end-to-end test (`npm run test:demo-real-fixture`, 14). The E2E drives an anonymous visitor through the exact frontend query shapes of all eight demo pages.

### Fixed

- The demo Player page's Game Log always showed "No recent game": `loadGameLog()` selects `game_log_entries.pitch`, which `demo.*` lacked.
- `demo.clone_demo_dataset(uuid)` inherited Postgres's default EXECUTE-to-PUBLIC grant, so any signed-in demo visitor could call this SECURITY DEFINER function directly and create orphan teams. All clone and load functions now revoke `PUBLIC` (takes effect in the cloud once 00036 is deployed).

## [0.19.1] - 2026-09-22

### Fixed

- Demo schema compatibility gaps surfaced by the live deployed demo: `player_priorities.follow_up_set_at` (and its stamping trigger) was missing, breaking Team and Player; `swing_phases.reconstruction_reliable` and `analysis_runs.no_action_needed`/`no_action_reason` were missing, breaking Review; `game_log_entries.session_note` was missing and `result` incorrectly kept a `NOT NULL` production had already dropped, breaking new practice reps.
- `coach_profiles` 404 in demo mode - added a minimal demo-owned `coach_profiles` table (fixed "Coach Demo" display name, no production identity link), auto-populated on bootstrap.
- Review and Compare no longer show a bare "Video unavailable" state in demo mode - `getVideoUrl()` skips the undeployed `get-video-url` function entirely and both pages render an explicit "Demo evidence placeholder" instead.
- Added 7 exact-frontend-query-shape regression tests (`supabase/demo/demo.test.ts`) covering Team/Player/At-Bat/Review/Development/Practice/Compare, since the prior suite proved data existed without mirroring the real `.select()` shapes closely enough to catch these gaps.

## [0.19.0] - 2026-09-22

### Added

- Public HitterLoop demo backend, complete and deployed to the real cloud Supabase project: an isolated `demo` Postgres schema (no demo row ever lives in `public.*`, no FK from `demo.*` into production tables) inside the same shared project, since a dedicated second project wasn't available. Anonymous visitors get a private, resettable clone of a fictional team via `start_demo_session()`/`reset_demo_session()`, transactionally cloned-then-repointed-then-deleted with per-visitor advisory-lock concurrency safety.
- Full canonical demo narrative: Jordan Lee's complete coaching loop (swing evidence -> reviewed finding -> priority -> assigned drill -> practice follow-up -> resolution -> shareable report), Maya Torres's exact 4-pitch game at-bat with a pending review finding, and Riley Chen's longitudinal development history (one resolved, one monitoring priority) - covering every real coach page (team, player, at-bat, review, development, practice, compare, report) with meaningful fictional data, none of it fabricated AI provenance.
- `get-demo-player-report` Edge Function: the demo-mode counterpart to `get-player-report`, schema-scoped to `demo`, reusing the same report-shaping logic; `report.html` now branches on demo mode to call it.
- Centralized demo runtime config (`coach/demoConfig.js`, `dataNamespace`) drives a single schema-scoped Supabase client construction in `coach/shared.js` - every existing `.from()`/`.rpc()` call site across the app is unchanged.

### Fixed

- At-bat page (and the Practice page's equivalent file-picker flows) no longer open the OS camera/file picker in demo mode - `chooseVideo()` and `practicePage.js`'s upload chokepoints now check the same `capabilities.uploads` flag `player.html` already used, closing a gap where Record-pitch/camera-icon/"Add another video" stayed clickable even though the resulting upload was already blocked after the fact.

## [0.18.2] - 2026-09-21

### Changed

- Renamed the product from BarrelTrace to HitterLoop across the coach app (titles, login, public report brand strip and footer), PWA manifest, Android app label (launcher and task switcher), Capacitor app name, npm package names, documentation and product metadata. Brand migration only: no behavior, schema, RLS, pipeline or AI changes.
- Android application ID / namespace / URL scheme `com.barreltrace.coach` -> `com.hitterloop.coach`, and `MainActivity` moved to `com/hitterloop/coach`. This is a separate Android app identity, not an in-place upgrade: an existing BarrelTrace install coexists until uninstalled (`adb uninstall com.barreltrace.coach`), and local app data is not carried over.
- `window.__BARRELTRACE_LOCAL_CONFIG__` is now `window.__HITTERLOOP_LOCAL_CONFIG__` (a gitignored `coach/config.local.js` must be updated). PWA cache names now start with `hitterloop-coach-`; the service worker's activate step deletes the old caches.
- Kept the persisted format identifiers `barreltrace-reconstruction-v1` and `barreltrace-x-right-y-up-z-pitcher`: stored reconstructions are validated against them on load, so renaming them would invalidate existing data.

### Added

- Brand-consistency test (`scripts/brand-consistency.test.mjs`) that fails if the old product name or Android application ID reappears in active source, build config or current docs.

## [0.18.1] - 2026-09-21

### Fixed

- Pitch outcomes can now be changed after logging (pitch menu and details sheet), and standard outcome saves no longer write `count_before_*`, so correcting an earlier pitch re-derives later counts. Only an explicit Fix count writes an override, and only when it differs from the derived count.
- Player Overview "Log at-bat" opens the quick Log at-bat sheet instead of the legacy modal (`?openLog=1` now redirects to the sheet).
- The "Other outcome" grid is actually hidden until expanded; new entries no longer offer `take`, and legacy take rows no longer render "Take · Take".
- Public report ranks active before monitoring before resolved, picks the newest drill assignment, and lists progress and watch-swing clips newest first.
- Segmented and Compare tabs scroll instead of splitting words at large text sizes.
- Compare transport controls are disabled when neither video loads, including when a video URL exists but the media fails to load.
- Player Overview's "Working on" card wraps at 200% text instead of causing horizontal page scroll.
- Pitch rows no longer nest buttons inside `role="button"`; Log without video stays available when an at-bat looks over.
- Approve is locked while saving and Retry repeats the approval.

## [0.18.0] - 2026-09-21

### Added

- Added a distinct-swing team Review queue with chronological player grouping, partial-review state, session-only skip, recent reviewed swings, a count badge, and explicit queue-mode Next swing behavior.
- Added collision-safe pitch quick entry, camera-cancel safety, derived count/swing state, optional strike-zone location, evidence upload states, and the shared Log at-bat sheet.
- Added deterministic suggested Compare pairs and the Video, Frames, Progress, Metrics, and optional explanatory 3D hierarchy.
- Added pure Phase 2B models and regression tests for queue classification, pitch numbering/end-state rules, suggested comparisons, shared-phase fallback, and public-report shaping.

### Changed

- Reworked the public player report into a summary-first coach-confirmed view and removed unreviewed checklist rows at the server shaping boundary.
- Enforced one actionable finding and one visible primary Approve action on Swing Review; queue mode switches to Next swing only after every finding is decided.
- Finished the Phase 2A closeouts: Session Plan values wrap, Coach Assessment owns the sticky Finish session action, and button-styled links no longer inherit underlines.

### Security

- Public report responses now exclude every checklist score whose `reviewed_by` is null and omit review-authority fields from checkpoint payloads.

## [0.17.0] - 2026-09-21

### Added

- Added deterministic Phase 2A presentation tests for Development next focus, game-transfer language, prefilled and same-day practice starts, guided rep progression, and manual session assessment.
- Added compact coach-plan and guided-practice rendering modules that remain framework-free and participate in the offline shell.

### Changed

- Reorganized Development around one Next Focus, compact expandable priorities, integrated game-transfer and follow-up states, coach-owned history, a separate findings-to-review list, and collapsed insights.
- Rebuilt Practice as a Baseline → Drill → Post-drill progression with prefilled session setup, continue-today handling, compact rep rows, baseline/post-drill comparison, manual assessment, and a single state-aware primary action.
- Moved drill, follow-up, progress, rep grouping/usability, and destructive actions into shared bottom sheets, overflow menus, snackbars, and confirmation dialogs while preserving stored values and coach authority.

## [0.16.0] - 2026-09-20

### Added

- Added deterministic Phase 1B presentation rules and regression tests for team attention, Player Overview next-action precedence, and the approve-before-priority Swing Review progression.

### Changed

- Reorganized Team around Today, a compact attention-sorted roster, recent activity, and collapsed team insights while retaining the existing roster, follow-up, activity, filter, and checklist data.
- Reorganized Player Overview around one next action, active priorities, an assigned drill, and compact recent game/practice rows. Detailed checklist, earlier analysis, history, context, and management remain available through disclosures and overflow.
- Made Swing Review a drill-in, video-first experience with a compact phase track, coach-oriented finding cards, one primary decision, post-approval priority tracking, a compact next step, and one collapsed Advanced analysis group.

## [0.15.0] - 2026-09-20

### Added

- Added the Phase 1A BarrelTrace design-system foundation: verified dark-theme tokens, Inter-first type scale, Lucide SVG sprite/helper, shared cards/list rows/status and filter chips/buttons/disclosures/states, and safe-area-aware sticky actions.
- Added accessible, history-aware BottomSheet, ActionSheet, ConfirmDialog, OverflowMenu and Snackbar primitives. Browser and Android WebView Back now close the top overlay before leaving the page.
- Added focused UI-contract and contrast tests, including player-tab route preservation, overlay history behavior, status mapping, viewport zoom, action-sheet destinations and interim bottom navigation state.

### Changed

- Replaced the shared player/team chrome with a 56dp app bar, equal-width Overview/Development/Compare/Practice tabs, and the interim Team / Add / Player bottom navigation. The Add sheet reuses existing at-bat, practice and add-player flows without silently selecting a player.
- Removed viewport zoom locks, centralized safe-area spacing and 48dp hit targets, removed the default card rail, restrained brand colour usage, and migrated shared chrome from emoji to the SVG icon system.
- Replaced shared development-form modals with mobile bottom sheets and migrated pitch deletion to the themed destructive confirmation dialog. Success/error notices now use the shared Snackbar.

## [0.14.1] - 2026-09-20

### Changed

- Rebranded BarrelIQ to BarrelTrace across the coach app (titles, login, share report), PWA manifest and cache names, Android app, documentation and product metadata. Product description is now "Video-based swing analysis and player development for youth baseball and softball."
- Renamed internal identifiers to match: Android application ID / namespace / URL scheme (`com.barreliq.coach` -> `com.barreltrace.coach`, so existing installs must be uninstalled and reinstalled), npm package names, `window.__BARRELTRACE_LOCAL_CONFIG__` (rename it in any local `coach/config.local.js`), the reconstruction pipeline/coordinate-system identifiers, and coordinate helper function names.
- PWA cache names now start with `barreltrace-coach-`; the service worker's activate step deletes the old caches, so installed apps refetch the shell (and the Three.js CDN cache once) on next load.

## [0.14.0] - 2026-09-19

### Added

- Longitudinal player-development model (migrations 00025-00027): `at_bat_pitches` (many pitches per at-bat, each with its own clip(s)), `player_priorities` with status history, `player_priority_drills`, coach-authored `player_priority_observations`, `practice_sessions` / `practice_repetitions` (baseline / drill / post-drill grouping, coach outcome), and a small curated `drill_library`. RLS on every new table, with tests. Existing clips migrated onto Pitch 1 / practice reps with no data loss; triggers keep the older log-at-bat and attach-video flows consistent with the new model.
- Player Development page: current priorities with evidence, assigned drills, follow-ups, game-transfer check, coaching-loop steps, next focus, chronological timeline, game-vs-practice mix, and lazy robust-metric trends.
- Simplified coach review page (`review.html?clip=&phase=`): what I see / what to work on / what to look for next time / track progress, with Approve, Edit, Reject, Promote to priority, Assign drill, and Mark progress. Technical details (analysis quality, metrics, 3D, detailed checklist) are collapsed. Phase deep links seek the video.
- Swing comparison page: pick any two swings (game, practice, mixed), video mode synced on a chosen phase, Frame A/B mode with Load to Contact, Plant to Contact, Contact to Finish presets, robust-only metric comparison, priority trend, and 3D A | 3D B with a shared viewpoint and trails.
- At-bat page (pitch add/edit/delete, per-pitch video attach, count progression, facts-only summary) and practice session page (goal, focus priority, drill, rep grouping, usable/rejected, baseline vs post-drill compare, coach outcome).
- Team dashboard (needs review, follow-ups due, active priorities, recent progress/practice/game swings) and per-team attention line on the home screen.
- Ingest-time analysis quality (pose/bat coverage, contact confidence, reconstruction, occlusion, handedness) stored on `video_clip_metrics`, plus `npm run backfill-analysis-quality`.
- 3D motion trails (hands, bat barrel, pelvis, sternum) with short configurable windows, and shoulder/hip axis overlays.

### Changed

- AI diagnosis now drafts observation / evidence / why it may matter / coaching cue / suggested drill / what to look for next time / confidence. Re-running analysis never overwrites a coach-reviewed issue and never creates or resolves a priority.
- Player page: active priorities shown up top; the 11-checkpoint checklist is now an advanced, collapsed section.
- Public player report simplified to strengths, what we're working on and why, drill, progress over time, and relevant video; the server whitelists coach-confirmed content only (no internal diagnostics) and serves video only for clips a coach linked as evidence.
- `uploadRawClip` can attach a clip directly to a pitch or practice rep.

## [0.13.0] - 2026-09-19

### Added

- Added a deterministic five-video validation runner with private diagnostic videos, reconstruction quality gates, versioned confidence summaries, and regression metadata.
- Added canonical reconstruction math for coordinates, short-gap interpolation, bone stabilization, foot planting, handedness evidence, and animation validation, with tests.
- Added original-video plus 3D coach review, frame stepping, named reconstructed camera views, and a secure short-lived private-video read endpoint.

### Changed

- Labels video-derived measurements separately from monocular 3D estimates and strengthens AI-draft precision/source-of-truth constraints.
- Uses a named FBX retarget map and preserves 3D failure as a non-blocking video/2D fallback.

### Fixed

- Prevented optional FFmpeg audio/decimation helpers from crashing the visual pipeline when executables are unavailable.
- Reduced limb-length variation and planted-foot sliding, and corrected arbitrary global lifter tilt with one sequence-level stance transform.

All notable changes to this project are documented here, following
[Keep a Changelog](https://keepachangelog.com/en/1.1.0/). This file starts 2026-08-01 — see
`NEXT_STEPS.md` (and its own git history) for the detailed narrative of everything before that.

## [0.12.0] - 2026-08-23

### Added
- AI-drafted swing diagnosis (checklist scores, issues, reference comps, drill recommendations)
  now runs automatically the moment an uploaded clip finishes processing - previously required a
  human to manually run `extract.ts` + `analyze.ts` afterward. `processUploadQueue.ts` extracts one
  still per located swing phase (seeking metrics.json's own phase timestamps directly, instead of
  dumping a dense fixed-fps frame sequence) and hands them to the analyzer automatically, in its own
  try/catch so a diagnosis failure can never undo or fail an otherwise-successful clip.
- Comp/drill recommendations were never part of the AI analysis pipeline at all before now -
  `comp_recommendations`, `comp_notes`, and `drill_recommendations` are new outputs of both analyzer
  backends, using full-replace semantics on each run (those tables have no reviewed-by protection
  concept, unlike checklist_scores/issues).
- New local-testing analyzer backend (`claudeCliAnalyzer.ts`): shells out to the `claude` CLI
  instead of calling the Gemini API, reusing the developer's own Claude subscription login rather
  than a separate metered key. Selected via `AI_ANALYZER=claude-cli` (local dev only - production
  stays on Gemini by default). Verified end-to-end against a real clip.

### Fixed
- `analyze.ts` re-running for the same player was pure `INSERT` for the `issues` table, silently
  duplicating every unreviewed issue on each run - now clears unreviewed drafts first, the same
  protection `checklist_scores` already has for coach-confirmed work.
- `coach/player.html`'s "Reference Comp" section only ever rendered a `comp_notes` entry when there
  was *also* at least one `comp_recommendations` row - an honest "no comp fits" note had nowhere to
  display. Notes now render regardless.
- `coach/sw.js`'s service worker intercepted every cross-origin request, including large video
  uploads - relaying a large-body POST/PUT through `fetch(evt.request)` forced the worker to buffer
  the whole body itself, reliably OOM-crashing the WebView renderer on a real 41MB upload (confirmed
  even after quadrupling the test emulator's RAM, ruling out a resource-constraint explanation).
  Non-GET requests are no longer intercepted at all.
- A real, confirmed shell-escaping bug in the initial `claudeCliAnalyzer.ts` implementation:
  `child_process.spawn` with `shell: true` and an args array does not escape those args, only
  concatenates them - passing a large multi-line prompt as an argv element got mangled badly enough
  that `claude` received no usable prompt at all. Fixed by piping the prompt via stdin instead.

## [0.11.0] - 2026-08-21

### Fixed
- The 3D skeleton's neck/head no longer renders from VideoPose3D's raw neck/head/head-top
  estimates, which were measurably unreliable for this activity (a real 115deg-from-vertical
  neck angle on a well-tracked frame) - the head now rides neutrally with the torso's own
  (reliable) orientation instead of independently rotating into "thrown back, looking up" poses.
  `skeletonScene.js`'s `AIM_RETARGET`.
- The Tier-2 comparison view's drag-to-rotate camera could reach a near-top-down/bottom-up angle
  where any standing figure foreshortens into an unrecognizable blob (root cause of a
  "physically impossible"-looking render that turned out to be a camera-angle bug, not bad pose
  data - confirmed by reproducing it on demand via a real drag gesture on an already-verified-
  clean frame). `OrbitControls`' polar-angle bounds tightened from ~22deg off either pole to
  ~50-104deg.
- `ingestPhases.ts` hardcoded `position: 0` whenever it created a new `video_clips` row, silently
  scrambling a multi-clip at-bat's pitch-switcher order if it ran before `ingest-pose3d-frames`
  for the same clip. Now takes its own `--position` flag, matching its sibling command.

### Added
- Each swing-phase checkpoint's underlying 3D reconstruction reliability is now checked (reusing
  `correct_limb_depth.py`'s own edge-on-to-camera anchor-condition test) and surfaced in the coach
  UI - a checkpoint landing on an unreliable frame (e.g. Load, when she's turned nearly edge-on to
  the camera) now shows an explicit "less reliable" caveat instead of a confidently-wrong render.
  New `swing_phases.reconstruction_reliable` column (migration `00023`), threaded through
  `metrics.py` -> `ingestPhases.ts` -> `compModal.js`.

## [0.10.0] - 2026-08-10

### Fixed
- Major 3D skeleton rendering fix: the two hands were never constrained to stay together on the
  bat - every frame of the reconstructed swing had wrists 0.5-6 shoulder-widths apart (anatomically
  impossible for a two-handed grip), the real driver behind renders that "didn't look like a real
  batter." Each arm is now solved as a 2-bone IK chain converging on a shared grip point, using
  already-trusted bone lengths and the model's own elbow-bend direction. `correct_limb_depth.py`.
- Stance-frame detection now also rejects frames where the batter is turned away from
  square-to-camera (a 2D-shoulder-width facing-ratio gate), on top of the existing rotation/
  hip-translation checks - closes a real failure mode on longer, multi-pitch clips. `metrics.py`.
- The 3D scrub slider (`coach/components/skeletonComparison.js`) silently hijacked page-scroll
  touches, jumping the displayed swing frame to an arbitrary instant whenever a scroll gesture
  happened to start on it - `touch-action: pan-y` fix.
- Camera "auto-level" correction now calibrates from the first 20% of a clip instead of the whole
  clip, removing a systematic tilt bias the swing's own dynamic motion was introducing into every
  frame's correction, including the genuinely-upright stance frame. `skeletonScene.js`.
- Shoulder bones are now retargeted to the real tracked player's shoulder width instead of staying
  locked at the character model's rest pose (was rendering less than half the real width).

### Security
- Fixed stored XSS: coach-entered free text (player/team names, notes, opponent, comp cues) was
  interpolated unescaped into `innerHTML` across the coach app, including `report.html`'s public,
  unauthenticated share-link page. Added a real `escapeHtml()` helper (`coach/shared.js`), applied
  at every injection point found.
- Fixed a silent-error data-loss path: a failed checklist load used to fall back to an empty
  placeholder row, and scoring that checkpoint would then silently overwrite a real AI
  draft/notes/coach-review with nulls. `loadChecklist()` now shows a real error and disables
  scoring until the load succeeds.
- Player share links now expire after 90 days (`expires_at`, checked by `get-player-report`).
- `create_team`'s access-code check is now rate-limited (5 attempts/15min per coach).

### Added
- Failed clip processing now auto-retries up to 3 times with backoff (2/10/30min) before falling
  back to requiring the existing manual "Retry" button - closes a real gap where a transient
  failure (a momentary GCS blip) had no automatic recovery at all.
- First automated test coverage in the repo (`npm test`, zero new dependencies): real integration
  tests against local Supabase for the upload-queue claim race guard and the checklist
  reviewed-by overwrite protection - previously the two most safety-critical pieces of backend
  logic with zero coverage.

### Changed
- `detect_2d.py` no longer crashes on a frame-count mismatch between its two independent decode
  passes (matched an existing guard used elsewhere in the same file).
- Fixed real disk leaks: a failed clip upload no longer strands its downloaded raw video
  (`processUploadQueue.ts` cleanup moved to a `finally`), and pipeline working-video/audio copies
  (`_stage0_audio.wav`, `_trimmed_input.mp4`, etc.) are now removed on every pipeline exit path,
  not left behind indefinitely (`run_pipeline.py`).

## [0.9.0] - 2026-08-04

### Added
- Per-checkpoint progress-over-time sparklines on `player.html`. `checklist_score_history` was
  already a real, trigger-populated audit trail (fires on every score change from any code path) -
  the gap was purely presentational. A checkpoint with 2+ real score changes now shows a small
  inline chart; checkpoints with fewer stay unchanged, same "never fabricate a trend" discipline
  the existing `loadTrend()` banner already followed.
- Shareable, read-only player reports. A coach can generate a link from `player.html`'s "Manage
  Player" drawer that a parent/recruiter can open with no BarrelIQ account at all
  (`coach/report.html` + new `get-player-report` Edge Function). This app's RLS model has never
  granted `anon` anything on any table, by deliberate original design - this feature doesn't change
  that: the Edge Function validates the share token and reads with `service_role` internally,
  mirroring the existing `get-upload-url` function's pattern, rather than exposing Supabase
  directly to an anonymous browser client. Links are revocable per-player at any time.

## [0.8.0] - 2026-08-04

### Security
- Fixed a real, proven RLS hole: `checkpoints` and `swing_phase_types` had row-level security
  disabled entirely (not just "no policy") plus full write grants to `authenticated` - any
  self-signed-up coach, including one with zero team access, could rewrite shared checklist data
  used by every team. `00017_lock_down_reference_tables.sql` enables RLS, adds read-only policies,
  and revokes the write grants. Re-ran the exact exploit after the fix - now correctly blocked.
- Self-service team creation now requires an access code, checked server-side in `create_team()`
  against a new `app_settings` table (service_role-only). Account signup itself stays open - a
  team-less coach account is inert once the fix above landed - but creating real team data now
  needs a code the app owner hands out. `00018_team_creation_access_code.sql`.

### Added
- A coach can now manually score any checklist checkpoint with no video or AI draft required -
  previously the entire scoring UI only rendered once a `checklist_scores` row already existed,
  and the only two things that ever created one were the pose3d pipeline and the (never verified
  against a real key) Gemini analyzer, leaving a brand-new player with zero way to be scored.
  `coach/components/stepper.js` now upserts on `(player_id, checkpoint_id)` instead of updating a
  row that might not exist yet; confirming a real AI-drafted score still correctly preserves
  `ai_draft`/`source`.

## [0.7.1] - 2026-08-03

### Removed
- The 8-name MLB reference-comp bank (Shoeless Joe Jackson, Ty Cobb, Pete Rose, Ted Williams, Barry
  Bonds, Lou Gehrig, Babe Ruth, Ichiro Suzuki) from `readme.md` - direct decision to focus
  exclusively on top-end softball hitters for comps/analysis. The live coach-app modal
  (`compModal.js`) never actually included these; the real find was `src/services/ai/
  geminiAnalyzer.ts`'s system prompt, which told Gemini to fall back to "a general MLB mechanics
  reference" when no softball comp fit - rewritten to never cite an MLB/baseball player, omitting a
  named comp entirely rather than reaching for baseball when nothing in the softball bank fits.

## [0.7.0] - 2026-08-03

### Changed
- Roster row (`coach/team.html`) is now tap-anywhere-opens-report, signaled by a trailing `›`
  chevron instead of an inline delete button - deleting a player moved to a collapsed "Manage
  Player" drawer at the bottom of `player.html` (a rare action, no longer competing for tap space
  on a row a coach opens constantly).
- Game log/practice log "Delete At-Bat" buttons (`player.html`) are now icon-only and muted at
  rest, intensifying to the full danger-red treatment on hover/focus - they sit on every card
  during passive scrolling, unlike "Delete Pitch" (inside an already-opened clip tab, left
  unchanged) or a roster action a coach deliberately seeks out.
- Video upload: the raw, browser-native `<input type="file">` controls (game log "Attach Video"
  and the Log-At-Bat modal) are hidden behind styled buttons, matching the pattern "Add Pitch"
  already used - "Attach Video" now auto-uploads on file selection instead of a separate confirm
  tap; the modal shows the chosen filename as text feedback.
- Team/player name header no longer hard-truncates at one line (e.g. "Latham Lady Bison W...") -
  wraps up to 2 lines (still gracefully truncates beyond that), fixing the actual cause (limited
  horizontal space next to the badge/pill) rather than the subtitle underneath.
- Confirmed-pill badge and player-switcher dropdown chevron both raised in contrast/tap-target
  size for legibility and usability.

## [0.6.0] - 2026-08-03

### Added
- A coach can now delete a player from their roster (`coach/team.html`) - a 🗑 button on each
  roster row, with a confirm dialog that honestly warns it removes every logged at-bat, score, and
  clip too (existing `on delete cascade` foreign keys, no new migration needed - the same RLS
  policy that already permits insert/update covers delete).

### Changed
- `.lineup-row` restructured into a card shell (`div`) wrapping a separate `.lineup-link` (the
  tap-to-open-player anchor) so the new delete button can sit outside the link - a `<button>`
  nested inside an `<a>` is invalid HTML5 and behaves inconsistently across browsers/screen readers.

## [0.5.0] - 2026-08-03

### Added
- Self-service coach onboarding: a coach can sign up, create their own team, and add players
  entirely through the coach app, with no admin/`provisionCoach.ts` step required. New
  `create_team()` database RPC atomically creates the team and its owning `coach_team_access` row.
  Coach invites to an existing team are explicitly out of scope for this pass (real follow-up).

### Fixed
- `coach/sw.js` was caching every cross-origin request cache-first, not just its intended CDN
  (`esm.sh`) - this meant live Supabase API reads could silently serve stale cached data whenever
  the exact same query URL was repeated (e.g. a team roster reload right after adding a player
  showed the pre-add, empty state). Now only `esm.sh` requests are cached; Supabase/GCS requests
  always hit the network.

## [0.4.1] - 2026-08-03

### Removed
- The entire legacy static-HTML report path, confirmed unused/deprecated by the user (a first pass
  only updated the README to describe it as legacy without actually removing it - real feedback,
  not a judgment call): `reports/` (Bethlehem Boom's real published files, Latham's frozen
  pre-migration copy, the shared templates, and the fictional demo reports), the PowerShell
  generator (`scripts/generate_team_reports.ps1`, `scripts/teams/*.ps1`, `scripts/extract_frames.ps1`
  - superseded by `src/cli/extract.ts`, kept), and the two Node CLIs that only existed to read/write
  those files (`src/cli/generate.ts`, `src/cli/migrate.ts`, and their `build:reports`/`migrate` npm
  scripts). Bethlehem Boom 10U currently has no live report until it's onboarded onto the coach app
  - flagged as a real, currently-open gap in `NEXT_STEPS.md`, not silently dropped.

### Changed
- README.md rewritten again to match: no more "two paths," the coach app is presented as the only
  path, with an explicit note for anyone who runs into a stale reference to the removed system in
  an old commit/comment/their own memory of this project.

## [0.4.0] - 2026-08-02

### Changed
- Replaced the 3D skeleton renderer entirely: the checklist's static skeleton view and the
  post-processing scrubbable comparison view both used to fake "3D" with Canvas2D (manually-drawn
  capsule strokes, gradient-fill circles, no real depth buffer or lighting) - flagged directly by
  the user as reading like a flat, dated stick figure, confirmed by screenshotting the actual
  render rather than taking the complaint on faith. Rebuilt on real WebGL (Three.js): real
  capsule/sphere/box meshes lit with ambient + directional lights, a lathed tapered bat mesh
  instead of two flat strokes, and free-orbit camera control (`THREE.OrbitControls`) replacing the
  old hand-rolled yaw/pitch drag math. The two-panel real-vs-corrected comparison still rotates
  both panels together when either is dragged. No pose data or scoring logic changed - this is a
  rendering-layer swap only. `coach/components/skeletonRenderer.js` deleted (superseded by
  `skeletonScene.js`); `coach/dev/skeleton-test.html` rewritten to exercise the new engine.
- Follow-up pass after seeing the new renderer against a real clip: per-limb-CATEGORY colors (one
  flat color for a whole arm, upper+forearm alike, no skin tone at all) replaced with real
  clothing-line color zones (skin: head/neck/forearms/hands; jersey: torso/shoulders/upper arms;
  pants: pelvis/thighs/calves; cleats: feet), plus per-bone (not per-category) radii so a thigh is
  thicker than a calf and an upper arm thicker than a forearm, and real hand/foot shapes instead of
  bare ball joints.
- User directly compared the rendered model against a real photo of the actual player's stance and
  it plainly didn't match (looked like a forward lunge, not a batting stance) - traced to a real,
  systemic bug, not a styling issue: confirmed via a real clip's own overlay video (2D tracking
  accurate, she's in a normal upright stance throughout) that this pipeline's monocular 2D->3D lift
  can reconstruct an implausible torso tilt for some real camera angles - `lift_3d.py`'s
  `WORLD_ROTATION` is a single fixed "vertical" assumption (borrowed from VideoPose3D's own demo
  code, explicitly documented by its authors as visualization-only, not real calibration) applied
  to every clip regardless of actual camera height/angle. Confirmed this wasn't a one-clip fluke -
  the SAME defect was present in the exact reference clip used to build/tune this renderer all
  along (torso tilt 34-65deg across all 1264 frames, never once plausible) - it had never actually
  been checked against real footage before now. Added a per-clip "auto-level" correction in
  `skeletonScene.js`: estimates the clip's own average torso-up direction and rigidly rotates the
  whole clip (same correction every frame, so all real relative motion is fully preserved) to read
  close to upright. Verified on both the reference clip and the real flagged clip, on desktop and
  the real Android WebView. Display-only - does NOT correct the stored `video_clip_metrics` angles
  (`torso_tilt_at_contact_deg` etc.), which remain the pipeline's raw, still-unreliable values; a
  real pipeline-level fix is tracked separately in `NEXT_STEPS.md`.
- User rejected the primitive-mesh mannequin outright, comparing it directly against a real photo
  of an actual player's stance ("doesn't look professional at all... doesn't even represent a
  softball batter") - a styling pass couldn't fix this since the fundamental shape (capsule limbs)
  was the problem, not the materials. Replaced entirely with a real rigged, skinned humanoid
  character (`coach/assets/models/batter.fbx`, a Mixamo-rigged mesh the user sourced) driven by a
  new bone-retargeting layer: each frame, the pipeline's 17 tracked H36M joints are converted into
  real bone rotations for the character's ~20 posable bones (full 2-vector hip/spine basis
  retargeting to preserve real hip-shoulder separation twist; single-vector aim alignment for
  limbs; fingers/toes/clavicles left at rest - H36M has no data for them). Two real bugs found and
  fixed via direct comparison against real rendered output, not assumed: the character's native
  scale (~181cm, Mixamo's centimeter convention) was being treated as meter-scale, putting the
  camera inside the mesh; and the retargeting math assumed the Hips/Spine bones' bind-pose world
  orientation was identity, which was wrong and caused visible head/neck mesh distortion - fixed by
  capturing each bone's REAL rest-pose world quaternion instead of assuming one.
  `createSkeletonScene()` is now async (loading a real character mesh is a real network fetch,
  cached after first load) - `skeletonComparison.js` and `compModal.js` updated to await it, with a
  "Loading 3D model…" state and graceful failure handling. No real uniform/face texture is applied
  yet (this specific export has none) - the character currently renders in a neutral matte tone;
  adding real texture art is separate follow-up work. Verified via direct comparison against
  reference photos and real device screenshots on desktop and the real Android WebView.

### Fixed
- A real, pre-existing bug unrelated to the character work above, only just surfaced: the shipped
  app's `.skeleton-canvas { width: 100% }` CSS relied on the canvas's own intrinsic width/height
  attribute ratio for "auto" height, while the renderer's `resize()` writes those same attributes
  on every layout change - a genuine ResizeObserver feedback loop, measured ballooning a canvas to
  66,440px tall on a real device. Never caught earlier because `coach/dev/skeleton-test.html`'s dev
  harness uses a fixed-pixel-size canvas (no feedback loop possible there); only surfaced once real
  clip data existed to render the live comparison view in the actual app for the first time. Fixed
  with `aspect-ratio: 6 / 7` on `.skeleton-canvas` and `.comp-split-col canvas`, decoupling layout
  height from the attributes entirely.

## [0.3.2] - 2026-08-02

### Fixed
- Full end-to-end audit across every feature surfaced 3 real bugs, all now fixed and verified live:
  - Raw Postgres duplicate-key errors (e.g. `game_log_entries_practice_natural_key`) were leaking
    straight to the coach in an `alert()` instead of a usable message. Added `friendlyInsertError()`
    to translate the two natural-key constraints (game vs. practice) into plain-language guidance
    pointing at the right log section; verified against real collisions in both modes.
  - The player page's "X/Y Confirmed" app-bar pill only updated on a full reload after confirming a
    checkpoint score, so a coach confirming several in one sitting saw a stale count the whole time.
    Added `refreshConfirmedPill()`, wired into the same callback that already re-renders the
    checklist after a confirm; verified live against a real roster (0/2 -> 1/2, no reload).
  - On narrow/mobile viewports the "Priority Flaws" filter chip on the team page was hard-cut
    mid-word by `overflow-x` with no visual hint the row scrolls further. Added a `mask-image` fade
    on `.chip-row`'s trailing edge; verified the row genuinely overflows (564px content in a 362px
    viewport) and the fade is applied via computed style.
- Bumped PWA cache (`CACHE_NAME` v10->v11, `coach.css` v8->v9) since this round touched both
  `player.html` and `coach.css` - see the cache-busting note in `sw.js`.

## [0.3.1] - 2026-08-01

### Fixed
- "View 3D Skeleton" investigated after a real user report ("seems to be a placeholder for all
  areas"). Root cause traced (not assumed): this dev database currently has exactly one real
  processed video clip anywhere, belonging to a disposable test fixture - not Emily C, the player
  being viewed - so her real at-bat correctly, but confusingly, fell back to illustration-only for
  all 11 checkpoints (working as documented, not a code bug).
- Separately, a full audit of all 11 checkpoints' reference-comp illustrations (prompted by the same
  report) found 6 that didn't accurately depict what they're paired with: "Head/eyes" and "Swing
  decisions" shared a generic batting-stance silhouette that showed neither eye-tracking nor pitch
  recognition; "Stance & setup", "Load", "Stride", and "Hand path to ball" shared that same
  mid-swing silhouette despite being four different, earlier phases of the swing; "Follow-through"
  reused the Extension diagram even though a finish position (bat wrapped high, weight forward) is
  visually a different pose than extension-at-contact; "Contact point" reused it too with no
  ball/plate reference to actually show what "deep vs. early" means. Built 6 new purpose-specific
  diagrams (`stance-setup.svg`, `load.svg`, `stride.svg`, `hand-path.svg`, `follow-through.svg`,
  `contact-point.svg`) alongside the 2 above - every checkpoint now has its own accurate
  illustration; `extension.svg`, `bat-path.svg`, and `hip-shoulder-separation.svg` were already
  correct and unchanged. Verified via a real Playwright run clicking through all 11: zero remaining
  on the generic fallback.

## [0.3.0] - 2026-08-01

### Added
- Batting Practice/Lesson as a distinct upload type alongside real game at-bats. Reuses
  `game_log_entries` (a new `session_type` column) rather than a parallel table, so the entire
  existing upload/processing pipeline, checklist scoring, and skeleton comparison work unchanged -
  but every query that computes a real-game stat (Logged ABs, Early Read status, the public
  report's at-bat-outcome correlation) was audited and filtered to `session_type='game'` so
  practice reps can never silently pollute them. Practice sessions get their own "Practice Log"
  section, separate from the real Game Log, with a simplified form (date, rep #, optional note,
  video - no opponent/pitch/result fields, which don't apply without a live pitcher).
- `CACHE_NAME`/cache-busting discipline note in `sw.js` after a real fix (bottom-nav alignment)
  looked like it hadn't landed for a full rebuild+reinstall cycle, purely because the PWA service
  worker was still serving a stale cached `coach.css`.

### Fixed
- The 0.2.0 bottom-nav alignment fix corrected the text baseline but left the "Log AB" FAB icon
  visibly larger than, and floating above, the Roster/Report icons - a real user report after the
  stale-cache issue above was resolved. Both icon types now share the same 26px box (no more
  raised-circle treatment) so they're the same size and sit at the same position, not just the
  same baseline.

## [0.2.0] - 2026-08-01

### Added
- Explicit Node/Python status contract (`pipeline_status.json`) between `process-upload-queue` and
  the pose3d pipeline, replacing exit-code inference that a real post-completion CUDA/driver crash
  had already proven unreliable.
- Per-environment coach app config (`coach/config.local.js`, gitignored) so a hardcoded personal LAN
  IP no longer ships in a tracked file or a real build.
- `npm run reconcile-uploads` — finds (and can delete) GCS raw uploads with no matching `video_clips`
  row, closing a gap where a dropped connection between upload and DB insert left orphaned bytes.
- Upload-time filming guidance in the coach app ("film from directly behind home plate") on all
  three places a coach can start an upload.
- A back arrow in the app bar (`team.html`, `player.html`) linking to the "My Teams" picker — there
  was previously no way back to it short of signing out.
- This changelog and the versioning/changelog/git policy in `CLAUDE.md`.

### Changed
- Pose3d Stage 0 (`locate_swing.py`) no longer falls back to analyzing an entire multi-minute clip
  when audio is ambiguous. It ranks every plausible candidate and `run_pipeline.py` tries them in
  order against the real contact/phase detector, keeping the first one that actually succeeds
  (capped at 3 attempts). Verified against a real 1GB/921s clip: 15–22 minutes down to 22–66
  seconds, with a clean clip still landing on the same real contact instant (222.24s vs. 222.36s)
  the old slow method found.
- `metrics.py`'s "cannot locate contact" failure is now specific when the real cause is a likely
  camera-angle problem (clean person-tracking, near-zero bat detection) instead of a generic
  technical string — traced to a real clip filmed parallel to first base instead of from behind the
  backstop.
- Surfaced previously-computed-but-never-shown swing metrics (bat speed, attack angle,
  hip-shoulder separation, movement-pattern flags) in the coach UI via a new `video_clip_metrics`
  table.
- Added 240fps support to the pose3d pipeline (decimate before the expensive stages, then a
  full-rate bat-speed refinement pass near contact).

### Fixed
- Bottom-nav "Log AB" label was visibly out of line with "Roster"/"Report" — the FAB icon's
  negative margin shrank its own column's layout height without the other icons following suit.
- `scripts/pose3d/models/` (94MB of YOLO weights) was untracked but not actually gitignored despite
  the README's claim that it was.
- A 240fps-blind rotation-window bug that would have silently broken contact-confidence and 3 of 5
  phase detectors on genuinely high-frame-rate uploads.
