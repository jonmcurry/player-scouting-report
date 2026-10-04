# Simplified app review and disposition

The analysis below records the original review. The decisions for the refactor are:

| Review question | Decision |
|---|---|
| Strikeout can include a swing | Let the video decide. Analyze a located swing regardless of the optional result chip; show no-swing copy only after reliable no-swing detection. An inconclusive clip fails closed. |
| Parent end-to-end path | Start with a coach-created team and a player-specific invite. No parent-created player in v1. |
| Progress overlap and sixth clip | Use the latest up-to-5 readable game swings for focus selection and status. A dismissed concept is excluded for the next 6 readable game swings. Apply dismissed → looks fixed → improving → still showing up; an active improving focus stays until fixed or dismissed. |
| Broken Dismissed table row | Fix its indentation. |
| 3D code | Remove unused app UI and assets with the old screens in Phase 4; retain only files with verified independent demo/portfolio callers. Keep the analysis pipeline. |
| Screenshot privacy | Disclose Gemini processing of the image and visible children's names before upload and in guardian consent. Do not claim that the provider discards it; verify provider handling before release. |
| Push setup | Include native push integration, provider setup, permissions and token handling in Phase 5. |
| Practice clip record | Create a `game_log_entries(session_type='practice')` row per clip. Existing triggers create the linked practice session and repetition; those tables stay hidden from the app UI. |
| Unlisted current files | Route `family.html` to parent Home; reuse `guardianAdmin.js`; rewrite `report.html` for the new shared report; use `subjectZoom.js` only if it helps playback. Check the other modules' callers before Phase 4 removal. |
| Group A cleanup | Treat the list below as candidates, not proof of safe deletion. Verify callers, npm scripts, research/release provenance and `todo.md` follow-ups before removing tracked files. Preserve untracked local artifacts unless separately authorized. |
| Group B cleanup | Remove obsolete UI code in Phase 4 once replacement screens work. Preserve frozen-demo dependencies; plan table drops separately after real use. |

Consent wording and release/publication still require Jon's review. A rollback tag is prepared as
part of Phase 0 but is created only with explicit authorization. These decisions are reflected in
`docs/SIMPLIFIED_APP_SPEC.md`.

## Original review

I read the whole spec and traced how the repo's files depend on each other: page imports, component imports, Python imports, npm scripts and edge-function callers. I didn't change any files, so the QA wrapper wasn't needed.

Part 1: Problems in the spec to fix before building
Swinging strikeouts get mislabeled (§3.3). The spec says that if someone taps Walk or Strikeout, the report says "No swing to analyze." A swinging strikeout has a swing. Only a walk or a called strikeout should skip analysis, and the Strikeout chip can't tell those apart.
The end-to-end test contradicts the access model (§10 vs §2). The test is "parent signs up → adds child → uploads." But §2 and §13 say parents only get in through a coach's invite, and parents without a team are out of scope. The test should be: coach invites parent → parent accepts → parent uploads.
The progress rules overlap (§3.4 / §5.6).
A focus seen 0 times in the last 5 at-bats matches both "Improving" (≤2 of 5) and "Looks fixed" (none in the last 4). Nothing says which wins.
The window is "last up-to-6" at-bats, but every threshold counts "of the last 5." It's unclear what the 6th at-bat is for.
These rules have to be deterministic and unit-tested, so pin both down now.
The "Dismissed" table row is broken. Line 309 isn't indented, so it falls out of the table when rendered.
The 3D code has two different fates. §4 says to keep the 3D/skeleton code "for the demo/portfolio only." §11 Phase 6 says to delete all removed components. The demo is also frozen, so pick one.
The screenshot roster import sends kids' names to Gemini (§3.6 option B). The spec says the image is "discarded immediately," but it's still sent to a third party. That needs a mention in the privacy and consent wording.
Push notifications need new setup that isn't listed (§7). mobile/package.json has only the Capacitor core packages and no push plugin. Push needs a Capacitor push plugin and Firebase (FCM) setup, so it belongs in Phase 5's scope.
Practice uploads have no clear place to live (§8). Uploads attach to "a game_log_entries row (or practice rep)." But practice_sessions is also listed as "untouched, hidden from UI." Say which record a practice clip attaches to.
Several files aren't mentioned in §4 at all:
family.html / familyPage.js: today's parent page. Does it become the new Home?
report.html: the shared-link page.
guardianAdmin.js: you'll likely reuse this for Invite parent.
subjectZoom.js: the batter zoom, which might be useful for "starts at the swing."
Also unlisted: logAtBatSheet, trendChart, stepper, teamDashboard, playerDevelopmentSummary, clipReviewState, phase1b/2aScreens, get-player-report.
Part 2: Which files you don't need
A. Dead today, whether or not the spec ships (safe to delete now)
Files	Why
src/services/html/reportBlocks.ts	Nothing references it. It only served migrate.ts/generate.ts, which were deleted on 2026-08-03.
scripts/pose_analyze.py, pose_common.py, pose_export_3d.py, pose_silhouette.py, validate_silhouette.py, render_real_overlay.py	The old MediaPipe prototype. These files only import each other, and the current pipeline (run_pipeline.py) uses none of them.
scripts/pose3d/render_public_skeleton.py, check_publish_gate.py	Built for the deleted static-HTML reports. The docstring even refers to generate_team_reports.ps1, which no longer exists.
Setup-HitterLoopMultiAgent.ps1, specs/README.md	One-time setup that configures Codex, which is no longer part of your workflow. The README points to Invoke-MultiAgentQA.ps1, which doesn't exist.
CLAUDE.md.bak.20260924-185228	A backup file that got committed.
todo.md	A paused handoff from 2026-09-19 that has since been overtaken: the admin tool exists and k-0.2.0 is published. Move its "semantic validation follow-ups" section into NEXT_STEPS.md first.
scripts/release/publishK020.ts, scripts/research/extractMethodologySeed.ts + raw-output/	One-off scripts that already ran. Delete them, or keep them only as a record of where the methodology came from. That's your call.
Untracked, local disk only:

The older demo-curation.emily.*.json files. Keep the live 2026-10-01.1 file and whichever one your demo-promotion notes name as the rollback target.
The dated QA folders and *.log files under frames/.
B. Made obsolete by the spec (delete when the new screens replace them)
Pages: atbat.html, queue.html, review.html, session.html, compare.html, development.html. team.html and player.html get rewritten.
Components, with their tests:
At-bat logging: pitchEntry, pitchZonePicker, logAtBatSheet.
Review: reviewQueue, devActions, clipReviewState (plus supabase/functions/_shared/clipReviewState.ts).
Checklist: checklistReview, checkpointEvidence.
Priorities and practice: developmentLogic (the priority parts), phase1bScreens, phase2aScreens, practicePage, playerDevelopmentSummary.
Charts and metrics: stepper, trendChart, swingMetricsPanel.
Compare: comparePairs.
Team dashboard: teamDashboard.
Comps: compModal, plus coach/illustrations/*.svg, which only compModal uses.
3D: skeletonComparison, skeletonScene, avatar-retarget-map, fkCorrection, h36mSkeleton, assets/models/batter.fbx, and coach/dev/.
Checklist backend path: src/cli/ingest.ts, scripts/pose3d/pose3d_to_checklist.py, and the checklist writes in analyze.ts / checklistUpsert.ts once the prompt drops the checklist (§5.2).
Superseded design docs: ux.md, docs/UX_REDESIGN_SPEC.md, docs/PHASE_2B_IMPLEMENTATION_SPEC.md, docs/UX_PHASE_1A_VERIFICATION.md.
Frozen demo (keep until you decide to rebuild or drop it): src/services/demoExport/*, the export/import fixture commands, get-demo-player-report, supabase/demo/, scripts/privacy/*, .venv_ocr/, demo-export/.
C. Keep
These are what the spec reuses:

the pose3d pipeline (minus the dead files above), the upload queue and worker, and the analyzer/validation code;
the knowledge pack and drill library, and admin/;
guardians, share links and delete-clip;
videoUpload.js, guardianAdmin.js, ui.js, appShell.js, coach.css and mobile/.
Decision for you
When should the Group B code be deleted? The spec says to hide it in Phase 3 and delete it in Phase 6, after about 4 weeks of real use, to make rollback easy. But Phase 0 already creates a git tag, and that tag is a full rollback on its own. You've also said you prefer a tight repo. I'd delete Group B in Phase 3, when the new screens replace those pages. Otherwise you'll be carrying two UIs and about 20 obsolete test files for a month.

Group A can go anytime. Want me to remove Group A now, as its own change with tests and QA run?
