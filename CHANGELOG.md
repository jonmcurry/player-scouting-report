# Changelog

All notable changes to this project are documented here, following
[Keep a Changelog](https://keepachangelog.com/en/1.1.0/). This file starts 2026-08-01 — see
`NEXT_STEPS.md` (and its own git history) for the detailed narrative of everything before that.

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
