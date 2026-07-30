# Open Items, To-Dos, and Future Considerations

Snapshot as of 2026-07-30 (updated after the mobile UX rebuild, Latham/Emily C's Supabase
migration, the BarrelIQ rebrand, a performance/scale review, a skeleton bone-length rigidity fix,
an untracked-frame rendering bug fix, a multi-clip switcher, delete-at-bat, interactive camera
rotation, a processing-status polling/microrefresh fix, a Capacitor Android wrap, and a
swing-locating pre-pass for the pose3d pipeline - see below). This file is a working status doc,
not permanent documentation — prune or rewrite sections as they get resolved rather than letting
it accumulate stale entries.

## Pose3D pipeline: swing-locating pre-pass (Stage 0) (2026-07-30)

Real coach uploads are full continuous at-bat recordings (walk-up, multiple pitches, dead time
between pitches) - not pre-trimmed single-swing clips - but the pipeline ran two full YOLO passes
over EVERY frame of whatever got uploaded, so a several-minute upload meant several minutes of GPU
compute, almost all of it on dead time. New `scripts/pose3d/locate_swing.py` (Stage 0, runs before
`detect_2d.py`): for clips over 60s, extracts the audio track, high-pass filters it (1000Hz,
zero-phase), computes a short-time energy onset envelope, and looks for one confident, isolated
bat-crack transient. If found, trims to a 12s window around it (ffmpeg re-encode, not stream-copy,
for frame-accurate cuts) and only that window gets analyzed. Falls back to today's exact full-clip
behavior (never a guess) whenever the audio is missing, silent, or ambiguous (e.g. multiple
similarly-loud transients - a foul ball plus the real contact).

Chose audio over a cheaper/faster vision-based pre-pass deliberately: a lighter model over the same
footage has the identical blind spot as the full-resolution model it would be protecting (see the
diagnosed clip below - 0.62% tracked frames), whereas audio doesn't depend on visual
resolution/focus at all.

- [x] **Verified for real, not just code review**: (a) a known-good 42s clip runs completely
      unchanged (Stage 0 skips itself entirely below the 60s threshold; re-ran the full pipeline
      and diffed `metrics.json` against the pre-existing baseline - identical contact
      frame/time/confidence). (b) The real diagnosed failing clip (`Emily_C_AB1_game2`, 465s)
      correctly and honestly falls back - found 6 similarly-loud candidate audio peaks (top=1.00,
      runner-up=0.96), correctly declined to guess, in 1.5s. (c) Built a synthetic clip (40s of
      black/silent padding + a known-good 42s clip, known contact time) to verify actual trimming
      + frame-index alignment: Stage 0 found a confident onset ~1s off from the clip's own
      (already low-confidence) video-based contact estimate - expected, since these are two
      different signals - but after re-running the full pipeline on the trimmed window, the
      reconstructed absolute contact time matched the original untrimmed clip's own contact
      detection to within **83 milliseconds**. Visually confirmed via the overlay video that the
      "CONTACT" marker lands on the real swing, not the padding.
- [x] **Small companion fix found along the way**: `processUploadQueue.ts`'s `runPipeline()` never
      forwarded `child.stdout` anywhere (only `stderr`, only surfaced on failure) - meant none of
      the `[detect_2d]`/`[metrics]`/`[overlay]`/now `[locate_swing]` progress prints were ever
      visible to anyone tailing the Node worker's console, success or failure. Fixed with one
      `child.stdout.on("data", ...)` forward.
- **Known, stated-plainly limitation**: this doesn't fix the diagnosed clip's own underlying
  problem (camera too far/blurry to reliably track the batter at all, confirmed by visually
  comparing frames against a clip that succeeded) - it makes failure fast instead of failure slow
  for clips like that. Real speedup only shows up once a clip's audio cooperates and its footage
  is actually trackable.
- **Not done**: friendlier user-facing error messaging for the "cannot locate contact" case (still
  a raw Python exception string in the coach UI today) - discussed as a separate, smaller follow-up,
  not yet requested/built.

## Capacitor native app wrap - Android working, iOS pending (2026-07-30)

Goal: ship the coach app as real installable Android/iOS apps (App Store/Play Store bypassed
entirely - Ad Hoc for iOS, direct APK share for Android), testable locally via emulator/simulator.
Full plan at the time: `mobile/` subdirectory, Capacitor 6.2.1 pinned (not latest - the only Mac
available for iOS work is a Mid-2017 MacBook Pro capped at macOS Ventura -> Xcode 15.2, and
Capacitor 7+ requires Xcode 16; confirmed via two independent searches). Ad Hoc distribution was
confirmed (also via search) to NOT require Apple's April 2026 Xcode 26/iOS 26 SDK mandate, since
that mandate only applies to App Store Connect uploads (which includes TestFlight, confirmed via
real developer bug reports - but not true Ad Hoc, which never touches App Store Connect).

- [x] **Android: scaffolded and verified working end-to-end**, this session, on a real local
      emulator (not just code review). `mobile/package.json` + `capacitor.config.json`
      (`webDir: "../coach"` - no duplication of the existing web app), `coach/config.js` given a
      `window.Capacitor.isNativePlatform()` branch so it uses the dev machine's LAN IP instead of
      `window.location.hostname` (which resolves to the device itself inside a native shell, not
      the machine running Supabase/Docker).
  - Installed the Android SDK **command-line tools only** (no full Android Studio GUI needed) -
    fully scriptable: downloaded `commandlinetools-win`, accepted licenses, installed
    platform-tools/build-tools/an API 34 platform+system-image/emulator via `sdkmanager`, created
    an AVD via `avdmanager`. Android Studio itself is still worth installing for a normal IDE
    workflow going forward, but wasn't required to get this far.
  - **Real bug found and fixed, not anticipated by the original plan**: login failed with "Failed
    to fetch" on the emulator even after the Android Network Security Config's cleartext exception
    was in place. Root cause (found via `adb logcat`, not guessed): the WebView's separate **Mixed
    Content** policy was blocking the HTTPS app shell (`https://localhost`, Capacitor's default)
    from calling the plain-HTTP local Supabase stack - a different restriction than the OS-level
    Network Security Config, which only governs cleartext at the network-stack level, not the
    WebView's own mixed-content blocking. Fixed via `"android": {"allowMixedContent": true}` in
    `capacitor.config.json` (Capacitor's `android.allowMixedContent` config key, confirmed by
    reading `@capacitor/android`'s own `CapConfig.java` source directly rather than guessing).
    Dev-only setting - moot once pointed at a real hosted (HTTPS) Supabase project.
  - Also needed: `AndroidManifest.xml` camera/video permissions
    (`CAMERA`/`READ_MEDIA_VIDEO`/`READ_EXTERNAL_STORAGE`) for the plain `<input type=file>` video
    picker, and `network_security_config.xml` with a cleartext exception scoped to the dev LAN IP
    only (flagged to remove before any real release build).
  - `npx cap run android` itself fails on this Windows/Git-Bash setup (`'gradlew' is not
    recognized` - a known Capacitor-CLI-on-Windows spawn quirk with `.bat` resolution); worked
    around by driving `gradlew.bat assembleDebug` + `adb install`/`adb shell am start` directly.
  - **Verified for real**: booted an AVD, installed the debug APK, and drove the UI via `adb shell
    input` (not just a static screenshot) - confirmed sign-in with a real test coach account
    succeeds over the LAN IP, the team list loads real Supabase data (Thunder 10U, Latham Lady
    Bison White 10U), and opening a team renders its real roster with real per-player checkpoint
    scores. This confirms the full auth + Postgrest read path works natively, not just that the
    app boots.
- [ ] **iOS: not yet started** - needs the Mac (Xcode 15.2 + CocoaPods install, `npx cap add ios`,
      `Info.plist` camera/photo-library usage strings + an ATS exception for the dev LAN IP, run on
      Simulator). Documented as a full runbook in the approved plan
      (`C:\Users\jonmc\.claude\plans\logical-yawning-gosling.md` at plan time - copy the relevant
      steps into a repo-tracked doc if this needs to survive past the current Claude session). The
      Mixed Content fix above is Android-specific (WebView-level); iOS's WKWebView has its own ATS
      mechanism instead, already anticipated in the plan but not yet verified against real
      hardware.
- [ ] **Not done yet**: real app icons (current `coach/icons/*.svg` are placeholder), Ad Hoc/APK
      distribution setup (Phase 4 of the plan - includes one open decision on where to host the
      iOS OTA `.ipa`/manifest, deliberately deferred rather than assumed), and vendoring
      `@supabase/supabase-js` locally instead of the `esm.sh` CDN import in `coach/shared.js`
      (Phase 5, recommended hardening, not blocking).

## Processing-status polling caused full-page "microrefresh" (2026-07-30)

User reported the whole game log page kept flickering/rebuilding every few seconds after an
upload, causing eye strain, and asked for a real progress indicator plus an end to the refresh.

**Root cause**: `startStatusPolling()` called the full `loadGameLog()` (which does
`el.innerHTML = ...` on the entire `#gameLogList`) every 10s whenever *any* clip anywhere was
in-flight - tearing down and rebuilding every card and skeleton canvas on the page regardless of
which clip actually changed.

- [x] **Fixed**: replaced the old `hasInFlightClips` boolean with an `inFlightClips` Map
      (clip id -> game_log_entry_id), populated for every pending/processing clip (not just the
      active tab) in `loadClipsForEntry`. `startStatusPolling()` now runs a targeted
      `.in("id", clipIds)` query against only in-flight clips, and for each one that finished
      updates just that tab's status-dot class and, only if it's the active tab, re-renders that
      one clip's mount - the rest of the page is never touched.
- [x] **Added a real progress indicator**: CSS spinner + a client-side `startElapsedTicker()`
      that increments a `[data-elapsed]` label every second from the clip's actual `created_at`
      (no fabricated percentage, since the pipeline has no real progress-fraction signal).
- [x] **Verified with real browser tests** on disposable Thunder/Maddie R test at-bats (never
      touching Emily's data): tagged an unrelated pre-existing card with a unique DOM marker,
      waited past a full 10s poll tick, and confirmed via `page.evaluate` the marked node still
      existed (proving no full-list rebuild); confirmed the elapsed label incremented correctly
      over real wall-clock time; confirmed a clip transitioning pending -> ready re-renders in
      place (screenshot) without disturbing sibling cards.
- Local dev infra also needed a restart during this work: `gcs-emulator` and the
  `get-upload-url` edge function had silently exited, and `process-upload-queue` wasn't running
  at all - see [[coach_app_supabase_architecture]] for this recurring gotcha.
- **Flag, not fixed**: while monitoring the queue, found a pre-existing failed clip on Emily's
  real player record (`opponent="Other", ab=1, date=2026-07-23`) that doesn't match any of her
  real logged at-bats - looks like leftover test/reproduction data from earlier session work, not
  caused by this fix. Left in place (shows as a normal "failed" clip with existing Retry/Delete
  Pitch buttons) pending the user's call on whether to delete it.

**Round 2 - user reported it still refreshed ~10s after uploading.** Two real, separate causes
found:
1. `wireGameLogDelegation()`'s Attach Video / Retry / Delete Pitch / Delete At-Bat / Add Pitch
   handlers all still called the full `loadGameLog()` on success (only `startStatusPolling()`'s
   own 10s tick had been fixed in round 1). Since a real upload takes several seconds, the
   post-upload full rebuild landed close enough to "10 seconds after uploading" to look like the
   same bug. Fixed by switching all five to `loadClipsForEntry(gameLogEntryId, ...)` (targets just
   that entry's mount) except Delete At-Bat, which now just removes its own `.card` element
   directly (`deleteAtBatBtn.closest(".card")?.remove()`) since that whole card is what's actually
   gone. The "Log AB" new-at-bat flow (`openLogAbModal`) still calls full `loadGameLog()`
   deliberately - a genuinely new card needs to be added to the list, which isn't a targeted-update
   case.
2. **`coach/sw.js`'s service-worker cache had never been bumped all session** (`CACHE_NAME` stayed
   `"barreliq-coach-v1"` through every player.html change this session - multi-clip switcher,
   delete-at-bat, camera rotation, round-1 polling fix). Since the SW's fetch handler is
   cache-first and its own bytes hadn't changed, browsers with an already-registered SW kept
   serving the stale precached `player.html` indefinitely - this is why the round-1 polling fix
   verified fine in a fresh Playwright browser (no prior SW registration to be stale) but a real
   persistent browser session could still be running old code. Fixed: bumped `CACHE_NAME` to `v2`,
   and added `self.skipWaiting()` (install) + `self.clients.claim()` (activate) so a new deploy
   takes over on the very next reload instead of requiring every open tab to be closed first.
   **Any future `coach/*` change needs `CACHE_NAME` bumped in `sw.js` to actually reach browsers**
   with the app already installed/open - easy to forget, as this session just demonstrated.
- Verified the targeted Attach-Video fix with a real browser test (DOM-marker technique again) -
  first attempt showed the marker wiped, which looked like the fix hadn't worked, but the console
  log `"Live reload enabled."` gave it away: VS Code Live Server was reloading the test's own
  browser tab because I was actively editing `player.html`/`sw.js` concurrently with the test run.
  Re-ran with no concurrent edits and the marker survived cleanly - confirms the fix is correct;
  the false failure was a test-methodology artifact (don't run browser verification while actively
  saving the file being tested), not an app bug.
- **Separately noticed while testing**: `Emily_C_AB1_game2.mp4` is a real ~1080p/30fps, ~7:45
  (465s) video - far longer than a single pitch - which is both why it's slow to process (full
  pose3d inference over ~14k frames) and may be why it previously failed with `metrics.json has no
  "phases" key` (the phase detectors likely assume a single swing, not a multi-swing/long
  recording). Not investigated further or fixed this round - flagged for the user, since it may
  simply be the wrong file (untrimmed footage instead of a single at-bat clip).

## Interactive camera rotation for the 3D skeleton view (2026-07-30)

Asked for a second opinion (fed to Gemini) on whether to attempt a synthesized "future state"
corrected full-swing skeleton animation, vs. staying strictly text/illustration-based for the 9
checkpoints outside the existing Tier-1 FK correction. Gemini's answer: don't attempt full-swing
synthesis (multi-joint IK without ground/balance constraints would produce anatomically broken
results, similar to the untracked-frame bug already fixed), keep the existing 3-tier system, and
instead add interactive camera rotation to the real reconstructed skeleton - a genuine, previously
unaddressed gap, not new advice (this was already flagged as an open item in the earlier
bone-rigidity review). Checked the recommendation against the actual code before trusting it: the
tiered system it describes already exists exactly as stated (not new advice, same as the earlier
external proposal's pattern), and the camera-rotation suggestion is architecturally sound -
`drawFigure()`/`project()` in `skeletonRenderer.js` already take a `camera` object as a plain
parameter rather than a hardcoded constant, so this was a real, well-contained addition, not a
rewrite.

- [x] **Implemented**: new `attachDragToRotate()` in `skeletonRenderer.js` - pointer-drag
      (mouse + touch via Pointer Events) adjusts a shared mutable `camera.yaw`/`camera.pitch`
      (pitch clamped to +-1.3 rad to avoid a disorienting near-upside-down flip), re-rendering the
      current frame. Wired into both `renderSkeletonComparison` (the main scrubber - both real and
      corrected panels share one camera object, so rotating one rotates both in sync, keeping the
      side-by-side comparison meaningful) and `renderSkeletonFrameToCanvas` (the Tier-2 static
      snapshot). Each mount gets its own camera clone (not the shared `DEFAULT_CAMERA` constant),
      so multiple game-log cards on one page rotate independently. Added a "Reset View" button and
      updated the disclaimer text that used to say rotation "isn't available here."
- [x] **Verified with a real drag interaction, not just code review**: since Emily's real pose3d
      data is gone (deleted during the delete-feature testing above, left deleted per the user's
      choice) and the Thunder fixture clip never had real pose3d data, built a small synthetic
      (clearly-fake, disposable) 17-joint test fixture to verify against - confirmed the figure
      visibly rotates to a different angle on drag and "Reset View" restores the exact original
      pose, via screenshots, before cleaning up the test fixture.

## Delete At-Bat (2026-07-29)

Added a "Delete At-Bat" button to each game-log card (distinct from "Delete Pitch," which removes
one physical clip within an at-bat) - removes the whole `game_log_entries` row, which cascades via
existing FK constraints to remove every pitch clip and all its 3D data for that at-bat in one
operation. Verified with a real browser test (network request captured directly: a correctly-
scoped `DELETE .../game_log_entries?id=eq.<uuid>`, not a broad/unfiltered delete) against a
disposable throwaway at-bat, never against real data.

**Real data was lost during this work, but not from a bug**: while testing the new delete buttons,
the user deleted Emily C's real 7 video clips through the UI directly. Investigated first
(captured the actual network request the delete button sends) before assuming a bug - confirmed
both delete features work exactly as designed (properly scoped by UUID). User confirmed leaving
the deletion as-is rather than restoring it. If this needs restoring later: the underlying pose3d
pipeline output still exists locally (`frames/emily_c/*`), so re-ingestion (`ingest-pose3d-frames`
+ `ingest-phases` per clip - see [[latham-emily-c-supabase-migration]]) would restore it without
re-running the Python pipeline.

## Multi-clip switcher for the game log (2026-07-29)

An external spec (`video_processing_spec.md`, brought to review) proposed tabbed clip switching,
incremental uploads, deletion, and fixing "Compare against Reference Comp"'s stale context. The
design was sound but the code had 5 real bugs (verified against the actual codebase, not accepted
at face value): a delete button reading the wrong `dataset` key (would never work), a
`game_log_entry_id` used but never selected in the query, two CSS variables that don't exist in
this palette, a tab-click handler re-fetching the per-player extension score on every click
(reintroducing an N+1 pattern fixed earlier the same day), and an unnecessary clips-list refetch
per tab click.

- [x] **Implemented with all 5 bugs fixed**: `loadClipsForEntry` now fetches all of an entry's
      clips and renders a tab per clip (status dot: green/ready, pulsing amber/processing, solid
      amber/pending, red/failed) plus an always-visible "➕ Add Pitch" button (fixes the upload
      lockout). New `renderActiveClip(clipMount, gameLogEntryId, clip, extensionScore)` takes the
      real id as a parameter instead of reading a column that was never selected.
      `wireGameLogDelegation` handles tab switches (re-rendering from a cached `clipsByEntry` map,
      no re-fetch), incremental uploads (reuses `uploadRawClip`, which already assigns `position`
      correctly), and delete (`deleteBtn.dataset.deleteClip`, matching the actual
      `data-delete-clip` attribute this time). CSS reuses the existing chip/pill visual language
      (`--surface-1`/`--border`/`--clay`, all real variables) instead of inventing new ones.
      `currentExtensionScore` is now a page-level variable set once by `loadGameLog()`, read
      directly by the tab handler - no re-fetch per click.
- [x] **Verified end-to-end with real browser interaction, not just code review**: tab switching
      renders genuinely distinct skeletons per pitch (screenshotted both states); delete removes
      the real DB row (tested against a disposable throwaway clip, never Emily's real data) and
      updates the tab count live; "Add Pitch" opens a real file chooser; switching tabs and then
      opening "Compare against Reference Comp" on a checkpoint renders the newly-active clip's
      skeleton, confirmed via screenshot.
- [ ] **Known, accepted limitation carried over from the design**: `firstClipContext` (the shared
      "reference comp" context) can still be silently reassigned by a background poll reloading a
      *different* game-log entry's already-ready clip, not just explicit tab clicks. Fixing that
      fully would need a per-checkpoint-card reference instead of one shared global - a bigger
      change, not done this pass.

## Skeleton rendering quality, part 2: untracked frames rendered as real data (2026-07-29)

Caught directly from a real rendered screenshot (an anatomically impossible crossed-arm pose),
not a code-review guess - the user flagged it as "the worst thing built" and was right to.

- [x] **Root cause found and measured, not assumed**: the pipeline stored and rendered EVERY
      frame from `pose_3d.json`, including frames where `tracked: false` (the 2D detector found no
      real person at all). VideoPose3D still emits SOME coordinates for those frames - degenerate/
      carried-forward garbage, not real inferred positions - and nothing downstream (smoothJoints,
      rigidifySkeleton, the renderer) ever checked the flag. Measured per real clip, not assumed
      uniform: `Emily_C_AB1 (1)` was 89% tracked (a garbage tail once the batter left frame);
      `Emily_C_AB2` was 35% tracked (a real ~2,494-frame swing plus a lot of real dead time in a
      long continuous at-bat); `Emily_C_AB1_game2` was **0.6% tracked** - its rendered "swing" was
      never real data at all.
- [x] **Fixed**: new `src/services/pose3d/trackedFrames.ts` - extracts the single LONGEST
      contiguous run of `tracked==true` frames per clip (not the union of every tracked frame
      regardless of position, which would stitch scattered fragments into a timeline with visible
      jump-cuts). Below `MIN_TRACKED_FRAMES` (30, ~1s) in its longest run, a clip gets NO pose3d
      row at all - the existing "no 3D swing data available" UI state already handles that
      honestly. Wired into both `processUploadQueue.ts` and `ingestPose3dFrames.ts`, before
      smoothing/rigidifying (so the bone-length reference is now also computed from only real
      data). Added `deletePose3dFrames()` to clean up stale rows from before this fix existed.
- [x] **Verified against real data**: re-ingested all 7 of Emily's clips - every stored clip now
      has exactly 0 untracked frames (checked directly, not assumed from the code).
      `Emily_C_AB1_game2` still gets a row (its longest run is 38 frames, just above the
      threshold) since it's real data, just not a swing - honest, not misleading, even though not
      very useful. Visually confirmed the real, high-confidence contact frame (frame 1283,
      `metrics.json`'s own contact detection) renders an anatomically sound load/stance pose.
- [ ] **Known remaining limitation, not fixed, honestly flagged**: a frame can be `tracked: true`
      (a real person was detected) and still be a bad 3D lift or a left/right limb-swap during
      rapid rotation - `tracked` means "something real was detected," not "the pose is anatomically
      correct." This was already called out as an open risk when reviewing an external pose-model
      proposal earlier the same day, and it's still true after this fix. Scrubbing to a moment
      late in a clip (well after any real swing action, e.g. the batter walking/adjusting) can
      still show an odd-looking but real-data pose - a materially different problem than the one
      just fixed (real-but-unremarkable vs fabricated-and-wrong), but worth knowing it isn't fully
      solved.

## Skeleton rendering quality, part 1: bone-length rigidity fix (2026-07-29)

A proposal (from an external source, brought to review) argued the 3D skeleton render "looks
terrible" and suggested swapping detectors (RTMPose/MMPose), adding a custom bat-keypoint model,
switching lifters (MotionBERT), applying temporal smoothing, enforcing fixed bone lengths, and
rendering with Three.js/WebGL instead of Canvas2D.

- [x] **Analyzed against what's actually here, not accepted at face value.** Read
      `scripts/pose3d/detect_2d.py`/`lift_3d.py` directly: RTMPose/MMPose was already attempted
      and rejected for this environment (`mmcv` has no prebuilt wheel for this machine's torch
      build, and building from source needs an MSVC+CUDA toolchain that isn't installed).
      MotionBERT was also already evaluated and rejected (OneDrive-hosted checkpoint behind
      interactive auth, Halpe-26 format mismatch). VideoPose3D is exactly what's running today. A
      real bat detector (YOLOv8 COCO "baseball bat" class + ByteTrack, tip/knob estimated from box
      geometry) already exists. One-Euro temporal smoothing is already applied twice (2D keypoints
      + bat path, and again after 3D lifting with separately re-tuned constants). Most of the
      proposal was already built or already tried and rejected for documented reasons - re-doing
      it wouldn't have fixed anything.
- [x] **Found the real, measured root cause: bone-length instability, not detector/lifter
      quality.** Measured real bone lengths across all 1,871 frames of a real ingested clip before
      touching anything: forearm length varied ~97% of its own mean, hip-knee ~91-95% - a visibly
      broken, stretching/shrinking skeleton. Root cause: `smoothJoints.ts`'s One-Euro filter
      smooths each of the 17 joints' x/y/z completely independently, with nothing constraining the
      DISTANCE between a joint and its parent.
- [x] **Fixed**: new `src/services/pose3d/rigidifySkeleton.ts`, run after `smoothJoints()` (which
      stays unchanged - still handles timing). Takes each bone's median observed length across the
      whole clip as a fixed per-clip reference, then reconstructs every frame's joints top-down
      from the root, reusing each frame's observed bone DIRECTION but replacing its LENGTH with
      the reference - the same forward-kinematics idea `fkCorrection.js` already uses for its 2
      corrected checkpoints, applied generally. Wired into both `processUploadQueue.ts` and
      `ingestPose3dFrames.ts`; `video_clip_pose3d.smoothing_method` now records
      `"one_euro_v1+rigid_v1"` so old vs new rows are distinguishable.
- [x] **Verified, not assumed**: re-measured the exact same clip after the fix - every bone length
      is now exactly constant (0.0% variance, down from 66-97%) across all 1,871 frames.
      Re-ingested all 7 of Emily's real clips and visually confirmed via real screenshots at 5
      points across the swing that limb proportions stay consistent (no stretching/shrinking)
      end-to-end through the actual coach app.
- [ ] **Not done, and a real, open question, not a rejected idea**: Three.js/WebGL with
      orbit-rotate camera vs the current fixed-camera Canvas2D orthographic projection. This is a
      genuine capability gap (a coach can't currently rotate the view), just probably a smaller
      contributor to "looks terrible" than the bone-length bug was - worth reconsidering once the
      rigidity fix has had a chance to be judged on its own.
- [ ] **Deliberately not pursued**: SMPL-X/BEDLAM parametric body-mesh fitting. Real, heavy addition
      (per-frame differentiable fitting, GPU cost, another dependency) - no concrete evidence yet
      that skeleton-only (now rigid) isn't sufficient for this app's coaching-cue purpose.

## Performance/scale review + fixes (2026-07-29)

Reviewed for "what breaks at hundreds/thousands of videos/users" and fixed in priority order:

- [x] **Missing FK indexes** (migration `00011_fk_indexes.sql`) - Postgres auto-indexes primary
      keys, not foreign keys; `players.team_id`, `game_log_entries.player_id`, `issues.player_id`,
      `comp_recommendations/comp_notes/drill_recommendations.player_id`, and
      `checklist_score_history.checklist_score_id` had none. Every RLS policy check re-runs these
      same lookups per row, so this hits twice as hard as it looks. Applied via
      `supabase migration up` (not `db reset`) to avoid wiping real data.
- [x] **N+1 query patterns in the coach app** - `team.html`'s `loadPlayers()` and
      `appShell.js`'s `loadRosterWithProgress()` did 2 sequential queries *per player* (a
      20-player roster = 40+ round trips); batched into 2 queries total via `.in("player_id",
      [...])` + client-side grouping. `player.html` was also re-fetching the player's
      (player-wide, not per-clip) extension score inside the per-clip loop - hoisted out to once
      per page load, and the per-entry clip-loading loop now runs concurrently
      (`Promise.all`) instead of sequentially. Deliberately did NOT convert the 10s status-polling
      to Supabase Realtime (bigger, separate piece of work; polling is already self-limiting -
      only fires while something's actually in-flight).
- [x] **Video processing queue concurrency** - turned out the existing
      `claimNextPendingClip()` was already race-safe for multiple concurrent workers (a real
      atomic conditional `UPDATE`, verified against the real local Postgres, not assumed from the
      code comment) - the actual gap was a crashed/killed worker leaving a clip stuck in
      `'processing'` forever with no recovery. Fixed: a clip stuck past
      `UPLOAD_QUEUE_STALE_CLAIM_MINUTES` (default 15) becomes reclaimable, verified with a real
      insert-stale-row-then-reclaim test against the local DB (including confirming a second
      immediate reclaim attempt correctly still fails). Real throughput at volume should come from
      running this same worker on multiple separate machines (already safe), not from
      parallelizing within one process - pose3d inference is GPU/CPU-bound, so N copies on one
      machine would just compete for the same GPU.
- [x] **`video_clip_pose3d.frames` JSONB bloat** - moved the bulky, uniform joint-position data
      (real observed size: ~14,000 frames for one clip) out of JSONB into a packed Float32 `bytea`
      column (`joints_blob`, migration `00012`), decoded browser-side back into the exact same
      in-memory shape the renderer/FK-correction code already expects, so nothing downstream had
      to change. **Correction to the original review's estimate**: measured via real HTTP
      payload size (not `pg_column_size`, which reports Postgres's own on-disk TOAST-*compressed*
      size and is the wrong metric for what the browser actually downloads/parses) - the real win
      is ~1.9x smaller (48%), not the ~5x originally estimated, because hex-encoding bytea for
      JSON/REST transport costs a 2x expansion tax that eats into the theoretical binary-packing
      win. Still a real, meaningful reduction, just smaller than hoped - a true binary
      transport (e.g. a dedicated blob store) would need to replace the JSON/REST path entirely to
      get closer to the full win, which is a bigger, separate architecture change.
- [x] **Local disk cleanup** - `processUploadQueue.ts` now deletes the downloaded raw video copy
      (`videos/_uploads/...`) once a clip is marked ready (GCS still has the authoritative copy).
      Deliberately does NOT delete `frames/<player>/<clip>/`'s other outputs - `overlay.mp4` is
      what a coach needs to watch for the still-open public-skeleton-render sign-off item below,
      and `pose_3d.json`/`metrics.json` let re-ingestion happen later without re-running the whole
      pipeline.
- [ ] **Not done, deliberately deferred**: pagination (team roster/game log fetch everything
      unbounded - fine at today's roster sizes), a batch/"regenerate all reports" CLI mode
      (`generate.ts`/`migrate.ts` are one-report-at-a-time), and the Realtime conversion mentioned
      above.

**A real, serious bug found and fixed while verifying the above, unrelated to the scale work
itself**: `migrate.ts`'s `replaceGameLogs()` used to `DELETE` every one of a player's
`game_log_entries` rows and re-`INSERT` fresh ones (new random ids) on every run. Since
`video_clips.game_log_entry_id` references `game_log_entries` `ON DELETE CASCADE`, simply
re-running `migrate.ts` again - e.g. after an unrelated edit, which is exactly what happened
during this session's rebrand verification - silently destroyed every already-ingested clip's
video/pose3d data for that player. Found by checking real row counts after a routine re-migration,
not assumed safe from the function's own "safe to re-run" docstring claim. Fixed with a real
`unique (player_id, date, opponent, ab)` constraint (migration `00013`) and rewrote
`replaceGameLogs` to upsert by that natural key - re-running `migrate.ts` now preserves the same
`game_log_entries.id` (and therefore any video_clips/pose3d hanging off it) for an at-bat that
already exists, only removing entries that are genuinely no longer in the report. Verified by
re-running `migrate.ts` a second time and confirming a clip's data survived this time, then
re-ingested the 6 clips lost before this fix was in place (all 7 of Emily's clips are whole again).
**This bug would have hit Bethlehem Boom 10U's eventual migration too** (any coach editing a report
and re-running `migrate.ts` would have silently lost ingested video data) - worth knowing this is
now fixed before that migration happens, not something to re-discover the hard way again.

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
- [x] **Rebranded the whole product to "BarrelIQ"** (chosen after screening candidates for
      obvious trademark/product-name conflicts - not a substitute for a real USPTO search, see
      the conversation this was decided in). Scope: the private coach app (manifest.json,
      page titles, login screen header, service-worker cache name) AND the public GitHub Pages
      reports/*.html site (every report's `<title>`/`<h1>` - was "Swing Scouting Report — Name" /
      "Team Swing Overview — Name", now "BarrelIQ Swing Report — Name" / "BarrelIQ Team Overview
      — Name"), plus `package.json`'s name. Deliberately did NOT rename the GitHub repo itself
      (would break the live Pages URL again, same as the earlier `bethlehem-boom-10u-scouting` →
      `player-scouting-report` rename - see [[distribution-approach]]) - the repo stays
      `jonmcurry/player-scouting-report`. Updated the two regexes in `migrate.ts` that parse
      these exact strings (`extractPlayerNameAndJersey`, `extractTeamName`) AND
      `scripts/generate_team_reports.ps1`'s two hardcoded `.Replace()` calls that had the OLD
      text baked in (would have silently no-op'd otherwise - the same stale-`.Replace()`-target
      bug class already documented in [[multi-team-architecture]]). Re-verified: `migrate.ts`
      parses the new title correctly, and `build:reports`'s round-trip is still byte-identical
      except for the intended title/header lines.
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
