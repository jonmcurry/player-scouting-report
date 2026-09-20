# BarrelTrace UX/UI redesign specification

**Status: specification only. No code, CSS, markup, migration, config or dependency was changed to produce this document.**
AI behaviour, the measurement pipeline, database semantics, RLS, video storage, the processing worker and the
knowledge architecture are out of scope and untouched.

**Sources.** The repo at commit `2eb443a` (v0.14.1) is the authority: `readme.md`, `ux.md`, `coach/*.html`,
`coach/coach.css`, `coach/components/*.js`, `coach/manifest.json`, `mobile/capacitor.config.json`,
`mobile/android/app/src/main/AndroidManifest.xml`, `supabase/migrations/00025-00028`,
`supabase/functions/get-player-report/shape.ts`, and `docs/CONTINUOUS_KNOWLEDGE_ARCHITECTURE.md` (read for context only).
The 53 emulator screenshots in `screenshots/` were also used (1080×1920 Android emulator, seeded fictional data). They
show one state per screen, so states that only exist in code are listed separately in §1.4.

**What I could not verify.** Contrast ratios below were computed by hand and must be re-checked with a tool. Keyboard
overlap, Android back-button behaviour, large-font behaviour and landscape were read from code and config, not tested on a
device; each is marked **UNVERIFIED** where it matters. Dimensions in dp assume the emulator's roughly 2.6× density.

**Naming.** The product is now BarrelTrace (`2eb443a`, "Rebrand BarrelIQ to BarrelTrace"). The `coach/` source is clean;
stale "BarrelIQ" strings remain only in generated Android assets under `mobile/android/app/src/main/assets/public/`
(rebuilt by `cap sync`). This spec uses BarrelTrace throughout.

---

## 1. Current UX audit

### 1.1 Headline findings

1. **Chrome eats about a third of the screen before any content.** On player pages (measured on the 1920 px screenshots):
   two-row app bar ≈ 74 dp, tab strip with margins ≈ 96 dp, bottom nav ≈ 67 dp. That is ≈ 237 dp of ≈ 683 dp usable height
   (≈ 35%). The 4-tab strip is also clipped: "Practice" is cut off at 390 px width and only reads as scrollable because of a
   partial pill.
2. **Every screen is a stack of equal-weight bordered cards.** Team, Development, Practice and At-bat all render 5–8
   same-sized cards with the same border, radius and heading treatment, so nothing signals "look here first".
3. **The flagship workflow hides behind five equal buttons.** A review finding shows *View evidence, Approve, Edit, Reject,
   Promote to priority* in one wrapping row (`review.html` `renderObservations`). The decision the coach should make
   (approve) is the same visual weight as four secondary actions.
4. **Web-style CRUD leaks into field flows.** Pitch cards carry *Attach video / Edit / Delete* (`atbat.html`); rep cards
   carry group `<select>`, a *Usable* checkbox, *Attach video*, *Delete*, plus *Review swing* (`session.html`); priority
   cards carry *Log progress, Assign drill, Follow-up, Status* plus four workflow-state boxes (`development.html`).
5. **Modals are desktop-style.** `closeableModal`/`openSheet` render a centred `.modal` (max-width 480, max-height 85vh) with
   a floating close button (`float: right`) that collides with the title rule (see `36_atbat_edit_pitch.png`,
   `38_practice_new_session.png`). Forms are stacked full-width native `<select>`s and inputs.
6. **Native `confirm()`/`alert()` are used for destructive and error paths**: 15 in `player.html`, plus `atbat.html`,
   `session.html`, `compModal.js`, `devActions.js`, `stepper.js`.
7. **The same concept has several names and several colours** (see §18): *Confirmed* / *Approved* / *Verified* / *Coach
   Reviewed*; *Improved* / *Improving*; *Needs review* is brand-clay in one place and amber in another.
8. **Terracotta is the default colour of everything**: h2 headings, links, active tab, active chip, primary buttons,
   "needs review", "active", card left rail, list bullets' links, jersey badge, nav FAB. When everything is accented,
   nothing is.
9. **Accessibility defects in the shell**: `maximum-scale=1, user-scalable=no` on 8 of 9 pages blocks pinch-zoom;
   brand-clay text on the page background is ≈ 4.2:1 and white on the clay button is ≈ 4.4:1 (both below 4.5:1 for small
   text); `--text-muted` on `--surface-1` is ≈ 4.4:1.
10. **Navigation labels collide.** The bottom nav's **Report** and the player tab strip's **Report** both open `player.html`,
    which is a hub (priorities, diagnosis, game log, practice log, checklist drawer, manage player), not a report. The public
    `report.html` is the actual report. At-bat, review and session-detail pages reuse the tab strip and highlight the wrong tab
    (At-bat shows *Report* active).

### 1.2 Screen-by-screen audit

| Screen (file) | Overloaded / weak hierarchy | Duplicate or excessive controls | Web-style patterns | Technical or redundant language |
|---|---|---|---|---|
| **Teams home** (`index.html`) | Fine as a list; summary line is a small grey caption | *Sign out* is a full-width button under the team list | — | — |
| **Team** (`team.html` + `teamDashboard.js`) | Six equal cards (*Needs review, Follow-ups due, Active priorities, Recent progress, Recent practice, Recent game swings*) sit **above** the roster, pushing the team's main content down. "Nothing is due." gets a whole card | Roster toolbar: 4 filter chips + *+ Add Player*; 4-item colour legend for a checklist heat-map that is now secondary | Underlined terracotta text links inside bullet lists | "0/2 Confirmed" pill (checklist confirmation) is meaningless to the new workflow; "Priority Flaws"; 🔴/⚠ emoji chips |
| **Player hub** (`player.html`) | Order: stats row → Working on → collapsed checklist → *Diagnosis, Comps & Plan* (4 drawers) → Game Log → Practice Log → Manage Player. Game/practice cards embed the scrubber, 3D viewer and comp modal inline, duplicating `review.html`. 1,329 lines | Stats row (*Logged ABs, Team avg, Status*): low-value; "Early Read (1/3)" is shown in **success green**, which reads as good news but is a caution. Per-card 🗑 delete on every at-bat | Log AB is a giant central modal with 6 text inputs including legacy at-bat-level pitch/zone/result that duplicate `at_bat_pitches` | "Primary Issue(s) Identified", "Comp Illustration — An Example, Not an Ideal Template" |
| **Swing review** (`review.html`) | Chrome (≈ 170 dp) + context card pushes the video down. Then *What I see → What to work on → What to look for next time → Track progress → Details*: four full headings before any advanced content | 5 equal actions per finding. *Track progress* repeats **five** progress buttons **per priority** | Underlined links (*At-bat summary · Development*) in the context card | "Video unavailable — The original video couldn't be loaded right now" is fine; "Analysis quality: Not measured" rows are noise |
| **At-bat** (`atbat.html`) | Cards are tall (~210 dp each): title, count, outcome, notes, video status, 3–4 buttons | *Attach video / Edit / Delete* on every pitch; *Add another video*; separate *Unassigned video* card | Edit sheet is a full form: outcome `<select>`, swing/take `<select>`, balls `<select>`, strikes `<select>`, pitch type, **free-text** location, notes. The 9-zone picker and `pitch_zone` column exist (`pitchZonePicker.js`, migration 00025) but this sheet does not use them | "(from earlier pitches)" appended to every inferred count |
| **Practice list / session** (`session.html`) | Detail page = 7 stacked sections: session card, *Summary*, *Did the movement change inside this session?*, *Reps*, add-rep card, *Coach assessment*. No sense of a guided flow | Each rep: group select + usable checkbox + 3 buttons. "New reps go in group" is a separate card with a select | New session is a 4-field modal (date, focus, drill, goal) with focus and drill both defaulting to *None* even when the player has an active priority and drill | "Priority: active" printed as a summary caption |
| **Compare** (`compare.html`) | Step 1 is five filter selects + a hint + *Clear* before any swing is visible. Selected swings are marked with a tiny `[A]`/`[B]` text tag | Mode tabs, phase select, play/step/rate buttons, per-mode presets and a "Mark progress" bar all visible at once | Filters as native selects | "Presets use Swing A. Change the dropdowns…"; alignment and low-confidence caveats each get their own paragraph |
| **Development** (`development.html`) | 11 sections in a scroll. Each priority card has: title + 2 chips, description, evidence list, drill line, **5 workflow boxes**, then 4 buttons. Bottom-nav overlaps in screenshots because the page is ~6 screens long | *Log progress, Assign drill, Follow-up, Status* on every card; AI suggestions use the same card style as coach priorities | Section headings as terracotta ALL-CAPS with a rule | Workflow-state boxes ("Issue identified / Priority created / Drill assigned / Practice before/after") restate the model |
| **Public report** (`report.html`) | Structurally correct after 0.14.0 but styled like the coach app: same app chrome tokens, `.card` with clay rail, "Your coach hasn't confirmed strengths yet." sits under a heading and reads as a deficiency | Full checklist drawer is present but the empty strengths message competes with real content | — | Status words "Needs more work" (`shape.ts` `STATUS_LABELS`) read as judgement to a parent |

### 1.3 Cross-cutting findings

- **Duplicate controls:** *Player development / Compare swings* link rows on At-bat; *All sessions / Player development*
  on Session; *Open development →* on Player hub; the same destinations already exist in the tab strip. Bottom-nav
  *Report* and tab *Report*. *Log AB* in the bottom nav and *Add pitch* in At-bat both add at-bats/pitches with different UIs.
- **Excessive buttons:** median card carries 3–5 buttons; Development priority cards carry 4 buttons + 4 non-interactive
  boxes that look like buttons (the loop chips are styled with the same border/radius as `.dev-btns button`).
- **Repeated destructive actions:** *Delete* on every pitch, every rep, every at-bat card (`btn-danger.subtle` 🗑),
  *Delete Player* and *Create Share Link* as primary-looking buttons in Manage Player. All use native `confirm()`.
- **Typography:** Oswald ALL-CAPS for h1, h2, stat labels, lineup names, clip tabs, comp names, scrubber phase label,
  ai-ribbon, eyebrows (`Checkpoint 03`); Inter for body. Result: ~10 places use caps + letter-spacing, so caps no longer
  signal hierarchy. Sizes are fixed px (11, 12, 13, 14, 15, 16, 17, 20, 22, 26) with no scale.
- **Icons:** emoji as UI: ⚾ 📊 ➕ (nav), ⏳ 📹 🔗 🗑 📐 🤖 ✓ ⚠ 🔴 (buttons and badges). No icon library exists
  (`mobile/package.json` has only Capacitor). Emoji render differently per Android OEM and are not themeable.
- **Spacing:** margins are ad-hoc (`margin: 22px 0 10px`, `margin-bottom: 12px`, `padding: 12px 14px`, `10px`, `14px`
  page gutter, `16px` card padding). Cards are 12–16 dp padded with 10–12 dp gaps, so a "compact" row is still ~90 dp.
- **Colour:** brand clay is used ≥ 12 ways (see 1.1 #8). `--status-warning` amber is used for AI draft, edited,
  unchanged, limited, monitoring, unclear, pending clips and the "Early read" caution simultaneously.
- **Empty states:** `.dev-empty` (dashed box, bold title, one sentence) exists and is used well on the new pages.
  Problems: it is used for both "nothing here yet" and "can't load"; error copy ("Couldn't load this page") has no retry;
  "Not measured" rows in Analysis quality are empty states masquerading as data.
- **Modal/form overload:** about a dozen distinct modal/sheet forms (counted from `openSheet`/`closeableModal` call sites); none use the keyboard-aware pattern, and all put the close
  button at top-right (hardest thumb reach).
- **Unnecessary technical language visible by default:** "AI observations", "Analysis quality", "Contact estimate", "Pose
  tracking: Not measured", "reconstruction", "phase", "Usable", "Grouping". Most belong under Advanced.

### 1.4 States that exist in code but not in the screenshots

Processing (`⏳ Processing video… N:NN elapsed`), failed clip with *Retry* and "Full error details" drawer, pending (queued)
clips, multi-clip tabs per at-bat, low-reliability 3D caveat and per-phase `reconstruction_reliable` flags, Early Read (<3 ABs),
share-link list and create/revoke, Player Context editor, comp modal (View 3D Skeleton) with reference illustrations, Log AB
modal with video attach and camera capture, Add Player modal, team-not-found and player-not-found guards, checklist load
failure (scoring disabled), offline shell (`sw.js`), team-creation access-code form, sign-up email-confirmation message,
`?openLog=1` deep link, `?phase=`/`?clip=` deep links, `?a=&b=&mode=&priority=` compare deep links.

---

## 2. UX principles

1. **Summary first, evidence second, diagnostics third.** Every screen opens with one answer, then the proof, then the
   numbers. Anything that is not the answer is one tap deeper.
2. **One question per screen** (Team: what needs attention? Player: what next? Review: what happened, what matters, what do
   we do? Practice: did it improve? Development: what are we working on, is it improving? Compare: what changed? Public
   report: what is the player working on and how are they progressing?).
3. **One primary action per screen.** At most one filled brand button visible at a time. Everything else is a tertiary text
   button, chip, or overflow item.
4. **The coach is the authority; AI is quiet.** AI provenance is a small label with an icon, never a colour block. Coach
   decisions are the visual foreground. Confidence never outweighs the coach's judgement.
5. **The video is the evidence.** Video is the largest element wherever it appears; 3D and metrics are secondary and
   labelled as estimates.
6. **Colour only for exceptions.** Neutral for normal state; success for improvement/approval; warning for attention;
   danger only inside destructive confirmations and real errors; brand for the primary action and the current location.
7. **Field-first ergonomics.** One-handed, thumb-reachable primary actions, glanceable in sunlight, forgiving of gloves and
   interruptions (drafts persist, undo instead of confirm where possible).
8. **Progressive disclosure, not removal.** Every existing capability (coach approval, advanced scoring, metrics, 3D,
   analysis quality, comps, share links) remains; it moves behind a labelled disclosure.
9. **Never fabricate precision or progress.** No fake percentage bars, no invented ETAs, no causal claims about transfer.
10. **Explain briefly, once.** Replace explanatory paragraphs with a clear label and an info affordance.

---

## 3. Updated information architecture

### 3.1 Sitemap (routes unchanged)

```
Sign in / Create account                         index.html (auth views)
Teams                                            index.html (picker view)      [+ account sheet]
└─ Team                                          team.html
   ├─ Review queue          (NEW, small)         queue view, see §9.5
   ├─ Add player                                 sheet
   └─ Player                                     player.html   ← tab "Overview"
      ├─ Overview                                player.html
      │   ├─ At-bat (drill-in)                   atbat.html?entry=
      │   └─ Swing review (drill-in)             review.html?clip=&phase=
      ├─ Development                             development.html
      ├─ Compare                                 compare.html?a=&b=&mode=&priority=
      └─ Practice                                session.html  (list) → session.html?session= (drill-in)
Public report (no login)                         report.html?token=
```

- **Tab-level pages** (Overview, Development, Compare, Practice list) show the player tab strip.
- **Drill-in pages** (At-bat, Swing review, Session detail) hide the tab strip and show a back-arrow title bar. This
  removes false "Report active" highlighting, recovers ≈ 96 dp, and makes back behaviour predictable.
- **New surface:** *Review queue* (§9.5). It is a filtered list over data that already exists
  (`issues.review_status = 'draft'`, clips `ready`); no schema change.

### 3.2 Object model the UI should teach

`Player → Priority (what we work on) → Drill (how) → Practice (rehearse) → Game (transfer) → Progress (coach's call)`.
Findings are AI drafts that may become priorities; swings are evidence attached to pitches/reps. Screens should never
present a swing without its context (Game AB/Pitch or Practice rep/group) as a single quiet label, e.g. `Sep 19 · AB 1 ·
Pitch 3` / `Sep 16 · Rep 3 · Post-drill`.

### 3.3 The core loop as a visible spine

Expressed once, on Development, as a compact 5-step dotted line inside an expanded priority (not as boxes):
`Found → Tracking → Drill → Practiced → Game check`. State comes from the existing `coachingLoop()` logic; no new data.

---

## 4. Navigation specification

### 4.1 Global bottom navigation

**Current:** `Roster · Report · Log AB` (`appShell.js` `renderBottomNav`). *Report* opens the last-viewed player's hub;
*Log AB* opens the player hub with `?openLog=1`, or a modal if already on `player.html`.

**Problems.** *Report* is the wrong word (§1.1 #10). *Log AB* is context-blind: from Team it silently picks "last player";
it doesn't offer practice or player creation. Tapping *Report* from Team when no player was viewed goes nowhere (`#`).

**Recommendation (final): three destinations, contextual centre action.**

| Slot | Label | Icon | Goes to | Notes |
|---|---|---|---|---|
| 1 | Team | `users` | `team.html` | Roster + "what needs attention" |
| 2 (centre, raised) | + (no label; accessible name "Add") | `plus` | **Action sheet** | See below |
| 3 | Review | `circle-check` | Review queue | Badge with count of swings needing review; hidden badge at 0 |

- **Centre "+" action sheet** (bottom sheet, 4 rows, each 56 dp): **Log at-bat**, **Start practice**, **Upload swing**
  (camera capture straight to an unassigned rep/pitch prompt), **Add player**. Player-scoped rows ask "Who?" only if not
  already inside a player (pre-selected player when on a player page; last-viewed player otherwise, shown as a removable
  chip).
- **Player** is intentionally **not** a global tab: players are reached via Team (roster) or the player switcher in the
  app bar. This avoids a fourth slot and removes the *Report* naming problem.
- **Phase 1 interim (no new screen):** if the Review queue is not ready, slot 3 is **Player** (last viewed, hidden when
  none), label "Player", icon `user-round`. The "+" sheet ships in Phase 1 either way.
- Nav height ≤ 56 dp plus safe-area inset. Labels 12 sp Inter 500, always visible with icons (icons supplement labels).
  Active item: brand-text colour + filled icon; inactive: text-secondary. Remove the 44 px terracotta FAB circle; use a
  48 dp brand-fill rounded square/circle that sits within the bar height (no protrusion).
- Hide the bottom nav on: Swing review (replaced by a sticky decision bar), full-screen pickers, and any sheet state.

### 4.2 Player-level navigation

**Current:** a horizontally scrollable pill strip, 48 dp tall pills, brand-filled active pill, clipped 4th item.

**Recommendation.**

- Replace with a **compact 4-segment tab bar**, equal width, no horizontal scroll: **Overview · Development · Compare ·
  Practice**. At 390 dp width each segment is ≈ 88 dp; "Development" at 14 sp Inter 600 is ≈ 84 dp (fits; if large-font
  scaling breaks it, the strip may drop to 13 sp and icon-above-label only at ≥ 130% font scale, never scroll).
- Visual: text tabs with a 2 dp brand underline on the active tab (no filled pills). Height 40 dp visible, 48 dp hit
  area (4 dp slop above/below). Sticky under the app bar.
- **"Report" → "Overview".** Route audit: `player.html` is the player hub (priorities strip, diagnosis, game log, practice
  log, checklist, manage). It is not a report and not the per-swing review. Rename the **label only** to *Overview*; keep
  `player.html` so links, the service worker precache list, `openLog=1`, share flows and tests stay valid. Do **not** use
  *Review* for this tab; *Review* is reserved for the per-swing screen and the queue.
- Keep *Development*, *Compare*, *Practice* as labels (they match README/CHANGELOG vocabulary and are short enough).
- Deep-link entry: if a user arrives at a drill-in page from a link, back goes to that page's logical parent (Overview or
  Development), not to the previous history entry.

### 4.3 App bar

- Single row, 56 dp: back chevron (48 dp hit) · jersey badge (32 dp) · name (Oswald, 20 sp, ellipsis) with a chevron
  that opens a **player switcher bottom sheet** (replaces the absolute-positioned dropdown menu) · overflow `⋮`.
- Overflow (player): *Share link*, *Player context*, *Manage player* (contains *Delete player* → destructive confirm).
- Team app bar: back chevron · team name · overflow (*Add player*, *Filters*).
- **Remove the "✓ N/M Confirmed" pill** from player pages. It counts checklist confirmation team-wide and is unrelated to the
  primary workflow. On Team it is replaced by the "Today" block (§9).
- **Sign out** moves out of the Teams list into an *Account* bottom sheet opened from an avatar/`⋮` in the Teams app bar
  (name, email, *Sign out*). It stays a text-weight action inside the sheet.

### 4.4 Android back and system behaviour (**UNVERIFIED** on device; derived from config)

- `mobile/package.json` has no `@capacitor/app`, so back uses WebView history. Sheets and menus are DOM overlays with no
  history entry, so **Back leaves the page instead of closing the sheet**.
- Spec: every bottom sheet, action sheet, dialog and full-screen picker pushes a history state (or hash) when it opens
  and closes on `popstate`. Back order: dialog → sheet → expanded disclosure (no) → page → parent. At the Teams root,
  back exits the app (system default).
- `session.html` calls `history.replaceState` when opening a session; keep, but the parent for back is the session list.
- Phase 3 may add `@capacitor/app` for explicit `backButton` handling (requires native sync and rebuild).

---

## 5. Design tokens

Preserve the current direction: dark charcoal, terracotta brand, restrained emerald. Refine for contrast, restraint and
elevation-by-surface. All values are proposals; verify contrast with a tool.

### 5.1 Colour

| Token | Value | Use | Contrast (approx.) |
|---|---|---|---|
| `--bg` | `#121418` | Page background (unchanged) | — |
| `--surface-1` | `#1A1E25` | Cards, list rows, bottom nav | — |
| `--surface-2` | `#232830` | Inputs, chips (rest), pressed rows | — |
| `--surface-3` | `#2C323B` | Sheets, menus, selected segment | — |
| `--border` | `rgba(244,239,234,0.10)` | Hairlines (currently 0.14 on every card) | — |
| `--border-strong` | `rgba(244,239,234,0.20)` | Input outlines, focus-adjacent | — |
| `--text-1` | `#F4EFEA` | Primary text (unchanged sand) | ≈ 15:1 on bg |
| `--text-2` | `#BDB6AB` | Secondary / metadata | ≈ 8.5:1 on surface-1 |
| `--text-3` | `#9A9588` | Captions, placeholders (raised from `#8A8578`, ≈ 4.4:1) | ≈ 5.3:1 on surface-1 |
| `--brand-fill` | `#B4503A` | Primary button background, active indicator fill | white on it ≈ 5.1:1 (current `#C2593F` ≈ 4.4:1) |
| `--brand-fill-pressed` | `#9C4632` | Pressed primary | — |
| `--on-brand` | `#FFFFFF` | Text/icons on brand fill | — |
| `--brand-text` | `#E27B60` | Brand-coloured text/icons on dark (links, active tab) | ≈ 6.3:1 on bg (current clay text ≈ 4.2:1) |
| `--success` | `#34D399` | Improving, approved, ready, good | ≈ 9:1 |
| `--success-subtle` | `rgba(52,211,153,0.14)` | Chip background | — |
| `--warning` | `#F2B84B` | Needs attention: needs review, unchanged, limited, due | ≈ 10:1 |
| `--warning-subtle` | `rgba(242,184,75,0.14)` | Chip background | — |
| `--danger` | `#E0584C` | Errors, worse, destructive text | ≈ 5.0:1 |
| `--danger-fill` | `#C7443A` | Destructive confirm button (white text ≈ 4.9:1) | — |
| `--scrim` | `rgba(0,0,0,0.60)` | Behind sheets/dialogs | — |

Rules:

- **Brand** may be used for: the single primary button on a screen, the active tab/nav indicator, the jersey badge, and
  key inline emphasis (one per screen). **Not** for headings, list bullets, every link, "active" status, card rails, or
  chip fills other than a selected filter.
- **Links** in body copy use `--text-1` with underline, or `--brand-text` without underline when they are obviously
  tappable rows/chips. No terracotta underlined links inside bullet lists.
- **Danger** appears only in destructive confirmation buttons, error messages, and the *Worse* progress state text/icon.
  It is not used for delete icons at rest.
- **AI provenance has no colour**: text-3 + `sparkles` icon.
- Status colours carry meaning only for *exceptions*: normal/neutral states (active priority, ready clip, approved
  finding shown in a list) use text-2 with an icon, not a coloured pill.
- Keep `--status-*` names as aliases during migration so existing CSS keeps working.

### 5.2 Shape, elevation, motion

- Radius: **8** (buttons, inputs, chips small), **12** (cards, video frames), **16** top corners (sheets), **999** (pills/
  segmented thumb). Remove the mixed 4/6/8/10/12 radii.
- Elevation: none by shadow. Use surface steps (`bg → surface-1 → surface-2 → surface-3`) and hairline borders. Cards use
  `surface-1` with **no border** by default; border only for grouping inputs and dashed empty states.
- Remove the 4 dp terracotta left rail from `.card`.
- Motion: 150–200 ms ease-out for sheets/disclosure; no decorative animation; `prefers-reduced-motion` disables slide/
  fade and keeps instant state changes. The processing spinner is allowed (it is state, not decoration).

### 5.3 Spacing and sizing scale

Scale: **4, 8, 12, 16, 24, 32**. Nothing else.

| Token | Value | Use |
|---|---|---|
| `--screen-pad` | 16 | Left/right page padding (currently 14) |
| `--card-pad` | 12 (compact row), 16 (hero/summary) | Card padding |
| `--gap-card` | 8 | Between cards/rows in a list |
| `--gap-section` | 24 | Between sections; section label sits 8 above its content |
| `--gap-inline` | 8 | Between chips/buttons in a row |
| Control visual height | 44 (buttons), 40 (tabs, chips), 48 (primary CTA), 56 (list rows with two lines) | |
| **Touch target** | **48 × 48 dp minimum hit area** for every interactive element (visual size may be smaller with padding/slop) | Android/Material guideline |
| Bottom nav | 56 + safe-area | |
| App bar | 56 | |
| Video frame | full-bleed width (no card padding) | |

Density goal: reduce vertical height per card by ≈ 35–45% (a pitch row goes from ≈ 210 dp to ≈ 72 dp; a rep row ≈ 56 dp;
a roster row ≈ 64 dp).

---

## 6. Typography

**Fonts.** Keep **Oswald** only where it adds sports identity: the BarrelTrace wordmark/lockup, team name and player name
in the app bar/hero, jersey numerals, and the single "Next focus" hero label on Development. Everything else is **Inter**
(already loaded): body, forms, buttons, navigation, coaching guidance, metadata. JetBrains Mono remains only for score
digits in the advanced checklist.

| Style | Font | Size / line | Weight | Case | Use |
|---|---|---|---|---|---|
| Display | Oswald | 28 / 32 | 600 | Sentence/Title | Public-report player name, wordmark lockup |
| Screen title | Inter (Oswald in app bar name) | 20 / 26 | 700 | Sentence | App bar title, sheet titles |
| Card title | Inter | 16 / 22 | 600 | Sentence | Priority name, finding title, list-row title |
| Body | Inter | 15 / 22 | 400 | Sentence | Findings text, coaching guidance |
| Label (controls) | Inter | 15 / 20 | 600 | Sentence | Buttons, tabs, chips |
| Supporting | Inter | 13 / 18 | 400 | Sentence | Metadata, secondary lines (`--text-2`) |
| Caption | Inter | 12 / 16 | 500 | Sentence | Timestamps, confidence, chip text (`--text-3`) |
| Eyebrow (rare) | Inter | 11 / 14 | 600, +0.06em | UPPER | At most one per screen, e.g. "NEXT FOCUS" |

Rules:

- **Minimum text size 12 sp.** Replace current 10–11 px labels (ai-ribbon 10, verified-pill 10, metric-source 10, stat
  label 11).
- Section labels become sentence-case 13 sp / 600 in `--text-2` (not 15 px ALL-CAPS Oswald in brand colour with a 2 px
  rule). Use whitespace (24) instead of rules to separate sections.
- Line length ≤ 65 characters for coaching text; body cards max-width 640 (existing) is fine.
- Use `rem`-based sizes (or `clamp`) so Android system font scale applies uniformly; test at 100/130/200% (§20).
- Numerals in tables and timers: `font-variant-numeric: tabular-nums`.

---

## 7. Iconography

**Current:** emoji as icons (⚾ 📊 ➕ ⏳ 📹 🔗 🗑 📐 🤖 ✓ ⚠ 🔴). No library.

**Recommendation:** **Lucide** (ISC licence, consistent 24 px stroke set), delivered as a **vendored inline SVG sprite**
(`coach/assets/icons.svg`, ~25 symbols, added to the `sw.js` `ASSETS` list and the cache-hash), not as an npm package
(the coach app has no build step). Use `<svg><use href="assets/icons.svg#name"/></svg>` through one `Icon(name, size)`
helper. Stroke 1.75 at 20–24 px, `currentColor`, so icons inherit the state colours.

Rules: icons **supplement** labels; icon-only buttons (close, overflow, back, camera on a row) get `aria-label`s;
no emoji anywhere in UI chrome, status chips or buttons; decorative emoji in user content is left alone.

| Purpose | Lucide name |
|---|---|
| Team / roster | `users` |
| Player | `user-round` |
| Add / new | `plus` |
| Review (queue, finding) | `circle-check` |
| Overview | `layout-list` |
| Development / progress | `trending-up` |
| Compare | `columns-2` |
| Practice / drill | `repeat` (session), `target` (drill) |
| Video / record / attach | `video`, `camera` |
| Play / pause / frame step | `play`, `pause`, `skip-back`, `skip-forward` |
| Follow-up / due | `clock` (due uses `bell-ring`) |
| AI provenance | `sparkles` |
| Approved / edited / rejected | `check`, `pencil`, `x` |
| Warning / info | `triangle-alert`, `info` |
| Advanced / filters | `sliders-horizontal` |
| 3D | `box` |
| More | `ellipsis-vertical` |
| Back / disclosure | `chevron-left`, `chevron-down`, `chevron-right` |
| Share | `link` |
| Delete (menu item only) | `trash-2` |

Brand identity stays in the **jersey badge** and Oswald wordmark; no baseball glyph is needed in navigation.

---

## 8. Reusable components

Each component has one definition; screens compose them. Names are for the spec; implementation may vary.

| Component | Definition |
|---|---|
| **AppBar** | 56 dp, back · identity (jersey+name, opens switcher) · overflow. Title-only variant for drill-in pages. |
| **SegmentedTabs** | Equal-width text tabs, underline indicator, 40 visible/48 hit. Also used for compare modes and progress input. |
| **BottomNav + ActionSheet** | 3 slots as §4.1; centre "+" opens ActionSheet. |
| **Card** | `surface-1`, radius 12, pad 12/16, no border, no rail. |
| **ListRow** | 56–72 dp row: leading (jersey/thumbnail/icon) · title + supporting line · trailing (chip or chevron or `⋮`). Whole row is the tap target. Replaces `.lineup-row`, pitch/rep cards, timeline rows. |
| **StatusChip** | One shape (24 dp tall, radius 999, 12 sp/600, optional 16 px icon). Variants from §18 only. Subtle background + coloured text; neutral variant = text-2. |
| **FilterChip** | 40 dp, toggles a filter; selected = `surface-3` + brand-text (not brand fill). |
| **Button** | Primary (brand-fill, 48 dp, max one per screen), Secondary (`surface-2`, 44), Tertiary (text, brand-text), Destructive (`danger-fill`, confirm dialogs only). Icon-leading optional. |
| **IconButton** | 48 dp hit, 24 px icon. |
| **OverflowMenu** | `⋮` anchored menu (bottom sheet on narrow screens) with icon+label rows; destructive item last, separated, in `--danger` text; opens ConfirmDialog. |
| **BottomSheet** | §17. Drag handle, title, optional sticky footer action, scrim, back-button closes. |
| **ConfirmDialog** | Centred small dialog (≤ 320 dp): title, one line of consequence, **Cancel** (secondary) + **Delete/Confirm** (destructive or primary). Replaces native `confirm()`/`alert()`. |
| **Snackbar** | Bottom toast above nav with optional **Undo** (5 s); replaces most success/error `toast`/`alert` calls. |
| **Disclosure** | One accordion pattern (label, optional summary chip, chevron). Replaces `details.drawer`, "Advanced" areas and inline "How to run it". |
| **EmptyState** | Icon (optional) + title (≤ 6 words) + one line (≤ 14 words) + optional single action. §19. |
| **ProcessingState** | Inline row: state label, real elapsed timer or indeterminate bar, optional Retry. §19. |
| **FindingCard** | §11. |
| **PriorityCard** | §14. |
| **RepRow / PitchRow** | Compact ListRow specialisations with a leading status dot, trailing camera/`⋮`. |
| **MediaPair** | Two synchronized video frames with A/B labels and shared transport (compare). |
| **Timeline** | Vertical list of dated events, grouped by week, first 5 visible + "Show earlier". |
| **StickyActionBar** | Bottom bar (above safe area) with one primary action + optional secondary; hides nav. |

---

## 9. Team screen specification

**Primary question:** *What needs my attention?*

**CURRENT PROBLEM.** Six same-weight cards (Needs review, Follow-ups due, Active priorities, Recent progress, Recent
practice, Recent game swings) precede the roster; "Nothing is due." consumes a card; the legacy heat-map legend and
filter chips (incl. 🔴 Priority Flaws, ⚠ Early Read) compete; Sign out and confirmed-pill are prominent.

**NEW HIERARCHY** (top → bottom, 390 dp):

1. **App bar:** back · team name · `⋮` (Add player, Filters).
2. **Today** summary card (16 pad): one line "**3 swings to review · 1 follow-up due**" (numbers in `--text-1`, labels
   `--text-2`; zero counts omitted). If both are zero: "You're all caught up." + `check` icon.
3. **Primary CTA:** **Review pending swings** (brand-fill, 48 dp, full-width inside the card) → Review queue. Hidden when
   there is nothing to review.
4. **Follow-ups due** (only if > 0): up to 3 ListRows `Ada T. · Front-side stability · Due next practice` with chevron; "See all" if more.
5. **Roster** (the main content; always visible without scrolling past the fold on ≥ 4 players): section label
   "Players (12)"; ListRow per player: jersey badge · name (Oswald 17) · one status line
   (`2 to review · Front-side stability · Improving`, or `No active priority` in text-3) · chevron. Sort: needs-review
   first, then follow-up due, then name.
6. **Recent activity** (secondary, collapsed Disclosure): compact combined list (last 5 events across practice/game/
   progress) instead of three separate cards.
7. **Team insights** (Disclosure, collapsed): existing "Team focus areas (avg < 2.0)" moves here (currently a red
   `focus-banner`); checklist heat-map legend appears here only when the heat-map view is enabled.

**PRIMARY CTA:** Review pending swings.

**SECONDARY ACTIONS:** Row tap opens player; "+" action sheet (Add player); Filters (`sliders-horizontal` in overflow →
sheet with *All / Needs review / Follow-up due / Early read*). Filter chips are removed from the always-visible area.

**ADVANCED CONTENT:** Checklist heat-map per roster row (opt-in via Filters → "Show checklist heat-map"), team focus
areas, "Priority flaws" and "Early read" filters.

**COMPONENT CHANGES:** Replace `teamDashboard.js` six `dev-card` blocks with `TodaySummary` + `ListRow`s; replace
`.lineup-row` with `ListRow`; remove `.legend-row` from default; move `renderFocusBanner` output into a Disclosure; remove
the confirmed pill; Sign out into Account sheet.

### 9.5 Review queue (new, small)

- Question: *What is next to review?* List of ready swings with at least one draft finding, grouped by player then date,
  each ListRow: thumbnail placeholder · `Ada T. · Sep 19 · AB 1 · Pitch 3` · `2 findings` chip. Tap opens `review.html`
  with `?queue=1`; after a decision the review screen offers **Next swing**. Empty state: "Nothing to review — new swings
  appear here after they're analyzed." Data: existing `issues` + `video_clips` queries; no schema change.

**Teams home** (`index.html` picker view): keep as a list of ListRows (team name in Oswald, one-line summary
"3 to review · 5 active priorities"); *Create team* becomes a secondary text button at the bottom; account/Sign out in the
Account sheet.

---

## 10. Player overview specification

**Primary question:** *What should we work on next?*

**CURRENT PROBLEM.** Leads with three stat tiles (Logged ABs, Team avg —, Status "EARLY READ (1/3)" in success green), then
a "Working on" list, then a collapsed checklist, then four diagnosis drawers, then Game Log and Practice Log cards with
embedded scrubbers and 3D. There is no single next action; the page is ~1,300 lines and several screens tall.

**NEW HIERARCHY:**

1. App bar (§4.3) + SegmentedTabs (Overview active).
2. **Next action card** (hero, 16 pad, the only brand-fill button on the page). Exactly one message, chosen by this
   precedence (reuses `nextFocus`/`isFollowUpDue`, no new data):
   1. Draft findings exist → "**2 findings to review**" → *Review swing* (opens the newest ready swing with drafts).
   2. Follow-up due → "**Check Front-side stability**" (reason: "Follow-up due") → *Compare recent swings* or *Update progress*.
   3. Active priority without a drill → "**Pick a drill for Front-side stability**" → *Choose drill*.
   4. Priority + drill and no practice since drill assigned → "**Practice Front-side stability**" → *Start practice* (prefilled sheet, §12).
   5. Otherwise → "**Log the next at-bat**" → *Log at-bat*.
3. **Working on** (Card): top priority title (card title), one-line goal (supporting), `StatusChip` progress
   (Improving/Unchanged/Worse/None yet), "+1 more" text button when several. Tap → Development. Caption when < 3 game
   at-bats (product principle 4): "Early read · based on 1 game at-bat so far" (text-3, no green).
4. **Assigned drill** (Card, only if a drill exists): drill name, purpose (1 line), `Disclosure` "How to run it".
5. **Recent** (two ListRows): last game (`Sep 19 vs Rivals · AB 1 · walk · 1 swing analyzed`) and last practice (`Sep 16 ·
   3 reps · Baseline → Post-drill`) each with chevron to At-bat / Session. "See all games / practices" → the lists below.
6. **More** (Disclosures, collapsed): *Game log*, *Practice log*, *Diagnosis, comps & plan* (existing drawers, retitled
   "Notes from earlier analysis"), *Detailed checklist scoring* (with "N AI drafts unconfirmed" summary chip),
   *Player context*. Game/Practice log rows are compact ListRows linking to At-bat / Session; **no inline scrubber, 3D or
   comp modal**.
7. Manage player and Share link move to the app-bar overflow.

**PRIMARY CTA:** The Next action card's single button.

**SECONDARY ACTIONS:** "+" action sheet (Log at-bat / Start practice); tabs; Working-on tap.

**ADVANCED CONTENT:** Checklist scoring, diagnosis/comps/plan, player context, share links, delete.

**COMPONENT CHANGES:** Remove `.stats-row`/`.stat-tile` from the top (Logged ABs may live inside the Game log summary
line); remove inline scrubber/comp/3D from `loadClipsForEntry` rendering on Overview (review page owns them); replace
`.card`/drawers with Card/Disclosure; replace `#priorityStrip` with the Working-on card; rename tab label; hide per-card 🗑.

---

## 11. Swing review specification (flagship)

**Primary question:** *What happened, what matters, and what should we do?*

**CURRENT PROBLEM.** Chrome ≈ 170 dp then a context card, so the video starts low. Findings show five equal actions.
"What to work on / What to look for next time / Track progress" each have a section heading and a full-width card even when
they hold one line. *Track progress* repeats five progress buttons per priority. Advanced content is four separate
drawers. The phase chips are a wrapping button row.

**NEW HIERARCHY** (video stays dominant; on a 390×844 viewport the entire video and the first finding title should be
visible without scrolling):

1. **Title bar (48 dp, drill-in):** back · `Ada T. · Sep 19 · AB 1 · Pitch 3` (one line, ellipsis) · `⋮` (Open at-bat, Compare,
   Share). A small context chip **Game** or **Practice · Post-drill** beneath at 12 sp if space permits.
2. **Video:** full-bleed, source aspect ratio, max height ≈ 55% of viewport; native-feeling controls: play/pause, ±1 frame,
   speed (0.25/0.5/1 as a single cycling chip). A **phase scrubber** under the video: one track with tick marks for
   Stance · Load · Stride · Contact · Extension · Finish; tapping a tick or a phase name jumps and labels the current
   phase. Low-confidence phases use a hollow tick and the caption "estimated". Deep link `?phase=` seeks and highlights
   the tick (existing behaviour).
3. **Review summary line:** `2 findings · Draft from analysis · Not reviewed` (caption/supporting; **Draft** uses the
   quiet AI label from §12; after decisions: `2 findings · 1 approved`). No card around it.
4. **Finding cards** (vertical list; first card expanded, others collapsed to one line: title + state chip):
   - Header: **title** (card title) · state chip (right).
   - Expanded body, in order, no sub-headings shown as caps:
     1. **What I see** — one to two sentences of evidence, with a **▶ Stride 0:04** inline evidence link (jumps the video;
        this replaces the *View evidence* button).
     2. **Why it may matter** — one supporting-weight sentence.
     3. **What to work on** — the coaching cue, `Body` weight, highlighted by weight not colour.
     4. Caption row: `High confidence` (text-3; low confidence shows `Low confidence · check the video` with `info`).
   - **Coach decision row (one primary, two quiet):** **Approve** (brand-fill, 44 dp, left) · **Edit** (tertiary text) ·
     `⋮` overflow (*Reject*, *Reject with reason* not required). Reject is reversible via Snackbar **Undo**; no
     `confirm()`.
   - **After approval** the decision row is replaced by the next-step row: **Track as priority** (primary) ·
     **Assign drill** (secondary) · "Not now" (tertiary). If the finding is already a priority: a neutral row
     "Tracking as *Front-side stability*" with *Update progress*. Priority tracking is never shown as an action on an
     unapproved draft (the current API auto-approves on promote; the UI should make approval an explicit step first, one
     tap, then offer tracking).
5. **What to look for next time:** a single Card shown only if non-empty; before approval it's text-3 with the AI label;
   after approval it is the coach's editable text.
6. **Progress check** (only when this swing relates to an active priority): one row "Is *Front-side stability* improving
   in this swing?" with a 3-option segmented control **Improving · Same · Worse** and a `⋮` for *Resolved / Unclear*.
   Selecting opens a note bottom sheet (optional note, evidence auto-linked to this swing/phase). If several priorities
   exist, a single priority picker chip precedes it; never one block per priority.
7. **Advanced analysis** (one Disclosure at the bottom, collapsed): summary chip shows overall analysis quality
   (`Quality: Limited`). Inside: *Analysis quality* (the 6-row Good/Limited/Poor grid, "Not measured" rows hidden),
   *Metrics*, *3D reconstruction*, *Advanced checklist scoring*. Each is a second-level Disclosure loaded lazily
   (existing behaviour).

**PRIMARY CTA:** **Approve** on the expanded finding; after approval, **Track as priority**.

**SECONDARY ACTIONS:** Edit, Reject (overflow), Assign drill, Update progress, inline evidence jump, Next swing
(queue mode), Open at-bat, Compare.

**ADVANCED CONTENT:** Analysis quality, Metrics, 3D reconstruction, Advanced checklist scoring, phase confidence details.

**COMPONENT CHANGES:** New `FindingCard` (replaces `renderObservations` markup), `StatusChip` for review states, inline
evidence chip, `SegmentedTabs`-style progress control, one `Disclosure` for all advanced content, sticky decision affordance
only inside the expanded card (no global bottom nav on this page), landscape full-screen video mode (§20).

### 11.1 Landscape

Rotating the device with the video focused switches to **video-only full screen** with overlay controls (phase ticks along
the bottom, ±frame, speed) and an "X" to return. Findings are not shown in landscape. (**UNVERIFIED** current behaviour:
`AndroidManifest.xml` does not lock orientation, `manifest.json` requests portrait for the PWA.)

---

## 12. Finding states (reusable)

One component, four states; provenance is quiet and never uses emoji.

| State | Data (`issues.review_status`) | Chip | Visual treatment |
|---|---|---|---|
| **Draft** | `draft` | `sparkles` + "Needs review" (warning text, subtle bg) on the card; provenance line "Drafted from this swing" (caption, text-3) | Title `Card title`; no accent border |
| **Approved** | `approved` | `check` + "Approved" (success text, subtle bg) | Body normal; small `by Coach Jon` caption |
| **Edited** | `edited` | `pencil` + "Edited" (neutral text-2 chip) | Shows the coach's wording; a Disclosure "See original draft" keeps the AI text |
| **Rejected** | `rejected` | `x` + "Rejected" (neutral, muted) | Collapsed, title in text-3, **Undo** action; hidden from default lists behind "Show rejected (1)" |

- "Needs review" is the **user-facing name** for `draft` (the data value cannot be renamed). "AI draft" as a label appears
  only in the provenance caption and in Advanced.
- **Confidence** is a caption in text-3 (`High/Medium/Low confidence`), never a coloured pill, never larger than the
  status chip. Low confidence adds an `info` icon and "check the video" hint; it does not change the card colour.
- The whole finding list obeys the rule: at most one Approve button visible at a time (the expanded card).
- On the Overview/Team surfaces, drafts are always described as "**findings to review**", not "AI observations".

---

## 13. Practice specification

**Primary question:** *Did the movement improve?*

**CURRENT PROBLEM.** `session.html` is a CRUD detail page: session card with an *Edit* button and two underlined links,
Summary, "Did the movement change…" card with a compare button, Reps as cards with group select + usable checkbox +
attach + delete each, a separate add-rep card with a group select, then Coach assessment with five buttons and a textarea.
Nothing indicates order or progress; destructive delete sits on every rep.

**NEW HIERARCHY** (a guided session; drill-in page with title bar "Practice · Sep 16"):

1. **Session brief** (Card): `Focus` (priority name) · `Drill` (name) · `Goal` (text). Each is a ListRow-style line with a
   trailing chevron that opens a small sheet (§17 "Session focus"). Optional third line collapsed if goal empty
   ("Add a goal").
2. **Progression** (the spine): three steps in a horizontal `Stepper` — **Baseline → Drill → Post-drill** — each showing a
   rep count (`2`, `6`, `1`) and a state (not started / in progress / done). The current step is highlighted (brand
   underline); tapping a step scrolls to its reps. "Free swing / Other" reps live under a quiet "Other reps" Disclosure.
3. **Reps by step** (compact `RepRow`, 56 dp): thumbnail/leading status dot · `Rep 3` · state (`Analyzed`,
   `Processing`, `Failed — Retry`, `No video`) · trailing `camera` (if no video) and `⋮`. `⋮` contains *Review swing*,
   *Move to Baseline/Drill/Post-drill*, *Mark unusable*, *Delete rep*. Unusable reps dim and drop to the bottom of their
   step; "12 usable / 6 rejected" appears as a caption, not a card.
4. **Record** (StickyActionBar): **Record rep** (brand-fill, opens camera) with the current step shown as the chip
   "→ Baseline". The group is set from the current step; the "New reps go in group" select is removed. Multi-file upload
   remains under `⋮` "Add from library".
5. **Compare** (Card, enabled when Baseline ≥ 1 and Post-drill ≥ 1): "Compare baseline → post-drill" with two small
   thumbnails and one button **Compare** (primary once the coach has captured post-drill reps). Until then a quiet
   EmptyState line "No post-drill swings yet." (no dashed box).
6. **Coach assessment** — only after a compare or when the coach taps "Finish": 4-option segmented
   **Improved · Unchanged · Mixed · Unclear** + optional note field + **Finish session** (primary). Data mapping in §18
   (`yes`→Improved, `no`→Unchanged, `mixed`, `unclear`; practice outcome has no "worse", so "Unchanged" means "did not
   improve"). Finish saves the assessment and offers one follow-on: "Update progress on *Front-side stability*?" (opens the
   existing observation sheet prefilled with the last post-drill rep as evidence). The coach chooses; nothing is auto-set.

**PRIMARY CTA:** *Record rep* while capturing; *Compare* once post-drill exists; *Finish session* at the end.
(Only one is brand-filled at a time.)

**SECONDARY ACTIONS:** Edit focus/drill/goal; move/mark/delete rep (overflow); add from library; open Development.

**ADVANCED CONTENT:** "Other reps" (free swing/other); rep notes; per-rep analysis quality.

**COMPONENT CHANGES:** New `Stepper`, `RepRow`, `StickyActionBar`, `OverflowMenu`, `ConfirmDialog`; remove per-rep
selects/checkboxes/buttons, the summary and "did the movement change" cards (replaced by the Progression + Compare
cards), and the add-rep card.

### 13.1 Practice list

Question: "Which session do I open?" ListRows: date · reps · focus · outcome chip; primary CTA **Start practice** (top
right / sticky) opens the §12-sheet below. Empty: "No practice yet" + **Start practice**.

---

## 14. New practice session (bottom sheet)

**Goal:** starting a session takes **one tap when a priority and drill already exist**.

- Sheet title "Start practice". Content (top → bottom):
  1. **Focus** row: pre-filled with the player's *next focus* priority (`nextFocus`), shown as `Front-side stability ›`;
     tap opens a picker of active priorities plus "No specific focus".
  2. **Drill** row: pre-filled with that priority's active assigned drill (`Split-stance tee drill ›`); tap changes;
     "None" allowed. If the priority has no drill: the row reads "Choose a drill" and links to Assign drill.
  3. **Goal** row collapsed as "+ Add a goal" (expands one text field).
  4. **Date** row hidden; a small text button "Today · Change" reveals the date field.
- Sticky footer: **Start session** (primary, 48 dp).
- **Same-day handling.** The schema enforces one `practice_sessions` row per player per date. If today already has a
  session, the sheet shows "You already have a session today" with **Continue today's session** (primary) and "Change date"
  (tertiary); it never errors. (A second same-day session would need a schema decision and is out of scope.)
- No focus/drill defaults to `None` when the player has active priorities.

---

## 15. Compare specification

**Primary question:** *What changed?*

**CURRENT PROBLEM.** The page opens with a "1. Pick two swings" card of five native selects plus a hint and *Clear*; two
swings are only distinguished by `[A]`/`[B]` text. Video, frame, metrics and trend modes are tabs of equal weight; the
alignment/play/step/speed controls and prose warnings appear together. Trend is second-to-last.

**NEW HIERARCHY:**

1. **Title bar:** "Compare" with back (tab-level page; player tab strip stays).
2. **Suggested comparisons** (chips or 56 dp ListRows, only those that are possible; the first is preselected when
   arriving without `a`/`b`):
   - *Baseline → Post-drill (Sep 16)* — from the most recent practice session having both groups.
   - *Latest practice vs latest game*.
   - *Previous game vs this game*.
   - *Before vs after Front-side stability* — the first and latest evidence swings for the selected priority.
   Selecting a suggestion loads the pair immediately; "Choose swings manually" opens the full-screen picker.
3. **Selection summary:** two labelled tiles at the top: **A** `Sep 16 · Rep 1 · Baseline` and **B** `Sep 16 · Rep 3 ·
   Post-drill`; tap a tile to replace it; a swap icon between them. When nothing is selected: EmptyState "Pick two swings
   to see what changed." with the suggestion chips as the action.
4. **Mode segments (order matters):** **Video · Frames · Trend · Metrics · 3D**, equal width, text only (≈ 78 dp each).
   Default is **Video**. **Trend** precedes **Metrics** because whether the coach's priority is improving matters more than
   measurement novelty.
5. **Video mode (dominant):** A and B side by side (each ≈ 187 dp wide, source aspect ratio), one shared transport
   under them: play/pause, ±frame, speed chips (0.25/0.5/1). **Aligned on: Contact ▾** is one chip (opens a sheet of the six
   phases). Warnings collapse to one line with `info`: "Contact is estimated on B" (tap for detail); alignment failure
   reads "Can't align on Load — playing from start."
6. **Frames mode:** Frame A / Frame B tiles with **presets** as chips (*Load → Contact*, *Plant → Contact*, *Contact →
   Finish*) plus a swing selector per frame ("Swing A/B"); two video stills; notes field.
7. **Trend mode:** the selected priority's coach-confirmed observations as a compact `Timeline`, plus robust metric
   sparklines (only metrics that pass the existing quality rules). Coach-confirmed only; no AI claims.
8. **Metrics mode:** only robust, labelled metrics (`Direct video measurement` vs `3D reconstructed estimate`); reconstructed
   values hidden when reconstruction is Poor (existing rule). Two columns A/B with a delta only when both exist.
9. **3D mode:** 3D A | 3D B with a single shared viewpoint row (Source/Front/Side/Rear/Pitcher/Batter), trails toggles
   collapsed under one "Trails" chip, the standing caveat "3D is an estimate from one camera" shown once.
10. **StickyActionBar:** **Mark progress from this comparison** (primary) → the existing observation sheet, prefilled with
    B as evidence and the current phase.

**PRIMARY CTA:** Mark progress from this comparison (after a comparison is visible); before that, the first suggested pair.

**SECONDARY ACTIONS:** Swap A/B; change alignment phase; open review for A or B; choose swings manually.

**ADVANCED CONTENT:** Manual picker with filters (Source, Swing/take, Priority, Practice group, Reviewed) collapsed under
one **Filter · 2** button; frame-level controls; 3D trails and axes; per-mode metric notes.

**COMPONENT CHANGES:** New suggestion chips + selection tiles + full-screen picker (list of `ListRow`s with A/B selection
state); `MediaPair`; `SegmentedTabs` for modes; single `StickyActionBar`; remove the always-visible filter card and the
step headings "1./2."; fold the presets and warnings into chips and one status line. Deep links `?a=&b=&mode=&priority=&phase=`
unchanged.

---

## 16. Development specification (second flagship)

**Primary question:** *What are we working on, and is it improving?* — this screen is the player's coaching plan.

**CURRENT PROBLEM.** Eleven stacked sections; each priority card has title + 2 chips + description + evidence + drill line +
five non-interactive workflow boxes styled like buttons + four buttons; AI suggestions share the same card style as
coach priorities and sit mid-page; "Recent swings", "Assigned drills", "Latest coach note" and "Recent comparison" repeat
information the priorities already carry.

**NEW HIERARCHY:**

1. **Next focus** (hero card, 16 pad): eyebrow "NEXT FOCUS" (the one allowed eyebrow); **priority name** (card title,
   Oswald 20 optional); **coaching goal** (body, from the priority description/cue); reason chip
   ("Follow-up due" / "No coach observation yet" / "Not improving yet", from `nextFocus`); primary **Start practice**
   (opens the prefilled §14 sheet); tertiary **Update progress** (opens the observation sheet).
2. **Active priorities** (`PriorityCard` list; each ≈ 120 dp collapsed):
   - Row 1: name (card title) · progress `StatusChip` (Improving / Unchanged / Worse / — none yet).
   - Row 2: goal (supporting, 1 line, ellipsis).
   - Row 3: drill (`target` icon + name) · evidence count as a text button `3 swings ›` (opens evidence list sheet with
     deep links to review/compare).
   - Row 4: **game-transfer chip** (§17) · **next check** (`clock` + "Next practice" / "Due Sep 23" / "Due now").
   - Trailing `⋮`: *Assign / change drill*, *Set follow-up*, *Change status* (Monitor, Resolve, Archive), *Edit*. There
     are no buttons on the card face; tapping the card expands it in place to show the compact dotted loop
     (`Found → Tracking → Drill → Practiced → Game check`), the last three evidence items, and *Update progress*.
3. **Needs review** (separate section, visually quieter than priorities; shown only when drafts exist):
   header "Findings to review" (supporting weight); each item a ListRow `Front side opens early · from Sep 19 · AB 1 ·
   Pitch 3` with a neutral `sparkles` provenance icon and chevron. Actions: primary in-row **Review swing**; overflow
   **Track as priority** (visible only after the finding is Approved; otherwise disabled with hint "Review it first")
   and **Dismiss**. Never render these with the priority card style or colour.
4. **Timeline** (`Timeline`, grouped by week, first 5, "Show earlier"): game, practice, priority created/drill assigned,
   coach notes, status changes, comparisons — one line each with a small icon. No separate "Latest coach note" section
   (notes appear in the timeline and on the priority).
5. **Insights** (Disclosure, collapsed): game-vs-practice mix (30 days) and **Metric trends** (existing lazy loader).
   Copy is unchanged; it moves here.

**PRIMARY CTA:** Start practice (hero).

**SECONDARY ACTIONS:** Update progress; add priority (`+` in app bar overflow or a tertiary "Add priority" at list end);
per-priority `⋮`.

**ADVANCED CONTENT:** Expanded loop line, evidence list, follow-up settings, status changes, insights, metric trends.

**COMPONENT CHANGES:** New `PriorityCard`; remove the five workflow boxes and per-card button rows; retire the separate
sections *Recent swings*, *Assigned drills*, *Latest coach note*, *Recent comparison*; add `Timeline` grouping; AI
suggestion list uses `ListRow`.

### 16.1 Game transfer (elevated)

Shown on every PriorityCard as a chip and, expanded, as a two-line explainer. It must never claim causation.

| Chip | When (derived from existing rows) | Copy |
|---|---|---|
| **Waiting for next game** | A coach-confirmed practice observation exists and no later game swing exists | "Practiced Sep 16 · waiting for the next game" |
| **Not observed yet** | A later game swing exists but has no coach observation for this priority | "Game Sep 19 · not reviewed for this yet" (**Review swing** link) |
| **Seen in next game** | A later game swing exists and has been opened/reviewed, coach hasn't recorded a status | "Game Sep 19 · reviewed, no progress noted" |
| **Coach confirmed** | A later game observation exists | Uses the coach's status: "Game Sep 19 · you marked *Improving*" |

- Mapping to current logic: `awaiting_game` → *Waiting for next game*; the six confirmed values of `TRANSFER_LABELS`
  (`carried_over`, `improved_in_game`, `partly_carried_over`, `no_change`, `not_carried_over`, `unclear`) collapse into
  *Coach confirmed* with the coach's own status text. *Not observed yet* and *Seen in next game* require a small query for
  later game swings per priority (no schema change) — flagged as the only data-adjacent piece.
- Copy rule: describe **what the coach recorded**, not why ("You marked Improving in the game on Sep 19"), never "transferred
  because of the drill".

---

## 17. Pitch-entry specification

**Primary question:** *What happened on this pitch?* (a two-tap task at the field.)

**CURRENT PROBLEM.** Each pitch is a ~210 dp card with title/count, outcome line, notes, video status and three buttons
(*Attach video, Edit, Delete*). Editing opens a modal with five native selects, two free-text inputs and a notes area,
including free-text location even though the schema and a 9-zone picker already exist. The legacy **Log AB** modal on the
player hub also asks for pitch text, zone, outcome and result at at-bat level, duplicating the pitch model.

**NEW HIERARCHY** (At-bat drill-in page; title bar "At-bat 1 · vs Rivals"):

1. **Header line:** `Sep 19 · Rivals · 4 pitches · 1 swing` (supporting) and a result field ("Walk") editable via row tap
   (Result is optional and can be set at the end).
2. **Pitch list** (`PitchRow`, ≈ 72 dp): `1` badge · outcome + `take/swing` (e.g. *Called strike · Take*) · live count
   `0-0` (caption; "(from earlier pitches)" text removed, an `info` tooltip explains inference) · trailing `camera`
   (attach/replace; shows a status dot when video exists) and `⋮` (Edit details, Add another video, Delete pitch). Row
   tap opens the quick-entry sheet.
3. **Quick entry** (StickyActionBar "**Next pitch**", opens a bottom sheet pre-numbered):
   - **Outcome** (required): a 2×3 grid of 56 dp buttons — **Ball, Called strike, Swinging strike, Foul, In play, Hit by
     pitch** — plus "Other…" under it. One tap selects.
   - **Swing / Take** (required): a 2-option segmented control **auto-set from the outcome** (`swungFromOutcome`) and
     editable; it only asks for input when the outcome doesn't determine it (Other).
   - **Count** is derived and displayed ("Count 1-1") from prior pitches; an inline "Fix count" text button reveals the
     balls/strikes override.
   - **Save & next** (primary) records the pitch and reopens the sheet for the next pitch number; **Done** (secondary)
     closes. Target: **≤ 2 taps per pitch** (outcome, then Save & next).
4. **Optional details** (one Disclosure inside the sheet, collapsed): **Pitch type** (free text, as stored), **Location**
   (see below), **Notes**.
5. **Location picker:** the schema supports `pitch_zone` (1–9) and `pitch_location` text; a **3×3 zone picker** already
   exists (`pitchZonePicker.js`) and is used in the legacy Log AB modal. Reuse it inside "Optional details" and write
   `pitch_zone`. Keep the free-text field only as "Describe location (optional)". No new visualization is required.
6. **Video:** camera icon per row starts capture/attach for that pitch; row shows the processing state chip (§19).
   "Unassigned video" card becomes a `ListRow` "1 clip isn't attached to a pitch — Assign".

**Log at-bat** (from "+" or Overview): bottom sheet: **Opponent** (remembered from last at-bat), **Date** (today),
**AB #** (auto next; hidden under "Change"), **Result** (skipped; set later). Primary **Start at-bat** → creates the entry
and drops into quick entry for pitch 1. Legacy at-bat-level pitch/zone/outcome fields are removed from this sheet (the
columns remain for old data and old-flow compatibility).

**PRIMARY CTA:** Next pitch / Save & next.

**SECONDARY ACTIONS:** Attach video (row icon); Review swing (row tap on analyzed pitch); Edit/Delete via `⋮`.

**ADVANCED CONTENT:** Pitch type, location/zone, notes, count override, at-bat facts summary (Disclosure "At-bat
summary").

**COMPONENT CHANGES:** New `PitchRow`, outcome grid, `BottomSheet`, `OverflowMenu`; remove `Delete` and `Edit` buttons
from rows; replace balls/strikes selects with derived count + override; reuse `pitchZonePicker`.

---

## 18. Public report specification

**Primary question:** *What is the player working on and how are they progressing?* Audience: player and parent, on a
phone, no account. This is a keepsake/communication surface, not a read-only coach screen.

**CURRENT PROBLEM.** Uses the coach chrome and card language (clay left rail, ALL-CAPS Oswald headings); the empty
strengths line ("Your coach hasn't confirmed strengths yet.") reads as a deficit; status words ("Needs more work") read as
judgement; full checklist drawer and player card share equal weight with the plan.

**NEW HIERARCHY** (no app bar, no bottom nav; brand top strip only):

1. **Brand strip (32 dp):** BarrelTrace wordmark (Oswald, small) left; right side empty. Not a nav bar.
2. **Player header:** jersey badge (large), **player name** (Display, Oswald 28), team (supporting).
3. **Current focus** (hero Card): eyebrow "CURRENT FOCUS"; **priority name** (card title, 20); why in plain language (body,
   1–2 lines); progress chip (**Improving / Holding steady / Still developing / Got it**). If several priorities, the top
   one here and the rest under "Also working on" (compact rows).
4. **Next step — your drill** (Card): drill name, purpose, `Disclosure` "How to do it" (instructions, equipment, coach
   note). If no drill: "Your coach will add a drill here."
5. **Progress** (`Timeline`): dated dots: `Aug 12 · Working on it`, `Sep 2 · Improving — "Much more stable at plant."`
   Coach-confirmed observations only.
6. **What's going well:** confirmed strengths as short rows with `check`. **Empty copy:** "Strengths will appear here as
   your coach reviews more swings." No warning tone, no empty box.
7. **Next check:** one line from the follow-up ("Coach will re-check next practice") when set; hidden otherwise.
8. **Watch swing** (only for clips a coach linked as evidence): up to 3 rows `Sep 19 · Contact` with `play`; tapping
   opens the video inline (existing endpoint; access is limited to evidence-linked clips).
9. **Advanced details** (Disclosure, collapsed): full checklist (`Reviewed by …` captions). Footer: "Shared by your coach
   with BarrelTrace · Read-only".

**PRIMARY CTA:** None (read-only). The focus card and drill are the primary content; **Watch swing** is the only
interactive affordance.

**SECONDARY ACTIONS:** Expand drill, play swing, expand advanced.

**ADVANCED CONTENT:** Full checklist; older progress entries ("Show earlier").

**COMPONENT CHANGES:** Public-only styling tokens (same colour tokens; larger type scale; no bottom padding for nav);
`Timeline`, `Disclosure`, `EmptyState`. Copy: consider changing `shape.ts` `STATUS_LABELS.worse` from "Needs more work"
to "Still developing" (a one-line copy change in the edge function; no logic change). Optional Phase 3: honour
`prefers-color-scheme: light` for the public report only (parents/print).

---

## 19. Form and sheet standards

**Pattern choice:**

| Task | Pattern |
|---|---|
| Edit pitch / Quick entry | Bottom sheet (tall, ≤ 90% height) |
| Assign drill | Bottom sheet with searchable list of ListRows (radio); "Drill details" as second-level disclosure |
| Update progress | Bottom sheet: 3-option segmented + "More" + note |
| Follow-up | Bottom sheet: 4 radio ListRows (*Next practice, Next game, After N swings, On a date*) + parameter field |
| Session focus / New session | Bottom sheet, prefilled (§14) |
| Promote to priority | Bottom sheet: title (prefilled), category (chips), goal (prefilled from cue); primary **Start tracking** |
| Player switcher | Bottom sheet list |
| Add player | Bottom sheet (name, jersey; slug auto) |
| Swing picker (compare) | **Full-screen** (long list + filters) |
| Swing review, 3D, compare | Full pages (not sheets) |
| Delete / remove data | **ConfirmDialog** (centred, small) |
| Reject finding, mark unusable, remove a drill | No dialog: action + **Undo** Snackbar |

**Bottom sheet rules.** Rounded top (16), 4×32 drag handle, title left (screen title style), close `x` on the right *and*
swipe-down *and* system Back. Content scrolls under a **sticky footer** holding the single primary action (48 dp) so it is
always in thumb reach; on keyboard open, the sheet resizes to `visualViewport` height and the footer stays above the
keyboard. Inputs use the platform keyboard type (`inputmode`, `enterkeyhint`), 16 sp minimum (prevents zoom), 48 dp height,
label above field in supporting weight (sentence case, not ALL CAPS). Long native `<select>`s (≥ 4 options) become tappable
rows that open a picker sheet; 2–3 options are segmented controls. Required fields marked in the label; validation
messages inline, plain language ("Choose an outcome").

**Confirm dialogs** state the consequence in one sentence ("Delete pitch 3? The video stays on the at-bat."), destructive
button labelled with the verb ("Delete pitch"), Cancel on the left, focus on Cancel. No `confirm()`/`alert()`.

**Do not convert:** the sign-in/create-account forms (full page, unchanged structure), the team-creation access-code form
(full page), the 3D viewer overlays and the comp modal (content viewer, keep full-screen).

---

## 20. Destructive actions

- Remove *Delete* from pitch cards, rep cards, at-bat cards and any visible row; place under `⋮` with a `trash-2` menu item
  at the bottom in `--danger` text.
- Every deletion of stored data (pitch, rep, at-bat, session, share link revoke, player) uses ConfirmDialog with
  `--danger-fill`. Reversible list-state changes (reject finding, mark rep unusable, dismiss suggestion, move rep to another
  group) use Undo Snackbar instead.
- Danger red never appears at rest on a list screen; it appears only inside overflow menus (text) and confirmation dialogs.
- *Delete player* lives only in Manage player (overflow) behind a typed-name confirmation ("Type *Ada Tester* to delete").
  (This is a UI safeguard; the deletion logic is unchanged.)

---

## 21. Status taxonomy

One vocabulary, one chip component. **User-facing labels can change; stored values cannot** (§21.3).

### 21.1 Canonical statuses

| Domain | UI label | Stored value(s) | Chip style | Icon |
|---|---|---|---|---|
| **Review** | Needs review | `issues.review_status = draft` | warning subtle | `sparkles` |
| | Approved | `approved` | success subtle | `check` |
| | Edited | `edited` | neutral (text-2) | `pencil` |
| | Rejected | `rejected` | neutral, muted | `x` |
| **Priority** | Active | `player_priorities.status = active` | none (plain text; only exceptions get chips) | — |
| | Monitoring | `monitoring` (UI copy: "Keeping an eye on it") | neutral | `eye` |
| | Resolved | `resolved` | success subtle | `check` |
| | Archived | `archived` (hidden; shown in "Archived") | neutral muted | `archive` |
| **Progress** (coach observation) | Improving | `improving` | success subtle | `trending-up` |
| | Unchanged | `unchanged` | warning subtle | `minus` |
| | Worse | `worse` | danger text on subtle | `trending-down` |
| | Unclear | `unclear` | neutral | `circle-help` |
| | Resolved | `resolved` (progress value; offers to resolve the priority) | success subtle | `check` |
| **Practice outcome** | Improved / Unchanged / Mixed / Unclear | `yes` / `no` / `mixed` / `unclear` | as progress; Mixed = warning | as progress |
| **Processing** | Uploading | client-only (not persisted) | neutral + progress | `upload` |
| | Waiting to process | `video_clips.status = pending` | neutral | `clock` |
| | Processing | `processing` | neutral + spinner | — |
| | Ready | `ready` (chip only in lists that need it; otherwise implicit) | success text | `check` |
| | Failed | `failed` (+ **Retry**) | danger text | `triangle-alert` |
| **Analysis quality** | Good / Limited / Poor | `analysis_quality` ratings | success / warning / danger text, no fill | — |
| **Transfer** | see §16.1 | derived | neutral/success | `git-merge` |

### 21.2 Synonyms to eliminate

| Today | Replace with |
|---|---|
| "✓ 0/2 Confirmed" pill, "Confirmed", "Verified", "Coach Reviewed", "Reviewed by X" chip | **Approved** (finding/score), with `by X` in caption; the roster-wide pill is removed |
| "AI observations", "AI draft", "AI Draft — Unconfirmed" | **Findings** / **Needs review** (with quiet "Drafted from this swing" provenance) |
| "Improved" (practice) vs "Improving" (priority) | **Improved** only for a finished session assessment; **Improving** for priority progress |
| "Did not improve" (practice `no`) | **Unchanged** |
| "Monitoring" / "Keep watching" / "Active priority" | **Active** / **Monitoring** as above |
| "Pending"/"Queued"/"Not measured" for clips | **Waiting to process** / **Processing**; "Not measured" rows hidden |
| "Early Read" in success green | **Early read** caption in text-3 |

### 21.3 Existing data values that cannot be renamed

`issues.review_status` (`draft/approved/edited/rejected`), `player_priorities.status`
(`active/monitoring/resolved/archived`), `player_priority_observations.status`
(`improving/unchanged/worse/resolved/unclear`), `practice_sessions.outcome` (`yes/no/mixed/unclear`),
`video_clips.status` (`pending/processing/ready/failed`; `pending` = "Waiting to process" is a label change only),
`practice_repetitions.grouping` (`baseline/drill/post_drill/free_swing/other`), `at_bat_pitches.pitch_outcome`
(`ball/called_strike/swinging_strike/foul/ball_in_play/hit_by_pitch/take/other`), `analysis_quality` fields. Stored values
are constrained by CHECK constraints and referenced by triggers, RLS helpers, tests and the public report; only labels
(`developmentLogic.js` `*_LABELS`, and `shape.ts` `STATUS_LABELS`) may change. **Not representable without schema
change:** a practice outcome of "Worse", "Mixed" as a priority progress value, a distinct persisted "Uploading" state, and a
persisted "AI is drafting" state (§22).

---

## 22. Empty, loading and processing states

### 22.1 Empty states

Format: optional 24 px icon, **title (≤ 6 words)**, **one sentence (≤ 14 words)**, at most **one** action. No dashed
boxes for "nothing yet"; a dashed outline is reserved for drop/attach targets. Errors are a separate component with **Retry**.

| Situation | Title | Line | Action |
|---|---|---|---|
| No swings | No swings yet | Record a swing to start building a picture. | **Record swing** |
| No practices | No practice yet | Start a session to work on a priority. | **Start practice** |
| No findings on a ready swing | No findings for this swing | The swing looks fine, or analysis found nothing to flag. | — |
| Findings pending (clip ready, none yet) | Analyzing this swing | Findings appear here when analysis finishes. | — (see §22.3) |
| No priorities | No priorities yet | Review a swing, then track a finding you want to work on. | **Review swings** |
| No metrics | No measurements yet | They appear once processing finishes. | — |
| No 3D | No 3D for this swing | The video and findings are still reliable. | — |
| No comparison | Pick two swings | Compare a rep before and after a drill, or game vs practice. | Suggested pair chips |
| No post-drill swings | No post-drill swings yet | Record a rep after the drill to compare. | **Record rep** |
| No strengths | (public report) "Strengths will appear here as your coach reviews more swings." | — | — |
| No pending reviews | You're all caught up | New swings appear here after they're analyzed. | — |
| No drills assigned | No drill yet | Pick a drill to practice this priority. | **Choose drill** |
| No follow-up | No follow-up set | Set a reminder to re-check this priority. | **Set follow-up** |
| Load failure | Couldn't load this | Check your connection and try again. | **Try again** |

### 22.2 Video, processing and analysis states

Only real states are shown; no invented percentages or ETAs. Sources are the code paths audited in `videoUpload.js`,
`player.html` processing indicator and `skeletonComparison.js`.

| Stage | What exists today | Spec |
|---|---|---|
| **Video upload** | `uploadRawClip` uses `fetch` PUT; no progress events; button text "Uploading…" | Show an **indeterminate** bar with file size ("Uploading 84 MB…") and a *Cancel*; do not show a percentage. **Optional Phase 2:** switch to `XMLHttpRequest` upload events to show a real percentage; only then show one. Failure: "Upload failed — nothing was saved. Try again." with **Retry**. |
| **Waiting to process** | `status = pending` | Row chip "Waiting to process". No timer. |
| **Processing** | `processing` + real elapsed timer since claim (existing `N:NN elapsed`) | Row chip + spinner + "2:14 elapsed · this can take a few minutes". Keep the honest elapsed counter (from claim time). No fake stages. |
| **Failed** | `failed`, `error_message`, retry supported | Danger text "Couldn't analyze this swing", the human-readable reason in one line, **Retry**; "Details" Disclosure holds the raw error. |
| **Ready** | `ready` | No chip in lists (implicit); phase/finding UI appears. |
| **3D generation** | Part of processing; the viewer shows "Loading 3D model…" | In the viewer: skeleton placeholder + "Loading 3D model…"; on failure a non-blocking line "3D isn't available for this swing — the video is unaffected". Never block review on 3D. |
| **AI diagnosis** | Runs after processing; no persisted status. A `ready` clip with no issues is ambiguous ("not yet run" vs "nothing found") | Interim copy: "Findings appear here once analysis finishes." with a passive timer only if the clip became ready < 5 min ago. **Dependency:** an explicit `analysis_status` (e.g. `queued/running/done/failed`) would let the UI say "Analyzing" vs "No findings"; **do not fake it**; ship the interim copy and file the data request. |

---

## 23. Accessibility and mobile ergonomics

**Thumb reach and one-handed use**
- Primary actions in the bottom 40% of the viewport (StickyActionBar, sheet footers, Approve in expanded card); the
  top-right `x` remains but never the only way to dismiss.
- Bottom nav 56 dp + safe area; centre "+" is the most reachable control.
- No horizontally-scrolling primary navigation (tabs are equal width).

**Touch targets:** ≥ 48 × 48 dp hit area everywhere (`--touch-min: 48px` already exists and is honoured by `button`,
`select`, `input[type=text]`; chips and small text buttons must gain slop padding to meet it). ≥ 8 dp between adjacent
targets.

**Safe areas:** the CSS contains **no `env(safe-area-inset-*)`** usage (grep of `coach/*.css|html`). Add
`padding-bottom: calc(56px + env(safe-area-inset-bottom))` to nav/sticky bars and `viewport-fit=cover` where the PWA is
displayed edge-to-edge. (Capacitor Android currently lays content inside system bars, so this mainly protects PWA/iOS and
gesture-nav devices; **UNVERIFIED** on Android 15 edge-to-edge defaults.)

**Zoom and scaling:** remove `maximum-scale=1, user-scalable=no` (present on 8 pages; only `report.html` omits it). Allow
pinch-zoom; the 3D canvas already sets `touch-action: none` and the scrub range `touch-action: pan-y`, so gestures don't
depend on the lock. Use `rem`/`clamp` type; test at font scales 100 / 130 / 200%: tabs may wrap to two lines but never clip,
chips wrap, sheets scroll, sticky footers never cover inputs.

**Keyboard (**UNVERIFIED**):** the manifest sets no `windowSoftInputMode`; centred modals with `max-height: 85vh` may be
covered by the keyboard depending on WebView resize behaviour. Sheets must follow `visualViewport` and keep the primary
button visible; scroll the focused field into view. Test the Log AB / Add player / notes fields on a small (5") emulator.

**Scroll behaviour:** preserve scroll position when returning from a drill-in page (`history.scrollRestoration = 'manual'`
+ per-route stored offset); a sheet open/close never scrolls the page; anchors/deep links (`?phase=`) scroll the video
into view first.

**Video ergonomics:** controls ≥ 48 dp; frame step and speed reachable with the thumb; landscape → full-screen video
(§11.1); do not autoplay with sound; keep `playsinline`; respect reduced motion for seek animation.

**Android back:** §4.4.

**Contrast and colour independence:** all text ≥ 4.5:1, UI components ≥ 3:1 (values in §5.1); state is never colour-only
(chips have text + icon; progress uses icons).

**Screen readers:** icon buttons have `aria-label`; sheets use `role="dialog"` + focus trap + return focus; live regions
for Snackbars ("Approved. Undo"); tabs use `role="tablist"`; A/B selection announces "Swing A selected". Video controls
are native or labelled buttons.

**Sunlight:** dark-only stays (documented rationale in `coach.css`); the public report may offer light mode (Phase 3).

---

## 24. Migration plan

Guiding rule: **no route, data or logic changes**; changes are tokens, markup structure and shared components. Ship in three
phases; each phase is independently releasable and reversible.

### Phase 1 — Foundations and the noisiest screens (lowest risk, highest value)

1. Tokens (§5) and type scale (§6) via CSS variables with `--status-*` aliases; fix contrast; 4/8/12/16/24/32 spacing;
   remove card rails and the ALL-CAPS section-heading treatment.
2. Lucide sprite + `Icon` helper (§7); replace emoji in nav, buttons and badges; add to `sw.js` `ASSETS` and the
   `bump-coach-cache.mjs` hash.
3. **AppBar** (single row, remove confirmed pill, player-switcher sheet) and **SegmentedTabs** (compact, equal width);
   hide the tab strip on drill-in pages and fix wrong active tab.
4. **BottomNav**: Team / + (ActionSheet) / Player (interim) with icons; **rename tab "Report" → "Overview"** (label only).
5. **BottomSheet + ConfirmDialog + Snackbar + OverflowMenu** replacing `openSheet`/`closeableModal` centred modals and
   native `confirm()/alert()` (one implementation swap covers about a dozen forms); Back-button history handling for sheets.
6. **Team screen** (§9) and **Player overview** (§10) re-hierarchy using existing data (no new queries except the
   review-count line already loaded by `teamDashboard.js`).
7. **Swing review** (§11) finding card + progressive disclosure + single Advanced disclosure; remove per-priority progress
   button blocks.
8. Remove viewport zoom lock; bundle fonts locally (see 24.4); pitch and rep row overflow (`⋮`) with Delete moved out of
   sight.

### Phase 2 — Flagship workflows

1. **Development** redesign (§16) with `PriorityCard`, Needs-review section, Timeline, Insights, game-transfer chips.
2. **Practice** guided session (§13) + prefilled **Start practice** sheet (§14) incl. same-day handling.
3. **Compare** suggested pairs, selection tiles, full-screen picker, mode reorder, single status line (§15).
4. **Pitch entry** quick-entry sheet with outcome grid, derived count, zone picker, optional details (§17); Log at-bat sheet.
5. **Review queue** screen and `?queue=1` sequential mode (§9.5).
6. **Public report** redesign (§18) and `STATUS_LABELS` copy tweak.
7. Processing/upload states (§22.2): honest ProcessingState; optional XHR upload progress.
8. Empty-state catalogue (§22.1) applied across screens.

### Phase 3 — Polish and platform

1. Landscape full-screen video, gesture niceties (swipe between findings/swings), haptics.
2. `@capacitor/app` for explicit Android back handling; edge-to-edge/insets verification; font-scale QA.
3. Priority detail as a full sheet; evidence list sheet; "Archived" view; optional heat-map view flag on Team.
4. Light theme for the public report only; print stylesheet.
5. Accessibility audit (TalkBack), screenshot regression suite (reuse the emulator capture script), instrumentation of the
   acceptance metrics (§26).
6. Optional data requests noted in §16.1 and §22.2 (`analysis_status`, real upload progress) if Phase 2 confirms need.

### 24.4 Offline and font note

`coach.css` imports Google Fonts at runtime (`@import url(https://fonts.googleapis.com/...)`), and `shared.js`/`skeletonScene.js`
import from `esm.sh`. `sw.js` deliberately does not precache them. Consequence: on a field with no signal the first launch
falls back to system fonts and the Supabase client may not load. **Recommendation:** vendor Inter/Oswald (subset, WOFF2) into
`coach/assets/fonts/` and precache; this is a UI-supporting change and does not affect behaviour. (Vendoring `esm.sh` modules
is out of scope for this spec.)

---

## 25. Components to remove or merge

| Remove / merge | Into | Reason |
|---|---|---|
| `.dev-tabs` pill row (48 dp pills) | `SegmentedTabs` | Oversized, clips 4th item |
| `.confirmed-pill` in app bars | Removed (Team uses "Today") | Checklist metric irrelevant to primary flow |
| `.stat-tile` / `.stats-row` on Overview | Working-on caption + Game log summary line | Low-value stats |
| `.badge.ai-draft/.edited/.confirmed`, `.verified-pill`, `.ai-ribbon`, `.pill` (incl. `.needs-review`, `.due`), `.clip-status-indicator` | `StatusChip` | Five chip systems, inconsistent colours |
| `.chip`, `.clip-tab-btn`, `.roster-toolbar` chips | `FilterChip`, moved to a Filters sheet | Visible clutter |
| `.card` (clay rail), `.dev-card`, `.lineup-row`, `.checkpoint-card` wrapper | `Card` + `ListRow` | Uniform heavy cards |
| `details.drawer` (+ ad-hoc "How to run it" details) | `Disclosure` | One accordion pattern |
| `.modal` / `closeableModal` / `openSheet` centred forms | `BottomSheet` | Mobile-native, keyboard-safe |
| Native `confirm()` / `alert()` (15 in `player.html`, plus atbat/session/compModal/devActions/stepper) | `ConfirmDialog` / `Snackbar` | Not themeable, blocks, poor a11y |
| `.btn-danger`, `.btn-danger.subtle` per-row 🗑 | `OverflowMenu` item | Danger at rest |
| `.dev-btns` wrapping button rows | `StickyActionBar` / per-component action slots | Equal-weight action piles |
| `.dev-empty` (used for errors) | `EmptyState` + `ErrorState` (with Retry) | Errors need action |
| Underlined terracotta inline links (`At-bat summary · Development · Compare swings`) | Tabs/back/title-bar overflow | Duplicated navigation |
| Inline scrubber, 3D viewer and comp modal in `player.html` game/practice cards | Link to `review.html` (single owner of video+3D) | Duplicate flagship UI, heavy DOM |
| Legacy at-bat-level pitch/zone/outcome fields in Log AB modal | Pitch quick-entry | Duplicates `at_bat_pitches` |
| Team heat-map legend & red `focus-banner` in default view | Team insights Disclosure | Legacy checklist emphasis |
| "New reps go in group" card; per-rep group `<select>` + usable checkbox | Stepper-driven group + `⋮` "Move / Mark unusable" | CRUD chrome |

---

## 26. Existing functionality that must remain

All of the following stay reachable and behave identically (behind disclosure/overflow where noted):

- **Coach approval** of findings and checklist scores (Approve/Edit/Reject; scores' 1-2-3 stepper in Advanced), with the rule
  that AI never overwrites coach-reviewed content and never creates or resolves a priority.
- **Video-first evidence:** original video with phase seeking and `?phase=` deep links; evidence links on findings and priorities.
- **Game vs practice distinction**, pitch-level and rep-level clip attachment, multiple clips per pitch, unassigned-clip assign.
- **Priorities, drills, follow-ups, progress observations, status history and resolve flow**, plus the drill library.
- **Game transfer** (elevated, §16.1).
- **Comparison** (video, Frame A/B with presets, metrics, trend, 3D A|B, shared viewpoint, trails, deep links).
- **Metrics** with the *direct video measurement* vs *3D reconstructed estimate* labels and the poor-reconstruction hiding rule.
- **3D reconstruction** (viewer, camera presets, trails, axes), on demand.
- **Analysis quality** (Good/Limited/Poor) and its fallback derivation for older clips.
- **Advanced checklist scoring**, history sparklines, AI-draft vs coach-reviewed badges (as Approved/Needs review chips).
- **Share links** (create, list, revoke, expiry) and the public report's server-side whitelist and evidence-only video access.
- **Early Read** honesty (<3 real at-bats) and low-confidence labelling.
- **Offline shell**, camera capture on upload inputs (`capture="environment"`), retry on failed clips, elapsed-time processing display.
- **Multi-coach/RLS boundaries** and team access code creation flow.

---

## 27. Screens and routes requiring no changes

- **Routes:** none renamed or removed (`index.html`, `team.html`, `player.html`, `atbat.html`, `session.html`,
  `review.html`, `development.html`, `compare.html`, `report.html`). The player-hub tab is relabelled, not re-routed.
- **Deep-link contracts:** `?team=&player=`, `?entry=`, `?session=`, `?clip=&phase=`, `?a=&b=&mode=&priority=&phase=`,
  `?token=`, `?openLog=1` unchanged.
- **Auth forms** (sign-in, sign-up, email confirmation, team-creation with access code): structure unchanged; only tokens/
  typography/sheet chrome update.
- **3D viewer internals** (`skeletonScene.js`, `skeletonComparison.js`, retarget map), the scrubber/range interactions and
  the checklist stepper: unchanged except surrounding containers and tokens.
- **Analysis quality grid, metrics table content, comp reference illustrations:** content unchanged; moved into Advanced.
- **Everything server-side:** migrations, RLS, edge functions (except the one optional `STATUS_LABELS` copy string),
  worker, pipeline, AI prompts, knowledge layer.

---

## 28. Acceptance criteria

Measured at 390×844 dp, font scale 100% unless stated, on an Android emulator and one physical device.

**Layout and hierarchy**
- [ ] App bar + tab strip ≤ 104 dp total; bottom nav ≤ 56 dp + inset; chrome ≤ 20% of viewport height on player tab pages
      (currently ≈ 35%).
- [ ] Each screen has at most **one** brand-filled button visible at once.
- [ ] No card shows more than **three** visible actions; destructive actions never visible at rest.
- [ ] Swing review: the full video frame and the first finding title are visible without scrolling on 390×844.
- [ ] Team screen: roster starts within the first screenful when ≥ 1 needs-review or due item exists; no equal-weight card
      stack.
- [ ] Development: priority names, progress state, drill and transfer state visible for the top 2 priorities without expanding.

**Interaction speed**
- [ ] Log a pitch in **≤ 2 taps** (outcome → Save & next) with derived count and swing/take.
- [ ] Start a practice session in **≤ 2 taps** when a priority and drill exist (open sheet → Start session).
- [ ] Reach *Compare baseline → post-drill* from a session in **≤ 2 taps**.
- [ ] Approve a finding and start tracking it in **≤ 3 taps**.
- [ ] From Team, reach the first swing needing review in **≤ 2 taps**.

**System consistency**
- [ ] Only the statuses in §21 appear; no synonym labels; every chip has text + icon; colour is never the sole signal.
- [ ] No emoji in navigation, buttons, chips or badges; all icons from the single sprite.
- [ ] No native `confirm()`/`alert()` in `coach/`; destructive flows use ConfirmDialog; reversible ones use Undo.
- [ ] Brand colour is not used for h1/h2 headings, list bullets, "active" status or card rails.
- [ ] Every list screen has a defined empty state (§22.1); every load failure has **Try again**.

**Accessibility and platform**
- [ ] Text contrast ≥ 4.5:1 and UI-component contrast ≥ 3:1 (verified with a tool, values in §5.1 adjusted if needed).
- [ ] Touch targets ≥ 48 × 48 dp, ≥ 8 dp separation.
- [ ] Pinch-zoom enabled; layouts survive 130% and 200% font scale without clipped controls or horizontal page scroll.
- [ ] Android Back closes the topmost sheet/dialog/menu first, then navigates to the logical parent; Teams root exits.
- [ ] Keyboard never covers the focused field or the sheet's primary button (Log at-bat, Add player, notes) on a 5" emulator.
- [ ] Landscape on review shows full-screen video with usable controls.
- [ ] TalkBack announces tabs, A/B selection, sheet open/close, Snackbar text.

**Capability preservation**
- [ ] Every item in §26 is reachable and passes its existing tests (`npm test`, `pages.test.mjs`); `sw.js`/cache-hash lists
      include new assets; no route or deep link regresses.

---

## 29. Per-screen quick reference

| Screen | Primary CTA | Secondary | Advanced | Key component changes |
|---|---|---|---|---|
| Teams home | Open team (row) | Create team | Account (Sign out) | ListRow, Account sheet |
| Team | Review pending swings | Follow-ups, roster row, "+" | Team insights, heat-map, filters | TodaySummary, ListRow, Disclosure |
| Player Overview | Next action (one) | Working on, Recent | Checklist, diagnosis, context, manage | Next-action card, Card, Disclosure |
| Swing review | Approve → Track as priority | Edit, Reject, drill, progress | Analysis quality, metrics, 3D, checklist | FindingCard, evidence chip, one Disclosure |
| Development | Start practice | Update progress, Add priority | Loop line, evidence, insights, trends | PriorityCard, Timeline, transfer chip |
| Practice session | Record rep → Compare → Finish | Edit brief, rep `⋮` | Other reps, notes | Stepper, RepRow, StickyActionBar |
| Start practice sheet | Start session | Change focus/drill/date | Goal | Prefilled BottomSheet |
| Compare | Mark progress | Swap, align, choose manually | Filters, trails, frames | Suggestions, tiles, MediaPair |
| At-bat / pitches | Next pitch | Attach video, review | Type, zone, notes, summary | PitchRow, outcome grid, sheet |
| Public report | — (read-only) | Watch swing, expand drill | Full checklist, earlier progress | Timeline, Disclosure, brand strip |

---

## 30. Top 10 highest-impact UX changes

1. **Collapse the chrome:** single-row 56 dp app bar, compact equal-width tabs, no confirmed pill (recovers ≈ 15% of the screen and removes the clipped tab).
2. **Swing review: one primary action per finding with progressive disclosure** (Approve → then Track as priority; evidence as an inline jump; Reject via Undo).
3. **A single "Next action" on Overview** replacing the stat tiles and legacy sections, with a deterministic precedence.
4. **Replace centred modals with keyboard-safe bottom sheets and ConfirmDialogs** (removes about a dozen forms' worth of desktop UX and every native `confirm()`).
5. **Practice as a guided Baseline → Drill → Post-drill flow** with a prefilled one-tap "Start practice".
6. **Development as the coaching plan:** Next focus hero, compact priority cards, `⋮` actions, needs-review separated from coach-owned priorities.
7. **Game-transfer chips on every priority** (coach-confirmed language, no causal claims) — the product's differentiator made visible.
8. **Two-tap pitch logging** (outcome grid + derived count/swing-take; details, zone picker and notes optional).
9. **Compare defaults to smart pairs**, video-dominant, with Trend before Metrics and one status line instead of prose warnings.
10. **One design system:** restrained brand colour (contrast-fixed), Inter-first type scale, Lucide icons instead of emoji, single StatusChip vocabulary (§21).

---

## 31. Phased delivery (prioritized by user value and implementation risk)

**PHASE 1 — Foundations and the noisiest screens.** *Highest value, lowest risk (CSS/markup/shared components; no routes,
data or logic change).*
Tokens, type and contrast fixes; icon sprite; AppBar + SegmentedTabs; BottomNav + "+" ActionSheet; **BottomSheet /
ConfirmDialog / Snackbar / OverflowMenu** (incl. sheet Back handling); Team and Player Overview re-hierarchy; Swing review
finding card + single Advanced disclosure; delete/edit moved to overflow; zoom lock removed; fonts vendored.
*Risk:* sheet component swap touches every form → cover with the existing page-wiring tests plus an emulator screenshot pass.

**PHASE 2 — Flagship workflows.** *High value, moderate risk (new screens/states, small queries, one new list view).*
Development redesign with game-transfer chips; guided Practice + prefilled Start practice; Compare smart pairs and mode
reorder; Pitch quick-entry and Log at-bat sheet; Review queue; public-report redesign; honest upload/processing states;
empty-state catalogue.
*Risk:* transfer chips "Not observed / Seen in next game" need a small per-priority query; upload percentage needs an XHR
change; AI-diagnosis "Analyzing" state needs a data field (kept out of scope, interim copy shipped).

**PHASE 3 — Polish and platform.** *Medium value, higher effort or native dependencies.*
Landscape full-screen video; `@capacitor/app` back handling (native rebuild); edge-to-edge/insets QA; priority detail sheet;
light public report/print; TalkBack and font-scale audit; screenshot regression and acceptance-metric instrumentation;
optional schema follow-ups (`analysis_status`, practice "Worse").
