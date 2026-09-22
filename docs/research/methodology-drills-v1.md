# Methodology Drills — Research v1

Companion to `methodology-seed-v1.md`. All 12 drills identified across the 8
successfully-reviewed videos (Antonelli and Candrea remain blocked — see
that document). **None of these are HitterLoop production drill-library
entries.** Per the architecture's Phase-1 decision, drill linkage
(`related_drill_id`) is deliberately out of the required v1 review
workflow — this document exists so a later, deliberate curation step has
something concrete to work from, not to create drill records now.

Every entry below uses `DRILL MATCH: needs later drill-library review`
because no comparison against HitterLoop's actual production drill library
was performed as part of this research task (out of scope here).

---

### Step-Behind Momentum Drill
- **Source:** Driveline Baseball, Video 1 (~02:09 / 129s, Gemini estimate)
- **Targeted problem:** Gaining momentum and transferring linear force
  accurately into the swing using a movement constraint.
- **Sport:** both
- **Age/level caution:** Suited for teen and advanced hitters (per Gemini);
  proper footwork/balance required.
- **Equipment:** Bat, balls, tee or toss feeder.
- **Tied to a specific fault?** No (general momentum-transfer training).
- **HitterLoop-observable afterward?** Partially — the drill's *execution*
  is observable; whether it produced the intended swing change would need a
  before/after comparison HitterLoop already supports via its Compare
  feature, not anything new.
- **DRILL MATCH:** needs later drill-library review.

### Underload/Overload Variable Bat Training
- **Source:** Driveline Baseball, Video 1 (~02:15 / 135s, Gemini estimate)
- **Targeted problem:** Building swing speed, motor adaptability, and
  mechanical efficiency through bat-load variation.
- **Sport:** both
- **Age/level caution:** Appropriate load selection matters for younger
  athletes — this document does not recommend a specific weight; a human
  (ideally with strength-and-conditioning input) should set youth-safe
  parameters before this becomes a HitterLoop-recommended drill.
- **Equipment:** Underload and overload weighted bats, training balls.
- **Tied to a specific fault?** No.
- **HitterLoop-observable afterward?** Yes, via swing-speed proxies visible
  in video, though HitterLoop does not currently measure bat speed directly
  (see the architecture's explicit "metrics/3D integration is out of
  scope" boundary — this drill's full value depends on capability
  HitterLoop doesn't have yet).
- **DRILL MATCH:** needs later drill-library review.

### Step Backs
- **Source:** Driveline Baseball, Video 2 (~01:19 / 79s, Gemini estimate)
- **Targeted problem:** Loading too early, failing to engage the back
  hip/glute, poor timing rhythm relative to the pitcher/tosser.
- **Sport:** baseball
- **Age/level caution:** "Youth appropriate" per Gemini's extraction —
  unconfirmed by a human; recommend a human sanity-check before trusting
  this for young hitters given it's explicitly a timing-correction drill.
- **Equipment:** Bat, balls, front-toss screen/tosser.
- **Tied to a specific fault?** Yes — explicitly tied to the early-loading
  diagnosis (`DRV2-001`).
- **HitterLoop-observable afterward?** Yes — timing (early vs. on-time
  contact) is a genuinely observable pattern across multiple at-bats.
- **DRILL MATCH:** needs later drill-library review.

### Modified Hook 'Em
- **Source:** Driveline Baseball, Video 2 (~01:58 / 118s, Gemini estimate)
- **Targeted problem:** Uncontrolled forward move and failing to load the
  upper half, leading to spinning off pitches early.
- **Sport:** baseball
- **Age/level caution:** Same caveat as Step Backs above.
- **Equipment:** Bat, balls, front-toss screen/tosser.
- **Tied to a specific fault?** Yes — tied to `DRV2-001`.
- **HitterLoop-observable afterward?** Yes.
- **DRILL MATCH:** needs later drill-library review.

### Offset Open
- **Source:** Driveline Baseball, Video 2 (~02:47 / 167s, Gemini estimate)
- **Targeted problem:** Spinning off pitches early, failing to maintain
  posture through the swing phase.
- **Sport:** baseball
- **Age/level caution:** Same caveat as Step Backs above.
- **Equipment:** Bat, balls, front-toss screen/tosser.
- **Tied to a specific fault?** Yes — tied to `DRV2-001`.
- **HitterLoop-observable afterward?** Yes.
- **DRILL MATCH:** needs later drill-library review.

### Two Tee Extension Drill
- **Source:** TannerTees / Megan Rembielak, Video 3 (~00:44 / 44s, Gemini
  estimate)
- **Targeted problem:** Pulling the bat barrel out of the hitting zone too
  early and rolling over prematurely into ground balls.
- **Sport:** softball
- **Age/level caution:** "Suitable for all skill levels" per Gemini —
  reasonable, no specific youth-safety concern identified.
- **Equipment:** Two batting tees, two softballs (specifically a "Tanner
  Tee" product in the source video — note the commercial/product angle from
  the source registry).
- **Tied to a specific fault?** Yes — tied to `TAN-001`.
- **HitterLoop-observable afterward?** Yes — barrel path through and past
  the contact zone is visible in ordinary swing video.
- **DRILL MATCH:** needs later drill-library review.

### PVC Pipe Chest Rotation Drill
- **Source:** Blast Motion, Video 4 (~00:10 / 10s, Gemini estimate)
- **Targeted problem:** Lunging/diving at the ball with the upper body,
  failing to use body rotation to control swing plane.
- **Sport:** both
- **Age/level caution:** Appropriate for youth and above, per Gemini.
- **Equipment:** PVC pipe, batting tee.
- **Tied to a specific fault?** Yes — tied to `BLM-001`.
- **HitterLoop-observable afterward?** Yes — chest/torso lean relative to
  the tee position is a genuinely observable posture pattern.
- **DRILL MATCH:** needs later drill-library review.

### 3-Plate Timing Drill
- **Source:** FloCollege \| Softball / JT Gasso, Video 6 (~00:15 / 15s,
  Gemini estimate)
- **Targeted problem:** Poor timing variability, inability to adjust to
  different pitch speeds/release distances.
- **Sport:** softball
- **Age/level caution:** Teen-appropriate per this document's recommendation
  (dynamic timing training, not youth-appropriate by default).
- **Equipment:** 3 home plates (placed at varying distances from the
  tosser), softballs, front-toss screen, bat.
- **Tied to a specific fault?** No (general timing-adaptability drill).
- **HitterLoop-observable afterward?** Yes — timing consistency across
  varied pitch depths is observable across multiple reps/at-bats.
- **DRILL MATCH:** needs later drill-library review.

### Med Ball Jump Back Toss Drill
- **Source:** ABCA, Video 8 (~00:58 / 58s, Gemini estimate)
- **Targeted problem:** Poor lower-half load, lack of hip rotation, swaying
  over the back knee.
- **Sport:** baseball
- **Age/level caution:** Use light medicine balls (2–4 lbs) for young
  hitters — explicit, concrete youth-safety detail from the source itself.
- **Equipment:** Light medicine ball (2–4 lbs), net or wall.
- **Tied to a specific fault?** Yes — tied to `ABCA-YT-002`.
- **HitterLoop-observable afterward?** Partially — the drill execution
  itself is observable; whether it changed in-game hip-loading pattern
  would need a before/after swing comparison.
- **DRILL MATCH:** needs later drill-library review.

### Med Ball Scoop Toss Drill
- **Source:** ABCA, Video 8 (~02:25 / 145s, Gemini estimate)
- **Targeted problem:** Lack of hip hinge, failure to release the backside
  through swing rotation.
- **Sport:** baseball
- **Age/level caution:** Ensure correct medicine-ball weight to prevent
  strain (per Gemini's extraction).
- **Equipment:** Light medicine ball, net or wall.
- **Tied to a specific fault?** Yes.
- **HitterLoop-observable afterward?** Partially, same reasoning as above.
- **DRILL MATCH:** needs later drill-library review.

### Volleyball Knee Squeeze Drill
- **Source:** ABCA, Video 8 (~04:09 / 249s, Gemini estimate)
- **Targeted problem:** Knee flare during stride, weak lower-body
  connection.
- **Sport:** baseball
- **Age/level caution:** "Safe for all youth players" per Gemini.
- **Equipment:** Soft dodgeball, volleyball, or connection ball.
- **Tied to a specific fault?** Yes.
- **HitterLoop-observable afterward?** Yes — knee position during stride is
  directly visible.
- **DRILL MATCH:** needs later drill-library review.

### Horseshoe Seam Visual Placement Drill
- **Source:** ABCA, Video 8 (~05:38 / 338s, Gemini estimate)
- **Targeted problem:** Losing visual focus on the inner half of the ball
  during tee work.
- **Sport:** baseball
- **Age/level caution:** None specifically flagged.
- **Equipment:** Batting tee, baseball, bat.
- **Tied to a specific fault?** No (general visual-tracking drill).
- **HitterLoop-observable afterward?** Not directly — visual focus itself
  isn't observable from outside video; only downstream contact-quality
  effects would be.
- **DRILL MATCH:** needs later drill-library review.

---

## Not yet covered (blocked sources)

Antonelli Softball (Video 5) and Championship Productions/Candrea (Video 7)
were both blocked by the Gemini API quota this round — see
`methodology-seed-v1.md`. Neither's drill content (if any) is represented
above; this is a known gap, not a decision that those videos lack drills.
