# HitterLoop engine v2 M4: evidence-backed AI coaching (development-only)

M4 connects the experimental v2 engine's M3 events to the existing AI analysis and report pipeline for
local development. Production is unchanged: when the v2 engine is not selected, the prompt
(`renderSwingAnalysisPrompt`, render-2.1), JSON shape, Gemini schema, provider adapters, validation,
report gates (`shownFix`, `assembleReport`, `get-simplified-report`), evidence flags and the empty V4
`PRODUCTION_RELIABILITY_CATALOG` behave exactly as before.

Implemented directly by Claude Code: the Codex hand-off failed repeatedly on an automated permission-check
error, so the owner directed direct implementation with disclosure and independent Gemini review.

## When v2 evidence may reach a provider

`v2CoachingEligibility` (`src/services/engine/v2Coaching.ts`) must pass, or nothing is extracted or sent:

| Requirement | Reason code when it fails |
| --- | --- |
| `ENGINE_V2_AI=enabled` (explicit opt-in, off by default) | `V2_AI_NOT_ENABLED` |
| `AI_ANALYZER` is `agy-cli` or `claude-cli` (Gemini has no evidence-addendum hook) | `V2_PROVIDER_UNSUPPORTED` |
| Engine run complete | `ENGINE_NOT_COMPLETE` |
| Batter selected with `pose_and_bat` grounding | `NO_SELECTED_BATTER`, `IDENTITY_NOT_BAT_GROUNDED` |
| No pose/bat disagreement or possible batter conflict | `POSSIBLE_BATTER_CONFLICT` |
| No unsupported-camera diagnostics | `UNSUPPORTED_CAMERA_GEOMETRY` |
| `swing_detection` is `swing_candidate` (inconclusive results never reach the AI) | `NO_SWING_CANDIDATE` |
| At least one available, `experimental` event with a located phase | `NO_SUPPORTED_EVENT` |

The owner's authorization for real footage excludes external AI analysis; tests use provider doubles only.

## Evidence package `evpkg-v2-1.0.0` (`src/services/ai/v2EvidencePackage.ts`)

Parallel to `evpkg-1.0.0`, which stays baseline-only. Stills are extracted by the unchanged
`extractAnalysisInputs` only for supported events (available, `downstream_use: experimental`, mapped to a
phase); `swing_launch` and `stride_foot_lift` are never supplied. Because v2 decodes the upload directly,
each image's analysed frame must equal its source frame and its PTS must match the frame map (within
1e-5 s), and a phase still must sit exactly on its event frame; otherwise the image is excluded with a
reason (`SOURCE_FRAME_MISMATCH`, `PTS_MISMATCH`, `IMAGE_NOT_AT_EVENT_FRAME`,
`NO_SUPPORTED_EVENT_FOR_PHASE`, `UNREADABLE_IMAGE`, `MALFORMED_IMAGE`) and deleted from the analysis
directory before any provider call. The worker then requires the directory to contain exactly the package
images, byte-identical by SHA-256.

Images are ordered by source PTS and labelled with event id, source frame, time, batter-pose presence and
bat observation: `direct` only for a direct, identity-resolved bat detection; `interpolated` is labelled as
not observed; otherwise `not_observed`. An event is citable only when its own phase still was supplied. The
package states that the impact estimate is not confirmed contact, `contact_confirmed` is never produced and
knob, hand-path and bat-angle measurements are unavailable. It contains no local paths and has a
deterministic canonical digest; a copy is written beside the engine outputs.

## Prompt `render-v2-1.0.0`

`renderV2Addendum` produces section E, appended through the CLI analyzers' existing `evidenceAddendum`
hook after the unchanged production prompt: a chronological image table, the citable events, and rules
(impact estimate only, never contact or results; no numbers; no hand-path, knob or bat-angle measurements;
direct observations or qualified interpretations only; cite events). The CLI attaches images in file-name
order; the table carries time order.

## Validation extension

`AnalysisInput.swing.v2Evidence = { supportedEvents }` is set only on v2 runs. `validationContext` passes it
to `validateSwingAnalysisResult`, which then requires every strength and issue to carry `supportingEvents`
(non-empty, no repeats, all supported) and `claimType` (`direct_observation` | `qualified_interpretation`).
Malformed output throws before anything is stored. Without `v2Evidence`, validation and outputs are
unchanged and extra fields are ignored.

## Experimental qualification (pre-storage)

`qualifyV2Findings` decides, per finding, whether it may be stored; only displayed findings are persisted
(`qualifiedResult`). The AI's own confidence is never a reason to display and is never upgraded. Each
suppression has a stable code and a plain-English explanation:

| Code | Explanation |
| --- | --- |
| `EVENT_REFERENCE_INVALID` | It cites a swing moment the engine did not supply. |
| `EVENT_PHASE_MISMATCH` | Its swing phase does not match the moment it cites. |
| `NO_IMAGE_FOR_EVENT` | There is no still image of the moment it cites. |
| `BAT_NOT_DIRECTLY_OBSERVED` | The bat was not directly seen at the moment it cites (impact estimate, finish). |
| `POSE_NOT_OBSERVED` | The batter's body was not tracked at the moment it cites (pose-timed events). |
| `UNSUPPORTED_BASIS` | It relies on evidence other than the video. |
| `NUMERIC_CLAIM` | It states a measurement the video analysis does not provide (any digit or degree sign once cited image names such as `swing_seq_04.png` are removed). |
| `CONTACT_CLAIM` | It describes ball contact or a batted-ball result, which the analysis cannot confirm. |
| `HAND_PATH_CLAIM` | It describes hand path or the knob, which the analysis cannot measure reliably. |
| `CAUSAL_CLAIM` | It states a cause as certain instead of describing what is visible (every strength and issue text field). |
| `NOT_SUPPORTED_IN_V2` | Checklist scores, comps, comp notes and drill text carry no event citations and are never stored. |
| `SUMMARY_UNSUPPORTED_CLAIM` | A summary or no-action reason with a contact, numeric, hand-path or causal claim withholds the whole run: zero database writes. |

The text rules fail closed on purpose: an incidental number ("1 in 3 swings"), or the phrase "at contact"
used as a phase name, is suppressed too. If every issue is suppressed, the stored run is no-action-needed
with the reason "No finding met the experimental evidence requirements for this swing.", never a
needs-attention run with nothing listed.

The decision list is stored in `analysis_runs.input_manifest.v2_experimental_qualification` (existing jsonb
column, no migration) and in a local `coaching_qualification.json`. A withheld run writes only the local
file, which records the summary decision and its reasons. Stored v2 issues still pass through the
unchanged report gate, so a qualified finding is displayed only if it also meets the existing production
rules. This is an experimental qualification, not calibrated reliability.

In the worker, a v2 run whose frames don't map one-to-one onto the upload, or whose package cannot be
built, is skipped with a log line, not reported as an analysis failure.

## Not done (M5 and later)

No Android or report-screen exposure of v2 evidence or suppression reasons (M5). No real-provider run: the
real-footage authorization excludes external AI analysis, and no synthetic live-provider smoke was run. Gemini is
not supported for v2. The worker v2 branch is covered by unit tests of its parts and by a database test of
`analyzeAndSync`'s v2 path, not by an end-to-end worker run.

## Verification (2026-10-20, local only)

- Unit tests, synthetic data only: `v2EvidencePackage.test.ts` (5), `v2Validation.test.ts` (3),
  `v2Coaching.test.ts` (7). Covered: supported-event phases; PTS ordering and labels; exclusions; refusals;
  the addendum; production parity; citation validation; the CLI double with the production prompt and
  addendum; eligibility; confidence-independent display; every suppression code; pose and bat observation;
  the digit rule; outcome words; causal strengths; no-action-needed fallback; summary withholding.
- Local Supabase test in `development.test.ts`: `analyzeAndSync` v2 path with an in-memory claude CLI
  double. Only the qualified issue is stored. Decisions land in `input_manifest`. An all-suppressed run is
  stored as no-action-needed. An outcome claim is rejected by the unchanged production validator. A
  numeric summary is withheld with no `analysis_runs` row.
- Full `npm test`, `tsc` build, baseline/no-media/eval-isolation guards, `git diff --check` and `deno check`
  of the Edge functions: see the M4 completion report.
- Independent Gemini review via `scripts/Invoke-OrchestratedQA.ps1`; its findings were reconciled and the
  fixes re-reviewed.
