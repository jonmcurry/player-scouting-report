# BarrelIQ — AI-Assisted Softball/Baseball Swing Scouting

Video-based swing analysis for youth softball/baseball teams: film real game at-bats, run them
through a real pose-estimation pipeline (YOLO11-pose + VideoPose3D), and turn the output into a
per-player scouting report a coach reviews and confirms — checklist scores, a real interactive 3D
swing model, and evidence-weighted diagnosis across multiple real at-bats, not a single cage swing.

Built as a general multi-team tool, not a one-team script — currently used by two real teams (see
[Teams](#teams) below).

- **What's still in flight / open decisions:** [NEXT_STEPS.md](NEXT_STEPS.md)
- **What's actually shipped, version by version:** [CHANGELOG.md](CHANGELOG.md)
- **Changelog/versioning/git conventions for this repo:** [CLAUDE.md](CLAUDE.md)

## Teams

| Team | Roster | Status |
|---|---|---|
| **Latham Lady Bison White 10U** | #10 Emily C | On the coach app (Supabase) - real game log, real uploaded/processed video with pose3d data, real checklist scores |

A fictional "Thunder 10U" team also exists in Supabase for local dev/testing only. Don't assume a
team/player's real data state without checking — query the local Supabase DB directly (`docker exec
supabase_db_softball_analysis psql -U postgres -d postgres -c "select name from teams;"`) rather
than guessing.

There used to be a second, hand-edited static-HTML path (extract frames with PowerShell, hand-edit
a report's embedded JS data arrays, `git push`, GitHub Pages serves the result) that Bethlehem
Boom's report was built on. **That path, its generated report files, and its generator scripts have
been removed** — it's not how this project works anymore. If you land on an old reference to
`reports/`, `generate_team_reports.ps1`, `scripts/teams/*.ps1`, `scripts/extract_frames.ps1`,
`src/cli/generate.ts`, or `src/cli/migrate.ts` in an old commit, comment, or your own memory of this
project, know that it's gone — the coach app below is the only path now.

## Coach app + pipeline

A coach (or team's roster) uploads real game footage through a private, authenticated app; a
worker automatically runs the pose3d pipeline; the coach reviews AI-drafted scores against real
3D-reconstructed swing data and confirms or corrects them.

### What's real today

- **A real Android app** (`mobile/`, Capacitor 6.2.1) wrapping the coach web app (`coach/`) — not
  just "works in mobile Safari," an actual installable APK, verified end-to-end on a real emulator.
  Ad Hoc/APK distribution for now, not on the Play Store. iOS wrap is scaffolded but not yet built
  (needs Mac-side Xcode work).
- **Automated upload → processing**: a coach uploads video in-app (`coach/components/
  videoUpload.js`) straight to GCS; `src/cli/processUploadQueue.ts` polls for pending clips and
  runs the entire pose3d pipeline automatically (swing-locate, detection, 2D→3D lift, metrics,
  ingest) — no manual script-running, no git push, per clip.
- **A real, interactive 3D swing model** (`coach/components/skeletonScene.js`, Three.js/WebGL) — a
  real rigged, skinned humanoid character (`coach/assets/models/batter.fbx`) driven frame-by-frame
  by the player's own real tracked H36M joint data via bone retargeting, not a canned animation and
  not a flat stick figure. Drag to orbit; scrub/play through the real swing.
- **Live, persisted coach editing**: 1-tap checklist score stepper, at-bat/practice-session
  logging, all with real-time Supabase RLS (each coach only sees their own team's data).
- **AI-assisted, coach-verified scoring**: Gemini drafts a checklist score from extracted frames;
  it renders as an unconfirmed "🤖 AI draft" badge until a coach reviews it. If a coach's score
  disagrees with the AI draft, both numbers stay visible — a disagreement is never silently lost.
- **A PWA offline shell** (`coach/sw.js`) — the app shell loads instantly and shows cached data
  offline; live edits still need a connection.
- **Practice sessions**, not just real game at-bats — a separate, simplified logging flow
  (date/rep#/note, no opponent/pitch/result fields) that's excluded from every real-game-only
  metric (Logged ABs, Early Read status, at-bat-outcome correlation) by a `session_type` column, so
  practice reps can never silently pollute game-derived stats.

### What's still missing for "used by anyone, not just me"

No hosted production Supabase project yet (`coach/config.js`'s `PROD_SUPABASE_URL`/`KEY` are blank
placeholders — everything today points at a local dev instance), no billing, no self-service
team/coach signup (a coach account is created by an admin script, `provision-coach`, on purpose —
see below), no age-group benchmarking, no parent-facing read-only view, no public report output at
all right now (see Teams above — Bethlehem Boom has no live report until it's migrated to this
path). See [NEXT_STEPS.md](NEXT_STEPS.md) for what's actively being worked on.

### One-time local setup

```powershell
npm install
npx supabase init      # already done in this repo - only needed once per clone
npx supabase start     # spins up Postgres/Auth/Storage/Studio via Docker; prints local API_URL/keys
cp .env.example .env   # then paste in the URL/keys `supabase start` just printed
```

`supabase start` requires Docker Desktop running. No global Supabase CLI install needed — every
command above is prefixed with `npx`.

For the coach app to reach Supabase from a real device (the Capacitor Android app, or any phone on
your LAN) rather than just `localhost` in a desktop browser:
```powershell
cp coach/config.local.example.js coach/config.local.js   # gitignored - fill in your machine's LAN IP
```

### Local dev loop

```powershell
npx supabase db reset                             # (re)applies supabase/migrations/ + supabase/seed.sql
docker compose up -d gcs-cors-proxy                # local GCS emulator + CORS proxy (brings up gcs-emulator too)
npm run process-upload-queue                       # polls for pending video_clips, runs the pose3d pipeline automatically
```

`process-upload-queue` is a long-running poller (`Ctrl-C` to stop) — leave it running while
uploading/testing through the coach app so real uploads actually get processed. `gcs-cors-proxy`
(not `gcs-emulator` directly) is what needs to be up: the emulator alone answers CORS preflight
requests without the `Access-Control-Allow-Methods` header real browsers require, so the nginx
proxy in front of it (`docker/gcs-cors-proxy.conf`) adds the missing header.

Provisioning a coach account (no self-service signup by design — see
`src/cli/provisionCoach.ts`'s own docstring for why):
```powershell
npm run provision-coach -- --email coach@example.com --team latham-lady-bison-white-10u
```

Finding/cleaning up orphaned GCS uploads (real bytes with no matching `video_clips` row, from a
dropped connection mid-upload):
```powershell
npm run reconcile-uploads                              # report-only by default
npm run reconcile-uploads -- --delete-older-than-days 7 # opt-in cleanup
```

### Building the Android app

```powershell
cd mobile
npx cap sync android
cd android
./gradlew installDebug   # requires an emulator or device already running/connected
```

### Filming at games

- Film **every at-bat**, not just the good or bad ones — a checklist built from a cherry-picked
  swing will mislead more than help.
- Slow-mo still works fine in games: start recording as the pitcher begins her windup, not when the
  bat starts moving — 10U pitch speed gives plenty of reaction time.
- Prefer **1/8 speed** (240fps) over 1/4 (120fps) when light allows; drop to 1/4 or normal speed at
  dusk/under weak field lights, where a dim 1/8 clip comes out dark and noisy.
- Shoot from a consistent spot each game (behind the backstop is usually best for both stance and
  swing plane) — this pipeline has no real camera calibration (see below), so consistency matters
  more than it might seem.

### The pose3d pipeline itself

`scripts/pose3d/` — YOLO11-pose (person/keypoints) + YOLOv8 bat detection/ByteTrack + One-Euro
smoothing + rigid FK bone-length correction + VideoPose3D 2D→3D lift. Runs in its own isolated
venv (`.venv_pose3d` — see `scripts/pose3d/README.md` for one-time setup: heavy, torch/CUDA, a
cloned VideoPose3D repo, a downloaded checkpoint). Per clip, produces: an audio-located swing
window (trims a long full-at-bat upload down before the expensive stages run), 2D/3D keypoints, bat
tip/knob tracking, and `metrics.json` — real bat speed/attack angle in body-relative units (no
camera calibration exists for this footage, so no fabricated mph), hip-shoulder separation,
lead-elbow angle, stride, torso/pelvis tilt, and an auto-detected contact instant with an honest
`confidence: "high"|"low"` flag.

Run it directly (outside the coach app's automated worker) against an already-downloaded clip:
```powershell
./scripts/run_pose3d.ps1 -VideoPath "videos/emily_c_ab1.mp4" -PlayerName emily_c
```

**Known, real limitation** (not yet fixed, see [NEXT_STEPS.md](NEXT_STEPS.md)): this pipeline has
no real camera calibration. `lift_3d.py`'s `WORLD_ROTATION` — a single fixed rotation borrowed from
VideoPose3D's own demo/visualizer code — can produce an implausible torso-tilt reading for some
real camera angles. Confirmed on real footage: 2D tracking was accurate and the batter was
genuinely upright the whole clip, but the reconstructed `torso_tilt_from_vertical_deg` read 48-70°
regardless. The coach app's 3D model works around this at the display layer (a per-clip
"auto-level" rotation); the underlying stored angle metrics do not yet have an equivalent fix.

**Legacy MediaPipe path**: `scripts/pose_analyze.py`/`pose_common.py`/`pose_export_3d.py`/
`pose_silhouette.py` are the original MediaPipe-only prototype this pipeline replaced — kept
working (`run_pose3d.ps1 -LegacyMediapipe`) for side-by-side comparison only. Don't build new work
on them.

## Reference comp banks

Used by the coach app's checklist reference-comp modal (`coach/components/compModal.js`). **Weight
the softball bank first** — same sport, same rise-ball timing:

- **Softball** (6, each with a specific sourced trait): Jocelyn Alo (shortened a long swing to
  control the zone under pressure), Lauren Chamberlain (kept the barrel through the zone longer for
  lift), Amanda Chidester (swings at ~85% effort deliberately, trading power for consistency),
  Sierra Romero (lets the ball travel deep before releasing the barrel), Natasha Watley (documented
  slap-hitting footwork/hand path), Haylie McCleney (hips→torso→shoulders→barrel sequencing +
  plate discipline).
- **MLB** (8, named cues for isolated mechanics only, not literal templates): Shoeless Joe Jackson,
  Ty Cobb, Pete Rose, Ted Williams, Barry Bonds, Lou Gehrig, Babe Ruth, Ichiro Suzuki.

Fact-checked 2026-07-23 against real hitting-instruction/historical sources in two passes; one
softball claim (a mechanical detail attributed to Alo) turned out unsourced/fabricated on the
second pass and was corrected. One live, unsettled debate not taken a side on: whether softball and
baseball swings are mechanically more alike than traditionally taught — this project weights
softball comps heavily for timing-specific things either way, which holds regardless.

## GCP deployment (planned, not yet live)

**Not currently deployed** — there is no hosted production Supabase project and no Cloud Run job
running today; everything above runs against a local dev Supabase instance and a locally-run
processing worker. This section documents the intended production shape once that changes.

The pose3d pipeline + ingest CLIs are fundamentally batch/CLI work, not request/response, so the
plan is a **Cloud Run Job** (run-to-completion), not a Cloud Run Service:

```powershell
gcloud builds submit --tag gcr.io/<PROJECT_ID>/scouting-cli
gcloud run jobs create scouting-cli `
  --image gcr.io/<PROJECT_ID>/scouting-cli `
  --region <REGION> `
  --task-timeout 1800 `
  --set-secrets SUPABASE_SERVICE_ROLE_KEY=supabase-service-role:latest,GEMINI_API_KEY=gemini-api-key:latest
gcloud run jobs execute scouting-cli --args="analyze,--team,...,--player,...,--framesDir,...,--pitchContext,..."
```

Secrets go through GCP Secret Manager, never baked into the image or committed. Supabase itself
would be hosted separately (supabase.com project, not a GCP resource). No Cloud Scheduler/
Eventarc/Pub-Sub trigger is planned for v1 — manual job execution until there's a real recurring
need for more automation.
