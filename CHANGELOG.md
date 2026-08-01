# Changelog

All notable changes to this project are documented here, following
[Keep a Changelog](https://keepachangelog.com/en/1.1.0/). This file starts 2026-08-01 — see
`NEXT_STEPS.md` (and its own git history) for the detailed narrative of everything before that.

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
