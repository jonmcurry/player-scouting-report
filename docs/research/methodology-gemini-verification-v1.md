# Methodology Source Verification Report — Seed v1

**Status: INDEPENDENT VERIFICATION AUDIT ONLY.**
Zero production database records, approval statuses, activation flags, prompts, or analysis policies have been modified. All claims remain candidate status (`human_verified = false`, `active = false`).

---

## Executive Summary Table

| Claim ID | Timestamp Verdict | Source Representation | Scope Verdict | Evidence-Type Verdict | HitterLoop Observability | Final Verification Verdict |
|---|---|---|---|---|---|---|
| **DRV2-001** | VERIFIED (00:28–00:42) | PARTIAL (causal overreach) | NEEDS NARROWING (teen+) | coaching_heuristic | YES (video-observable) | **VERIFIED_BUT_EDIT_REQUIRED** |
| **TAN-001** | VERIFIED (00:07–00:43) | PARTIAL ("extension" ambiguous) | NEEDS NARROWING (softball-only) | coaching_heuristic | YES (video-observable) | **VERIFIED_BUT_EDIT_REQUIRED** |
| **GAS-001** | VERIFIED (00:15–00:28) | YES | VERIFIED (softball, teen+) | drill_prescription | YES (drill structure) | **VERIFIED_AS_WRITTEN** |
| **ABCA-YT-001** | VERIFIED (06:18–08:20) | YES | VERIFIED (baseball, youth+) | coaching_instruction | YES (tee setup geometry) | **VERIFIED_AS_WRITTEN** |
| **ABCA-YT-002** | VERIFIED (00:58–02:30) | YES | VERIFIED (baseball, youth w/ 2–4 lb ball) | drill_prescription | YES (drill execution) | **VERIFIED_AS_WRITTEN** |
| **BLM-001** | VERIFIED (00:52–01:45) | YES | VERIFIED (both, youth+) | drill_prescription | YES (sensor-independent) | **VERIFIED_AS_WRITTEN** |
| **SCI-002** | VERIFIED (15:43–16:10) | PARTIAL (normative absolutism) | VERIFIED (both, general) | biomechanical_explanation | PARTIAL (qualitative only) | **VERIFIED_BUT_EDIT_REQUIRED** |
| **DRV1-001** | VERIFIED (00:38–01:03) | YES | VERIFIED (both, general) | research_supported | PARTIAL (cue policy constraint) | **VERIFIED_AS_WRITTEN** |

---

# Detailed Verification by Claim

--------------------------------------------------
## 1. CLAIM ID: DRV2-001

### VIDEO ACCESS
- Accessible: YES
- If NO, reason: N/A

### SOURCE METADATA
- Video title: "3 Drills to Improve Timing and Load When Hitting" (On-screen segment card: "Helping An Early Hitter")
- Channel/publisher: Driveline Baseball
- Presenter if identifiable: Conner Watson (Driveline Hitting Trainer)
- Metadata conflicts: None (listing title matches oEmbed; on-screen card reflects the specific clinical segment).
- Confidence: HIGH

### TIMESTAMP VERIFICATION
- Existing claimed start: 00:28 (28s)
- Existing claimed end: 00:42 (42s)
- Independently verified start: 00:28
- Independently verified end: 00:42
- Timestamp verdict: **VERIFIED**
- Notes: At 00:28–00:42, Conner Watson introduces the mechanical breakdown of an early hitter. Drill demonstrations follow at 01:19 (Step Backs), 01:58 (Modified Hook 'Em), and 02:47 (Offset Open).

### SOURCE MEANING
- What the source actually says/shows: Hitters who are consistently early often start their load and forward move too soon, which commonly leads to early hip extension and lunging forward into contact. Watson notes this diagnostic pattern and suggests checking movement/strength limitations before prescribing corrective tempo drills.
- Does the existing candidate accurately represent it?: **PARTIAL**
- Material omission or distortion: The candidate claim presents early loading as an unyielding root cause ("initiating load prematurely, leading to an uncontrolled forward move..."). In motor-control reality, early loading, premature forward move, early hip extension, and lunging are co-occurring symptoms of poor tempo/timing.
- Is causal language supported by the source itself?: Watson presents it as a coaching heuristic/explanation from clinical experience, not a validated causal laboratory law.
- Is the coaching cue actually source-provided?: N/A (none extracted; diagnostic claim).
- Is the drill relationship actually source-provided?: YES (Step Backs, Modified Hook 'Em, and Offset Open are directly demonstrated to address this timing pattern).

### SCOPE
- Baseball / softball / both: Baseball
- Age/level actually supported by the source: High school, college, advanced amateur (teen+).
- Does existing scope need narrowing?: YES — age guardrail should remain strictly `teen_appropriate`. Diagnosing premature hip extension timing requires developmental maturity and is inappropriate as an automated youth diagnosis.
- Applies_when supported?: YES ("A hitter is consistently early on pitches and lunging forward into contact.")
- Does_not_apply_when supported?: YES ("A hitter is late on pitches or failing to initiate stride in time.")

### EVIDENCE QUALITY
- Evidence type: `coaching_heuristic`
- Rationale: Grounded in training-facility coaching experience and observable diagnostic patterns, but not an academic peer-reviewed biomechanical study.

### HITTERLOOP RELEVANCE
- Observable from ordinary game/practice video: **YES** (premature forward weight shift prior to pitch release and forward trunk lunge are visually obvious).
- Requires unavailable measurement: NO.
- Appropriate to constrain HitterLoop swing analysis: **YES** (provides diagnostic heuristic for early timing).

### VERIFICATION VERDICT
**VERIFIED_BUT_EDIT_REQUIRED**

- Proposed corrected claim: "Hitters who consistently swing early often initiate their load prematurely, a pattern that frequently co-occurs with an uncontrolled forward move, early back-hip extension, and lunging into contact."
- Proposed corrected sport scope: baseball
- Proposed corrected age/level scope: teen_appropriate (high school through advanced)
- Proposed corrected applies_when: A hitter is consistently early on pitches and lunging forward into contact.
- Proposed corrected does_not_apply_when: A hitter is late on pitches or failing to initiate stride in time.
- Proposed corrected evidence type: coaching_heuristic
- Reason: Softens unproven causal certainty ("leading to") into an observable co-occurring diagnostic pattern ("frequently co-occurs with"), and explicitly restricts age scope to teen+.

--------------------------------------------------
## 2. CLAIM ID: TAN-001

### VIDEO ACCESS
- Accessible: YES
- If NO, reason: N/A

### SOURCE METADATA
- Video title: "Two Tee Extension Drill with Megan Rembielak using a Tanner Tee | Softball Hitting Drills"
- Channel/publisher: TannerTees (YouTube uploader); Megan Rembielak / MegRem Softball (featured coach / brand)
- Presenter if identifiable: Megan Rembielak
- Metadata conflicts: YouTube publisher is TannerTees; instructor brand on-screen is "MegRem Softball". Resolved: TannerTees is the commercial publishing channel featuring MegRem.
- Confidence: HIGH

### TIMESTAMP VERIFICATION
- Existing claimed start: 00:07 (7s)
- Existing claimed end: 00:43 (43s)
- Independently verified start: 00:07
- Independently verified end: 00:43
- Timestamp verdict: **VERIFIED**
- Notes: 00:07–00:43 explains the mechanical concept of extension through the hitting zone and why hitters roll over early into ground balls. The Two Tee drill execution is shown immediately after (~00:44).

### SOURCE MEANING
- What the source actually says/shows: Rembielak demonstrates that post-contact extension means driving the bat barrel forward through the hitting "tunnel" toward the pitcher. This directional barrel path maximizes power and ball flight direction, preventing the hands and wrists from rolling over prematurely into weak ground balls.
- Does the existing candidate accurately represent it?: **PARTIAL**
- Material omission or distortion: General baseball/softball jargon often misinterprets "extension" as reaching or casting the arms straight. The source specifically defines extension as *barrel path direction through the zone post-contact*.
- Is causal language supported by the source itself?: YES (premature wrist rolling is correctly framed as a mechanical consequence of pulling the barrel out of the hitting zone).
- Is the coaching cue actually source-provided?: YES ("Drive the barrel through the tunnel from home to the pitcher").
- Is the drill relationship actually source-provided?: YES (Two Tee Extension Drill with two batting tees).

### SCOPE
- Baseball / softball / both: Softball
- Age/level actually supported by the source: Youth through college softball (general).
- Does existing scope need narrowing?: YES — must be narrowed from `both` to `softball`. The demonstration is entirely softball-specific (softballs, 12" ball diameter, softball swing path).
- Applies_when supported?: YES ("Executing swing follow-through and extension on pitches through the middle of the zone.")
- Does_not_apply_when supported?: YES ("Adjusting to extreme inside pitch locations where hand path must clear tightly.")

### EVIDENCE QUALITY
- Evidence type: `coaching_heuristic`
- Rationale: Practical instructional heuristic operationalized by a double-tee drill constraint.

### HITTERLOOP RELEVANCE
- Observable from ordinary game/practice video: **YES** (barrel path progression through contact/extension video frames is clearly observable).
- Requires unavailable measurement: NO.
- Appropriate to constrain HitterLoop swing analysis: **YES** (constrains post-contact barrel path and prevents misdiagnosing roll-over).

### VERIFICATION VERDICT
**VERIFIED_BUT_EDIT_REQUIRED**

- Proposed corrected claim: "Extending the bat barrel through the hitting zone tunnel toward the pitcher after contact optimizes directional ball flight and power while preventing premature wrist rollover."
- Proposed corrected sport scope: softball
- Proposed corrected age/level scope: youth_appropriate (general amateur)
- Proposed corrected applies_when: Executing swing follow-through and extension on pitches through the middle and outer parts of the zone.
- Proposed corrected does_not_apply_when: Adjusting to extreme inside pitch locations where hand path must clear tightly without full forward barrel extension.
- Proposed corrected evidence type: coaching_heuristic
- Reason: Restricts sport scope to softball only and sharpens "extension" wording to explicitly reference the barrel path through the hitting tunnel, preventing confusion with arm-casting.

--------------------------------------------------
## 3. CLAIM ID: GAS-001

### VIDEO ACCESS
- Accessible: YES
- If NO, reason: N/A

### SOURCE METADATA
- Video title: "JT Gasso Hitting Technique: 3-Plate Drill"
- Channel/publisher: FloCollege | Softball (FloSports network)
- Presenter if identifiable: JT Gasso (University of Oklahoma Assistant Coach / Hitting Coach)
- Metadata conflicts: Real publisher is FloCollege | Softball (FloSports), not "Oklahoma Softball" (employer) or "FloSoftball" (legacy brand).
- Confidence: HIGH (channel/title verified; publish date remains unconfirmed/UNKNOWN).

### TIMESTAMP VERIFICATION
- Existing claimed start: 00:15 (15s)
- Existing claimed end: 00:28 (28s)
- Independently verified start: 00:15
- Independently verified end: 00:28
- Timestamp verdict: **VERIFIED**
- Notes: Clip is short (~28s total). 00:15–00:28 captures the core instruction and hitter movement across the three plates.

### SOURCE MEANING
- What the source actually says/shows: JT Gasso explains that moving hitters sequentially between three home plates set up at varying distances from the front tosser trains hitters to adjust their internal timing rhythm, tempo, and contact depth relative to changing ball arrival times.
- Does the existing candidate accurately represent it?: **YES**
- Material omission or distortion: None. The candidate is a faithful paraphrase of this short highlight clip.
- Is causal language supported by the source itself?: YES (pure drill-structure prescription).
- Is the coaching cue actually source-provided?: N/A (none extracted).
- Is the drill relationship actually source-provided?: YES (3-Plate Timing Drill).

### SCOPE
- Baseball / softball / both: Softball
- Age/level actually supported by the source: High school, travel ball, college (teen+).
- Does existing scope need narrowing?: NO (already correctly scoped to softball and teen_appropriate).
- Applies_when supported?: YES ("Practicing timing rhythm and reaction-time adjustments during front toss or live pitching practice.")
- Does_not_apply_when supported?: YES ("Isolating stationary swing mechanics on a tee where pitch arrival time is not a factor.")

### EVIDENCE QUALITY
- Evidence type: `drill_prescription`
- Rationale: Pure drill protocol designed to challenge dynamic timing adaptability.

### HITTERLOOP RELEVANCE
- Observable from ordinary game/practice video: **YES** (multi-plate practice setup and tempo adjustments are directly visible).
- Requires unavailable measurement: NO.
- Appropriate to constrain HitterLoop swing analysis: **YES** (as drill recommendation for timing variability).

### VERIFICATION VERDICT
**VERIFIED_AS_WRITTEN**

--------------------------------------------------
## 4. CLAIM ID: ABCA-YT-001

### VIDEO ACCESS
- Accessible: YES
- If NO, reason: N/A

### SOURCE METADATA
- Video title: "Youth Practice Plan Series | Hitting Tips"
- Channel/publisher: American Baseball Coaches Association (ABCA)
- Presenter if identifiable: Ryan Brownlee (ABCA Assistant Executive Director for Coaching Outreach)
- Metadata conflicts: On-screen facility/partner logo is "Golden Spikes Baseball" (USA Baseball / ABCA youth development program); uploader is ABCA. Resolved: ABCA official production in partnership with Golden Spikes.
- Confidence: HIGH

### TIMESTAMP VERIFICATION
- Existing claimed start: 06:18 (378s)
- Existing claimed end: 08:20 (500s)
- Independently verified start: 06:18
- Independently verified end: 08:20
- Timestamp verdict: **VERIFIED**
- Notes: Ryan Brownlee demonstrates tee contact points and visual seam orientation from 06:18 through 08:20.

### SOURCE MEANING
- What the source actually says/shows: When setting up a batting tee for pitch-location work, the contact depth must change relative to the hitter's body: outside pitches should be hit deeper (off the lead hip/inside corner), middle pitches off the front/lead foot, and inside pitches out in front of the lead foot.
- Does the existing candidate accurately represent it?: **YES**
- Material omission or distortion: None.
- Is causal language supported by the source itself?: YES (stated as a foundational geometry convention for practice).
- Is the coaching cue actually source-provided?: YES ("Outside off lead hip, middle off lead foot, inside out front").
- Is the drill relationship actually source-provided?: YES (Tee placement baseline for Horseshoe Seam Visual Placement Drill).

### SCOPE
- Baseball / softball / both: Baseball
- Age/level actually supported by the source: Youth and amateur baseball (youth_appropriate).
- Does existing scope need narrowing?: NO (properly scoped to baseball and youth).
- Applies_when supported?: YES ("Setting up batting-tee drills for specific pitch-location practice.")
- Does_not_apply_when supported?: YES ("Practicing dynamic pitch recognition or live-pitching hitting without controlled tee setups.")

### EVIDENCE QUALITY
- Evidence type: `coaching_instruction`
- Rationale: Standard pedagogical baseline rule for stationary tee setup.

### HITTERLOOP RELEVANCE
- Observable from ordinary game/practice video: **YES** (tee position relative to hitter's stride foot and lead hip is directly measurable/observable on video).
- Requires unavailable measurement: NO.
- Appropriate to constrain HitterLoop swing analysis: **YES** (guides tee-drill review and contact depth evaluation).

### VERIFICATION VERDICT
**VERIFIED_AS_WRITTEN**

--------------------------------------------------
## 5. CLAIM ID: ABCA-YT-002

### VIDEO ACCESS
- Accessible: YES
- If NO, reason: N/A

### SOURCE METADATA
- Video title: "Youth Practice Plan Series | Hitting Tips"
- Channel/publisher: American Baseball Coaches Association (ABCA)
- Presenter if identifiable: Ryan Brownlee (ABCA)
- Metadata conflicts: ABCA publisher vs. Golden Spikes on-screen branding (resolved as collaborative production).
- Confidence: HIGH

### TIMESTAMP VERIFICATION
- Existing claimed start: 00:58 (58s)
- Existing claimed end: 02:30 (150s)
- Independently verified start: 00:58
- Independently verified end: 02:30
- Timestamp verdict: **VERIFIED**
- Notes: Brownlee introduces and demonstrates the Med Ball Jump Back drill with youth players from 00:58 to 02:30, explicitly stating the 2–4 lb ball guideline.

### SOURCE MEANING
- What the source actually says/shows: Demonstrates youth players using a light medicine ball (2–4 lbs) to perform a jump-back toss. The drill forces the player to hinge into the back hip upon landing and maintain pressure on the inside of the back knee/foot, creating dynamic stability and rear-hip load before rotational release.
- Does the existing candidate accurately represent it?: **YES**
- Material omission or distortion: None. Captures the exact drill mechanism and youth safety parameters.
- Is causal language supported by the source itself?: YES (uses movement constraint to induce hip loading).
- Is the coaching cue actually source-provided?: YES ("Jump back and load into your back hip").
- Is the drill relationship actually source-provided?: YES (Med Ball Jump Back Toss Drill).

### SCOPE
- Baseball / softball / both: Baseball
- Age/level actually supported by the source: Youth baseball (ages 6–14; youth_appropriate).
- Does existing scope need narrowing?: NO (specifically designed for youth).
- Applies_when supported?: YES ("Developing dynamic lower-half loading and back-hip weight distribution.")
- Does_not_apply_when supported?: YES ("Players lack basic lower-body balance or have joint issues requiring physical screening.")

### EVIDENCE QUALITY
- Evidence type: `drill_prescription`
- Rationale: Constraint-led drill prescription demonstrated specifically on youth athletes with equipment guardrails.

### HITTERLOOP RELEVANCE
- Observable from ordinary game/practice video: **YES** (rear leg hinge, knee angle stability, and jump-back mechanics are visually verifiable).
- Requires unavailable measurement: NO.
- Appropriate to constrain HitterLoop swing analysis: **YES** (serves as a primary loading remediation drill).

### VERIFICATION VERDICT
**VERIFIED_AS_WRITTEN**

--------------------------------------------------
## 6. CLAIM ID: BLM-001

### VIDEO ACCESS
- Accessible: YES
- If NO, reason: N/A

### SOURCE METADATA
- Video title: "Youth Hitting Drills - Swing Plane"
- Channel/publisher: Blast Motion
- Presenter if identifiable: Blast Motion Instructor
- Metadata conflicts: None.
- Confidence: HIGH

### TIMESTAMP VERIFICATION
- Existing claimed start: 00:52 (52s)
- Existing claimed end: 01:45 (105s)
- Independently verified start: 00:52
- Independently verified end: 01:45
- Timestamp verdict: **VERIFIED**
- Notes: 00:52–01:45 demonstrates the PVC pipe chest rotation drill on high, middle, and low tees.

### SOURCE MEANING
- What the source actually says/shows: The instructor demonstrates how a youth hitter holding a PVC pipe across the chest must adjust to different pitch heights by maintaining spinal tilt and rotating around the body's center, rather than lunging or diving the chest forward toward the ball.
- Does the existing candidate accurately represent it?: **YES**
- Material omission or distortion: None. Extraction cleanly excluded Blast's proprietary "on-plane %" metric, keeping only the observable mechanical drill.
- Is causal language supported by the source itself?: YES (diving the chest forward is identified as a rotational failure).
- Is the coaching cue actually source-provided?: YES ("Rotate around your center so the pipe comes to the tee—don't dive your chest forward").
- Is the drill relationship actually source-provided?: YES (PVC Pipe Chest Rotation Drill).

### SCOPE
- Baseball / softball / both: Both
- Age/level actually supported by the source: Youth through advanced (youth_appropriate).
- Does existing scope need narrowing?: NO.
- Applies_when supported?: YES ("Working on swing plane control, torso rotation, and pitch location adjustment.")
- Does_not_apply_when supported?: YES ("Full game situations where timing and stride dynamics vary unpredictably.")

### EVIDENCE QUALITY
- Evidence type: `drill_prescription`
- Rationale: Constraint-based posture drill using standard equipment (PVC pipe and tee).

### HITTERLOOP RELEVANCE
- Observable from ordinary game/practice video: **YES** (spinal angle, torso rotation, and chest lunge are directly observable).
- Requires unavailable measurement: NO (independent of Blast Motion hardware sensors).
- Appropriate to constrain HitterLoop swing analysis: **YES** (posture evaluation baseline).

### VERIFICATION VERDICT
**VERIFIED_AS_WRITTEN**

*Reviewer Note on Contradiction Matrix*: BLM-001's internal-focus verbal cue ("Rotate around your center") stands in deliberate philosophical contradiction with DRV1-001's external-focus research evidence. This contradiction is preserved in `methodology-contradictions-v1.md` for human governance.

--------------------------------------------------
## 7. CLAIM ID: SCI-002

### VIDEO ACCESS
- Accessible: YES
- If NO, reason: N/A

### SOURCE METADATA
- Video title: "The Science Behind Hitting in Baseball with: Chad Miller"
- Channel/publisher: Let's Have This Conversation (Podcast)
- Presenter if identifiable: Kevin McShan (Host; corrected from initial transcript "Tevin McChan"); Chad Miller (Guest, Founder of Louisville Slugger Hitting Science Center)
- Metadata conflicts: Initial extraction recorded host as "Tevin McChan"; verified host name is Kevin McShan. Channel is a conversational interview podcast, NOT a peer-reviewed research entity.
- Confidence: HIGH (as podcast interview metadata).

### TIMESTAMP VERIFICATION
- Existing claimed start: 15:43 (943s)
- Existing claimed end: 16:10 (970s)
- Independently verified start: 15:43
- Independently verified end: 16:10
- Timestamp verdict: **VERIFIED**
- Notes: 15:43–16:10 covers Chad Miller's qualitative description of ground-up kinetic-energy transfer through the swing sequence.

### SOURCE MEANING
- What the source actually says/shows: Chad Miller describes hitting as a sequential transfer of kinetic energy starting from the ground and progressing through the hips, torso/shoulders, arms/hands, and finally into the bat barrel to stay behind the ball.
- Does the existing candidate accurately represent it?: **PARTIAL**
- Material omission or distortion: Candidate claim opened with normative absolutism ("Optimal hitting mechanics rely on..."), whereas the source was describing a general proximal-to-distal biomechanical framework during an interview.
- Is causal language supported by the source itself?: YES (kinetic chain sequencing as energy transfer mechanism).
- Is the coaching cue actually source-provided?: YES ("Drive from the ground up through hips, shoulders, and hands").
- Is the drill relationship actually source-provided?: N/A (interview format, no drill).

### SCOPE
- Baseball / softball / both: Both
- Age/level actually supported by the source: General (youth through professional).
- Does existing scope need narrowing?: NO (general concept).
- Applies_when supported?: YES ("Executing a full-effort rotational swing.")
- Does_not_apply_when supported?: YES ("Executing check swings, bunts, or emergency contact swings.")

### EVIDENCE QUALITY
- Evidence type: `biomechanical_explanation`
- Rationale: Interview commentary explaining the kinetic chain. Under NO circumstances should this be upgraded to `research_supported`, as no peer-reviewed methodology or data was presented in the video.

### HITTERLOOP RELEVANCE
- Observable from ordinary game/practice video: **PARTIAL** (qualitative proximal-to-distal sequence is visible on high-speed video, but precise millisecond timing of kinetic energy transfer requires lab measurement).
- Requires unavailable measurement: Lab-grade 3D motion capture / force plates for exact kinetic quantification, but qualitative sequence remains observable.
- Appropriate to constrain HitterLoop swing analysis: **PARTIAL** (appropriate as qualitative concept; must not be used to enforce rigid quantitative timing windows).

### VERIFICATION VERDICT
**VERIFIED_BUT_EDIT_REQUIRED**

- Proposed corrected claim: "Kinetic-chain energy transfer in a full-effort swing progresses sequentially from the ground up through the hips, torso, hands, and bat barrel."
- Proposed corrected sport scope: both
- Proposed corrected age/level scope: youth_appropriate (general)
- Proposed corrected applies_when: Executing a full-effort rotational swing.
- Proposed corrected does_not_apply_when: Executing check swings, bunts, or emergency contact adjustments.
- Proposed corrected evidence type: biomechanical_explanation
- Reason: Removes normative absolutism ("Optimal hitting mechanics rely on...") to reflect qualitative interview explanation, corrects host metadata to Kevin McShan, and firmly maintains `biomechanical_explanation` evidence type.

--------------------------------------------------
## 8. CLAIM ID: DRV1-001

### VIDEO ACCESS
- Accessible: YES
- If NO, reason: N/A

### SOURCE METADATA
- Video title: "How To Coach Hitting Mechanics Pt. 1 | Driveline Baseball" (On-screen title: "Coaching Hitting Mechanics with Jason Ochart Pt. 1")
- Channel/publisher: Driveline Baseball
- Presenter if identifiable: Jason Ochart (former Driveline Director of Hitting)
- Metadata conflicts: None. Presenter identity verified as Jason Ochart.
- Confidence: HIGH

### TIMESTAMP VERIFICATION
- Existing claimed start: 00:38 (38s)
- Existing claimed end: 01:03 (63s)
- Independently verified start: 00:38
- Independently verified end: 01:03
- Timestamp verdict: **VERIFIED**
- Notes: 00:38–01:03 displays on-screen academic citations and Ochart's breakdown of internal vs. external attentional focus.

### SOURCE MEANING
- What the source actually says/shows: Jason Ochart presents motor-learning principles, citing research showing that external focus of attention (focusing on movement effects, bat path, or ball flight) promotes superior force production, movement economy, and automatic motor sequencing compared to internal focus of attention (focusing on body parts, joint angles, or muscle movements).
- Does the existing candidate accurately represent it?: **YES**
- Material omission or distortion: None.
- Is causal language supported by the source itself?: YES (supported directly by on-screen academic research citations).
- Identification of cited research:
  1. *Castaneda & Gray (2007)*: "Effects of focus of attention on baseball batting performance in players of differing skill levels" (Journal of Sport & Exercise Psychology) — directly tested baseball hitters and found external focus produced superior swing kinematics and batting performance.
  2. *Wulf & Su (2007) / Wulf (2010)*: Extensive motor-learning literature demonstrating external focus enhances motor unit recruitment efficiency and force output.
  3. *Wu et al. (2012)*: Attentional focus in motor learning and movement dynamics.
- Does cited research support the exact claim?: YES. The cited literature specifically validates that external focus yields superior force production and motor sequencing relative to internal body cues.
- Is the coaching cue actually source-provided?: YES ("Focus on ball flight trajectory and where you want to hit the ball rather than internal body movement").
- Is the drill relationship actually source-provided?: N/A (coaching philosophy/policy claim).

### SCOPE
- Baseball / softball / both: Both (motor-learning mechanism applies across sports).
- Age/level actually supported by the source: Youth through professional (youth_appropriate).
- Does existing scope need narrowing?: NO.
- Applies_when supported?: YES ("Delivering verbal feedback during batting practice, cage work, or game preparation.")
- Does_not_apply_when supported?: YES ("Conducting explicit body-awareness drills or physical therapy screenings where internal focus is intentionally required.")

### EVIDENCE QUALITY
- Evidence type: `research_supported`
- Rationale: Fully verified. On-screen citations to published, peer-reviewed motor-learning papers (including Castaneda & Gray's direct baseball batting study) directly support the proposition.

### HITTERLOOP RELEVANCE
- Observable from ordinary game/practice video: **PARTIAL** (internal cognitive focus is not directly visible in swing pixels; this claim operates as a policy constraint governing how HitterLoop AI phrases coaching cues).
- Requires unavailable measurement: NO (applied as an AI generation constraint).
- Appropriate to constrain HitterLoop swing analysis: **YES** (directly governs coaching-cue phrasing architecture).

### VERIFICATION VERDICT
**VERIFIED_AS_WRITTEN**

---

# Verification Summary & Disagreements Log

### Disagreements with Earlier Gemini Extractions
1. **DRV2-001 Causal Assertion**: Initial extraction treated early loading as the established root cause of lunging. Verification audit softened this to co-occurring diagnostic heuristic.
2. **TAN-001 Sport Scope**: Initial extraction defaulted to `both`. Verification audit strictly narrowed this to `softball`.
3. **TAN-001 Concept Definition**: Clarified that "extension" in the source specifically denotes barrel path through the hitting tunnel, preventing confusion with arm-casting.
4. **SCI-002 Host Metadata & Normative Phrasing**: Initial extraction misrecorded host name as "Tevin McChan" (verified: Kevin McShan) and phrased the claim with normative absolutism ("Optimal mechanics..."). Verification audit corrected metadata, softened wording, and confirmed `biomechanical_explanation` evidence type (rejecting any upgrade to `research_supported`).
5. **DRV1-001 Research Citation Verification**: Confirmed on-screen citations (Castaneda & Gray 2007, Wulf 2010, Wu 2012) and verified that presenter is Jason Ochart, justifying `research_supported` status.
