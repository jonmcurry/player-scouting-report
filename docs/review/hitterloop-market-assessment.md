# HitterLoop: Market Assessment, Product Reset, and the "Must-Have" Test

*Prepared 2026-10-03. Research orchestrated by Claude, with 12 independent Gemini/AGY research
workers. Answers the brief in [fullmarketassessment.md](fullmarketassessment.md).*

---

## How to read this report

Every material claim carries one of three labels:

- **[OBS] Observed evidence**: directly supported by a cited source, the repository, or the live
  product page.
- **[INF] Strong inference**: not stated outright by customers, but supported by several
  independent evidence points.
- **[HYP] Hypothesis**: plausible but untested. It needs customer testing before you build on it.

**Evidence-quality warning.** The voice-of-customer evidence is the weakest part of this study.
Reddit blocks direct access from this environment. Gemini workers reached Reddit through Google
grounding, but several returned *paraphrased* "quotes" behind opaque redirect URLs. I treat those as
[INF] at best. I quote verbatim only where I fetched the page myself. No customer has been
interviewed. Every conclusion below about what coaches, parents, or instructors *want* is therefore
provisional until the discovery program in §21 runs.

### Research log (what was actually done)

| # | Workstream | Worker | Quality of return | How I used it |
|---|---|---|---|---|
| 1 | Competitive intelligence | AGY (spawned 4 sub-agents) | Good breadth; complaint citations are generic search pages | Landscape; competitor pricing re-verified where it matters |
| 2 | Voice of the coach | AGY | Directionally consistent, quotes paraphrased | Hypotheses, cross-checked against forum threads I fetched myself |
| 3 | Parent / player / org segments | AGY | Thin sourcing for "instructor retention pain" | Segment ranking, discounted |
| 4 | GameChanger deep dive | AGY | Strong; two factual errors corrected (stream resolution; "hits only") | Core input to the thesis |
| 5 | CV feasibility | AGY + repo code | Strong; grounded in this repo's own audit notes | Feasibility classification |
| 6 | Exception-workflow analogues | AGY | Good; best insight was where the analogy *breaks* | Workflow redesign |
| 7 | Red team on current product | AGY | Strong argument, but some invented specifics (corrected below) | Failure modes |
| 8 | Greenfield founder (no HitterLoop UX shown) | AGY | Fast, thin market sourcing; independent conclusion | Anchoring check |
| 9–11 | Investor evaluations of 3 theses | AGY ×3 | All three said "don't invest" (2/10, 3/10, 2/10) | Thesis stress test |
| 12 | Adversarial red team on the emerging thesis | AGY | Strong. Forced two real revisions (no cross-camera metrics; plug-in secondary); one overstatement corrected | Thesis revision (§13) |
| — | Independent verification | Claude (web + repo) | Primary sources where reachable | GameChanger features and pricing, WIN SmartPark, Trace, Balltime/Hudl, Aspen spending, forum quotes |

Worker errors I caught and corrected:

- Red team #7 claimed the pipeline assumes 240 fps footage. It doesn't: it decimates high-fps
  video to about 30 fps.
- Red team #7 cited an "80% upload failure rate". That number was invented.
- Red team #7 called v0.30 a "panicked pivot". That is rhetoric, not evidence.
- The GameChanger worker said streams are 720p. GameChanger announced 1080p HD streams in Feb 2026.
- One evaluator said GameChanger auto-clips only hits. GameChanger's help center says every at-bat
  in a streamed and scored game.
- One evaluator said Trace abandoned baseball. That is unverified, and a Trace Baseball app exists.
- One worker wrote a file into the repo despite read-only instructions. It was removed.

---

## 1. Executive Summary

**Bottom line: HitterLoop is a technically serious answer to a problem its current user does not
have.**

1. **The current customer is wrong.** [INF, multiple sources] Travel and youth team coaches
   largely do not do individual swing mechanics. They outsource it to private hitting instructors
   and steer clear of mechanics conversations. A coach quoted on a softball forum said: *"Too many
   voices muddy the waters so as a coach I try to avoid those conversations, even if I think I am
   right and the personal/paid coach is wrong"* [OBS: discussfastpitch, Aug 2024]. HitterLoop
   currently asks this person for roughly 1–4 hours a week of logging and approvals (§8). That is
   the core failure mode, independent of anything else in this report.

2. **"AI analyzes a phone swing video" is now a commodity.** [OBS] SwingAI (WIN Reality), Mind &
   Muscle, Baseball AI (Athletech), Dingerly, and ProPlayAI all do it at roughly $10–30/month. One
   vendor's own buyer guide says: *"In 2024, phone-based AI swing analysis was a novelty. In 2026,
   it's expected."* HitterLoop's analysis layer is not a differentiator, and its 3D layer is not a
   product.

3. **Automated game-swing analysis is being taken by a well-funded consolidator at the venue
   level.** [OBS] WIN Reality bought Blast Motion (June 2025) and Yakkertech, then launched
   **SmartPark** (Dec 2025). SmartPark puts fixed cameras on fields, starts at $6,500 per field per
   year, and claims 2,500+ fields committed. Every game swing is "automatically analyzed by SwingAI
   with a full biomechanical evaluation and paired with Blast Motion bat path data". The output goes
   to coaches, players, and families. "Automated Game Film Intelligence" sold to teams or venues is
   not open white space.

4. **GameChanger already produces the raw input HitterLoop needs.** [OBS] GameChanger generates a
   clip of *every at-bat* in streamed and scored games. Clips are downloadable and shareable one at
   a time, and the usual camera position is behind home plate, the same angle HitterLoop's pipeline
   was built on. There is no public API, and GameChanger's ToS forbids automated access. GameChanger
   is not doing swing analysis. Its AI goes into streaming, recaps, highlights, and an outcome-stats
   "Insights" tab.

5. **The one piece of real existing behavior found is parents carrying game swings to private
   instructors.** [OBS, single verbatim source plus corroborating summaries] One parent wrote: *"We
   video every at bat and I usually send them to her hitting instructor the day before our next
   lesson. He doesn't usually ask for them (sometimes), but he usually thanks me for sending them."*
   Note what that quote says: the parent does the work, the instructor rarely asks, and the
   instructor is grateful. That is **evidence of a habit, not of hair-on-fire pain.**

6. **No direction tested here passed the must-have test.** Three independent investor-style
   evaluations each rejected their thesis (2/10, 3/10, 2/10). Every audience showed either weak pain
   (coaches), weak willingness to pay for development software (parents; see the Blast paywall
   backlash), or a crowded, seasonal, fragmented market (instructors).

**Recommendation.**
- **Stop building the coach-led player-development operating system now.** Freeze the product.
- Run a **4–6 week concierge test** of the narrowest thesis with the best evidence of existing
  behavior: **a "game-swing brief" for private hitting instructors.** Parents forward GameChanger or
  phone at-bat clips. HitterLoop automatically keeps the swings and shows them beside the
  student's previous game swings, with the lesson swing as video only. The instructor gets a
  60-second brief before the next lesson, and the coach is not involved at all. The red team forced
  one narrowing (§13): no metric comparisons across different camera setups.
- Write no new production code until instructors pay for the concierge version and parents keep
  forwarding clips without being chased.
- **If that fails, stop**, or license the game-clip processing to a platform that already owns the
  footage and the distribution.
- Even if it succeeds, it is most likely a **small, focused software business, not a venture-scale
  company** (§19).

**HitterLoop becomes indispensable when** a hitting instructor walks into Tuesday's lesson having
already seen Saturday's game swings next to last week's cage swings, and knowing whether anything
changed since earlier games, without anyone having done anything but forward the clips they were
already taking.

---

## 2. What HitterLoop Is Today

[OBS: [live project page](https://joncurry.co/projects/hitterloop), `readme.md`, `CHANGELOG.md`, repo]

- **Positioning:** "A coach-led swing-development app for baseball and softball hitters... The
  coach decides what a hitter should work on next, assigns drills, compares swings over time, and
  tracks whether practice carries into games."
- **Pipeline:**
  - YOLO11-pose for the body, plus YOLOv8 with ByteTrack for the bat.
  - An audio bat-crack pre-pass that finds the swing window in long clips.
  - Batter selection by cumulative "who is holding the bat" evidence.
  - One-Euro smoothing.
  - VideoPose3D 2D→3D lift.
  - Contact-frame inference.
  - Body-relative metrics: bat speed in shoulder-widths/s, stride in hip-widths, angles with
    confidence flags.
  - Gemini drafts findings from one still frame per located swing phase, plus pitch context. It
    never sees raw video and never generates the measurements [OBS: `src/services/ai/geminiAnalyzer.ts`,
    readme "AI diagnosis"; live page].
- **Coach workflow:**
  - Pitch-by-pitch at-bat logging: outcome, optional 9-zone location, count, a clip per pitch.
  - Practice sessions: goal, focus priority, drill, and reps grouped as baseline / drill /
    post-drill.
  - A team review queue that asks for one explicit decision per AI finding.
  - An 11-checkpoint checklist, each checkpoint in AI-draft / verified / insufficient / rejected.
  - Priorities, a drill library, follow-ups, and outcome logging.
  - Compare (Video / Frames / Progress / Metrics / 3D).
  - A development timeline, a game-vs-practice transfer view, and 90-day parent report links.
  - New in v0.30: guardian accounts and a family page.
- **Scale of the build:**
  - About 41k lines of TS/JS/Python/SQL/HTML, 45 migrations, and 12 coach pages.
  - A public demo built on one real player.
  - A methodology "knowledge system" with an admin UI.
  - About 108 commits since June 2026.
- **Reality:**
  - Nothing is in production, and there is no billing.
  - One real team (a 10U softball team).
  - The pipeline's correct-batter selection was validated on **four short clips**
    [OBS: `docs/PIPELINE_AUDIT.md`].
  - Bone-length variation is 2.4–10.1% CV.
  - Torso-tilt and other world-space angles shift with camera position. The live page says so.

---

## 3. Where HitterLoop Became Overbuilt

Overbuilding happened in three layers:

1. **Workflow overbuild:** the product assumes a full-time, mechanics-minded coach.
   - Pitch-by-pitch logging duplicates what GameChanger's scorer already records [OBS].
   - Per-finding approval turns the coach into a QA reviewer for the AI.
   - The priority → drill → follow-up → outcome loop is a case-management system.
   - None of this is wrong in itself. It belongs to a paid professional (an instructor), not a
     volunteer.
2. **Analytical overbuild:**
   - The 3D reconstruction, the rigged FBX avatar, and the "corrected swing" visualization
     research all serve explanation and demo value.
   - The page itself says the 3D is "a review aid, not the source of truth" [OBS].
   - Customers in this market pay for outcome metrics they trust (exit velocity, bat speed from
     sensors), not reconstructed kinematics [INF: hardware dominance, Blast/HitTrax pricing].
3. **Governance overbuild for a product with no users:**
   - The methodology knowledge system, demo fixture lifecycle, curated export, privacy-treated
     public demo, guardian consent versioning, and clip-deletion audits are each careful work.
   - Together they are infrastructure for a scale that does not exist.
   - The consent and privacy work does matter if minors' video is stored, and should be kept
     (§16).

The honest estimate of how much of the current product the recommended direction needs is about
**20–30%**: the clip ingestion, the 2D pipeline, the player record, and a brief renderer. **About
70% should be frozen or deleted.**

---

## 4. Market Reality

**Size and spending:**
- [OBS] US baseball participation among 6–17 year-olds was about 8.5M, a record
  ([MLB/Aspen](https://www.mlb.com/news/more-youth-teens-continuing-to-play-baseball)).
- [OBS] Average family spending on baseball was $1,113/yr, up 68% from 2019 to 2024
  ([Aspen Project Play](https://projectplay.org/news/2025/2/24/project-play-survey-family-spending-on-youth-sports-rises-46-over-five-years)).
- [OBS] Travel families spend $2k–$20k/yr.
- [OBS] Private lessons cost $80–140/hr, with 10-packs at $700–1,100
  ([summary of facility rates](https://www.baseballclinics.com/are-you-paying-too-much-for-baseball-training/)).

**Who owns what:**
- **GameChanger (DICK'S)** owns game-day workflow: scoring, streaming, stats, per-at-bat clips.
  - It is free for coaches and staff [OBS].
  - Families pay, or a team buys a Team Pass at $239 (Plus) or $449 (Premium) per season
    [OBS: [gc.com Team Pass](https://gc.com/pricing/team-pass)].
  - Feb 2026 brought "15+ new features": 1080p streams, highlight reels, and a beta "Insights" tab
    [OBS].
- **WIN Reality** is consolidating hitter development:
  - SwingAI phone analysis, TrainVR, Blast Motion (acquired Jun 2025), Yakkertech (acquired), and
    SmartPark venue cameras (2,500+ fields committed, from $6,500 per field per year).
    [OBS: [businesswire](https://secure.businesswire.com/news/home/20250623297228/en/WIN-Reality-Acquires-Blast-Motion-A-New-Era-in-Swing-Development),
    [SmartPark launch](https://winreality.com/blog/smartpark-launch-pro-tech-for-every-diamond/),
    [SmartPark pricing](https://winreality.com/join-the-smartpark-era/)]
- **Hudl** is consolidating AI film in adjacent sports. It acquired Balltime, the AI volleyball
  film product sold to clubs and regions, with 12,000 teams [OBS].
- **Instructor and parent video tooling is crowded and cheap:**
  - OnForm: $29–79/mo.
  - CoachNow: $39.99–49.99/mo, with a $9.99/mo Analyze tier.
  - V1, Skillest, plus the free option of texting video [OBS].
- **AI phone swing apps are a commodity tier** at about $10–30/mo [OBS].
- **Parents pay for passive video:**
  - Trace PlayerFocus (soccer) was $15–35/mo per player for automatic per-player highlights, and
    regional associations are signing on in 2026.
  - GameChanger Premium, BallerTV, and sidelineHD.
  - [OBS] Parents pay readily for *exposure and memories*. They push back on paying for *practice
    tools*: the Blast paywall backlash after the WIN acquisition [OBS: app reviews].

**Implication [INF]:** the market is not empty. It is being carved up by two large consolidators.
GameChanger owns game data and video; WIN, Blast, and SmartPark own measured hitting development.
A solo founder cannot compete with either on their own job. The only workable positions are
**downstream of** GameChanger and **outside** the venue footprint SmartPark sells into.

---

## 5. Voice of the Customer

Each point is labeled by evidence strength. Paraphrased worker "quotes" are not reproduced as
quotes.

**Team coaches**
- *Outsource mechanics to private instructors* [INF: 8+ threads per AGY, plus one verbatim coach
  quote I fetched].
- *Burnout comes from parents and administration, not baseball* [INF].
- *"Stat stalking"*: parents use GameChanger batting average to argue lineups [INF: many threads].
  Any tool that hands parents more numbers can make a coach's life *worse*.
- *Distrust game swings for mechanics work*: nerves, timing, and pitch variance. They prefer
  controlled tee or soft-toss work [INF, 3+ threads]. **This directly attacks HitterLoop's founding
  premise** that "swing evaluation [should be] built around actual competitive game footage."
- *Fear "coaching the athlete out of the kid"* through metric obsession [INF].

**Parents**
- Film games themselves. Coaches don't [INF, consistent across workers].
- Some send every at-bat to the instructor [OBS, verbatim, above].
- Pay for streaming and highlights. Resent subscriptions on development hardware [OBS: Blast
  reviews].
- Experience value-for-money anxiety about $3k–$10k travel seasons and lessons [INF].
- The evidence that parents *want development proof* rather than highlights is weak [HYP]. One
  evaluator argued that showing a parent "no improvement" accelerates churn. Plausible, untested.

**Private instructors**
- Use video, sometimes heavily. Some use it lightly and say *"an experienced instructor can just
  see things quickly"* [OBS: discussfastpitch 2016].
- One instructor said they're *"not terribly interested in taking video during a lesson...
  interested in seeing video... when they are hitting in games"* [OBS, 2016, single source].
- "Client retention / proving value" as an instructor pain is asserted by workers from SaaS-vendor
  blogs [weak; HYP].
- Pushback exists against AI drafting the instructor's narrative [INF: two sources].

**Directors / organizations**
- Pain around parent conflict and playing time [INF].
- No evidence found that they buy development software [gap].

**Players**
- No usable evidence. They are not buyers.

### Complaint classification

| | Coach | Parent | Instructor |
|---|---|---|---|
| **High frequency** | Parent friction, stat arguments, admin load, scorekeeping drama | Paywalls for viewing, clip download friction, cost of everything | (unknown) |
| **High severity** | Burnout, quitting | Value-for-money anxiety, recruiting stress | Client churn in slumps [HYP] |
| **Already paid to solve** | Nothing for development; GameChanger is free to them | Lessons ($80–140/hr), streaming/highlights, sensors | Video tools ($30–50/mo), cages, HitTrax at facilities |
| **Tolerated, not paid** | Manual GameChanger scoring, no development tracking | Fence-mounted phones, manual clip forwarding | Not seeing game swings; texting video around |

The bottom-right cell is where HitterLoop's best opportunity sits, and it is a *tolerated*
problem. That is the central risk of the whole recommendation.

---

## 6. Competitive Landscape

### What customers hire each product to do (not features)

| Product | Hired by | Job | Input | Coach effort | Price | Overlap |
|---|---|---|---|---|---|---|
| GameChanger | Coach (free) / family (paid) | Run the game; follow my kid; get clips | Scorer + phone stream | Low (delegated to parents) | Free / $239–449 team pass | Owns HitterLoop's input |
| WIN SmartPark | Venue / event operator | Pro-style game data at my facility | Fixed cameras | None | $6.5k+ per field per year | Owns "automated game swing analysis" at venues |
| SwingAI (WIN) | Player / parent | Tell me what's wrong with my swing | Phone video | None | ~$15–30/mo | Direct competitor to HitterLoop's analysis |
| Blast Motion | Player / parent / instructor | Objective bat metrics | Sensor | Low | $150 + subscription | Metrics credibility benchmark |
| HitTrax / Rapsodo / TrackMan | Facility | Ball-flight numbers, entertainment, recruiting | Hardware | Low | $5k–20k+ | None directly; sets the credibility bar |
| OnForm / CoachNow / V1 | Instructor | Organize and mark up student video; communicate | Phone video | High (manual) | $10–80/mo | The instructor's existing tool |
| Mind & Muscle / Baseball AI / Dingerly / ProPlayAI | Parent / player | Cheap AI lesson substitute | Phone video | None | $0–20/mo | Commodity |
| Sportsbox AI, Uplift, Reboot | Elite / pro, golf-heavy | 3D kinematics | Phone or multi-cam | High | $15/mo – enterprise | HitterLoop's 3D is a weaker version |
| Trace / Veo / Pixellot / Hudl | Club / parent | Automatic per-player highlights / film | Dedicated camera | Low | $15–35/mo per player (Trace) | Analog for zero-touch per-player output |

### Job-based matrix: where is the white space?

Legend: ● does it well · ◐ partially · ○ no

| Job | GameChanger | SmartPark | SwingAI | OnForm / CoachNow | Blast | HitterLoop today | HitterLoop proposed |
|---|---|---|---|---|---|---|---|
| Capture game video | ● | ● (venue) | ○ | ○ | ○ | ◐ (coach films) | ○ (uses GC / parent video) |
| Score games | ● | ◐ | ○ | ○ | ○ | ◐ (duplicate) | ○ |
| Clip a player's at-bats | ● | ● | ○ | ○ | ○ | ◐ | ◐ (keep swings only) |
| Analyze swing mechanics | ○ | ● | ● | ◐ (manual) | ◐ | ● | ◐ (hidden, only to rank and flag) |
| Measure bat metrics | ○ | ● | ◐ | ○ | ● | ◐ (body-relative) | ○ (not claimed) |
| Compare swings | ○ | ? | ◐ | ● (manual) | ○ | ● | ● (automatic game vs lesson pairing) |
| Track progress | ◐ (stats) | ◐ | ◐ | ◐ | ● | ● (heavy) | ◐ (swing history only) |
| Suggest drills | ○ | ◐ (WIN tools) | ● | ○ | ◐ | ● | ○ (instructor's job) |
| Communicate to parents | ◐ | ◐ | ◐ | ● | ○ | ● | ◐ (instructor forwards) |
| Get game swings to the *private instructor* | ○ (manual forward) | ○ (venue-bound) | ○ | ◐ (parent uploads manually) | ○ | ○ | **●** |
| Connect lessons to game performance | ○ | ◐ (WIN ecosystem) | ○ | ○ | ○ | ◐ (team practice only) | **●** |

**White space [INF]:** the *private instructor ↔ game swing* link at fields without SmartPark. It
is narrow. It is real only if instructors value it (§22).

---

## 7. Jobs-to-be-Done Analysis

| Actor | Functional job | Emotional / social job | Current hire | HitterLoop fit |
|---|---|---|---|---|
| Team coach | Win games, set lineups, keep parents calm | "Don't make me the bad guy" | GameChanger, group text | **Poor.** Development tooling adds conflict surface |
| Parent | Know whether the money is working; help my kid | "Am I a good sports parent?" / pride | Lessons, GC Premium, filming | Medium: as a *forwarder*, not an analyst |
| Private instructor | Fix the swing; prove lessons work; keep clients | Professional credibility | Eye, phone video, OnForm/CoachNow, HitTrax | **Best**, if game swings matter to them |
| Facility owner | Fill cages and lessons; retain members | Premium brand | HitTrax, Rapsodo, scheduling software | Low: hardware and SmartPark own it |
| Director | Retention, reputation, playing-time defense | Avoid parent revolts | GC, TeamSnap/SportsEngine | Low; unproven |

The job HitterLoop can credibly be hired for:

> *"Show me how my student actually swings in games, compared with how they swing for me, without
> me chasing anyone for video."*

---

## 8. Current Workflow Friction

### Current workflow (from the code: `coach/atbat.html`, `queue.html`, `review.html`, `session.html`, `player.html`)

| # | Action | Who | Effort | Classification |
|---|---|---|---|---|
| 1 | Create team, roster, access code | Coach | Setup, ~15 min | Must be human (once). **Eliminate** in thesis (student = instructor's client) |
| 2 | Film each pitch / at-bat | Coach (in practice: a parent) | Every pitch | **Eliminate**: reuse GC / parent video |
| 3 | Open the at-bat and log the opponent | Coach | Per AB | **Eliminate**: duplicates GC |
| 4 | Log each pitch's outcome, optional 9-zone location, count | Coach | ~2–4 taps × ~4 pitches/AB | **Eliminate**: GC scorer already records it |
| 5 | Attach a clip per pitch / upload | Coach | Per pitch | **Automate**: share-sheet ingestion of whole AB clips |
| 6 | Wait for processing | — | Minutes | Automate (exists) |
| 7 | Open the review queue | Coach | Per session | **Eliminate** |
| 8 | Read "what I see / what to work on" per swing | Coach | ~1–2 min per swing | **Automate into a brief**; most swings never shown |
| 9 | Approve / edit / reject each AI finding | Coach | 1 decision × ~2–4 findings per swing | **Eliminate**: silence by default, surface only high-confidence differences |
| 10 | Score 11 checkpoints (1-2-3) | Coach | Up to 11 taps per player | **Eliminate** |
| 11 | Inspect metrics / 3D | Coach | Optional | **Hide** (internal ranking only) |
| 12 | Promote an issue to a priority | Coach | Per issue | **Eliminate** (instructor's head / own tools) |
| 13 | Assign drill, set follow-up | Coach | Per priority | **Eliminate** |
| 14 | Run a practice session (goal, focus, drill, rep grouping, outcome) | Coach | ~10–20 taps per session per player | **Eliminate** (lesson clips arrive the same way game clips do) |
| 15 | Compare two swings | Coach | Manual pick | **Automate**: auto-pair game swings with earlier game swings; lesson swing as video only |
| 16 | Log outcome (improving / unchanged / ...) | Coach | Per follow-up | **Eliminate**, or optional one-tap |
| 17 | Generate and share report link | Coach | Per player | Unclear: a parent-facing artifact is later scope |

**Effort estimate (current product, my derivation from the UI, [INF]).** Assume a 12-player team,
two games and one practice a week, about 3 ABs per game, and about 4 pitches per AB:

| Activity | Calculation | Actions per week |
|---|---|---|
| Pitch logging | 12 × 6 ABs × 4 pitches × ~3 actions | ~860 |
| Review | 12 × ~6 swings × ~4 decisions | ~290 |
| Practice | ~12 × 15 | ~180 |
| **Total** | | **~1,300** (roughly 2–4 hours) |

The AGY red team's lighter count was ~300 per week. **Either number is incompatible with a
volunteer.** Even a paid team coach would delegate it, and the obvious delegate (a parent) has no
authority to approve findings. This is a structural flaw, not a UX polish problem.

### Redesigned models (for the instructor thesis)

| Model | What the parent does | What the instructor does | Coach | Value | Risk |
|---|---|---|---|---|---|
| **A: Zero-touch** | Nothing (needs GC API or SmartPark-style feed) | Reads brief | — | Highest | **Not feasible**: no GC API, ToS bars automation [OBS] |
| **B: 30-second** | After a game, share 3–4 AB clips from GC or camera roll (~30–60 s) | Reads a 60-second brief before the lesson | — | High | Parent forwarding habit decays |
| **C: Exception-based** | Same as B | Gets a brief *only* when something differs from that student's baseline; otherwise a one-line "game swings consistent with lesson" | — | Highest per minute | Silence misread as health; small-sample noise |

**Recommendation:** B for the input, C for the output. **"Zero-touch" is a fantasy without a
data-source partnership.** Say so in every pitch.

---

## 9. Must-Have vs. Nice-to-Have

Must-have definition used here. All of the following must hold:

- The problem recurs at least weekly in season.
- Someone already spends money or real time on it.
- The product **replaces** an existing activity rather than adding one.
- Failing to use the product produces a cost the buyer can name.

| Test | Current HitterLoop (coach) | Instructor game-swing brief | Parent swing record | Venue game analytics |
|---|---|---|---|---|
| Frequency | Weekly in season | Weekly (lessons + games) | Weekly | Every game |
| Severity | Low for coaches | **Low–medium** [HYP] | Low–medium | Medium for venues |
| Existing spend | ~None (GC free) | Instructors pay $30–50/mo for video tools; parents pay $80–140/hr | Parents pay for highlights | Venues pay $6.5k+ (SmartPark) |
| Replacement | Adds work | Replaces parent texting clips and instructor scrubbing camera rolls | Adds to GC clips | Replaces nothing (new) |
| Workflow fit | **New** workflow | Fits an existing (manual) behavior | Partial | Venue-installed |
| Automation | Adds work | Removes scrubbing, pairing, filing | Removes nothing GC doesn't | Full |
| Actionable output | Yes, but costly | Yes ("look at X before Tuesday") | Weak | Yes |
| Switching cost | Low | **Medium**: per-student game/lesson history accumulates | Low | High (hardware) |
| Distribution | None | Parent ↔ instructor ↔ other parents | GC dominates | Enterprise sales |
| Churn resistance | None | History; seasonality hurts | Weak | Strong |
| "Hair on fire" if absent? | **Nothing happens** | **Mostly nothing**: instructor keeps guessing about games | Nothing | — (owned by WIN) |

**Verdict:** nothing passes the "hair on fire" test. The instructor brief is the only option that
passes *replacement* and *workflow fit*. It is a **strong want** at best until behavior proves
otherwise.

---

## 10. Customer / Buyer Analysis

| Segment | Pain | Frequency | WTP evidence | Authority | Athletes per customer | Retention | Sales difficulty | Verdict |
|---|---|---|---|---|---|---|---|---|
| Volunteer travel coach | Low (for development) | Weekly | None | Yes, but no budget | 12 | Seasonal | Easy to reach, impossible to monetize | **Drop as buyer** |
| Paid travel coach | Low–med | Weekly | Weak | Yes | 12 | Seasonal | Medium | Drop |
| Private instructor (independent) | Med [HYP] | Weekly | **Pays $30–50/mo for video tools** [OBS] | Yes | 20–60 active | Seasonal (winter peak) | Fragmented; reachable on Instagram [INF] | **Primary** |
| Facility / academy | Med | Daily | Pays for hardware [OBS] | Yes | 100s | Better | Harder; HitTrax/SmartPark incumbents | Later expansion |
| Travel org director | Med | Seasonal | None found | Yes | 100s | Annual | Hard | Defer |
| High school program | Med | Season | Low budgets [INF] | Coach + AD | 20–40 | Annual | Slow | Defer |
| College | Low (for phone video) | — | Buys TrackMan/Synergy | Yes | 35 | — | — | Abandon |
| Parent | Med (value anxiety) | Weekly | Pays for video and lessons, resists development subscriptions | Yes | 1–2 | Seasonal, high churn | Expensive acquisition | **Input provider + recipient, not buyer (initially)** |
| Player | — | — | None | No | 1 | — | — | User only |
| Tournament org / recruiting | Low for this | — | Pays for streams | — | — | — | — | Abandon (SmartPark / BallerTV) |

**Coach role going forward:** *entirely removed from the workflow.* The instructor is buyer, user,
and the only human judge. The parent is a forwarder and optional recipient. The product makes no
claims to the team coach.

---

## 11. Product Thesis Options

Nine genuinely different theses, each scored on the evidence above.

| # | Thesis | User / buyer | Core pain | Minimum input | Output | Why existing products fail | Primary risk | Validation test | Verdict |
|---|---|---|---|---|---|---|---|---|---|
| A | **Automated game film intelligence** | Team / venue | Nobody reviews game film | Full game video | Per-hitter insights | They don't; **SmartPark does** | WIN owns it; batter ID in full games fragile | — | **Abandon** |
| B | Player development monitoring | Coach / parent | "Is my kid improving?" | Repeated swings | Change detection | Noise floor > real change on uncalibrated monocular video [OBS: CV worker] | False change signals | Repeatability study | Defer (becomes a feature of E/H) |
| C | Coach exception engine | Team coach | Too many hitters to watch | Game clips | "3 hitters need attention" | Coaches don't do mechanics [INF] | Wrong user | 5 coach interviews | **Abandon** for team coaches |
| D | Automated parent development reports | Parent (org pays) | Value-for-money anxiety | Game + lesson clips | Monthly report | GC gives clips, not development | Parents pay for highlights, not proof; "no improvement" reports churn | Fake-door to parents | Secondary signal only |
| E | Game-to-practice transfer | Instructor | "Does my lesson show up in games?" | Lesson + game clips | Paired comparison | Nobody pairs them | Pain may be tolerated | Concierge with 5–8 instructors | **Core of primary** |
| F | Team hitting intelligence ("virtual hitting coordinator") | Small programs | No hitting coordinator | Team video | Team trends | Commodity AI + coach indifference | Same as C | — | Abandon |
| G | Player-owned swing profile | Player / parent | History lost between teams | Any clips | Portable timeline | GC loses access when you leave a team [OBS: GC worker] | B2C acquisition; weak WTP | Fake-door | Defer: natural expansion of E |
| H | **Hitting instructor game-swing brief** | Instructor | Never sees game swings; scrubs texts | Parent-forwarded AB clips | Pre-lesson brief with paired swings | OnForm/CoachNow are manual; SwingAI is player-facing; SmartPark is venue-bound | Instructors "don't usually ask" for game video | Concierge, paid | **Primary** (= E + H) |
| I | Video infrastructure / API | Platforms (OnForm, CoachNow, team apps) | They lack AI on messy game footage | Their video | Swing segments + pose | They'd build or buy SwingAI | Solo-founder enterprise sales | 3 partner conversations | **Secondary / fallback** |
| J | Instructor lesson recap and retention (Greenfield worker's pick) | Instructor | Proving value to parents | Lesson clips | Branded recap | Crowded (OnForm, CoachNow, HitTrax reports); "texting a video" is free | Commodity; AI narration resented | Wizard-of-Oz | Evaluated 3/10; fold the useful part into H |

---

## 12. Strongest Market Wedge

> **The smallest problem HitterLoop could completely own: getting a private hitting student's
> game swings in front of their instructor, automatically paired with that student's lesson swings,
> before the next lesson.**

Why this wedge:

- **Existing behavior:** parents already carry clips to instructors [OBS].
- **Uses an input that already exists:** GameChanger per-AB clips, filmed from behind the plate,
  and parent phone video [OBS].
- **Matches what the pipeline was built and tested on:** one at-bat clip from behind the backstop,
  batter chosen by bat-holding [OBS: repo].
- **Not owned by the consolidators:**
  - GameChanger doesn't analyze swings or route to instructors.
  - SmartPark is venue-bound and team/venue-paid.
  - SwingAI is player-facing cage analysis.
- **Creates proprietary data:** a per-student game-swing history, with lesson swings alongside.
  Nobody else holds that pairing.
- **Hard for a generic LLM wrapper:** it needs CV to find swings inside messy game clips and to
  pair them by phase. Text generation is the easy part.

Why it might still be wrong is covered in §13 (red team) and §25.

---

## 13. Recommended Product Thesis

### Thesis as first proposed (before the red team)

> HitterLoop is the game-swing feed for private hitting instructors. Parents share the at-bat clips
> they already have. HitterLoop keeps the swings and pairs each one with the student's recent
> lesson swing. It sends the instructor a short pre-lesson brief with 1–2 "this looks different"
> notes when confident. The instructor pays $25–50/mo.

### Adversarial red team (AGY worker 12, told to prove it wrong). My evaluation of each point:

| Red-team argument | My evaluation | Effect on thesis |
|---|---|---|
| **GameChanger clip supply is brittle.** Clips need streaming *and* scoring. Late or "assign later" scoring loses a player's clip. Clips are downloaded one at a time | **Valid in substance** [OBS: streamed+scored requirement]. The specific scorer-delay detail is unverified | Keep both input paths (GC + phone). Experiment #3 measures clip availability before anything is built |
| **Behind-plate pose estimation breaks in the wild.** Catcher, umpire, fence, 30 fps blur. "Tested on a single clean clip" | Overstated: it was four real behind-backstop game clips, not one clean one. **But the core point stands: n=4 is not validation** | Experiment #4 (repeatability) becomes a hard gate |
| **Instructors use game video for timing and approach, not mechanics. Cage-angle vs. game-angle comparison is invalid (parallax, camera height)** | **Correct, and it changes the product.** The CV worker independently rated cross-setup comparison "possible but fragile". The live product page already admits angles shift with camera position | **Revised:** no metric comparisons across camera setups. Lesson ↔ game pairing is *video for the instructor's eye only*. Machine notes only compare game ↔ previous games (same setup class), and only if #4 passes |
| **Free substitutes:** parents text the GC clip; the instructor follows the team on GameChanger | **Valid**, and it's the main reason WTP is uncertain | The paid value must be "swings only, all students, organized, paired, before the lesson". If concierge instructors won't pay for that, stop |
| **Competitors:** OnForm, CoachNow Spaces (parents upload game clips; AI skeleton; Versus mode), SwingAI, Skillest | **Largely valid.** CoachNow/OnForm are the instructor's existing home, and parents *can* already upload there. Their gap is automatic swing extraction from messy game clips and automatic pairing [INF] | Promotes thesis I (plug-in / API into these platforms) to **secondary** and runs it in parallel |
| **Market size:** ~$4.5–15M TAM; high CAC across fragmented instructors | Consistent with my independent estimate (§19) | Confirms "small business, not venture" unless the secondary unlocks distribution |
| **"Pivot to B2C parents"** | Partly rejected. Parent WTP is for highlights and exposure, not development tools [OBS: Blast backlash; GC/Trace spend], and B2C acquisition/seasonality is brutal. **But who pays is genuinely unresolved** | The concierge test charges *both* ways: instructor subscription vs. parent pass-through (#5, #6) |

### Revised primary thesis (survives the red team, with narrower claims)

> **HitterLoop turns the game clips parents already have into a pre-lesson "game swing brief" for
> the student's private hitting instructor.**
>
> - It keeps only the swings and organizes them by student.
> - It shows them next to the student's previous game swings and latest lesson swing, as video for
>   the instructor's eye.
> - It adds at most one or two observations about *game-to-game* change, and only where
>   measurement is proven repeatable. Otherwise it says nothing.
>
> No team coach, no approvals, no 3D, no cross-camera metric claims. Payer to be decided by
> experiment: instructor subscription or parent pass-through.

**Why it's still the primary.** It has more going for it than any alternative found:

- It is the only option with *existing behavior*: parents already carry clips to instructors.
- Its inputs come from workflows that already happen: GameChanger clips and parent phones.
- It sits in a gap the consolidators don't serve: the instructor relationship, at fields without
  SmartPark.
- It uses what HitterLoop's pipeline was actually built for: single at-bat clips from behind the
  backstop.

**Why it may still fail [stated plainly].**
- "He doesn't usually ask for them" is the most important sentence in this report. The pull from
  instructors may be politeness, not need.
- The free substitute (texting clips) is good enough for most people.

### Secondary thesis

> **License the game-clip swing extraction (find the batter, keep the swings, phase-sync them) as
> a plug-in or API for the instructor video platforms (CoachNow, OnForm, V1, Skillest) or for
> team-video platforms.**

- **Evidence for:** those platforms already hold the instructor relationship and the parent upload
  flow [OBS], and they are manual [OBS].
- **Evidence against:** they may build or buy SwingAI-style analysis. Enterprise sales are hard for
  a solo founder.
- Run 3 partner conversations in the first 45 days, in parallel. Their reaction is itself evidence
  about whether "automatic game-swing extraction" is valued.

### Theses to abandon

1. **The current product: a coach-led player-development operating system for travel teams.**
   - It looks attractive because it is complete, principled, and demoable.
   - It is strategically weak because the user doesn't do this job, won't do the data entry, and
     isn't the buyer.
2. **Automated game-film intelligence for teams and venues.**
   - It looks attractive because it is the biggest vision and the best demo.
   - It is weak because WIN Reality's SmartPark (venue cameras, Blast and SwingAI integration,
     2,500+ committed fields) and GameChanger already occupy it with capital and distribution a
     solo founder can't match.

---

## 14. Redesigned User Experience

Written from the instructor's perspective (the buyer), with the parent's 30 seconds shown.

**Saturday–Sunday (tournament).**
- Nobody does anything in HitterLoop.
- The team's GameChanger streamer and scorer do what they already do, and GameChanger cuts a clip
  for every at-bat.
- Or a parent films at-bats on their phone, as they already do.

**Sunday night: the parent (≈30–60 seconds, once per weekend).**
- In GameChanger, open the player → Video Clips → share each at-bat clip to HitterLoop.
- Or select the camera-roll clips and share them.
- No form, no tagging. The share target is already bound to one student.
- Taps: about 3 per clip, roughly 10–15 total. Decisions: 0.

**Sunday night: HitterLoop (automatic).**
- For each clip, decide swing vs. take/no-swing. Takes are discarded silently.
- For each swing:
  - Find the swing window and contact estimate.
  - Find the phase-matched frame pairs against the student's previous *game* swings (same setup
    class). The latest lesson swing is attached as video only.
  - Compute two or three robust body-relative comparisons, with confidence.
- Write *at most two* game-to-game notes, and only for measures that passed the repeatability
  study and only above a confidence threshold. Otherwise
  write nothing.
- Low-quality clips are labeled "couldn't read this one". They are never guessed.

**Monday or the morning of the lesson: the instructor (≈60 seconds per student).** They receive an
email or text, not an app session:

> **Emma R. (fictional example) · lesson Tuesday 5:00**
> 4 game swings this weekend (2 takes skipped, 1 clip unreadable).
> ▶ Game swings, side by side with the last tournament's game swings (same angle), synced at
> foot plant.
> ▶ Your last cage swing alongside, *video only: different camera, so no measurements compared*.
> • Compared with her previous 2 tournaments: foot plant to contact is consistently quicker (4 of 4
> swings). *Shown only if the repeatability study passed for this measure.*
> *Nothing else stood out.*
> [Open all 4 swings]

- Taps: 1–2. Screens: 1 (a web page). Decisions: 0 required.
- Optional: one tap on 👍 / 👎 per note. That is implicit tuning, not approval.

**Tuesday lesson.**
- The instructor films a few swings as they already do, or the parent shares them the same way.
- Those become the new lesson baseline. Nothing else.

**Compared with today**

| | Current HitterLoop (coach, per player per week) | Proposed (instructor, per student per week) |
|---|---|---|
| Human actions | ~100 (coach) | ~12 (parent) + ~2 (instructor) |
| Screens | 6–8 pages | 1 web page + share sheet |
| Minutes | ~10–20 | ~1 parent + ~1 instructor |
| Required decisions | ~25 | **0** |

---

## 15. Feature Autopsy

| Feature | Problem solved | Real frequency | Effort | User value | Differentiation | **Verdict** |
|---|---|---|---|---|---|---|
| Video upload (GCS signed URL, queue) | Get video in | Every clip | Low | Required | None | **Keep**, adapt to share-sheet / email-in |
| 2D pose + bat tracking + batter selection | Find the hitter in messy game clips | Every clip | None | Core (hidden) | **Yes**, for game footage | **Keep** |
| Audio bat-crack swing locator | Find swings in long clips | Long clips | None | Medium | Some | **Keep** |
| Swing vs. take classification | Discard non-swings | Every clip | None | Core | Some | **Build / harden** (currently weak) |
| Contact-frame inference | Phase-sync comparisons | Every swing | None | Core (hidden) | Some | **Keep** |
| VideoPose3D lift | 3D model | Every swing | None | Low | Weak (2019 model; others do better) | **Remove from critical path**; keep offline |
| 3D avatar viewer (Three.js, FBX retarget) | "Look from any angle" | Rarely | Medium | Demo value | Low | **Kill from product** (keep for demo) |
| Corrected / ideal swing visualization | "Show the fix" | — | — | Speculative | — | **Kill** |
| Body-relative metrics | Quantify change | Every swing | None | Medium if hidden, low if shown | Low | **Simplify**: 2–3 robust ones, internal |
| Gemini findings (per-swing drafts) | Explain the swing | Every swing | High (needs approval) | Negative (creates work) | None | **Kill** as drafts → replace with ≤2 thresholded difference notes |
| Coach review queue / approve-edit-reject | AI governance | Constant | **Very high** | Negative | None | **Kill** |
| 11-checkpoint checklist and scoring | Structured eval | Constant | High | Low | None | **Kill** |
| Priorities / drills / follow-ups / outcomes | Case management | Weekly | High | Medium for pros | None (instructors have their own method) | **Kill** (defer; instructors may want a single "focus" note later) |
| Pitch-by-pitch at-bat logging, 9-zone picker | Context | Every pitch | **Very high** | Low | Duplicates GC | **Kill** |
| Practice session logging (rep groups) | Practice structure | Weekly | High | Low | None | **Kill** → lesson clips just arrive |
| Compare (Video / Frames / Progress / Metrics / 3D) | Side by side | Weekly | Medium | **High** | Moderate | **Simplify + automate**: auto-paired, phase-synced, video only |
| Game vs. practice separation | Data integrity | — | None | High | Some | **Keep** (it is the product now) |
| Development timeline / metric trends | Longitudinal | Monthly | Low | Medium | Low | **Hide** until the repeatability study passes |
| Team dashboard / roster filters / team focus areas | Team management | — | Medium | Low | None | **Kill** |
| Parent report link (90-day) | Parent communication | Monthly | Low | Medium | Low | **Defer** (instructor forwards the brief instead) |
| Guardian accounts / family page / consent | Minors' data governance | — | — | **Required** for parent-uploaded minors' video | — | **Simplify + keep** (consent at share time) |
| Methodology knowledge system + admin UI | Governed coaching claims | — | — | None for this thesis | — | **Freeze** |
| Public demo pipeline / fixtures | Portfolio / marketing | — | — | Marketing | — | **Freeze**; replace with one concierge-generated brief as the demo |
| Android shell (Capacitor) / PWA | Field capture | — | — | Low (no field capture now) | — | **Defer** (web + share-target + email suffice) |
| Supabase + RLS | Multi-tenant data | — | — | Infrastructure | — | **Keep** |

---

## 16. Stop / Finish / Defer / Build

### STOP (now)
- All coach-facing work in `coach/`: queue, review, checklist, priorities, drills, session logging,
  at-bat pitch logging, and the team dashboard.
- 3D: camera calibration, angle normalization, the corrected-swing visualization, avatar
  retargeting.
- The methodology knowledge system and its admin UI.
- Demo fixture lifecycle work and its privacy-treatment pipeline. The existing demo stays as it is.
- Phase B "self-coached parents".
- The iOS build and Capacitor polish.
- Production deployment of the current app.

### FINISH (only what the test needs, or what's unsafe to leave)
- The privacy holes already flagged. Do these *before any real family's video enters a new flow*:
  - the token report returns the player's stored name and team name
    (`supabase/functions/_shared/familyReport.ts:92`; flagged in `docs/review/REVIEW.md`);
  - most deletes bypass `delete-clip` (`NEXT_STEPS.md`).
  - Don't ship anything new on top of them.
- Run the existing pipeline on a **repeatability set**: 10 players × 5 clips each, from GameChanger
  and parent phones. Measure:
  - batter-selection accuracy;
  - swing/take accuracy;
  - contact estimate;
  - within-player variance of the 2–3 metrics you'd use.
  - This is the single most important engineering task. It decides whether "looks different" notes
    can exist at all.

### DEFER
- Parent-facing reports.
- Player-owned profile.
- Facility and organization plans.
- Automated drills.
- Longitudinal trend charts.
- Native apps.
- Any GameChanger "integration" beyond the share sheet.
- Billing automation (invoice manually).

### BUILD (only after the concierge test passes)
1. Ingestion:
   - a share-target / email-in / upload-link per student;
   - one link per student per instructor;
   - consent captured at first share.
2. Swing vs. take filter on AB clips, with an honest "couldn't read" bucket.
3. Auto-pairing of game swings with previous game swings, phase-synced at foot plant or contact,
   plus the latest lesson swing alongside as video only. No cross-setup metrics.
4. A thresholded difference note generator: at most 2 notes, silent below the confidence floor.
   Template-driven first; an LLM only for phrasing.
5. A pre-lesson brief delivered as email or SMS with a single web page per student.
6. An instructor roster page: students, share links, lesson day.

---

## 17. New MVP Specification

**Inputs**
- *Parent:* at-bat clips shared from GameChanger or the camera roll to a per-student link.
- *Instructor:* lesson clips, shared the same way, plus the student's lesson day, entered once.

**Automated processing**
- Batter detection and selection. Swing vs. no-swing. Contact and foot-plant estimate.
- Quality gate. Pairing with previous game swings, with the lesson swing attached as video only.
- 2–3 robust within-player comparisons, for example stride ratio and timing of foot-plant to
  contact, chosen *after* the repeatability study.
- Thresholded notes.

**Outputs**
- A pre-lesson brief per student: swings, the paired comparison video, and up to 2 notes or
  "nothing stood out".
- A per-student swing archive, split game | lesson.

**Human interaction**
- Parent: forward clips (~1 min per weekend).
- Instructor: read the brief (~1 min). Optional 👍 / 👎.
- **No approvals.**

**Screens**
1. Instructor: student list with each student's share link.
2. Student brief page (web).
3. Parent: share/upload confirmation, with the consent screen the first time only.

That's it.

**Notifications**
- One brief per student, sent the evening before the lesson.
- Nothing otherwise.

**Data model:** Instructor, Student, Guardian (consent), Clip (source: game | lesson; origin: GC |
phone), Swing (derived; quality; phases), Pairing, Note (confidence, feedback), Brief.

**Integrations:** none. Email/SMS provider only. GameChanger is reached through the user's own
share action, not an integration.

**Explicitly excluded:**
- Team coaches, rosters, games, pitch logging, scoring.
- 3D viewer, metrics dashboards, trend charts, checklists, priorities, drills, approval queues,
  AI narratives.
- Parent reports, native apps, recruiting features, billing system.

---

## 18. Pricing / Business Model

Comparables [OBS]:
- OnForm $29–79/mo; CoachNow $39.99–49.99/mo (Analyze $9.99).
- SwingAI ~$15–30/mo.
- Blast subscription ~$50–100/yr on a $150 sensor.
- Trace PlayerFocus $15–35/mo per player.
- GameChanger Team Pass $239–449 per season.
- Lessons $80–140/hr.

| Model | Price | Logic | Risk |
|---|---|---|---|
| **Instructor subscription (primary)** | **$29–49/mo**, or ~$249/yr | Below the cost of one lesson per month; sits next to OnForm/CoachNow rather than replacing it | Seasonality: winter lesson peak, summer game peak. Note that the *product* peaks when games happen, which is when lessons slow down |
| Per-student pass-through | $5–8 per student per month, billed to the parent via the instructor | Scales with roster; matches "parents pay for video" behavior | Instructors dislike adding charges to clients [HYP] |
| Facility plan | $150–400/mo | Many instructors under one roof | Competes with HitTrax/SmartPark budgets |
| API / licensing (fallback) | Per processed clip, or rev-share | Platforms with footage and distribution | Long sales cycles for a solo founder |

**Economic buyer:** the instructor. **The parent pays indirectly** through lesson fees, which is
the actual flow of money.

**Do not** charge volunteer coaches. **Do not** launch B2C.

---

## 19. Bottom-Up Market Size

All figures are assumption chains, [HYP] unless cited.

| Step | Figure | Basis |
|---|---|---|
| Baseball participants, ages 6–17 | ~8.5M | [OBS, MLB/Aspen] |
| Plus fastpitch softball, ages 6–17 | +~2–3M | [HYP; no clean source found] |
| Core / serious players (13+ days/yr) | ~45–50% | [OBS: baseball core share 48.9%, all ages] |
| Players in regular private hitting lessons (≥ ~2/month in season) | 3–8% of ~10.5–11.5M youth players → **~300k–900k** | [HYP]; this is the number that most needs real data |
| Active students per independent instructor | 25–60 | [HYP] |
| Implied instructors | **~5k–36k** | Derived (300k÷60 to 900k÷25); the true count is unknown (no source found) |
| Of those, independent and tech-using enough to adopt | 30–50% | [HYP] |
| Reachable instructors | **~1.5k–18k** | Derived |
| ACV | ~$300–500 | From §18 |
| **Initial niche SAM** | **~$0.5M–9M ARR** | Derived (1.5k × $300 to 18k × $500) |

- **Adjacent expansion (per-student parent pass-through):** 300k–900k students × ~$50/yr ×
  10–30% penetration → **~$1.5M–13.5M**.
- **Long-term (facilities and orgs; player-owned profile):**
  - D-BAT alone has about 153–170 locations [OBS, FDD/listing data].
  - Indoor facilities are claimed at around 3,400 [single-source, unverified].
  - At $2–5k per facility per year, that adds **~$7M–17M** at full penetration (realistically a
    fraction of that) if HitTrax/SmartPark don't own the budget.

**Honest read [INF]:** the wedge is a **single-digit-millions ARR ceiling business** unless the
player-owned profile or a platform licensing deal unlocks a much larger channel. That is a fine
solo or small-team software business. It is not, on this evidence, a venture-scale company.

---

## 20. Defensibility

| Source | Real / potential / fake | Why |
|---|---|---|
| Paired game ↔ lesson swing history per student | **Potential → real** after ~1 season | Nobody else holds the pairing. Switching loses the history. Grows with every forward |
| Messy-game-clip processing (behind-backstop youth footage, batter-by-bat-holding, audio locator) | **Potential** (time-limited) | Real engineering, but SwingAI/WIN/GC could match it in months if they cared |
| Instructor ↔ parent network (every student's parents receive or forward) | **Potential** (distribution, not a moat) | Each instructor exposes 25–60 families |
| Implicit 👍 / 👎 feedback on difference notes | Potential, slow | Small volumes; years to matter |
| Player-specific baselines | Potential | Depends on the noise floor (§16 Finish) |
| 3D reconstruction | **Fake** | 2019 public model; others have better |
| "AI findings" / Gemini | **Fake** | Commodity |
| Methodology knowledge base | Fake (for this thesis) | Not what anyone pays for |
| Coach approvals as a "labeled dataset" | Fake | Volumes far too small; users won't produce them |

---

## 21. Customer Discovery Program

### Populations and sample sizes
| Population | n | Why |
|---|---|---|
| Independent hitting instructors (baseball and softball, mixed age bands) | **12–15** | Primary buyer |
| Parents of kids in regular private lessons | **12–15** | Input provider; the forwarding habit is the crux |
| Facility owners / lead instructors at multi-instructor facilities | 4–5 | Expansion and veto risk |
| Travel coaches (volunteer and paid) | 5–6 | *To confirm they should be dropped* |
| GameChanger-heavy team "video parents" (the streamer) | 4–5 | Clip availability and sharing behavior |

### Recruiting
- Instructors: Instagram and TikTok (they post student swings), CoachUp / Athletes Untapped
  listings, D-BAT and local facility staff pages. Offer a $50 gift card or a free concierge month.
- Parents: through recruited instructors, the existing team's parent network, local travel orgs' Facebook
  groups, and discussfastpitch / HSBaseballWeb (post as a researcher, not a vendor).
- Coaches: the existing team relationship plus 4–5 cold contacts.

### Interview script: instructors (behavioral, non-leading)
1. Walk me through your last week of lessons. What happened before, during, and after each one?
2. When did you last see one of your students hit in a real game? How did that come about?
3. Tell me about the last time a parent sent you game video. What did you do with it? How long did
   it take? What did you wish was different?
4. Tell me about a student whose lesson swing didn't show up in games. How did you find out? What
   did you change?
5. How do you currently record or keep student video? Where does it live? What do you pay for?
6. What have you stopped doing because it was too much work?
7. When did a parent last question whether lessons were working? What happened?
8. What tools have you tried and dropped in the last two years? Why?
9. When are your busiest and slowest months?

**Invalidation probes (ask directly):**
- "Some instructors say game swings are too noisy to coach from. Where do you land, and why?"
- "If a parent sent you every game at-bat automatically, what would you actually do differently on
  Tuesday?" If the answer is "nothing" or "I'd watch a couple", the thesis is weak for that
  instructor.
- "What would make you *not* want to see game video?"
- "What do you pay for monthly today? What did you cancel?"

### Interview script: parents
1. Walk me through what happens after a weekend tournament for your child.
2. What happens to the video of your child's at-bats? Who films? Where does it go?
3. When did you last send video to anyone? Who, why, and how?
4. How do you know whether lessons are working? When did that question last come up?
5. What do you pay for around baseball/softball apps and video? What did you cancel and why?
6. **Invalidation:** "If you had to forward each at-bat after every weekend, how many weekends would
   you keep doing it?" Then compare with what they did last month, not what they predict.

### Interview script: coaches (to confirm the drop)
1. Walk me through what happens after a tournament when you want to assess how hitters performed.
2. What do you do with game video?
3. Tell me about the last time you changed something in a player's swing. How did you know whether
   it carried into games?
4. Who handles hitting mechanics for your players? How do you feel about private instructors'
   input?
5. **Invalidation of the drop:** "If you had a 5-minute weekly summary of your hitters' swings, what
   would you do with it?" (A specific, behavior-changing answer from 3+ coaches would reopen
   thesis C.)

**Analysis rule:** count *past behaviors and money spent*, never stated intent.

---

## 22. Validation Experiments (before more software)

| # | Experiment | Hypothesis | Users / n | Setup and input | Output | Success | Failure | Decision informed |
|---|---|---|---|---|---|---|---|---|
| 1 | **Concierge game-swing brief** | Instructors value pre-lesson paired game swings enough to pay | 6–8 instructors × 3–5 students each | Parents text or share AB clips to a number or email; Jon runs the existing pipeline by hand and edits the side-by-side (no new code) | Brief emailed the night before each lesson, for 4–6 weeks | ≥50% of instructors open ≥80% of briefs; ≥3 cite a specific lesson change; **≥3 pay $29+ for month 2** | <2 pay, or "nice but I didn't use it" | Go / no-go on the primary thesis |
| 2 | **Parent forwarding decay** | Parents forward clips without reminders | The parents in #1 (~25–40) | No reminders after week 1 | Weekly forward rate | ≥60% still forwarding in week 4 without nudges | <35% | Whether input is viable without the zero-touch fantasy |
| 3 | **GC clip availability audit** | Most travel games are streamed and scored, so clips exist | 10 local travel teams across 3 age bands | Check team GameChanger pages | % of games with AB clips | ≥50% | <25% → phone-video input dominates, and friction rises | Input strategy |
| 4 | **Repeatability study** (engineering, ~1 week) | 2–3 metrics are stable within a player, enough to flag real differences | 10 players × 5 swings, same and different cameras | Existing pipeline | Within-player CV vs. between-condition difference; swing/take accuracy; batter selection accuracy | Batter selection ≥95%, swing/take ≥90%; ≥2 metrics with within-player noise < plausible change | Otherwise: notes off, ship video pairing only | Whether notes exist at all |
| 5 | **Price test** | Instructors will pay $29–49/mo | Instructors from #1 plus 10 cold | Two-tier offer page after a sample brief | Paid conversions | ≥20% of qualified prospects pay | <5% | Pricing, and the per-student pass-through alternative |
| 6 | **Parent-pay variant (fake door)** | Parents pay $5–8/mo for the same brief to their instructor | 30–50 parents via instructors | Landing page with a "send my game swings to my instructor" offer | Pre-orders | ≥10% pre-order | <3% | Secondary thesis (who pays) |
| 7 | **Coach drop confirmation** | Team coaches won't use even a 5-minute digest | 5 coaches | Hand-made "3 hitters to watch" digest after 2 games | Replies, actions | Any coach takes a specific action twice → reopen | (expected) | Formally closing thesis C |

Experiments 1–4 cost about 6 weeks of Jon's time and $0–300. They need **no new production code**.

---

## 23. 30-Day Product Reset Plan

**Week 1**
- Freeze `coach/` and `mobile/` feature work.
- Fix the two privacy issues.
- Tag the current state (`v0.30-freeze`).
- Write the consent text for parent-shared clips.
- Recruit 6–8 instructors (§21).
- Start the GC clip availability audit (#3).

**Week 2**
- Run instructor and parent interviews (target 10 instructors, 8 parents).
- Run the repeatability study (#4) on existing clips plus 2–3 newly collected GC clips.

**Week 3**
- Start the concierge brief (#1): first briefs to the first 3 instructors.
- Set up the forwarding-decay measurement (#2).
- Run the coach digest (#7) with the existing team.

**Week 4**
- Concierge briefs at full cohort.
- Mid-point readout: open rates, forward rates, verbatim instructor reactions.
- Decide which 2–3 metrics (if any) are allowed to produce notes.

**Output at day 30:** a 1-page evidence memo. No new product code except scripts that make the
concierge faster.

## 24. 90-Day Validation Roadmap

| Days | Goal | Gate |
|---|---|---|
| 31–45 | Finish concierge cohort 1; ask for payment for month 2 | **Gate 1:** ≥3 instructors pay, and ≥60% parents still forwarding at week 4 |
| 46–60 | If Gate 1 passes: build the MVP (§17) on the existing pipeline, ~3 weeks. If it fails: run the parent-pay fake door (#6) and 3 platform conversations (thesis I) | **Gate 2:** MVP delivers briefs with <10% manual fixes |
| 61–90 | Cohort 2: 15–25 paying instructors via Instagram outreach plus referrals from cohort 1 | **Gate 3:** ≥70% month-2 retention, and ≥1 unprompted referral per 5 instructors |
| Day 90 | Decide: scale, pivot to licensing, or stop | Kill criteria in "Brutal version" Q10 |

---

## 25. Key Unknowns

### Assumption register

| Assumption | For | Against | Confidence | Validation |
|---|---|---|---|---|
| Coaches care about longitudinal swing mechanics | Some forum interest in development | They outsource mechanics; avoid "too many voices"; distrust game swings | **Low** | #7 |
| Coaches will upload video | — | Parents film; coaches manage the game | **Very low** | Already settled by evidence; drop |
| Parents will forward clips weekly | Some already do, unasked [OBS] | Upload friction; habit decay; one source | Low–medium | #2 |
| GameChanger footage is accessible | Per-AB clips are shareable [OBS] | No API; ToS bans automation; needs streamed + scored games | Medium (manual) / zero (automated) | #3 |
| Automated batter identification is reliable enough | Bat-holding heuristic works on 4 clips [OBS] | Full-game ID is fragile; occlusion | Medium for single-AB clips; low for full games | #4 |
| Swing vs. take can be classified on AB clips | Bat-speed and motion signals exist | Audio only catches contact; whiffs and checks are hard | **Low–medium** | #4 |
| Instructors want game video | 2016 instructor quote; parents send it [OBS] | "He doesn't usually ask for them" [OBS]; "game swings misleading" [INF] | **Low–medium** | #1 |
| Instructors will pay | They pay for OnForm/CoachNow [OBS] | Crowded; seasonal; fragmented | Low–medium | #1, #5 |
| Parents care about development reports | Value anxiety [INF] | Pay for highlights, not proof; Blast backlash | Low | #6 |
| Organizations will pay | — | No evidence found | Very low | Defer |
| Game/practice comparison changes coaching decisions | Logical for instructors | Untested anywhere | **Unknown** | #1 ("what did you change?") |
| Coaches/instructors want AI recommendations | Commodity AI apps sell to players | Pushback on AI narrating the expert's view | Low (as drafts) | #1 👍/👎 data |
| Users will trust automated findings | — | Uncalibrated angles visibly wrong at times [OBS: live page] | Low unless thresholded hard | #4 + #1 |
| GameChanger / WIN won't build this | GC's AI goes to streaming and highlights; WIN is venue-centric | Both could ship it quickly | Medium–low | Watch; speed |

### Strategic uncertainties (where agents disagreed)

1. **Is "coach-in-the-loop" an asset or a liability?**
   - The competitive worker called it "the perfect middle ground". The red team called it "coaches
     doing homework".
   - *Resolution:* they're talking about different humans. For a paid instructor, judgment is the
     job, but even then *approval* is the wrong interaction. For a volunteer team coach it is a
     liability.
   - *Remaining uncertainty:* whether instructors want *any* machine-written notes, or only the
     paired video. Experiment #1 collects 👍/👎.
2. **Is behind-the-backstop game video usable for pose estimation?**
   - The GameChanger worker said standard models "will likely fail" because of fence, umpire,
     catcher, and 480–720p.
   - The repo shows the pipeline producing usable output on real behind-backstop 10U game clips,
     but only four of them were validated.
   - *Neither side has a large sample.* Experiment #4 decides it.
3. **Does a GameChanger clip exist for most games?**
   - It depends on someone streaming *and* scoring. Unknown share. Experiment #3.
4. **Instructor pain: real or tolerated?**
   - The evaluators split: B scored 3/10 citing real retention pain; A scored 2/10 citing feasibility.
   - The evidence of instructor pain comes from SaaS-vendor blogs [weak]. Only paid concierge
     behavior resolves it.
5. **Venture vs. small business.**
   - The Greenfield worker said "8/10 viable small SaaS, 4/10 venture". My sizing (§19) agrees.
   - This is a founder-goal question, not a research question.

---

## 26. Final Strategic Conclusion

- HitterLoop's engineering is genuinely good. Its product thesis was built around the wrong person
  (the volunteer team coach) and the wrong interaction (approving AI findings).
- Meanwhile the market moved:
  - AI swing analysis became a commodity;
  - WIN Reality assembled sensor, VR, phone-AI, and venue-camera game analysis into one stack;
  - GameChanger made per-at-bat game clips standard.
- What's left for a solo founder is a narrow, real, *tolerated* gap: the private instructor
  doesn't see game swings, and the parent is already the courier.
- HitterLoop's existing pipeline was, almost by accident, built for exactly the clips that flow
  through that gap.
- The right move is not to build that product. It is to **prove, by hand and for money, that
  instructors will pay for it and parents will keep feeding it**, then build only the thin layer
  that removes the manual work.
- If the concierge test fails, the honest options are:
  - license the game-clip processing to a platform that already has the footage and distribution;
  - or stop, and keep HitterLoop as the excellent portfolio project it already is.

---

# "What HitterLoop Is Now"

**Customer.** Private baseball and softball hitting instructors, and the parents who already film
their students' games.

**Pain.** Instructors teach a swing in the cage and almost never see whether it shows up in games.
Today a parent sometimes texts a pile of at-bat clips, and the instructor has to find the swings,
remember last week's lesson, and compare by eye.

**Promise.** Before each lesson, the instructor gets that student's game swings from the weekend,
each placed beside their earlier game swings and the latest lesson swing, with at most two plain
notes on what changed since earlier games (never measured across different cameras). When nothing
stands out, it says so.

**Input.** Parents share the at-bat clips they already have (GameChanger or phone) to the student's
HitterLoop link. Instructors share a few lesson clips the same way.

**Output.** One short pre-lesson brief per student, by email or text, plus a growing game-vs-lesson
swing history.

**Human effort.** Parent: about 1 minute per weekend. Instructor: about 1 minute per student
before a lesson. No logging, no tagging, no approvals.

**Why it wins.**
- GameChanger clips at-bats but doesn't analyze swings or send them to instructors.
- SwingAI and its peers analyze cage swings for players, not game swings for instructors.
- SmartPark only covers fields that bought cameras.
- OnForm and CoachNow make the instructor do all the work.

**Product boundary.** No team coaches, scoring, pitch logging, drills, priorities, checklists,
approval queues, 3D models, metric dashboards, recruiting, or "AI coach" advice. It never claims
mph, inches, or degrees.

**MVP.** A per-student share link, automatic swing filtering, automatic pairing with earlier game
swings (the lesson swing shown as video only), a note generator gated by the repeatability study,
and an emailed brief. First delivered by hand
(concierge) to 6–8 instructors.

**Success signal.**
- Instructors pay for a second month without being chased.
- Parents keep forwarding clips in week 4 without reminders.
- Instructors can name a specific lesson change the brief caused.

---

# "If I Were Starting HitterLoop From Scratch Today"

1. **Would you build this company at all?**
   - Not as a venture-backed company on today's evidence. The consolidators (WIN Reality and
     GameChanger) own the big jobs, and the open gap is narrow and tolerated rather than painful.
   - I would spend 6 weeks and under $500 testing whether a small instructor-paid business exists,
     because the existing pipeline makes the test unusually cheap.
2. **Which customer?** Independent private hitting instructors with 20+ active youth students,
   reached through Instagram, in one or two regions you can drive to.
3. **Which single problem?** "I never see my students' game swings next to their lesson swings."
4. **What would the product do?** Turn parent-forwarded at-bat clips into a pre-lesson,
   phase-synced game-swing brief. Earlier game swings and the latest lesson swing go alongside as
   video. Notes are added only where game-to-game measurement has been proven repeatable.
5. **What would it explicitly not do?**
   - Team management, scoring, drills, development plans, approval queues, 3D, metrics dashboards,
     parent apps, recruiting.
   - Any claim in physical units.
6. **What would happen automatically?** Swing filtering, batter selection, contact and phase
   detection, pairing, difference detection, brief delivery.
7. **What would require human input?** Parents forwarding clips. Instructors judging what to do
   about it, which is their actual job.
8. **What would the first version contain?** A share link, a processing script, a brief template,
   and an email sender. At first, much of it would be Jon by hand.
9. **What would you test before more production code?** Experiments 1–4 in §22: concierge briefs
   with payment, the parent forwarding decay rate, GameChanger clip availability, and pipeline
   repeatability on real game clips.
10. **What evidence would make you abandon it?** Any of these:
    - fewer than 3 of 8 instructors pay for month 2;
    - under 35% of parents still forwarding by week 4;
    - batter/swing filtering under ~90% on real GameChanger clips;
    - instructors consistently saying game swings don't change what they teach.
11. **What evidence would make you double down?**
    - Instructors pay *and* refer other instructors unprompted.
    - Parents forward without reminders.
    - Instructors cite specific lesson changes driven by briefs.
    - At least one facility asks for a multi-instructor plan.

> **HitterLoop becomes indispensable when** a hitting instructor walks into every lesson having
> already seen that student's latest game swings beside their cage swings, and knowing whether
> anything changed since earlier games, and the only thing anyone did was forward clips they already had.

---

# Appendix: Specific Questions From the Brief

### A. Value delivered per minute of human effort (brief §3)

| Workflow | Actions/wk | Minutes/wk | Frequency | Cognitive load | Setup | Ongoing admin | Value | **Value per minute** |
|---|---|---|---|---|---|---|---|---|
| Current HitterLoop, team coach (12 players) | ~1,300 | 120–240 | Every game and practice | High (judging AI drafts) | Team, roster, access code | Pitch logging, queue, priorities | Medium (if used) | **Very low** |
| Current HitterLoop, review only (logging delegated) | ~290 | 30–60 | Weekly | High | Same | Queue | Medium | Low |
| Proposed, parent | ~12 | ~1 | Weekly | None | Consent, once | None | Indirect | n/a (courier) |
| Proposed, instructor (per student) | ~2 | ~1 | Per lesson | Low (watch, judge) | Student link, once | None | High *if* game swings change lessons [HYP] | **High** |

### B. Why coach software gets abandoned: HitterLoop's exposure (brief §8)

Abandonment risks were researched only indirectly. These are [INF] from the voice-of-customer and
competitor work, not dedicated studies.

| Risk | Current product | Proposed |
|---|---|---|
| Duplicate data entry | **Yes** (pitch logging duplicates GameChanger) | No |
| Coach burnout / time | **Yes** | Coach removed |
| Onboarding friction | Medium (team, roster, code) | Low (one link per student) |
| Recording friction | **Yes** (coach films every pitch) | Reuses existing footage |
| Hardware friction | No | No |
| Upload friction | Medium | **Medium** (parent share; the key risk, Experiment #2) |
| Account creation | Coach accounts + guardian accounts | Instructor only; parent consents via link |
| Manual tagging | **Yes** (opponent, pitch, outcome, rep grouping) | None |
| Roster maintenance | Yes | Instructor's own student list |
| Stats already elsewhere | **Yes** (GameChanger) | Not attempted |
| Reports nobody reads | Risk (parent report) | Risk (brief): measured by open rate |
| Analytics nobody acts on | **Yes** (metrics, 3D, trends) | Notes gated and capped at 2 |
| "Another dashboard" | **Yes** (12 pages) | Email/SMS + 1 page |
| Used twice and forgotten | Likely | Tested by 4-week decay |
| Needs perfect filming conditions | Partly (behind-plate guidance) | Same constraint; quality gate says "couldn't read" |
| Works in cages, not games | Built for games (an asset) | Same asset |

### C. The GameChanger question (brief §9)

- **What coaches use it for:** scoring, stats, lineups, streaming.
- **What parents use it for:** following games, watching clips, and stats, sometimes to argue
  lineups [OBS/INF].
- **What it generates:**
  - pitch-by-pitch play data;
  - box scores and spray charts;
  - streamed video at 1080p (since 2026);
  - per-at-bat clips for streamed and scored games [OBS].
- **Should HitterLoop compete with it?** No.
- **Should HitterLoop sit downstream of it?** Yes, but only through user-initiated sharing.
- **Can HitterLoop consume its data?**
  - Officially: the manual stats CSV (staff only) and per-clip download/share.
  - Automated access is against the ToS. There is no API [OBS: GameChanger worker, Terms of Use].
- **Is integration commercially possible?** Only via partnership. That is unlikely to be granted to
  a solo founder [HYP].
- **Is GameChanger moving toward automated player development?**
  - Not toward swing mechanics. Its AI goes to streaming, highlight reels, recaps, and an outcome
    "Insights" tab.
  - DICK'S launched "Coach by DICK'S" (an agentic retail and training advisor) in 2026 [OBS].
  - It could move quickly if it chose to [HYP].
- **"If a coach already uses GameChanger, what must HitterLoop do that GameChanger doesn't?"**
  - For a *team coach*: nothing compelling was found. That is why the coach is dropped.
  - For an *instructor*: deliver the student's game swings, swings only, organized and paired,
    before the lesson. GameChanger doesn't route anything to instructors.
- **"Can inputs come from workflows already performed?"** Yes. The streamer/scorer and the filming
  parent already create the clips. HitterLoop asks for one extra act: forwarding.

### D. Passive-data opportunities (brief §10)

| Opportunity | Classification | Why |
|---|---|---|
| Segment a full game video into at-bats | Feasible but difficult | Audio finds contact, not takes or whiffs; full-game visual scan is costly [OBS: repo] |
| Identify hitters in full-game video | **Unreliable today** | Jersey OCR and face ID behind fences fail; needs lineup/timestamp alignment [OBS: CV worker] |
| Identify the hitter in a single AB clip | **Feasible now** | Bat-holding track selection [OBS: repo, n=4] |
| Detect swings vs. takes | Feasible but difficult | Needs a visual classifier; audio catches contact only |
| Separate fouls / balls in play | Unreliable today | No ball tracking. GameChanger already knows it (from the scorer) |
| Classify at-bats | Bad idea regardless | GameChanger's scorer already does it; duplicates the incumbent |
| Auto-select useful swing clips | Feasible now (swings only) / difficult ("best") | No outcome signal for "best" |
| Compare recent swings, same setup | Feasible but difficult | Depends on noise floor (Experiment #4) |
| Detect mechanical changes over weeks | Unreliable today | 2.4–10.1% bone-length CV; uncalibrated angles [OBS] |
| Identify emerging trends | Unreliable today | Same, plus small samples |
| Flag deviations from a player's own baseline | Feasible but difficult | Only within one camera setup class |
| Auto development summaries | Bad idea (as text) | Generates review work; commodity |
| Auto clips for parent/player review | Feasible now | Already done by GameChanger; no differentiation |
| Auto practice recommendations / drills | Bad idea regardless | Instructor's domain; commodity in SwingAI and others |
| "What changed since last week" | Feasible but difficult | Same-setup only |
| Which players deserve coach attention | Bad idea (for team coaches) | Wrong user [INF] |
| Did practice changes transfer into games | **Unreliable as a metric**; feasible as *video pairing* | Cross-setup parallax [§13] |

### E. Magic moments (brief §11)

- **Strongest candidate [HYP, to be tested in Experiment #1]:**
  - An instructor opens a text on Tuesday morning.
  - In 40 seconds they see that the student they spent three lessons on is still dropping the back
    side in *games*, though not in the cage.
  - They change the lesson plan before the student arrives.
  - The parent never had to explain anything.
- **Not magic:** a 3D avatar, a metrics dashboard, a weekly AI paragraph, a "3 hitters need
  attention" alert to a volunteer coach. Each is "that's cool" at best.
- **The parent's version:** the instructor opens the lesson with "I watched your game swings."
  That moment is what makes the parent keep forwarding. It is also why the instructor must be the
  recipient.

### F. 3D and other feature roles (brief §12)

| Capability | Role |
|---|---|
| 3D reconstruction | **Impressive demo, weak product value**. At most supporting infrastructure (phase timing). Users should not see it in the MVP |
| Pose measurements | Supporting infrastructure (hidden), plus thresholded notes only if repeatable |
| AI findings | Weak product value as drafts; replaced by capped, thresholded notes |
| Drill assignment | Unnecessary complexity (instructor's domain) |
| Progress tracking | Future differentiator (as swing *history*, not scores) |
| Player reports | Future (parent-facing), deferred |
| Side-by-side compare | **Core customer value**, automated |
| Coach approval queue | Unnecessary complexity; kill |
| Game logging / pitch-by-pitch logging | Duplicates GameChanger; kill |
| Practice logging | Unnecessary; lesson clips just arrive |
| Corrected / ideal swing visualization | Unnecessary complexity; kill |

### G. The "no new dashboard" rule (brief §17)

- The proposed product passes. Delivery is an email or SMS brief the evening before the lesson,
  with one web page per student.
- There is no app session, no inbox to clear, and nothing to approve.
- The only "app" surface is the instructor's student list with share links, visited at setup.
- **Footage goes in → useful information comes out.**

### H. Technical reality check (brief §19)

| Component | Verdict | Note |
|---|---|---|
| YOLO11-pose + batter selection | **Retain** | The unfair head start for messy game clips |
| YOLOv8 bat tracking (ByteTrack) | Retain | Needed for swing/take and phases |
| Audio bat-crack locator | Retain | Speeds long-clip handling |
| Automatic swing-window / contact inference | **Retain + harden** | Phase sync for pairing |
| Swing vs. take classifier | **Build** | Largest technical gap for the thesis |
| Measurement engine | Modify | 2–3 same-setup metrics chosen by Experiment #4; drop world-space angles |
| VideoPose3D | **Remove from critical path** | Keep offline; replace later if needed |
| Three.js / FBX avatar viewer | Deemphasize (demo only) | |
| Gemini analysis | Modify | Phrasing of thresholded notes only, or remove |
| Supabase + RLS | Retain | Tenancy changes from team to instructor |
| GCS video infrastructure + upload queue | Retain | Add share-target / email ingest |
| Longitudinal player data model | Modify | Student-centric swing history, split game / lesson |
| Methodology knowledge system | Abandon (freeze) | |
| Capacitor Android shell | Deemphasize | Web share target suffices initially |

### I. Skepticism about AI (brief §29)

**"Why are we generating findings that a coach must individually approve?"**

- Because the product inherited a governance principle ("AI drafts are not coach conclusions")
  and implemented it as a *workflow*: a queue with one decision per finding.
- The principle is right. The implementation turns the user into the AI's QA staff.
- That is the single feature most responsible for the effort problem.

Replacement, applying the exception-workflow patterns (Stripe Radar, Datadog, Gong) with their
limits:

- **Remove labor:** swing filtering, pairing, phase sync. These are pure labor removal and the core
  of the product.
- **Increase confidence:** surface notes only above a threshold, and only on measures proven
  repeatable. Silence is the default. Encode uncertainty by not speaking, never with a
  "low-confidence" badge the user has to interpret.
- **No approvals:** the instructor is the expert. Notes are hints for their eye, never conclusions
  shown to parents. Optional 👍/👎 is implicit feedback, not a gate.
- **Longitudinal evidence instead of approvals:** the swing history itself is the evidence. The
  instructor's judgment happens in the lesson, where it belongs.
- **Generated text the user must read:** capped at two lines. Anything longer is a product failure.
- **Where the analogy breaks** [OBS: AGY worker 6]: the volume is small (a few swings per student
  per week) and noisy, and nothing is urgent. So the exception pattern is used for *trust* (say
  little, be right), not for triage.

### J. The 10x question (brief §27)

The strongest candidate [HYP]:

- **Today:** a parent texts 6–12 raw at-bat clips. The instructor scrubs each one for the swing,
  remembers last week's lesson, and finds the old cage clip in their camera roll to compare. That
  is about 10–15 minutes per student, so mostly it isn't done.
- **Proposed:** about 1 minute, already filtered to swings, phase-synced, and paired.

That is roughly **10× less instructor time** for a job that is currently mostly *skipped*. The real
gain is from "not done" to "done every week". Whether that matters is exactly what Experiment #1
tests.

---

## Sources

Primary or near-primary sources I verified, and sources the workers cited that I relied on:

- HitterLoop live page: https://joncurry.co/projects/hitterloop
- Repo: `readme.md`, `docs/PIPELINE_AUDIT.md`, `scripts/pose3d/README.md`, `NEXT_STEPS.md`,
  `coach/*.html`
- GameChanger 2026 update (press):
  https://www.morningstar.com/news/pr-newswire/20260210ne82250/gamechanger-announces-most-comprehensive-product-update-in-its-15-year-history
- GameChanger 2026 help article: https://help.gc.com/hc/en-us/articles/41988821287309
- GameChanger Team Pass pricing: https://gc.com/pricing/team-pass
- GameChanger clips help (search summary; page blocked to direct fetch):
  https://help.gc.com/hc/en-us/articles/4482237253517
- GameChanger camera setup: https://gc.com/camera ; https://gc.com/live-streaming-tools
- Coach by DICK'S (May 2026):
  https://www.retaildive.com/news/dicks-sporting-goods-launches-ai-adviser/821356/
- WIN Reality acquires Blast Motion:
  https://secure.businesswire.com/news/home/20250623297228/en/WIN-Reality-Acquires-Blast-Motion-A-New-Era-in-Swing-Development
- WIN SmartPark launch and Yakkertech:
  https://winreality.com/blog/smartpark-launch-pro-tech-for-every-diamond/
- SmartPark pricing and features: https://winreality.com/join-the-smartpark-era/ ;
  https://winreality.com/smartpark/
- AWRE × WIN Reality automated swing analysis (headline only):
  https://secure.businesswire.com/news/home/20250630380885/en/AWRE-and-WIN-Reality-Partner-to-Deliver-Automated-AI-Swing-Analysis-for-Baseball-and-Softball
- Blast paywall complaints: https://appshunter.io/ios/app/blast-baseball/id696974849/reviews
- AI swing app landscape (vendor-authored, biased): https://mindandmuscle.ai/best-swing-analysis-apps
- Dingerly launch:
  https://news.marketersmedia.com/grassroots-baseball-app-with-ai-swing-analysis-for-youth-players-launched/89197629
- OnForm pricing: https://www.trustradius.com/products/onform/pricing
- CoachNow pricing: https://help.coachnow.io/en/articles/8534029-what-s-the-price-of-coachnow-analyze ;
  https://www.capterra.com/p/196441/CoachNow/
- Trace PlayerFocus:
  https://www.businesswire.com/news/home/20230502005375/en/Trace-Launches-PlayerFocus-an-Affordable-Video-Highlights-Service-for-Youth-Soccer ;
  EPYSA partnership (Mar 2026):
  https://www.epysa.org/news/2026/03/06/eastern-pennsylvania-youth-soccer-partners-with-trace-to-bring-advanced-video-tools-to-players-and-coaches/ ;
  Trace Baseball app: https://apps.apple.com/bb/app/trace-baseball/id1636026663
- Hudl acquires Balltime:
  https://siliconprairienews.com/2025/06/lincoln-based-hudl-acquires-titan-sports-and-balltime-expanding-access-to-performance-data-for-athletes/ ;
  Balltime pricing: https://www.balltime.com/high-schools
- Aspen Project Play spending survey:
  https://projectplay.org/news/2025/2/24/project-play-survey-family-spending-on-youth-sports-rises-46-over-five-years
- MLB / Aspen participation: https://www.mlb.com/news/more-youth-teens-continuing-to-play-baseball
- Perfect Game / All League (22,000 teams):
  https://www.prnewswire.com/news-releases/perfect-game-adds-22-000-youth-teams-through-partnership-with-all-league-baseball-302313204.html
- Lesson pricing: https://www.baseballclinics.com/are-you-paying-too-much-for-baseball-training/
- D-BAT locations: https://www.bizbuysell.com/franchise-for-sale/d-bat/
- Forum, parent → instructor game video (verbatim):
  https://www.discussfastpitch.com/threads/coaches-parents-question-for-you.46520/
- Forum, instructors on video (verbatim):
  https://www.discussfastpitch.com/threads/should-hitting-instructor-use-video.27831/
- Forum, video app usage (2025): https://www.discussfastpitch.com/threads/best-video-analysis-app.47524/
- Exception-workflow analogues (AGY):
  Stripe Radar rules https://stripe.com/docs/radar/rules ;
  Datadog Watchdog https://www.datadoghq.com/product/watchdog/ ;
  Gong deal warnings https://help.gong.io/hc/en-us/articles/360044810752-Deal-warnings ;
  RPM alarm fatigue https://www.ncbi.nlm.nih.gov/pmc/articles/PMC8901314/
