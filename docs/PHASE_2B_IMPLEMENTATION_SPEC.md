# BarrelTrace Phase 2B implementation brief

**Scope:** Review queue · Pitch quick-entry · Compare · Public player report · native-dialog cleanup *only where those
flows touch it*.
**Status:** specification only. No code, migration, config or dependency was changed to produce it.
**Builds on:** `docs/UX_REDESIGN_SPEC.md` (still the design-system authority). Where this brief and that spec disagree on
these four screens, **this brief wins** (each disagreement is called out and justified).

**Basis (repo read, not assumed):** `coach/review.html`, `compare.html`, `atbat.html`, `report.html`, `session.html` +
`components/practicePage.js`, `components/{ui,appShell,shellState,teamDashboard,phase1bScreens,phase2aScreens,devActions,
developmentLogic,pitchZonePicker,videoUpload}.js`, `supabase/functions/get-player-report/{index,shape}.ts`, migrations
00025-00028, `tmp/phase2a/*.png` QA screenshots, and the current debug APK.

**Non-goals, restated.** BarrelTrace is not a biomechanics dashboard. Original video is the source of truth; AI findings are
drafts until the coach confirms them; 3D and metrics are supporting evidence. No new AI workflow, approval taxonomy, metric or
migration is introduced by anything below.

---

## 1. Phase 2A closeout note

Phase 2A is accepted. Development and Practice are **not** redesigned here. Three small closeout items are acknowledged;
each is a fix, not a redesign, and each should ship as its own tiny change before or alongside 2B.

### 1.1 Session Plan goals must wrap, not ellipsize

- **Evidence:** `coach.css` `.p2a-brief-row > strong` sets `white-space: nowrap; overflow: hidden; text-overflow: ellipsis`.
  `tmp/phase2a/current-practice-session-top.png` shows the goal cut to "Keep the front hip closed throug…".
- **Fix:** the Focus, Drill and Goal values in the Session Plan card wrap to as many lines as they need (no clamp). The
  label column keeps a fixed width so values align. Ellipsis stays only where the text is navigation chrome (app-bar title,
  tab labels, list-row secondary lines).
- **Acceptance:** a 140-character goal is fully readable at 390 dp / 100% and 130% font scale with no horizontal overflow.

### 1.2 On Coach Assessment, Compare must stop being the dominant sticky action

- **Evidence:** `practicePrimaryAction()` returns `compare` whenever baseline and post-drill both exist and no assessment is
  selected. `tmp/phase2a/current-coach-assessment.png` shows the Coach Assessment card on screen with a full-width brand-filled
  **Compare baseline → post-drill** bar pinned under it and no save action anywhere.
- **Fix (deterministic rule):** the coach is "assessing" as soon as **any** of these is true: an assessment option is
  selected, the note has text, the Coach Assessment card is ≥ 50% in the viewport, or the coach arrived back from Compare.
  While assessing, the sticky bar is **Finish session** (primary; disabled with the hint "Choose how it went" until an option
  is selected) with **Compare** as a secondary button beside it. Outside assessing, the current behaviour is unchanged.
  The inline Compare card keeps its own button (it is not sticky).
- **Same root cause, one more visible defect:** anchor-styled buttons inherit the link underline (both the sticky Compare
  bar and the inline "Compare baseline → post-drill" and "Review" controls are underlined in the screenshots). Buttons that
  are `<a>` elements must render with `text-decoration: none`.
- **Acceptance:** on the Coach Assessment screenshot state, exactly one brand-filled control is visible and it says
  **Finish session**; Compare is present but not brand-filled.

### 1.3 A clean current Android build cannot show BarrelIQ

Verified now, so this is a checklist, not a suspicion:

| Check | Result |
|---|---|
| `mobile/android/app/src/main/res/values/strings.xml` (`app_name`, `package_name`, `custom_url_scheme`) | BarrelTrace / `com.barreltrace.coach` |
| `build.gradle` `applicationId` + `namespace` | `com.barreltrace.coach` |
| `coach/manifest.json`, `coach/sw.js` cache names, `scripts/bump-coach-cache.mjs` | BarrelTrace / `barreltrace-coach-*` |
| Repo source outside history/upgrade notes | Only `readme.md` "Upgrading from BarrelIQ" and docs prose mention the old name |
| Current `app-debug.apk` (scanned: assets, XML, JSON, HTML, JS, resources) | **0** occurrences of "BarrelIQ" |

Stale branding can still reach a user in exactly three ways, and each needs a rule:

1. **The old package is still installed.** `com.barreliq.coach` is a *different* app id, so it installs side-by-side and keeps
   the old name and data. *QA rule:* uninstall `com.barreliq.coach` on every test device/emulator before verifying.
2. **A stale, gitignored `mobile/android/app/src/main/assets/public/`** on a machine that copied over old files. *Build rule
   for release builds:* delete `assets/public` and `app/build`, run `npx cap sync android`, then `gradlew clean assembleDebug`
   (or `assembleRelease`).
3. **An old PWA install** with `barreliq-coach-*` caches. The new service worker's `activate` already deletes every cache not
   equal to its own two names, so this self-heals on first load; add it to QA anyway.

*Acceptance:* after the clean-build rule, `unzip -p app-debug.apk` + a case-insensitive search for "barreliq" returns nothing,
and the launcher label, task-switcher title and the login page title all read "BarrelTrace".

---

## 2. Phase 2B product goals

1. **Close the coach's review loop.** A coach can clear "what needs my review?" across the whole team without hunting player
   by player, and can see what is already done.
2. **Make field logging nearly free.** A pitch takes about two intentional taps; video is evidence attached to the pitch,
   never the pitch itself.
3. **Make Compare answer one question.** "What changed between these two swings?", starting from a sensible pair, with
   original video first and 3D last.
4. **Make the player/parent report trustworthy and human.** It shows only what the coach confirmed, in plain language, and it
   never leaks a draft.
5. **Delete complexity.** Every screen below loses controls. The count of visible controls per screen must go down.

**Success in one sentence:** after a game, a coach opens BarrelTrace, taps **Review**, works through pending swings in order,
logged each pitch in two taps at the field, compares two swings in two taps, and hands a parent a link that only says what
the coach believes.

---

## 3. Screen-by-screen behaviour

### 3.A Review queue (new `queue.html`) and the review page's queue mode

**Definition.** A **queue item is a swing (video clip) that has at least one finding still in `draft`.** Nothing else is in the
queue: not follow-ups, not unreviewed checklist scores, not swings without findings, not swings with only decided findings.
The queue is a list over data that already exists; it introduces no new state.

**Behaviour**

- **Entry points (two, one system):** (1) bottom nav **Review** (with count badge); (2) Team "Today" card CTA
  **Review pending swings**, which jumps *straight into the first swing* in queue mode rather than to the list.
- **Order:** players first, ordered by their **oldest pending swing**; within a player, swings in **chronological order**
  (`date`, then AB, then pitch/rep number) so an at-bat reads in the order it happened. "Next" is always the first item.
- **Start reviewing** opens the first swing with `?queue=1`. The URL carries no list of ids (no stale lists, no long URLs); the
  review page re-queries pending items itself.
- **In queue mode the review page:**
  - keeps its title-bar back arrow, which now returns to the queue;
  - shows a caption `Queue · 3 more after this`;
  - never auto-advances and never uses timers;
  - when **every finding on the swing has a decision** (approved, edited or rejected), shows a sticky bar with a single
    primary **Next swing · 3 left**; when nothing is left it shows **All caught up** with a secondary **Back to Team**;
  - offers **Skip for now** in the title-bar overflow. Skip only affects the *current session's* ordering (kept in
    `sessionStorage`, not the database); a skipped swing stays in the queue and reappears next session.
- **Decisions use the existing controls and the existing taxonomy:** Approve → `approved`, Edit → `edited`, Reject →
  `rejected` (overflow, with Undo snackbar). **No new statuses, no bulk actions.**
- **Promote to priority is exposed only after approval/edit.** In queue mode it is a **secondary** button ("Track as
  priority"), never the primary, so the coach is not nudged to create priorities while clearing a queue. Assign drill and
  progress remain reachable but are not in the queue's critical path.
- **Already reviewed:** swings whose findings are all decided are not in the pending list. They appear in a collapsed
  **Reviewed** section (last 5 swings) so the coach can confirm what is done, and open the same review page in read mode
  (decisions visible, `Edited` shows a "See original draft" disclosure from the existing `ai_original` snapshot).
- **Partially reviewed swings** stay pending and say so: `1 of 3 reviewed`.

**Deletions (explicit, opinionated)**

- Delete the review page's fallback that shows *other swings'* drafts when this swing has none
  (`issues = own.length ? own : latestAnalysisRun ? [] : all.slice(0, 5)` in `loadIssues`). Approving a finding while watching
  a *different* swing's video breaks "video is evidence". Pending findings with no linked swing are handled in §3.A.6 instead.
- Delete "Approve all", queue filters, search, sorting options, assignment, snooze persistence and per-player badges. None
  belongs in a review queue that is meant to stay small.

### 3.B Pitch quick-entry (`atbat.html`, plus a shared Log-at-bat sheet)

**Domain (unchanged):** Game → At-bat → Pitch 1..N → Video clip(s). A pitch is a row in `at_bat_pitches`; a clip is evidence
attached through `video_clips.at_bat_pitch_id`. A pitch may have no clip; a clip may not exist without a pitch owner in this flow.

**Common pitch = two intentional taps:**

1. **Record pitch** (opens the camera). The pitch row is created immediately, the clip uploads in the background and attaches
   to it.
2. **Tap the outcome** in the sheet that opens on return. That single tap saves the outcome; **swing/take and count are derived**;
   the sheet closes and the bar re-arms as "Record pitch 4".

A pitch without video is **Log pitch** + outcome (also two taps). Location is optional and never blocks the flow.

**Log at-bat** (from Add ▸ Log at-bat, and from the Overview): a bottom sheet with **Opponent** (pre-filled from the player's
most recent game), **Start at-bat**. Date is today (a "Change" text button reveals it); AB number is automatic (next AB for that
player + date + opponent); **result is not asked** (the column is nullable since migration 00015). Start creates the
`game_log_entries` row (`session_type = 'game'`) and lands on the at-bat screen with the pitch bar ready. This replaces the
6-field legacy modal as the *entry point*; the legacy modal is not deleted in 2B (see §15).

**Rules that keep it fast and honest**

- Count is **derived** from earlier outcomes (`inferCounts`); it is shown in the outcome sheet title (`Pitch 3 · count 1-1`).
  When the count cannot be known (an earlier pitch had no outcome), the title says `count unknown`; the coach can fix it in Details.
- **Swing/take is not a control in the fast path.** Outcome determines it (`swungFromOutcome`: ball, called strike, HBP, take → take;
  swinging strike, foul, in play → swing). It is displayed on the row (`Foul · Swing`) and editable in Details only.
- **Location** uses the existing 3×3 `pitch_zone` picker (values 1–9). No free-text location entry anywhere in the new flow.
  Older free-text `pitch_location` values are shown read-only ("From earlier entry: Outside, low") so no data is lost.
- After an outcome that normally ends the at-bat (ball in play, hit by pitch, ball 4, strike 3 by called/swinging strike), the row
  gets a quiet note `At-bat likely over` and the bar offers **Done**. It does not lock: a coach can always add another pitch.
- No baseball-stat complexity: no pitch-type chips, no result chips, no batter/pitcher fields, no inning/out state.

### 3.C Compare (`compare.html`)

**Question:** "What changed between these two swings?"

**Behaviour**

- **Setup friction removal:** the page opens with **suggested pairs**, not filters. One tap loads a pair. Manual selection stays
  available in a full-screen picker (see §4.C).
- **Suggested pairs** (computed client-side from data the page already loads; at most three are shown; each is a single row with
  a one-line description and dates):
  1. **Baseline → Post-drill** for the most recent practice session that has both groups (first usable baseline vs last usable
     post-drill). Ranked first when arriving from Practice.
  2. **Before → After: {priority}** for the top active priority: earliest vs latest *evidence* swing (swings a coach linked to
     an observation for that priority). Ranked first when arriving from Development (`?priority=`).
  3. **Practice → Next game** for a priority: the latest practice evidence swing vs the first ready game swing after it.
  4. **Previous game → Latest game**: a representative swing from each of the two most recent games.
  Ranking is fixed (context first, then priority-based, then recency). No scoring, no ML.
- **Order of value on screen:** (1) synchronized original video, (2) same-phase frames A/B, (3) coach-confirmed observations and
  the priority context, (4) comparable metrics, (5) 3D as an optional explanation. This is the tab order and the visual weight order.
- A is always the **earlier** swing and B the **later** (auto-ordered by date; **Swap** available).
- Compare never writes data except through the existing **Mark progress** sheet.

**Deletions**

- Delete the always-visible "1. Pick two swings" card with **five** native selects and the Clear button.
- Delete Swing/take, Practice group and Reviewed filters (the picker defaults to *ready swings only*, takes hidden).
- Delete the top-level **3D** and **Trend** tabs (3D becomes a disclosure; Trend becomes **Progress**, §4.C).
- Delete the prose paragraphs about presets and alignment; replace with one status line.

### 3.D Public player report (`report.html`, `get-player-report`)

**Audience:** the player and parent, no account, on a phone. **It shows only coach-confirmed content.** It is a keepsake and a
conversation starter, not a read-only coach screen.

**Behaviour**

- Uses the existing read-only share model (`player_share_links`, token, expiry, revoke). No new auth, no new endpoints.
- **Must-fix defect found in the audit:** `shape.ts` returns *every* checklist row (`score`, `reviewedBy`) and `report.html`
  colours a block by `score` even when `reviewedBy` is null. An **unconfirmed AI-draft score is therefore visible** to a parent as
  a coloured block, contradicting the file's own "coach-confirmed content only" header. **Fix: the server must drop every
  checkpoint whose `reviewed_by` is null**; the page never sees a draft score. This is a hotfix and should ship first.
- Hierarchy is summary-first: current focus → why → your drill → progress → what's going well → next check → watch swing →
  advanced (checklist).
- Video plays only for clips a coach linked as evidence (existing rule, unchanged).
- Language is plain and non-judgemental. Status copy changes (`shape.ts` `STATUS_LABELS`): `worse` "Needs more work" →
  **"Still developing"**; `unchanged` stays "Holding steady"; `improving` "Improving"; `resolved` "Got it".
- No internal diagnostics of any kind: no AI confidence, no analysis quality, no reconstruction detail, no `Monitoring`/`draft`/
  `needs review` coach workflow states, no first-identified dates, no coach-only notes.

### 3.E Native dialogs (only where these flows touch them)

| Native call | Reached from a 2B surface? | Action |
|---|---|---|
| `devActions.js` `confirm("Mark … as resolved?")` in the observation sheet | **Yes** (review "Is it improving?", Compare "Mark progress") | Replace with `confirmDialog` (non-destructive, primary confirm) |
| `player.html` `alert()` on Log-AB validation, insert error, upload error (lines ~1229, 1233, 1266, 1002, 1025) | **Yes, via the legacy modal** that the nav "Log at-bat" currently opens | The new Log-at-bat sheet uses inline validation + `showSnackbar`; the legacy modal is no longer reached from nav, so these are **not edited** |
| `stepper.js` `alert()` (score save error) | No (Advanced checklist opens on the player page, not in review/compare) | Leave |
| `compModal.js` two 3D `alert()`s | No (checkpoint "View 3D" on the player page) | Leave |
| `player.html` share-link, clip retry/delete, at-bat delete `confirm()/alert()` (≈ 10) | No | Leave |
| Any error path in **new** 2B code | n/a | `showSnackbar` with a retry action, never `alert()`/`confirm()` |

Legacy `toast()` calls inside the four rewritten pages are converted to `showSnackbar` as those files are rewritten; no repo-wide sweep.

---

## 4. Exact information hierarchy

Widths assume 390 dp; "sticky" means a `StickyActionBar` above the safe area. Components are the Phase 1A set in `ui.js`.

### 4.A Review queue

```
AppBar (drill-in, no tab strip):  ‹  Review                                ⋮ (none in 2B)
─────────────────────────────────────────────────────────────────────────
Summary line (supporting):   5 swings to review · 3 players
[ Start reviewing ]          (primary, full width; label = "Start with Ada T. · Sep 19 · AB 1 · Pitch 3")
─────────────────────────────────────────────────────────────────────────
Ada Tester                                                    3 swings   (section label; jersey badge 24dp)
 ▸ Sep 19 · AB 1 · Pitch 3     2 findings to review                     ›
 ▸ Sep 19 · AB 2 · Pitch 1     1 of 3 reviewed                          ›
 ▸ Sep 21 · Practice · Rep 3   1 finding · Post-drill                   ›
Bea Sample                                                    2 swings
 ▸ …
─────────────────────────────────────────────────────────────────────────
Older findings without a swing (only if > 0, muted):  4 findings ›   → Development ▸ Needs review
▾ Reviewed (last 5)   (Disclosure, collapsed)
 ▸ Sep 18 · AB 1 · Pitch 2     2 approved · 1 rejected                  ›
Bottom nav:  Team · + · Review(●5 active)
```

- Row = `ListRow` (56 dp, whole row tappable). No thumbnails (none are stored; do not fake them). Context chip only for Practice
  (`Practice · Post-drill`); Game is implicit.
- One brand-filled button on the page: **Start reviewing**.

**Review page in queue mode** keeps the Phase 1B order (video → phase track → summary → finding cards → look-for → next step → Advanced)
with these exact changes:

```
Title bar:  ‹  Ada T. · Sep 19 · AB 1 · Pitch 3                    ⋮ (Open at-bat · Compare swings · Skip for now)
Caption:    Queue · 3 more after this                              (text-3, only when ?queue=1)
[ video … phase track … ]
Summary:    2 findings · 1 approved            (or "Reviewed · 2 approved · 1 rejected" when complete)
Finding cards (first undecided expanded):   Approve (primary) · Edit (tertiary) · ⋮ Reject
   after decision:  chip Approved/Edited/Rejected · secondary "Track as priority" (approved/edited only)
[ Look-for-next … Next step (only if a priority exists) … Advanced analysis ]
Sticky (queue mode only, when all findings decided):   [ Next swing · 3 left ]      or   All caught up · Back to Team
```

- The **"Is *X* improving in this swing?"** card and **Next step** card stay where Phase 1B put them but are visually
  secondary in queue mode (compact, no eyebrow) so the primary is always the next required decision.
- Only one primary is ever visible: the next undecided finding's **Approve**, else the sticky **Next swing**.

### 4.B Pitch quick-entry (`atbat.html`)

```
AppBar (drill-in):  ‹  At-bat 1 · vs Rivals                          ⋮ (Edit at-bat · Unassigned video · At-bat summary)
Count strip:        Count 1-1 · Pitch 3 next          ← live, derived; "Count unknown" if not derivable
──────────────────────────────────────────────────────────────────────
Pitch rows (PitchRow, 64–72 dp, newest last; row tap = Details):
 1  Called strike · Take            0-0          ▢ video ready           📷  ⋮
 2  Ball · Take                     0-1          ▢ uploading…            📷  ⋮
 3  Foul · Swing · High, In         1-1          ▢ processing            📷  ⋮
──────────────────────────────────────────────────────────────────────
Disclosure (collapsed): At-bat summary   ← the existing facts-only text + Save summary (kept, demoted)
──────────────────────────────────────────────────────────────────────
Sticky:  [ Record pitch 4 ]  (primary)   [ Log without video ] (secondary)     (or  [ Done ]  when likely over)
Bottom nav: Team · + · Review
```

- The video status is a small **evidence chip on the row** (`video ready` / `uploading` / `processing` / `failed · Retry` / `no video`),
  visually subordinate to the outcome text. Multiple clips show `2 clips`. This keeps video reading as evidence.
- Row `⋮`: **Edit details**, **Add another video**, **Review swing** (when a ready clip exists), **Delete pitch** (`confirmDialog`,
  already implemented). No visible Edit/Delete buttons.
- The two duplicate link rows (`Player development · Compare swings`) are deleted; the tab strip/back arrow already cover them.
- `Unassigned video` (clips on this at-bat with no pitch) is a single `ListRow` in the `⋮` menu → sheet listing pitches (replaces the native `<select>`).

**Outcome sheet** (auto-opens after Record/Log; also opens from a row tap):

```
Sheet title:   Pitch 3 · count 1-1                                     ✕
[ Ball ]  [ Called strike ]  [ Swinging strike ]        ← 2 × 3 grid, 56 dp tall, one tap = save + close
[ Foul ]  [ In play ]        [ Hit by pitch ]
▸ Add location (optional)        ← Disclosure; expanded state remembered for the session
     ┌───┬───┬───┐   3×3 zone picker (existing pitch_zone 1–9, labels High/Mid/Low × In/Mid/Out)
     └───┴───┴───┘   caption: "Strike zone only — leave blank for pitches outside it."
▸ Other outcome · Note · Fix count      ← text buttons, secondary; not in the two-tap path
```

- Tapping a zone selects it (highlight); the next outcome tap saves outcome + zone together. Zone after the fact is added via Details.
- `Other outcome` reveals `Take` (generic) and `Other`; `Fix count` reveals the two override segmented controls (balls, strikes). Both are inside the sheet, never full-page.
- After a save: `showSnackbar("Pitch 3 · Foul saved", { actionLabel: "Change" })`.

### 4.C Compare

```
AppBar (tab-level, player tab strip visible):  Ada Tester ▾ … Overview · Development · [Compare] · Practice
Suggested pairs (shown when nothing is selected, and as a collapsed "Other comparisons" row when a pair is loaded):
  ● Baseline → Post-drill · Sep 21                       ›     ← primary-tinted row (first suggestion)
  ● Before → After: Front-side stability · Sep 12 → Sep 21 ›
  ● Practice → Next game · Sep 16 → Sep 19               ›
  Choose swings manually…                                        (tertiary)
──────────── when a pair is loaded ────────────
Selection:   [A · Sep 16 · Rep 1 · Baseline]  ⇄  [B · Sep 21 · Rep 3 · Post-drill]     (tiles; tap = replace; ⇄ = swap)
Segments:    Video · Frames · Progress · Metrics                                   (equal width, text only)
Mode body
Disclosure:  Explain in 3D   (only if both swings have 3D; lazy; shared viewpoint; the standing "estimate from one camera" caveat once)
Sticky:      [ Mark progress from this comparison ]   (only when a priority is in context and none recorded for these swings)
```

- **Video (default):** A and B side by side (≈ 187 dp each, source aspect ratio, `A`/`B` chips overlaid top-left). One shared
  transport underneath: play/pause · ±frame · speed (0.25 / 0.5 / 1, single cycling chip). **Aligned on: Contact ▾** is one chip
  that opens a phase sheet; default is Contact when both have it, else the first phase both share, else "start". One status
  line with an `info` icon replaces all warning paragraphs ("Contact is estimated on B", "Can't align on Load, playing from start").
- **Frames:** *same phase, both swings* is the default (`Stance · Load · Stride · Contact · Finish` as chips → A@phase | B@phase).
  The existing within-one-swing presets (Load→Contact, Plant→Contact, Contact→Finish) move under a `Compare two moments in one swing` disclosure; capability kept, default simplified.
- **Progress** (was "Trend"): priority context chip (defaults to the priority linked to either swing's observation, else the
  top active priority), then the **coach-confirmed observations** on these swings (status chip, note, date) and the priority's
  recent coach timeline. Coach words only; no AI text. Empty: "No coach notes on these swings yet." + the sticky Mark progress.
- **Metrics:** unchanged rules (robust rows only; reconstructed rows hidden when reconstruction is Poor; direct vs 3D-estimate
  labels). Show at most 6 rows; a `Show all` text button reveals the rest. Empty: "Metrics appear once both swings finish processing."
- **3D:** removed as a tab. Offered only when both swings have `video_clip_pose3d`; otherwise it is simply not offered (no disabled control, no apology).
- **Manual picker** (full-screen, only opened on demand): source segmented `All · Game · Practice`, a priority chip, and a list of
  ready swings (`Sep 16 · Rep 1 · Baseline`). Tap once for A, once for B; sticky **Compare**. Not-ready swings are listed
  dimmed with their processing chip and cannot be selected. No other filters.

### 4.D Public player report

```
Brand strip (32 dp):  BarrelTrace (wordmark, Oswald, small)                      ← no nav, no app bar
Player header:        [jersey]  Ada Tester   ·  Riverside Rockets 10U            (Display 28)
Current focus (hero Card):   eyebrow CURRENT FOCUS · Front-side stability · [Improving]
                             Why: Keep the front side closed longer through the plant.
Your drill (Card):           Split-stance tee drill — keeps the front side closed …   ▸ How to do it (Disclosure: instructions, equipment, coach note)
Progress (Timeline):         Sep 17 · Improving — "Much better"
                             Sep 9  · Holding steady
What's going well:           ✓ Balance   ✓ Hands stay connected            (or the empty copy below)
Next check:                  Your coach will look at this again at the next practice.     (only when a follow-up is set)
Also working on:             Hand path · Still developing            ›                   (compact rows; tap expands the same card body)
Watch swing:                 ▶ Sep 17 · Contact                                    (only for evidence-linked clips, max 3)
▸ Full swing checklist (Disclosure, collapsed; coach-confirmed items only)
Footer:                      Shared by your coach with BarrelTrace · Read-only
```

- **What's going well** sources (no new data): checkpoints a coach **confirmed** at the top score, plus **resolved priorities**
  ("Got it: …"). Empty copy: **"Strengths will appear here as your coach reviews more swings."** (no icon, no box, no warning tone).
- The **Full swing checklist** shows only coach-confirmed items and uses words, not colour blocks: 3 = "Solid", 2 = "Developing",
  1 = "Working on it". Unconfirmed items do not appear at all (no "Not yet scored" rows).
- Multiple priorities: the top active one is the hero; the rest are collapsed rows under **Also working on**. Resolved priorities appear last, prefixed "Got it".
- "Monitoring" priorities are presented as ordinary "working on" (the coach-only distinction is not exposed).

---

## 5. Primary / secondary / overflow actions

| Screen | Primary (one) | Secondary | Overflow / hidden |
|---|---|---|---|
| **Review queue** | Start reviewing | Row tap → open swing | Reviewed disclosure; "Older findings" row |
| **Review (queue mode)** | Approve (next undecided finding) → **Next swing** when all decided | Edit · Track as priority (after approval) · Assign drill · Update progress | Reject (+ Undo) · Skip for now · Open at-bat · Compare swings |
| **At-bat / pitches** | Record pitch N (or **Done** when likely over) | Log without video · row tap = Details · attach/add clip (row camera) | Edit at-bat · Unassigned video · Delete pitch · Review swing · At-bat summary |
| **Outcome sheet** | *An outcome button* (single tap commits) | Add location · Other outcome · Note · Fix count | — |
| **Log at-bat sheet** | Start at-bat | Change date | — |
| **Compare (no pair)** | First suggested pair | Other suggestions · Choose manually | — |
| **Compare (pair)** | Mark progress from this comparison (when applicable), else none | Play/step/speed · Aligned-on chip · Swap | Open review A/B · Compare two moments in one swing · Explain in 3D · Show all metrics |
| **Public report** | — (read-only) | Watch swing · How to do it · Also working on | Full swing checklist |

Rules: at most one brand-filled control visible per screen state; destructive actions never visible at rest; every irreversible
delete uses `confirmDialog`; every reversible change (reject, outcome change) uses Undo/Change on a snackbar.

---

## 6. Loading, empty, error, partial-processing and already-reviewed states

### 6.A Review queue and queue-mode review

| State | Behaviour |
|---|---|
| Loading | 3 skeleton `ListRow`s; nav badge simply absent until known |
| Empty (nothing pending) | Icon `circle-check`, **"You're all caught up"**, one line "New swings show up here after they're analyzed.", no button |
| Empty but reviewed items exist | Same message, plus the collapsed **Reviewed** section |
| Error | `errorState("Couldn't load the review queue", … , "Try again")`; never an empty list on failure |
| Older findings without a swing | Single muted row per team (see §9); never blocks "All caught up" |
| Swing not ready (processing/failed) | Not in the queue (no ready video, nothing to review); shown on the at-bat/session row's evidence chip instead |
| Ready, analysis finished, no findings | Not in the queue; on the review page: the existing "No findings for this swing" state; if `analysis_runs.no_action_needed`, the run's reason is shown as-is |
| Ready, **no analysis run yet** | Not in the queue; review page: "Findings appear here once analysis finishes." (see §9 gap: cannot say "analyzing" honestly) |
| Already reviewed (opened from Reviewed) | Cards collapsed, chips show decisions, no decision buttons; `Edited` offers "See original draft"; a quiet "Reviewed" summary line; **no sticky Next-swing bar** |
| Partially reviewed | Stays pending; `1 of 3 reviewed`; only undecided findings show Approve |
| Decision write fails | Snackbar "Couldn't save. Try again" with Retry; the card keeps its previous state |
| Someone else decided it meanwhile | On reload the card shows the new state; no error, no duplicate write |

### 6.B Pitch quick-entry

| State | Behaviour |
|---|---|
| Empty at-bat | Title "No pitches yet", line "Record or log the first pitch." (the sticky bar *is* the action; no second button in the empty state) |
| Loading | Row skeletons; sticky bar disabled |
| Camera cancelled | Nothing is created; no snackbar |
| Video selected | Pitch row created first; outcome sheet opens; upload runs in the background |
| Uploading | Row chip `Uploading…` (indeterminate; **no percentage**, none is available via `fetch`); the coach can keep logging; caption once: "Uploads continue while BarrelTrace is open." |
| Upload failed | Row chip `Failed · Retry`; the file is kept in memory for one retry; if the page was reloaded the chip says "Re-record to try again" |
| Processing / ready / failed clip | The Phase 1A processing vocabulary (`Waiting to process`, `Processing`, `Ready`, `Failed`) on the evidence chip |
| Outcome save fails | Snackbar "Couldn't save pitch 3" with **Retry**; the outcome stays selected in the sheet |
| Offline | Snackbar "You're offline. Pitches can't be saved yet." The sheet stays open with the selection; **no offline queue in 2B** (see §15) |
| Pitch number collision (two devices) | On `23505` re-read pitches and use the next free number; never surface the DB error |
| Count unknown | Title says `count unknown`; Fix count available |
| At-bat likely over | Quiet row note; bar offers **Done**; adding another pitch is always allowed |

### 6.C Compare

| State | Behaviour |
|---|---|
| No swings at all | `emptyState("No swings to compare yet", "Record a rep or a pitch to start.", Record)` |
| Fewer than 2 ready swings | "You need two swings to compare." + shows the one swing; picker opens for B |
| No suggestion available | The suggestions block is replaced by "Choose two swings" + the picker button (no empty dashed box) |
| Loading | Two video frames render as neutral placeholders with spinners; controls disabled |
| One video fails | That side shows "Video unavailable · Try again"; the other keeps working; transport controls stay enabled for the working side |
| Both fail | `errorState("Couldn't load these videos", "Check your connection and try again.")` |
| Not aligned | One status line; playback starts at 0 for both |
| Swing still processing | Cannot be selected; in the picker it is dimmed with its processing chip |
| No metrics / no 3D | Metrics tab shows its empty line; 3D is not offered |
| Reconstruction Poor | Reconstructed metric rows hidden (existing rule); 3D disclosure carries the standing caveat |
| Already-recorded progress for this pair | The sticky Mark progress is hidden; Progress shows the existing note |

### 6.D Public report

| State | Behaviour |
|---|---|
| Loading | Header skeleton; no spinner-only screen |
| Invalid / expired / revoked | One generic page: "This link isn't available. Ask your coach for a new link." (still **not** revealing which case) |
| Network error | Distinct from the above: "Couldn't load. Check your connection." with **Try again** |
| No priorities | "Your coach hasn't set a focus yet. It will appear here after they review your swings." |
| No strengths | "Strengths will appear here as your coach reviews more swings." |
| No progress notes | Timeline omitted (no empty heading) |
| No drill | "Your coach will add a drill here." |
| No shared clips | "Watch swing" section omitted entirely |
| Video fails/expired (URL is valid ~15 min) | "Video unavailable. Reload to try again." — reloading requests a fresh signed URL |
| Resolved priority | Shown last, prefixed "Got it" |

---

## 7. Mobile behaviour

**Common:** target viewport 390 × 844 dp, 100% and 130% font scale, portrait; every interactive element ≥ 48 × 48 dp with ≥ 8 dp
between targets; sheets use the Phase 1A bottom-sheet with `visualViewport` handling and a sticky footer; Android Back closes
the topmost overlay, then goes to the *logical* parent; sticky bars sit above `env(safe-area-inset-bottom)`.

- **Review queue:** the whole row is the target (56 dp). `Start reviewing` is full-width at the top (reachable, not sticky, because the list is short). Badge on the nav item is a 16 dp dot/count, never the only signal (the accessible name carries the count).
- **Review page:** the video and first finding title are visible without scrolling on 390 × 844. The queue sticky bar replaces the bottom nav on this page (as the UX spec requires) so **Next swing** is a thumb-reach control. Landscape → full-screen video (spec §11.1, Phase 3), no queue chrome.
- **Pitch entry:**
  - The **Record pitch** bar is thumb-zone and one-handed. Camera launch uses `<input type="file" accept="video/*" capture="environment">` (already used on `player.html`; the at-bat page currently omits `capture`).
  - Outcome buttons are 56 dp tall in a 2 × 3 grid, laid out for a right thumb; the sheet must fit **without scrolling** at 390 × 844 with the location disclosure collapsed.
  - Keep the screen awake is *not* requested (battery); do not autofocus text fields; the note field is the only keyboard-triggering control and lives behind a text button.
  - Long at-bats (≥ 12 rows) keep the count strip and sticky bar pinned; rows scroll.
  - Coach is often gloved/in sun: no gesture-only controls, no swipe-to-delete, no long-press requirements.
- **Compare:** side-by-side video at 390 dp is the design point; at ≥ 130% font the segments may drop to 13 sp but never scroll. Two simultaneous full-resolution videos are heavy: **decode paused, play only on tap**, preload metadata only, and pause both when the tab is backgrounded. Real-device verification is required (§13).
- **Public report:** single column, 16 dp gutters, the video is full width and `playsinline`, no fixed positioning, works from a shared link opened in an in-app browser, no login prompts.

---

## 8. Accessibility requirements

- **Roles/names:** queue rows are links with names like "Ada Tester, September 19, at-bat 1, pitch 3, 2 findings to review". The nav Review item's accessible name includes the count ("Review, 5 swings waiting"). Outcome buttons are a `radiogroup`-style set of buttons with `aria-pressed` before commit; zone picker buttons are named by their label ("High, In, zone 1").
- **Announcements:** decision, outcome-saved and queue-advance events use a polite live region ("Approved. Undo available."; "Pitch 3 saved: Foul, swing. Count 1-1"; "Next swing: Bea Sample, September 19, at-bat 2").
- **Focus:** opening a sheet moves focus to its title; closing returns focus to the triggering control; after **Next swing** focus lands on the new page's `h1`. The auto-opening outcome sheet is announced ("Record outcome for pitch 3").
- **Not colour alone:** status chips carry text + icon; zone selection also changes weight/border; A/B are letters on the video, not just colours.
- **Video:** native controls or labelled buttons (Play, Pause, Previous frame, Next frame, Speed 0.5×). The compare transport is keyboard/TalkBack reachable in order A → B → shared controls. Captions are not available (no audio content is authored).
- **Contrast/size:** text ≥ 4.5:1, UI ≥ 3:1 (Phase 1A tokens already verified by `verify-ux-contrast.mjs`); minimum text 12 sp; layouts must survive 200% font scale with wrapping, not clipping.
- **Zoom:** pinch-zoom stays enabled on all pages (Phase 1A removed the lock; do not reintroduce it, especially on the public report which may be read by low-vision family members).
- **Motion:** no auto-advancing, no auto-playing video with sound, sheet/disclosure animation respects `prefers-reduced-motion`.
- **Public report:** the page has a single `h1` (player name), headings in order, drill instructions and timeline are real lists, links/buttons have descriptive names ("Watch swing from September 17, contact").

---

## 9. Data already available vs genuine gaps

### 9.1 Already available (no schema change needed)

| Need | Source |
|---|---|
| Pending findings, their swing and state | `issues` (`review_status`, `video_clip_id`, `created_at`, `suggest_priority`, `context_explains_it`, `ai_original` snapshot on first decision) |
| Swing context for a queue row | `video_clips` → `game_log_entries` (`date`, `ab`, `session_type`), `at_bat_pitches` (`pitch_number`, outcome), `practice_repetitions` (`rep_number`, `grouping`) via one PostgREST embed |
| Analysis finished / no-action | `analysis_runs` (`video_clip_id`, `no_action_needed`, `no_action_reason`) |
| Team scoping & RLS | Existing policies; the same `players!inner(team_id)` filter `teamDashboard.js` already uses |
| Pitch model | `at_bat_pitches` incl. `pitch_outcome` enum, `swung`, `count_before_*`, `pitch_zone` (1–9), `pitch_type`, `notes`; unique `(game_log_entry_id, pitch_number)` |
| Derived count & swing/take | `inferCounts`, `swungFromOutcome` in `developmentLogic.js` |
| Result may be omitted | `game_log_entries.result` is nullable (migration 00015) |
| Video attach to pitch | `uploadRawClip(entryId, file, { pitchId })` + the 00027 default-link trigger |
| Compare pairs | `loadSwingRecords` (context, group, priority ids via observations), `player_priority_observations.video_clip_id`, `practice_repetitions.grouping`, `swing_phases`, `video_clip_metrics`, `video_clip_pose3d` presence |
| Report content | `player_priorities`, `player_priority_drills` + `drill_library`, `player_priority_observations`, `checklist_scores`, `player_share_links` (expiry/revoke) |
| Report follow-up (server-side only) | `player_priorities.follow_up_kind/date/swings` exist; `get-player-report` simply does not select them yet |

### 9.2 Genuine gaps (each has a stated 2B behaviour; none is fixed with a migration here)

| # | Gap | 2B behaviour |
|---|---|---|
| G1 | **`issues` has no `reviewed_at`.** "Reviewed" cannot be time-stamped or sorted by decision time. | Reviewed section is ordered by **swing date** and says "Reviewed", never "reviewed today". |
| G2 | **Legacy drafts have `video_clip_id = null`** (created before migration 00025). They cannot open a swing. | Excluded from queue and badge; one muted row "Older findings without a swing · N" links to Development's existing needs-review list. |
| G3 | **No "analysis running" state.** Only `analysis_runs` existence distinguishes finished from not-yet/never-run. | Neutral copy ("Findings appear once analysis finishes"); never claim "Analyzing…" or show progress. |
| G4 | **No batter handedness.** The picker's In/Out columns cannot be mirrored for a left-handed batter. | Keep the existing In/Mid/Out label semantics unchanged; the labels, not the screen position, carry the meaning. Mirroring deferred. |
| G5 | **`pitch_zone` covers only the strike zone (1–9).** No value for a pitch outside it. | Location stays blank for those pitches; caption says so. Do not force a zone. |
| G6 | **No thumbnails/poster frames stored.** | Rows are text + chips; no fake imagery. |
| G7 | **No low-resolution proxy video.** Source clips can be 4K; two simultaneous decodes may stutter on low-end phones. | Paused-by-default, play on demand; measure on a real device before deciding whether a proxy is needed (deferred). |
| G8 | **`fetch` uploads expose no progress.** | Indeterminate chip only; no percentage. |
| G9 | **No offline write queue.** | Honest offline message; keep the selection in the sheet. |
| G10 | **`get-player-report` returns unconfirmed checkpoint scores** and omits follow-up info. | Server-side fix in `shape.ts`/`index.ts` (drop `reviewed_by = null` rows; add a derived `nextCheck` phrase). No migration. |
| G11 | **Team "Today" counts findings but labels them "swings"** (`teamAttentionModel` sums per-player draft *issue* counts). | Count **distinct swings** (`video_clip_id`) for both the headline and the badge. |
| G12 | Practice outcome has no "Worse" (2A). | Out of scope; unchanged. |

---

## 10. What must NOT be changed

- **Schema, migrations, RLS, triggers** (00025-00028). No new columns, no views, no policies.
- **AI behaviour**, prompts, analysis policy, knowledge layer, `analysis_runs`, `ai_original` snapshot semantics, finding generation, `suggest_priority`.
- **Approval taxonomy and stored values:** `issues.review_status` (`draft/approved/edited/rejected`), priority statuses, observation statuses, practice outcomes, `video_clips.status`, `pitch_outcome`, `practice_repetitions.grouping`.
- **Coach authority rules:** approval never automatic; re-analysis never overwrites decided issues; promote-to-priority stays a coach action; no "approve all".
- **Measurement/CV pipeline, phase detection, metric definitions, 3D reconstruction, video storage and the processing worker.**
- **Share-link model:** token, expiry, revoke, generic invalid message, and "video only for evidence-linked clips". Only the *shaping whitelist* and one derived field change.
- **`inferCounts` / `swungFromOutcome` semantics.** New helpers may be *added* (e.g. "outcome likely ends at-bat"); existing ones are not altered.
- **`pitch_zone` numbering and the picker's label meaning**, and legacy `pitch_location` text (kept, read-only).
- **Routes and deep-link contracts:** `?team=&player=`, `?entry=`, `?session=`, `?clip=&phase=`, `?a=&b=&mode=&priority=&phase=`, `?token=`, `?openLog=1`. Additions only: `queue.html`, `?queue=1`.
- **Phase 2A screens** (Development, Practice) beyond the three closeout fixes in §1.
- **Phase 1A design tokens and components**; new UI is composed from them.
- **Advanced checklist scoring and the 3D viewer internals.**
- The legacy `player.html` Log-AB modal and its ~12 unrelated native dialogs (deferred, §15).

---

## 11. Implementation order

Ordered by risk first, value second, with dependencies respected. Each step is independently shippable and testable.

0. **Closeout micro-fixes (§1)** — goal wrap, assessment sticky rule, anchor-button underline, clean-build verification. *Minutes each; do first so 2B starts from a clean 2A.*
1. **Public-report leak hotfix.** In `shape.ts` drop checkpoints with `reviewed_by = null`; extend the integration test to assert no unconfirmed score appears. *Highest trust value, tiny change, ships before anything else in 2B.*
2. **Pure models + tests, no UI.** `reviewQueue` (grouping, ordering, counts, "next", already-reviewed classification), compare pair suggestions, pitch entry helpers (likely-ends-at-bat, count title, collision-safe next number), report shaping additions. Node unit tests only.
3. **Review queue + review queue mode.** New `queue.html`; bottom nav **Review** slot with badge (replaces the interim Player slot); Team "Today" fix (G11) and CTA; review page queue mode, fallback deletion, sticky Next swing, already-reviewed state; resolve-priority `confirmDialog`.
4. **Pitch quick-entry.** Log-at-bat sheet (opponent, Start); rewritten `atbat.html` (drill-in bar, count strip, `PitchRow`, sticky Record/Log bar); outcome sheet with optional zone; upload-as-evidence chips + retry; delete duplicate links and per-row buttons.
5. **Compare.** Suggested pairs, selection tiles, manual picker, Video/Frames/Progress/Metrics, "Explain in 3D" disclosure, single status line.
6. **Public report redesign.** New report page on the shaped data (focus hero, drill, timeline, strengths, next check, watch, advanced); friendly invalid/network states; `STATUS_LABELS` copy.
7. **Verification pass.** Unit + integration + page-wiring tests, emulator QA at 390 × 844 / 130% font, a physical-device pass for Compare and pitch capture, screenshots for the acceptance list.

*Why this order:* the leak fix is a correctness issue; the queue closes the coach's core loop and is the lowest-risk new screen; pitch entry is field-critical but the largest rewrite; Compare depends on stable review/observation semantics; the report redesign is independent and safest last once its data is verified.

---

## 12. Acceptance criteria

**Review queue**
- [ ] The queue lists **only** swings with ≥ 1 `draft` finding that has a `video_clip_id`; a swing with all findings decided is absent from Pending and present in Reviewed.
- [ ] The nav badge, the Team headline and the queue's row count agree (all count distinct swings) for the same data.
- [ ] From Team, **Review pending swings** opens the first swing in ≤ 1 tap; from the nav, **Start reviewing** in ≤ 2 taps.
- [ ] Order is player-by-oldest-pending, then chronological within player.
- [ ] "Track as priority" is absent on an undecided finding and appears only after Approve/Edit; it is secondary in queue mode.
- [ ] After the last finding on a swing is decided, a sticky **Next swing · N left** appears; nothing auto-advances; with none left it reads **All caught up**.
- [ ] The review page never shows findings that belong to a different swing.
- [ ] Reject offers Undo; Undo restores `draft` and the row returns to Pending.
- [ ] Empty, loading, error and partially-reviewed states match §6.A.

**Pitch quick-entry**
- [ ] A common pitch is logged in **≤ 2 intentional taps** (Record pitch → outcome; or Log pitch → outcome), with count and swing/take derived and shown.
- [ ] The outcome sheet fits 390 × 844 without scrolling; every outcome button is ≥ 56 dp tall.
- [ ] Location uses only the 3×3 zone picker; there is **no free-text location field** in the new flow; legacy `pitch_location` text still displays.
- [ ] A recorded video appears as an evidence chip on its pitch row and progresses uploading → waiting → processing → ready/failed; a failed upload offers Retry.
- [ ] `at_bat_pitches` and `video_clips` rows have the same shape and links as before (verified against the existing tests); no new columns.
- [ ] Concurrent pitch-number collisions never surface a raw database error.
- [ ] No visible Edit/Delete buttons on pitch rows; delete uses `confirmDialog` from `⋮`.
- [ ] New at-bats created with a null `result` render everywhere without blank/undefined text.

**Compare**
- [ ] With ≥ 2 ready swings, opening Compare shows ≥ 1 suggested pair when one exists, and one tap loads it.
- [ ] Baseline → Post-drill from Practice reaches side-by-side video in ≤ 2 taps (existing link) and the pair is A = earlier, B = later.
- [ ] Manual selection is possible with **no more than two filters**; not-ready swings are not selectable.
- [ ] Tab order is Video · Frames · Progress · Metrics; 3D is a disclosure offered only when both swings have 3D.
- [ ] Video mode shows A and B side by side, a single transport, one alignment chip and one status line; both videos start paused.
- [ ] Progress shows only coach-authored notes/statuses (no AI text).
- [ ] Deep links `?a=&b=&mode=&priority=&phase=` still work; `mode=trend` maps to Progress and `mode=3d` opens the 3D disclosure.
- [ ] One video failing does not disable the other.

**Public report**
- [ ] The API response and the rendered page contain **no** checkpoint whose `reviewed_by` is null, and no AI confidence, analysis-quality, reconstruction or coach-only workflow field (asserted in a test that scans the JSON).
- [ ] Order is focus → drill → progress → strengths → next check → watch → advanced.
- [ ] Empty strengths reads exactly "Strengths will appear here as your coach reviews more swings."
- [ ] "Worse" is presented as "Still developing"; no red status colour appears on the public page.
- [ ] Invalid/expired/revoked links show one generic page; a network failure shows a retry page.
- [ ] Watch swing works only for evidence-linked clips and recovers from an expired signed URL by reloading.

**Cross-cutting**
- [ ] One brand-filled control per screen state; no `confirm()/alert()` reachable from the four flows (§3.E table).
- [ ] All touch targets ≥ 48 dp; layouts survive 130% and 200% font scale; pinch-zoom works; Back closes sheets first.
- [ ] `npm test`, `npm run build`, contrast check and the page-wiring tests pass; new pure models have unit tests; no migration files added.

---

## 13. QA matrix

**Devices/configurations:** (a) Android emulator 390 × 844 dp @ 420 dpi, 100% font; (b) same at font scale 130%; (c) same at 200%; (d) small 5" emulator (keyboard tests); (e) one physical mid-range Android phone (camera, video decode, cellular); (f) PWA in Chrome on Android (report and queue only); (g) `com.barreliq.coach` uninstalled before every run.

| Area | Scenario | Config | Pass condition |
|---|---|---|---|
| Queue | 0 pending, 0 reviewed | a | "All caught up", no badge |
| Queue | 5 swings / 3 players, 1 partial | a, b | Grouping/order per §3.A, "1 of 3 reviewed" |
| Queue | Legacy draft with no swing | a | Muted row, excluded from badge |
| Queue | Decide all findings on a swing | a, e | Sticky Next swing; skipped swing returns next session |
| Queue | Reject → Undo | a | Returns to Pending; `ai_original` preserved |
| Queue | Another coach's team | a | Never visible (RLS) |
| Review | Open swing already fully reviewed | a | Read mode, no Next bar |
| Review | Analysis run exists, no findings | a | No-action reason shown |
| Review | Swing with no analysis run | a | "Findings appear once analysis finishes" |
| Pitch | Record → outcome for pitches 1–6, then walk (ball 4) | e | ≤ 2 taps each; "likely over" after ball 4; count correct |
| Pitch | Foul at 2 strikes | a | Count stays; no "likely over" |
| Pitch | Outcome then zone later (Details) | a | `pitch_zone` saved; label correct |
| Pitch | Camera cancelled | e | No row created |
| Pitch | Upload fails (airplane mode) then retry | e | `Failed · Retry`; retry succeeds; row keeps outcome |
| Pitch | Two devices add pitch simultaneously | a ×2 | No raw DB error; distinct numbers |
| Pitch | Old at-bat with free-text `pitch_location` | a | Shown read-only |
| Pitch | Delete pitch with a clip | a | `confirmDialog`; clip becomes unassigned |
| Pitch | Log at-bat from Team, Overview and nav | a | Same sheet everywhere; result stays null |
| Compare | Arrive from Practice / Development / Review / nav | a | Correct suggestion first; deep link honoured |
| Compare | Two 4K clips, play both at 0.5× | e | Starts on tap; drift/stutter noted; pause on background |
| Compare | One clip not ready | a | Not selectable; processing chip |
| Compare | Poor reconstruction | a | Reconstructed metrics hidden; 3D caveat |
| Compare | Mark progress from pair | a | Existing observation sheet; resolve prompt is a `confirmDialog` |
| Report | Confirmed vs unconfirmed checkpoints | a, f | Unconfirmed absent from JSON and page |
| Report | No strengths / no drill / no clips | a, f | Copy per §6.D, no empty headings |
| Report | Expired, revoked, garbage token; offline | a, f | Generic page vs retry page |
| Report | Signed URL expiry mid-session | f | "Reload" recovers |
| A11y | TalkBack through queue, outcome sheet, compare transport | e | Names/order/announcements per §8 |
| Mobile | Back from sheet, from review queue, from compare | a | Sheet first, then logical parent |
| Mobile | Keyboard in Note/Fix count/Log-at-bat opponent | d | Primary button visible above keyboard |
| Brand | Launcher label, task switcher, login title, APK string scan | a, e | "BarrelTrace" only |

---

## 14. Files and components likely to be touched

**New**

| File | Purpose |
|---|---|
| `coach/queue.html` | Review queue page (drill-in, uses `AppBar`, `ListRow`, `Disclosure`, `emptyState/errorState`) |
| `coach/components/reviewQueue.js` (+ `.test.mjs`) | Pure: classify swings (pending/partial/reviewed), group/order, counts, "next", skip handling |
| `coach/components/pitchEntry.js` (+ test) | Outcome sheet, Log-at-bat sheet, at-bat-likely-over rule, count title, collision-safe pitch numbering, upload-as-evidence queue with retry |
| `coach/components/comparePairs.js` (+ test) | Pure: suggested-pair rules and ordering |

**Modified**

| File | Change |
|---|---|
| `coach/review.html` | Queue mode, remove other-swing fallback, sticky Next swing, already-reviewed state, secondary Track-as-priority |
| `coach/atbat.html` | Full rewrite to the layout in §4.B (drill-in bar, count strip, `PitchRow`, sticky bar, Details sheet) |
| `coach/compare.html` | Suggested pairs, selection tiles, picker, four modes, 3D disclosure, status line |
| `coach/report.html` | Public report layout (§4.D), friendly states |
| `coach/components/appShell.js`, `shellState.js` | Nav `Team · Add · Review` with async badge (cached ~60 s in `sessionStorage`, invalidated on a decision); "Log at-bat" opens the new sheet |
| `coach/components/teamDashboard.js`, `phase1bScreens.js` | Distinct-swing counts (G11); CTA opens queue mode; legacy-draft row |
| `coach/components/devActions.js` | Resolve-priority `confirm()` → `confirmDialog` |
| `coach/components/developmentLogic.js` | **Additive** helpers only (e.g. outcome likely ends at-bat); existing functions unchanged |
| `coach/components/videoUpload.js` | Return the created clip id (for the evidence chip); keep `capture="environment"` behaviour at the call site |
| `coach/components/pitchZonePicker.js` | Reuse; optionally a zone-only render helper for the sheet (no semantic change) |
| `coach/components/practicePage.js`, `coach/coach.css` | §1 closeout only (goal wrap, assessing rule, anchor underline) |
| `coach/coach.css` | Styles for queue rows, PitchRow, outcome grid, compare tiles/status line, report layout |
| `coach/sw.js`, `scripts/bump-coach-cache.mjs` | Precache/stamp `queue.html` and the new components |
| `coach/components/pages.test.mjs` | Add `queue` to page-wiring checks; `report` allowlist |
| `supabase/functions/get-player-report/shape.ts`, `index.ts` | Drop unconfirmed checkpoints; add derived `nextCheck`; new status copy; select follow-up columns |
| `src/services/db/developmentFlows.test.ts` | Report leak + shape assertions (extend existing report test) |
| `CHANGELOG.md`, `readme.md` (screens table), versions | Per project rules on a real capability change |

**Explicitly not touched:** `coach/development.html`, `practicePage.js` beyond §1, migrations, edge functions other than `get-player-report`, worker/pipeline, `skeletonScene.js`, `stepper.js`, `compModal.js`, the legacy `player.html` Log-AB modal.

---

## 15. Deferred (recommended not to do in 2B)

- **Queue extras:** filters, search, sort options, bulk approve, snooze persistence, assignment, per-player badges, notifications/push. *(Deliberately unnecessary; deleting them keeps the queue small.)*
- **Thumbnails/poster frames** (needs pipeline/storage work) and any thumbnail UI.
- **Offline write queue** for pitches/outcomes (real field need, but a separate reliability project).
- **Batter handedness** and picker mirroring; an **out-of-zone location grid** (needs schema).
- **Pitch-type chips** (sport-specific list is a product decision); **at-bat result chips or derivation**; any baseball-stat fields.
- **Real upload percentage** (requires switching to `XMLHttpRequest`); indeterminate state is honest and sufficient.
- **A low-resolution proxy video** for Compare (decide after the physical-device test); landscape Compare; onion-skin/overlay comparison; automatic "best pair" selection; metric trend charts inside Compare.
- **Analysis-status field** (to say "Analyzing…") and **`issues.reviewed_at`** (to say "reviewed today").
- **Public report extras:** light theme, print/PDF, coach name/avatar, translations, per-priority sharing controls.
- **Deleting the legacy `player.html` Log-AB modal** and the remaining ~12 native dialogs there, plus `stepper.js` and `compModal.js` alerts.
- **Practice outcome "Worse"** and any change to Development/Practice beyond §1.
- **Repo-wide native-dialog refactor to zero** (explicitly out of scope).
- **`@capacitor/app`** or other native plugins.
