# Analysis depth Phase 0 decision record

Status: proposed for human review, 2026-10-10. This record does not authorize an advanced release, research use, new consent scope, or a validation claim. The development summary stays the default at every competition level. Phase 1 stores only experimental definitions and service-only evidence.

## Governance and owners

| Decision | Proposed owner | Status |
|---|---|---|
| Three-view permission and revocable sharing policy | Product owner and privacy lead | Approval pending |
| Youth softball methodology and applicability | Qualified softball hitting reviewer, to be recruited | Reviewer pending |
| Youth baseball methodology and applicability | Qualified baseball hitting reviewer, to be recruited | Reviewer pending |
| Advanced competition methodology | Independent college/pro reviewers for each marketed sport, to be recruited | Reviewers pending |
| Validation thresholds and dataset protocol | Independent methodology reviewer and validation lead, to be named | Owners and thresholds pending |
| Advanced analysis, external import, and research consent wording | Product owner and privacy/legal reviewer | Approval pending |

No reviewer identity or sign-off is inferred from existing methodology-admin access. A methodology admin can register a definition but cannot grant themselves media access or declare it released.

## Proposed view and sharing rules

- Development summary is the landing view for all roles and competition levels.
- Coach analysis requires an enabled organization plus a player-scoped coach/instructor permission. Guardian access remains the summary by default.
- Performance lab requires an explicit organization entitlement and player-scoped analyst permission.
- Ordinary shared links expose only the development summary. Advanced sharing needs a separate, revocable, player-scoped token with a field allowlist. Phase 1 creates no such token or read endpoint.
- No view role grants access to another player. Methodology admins see definition metadata only.

## Controlled vocabulary for future phases

Sport: `softball`, `baseball`, `unknown`. Environment: `tee`, `front_toss`, `side_toss`, `pitching_machine`, `live_practice`, `game`, `unknown`. Intent: `conventional_full`, `slap`, `power_slap`, `bunt`, `drag_bunt`, `checked_protective`, `take`, `unknown`. Phase event: `ready_stance`, `load_start`, `peak_load`, `stride_start`, `front_foot_plant`, `launch_rotation_start`, `bat_enters_zone`, `contact_estimate`, `extension`, `finish`. A missing event stays unavailable.

Controlled exclusion reasons are implemented in migration `00055` and `src/services/analysisDepth/evidence.ts`: incompatible capture, hidden body part, detector uncertainty, deleted media, intent mismatch, environment mismatch, definition version mismatch, insufficient quality, wrong athlete, and unknown context. No unclassified exclusion is silently treated as eligible.

## Initial applicability proposal

| Observation family | Conventional full | Slap/power slap | Bunt/drag bunt | Checked/protective | Take/unknown |
|---|---|---|---|---|---|
| Visible stance and balance | Candidate | Candidate, separate interpretation | Candidate, separate interpretation | Candidate | Visibility only |
| Front-foot plant timing | Candidate | Separate validation required | Unavailable | Unavailable | Unavailable |
| Contact estimate timing | Candidate | Separate validation required | Separate validation required | Unavailable | Unavailable |
| Finish and recovery | Candidate | Separate validation required | Unavailable | Unavailable | Unavailable |

“Candidate” means eligible for a validation study, not a report claim. Sport-specific review is required even where both sports have a candidate. Unknown intent allows only visibility and quality statements.

## First validation study proposal

Select two estimates: front-foot plant event timing and contact event timing, each expressed in source frames with frame rate and uncertainty. Neither produces physical distance, velocity, or joint angle. The study will use consented, athlete-separated development/test sets covering both sports, handedness, approved intents, and each supported capture profile. Two independent qualified reviewers label frames without model output; disagreements are adjudicated and inter-rater agreement is recorded. Report absolute frame and millisecond error, missing-event rate, false-positive rate, per-profile readability, and subgroup reliability.

The validation lead must pre-register numeric pass/fail thresholds, sample sizes, and subgroup criteria **before** labeling the held-out set. Those values remain pending because no approved protocol or reviewer has set them. Until then every definition remains `experimental`; neither estimate is published. Research and external-import use likewise wait for approved, separate consent text and retention rules.

Consent draft for review: “If you turn on advanced analysis, HitterLoop may use this player's videos to create additional observations and estimates. An estimate can be unavailable when the video is unclear. These results are visible only to people you authorize for this player. External device data requires a separate import choice. We will not use the player's videos for a research or validation dataset without a separate, recorded opt-in. You may withdraw access and request deletion through the existing account controls.” The privacy reviewer must reconcile this wording with actual retention, guardian authority, export, withdrawal, and deletion behavior before it is shown in the app.

## Phase boundaries

Phase 1 provides a versioned registry, private evidence store, controlled reasons, and safe projection logic. It does not add attempts, phase detection, capture assessment, coach analysis, performance lab, external imports, new consent capture, or advanced sharing. Those belong to later phases.
