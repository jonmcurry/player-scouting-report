# Methodology Human Review Sheet — v1

**Status: REVIEW PREPARATION ONLY.** Nothing in this document is a database
write, an approval, or a rejection. Every claim below remains
`review_status = candidate`, `human_verified = false`, `active = false`
until a human explicitly records APPROVE / EDIT / REJECT below and that
decision is separately entered through `/admin/claim.html` (or a later,
separately-instructed step). No `methodology_claims` row, `methodology_versions`
row, `methodology_version_items` row, `knowledge/claims.json`,
`knowledge/version.json`, active knowledge snapshot, analysis prompt, or
analysis policy was touched to produce this document.

**Source of truth**: `docs/research/methodology-seed-v1.md`,
`methodology-source-registry-v1.md`, `methodology-contradictions-v1.md`,
`methodology-drills-v1.md`, `methodology-seed-v1.import.json`, and
`scripts/research/raw-output/*.json`. Every field below was pulled directly
from those files — cross-checked field-by-field between
`methodology-seed-v1.md` and the import JSON for all 8 claims before writing
this sheet, and they agree on every field (concept, sport_scope,
age_guardrail, evidence_type, numeric_claim, timestamps). No conflict was
found between artifacts for these 8 claims.

**A field this sheet couldn't fill from the artifacts**: none of the
research files define a `classification` value distinct from `evidence_type`
(that's a legacy `knowledge/claims.json` concept —
`CLAIM_CLASSIFICATIONS` in `src/services/knowledge/knowledgePack.js` — not a
column on the new `methodology_claims` table, and not populated anywhere in
this seed's research). Rather than invent one, every claim's "Classification"
line below says so explicitly and points to Evidence type instead.

**Timestamp reality check** (carried forward from `methodology-seed-v1.md`'s
own header): every timestamp below is Gemini's self-reported reading of the
actual video/audio, via its video-input API — no human, and no independent
second model, has watched any of these 8 clips to confirm them. All 8 are
marked "Manual verification status: NOT YET VERIFIED" and must stay that way
until you personally watch each cited range.

---

## Summary table

| Claim ID | Source | Concept | Sport | Age/Level | Observable? | Evidence type | Main caveat | Timestamp verified? | Human decision |
|---|---|---|---|---|---|---|---|---|---|
| DRV2-001 | Driveline Baseball | timing | baseball | teen+ | YES | coaching_heuristic | Causal chain (early load → lunge) is heuristic, not validated research | NO | PENDING |
| TAN-001 | TannerTees | extension | softball | general (youth_appropriate) | YES | coaching_heuristic | "Extension" wording risk; commercial product-placement channel | NO | PENDING |
| GAS-001 | FloCollege \| Softball | timing | softball | HS/college (teen+) | YES | drill_prescription | Source is one ~28s clip — thin, likely excerpted | NO | PENDING |
| ABCA-YT-001 | ABCA | pitch_location_adjustment | baseball | youth | YES | coaching_instruction | None major — cleanest claim in the set | NO | PENDING |
| ABCA-YT-002 | ABCA | load | baseball | youth | YES | drill_prescription | Channel-attribution conflict on this video (ABCA vs. "Golden Spikes Baseball") | NO | PENDING |
| BLM-001 | Blast Motion | posture | both | youth+ | YES | drill_prescription | Cueing-philosophy contradiction with DRV1-001 (internal vs. external focus) | NO | PENDING |
| SCI-002 | Let's Have This Conversation | hip_shoulder_sequencing | both | general (youth_appropriate) | PARTIAL | biomechanical_explanation | Podcast/interview source, not peer-reviewed; "universal" wording | NO | PENDING |
| DRV1-001 | Driveline Baseball | game_approach | both | general (youth_appropriate) | PARTIAL | research_supported (conditional) | Approval should require verifying the on-screen research citations | NO | PENDING |

All 8: **Timestamp verified = NO**, **Human decision = PENDING**.

---

## Metadata conflicts carried forward (visible, not disqualifying)

These do not automatically disqualify the claims below, but you should see
them before deciding:

1. **TannerTees / "MegRem Softball" credit conflict** (affects TAN-001) —
   oEmbed (authoritative) says the publishing channel is TannerTees;
   Gemini's on-screen read said "MegRem Softball." Unresolved — may be the
   instructor's personal/secondary channel.
2. **ABCA / "Golden Spikes Baseball" on-screen credit conflict** (affects
   ABCA-YT-001, ABCA-YT-002) — oEmbed says ABCA; Gemini's on-screen read said
   "Golden Spikes Baseball." Unresolved.
3. **JT Gasso channel labeling correction** (affects GAS-001) — real channel
   is FloCollege \| Softball, not "Oklahoma Softball" (Gemini's read,
   conflating JT Gasso's employer with the publisher) or generic
   "FloSoftball" (an earlier, uncorrected label).
4. **Chad Miller source classification** (affects SCI-002) — confirmed a
   podcast/interview channel ("Let's Have This Conversation"), not a
   research or medical publication, despite the video title containing
   "Science."

---

# Review queue (8 claims, in suggested review order)

--------------------------------------------------
## 1. CLAIM ID: DRV2-001

**Special review note (per your instructions)**: pay attention to
timing/load context. Distinguish an observable timing/load *pattern* from a
*causal explanation*. Do not let the drill prescriptions below generalize
this into a universal mechanic.

### SOURCE
- Source name: Driveline Baseball
- Video title: "3 Drills to Improve Timing and Load When Hitting" (oEmbed/YouTube listing title). Gemini's on-screen read reported a different on-screen segment title, "Helping An Early Hitter" — both recorded in `methodology-seed-v1.md`; no real conflict, just two labels for the same content.
- Video URL: https://www.youtube.com/watch?v=tTBSOTw7XoQ
- Video ID: tTBSOTw7XoQ
- Channel / publisher: Driveline Baseball (oEmbed-verified)
- Metadata confidence: High (title/channel independently verified via YouTube's own oEmbed API)
- Source trust status: `approved_for_scope` (proposed) for timing/load coaching heuristics and cueing philosophy
- Material status: queued (schema default `ingestion_state`; not explicitly assessed in research — this material record has not been formally reviewed as "reviewed"/"extracted" in the `methodology_materials` sense)

### TIMESTAMP TO REVIEW
- Start: 00:28 (28s)
- End: 00:42 (42s)
- Timestamp confidence: Gemini self-reported "high" — NOT independently confirmed
- Manual verification status: **NOT YET VERIFIED**

### CLAIM
- Current candidate claim: "Hitters who consistently swing too early often initiate their load prematurely, leading to an uncontrolled forward move, early back-hip extension, and lunging."
- Concept: timing
- Classification: not tracked as a separate field in methodology_claims (see Evidence type below)
- Evidence type: coaching_heuristic

### APPLICABILITY
- Sport scope: baseball
- Age guardrail: teen_appropriate (research artifact's own reviewer note: Gemini defaulted to broad "youth through advanced," but the research doc recommends `teen_appropriate` pending your judgment, since diagnosing early hip extension is a nuanced call on a young hitter)
- Level scope: youth through advanced (per Gemini's raw extraction) / teen+ recommended
- Applies when: "A hitter is consistently early on pitches and lunging forward into contact."
- Does not apply when: "A hitter is late on pitches or failing to initiate stride in time."

### OBSERVABLE IN HITTERLOOP?
- What ordinary game/practice video evidence would support this claim: Hitter shifting weight forward well before pitch release, back hip extending early, body posture lunging toward the ball — per the research artifact, "genuinely visible in ordinary game/practice video."
- What HitterLoop currently cannot observe: Nothing flagged as unavailable for this specific claim — it's a video-observable pattern, not metric-dependent.
- Does this depend on metrics, 3D, force, bat sensor, pitch tracking, or other unavailable evidence?: No.
- Observable-from-current-inputs assessment: **YES**

### COACHING USE
- Coaching cue from source: None given directly as a quoted cue in the extraction (this is a diagnostic claim, not a cue).
- Drill relationship: All three drills in this video (Step Backs, Modified Hook 'Em, Offset Open) are explicitly tied to this diagnosis per the research artifact.
- Is the cue source-provided or inferred?: N/A — no cue extracted.
- Does the claim describe: **source interpretation** (a causal explanation the source gives for why hitters are early) — the research artifact is explicit that this is "a causal chain, not just an observation."

### CAVEATS / RISKS
- Cause-vs-symptom concern: **Yes, explicitly flagged.** The source frames early loading as the *cause* of forward-move/hip-extension/lunging. This causal claim is coaching heuristic/experience, not independently validated research. The research artifact recommends you explicitly decide whether to preserve it as stated (causal) or soften to "these often co-occur."
- Sport transfer concern: Scoped to baseball only — not claimed for softball.
- Youth/generalization concern: Age guardrail was reviewer-adjusted down from Gemini's broad default; confirm teen_appropriate is right, or relax to youth_appropriate if you judge the diagnostic call is safe for younger hitters too.
- Context dependency: None beyond the stated applies_when/does_not_apply_when.
- Numeric claim concern: None — not a numeric claim.
- Proprietary metric concern: None.
- Contradiction with another candidate: None identified in the contradiction matrix.
- Other caveats: Do not let this diagnosis (or its three tied drills) get generalized into "all early swings are caused by early loading" — the research artifact's own drill descriptions frame these as targeted, not universal.

### WHY THIS CLAIM WAS TRIAGED AS STRONG
Per `methodology-seed-v1.md`: "Clear, internally consistent, drill-actionable." It's directly observable, has three concrete tied drills, and the only real concern (the causal framing) is explicitly named rather than hidden.

### HUMAN CHECKLIST
- [ ] I watched the cited timestamp.
- [ ] The source is represented accurately.
- [ ] The claim is atomic and narrow enough.
- [ ] The claim is observable from HitterLoop-relevant evidence.
- [ ] The sport scope is correct.
- [ ] The age/level guardrail is correct.
- [ ] Applies_when / does_not_apply_when are adequate.
- [ ] The wording does not overstate causation.
- [ ] The claim does not depend on unavailable measurement.
- [ ] I am comfortable allowing this claim to constrain AI analysis.

### HUMAN DECISION
- [ ] APPROVE
- [ ] EDIT
- [ ] REJECT

If EDIT:
- Revised claim:
- Revised sport scope:
- Revised age/level scope:
- Revised applies_when:
- Revised does_not_apply_when:
- Revised classification:
- Revised evidence type:
- Reviewer notes:

Reviewer:
Review date:

--------------------------------------------------
## 2. CLAIM ID: TAN-001

**Special review note (per your instructions)**: clarify exactly what
"extension" means in the source. Avoid ambiguous baseball/softball coaching
shorthand. Separate drill instruction from mechanical truth.

### SOURCE
- Source name: TannerTees (channel), featuring instructor Megan Rembielak
- Video title: "Two Tee Extension Drill with Megan Rembielak using a Tanner Tee | Softball Hitting Drills" (oEmbed). Gemini's on-screen read reported "Softball Hitting Drill for Extension" — different wording, same content, no real conflict.
- Video URL: https://www.youtube.com/watch?v=22bq90ojT_o
- Video ID: 22bq90ojT_o
- Channel / publisher: TannerTees (oEmbed-verified) — see the metadata conflict above re: "MegRem Softball"
- Metadata confidence: High for the channel/title (oEmbed); LOW for whether "MegRem Softball" is a distinct, relevant channel
- Source trust status: `candidate` (proposed) — commercial equipment-brand channel, single instructor/video, not yet cross-checked against an independent source
- Material status: queued (schema default; not explicitly assessed)

### TIMESTAMP TO REVIEW
- Start: 00:07 (7s)
- End: 00:43 (43s)
- Timestamp confidence: Gemini self-reported "high" — NOT independently confirmed
- Manual verification status: **NOT YET VERIFIED**

### CLAIM
- Current candidate claim: "Extending the bat barrel through the hitting zone after contact optimizes power and directional ball flight while preventing premature wrist rollover."
- Concept: extension
- Classification: not tracked as a separate field in methodology_claims (see Evidence type below)
- Evidence type: coaching_heuristic

### APPLICABILITY
- Sport scope: **softball** — reviewer-downgraded from Gemini's `both` (Gemini's raw extraction marked this `both`; the research doc explicitly recommends `softball` since the video is softball-specific instruction using a softball-specific product, per the task's "be conservative with both" principle). **You are the one who should make this final call.**
- Age guardrail: youth_appropriate
- Level scope: general
- Applies when: "Executing swing follow-through and extension on pitches through the middle of the zone."
- Does not apply when: "Adjusting to extreme inside pitch locations where hand path must clear tightly."

### OBSERVABLE IN HITTERLOOP?
- What ordinary game/practice video evidence would support this claim: Bat barrel path continuing forward toward the pitcher after contact with extended arms prior to the finish roll-over — explicitly noted as "visible in ordinary video, including HitterLoop's own contact/extension swing-phase stills."
- What HitterLoop currently cannot observe: Nothing flagged as unavailable.
- Does this depend on metrics, 3D, force, bat sensor, pitch tracking, or other unavailable evidence?: No.
- Observable-from-current-inputs assessment: **YES**

### COACHING USE
- Coaching cue from source: "Drive the barrel through the tunnel from home to the pitcher."
- Drill relationship: The Two Tee Extension Drill itself (two batting tees, two softballs, using the Tanner Tee product).
- Is the cue source-provided or inferred?: Source-provided.
- Does the claim describe: **coaching cue + drill prescription** (the claim states the mechanical rationale; the cue and drill operationalize it).

### CAVEATS / RISKS
- Cause-vs-symptom concern: Premature wrist roll is framed as a *symptom* of poor barrel path/rotational casting, not re-labeled as a root cause — the research artifact calls this "appropriately careful."
- Sport transfer concern: **Yes — this is the primary open question.** See sport_scope above; the artifact recommends softball-only pending your confirmation.
- Youth/generalization concern: None flagged beyond the general "extension" ambiguity risk below.
- Context dependency: Explicitly does not apply to extreme inside pitches.
- Numeric claim concern: None — not numeric.
- Proprietary metric concern: None.
- Contradiction with another candidate: None identified.
- Other caveats: **"Extension" ambiguity.** The research artifact is explicit that this claim's specific meaning is "barrel-path direction/duration through the zone post-contact," not "arm-extension-as-a-goal" in isolation, and not a vague universal ideal — worth confirming the current claim wording preserves that specific meaning rather than drifting into generic "extend your arms" language. Also a real commercial angle: the drill uses a branded product (Tanner Tee), a product-placement consideration for the source (not necessarily the claim's validity).

### WHY THIS CLAIM WAS TRIAGED AS STRONG
Per `methodology-seed-v1.md`: this is "exactly the 'what does extension mean' question the task flagged" — and the research found a concrete, specific, non-vague answer worth preserving, rather than a generic platitude.

### HUMAN CHECKLIST
- [ ] I watched the cited timestamp.
- [ ] The source is represented accurately.
- [ ] The claim is atomic and narrow enough.
- [ ] The claim is observable from HitterLoop-relevant evidence.
- [ ] The sport scope is correct.
- [ ] The age/level guardrail is correct.
- [ ] Applies_when / does_not_apply_when are adequate.
- [ ] The wording does not overstate causation.
- [ ] The claim does not depend on unavailable measurement.
- [ ] I am comfortable allowing this claim to constrain AI analysis.

### HUMAN DECISION
- [ ] APPROVE
- [ ] EDIT
- [ ] REJECT

If EDIT:
- Revised claim:
- Revised sport scope:
- Revised age/level scope:
- Revised applies_when:
- Revised does_not_apply_when:
- Revised classification:
- Revised evidence type:
- Reviewer notes:

Reviewer:
Review date:

--------------------------------------------------
## 3. CLAIM ID: GAS-001

**Special review note (per your instructions)**: treat this as
softball-specific unless the source clearly supports broader transfer.
Focus on pitch depth / plate coverage / adjustability. Note that the drill
may be more advanced than the underlying claim.

### SOURCE
- Source name: FloCollege | Softball (FloSports network), featuring JT Gasso (Oklahoma Softball hitting coach)
- Video title: "JT Gasso Hitting Technique: 3-Plate Drill" (oEmbed-verified)
- Video URL: https://www.youtube.com/watch?v=RtQUfmkqX0s
- Video ID: RtQUfmkqX0s
- Channel / publisher: FloCollege | Softball (oEmbed-verified) — see JT Gasso channel conflict above; the real publisher is the FloSports network, JT Gasso is the featured coach, not the channel owner
- Metadata confidence: High for channel/title; **LOW for publish date** (an unconfirmed secondhand "~Dec 2017" figure exists but is explicitly not trusted — `published_at` should stay UNKNOWN)
- Source trust status: `candidate` (proposed)
- Material status: queued (schema default; not explicitly assessed) — research artifact flags this source as "may be too thin (one short clip) to justify `approved_for_scope` at the source level yet"

### TIMESTAMP TO REVIEW
- Start: 00:15 (15s)
- End: 00:28 (28s)
- Timestamp confidence: Gemini self-reported "high" — NOT independently confirmed
- Manual verification status: **NOT YET VERIFIED**

### CLAIM
- Current candidate claim: "Moving hitters between three different plate distances during toss drills trains their ability to adjust swing timing and rhythm relative to pitch arrival time."
- Concept: timing
- Classification: not tracked as a separate field in methodology_claims (see Evidence type below)
- Evidence type: drill_prescription

### APPLICABILITY
- Sport scope: **softball** — the research artifact did not find broader baseball-transfer support in this clip; keep softball-specific unless you judge otherwise.
- Age guardrail: teen_appropriate
- Level scope: high school, travel ball, college
- Applies when: "Practicing timing rhythm and reaction-time adjustments during front toss or live pitching practice."
- Does not apply when: "Isolating stationary swing mechanics on a tee where pitch arrival time is not a factor."

### OBSERVABLE IN HITTERLOOP?
- What ordinary game/practice video evidence would support this claim: "A hitter taking swings sequentially from three different home-plate markers at varied distances from the front-toss screen — directly visible drill structure."
- What HitterLoop currently cannot observe: Nothing flagged as unavailable — this is drill-structure, not a swing-mechanics measurement.
- Does this depend on metrics, 3D, force, bat sensor, pitch tracking, or other unavailable evidence?: No.
- Observable-from-current-inputs assessment: **YES**

### COACHING USE
- Coaching cue from source: None given directly (a drill-structure claim, not a verbal cue).
- Drill relationship: The 3-Plate Timing Drill itself — 3 home plates at varying distances, softballs, front-toss screen, bat.
- Is the cue source-provided or inferred?: N/A — no cue extracted.
- Does the claim describe: **drill prescription** (pure drill-structure claim, no causal mechanics diagnosis per the artifact).

### CAVEATS / RISKS
- Cause-vs-symptom concern: n/a — pure drill-structure claim.
- Sport transfer concern: Yes — kept softball-only pending stronger evidence.
- Youth/generalization concern: Level scope is HS/college/travel-ball, not youth — do not relax this without new evidence, since the drill's timing-adaptability demands may be more advanced than a young hitter needs.
- Context dependency: Explicitly does not apply to tee-only stationary work.
- Numeric claim concern: None.
- Proprietary metric concern: None.
- Contradiction with another candidate: None identified.
- Other caveats: **Source is thin** — only ~28 seconds of usable content in the accessible clip, "almost certainly an excerpt/highlight clip rather than a full lesson." The claim itself is solid, but the research artifact recommends NOT extending `approved_for_scope` to this source generally on the strength of one short clip. Also worth noting: the *drill* (moving between three plate positions to adjust timing) may demand more swing-adjustability skill than the underlying claim ("timing/tempo need to adjust for pitch distance") strictly requires — consider whether the claim and the specific drill should be evaluated somewhat separately.

### WHY THIS CLAIM WAS TRIAGED AS STRONG
Per `methodology-seed-v1.md`: "concrete, named timing-adjustment drill from a credentialed college hitting coach" with a directly observable drill structure and no causal overreach.

### HUMAN CHECKLIST
- [ ] I watched the cited timestamp.
- [ ] The source is represented accurately.
- [ ] The claim is atomic and narrow enough.
- [ ] The claim is observable from HitterLoop-relevant evidence.
- [ ] The sport scope is correct.
- [ ] The age/level guardrail is correct.
- [ ] Applies_when / does_not_apply_when are adequate.
- [ ] The wording does not overstate causation.
- [ ] The claim does not depend on unavailable measurement.
- [ ] I am comfortable allowing this claim to constrain AI analysis.

### HUMAN DECISION
- [ ] APPROVE
- [ ] EDIT
- [ ] REJECT

If EDIT:
- Revised claim:
- Revised sport scope:
- Revised age/level scope:
- Revised applies_when:
- Revised does_not_apply_when:
- Revised classification:
- Revised evidence type:
- Reviewer notes:

Reviewer:
Review date:

--------------------------------------------------
## 4. CLAIM ID: ABCA-YT-001

**Special review note (per your instructions)**: keep youth applicability
conservative. Do not turn a coaching baseline into a rigid universal rule.

### SOURCE
- Source name: American Baseball Coaches Association (ABCA)
- Video title: "Youth Practice Plan Series | Hitting Tips" (oEmbed-verified)
- Video URL: https://www.youtube.com/watch?v=7J-JoyaSabA
- Video ID: 7J-JoyaSabA
- Channel / publisher: American Baseball Coaches Association (oEmbed-verified) — see the "Golden Spikes Baseball" on-screen-credit conflict above, unresolved
- Metadata confidence: High for channel/title (oEmbed); **unresolved** for who actually produced/taught the content (see conflict)
- Source trust status: `approved_for_scope` (proposed) for baseball youth-practice fundamentals
- Material status: queued (schema default; not explicitly assessed)

### TIMESTAMP TO REVIEW
- Start: 06:18 (378s)
- End: 08:20 (500s)
- Timestamp confidence: Gemini self-reported "high" — NOT independently confirmed
- Manual verification status: **NOT YET VERIFIED**

### CLAIM
- Current candidate claim: "Adjust contact points on a batting tee according to pitch location: outside pitches off the lead hip, middle pitches off the lead foot, and inside pitches out in front of the lead foot."
- Concept: pitch_location_adjustment
- Classification: not tracked as a separate field in methodology_claims (see Evidence type below)
- Evidence type: coaching_instruction

### APPLICABILITY
- Sport scope: baseball
- Age guardrail: youth_appropriate
- Level scope: youth and amateur
- Applies when: "Setting up batting-tee drills for specific pitch-location practice."
- Does not apply when: "Practicing dynamic pitch recognition or live-pitching hitting without controlled tee setups."

### OBSERVABLE IN HITTERLOOP?
- What ordinary game/practice video evidence would support this claim: "Positioning of the batting tee relative to the hitter's front foot/lead hip across different pitch locations" — a tee-setup convention, not a live-swing observation per se, but genuinely visible practice-design guidance.
- What HitterLoop currently cannot observe: Nothing flagged as unavailable.
- Does this depend on metrics, 3D, force, bat sensor, pitch tracking, or other unavailable evidence?: No.
- Observable-from-current-inputs assessment: **YES**

### COACHING USE
- Coaching cue from source: "Outside off lead hip, middle off lead foot, inside out front."
- Drill relationship: The tee-setup convention described alongside the "Horseshoe Seam Visual Placement Drill" (see `methodology-drills-v1.md`).
- Is the cue source-provided or inferred?: Source-provided.
- Does the claim describe: **coaching cue** (a concrete, actionable practice-setup rule).

### CAVEATS / RISKS
- Cause-vs-symptom concern: n/a — practice-setup convention, not a mechanics diagnosis.
- Sport transfer concern: Kept baseball-only, consistent with ABCA's own scope (do not extend to softball per the source registry's explicit caution).
- Youth/generalization concern: **This is the special review note above** — this is a solid, simple, conservative youth baseline per the research artifact ("clear, concrete, genuinely youth-appropriate, easy for a coach to apply without any special equipment"), but keep it as *one useful tee-setup convention*, not an inflexible universal rule for every hitter/situation.
- Context dependency: Explicitly scoped to tee work, not live pitching.
- Numeric claim concern: None.
- Proprietary metric concern: None.
- Contradiction with another candidate: None identified.
- Other caveats: The channel-attribution conflict above (ABCA vs. "Golden Spikes Baseball") applies to this claim's material — worth resolving before finalizing provenance, per the research artifact's own human-review note for Video 8.

### WHY THIS CLAIM WAS TRIAGED AS STRONG
Per `methodology-seed-v1.md`: explicitly the cleanest, most concrete, lowest-risk claim in this set — a simple coaching convention with no causal claims, no numeric claims, and no equipment beyond a tee.

### HUMAN CHECKLIST
- [ ] I watched the cited timestamp.
- [ ] The source is represented accurately.
- [ ] The claim is atomic and narrow enough.
- [ ] The claim is observable from HitterLoop-relevant evidence.
- [ ] The sport scope is correct.
- [ ] The age/level guardrail is correct.
- [ ] Applies_when / does_not_apply_when are adequate.
- [ ] The wording does not overstate causation.
- [ ] The claim does not depend on unavailable measurement.
- [ ] I am comfortable allowing this claim to constrain AI analysis.

### HUMAN DECISION
- [ ] APPROVE
- [ ] EDIT
- [ ] REJECT

If EDIT:
- Revised claim:
- Revised sport scope:
- Revised age/level scope:
- Revised applies_when:
- Revised does_not_apply_when:
- Revised classification:
- Revised evidence type:
- Reviewer notes:

Reviewer:
Review date:

--------------------------------------------------
## 5. CLAIM ID: ABCA-YT-002

**Special review note (per your instructions)**: keep youth applicability
conservative. Separate practice instruction from evidence that a mechanic is
universally correct.

### SOURCE
- Source name: American Baseball Coaches Association (ABCA)
- Video title: "Youth Practice Plan Series | Hitting Tips" (oEmbed-verified)
- Video URL: https://www.youtube.com/watch?v=7J-JoyaSabA
- Video ID: 7J-JoyaSabA
- Channel / publisher: American Baseball Coaches Association (oEmbed-verified) — same "Golden Spikes Baseball" on-screen-credit conflict as ABCA-YT-001, unresolved
- Metadata confidence: High for channel/title; unresolved production-credit question
- Source trust status: `approved_for_scope` (proposed) for baseball youth-practice fundamentals
- Material status: queued (schema default; not explicitly assessed)

### TIMESTAMP TO REVIEW
- Start: 00:58 (58s)
- End: 02:30 (150s)
- Timestamp confidence: Gemini self-reported "high" — NOT independently confirmed
- Manual verification status: **NOT YET VERIFIED**

### CLAIM
- Current candidate claim: "Using a jump-back medicine-ball toss teaches hitters to load into the back hip and maintain weight on the inside of the back knee."
- Concept: load
- Classification: not tracked as a separate field in methodology_claims (see Evidence type below)
- Evidence type: drill_prescription

### APPLICABILITY
- Sport scope: baseball
- Age guardrail: youth_appropriate
- Level scope: youth (with reduced medicine-ball weight, 2–4 lbs per the source, per Gemini's extraction)
- Applies when: "Developing dynamic lower-half loading and back-hip weight distribution."
- Does not apply when: "Players lack basic lower-body balance or have joint issues requiring physical screening."

### OBSERVABLE IN HITTERLOOP?
- What ordinary game/practice video evidence would support this claim: "Hitter jumping back onto the rear leg, hinging at the back hip without the knee collapsing outward, before throwing the medicine ball" — a visible drill-execution pattern.
- What HitterLoop currently cannot observe: Nothing flagged as unavailable.
- Does this depend on metrics, 3D, force, bat sensor, pitch tracking, or other unavailable evidence?: No.
- Observable-from-current-inputs assessment: **YES**

### COACHING USE
- Coaching cue from source: "Jump back and load into your back hip."
- Drill relationship: The Med Ball Jump Back Toss Drill itself — light medicine ball (2–4 lbs), net or wall.
- Is the cue source-provided or inferred?: Source-provided.
- Does the claim describe: **drill prescription** (a specific drill teaching a specific loading pattern).

### CAVEATS / RISKS
- Cause-vs-symptom concern: Uses a physical-movement constraint (the jump-back action) to *cause* proper hip loading — a constraint-based teaching approach, similar in spirit to Video 1's (Driveline) and Video 4's (Blast Motion) constraint-based framing. Not flagged as a problematic causal overreach.
- Sport transfer concern: Kept baseball-only, consistent with ABCA's own scope.
- Youth/generalization concern: **This is the special review note above.** This is drill instruction demonstrated with youth players and a concrete youth-safety detail (2–4 lb medicine ball) — but per your instruction, separate "this drill is a reasonable way to teach a loading pattern" from "back-hip loading in this exact form is universally correct mechanics" before approving. The claim as worded is about what the *drill* teaches, not a universal mechanical prescription.
- Context dependency: Explicitly excludes players with joint issues requiring physical screening — good, conservative exclusion already present.
- Numeric claim concern: None — the 2–4 lb figure is recorded as equipment/safety guidance, not flagged as a normative biomechanical numeric claim.
- Proprietary metric concern: None.
- Contradiction with another candidate: None identified.
- Other caveats: Same channel-attribution conflict as ABCA-YT-001 applies to this claim's material.

### WHY THIS CLAIM WAS TRIAGED AS STRONG
Per `methodology-seed-v1.md`: concrete, youth-demonstrated, with an explicit, sensible physical-screening exclusion and a real equipment-safety detail (2–4 lb ball) worth preserving.

### HUMAN CHECKLIST
- [ ] I watched the cited timestamp.
- [ ] The source is represented accurately.
- [ ] The claim is atomic and narrow enough.
- [ ] The claim is observable from HitterLoop-relevant evidence.
- [ ] The sport scope is correct.
- [ ] The age/level guardrail is correct.
- [ ] Applies_when / does_not_apply_when are adequate.
- [ ] The wording does not overstate causation.
- [ ] The claim does not depend on unavailable measurement.
- [ ] I am comfortable allowing this claim to constrain AI analysis.

### HUMAN DECISION
- [ ] APPROVE
- [ ] EDIT
- [ ] REJECT

If EDIT:
- Revised claim:
- Revised sport scope:
- Revised age/level scope:
- Revised applies_when:
- Revised does_not_apply_when:
- Revised classification:
- Revised evidence type:
- Reviewer notes:

Reviewer:
Review date:

--------------------------------------------------
## 6. CLAIM ID: BLM-001

**Special review note (per your instructions)**: flag the known
cueing-philosophy tension — Driveline external-focus research framing
(DRV1-001) vs. Blast Motion's explicit internal-mechanics cue here. **This
sheet does not resolve that contradiction for you.** Decide for yourself
whether this claim should survive even though its cue is arguably
context-dependent.

### SOURCE
- Source name: Blast Motion
- Video title: "Youth Hitting Drills - Swing Plane" (oEmbed-verified)
- Video URL: https://www.youtube.com/watch?v=NThwdXRo0b8
- Video ID: NThwdXRo0b8
- Channel / publisher: Blast Motion (oEmbed-verified, no conflict — Gemini's "Blast Motion PVC Pipe On-Plane Drill" is just a more specific on-screen description, same substance)
- Metadata confidence: High
- Source trust status: `limited` (proposed) — good specifically for non-metric-dependent drill content; do NOT extend blanket approval to this source's proprietary-metric claims
- Material status: queued (schema default; not explicitly assessed)

### TIMESTAMP TO REVIEW
- Start: 00:52 (52s)
- End: 01:45 (105s)
- Timestamp confidence: Gemini self-reported "high" — NOT independently confirmed
- Manual verification status: **NOT YET VERIFIED**

### CLAIM
- Current candidate claim: "Hitters should adjust swing plane to different pitch locations through torso rotation and body posture rather than diving their chest forward toward the ball."
- Concept: posture
- Classification: not tracked as a separate field in methodology_claims (see Evidence type below)
- Evidence type: drill_prescription

### APPLICABILITY
- Sport scope: both
- Age guardrail: youth_appropriate
- Level scope: youth through advanced
- Applies when: "Working on swing plane control, torso rotation, and pitch location adjustment."
- Does not apply when: "Full game situations where timing and stride dynamics vary unpredictably."

### OBSERVABLE IN HITTERLOOP?
- What ordinary game/practice video evidence would support this claim: "Maintaining spinal posture during torso rotation, chest not lunging forward toward the ball, across different tee locations" — explicitly confirmed genuinely visible in ordinary video, **without** any Blast sensor data (the task's proprietary-metric caution for this source was checked and confirmed not to apply to this specific claim).
- What HitterLoop currently cannot observe: Nothing flagged as unavailable for this specific claim.
- Does this depend on metrics, 3D, force, bat sensor, pitch tracking, or other unavailable evidence?: No — explicitly verified NOT to depend on Blast's proprietary metrics.
- Observable-from-current-inputs assessment: **YES**

### COACHING USE
- Coaching cue from source: "Rotate around your center so the pipe comes to the tee—don't dive your chest forward."
- Drill relationship: The PVC Pipe Chest Rotation Drill itself (PVC pipe, batting tee).
- Is the cue source-provided or inferred?: Source-provided.
- Does the claim describe: **coaching cue** — and specifically, **this cue is an explicit internal/body-mechanics instruction** ("rotate around your center," "don't dive your chest forward").

### CAVEATS / RISKS
- Cause-vs-symptom concern: "Diving at the ball" is framed as a mechanical fault caused by reaching with the chest instead of rotating — a constraint-based correction, consistent in spirit with Video 1's own constraint-based philosophy.
- Sport transfer concern: None flagged — marked `both` in the source artifact.
- Youth/generalization concern: None beyond the general contradiction note below.
- Context dependency: Explicitly does not apply to full-game situations with unpredictable timing/stride.
- Numeric claim concern: None.
- Proprietary metric concern: **Checked and cleared for this specific claim** — the research explicitly excluded Blast's "on-plane %" sensor metric from this claim (see the rejection log in `methodology-seed-v1.md`), keeping only the sensor-independent drill/posture content.
- Contradiction with another candidate: **Yes — flagged in `methodology-contradictions-v1.md`.** This claim's coaching cue is an explicit internal-body-mechanics instruction, which sits in substantive tension with DRV1-001's (Driveline) research-supported claim that external-focus (outcome-based) cues produce superior force/sequencing versus internal-focus (body-mechanics) cues. **The contradiction file frames the open question as**: "Should HitterLoop's own coaching-cue generation lean external-focus (per Driveline's research-supported claim) even when other approved sources give internal-mechanics cues?" This sheet does not answer that for you.
- Other caveats: None beyond the above.

### WHY THIS CLAIM WAS TRIAGED AS STRONG
Per `methodology-seed-v1.md`: "Solid, youth-appropriate, drill-actionable, genuinely observable without proprietary sensor data" — the contradiction with DRV1-001 is a real open question, not a defect in this claim's own internal quality.

### HUMAN CHECKLIST
- [ ] I watched the cited timestamp.
- [ ] The source is represented accurately.
- [ ] The claim is atomic and narrow enough.
- [ ] The claim is observable from HitterLoop-relevant evidence.
- [ ] The sport scope is correct.
- [ ] The age/level guardrail is correct.
- [ ] Applies_when / does_not_apply_when are adequate.
- [ ] The wording does not overstate causation.
- [ ] The claim does not depend on unavailable measurement.
- [ ] I am comfortable allowing this claim to constrain AI analysis.

### HUMAN DECISION
- [ ] APPROVE
- [ ] EDIT
- [ ] REJECT

If EDIT:
- Revised claim:
- Revised sport scope:
- Revised age/level scope:
- Revised applies_when:
- Revised does_not_apply_when:
- Revised classification:
- Revised evidence type:
- Reviewer notes:

Reviewer:
Review date:

--------------------------------------------------
## 7. CLAIM ID: SCI-002

**Special review note (per your instructions)**: explicitly distinguish
coaching explanation from scientific evidence. The source is a podcast/
interview channel, not a peer-reviewed research source. Do not upgrade
evidence_type to research_supported unless independent source support
exists.

### SOURCE
- Source name: "Let's Have This Conversation" (podcast), guest Chad Miller (founder, Louisville Slugger Hitting Science Center)
- Video title: "The Science Behind Hitting in Baseball with: Chad Miller" (oEmbed-verified)
- Video URL: https://www.youtube.com/watch?v=fETlemtrceo
- Video ID: fETlemtrceo
- Channel / publisher: "Let's Have This Conversation" (oEmbed-verified) — see Chad Miller source-classification conflict above (already resolved by this research, not open, but worth restating: it is NOT a research channel)
- Metadata confidence: High for channel/title; host name ("Tevin McChan" per Gemini) not independently verified
- Source trust status: `limited` (proposed) — reasonable for qualitative kinetic-chain framing, explicitly NOT for numeric normative claims without further verification
- Material status: queued (schema default; not explicitly assessed)

### TIMESTAMP TO REVIEW
- Start: 15:43 (943s)
- End: 16:10 (970s)
- Timestamp confidence: Gemini self-reported "high" — NOT independently confirmed
- Manual verification status: **NOT YET VERIFIED**

### CLAIM
- Current candidate claim: "Optimal hitting mechanics rely on a kinetic-chain sequence transferring energy from the ground through the hips, shoulders, hands, and barrel."
- Concept: hip_shoulder_sequencing
- Classification: not tracked as a separate field in methodology_claims (see Evidence type below)
- Evidence type: biomechanical_explanation (deliberately NOT `research_supported` — see caveats)

### APPLICABILITY
- Sport scope: both
- Age guardrail: youth_appropriate
- Level scope: general — Gemini's own extraction called this a "universal mechanical principle"; the research artifact recommends you consider softening "universal" language, since few biomechanical claims are truly universal without exception.
- Applies when: "Executing a full-effort rotational swing."
- Does not apply when: "Executing check swings, bunts, or emergency contact swings."

### OBSERVABLE IN HITTERLOOP?
- What ordinary game/practice video evidence would support this claim: "High-speed video showing sequential rotation — ground drive, lead-hip turn, trunk rotation, hand acceleration, barrel delivery."
- What HitterLoop currently cannot observe: HitterLoop's analysis path does not currently receive validated stored swing metrics or 3D reconstruction evidence (a repo-wide, pre-existing limitation, not specific to this claim) — sequencing as a qualitative visual pattern is still assessed as observable from ordinary video, but a precise, measured kinetic-chain timing sequence is not something HitterLoop currently measures.
- Does this depend on metrics, 3D, force, bat sensor, pitch tracking, or other unavailable evidence?: The claim itself is stated qualitatively (a general pattern), not tied to specific measured values, so it does not strictly require unavailable measurement — but see the PARTIAL rating below.
- Observable-from-current-inputs assessment: **PARTIAL** — the general sequencing *pattern* is visually inferable, but confirming "optimal" sequencing precisely would require measurement HitterLoop doesn't currently have; a coach can plausibly judge the qualitative pattern from video alone, which is why this isn't rated NO.

### COACHING USE
- Coaching cue from source: "Drive from the ground up through hips, shoulders, and hands."
- Drill relationship: None — interview format, no drill demonstrated.
- Is the cue source-provided or inferred?: Source-provided.
- Does the claim describe: **biomechanical explanation** (a general kinetic-chain description) — per the research artifact, this is "widely consistent with mainstream hitting-mechanics teaching (not a novel or contested claim)."

### CAVEATS / RISKS
- Cause-vs-symptom concern: Proximal-to-distal sequencing framed as the underlying cause of efficient bat speed/barrel extension — "standard, uncontroversial framing in hitting mechanics generally," per the artifact.
- Sport transfer concern: None flagged — marked `both`.
- Youth/generalization concern: "Universal" language flagged for possible softening (see Level scope above).
- Context dependency: Explicitly excludes check swings/bunts/emergency contact.
- Numeric claim concern: None — this claim itself is non-numeric (contrast with SCI-001, the sibling claim from the same video that WAS downgraded specifically for its numeric 8%/11% figures and is deferred, not in this review queue).
- Proprietary metric concern: None.
- Contradiction with another candidate: None identified — broadly compatible with DRV1-002's constraint-based sequencing philosophy (not itself in this review queue).
- Other caveats: **This is the special-review-note item.** The source is confirmed to be a podcast/interview, not a research publication — `evidence_type` is deliberately kept at `biomechanical_explanation`, not upgraded to `research_supported`. Do not change that without independently locating actual supporting research, and do not let the general safety of this claim's content imply the *source* itself should be trusted for other, less-safe claims (e.g. SCI-001's numeric figures from the same video).

### WHY THIS CLAIM WAS TRIAGED AS STRONG
Per `methodology-seed-v1.md`: "much safer claim than SCI-001 — general kinetic-chain sequencing is uncontroversial, non-numeric, and doesn't hinge on the interview format's evidentiary weaknesses the way SCI-001 does."

### HUMAN CHECKLIST
- [ ] I watched the cited timestamp.
- [ ] The source is represented accurately.
- [ ] The claim is atomic and narrow enough.
- [ ] The claim is observable from HitterLoop-relevant evidence.
- [ ] The sport scope is correct.
- [ ] The age/level guardrail is correct.
- [ ] Applies_when / does_not_apply_when are adequate.
- [ ] The wording does not overstate causation.
- [ ] The claim does not depend on unavailable measurement.
- [ ] I am comfortable allowing this claim to constrain AI analysis.

### HUMAN DECISION
- [ ] APPROVE
- [ ] EDIT
- [ ] REJECT

If EDIT:
- Revised claim:
- Revised sport scope:
- Revised age/level scope:
- Revised applies_when:
- Revised does_not_apply_when:
- Revised classification:
- Revised evidence type:
- Reviewer notes:

Reviewer:
Review date:

--------------------------------------------------
## 8. CLAIM ID: DRV1-001

**Special review note (per your instructions)**: this was marked strong
only *conditionally*. Approval should require you to personally verify any
on-screen research citations or source references before accepting this
claim. Do not treat it as research-supported unless the cited research is
actually identifiable and actually supports the exact claim as worded.

### SOURCE
- Source name: Driveline Baseball
- Video title: "How To Coach Hitting Mechanics Pt. 1 | Driveline Baseball" (oEmbed-verified). Gemini's on-screen read reported a more specific title, "Coaching Hitting Mechanics with Jason Ochart Pt. 1" — likely naming the on-screen presenter; **the presenter's identity (Jason Ochart) is not independently confirmed** and should be checked before citing him by name anywhere.
- Video URL: https://www.youtube.com/watch?v=tXKjS3iKgAk
- Video ID: tXKjS3iKgAk
- Channel / publisher: Driveline Baseball (oEmbed-verified)
- Metadata confidence: High for channel/title; **LOW for presenter identity and for the specific cited research**
- Source trust status: `approved_for_scope` (proposed) for timing/load coaching heuristics and cueing philosophy
- Material status: queued (schema default; not explicitly assessed)

### TIMESTAMP TO REVIEW
- Start: 00:38 (38s)
- End: 01:03 (63s)
- Timestamp confidence: Gemini self-reported "high" — NOT independently confirmed
- Manual verification status: **NOT YET VERIFIED**

### CLAIM
- Current candidate claim: "External focus cues (focusing on ball flight or target outcome) promote superior force production and movement sequencing compared to internal focus cues (focusing on body mechanics)."
- Concept: game_approach
- Classification: not tracked as a separate field in methodology_claims (see Evidence type below)
- Evidence type: research_supported **— conditional, see caveats below; this is the field most likely to need an EDIT down to `coaching_heuristic` or `expert_opinion` if the citations can't be verified**

### APPLICABILITY
- Sport scope: both
- Age guardrail: youth_appropriate
- Level scope: general
- Applies when: "Delivering verbal feedback during batting practice, cage work, or game preparation."
- Does not apply when: "Conducting explicit body-awareness drills or physical therapy screenings where internal focus is intentionally required."

### OBSERVABLE IN HITTERLOOP?
- What ordinary game/practice video evidence would support this claim: None directly — per the research artifact, "this is about how HitterLoop-authored coaching cues should be worded, not something visible in swing video itself."
- What HitterLoop currently cannot observe: The claim is not itself a video-observable swing pattern; it's a claim about coaching-cue *effectiveness*, which HitterLoop has no mechanism to measure from video at all (no before/after force-production comparison, no motor-learning outcome tracking).
- Does this depend on metrics, 3D, force, bat sensor, pitch tracking, or other unavailable evidence?: The claim's *underlying evidentiary basis* (the cited research) presumably relies on force/motor-learning measurement done in that research — not something HitterLoop itself measures, but also not something HitterLoop needs to measure to use this as a cueing-language guideline.
- Observable-from-current-inputs assessment: **PARTIAL** — not observable as a swing pattern, but usable as a language/cueing-policy claim rather than a claim about what's visible in any specific clip. Rated PARTIAL rather than NO because the claim can still meaningfully constrain how HitterLoop *phrases* AI-drafted coaching cues, even without being visually verifiable per-swing.

### COACHING USE
- Coaching cue from source: "Focus on ball flight trajectory and where you want to hit the ball rather than internal body movement."
- Drill relationship: None directly — a cueing-philosophy claim, not a drill.
- Is the cue source-provided or inferred?: Source-provided.
- Does the claim describe: **source interpretation** presented as research-grounded — the research artifact frames this as the source citing external motor-learning literature (Wulf 2010, Wu 2012, Castaneda & Gray 2007) to support a general cueing principle.

### CAVEATS / RISKS
- Cause-vs-symptom concern: n/a — cueing-methodology claim, not a mechanics diagnosis.
- Sport transfer concern: None flagged — marked `both`.
- Youth/generalization concern: None flagged beyond the general evidentiary caveat below.
- Context dependency: Explicitly excludes body-awareness drills/PT screening, where internal focus is intentionally needed.
- Numeric claim concern: None — not numeric.
- Proprietary metric concern: None.
- Contradiction with another candidate: **Yes — flagged in `methodology-contradictions-v1.md`.** This claim's external-focus framing sits in tension with BLM-001's explicit internal-mechanics coaching cue (see BLM-001 above for the full framing). This sheet does not resolve that for you.
- Other caveats: **This is the central caveat for this claim.** Gemini reports the video shows on-screen citations to specific motor-learning research (Wulf 2010, Wu 2012, Castaneda & Gray 2007). External-focus-of-attention research is a real, substantial, well-established body of work in sports science (Gabriele Wulf's research program is genuinely extensive) — which makes `research_supported` *plausible*. But **nobody on the research or review side of this process has personally watched the video to confirm those exact citations actually appear on screen, or that they actually support this exact claim as worded** (rather than a related-but-different one). Per your explicit instruction: approval should require you to verify this directly before accepting `research_supported` as the evidence_type.

### WHY THIS CLAIM WAS TRIAGED AS STRONG
Per `methodology-seed-v1.md`: triaged as strong on the strength of citing real, credible research literature — but explicitly flagged with a **conditional** approval-readiness the whole time, not an unconditional one. It is included in this review queue (rather than the deferred appendix) because the underlying claim quality is genuinely good, not because the citation question has been resolved.

### HUMAN CHECKLIST
- [ ] I watched the cited timestamp.
- [ ] The source is represented accurately.
- [ ] The claim is atomic and narrow enough.
- [ ] The claim is observable from HitterLoop-relevant evidence.
- [ ] The sport scope is correct.
- [ ] The age/level guardrail is correct.
- [ ] Applies_when / does_not_apply_when are adequate.
- [ ] The wording does not overstate causation.
- [ ] The claim does not depend on unavailable measurement.
- [ ] I am comfortable allowing this claim to constrain AI analysis.
- [ ] **(Claim-specific) I confirmed the on-screen research citations exist and actually support this exact claim, OR I am downgrading evidence_type away from research_supported.**

### HUMAN DECISION
- [ ] APPROVE
- [ ] EDIT
- [ ] REJECT

If EDIT:
- Revised claim:
- Revised sport scope:
- Revised age/level scope:
- Revised applies_when:
- Revised does_not_apply_when:
- Revised classification:
- Revised evidence type:
- Reviewer notes:

Reviewer:
Review date:

--------------------------------------------------

# Appendix: Deferred / lower-confidence candidates

Not expanded into full review forms — these 4 were reviewer-downgraded from
Gemini's own "strong_candidate" assessment during the original research pass
and are intentionally excluded from the main queue above.

## DRV1-002
- One-sentence summary: Manipulating physical/environmental practice constraints (not verbal cueing) lets hitters self-organize efficient mechanics.
- Why deferred: It's a coaching/practice-*design* principle, not an observable-from-video mechanical claim — doesn't cleanly fit `observable_evidence`, which is meant to describe what's visible in a coach/game clip.
- What would need to be resolved: Whether HitterLoop's schema wants a category for practice-design/coaching-philosophy claims distinct from observable mechanical claims, before this can be evaluated on the same terms as the 8 above.

## ABCA-LB-001
- One-sentence summary: Hitters should anchor their approach on being consistently "on time" for the pitcher's best fastball.
- Why deferred: Mental-approach content, not swing mechanics — flagged POSSIBLE FUTURE APPROACH-KNOWLEDGE DOMAIN; forcing it into the `timing` concept (a mechanics label) is a taxonomy mismatch.
- What would need to be resolved: Whether HitterLoop's methodology architecture will support a dedicated approach/mental-game knowledge domain at all.

## ABCA-LB-002
- One-sentence summary: Hitters should measure success by "winning" individual pitches rather than box-score outcomes.
- Why deferred: Same approach-domain misfit as ABCA-LB-001. Also has a quality defect: its `does_not_apply_when` was recorded as "never," which the research artifact itself flags as not a real exception.
- What would need to be resolved: The approach-domain architecture question above, AND a human needs to supply a real `does_not_apply_when` before this is approval-ready even if that question is resolved.

## SCI-001
- One-sentence summary: Rolling over the front foot causes an 8%/11% kinetic-energy-transfer loss (front foot / backside respectively).
- Why deferred: The specific numeric figures come from a podcast interviewee's spoken claim with no on-screen citation of methodology or sample size — exactly the "unsupported numerical norm" the research task said never to approve. The qualitative pattern (front-foot rollover is suboptimal) is reasonable on its own, but is bundled with the numeric claim in the current candidate record.
- What would need to be resolved: A human would need to either (a) split this into a qualitative-pattern-only candidate (dropping the 8%/11% figures) and a separately-tracked, likely-rejected numeric candidate, or (b) locate an actual citable source for the specific percentages before either half can be approved as currently worded.
