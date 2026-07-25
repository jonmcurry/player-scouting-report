# Softball/Baseball Swing Scouting Reports

Video-based swing analysis, built to support multiple teams (currently two, more planned —
this is being developed as a general tool, not a one-team script). Extract key frames from
phone video, diagnose mechanical issues against a standard checklist, and produce per-player +
team-level reports.

**Filming source:** live game at-bats only (no tee/BP/practice reps) — game swings are more
indicative of a player's real at-bats than a controlled rep, so every player's checklist should
be built from a running log of her actual at-bats across the season (see each report's Game Log
section), not a single staged swing.

## Teams

| Team | Coaches | Roster | Live team summary |
|---|---|---|---|
| **Bethlehem Boom 10U** | Bill Lynch, Doron Bruns, Kathleen Turner, Katie Melnikoff, Kayla Lupi | #1 Maggie M · #2 Ellie T · #3 Clare C · #5 Felicia A · #10 Anya O · #12 Payton M · #16 Lucy L · #23 Harper B · #25 Emily Y · #44 Chloe R · #66 Madison W | [team_summary.html](https://jonmcurry.github.io/player-scouting-report/reports/team_summary.html) |
| **Latham Lady Bison White 10U** | TBD | #10 Emily C | [team_summary.html](https://jonmcurry.github.io/player-scouting-report/reports/latham-lady-bison-white-10u/team_summary.html) |

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
