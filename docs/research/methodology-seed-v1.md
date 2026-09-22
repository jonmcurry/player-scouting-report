# Methodology Seed Research — v1

**Every claim in this document is `review_status = candidate`, `human_verified
= false`, `active = false`. Nothing here has been approved. This document
does not modify `knowledge/claims.json`, `knowledge/version.json`, or any
`methodology_*` table.**

## How this research was actually done (read before trusting anything below)

This repository's own tooling (WebFetch, WebSearch, the Gemini API) has no
way to watch video directly except by giving Gemini's video-input API a
public YouTube URL and asking it to extract structured claims. That is
exactly what was done here — see `scripts/research/extractMethodologySeed.ts`
(a one-off script, not part of the production pipeline) and its raw,
unedited output in `scripts/research/raw-output/*.json`.

**What that means for how to read this document:**
- Titles/channels marked "verified" below come from **YouTube's own oEmbed
  API**, checked independently of Gemini (see
  `methodology-source-registry-v1.md`) — this is solid ground truth.
- Claim text, timestamps, and content characterization come from **Gemini's
  self-reported reading of the actual video/audio** — nobody on the human or
  Claude side of this session watched the videos directly to independently
  confirm them. Gemini's own `timestampConfidence` field is preserved below
  exactly as it reported it; where I (the reviewing Claude session) disagree
  with Gemini's self-assessment, that's called out explicitly as a "Reviewer
  note," not silently changed.
- Two of the ten locked videos (#5 Antonelli, #7 Candrea) are **BLOCKED**:
  Gemini's API returned repeated `503 UNAVAILABLE` and then hit the
  free-tier daily quota (20 requests/day for `gemini-3.6-flash`) before a
  successful extraction completed. This is an infrastructure limit, not a
  content/access problem with those two videos — they were not silently
  replaced with substitutes, per the task's own instruction.
- The configured production model (`gemini-2.5-flash` in `.env`) returned
  `404 no longer available to new users`; this one-off script used
  `gemini-3.6-flash` instead, **without changing the production
  `GEMINI_MODEL` config** used by `src/services/ai/geminiAnalyzer.ts`. That's
  a separate decision for the user, not made here.

---

# Video 1 — How To Coach Hitting Mechanics Pt. 1

Source: Driveline Baseball
Source ID: `driveline-baseball`
Canonical URL: https://www.youtube.com/watch?v=tXKjS3iKgAk
Video ID: tXKjS3iKgAk
Published: UNKNOWN (not returned by oEmbed; not independently confirmed)
Duration: ~136s (Gemini estimate, unverified)
Sport: both (baseball-presented; general motor-learning claim)
Audience / level: teen and above
Verification status: title/channel verified via oEmbed ("How To Coach Hitting
Mechanics Pt. 1 \| Driveline Baseball", channel Driveline Baseball). Gemini's
own on-screen read reported a different, more specific title — "Coaching
Hitting Mechanics with Jason Ochart Pt. 1" — likely an on-screen title card
naming the presenter (Driveline's Director of Hitting) rather than a
conflicting fact; a human should confirm Jason Ochart is indeed the presenter
before citing him by name anywhere.

## Why this belongs in the seed

Directly addresses coaching *philosophy* (how to cue hitters at all), which
matters for how HitterLoop's own coaching-cue language should be framed, even
though it is light on directly observable swing-mechanics claims.

## Candidate Claim DRV1-001

Concept: game_approach
Timestamp: 00:38–01:03
Start seconds: 38
End seconds: 63
Source proposition: Athletes produce more force and sequence more efficiently
when focusing externally on movement outcomes rather than internally on body
movements.
HitterLoop candidate claim: External focus cues (focusing on ball flight or
target outcome) promote superior force production and movement sequencing
compared to internal focus cues (focusing on body mechanics).
Observable evidence: Coaching instructions directed at ball flight
trajectory/target outcome rather than a specific body segment during live or
cage swings — this is about *how HitterLoop-authored coaching cues should be
worded*, not something visible in swing video itself.
Applies when: Delivering verbal feedback during batting practice, cage work,
or game preparation.
Does not apply when: Conducting explicit body-awareness drills or physical
therapy screenings where internal focus is intentionally required.
Sport scope: both
Age guardrail: youth_appropriate
Level scope: general
Evidence type: research_supported
Numeric claim: false
Numeric evidence ref: none
Coaching cue: "Focus on ball flight trajectory and where you want to hit the
ball rather than internal body movement."
Related drill: none directly (this is a cueing-philosophy claim, not a drill)
Cause vs symptom concern: n/a — this is a cueing-methodology claim, not a
mechanics diagnosis.
Potential contradiction: see DRV1-002 vs BLM-001 in the contradiction matrix —
this external-focus philosophy sits in tension with Blast Motion's explicit
internal-mechanics coaching cue in Video 4.
Quality notes: Gemini reports the video shows on-screen citations to specific
motor-learning research (Wulf 2010, Wu 2012, Castaneda & Gray 2007). External-
focus-of-attention research is a real, substantial, well-established body of
work in the sports-science literature (Gabriele Wulf's research program is
genuinely extensive and frequently cited) — this makes `research_supported`
plausible, but **I have not personally watched the video to confirm those
exact citations appear on screen**, so a human reviewer should visually
confirm before trusting the `research_supported` classification as-is.
Approval readiness: strong_candidate (Reviewer note: conditional on a human
confirming the on-screen citations)
Human verified: NO
Review status: CANDIDATE
Active: NO

## Candidate Claim DRV1-002

Concept: game_approach
Timestamp: 01:59–02:25
Start seconds: 119
End seconds: 145
Source proposition: The human body self-organizes to accomplish tasks within
an environment, so coaches should manipulate environmental/physical
constraints rather than over-cueing mechanics verbally.
HitterLoop candidate claim: Manipulating physical and environmental
constraints allows hitters to self-organize efficient swing mechanics without
creating robotic movement patterns.
Observable evidence: Use of environmental constraints (step-behind drills,
variable overload/underload bats) to induce mechanical adjustment without
explicit verbal mechanics instruction — again, this is a *coaching-design*
claim more than something directly visible in ordinary swing video.
Applies when: Designing practice environments to correct hitting mechanics
and timing faults.
Does not apply when: An athlete lacks basic movement patterns or physical
mobility required for the constraint.
Sport scope: both
Age guardrail: teen_appropriate
Level scope: players with baseline mechanics already established
Evidence type: coaching_instruction
Numeric claim: false
Numeric evidence ref: none
Coaching cue: none given directly as a cue (this is a design-principle claim)
Related drill: DRILL MATCH — no obvious existing HitterLoop match; two
specific drills demonstrated (see below).
Cause vs symptom concern: direct body cueing framed as a "symptom-focused"
approach that can inhibit natural self-organization; the underlying-cause
framing here is Driveline's own coaching philosophy, not an independently
established fact.
Potential contradiction: same as DRV1-001 — see contradiction matrix vs
BLM-001.
Quality notes: Reasonable, conservatively worded design principle. Note this
is about *practice/cueing design*, not itself an observable swing pattern —
flagging for human judgment on whether "constraint design" claims like this
belong in the same schema/prompt slot as observable mechanical claims.
Approval readiness: needs_human_judgment (Reviewer note: downgraded from
Gemini's "strong_candidate" — this is closer to a coaching-methodology
design principle than an observable-from-video mechanical claim, and
HitterLoop's `observable_evidence` field is meant to describe what's visible
in a coach/game clip, which this claim doesn't cleanly satisfy)
Human verified: NO
Review status: CANDIDATE
Active: NO

## Drills in this video

- **Step-Behind Momentum Drill** — ~02:09 (129s, Gemini estimate). Targets
  transferring linear momentum via movement constraint. Equipment: bat,
  balls, tee/toss feeder. DRILL MATCH: needs later drill-library review.
- **Underload/Overload Variable Bat Training** — ~02:15 (135s, Gemini
  estimate). Targets swing-speed/motor adaptability via bat-weight variation.
  Equipment: underload/overload bats. Youth-safety caution: load selection
  matters for younger athletes (per Gemini's own note) — do not treat as
  youth-appropriate without a human confirming appropriate bat weights.
  DRILL MATCH: needs later drill-library review.

## Human review notes

Confirm the presenter is really Jason Ochart and that the cited research
(Wulf 2010, Wu 2012, Castaneda & Gray 2007) actually appears on screen before
trusting `research_supported` on DRV1-001. Decide whether coaching-philosophy/
practice-design claims like DRV1-002 belong in the same claim schema as
directly-observable mechanical claims, or need a separate future category.

---

# Video 2 — 3 Drills to Improve Timing and Load When Hitting

Source: Driveline Baseball
Source ID: `driveline-baseball`
Canonical URL: https://www.youtube.com/watch?v=tTBSOTw7XoQ
Video ID: tTBSOTw7XoQ
Published: UNKNOWN
Duration: ~230s (Gemini estimate, unverified)
Sport: baseball
Audience / level: youth through advanced (drills), teen+ (diagnosis claim)
Verification status: title/channel verified via oEmbed ("3 Drills to Improve
Timing and Load When Hitting \| Driveline Baseball", channel Driveline
Baseball). Gemini's on-screen read reported the title "Helping An Early
Hitter" — likely a specific on-screen segment/topic title distinct from the
YouTube listing title; both are recorded, oEmbed's is treated as canonical.

## Why this belongs in the seed

Directly addresses timing/load diagnosis and gives three concrete,
timestamped drills — good coverage for the timing/load knowledge domain.

## Candidate Claim DRV2-001

Concept: timing
Timestamp: 00:28–00:42
Start seconds: 28
End seconds: 42
Source proposition: Early hitting is usually caused by loading too early,
which causes moving forward too early, early hip extension, and lunging at
the ball.
HitterLoop candidate claim: Hitters who consistently swing too early often
initiate their load prematurely, leading to an uncontrolled forward move,
early back-hip extension, and lunging.
Observable evidence: Hitter shifting weight forward well before pitch
release, back hip extending early, body posture lunging toward the ball —
this is genuinely visible in ordinary game/practice video.
Applies when: A hitter is consistently early on pitches and lunging forward
into contact.
Does not apply when: A hitter is late on pitches or failing to initiate
stride in time.
Sport scope: baseball
Age guardrail: teen_appropriate
Level scope: youth through advanced (per Gemini); Reviewer note — I'm
keeping `teen_appropriate` rather than `youth_appropriate` since the
underlying causal chain (early hip extension timing) is a fairly nuanced
diagnostic judgment call for a coach to make correctly on a young hitter;
a human should decide if this is safe to relax to `youth_appropriate`.
Evidence type: coaching_heuristic
Numeric claim: false
Numeric evidence ref: none
Coaching cue: none given directly
Related drill: all three drills below are explicitly tied to this diagnosis
Cause vs symptom concern: **Explicitly a causal chain, not just an
observation** — the source frames early loading as the *cause* of the
downstream forward-move/hip-extension/lunging symptoms. This causal claim
itself is coaching heuristic/experience, not independently validated
research — worth a human explicitly deciding whether to preserve as a
causal claim or soften to "these often co-occur."
Potential contradiction: none identified against the other 7 reviewed videos.
Quality notes: Clear, internally consistent, drill-actionable.
Approval readiness: strong_candidate
Human verified: NO
Review status: CANDIDATE
Active: NO

## Drills in this video

- **Step Backs** — ~01:19 (79s). Targets early loading / poor
  timing-rhythm relative to pitcher/tosser. Equipment: bat, balls,
  front-toss screen. Tied to a specific fault (per Gemini). DRILL MATCH:
  needs later drill-library review.
- **Modified Hook 'Em** — ~01:58 (118s). Targets uncontrolled forward move /
  failing to load upper half / spinning off early. Same equipment. Tied to a
  specific fault. DRILL MATCH: needs later drill-library review.
- **Offset Open** — ~02:47 (167s). Targets spinning off pitches early /
  losing posture through the swing. Same equipment. Tied to a specific
  fault. DRILL MATCH: needs later drill-library review.

## Human review notes

Decide whether the early-loading causal chain (DRV2-001) should be preserved
as stated (causal) or softened. Confirm age guardrail — Gemini defaulted to
broad "youth through advanced" applicability; this document recommends
`teen_appropriate` pending a human's own judgment.

---

# Video 3 — Two Tee Extension Drill

Source: TannerTees, featuring Megan Rembielak
Source ID: `tanner-tees`
Canonical URL: https://www.youtube.com/watch?v=22bq90ojT_o
Video ID: 22bq90ojT_o
Published: UNKNOWN
Duration: ~108s (Gemini estimate, unverified)
Sport: softball
Audience / level: general
Verification status: title/channel verified via oEmbed ("Two Tee Extension
Drill with Megan Rembielak using a Tanner Tee \| Softball Hitting Drills",
channel TannerTees). Gemini's on-screen read reported the title "Softball
Hitting Drill for Extension" and channel "MegRem Softball" — **this channel
name conflicts with oEmbed's authoritative "TannerTees"**; likely Gemini
read an on-screen watermark/brand for the instructor's own personal
name/brand rather than the actual uploading channel. oEmbed is treated as
canonical for the actual publisher; "MegRem Softball" is worth a human
double-checking as a possible secondary/personal channel for Megan
Rembielak.

## Why this belongs in the seed

Concrete, named "extension" concept with a specific drill — good test case
for the task's own caution about not encoding "extension" as a vague
universal ideal.

## Candidate Claim TAN-001

Concept: extension
Timestamp: 00:07–00:43
Start seconds: 7
End seconds: 43
Source proposition: Extension after contact keeps the barrel through the
tunnel toward the pitcher, maximizing power and helping direct the ball
rather than rolling over into weak grounders.
HitterLoop candidate claim: Extending the bat barrel through the hitting zone
after contact optimizes power and directional ball flight while preventing
premature wrist rollover.
Observable evidence: Bat barrel path continuing forward toward the pitcher
after contact with extended arms prior to the finish roll-over — visible in
ordinary video, including HitterLoop's own contact/extension swing-phase
stills.
Applies when: Executing swing follow-through and extension on pitches through
the middle of the zone.
Does not apply when: Adjusting to extreme inside pitch locations where hand
path must clear tightly.
Sport scope: softball (Reviewer note: Gemini marked this `both`, but the
video is explicitly softball instruction with a softball-specific product
(Tanner Tee) and softball swing plane; downgraded to `softball` pending a
human confirming genuine baseball transferability — per the task's own
"be conservative with both" instruction.)
Age guardrail: youth_appropriate
Level scope: general
Evidence type: coaching_heuristic
Numeric claim: false
Numeric evidence ref: none
Coaching cue: "Drive the barrel through the tunnel from home to the
pitcher."
Related drill: the Two Tee Extension Drill itself (below)
Cause vs symptom concern: premature wrist roll is framed as a *symptom* of
poor barrel path/rotational casting, not itself re-labeled as a root cause —
this framing is appropriately careful.
Potential contradiction: none identified.
Quality notes: This is exactly the "what does 'extension' mean" question the
task flagged — here it specifically means barrel-path direction/duration
through the zone post-contact, not arm-extension-as-a-goal in isolation.
Worth preserving that specific definition rather than a vague "extend your
arms" restatement.
Approval readiness: strong_candidate
Human verified: NO
Review status: CANDIDATE
Active: NO

## Drills in this video

- **Two Tee Extension Drill** — ~00:44 (44s). Targets pulling the barrel out
  of the zone too early / rolling over into ground balls. Equipment: two
  batting tees, two softballs (and specifically the "Tanner Tee" product —
  worth noting the commercial/product-specific angle). DRILL MATCH: needs
  later drill-library review.

## Human review notes

Decide on `sport_scope` (this document recommends `softball` over Gemini's
`both`). Confirm whether "MegRem Softball" is a real secondary channel worth
its own source registry row, or just an on-screen instructor credit.

---

# Video 4 — Youth Hitting Drills - Swing Plane

Source: Blast Motion
Source ID: `blast-motion`
Canonical URL: https://www.youtube.com/watch?v=NThwdXRo0b8
Video ID: NThwdXRo0b8
Published: UNKNOWN
Duration: ~108s (Gemini estimate, unverified)
Sport: both
Audience / level: youth through advanced
Verification status: title/channel verified via oEmbed ("Youth Hitting
Drills - Swing Plane", channel Blast Motion). Gemini's on-screen read
reported "Blast Motion PVC Pipe On-Plane Drill" — consistent in substance,
just a more specific on-screen description; no conflict.

## Why this belongs in the seed

Youth-safe posture/plane drill with an explicit "don't dive at the ball"
cue, and explicitly avoids the proprietary-sensor-metric trap the task
warned about for this source.

## Candidate Claim BLM-001

Concept: posture
Timestamp: 00:52–01:45
Start seconds: 52
End seconds: 105
Source proposition: Hitters must rotate the torso to bring the pipe around
to the tee, avoiding diving the chest forward at the ball.
HitterLoop candidate claim: Hitters should adjust swing plane to different
pitch locations through torso rotation and body posture rather than diving
their chest forward toward the ball.
Observable evidence: Maintaining spinal posture during torso rotation, chest
not lunging forward toward the ball, across different tee locations — this
is genuinely visible in ordinary video without any Blast sensor data (the
task's own caution about this source's proprietary metrics was checked and
does not apply to this particular claim).
Applies when: Working on swing plane control, torso rotation, and pitch
location adjustment.
Does not apply when: Full game situations where timing and stride dynamics
vary unpredictably.
Sport scope: both
Age guardrail: youth_appropriate
Level scope: youth through advanced
Evidence type: drill_prescription
Numeric claim: false
Numeric evidence ref: none
Coaching cue: "Rotate around your center so the pipe comes to the tee—don't
dive your chest forward."
Related drill: the PVC Pipe Chest Rotation Drill itself (below)
Cause vs symptom concern: "diving at the ball" framed as a mechanical fault
caused by reaching with the chest instead of rotating — reasonable framing,
directly tied to what the drill/constraint is designed to fix (a physical
constraint-based correction, similar in spirit to Video 1's own
constraint-based philosophy).
Potential contradiction: **flagged in the contradiction matrix** — this
claim's coaching cue is an explicit internal/body-mechanics instruction
("rotate around your center," "don't dive your chest forward"), which sits
in tension with Video 1's (Driveline) external-focus-cueing claim (DRV1-001)
that argues internal-body cues are inferior to external-outcome cues. See
`methodology-contradictions-v1.md`.
Quality notes: Solid, youth-appropriate, drill-actionable, genuinely
observable without proprietary sensor data.
Approval readiness: strong_candidate
Human verified: NO
Review status: CANDIDATE
Active: NO

## Drills in this video

- **PVC Pipe Chest Rotation Drill** — ~00:10 (10s). Targets lunging/diving
  at the ball with the upper body. Equipment: PVC pipe, batting tee. Tied to
  a specific fault. DRILL MATCH: needs later drill-library review.

## Human review notes

Resolve the cueing-philosophy tension with DRV1-001/DRV1-002 (see
contradiction matrix) — this is a genuine, substantive disagreement about
whether internal-body cues like this one are good coaching practice, not
just a semantic difference.

---

# Video 5 — Behind the Scenes Softball Lesson — **BLOCKED**

Source: Antonelli Softball
Canonical URL: https://www.youtube.com/watch?v=tfz7sCIcu8g
Video ID: tfz7sCIcu8g
Verification status: title/channel verified via oEmbed only ("Behind the
Scenes Softball Lesson", channel Antonelli Softball). **No content-level
extraction was possible** — Gemini's API returned `503 UNAVAILABLE` (model
overloaded) after 4 retries with backoff, and further attempts would have
risked/exceeded the free-tier daily request quota. This is an infrastructure
limitation, not a decision that this video lacks useful content or is
inaccessible — retry another day (see
`scripts/research/raw-output/5-tfz7sCIcu8g.blocked.json`).

No claims, no drills, no human review notes possible this round.

---

# Video 6 — JT Gasso Hitting Technique: 3-Plate Drill

Source: FloCollege \| Softball, featuring JT Gasso (Oklahoma Softball hitting
coach)
Source ID: `flocollege-softball`
Canonical URL: https://www.youtube.com/watch?v=RtQUfmkqX0s
Video ID: RtQUfmkqX0s
Published: UNKNOWN (see source registry — a secondhand "~Dec 2017" mention
found via web search is NOT independently confirmed and should not be
trusted as `published_at`)
Duration: ~28s (Gemini estimate, unverified) — likely a short highlight clip
Sport: softball
Audience / level: high school, travel ball, college
Verification status: title verified via oEmbed ("JT Gasso Hitting Technique:
3-Plate Drill"). **Channel attribution conflict**: oEmbed says the real
publisher is "FloCollege \| Softball"; Gemini's on-screen read said "Oklahoma
Softball" — almost certainly Gemini conflating JT Gasso's employer
(University of Oklahoma) with the actual channel. Treating FloCollege \|
Softball as canonical per the task's explicit instruction to verify JT
Gasso's metadata carefully.

## Why this belongs in the seed

Concrete, named timing-adjustment drill from a credentialed college hitting
coach.

## Candidate Claim GAS-001

Concept: timing
Timestamp: 00:15–00:28
Start seconds: 15
End seconds: 28
Source proposition: Hitters move back and forth between three different
plate locations to learn how swing timing and tempo need to adjust for pitch
distance.
HitterLoop candidate claim: Moving hitters between three different plate
distances during toss drills trains their ability to adjust swing timing and
rhythm relative to pitch arrival time.
Observable evidence: A hitter taking swings sequentially from three
different home-plate markers at varied distances from the front-toss screen
— directly visible drill structure.
Applies when: Practicing timing rhythm and reaction-time adjustments during
front toss or live pitching practice.
Does not apply when: Isolating stationary swing mechanics on a tee where
pitch arrival time is not a factor.
Sport scope: softball
Age guardrail: teen_appropriate
Level scope: high school, travel ball, college
Evidence type: drill_prescription
Numeric claim: false
Numeric evidence ref: none
Coaching cue: none given directly (this is a drill-structure claim)
Related drill: the 3-Plate Timing Drill itself (below)
Cause vs symptom concern: n/a — pure drill-structure claim, no causal
mechanics diagnosis.
Potential contradiction: none identified.
Quality notes: **Video is very short (~28s of usable content per this
extraction)** — almost certainly an excerpt/highlight clip rather than a
full lesson, consistent with the task's caution to verify accessible-content
sufficiency. The single claim extracted is solid but this is a thin source
overall.
Approval readiness: strong_candidate (for the one claim itself); Reviewer
note: flag to a human that this source may be too thin (one short clip) to
justify `approved_for_scope` at the source level yet — recommend `candidate`
at the source level (see source registry).
Human verified: NO
Review status: CANDIDATE
Active: NO

## Drills in this video

- **3-Plate Timing Drill** — ~00:15 (15s). Targets poor timing variability /
  inability to adjust to different pitch speeds or release distances.
  Equipment: 3 home plates at varying distances, softballs, front-toss
  screen, bat. Not tied to one specific fault (general timing-adaptability
  drill, per Gemini). DRILL MATCH: needs later drill-library review.

## Human review notes

Confirm actual publish date directly on the video page (do not trust the
secondhand "~2017" figure). Confirm whether more of this lesson exists
elsewhere (FloCollege paid content) that a human reviewer with access could
draw a second claim from, per the task's general caution about
paywalled/excerpted source material.

---

# Video 7 — Mike Candrea's Ultimate Coaching Clinic — **BLOCKED**

Source: Championship Productions
Canonical URL: https://www.youtube.com/watch?v=IwEsqGwUZDQ
Video ID: IwEsqGwUZDQ
Verification status: title/channel verified via oEmbed ("Mike Candrea's
Ultimate Coaching Clinic", channel Championship Productions) and
cross-checked via web search (confirms Championship Productions, NOT USA
Softball, per the task's explicit correction). **No content-level extraction
was possible**: Gemini's API returned `503 UNAVAILABLE`, then a retry hit
`429 RESOURCE_EXHAUSTED` (free-tier daily quota of 20 requests/day for
`gemini-3.6-flash` exhausted by this point in the run). This is an
infrastructure limitation, not a decision that this video lacks useful
content (see
`scripts/research/raw-output/7-IwEsqGwUZDQ.blocked.json`).

**Metadata correction applied per the task's explicit instruction, even
without content access:** do not describe Candrea as the *current* all-time
NCAA softball wins leader — he held that record (1,674 wins) at his 2021
retirement; Carol Hutchins (Michigan) passed it in February 2022. A
conflicting, lower-quality "1,859 wins" figure was also found and could not
be reconciled — do not use either specific number in any future claim
without a human confirming it against a primary source.

No claims, no drills possible this round.

---

# Video 8 — Youth Practice Plan Series | Hitting Tips

Source: American Baseball Coaches Association (ABCA)
Source ID: `abca`
Canonical URL: https://www.youtube.com/watch?v=7J-JoyaSabA
Video ID: 7J-JoyaSabA
Published: UNKNOWN
Duration: ~600s (Gemini estimate, unverified)
Sport: baseball
Audience / level: youth
Verification status: title/channel verified via oEmbed ("Youth Practice Plan
Series \| Hitting Tips", channel American Baseball Coaches Association
(ABCA)). **Unresolved channel-attribution conflict**: Gemini's on-screen read
reported "Golden Spikes Baseball" as the channel — this directly conflicts
with oEmbed's authoritative "ABCA." Possible explanation: a facility or
co-production credit shown on screen, distinct from the actual YouTube
publisher. Flagging to a human rather than guessing further — I did not
watch the video myself.

## Why this belongs in the seed

Strong, youth-safe fundamentals content — exactly the "conservative youth
baseline" the task called out this source as valuable for.

## Candidate Claim ABCA-YT-001

Concept: pitch_location_adjustment
Timestamp: 06:18–08:20
Start seconds: 378
End seconds: 500
Source proposition: When setting up a tee, pitch location dictates contact-
point depth relative to the body (away off lead hip, middle off front foot,
inside in front of front foot) to maintain connection.
HitterLoop candidate claim: Adjust contact points on a batting tee according
to pitch location: outside pitches off the lead hip, middle pitches off the
lead foot, and inside pitches out in front of the lead foot.
Observable evidence: Positioning of the batting tee relative to the
hitter's front foot/lead hip across different pitch locations — a tee-setup
convention, not itself a live-swing observation, but genuinely useful
practice-design guidance.
Applies when: Setting up batting-tee drills for specific pitch-location
practice.
Does not apply when: Practicing dynamic pitch recognition or live-pitching
hitting without controlled tee setups.
Sport scope: baseball
Age guardrail: youth_appropriate
Level scope: youth and amateur
Evidence type: coaching_instruction
Numeric claim: false
Numeric evidence ref: none
Coaching cue: "Outside off lead hip, middle off lead foot, inside out
front."
Related drill: the tee-setup convention described alongside the "Horseshoe
Seam Visual Placement Drill" below
Cause vs symptom concern: n/a — practice-setup convention, not a mechanics
diagnosis.
Potential contradiction: none identified.
Quality notes: Clear, concrete, genuinely youth-appropriate, easy for a
coach to apply without any special equipment.
Approval readiness: strong_candidate
Human verified: NO
Review status: CANDIDATE
Active: NO

## Candidate Claim ABCA-YT-002

Concept: load
Timestamp: 00:58–02:30
Start seconds: 58
End seconds: 150
Source proposition: Jumping back into a med-ball toss teaches lower-half
loading into the back hip while keeping weight inside the back knee to
ground forces effectively.
HitterLoop candidate claim: Using a jump-back medicine-ball toss teaches
hitters to load into the back hip and maintain weight on the inside of the
back knee.
Observable evidence: Hitter jumping back onto the rear leg, hinging at the
back hip without the knee collapsing outward, before throwing the medicine
ball — visible drill-execution pattern.
Applies when: Developing dynamic lower-half loading and back-hip weight
distribution.
Does not apply when: Players lack basic lower-body balance or have joint
issues requiring physical screening.
Sport scope: baseball
Age guardrail: youth_appropriate
Level scope: youth (with reduced medicine-ball weight, 2–4 lbs per Gemini's
extraction)
Evidence type: drill_prescription
Numeric claim: false (the 2–4 lb equipment note is a safety/equipment
recommendation, not a normative biomechanical numeric claim)
Numeric evidence ref: none
Coaching cue: "Jump back and load into your back hip."
Related drill: the Med Ball Jump Back Toss Drill itself (below)
Cause vs symptom concern: uses a physical-movement constraint (the jump-back
action) to *cause* proper hip loading — a constraint-based teaching approach,
similar in spirit to Video 1's and Video 4's constraint-based framing.
Potential contradiction: none identified.
Quality notes: Explicit medicine-ball weight guidance for young players (2–4
lbs) is a good, concrete youth-safety detail worth preserving even though
it's not itself the claim.
Approval readiness: strong_candidate
Human verified: NO
Review status: CANDIDATE
Active: NO

## Drills in this video

- **Med Ball Jump Back Toss Drill** — ~00:58 (58s). Targets poor lower-half
  load / lack of hip rotation / swaying over the back knee. Equipment: light
  medicine ball (2–4 lbs), net or wall. Tied to a specific fault. DRILL
  MATCH: needs later drill-library review.
- **Med Ball Scoop Toss Drill** — ~02:25 (145s). Targets lack of hip hinge /
  failure to release the backside through rotation. Same equipment. Tied to
  a specific fault. DRILL MATCH: needs later drill-library review.
- **Volleyball Knee Squeeze Drill** — ~04:09 (249s). Targets knee flare
  during stride / weak lower-body connection. Equipment: soft
  dodgeball/volleyball/connection ball. Tied to a specific fault. DRILL
  MATCH: needs later drill-library review.
- **Horseshoe Seam Visual Placement Drill** — ~05:38 (338s). Targets losing
  visual focus on the inner half of the ball during tee work. Equipment:
  batting tee, baseball, bat. Not tied to one specific fault (a general
  visual-tracking drill, per Gemini). DRILL MATCH: needs later drill-library
  review.

## Human review notes

Resolve the "Golden Spikes Baseball" vs. ABCA channel-attribution conflict —
find out who actually produced/taught this content before finalizing source
provenance for these two claims.

---

# Video 9 — Swinging vs. Hitting with Bryson LeBlanc, University of Missouri

Source: American Baseball Coaches Association (ABCA)
Source ID: `abca`
Canonical URL: https://www.youtube.com/watch?v=8tT4KXt5hhk
Video ID: 8tT4KXt5hhk
Published: UNKNOWN
Duration: ~295s (Gemini estimate, unverified)
Sport: both (per content, though presented at a baseball clinic)
Audience / level: youth through college
Verification status: title/channel verified via oEmbed ("Swinging vs.
Hitting with Bryson LeBlanc, University of Missouri", channel ABCA). Gemini's
on-screen read reported "Missouri Tigers Hitting Philosophy - ABCA
Barnstormers" — consistent in substance (same clinic, same presenter), just
a differently-worded on-screen title; no real conflict. **Confirmed via
earlier web search**: this public video is an excerpt from a much longer
(46:43) full 2024 ABCA Barnstormers clinic session — per the task's
instruction, only claims supported by this accessible public clip were
extracted; nothing was inferred from the longer session's description.

## Why this belongs in the seed

**IMPORTANT, per the task's own instruction**: this video's content is
about approach/mental game, not observable swing mechanics. Flagging both
claims below as **POSSIBLE FUTURE APPROACH-KNOWLEDGE DOMAIN** rather than
forcing them into the current mechanics-analysis concept taxonomy.

## Candidate Claim ABCA-LB-001

Concept: timing *(closest existing match; genuinely more of a mental/approach
concept than a mechanical one — see note below)*
Timestamp: 03:32–04:02
Start seconds: 212
End seconds: 242
Source proposition: Our core philosophy is to be on time for his best
fastball; when hitters truly believe they are on time for the best fastball,
it opens up their entire offensive execution.
HitterLoop candidate claim: Hitters should anchor their approach on being
consistently on time for the pitcher's best fastball.
Observable evidence: **Not cleanly observable from ordinary swing video** —
this is a stated mental-approach philosophy, not a visible mechanical
pattern. A coach could only infer this indirectly (e.g. consistent
early/late timing across at-bats over time), which is a much weaker/noisier
signal than the claim itself suggests.
Applies when: Standard plate appearances across all counts.
Does not apply when: Situational at-bats where sitting on a specific
offspeed pitch is explicitly called.
Sport scope: both
Age guardrail: youth_appropriate
Level scope: youth through college
Evidence type: coaching_instruction
Numeric claim: false
Numeric evidence ref: none
Coaching cue: "Be on time for his best fastball."
Related drill: none
Cause vs symptom concern: n/a — approach/philosophy claim.
Potential contradiction: none identified against the other videos, though it
sits adjacent to (not in conflict with) DRV2-001's mechanical timing
diagnosis — one is "how to think about timing," the other is "what early
timing looks like mechanically."
Quality notes: **POSSIBLE FUTURE APPROACH-KNOWLEDGE DOMAIN** — this is
genuinely a mental-approach concept, not swing mechanics. HitterLoop's
current concept taxonomy has no dedicated approach/mental-game concept
beyond `game_approach`/`swing_decision`, and neither maps cleanly onto "have
a timing anchor belief." Forcing this into `timing` (a mechanics concept in
the existing taxonomy) is a mismatch worth a human explicitly deciding on.
Approval readiness: needs_human_judgment (Reviewer note: downgraded from
Gemini's "strong_candidate" — not because the content is weak, but because
it doesn't fit the current mechanics-analysis-only architecture without a
human decision on scope)
Human verified: NO
Review status: CANDIDATE
Active: NO

## Candidate Claim ABCA-LB-002

Concept: game_approach
Timestamp: 01:25–02:05
Start seconds: 85
End seconds: 125
Source proposition: To alleviate outcome pressure, hitters must
reverse-engineer success from outcome results back to winning individual
pitches.
HitterLoop candidate claim: Hitters should measure success by winning
individual pitches rather than tracking box-score outcome results.
Observable evidence: **Not observable from swing video at all** — this is a
mental-framework claim about how a hitter should self-evaluate, with no
visible swing-mechanics correlate.
Applies when: All game at-bats and practice routines.
Does not apply when: Gemini reported "never; universal mental-game
heuristic" — Reviewer note: no claim should be recorded as having zero
exceptions; a human should supply a real `does_not_apply_when` before this
is approval-ready, even if genuinely broad.
Sport scope: both
Age guardrail: youth_appropriate
Level scope: general
Evidence type: coaching_heuristic
Numeric claim: false
Numeric evidence ref: none
Coaching cue: "Win each pitch."
Related drill: none
Cause vs symptom concern: n/a
Potential contradiction: none identified.
Quality notes: **POSSIBLE FUTURE APPROACH-KNOWLEDGE DOMAIN.** Also: the
"does_not_apply_when: never" answer is itself a quality flag — see above.
Approval readiness: needs_human_judgment (Reviewer note: same
approach-domain-fit concern as ABCA-LB-001, plus the missing genuine
does_not_apply_when)
Human verified: NO
Review status: CANDIDATE
Active: NO

## Drills in this video

None — per Gemini's own extraction, no mechanical swing claims or physical
drill demonstrations were present in this clip (confirmed consistent with
this being philosophy/approach content, not a mechanics/drill video).

## Human review notes

**Primary decision needed:** does HitterLoop's schema/architecture want an
approach-knowledge domain at all yet? The task itself anticipated this
question. If not, these two claims should probably stay `candidate`
indefinitely (or be explicitly rejected as "outside HitterLoop scope" per
the task's own rejection-log category) rather than ever reaching
`approved`/`active` under the current mechanics-only concept taxonomy.

---

# Video 10 — The Science Behind Hitting in Baseball with: Chad Miller

Source: Let's Have This Conversation (podcast), guest Chad Miller (founder,
Louisville Slugger Hitting Science Center)
Source ID: `lets-have-this-conversation`
Canonical URL: https://www.youtube.com/watch?v=fETlemtrceo
Video ID: fETlemtrceo
Published: UNKNOWN
Duration: ~1768s (~29 min, Gemini estimate, unverified)
Sport: both
Audience / level: general
Verification status: title/channel verified via oEmbed ("The Science Behind
Hitting in Baseball with: Chad Miller", channel "Let's Have This
Conversation"). **Independently confirmed, per the task's explicit caution**:
this is a podcast/interview channel, not a research or medical publication —
both my own oEmbed-based check and Gemini's own `contentCharacter:
"interview/podcast commentary"` classification agree on this. The title
containing "Science" does NOT make this research-backed by itself, and it is
not treated as such below.

## Why this belongs in the seed

Kinetic-chain sequencing content is directly relevant to
`hip_shoulder_sequencing`, but the numeric claim in this video is exactly the
kind of "sounds authoritative, isn't independently verifiable" content the
task asked to be extremely conservative about.

## Candidate Claim SCI-001

Concept: front_side_stability
Timestamp: 16:24–16:35
Start seconds: 984
End seconds: 995
Source proposition: Hitters who roll over on their front foot lose 8% of
energy transfer through the front foot and 11% through the backside.
HitterLoop candidate claim: Rolling over onto the outer edge of the front
foot during the swing results in measurable kinetic-energy loss during force
transfer.
Observable evidence: Video observation of the front foot rolling onto its
lateral edge during or immediately following contact — the *qualitative*
pattern (front-foot rollover) is genuinely observable in ordinary video; the
*quantitative* energy-loss figures are not.
Applies when: During the weight-transfer, foot-plant, and rotation phase of
the swing.
Does not apply when: Evaluating post-finish relaxation or non-swing
movement.
Sport scope: both
Age guardrail: youth_appropriate (Reviewer note: the *qualitative* pattern
observation may be youth-appropriate; the numeric figures below should not
be repeated to a youth audience as established fact — see quality notes)
Level scope: general
Evidence type: biomechanical_explanation (Gemini correctly avoided labeling
this `research_supported`, consistent with the task's caution)
Numeric claim: true
Numeric evidence ref: "Claims an 11% loss of kinetic energy transfer through
the backside and an 8% loss through the front foot when rolling over the
lead foot" — **this is Chad Miller's own spoken claim in the interview, with
no on-screen citation of methodology, sample size, or a checkable published
source.** Per the task's explicit numeric-claim rule ("be extremely
conservative... do not approve any unsupported numerical norm"), this
number should NOT be approved as stated without a human finding an actual
citable source for it.
Coaching cue: "Maintain pressure through the inside of the lead foot and big
toe during rotation."
Related drill: none
Cause vs symptom concern: front-foot rollover treated as a symptom
resulting from improper foot orientation/ground-force direction — reasonable
qualitative framing, independent of the numeric claim's evidence quality.
Potential contradiction: none identified against the other videos.
Quality notes: **Reviewer override of Gemini's self-assessment.** Gemini
rated this `strong_candidate`; I disagree specifically because of the
numeric claim's lack of any checkable evidence trail, combined with its
podcast/interview-format source. **Recommend splitting this into two
separate candidates during human review**: (a) the qualitative front-foot-
rollover-is-suboptimal pattern (genuinely a reasonable, observable,
strong candidate on its own), and (b) the specific 8%/11% figures (should
be `likely_reject` or held indefinitely pending independent verification,
and if ever approved, `numeric_claim=true` with a real, checkable
`numeric_evidence_ref` — not just "the interviewee said so").
Approval readiness: needs_human_judgment (Reviewer note: downgraded from
Gemini's "strong_candidate" for the reasons above)
Human verified: NO
Review status: CANDIDATE
Active: NO

## Candidate Claim SCI-002

Concept: hip_shoulder_sequencing
Timestamp: 15:43–16:10
Start seconds: 943
End seconds: 970
Source proposition: Hitting a baseball is a transfer of kinetic energy
derived from the ground up, delivered sequentially through hips, shoulders,
hands, and bat barrel while keeping the barrel behind the ball.
HitterLoop candidate claim: Optimal hitting mechanics rely on a kinetic-chain
sequence transferring energy from the ground through the hips, shoulders,
hands, and barrel.
Observable evidence: High-speed video showing sequential rotation — ground
drive, lead-hip turn, trunk rotation, hand acceleration, barrel delivery.
This general proximal-to-distal sequencing description is widely consistent
with mainstream hitting-mechanics teaching (not a novel or contested claim),
which makes it a reasonably safe qualitative claim even from an
interview-format source.
Applies when: Executing a full-effort rotational swing.
Does not apply when: Executing check swings, bunts, or emergency contact
swings.
Sport scope: both
Age guardrail: youth_appropriate
Level scope: general — "universal mechanical principle" per Gemini; Reviewer
note: reasonable as a general description, though "universal" language
itself should probably be softened by a human reviewer (few biomechanical
claims are truly universal without exception).
Evidence type: biomechanical_explanation
Numeric claim: false
Numeric evidence ref: none
Coaching cue: "Drive from the ground up through hips, shoulders, and hands."
Related drill: none
Cause vs symptom concern: proximal-to-distal sequencing framed as the
underlying cause of efficient bat speed/barrel extension — standard,
uncontroversial framing in hitting mechanics generally.
Potential contradiction: broadly compatible with DRV1-002's constraint-based
sequencing philosophy (Video 1) — not contradictory.
Quality notes: This is a much safer claim than SCI-001 — general kinetic-
chain sequencing is uncontroversial, non-numeric, and doesn't hinge on the
interview format's evidentiary weaknesses the way SCI-001 does.
Approval readiness: strong_candidate
Human verified: NO
Review status: CANDIDATE
Active: NO

## Drills in this video

None presented (interview format).

## Human review notes

**Split SCI-001** as described above before any approval decision — the
qualitative pattern and the specific numeric figures should not stand or
fall together. Consider softening "universal" language in SCI-002.

---

# Cross-video output

## Candidate claim summary

| Claim ID | Concept | Source | Sport | Age/level | Evidence type | Timestamp verified? | Approval readiness |
|---|---|---|---|---|---|---|---|
| DRV1-001 | game_approach | Driveline Baseball | both | general | research_supported | Gemini: high (unconfirmed by human) | strong_candidate* |
| DRV1-002 | game_approach | Driveline Baseball | both | teen+ | coaching_instruction | Gemini: high (unconfirmed) | needs_human_judgment (reviewer downgrade) |
| DRV2-001 | timing | Driveline Baseball | baseball | teen+ | coaching_heuristic | Gemini: high (unconfirmed) | strong_candidate |
| TAN-001 | extension | TannerTees | softball* | general | coaching_heuristic | Gemini: high (unconfirmed) | strong_candidate |
| BLM-001 | posture | Blast Motion | both | youth+ | drill_prescription | Gemini: high (unconfirmed) | strong_candidate |
| GAS-001 | timing | FloCollege \| Softball | softball | HS/college | drill_prescription | Gemini: high (unconfirmed) | strong_candidate |
| ABCA-YT-001 | pitch_location_adjustment | ABCA | baseball | youth | coaching_instruction | Gemini: high (unconfirmed) | strong_candidate |
| ABCA-YT-002 | load | ABCA | baseball | youth | drill_prescription | Gemini: high (unconfirmed) | strong_candidate |
| ABCA-LB-001 | timing (approach-domain misfit) | ABCA | both | youth-college | coaching_instruction | Gemini: high (unconfirmed) | needs_human_judgment (reviewer downgrade) |
| ABCA-LB-002 | game_approach (approach-domain misfit) | ABCA | both | general | coaching_heuristic | Gemini: high (unconfirmed) | needs_human_judgment (reviewer downgrade) |
| SCI-001 | front_side_stability | Let's Have This Conversation | both | general | biomechanical_explanation | Gemini: high (unconfirmed) | needs_human_judgment (reviewer downgrade, numeric claim) |
| SCI-002 | hip_shoulder_sequencing | Let's Have This Conversation | both | general | biomechanical_explanation | Gemini: high (unconfirmed) | strong_candidate |

\* TAN-001's sport_scope was reviewer-downgraded from Gemini's `both` to
`softball`; see Video 3 above.
\* "Timestamp verified" means Gemini's *self-reported* confidence from
reading the actual video — no independent human or second-model
confirmation has occurred. Treat all of these as `needs_manual_verification`
in the sense the task defines it (a human has not yet confirmed them),
even though none required inventing a timestamp outright.

**12 total candidate claims** from 8 successfully reviewed videos (target
was "roughly 10–20" from all 10; on track given 2 videos blocked).

## Contradiction matrix

See `methodology-contradictions-v1.md` for full detail. Summary:

| Concept | Claim A | Claim B | Sources | Conflict type | Human decision needed |
|---|---|---|---|---|---|
| Cueing philosophy | DRV1-001/DRV1-002 (external focus / constraint-based, avoid explicit body cues) | BLM-001 (explicit internal-body coaching cue: "rotate around your center... don't dive your chest") | Driveline Baseball vs. Blast Motion | Substantive — a real disagreement about coaching-cue style, not just wording | Should HitterLoop's own coaching-cue generation lean external-focus (per Driveline's research-supported claim) even when other approved sources give internal-mechanics cues? |

Only one substantive contradiction was identified across these 8 videos;
see the dedicated file for the full reasoning and two additional
"related-but-not-contradictory" notes (early-loading mechanics vs.
timing-approach philosophy; "lunging"/"diving" terminology overlap across
Driveline and Blast Motion).

## Drill summary

| Drill | Source | Intended purpose | Sport | Age caution | Possible HitterLoop match |
|---|---|---|---|---|---|
| Step-Behind Momentum Drill | Driveline Baseball | Momentum transfer via constraint | both | teen+ | needs later drill-library review |
| Underload/Overload Variable Bat Training | Driveline Baseball | Swing-speed/motor adaptability | both | load selection needs adult judgment | needs later drill-library review |
| Step Backs | Driveline Baseball | Fix early loading/timing rhythm | baseball | youth+ (per Gemini; unconfirmed) | needs later drill-library review |
| Modified Hook 'Em | Driveline Baseball | Fix uncontrolled forward move | baseball | youth+ (unconfirmed) | needs later drill-library review |
| Offset Open | Driveline Baseball | Fix spinning off early | baseball | youth+ (unconfirmed) | needs later drill-library review |
| Two Tee Extension Drill | TannerTees | Fix early rollover, teach extension | softball | general | needs later drill-library review |
| PVC Pipe Chest Rotation Drill | Blast Motion | Fix diving/lunging at the ball | both | youth+ | needs later drill-library review |
| 3-Plate Timing Drill | FloCollege \| Softball | General timing adaptability | softball | teen+ | needs later drill-library review |
| Med Ball Jump Back Toss Drill | ABCA | Fix lower-half load/hip rotation | baseball | youth (2–4 lb ball) | needs later drill-library review |
| Med Ball Scoop Toss Drill | ABCA | Fix hip hinge/backside release | baseball | youth (equipment weight matters) | needs later drill-library review |
| Volleyball Knee Squeeze Drill | ABCA | Fix knee flare during stride | baseball | youth-safe | needs later drill-library review |
| Horseshoe Seam Visual Placement Drill | ABCA | Visual tracking during tee work | baseball | general | needs later drill-library review |

No drill was auto-linked to the HitterLoop production drill library, and no
`related_drill_id` was populated anywhere in this document, per the
architecture's Phase-1 decision (drill linkage is a deliberate later
curation step, not part of this review workflow).

## Coverage assessment

| Domain | Covered? | Notes |
|---|---|---|
| Timing/load | **Yes, well** | DRV2-001, GAS-001, ABCA-YT-002; multiple sources, both sports |
| Posture/plane | **Yes** | BLM-001 |
| Contact depth | **Yes** | ABCA-YT-001 (tee-setup convention) |
| Sequencing | **Yes** | SCI-002, DRV1-002 (design-level) |
| Adjustability | **Partial** | ABCA-YT-001 and GAS-001 touch pitch-location/timing adjustability; no single claim addresses in-swing adjustability directly |
| Coach evaluation (how a coach should judge a swing from video) | **Not covered** | No video directly addressed evaluation methodology itself — a real gap |
| Youth fundamentals | **Yes, well** | Video 8 (ABCA) was explicitly strong here as anticipated |
| Softball-specific instruction | **Partial** | TAN-001, GAS-001 cover softball, but Antonelli (blocked) was meant to be the deeper softball-lesson source — that gap is real and should be closed once quota resets |
| Baseball-specific instruction | **Yes, well** | DRV1/DRV2, ABCA-YT, SCI |
| Approach/swing decisions | **Yes, but flagged out-of-current-architecture** | ABCA-LB-001/002 — explicitly not forced into the mechanics taxonomy |

**Honest gaps**: coach-evaluation methodology is not covered by any of the
10 locked videos as reviewed; softball-specific lesson-style content
(Antonelli) is missing this round due to the API-quota block, not a content
decision.

---

# Rejection / weak claim log

Recorded so these aren't rediscovered and re-litigated later:

- **Video 1**: general commentary on pitch-reaction-time physics (taking
  under 0.5s at 80–90mph) — standard physics context, not a novel mechanical
  claim; not elevated to a candidate.
- **Video 4**: Blast Motion's own "on-plane %" sensor metric was explicitly
  NOT extracted as a claim, since it depends on proprietary sensor data
  HitterLoop doesn't have access to — only the sensor-independent drill/
  posture content was kept (BLM-001).
- **Video 9**: both claims (ABCA-LB-001, ABCA-LB-002) — not rejected
  outright, but flagged POSSIBLE FUTURE APPROACH-KNOWLEDGE DOMAIN and
  downgraded to `needs_human_judgment` rather than treated as
  mechanics-analysis-ready, per the task's explicit instruction not to force
  approach content into the mechanics taxonomy.
- **Video 10 (SCI-001)**: the specific 8%/11% energy-loss figures —
  downgraded to `needs_human_judgment`/recommend splitting out entirely,
  since an interview-stated statistic with no checkable methodology is
  exactly the "unsupported numerical norm" the task said to never approve.
- **General**: Gemini's raw `timestampConfidence: "high"` was NOT treated as
  equivalent to human verification anywhere in this document — every claim
  above is still `needs_manual_verification` in the practical sense that no
  human (or independent second source) has confirmed the timestamp against
  the actual video yet.

---

# Videos blocked / unavailable this round

| # | Video | Reason | Retry plan |
|---|---|---|---|
| 5 | Antonelli Softball — Behind the Scenes Softball Lesson | Gemini API `503 UNAVAILABLE` after 4 retries with backoff | Retry `npx tsx scripts/research/extractMethodologySeed.ts tfz7sCIcu8g` once demand subsides or after daily quota resets |
| 7 | Mike Candrea's Ultimate Coaching Clinic | Gemini API `503` then `429 RESOURCE_EXHAUSTED` (free-tier daily quota) | Retry `npx tsx scripts/research/extractMethodologySeed.ts IwEsqGwUZDQ` after quota resets (~24h) or with a paid-tier key |

Neither was silently substituted with a different video.
