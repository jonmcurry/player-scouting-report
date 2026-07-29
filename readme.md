# BarrelIQ — Softball/Baseball Swing Scouting Reports

Video-based swing analysis, built to support multiple teams (currently two, more planned —
this is being developed as a general tool, not a one-team script). Extract key frames from
phone video, diagnose mechanical issues against a standard checklist, and produce per-player +
team-level reports.

**Filming source:** live game at-bats only (no tee/BP/practice reps) — game swings are more
indicative of a player's real at-bats than a controlled rep, so every player's checklist should
be built from a running log of her actual at-bats across the season (see each report's Game Log
section), not a single staged swing.

See [NEXT_STEPS.md](NEXT_STEPS.md) for current open decisions, near-term to-dos, and longer-range
considerations — this readme covers how the project works, that file covers what's still in
flight.

## Teams

| Team | Coaches | Roster | Live team summary |
|---|---|---|---|
| **Bethlehem Boom 10U** | TBD | #2 Ellie T | [team_summary.html](https://jonmcurry.github.io/player-scouting-report/reports/team_summary.html) |
| **Latham Lady Bison White 10U** | TBD | #10 Emily C | [team_summary.html](https://jonmcurry.github.io/player-scouting-report/reports/latham-lady-bison-white-10u/team_summary.html) |

**Migration status:** Bethlehem Boom 10U is still fully on the hand-edited static-HTML path
described in this readme — not in Supabase. Latham Lady Bison White 10U is partially migrated:
Emily C (#10) is in Supabase (`npm run migrate`, real game log/checklist/issues/comps/drills/
video+pose3d data for all 7 of her real clips — see the Cloud layer section below), but she's the
team's only player so far; any other Latham roster spot still needs its own `migrate.ts` run once
it has real hand-filled report content. The demo team ("Thunder 10U" / seed.sql fixture data) is
also in Supabase, for local dev/testing only. Don't assume a real team/player is Supabase-backed
without checking (query the local Supabase DB directly, e.g. `docker exec
supabase_db_softball_analysis psql -U postgres -d postgres -c "select name from teams;"` — cheaper
than guessing from memory).

## Live site

Reports are hosted on GitHub Pages (public — no video/photos are hosted, only text: names,
jersey numbers, coach names, and written swing notes):

- **Repo:** https://github.com/jonmcurry/player-scouting-report

Share a team's summary link with its coaches/parents — every player's report is one tap away
from there. To publish an update after editing a report locally:
```powershell
git add -A
git commit -m "describe what changed"
git push
```
GitHub Pages rebuilds automatically within a minute or two of a push. `videos/` and `frames/`
are gitignored — real footage never leaves your machine.

## Folder layout

- `videos/` — drop raw game clips here (`.mp4`/`.mov` from your Pixel), one file per at-bat. Suggested naming: `<player_slug>_<YYYYMMDD>_<opponent>_ab<N>.mp4`, e.g. `videos/maggie_m_20260802_eagles_ab1.mp4` — the date/opponent/AB# should match a row you add to that player's Game Log.
- `frames/<player_slug>/<clip_name>/` — extracted stills + a contact-sheet thumbnail grid, generated per clip (nested per at-bat so multiple games don't overwrite each other).
- `reports/` — filled-in scouting reports. Reports are self-contained, interactive HTML — open them straight in a browser (double-click, no server needed). Each has a light/dark toggle in the top corner.
  - **Bethlehem Boom 10U's files live at the `reports/` root** (`team_summary.html`, `maggie_m.html`, etc.) — this predates the multi-team structure and its URL is already shared with coaches, so it stays put rather than moving and breaking that link.
  - **Every other team gets its own subfolder**, named after the team (e.g. `reports/latham-lady-bison-white-10u/`), containing that team's own `team_summary.html` + player pages. This is the pattern going forward for any new team.
  - `_individual_report_template.html` / `_team_comparison_template.html` — the shared blank templates, at the `reports/` root, used by every team regardless of which folder its generated files land in.
  - `example_maddie.html` / `example_ava.html` / `example_team_summary.html` — filled-in mock examples (fictional players, fictional "Thunder 10U" team), also shared/at the root since they're not real-team-specific. **Maddie has 4 at-bats logged** (past the evidence-discipline threshold — her report shows the "resolved" state, no warning banner). **Ava has only 2 at-bats logged on purpose** — hers is the one place in this project that actually shows the "⚠ early read" warning banner triggered, since every real player currently has zero at-bats (banner correctly absent — nothing to warn about yet) and Maddie's already past the threshold. If you want to *see* what that warning looks like, open Ava's report.
- `scripts/extract_frames.ps1` — pulls frames + a contact sheet out of a video.
- `scripts/generate_team_reports.ps1` — the shared generator engine: takes `-TeamName`, `-Coaches`, `-Players`, `-OutDir` and produces a placeholder ("awaiting video") page per player + a wired-up `team_summary.html` from the two templates above. Not meant to be run directly — see below.
  - `scripts/teams/*.ps1` — one thin config script per team (roster + coaches + output folder), each just calling `generate_team_reports.ps1` with that team's data. **To add a new team:** copy `scripts/teams/latham_lady_bison_white_10u.ps1`, change the team name/coaches/roster/`-OutDir` (use the team's own subfolder — see Folder layout above), and run it. **To add a player to an existing team**, add them to that team's config script and re-run it — it only writes files for players still listed, so it won't touch anyone already filled in with real data.
- `scripts/pose3d/` — **the current pose-estimation pipeline** (YOLO11-pose + YOLOv8 bat
  detection/ByteTrack + One-Euro smoothing + VideoPose3D 2D→3D lift), replacing an earlier
  MediaPipe-only prototype. Runs in its own isolated venv (`.venv_pose3d` — see
  `scripts/pose3d/README.md` for one-time setup; it's heavy: torch/CUDA, a cloned VideoPose3D
  repo, a downloaded checkpoint). Produces, per clip: 2D/3D keypoints, bat tip/knob tracking, and
  `metrics.json` (real bat speed/attack angle in body-relative units — no camera calibration
  exists for this footage, so no fabricated mph; hip-shoulder separation, lead-elbow angle,
  stride; an auto-detected contact instant with an honest `confidence: "high"|"low"` flag — only
  "high" clips should be trusted). `pose3d_to_checklist.py` turns one or more clips'
  `metrics.json` into a CHECKLIST-shaped JSON snippet ready to paste into a player's report:
  ```powershell
  ./scripts/run_pose3d.ps1 -VideoPath "videos/emily_c_ab1.mp4" -PlayerName emily_c
  .venv_pose3d/Scripts/python.exe scripts/pose3d/pose3d_to_checklist.py "frames/emily_c/*" out.json
  ```
  - `render_public_skeleton.py` + `check_publish_gate.py`: a privacy-safe way to surface this
    pipeline's evidence visually in a public report. The renderer draws an abstract skeleton
    (joint dots/lines + bat path, no real video pixels — never a photo/video of a real child) from
    a clip's tracked keypoints, annotated with the real computed knee-angle/hip-shoulder-separation
    numbers at the joint they came from — but only for clips where `metrics.json`'s
    `contact.confidence` is `"high"`. Its output is gated behind a `render_manifest.json`: nothing
    gets embedded in a real report until a coach has watched that clip's `overlay.mp4` (a separate,
    real-video QA render — coach-only, never published) and `check_publish_gate.py` confirms both
    the confidence gate and a coach's `approvedBy` sign-off are set.
  - The old MediaPipe scripts (`pose_analyze.py`, `pose_export_3d.py`, `pose_silhouette.py`,
    `pose_common.py`) are now **legacy/comparison-only** — kept for `-LegacyMediapipe` runs, not
    the live pipeline. Don't build new work on them.

## Filming at games

- Film **every at-bat**, not just the good or bad ones — a checklist built from a cherry-picked swing will mislead more than help.
- Slow-mo still works fine in games: start recording as the pitcher begins her windup (not when you see the bat start moving) — 10U pitch speed gives plenty of reaction time, and this gets you clean slow-mo without needing to react to the swing itself.
- Prefer **1/8 speed** (240fps, if your phone supports it) over 1/4 (120fps) when light allows — it gives double the real-time frame density for the same frame-extraction setting, which matters for catching the exact contact frame. Drop to 1/4, or normal speed, if a game's at dusk/under weak field lights — higher capture fps means a shorter exposure per frame, and a dim 1/8 clip comes out dark and noisy rather than usably slow.
- Shoot from a consistent spot each game if you can (behind the backstop is usually the best angle to see both stance and swing plane) — if shooting through fence mesh, get the lens close to the mesh to avoid moiré/focus issues.
- Heads up: filming from behind a public backstop will incidentally catch other teams' players in frame — worth keeping in mind if clips ever get shared beyond your own coaching use.

## Workflow

Shown below using Bethlehem Boom's Maggie M as the example — the steps are identical for any
team/player, just working out of that team's own subfolder (e.g. `reports/latham-lady-bison-white-10u/emily_c.html` instead of `reports/maggie_m.html`, and that team's `team_summary.html` in step 7).

1. Film an at-bat (see filming tips above).
2. Copy the clip into `videos/`, e.g. `videos/maggie_m_20260802_eagles_ab1.mp4`.
3. Extract frames:
   ```powershell
   ./scripts/extract_frames.ps1 -VideoPath videos/maggie_m_20260802_eagles_ab1.mp4 -PlayerName maggie_m
   ```
4. Review the clip's `contact_sheet.png` under `frames/maggie_m/maggie_m_20260802_eagles_ab1/` for the overall shape, then pull specific `frame_###.png` files for stance / load / stride / contact / extension / follow-through.
5. Open `reports/maggie_m.html` (already created for every roster player). Add a row to the `GAME_LOG` array for this at-bat (date, opponent, AB #, **pitch location/type**, result, clip filename). The pitch column matters: a rollover on an outside pitch is a normal outcome, on a middle-middle pitch it's a swing flaw — without it, pitch effects get misread as mechanics.
6. Once a few at-bats are logged, fill in the `CHECKLIST` array (score 1-3 + notes per checkpoint, describing the *pattern* across logged at-bats, not just one swing) and the issue/comp/drill sections in the body — cite which at-bat(s) show each issue, and note the pitch quality for at least one cited at-bat (e.g. "middle-middle, so this is the swing, not the pitch") so the issue rules out pitch quality as the cause. The checklist is 10 mechanical checkpoints plus an 11th, **swing decisions (pitch selection)** — scored from the Game Log's pitch column (does she swing at strikes and take balls?), since pitch selection is often the biggest skill gap at 10U. On a re-film, move each checkpoint's old score into its `history` array before entering the new score — the Trend column then shows progression across sessions (e.g. `1 → 2`).
   - **Evidence-discipline check:** if any score is entered while fewer than `MIN_ATBATS_FOR_PATTERN` (3) at-bats are logged, the report shows a visible "⚠ early read" warning banner automatically — this isn't just policy in the readme, it's a computed check that fires whenever a thin sample gets scored anyway.
   - **AI-assisted scoring workflow:** when Claude reads the extracted frames and drafts a checkpoint's score, it sets `score` and `aiDraft` to the same value and leaves `reviewedBy: null` — this renders as an unconfirmed "🤖 AI draft" badge. When a coach reviews it: if they agree, just set `reviewedBy` to their name; if they disagree, change `score` but leave `aiDraft` alone — the badge then shows both numbers, so an AI/coach disagreement is never silently lost. If `score` is edited without setting `reviewedBy`, the badge flags it as "edited, unconfirmed" rather than a plain AI draft, so a drift never passes as either state silently. Claude's frame-based read is a real first pass, not a substitute for a coach who watched the at-bat live — treat unconfirmed scores as drafts, especially early on.
   - The same `reviewedBy` pattern applies to the `ISSUES` array (the written diagnosis, not just the numeric scores) — arguably the more important one to verify, since the diagnosis is where the real coaching value is.
   - Once a player has real scores, copy her `reviewedCount` (how many of her scored checkpoints have `reviewedBy` set) into her entry in `team_summary.html`'s `PLAYERS` array alongside `scores` — the team view shows an "X/N confirmed" indicator per player so a coach glancing at the roster knows whose report is still mostly unverified AI output.
   - **At-Bat Outcome Correlation:** each `GAME_LOG` entry can carry a short `outcome` tag
     (`"take"`, `"foul-no-advance"`, `"ball-in-play"`) for the at-bat's final pitch result, and
     each `CHECKLIST`/`ISSUES` row can carry a numeric `atBats` array referencing which logged
     at-bats (by position in `GAME_LOG` — 1st/2nd/3rd, not the `ab` field, which can repeat across
     games) its notes are drawn from. When both are filled in, a computed "At-Bat Outcome
     Correlation" section surfaces things like "this issue: 3 of 4 logged at-bats ended in
     ball-in-play" — computed live from the data, not hand-written prose. Leave `atBats: []` until
     real notes actually cite real at-bats; this isn't required, just extra insight when present.
   - **Kid-facing trend callout:** a small "📈 Trending up: ..." banner near the top of the report
     appears automatically whenever a checkpoint's current `score` beats the last entry in its
     `history` array — no setup needed beyond keeping `history` current on a re-film. Meant for the
     player, not just the coach; see `example_maddie.html`'s "Load" checkpoint for a live example
     of it triggered.
7. Copy that player's `strength` / `issue` / `drill` / `comp` / `scores` into the matching entry in `reports/team_summary.html`'s `PLAYERS` array. The side-by-side table, heat map, and live team-average row are all generated from that array — sortable and filterable in the browser, and the average row recalculates automatically as more players get scored.
   - **Team-Wide Patterns are auto-detected, not hand-written:** a checkpoint gets flagged automatically whenever the team average (of players currently shown, respecting the search box) drops below 2.0 — that can't happen without at least one player needing work there. Flagged checkpoints are listed worst-average-first. There's a separate "Coach notes" list below it for free-text observations the numbers can't capture (e.g. a specific drill recommendation) — that part's still manual by design, since it's where real coaching judgment adds something the raw scores can't.

## On the reference comp banks

The individual report template carries two reference banks in its "Reference Comp" section —
**weight the softball bank first**, since it's the same sport and same rise-ball timing:

- **Softball bank** (6 comps, each with a specific sourced mechanical/approach trait, not just a
  career stat line): Jocelyn Alo (Oklahoma — shortened a long swing to control the zone under
  pressure without losing power), Lauren Chamberlain (Oklahoma — kept the barrel through the zone
  longer for lift instead of a short chop), Amanda Chidester (Michigan/Team USA — swings at ~85%
  effort deliberately, trading power for zone-wide consistency), Sierra Romero (Michigan — lets
  the ball travel deep before releasing the barrel), Natasha Watley (UCLA/Team USA — documented
  slap-hitting footwork and hand path), Haylie McCleney (Alabama/Team USA — hips→torso→shoulders→
  barrel sequencing and plate discipline, ties directly to the swing-decisions checkpoint).
- **MLB bank** (8 comps): Shoeless Joe Jackson, Ty Cobb, Pete Rose, Ted Williams, Barry Bonds, Lou
  Gehrig, Babe Ruth, Ichiro Suzuki — **named cues for isolated mechanics only** (e.g. "match the
  pitch plane like Ted Williams"), not literal swing templates, and a weaker fit than the softball
  bank for anything rise-ball- or timing-specific.

**Accuracy check (2026-07-23, two passes):**
- *Pass 1:* the mechanics checklist, hip-shoulder separation terminology, and all 8 MLB comps were
  fact-checked against real hitting-instruction and historical sources. Two corrections: Ted
  Williams' documented signature is pitch-plane matching (slight upward bat path), not "hip
  rotation" specifically; Barry Bonds' well-documented trait is rotational hip-to-hand separation,
  not a specific "short/compact load." Lou Gehrig is the weakest-sourced comp of the group — he's
  genuinely famous for durability/consistency (2,130 consecutive games), not a documented swing
  technique, so his cue is framed around routine/consistency rather than mechanics.
- *Pass 2:* the softball side got the same rigor. The original softball mentions (Alo, Chamberlain,
  Chidester, Watley) had only been fact-checked for career stats/records, never for the specific
  mechanical claims attributed to them — and one of those claims ("Alo shortens her stride, letting
  hips do the opening") turned out to be entirely unsourced/fabricated once actually checked. All 6
  comps now listed above have a specific, cited mechanical trait; candidates without one
  (Crystl Bustos, Dot Richardson, Kelly Kretschman) were investigated and dropped rather than
  included with a manufactured claim.

One live, unsettled debate worth knowing about: some modern hitting instructors argue softball and
baseball swings are mechanically more alike than traditionally taught, and that "flatter swing for
the rise ball" oversimplifies — the real difference is pitch timing/trajectory, not bat path
philosophy. This project doesn't take a side on that debate; it just weights softball comps
heavily for anything timing-specific, which holds either way.

## Cloud layer (optional): Supabase + GCS + Gemini + Coach App

Everything above (Python + PowerShell + hand-edited static HTML, zero cost, GitHub Pages) still
works unchanged and remains how the public reports actually get published for any team not yet
migrated (both real teams, as of this writing — see the Migration status note under Teams). This
is an *additional*, optional layer: Supabase (private Postgres backend, RLS-scoped per team), GCS
(media storage), and Gemini (AI-drafted checklist/issue scores) — added in `src/` (Node/
TypeScript), `supabase/` (schema), `Dockerfile`/`docker-compose.yml` — plus a real authenticated
**coach web app** (`coach/*.html`, plain ES modules, no bundler, `@supabase/supabase-js` via
esm.sh) that lets a coach make live persisted edits (1-tap score stepper, at-bat logging) instead
of hand-editing HTML. Its visual design is a deliberate "infield dirt" system (clay/terracotta
primary, Oswald condensed display face, circular jersey-number badge) — see the `frontend-design`
skill before doing another visual pass on it rather than defaulting to a generic dashboard look.

**The public GitHub Pages output never talks to Supabase directly** — a `generate` CLI (server-
side, `service_role` key) is the only thing that reads Supabase and writes the same kind of flat
static HTML into `reports/`; a human still reviews the diff and commits/pushes, same as today.

**3D skeleton comparison** (`coach/components/skeletonComparison.js`) replaced an earlier real-
video playback feature that was tried and abandoned — jitter persisted even after fixing four
real, confirmed root causes (GCS emulator dropping Content-Type, undecodable source video, a VFR/
CFR mismatch, a refresh-rate mismatch), so video was dropped entirely in favor of rendering a
Canvas2D skeleton straight from the pose3d pipeline's own joint data (no video decode, no codec,
no browser-compositor timing to fight). It renders a player's real reconstructed swing next to a
forward-kinematics-corrected "idealized" version, but honestly only for the 2 of 11 checklist
checkpoints with any calibrated angle target anywhere in this codebase (Extension, Hip-shoulder
separation) — the rest get either a static real-skeleton snapshot at the right phase, or stay
illustration-only. If a future request asks to "fix video playback" here, know that this was
already tried and deliberately abandoned — the skeleton comparison is the intended path, not a
fallback.

### One-time local setup

```powershell
npm install
npx supabase init      # already done in this repo - only needed once per clone
npx supabase start     # spins up Postgres/Auth/Storage/Studio via Docker; prints local API_URL/keys
cp .env.example .env   # then paste in the URL/keys `supabase start` just printed
```

`supabase start` requires Docker Desktop running. If you don't have the Supabase CLI installed
globally, prefix every `supabase` command with `npx` (as above) - no global install needed.

### Local dev loop

```powershell
npx supabase db reset                 # (re)applies supabase/migrations/ + supabase/seed.sql
docker compose up -d gcs-emulator     # zero-cost local GCS emulator (fake-gcs-server)
npm run extract -- --video "videos/emily_c_ab1.mp4" --player emily_c
npm run migrate -- --report reports/latham-lady-bison-white-10u/emily_c.html
npm run build:reports -- --report reports/latham-lady-bison-white-10u/emily_c.html
```

`migrate` is a one-time-per-report bootstrap (parses an existing hand-filled report's embedded
GAME_LOG/CHECKLIST/ISSUES into Supabase); after that, Supabase is the source of truth and
`build:reports` regenerates the HTML from it - full regeneration every run, unlike the old
PowerShell generator's one-way "never touch a hand-filled report" behavior.

Feeding the two automated-draft sources into Supabase:
```powershell
# pose3d pipeline (scripts/pose3d/) output - never touches Supabase itself, just writes JSON
.venv_pose3d/Scripts/python.exe scripts/pose3d/pose3d_to_checklist.py "frames/emily_c/*" out.json
npm run ingest -- --team latham-lady-bison-white-10u --player emily_c --pose3dJson out.json

# Gemini vision draft over extracted frames
npm run analyze -- --team latham-lady-bison-white-10u --player emily_c \
  --framesDir frames/emily_c/some_clip --pitchContext "Outside, low"
```
Both respect the same rule: never silently overwrite a checkpoint a coach has already confirmed
(`reviewed_by` set) unless you pass `--force`.

Getting an already-filmed player's real video/pose3d data into the coach app's 3D skeleton
comparison (`coach/components/skeletonComparison.js`) when the pose3d pipeline has already been
run locally (`frames/<player>/<clip>/` already has `pose_3d.json`/`metrics.json`), rather than via
a coach's live browser upload:
```powershell
# swing_phases (per clip) - which at-bat a physical clip belongs to is a human judgment call,
# so --date/--opponent/--ab must match an existing game_log_entries row exactly
npm run ingest-phases -- --team latham-lady-bison-white-10u --player emily_c \
  --date 2026-07-25 --opponent "EG Xpress Hurricanes" --ab 1 --clipDir "frames/emily_c/Emily_C_AB1 (1)"

# smoothed joint frames (video_clip_pose3d) - the piece ingest-phases doesn't cover
npm run ingest-pose3d-frames -- --team latham-lady-bison-white-10u --player emily_c \
  --date 2026-07-25 --opponent "EG Xpress Hurricanes" --ab 1 \
  --clipDir "frames/emily_c/Emily_C_AB1 (1)" --position 0
```
`--position` matters when one at-bat has multiple physical clip files (e.g. several pitches filmed
separately) - only the lowest position is surfaced by default in the coach app, so put the
highest-confidence clip at `--position 0`.

### GCP deployment (production)

This is fundamentally batch/CLI work (extract → analyze → regenerate), not a request/response
service, so it deploys as a **Cloud Run Job** (run-to-completion), not a Cloud Run Service:

```powershell
gcloud builds submit --tag gcr.io/<PROJECT_ID>/scouting-cli
gcloud run jobs create scouting-cli `
  --image gcr.io/<PROJECT_ID>/scouting-cli `
  --region <REGION> `
  --task-timeout 1800 `
  --set-secrets SUPABASE_SERVICE_ROLE_KEY=supabase-service-role:latest,GEMINI_API_KEY=gemini-api-key:latest
gcloud run jobs execute scouting-cli --args="analyze,--team,...,--player,...,--framesDir,...,--pitchContext,..."
```

Secrets (`SUPABASE_SERVICE_ROLE_KEY`, `GEMINI_API_KEY`, GCS credentials) go through GCP Secret
Manager, never baked into the image or committed anywhere - `.env` is gitignored and
`.env.example` only ever holds placeholders. No Cloud Scheduler/Eventarc/Pub-Sub trigger is set up
for v1 - manual `gcloud run jobs execute` per invocation is the whole story until there's an actual
recurring need for more automation.

Supabase itself is hosted separately (supabase.com project, not a GCP resource) - point
`SUPABASE_URL`/`SUPABASE_SERVICE_ROLE_KEY` at that project's real values for production, the same
env vars used for local dev against `supabase start`'s local instance.
