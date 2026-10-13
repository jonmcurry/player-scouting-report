# PR8 evidence assessment — recovered canonical rules

This is isolated infrastructure. No worker, report, notification, focus, database,
running flag, model, prompt text or computer-vision algorithm is changed.

## Exact specification provenance

The recovered original (Revision 1, dated 2026-10-11) is
[`../architecture/archive/HITTERLOOP_V2_IMPLEMENTATION_PLAN.md`](../architecture/archive/HITTERLOOP_V2_IMPLEMENTATION_PLAN.md),
S0-04, lines 221–297: `ClipEvidenceSignals`, the eight predicates, reason enum,
family mappings and acceptance tests. SHA-256 of the source bytes:
`eef8a323c182cc744313eceb96019dc35d5c655f69767dcb80d56150a7eafe73`.
Revision 2 is [`../architecture/HITTERLOOP_V2_IMPLEMENTATION_PLAN.md`](../architecture/HITTERLOOP_V2_IMPLEMENTATION_PLAN.md),
§3.1–3.3 and S0-07; SHA-256:
`aa225767dcf75e1360f7b32aa89abe906299e1cd747f1f32444a8b0e84fea741`.
Neither source is edited by this implementation.

`strictBaseline.ts` implements `strict-0.1.0`. For well-formed consulted inputs,
the original withhold predicates are exactly:

| Rule | Withhold predicate | Family |
|---|---|---|
| G1 | `usedFallback === true` | batter_unclear |
| G2 | `batEvidenceFrames < Math.max(5, 0.02 * trackFrames)` | batter_unclear |
| G3 | `contact.frame == null` | swing_unclear |
| G4 | `contact.confidence !== "high"` | swing_unclear |
| G5 | window null or `batterTrackedFraction < 0.9` | swing_unclear |
| G6 | `identityJumpFraction > 0.05` | batter_unclear |
| G7 | zooms lacks exact `zoom_contact` | batter_unclear |
| G8 | engine not exactly `baseline-1.0.0` | unspecified in source |

Equality passes G2/G5/G6. Null window produces G5's `swing_window_unavailable`,
not an invented G6 observation. Null top-level input withholds with that same
reason. Malformed consulted signals additionally set `invalidSignals` and
`evaluated: false`; unconsulted metadata adds no gates. All reasons and failed
rules are ordered G1 through G8. Inputs are retained verbatim for audit.

The exact spatial rule comes from `src/services/pose3d/subjectBox.ts`:
`MAX_JUMP = 1.0`; reject only when
`Math.hypot(cx - anchor.cx, cy - anchor.cy) > MAX_JUMP * anchor.h`.
The anchor height is used. Body centre averages at least 8 keypoints with
confidence ≥0.3; height is their max Y minus min Y. The requested usable anchor
is preferred, otherwise the first usable frame in the inclusive window.
`subjectPolicy.ts` records these constants and exposes a pure comparison helper;
tests check drift against the original source and exercise the existing crop rule.
The crop implementation and instrumentation remain unchanged.

## Specification discrepancies and explicit conventions

- Revision 1 omits a G2-specific code from its reason enum. We use Revision 2's
  `insufficient_bat_holding_evidence`; this fills an enum gap, not a predicate change.
- Revision 1 maps no family for G8. We retain null and expose `unmappedFamilyRules`;
  we do not invent a family mapping.
- Revision 1 requires stable ordering but specifies no combined-family precedence.
  Reasons follow G1–G8; `familyReasons` retains distinct mapped families in that
  order, and the singular `familyReason` is the first. This is an explicit local
  convention, not a recovered precedence requirement.
- Revision 1's combined engine identifier is `baseline-1.0.0`; Revision 2/PR7
  separates `engine-baseline-1.0.0`, instrumentation `inst-1` and environment.
  The comparator accepts only the historical name. An explicitly invoked
  `strictEngineVersionForComparison` can project the modern engine name to the
  historical spelling for observational comparison only. This neither establishes
  environment/algorithm equivalence nor aliases PR7 tuples. Unknown names and
  `pose3d-live-1.0.0` are not mapped; that pipeline identifier stays unchanged.
- Revision 1 makes contact/zoom-contact universal. Revision 2 makes events
  independent and V1 subject-only. Only its authorized subject signals receive
  recovered G2/G5/G6 numerical values. V1 uses generic crop availability; it does
  not acquire strict contact-confidence, contact-frame, zoom-contact or engine
  predicates. No numeric V1 rule currently remains unspecified; unavailable or
  malformed policy values still return `subject_thresholds_unavailable` in policy
  simulation instead of inventing a value.
- Revision 1's extractor round-trip acceptance belongs to its former combined
  artifact extractor. PR8 accepts explicit signals; artifact normalization and
  provenance association remain deferred to PR11. No production extractor is added.

The comparator always reports `scope: shadow_comparator_only` and
`approvedForProduction: false`. `assessClip` accepts optional explicit
`strictSignals`; strict outcomes do not control its V1 result or claim eligibility.
All production enforcement remains disabled.

## Contracts and implementation

- **V1:** validates fallback, bat-holding frames, track count/coverage, spatial
  identity-jump fraction, crop availability and swing-window availability. Missing,
  malformed, nonfinite and inconsistent signals fail with explicit reasons.
  Inputs are window-scoped 2D availability signals, not proof of true identity.
  The recovered provisional policy is versioned by PR7's gate version; its values
  are specified above and are neither calibrated nor reviewer approval.
- **V2:** shares PR3's vocabulary and legacy mapping. Contact maps only to
  `impact_estimate`; load maps only to auxiliary `load_peak_estimate`.
  `load_start`, `swing_launch`, `stride_foot_lift` and `contact_confirmed` remain
  not produced by this baseline adapter. Extension remains auxiliary. Original
  source method/confidence labels are preserved; no confidence is a probability.
  Low impact confidence fails that event alone; valid foot-plant/finish events
  remain available. Missing methods/labels fail. Event uncertainty stays null.
- **Frame identity:** accepts exact PR6 frame-map JSON bytes and the companion
  manifest. Uses Web Crypto SHA-256, checking hash, schema, instrumentation,
  baseline engine, run, input, final attempt, decode counts, verified aggregate
  and row statuses, integer source frame/PTS, monotonic order, common rational
  time base, and convenience-seconds consistency. Never uses i/fps or legacy
  `time_s`. Async functions are deterministic because hashing requires no I/O.
  No attempt-history fallback. Callers still must associate metrics and supplied
  media with the same run/input/attempt; PR8 does not implement PR11 normalization.
- **V3:** all 17 existing concepts have proposed requirements, null approval and
  the PR7 claims version. AND-of-OR event groups preserve impact alternatives;
  head stability, posture and front-side stability specifically require estimated
  impact as written in §3.2. Required stills/zooms match exact original frame/PTS;
  ordered sequences span required events (extension requires at least 8 frames).
  Other sequences need at least two distinct frames to constitute a sequence.
  Sequence bounds do not substitute for missing load-start or launch before D7.
  Stride's OR group permits plant-only availability; it does not assert that a
  lift event was detected. Each supplied sequence frame and required event frame
  needs visibility evidence. Bat ≥0.5, feet/head ≥0.8 use availability fractions,
  never detector probabilities. Qualitative arms/hands/lower-body/torso/lead-leg
  requirements need explicit true visibility at each required frame; no numeric
  cutoff is invented for them. Identity-bound samples, not global clip averages,
  determine sufficiency. Missing samples and duplicates fail closed.
- **Camera limits:** hip/shoulder sequencing stays disallowed in every profile;
  no open-side exception is invented. Stance and timing remain unavailable;
  swing decision, pitch adjustment and game approach are nonmechanical. No other
  camera restrictions are added beyond the plan.
- **V4:** every lookup returns `unmeasured` with all profile, rate, bound and sample
  fields null. A future lookup interface is separate from V1–V3; no injected
  profile can authorize a production claim in PR8.
- **Composition:** `decideClaim` recomputes dimensions, returns actual reliability,
  and always sets `displayable` and `enforceEligible` false. Its separately labeled
  hypothetical result can show how unmeasured shadow availability would compose;
  enforce simulation requires `within_ceiling`. Off returns no hypothetical
  display eligibility. A simulation cannot register a tuple or change PR7 flags.

PR3's event vocabulary/frame identity and legacy translation were extracted into
pure `src/domain/` modules with backward-compatible PR3 re-exports. Annotation
schema v1.0.0 is unchanged. Existing concept and legacy phase constants likewise
move to pure shared modules with original exports retained; prompt text and
taxonomy values are unchanged. This avoids Node-only transitive type imports as
well as runtime imports in shared evidence code. Tests check both dependency graphs.

## Verification

Synthetic fixtures only. PR8: 94 passed (including all 256 combined G1–G8
failure masks). PR3: 82 passed. PR7: 61 passed. Full `npm test` passed:
compiled suite 555 passed/1 skipped, coach/brand 248 passed; prerequisite
suites passed with 3 existing privacy platform skips. All 18 protected source
files and 25 PR6 instrumentation tests passed their checks. `npm run build`
and whitespace validation pass. Comparator tests cover original rules, exact
boundaries, malformed/null inputs, deterministic ordering, explicit engine
projection, unavailable policies, original MAX_JUMP and 3D independence.

Node executes the shared TypeScript code and the actual PR7 Edge shim. Runtime
and type dependency tests reject Node-only/3D imports and cycles. Native Deno
and Supabase bundling remain unverified; the optional Deno smoke test is
`scripts/tests/evidence-dimensions.deno.ts`. Node results do not establish native
Deno execution. PR5-B real-video repeatability and PR6 real-video equivalence
remain unverified. No accuracy/calibration claim is made.

No application version bump: isolated foundational modules have no production
callers. No staging, commit, push, deployment or cloud changes. Visual QA is
inapplicable. Signal provenance must still be established by future adapters;
subject heuristics are not proof of identity. Visibility sample matching remains
quadratic and unbenchmarked; profile/bound inputs before future integration.

## PR8 file inventory

Added:

- `src/domain/concepts.ts`
- `src/domain/swingEvents.ts`
- `src/domain/swingPhases.ts`
- `src/domain/legacyPhaseMapping.ts`
- `src/services/development/evidence/types.ts`
- `src/services/development/evidence/subject.ts`
- `src/services/development/evidence/subjectPolicy.ts`
- `src/services/development/evidence/events.ts`
- `src/services/development/evidence/eventMapping.ts`
- `src/services/development/evidence/sufficiency.ts`
- `src/services/development/evidence/reliability.ts`
- `src/services/development/evidence/assessClip.ts`
- `src/services/development/evidence/decideClaim.ts`
- `src/services/development/evidence/claimRequirements.ts`
- `src/services/development/evidence/strictBaseline.ts`
- `src/services/development/evidence/validation.ts`
- `src/services/development/evidence/evidence.test.ts`
- `src/services/development/evidence/strictBaseline.test.ts`
- `src/services/development/evidence/fixtures/baseline.json`
- `scripts/tests/evidence-dimensions.deno.ts`
- `docs/evaluation/evidence-assessment.md`

Modified:

- `src/eval/schema/annotation.ts` — shared vocabulary/type exports only
- `src/eval/schema/legacyMapping.ts` — shared implementation re-export
- `src/services/knowledge/knowledgePack.ts` — unchanged concept taxonomy re-export
- `src/services/ai/swingAnalysisShared.ts` — unchanged phase vocabulary re-export;
  no prompt text, policy or model edits
- `package.json` — focused PR8 test script and pretest addition
- `NEXT_STEPS.md` — PR8 status and limitations

`evidence/version.ts` and the other PR7 files predate PR8 and are unchanged.
Pre-existing PR5/PR6/unrelated changes are preserved. The index is empty.

## Independent review and reconciliation

Earlier PR8 reviews completed through the repository wrapper:
`.git/gemini-review/review-20261013-133601-4a329b.md` and
`.git/gemini-review/review-20261013-134244-23272e.md`. Their missing-source blocker
is now addressed by the restored original specification and comparator tests.
Those earlier reviews do not establish review of the recovered-rule changes.
The completion review ran successfully through `Invoke-OrchestratedQA.ps1`
using Gemini 3.8 Flash (High), with previously completed tests supplied separately
(`-SkipTests`). Record: `.git/gemini-review/review-20261013-184450-9adf0c.md`.

- **BLOCKING:** none. Source/test reconciliation found no predicate, boundary,
  reliability bypass or production-integration defect.
- **NON-BLOCKING:** quadratic visibility matching remains unbenchmarked; native
  Deno/bundling and real-video checks remain unverified. The reviewer's estimate
  that matching is negligible is not a measured performance result.
- **NON-BLOCKING:** strict results retain the input object reference. This matches
  verbatim signal retention and never mutates the caller's input, but it is not
  an immutable snapshot. Future audit persistence must serialize/snapshot signals
  before caller mutation. No production persistence is implemented here.
- **QUESTION / JUDGMENT CALL:** the G2 enum gap, G8 family gap and combined family
  precedence are resolved explicitly above. V1's singular family convention is
  separate: unknown version/unavailable policy takes precedence, then unavailable
  window maps to swing_unclear, then other subject failures to batter_unclear.
  All individual subject reasons remain available. No parent-facing copy changes.

No behavioral fixes were required by this completion review. Only this review
record and the work log changed afterward. Visual QA is inapplicable.
