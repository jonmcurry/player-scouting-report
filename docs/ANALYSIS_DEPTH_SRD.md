# HitterLoop Analysis Depth Expansion: Software Requirements Document

*Status: proposed implementation specification, 2026-10-10.*
*Scope: requirements and implementation backlog for analysis-depth items 1–7.*
*Relationship to the simplified app: extends `docs/SIMPLIFIED_APP_SPEC.md`; it does not replace the youth-first product, automatic report, one-fix rule, evidence threshold, or safety/privacy requirements.*

## 1. Executive summary

HitterLoop remains a youth-first baseball and softball development product:

> Film an at-bat. HitterLoop explains what is working, shows one evidence-supported focus when one
> is warranted, offers a vetted next step, and shows whether it carries into later game swings.

This expansion adds optional technical depth for qualified coaches, instructors, college programs,
and professional staff without turning the family experience into a laboratory dashboard. The same
analysis run will support three progressively disclosed views:

| View | Default audience | Purpose |
|---|---|---|
| Development summary | Youth athlete, parent, coach | Readable in under one minute; strengths, at most one fix, evidence video, vetted drill, progress |
| Coach analysis | Instructor, high-school coach, approved team staff | Phase filmstrip, comparable-swing history, variability, context, evidence provenance, annotations |
| Performance lab | College/pro staff and explicitly enabled advanced users | Validated measurements, distributions, controlled challenge sets, external sensor data, exports |

The product earns technical depth through evidence, repeatability, and transparent limitations. It
must not imitate a sensor system by producing physical-unit values from uncalibrated phone video.
Simple output is a presentation choice; it is not permission for shallow or unsupported analysis.

### 1.1 The seven capabilities

1. A softball- and baseball-aware swing fingerprint built from multiple comparable swings.
2. A phase-by-phase technical report linked to the original video.
3. Sport, hitter style, swing intent, environment, and context handling.
4. Adaptability analysis across controlled challenges and real game conditions.
5. An evidence drawer that makes every displayed claim auditable.
6. A measurement hierarchy separating video observations, estimates, and external instruments.
7. Standardized capture modes with automatic quality and comparability checks.

### 1.2 Product outcome

The completed system should credibly say:

> HitterLoop is a youth-safe, evidence-backed hitting development platform for softball and
> baseball. It grows from a simple family report into a professional analysis workspace without
> changing what the athlete is asked to do: record, understand one focus, train, and recheck.

## 2. Goals, non-goals, and release boundaries

### 2.1 Goals

- Preserve **WATCH → UNDERSTAND → FOCUS → TRAIN → RECHECK**.
- Preserve an under-one-minute, youth-appropriate default report.
- Make each observation traceable to the original video and exact evidence used.
- Compare athletes primarily with their own comparable history.
- Support both softball and baseball without treating either as a reskinned version of the other.
- Support conventional swings, slap-family attempts, bunts, and situational adjustments without
  automatically labeling style variation as a flaw.
- Allow technical depth to grow with user role, capture quality, evidence volume, and validated
  measurement availability—not merely with the athlete's age.
- Let external bat sensors, radar, and ball-flight systems enrich a report while keeping HitterLoop
  useful without them.
- Create a validation program that can remove or withhold unreliable features.

### 2.2 Non-goals

- Diagnosing injury, pain, fatigue, maturation, anatomy, or medical risk.
- Giving recruiting rankings, scholarship predictions, or a universal "college-ready" score.
- Declaring one universal ideal swing or comparing youth players with professional athletes as a
  normative target.
- Reporting mph, inches, force, power, joint angles, or other physical units from uncalibrated
  monocular video.
- Claiming causal relationships such as "this movement produced exit velocity" without a validated
  study and the necessary instrument data.
- Replacing a hitting instructor or making an AI approval queue part of normal use.
- Combining incompatible camera setups into a numeric trend.
- Expanding into pitching analysis, fielding analysis, team scoring, or lineup management.
- Restoring required pitch-by-pitch logging, pitch tracking, count entry, or outcome entry to the
  ordinary family upload flow.
- Making college/pro tools visible to families by default.

### 2.3 Release boundary

The critical family-release, consent, hosted-access, deletion, and real-footage validation gates in
`NEXT_STEPS.md` remain ahead of this expansion. Work may begin with offline schemas, pure functions,
fixtures, and prototypes, but no advanced claim may ship publicly until its capability-specific
validation gate passes.

## 3. Users, roles, and progressive disclosure

### 3.1 User roles

| Role | Default access |
|---|---|
| Athlete/guardian | Development summary, source video, current focus, drills, progress, feedback |
| Youth/team coach | Development summary; coach analysis only when enabled and trained |
| Private hitting instructor | Development summary, coach analysis, annotations, controlled-session setup |
| High-school/college staff | Coach analysis, comparison sets, team-level exports within authorized scope |
| Performance analyst | Performance lab, measurement definitions, external imports, exports, validation tools |
| Internal methodology admin | Definition/version governance; no automatic access to private athlete media |

Authorization must remain player scoped. A more advanced view never grants access to additional
players, teams, video, or identifying information.

### 3.2 Athlete profile

The athlete profile may store:

- sport: `softball` or `baseball`;
- age band, retaining the existing fail-safe behavior when unknown;
- competition level: `recreational`, `travel`, `middle_school`, `high_school`, `college`,
  `professional`, or `unknown`;
- bats and throws handedness;
- hitting styles: one or more of `conventional`, `slap`, `power_slap`, `bunt`, or `unknown`;
- coach-approved development goals;
- enabled analysis view, controlled by the owning coach/organization and user role.

Competition level changes vocabulary and available workflows. It must not weaken evidence
thresholds or imply biological development, talent, or future potential.

### 3.3 View selection rules

- The development summary remains the landing view for all users.
- Coach analysis is an explicit secondary action, not a required step.
- Performance lab is role- and organization-enabled.
- Advanced measurements appear only when their individual availability requirements pass.
- A guardian viewing a youth player never receives a dense performance dashboard by default.
- Shared links default to the development summary. Advanced sharing requires a separately scoped,
  revocable token and must exclude internal quality/debug data.
- Optional pitch/approach context is an advanced staff tool and explicit exception to the
  simplified v1 exclusion. It never becomes required family data entry or a scoring workflow.

## 4. Cross-cutting truth and safety requirements

### 4.1 Evidence hierarchy

When evidence conflicts, use this order:

1. Original video or external instrument's original export.
2. Explicit capture metadata and synchronization evidence.
3. Deterministic detections and validated derived measurements.
4. Reconstructed motion with its quality state.
5. AI interpretation.

The original video remains the source of truth for visible movement. An external device remains the
source of truth only for the fields it directly measures. Neither source silently outranks the
other outside its domain.

### 4.2 Required labels

Every technical value or observation must declare one source class:

- **Observed in video**
- **Estimated from video**
- **Calculated from comparable video**
- **Measured by `<device/provider>`**
- **Entered by coach/user**

The UI may translate these into concise labels but must not remove the distinction.

### 4.3 Uncertainty

- Store uncertainty as a machine-readable range or status, not merely explanatory prose.
- Timing derived from frames must retain source frame rate, frame index, and uncertainty in frames.
- Estimates that fail their quality threshold are unavailable, not zero.
- The family report continues to fail closed with "couldn't tell" or no finding.
- The technical view may explain why a value is unavailable.

### 4.4 Youth safeguards

- No anatomical manipulation cues, separation targets, weighted/overspeed prescription, or
  medical/injury language for young athletes.
- No public leaderboards, body comparisons, or attractiveness/talent scoring.
- No value judgment based on body size, shape, puberty, or inferred maturation.
- Coaches and guardians retain the existing ability to hide a finding that does not look right.
- Youth reports prioritize balance, timing, posture, barrel control, contact, and enjoyment.
- Dense measurements are never required to complete the core loop.

## 5. Shared concepts and definitions

### 5.1 Swing attempt

A `swing_attempt` is one located attempt within a source clip. It may be a full swing, checked
swing, slap-family attempt, bunt attempt, take, or unreadable/unknown event. A clip may contain zero
or more attempts. The existing single-located-swing path remains supported while multi-attempt
extraction is developed.

### 5.2 Phase event

A phase event is a detected or coach-corrected instant or interval. Initial controlled vocabulary:

- ready/stance;
- load start;
- peak load;
- stride start;
- front-foot plant;
- launch/rotation start;
- bat enters hitting zone;
- contact estimate;
- extension;
- finish.

Each event stores the detector/version, time, source frame, uncertainty, visibility, and optional
coach correction. UI labels may remain simpler for families.

### 5.3 Comparable swing

Swings are numerically comparable only when all required compatibility rules for a measurement are
met. At minimum:

- same athlete;
- same sport;
- compatible swing intent;
- compatible environment;
- compatible capture profile and orientation;
- adequate visibility and quality;
- compatible measurement-definition version.

Pitch context, camera distance, handedness, drill type, and sensor/device may add further rules.

### 5.4 Baseline and fingerprint

- A baseline is a versioned, explicit set of comparable swings.
- A fingerprint is the distribution of eligible observations and measurements in that baseline.
- A fingerprint is not a score, diagnosis, or ideal.
- A baseline records inclusion/exclusion reasons and never changes silently after publication.

## 6. Capability 1 — athlete swing fingerprint

### 6.1 User value

Coaches should see what is typical for an athlete, how much it varies, and whether a recent pattern
is meaningfully different. Families should see only a plain-language progress result supported by
that history.

### 6.2 Functional requirements

**FP-1. Comparable-set builder**

- Build automatic candidate sets by athlete, sport, intent, environment, capture profile, and
  measurement version.
- Allow an authorized coach to narrow a set without altering original data.
- Show why each swing was included or excluded.
- Require a minimum sample configured per metric; default proposal is five eligible swings for a
  descriptive fingerprint and ten for trend language.
- A small sample may show individual swings but not distribution or trend conclusions.

**FP-2. Initial fingerprint dimensions**

- Phase timing as percentages of the detected swing interval.
- Event ordering and transition durations.
- Normalized 2D stride displacement when the feet and scale reference are visible.
- Normalized 2D head/torso displacement.
- Contact position relative to visible body landmarks.
- Bat/hand path shape descriptors that pass repeatability validation.
- Finish/balance categorical observations.
- Per-concept observation frequency using only report-eligible findings.

Absolute physical distance, bat speed, joint torque, and force are excluded unless supplied by a
calibrated or external measurement source.

**FP-3. Statistics**

- Store/display median, interquartile range, eligible sample count, excluded count, and date range.
- Avoid red/green grading based solely on distance from the athlete's median.
- Identify outliers descriptively and let the coach inspect them.
- Compute trends only across compatible baseline versions and with sufficient sample size.
- Preserve game and practice as distinct series; allow a visual juxtaposition without claiming
  that different camera setups are metrically interchangeable.

**FP-4. Family presentation**

- Translate the fingerprint into the existing progress states only when the focus rules are met.
- Do not expose raw distributions by default.
- Use phrases such as "showing up more consistently" only when the deterministic rule and minimum
  sample pass.

### 6.3 Acceptance criteria

- Two incompatible camera profiles cannot enter the same numeric fingerprint unless the specific
  metric definition explicitly permits it.
- Reprocessing with a new measurement version creates a new fingerprint version.
- Deleting a clip removes it from future computation while preserving required audit facts without
  retaining deleted media.
- Every aggregate can list its contributing swing IDs and exclusion reasons.
- Empty, one-swing, and insufficient-sample states never display a trend.
- Softball and baseball swings never share a fingerprint.

## 7. Capability 2 — phase-by-phase technical report

### 7.1 Information architecture

The coach analysis opens from the existing report and contains:

1. original video with phase markers;
2. horizontal phase filmstrip;
3. phase sections;
4. comparable-history summary;
5. coach annotations;
6. evidence drawer;
7. measurement/methodology links.

It must use the existing `DESIGN.md` tokens, mobile-first layout, black media wells, bordered slate
cards, clay selected states, 48px touch targets, and native disclosure patterns. It must not invent
a competing visual language.

### 7.2 Functional requirements

**PR-1. Video and phase navigation**

- Selecting a phase seeks the original video to its event time.
- The phase marker shows uncertainty when greater than the display threshold.
- Missing phases appear as unavailable rather than being interpolated for display.
- Coach-corrected events show who corrected them and retain the original detector output.
- Source and corrected markers can be compared by authorized reviewers.

**PR-2. Phase cards**

Each phase card may show:

- original full frame and optional batter crop;
- what was directly observed;
- eligible measurement values;
- comparison with the athlete's compatible baseline;
- why it may matter, using approved methodology text;
- linked current focus when applicable;
- coach annotation;
- evidence and definition disclosures.

Generated prose must not turn correlation or stylistic difference into causation or defect.

**PR-3. Initial phase content**

| Phase | Eligible initial evidence |
|---|---|
| Ready/stance | visibility, orientation, balance/posture observation, known intent |
| Load | load event, visible rearward/vertical movement descriptors, hand/head stability |
| Stride/plant | plant event, normalized stride proxy, balance, readiness to rotate |
| Acceleration | event order, torso/pelvis timing proxy, hand/bat path proxy |
| Contact | contact estimate, body-relative location, head/front-side visibility |
| Extension | visible continuation/path, not a prescribed reach position |
| Finish | balance, completion, recovery, context-dependent adjustment |

**PR-4. Coach annotations**

- Coaches may add text, voice, and simple line/angle overlays to the original frame/video.
- An annotation is always labeled as coach-authored and never becomes an AI fact automatically.
- For a minor athlete, annotations default to guardian-visible. For an adult athlete, they default
  to athlete-visible. Staff-private annotations are deferred until an organization policy,
  retention rule, consent wording, and access tests are explicitly approved.
- Annotation deletion follows audit and access rules.

**PR-5. Comparison**

- Support phase-synchronized side-by-side playback.
- Support manual correction of sync points without rewriting detector output.
- Support overlay only for compatible orientations and crop transforms.
- Label practice/game and capture profile prominently.
- Do not display numeric deltas for measurements that fail compatibility.

### 7.3 Acceptance criteria

- Every phase card links back to the original video instant.
- A user can distinguish original imagery, crop, overlay, reconstruction, AI prose, and coach note.
- The report remains usable with no reconstruction and no physical-unit metrics.
- Family-summary behavior and one-fix limit are unchanged.
- Screen-reader labels name phase, evidence source, availability, and control purpose.

## 8. Capability 3 — sport, style, intent, and context

### 8.1 Context dimensions

**Sport**

- softball;
- baseball.

**Environment**

- tee;
- front toss;
- side toss;
- pitching machine;
- live practice;
- game;
- unknown.

**Attempt intent**

- conventional full swing;
- slap;
- power slap;
- bunt;
- drag bunt;
- checked/protective swing;
- take;
- unknown.

**Optional pitch/approach context**

- pitch type, speed, and location only when entered or instrument-measured;
- count and approach when entered;
- intended field direction when entered before review or by the coach;
- outcome as its broad known label, never as proof of contact quality.

This is an advanced coach/performance exception, not a return to the legacy pitch-entry workflow.
It is optional, hidden from the ordinary family capture path, and scoped to explaining or grouping
already recorded swings. HitterLoop does not become a pitch-tracking, scoring, or count-management
product.

### 8.2 Functional requirements

**SC-1. Context capture**

- Sport comes from the player/team and is confirmed when ambiguous.
- Environment and intent may be predicted but remain `unknown` below threshold.
- Coach correction is supported and versioned.
- The uploader is not required to complete context fields for the family flow.
- Only an authorized coach/performance user may add pitch/approach context after an ordinary family
  upload; family users may view allowlisted context but are never prompted to log it.
- Controlled-session workflows may require context to make the attempt eligible for a challenge
  set.

**SC-2. Analysis routing**

- Use sport- and intent-specific applicability rules in the methodology pack.
- A conventional-swing finding cannot automatically apply to slap or bunt attempts.
- Unknown intent uses only observations valid across intents.
- Game swing adjustments are not persistent flaws unless supported across comparable swings.
- Softball and baseball may share a concept only when the methodology record explicitly supports
  both.

**SC-3. Vocabulary**

- Families receive plain terms.
- Coaches may opt into technical terms with definitions.
- Sport-specific language is required; avoid baseball-only language in softball reports and vice
  versa.
- No age or level is described as deficient relative to older players.

### 8.3 Acceptance criteria

- A slap-family attempt cannot receive a conventional-only finding or drill.
- Unknown pitch location cannot produce a location-specific claim.
- Correcting intent triggers deterministic re-evaluation and records the prior classification.
- Context is included in evidence provenance and comparison compatibility.
- Reports continue to work when all optional context is unknown.

## 9. Capability 4 — adaptability and controlled challenges

### 9.1 Purpose

Higher-level analysis should measure whether the athlete can preserve useful movement or make an
appropriate adjustment across changing tasks. It must not reward one visually uniform swing in
every context.

### 9.2 Challenge-set model

An authorized coach creates a versioned protocol from approved templates. Initial templates:

- middle-location baseline;
- high/low location pair;
- inside/outside location pair;
- faster/slower speed pair;
- same-task repeatability set;
- randomized mixed sequence.

Templates define required environment, minimum attempts, acceptable capture profiles, required
external measurements, safety notes, and supported conclusions.

### 9.3 Functional requirements

**AD-1. Protocol execution**

- Show the coach the order, required repetitions, and capture setup.
- Record actual context and missing/failed attempts.
- Do not infer a completed challenge from an ordinary collection of unlabeled clips.
- Permit incomplete sessions without manufacturing a score.

**AD-2. Adaptability outputs**

Initial eligible outputs:

- phase timing stability;
- contact-location adjustment in body-relative or image-normalized terms;
- movement variability by task;
- swing/take or attempt-type result when known;
- external bat/ball metrics by task;
- coach observations.

Outputs must separate "changed" from "improved." A change is not an improvement without a defined,
supported performance criterion.

**AD-3. Game transfer**

- Controlled practice and game attempts remain separate data series.
- A game-transfer statement requires repeated readable game evidence.
- Different camera profiles may support visual evidence without numeric deltas.
- The family progress card remains capped at one active focus.

### 9.4 Acceptance criteria

- No adaptability result appears without a completed protocol and minimum eligible attempts.
- An incomplete protocol shows what is missing.
- Challenge results name the task, sample count, capture source, and measurement source.
- The system never converts exit velocity or a batted-ball result into a mechanical conclusion by
  itself.
- Youth protocols contain no unsafe or age-inappropriate equipment prescription.

## 10. Capability 5 — evidence drawer and auditability

### 10.1 Evidence drawer contents

Every displayed strength, fix, trend, or technical observation must be expandable to show, as
applicable:

- original clip and source frame/time range;
- full frame plus any crop used by analysis;
- phase detector output and uncertainty;
- capture profile and quality checks;
- observation/measurement definition and version;
- source class;
- analysis model/pipeline/prompt version;
- comparable swings and exclusion reasons;
- confidence/display-threshold result;
- external device/provider and import record;
- coach corrections or annotations;
- known limitation in plain language.

Internal diagnostics, storage paths, provider secrets, prompts, and another athlete's data must not
enter client or shared-link payloads.

### 10.2 Functional requirements

**ED-1. Evidence package**

- Create an immutable evidence-package identifier per analysis result.
- Store references and hashes needed to reproduce the result without duplicating private video.
- Re-analysis creates a new package; it does not mutate the previous result.
- A displayed result references exactly one evidence package and definition version.

**ED-2. Inclusion/exclusion ledger**

- Aggregates list included swing IDs.
- Excluded swings store a controlled reason such as incompatible capture, hidden body part,
  detector uncertainty, deleted media, intent mismatch, environment mismatch, or definition
  version mismatch.
- User-facing text translates controlled reasons without exposing internal IDs.

**ED-3. Corrections and feedback**

- Preserve "Doesn't look right."
- Add coach correction for phase, intent, environment, and context.
- A correction never rewrites original model output.
- Recalculation is explicit, versioned, and deterministic.
- Feedback data is restricted to authorized quality improvement; it is not public training data by
  default.

### 10.3 Acceptance criteria

- A reviewer can navigate from a report sentence to its original video evidence in two actions or
  fewer.
- Reprocessing leaves the prior evidence package auditable while only the selected current run is
  presented by default.
- Shared evidence contains no team name, internal identifier, private annotation, or unauthorized
  advanced measurement.
- Deleted video becomes unplayable immediately and follows the existing audited deletion path.
- An observation lacking its required evidence package is ineligible for display.

## 11. Capability 6 — measurement hierarchy and external instruments

### 11.1 Measurement classes

| Class | Examples | Display rule |
|---|---|---|
| Video observation | foot visibly planted, balanced finish | Plain observation with frame evidence |
| Video estimate | event time, body-relative contact location | Must show estimate label, definition, uncertainty, quality |
| Comparable-video calculation | median phase timing, variability | Requires compatible set and minimum sample |
| External instrument | bat speed, exit velocity, launch angle | Provider/device label, original units, import provenance |
| Coach-entered | intended field, pitch type, session goal | Coach-entered label; never converted to measured fact |

### 11.2 Measurement-definition registry

Every measurement definition must include:

- stable slug and semantic version;
- display name and plain-language definition;
- source class;
- sport and intent applicability;
- required capture profiles, landmarks, phases, and minimum quality;
- unit or unitless normalization;
- compatibility rules;
- minimum sample for aggregate/trend;
- uncertainty method;
- validation status: `experimental`, `validated_internal`, `validated_external`, or `retired`;
- family, coach, and performance-lab visibility;
- citations/methodology references;
- known limitations and prohibited interpretations.

Only `validated_internal` or `validated_external` definitions may appear outside an explicitly
labeled internal evaluation environment. Validation status is human-governed.

### 11.3 External import requirements

**MH-1. Provider-neutral envelope**

Define a canonical import containing:

- provider/device/model/firmware when available;
- source file hash and import time;
- athlete/session/attempt linkage;
- device timestamp and synchronization evidence;
- original field name, value, unit, and provider definition version;
- normalized canonical field when a reviewed mapping exists;
- import warnings and unmapped fields;
- consent/data-ownership record.

**MH-2. Initial integrations**

Implement CSV/JSON file imports before private undocumented APIs. Prioritize based on real partner
demand rather than brand prestige. Candidate categories:

- bat sensor;
- radar;
- ball-flight/launch monitor;
- facility system export.

**MH-3. Synchronization**

- Link manually by session/attempt as the safe fallback.
- Automatic sync requires timestamp, audio/contact event, or another validated shared marker.
- Surface sync confidence and allow coach correction.
- Never attach a measurement to a swing when more than one candidate remains plausible.

### 11.4 Acceptance criteria

- The same field cannot silently change definition across provider or firmware versions.
- Original imported values remain available for audit; normalized values retain their mapping
  version.
- Units are stored explicitly and never inferred from the number alone.
- Removing an integration does not make historical reports uninterpretable.
- HitterLoop works end to end with no external device connected.
- Uncalibrated video never produces a sensor-labeled metric.

## 12. Capability 7 — standardized capture modes

### 12.1 Capture profiles

**Game/backstop**

- Purpose: automatic batter/swing selection, broad phase evidence, game-transfer history.
- Required: whole hitter, plate area, bat arc room, stable view, before pitch through finish.
- Limitations: lower-body occlusion, fence, catcher/umpire, unknown camera geometry; fine bat-plane
  and physical-unit measurements generally unavailable.

**Open-side practice**

- Purpose: load, stride, plant, body-relative contact, phase timing, side-view comparison.
- Required: full body/bat, camera approximately perpendicular, fixed mount, known orientation.
- Limitations: not numerically comparable with backstop game footage by default.

**Catcher view practice**

- Purpose: barrel/hand path proxy, plate coverage, lateral movement.
- Required: protected camera placement, fixed centerline, full bat arc.
- Safety: only from a protected position; no person or unsecured phone behind the plate in a live
  unprotected path.

**Multi-angle controlled session**

- Purpose: research/performance analysis and cross-view event confirmation.
- Required: two or more supported profiles, fixed cameras, synchronization marker, same attempt.
- Limitations: remains an estimate unless calibration requirements for a measurement are met.

**Unknown/imported**

- Purpose: preserve ordinary uploads.
- Behavior: run general quality/readability analysis; enable only measurements whose requirements
  pass independently.

### 12.2 Functional requirements

**CP-1. Guided capture**

- Display sport- and mode-specific framing illustrations using existing design conventions.
- Provide an on-screen silhouette/plate guide without asserting that alignment is calibrated.
- Recommend frame rate, exposure/shutter behavior, orientation, distance, lighting, and mount.
- Require minimal taps and retain offline recording/upload behavior.
- Let users skip guidance and upload an existing clip.

**CP-2. Automated quality checks**

Check and store:

- resolution and actual frame rate;
- orientation and rotation metadata;
- duration;
- motion blur proxy;
- lighting/exposure proxy;
- camera motion/stability;
- whole-body and bat visibility by phase;
- primary-athlete ambiguity;
- catcher/umpire/fence occlusion;
- whether the declared capture profile appears plausible.

Each measurement definition consumes the relevant checks. There is no single quality score that
unlocks everything.

**CP-3. Capture identity and comparability**

- Store declared and inferred profile separately.
- Store camera/device metadata that does not expose unnecessary personal identifiers.
- Create a reusable setup fingerprint from non-identifying geometry/metadata when possible.
- Ask for confirmation when a clip would enter an existing numeric comparison but its setup is
  uncertain.
- A coach may correct a profile; the original inference remains auditable.

**CP-4. Calibration**

- Calibration is measurement specific, never a generic "calibrated" boolean.
- Approved calibration may use known field geometry, a marker, camera intrinsics, or multi-view
  reconstruction only after validation.
- Store calibration method, inputs, fit error, version, and supported measurement definitions.
- A failed or stale calibration disables dependent measurements.

### 12.3 Acceptance criteria

- Existing GameChanger/camera-roll uploads remain supported.
- The app explains one or two actionable capture corrections, not a wall of technical errors.
- A family can complete a normal upload without calibration.
- A coach can see which measurements a capture supports before starting a controlled session.
- Capture mode never weakens video privacy, consent, retention, or deletion rules.

## 13. Data model proposal

All changes use additive migrations and preserve `public`/`demo` parity or explicitly tested demo
exclusion. Names below are proposed; implementation may refine them without weakening semantics.

| Table/entity | Purpose |
|---|---|
| `swing_attempts` | Multiple attempts per clip; type/intent/environment classification and correction history |
| `swing_phase_events` | Versioned phase events, uncertainty, visibility, detector and coach correction |
| `capture_profiles` | Governed profile definitions and measurement compatibility |
| `clip_capture_assessments` | Declared/inferred profile, media facts, per-check quality results |
| `measurement_definitions` | Versioned registry described in §11.2 |
| `swing_measurements` | Per-attempt value, source class, uncertainty, definition/version, evidence package |
| `analysis_evidence_packages` | Immutable run/pipeline/capture/source manifest |
| `analysis_evidence_items` | Frames, time ranges, source references/hashes, visibility and inclusion role |
| `comparison_sets` | Versioned baseline/challenge membership and compatibility state |
| `comparison_set_members` | Included/excluded attempts with controlled reason |
| `challenge_protocols` | Governed protocol templates and safety/applicability |
| `challenge_sessions` | Athlete execution of a protocol and completion state |
| `external_measurement_imports` | Provider/device/source-file provenance and consent |
| `external_measurements` | Original values plus reviewed canonical mappings |
| `coach_annotations` | Authored text/voice/overlay references and visibility |

### 13.1 Required constraints

- Every child entity must be provably scoped to its player/team through foreign keys and RLS or a
  narrow security-definer boundary.
- A measurement references an immutable definition version.
- External values retain original unit and field name.
- Corrections append; they do not overwrite original machine results.
- Evidence references never expose raw storage paths to clients.
- Deleted clips cannot be reconstructed from retained evidence metadata.
- Shared-link response shapes are explicit allowlists.

### 13.2 API/read model

Keep the development summary endpoint small. Add separate authorized reads:

- `get-coach-analysis`: phase report, evidence summaries, comparable history, annotations;
- `get-performance-analysis`: validated measurements, distributions, challenge sets, external data;
- `get-analysis-evidence`: one allowlisted evidence package scoped to one displayed result;
- mutation boundaries for context correction, phase correction, comparison-set curation, and coach
  annotations.

Do not add the advanced payload to every family report response.

### 13.3 Legacy clip-to-attempt transition

`video_clips` is the current source record and most report, issue, phase, metric, deletion, demo, and
share paths reference it directly. Introducing `swing_attempts` must be a staged compatibility
migration, not an immediate ownership rewrite:

1. Add `swing_attempts` without changing existing reads. Create at most one canonical attempt for a
   legacy clip only when the stored detection state supports it; do not fabricate an attempt for an
   unknown/no-swing clip.
2. Add nullable `swing_attempt_id` references to new attempt-scoped entities. Keep existing
   `video_clip_id` foreign keys authoritative during dual-read migration.
3. Provide one tested resolver that maps a legacy single-attempt clip to its canonical attempt.
   No client or service may implement its own fallback rule.
4. Dual-write only through one server-side boundary, with idempotency and uniqueness preventing two
   canonical attempts for the same legacy located swing.
5. Move reads capability by capability behind a feature flag and compare legacy/new response
   shapes on fixtures before cutover.
6. Update deletion, RLS, demo clone/export, share allowlists, and reprocessing before allowing more
   than one attempt per clip.
7. Remove a legacy read only after production-equivalent verification proves that reports, focus,
   progress, media access, and audit history remain unchanged for existing clips.

During transition, a report must never count both the clip and its canonical attempt as separate
swings. The migration plan must include rollback without discarding newly derived attempt data.

## 14. Pipeline and processing requirements

### 14.1 Processing stages

1. Media validation and capture assessment.
2. Athlete selection and attempt detection.
3. Phase event detection with uncertainty.
4. Observation and measurement eligibility evaluation.
5. Measurement calculation through the versioned registry.
6. AI analysis using only eligible supplied evidence.
7. Evidence-package creation.
8. Report assembly and current-focus update.
9. Fingerprint/comparison recalculation for affected compatible sets.

A failure in advanced stages must not discard a valid family report. Advanced analysis can be
`pending`, `unavailable`, or `failed` independently.

### 14.2 Determinism and versioning

- Persist pipeline, detector, measurement, methodology, prompt, and model versions.
- Given the same stored inputs and versions, deterministic stages must reproduce the same output.
- AI prose is not used as the source for numeric aggregates.
- Reprocessing never changes a previously published run in place.
- A definition retirement removes future display eligibility but preserves historical explanation.

## 15. UX requirements

### 15.1 Development summary

No structural regression from the simplified specification:

- what worked;
- at most one fix for a readable at-bat;
- video evidence;
- up to three vetted, age/sport-safe drills;
- "Doesn't look right";
- current focus and progress.

Add only a secondary **Coach analysis** action when the role and report support it.

### 15.2 Coach analysis

- Mobile-first and usable on a phone at the field.
- Phase tabs/filmstrip may scroll horizontally.
- Details use native disclosures.
- Evidence-source labels use text and icon, not color alone.
- Unavailable data explains why and what capture would be needed next time.
- Comparison controls prevent incompatible selection before rendering a misleading result.

### 15.3 Performance lab

- Responsive wide layout may use the existing 980px coach maximum.
- Tables/charts always include sample count, date range, definition version, and source.
- Default charts show distributions and individual attempts, not smoothed certainty.
- Export is explicit, permission checked, audited, and limited to the selected players/fields.
- No team leaderboard is included in the first implementation.

## 16. Validation and evidence program

### 16.1 Dataset design

Before external release, build consented, access-controlled validation sets spanning:

- softball and baseball;
- youth, middle school, high school, college, and—when legitimately available—professional;
- left- and right-handed hitters;
- conventional, slap-family, bunt, check/protect, take, and no-swing examples;
- tee, toss, machine, live practice, and game;
- supported capture profiles and common failure conditions;
- diverse body sizes, uniforms, skin tones, lighting, fences, catchers, and umpires.

Professional data is not required to validate the youth-first family release. A capability cannot be
marketed for a population absent from its validation set.

### 16.2 Labels and review

- Use at least two qualified independent reviewers for phase and observation labels.
- Resolve disagreements through a recorded adjudication process.
- Measure inter-rater agreement before treating human labels as ground truth.
- Keep coaches blind to model output during first-pass labeling.
- Separate development/test sets by athlete to prevent identity leakage.

### 16.3 Required metrics

- correct-athlete selection;
- attempt type and swing/take precision/recall;
- phase-event absolute error in frames and milliseconds;
- contact estimate error;
- per-capture-profile readability;
- observation precision and false-positive rate;
- within-session and between-session repeatability for every displayed measurement;
- calibration error where applicable;
- external-import linkage/synchronization accuracy;
- disparities across sport, age band, handedness, skin tone, uniform, and capture condition;
- coach agreement and whether the report changed a training decision.

### 16.4 Release gate per measurement

A measurement may move from experimental to validated only when:

- its definition, applicability, and prohibited interpretations are documented;
- test data covers the marketed population and supported capture profile;
- repeatability and error thresholds are predeclared and passed;
- subgroup results show no unresolved material reliability gap;
- failure/unavailable behavior passes;
- an independent methodology reviewer approves publication;
- user-facing wording accurately reflects what was validated.

Threshold values must be set from the validation protocol, not invented in this SRD.

## 17. Testing requirements

### 17.1 Unit

- comparability rules and controlled exclusion reasons;
- minimum-sample and trend rules;
- phase-event uncertainty propagation;
- measurement availability by capture/visibility/validation status;
- sport/intent applicability;
- challenge completion and missing-attempt states;
- external unit normalization and version mapping;
- evidence-package completeness;
- view/role field allowlists;
- youth language and equipment safety gates.

### 17.2 Integration/database

- coach, guardian, unrelated user, revoked guardian, and scoped-share access for every new table and
  read boundary;
- no roster or other-player inference through comparison IDs, charts, errors, or exports;
- demo parity/exclusion;
- clip deletion removes advanced reads and external linkage while preserving safe audit facts;
- correction history is append-only;
- old reports load after additive migrations;
- concurrent reprocessing cannot select mixed definition versions;
- export contains exactly the authorized selected fields.

### 17.3 Pipeline

- multiple/no-attempt clips;
- wrong-batter and occlusion cases;
- variable and reported frame rates;
- rotated and metadata-stripped videos;
- every capture profile;
- incompatible-comparison rejection;
- advanced-stage failure with successful family report;
- deterministic rerun for non-AI stages;
- stale calibration and retired definition behavior.

### 17.4 UI and accessibility

- development summary remains under-one-minute and unchanged in default complexity;
- keyboard, screen reader, focus management, reduced motion, contrast, and 48px touch targets;
- narrow phone and wide staff layouts;
- missing/unavailable/insufficient states;
- provenance distinguishable without color;
- phase seek and synchronized playback accuracy;
- shared links omit unauthorized advanced data.

### 17.5 Rendered QA

Every user-visible phase must include real rendered mobile and wide-screen QA against `DESIGN.md`.
If browser automation is unavailable, the release record must state **MANUAL VISUAL QA REQUIRED**.

## 18. Observability and product success

Collect privacy-minimized operational events:

- capture profile selected/inferred/corrected;
- quality failure category;
- coach-analysis/performance-lab opened;
- evidence drawer opened;
- context/phase corrected;
- finding hidden;
- comparison created/rejected as incompatible;
- challenge started/completed;
- external import success/warning/failure;
- coach annotation shared;
- processing time by stage.

Success is not more screen time. Measure:

- fewer unsupported findings;
- higher agreement on displayed findings;
- more readable clips after capture guidance;
- coaches using evidence to choose a next training step;
- families continuing the record → train → recheck loop;
- advanced users returning to longitudinal comparison rather than only single-swing novelty;
- no increase in cross-player privacy or youth-safety incidents.

## 19. Implementation plan and to-do

The order below deliberately builds trust infrastructure before advanced presentation.

### Phase 0 — product and methodology decisions

- [ ] Confirm that the development summary remains the default for every competition level.
- [ ] Approve the three-view permissions and sharing model.
- [ ] Recruit softball and baseball methodology reviewers across youth and advanced competition.
- [ ] Define the initial sport/intent applicability matrix.
- [ ] Define controlled environments, attempt intents, phase events, and exclusion reasons.
- [ ] Select the first two or three video estimates to validate; do not implement a broad metric
  catalog first.
- [ ] Write validation protocols and predeclare pass/fail thresholds.
- [ ] Approve consent language for advanced analysis, external imports, and research/validation use.

**Exit:** terminology, governance, and validation plan have named human owners; no measurement is
described as validated yet.

### Phase 1 — evidence and versioning foundation

- [ ] Add measurement-definition registry types and validation-status governance.
- [ ] Add immutable evidence-package and evidence-item models.
- [ ] Persist detector, pipeline, measurement, methodology, prompt, and model versions.
- [ ] Add controlled inclusion/exclusion reasons.
- [ ] Implement provenance labels and response allowlists.
- [ ] Extend deletion and access tests to the new evidence entities.
- [ ] Add methodology-admin support for definitions without granting media access.
- [ ] Create fixtures for video-observed, video-estimated, aggregate, external, and coach-entered
  evidence.

**Exit:** no technical result can exist without a definition, source class, version, and evidence
package.

### Phase 2 — capture profiles and quality

- [ ] Add governed capture-profile definitions.
- [ ] Add clip capture assessments with declared and inferred profiles.
- [ ] Implement media facts: resolution, frame rate, orientation, duration, and camera motion.
- [ ] Implement per-phase body/bat visibility and athlete ambiguity checks.
- [ ] Implement conservative blur, exposure, fence/catcher/umpire occlusion indicators.
- [ ] Update capture guidance for game/backstop and open-side practice first.
- [ ] Add catcher-view safety language before enabling that mode.
- [ ] Add multi-angle and calibration only after the first two profiles validate.
- [ ] Feed per-measurement availability from quality checks; do not create a universal unlock score.
- [ ] Render and visually verify every capture state.

**Exit:** the system can state which evidence a clip supports and why, without blocking ordinary
family uploads.

### Phase 3 — attempt, context, and phase model

- [ ] Add `swing_attempts` while preserving the existing single-attempt path.
- [ ] Implement the §13.3 canonical legacy resolver, idempotent backfill, and duplicate-count guard.
- [ ] Add feature-flagged dual-read parity tests before moving any report/focus consumer.
- [ ] Add versioned phase events and uncertainty.
- [ ] Add sport, environment, intent, and optional approach context.
- [ ] Add conservative classifiers for environment and attempt intent.
- [ ] Add coach corrections with append-only history.
- [ ] Add softball slap, power-slap, bunt, drag-bunt, take, and protective-swing evaluation cases.
- [ ] Add baseball/softball-specific methodology routing.
- [ ] Prove unknown context fails closed.
- [ ] Reprocess fixtures and confirm the family report does not regress.

**Exit:** analysis knows what kind of attempt it is evaluating, or explicitly knows that it does not
know.

### Phase 4 — coach phase report and evidence drawer

- [ ] Add separate coach-analysis read boundary.
- [ ] Build original-video phase navigation and filmstrip.
- [ ] Build phase cards using existing HitterLoop components/tokens.
- [ ] Add evidence drawer with source, definition, uncertainty, versions, and limitations.
- [ ] Add phase-synchronized side-by-side playback.
- [ ] Prevent incompatible numeric comparisons in the selector.
- [ ] Add coach text annotations; defer voice/overlay until the text model and permissions pass.
- [ ] Add staff-only/guardian-visible annotation controls.
- [ ] Keep the summary landing view and one-fix behavior unchanged.
- [ ] Complete rendered mobile and wide-screen QA.

**Exit:** an authorized coach can audit every technical statement against original evidence without
making the family workflow more complex.

### Phase 5 — fingerprint and longitudinal analysis

- [ ] Implement automatic comparable-set candidates and compatibility rules.
- [ ] Implement versioned baselines and membership/exclusion ledger.
- [ ] Implement median, interquartile range, counts, and date range.
- [ ] Implement minimum-sample and no-trend behavior.
- [ ] Add individual-attempt and distribution views.
- [ ] Keep game and practice series separate.
- [ ] Connect eligible aggregate evidence to the existing deterministic focus states.
- [ ] Add deletion/reprocessing/concurrency regression tests.
- [ ] Validate the first selected estimates across supported populations and capture profiles.
- [ ] Ship only definitions that pass their release gates.

**Exit:** HitterLoop can describe an athlete's typical, variable, and changing movement without a
universal swing score or incompatible-camera math.

### Phase 6 — adaptability protocols

- [ ] Govern initial protocol templates and safety notes.
- [ ] Build coach session setup and repetition tracking.
- [ ] Require actual context rather than infer protocol completion.
- [ ] Implement same-task repeatability before high/low, inside/outside, and speed-change sets.
- [ ] Separate "changed" from "improved" in logic and wording.
- [ ] Add incomplete/insufficient states.
- [ ] Add game-transfer visual evidence without cross-camera numeric claims.
- [ ] Validate each supported protocol with qualified coaches.

**Exit:** advanced programs can evaluate repeatability and task adjustment without turning an
ordinary at-bat collection into a fabricated experiment.

### Phase 7 — external instruments and performance lab

- [ ] Define the provider-neutral import envelope.
- [ ] Select the first integration from an actual pilot partner's data.
- [ ] Implement file hash, original fields/units, mappings, warnings, and consent provenance.
- [ ] Implement safe manual attempt linkage.
- [ ] Add automatic synchronization only after linkage accuracy validates.
- [ ] Add the separate performance-analysis read boundary.
- [ ] Build measurement/distribution UI with sample, source, date, and version always visible.
- [ ] Add permission-checked, audited export.
- [ ] Validate historical interpretation across mapping/provider version changes.
- [ ] Keep the complete product usable without external hardware.

**Exit:** college/pro staff can combine trustworthy video evidence with instrument data without
confusing one source for the other.

### Phase 8 — population expansion and launch claims

- [ ] Complete validation for each marketed sport, competition level, intent, and capture profile.
- [ ] Audit subgroup reliability and address material gaps.
- [ ] Obtain independent methodology review.
- [ ] Publish in-app methodology and limitations.
- [ ] Train pilot coaches and document intended use.
- [ ] Run youth, high-school, college, and available professional pilots separately.
- [ ] Approve exact marketing claims from completed evidence.
- [ ] Complete privacy, consent, security, accessibility, and release review.

**Exit:** HitterLoop markets only the populations and measurements actually validated.

## 20. Risks and mitigations

| Risk | Mitigation |
|---|---|
| Dense analysis overwhelms families | Summary remains default; advanced reads are separate and role gated |
| False precision from phone video | Measurement registry, capture requirements, uncertainty, unavailable states |
| Baseball assumptions leak into softball | Sport applicability matrix and independent softball review |
| Conventional swing model penalizes slappers/bunters | Attempt intent routing and unknown-intent fail-closed rules |
| Youth product becomes a recruiting/ranking product | No universal score, leaderboard, body comparison, or projection |
| Comparisons mix incompatible setups | Per-definition compatibility rules and selector enforcement |
| AI prose outruns evidence | Immutable evidence packages and deterministic semantic validation |
| External provider fields drift | Original values, mappings, units, provider/firmware/version provenance |
| Advanced payload expands privacy exposure | Separate endpoints, allowlists, player scoping, RLS/integration tests |
| Development scope overtakes release readiness | Existing critical family release gates remain first |

## 21. Open decisions

1. Which two or three video estimates should enter the first validation study?
2. Which coach/instructor roles may enable Coach analysis for a youth athlete?
3. What organization policy, consent, retention, and athlete/guardian access rules would be required
   before staff-private annotations can be considered after the initial release?
4. Which capture profile should be the first practice standard: open side only, or open side plus
   catcher view?
5. What constitutes a reusable setup fingerprint without collecting unnecessary device data?
6. Which real pilot partner determines the first external import format?
7. Should an organization be able to rename technical terms while retaining canonical definitions?
8. What data-retention period applies to evidence metadata after a video is deleted?
9. Which exports are necessary for college/pro pilots, and which create unacceptable privacy or
   re-identification risk?
10. What minimum sample and validation thresholds should be predeclared for each proposed measure?

No open decision permits invented metrics, relaxed youth safety, unauthorized sharing, or deviation
from the original video as the source of truth.
