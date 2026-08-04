# Changelog

All notable changes to this project are documented here, following
[Keep a Changelog](https://keepachangelog.com/en/1.1.0/). This file starts 2026-08-01 — see
`NEXT_STEPS.md` (and its own git history) for the detailed narrative of everything before that.

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
