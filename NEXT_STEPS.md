# Open Items, To-Dos, and Future Considerations

Snapshot as of 2026-07-29 (updated after the mobile UX rebuild and Latham/Emily C's Supabase
migration - see below). This file is a working status doc, not permanent documentation — prune
or rewrite sections as they get resolved rather than letting it accumulate stale entries.

## Resolved this session (2026-07-29)

- [x] **Mobile UX overhaul** (ux.md): coach app is now dark-only (retired the two-mode "infield
      dirt" theme), with a sticky app bar + bottom nav (Roster/Report/Log AB), always-visible
      checkpoint cards, a real 9-zone pitch-location/outcome picker, and a PWA shell. See the
      `mobile-ux-redesign` memory for details/scope decisions.
- [x] **Latham Lady Bison White 10U migrated into Supabase, Emily C (#10) specifically**: ran
      `migrate.ts` against her real `emily_c.html` (checklist/issues/comps/drills/game-log/
      follow-up), verified a byte-identical round trip via `build:reports`, and ingested all 7 of
      her real video clips (`videos/Emily_C_AB1 (1-4).mp4`, `Emily_C_AB2.mp4`,
      `Emily_C_AB1_game2.mp4`, `Emily_C_AB2_game2.mp4`) into `video_clips`/`swing_phases`/
      `video_clip_pose3d` from the pose3d pipeline output already sitting in `frames/emily_c/*`
      (no need to re-run the Python pipeline - it had already been run). Her 3D skeleton
      comparison renders real data in the coach app now, not a placeholder.
- [x] **"Do the new report features get ported into the Supabase schema?" is decided: yes,
      ported.** Migrating Emily's real report surfaced that `migrate.ts`/`generate.ts` would have
      silently dropped `GAME_LOG[].outcome` and `CHECKLIST[]`/`ISSUES[].atBats` (added to the
      template 2026-07-28, added to Emily's real report the same day) - exactly the risk this
      file already flagged. Fixed with migration `00010_atbat_outcome_correlation.sql` +
      `migrate.ts`/`generate.ts` updates; verified round-trip is still byte-identical.
- [x] Added `npm run ingest-pose3d-frames` (new CLI, `src/cli/ingestPose3dFrames.ts`) - the piece
      `ingest-phases` doesn't cover (the actual smoothed joint trajectory, not just phase
      timestamps) for a clip that's already been processed locally rather than uploaded live
      through the coach app's browser flow. Documented in readme.md's Cloud layer section.
- [x] `readme.md`'s Teams/Migration-status section updated to reflect Latham/Emily C's real
      status (partially migrated - Emily C only) instead of "neither real team is in Supabase."
- [x] **Reproducibility verified**: ran `supabase db reset` (full wipe back to migrations +
      seed.sql) and redid the entire Emily C migration/ingestion from scratch - same end state,
      same byte-identical round trip, same real skeleton rendering in the coach app. This time the
      multi-clip position ordering (her 4-pitch AB1) landed correctly on the first pass by running
      `ingest-pose3d-frames` (which sets position on first insert) before `ingest-phases` (which
      always requests position 0 and would otherwise clobber it) - no manual position fix-up
      needed, unlike the first run.
- [x] **`pose_to_checklist.py` retired**: deleted (fully superseded by
      `scripts/pose3d/pose3d_to_checklist.py` - better underlying pipeline, auto-detected swing
      phases instead of a hand-authored `windows.json` sidecar, confidence-gated contact). Its
      sidecar and the rest of `scripts/pose_out/*` were never actually committed to git (confirmed
      via `git ls-files` - the whole directory is `.gitignore`'d), so this was a clean one-file
      deletion, not a repo-bloat cleanup. Updated the two remaining references
      (`scripts/pose3d/README.md`, `src/cli/ingest.ts`'s docstring) that compared against it.

## Open / needs a decision

- [ ] **Emily C's skeleton render needs a coach's actual sign-off before it can go anywhere
      public.** `scripts/pose3d/render_public_skeleton.py` has produced a validated render for her
      one high-confidence clip (`Emily_C_AB1 (1)`), sitting in a scratch/local location — nobody
      has watched the paired `overlay.mp4` and set `approvedBy` in `render_manifest.json` yet.
      Until that happens, `check_publish_gate.py` will keep refusing to let it be embedded
      anywhere, by design. Not affected by this session's Supabase migration - that's a separate,
      private, coach-only view; this gate is specifically about the PUBLIC static report.
- [ ] **Pricing model direction** (team-first SaaS, seasonal billing, undercut WinReality's
      per-player pricing) was discussed and is a real recommendation, but nothing has been decided
      or built — no billing, no accounts, no tiering exists anywhere in this codebase yet.

## Still to do (concrete, near-term)

- [ ] Get a coach (you) to actually watch `frames/emily_c/Emily_C_AB1 (1)/overlay.mp4` and either
      approve or reject the paired skeleton render — this is the one manual step blocking Part 1
      of the pose3d evidence work from being genuinely "done," not just built.
- [ ] Re-run `scripts/pose3d/render_public_skeleton.py` for any of Emily's other clips if more
      contact-confidence-"high" swings get filmed/reprocessed — right now she has exactly one.
- [ ] Bethlehem Boom 10U still needs its own `migrate.ts` pass (11 real players) if/when it moves
      off the static-HTML path - Latham's migration this session (Emily C only so far, now proven
      reproducible via a full db-reset-and-redo) is the template to follow, not a reason to assume
      Bethlehem is done too.
- [ ] Latham has other roster spots beyond Emily C (see the team's `team_summary.html`) that
      aren't in Supabase yet - each needs its own real, hand-filled report content before
      `migrate.ts` has anything meaningful to migrate for them.

## Future considerations (bigger, no immediate action needed)

**Architecture**
- This project has changed its core architecture roughly every week (PowerShell generator →
  MediaPipe pose scripts → pose3d YOLO11/VideoPose3D → Supabase-backed coach app). That pace is a
  real asset (fast iteration) but also a real risk for any session (human or AI) that assumes
  "what I remember" is still current — see the `verify-current-architecture-first` memory this
  session wrote specifically because of that.
- Bethlehem Boom 10U is not yet in Supabase; Latham Lady Bison White 10U is partially migrated
  (Emily C only, as of this session). Deciding *when* and *how* the rest migrate (all at once vs.
  incrementally, who does each `migrate.ts` run) is still an open design question, not just an
  execution detail - but the mechanics are now proven end-to-end on one real player, including the
  video/pose3d ingestion path, not just theoretical.
- The coach app's skeleton-comparison feature (FK-corrected idealized comparison) currently only
  covers 2 of 11 checklist checkpoints (Extension, Hip-shoulder separation) — the only two with any
  calibrated angle target anywhere in the codebase. Expanding that requires either real coaching
  research to calibrate more targets, or accepting that most checkpoints stay illustration-only.

**Product / business**
- The competitive positioning worked out this session (full-mechanics diagnosis + coach-verified
  trust + team workflow + pitch-context awareness, vs. Blast Motion's precise-but-narrow bat
  kinematics and WinReality's fully-automated model) is real and defensible, but untested with any
  actual customer outside your own two teams.
- If monetization is pursued: team-first/seasonal pricing was the recommendation, undercutting
  competitors' per-player model for the specific underserved segment (volunteer rec/travel teams).
  This assumes a real SaaS layer (accounts, billing, tenancy) that doesn't exist yet — treat that as
  its own project phase, not an incremental add to the current static-report or coach-app systems.
- The "insightful analytics" direction (cross-checkpoint correlation, real computed bat-speed/
  attack-angle evidence) is a genuine differentiator versus competitors, but is currently proven on
  exactly one real player's data (Emily C, 4 logged at-bats, 1 high-confidence swing). Worth being
  honest with yourself about sample size before presenting this as a mature capability to anyone
  outside the project.

**Process**
- Two mid-session pivots this session both traced back to not checking recent git history / the
  repo's own top-level directories before starting substantial work. Cheap to check, expensive to
  skip — worth treating as standard practice going forward, not a one-off lesson.
