# Open Items, To-Dos, and Future Considerations

Snapshot as of 2026-07-28. This file is a working status doc, not permanent documentation — prune
or rewrite sections as they get resolved rather than letting it accumulate stale entries.

## Open / needs a decision

- **Is `scripts/pose_to_checklist.py` (MediaPipe-based) still wanted?** It's fully superseded by
  `scripts/pose3d/pose3d_to_checklist.py` (same output shape, better underlying pipeline), but it's
  already committed to git, so removing it is a deliberate call, not cleanup of scratch work.
  `scripts/pose_out/emily_c_windows.json` (its hand-authored sidecar) is in the same boat.
- **Emily C's skeleton render needs a coach's actual sign-off before it can go anywhere public.**
  `scripts/pose3d/render_public_skeleton.py` has produced a validated render for her one
  high-confidence clip (`Emily_C_AB1 (1)`), sitting in a scratch/local location — nobody has
  watched the paired `overlay.mp4` and set `approvedBy` in `render_manifest.json` yet. Until that
  happens, `check_publish_gate.py` will keep refusing to let it be embedded anywhere, by design.
- **Do the new report features (At-Bat Outcome Correlation, kid-facing trend callout) get ported
  into the Supabase schema, or stay HTML-only?** They're live on `emily_c.html` and in
  `_individual_report_template.html`, but Latham isn't in Supabase yet (confirmed by querying the
  live local DB), so there's no `generate.ts`/schema equivalent. If/when Latham migrates, these
  either need a schema home or they'll quietly not exist in the new system.
- **Pricing model direction** (team-first SaaS, seasonal billing, undercut WinReality's per-player
  pricing) was discussed and is a real recommendation, but nothing has been decided or built —
  no billing, no accounts, no tiering exists anywhere in this codebase yet.

## Still to do (concrete, near-term)

- Get a coach (you) to actually watch `frames/emily_c/Emily_C_AB1 (1)/overlay.mp4` and either
  approve or reject the paired skeleton render — this is the one manual step blocking Part 1 of
  the pose3d evidence work from being genuinely "done," not just built.
- Re-run `scripts/pose3d/render_public_skeleton.py` for any of Emily's other clips if more
  contact-confidence-"high" swings get filmed/reprocessed — right now she has exactly one.
- Decide the `pose_to_checklist.py` / `pose_out/*` question above and act on it (retire or keep).
- If Latham ever gets migrated into Supabase, port the At-Bat Outcome Correlation and trend-callout
  logic into `generate.ts`/the schema at that point — don't let them silently vanish in the
  migration the way the "2-5. Diagnosis, Comps & Plan" section almost did (see
  [[coach-app-supabase-architecture]] memory: it was found only by diffing real report HTML
  end-to-end, not by re-reading the existing schema).
- `readme.md` at the repo root still describes only the old PowerShell/hand-edited-HTML workflow —
  worth a pass once the Supabase migration path for real teams is actually decided, so new
  contributors (or future sessions) aren't misled the way this session initially was.

## Future considerations (bigger, no immediate action needed)

**Architecture**
- This project has changed its core architecture roughly every week (PowerShell generator →
  MediaPipe pose scripts → pose3d YOLO11/VideoPose3D → Supabase-backed coach app). That pace is a
  real asset (fast iteration) but also a real risk for any session (human or AI) that assumes
  "what I remember" is still current — see the `verify-current-architecture-first` memory this
  session wrote specifically because of that.
- Real teams (Bethlehem Boom 10U, Latham Lady Bison White 10U) are not yet in Supabase. Deciding
  *when* and *how* they migrate (all at once vs. incrementally, who does the `migrate.ts` run, what
  happens to already-hand-edited content like Emily's corrected notes) is an open design question,
  not just an execution detail.
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
