# HitterLoop Simplified App: Product Spec

*Status: approved direction, 2026-10-03. Implementation in progress; see `NEXT_STEPS.md` for what is verified and still open.*
*Replaces the coach-led workflow described in `readme.md` and `docs/UX_REDESIGN_SPEC.md`.*

**Companion documents:**

| Document | What it is |
|---|---|
| [`docs/review/hitterloop-market-assessment.md`](review/hitterloop-market-assessment.md) | Why the product was simplified: market and competitor research, voice of the customer, the case against the coach-approval workflow |
| [`docs/design/simplified-app/`](design/simplified-app/) | Approved visual design: a clickable prototype (`index.html`) plus screenshots of every screen (§3.0) |
| [`docs/research/drill-library-candidates-v2.md`](research/drill-library-candidates-v2.md) | Watch-verified drill candidates awaiting human review (§5.4) |
| [`docs/ANALYSIS_DEPTH_SRD.md`](ANALYSIS_DEPTH_SRD.md) | Additive, youth-first technical-analysis expansion for softball and baseball; preserves this specification's default family experience |

This document remains the source of truth for the default family experience and first hosted
release. `ANALYSIS_DEPTH_SRD.md` governs a later, progressively disclosed coach/performance layer.
Its validated features may extend the v1 exclusions in §14, but they do not relax this document's
one-fix rule, video-evidence threshold, youth safeguards, or fail-closed behavior.

---

## 1. What the app is now

**Film your kid's at-bat. HitterLoop tells you how it went, what they did well, the one thing to
fix, drills that help, and whether it's getting better.**

- **Users:** parents and coaches. Both get the same reports for the same player.
- **The AI does the analysis.** Nobody reviews, approves, or edits findings before they're shown.
- **Effort target:** record or upload takes 4 taps or fewer. Reading the report takes under a
  minute. Zero required decisions.

### The loop

```
Record / upload at-bat  →  automatic analysis  →  At-bat report  →  Drill at home  →  next at-bat
                                                       │
                                                       └→  Progress: is the fix showing up?
```

### End-to-end workflow

| Step | Who | What they do | Effort |
|---|---|---|---|
| 1. Set up the team | Coach (once) | Create the team; import the roster from GameChanger (§3.6); tap **Invite parents** to send each family a link to their own kid | ~5 min, once a season |
| 2. Join | Parent (once) | Open the invite link, accept consent, see only their own kid(s) (§2) | ~1 min |
| 3. Capture | Anyone filming (usually a parent) | Film the at-bat, or save the GameChanger clip; tap **Record at-bat** → Send (§3.2) | 3–4 taps |
| 4. Analysis | HitterLoop (automatic) | Find the batter and swing, analyze, build the report, notify coach + that kid's parents (§5, §7) | 0 |
| 5. Read the report | Parent and coach | What went well, the one fix, up to 3 drills with "Best for" lines (§3.3) | < 1 min |
| 6. Practice | Parent + kid | Pick a drill and do it at home | Their choice |
| 7. Progress | Automatic | Current focus moves Early read → Still showing up → Improving → Looks fixed as at-bats come in (§3.4, §5.6) | 0 |

Nobody approves anything. The only optional judgment call is "Doesn't look right" (§5.5).

### Principles carried over (still binding)

1. **The video is the evidence.** Every statement in a report must be something the video
   supports.
2. **Never invent.**
   - No invented flaws, outcomes, metrics, or drills.
   - Drills come only from the drill library.
   - When the video isn't good enough, the report says "couldn't tell from this video", never a
     guess.
3. **No fake precision.** No mph, inches, or degrees in reports.
4. **Games and practice stay separate.** One toggle at upload, never mixed silently.
5. **Kids' video is private.** Nothing is public without explicit guardian permission.

### Principle that changes

| Old | New |
|---|---|
| "AI drafts are not coach conclusions. A coach approves, edits or rejects each finding before it counts." | **The AI speaks directly to parents and coaches, so it must fail closed.** It shows at most one fix per at-bat, only at the confidence threshold in §5.3. Otherwise it says nothing is clear yet. A coach or parent *may* mark a finding "doesn't look right" (optional, one tap), and that hides it. |

`CLAUDE.md`'s "HitterLoop Product Contract" and `readme.md`'s "Product principles" need updating
to match when implementation starts (§12).

---

## 2. Users and access

**The team model: the coach owns the team, and parents see only their own kids.**

1. A coach signs up and **creates a team** (exists). Creating it requires the team's **sport**
   (baseball / softball) and **age group** (8U–18U). Drill safety filtering depends on age
   (§5.4).
2. The coach **adds players** to the roster (exists).
3. The coach **invites a parent to a specific player** (exists: `guardian_invites`). The parent
   accepts and is linked to that kid (`player_guardians`). A parent with two kids on the team is
   invited to each. A kid can have more than one linked parent.

| Role | Sees | Can do | How they get in |
|---|---|---|---|
| **Coach** | **The whole roster:** every player's reports, focus and progress | Create the team; add/remove players; invite/remove parents; record/upload for any player; share; delete any at-bat on the team; hide a fix | Signs up and creates a team (exists). Assistant coaches join via the team access code (exists: `coach_team_access`) |
| **Parent / guardian** | **Only their own linked kid(s).** Never the roster, other players' names, reports, focus, or videos | Record/upload for their kid; read their kid's reports and progress; share their kid's report; delete their kid's at-bats; hide a fix | Invited by the coach to a specific player (exists: `guardian_invites` → `player_guardians`) |
| **Shared-link viewer** | One report or progress page | Read only; no account | Revocable token link (exists: `player_share_links`) |

**What a parent and coach both see for a kid:** the same reports. Neither can hide a report from the
other. Either can mark a fix "doesn't look right" (§5.5), and the mark shows who flagged it.

**What a parent never sees:**
- other players on the team;
- team-wide lists;
- anything that reveals another child's name, video, or progress, including in notifications,
  share links, or the player switcher.

**Control over a child's video.**
- A linked parent/guardian can **delete any at-bat of their own child**, whoever uploaded it.
- A coach can delete any at-bat on their team.
- All deletes go through `delete-clip` (removes the GCS object, writes the `clip_deletions` audit
  row).

**Removing access.**
- The coach can **remove a parent's link** to a player (Roster → player → Parents). Their access
  ends immediately.
- A parent can **unlink themselves** from a player.
- The coach can cancel pending invites (exists: `revoke_guardian_invites`).
- Removing a player from the roster deletes the player. Their parent links go with them
  (`player_guardians` cascades on `player_id`; `players.team_id` cannot be null, so there is no
  "detached" state). The removal must first delete that player's clips through `delete-clip`, so
  no video is left orphaned in storage.

**Parents without a team** are out of scope for v1. See §13.

---

## 3. Screens

### 3.0 Visual design (approved)

The approved look is the AGY-produced prototype in `docs/design/simplified-app/`. Open
`index.html` in a browser, or see the PNGs:

| Screenshot | Screen |
|---|---|
| `1-home.png` | Home |
| `2-record-upload.png` | Record / upload |
| `3-report.png`, `3-report-full.png` | At-bat report |
| `4-report-error.png` | Couldn't read this one |
| `5-progress.png`, `5-progress-full.png` | Progress |
| `6-coach-roster.png` | Coach roster |
| `7-share-sheet.png` | Share sheet |

**Design decisions:**
- **Palette:** the existing "infield dirt at night" dark palette from `coach/coach.css` (dark
  slate, clay accent, warm sand text), chosen for sunlight legibility. All colors are CSS custom
  properties.
- **Type:** Oswald for headings, Inter for body text.
- **Touch targets:** 48 px minimum. Primary actions are full-width buttons or bottom sheets for
  one-handed use.
- **Report order:**
  1. Video, starting at the swing, with a ½-speed control and a contact marker on the scrub bar.
  2. How it went.
  3. What looked good, with green checks. It always comes before the fix.
  4. **One thing to fix**:
     - first a plain statement of the problem;
     - then "Say to \<kid\>:" with the cue in large type;
     - then "Next time, watch for".
  5. Drills that can help: up to 3 cards. The collapsed card shows name, **Best for**, and
     equipment/home-friendly badges. The expanded card adds steps, cue, looks right when, common
     mistake, demo link and credit.
  6. Footer: Share, Doesn't look right, Delete.
- **Progress:** a status pill plus one plain evidence sentence, then "then vs. now" video with
  play buttons, then history. No charts.
- **Sample data:** fictional only ("Maya", "Riverside 12U").

**Known design follow-ups** (not yet mocked; build to the spec text):
- "Doesn't look right" on Progress is small text. It needs a 48 px tap target.
- The coach's per-player **Invite parent** control (§2) isn't in the prototype.
- The roster import flow (§3.6) isn't in the prototype.
- The parent player switcher for parents with 2+ kids (§3.1) isn't in the prototype.

Four screens, plus sign-in and settings. That is the whole app.

### 3.1 Home

**Purpose:** get to Record in one tap and see recent reports.

**Layout (top to bottom):**

1. **Player switcher.** Shown only to a parent linked to more than one kid, and it lists only
   their own kids. A parent with one child never sees it. Coaches get the roster instead (below).
2. **Record at-bat**: one large primary button.
3. **Current focus card**: the player's active fix, from Progress (§3.4), in one line. Example:
   "Working on: staying balanced through the finish". Tapping it opens Progress.
4. **Recent at-bats feed**: newest first, one row per at-bat:
   - thumbnail, date, Game/Practice tag;
   - a one-line headline from the report;
   - the state ("Analyzing…" / "Ready" / "Couldn't read this one").

**Coach variant:** the player switcher becomes a simple roster list. Each row shows the player's
name, current focus, and newest report date. No dashboards, filters, team averages, or "needs
review" counts.

**Empty state:** "Film an at-bat to get your first report." Plus a link to "How to film" (§6).

**Acceptance:**
- From a cold app open, a parent with one child reaches the camera in ≤2 taps.
- A coach reaches any player's latest report in ≤2 taps.

### 3.2 Record / Upload

**Purpose:** get video in with no data entry.

**Flow:**

1. Tap **Record at-bat** → a sheet with two choices:
   - **Record now** (rear camera, `capture="environment"`);
   - **Choose video** (camera roll; covers GameChanger clips saved to the phone).
2. After the video is chosen, a confirm sheet shows:
   - **Player**: pre-filled with the current player; a coach must confirm.
   - **Game / Practice** toggle, default **Game**.
   - **Result (optional)**: one row of chips: Hit · Out · Walk · Strikeout · Skip. Default is
     *Skip*.
   - **Send**.
3. Upload starts in the background. The user goes straight back to Home, where the new row shows
   "Uploading… / Analyzing…".

**Multiple videos at once:** choosing several videos creates one at-bat each, all for the same
player and type. This covers a parent saving a whole tournament from GameChanger.

**Not asked, ever:**
- opponent, date (taken from the video's metadata, or the upload time);
- pitch count, pitch location, pitch type, count;
- which pitch was swung at.

**Taps:**
- Record path: Record at-bat → Record now → (film) → Send = **3 taps + filming**.
- Upload path: Record at-bat → Choose video → pick → Send = **4 taps**.

**Acceptance:**
- No required field other than the video.
- Leaving the screen never loses an in-progress upload; it resumes or shows a retry.
- The `get-upload-url` gate rejects uploads for players the user has no access to.

### 3.3 At-bat report

**Purpose:** answer "how did it go, and what do we do about it?" in under a minute.

**Arrives automatically.** When processing finishes, the user gets a notification (§7) and the
feed row turns to "Ready".

**Layout (top to bottom):**

1. **Video player**:
   - starts at the swing;
   - one tap to watch at ½ speed;
   - a single marker at contact.
   - No 3D, no skeleton overlay by default.
2. **How it went**: 2–3 plain sentences describing what the video shows.
   - It mentions the result only if the user tapped one (§3.2). Otherwise the outcome stays
     unknown, as the AI policy already requires.
   - Example: "Good, balanced stance and an on-time load. Her front side opened early, and she
     finished off-balance toward first base."
3. **What looked good**: 1–2 short bullets. Always present when the swing was readable. Required:
   every report leads with something real and positive the video supports.
4. **One fix**: at most one.
   - The single most important thing to work on, in parent language.
   - One coaching cue the kid can hear ("Finish tall, like a statue").
   - "What to look for next time" in one line.
   - Shown only if it passes the threshold in §5.3. Otherwise: "Nothing clear to fix from this
     at-bat. Keep filming. Patterns show up over 3+ at-bats."
5. **Drills that can help**: shown only when a fix is shown.
   - **Up to 3 drills** from the drill library that target the fix (§5.4). Fewer if fewer vetted
     drills exist; never padded.
   - Each drill card leads with **"Best for:"**, one plain sentence saying exactly what that drill
     is meant to fix or build. Example: "Best for: hitters whose front foot opens toward the dugout
     before the swing starts." The line is what lets a parent pick between drills that target the
     same fix.
   - Cards are collapsed by default to name, "Best for", equipment, and a home-friendly badge. Tap
     to expand: 3–5 steps, the kid cue, "looks right when", common mistakes, a demo video link with
     timestamp, and credit to the coach who teaches it.
   - Order: the drill that best fits this kid comes first (rules in §5.4).
   - Never a made-up drill.
6. **Footer actions:**
   - **Share** (§3.5);
   - **"Doesn't look right"** (§5.5);
   - **Delete at-bat** (goes through `delete-clip`).

**"Couldn't read this one" variant** (bad angle, batter not found, no swing found, video too
short or blurry):
- Message: "We couldn't analyze this video" plus the specific reason in plain words. Examples:
  "We couldn't find the batter clearly"; "No swing in this clip. Was it a take or walk?"
- The relevant filming tip from §6.
- Nothing else. No partial guesses.

**No swing (take, walk, called strikeout):**
- The result chip never decides whether a swing happened. Analyze a located swing even when the
  optional result is Strikeout; a swinging strikeout still has a swing to report on. If the
  pipeline reliably finds no swing, the report says "No swing to analyze in this at-bat."
- If swing detection is inconclusive, show "We couldn't analyze this video" with a filming tip;
  do not infer a take from Walk or Strikeout.
- A confirmed no-swing clip still counts as a recorded at-bat in the feed, not as an error.

**Acceptance:**
- The report never shows: numbers with physical units, joint angles, checkpoint scores, AI
  confidence labels, "AI draft" badges, more than one fix, or more than 3 drills.
- Every sentence in "How it went", "What looked good", and "One fix" traces to the stored analysis
  run for that clip (`analysis_runs`).

### 3.4 Progress

**Purpose:** "Is the fix showing up?" One page per player.

**Layout:**

1. **Current focus**:
   - the fix that has appeared most in recent at-bats (rules in §5.6);
   - its drill (same card as §3.3);
   - since when it has been the focus;
   - a **"Doesn't look right"** action, which dismisses the focus (§5.6).
2. **How it's going**: a plain status with the evidence behind it.

   | Status | Rule (readable game swings, same fix) | Example text |
   |---|---|---|
   | **Early read** | Fewer than 3 readable at-bats | "Keep filming to see a pattern." |
   | **Still showing up** | Seen in ≥3 of the last 5 | "Still showing up in 4 of her last 5 at-bats." |
   | **Improving** | Active focus appeared in ≤2 of the latest up-to-5 after previously qualifying at ≥3 | "Showing up less: 2 of her last 5 at-bats." |
   | **Looks fixed** | Not seen in the last 4 readable at-bats, after being the focus | "Hasn't shown up in her last 4 at-bats. Nice work." Then the next focus is picked. |
   | **Dismissed** | Someone tapped "Doesn't look right" on the focus (§5.6) | "Dismissed by Coach Smith on Oct 3." Moves to History. |

   Apply statuses in this order: dismissed, looks fixed, improving, still showing up. "Looks
   fixed" wins when its four-swing rule also satisfies "Improving". The focus selection window is
   the latest **up to 5** readable game swings; the 6-swing window applies only to the exclusion
   after a dismissal (§5.6). With ≥3 readable game swings but no qualifying concept, show "No
   clear pattern yet" and no focus. Do not invent a previous count for the Improving sentence.

3. **Then vs. now**: two videos side by side, synced at contact:
   - the at-bat where the focus was clearest: the earliest at-bat in the current focus window with
     a medium-confidence, video-basis finding of that concept; if none, the earliest at-bat where
     the concept appeared;
   - the most recent readable at-bat.
   - Video only. No measurements across different videos (camera positions differ).
4. **History**: the list of past focuses with dates and their final status. ("Front side opening:
   looks fixed, Sept 12.")

**Game vs. practice:**
- Statuses are computed from **game** at-bats.
- Practice at-bats show as a separate line: "In practice: seen in 1 of last 4 swings". This keeps
  the "does it carry into games" signal without a separate workflow.

**Acceptance:**
- No charts, scores, or metric trends.
- Status rules are deterministic and unit-tested (§10). They are computed from stored findings,
  never generated by the AI.

### 3.5 Sharing (sheet, not a screen)

- **Share report** or **Share progress** creates a revocable read-only link, 90-day expiry (exists:
  `player_share_links`).
- **Share-link privacy fix (required):** shared pages show first name + last initial and no team
  name. Today `supabase/functions/_shared/familyReport.ts:92` returns the stored name and team name;
  fix that before any link is shared.
- **Opaque video storage paths (required).** Video objects are stored as
  `<team-slug>/<player-slug>/raw/<clip>` (`supabase/functions/get-upload-url/index.ts:165`), so any
  signed video URL exposes the team and player name to anyone who inspects a page. Two changes:
  - New uploads use opaque keys (e.g. `<random uuid>/raw/<random uuid>.<ext>`).
  - Existing objects are copied to opaque keys, and `video_clips.gcs_path` is updated, before
    any share link or parent-facing page serves video.
- **Invite a parent** (coach only, from a player's page) uses the existing invite token pattern
  (`guardian_invites`). Parents cannot invite anyone.

### 3.6 Roster import from GameChanger (coach only)

**Purpose:** a coach whose team is already in GameChanger never types the roster again.

**Why this route:** GameChanger has no public API, and its terms forbid automated access, so
HitterLoop never logs into or scrapes GameChanger. It uses exports the coach can already make:

- **Staff accounts** can sign in at web.gc.com → team → **Stats → Export Stats** to download a CSV
  with one row per player ([GameChanger help](https://help.gc.com/hc/en-us/articles/360043583651-Exporting-Season-Stats)).
- **Followers can't export.** Coaches without staff access use the screenshot option.

**Entry points:**
- the team's first-run empty state: "Import your roster from GameChanger";
- Roster → **Import players**.

**Three ways in, one review step:**

| Option | Coach does | HitterLoop does |
|---|---|---|
| **A. GameChanger CSV** (primary) | Exports stats on web.gc.com, then uploads the CSV (or shares it from the phone's Files app) | Reads only the player identity columns: jersey number, first name, last name. **Every stat column is discarded on read and never stored** |
| **B. Screenshot** | Screenshots the roster screen in the GameChanger app and uploads the image | Extracts number + name from the image (Gemini). Lower trust, so the review step is mandatory and highlights uncertain rows |
| **C. Paste** | Pastes a list ("12 Maya Davis", one per line) | Parses number + name |

**Review step (always shown, never skipped):**
- A list of detected players: number, first name, last name, each editable. A checkbox to include
  each one, on by default.
- Rows flagged "possible duplicate" when they match an existing player by number + name or by
  name. Default: don't create a duplicate.
- Rows HitterLoop couldn't read cleanly are highlighted for the coach to fix.
- **Import N players** creates them. Nothing is created before this tap.

**Re-import (mid-season changes):**
- Importing again adds new players and offers to update changed jersey numbers.
- It **never deletes** players. Removing a player stays a deliberate action (§2).

**Parents after import:**
- After import, the coach sees **Invite parents** with a per-player invite link to text or email
  (existing `guardian_invites`).
- GameChanger's family/follower list is not exported, so parent links can't be imported.

**Privacy:**
- The uploaded CSV or screenshot is processed and **discarded immediately**. It's not kept in
  storage, and only the confirmed name/number rows are saved.
- The file can contain stats for the whole team. That data is never kept.
- The screenshot option sends the image, including any visible children's names, to Gemini for
  extraction. Say this before the coach chooses that option and cover this third-party processing
  in the guardian consent text. HitterLoop does not retain the screenshot after processing;
  provider handling follows its applicable terms and must be reviewed before release.

**Acceptance:**
- A real GameChanger "Export Stats" CSV imports correctly.
  - **To verify before release:** published GameChanger instructions do not specify the CSV
    headers, and no real export is available in this workspace. The importer therefore requires
    a coach-reviewed identity-column mapping; confirm the default suggestions and full flow
    against a real export before inviting families.
- No stat value from the file is written anywhere.
- Re-importing the same file creates zero duplicates.
- Import is coach-only. Parents never see the roster or the import.

---

## 4. What gets removed from the product

Nothing is dropped from the database in the first release (§11 explains why). These are removed
from the **user interface and the required workflow**.

| Current piece | Files (main) | Action |
|---|---|---|
| Pitch-by-pitch at-bat logging, 9-zone picker, count, outcome per pitch | `coach/atbat.html`, `components/pitchEntry.js`, `pitchZonePicker.js` | **Remove.** Replaced by one optional result chip |
| Opponent / game entry | `player.html` game log | **Remove** (opponent becomes optional, defaults to empty) |
| Review queue | `coach/queue.html` | **Remove** |
| Swing review page (approve / edit / reject per finding) | `coach/review.html`, `devActions.js` | **Remove.** Replaced by the At-bat report |
| 11-checkpoint checklist scoring | `checklistReview.js`, `checkpointEvidence.js` | **Remove** from UI. AI still produces it internally only if it helps the report; otherwise drop it from the prompt (§5.2) |
| Priorities, follow-ups, outcome logging, status history | `development.html`, `player.html` priority sections, `developmentLogic.js` (priority parts) | **Remove.** Replaced by the automatic Current focus (§5.6) |
| Practice session logging (goal, focus, drill, rep grouping) | `coach/session.html`, `practicePage.js` | **Remove.** Practice is just the Game/Practice toggle |
| Compare page (Video / Frames / Progress / Metrics / 3D) | `coach/compare.html`, `skeletonComparison.js` | **Remove.** "Then vs. now" on Progress replaces it |
| 3D viewer, avatar retargeting | `skeletonScene.js`, `avatar-retarget-map.js`, `assets/models` | **Remove from the app with the old screens in Phase 4.** Keep only independently used demo/portfolio assets after checking their callers |
| Team dashboard, roster filters, team focus areas | `coach/team.html` dashboard parts | **Remove.** Roster becomes the simple list in §3.1 |
| Metrics panels | `swingMetricsPanel.js` | **Remove** from UI (metrics stay internal) |
| Comps (pro comparisons) | `compModal.js`, comp tables | **Remove** from UI |
| Methodology admin UI | `admin/` | **Keep, unchanged** (internal tool that feeds drills and knowledge, §5.4) |
| Public demo | demo export / fixtures | **Freeze.** Rebuild later on the new screens |

**What stays and is reused:**

- **Video and processing:** upload (`videoUpload.js`, `get-upload-url`, GCS), the upload queue and
  worker (`processUploadQueue.ts`), and the pose3d pipeline (detection, batter selection, swing
  location, contact).
- **Analysis:** the AI analyzer (`geminiAnalyzer.ts`, `swingAnalysisShared.ts`, semantic
  validation) and `analysis_runs`.
- **Content:** the drill library and the knowledge pack.
- **Access and privacy:** guardian accounts and invites, share links, clip deletion
  (`delete-clip`), and Supabase auth/RLS.
- **App shell:** the Android shell and PWA.

**Existing-file routing for the replacement:** `family.html` / `familyPage.js` become the parent
Home and linked-player switcher; `team.html` and `player.html` are reduced to the coach roster and
player actions. `guardianAdmin.js` supplies per-player invites. `report.html` remains the
shared-link entry point but gets the new private report shape and redacted identity. Reuse
`subjectZoom.js` only if it improves playback without adding an overlay or a claim. Replace
`get-player-report` / `get-family-report` read shapes as needed for the new report, while keeping
the frozen demo's existing read path working. Remove the old logging, review, checklist, priority,
comparison, chart and 3D UI modules with their screens in Phase 4, after checking all callers.
The analysis pipeline and historical tables stay until a separately reviewed cleanup.

---

## 5. Analysis: what the AI produces and how it's shown

### 5.1 Processing (unchanged path)

Upload → `video_clips` row (`pending`) → worker claims it → pose3d pipeline → phase stills → AI
analyzer → stored `analysis_runs` + `issues` → the report is assembled at read time.

**New:** when the run finishes, the worker sends the "report ready" notification (§7).

### 5.2 Prompt and output changes (`swingAnalysisShared.ts`)

Keep every rule in `ANALYSIS_POLICY`: never invent, at most 2 issues, single-swing confidence
capped at medium, unknown outcome stays unknown, no exact biomechanics. Change the output:

| Field | Change |
|---|---|
| `summary` (new) | 2–3 sentences, plain parent/coach language, describing what the video shows. Must not state the outcome unless supplied. Validated like issues |
| `strengths` (new) | 0–2 short items, each with `evidence` and `phase`. Must be visible in the stills. Required when the swing is readable and something genuinely solid is visible |
| `issues` | Unchanged shape (max 2). `coachingCue` and `lookForNext` are used directly. `suggestedDrill` free text is **ignored for display** (drills come from the library, §5.4) |
| `checklist` | **Remove from the prompt** unless kept as an internal signal. Recommendation: remove, since it costs tokens and adds failure modes, and no screen shows it |
| `comps`, `compNotes` | **Remove from the prompt** |
| `drills` (free text) | **Remove from the prompt** |
| Reading level | Add a policy line: write for a parent with no baseball/softball training; no jargon without a plain explanation; short sentences |

Bump `ANALYSIS_POLICY_VERSION` and `PROMPT_RENDER_VERSION`. `semanticValidation.ts` gets checks for
the new fields: `summary` must not state an outcome when the outcome is unknown, and `strengths`
must cite a supplied phase.

### 5.3 The "show a fix" threshold

A finding is shown as the **One fix** only if **all** of these hold:

1. `basis` is `video` (not metric-only or reconstruction-only).
2. `confidence` is `medium`. (`high` is impossible for one swing; `low` is never shown.)
3. `contextExplainsIt` is false and `emergencySwingSuspected` is false. A protective or chase swing
   is not a mechanical fix.
4. The clip passed the pipeline quality gate (batter found, swing located).
5. No one has marked it "doesn't look right" (§5.5).
6. Its `concept` is a mechanical one. `swing_decision`, `pitch_location_adjustment` and
   `game_approach` depend on pitch information the simplified app no longer collects, so they are
   never shown as a fix in v1. They stay stored and do not count toward Progress.

If two issues pass, show the one whose `concept` matches the player's current focus. Otherwise
show the one in the earlier swing phase (stance → load → stride → contact → extension → follow
through), because earlier faults usually cause later ones. *This tie-break is a product choice;
revisit it with real reports.*

**Low-confidence findings are still stored and still count toward Progress patterns (§5.6), but
are never shown on their own.** Repetition across at-bats is what turns a weak single-swing signal
into a real focus.

### 5.4 Drill selection (never invented)

- Each issue `concept` (from `src/services/knowledge/knowledgePack.ts` `CONCEPTS`) maps to drill
  library entries via `drill_library.target_tags`.
- Show **up to 3** active drills whose tags include the concept. Selection and order:
  1. Exclude drills not suitable for the player's age (`min_age`), and drills flagged for
     weighted or overspeed equipment for under-13s.
     - The player's age comes from the per-player age band if the coach set one, otherwise from
       the team's age group (§2).
     - **If neither is known, treat the player as under 13** (fail safe).
  1a. Drills that place a partner or feeder near the swing or in front of the hitter are shown
     only if their approved instructions require a protective screen or adult-only feeding (set
     during curation, §5.4).
  2. Match sport (`sport` = the player's sport or `both`).
  3. Prefer drills whose `best_for` matches the issue's specific symptom, when the issue's
     `phase` matches the drill's `phase` tag.
  4. Prefer home-friendly drills, then vary equipment so the three aren't all the same setup
     (e.g. one tee drill, one toss drill, one no-ball drill).
  5. Rotation: if the same fix recurs, keep the drill the family has been using first, so the plan
     doesn't change every at-bat.
- Every drill's **`best_for`** text is written and approved by a human during library curation. It
  is never generated at report time.
- If no drill matches, show the fix with **no drill**, plus "No drill for this yet". Never fill the
  gap with AI text.
- **Drill content: researched, awaiting curation.**
  - The production library has 7 seeded drills.
  - [`docs/research/drill-library-candidates-v2.md`](research/drill-library-candidates-v2.md) holds
    **90 watch-verified drill candidates** from 110 YouTube videos by credible hitting coaches,
    baseball and softball.
  - Every concept the app can show as a fix has at least 3: front-side stability 10, barrel
    path 11, load 9, posture 9, hand path 7, timing 6, five each for hip-shoulder sequencing,
    head stability, extension and finish/balance, four each for stance, stride and barrel depth,
    three each for contact and foundation.
  - **How they were verified:** links were checked against YouTube oEmbed, and each video was
    actually watched by Gemini/AGY (frames + audio). Only drills demonstrated in a video are kept,
    credited to the presenter and channel with a link and timestamp. About half of the first-pass
    search results were misattributed and were discarded by this process.
  - **Each candidate carries every field the drill card needs:** a draft "Best for", parent-language
    steps, cue, looks right when, common mistakes, equipment, home-friendly flag, age notes and
    safety notes.
  - **Curation step (Phase 2):** for each drill, a human:
    1. approves, edits or rejects it;
    2. rewrites "Best for" into one specific, distinct sentence;
    3. sets `min_age`, checking the 7 ⚠️ age/equipment flags;
    3a. checks the 21 ⚠️ safety flags (a person near the swing or in front of the hitter) and either
        requires a screen or adult-only feeding (`requires_screen`) or rejects the drill for home
        use;
    4. confirms the concept;
    5. imports it into `drill_library` using the §8 fields.
  - Steps stay paraphrased with credit and a link. Never copy a coach's script or video.
  - `docs/research/methodology-drills-v1.md` (the earlier 12 candidates) is superseded but kept for
    history.

### 5.5 "Doesn't look right" (optional feedback)

- One tap on a shown fix, available to parent or coach. An optional reason: "Not what happened" /
  "Wrong kid in video" / "Other".
- Effect:
  - the fix is hidden from that report for everyone, with a note: "Hidden by Coach Smith: doesn't
    look right";
  - it is excluded from Progress counting;
  - it is stored for quality review.
- **Not required, never prompted.** It replaces the old approval queue as a safety valve, not a
  workflow.
- Reuses the `issues.review_status` / `reviewed_by` columns. Existing coach-reviewed protections
  (never overwritten by re-analysis) still apply.

### 5.6 Current focus (automatic, deterministic)

- Group stored findings by `concept` across the player's most recent **up to 5 readable game at-bats**.
  Exclude hidden findings, non-video-basis findings, and the non-mechanical concepts listed in §5.3
  rule 6.
- A concept becomes the **current focus** when it appears (any confidence ≥ low, `basis` video) in
  **≥3 of the last 5** readable game at-bats.
- One focus at a time. While a focus is active, it keeps priority in tie-breaks (§5.3).
- Status transitions follow the table in §3.4. "Looks fixed" retires the focus and stores it in
  history. The next qualifying concept, if any, becomes the focus.
- An active focus stays selected while it is improving, even when it no longer meets the 3-of-5
  entry threshold. Its recorded qualifying window is the evidence that it previously met the
  threshold. Retire it only when it looks fixed or is dismissed; never relabel a new focus as an
  improvement of the old one.
- Fewer than 3 readable game at-bats → "Early read", no focus. This matches the existing 3-at-bat
  rule.
- **Dismissing a focus.** Low-confidence findings count toward a focus but are never shown on their
  own. So the Current focus card itself carries **"Doesn't look right"**. Using it:
  - retires the focus as "dismissed by <name>";
  - excludes that concept from focus selection for that player for the next 6 readable at-bats;
  - keeps the underlying findings stored for quality review.
  This ensures a repeated AI false positive can always be rejected.
- **Where it runs: the server, not the app.**
  - A pure, unit-tested function (no DOM, no Supabase) in `src/services/development/focus.ts`.
  - The worker calls it after every completed analysis run, and after any "doesn't look right"
    action, via an RPC/Edge Function.
  - It writes transitions to `player_focus` and triggers the §7 focus notification.
  - The app only reads `player_focus`; it never computes status itself.

---

## 6. Filming guidance (shown in-app)

Shown on first use, from the "Couldn't read this one" report, and under Settings → How to film.
One screen, with pictures:

1. **Behind home plate**, as straight-on as you can. Through the fence is fine; get the lens close
   to the fence.
2. **Whole batter in frame**, head to feet, plus a little room for the bat.
3. **Start before the pitch, stop after the follow-through.** A whole at-bat in one clip is fine.
4. **Hold steady.** Use a fence mount or tripod if you can.
5. GameChanger clips work. Save them to your phone and choose **Choose video**.

---

## 7. Notifications

| Event | Who | Channel | Text |
|---|---|---|---|
| Report ready | Everyone with access to the player | Push (Android shell), else email | "Maya's at-bat report is ready: 1 thing to work on." / "…ready: looking good." |
| Couldn't analyze | Uploader only | Push / email | "We couldn't analyze Maya's at-bat. Tap for a filming tip." |
| Focus status change | Everyone with access | Push / email, **at most once a week** per player | "Good news: front-side opening is showing up less (2 of last 5)." |

**Settings:** one toggle per user, "Notify me when reports are ready". No other notification
settings in v1.

Phase 5 includes native push integration in `mobile/`, notification permission and device-token
handling, push-provider setup, and email delivery. None of those are supplied by the current
Capacitor dependencies, so notification work is part of hosting, not an assumption about the
existing shell.

**Batching:**
- When several at-bats are uploaded together, send one notification **per player**: "4 at-bat
  reports ready for Maya".
- A notification only ever names one child, and only goes to that child's coach(es) and linked
  parents.
- A coach's bulk upload across several players produces a separate notification per player for
  that player's parents. The coach may get one combined summary.
- No notification to a parent ever contains another player's name.

---

## 8. Data model changes

Principle: **additive migrations only** in the first release. Existing tables stay, so rollback is
a frontend redeploy.

**Demo schema parity (required).** `demo.clone_real_fixture` and the fixture loader require column
parity between `public` and `demo` tables (see the 00031 / 00036 / 00042 migration comments). Every
column added below to a table that also exists in `demo` must be added to the `demo` copy in the
same migration. Every new table must be either:
- created in `demo` as well, or
- explicitly excluded from the clone, with a test asserting the exclusion.

| Change | Why |
|---|---|
| `game_log_entries.opponent`: allow empty (default `''`); `pitch`, `result` optional | At-bats are created with no data entry |
| `game_log_entries.result_simple` (new, nullable: `hit` / `out` / `walk` / `strikeout`) | The optional result chip. Feeds the AI's "outcome known" input |
| Auto-create one `game_log_entries` row per uploaded video, with `session_type` set by the Game/Practice toggle, via an RPC callable by coaches and guardians | `video_clips.game_log_entry_id` is required. For Practice, the existing triggers also create/link a `practice_sessions` and `practice_repetitions` row behind the scenes; the user does not enter session details |
| **Guardian delete rights:** extend `delete-clip` authorization so a linked guardian can delete any clip of their own child | §2 control over a child's video |
| **Remove parent link / self-unlink:** coach-only RPC to delete a `player_guardians` row for a player on their team; guardian self-unlink RPC | §2 removing access |
| **Guardian read access to reports:** read-only RPCs or views (security definer, `set search_path = ''`, per the 00040/00042 conventions) returning the report and progress data for a guardian's **own linked child only**. No guardian grant on any table or view that lists other players | Today guardians have no read access to development data by design. Parents must never see the roster |
| `issues`: reuse `review_status` for "hidden"; add `hidden_reason` (nullable text) | §5.5 |
| `analysis_runs`: store `summary` and `strengths` (jsonb), or a new `analysis_run_report` table keyed by run | §5.2 new fields |
| `player_focus` (new): player_id, concept, status (`active` / `improving` / `fixed` / `dismissed`), started_at, ended_at, dismissed_by (nullable user id), dismissed_reason (nullable text) | Focus history (§3.4). Could be derived on the fly; a table keeps history stable when old clips are deleted |
| `teams.sport` (`baseball`/`softball`) and `teams.age_group` (e.g. `12U`), required for new teams; `players.age_band` (nullable override) | §5.4 age-safe drill filtering; the AI's existing `age_band` input (`analysisContext.ts`) gets a real value |
| Drill library: add `requires_screen` (bool), plus `best_for` (text, required for active drills), `looks_right_when` (text), `cue` (text), `common_mistakes` (text[]), `home_friendly` (bool), `sport` (`baseball`/`softball`/`both`), `min_age` (smallint, nullable), `phase` (nullable), `demo_url` (text, nullable), `demo_timestamp` (text, nullable), `source_credit` (text) | §3.3 drill cards, §5.4 selection |
| Notification preferences: a `user_settings` row with `notify_reports boolean` | §7 |

**Kept for rollback and hidden from UI:** `checklist_scores`, `checklist_score_history`,
`player_priorities*`, `at_bat_pitches`, `comp_*`, `drill_recommendations`. Practice uploads continue
to create `practice_sessions` and `practice_repetitions` through the existing linking triggers.
Drop them in a later cleanup release only after the new flow has run in real use (§11, Phase 5).

---

## 9. Non-functional requirements

| Area | Requirement |
|---|---|
| **Processing time** | Report ready within 10 minutes of upload for a ≤60 s clip. Show "usually ready in a few minutes" |
| **Hosting** | **Blocking dependency.** Nothing is deployed today; the worker runs locally on a Windows GPU box. The simplified app needs a hosted Supabase project and a hosted GPU worker before anyone but Jon can use it. Pick one: Modal, RunPod, or Cloud Run with GPU. Decide on cost: estimate per-clip GPU seconds × price before choosing |
| **Cost guardrails** | Per-user daily upload cap (reuse the existing rate-limit pattern). Clip length cap (e.g. 3 minutes). The pipeline already trims long clips to a ~12 s window |
| **Privacy** | Video is private; signed URLs only. Shared links: first name + last initial, no team name. Guardian consent at parent sign-up (existing consent text v1 still needs Jon's approval: `NEXT_STEPS.md`). Deletion removes the GCS object (all deletes must go through `delete-clip`; today most don't) |
| **Accessibility / field use** | Keep the existing 48 px touch targets and high-contrast palette |
| **Offline** | Recording works offline; the upload queues and sends when back online |

---

## 10. Testing

- **Unit (pure logic):**
  - the §5.3 threshold;
  - the §5.6 focus/status rules in `src/services/development/focus.ts`, including every transition,
    "Early read", dismissal and the 6-at-bat exclusion, game vs. practice separation, hidden and
    non-mechanical findings excluded;
  - drill selection (§5.4): up to 3, age/sport exclusion, ordering, equipment variety, rotation,
    no-match;
  - report assembly from a stored run.
- **Roster import (§3.6):**
  - CSV parsing against a real GameChanger export, plus variants with reordered or extra columns;
  - stat columns never persisted;
  - duplicate detection;
  - re-import idempotence;
  - coach-only access.
- **Prompt validation:** extend the `semanticValidation` tests for `summary`/`strengths`. In
  particular, reject an outcome stated when unknown, and strengths that cite unsupplied phases.
- **DB:**
  - RLS tests:
    - a coach reads every player on their team;
    - a guardian reads only their own linked child's reports and progress, and cannot list,
      read, or infer any other player on the team (roster, names, focus, clips, notifications);
    - a guardian with two linked kids sees exactly those two;
    - share links expose no team name;
    - a guardian can delete a clip of their own child but no other child's;
    - a removed parent link loses access immediately;
    - notifications to a parent never include another player's name, including after a coach's
      multi-player bulk upload;
    - signed video URLs contain no team or player name.
  - Demo parity test: every `public` column added in this work exists in the `demo` copy, and the
    demo clone still runs.
  - Additive-migration test: existing data still loads.
- **End to end (emulator):**
  - coach creates team and player → invites parent → parent accepts and consents → uploads clip →
    gets report → shares link;
  - coach and parent see the same report, and the parent sees only linked children.
- **Real-footage check:** run 20+ real at-bats (mix of phone and GameChanger clips) through the new
  report. Track:
  - % "couldn't read";
  - % with a fix shown;
  - % of shown fixes Jon agrees with.
  - Target before inviting families: **≥80% agreement on shown fixes.** If lower, tighten §5.3.

---

## 11. Build plan

| Phase | Scope | Done when |
|---|---|---|
| **0. Prep** | Fix share-link name exposure and opaque video paths; route all deletes through `delete-clip`; draft updated guardian consent for review; prepare a rollback tag for explicit authorization | Privacy code validated; consent and rollback action ready for approval |
| **1. Analysis output** | Prompt changes (§5.2); threshold, drill matching, focus logic (§5.3–5.6) as tested pure functions; report assembler | Unit tests pass; 20 real at-bats produce sensible reports offline |
| **2. Drill content** | Curate the 90 watch-verified candidates (§5.4) into 30–45 approved drills, each with a human-approved "Best for" line, steps, "looks right when", age notes, demo links | Every emittable concept has ≥1 approved drill, most have 3 |
| **3. Access foundation** | Guardian report/progress reads scoped to linked kids, remove-link and self-unlink, guardian delete rights; reuse coach-to-parent invites. Add the reviewed GameChanger roster import (§3.6: CSV, screenshot, paste) | RLS tests pass, including "a parent cannot see the roster"; import is idempotent and coach-only |
| **4. New screens** | Home, Record/Upload, At-bat report, Progress, Share sheet; remove obsolete UI pages and components after replacement paths work, preserving any independently used frozen-demo code | Emulator end-to-end passes; old pages and their unused UI code removed |
| **5. Hosting + notifications** | Hosted Supabase + GPU worker; native push integration and provider setup; email delivery | A non-Jon device completes the full loop |
| **6. Data cleanup** | After ~4 weeks of real use: assess historical tables and plan any drops as separate, reviewed migrations | Unused data structures have an evidence-backed migration plan |

**Versioning:** this is a product redefinition. Under `CLAUDE.md`'s policy it is a candidate for a
MAJOR bump (e.g. 1.0.0 when Phase 5 ships) or a MINOR bump per phase. That's Jon's call. Keep
`package.json`, `mobile/package.json`, and `build.gradle` in sync either way.

---

## 12. Documentation to update when implementation starts

- `CLAUDE.md`, "HitterLoop Product Contract": replace "AI drafts are not coach conclusions" and
  "the coach is the final authority" with the §1 principle. Suggested wording:
  > AI analysis is shown directly to parents and coaches and must fail closed: at most one fix per
  > at-bat, only from video evidence at medium confidence, drills only from the vetted library, and
  > "couldn't tell" instead of guessing. Coaches and parents can hide a finding; nobody is required
  > to approve one.
- `readme.md`: product principles, screens table, "What a coach can do".
- `NEXT_STEPS.md`: Phase B (self-coached parents) stays deferred (§13).
- `CHANGELOG.md`: per release.

---

## 13. Open decisions (not blocking Phases 0–3)

0. **Parents without a team.** v1 requires a coach-created team. Whether a parent can sign up
   alone (e.g. a private one-player "team" they own) is deferred. Revisit if parents ask for it.

1. **Pricing.** Options: free while testing, then per family (~$5–10/mo or ~$40–60/season) or per
   team (~$100–300/season, families split it). Billing is not in this spec.
2. **Multiple swings per at-bat.** The pipeline analyzes one located swing per clip. An at-bat with
   foul balls has several. v1 analyzes the one the pipeline locates and says "1 swing analyzed".
   Analyzing every swing is a later improvement.
3. **iOS.** The Android shell exists. iOS parents can use the PWA until an iOS build is done.
4. **Softball vs. baseball.** Both are supported today. Drill content (Phase 2) should cover both,
   or tag drills by sport.

---

## 14. What this spec deliberately does not include

The exclusions below apply to the simplified v1 family surface. The optional coach/performance
expansion in `docs/ANALYSIS_DEPTH_SRD.md` may introduce validated measurements, comparisons, and
exports behind separate authorization and evidence gates while leaving this default surface intact.

- Team management, scoring, stats, lineups. (GameChanger does this.)
- Pitch tracking, pitch location, counts.
- Coach approval workflows of any kind.
- Metric dashboards, charts, checkpoint scores, physical-unit measurements.
- 3D models in the app.
- Pro player comparisons.
- Recruiting features.
- AI-written drills or free-form AI coaching chat.
