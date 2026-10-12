# HitterLoop evaluation annotation guide — v1.0.0

This contract describes what qualified human reviewers can see in **original baseball and softball video**. It is independent of annotation software and separate from HitterLoop's live analysis. It does not establish that a coaching claim or a model is correct. There is no benchmark runner, decoder, database migration, or production integration in PR3.

## Before labeling

- Work only with footage authorized for evaluation, on the approved private workstation. This file's `data_origin: private_consented` is a declaration, **not proof of consent**. Consent enforcement and tooling belong to later work packages.
- Use opaque clip, athlete, track and annotator IDs. Never put names, email addresses, birth dates, team names, jersey numbers, file paths, URLs, GPS or other personal details in annotations. Keep the private identity/qualification registry separately controlled.
- Every committed example is synthetic, has a deliberately fictitious all-zero source hash, and has no corresponding video. Never replace these examples with real footage or labels. Real source hashes and per-clip labels also belong in private evaluation storage.
- Observe the whole attempt at normal speed, then step through source frames. Do not view model predictions before making independent human labels. For the planned agreement study, double-annotate 20% independently; review/adjudication must not overwrite the original private revisions.

## Find the correct batter

In multi-person video, first identify who is attempting to hit the pitch. Follow that person's body through the whole attempt; the largest/nearest person may be a catcher, coach or umpire. Do not select the person merely because a detector assigned a track or a bat-shaped object is nearby.

Give each continuously identified person a clip-local `trk_` ID. `tracks` associates it with a pseudonymous `ath_` ID when identity is known; a bystander may have `athlete_id: null`. Keep IDs stable across frames. If a track fragments and identity can be established, separate track IDs may refer to the same athlete. Do not merge different people because their paths cross.

Each attempt records `batter_identity_status`:

- `confirmed`: a declared athlete and track agree; no candidate list is needed.
- `ambiguous`: leave `batter_track_id` null and list candidate tracks. One candidate is allowed when it cannot yet be confirmed. Do not turn uncertainty into an arbitrary identity choice.
- `not_visible`: no track or candidate is asserted. The athlete may be known from the private task, or may be null.

Review each sampled subject box. Use the visible person's tight, positive-area extent; clip it at the image boundary. Do not invent the off-screen body outline. If the extent is uncertain, mark the box ambiguous and give an uncertainty radius. Fully invisible people have no box coordinates. Record other visible people as separate subjects where relevant to identity assessment.

## Coordinate convention and COCO-17

Coordinates are normalized to the **original coded raster**, before display rotation, mirroring, resizing or cropping: x increases to image right, y down; (0,0) is the top-left boundary and (1,1) the bottom-right boundary. Continuous pixel-edge coordinates convert as `x_normalized = x / source.width`, `y_normalized = y / source.height`. Boundary points are allowed; values outside [0,1] are not. Boxes are `[left, top, right, bottom]` with strictly positive area.

If your tool displays a rotated, resized or cropped image, its exporter must undo that transform. `rotation_degrees` records source display rotation and `mirrored` records known reflection, or `unknown`. Changing these metadata values cannot substitute for transforming coordinates correctly. A later media inventory check must compare original dimensions and stream identity.

Supply all 17 **anatomical** COCO joints for each sampled subject, in the named fields:

`nose`, `left_eye`, `right_eye`, `left_ear`, `right_ear`, `left_shoulder`, `right_shoulder`, `left_elbow`, `right_elbow`, `left_wrist`, `right_wrist`, `left_hip`, `right_hip`, `left_knee`, `right_knee`, `left_ankle`, `right_ankle`.

“Left” means the athlete's left, not the left side of the picture. Do not label fingers, toes, grip locations or inferred 3D joints as COCO landmarks.

For every joint and each bat endpoint:

| Status | Coordinates and uncertainty | COCO visibility |
| --- | --- | --- |
| `observed` | Visible location, with a non-negative localization uncertainty radius | 2 |
| `ambiguous` | A bounded estimate supported by footage; positive uncertainty radius and reason | 1 for occluded, 2 for visible but blurred/uncertain |
| `not_visible` | Coordinates/radius null; reason such as occluded, out of view or motion blur | 0 |
| `not_applicable` | Coordinates/radius null; reason `not_applicable` | 0 |

The radius is in the same normalized coordinate plane, around the point (or each box corner). It describes localization tolerance, not confidence that an event happened. It is not a probability. Do not use zero coordinates as a missing-value sentinel. Never copy the model's skeleton into an occluded joint. Only give an ambiguous estimate if nearby source frames and visible anatomy actually bound its location; otherwise use `not_visible`. A fully occluded body cannot have visibility-2 joints.

## Bat endpoints, blur and occlusion

Label the **knob** at the handle's end and the **barrel end** at the far end of the barrel. These are physical endpoints, not the corners or midpoints of an axis-aligned detection box. The knob is not automatically the left wrist. Hands may separate during follow-through.

- If both ends are clear, label each independently.
- If an end appears as a smear, use a bounded ambiguous location only if the endpoint can be localized; include a positive radius and `motion_blur` reason.
- If the endpoint disappears in blur or behind a person, set that endpoint to `not_visible`. The other endpoint may still be observed.
- For a person with no relevant bat, endpoints may be `not_applicable`.

Record body and bat `motion_blur` separately (`none`, `mild`, `severe`, `unknown`) and `occlusion` separately (`none`, `partial`, `full`, `unknown`). These describe the image, not confidence scores. Fully occluded bats cannot have visibility-2 endpoints.

## Batting side and front leg

Record the side actually used in this attempt: `R`, `L`, or `unknown`, including for switch hitters. Use body position relative to the plate/pitcher and the swing across multiple frames; do not infer it from screen-left position or the model's wrist choice. Check for mirroring.

For conventional R batting the front leg is anatomically left; for L it is right. Mark `front_leg: unknown` when you cannot determine it. A known side may coexist with an unobserved front leg. Slap and bunt intent should be recorded separately; do not force a conventional stride/launch sequence onto those movements.

## Events and outcomes

Each pitch/attempt has an opaque `swing_id`, a source-frame window and all eight event keys. The name “swing” is a container name: takes also get an attempt record. Intent is `conventional_full`, `slap`, `power_slap`, `bunt`, `drag_bunt`, `checked_protective`, `take`, or `unknown`.

| Event | Label what is visible |
| --- | --- |
| `stance_set` | An established ready stance for this attempt; the batter need not be perfectly motionless. |
| `load_start` | Onset of observable preparatory rearward hand/body motion. This is not proof of force or weight transfer. When onset is unclear, give an interval rather than a guessed instant. |
| `stride_foot_lift` | Front foot visibly leaves the ground/starts the relevant slide. A no-stride action can be not applicable. |
| `foot_plant` | Front foot visibly re-establishes its landing/plant for this action. Video does not measure weight bearing or ground reaction force. |
| `swing_launch` | Hands/barrel start their forward hitting action. This is a visual boundary, not a measured neural or muscular onset. |
| `impact_estimate` | Estimated passage through the hitting zone: barrel nearest the estimated pitch path or plate-front reference. This does **not** assert bat-ball contact. |
| `contact_confirmed` | Ball-bat interaction is confirmed visually: the ball is seen at the bat with clear interaction, or an attributable ball deflection is visible. The exact time may still be ambiguous. |
| `finish` | The visible stabilized post-action finish. It may be absent when the clip ends early. |

Outcome vocabulary:

- `contact_confirmed_fair`, `contact_confirmed_foul`;
- `contact_confirmed_unknown_direction`: v1 addition for visible contact when fair/foul cannot be determined; do not guess direction;
- `contact_unconfirmed`: possible contact, e.g. an audio crack, without sufficient visual confirmation;
- `swing_miss`, `checked_swing`, `no_swing_take`, `unknown`.

`outcome_evidence` records `ball_visible_at_bat`, `ball_deflection`, `audio_crack`, `fielder_reaction`, or `none`. `none` must stand alone. The first two flags mean **clear visual contact evidence**, not mere 2D proximity or an indistinct ball-shaped smear, and require a confirmed-contact outcome. Audio and fielder reaction alone cannot confirm contact. Do not classify a hit or fair/foul from body motion, sound or the model's `contact` phase.

For a confirmed-contact outcome, the `contact_confirmed` event must be observed or have an uncertain time interval, and visual evidence is mandatory. For all other outcomes it must remain missing/not applicable/unreviewed. Ambiguous physical contact is `contact_unconfirmed` or `unknown`, not an ambiguous claim that contact is confirmed. An ambiguous **time** for visually confirmed contact is allowed.

`hitting_zone` is `reached`, `not_reached`, or `unknown`. Misses that pass through the zone still have an impact estimate. Checked swings that reach it may also have one; checked swings that stop beforehand have `impact_estimate: not_applicable` / `not_reached`. If the zone is reached but the moment is obscured, `not_visible` is valid. Never fabricate an impact estimate solely to fill a field.

For `no_swing_take`, use `intent: take`, `hitting_zone: not_reached`; all events after `stance_set` are explicitly `not_applicable` with reason `no_swing`. This is the evaluation convention, **not a claim that a taking batter cannot make preparatory movements**. Those movements may be represented in sampled body labels. The plan has both “no events” and “none after stance” wording; v1 retains the useful stance label while prohibiting swing-event assertions.

## Time: source PTS only

`source.presentation_timestamps` is the complete PTS inventory of the selected **original video stream**, in presentation order, with one integer entry per frame. `time_base.numerator / denominator` expresses seconds per tick. `frame_count` equals its length. `video_stream_index`, original dimensions, source SHA-256 and orientation identify the source. Index zero is the first presented frame of the original video, not the first frame of a trim, crop or annotation task.

Every frame sample, attempt-window endpoint, observed event and uncertainty endpoint carries both `frame_index` and integer `pts`. They must exactly match the inventory. Index is presentation order, not encoded packet/DTS order. Do not use frame_index/fps, average fps, re-encoded timestamps, player seek positions or rounded milliseconds to create labels. Preserve original nonzero or negative PTS origins; do not rebase to zero. The VFR example deliberately has uneven gaps and a negative first PTS.

For event timing:

- `observed`: one source frame, plus a singleton uncertainty interval containing that same frame.
- `ambiguous`: no privileged guessed frame (`frame: null`); earliest/latest plausible source frames define a non-singleton interval, with a reason. Use this when multiple neighboring frames fit the boundary.
- `not_visible`: no time or interval; state why footage cannot localize it.
- `not_applicable`: no time or interval; state `no_swing`, `no_stride`, `not_reached`, `no_contact`, or `no_distinct_action` as appropriate. A held bunt may have no distinct load/forward-launch action; do not manufacture one.
- `not_annotated`: an unfinished draft, not evidence of absence. Completed reviewed/adjudicated records cannot retain it.

Source and sample indexes must be ordered and unique, attempt windows ordered/non-overlapping, and event ranges contained in their attempt window. Timing uses a **partial order**: stance precedes action, load precedes launch, foot lift precedes plant, launch precedes hitting-zone/contact events, and finish follows action. **There is no requirement that plant precede launch, that load precede foot lift, or that impact estimate equal/precede confirmed contact.** Overlapping uncertainty intervals are valid if some chronology satisfies the partial order. The validator propagates bounds through the full sequence rather than comparing adjacent labels only.

Duplicate/non-increasing source PTS and values outside JavaScript's exact safe-integer range are unsupported by v1 and fail closed. Do not “fix” them by synthesizing timestamps. Preserve the original artifact for diagnosis; support requires an explicit contract update. Seconds/milliseconds may be calculated from PTS for display or later scoring, but are not annotation keys.

## Camera conditions

Record observed `viewpoint`: `open_side`, `closed_side`, `behind_plate`, `pitcher_view`, `oblique`, or `unknown`. Describe where the camera is relative to the batter's hitting side, not just where it appears on screen. Separately record the declared `capture_profile` (`game_backstop`, `open_side_practice`, `unknown_imported`, `other`). A declared profile is not evidence that the camera actually matches it.

Record visible obstructions (net, fence, person, equipment, other, unknown) without guessing occluded details. `none` cannot accompany another obstruction. If an angle hides a joint, foot or barrel endpoint, annotate that limitation rather than treating perspective as correctable 3D evidence. An unusual angle is valid data, not automatically a failed clip.

## Annotators, review and versioning

IDs use prefixes `eval_`, `ath_`, `trk_`, `swg_`, `ann_` followed by 16 lowercase hexadecimal characters. Generate them privately; do not derive them from names/emails. Roles and qualifications are declarations whose real identity and qualifications must be verified in the private registry. Schema validation cannot certify a reviewer, consent, correctness, or honest judgment.

Exactly one primary annotator is declared. `reviewed` requires at least one distinct declared reviewer and no unresolved disagreement. `adjudicated` requires a distinct declared adjudicator, at least one reviewer and `disagreement: resolved`. Neither self-review nor reusing a reviewer's ID as adjudicator is valid. Drafts may record distinct declared reviewer IDs as review progresses. Unresolved disagreement requires at least one reviewer ID and draft status; a draft cannot claim resolved disagreement. If reviewers disagree, keep the record in draft, retain those reviewer IDs and their original independent annotations; do not average coordinates or timestamps silently. An adjudicator may resolve disagreement by retaining an ambiguous interval or a missing observation.

`schema_version` is exactly `1.0.0`; unsupported versions are rejected, never guessed/coerced. `annotation.revision` counts annotation edits independently of schema version. Keep old revisions privately. Semantic/field changes require a new versioned schema and explicit migration policy; preserve v1 for old datasets.

## Validation layers and non-TypeScript tools

1. **Portable structure:** `eval/schema/annotation.v1.schema.json` is standard draft-07, with closed objects, enums, numeric bounds and conditional status/evidence constraints. Any compliant JSON Schema implementation can validate it. TypeScript's `validateAnnotationStructure` compiles **that same file** using Ajv without coercion/default insertion. Tests compare it with a separately compiled standard-schema validator.
2. **Relational document validity:** `validateAnnotation` adds identity references, uniqueness, source-count/PTS joins, boxes, partial event ordering, frame windows and independent review roles. Standard JSON Schema cannot express arbitrary array joins or cross-field arithmetic; passing layer 1 alone is **not full conformance**. Other tools must implement these normative rules too. `parseAnnotation` throws on either layer's failure.
3. **Independent media match:** `validateAgainstSourceMedia(annotation, observedSource)` also compares the hash, stream, dimensions, orientation, time base, count and entire PTS inventory supplied independently from the original media. An internally coherent but forged/rebased annotation can pass layer 2 and fail layer 3. This pure comparison does not itself hash bytes, decode video, verify consent, or prove physical observations.

Do not pass `annotation.source` as “independent” evidence for real footage. The later authorized media tooling must obtain that inventory directly from the original bytes. PR3 uses synthetic inventories only. No importer, frame-map resolver, benchmark runner, or scoring metric is implemented here.

References for implementers: [JSON Schema conditional validation](https://json-schema.org/understanding-json-schema/reference/conditionals) and [Ajv compilation/validation](https://ajv.js.org/guide/getting-started.html).

## Legacy compatibility — translation only

`src/eval/schema/legacyMapping.ts` is a pure vocabulary/provenance translator, with no live-engine imports or behavior changes:

| Source field | Evaluation result |
| --- | --- |
| `metrics.json.contact`, `phases.contact` | `impact_estimate`, method `baseline_triple_product` |
| `phases.stance` | `stance_set` |
| `phases.load` | Auxiliary `load_peak_estimate`, method `baseline_wrist_extremum`; **load_start stays not_produced** |
| `phases.stride` | `foot_plant` |
| `phases.follow_through` | `finish` |
| `phases.extension` | Auxiliary `extension` |
| Missing outputs | `not_produced`, never interpolated |
| No baseline equivalents | `contact_confirmed`, `stride_foot_lift`, `swing_launch`, `load_start` remain `not_produced` |

This follows the explicit PR3 instruction over the older plan table that mapped a wrist extremum to load_start. Original phase slug, source-field path, frame and time_s are retained as **unverified legacy provenance**. Conflicting contact aliases remain separate estimates; no source silently wins. These fields are never promoted to source PTS. A later normalizer must verify frame identities before timing comparison. No outcome or confirmed contact is synthesized, and application/database phase names stay unchanged.

## Tests and PR3 scope

Run `npm run test:eval-annotations` and `npm test`. Synthetic examples cover R/L batting, confirmed contact, miss, take, checked swing, an obscured batter among multiple people, missing bat endpoints, VFR, and ambiguous contact. Negative tests cover bad frame identities, impossible coordinates, incompatible versions, chronology, uncertainty, privacy fields and invalid review metadata. Separate tests cover legacy provenance and independent source mismatch.

Added PR3 files: this guide; `eval/schema/annotation.v1.schema.json`; ten JSON examples under `eval/schema/examples/`; `src/eval/schema/{annotation,annotation.test,legacyMapping,legacyMapping.test}.ts`.

Modified PR3 files: `package.json` (test command, evaluation-only Ajv development dependency, app patch version), `package-lock.json`, `mobile/package.json`, `mobile/package-lock.json`, `mobile/android/app/build.gradle` (version metadata only), `CHANGELOG.md`, `NEXT_STEPS.md`. Pre-existing PR1/PR2 files and QA-wrapper edits are preserved. No source footage, model, engine/prompt/report change, migration, deployment or benchmark execution is part of PR3.

### Exact synthetic example files

All under `eval/schema/examples/`:

- `right-handed-swing.json`
- `left-handed-swing.json`
- `swing-and-miss.json`
- `take.json`
- `checked-swing.json`
- `obscured-batter.json`
- `missing-bat-endpoints.json`
- `variable-frame-rate.json`
- `ambiguous-contact.json`
- `confirmed-contact-unknown-direction.json`

The unknown-direction outcome closes a gap in the original fair/foul-only vocabulary. It was added under the stated assumption that confirmed contact should not require guessing ball direction; the optional user clarification remains open to correction before adoption. The explicit load-peak mapping and allowance for a stance label on takes resolve the plan's conflicting wording as described above.

### Review reconciliation

The initial read-only Gemini/AGY review found no blocking issues. Codex verified and addressed its four non-blocking findings: inclusive attempt windows cannot share a frame; obstruction exclusivity is enforced in portable JSON Schema; TypeScript landmarks discriminate visibility by status; and unreached-zone impact labels require the correct missing-event reason. Its review-attribution question was resolved by retaining declared reviewer IDs on unresolved drafts while preserving distinct identities and forbidding a completed-review claim. Regression tests cover each change.

Local validation: `npm run test:eval-annotations` passes 82 tests; `npm run build` passes; `npm test` passes 387 test executions; `git diff --check` passes. Source-media verification uses synthetic inventories only. No rendered UI QA is applicable because PR3 changes no UI behavior.

The follow-up Gemini review completed successfully and verified all five fixes with no blocking findings. Its two cosmetic notes were reconciled: the attempt-index guard now uses explicit `i > 0`; a harmless blank line requires no functional change. Its two judgment notes remain documented above: unknown-direction confirmed contact avoids invented fair/foul claims, and retaining stance on takes follows the plan's explicit “no events after stance” rule. Neither introduces a production behavior change. Local review artifacts are `.git/gemini-review/review-20261012-065448-379a09.md` and `.git/gemini-review/review-20261012-070933-a24685.md`.
