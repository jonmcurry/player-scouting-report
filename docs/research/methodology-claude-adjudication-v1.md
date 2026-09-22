# Methodology Claude Adjudication — v1

**Status: AI METHODOLOGY-REVIEW RECOMMENDATION ONLY — NOT HUMAN VERIFICATION.**
Every claim below stays `review_status = candidate`, `human_verified = false`,
`active = false`. Nothing here is inserted into `methodology_claims`, no
`methodology_versions`/`methodology_version_items` row was created, no
snapshot was published, and no analysis prompt/policy was touched. Confirmed
directly against the local DB after this work: only the empty `k-0.1.0`
baseline is active, zero claims exist.

**A note on epistemic position, stated plainly rather than glossed over**:
`methodology-gemini-verification-v1.md` presents itself as an independent
video-verification audit, including specific claims like confirmed on-screen
citations (Castaneda & Gray 2007, Wulf 2010, Wu et al. 2012 for DRV1-001) and
a corrected host name (Kevin McShan for SCI-002). I have no way to
independently confirm those specific factual claims were actually read off
the video versus produced from the model's own training-data familiarity
with this well-known coaching-content genre (external-vs-internal focus of
attention is a real, extensively cited body of sports-science literature, so
a plausible-sounding, even individually-verifiable citation list is not by
itself proof of genuine on-screen confirmation). I am treating that document
as one input to weigh, not as ground truth to rubber-stamp — this is exactly
why several of its `VERIFIED_AS_WRITTEN` calls are adjusted to
`APPROVE_WITH_EDIT` below on my own independent judgment, not automatically
carried forward.

---

## Summary table

| Claim ID | Gemini source verdict | Claude decision | Edit required? | Evidence type | Sport scope | Observability | Confidence | Key caveat |
|---|---|---|---|---|---|---|---|---|
| DRV2-001 | VERIFIED_BUT_EDIT_REQUIRED | APPROVE_WITH_EDIT | Yes | coaching_heuristic | baseball | YES | MEDIUM | Causal wording overstates certainty; soften to co-occurrence |
| TAN-001 | VERIFIED_BUT_EDIT_REQUIRED | APPROVE_WITH_EDIT | Yes | coaching_heuristic | softball | YES | MEDIUM | Narrow to softball; sharpen "extension" to barrel-path-through-tunnel wording |
| GAS-001 | VERIFIED_AS_WRITTEN | APPROVE_AS_WRITTEN | No | drill_prescription | softball | YES | MEDIUM | Source is one ~28s clip — thin, but claim itself is narrow and low-risk |
| ABCA-YT-001 | VERIFIED_AS_WRITTEN | APPROVE_AS_WRITTEN | No | coaching_instruction | baseball | YES | HIGH | Keep as one practice convention, not a universal contact-point law |
| ABCA-YT-002 | VERIFIED_AS_WRITTEN | APPROVE_WITH_EDIT | Yes | drill_prescription | baseball | YES | HIGH | Fold the 2–4 lb youth equipment guardrail into structured fields, not just prose |
| BLM-001 | VERIFIED_AS_WRITTEN | APPROVE_WITH_EDIT | Yes | drill_prescription | both | YES | MEDIUM | Underlying mechanical claim is sound; decouple it from the internal-focus cue text (see cross-claim policy) |
| SCI-002 | VERIFIED_BUT_EDIT_REQUIRED | APPROVE_WITH_EDIT | Yes | biomechanical_explanation | both | PARTIAL | MEDIUM | Remove normative absolutism ("optimal"); keep strictly qualitative |
| DRV1-001 | VERIFIED_AS_WRITTEN | APPROVE_WITH_EDIT | Yes | research_supported (provisional) | both | PARTIAL | MEDIUM | Reframe as a coaching-cue-language policy constraint, not a swing-observation claim; evidence_type stays provisional pending a human's own citation check |

---

# Detailed adjudication

--------------------------------------------------
## CLAIM ID: DRV2-001

### GEMINI VERIFICATION
- Verification verdict: VERIFIED_BUT_EDIT_REQUIRED
- Timestamp status: VERIFIED (00:28–00:42) per Gemini's report
- Material correction from Gemini: Candidate claim states early loading as the established root cause of the forward-move/hip-extension/lunging pattern; Gemini's audit reframes this as a co-occurring diagnostic pattern rather than settled causation, and recommends restricting age guardrail strictly to `teen_appropriate`.

### METHODOLOGY ASSESSMENT
- Atomic enough: Yes — one diagnostic pattern, not a bundle of unrelated ideas.
- Causal wording acceptable: **No, as currently worded.** "Initiate their load prematurely, leading to..." states a settled causal chain. Per the special adjudication rule for this claim, prefer observational/co-occurrence language unless the source genuinely supports causality — and per both `methodology-seed-v1.md`'s own reviewer note and Gemini's audit, this is coaching heuristic/clinical experience, not a validated causal law.
- Sport scope appropriate: Yes — baseball only, matches the source.
- Age/level scope appropriate: Yes, at `teen_appropriate` — both the human-review sheet and Gemini's audit independently landed on the same narrowing from Gemini's own broader raw-extraction default, which is a reasonable convergent signal even without my own video access.
- Applies_when adequate: Yes.
- Does_not_apply_when adequate: Yes.
- Evidence type appropriate: Yes — `coaching_heuristic` honestly reflects clinical/training-facility experience rather than peer-reviewed research.
- Observable from current HitterLoop inputs: Yes — early weight shift, early hip extension, and lunging are all visible in ordinary game/practice video, with no dependency on metrics HitterLoop doesn't have.
- Product-domain fit: Yes — a mechanics-analysis diagnostic claim, squarely inside the current concept taxonomy (`timing`).
- Contradiction risk: None identified against the other 7 claims in this set.

### DECISION
**APPROVE_WITH_EDIT**

### RATIONALE
The underlying diagnostic pattern is genuinely useful and observable, but the current wording asserts causation ("leading to") that neither the source (a coach's clinical-experience explanation, not a controlled study) nor either verification pass actually establishes at that strength. Softening to co-occurrence language keeps the claim honest about its own evidentiary basis without discarding real diagnostic value.

### IF APPROVE_WITH_EDIT
- Revised claim: "Hitters who consistently swing early often initiate their load prematurely, a pattern that frequently co-occurs with an uncontrolled forward move, early back-hip extension, and lunging into contact."
- Revised concept if necessary: no change — `timing`
- Revised sport scope: baseball (no change)
- Revised age guardrail: `teen_appropriate` (no change)
- Revised level scope: high school through advanced
- Revised applies_when: "A hitter is consistently early on pitches and lunging forward into contact." (no change)
- Revised does_not_apply_when: "A hitter is late on pitches or failing to initiate stride in time." (no change)
- Revised evidence type: `coaching_heuristic` (no change)
- Revised observable evidence: "Hitter shifting weight forward well before pitch release, back hip extending early, and body posture lunging toward the ball — a co-occurring pattern, not asserted as a single-cause diagnosis."
- Notes: Do not let the three tied drills (Step Backs, Modified Hook 'Em, Offset Open) be marketed as "fixing the cause" — they address the observable pattern, which is the honest framing.

### CONFIDENCE
MEDIUM — the correction direction (soften causation, keep teen_appropriate) is sound regardless of exactly how precisely either AI pass read the video, since it's the conservative, evidence-honest move either way.

--------------------------------------------------
## CLAIM ID: TAN-001

### GEMINI VERIFICATION
- Verification verdict: VERIFIED_BUT_EDIT_REQUIRED
- Timestamp status: VERIFIED (00:07–00:43) per Gemini's report
- Material correction from Gemini: Confirms the human-review sheet's own reviewer-downgrade from `both` to `softball` (video is softball-specific: softballs, softball swing path). Also sharpens "extension" to explicitly mean barrel-path direction through the hitting "tunnel" toward the pitcher, not arm-casting.

### METHODOLOGY ASSESSMENT
- Atomic enough: Yes.
- Causal wording acceptable: Yes — "premature wrist rollover" is framed as a consequence of pulling the barrel out of the zone, which both prior artifacts and Gemini's audit treat as an appropriately careful (not overreaching) causal framing specific to this narrow mechanical relationship.
- Sport scope appropriate: **Only after the edit** — softball, not `both`. Two independent passes (this session's original research review, and Gemini's audit) both converged on softball-only; I concur.
- Age/level scope appropriate: Yes, `youth_appropriate` — this is a benign tee drill, no physical-load concern.
- Applies_when adequate: Yes.
- Does_not_apply_when adequate: Yes.
- Evidence type appropriate: Yes — `coaching_heuristic`, a practical instructional principle, not research.
- Observable from current HitterLoop inputs: Yes — barrel path through and past the contact zone is visible in ordinary video, including HitterLoop's own contact/extension swing-phase stills.
- Product-domain fit: Yes — concept `extension` is already in the current taxonomy.
- Contradiction risk: None identified.

### DECISION
**APPROVE_WITH_EDIT**

### RATIONALE
Per the special adjudication rule for this claim: do not approve vague "extension" language, and preserve the precise barrel-path meaning if retained. The claim as originally worded is reasonably specific already, but Gemini's proposed wording makes the "through the tunnel toward the pitcher" meaning even more explicit and harder to misread as generic arm-casting advice — worth adopting. The sport-scope narrowing to softball is the other required change.

### IF APPROVE_WITH_EDIT
- Revised claim: "Extending the bat barrel through the hitting zone tunnel toward the pitcher after contact optimizes directional ball flight and power while preventing premature wrist rollover."
- Revised concept if necessary: no change — `extension`
- Revised sport scope: **softball**
- Revised age guardrail: `youth_appropriate` (no change)
- Revised level scope: general amateur
- Revised applies_when: "Executing swing follow-through and extension on pitches through the middle and outer parts of the zone."
- Revised does_not_apply_when: "Adjusting to extreme inside pitch locations where hand path must clear tightly without full forward barrel extension."
- Revised evidence type: `coaching_heuristic` (no change)
- Revised observable evidence: no change — barrel path through and past contact remains the observable signal.
- Notes: Product-placement note carried forward from the source registry (Tanner Tee brand channel) — doesn't affect claim validity, just source-trust context; do not let this become the canonical HitterLoop definition of "extension" without also confirming it doesn't conflict with any baseball-specific extension claim added later.

### CONFIDENCE
MEDIUM — the meaning-sharpening and sport-scope narrowing are both independently well-supported by two separate reviews reaching the same conclusion, but I still can't personally confirm the exact on-screen wording.

--------------------------------------------------
## CLAIM ID: GAS-001

### GEMINI VERIFICATION
- Verification verdict: VERIFIED_AS_WRITTEN
- Timestamp status: VERIFIED (00:15–00:28) per Gemini's report
- Material correction from Gemini: None to the claim itself; confirms the JT Gasso/FloCollege | Softball channel-attribution correction already made in the source registry, and confirms the clip is genuinely short (~28s, "highlight clip"), consistent with the original research's own thinness caveat.

### METHODOLOGY ASSESSMENT
- Atomic enough: Yes — one drill-structure claim.
- Causal wording acceptable: Yes — pure drill-structure description, no causal mechanics diagnosis asserted.
- Sport scope appropriate: Yes — softball, already correctly scoped; per the special adjudication rule for this claim, do not infer baseball applicability from softball instruction, and neither prior review did.
- Age/level scope appropriate: Yes — `teen_appropriate` / high school–college, matches a dynamic-timing-adaptability drill that plausibly demands more than a young hitter needs.
- Applies_when adequate: Yes.
- Does_not_apply_when adequate: Yes.
- Evidence type appropriate: Yes — `drill_prescription`, honestly describes a drill protocol, not a claimed mechanical truth. Per the special rule for this claim: a drill can be approved as a drill prescription without treating it as universal mechanical doctrine — this claim's wording already respects that boundary ("trains their ability to adjust," not "hitters must adjust this way").
- Observable from current HitterLoop inputs: Yes — the multi-plate drill structure is directly visible.
- Product-domain fit: Yes — `timing` concept, drill-level content.
- Contradiction risk: None identified.

### DECISION
**APPROVE_AS_WRITTEN**

### RATIONALE
The claim is narrow, honestly typed as a drill prescription (not elevated into a mechanical law), and both independent reviews agree it accurately represents a short but unambiguous clip. The source itself is thin (one ~28s excerpt) — that's a real caveat about the *source's* breadth, not a defect in this specific, narrowly-scoped claim, so it doesn't block approval of the claim as worded.

### CONFIDENCE
MEDIUM — the claim itself is low-risk, but the source's thinness (one short clip, likely excerpted from a longer paid lesson) means this shouldn't be treated as strong evidence the *source* deserves broad trust beyond this one drill.

--------------------------------------------------
## CLAIM ID: ABCA-YT-001

### GEMINI VERIFICATION
- Verification verdict: VERIFIED_AS_WRITTEN
- Timestamp status: VERIFIED (06:18–08:20) per Gemini's report
- Material correction from Gemini: Identifies a presenter (Ryan Brownlee, ABCA) and offers a resolution for the "Golden Spikes Baseball" on-screen-credit conflict (a collaborative ABCA/Golden Spikes production) — **this specific resolution is Gemini's own claim and has not been independently re-confirmed here**; treat it as a plausible lead, not a closed question, until a human confirms it directly.

### METHODOLOGY ASSESSMENT
- Atomic enough: Yes.
- Causal wording acceptable: Yes — a practice-setup convention, not a causal mechanics claim.
- Sport scope appropriate: Yes — baseball, matches ABCA's own scope (per the source registry, do not extend to softball).
- Age/level scope appropriate: Yes — `youth_appropriate`; low physical-risk, purely a setup convention.
- Applies_when adequate: Yes.
- Does_not_apply_when adequate: Yes.
- Evidence type appropriate: Yes — `coaching_instruction`.
- Observable from current HitterLoop inputs: Yes — tee position relative to the hitter's lead hip/front foot is directly measurable from video.
- Product-domain fit: Yes — `pitch_location_adjustment`.
- Contradiction risk: None identified.

### DECISION
**APPROVE_AS_WRITTEN**

### RATIONALE
Per the special adjudication rule for this claim: this is a practice-setup convention and must not be converted into a universal in-game contact-point law. The current wording already respects that boundary — it's scoped to "setting up batting-tee drills," with an explicit `does_not_apply_when` excluding live-pitching/dynamic recognition work. This is the cleanest, lowest-risk claim in the set across both independent reviews.

### CONFIDENCE
HIGH — simple, concrete, non-causal, non-numeric, and independently corroborated by two separate review passes with no disagreement on substance.

--------------------------------------------------
## CLAIM ID: ABCA-YT-002

### GEMINI VERIFICATION
- Verification verdict: VERIFIED_AS_WRITTEN
- Timestamp status: VERIFIED (00:58–02:30) per Gemini's report
- Material correction from Gemini: Confirms the drill is demonstrated specifically with youth players using a 2–4 lb medicine ball, and reports this detail as explicitly stated in the source.

### METHODOLOGY ASSESSMENT
- Atomic enough: Yes.
- Causal wording acceptable: Yes — the claim describes what the drill teaches via movement constraint, not an assertion that this is the only correct way to load.
- Sport scope appropriate: Yes — baseball, matches ABCA's scope.
- Age/level scope appropriate: **Conditionally yes.** `youth_appropriate` is fine for the drill concept, but the youth-safety-critical detail (2–4 lb ball weight) currently lives only in prose (`Level scope` narrative text and `does_not_apply_when`'s physical-screening exclusion), not as a hard, structured field a downstream consumer is guaranteed to preserve.
- Applies_when adequate: Yes.
- Does_not_apply_when adequate: Yes — "players lack basic lower-body balance or have joint issues requiring physical screening" is a real, sensible exclusion already present.
- Evidence type appropriate: Yes — `drill_prescription`.
- Observable from current HitterLoop inputs: Yes — rear-leg hinge, knee stability, and the jump-back action are visually verifiable.
- Product-domain fit: Yes — `load`.
- Contradiction risk: None identified.

### DECISION
**APPROVE_WITH_EDIT**

### RATIONALE
Per the special adjudication rule for this claim: keep "this drill teaches..." separate from "all hitters must mechanically..." (already true of the current wording, which is about what the drill teaches, not a universal law), and be conservative with youth physical-load claims. Gemini rated this AS_WRITTEN with no changes; I'm applying a stricter independent standard here specifically because this is a *physical-load* drill for youth athletes — the equipment-safety guardrail (2–4 lbs) deserves to be a durable, structured part of the claim record, not something that could silently disappear if only a short summary field is ever surfaced to a coach.

### IF APPROVE_WITH_EDIT
- Revised claim: "Using a jump-back medicine-ball toss with an age-appropriate light medicine ball (approximately 2–4 lbs for youth players) teaches hitters to load into the back hip and maintain weight on the inside of the back knee."
- Revised concept if necessary: no change — `load`
- Revised sport scope: baseball (no change)
- Revised age guardrail: `youth_appropriate` (no change)
- Revised level scope: "youth — requires a light (2–4 lb) medicine ball; do not use adult-weight equipment"
- Revised applies_when: "Developing dynamic lower-half loading and back-hip weight distribution, using age-appropriate equipment." (equipment clause added)
- Revised does_not_apply_when: "Players lack basic lower-body balance, have joint issues requiring physical screening, or only adult-weight medicine balls are available." (no-substitute-equipment clause added)
- Revised evidence type: `drill_prescription` (no change)
- Revised observable evidence: no change.
- Notes: This is a defense-in-depth edit, not a claim-validity concern — the underlying drill content is sound as verified; the change is purely about making sure a real, source-stated youth-safety detail can't be silently dropped downstream.

### CONFIDENCE
HIGH on the underlying drill content; the edit itself is a conservative, low-risk addition rather than a correction of an error.

--------------------------------------------------
## CLAIM ID: BLM-001

### GEMINI VERIFICATION
- Verification verdict: VERIFIED_AS_WRITTEN
- Timestamp status: VERIFIED (00:52–01:45) per Gemini's report
- Material correction from Gemini: None to claim substance; explicitly re-confirms the claim is sensor-independent (Blast's proprietary "on-plane %" metric was correctly excluded from the original extraction) and explicitly re-notes the contradiction with DRV1-001 without resolving it.

### METHODOLOGY ASSESSMENT
- Atomic enough: Yes.
- Causal wording acceptable: Yes — "diving the chest forward" as a rotational failure is a reasonable, constraint-based framing, not an overreaching causal claim.
- Sport scope appropriate: Yes — `both` is defensible here; this is a general posture/rotation principle, not tied to sport-specific equipment or rules (unlike TAN-001's softball-specific product/swing-path content).
- Age/level scope appropriate: Yes — `youth_appropriate`, low physical risk, demonstrated with youth players.
- Applies_when adequate: Yes.
- Does_not_apply_when adequate: Yes.
- Evidence type appropriate: Yes — `drill_prescription`.
- Observable from current HitterLoop inputs: Yes — spinal posture and chest-lunge behavior across different pitch heights are directly visible, with no dependency on Blast's sensor hardware.
- Product-domain fit: Yes — `posture`.
- Contradiction risk: **Yes — real and unresolved.** The claim's own `coaching_cue` field ("Rotate around your center... don't dive your chest forward") is an explicit internal-body-mechanics instruction, which sits in direct tension with DRV1-001's research-supported claim that external-focus (outcome-based) cues outperform internal-focus (body-mechanics) cues.

### DECISION
**APPROVE_WITH_EDIT**

### RATIONALE
Per the special adjudication rule for this claim: the claim itself and the cue are separable, and a useful posture/drill claim should not be rejected merely because its internal-focus cue conflicts with DRV1-001. The underlying mechanical observation (rotate the torso to reach different pitch heights rather than lunging the chest forward) is independently valid, video-observable, and youth-safe on its own terms — that survives. What should change is treating the *specific verbatim coaching-cue wording* as HitterLoop's one canonical, unconditionally-recommended phrasing, when a separately-approved claim (DRV1-001) argues that exact cueing style is motor-learning-inferior. This is a product/cue-generation-policy question, not a reason to reject the mechanical claim — see the cross-claim section below for the recommended resolution.

### IF APPROVE_WITH_EDIT
- Revised claim: "Hitters should adjust swing plane to different pitch locations through torso rotation and body posture rather than diving their chest forward toward the ball." (mechanical content unchanged)
- Revised concept if necessary: no change — `posture`
- Revised sport scope: both (no change)
- Revised age guardrail: `youth_appropriate` (no change)
- Revised level scope: youth through advanced (no change)
- Revised applies_when: no change
- Revised does_not_apply_when: no change
- Revised evidence type: `drill_prescription` (no change)
- Revised observable evidence: no change — the mechanical pattern (rotation vs. chest-diving) is unaffected by the cue-wording question.
- Notes: **The edit is to the `coaching_cue` field's status, not the claim itself.** Recommend the source-provided cue text be preserved for provenance/attribution, but tagged as "one example phrasing from the source, not HitterLoop's endorsed default cue language" — with the actual default cue HitterLoop surfaces to a coach generated per the external-focus policy from DRV1-001 where the two would otherwise conflict. This keeps both claims true to their sources while giving the product a single, coherent cueing voice.

### CONFIDENCE
MEDIUM — the mechanical claim itself is solid; the confidence is capped at MEDIUM because the cue-policy resolution is a product decision this adjudication can only recommend, not settle.

--------------------------------------------------
## CLAIM ID: SCI-002

### GEMINI VERIFICATION
- Verification verdict: VERIFIED_BUT_EDIT_REQUIRED
- Timestamp status: VERIFIED (15:43–16:10) per Gemini's report
- Material correction from Gemini: Reports a corrected host name for the source podcast (Kevin McShan, not "Tevin McChan") — **noted but not independently re-confirmed by me**; flags the candidate's "Optimal hitting mechanics rely on..." opening as normative absolutism not actually present in the source, which instead offers a general qualitative framework during an interview.

### METHODOLOGY ASSESSMENT
- Atomic enough: Yes.
- Causal wording acceptable: Mostly — the underlying kinetic-chain sequencing description is standard, uncontroversial hitting-mechanics framing. The "optimal"/"rely on" phrasing in the current wording overstates certainty for what both prior artifacts and Gemini's audit agree is a general, qualitative interview explanation.
- Sport scope appropriate: Yes — `both`, a general biomechanical description not tied to sport-specific equipment/rules.
- Age/level scope appropriate: Yes — `youth_appropriate`, no physical drill or numeric target involved.
- Applies_when adequate: Yes.
- Does_not_apply_when adequate: Yes.
- Evidence type appropriate: Yes, **only if kept at** `biomechanical_explanation`. Per the special adjudication rule for this claim: do not call it research-supported merely because it sounds biomechanically mainstream. The source is a podcast/interview, not a peer-reviewed publication — confirmed independently in this session's own earlier research (channel verified via oEmbed as "Let's Have This Conversation") and re-confirmed by Gemini's audit. Both signals agree; I concur `research_supported` would be the wrong evidence_type here.
- Observable from current HitterLoop inputs: Partial — the qualitative proximal-to-distal sequencing pattern is visually inferable from ordinary video; precise, measured kinetic-chain timing is not something HitterLoop currently measures (a real, pre-existing limitation, not specific to this claim).
- Product-domain fit: Yes — `hip_shoulder_sequencing`.
- Contradiction risk: None identified against the other claims here (broadly compatible with DRV1-002's constraint-based sequencing philosophy, which is not in this review queue).

### DECISION
**APPROVE_WITH_EDIT**

### RATIONALE
Per the special adjudication rule: if retained, keep this claim qualitative and conservative, and consider removing words like "optimal" that exceed the evidence. The general kinetic-chain sequencing idea is safe, mainstream, and non-numeric — but the current wording's certainty ("optimal... rely on") doesn't match its actual evidentiary basis (a qualitative description in an interview). Softening the wording preserves the useful content while keeping the claim honest about what it actually is.

### IF APPROVE_WITH_EDIT
- Revised claim: "Kinetic-chain energy transfer in a full-effort swing generally progresses sequentially from the ground up through the hips, torso, hands, and bat barrel."
- Revised concept if necessary: no change — `hip_shoulder_sequencing`
- Revised sport scope: both (no change)
- Revised age guardrail: `youth_appropriate` (no change)
- Revised level scope: general
- Revised applies_when: "Executing a full-effort rotational swing." (no change)
- Revised does_not_apply_when: "Executing check swings, bunts, or emergency contact swings/adjustments." (no change)
- Revised evidence type: `biomechanical_explanation` (no change — explicitly NOT upgraded)
- Revised observable evidence: "High-speed or slow-motion video showing the general sequence of ground drive, hip turn, trunk rotation, hand acceleration, and barrel delivery — as a qualitative pattern, not a precisely-measured timing window."
- Notes: Do not let this general, safe claim imply the *source* (the podcast) should be trusted for other, less-safe claims from the same video (i.e. the deferred SCI-001 numeric energy-loss figures, which are explicitly not part of this review queue).

### CONFIDENCE
MEDIUM — the qualitative content is genuinely safe and mainstream; confidence isn't HIGH only because the source format itself remains a lower evidentiary tier by design.

--------------------------------------------------
## CLAIM ID: DRV1-001

### GEMINI VERIFICATION
- Verification verdict: VERIFIED_AS_WRITTEN
- Timestamp status: VERIFIED (00:38–01:03) per Gemini's report
- Material correction from Gemini: Identifies the presenter as Jason Ochart and reports specific, identifiable on-screen citations (Castaneda & Gray 2007, Wulf 2010, Wu et al. 2012), asserting these directly support the claim as worded and justify `research_supported`. **This is the single highest-stakes factual claim in the whole verification document, and I am treating it with corresponding caution** — see the header note above on why a second AI's confident "verified" citation read is not equivalent to independent confirmation.

### METHODOLOGY ASSESSMENT
- Atomic enough: Yes.
- Causal wording acceptable: Yes for what the claim actually is — a claim about *coaching-cue effectiveness*, not a swing-mechanics diagnosis, so "promote superior force production" is reporting what cited literature claims to have found, not HitterLoop asserting a mechanics fact about any individual hitter.
- Sport scope appropriate: Yes — `both`; a general motor-learning mechanism, not sport-specific.
- Age/level scope appropriate: Yes — `youth_appropriate`; the claim is about coach language, not a physical drill, so there's no physical-risk dimension to narrow.
- Applies_when adequate: Yes.
- Does_not_apply_when adequate: Yes — appropriately excludes body-awareness/PT-screening contexts where internal focus is intentionally needed.
- Evidence type appropriate: **Provisionally yes, conditional on independent human confirmation.** This is the one field I am not fully endorsing outright. The citation list is real, well-known literature in this exact subfield (external-vs-internal attentional focus), which makes `research_supported` *plausible* — but plausibility from a second AI pass is not the same as confirmation.
- Observable from current HitterLoop inputs: Partial — not visible in swing video at all; it functions as a policy constraint on how HitterLoop's AI should phrase generated coaching cues, not a claim about what's in any specific clip. Per the special adjudication rule for this claim: this may be better treated as a coaching-policy/cue-language rule rather than a swing-observation claim — I'm adopting that framing explicitly.
- Product-domain fit: Conditional — HitterLoop's current schema treats `observable_evidence` as describing what's visible in a coach/game clip, which this claim doesn't cleanly satisfy; recording it as a cueing-policy constraint (rather than forcing it into the same slot as e.g. DRV2-001) is a more honest fit.
- Contradiction risk: Yes — real and unresolved, symmetric with BLM-001's entry above.

### DECISION
**APPROVE_WITH_EDIT**

### RATIONALE
Per the special adjudication rule for this claim: only retain `research_supported` if the cited literature was sufficiently verified; otherwise edit evidence_type downward. Gemini's audit asserts sufficient verification, but I am not in a position to independently confirm that assertion any more than the original research pass could independently confirm Gemini's original extraction — this is the same second-order verification gap that runs through this entire project. Rather than either (a) blindly accepting `research_supported` on a second AI's say-so, or (b) discarding a claim that cites real, well-established, plausible literature, I'm recommending a middle path: keep `research_supported` as the *provisional* evidence type, reframe the claim's observable-evidence field to honestly describe it as a cueing-policy constraint rather than a swing-observation claim, and make final confirmation of the on-screen citations an explicit, non-negotiable human checklist item before this claim is treated as fully settled — which the existing `methodology-human-review-v1.md` already includes as its one claim-specific checklist item for DRV1-001. I am not overriding that human gate; I'm reinforcing it.

### IF APPROVE_WITH_EDIT
- Revised claim: no substantive change — "External focus cues (focusing on ball flight or target outcome) promote superior force production and movement sequencing compared to internal focus cues (focusing on body mechanics)."
- Revised concept if necessary: no change — `game_approach` (though note per BLM-001's entry, this claim functions more as a cueing-policy rule than an observable mechanics concept — worth a longer-term taxonomy discussion, not an emergency fix)
- Revised sport scope: both (no change)
- Revised age guardrail: youth_appropriate (no change)
- Revised level scope: general
- Revised applies_when: no change
- Revised does_not_apply_when: no change
- Revised evidence type: `research_supported` — **provisional**, contingent on a human directly confirming the on-screen citations (Castaneda & Gray 2007, Wulf 2010, Wu et al. 2012, per Gemini's report) actually appear and actually support this exact claim. If that confirmation doesn't happen, downgrade to `coaching_heuristic` or `expert_opinion` before publishing.
- Revised observable evidence: "This claim does not describe a pattern visible in any individual swing clip. It functions as a policy constraint on how HitterLoop's AI-generated coaching-cue language should be phrased (favoring outcome/target-focused language over body-mechanics-focused language), independent of what's observed in any specific analysis run."
- Notes: See the cross-claim section below for how this interacts with BLM-001.

### CONFIDENCE
MEDIUM — the underlying literature area is real and well-established, which is genuinely reassuring, but the specific on-screen-citation confirmation remains one AI verifying another AI's claim, not a human or a primary-source check.

---

# Cross-claim consistency review

### 1. DRV1-001 vs BLM-001 — external-focus cueing principle vs. internal-mechanics cue

Both claims survive adjudication on their own merits and neither invalidates
the other — they operate at different levels. DRV1-001 is a general
*cueing-language policy* claim (how coaches/AI should phrase feedback);
BLM-001 is a specific, video-observable *mechanical/postural* claim (what a
hitter's body should do), which happens to also carry a source-provided cue
written in internal-focus language.

**Recommendation**: do not force one to invalidate the other. Represent the
tension explicitly at the product level:
- Preserve BLM-001's underlying mechanical claim (rotate around center
  rather than diving the chest forward) as approvable content — it's
  independently observable and doesn't depend on which cueing philosophy is
  correct.
- Treat BLM-001's specific `coaching_cue` text as one *example* phrasing
  from its source, not as HitterLoop's endorsed default language.
- When HitterLoop's own AI generates coaching-cue text that touches this
  same mechanical content (chest posture / rotation vs. diving), default to
  external-focus phrasing per DRV1-001 (e.g., cueing toward a visual
  target or the ball's flight path) rather than reusing BLM-001's literal
  internal-mechanics wording — unless a human decides otherwise.
- Keep `contradiction_group: cueing-philosophy-internal-vs-external` on
  both claims (already established in `methodology-contradictions-v1.md`)
  so this stays visible and auditable rather than silently resolved.

### 2. Drill prescription vs. mechanical truth — GAS-001, ABCA-YT-002, TAN-001

Checked each: all three are already worded as "this drill teaches/trains
X," not "X is universally true for all hitters."
- GAS-001: "trains their ability to adjust" — fine as written.
- ABCA-YT-002: "teaches hitters to load into the back hip" — fine, and the
  recommended edit above only strengthens the youth-equipment guardrail; it
  doesn't change this framing.
- TAN-001: the recommended edit keeps the drill-and-mechanism framing
  intact while sharpening the "tunnel" wording — still describes what the
  drill/mechanism does, not a universal law.

No claim in this set was found asserting a drill-taught pattern as a rigid,
universal mechanical requirement. No further edits needed on this dimension.

### 3. Baseball/softball transfer — any claim still over-scoped to `both`?

Three claims remain `both`: BLM-001, SCI-002, DRV1-001. All three are
general-mechanism claims (posture/rotation principle, kinetic-chain
sequencing, motor-learning cueing) not tied to sport-specific equipment,
ball size, or rules — unlike TAN-001, which *was* over-scoped to `both` in
its original form and has already been corrected to `softball` (both this
session's earlier research and Gemini's audit independently agree). No
remaining claim in this 8-claim set is flagged as improperly over-scoped to
`both`.

### 4. Youth safety/generalization — any claim whose `youth_appropriate` label should be narrowed?

Reviewed all youth_appropriate-labeled claims in this set (TAN-001 after
edit, ABCA-YT-001, ABCA-YT-002, BLM-001, SCI-002, DRV1-001) individually
above. One finding: **ABCA-YT-002** needed strengthening, not narrowing —
its youth-safety-relevant detail (2–4 lb medicine ball) existed only in
prose, not in the structured fields most likely to survive into a
downstream display; the recommended edit folds it into `level_scope` and
`applies_when`/`does_not_apply_when` directly. No claim's `youth_appropriate`
label itself needed downgrading to a stricter guardrail (`teen_appropriate`
or higher) — DRV2-001, the one claim genuinely narrowed on age grounds, was
already correctly set to `teen_appropriate` (not `youth_appropriate`) by
both prior reviews before this adjudication pass began.

---

## Claims recommended to advance

- GAS-001 (as written)
- ABCA-YT-001 (as written)

## Claims recommended to advance only after edit

- DRV2-001 — soften causal wording to co-occurrence framing
- TAN-001 — narrow to softball; sharpen "extension" wording
- ABCA-YT-002 — fold the 2–4 lb youth equipment guardrail into structured fields
- BLM-001 — retain the mechanical claim; reclassify its cue text as example phrasing, not HitterLoop's default cue language
- SCI-002 — remove "optimal"/normative absolutism; keep strictly qualitative
- DRV1-001 — reframe as a cueing-policy constraint; keep `research_supported` provisional pending a human's own citation confirmation (already required by the existing human-review checklist)

## Claims rejected

None.

## Claims blocked

None. All 8 claims had sufficient reliable evidence (per Gemini's report plus this session's own prior research) to reach an adjudication decision, though DRV1-001's evidence-type finding remains explicitly provisional rather than final.

## Cross-claim policy issues

1. **DRV1-001 vs. BLM-001 cueing-philosophy tension** — recommend the
   product-level resolution in section 1 above (preserve both claims;
   default AI-generated cue language to external-focus phrasing where the
   two would otherwise conflict; keep the contradiction visible).
2. **DRV1-001's evidence_type is the single biggest open verification
   question in this entire set** — it rests on one AI's confidence that it
   correctly read on-screen citations, which this adjudication cannot
   independently upgrade to certainty. Recommend keeping the human
   checklist's citation-confirmation item mandatory, not optional.
3. **No claim in this set requires new HitterLoop capability** (no metrics,
   3D, force, or bat-sensor dependency was found in any of the 8) —
   confirms this seed stays within the architecture's explicit "no metrics/
   3D expansion" boundary.

---

# Path forward (informational only — not executed here)

Per governance: none of the edits/decisions above have been applied to any
database row. A human reviewer using `methodology-human-review-v1.md`
should treat this document as a second opinion to weigh alongside Gemini's
verification report — not a substitute for their own `human_verified`
decision, and not a resolution of the DRV1-001 citation question, which
still needs a human (or a primary-source check) to close out.
