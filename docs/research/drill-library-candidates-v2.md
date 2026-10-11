# Drill Library Candidates v2 (watch-verified)

**Status: APPROVED (2026-10-11).** All 90 watch-verified candidate drills approved with safety guardrails applied (21 drills require protective screen / adult feeding; 7 weighted/overspeed drills require min_age 13; imported into `drill_library` via migration 00062 and `npm run import-curated-drills`).

## How this was produced

1. **Search:**
   - Five AGY/Gemini research workers proposed 72 drill candidates across the 14 swing concepts
     the app can raise, plus a softball-specific pass.
   - A second, targeted YouTube search added 36 videos for the thinnest concepts:
     front-side stability, stride, finish/balance, and stance.
2. **Link check:** every YouTube link was confirmed real via YouTube's oEmbed API. About half
   credited the wrong coach or didn't match the drill, so search output alone was not trusted.
3. **Watch check:** each candidate video was actually *watched*, frames plus audio:
   - 9 by the Gemini API, until it hit the free-tier quota;
   - 101 by AGY, which downloads the video and analyzes it.
   - **110 videos watched in total.**
   - Only drills **demonstrated in the video** are kept. Videos with no demonstrated drill, and
     non-hitting videos (pitching, catching, fielding), were rejected and are listed at the bottom.
4. **Credit:** comes from the presenter named in the video plus the YouTube channel, with a link
   and approximate timestamp.

## Before approving a drill

- **Rewrite "Best for"** into one specific sentence saying exactly what the drill is meant for,
  distinct from other drills under the same concept. The drafts are model-written.
- **Steps are paraphrased** in plain parent language, not transcribed. Keep them in our own words
  and keep the source credit and link. Don't copy a coach's script or video.
- **Two kinds of ⚠️ flag:**
  - **Age/equipment flag** (7 drills): weighted or heavy implements, dumbbells, overspeed, or
    older-player-only notes. Decide the minimum age (`min_age`) before approving.
  - **Safety flag** (21 drills): a partner or feeder stands near the swinging bat or in front of
    the hitter (holding the bat, front/side toss, bounce feeds). Before approving, require a
    protective screen and/or adult-only feeding, or reject the drill for home use with kids.
  - **Both flags are keyword-based.** They over-flag, and they can miss things. Read every drill's
    steps with safety in mind; the flags don't replace that.
- **Concept labels are the model's best guess.** Move a drill if it's filed under the wrong
  concept.
- **Same drill, different coaches:** where the same drill appears in several videos, they're listed
  as "also shown in".

## Coverage

- Every concept has at least 3 watch-verified drills, so the app can offer up to 3 per fix.
- "Contact" and "Foundation" have exactly 3. Adding more there is optional.

## Summary

Videos watched: 110 (+0 could not be processed). Drills actually demonstrated: 96; after de-duplication: 90.

Safety flags: 21 drills put a person near the swing or in the ball's path; 7 drills carry an age/equipment flag.

| Concept | Drills | Home-friendly | Under-13 OK |
|---|---|---|---|
| Stance & setup | 4 | 4 | 4 |
| Load | 9 | 9 | 9 |
| Stride & foot plant | 4 | 4 | 4 |
| Timing | 6 | 4 | 6 |
| Hip-shoulder sequencing | 5 | 4 | 5 |
| Posture | 9 | 8 | 8 |
| Head & eyes stability | 5 | 5 | 4 |
| Front-side stability | 10 | 10 | 9 |
| Hand path | 7 | 7 | 7 |
| Barrel path | 11 | 9 | 9 |
| Barrel depth | 4 | 4 | 4 |
| Contact | 3 | 2 | 3 |
| Extension | 5 | 4 | 3 |
| Finish & balance | 5 | 3 | 5 |
| Foundation (any fault, ages 8-10) | 3 | 3 | 3 |


## Stance & setup (`stance_setup`)

### D01. Open Stance Drill
- **Review:** ☑ Approve ☐ Edit ☐ Reject
- **Best for (draft, edit before approving):** closed stance or rotational issues
- **Sport:** softball · **Home-friendly:** yes · **Equipment:** tee, bat, softball, two PVC pipes
- **Age:** 
- **Steps:**
  1. Place one PVC pipe on the ground pointing toward the pitcher.
  2. Place a second PVC pipe on the ground at an angle to create an open stance guide.
  3. Set up your feet matching the angle of the second pipe to ensure an open stance.
  4. Hit the ball off the tee while maintaining this open setup.
- **Cue:** "Stay open"
- **Looks right when:** The batter hits from an open stance while maintaining balance and proper rotation.
- **Common mistakes:** 
- **Source:** The Softball Doctor, [💥Open Stance Drill💥](https://www.youtube.com/watch?v=6_L8YlS6WoQ) at ~0:00

### D02. Hop Drill
- **Review:** ☑ Approve ☐ Edit ☐ Reject
- **Best for (draft, edit before approving):** unathletic batting stance with feet too close together and straight legs
- **Sport:** baseball · **Home-friendly:** yes · **Equipment:** bat
- **Age:** 
- **Steps:**
  1. Start in an unathletic position with hands up, straight legs, and feet close together.
  2. Hop outwards so your feet land just outside your shoulders.
  3. Land softly in a low, athletic position.
  4. Load and swing the bat from this strong stance.
- **Cue:** "Hop into an athletic position"
- **Looks right when:** The batter lands balanced with feet slightly wider than shoulders and knees bent in an athletic posture.
- **Common mistakes:** Jumping too high; Jumping too wide
- **Source:** Bobby Brown Baseball, [The HOP DRILL for a move athletic batting stance #baseball #hittingmechanics #baseballplayer #swing](https://www.youtube.com/watch?v=Ksr6rEkzC-I) at ~0:10

### D03. Batter's Box Routine
- **Review:** ☑ Approve ☐ Edit ☐ Reject
- **Best for (draft, edit before approving):** Rushed at-bats, low confidence, lack of mental focus, and physical tension before swings.
- **Sport:** softball · **Home-friendly:** yes · **Equipment:** Bat
- **Age:** Suitable for all age levels to establish healthy mental and physical pre-pitch habits.
- **Steps:**
  1. Walk with confident body language from the on-deck circle to the box.
  2. Step near the box to level the dirt, take practice swings, and pick up the third-base coach's signals.
  3. Scan the infield defense to identify defensive alignment and potential opportunity.
  4. Place one foot in the box, focus on a visual target, take a deep breath, and enter fully.
  5. Establish a comfortable rhythm (big to small movement) to stay loose and use positive self-talk and visualization before each pitch.
- **Cue:** "Deep breath, stay loose, positive talk."
- **Looks right when:** The hitter looks relaxed, confident, follows a repeatable pre-pitch sequence, and stays mentally focused.
- **Common mistakes:** Rushing straight to the third-base coach without processing the prior pitch; Tensing up and staying static in the stance; Using negative self-talk such as telling oneself what not to do
- **Safety:** Ensure sufficient space around the batter's box when taking warm-up swings.
- **Source:** Amanda Scarborough · Team Express, [Softball Hitting Tips: Batter's Box Routine - Amanda Scarborough](https://www.youtube.com/watch?v=ON-hx6SuiEU) at ~00:06

### D04. UAP and Listen to Your Thumb
- **Review:** ☑ Approve ☐ Edit ☐ Reject
- **Best for (draft, edit before approving):** Stiff legs, poor athletic posture, or hands resting too low or too high
- **Sport:** both · **Home-friendly:** yes · **Equipment:** Bat
- **Age:** Ideal for youth players
- **Steps:**
  1. Have the player assume a Universal Athletic Position (UAP), similar to guarding someone in basketball.
  2. Focus on an overall athletic ready posture instead of just telling them to bend their knees.
  3. Bring the hands up so the top hand's thumb is near the back ear.
  4. Instruct the player to 'listen to your thumb' to easily establish the correct hand height.
- **Cue:** "UAP, listen to your thumb"
- **Looks right when:** The player is balanced and athletic, with their hands positioned comfortably near their back ear.
- **Common mistakes:** Resting hands down by the belly; Holding hands too high up in the air
- **Safety:** None
- **Source:** Coach Justin · JustinTime Baseball, [Proper batting stance for a Youth Baseball Player! #batting #baseball #battingstance](https://www.youtube.com/watch?v=SqHHJsMNkNM) at ~0:00-0:47


## Load (`load`)

### D05. Step Back Drill
- **Review:** ☑ Approve ☐ Edit ☐ Reject
- **Best for (draft, edit before approving):** understanding movement and creating a good gather position
- **Sport:** baseball · **Home-friendly:** yes · **Equipment:** bat, tee, baseballs
- **Age:** None
- **Steps:**
  1. Start in a normal 50/50 setup slightly behind the baseball
  2. Pick up the back leg and step backward into a gather position
  3. Land in balance, then step forward and hit the baseball
- **Cue:** "step back and forward"
- **Looks right when:** you land in balance after stepping back and move smoothly forward
- **Common mistakes:** failing to land in balance after taking the step back
- **Safety:** None
- **Source:** BASE by Pros, [Baseball Hitting Drill: Step Back](https://www.youtube.com/watch?v=1bK3iPt-wOk) at ~0:07 (also shown in 2 other video(s): [Driveline Baseball](https://www.youtube.com/watch?v=AkwKO0J2SEM), [Dominate The Diamond](https://www.youtube.com/watch?v=EQmJc_nRscc))

### D06. Skater Drill
- **Review:** ☑ Approve ☐ Edit ☐ Reject
- **Best for (draft, edit before approving):** Poor rhythm or rushed weight transfer.
- **Sport:** baseball · **Home-friendly:** yes · **Equipment:** Tee, bat, balls
- **Age:** 
- **Steps:**
  1. Begin from your regular batting stance.
  2. Hop slightly forward onto your front foot.
  3. Hop backward onto your back foot to load.
  4. Drive forward from the back foot and swing.
- **Cue:** "Forward, back, drive"
- **Looks right when:** The player demonstrates a rhythmic and dynamic balance on the back leg before the swing.
- **Common mistakes:** Losing balance during the jumping motions
- **Source:** Dominate The Diamond, [STEP BACK Hitting Drill | Perfect Your Swing](https://www.youtube.com/watch?v=EQmJc_nRscc) at ~00:40

### D07. Figure 4 Drill
- **Review:** ☑ Approve ☐ Edit ☐ Reject
- **Best for (draft, edit before approving):** stepping away from the back leg or having no back leg at all
- **Sport:** baseball · **Home-friendly:** yes · **Equipment:** bat
- **Age:** None
- **Steps:**
  1. Lift the front leg up to create a figure 4 position
  2. Sink into the back leg to create tension on the inside of the leg
  3. Hold the position to feel the back side supporting the body's forward movement
- **Cue:** "feel the inside of your leg"
- **Looks right when:** tension is felt in the back leg while maintaining a balanced position
- **Common mistakes:** stepping away from the back leg; having no back leg connection at all
- **Safety:** None
- **Source:** Doug Latta · Youth Baseball Edge, [Figure 4 drill with Doug Latta](https://www.youtube.com/watch?v=IGJmFJyUwIs) at ~0:11

### D08. Babe Ruth Drill
- **Review:** ☑ Approve ☐ Edit ☐ Reject
- **Best for (draft, edit before approving):** Lunging forward or failing to load weight on the back leg.
- **Sport:** baseball · **Home-friendly:** yes · **Equipment:** Bat, tee.
- **Age:** 
- **Steps:**
  1. Stand with your feet very close together, just a few inches apart.
  2. Coil your hips back, feeling your weight press down into your back leg.
  3. Take an exaggerated stride forward while keeping your weight held back over your rear leg.
  4. Swing from this strong, loaded position.
- **Cue:** "Screw down into the ground and hold."
- **Looks right when:** The weight remains fully loaded on the back leg as the front foot strides forward lightly.
- **Common mistakes:** Shifting the upper body and weight forward along with the stride foot.
- **Source:** Matt Antonelli · Antonelli Baseball, [3 Hitting Drills To Stop Lunging!](https://www.youtube.com/watch?v=OOCM_BazSao) at ~05:10

### D09. Cross Foot Drill
- **Review:** ☑ Approve ☐ Edit ☐ Reject
- **Best for (draft, edit before approving):** Inability to maintain a coiled load during the stride.
- **Sport:** baseball · **Home-friendly:** yes · **Equipment:** Bat, tee.
- **Age:** 
- **Steps:**
  1. Start with your front foot crossed over your back foot.
  2. Coil your hips to load your weight securely onto your back leg.
  3. Uncross your legs by taking a normal stride out, ensuring your weight stays back.
  4. Execute the swing.
- **Cue:** "Stay coiled as you stride out."
- **Looks right when:** The hitter smoothly uncrosses their legs and strides without losing their loaded posture.
- **Common mistakes:** Uncoiling too early or lunging forward during the uncross.
- **Source:** Matt Antonelli · Antonelli Baseball, [3 Hitting Drills To Stop Lunging!](https://www.youtube.com/watch?v=OOCM_BazSao) at ~08:01

### D10. Crate Drill
- **Review:** ☑ Approve ☐ Edit ☐ Reject
- **Best for (draft, edit before approving):** Putting weight on the front foot too early instead of properly loading the back leg.
- **Sport:** baseball · **Home-friendly:** yes · **Equipment:** Bat, tee, a ball or crate.
- **Age:** 
- **Steps:**
  1. Rest your front foot lightly on top of a baseball, crate, or helmet.
  2. Keep all of your body weight centered over your back leg.
  3. Coil your hips around your back leg to load.
  4. Pick up the front foot and stride forward, keeping the weight anchored back.
  5. Swing from the loaded position.
- **Cue:** "Keep the front foot light."
- **Looks right when:** The batter can cleanly stride off the object without having put any heavy pressure on it.
- **Common mistakes:** Resting weight onto the ball or crate before the stride.
- **Safety:** Be careful when resting the front foot on a baseball; avoid putting weight on it to prevent rolling an ankle.
- **Source:** Matt Antonelli · Antonelli Baseball, [3 Hitting Drills To Stop Lunging!](https://www.youtube.com/watch?v=OOCM_BazSao) at ~08:30

### D11. Step Back Over Cone Drill
- **Review:** ☑ Approve ☐ Edit ☐ Reject
- **Best for (draft, edit before approving):** Rushing forward to the front side too early instead of properly coiling and loading the back leg.
- **Sport:** baseball · **Home-friendly:** yes · **Equipment:** Bat, cone
- **Age:** None
- **Steps:**
  1. Place a cone on the ground and stand just in front of it with a slightly narrow stance.
  2. When ready, step your back foot up and over the cone, moving your body backward.
  3. As you step back, coil your weight around your back leg in a slow, controlled manner (about 50% speed).
  4. From this coiled position, stride forward toward the pitcher without rushing your front side.
- **Cue:** "Collect and coil"
- **Looks right when:** The batter maintains balance and control while stepping back, showing a clear, slow gather before exploding forward.
- **Common mistakes:** Jumping backward quickly instead of a slow, controlled step.; Rushing the forward stride immediately after stepping back.
- **Safety:** None
- **Source:** Matt Antonelli · Antonelli Softball, [Softball hitting drill to help stop you from lunging 🥎](https://www.youtube.com/watch?v=_9QbbnwRL-I) at ~0:00-0:55

### D12. Hip Coils with Resistance Band
- **Review:** ☑ Approve ☐ Edit ☐ Reject
- **Best for (draft, edit before approving):** Poor counter rotation or lack of hinging in the back hip when preparing to swing.
- **Sport:** softball · **Home-friendly:** yes · **Equipment:** Resistance band
- **Age:** 
- **Steps:**
  1. Secure a resistance band to a stable anchor point at roughly chest height.
  2. Hold the band in both hands and stand on just your back leg.
  3. Bend slightly at the hips (hinge) and turn your upper body away from the anchor.
  4. Hold your balance on that one leg as you turn to feel the coil in your back hip.
- **Cue:** "Coil into the back hip"
- **Looks right when:** The player can turn their upper body while staying perfectly balanced on their back leg without standing straight up.
- **Common mistakes:** Losing balance and falling off the back leg; Standing straight up instead of keeping a hinge at the hips
- **Safety:** Make sure the resistance band is safely tied down so it doesn't snap back.
- **Source:** Jaclyn · Driveline Softball, [Hip Coil Hitting Drill With Jacklyn Meyers](https://www.youtube.com/watch?v=aNqd5AQun-U) at ~0:01

### D13. The Arrow Drill
- **Review:** ☑ Approve ☐ Edit ☐ Reject
- **Best for (draft, edit before approving):** Not loading properly or moving the top hand early
- **Sport:** softball · **Home-friendly:** yes · **Equipment:** Bat, tee, ball
- **Age:** 
- **Steps:**
  1. Get into your stance and reach your back arm forward as if holding a bow.
  2. Pull your back hand tight like drawing an arrow to squeeze your shoulder blade.
  3. Drop the bat from your front hand into your back hand without moving your top hand.
  4. Finish your load into your back hip and swing.
- **Cue:** "Pull the arrow tight"
- **Looks right when:** The batter finishes the load in their back hip while keeping the top hand stable.
- **Common mistakes:** Moving the top hand when dropping the bat.
- **Source:** Complete Softball Guidance, [Excellent Hitting Drill- The Arrow](https://www.youtube.com/watch?v=f54oQbEKCSI) at ~00:00


## Stride & foot plant (`stride_plant`)

### D14. Secret Softball Drill
- **Review:** ☑ Approve ☐ Edit ☐ Reject
- **Best for (draft, edit before approving):** Losing tension or letting the hands drift forward too early during the stride.
- **Sport:** softball · **Home-friendly:** yes · **Equipment:** Bat, tee, softballs, a partner
- **Age:** 
- **Steps:**
  1. The batter sets up in their stance while a partner stands behind them and holds the bat.
  2. The partner pulls back slightly on the bat to create tension.
  3. The batter takes their stride forward while the partner maintains their grip, forcing the batter to feel the tension and keep their hands back.
  4. The partner lets go of the bat, allowing the batter to unleash their swing.
- **Cue:** "Feel that tension"
- **Looks right when:** The batter maintains tension in their upper body and keeps their hands back while their lower body strides forward.
- **Common mistakes:** Losing resistance or pulling the hands forward before the stride is complete.
- **Safety:** The partner must be careful to avoid being hit by the bat when letting go.
- ⚠️ **Safety flag: a person is near the swinging bat or in front of the hitter.** Before approving, require a protective screen and/or adult-only feeding, or reject for home use with kids.
- **Source:** D.R. Hitting: Coaching & Instruction, [Secret Softball Drill #baseball #coaching #softball #mlb #swing #baseballdrills](https://www.youtube.com/watch?v=3HSshWm7CpA) at ~00:00

### D15. One Two Separate Drill
- **Review:** ☑ Approve ☐ Edit ☐ Reject
- **Best for (draft, edit before approving):** Lunging forward with the upper body and hands during the stride.
- **Sport:** baseball · **Home-friendly:** yes · **Equipment:** Bat
- **Age:** Appropriate for all ages.
- **Steps:**
  1. Start in a normal batting stance.
  2. Cross your front foot over your back foot.
  3. Stride your front foot back out toward the pitcher.
  4. Keep your hands back as your front foot lands to create stretch and separation.
- **Cue:** "One, two, separate"
- **Looks right when:** The lower body moves forward during the stride while the hands stay back.
- **Common mistakes:** Bringing the hands forward at the same time as the front foot.
- **Safety:** Ensure enough space to swing the bat.
- **Source:** George Carroll, [Separation toe touch touch](https://www.youtube.com/watch?v=C7-0oSzXJa4) at ~0:01

### D16. Bucket Behind Front Foot Drill
- **Review:** ☑ Approve ☐ Edit ☐ Reject
- **Best for (draft, edit before approving):** Stepping out or stepping in the bucket.
- **Sport:** baseball · **Home-friendly:** yes · **Equipment:** Bucket or similar constraint, tee or coach to pitch
- **Age:** Great for players transitioning from tee ball to coach or kid pitch.
- **Steps:**
  1. Place a bucket or constraint directly behind the batter's front foot.
  2. Pitch to the batter or have them hit off a tee.
  3. Have the batter take normal swings, aiming to step straight toward the pitcher without hitting the bucket.
- **Cue:** "Don't knock over the bucket"
- **Looks right when:** The batter strides straight ahead toward the pitcher and the bucket remains untouched.
- **Common mistakes:** Stepping away from home plate and knocking over the bucket.
- **Safety:** Ensure the constraint isn't too tall to prevent a tripping hazard.
- **Source:** Legends Baseball Camps, [Eliminate Stepping Out with This Drill](https://www.youtube.com/watch?v=to36ULrlGMU) at ~00:00

### D17. Separation Drill
- **Review:** ☑ Approve ☐ Edit ☐ Reject
- **Best for (draft, edit before approving):** shoulders flying open at the same time as the hips
- **Sport:** unclear · **Home-friendly:** yes · **Equipment:** bat
- **Age:** None
- **Steps:**
  1. Start in your batting stance and begin a controlled forward stride
  2. As the weight transfers and front foot lands, turn the belt buckle toward the pitcher
  3. Keep the shoulders closed to create separation from the hips
- **Cue:** "keep shoulders closed"
- **Looks right when:** belt buckle turns forward while shoulders remain closed at launch position
- **Common mistakes:** collapsing on the backside; reaching with the front foot; shoulders opening with the hips
- **Safety:** None
- **Source:** PHS Softball, [Stride & Separation – The Hitting Vault](https://www.youtube.com/watch?v=tzmuApk2fk4) at ~3:26


## Timing (`timing`)

### D18. Slow to Fast Drill
- **Review:** ☑ Approve ☐ Edit ☐ Reject
- **Best for (draft, edit before approving):** having fast feet and rushing the stride or getting the foot down too early
- **Sport:** unclear · **Home-friendly:** yes · **Equipment:** bat, tee
- **Age:** None
- **Steps:**
  1. Begin your load and stride in slow motion to maintain control and balance
  2. As the front foot is getting down, begin to accelerate the swing
  3. Go full speed through the swing as you land
- **Cue:** "slow load, slow stride, fast swing"
- **Looks right when:** forward movement is slow and controlled, then explodes into a fast swing as the foot lands
- **Common mistakes:** having fast feet and rushing the stride; getting the front foot down too early
- **Safety:** None
- **Source:** Brandon Gore, [Slow to fast drill](https://www.youtube.com/watch?v=0XonPCl2lbg) at ~0:01

### D19. Bounce Drill
- **Review:** ☑ Approve ☐ Edit ☐ Reject
- **Best for (draft, edit before approving):** Struggling to adjust timing to different pitch speeds or locations
- **Sport:** softball · **Home-friendly:** no · **Equipment:** Bat, tennis balls, home plate
- **Age:** 
- **Steps:**
  1. A coach stands in front of the batter and bounces a tennis ball off a home plate.
  2. The batter waits in their stance and adjusts to the unpredictable bounce.
  3. The batter swings and hits the ball after it pops up from the bounce.
- **Cue:** "Be adaptable"
- **Looks right when:** The batter stays balanced and hits the ball squarely after the bounce.
- **Common mistakes:** Swinging too early before the ball has bounced properly.
- **Safety:** Coach must be careful standing close to the batter; recommend using a protective screen or soft balls.
- ⚠️ **Safety flag: a person is near the swinging bat or in front of the hitter.** Before approving, require a protective screen and/or adult-only feeding, or reject for home use with kids.
- **Source:** ZONEDSportsAcademy, [Try this drill at your next practice 🥎 Perfect timing drill for elite softball players.](https://www.youtube.com/watch?v=CGakFeR1QUM) at ~00:00

### D20. Yes, Yes, No Mindset Drill
- **Review:** ☑ Approve ☐ Edit ☐ Reject
- **Best for (draft, edit before approving):** hesitation, poor pitch recognition, or lack of aggressive readiness
- **Sport:** softball · **Home-friendly:** yes · **Equipment:** tee, bat
- **Age:** 
- **Steps:**
  1. Set up at the tee as if you are going to take a regular swing.
  2. Load and stride aggressively with the mindset that you are definitely going to swing (Yes, Yes, Yes).
  3. At the very last moment, hold up your swing abruptly to simulate taking a bad pitch (No).
  4. Alternate this with full swings to practice aggressive readiness.
- **Cue:** "Yes, yes, no"
- **Looks right when:** The batter loads aggressively but is able to abruptly stop the swing without losing balance.
- **Common mistakes:** 
- **Source:** Jay The Hitting Instructor, [Are you ready to hit??? Try this drill #softball #baseball #hitting #shorts](https://www.youtube.com/watch?v=adKfIrQ6Z5Y) at ~0:00

### D21. Walk Throughs
- **Review:** ☑ Approve ☐ Edit ☐ Reject
- **Best for (draft, edit before approving):** Being stagnant in the box, moving too slowly, or hanging back on the rear leg during the swing.
- **Sport:** baseball · **Home-friendly:** no · **Equipment:** Bat
- **Age:** 
- **Steps:**
  1. Start facing the pitcher from behind the batter's box area.
  2. Step forward with your left foot, then your right foot.
  3. Plant your front foot into your normal stride position and execute a full swing.
- **Cue:** "Left, right, swing"
- **Looks right when:** The hitter stays fluid, creates linear momentum, and seamlessly transfers it through the ball.
- **Common mistakes:** Rushing the steps and losing rhythm; Starting the drill too early and lunging at the pitch; Hanging back and failing to transfer momentum forward
- **Source:** Maxx Garrett · Driveline Baseball, [Walk Through | Hitting Drills | Driveline Baseball](https://www.youtube.com/watch?v=d_Bw3KL2om4) at ~00:11

### D22. Side Toss Drill
- **Review:** ☑ Approve ☐ Edit ☐ Reject
- **Best for (draft, edit before approving):** Poor timing or rhythm in the swing
- **Sport:** softball · **Home-friendly:** yes · **Equipment:** Softballs, bat, protective screen
- **Age:** Start with wiffle balls for younger kids to build confidence without fear.
- **Steps:**
  1. Feeder kneels at a 45-degree angle behind a screen.
  2. Feeder brings their hand back to give the hitter a timing mechanism.
  3. Feeder tosses the ball toward the hitter's front hip.
  4. Hitter times the pitch and drives it up the middle.
- **Cue:** "Time the release"
- **Looks right when:** Hitter gets to toe touch as the ball is released and hits it squarely up the middle
- **Common mistakes:** Rushing through swings and prioritizing quantity over quality
- **Safety:** Feeder should always use a protective screen. Use wiffle balls for beginners.
- ⚠️ **Safety flag: a person is near the swinging bat or in front of the hitter.** Before approving, require a protective screen and/or adult-only feeding, or reject for home use with kids.
- **Source:** TeamSnap, [Softball Hitting Drills & Must Know Batting Tips](https://www.youtube.com/watch?v=leDfLWdAZQk) at ~02:42

### D23. Bounce Toss Drill
- **Review:** ☑ Approve ☐ Edit ☐ Reject
- **Best for (draft, edit before approving):** Dropping the hands and struggling with timing or tracking a moving pitch.
- **Sport:** baseball · **Home-friendly:** yes · **Equipment:** Bat, baseballs
- **Age:** 
- **Steps:**
  1. The coach stands a few feet away from the batter in a front toss position.
  2. Instead of tossing the ball in the air, the coach bounces the ball firmly on the ground or a plate.
  3. The batter tracks the bouncing ball, times their load and stride, and swings as the ball enters the hitting zone.
  4. The goal is to keep the hands up and hit a line drive back toward the pitcher.
- **Cue:** "Don't drop your hands"
- **Looks right when:** The batter correctly times the bounce, keeps their hands high, and drives the ball back up the middle.
- **Common mistakes:** Dropping the hands before the swing; Poor timing with the bounce
- **Safety:** The coach should use an L-screen or stand at a safe distance since the batter is hitting line drives back up the middle.
- ⚠️ **Safety flag: a person is near the swinging bat or in front of the hitter.** Before approving, require a protective screen and/or adult-only feeding, or reject for home use with kids.
- **Source:** HittingwithBert, [Try the Bucket Drill!! (Baseball hitting drill) #baseball #shorts](https://www.youtube.com/watch?v=pApmc032Zmo) at ~00:00


## Hip-shoulder sequencing (`hip_shoulder_sequencing`)

### D24. No Stride Drill
- **Review:** ☑ Approve ☐ Edit ☐ Reject
- **Best for (draft, edit before approving):** Over-striding or failing to properly rotate the hips during the swing.
- **Sport:** softball · **Home-friendly:** yes · **Equipment:** Bat, tee, softballs
- **Age:** 
- **Steps:**
  1. Set up in a wide stance, as if you have already completed your stride.
  2. Load the weight into your back hip to find your balance point.
  3. Execute the swing without taking any forward step, focusing purely on rotating and unraveling the hips through the ball.
- **Cue:** "Unravel"
- **Looks right when:** The hips lead the swing and rotate fully while the feet stay planted in their wide base.
- **Common mistakes:** Taking a forward step even when instructed not to.
- **Source:** D.R. Hitting: Coaching & Instruction, [No Stride Drill for more POWER #baseball #mlb #coaching #softball #swing #shorts](https://www.youtube.com/watch?v=CFivDYVlXIY) at ~00:00 (also shown in 1 other video(s): [Driveline Baseball](https://www.youtube.com/watch?v=GlP6p-IhUwU))

### D25. Offset Open Drill
- **Review:** ☑ Approve ☐ Edit ☐ Reject
- **Best for (draft, edit before approving):** Slow rotation or getting stuck moving too slowly before the swing.
- **Sport:** baseball · **Home-friendly:** no · **Equipment:** Bat, HitTrax (optional)
- **Age:** 
- **Steps:**
  1. Start with your feet close together.
  2. Step forward into an offset open stance.
  3. Hold the stance briefly and then rotate your body quickly to swing.
  4. Focus on pivoting the barrel fast before the back angle of the plate.
- **Cue:** "Get to the spot and rotate fast."
- **Looks right when:** The batter generates fast rotation with line drive ball flight.
- **Common mistakes:** Hitting the ball too high (above 30 degrees).
- **Source:** Driveline Baseball, [Use this Hitting Drill to Rotate Faster](https://www.youtube.com/watch?v=DU8hBKDm9kM) at ~00:00

### D26. Launch Pause Drill
- **Review:** ☑ Approve ☐ Edit ☐ Reject
- **Best for (draft, edit before approving):** Bringing hands forward too early with the stride, or flying open with the front shoulder and head.
- **Sport:** softball · **Home-friendly:** yes · **Equipment:** Batting tee, bat, ball
- **Age:** 
- **Steps:**
  1. Set up in a slightly wider than normal stance.
  2. Stride and plant your front foot while keeping your hands back to achieve the launch position.
  3. Pause completely in this position to feel the separation.
  4. Initiate the swing by firing the back hip first.
- **Cue:** "Front foot down, hands back"
- **Looks right when:** There is clear separation between the upper and lower body at foot strike, with the hips initiating the turn before the hands.
- **Common mistakes:** Stepping and bringing the hands forward at the same time; Flying open with the front shoulder or head before the swing starts
- **Source:** MegRem Softball, [Hitting drill to work on getting into correct launch position + firing hips 1st #softball #baseball](https://www.youtube.com/watch?v=ZlRj3J2g8qM) at ~0:00-0:30

### D27. Load, Toe, Tornado
- **Review:** ☑ Approve ☐ Edit ☐ Reject
- **Best for (draft, edit before approving):** Swinging entirely with the arms and hands instead of generating rotational power from the hips.
- **Sport:** baseball · **Home-friendly:** yes · **Equipment:** Bat, batting tee, baseballs
- **Age:** None
- **Steps:**
  1. Set up in your stance and perform your normal 'Load' phase.
  2. Move into the 'Toe' phase by taking your stride and touching your front toe to the ground, pausing the swing.
  3. Execute the 'Tornado' by aggressively firing your hips to pull the bat through the zone.
  4. Focus on making the hip turn the primary driver of the swing rather than pushing the hands.
- **Cue:** "Load, Toe, Tornado"
- **Looks right when:** The hitter successfully separates the stride from the swing, and the hips visibly rotate explosively to initiate the bat path.
- **Common mistakes:** Punching the hands at the ball without turning the hips.; Blending the toe touch and swing together instead of pausing to separate them.; Turning the shoulders before the hips.
- **Safety:** None
- **Source:** D.R. Hitting: Coaching & Instruction, [Youth Hitters Need to Learn this Drill! #baseball #mlb #softball #swing #coaching #shorts](https://www.youtube.com/watch?v=njFyLD5LOZo) at ~00:15

### D28. PVC Separation Drill
- **Review:** ☑ Approve ☐ Edit ☐ Reject
- **Best for (draft, edit before approving):** Lack of separation between the hips and shoulders, or upper body firing too early.
- **Sport:** baseball · **Home-friendly:** yes · **Equipment:** 5-foot PVC pipe
- **Age:** 
- **Steps:**
  1. Hold the PVC pipe with your hands positioned as if they are in launch position.
  2. Rest the bottom of the PVC pipe on the ground directly behind your back foot.
  3. Start your hip rotation while consciously leaving your hands and upper body back.
  4. Feel the physical stretch in your core as the hips open.
- **Cue:** "Turn hips, leave hands back"
- **Looks right when:** The hips visibly open while the shoulders stay closed, creating a strong stretch.
- **Common mistakes:** Letting the hands drift forward with the hips
- **Source:** Josh Cathcart · Hitting Done Right - HDR, [PVC Separation Drill - Feel the Core Stretch | Hitting Done Right](https://www.youtube.com/watch?v=qwSupMYADhM) at ~00:10


## Posture (`posture`)

### D29. Short Bat Posture Drill
- **Review:** ☑ Approve ☐ Edit ☐ Reject
- **Best for (draft, edit before approving):** Coming out of posture and pulling off the ball.
- **Sport:** baseball · **Home-friendly:** yes · **Equipment:** Short bat (e.g., 29 inch) or regular bat, tee, net.
- **Age:** 
- **Steps:**
  1. Use a short bat or choke up four to five inches on your regular bat.
  2. Get into your stance with your chest over the plate.
  3. Take a swing while maintaining this posture over the plate.
  4. Hold your finish to ensure you haven't lifted up.
- **Cue:** "Stay over the plate"
- **Looks right when:** You finish the swing with your spine angle unchanged from the start.
- **Common mistakes:** Lifting up out of posture; Front shoulder opening up early
- **Source:** Matt Antonelli · Antonelli Baseball, [Two Drills To Stop You From Pulling Off the Ball](https://www.youtube.com/watch?v=-giROv5qLvE) at ~3:50

### D30. Posture Tee Drill
- **Review:** ☑ Approve ☐ Edit ☐ Reject
- **Best for (draft, edit before approving):** Losing posture or standing up straight during the load
- **Sport:** both · **Home-friendly:** yes · **Equipment:** Batting tee
- **Age:** 
- **Steps:**
  1. Place a batting tee raised high directly behind you.
  2. Get into your stance a couple of inches away from the tee.
  3. Coil your hips and pull your upper body back as you load.
  4. Feel your back pocket touch the tee to ensure your butt is pushed back and posture is maintained.
- **Cue:** "Back pocket to the tee"
- **Looks right when:** The back pocket touches the tee and the chest remains over the plate.
- **Common mistakes:** Standing straight up without pushing the butt back into the tee.
- **Source:** Matt Antonelli · Antonelli Softball, [One Great Softball Hitting Drill To Improve Your Swing](https://www.youtube.com/watch?v=5pO4mI2hJsM) at ~00:55

### D31. Rear Tee Posture and Coil Drill
- **Review:** ☑ Approve ☐ Edit ☐ Reject
- **Best for (draft, edit before approving):** Standing too upright during the swing, failing to hinge at the hips, and losing proper posture over the plate
- **Sport:** baseball · **Home-friendly:** yes · **Equipment:** Batting tee, bat
- **Age:** Suitable for all age levels.
- **Steps:**
  1. Raise a batting tee to its maximum height and place it directly behind your back hip.
  2. Take your standard hitting stance about a couple inches in front of the elevated tee.
  3. Begin your load by hinging at the hips and coiling your lower body until your rear back pocket touches the tee.
  4. Maintain chest angle over the plate and complete dry swings or live hits while feeling the rear hip against the tee.
- **Cue:** "Touch your back pocket to the tee"
- **Looks right when:** The rear pocket contacts the tee during the coil, the spine tilts approximately 30 degrees over the plate, and the butt remains back behind the heels.
- **Common mistakes:** Standing straight up with a completely vertical spine; Tucking the hips under the torso instead of pushing the glutes backward
- **Safety:** Ensure sufficient clearance around the tee so the backswing or body movement does not knock over nearby equipment.
- **Source:** Matt Antonelli · Antonelli Baseball, [This Hitting Drill Changes Everything](https://www.youtube.com/watch?v=8eh8vpSPJbs) at ~00:47

### D32. PVC Pipe Feedback Drill
- **Review:** ☑ Approve ☐ Edit ☐ Reject
- **Best for (draft, edit before approving):** Dropping the hands and having awkward, disconnected upper body rotation when swinging.
- **Sport:** baseball · **Home-friendly:** no · **Equipment:** PVC pipe or a long stick, a heavy punching bag
- **Age:**   ⚠️ **flag: check before offering to under-13**
- **Steps:**
  1. Hold a PVC pipe or stick like a bat, but slide your hands up so an extra foot of the stick hangs below your bottom hand.
  2. Stand next to a heavy bag as if it were the ball.
  3. Take a swing, hitting the heavy bag with the top of the stick.
  4. Turn your body correctly so the extra part of the stick clears your side.
- **Cue:** "Turn your upper body cleanly"
- **Looks right when:** The player swings and the bottom of the stick ends up cleanly above their forearm without poking their side.
- **Common mistakes:** Dropping the hands, which causes the bottom of the stick to aggressively poke them in the ribs
- **Safety:** Players should start with slow swings so they don't bruise their ribs if they make a mistake.
- ⚠️ **Safety flag: a person is near the swinging bat or in front of the hitter.** Before approving, require a protective screen and/or adult-only feeding, or reject for home use with kids.
- **Source:** Antonelli Softball, [One reason we use a PVC pipe on the bag when hitting](https://www.youtube.com/watch?v=CicQtSJby6o) at ~0:01

### D33. Seated Bucket Hitting Drill
- **Review:** ☑ Approve ☐ Edit ☐ Reject
- **Best for (draft, edit before approving):** Using too much lower body or struggling to maintain upper body posture and hand path.
- **Sport:** baseball · **Home-friendly:** yes · **Equipment:** Bat, batting tee, baseballs, bucket
- **Age:** 
- **Steps:**
  1. Place a bucket next to home plate and have the batter sit on it.
  2. Set up a batting tee in front of the batter.
  3. Have the batter take swings to hit the ball off the tee while remaining seated.
  4. Focus on upper body mechanics, posture, and generating bat speed with the hands.
- **Cue:** "Use your hands"
- **Looks right when:** The batter maintains a steady posture on the bucket and delivers the barrel cleanly to the ball.
- **Common mistakes:** Losing balance on the bucket; Failing to rotate the torso
- **Safety:** Ensure the bucket is sturdy and placed on a flat, non-slip surface.
- ⚠️ **Safety flag: a person is near the swinging bat or in front of the hitter.** Before approving, require a protective screen and/or adult-only feeding, or reject for home use with kids.
- **Source:** Braxton Baller, [Bucket Hitting Drill #baseball #baseballtraining #shorts](https://www.youtube.com/watch?v=j548JqjRCEg) at ~00:00

### D34. PVC Pipe Posture Drill
- **Review:** ☑ Approve ☐ Edit ☐ Reject
- **Best for (draft, edit before approving):** losing posture and casting hands
- **Sport:** softball · **Home-friendly:** yes · **Equipment:** PVC pipe, fence
- **Age:** 
- **Steps:**
  1. Place a PVC pipe across your shoulders and stand near a fence.
  2. Simulate your swing by rotating your shoulders and side bending.
  3. Maintain your posture so the pipe does not strike the fence.
- **Cue:** "Rotate and bend, don't hit the fence"
- **Looks right when:** The hitter maintains posture and the pipe clears the fence without hitting it.
- **Common mistakes:** Standing up too tall; Hitting the fence
- **Safety:** Do not swing aggressively against a solid fence to avoid injury.
- **Source:** coachb_msusoftball · MSA Hitting Performance Center, [#PVC Pipe Drills](https://www.youtube.com/watch?v=nLdxKKF5pUA) at ~00:00

### D35. PVC Pipe on Back Drill
- **Review:** ☑ Approve ☐ Edit ☐ Reject
- **Best for (draft, edit before approving):** losing posture during contact
- **Sport:** softball · **Home-friendly:** yes · **Equipment:** PVC pipe, squishy or tennis balls, tosser
- **Age:** 
- **Steps:**
  1. Hook the PVC pipe behind your back inside your elbows.
  2. Have a coach or partner toss squishy balls or tennis balls.
  3. Rotate and side bend to physically hit the balls with the pipe.
- **Cue:** "Turn and hit"
- **Looks right when:** The hitter maintains strong side bend and posture while making contact.
- **Common mistakes:** Losing side bend; Not rotating fully
- **Safety:** Use soft balls to avoid injury or breaking the PVC pipe.
- ⚠️ **Safety flag: a person is near the swinging bat or in front of the hitter.** Before approving, require a protective screen and/or adult-only feeding, or reject for home use with kids.
- **Source:** coachb_msusoftball · MSA Hitting Performance Center, [#PVC Pipe Drills](https://www.youtube.com/watch?v=nLdxKKF5pUA) at ~00:10

### D36. PVC Posture Adjustment Drill
- **Review:** ☑ Approve ☐ Edit ☐ Reject
- **Best for (draft, edit before approving):** Losing spine angle, standing up or backing out during the swing, and failing to adjust shoulder tilt to different pitch heights
- **Sport:** both · **Home-friendly:** yes · **Equipment:** 5-foot PVC pipe (1/2 inch thickness) and a batting tee
- **Age:** Suitable for all ages. Great pre-game warm-up or station work for youth and high school players.
- **Steps:**
  1. Place a 5-foot PVC pipe across your collarbone and hold it centered with hands together and elbows flared out.
  2. Set up in your normal hitting stance in front of a tee set at a specific pitch height.
  3. Take your stride into launch position while maintaining your spine angle.
  4. Initiate the rotation with your hips first, then tilt your shoulders to direct the front end of the pipe down toward the tee location.
- **Cue:** "Hips first, tilt to the pitch"
- **Looks right when:** The player maintains their spine angle, turns hips first, and tilts the shoulders smoothly to align the pipe with the pitch height.
- **Common mistakes:** Flaying elbows down instead of keeping them wide to support proper shoulder structure; Rotating shoulders before or simultaneously with the hips; Standing up straight or pulling the body backward during rotation
- **Safety:** Ensure sufficient space around the player to prevent hitting nearby people with the extended PVC pipe.
- **Source:** Josh Cathcart · Hitting Done Right - HDR, [💢 PVC Posture Drill 💢 (Posture and Tilt) | Hitting Done Right - Youth Baseball Swing Drills](https://www.youtube.com/watch?v=p7B12g_o4pQ) at ~00:54

### D37. Posture Over the Plate Drill
- **Review:** ☑ Approve ☐ Edit ☐ Reject
- **Best for (draft, edit before approving):** Standing up straight or pulling off the ball
- **Sport:** unclear · **Home-friendly:** yes · **Equipment:** Bat
- **Age:** 
- **Steps:**
  1. Get into your normal batting stance.
  2. As you coil or turn, ensure your body leans over the plate.
  3. Swing while maintaining that posture over the plate so the bat passes correctly through the zone.
  4. Avoid standing straight up as you swing.
- **Cue:** "Stay over the plate"
- **Looks right when:** The body remains bent towards the plate and the bat drives through the hitting zone
- **Common mistakes:** Standing up straight; Bat path casting away due to poor posture
- **Source:** Antonelli Baseball, [Creating good direction by getting into proper posture and staying in posture as we turn](https://www.youtube.com/watch?v=sgHzu92ZR-E) at ~00:00


## Head & eyes stability (`head_visual_stability`)

### D38. Head in the Lane
- **Review:** ☑ Approve ☐ Edit ☐ Reject
- **Best for (draft, edit before approving):** Losing head control, lunging forward, or falling back during the swing.
- **Sport:** baseball · **Home-friendly:** yes · **Equipment:** Bat, tee, two PVC pipes.
- **Age:** 
- **Steps:**
  1. Place two PVC pipes on the ground to form a lane around the tee.
  2. Set up a hitting tee in the middle of the lane.
  3. Keep your head between the two pipes while loading, striding, and swinging.
  4. Ensure your head does not fall back over the rear pipe or drift forward over the front pipe.
- **Cue:** "Keep your head in the lane."
- **Looks right when:** The batter's head stays centered and still through the entire swing motion.
- **Common mistakes:** Drifting forward over the front foot.; Falling back over the rear foot after contact.
- **Source:** Josh Cathcart · Hitting Done Right - HDR, [💢 Control Your Swing 💢 3 Youth Baseball Drills For Improved Head Stabilization](https://www.youtube.com/watch?v=6tSAqdUUzmc) at ~01:21

### D39. Back Knee Down Drill
- **Review:** ☑ Approve ☐ Edit ☐ Reject
- **Best for (draft, edit before approving):** Poor balance and losing posture during the swing.
- **Sport:** baseball · **Home-friendly:** yes · **Equipment:** Bat, tee, medicine ball.
- **Age:** Heavy med balls are not for under-13 players.  ⚠️ **flag: check before offering to under-13**
- **Steps:**
  1. Kneel on your back knee with your front foot firmly planted.
  2. Place a medicine ball on the ground next to your back knee.
  3. Take a swing while keeping your head still and staying grounded.
  4. After finishing the swing, reach down and touch the medicine ball with your top hand without falling over.
- **Cue:** "Swing and touch the ball."
- **Looks right when:** The batter maintains their posture and easily touches the ball after swinging.
- **Common mistakes:** Pushing up onto the toes.; Falling backward away from the plate.
- **Safety:** Do not use overly heavy medicine balls that could strain the back when reaching.
- **Source:** Josh Cathcart · Hitting Done Right - HDR, [💢 Control Your Swing 💢 3 Youth Baseball Drills For Improved Head Stabilization](https://www.youtube.com/watch?v=6tSAqdUUzmc) at ~03:53

### D40. Pool Noodle Posture Drill
- **Review:** ☑ Approve ☐ Edit ☐ Reject
- **Best for (draft, edit before approving):** Over-tilting, bringing the head down, and scooping under the ball.
- **Sport:** baseball · **Home-friendly:** yes · **Equipment:** Bat, tee, second tee, pool noodle.
- **Age:** 
- **Steps:**
  1. Place a pool noodle over a tee set at belly button height on the inside part of the plate.
  2. Set up a regular hitting tee with a ball on the outside part of the plate.
  3. Swing and hit the ball off the outside tee without letting any part of your body or bat hit the pool noodle.
  4. Keep your head still to avoid collapsing your posture.
- **Cue:** "Don't hit the noodle."
- **Looks right when:** The batter hits the ball cleanly while keeping their posture upright and clear of the noodle.
- **Common mistakes:** Over-tilting and dropping the head, which causes the bat to hit the noodle.
- **Source:** Josh Cathcart · Hitting Done Right - HDR, [💢 Control Your Swing 💢 3 Youth Baseball Drills For Improved Head Stabilization](https://www.youtube.com/watch?v=6tSAqdUUzmc) at ~06:12

### D41. Two-Ball Toss
- **Review:** ☑ Approve ☐ Edit ☐ Reject
- **Best for (draft, edit before approving):** Lack of visual focus or tracking
- **Sport:** softball · **Home-friendly:** yes · **Equipment:** Two differently colored wiffle balls, bat, protective screen
- **Age:** 
- **Steps:**
  1. Feeder holds two wiffle balls in one hand.
  2. Feeder tosses both balls simultaneously.
  3. Feeder calls out 'top' or 'bottom' while the balls are in the air.
  4. Hitter tracks and hits the specified ball.
- **Cue:** "Top or bottom"
- **Looks right when:** Hitter successfully recognizes and hits the correct ball
- **Common mistakes:** Swinging wildly without focusing on the specific ball
- **Safety:** Feeder must use a screen.
- ⚠️ **Safety flag: a person is near the swinging bat or in front of the hitter.** Before approving, require a protective screen and/or adult-only feeding, or reject for home use with kids.
- **Source:** TeamSnap, [Softball Hitting Drills & Must Know Batting Tips](https://www.youtube.com/watch?v=leDfLWdAZQk) at ~04:02

### D42. No Peeks Drill
- **Review:** ☑ Approve ☐ Edit ☐ Reject
- **Best for (draft, edit before approving):** Head and body pulling off the ball.
- **Sport:** baseball · **Home-friendly:** yes · **Equipment:** Bat, tee, balls.
- **Age:** 
- **Steps:**
  1. Set a ball on the tee down the middle.
  2. Swing but exaggerate keeping your head down on the tee.
  3. Do not look up to see where the ball went.
  4. Hold your finish to verify your head is still down.
- **Cue:** "No peeks"
- **Looks right when:** The swing is completed with the head still pointed down at the hitting zone.
- **Common mistakes:** Head coming up quickly to track the ball.
- **Source:** Matt Antonelli · Antonelli Baseball, [Youth Hitting Drill To Stop Pulling Off the Ball](https://www.youtube.com/watch?v=mC5rRupCo1k) at ~0:00


## Front-side stability (`front_side_stability`)

### D43. Pre-Set Launch Position Drill
- **Review:** ☑ Approve ☐ Edit ☐ Reject
- **Best for (draft, edit before approving):** Lunging out and not swinging against a firm front side
- **Sport:** baseball · **Home-friendly:** yes · **Equipment:** Bat, tee, baseball
- **Age:** None
- **Steps:**
  1. Take a normal swing and freeze at the finish.
  2. Adjust into the correct finish position with a stiff front side, driven back knee, and back toes facing the pitcher.
  3. Bring your hands back around to the hitting position while maintaining this wide, firm stance.
  4. Take a swing from this pre-set position to feel what it's like to swing against a firm front side.
- **Cue:** "Swing against a firm front side"
- **Looks right when:** The hitter swings with a firm, stable front leg and their body does not lunge forward.
- **Common mistakes:** Lunging forward during the swing
- **Safety:** None
- **Source:** Legends Baseball Camps, [Best Drill To Teach A Firm Front Side](https://www.youtube.com/watch?v=0QvIPPN3edQ) at ~0:00-0:32

### D44. Front Hand Ball Drill
- **Review:** ☑ Approve ☐ Edit ☐ Reject
- **Best for (draft, edit before approving):** Front shoulder flying open and head pulling off the ball
- **Sport:** baseball · **Home-friendly:** yes · **Equipment:** Bat, tee, two baseballs
- **Age:** None
- **Steps:**
  1. Choke up on the bat with your top hand.
  2. Hold a baseball in your front hand.
  3. Place your front hand with the ball directly above the ball resting on the tee.
  4. Take a swing with your top hand while trying to keep your front hand as still as possible above the tee.
- **Cue:** "Keep the hand still above the ball"
- **Looks right when:** The front hand remains completely stationary over the tee while the back hand completes the swing.
- **Common mistakes:** Pulling the front hand away during the swing; Moving the head away from the tee
- **Safety:** Be careful not to hit your front hand with the bat.
- **Source:** Bobby Brown Baseball, [Shoulder Flying Open? Try this drill! ⚾️ #baseballszn #baseball #hitting #baseballpractice #sports](https://www.youtube.com/watch?v=B1MmXHAZknU) at ~0:00-0:39

### D45. Maintain Posture Tee Swing
- **Review:** ☑ Approve ☐ Edit ☐ Reject
- **Best for (draft, edit before approving):** Front shoulder flying open and pulling off the ball.
- **Sport:** baseball · **Home-friendly:** yes · **Equipment:** Bat, tee, ball.
- **Age:** 
- **Steps:**
  1. Set up at the tee and get your body over the plate.
  2. Maintain your posture over the plate as you initiate the swing.
  3. Swing through the ball without backing away or opening early.
  4. Hold your finish to check your posture.
- **Cue:** "Maintain this and keep it there"
- **Looks right when:** You finish the swing with your body still over the plate.
- **Common mistakes:** Pulling the front shoulder out immediately; Backing away from the plate
- **Source:** Moy Style Baseball, [How to stop flying open with front shoulder.](https://www.youtube.com/watch?v=DTbpkeH0Wo4) at ~0:00

### D46. BOSU Ball Front Foot Drill
- **Review:** ☑ Approve ☐ Edit ☐ Reject
- **Best for (draft, edit before approving):** Locking the front leg too early, losing space, and falling back during the swing.
- **Sport:** baseball · **Home-friendly:** yes · **Equipment:** Bat, BOSU ball (half-balance ball)
- **Age:** 
- **Steps:**
  1. Place the batter's front foot on a BOSU ball and their back foot on the ground.
  2. Have the batter take normal swings from this setup.
  3. Focus on feeling the support of the front side without fully locking the front leg too early.
- **Cue:** "Feel that front side"
- **Looks right when:** The front leg supports the swing and maintains space without locking out prematurely.
- **Common mistakes:** Locking the front leg too early; Falling back to create space
- **Safety:** Ensure the balance ball is stable on the ground to prevent the hitter from slipping.
- **Source:** Rick Saggese - TOTD Sports Performance, [Baseball Hitting Drill Front Leg Blocker](https://www.youtube.com/watch?v=NZQWA6pvrwY) at ~00:00

### D47. 45-Degree Open Stance Drill
- **Review:** ☑ Approve ☐ Edit ☐ Reject
- **Best for (draft, edit before approving):** Jumping or lunging forward during the swing
- **Sport:** baseball · **Home-friendly:** yes · **Equipment:** Bat, tee, baseball
- **Age:** None
- **Steps:**
  1. Open up your normal stance to about 45 degrees.
  2. Focus on getting your weight loaded around your back leg.
  3. Push down and turn into your back hip to feel pressure in your back glute.
  4. Unravel your hip and swing through the ball without jumping forward.
- **Cue:** "Push down and turn into your back hip"
- **Looks right when:** The hitter feels a pocket of pressure in their back glute and swings without jumping forward.
- **Common mistakes:** Jumping forward during the swing
- **Safety:** None
- **Source:** D.R. Hitting: Coaching & Instruction, [STOP LUNGING! Try this drill #baseball #coaching #mlb #softball #swing #baseballdrills #shorts](https://www.youtube.com/watch?v=TuYob2yIexw) at ~0:00-0:32

### D48. Top Hand Swing with Front Hand Ball Drop
- **Review:** ☑ Approve ☐ Edit ☐ Reject
- **Best for (draft, edit before approving):** Front shoulder flying up and pulling open too early in the swing.
- **Sport:** baseball · **Home-friendly:** yes · **Equipment:** Bat, two baseballs, batting tee
- **Age:** 
- **Steps:**
  1. Hold the bat in your top hand and a baseball in your front hand.
  2. Extend your front arm straight out toward the pitcher.
  3. Swing the bat with your top hand to hit the ball off the tee.
  4. As you swing, bring the ball in your front hand down at an angle to replace the hit ball on the tee.
- **Cue:** "Stay closed and swing down and through"
- **Looks right when:** The front shoulder stays down and closed, and the front hand finishes directly over the tee.
- **Common mistakes:** Pulling the front hand back and down instead of forward to the tee; Letting the front shoulder fly up and out
- ⚠️ **Safety flag: a person is near the swinging bat or in front of the hitter.** Before approving, require a protective screen and/or adult-only feeding, or reject for home use with kids.
- **Source:** Top Level LA Baseball Academy, [Front Shoulder Closed Baseball Hitting Drill (Stay Down and Through, Not Up and Out)](https://www.youtube.com/watch?v=VNZvUp-Q_OQ) at ~00:00

### D49. One-Handed Chair Drill
- **Review:** ☑ Approve ☐ Edit ☐ Reject
- **Best for (draft, edit before approving):** Pulling off the front shoulder and dragging the barrel.
- **Sport:** baseball · **Home-friendly:** yes · **Equipment:** Bat, tee, balls, chair.
- **Age:** 
- **Steps:**
  1. Place a chair behind your stance.
  2. Rest your back hand on the chair.
  3. Hold the bat with your front hand only.
  4. Swing at the ball on the tee using only your front arm, driving toward the pitcher.
- **Cue:** "Keep that front shoulder put"
- **Looks right when:** The front arm works through the ball without the front shoulder flying open.
- **Common mistakes:** Pulling off the front shoulder; Fighting the back shoulder against the chair
- ⚠️ **Safety flag: a person is near the swinging bat or in front of the hitter.** Before approving, require a protective screen and/or adult-only feeding, or reject for home use with kids.
- **Source:** The Swing Shop, [STOP PULLING OFF | great drill #shorts #tips #hittingcoach](https://www.youtube.com/watch?v=Wdllle-CaDg) at ~0:00

### D50. Elevated Front Foot Drill
- **Review:** ☑ Approve ☐ Edit ☐ Reject
- **Best for (draft, edit before approving):** Lunging forward or sliding forward when swinging
- **Sport:** softball · **Home-friendly:** yes · **Equipment:** Bat, tee, softball, step stool
- **Age:** None
- **Steps:**
  1. Place a small step stool or similar object in front of the tee.
  2. Step onto the stool with your front foot so it is elevated above your back foot.
  3. Take your normal stance and swing at the ball on the tee.
  4. Focus on rotating your hips instead of sliding your body forward.
- **Cue:** "Rotate your hips, don't slide forward"
- **Looks right when:** The hitter rotates their hips without their body lunging or sliding forward during the swing.
- **Common mistakes:** Lunging forward despite the elevated front foot
- **Safety:** Ensure the step stool is stable to avoid slipping.
- **Source:** The Softball Doctor, [💥Drill to stop lunging💥](https://www.youtube.com/watch?v=_3PTTrDVK48) at ~0:00-0:30

### D51. Dumbbell Front Shoulder Drill
- **Review:** ☑ Approve ☐ Edit ☐ Reject
- **Best for (draft, edit before approving):** Front shoulder flying open early and losing a closed stance.
- **Sport:** both · **Home-friendly:** yes · **Equipment:** Short bat, light dumbbell, batting tee
- **Age:** Use 2 or 3 lb weights for younger kids, 5 lbs for older/stronger hitters. Heavy weights are not for young kids.  ⚠️ **flag: check before offering to under-13**
- **Steps:**
  1. Hold a short bat in the top hand and a light dumbbell in the front hand.
  2. Get into a normal batting stance with both hands raised.
  3. Go through the load phase and bring the front hand down over the tee to keep the shoulder closed.
  4. Extend both hands straight out toward the pitcher through the swing.
- **Cue:** "Palm up, palm down"
- **Looks right when:** The front shoulder remains pointed up the middle during the load and the hands extend forward without pulling off the ball.
- **Common mistakes:** Front shoulder flying open
- **Safety:** Do not use a weight that is too heavy to control safely to avoid shoulder strain.
- **Source:** Complete Softball Guidance, [Great hitting drill to stop pulling your front should out](https://www.youtube.com/watch?v=aZhqUaCW3K8) at ~00:00

### D52. Two Ball Front Arm Drill
- **Review:** ☑ Approve ☐ Edit ☐ Reject
- **Best for (draft, edit before approving):** Front shoulder flying open.
- **Sport:** baseball · **Home-friendly:** yes · **Equipment:** Bat, tee, two balls.
- **Age:** 
- **Steps:**
  1. Place one ball on the tee.
  2. Hold a second ball in your front hand, extended directly over the tee.
  3. Hold the bat with your back hand only.
  4. Take a one-handed swing with the back hand, keeping the front hand and ball still.
- **Cue:** "Keep this ball over top of the tee"
- **Looks right when:** The ball in the front hand remains directly over the tee throughout the back hand swing.
- **Common mistakes:** Flying open with the front shoulder and moving the front hand away.
- ⚠️ **Safety flag: a person is near the swinging bat or in front of the hitter.** Before approving, require a protective screen and/or adult-only feeding, or reject for home use with kids.
- **Source:** Northern Baseball Training, [Flying Open With Your Front Shoulder? TRY THIS DRILL](https://www.youtube.com/watch?v=gT36eMcSXds) at ~0:00


## Hand path (`hand_path`)

### D53. High Tee Drill
- **Review:** ☑ Approve ☐ Edit ☐ Reject
- **Best for (draft, edit before approving):** Dropping the hands too early, which causes the bat to drag and pop the ball straight up.
- **Sport:** softball · **Home-friendly:** yes · **Equipment:** Batting tee, bat, ball
- **Age:** 
- **Steps:**
  1. Raise the batting tee as high as it will go, so the ball is about chest high.
  2. Have the player take their normal batting stance.
  3. Ask them to swing and hit the ball while keeping their hands above the ball.
  4. Focus on not letting the bottom of the bat (the knob) dip below the ball before making contact.
- **Cue:** "Keep your hands higher than the ball"
- **Looks right when:** The swing stays level with the high pitch and the ball is hit sharply line-drive style instead of popped up.
- **Common mistakes:** Dropping the hands downward as the swing starts; Letting the heavy part of the barrel fall below the hands too soon
- **Source:** MegRem Softball, [High tee: hitting drill if you drop the hands and get under every ball](https://www.youtube.com/watch?v=5UtyIR4-9y4) at ~0:02

### D54. Hands Isolation Drill
- **Review:** ☑ Approve ☐ Edit ☐ Reject
- **Best for (draft, edit before approving):** pulling the knob to the pitcher or poor bat path
- **Sport:** softball · **Home-friendly:** yes · **Equipment:** tee, bat, softball
- **Age:** 
- **Steps:**
  1. Set up with your feet and shoulders completely squared to the plate or net.
  2. If you are a slapper, start in your crossover stance instead.
  3. Isolate your hands, keeping your lower body quiet.
  4. Swing using only your hands to hit the ball, focusing on proper bat path and bat speed.
- **Cue:** "Work the hands"
- **Looks right when:** The hands generate good bat speed and take a direct path to the ball without relying on body rotation.
- **Common mistakes:** Pulling the knob toward the pitcher
- **Source:** AnaMarie Bruni, [Proper Bat PATH! Let's do it. #softball #baseball #hitting #battingpractice #training #mlb #athlete](https://www.youtube.com/watch?v=JdDiEQyB_9Y) at ~0:04

### D55. Bottom Hand Drill
- **Review:** ☑ Approve ☐ Edit ☐ Reject
- **Best for (draft, edit before approving):** extending hands out early and pulling across the ball
- **Sport:** softball · **Home-friendly:** yes · **Equipment:** bat, tee, softballs
- **Age:** None
- **Steps:**
  1. Hold the bat with your bottom hand and grab your lead elbow with your top hand
  2. Keep your bottom hand inside your elbow to lead the swing with the elbow
  3. Swing through the ball on the tee, keeping the hand inside the ball like throwing a frisbee
- **Cue:** "like a frisbee"
- **Looks right when:** the bottom hand stays inside the elbow and you swing through without extending early
- **Common mistakes:** extending the hands out early; pulling across the ball
- **Safety:** None
- ⚠️ **Safety flag: a person is near the swinging bat or in front of the hitter.** Before approving, require a protective screen and/or adult-only feeding, or reject for home use with kids.
- **Source:** Mike Candrea · Team Express, [Mike Candrea Softball Hitting tips: Bottom hand drills - Sponsored by Mizuno](https://www.youtube.com/watch?v=afF8Rfrupwc) at ~0:13

### D56. Bucket Behind Tee Drill
- **Review:** ☑ Approve ☐ Edit ☐ Reject
- **Best for (draft, edit before approving):** Dropping the hands early and swinging under the ball.
- **Sport:** softball · **Home-friendly:** yes · **Equipment:** Batting tee, bucket of balls, bat
- **Age:** 
- **Steps:**
  1. Place a bucket of balls directly behind a batting tee.
  2. Set the tee so the ball is just slightly higher than the top of the bucket.
  3. Take your normal stance and swing at the ball on the tee.
  4. Keep your hands above the bucket to hit the ball without striking the bucket.
- **Cue:** "Hands above the bucket"
- **Looks right when:** The batter hits a clean line drive off the tee without the bat path dropping into the bucket.
- **Common mistakes:** Dropping the hands early, causing the bat to hit the bucket
- **Safety:** Use a durable bucket that will not shatter if accidentally hit by the bat.
- **Source:** MegRem Softball, [Hitting drill if you dump the barrel too much and get under every ball. #softball #baseball](https://www.youtube.com/watch?v=iKyEvuXAIwU) at ~0:00-0:18

### D57. Shoulder Drill
- **Review:** ☑ Approve ☐ Edit ☐ Reject
- **Best for (draft, edit before approving):** Hands casting away from the body early and shaving the outside of the baseball
- **Sport:** baseball · **Home-friendly:** yes · **Equipment:** Bat, baseballs, batting cage or net
- **Age:** Suitable for all youth hitting levels.
- **Steps:**
  1. Rest the bat handle and barrel back against your back shoulder during setup.
  2. Initiate the swing by turning the hips while keeping the bat connected to the rear shoulder.
  3. Drive the barrel through contact towards the middle or opposite field while staying extension-focused.
- **Cue:** "Keep bat on the shoulder and stay long through the ball"
- **Looks right when:** The bat stays close to the rear shoulder during the turn before extending smoothly through contact up the middle.
- **Common mistakes:** Pushing or casting the hands away from the body before turn; Cutting off the follow-through prematurely
- **Safety:** Ensure proper distance from live tosser or pitching machine net.
- **Source:** D.R. Hitting: Coaching & Instruction, [My Favorite Connection Drill #baseball #mlb #softball #shorts](https://www.youtube.com/watch?v=iQG9laxhXew) at ~00:05

### D58. Inside Pitch Side Toss
- **Review:** ☑ Approve ☐ Edit ☐ Reject
- **Best for (draft, edit before approving):** Struggling to hit inside pitches
- **Sport:** softball · **Home-friendly:** yes · **Equipment:** Softballs, bat, protective screen
- **Age:** 
- **Steps:**
  1. Hitter sets up closed, facing slightly toward the feeder.
  2. Feeder tosses the ball toward the front hip.
  3. Hitter works on getting hands out early to simulate pulling an inside pitch.
- **Cue:** "Get your hands out"
- **Looks right when:** Hands clear the body and hitter successfully hits the inside pitch
- **Common mistakes:** Getting tied up and not extending the hands
- **Safety:** Feeder must use a screen.
- **Source:** TeamSnap, [Softball Hitting Drills & Must Know Batting Tips](https://www.youtube.com/watch?v=leDfLWdAZQk) at ~03:24

### D59. Broomstick Toss Drill
- **Review:** ☑ Approve ☐ Edit ☐ Reject
- **Best for (draft, edit before approving):** Not getting enough swings or poor hand-eye coordination
- **Sport:** baseball · **Home-friendly:** yes · **Equipment:** Broomstick, small balls or caps
- **Age:** 
- **Steps:**
  1. Get a broomstick and a small ball.
  2. Toss the ball up in the air.
  3. Swing the broomstick to hit the ball.
  4. Repeat the process continuously.
- **Cue:** "Swing more, hit less"
- **Looks right when:** Making consistent contact with the small target using the broomstick
- **Common mistakes:** Not taking enough swings
- **Safety:** Make sure there is enough space to swing the broomstick safely.
- **Source:** Bobby Scales · Coach Beede, [The Best Hitting Drill for Youth Baseball Players](https://www.youtube.com/watch?v=nuOdLq5U0NI) at ~00:00


## Barrel path (`barrel_path`)

### D60. Pull Side Angle Toss
- **Review:** ☑ Approve ☐ Edit ☐ Reject
- **Best for (draft, edit before approving):** getting tied up on inside pitches or failing to pull the ball
- **Sport:** baseball · **Home-friendly:** no · **Equipment:** Bat, baseballs, net, tosser
- **Age:** 
- **Steps:**
  1. Tosser stands at an angle in front of the hitter on the pull side.
  2. Tosser feeds balls firmly toward the hitter.
  3. Hitter works on turning quickly and pulling the ball hard into the pull-side net.
- **Cue:** "Turn on it"
- **Looks right when:** The hitter cleanly and forcefully pulls the ball into the net.
- **Common mistakes:** Rolling over the ball; Getting jammed
- **Safety:** Tosser must use an L-screen or stay safely protected behind a net.
- ⚠️ **Safety flag: a person is near the swinging bat or in front of the hitter.** Before approving, require a protective screen and/or adult-only feeding, or reject for home use with kids.
- **Source:** 108 Performance, [Pull Side Angle Toss #baseball #baseballtraining #hitting #hittingdrills](https://www.youtube.com/watch?v=-PzJBDzuQyI) at ~00:00

### D61. Double Tee Drill
- **Review:** ☑ Approve ☐ Edit ☐ Reject
- **Best for (draft, edit before approving):** A loopy swing or dropping the hands early
- **Sport:** softball · **Home-friendly:** yes · **Equipment:** Two batting tees, softballs, bat, net
- **Age:** Appropriate for all ages
- **Steps:**
  1. Set up a high tee at the front of the plate with a ball on it
  2. Set up a lower tee at the back of the plate with a ball on it
  3. Take your swing aiming to hit the ball on the front tee
  4. Ensure your bat path misses the ball on the back tee
- **Cue:** "Swing over the low tee"
- **Looks right when:** The batter cleanly hits the ball off the front high tee without disturbing the back lower tee
- **Common mistakes:** Dropping the hands and hitting the back tee; Looping the barrel under the desired swing plane
- **Safety:** Standard tee work safety applies
- **Source:** POWERHOUSE SOFTBALL TX, [No wasted movement. No looping. Just direct, efficient barrel path 🔥 #hittingdrills  #softball](https://www.youtube.com/watch?v=01fgwwSoUVs) at ~0:00

### D62. Lead Arm Plyo Throw Drill
- **Review:** ☑ Approve ☐ Edit ☐ Reject
- **Best for (draft, edit before approving):** Lead arm working down, causing a steep or downward bat path
- **Sport:** both · **Home-friendly:** yes · **Equipment:** Light plyo ball
- **Age:** Avoid using heavy plyo balls with young players to prevent arm strain.  ⚠️ **flag: check before offering to under-13**
- **Steps:**
  1. Get into your batting stance holding a light plyo ball in your lead hand.
  2. Initiate the swing by turning your upper body triangle.
  3. Work your lead arm up and throw the ball upwards.
  4. Ensure you throw from the inside out, aiming slightly towards the opposite field gap.
- **Cue:** "Lead arm works up"
- **Looks right when:** The ball is thrown upwards and slightly opposite field, simulating an upward bat path.
- **Common mistakes:** Throwing the ball down into the ground.; Throwing the ball out and around instead of inside-out.
- **Source:** Matt Antonelli · Antonelli Softball, [Try This Simple Drill To Fix Your Softball Bat Path](https://www.youtube.com/watch?v=93RA36CtuNE) at ~00:11

### D63. Inside-Out Bat Path Tee Drill
- **Review:** ☑ Approve ☐ Edit ☐ Reject
- **Best for (draft, edit before approving):** Casting the bat barrel wide around the hands, rolling over, or casting back toward the catcher.
- **Sport:** baseball · **Home-friendly:** yes · **Equipment:** Bat, batting tee, baseballs or softballs, net
- **Age:** Suitable for all ages.
- **Steps:**
  1. Set up at a comfortable distance from the tee in a balanced athletic stance.
  2. Begin the swing by keeping the hands tight and the bat barrel close inside the body line.
  3. Extend through contact and finish with a high diagonal follow-through rather than sweeping flat across the body.
- **Cue:** "Stay inside until contact and finish high"
- **Looks right when:** The barrel stays compact through the turn and accelerates on an upward diagonal path through the ball.
- **Common mistakes:** Letting the bat barrel drift backwards toward the catcher early in the swing; Finishing the follow-through flat across the waist; Casting hands outward toward the plate before contact
- **Safety:** Ensure sufficient clearance behind and around the tee from walls or surrounding people.
- **Source:** Cage Culture Hitting!, [Stop Pulling Off the Ball! ⚾️ Fix Your Swing With This Simple Drill 🔥](https://www.youtube.com/watch?v=V_5vCm11X2M) at ~00:00

### D64. Sitting Down Front Toss Drill
- **Review:** ☑ Approve ☐ Edit ☐ Reject
- **Best for (draft, edit before approving):** Swinging and missing underneath pitches.
- **Sport:** baseball · **Home-friendly:** no · **Equipment:** Bat, balls, L-screen.
- **Age:** 
- **Steps:**
  1. The batter takes their normal hitting stance.
  2. The tosser sits on the ground behind an L-screen, about 10-15 feet away.
  3. The tosser throws underhand pitches to simulate a flatter pitch angle.
  4. The batter works on flattening their bat path to match the pitch and hit solid line drives.
- **Cue:** "Swing flatter for flat pitches."
- **Looks right when:** The batter hits hard, square line drives rather than popping up.
- **Common mistakes:** Maintaining a steep upward swing path and swinging under the ball.
- **Safety:** Always use an L-screen to protect the tosser.
- ⚠️ **Safety flag: a person is near the swinging bat or in front of the hitter.** Before approving, require a protective screen and/or adult-only feeding, or reject for home use with kids.
- **Source:** Bobby Tewksbary and John Madden · YouGoProBaseball, [1 Super Simple Hitting Drill That Exposes Swing Flaws & Fixes Swing Plane with Bobby Tewksbary!](https://www.youtube.com/watch?v=XgnRbGkbTxk) at ~04:19

### D65. Frisbee Hitting Drill
- **Review:** ☑ Approve ☐ Edit ☐ Reject
- **Best for (draft, edit before approving):** Downward swing path and chopping at the baseball
- **Sport:** baseball · **Home-friendly:** yes · **Equipment:** Frisbees
- **Age:** Great visual tool for all ages
- **Steps:**
  1. Hold a frisbee with both hands mimicking a bat grip
  2. Get into your normal hitting stance
  3. Take your swing and release the frisbee towards the field
  4. Watch the flight path of the frisbee to evaluate your swing plane
- **Cue:** "Throw it level"
- **Looks right when:** The frisbee flies straight and level or slightly upward to the opposite field
- **Common mistakes:** The frisbee dives straight into the ground indicating a chopping motion; The frisbee pops straight up indicating dropping the hands
- **Safety:** Ensure an open space to safely throw frisbees
- **Source:** John Madden · YouGoProBaseball, [The Frisbee Hitting Drill](https://www.youtube.com/watch?v=g72wLGj2kq4) at ~0:15

### D66. Training Bat Swing Demonstration
- **Review:** ☑ Approve ☐ Edit ☐ Reject
- **Best for (draft, edit before approving):** poor swing mechanics or bat path
- **Sport:** softball · **Home-friendly:** yes · **Equipment:** training bat with weighted end
- **Age:** None  ⚠️ **flag: check before offering to under-13**
- **Steps:**
  1. Take your normal stance holding the specialized training bat.
  2. Perform a slow, controlled dry swing.
  3. Focus on the path of the weighted end as it travels through the strike zone.
- **Cue:** "smooth swing"
- **Looks right when:** The body stays balanced and the bat path looks clean in slow motion.
- **Common mistakes:** Losing balance or casting the hands.
- **Safety:** Ensure enough clear space around you to swing the training bat safely.
- **Source:** The Hitting Vault, [Turning the barrel/elite bat path VS Knob to ball/taking your hands to the ball](https://www.youtube.com/watch?v=jRnin7g-_x0) at ~0:01

### D67. Outside Pitch Side Toss
- **Review:** ☑ Approve ☐ Edit ☐ Reject
- **Best for (draft, edit before approving):** Struggling to drive outside pitches
- **Sport:** softball · **Home-friendly:** yes · **Equipment:** Softballs, bat, protective screen
- **Age:** 
- **Steps:**
  1. Hitter sets up open, facing slightly away from the feeder.
  2. Feeder tosses the ball to the front hip.
  3. Hitter drives the ball the opposite way simulating an outside pitch.
- **Cue:** "Drive it away"
- **Looks right when:** Hitter hits the ball solidly to the opposite field
- **Common mistakes:** Trying to pull the outside pitch
- **Safety:** Feeder must use a screen.
- **Source:** TeamSnap, [Softball Hitting Drills & Must Know Batting Tips](https://www.youtube.com/watch?v=leDfLWdAZQk) at ~03:47

### D68. PVC Pipe Path Drill
- **Review:** ☑ Approve ☐ Edit ☐ Reject
- **Best for (draft, edit before approving):** casting hands and long swing path
- **Sport:** softball · **Home-friendly:** yes · **Equipment:** PVC pipe, fence
- **Age:** 
- **Steps:**
  1. Hold the PVC pipe in the middle as if it were a bat.
  2. Stand close to the fence.
  3. Take full swings, focusing on keeping the path tight to avoid hitting the fence.
- **Cue:** "Keep it tight"
- **Looks right when:** The pipe follows a clean, tight path without striking the fence.
- **Common mistakes:** Casting hands away from the body early in the swing
- ⚠️ **Safety flag: a person is near the swinging bat or in front of the hitter.** Before approving, require a protective screen and/or adult-only feeding, or reject for home use with kids.
- **Source:** coachb_msusoftball · MSA Hitting Performance Center, [#PVC Pipe Drills](https://www.youtube.com/watch?v=nLdxKKF5pUA) at ~00:04

### D69. Half-Kneeling Bosu Ball Barrel Path Drill
- **Review:** ☑ Approve ☐ Edit ☐ Reject
- **Best for (draft, edit before approving):** Casting the hands or pulling the barrel down and across the body instead of working inside and through the ball.
- **Sport:** baseball · **Home-friendly:** yes · **Equipment:** Bosu ball (or balance pad), swing training stick with ball
- **Age:** Suitable for players of all ages; adjust height or stability pad for younger players.
- **Steps:**
  1. Place your rear knee on an unstable surface like a Bosu ball while extending your front leg out into a wide base.
  2. Set up in your hitting stance using a swing trainer stick.
  3. Initiate your turn while keeping your upper body posture controlled on the pad.
  4. Work the barrel behind the ball and extend out toward center field rather than pulling down and across your lead side.
- **Cue:** "Drive the barrel out, not down and around"
- **Looks right when:** The barrel path remains on plane and extends toward center field with controlled balance on the pad.
- **Common mistakes:** Pulling hands across the chest early; Dumping the barrel downward toward the rear shoe; Losing balance on the Bosu pad
- **Safety:** Ensure adequate space around the Bosu ball to maintain balance safely.
- **Source:** Matt Antonelli · Antonelli Baseball, [Hitting Drill With A Dog Toy](https://www.youtube.com/watch?v=oqjZG_18P0o) at ~00:00

### D70. Two Tee Line Drive Drill
- **Review:** ☑ Approve ☐ Edit ☐ Reject
- **Best for (draft, edit before approving):** Getting under the ball, popping up, and dropping the barrel prematurely
- **Sport:** softball · **Home-friendly:** yes · **Equipment:** Two batting tees, softballs/baseballs, bat
- **Age:** Suitable for all youth ages.
- **Steps:**
  1. Set up two tees in line with your stance path, putting a ball on each tee.
  2. Begin from your loaded position to focus on barrel control through the strike zone.
  3. Swing aiming to drive the ball off the target tee without dropping beneath the trajectory.
  4. Progress to full swings while maintaining a direct barrel path for line drives.
- **Cue:** "Stay on top and drive through the ball"
- **Looks right when:** The bat makes crisp contact with the target ball, creating a level line drive without clipping the rear tee.
- **Common mistakes:** Dropping the back shoulder and dipping beneath the ball; Striking the rear tee before hitting the target ball; Casting hands outward instead of driving through contact
- **Safety:** Ensure clear spacing in front of the tees and around the swing area.
- **Source:** MegRem Softball, [Hitting drill to work on line drives #softball #baseball](https://www.youtube.com/watch?v=vVF2ma-ot3E) at ~00:00


## Barrel depth (`barrel_depth`)

### D71. Deep Tee Drill
- **Review:** ☑ Approve ☐ Edit ☐ Reject
- **Best for (draft, edit before approving):** Hitting everything way out front and not keeping the barrel in the hitting zone long enough.
- **Sport:** baseball · **Home-friendly:** yes · **Equipment:** Bat, batting tee, baseballs
- **Age:** None
- **Steps:**
  1. Set up the batting tee deeper in the stance than normal.
  2. Take your normal batting stance.
  3. Focus on turning the barrel into the zone early.
  4. Hit the ball off the tee in this deep position to practice catching the ball deeper in the zone.
- **Cue:** "Get the barrel in the zone early"
- **Looks right when:** The batter can drive the ball solidly even when it is placed deep in the stance, without having to reach forward.
- **Common mistakes:** Placing the tee too far out front during regular practice, which promotes a short swing path.
- **Safety:** None
- **Source:** Matt Antonelli · Antonelli Softball, [Use this tee drill to help your bat path [Softball Hitting Tips]](https://www.youtube.com/watch?v=3Hdz7PqAW-k) at ~0:00-0:56

### D72. Deep Tee Warm Up
- **Review:** ☑ Approve ☐ Edit ☐ Reject
- **Best for (draft, edit before approving):** hitting too far out front
- **Sport:** baseball · **Home-friendly:** yes · **Equipment:** Bat, tee, baseballs
- **Age:** 
- **Steps:**
  1. Set the tee deep in the hitting zone, near the back hip.
  2. Take normal swings, focusing on making solid contact at this deeper point.
  3. Use this setup repeatedly as a warm-up.
- **Cue:** "Hit it deep"
- **Looks right when:** The hitter drives the ball solidly despite the deep point of contact.
- **Common mistakes:** Reaching for the ball; Getting jammed
- **Source:** Gridiron Elite Lab · Baseball Elite Lab, [Do THIS Tee Drill To INSTANTLY Improve Swing Path! ⚾⚡ #baseball #mlb #hittingdrills](https://www.youtube.com/watch?v=9vDh5MxOziU) at ~00:00

### D73. Back Hip Tee Drill
- **Review:** ☑ Approve ☐ Edit ☐ Reject
- **Best for (draft, edit before approving):** pushing arms out front, sliding forward excessively
- **Sport:** baseball · **Home-friendly:** yes · **Equipment:** Bat, tee, baseballs
- **Age:** 
- **Steps:**
  1. Place a batting tee in line with your back hip.
  2. Coil onto and around your rear leg and pause.
  3. Turn your forearm rearward as if trying to hit the catcher's mask.
  4. Tilt and turn your rear leg forward to make contact deep without pushing your arms.
- **Cue:** "Hit the catcher's mask"
- **Looks right when:** Contact is made deep in the zone without the arms pushing forward.
- **Common mistakes:** Sliding forward excessively; Pushing the arms out to make contact
- **Source:** Aj Arroyo, [Deep tee work for barrel depth](https://www.youtube.com/watch?v=S0-O3P5DQ9s) at ~00:17

### D74. Step Back Drill
- **Review:** ☑ Approve ☐ Edit ☐ Reject
- **Best for (draft, edit before approving):** lack of barrel depth
- **Sport:** softball · **Home-friendly:** yes · **Equipment:** Bat, tee, softball
- **Age:** 
- **Steps:**
  1. Set up in your normal batting stance.
  2. Step backward with your rear foot away from the pitcher.
  3. Stride forward with your front foot and swing.
- **Cue:** "Step back, step forward"
- **Looks right when:** The hitter creates momentum and achieves good barrel depth through the swing.
- **Common mistakes:** Losing balance when stepping backward
- **Source:** The Softball Doctor · The Softball Doctor, [💥BARREL DEPTH DRILL💥](https://www.youtube.com/watch?v=czvIcNx3I84) at ~00:00


## Contact (`contact`)

### D75. Palm Up Tee Drill
- **Review:** ☑ Approve ☐ Edit ☐ Reject
- **Best for (draft, edit before approving):** Rolling the wrists over too early or casting the hands.
- **Sport:** softball · **Home-friendly:** yes · **Equipment:** bat, tee, ball
- **Age:** 
- **Steps:**
  1. Set up a ball on a tee.
  2. Hold the bat with only your top hand and keep your palm facing up.
  3. Hover your front hand out over the tee.
  4. Drive your back knee and swing through the ball with your top hand, focusing on keeping the palm up.
- **Cue:** "Palm up, knee drive."
- **Looks right when:** The batter maintains a palm-up position with the back hand through contact without the wrist rolling over.
- **Common mistakes:** Rolling the wrist at or before contact.; Failing to drive the back knee.
- ⚠️ **Safety flag: a person is near the swinging bat or in front of the hitter.** Before approving, require a protective screen and/or adult-only feeding, or reject for home use with kids.
- **Source:** ChasWalchSoftball , [stop rolling over and do this drill! @bruceboltus code CHAS ⚡️ #softball #baseball #hitting #coach](https://www.youtube.com/watch?v=1ymTutzIrCY) at ~00:00

### D76. Set Contact - Set Extension
- **Review:** ☑ Approve ☐ Edit ☐ Reject
- **Best for (draft, edit before approving):** Poor body position at contact and lack of extension.
- **Sport:** softball · **Home-friendly:** yes · **Equipment:** Tee, bat, balls
- **Age:** 
- **Steps:**
  1. Take a normal stance.
  2. Take a slow mock swing and stop exactly at the point of contact.
  3. Reload your upper body while keeping your lower body completely still.
  4. Take a full swing from this reloaded position.
- **Cue:** "Fake, reload, swing"
- **Looks right when:** The batter maintains their lower half positioning during the reload phase and fires cleanly.
- **Common mistakes:** Moving the lower body during the reload
- **Source:** SportVideos, [Softball Hitting Tips and Techniques - Tee Drills - Coach Holly Bruder](https://www.youtube.com/watch?v=49DRucUUibY) at ~00:11

### D77. Pause at Contact Drill
- **Review:** ☑ Approve ☐ Edit ☐ Reject
- **Best for (draft, edit before approving):** swinging through without feeling the proper contact point
- **Sport:** softball · **Home-friendly:** no · **Equipment:** bat, ball, tosser
- **Age:** None
- **Steps:**
  1. Set up in your stance while a partner or machine pitches the ball.
  2. Swing at the pitch with regular intent.
  3. Abruptly stop your bat exactly at the point of contact.
  4. Hold the position to feel your body and bat alignment at contact.
- **Cue:** "pause at contact"
- **Looks right when:** The bat stops solidly upon hitting the ball without continuing into a follow-through.
- **Common mistakes:** Following through instead of completely stopping the bat at contact.
- **Safety:** Tosser should be behind a protective screen.
- ⚠️ **Safety flag: a person is near the swinging bat or in front of the hitter.** Before approving, require a protective screen and/or adult-only feeding, or reject for home use with kids.
- **Source:** MegRem Softball, [Hitting drill to work on extension](https://www.youtube.com/watch?v=RjOIuTdYueA) at ~0:01


## Extension (`extension`)

### D78. Two Tee Extension Drill
- **Review:** ☑ Approve ☐ Edit ☐ Reject
- **Best for (draft, edit before approving):** Pulling the bat away from the plate too early after hitting the ball, leading to weak grounders.
- **Sport:** softball · **Home-friendly:** yes · **Equipment:** Two batting tees, two balls, bat
- **Age:** 
- **Steps:**
  1. Place one batting tee right down the middle of home plate.
  2. Place a second batting tee directly in front of where the player's front foot steps.
  3. Make sure both balls are set to the exact same height.
  4. Have the player swing to hit the ball on the first tee.
  5. They must extend their bat forward enough so that they don't accidentally hit the ball on the second tee.
- **Cue:** "Keep the barrel moving through the zone"
- **Looks right when:** The player hits the first ball powerfully and their bat swings completely past the second ball without touching it.
- **Common mistakes:** Pulling the bat across the body too quickly, which knocks the second ball off its tee
- **Source:** Megan Rembielak · TannerTees, [Two Tee Extension Drill with Megan Rembielak using a Tanner Tee | Softball Hitting Drills](https://www.youtube.com/watch?v=22bq90ojT_o) at ~0:43 (also shown in 2 other video(s): [MegRem Softball](https://www.youtube.com/watch?v=BWLHCBkcsvc), [MegRem Softball](https://www.youtube.com/watch?v=MXffI8D2w0o))

### D79. Non-Traditional Hitting Drill
- **Review:** ☑ Approve ☐ Edit ☐ Reject
- **Best for (draft, edit before approving):** Weak contact and lack of barrel control or extension through the ball.
- **Sport:** baseball · **Home-friendly:** yes · **Equipment:** Bat, ankle weight, batting tee, baseballs
- **Age:** Weighted bat drills are generally not recommended for players under 13.  ⚠️ **flag: check before offering to under-13**
- **Steps:**
  1. Wrap an ankle weight securely around the barrel of the bat.
  2. Take your normal stance and set up a ball on the tee.
  3. Swing the bat, focusing on maintaining strong top hand control.
  4. Drive through the ball for explosive extension, keeping the heavy barrel steady.
- **Cue:** "Explosive extension"
- **Looks right when:** The hitter maintains barrel control despite the extra weight and fully extends through contact without dropping the bat head.
- **Common mistakes:** Dropping the barrel due to the added weight.; Decelerating before contact instead of powering through.; Losing top hand stability.
- **Safety:** Ensure the ankle weight is fastened securely so it doesn't fly off during the swing.
- **Source:** Complete Softball Guidance, [Non-Traditional Hitting Drill for a Strong Top Hand, Barrel Control, Explosive Extension](https://www.youtube.com/watch?v=a5feXz3b9Ek) at ~00:00

### D80. Tee Extension Demonstration
- **Review:** ☑ Approve ☐ Edit ☐ Reject
- **Best for (draft, edit before approving):** fighting for extension by pushing the hands out or cutting across the ball
- **Sport:** baseball · **Home-friendly:** yes · **Equipment:** bat, tee, ball
- **Age:** None
- **Steps:**
  1. Set up a tee in front of you.
  2. Start your swing by keeping the barrel tight to your shoulder, entering the zone early and deep from the inside.
  3. Hit the ball off the tee while staying on the proper path.
  4. Maintain a palm up, palm down hand position through the ball.
  5. Allow the bat to fully extend towards the pitcher before the wrists turn over.
- **Cue:** "palm up, palm down"
- **Looks right when:** The barrel works down the line through the middle of the field and extends fully before rolling over.
- **Common mistakes:** Pushing the hands away from the body to force extension.; Entering the zone from the outside and cutting across the ball.
- **Safety:** Ensure proper space for swinging and a net to hit into.
- **Source:** Matt Antonelli · Antonelli Baseball, [How To Get Proper Extension [Baseball Hitting Tips]](https://www.youtube.com/watch?v=ajjQs5a_EXk) at ~0:11

### D81. Extension Drill
- **Review:** ☑ Approve ☐ Edit ☐ Reject
- **Best for (draft, edit before approving):** Cutting the swing off early or wrapping around the body too soon.
- **Sport:** softball · **Home-friendly:** yes · **Equipment:** bat, tee, ball
- **Age:** 
- **Steps:**
  1. Place a ball on the tee.
  2. Take your normal swing and hit the ball.
  3. After contact, extend your arms straight out toward the pitcher.
  4. Stop and hold the bat out at full extension without finishing the swing around your body.
- **Cue:** "Hold your extension."
- **Looks right when:** Both arms are fully extended straight in front of the batter after contact, forming a V shape.
- **Common mistakes:** Pulling the bat across the body too early.; Stopping the swing before full extension.
- ⚠️ **Safety flag: a person is near the swinging bat or in front of the hitter.** Before approving, require a protective screen and/or adult-only feeding, or reject for home use with kids.
- **Source:** D.R. Hitting: Coaching & Instruction, [Extension Drill Progression #softball #swing #baseball #coaching #mlb #baseballdrills #shorts](https://www.youtube.com/watch?v=dnWmlH_hmjs) at ~00:00

### D82. Front Toss: Palm Up, Palm Down
- **Review:** ☑ Approve ☐ Edit ☐ Reject
- **Best for (draft, edit before approving):** rolling the wrists over too early before extension
- **Sport:** both · **Home-friendly:** no · **Equipment:** bat, weighted training balls, front tosser
- **Age:** Weighted training balls are used, which may not be suitable for players under 13.  ⚠️ **flag: check before offering to under-13**
- **Steps:**
  1. Have a partner set up behind a screen for front toss.
  2. The partner tosses weighted training balls to the hitter.
  3. Take a normal swing, focusing on keeping the bat path even through the zone.
  4. Ensure your top hand remains palm up and bottom hand palm down through extension.
- **Cue:** "palm up, palm down"
- **Looks right when:** The hitter drives the weighted ball smoothly without rolling their wrists over at contact.
- **Common mistakes:** Rolling the wrists over too early before getting extension.
- **Safety:** The tosser must use an L-screen or protective net.
- ⚠️ **Safety flag: a person is near the swinging bat or in front of the hitter.** Before approving, require a protective screen and/or adult-only feeding, or reject for home use with kids.
- **Source:** Samantha Hislop · Hit Run Steal, [Weighted Training Balls  Front Toss Practice](https://www.youtube.com/watch?v=toVF-nj2W9g) at ~0:05


## Finish & balance (`finish_balance`)

### D83. Rapid Fire Hitting
- **Review:** ☑ Approve ☐ Edit ☐ Reject
- **Best for (draft, edit before approving):** Hitters getting stuck in their swing, flying open towards third base, or leaning forward and falling out of balance.
- **Sport:** baseball · **Home-friendly:** no · **Equipment:** Bat, 6 baseballs, batting net/cage, soft toss partner
- **Age:** 
- **Steps:**
  1. Have a coach or partner stand in soft toss range with six baseballs ready.
  2. Get into a wide, no-stride stance and stay low in your legs.
  3. Swing at the first tossed ball, then immediately retrace your swing back to the starting position.
  4. Continue swinging and resetting for all six balls in rapid succession without stopping.
  5. Focus on keeping your legs low, maintaining your posture, and staying balanced throughout all six swings.
- **Cue:** "Stay in your legs"
- **Looks right when:** The hitter can maintain their swing mechanics, posture, and balance for six consecutive rapid swings without falling over.
- **Common mistakes:** Leaning over and falling forward; Flying open towards the pull side; Coming up out of the legs during the swings
- ⚠️ **Safety flag: a person is near the swinging bat or in front of the hitter.** Before approving, require a protective screen and/or adult-only feeding, or reject for home use with kids.
- **Source:** Hit4Power, [Rapid Fire Hitting Drill | Fix Your Balance and Stay in Your Legs](https://www.youtube.com/watch?v=ZLJMteKuYxA) at ~00:19

### D84. Flexion Release Swing
- **Review:** ☑ Approve ☐ Edit ☐ Reject
- **Best for (draft, edit before approving):** Releasing the barrel too early and falling back before making contact.
- **Sport:** baseball · **Home-friendly:** yes · **Equipment:** Bat, batting net
- **Age:** 
- **Steps:**
  1. Start in your normal batting stance.
  2. Initiate the swing by bringing the knob of the bat forward first.
  3. Throw the barrel out front to feel the flexion release at the point of contact.
  4. Complete the swing while keeping your balance and avoiding falling backward.
- **Cue:** "Knob first, barrel follows"
- **Looks right when:** The bat speed is generated out front with a strong release, and the body stays balanced through contact without falling back.
- **Common mistakes:** Releasing the barrel early; Falling backwards before making contact
- **Source:** Perfect Swings USA, [Stop falling back! How to fix. #baseball #hitting #hittingdrills #softball #training #swingpath](https://www.youtube.com/watch?v=_1vDo6Akc6w) at ~00:00

### D85. One-Legged Drill
- **Review:** ☑ Approve ☐ Edit ☐ Reject
- **Best for (draft, edit before approving):** Lunging forward, not keeping weight back, or shifting weight too early.
- **Sport:** baseball · **Home-friendly:** no · **Equipment:** Bat, batting cage, front toss or machine
- **Age:** 
- **Steps:**
  1. Set up in the batter's box and lift your front leg entirely off the ground.
  2. Balance all of your weight on your back leg while waiting for the pitch.
  3. As the pitch approaches, begin your swing process.
  4. Let your front leg come down to the ground exactly as you launch your swing, not before.
  5. Drive through the swing from this loaded position.
- **Cue:** "Keep your weight back"
- **Looks right when:** The front foot lands right at the moment the swing is launched, maximizing power and keeping the weight back.
- **Common mistakes:** Letting the front foot come down before launching the swing; Losing balance while on one leg
- ⚠️ **Safety flag: a person is near the swinging bat or in front of the hitter.** Before approving, require a protective screen and/or adult-only feeding, or reject for home use with kids.
- **Source:** Teacherman Hitting, [The Best Way To Teach A Hitter To Keep Their Weight Back? Try This One-Legged Drill Progression](https://www.youtube.com/watch?v=gXeByJRG4t4) at ~00:00

### D86. Ball Behind Back Foot Drill
- **Review:** ☑ Approve ☐ Edit ☐ Reject
- **Best for (draft, edit before approving):** Falling backward during the swing or spinning out instead of driving forward through the ball.
- **Sport:** softball · **Home-friendly:** yes · **Equipment:** Bat, batting tee, two softballs
- **Age:** 
- **Steps:**
  1. Set up a ball on the tee in your normal hitting position.
  2. Place a second ball on the ground about one inch behind your back foot.
  3. Take your normal swing at the ball on the tee.
  4. Ensure your back foot does not kick or touch the ball on the ground behind it.
- **Cue:** "Drive through the ball"
- **Looks right when:** The swing is completed and the ball behind the back foot remains untouched, indicating a forward drive rather than a backward fall.
- **Common mistakes:** Sitting back and spinning on the back foot; Kicking the back foot backward and hitting the ball on the ground; Falling backwards instead of driving forward
- **Source:** MegRem Softball, [Hitting drill to avoid falling back.](https://www.youtube.com/watch?v=tlUtsXzWnYA) at ~00:00

### D87. Kick Drill
- **Review:** ☑ Approve ☐ Edit ☐ Reject
- **Best for (draft, edit before approving):** Back side not working, lacking balance through the finish
- **Sport:** baseball · **Home-friendly:** yes · **Equipment:** Bat, ball, tee or net
- **Age:** Appropriate for all ages
- **Steps:**
  1. Take a regular swing at the ball
  2. After making contact, kick your back foot forward
  3. Land balanced on the foot you just kicked forward
- **Cue:** "Kick forward"
- **Looks right when:** The batter finishes completely balanced on their front foot while their back foot kicks forward
- **Common mistakes:** Falling off balance during the kick; Not allowing the back side to fully release
- **Safety:** Ensure there is enough clear space to kick forward safely
- **Source:** Ahead Of The Curve, [Kick Through Drill (Balance)](https://www.youtube.com/watch?v=v0S1t0GnGi8) at ~0:05


## Foundation (any fault, ages 8-10) (`foundation`)

### D88. The Flamingo Drill
- **Review:** ☑ Approve ☐ Edit ☐ Reject
- **Best for (draft, edit before approving):** Lack of back leg stability, poor posture, and losing balance during the stride.
- **Sport:** baseball · **Home-friendly:** yes · **Equipment:** Bat, batting tee, baseballs
- **Age:** None
- **Steps:**
  1. Lift your front stride leg high in the air, balancing entirely on your back leg.
  2. Hinge slightly at the hips to activate your glutes and sit your weight into your back leg.
  3. Hold this single-leg balance position in the air to establish control.
  4. Plant your front foot forward and take a controlled swing.
- **Cue:** "Sit in the back hip"
- **Looks right when:** The hitter can balance smoothly on the back leg without wavering, then transition directly into a powerful swing without falling forward.
- **Common mistakes:** Standing too upright without hinging at the hips.; Losing balance and falling forward before the stride is intentionally made.; Failing to engage the back leg muscles to hold the body's weight.
- **Safety:** None
- **Source:** icoachbaseball, [Try the Flamingo Drill 🦩 (Balance + POWER)](https://www.youtube.com/watch?v=3g8GVtF77dA) at ~00:00 (also shown in 1 other video(s): [Legends Baseball Camps](https://www.youtube.com/watch?v=IB5dBtmh3Fw))

### D89. Resistance Band Hitting Drill
- **Review:** ☑ Approve ☐ Edit ☐ Reject
- **Best for (draft, edit before approving):** Over-striding, weak lower half, or losing balance during the swing.
- **Sport:** softball · **Home-friendly:** yes · **Equipment:** bat, tee, ball, resistance band
- **Age:** 
- **Steps:**
  1. Place a resistance band around your lower thighs just above the knees.
  2. Take your stance at the tee.
  3. Stride against the resistance of the band, ensuring your feet stay grounded.
  4. Take a full swing while maintaining a strong, stable lower half.
- **Cue:** "Stay strong in your legs."
- **Looks right when:** The batter maintains a wide, stable base during the stride and swing without the band pulling their knees together.
- **Common mistakes:** Allowing the band to pull the knees inward.; Striding too narrow due to the band's resistance.
- **Safety:** Ensure the resistance band is secure and not too tight to prevent tripping.
- **Source:** Myosource Kinetic Bands, [Hitting drills for Softball leg and hip strength adding resistance with Kinetic bands](https://www.youtube.com/watch?v=KaQZyRJCzss) at ~00:00

### D90. The Slinky
- **Review:** ☑ Approve ☐ Edit ☐ Reject
- **Best for (draft, edit before approving):** not working from a position of balance
- **Sport:** baseball · **Home-friendly:** yes · **Equipment:** bat
- **Age:** None
- **Steps:**
  1. Set up in your balanced batting stance without counter-loading your weight.
  2. Perform a full squat straight down and come back up while maintaining your balance.
  3. Move into your 50/50 stride position.
  4. Perform another full squat in the stride position to ensure you are still perfectly balanced.
- **Cue:** "carry balance"
- **Looks right when:** You can perform the squats smoothly without falling off balance or shifting your weight incorrectly.
- **Common mistakes:** Counter-loading over either leg instead of staying centered.
- **Safety:** None
- **Source:** Youth Baseball Edge, [Slinky Drill with Doug Latta](https://www.youtube.com/watch?v=S9hy_Qd1sE8) at ~0:11


## Videos rejected during watching

- [Pure Fastpitch · Jessica Mendoza Slow Motion Swing Mechanics#softball #softballlife #fastpitch #purefastpitch](https://www.youtube.com/watch?v=2sS9V4XTHmw): no drill actually demonstrated
- [MegRem Softball · How To Hit A Softball](https://www.youtube.com/watch?v=3jXFfiA0ULI): no drill actually demonstrated
- [MegRem Softball · 3 plate hitting drill to work on timing](https://www.youtube.com/watch?v=4UJ-fd8gfxY): not hitting instruction
- [MegRem Softball · 5 picks glove side + a throw. 5 picks backhand + a throw #infield #softball #baseball](https://www.youtube.com/watch?v=5vXzuaR_dKI): not hitting instruction
- [icoachbaseball · Step 1 to a Good Baseball Swing 💥](https://www.youtube.com/watch?v=6nZr8_A_N2Y): no drill actually demonstrated
- [Ken Krause · Towel drill front view](https://www.youtube.com/watch?v=Ga6naYWnwbo): not hitting instruction
- [Driveline Softball · Angle In Drill: High Intensity Hitting with Driveline Smash Balls](https://www.youtube.com/watch?v=JMtgzs9OJh4): no drill actually demonstrated
- [MegRem Softball · Do's and Don'ts Of Front Toss For Softball/Baseball](https://www.youtube.com/watch?v=LRT1pFCQQ70): no drill actually demonstrated
- [HittingWithCarl · Hands and Stride #softball #swing #hitting #youtubeshorts #shorts #drills #stretch #separation #hit](https://www.youtube.com/watch?v=LWYVLB60r90): no drill actually demonstrated
- [Teacherman Hitting · "Do You Recommend A Toe Tap, No Stride, Or A Leg Kick For Hitters?](https://www.youtube.com/watch?v=MblHwCXrCvI): no drill actually demonstrated
- [Driveline Softball · What Works Best for Hitting Training?](https://www.youtube.com/watch?v=NN9X1tlsZCE): no drill actually demonstrated
- [31 Pitching Development / Chris Romano MA, RSCC’D · 58 ➡️ 61mph with one adjustment-using a quick & simple drill to feel how to lead leg block #baseball](https://www.youtube.com/watch?v=QtXHTULv5fY): not hitting instruction
- [Antonelli Baseball · How To Get Your Timing Down](https://www.youtube.com/watch?v=RTyD8Fv8SeI): no drill actually demonstrated
- [Easton Diamond Sports, LLC · A staple drill in Jen Schro Catching 👏 #teameaston #softball](https://www.youtube.com/watch?v=SMWXMVYI9yI): not hitting instruction
- [MegRem Softball · Hitting drill to work hand path and posture.](https://www.youtube.com/watch?v=VMyxvwWiUGo): not hitting instruction
- [Antonelli Baseball · How To Improve Your Timing When Hitting](https://www.youtube.com/watch?v=bot4OoQMue8): no drill actually demonstrated
- [Hitterish · Most hitters are never taught this](https://www.youtube.com/watch?v=cA_VxBFH6ck): no drill actually demonstrated
- [Amanda Scarborough | Pitching Angel · Make your front side resistance be a 10/10](https://www.youtube.com/watch?v=diXFPoJav2g): not hitting instruction
- [MAYBERRY BASEBALL · How to Fix Falling Off the Ball on Outside Pitches | 8U Hitting Lesson](https://www.youtube.com/watch?v=j-S9LkLoKGU): no drill actually demonstrated
- [Taylor Yates · Banded Knee Up Drill | Triple Play Academy](https://www.youtube.com/watch?v=kxtZqpuCYu4): not hitting instruction
- [Next Level · Next Level Training II (6 year old) Toe Touch Drill](https://www.youtube.com/watch?v=sQU95BS5pIg): not hitting instruction
- [Amanda Scarborough | Pitching Angel · Touch Triggers!! #softball #pitching #pitchingdrills](https://www.youtube.com/watch?v=sfUvVj-4lq0): not hitting instruction
- [Quel · Practice using your entire body rotation for hits or dingers like this #baseball](https://www.youtube.com/watch?v=wEHumwz5rT8): not hitting instruction
- [Antonelli Baseball · You CAN'T Do This With Your Stride! [Baseball Hitting Tips]](https://www.youtube.com/watch?v=zr3YHh8hnxY): no drill actually demonstrated