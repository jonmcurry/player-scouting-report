# HitterLoop Methodology Seed v1 — Final Structural / Provenance Audit

**Audit date:** 2026-09-22

**Scope:** Schema, provenance, consistency, governance, and production-safety validation. No hitting-methodology judgment was added by this audit.

**Publication state:** No methodology row was inserted, reviewed, selected into a release, published, or activated.

## Executive audit result

All eight reviewed claims are `READY_TO_STAGE` in the offline staging artifact. The corrected governance model can truthfully represent them as dual-model reviewed, not human verified, approved-but-inactive records. The staging artifact itself deliberately leaves every record at `review_status = candidate`, `review_method = dual_model`, `human_verified = false`, and `active = false`; a later authorized import/review operation would be required to create or approve database rows.

Counts:

- `READY_TO_STAGE`: 8
- `NEEDS_EDIT`: 0 — all six required Claude edits are incorporated in the staged proposal.
- `BLOCKED`: 0 at the claim-record level.
- `REJECTED_BY_PRIOR_REVIEW`: 0.

One current release-security blocker remains outside the eight records: `preview_methodology_snapshot(uuid[])` is `SECURITY DEFINER`, is executable by all authenticated users, and contains no `is_methodology_admin()` check. It bypasses methodology table RLS and lets an ordinary authenticated coach enumerate approved claims. This does not make the offline records unsafe to stage, but it should block production release until the RPC performs the same admin authorization check as review and publish. Add an ordinary-coach denial test for preview.

Two non-blocking consistency defects also remain:

- `admin/claim.html` says `review_method=dual_model/mixed` never implies a human confirmed the claim, but the schema and RPC correctly define `mixed` as human involvement with `human_verified = true`.
- The SQL comment on `review_methodology_claim` says human verification is true only for `human`, while the implementation correctly sets it true for `human` and `mixed`.

## Governance verification

### Required questions

**Can the current methodology schema truthfully represent AI-reviewed-but-not-human-verified approved claims? YES.** An approval using `p_review_method = 'dual_model'` produces `review_status = 'approved'`, `review_method = 'dual_model'`, `human_verified = false`, and leaves `active = false`.

**Can an approved claim remain inactive and excluded from a release until explicitly selected? YES.** Approval does not stage or activate a claim. Publication requires an explicit UUID array and freezes only that selected set.

### Implemented invariants

- `candidate_id` exists and is unique when non-null.
- `human_verified` is non-null and defaults false.
- `review_method` accepts `human`, `dual_model`, or `mixed`.
- The database prevents `human_verified = true` for `dual_model` or null review methods.
- Approval requires a review method and derives human verification server-side.
- The approval RPC never sets `active = true`; it may only clear active during a reject/dispute/duplicate/supersede hotfix.
- Approved claims form an eligible pool. They are not implicitly staged.
- Preview without IDs returns the approved pool; preview with approved IDs returns that selected subset.
- Publish rejects null `p_claim_ids`; an explicit empty array is permitted.
- Publish rejects every selected ID that is not currently approved.
- Frozen `methodology_version_items` define release membership.
- Publishing reconciles claim activity to exactly the new snapshot: selected claims become active, approved/unselected claims remain inactive, and previously active omitted claims become inactive.
- An approved/unselected claim remains eligible for a later release.
- `candidate_id`, `review_method`, and `human_verified` are frozen into `item_payload` and parsed into the runtime `MethodologyItem` shape.
- Authenticated methodology admins cannot update/delete historical version rows/items. The existing `service_role` retains broad grants, so “immutable” is enforced against application/admin clients, not against a compromised or deliberately used service-role credential.
- Runtime continues to read only the active frozen snapshot, never candidate or merely approved rows.

### Remaining governance/security findings

1. **Release-security blocker — preview authorization:** Add `if not is_methodology_admin() then raise ...` to the preview RPC or otherwise ensure it executes with invoker-safe RLS semantics. Its current `SECURITY DEFINER` body exposes approved-pool data to any authenticated account.
2. **Preview exactness gap:** Explicit preview silently omits non-existent or no-longer-approved IDs instead of rejecting them. Publish fails closed, so production membership is safe, but preview can cease to represent the requested selection during a stale/racing review change. Reuse publish's validation for exact preview behavior.
3. **Admin wording defect:** Correct the `mixed` explanatory text noted above.
4. **Test gap:** No dedicated admin API/static test was found for the new RPC argument wiring or the release-selection UI. Current correctness is code-inspected, not test-proven at that boundary.
5. **Integration cleanup defect:** The full suite left its `TEST-FULL-*` methodology claim/material/source fixture behind and restored `k-0.1.0.active = true` without restoring its status from `retired` to `published`. This audit removed only those exact local test-fixture rows and restored the baseline status, but the test cleanup should be fixed so future runs leave the asserted baseline without manual intervention.

## Per-claim gate table

| Claim ID | Gemini | Claude | Schema | Governance | Final audit result |
|---|---|---|---|---|---|
| DRV2-001 | VERIFIED_BUT_EDIT_REQUIRED | APPROVE_WITH_EDIT | PASS | PASS | READY_TO_STAGE |
| TAN-001 | VERIFIED_BUT_EDIT_REQUIRED | APPROVE_WITH_EDIT | PASS | PASS | READY_TO_STAGE |
| GAS-001 | VERIFIED_AS_WRITTEN | APPROVE_AS_WRITTEN | PASS | PASS | READY_TO_STAGE |
| ABCA-YT-001 | VERIFIED_AS_WRITTEN | APPROVE_AS_WRITTEN | PASS | PASS | READY_TO_STAGE |
| ABCA-YT-002 | VERIFIED_AS_WRITTEN | APPROVE_WITH_EDIT | PASS — numeric guardrail referenced | PASS | READY_TO_STAGE |
| BLM-001 | VERIFIED_AS_WRITTEN | APPROVE_WITH_EDIT | PASS — source cue separated | PASS | READY_TO_STAGE |
| SCI-002 | VERIFIED_BUT_EDIT_REQUIRED | APPROVE_WITH_EDIT | PASS | PASS | READY_TO_STAGE |
| DRV1-001 | VERIFIED_AS_WRITTEN | APPROVE_WITH_EDIT | PASS — source-side research caveat preserved | PASS | READY_TO_STAGE |

## READY_TO_STAGE

### CLAIM ID: DRV2-001

#### SOURCE GATE

- **Gemini verdict:** `VERIFIED_BUT_EDIT_REQUIRED`.
- **Timestamp verified by independent AI review:** Yes, 00:28–00:42.
- **Source metadata acceptable:** Yes; Driveline Baseball, video `tTBSOTw7XoQ`.
- **Provenance complete:** Yes; candidate, source/material keys, publisher, URL, video ID, verified range, and both model decisions are preserved.
- **Source-side caveat:** Coaching-facility heuristic, not validated causal research.

#### METHODOLOGY GATE

- **Claude verdict:** `APPROVE_WITH_EDIT`.
- **Claude edit required:** Yes; deterministic “leading to” language is replaced with “frequently co-occurs with.”
- **Final wording consistent with Gemini source verification:** Yes.
- **Product-domain fit:** Timing diagnostic pattern observable in baseball video.
- **Contradiction/policy caveat:** No cross-claim contradiction; do not turn associated symptoms into a single-cause diagnosis.

#### SCHEMA GATE

- **candidate_id valid:** Yes, unique non-empty `DRV2-001`.
- **concept valid:** Yes, `timing`.
- **sport_scope valid:** Yes, `baseball` only.
- **age_guardrail valid:** Yes, `teen_appropriate`.
- **level_scope valid:** Yes, high school/college/advanced.
- **evidence_type research label valid:** Yes, `coaching_heuristic` is mapped by the controlled function.
- **mapped production evidence type:** `coaching_experience`.
- **applies_when valid:** Yes.
- **does_not_apply_when valid:** Yes.
- **observable_evidence valid:** Yes; expressly a co-occurring visual pattern.
- **numeric claim handling valid:** Yes, non-numeric.
- **source/material references valid:** Yes.

#### GOVERNANCE GATE

- **review_method:** `dual_model`.
- **human_verified:** `false`.
- **review_status proposed:** `candidate` in the staging artifact; eligible for later dual-model approval.
- **active proposed:** `false`.
- **approved-but-unpublished representation valid:** Yes.
- **publishable under current schema:** Yes, only after approval and explicit release selection.
- **blocker if any:** None specific to this record.

#### FINAL AUDIT RESULT

`READY_TO_STAGE`

### CLAIM ID: TAN-001

#### SOURCE GATE

- **Gemini verdict:** `VERIFIED_BUT_EDIT_REQUIRED`.
- **Timestamp verified by independent AI review:** Yes, 00:07–00:43.
- **Source metadata acceptable:** Yes; TannerTees is publisher and Megan Rembielak/MegRem is the featured instructor.
- **Provenance complete:** Yes.
- **Source-side caveat:** Commercial equipment channel; approval of this record does not broaden trust beyond this material.

#### METHODOLOGY GATE

- **Claude verdict:** `APPROVE_WITH_EDIT`.
- **Claude edit required:** Yes; softball-only scope and explicit barrel-path-through-tunnel meaning.
- **Final wording consistent with Gemini source verification:** Yes.
- **Product-domain fit:** Post-contact barrel-path guidance in softball tee/drill context.
- **Contradiction/policy caveat:** It does not prescribe generic arm extension or desirable casting.

#### SCHEMA GATE

- **candidate_id valid:** Yes, `TAN-001`.
- **concept valid:** Yes, `extension`.
- **sport_scope valid:** Yes, `softball` only.
- **age_guardrail valid:** Yes, `youth_appropriate`.
- **level_scope valid:** Yes; youth through college softball as verified.
- **evidence_type research label valid:** Yes, `coaching_heuristic`.
- **mapped production evidence type:** `coaching_experience`.
- **applies_when valid:** Yes, middle/outer-zone context.
- **does_not_apply_when valid:** Yes, extreme inside pitches excluded.
- **observable_evidence valid:** Yes; barrel direction, not arm-casting, is explicit.
- **numeric claim handling valid:** Yes, non-numeric.
- **source/material references valid:** Yes.

#### GOVERNANCE GATE

- **review_method:** `dual_model`.
- **human_verified:** `false`.
- **review_status proposed:** `candidate` pre-import staging.
- **active proposed:** `false`.
- **approved-but-unpublished representation valid:** Yes.
- **publishable under current schema:** Yes after explicit approval/selection.
- **blocker if any:** None specific to this record.

#### FINAL AUDIT RESULT

`READY_TO_STAGE`

### CLAIM ID: GAS-001

#### SOURCE GATE

- **Gemini verdict:** `VERIFIED_AS_WRITTEN`.
- **Timestamp verified by independent AI review:** Yes, 00:15–00:28.
- **Source metadata acceptable:** Yes; FloCollege | Softball publisher, JT Gasso presenter, video `RtQUfmkqX0s`.
- **Provenance complete:** Yes.
- **Source-side caveat:** Short excerpt with unknown publication date; no broad source trust is inferred.

#### METHODOLOGY GATE

- **Claude verdict:** `APPROVE_AS_WRITTEN`.
- **Claude edit required:** No.
- **Final wording consistent with Gemini source verification:** Yes.
- **Product-domain fit:** Softball timing drill prescription.
- **Contradiction/policy caveat:** The drill trains variability; it is not a universal mechanical law.

#### SCHEMA GATE

- **candidate_id valid:** Yes, `GAS-001`.
- **concept valid:** Yes, `timing`.
- **sport_scope valid:** Yes, `softball` only.
- **age_guardrail valid:** Yes, `teen_appropriate`.
- **level_scope valid:** Yes, high school/travel/college.
- **evidence_type research label valid:** Yes, `drill_prescription`.
- **mapped production evidence type:** `drill_prescription`.
- **applies_when valid:** Yes.
- **does_not_apply_when valid:** Yes.
- **observable_evidence valid:** Yes, setup and execution are directly observable.
- **numeric claim handling valid:** Yes, non-numeric.
- **source/material references valid:** Yes.

#### GOVERNANCE GATE

- **review_method:** `dual_model`.
- **human_verified:** `false`.
- **review_status proposed:** `candidate` pre-import staging.
- **active proposed:** `false`.
- **approved-but-unpublished representation valid:** Yes.
- **publishable under current schema:** Yes after explicit approval/selection.
- **blocker if any:** None specific to this record.

#### FINAL AUDIT RESULT

`READY_TO_STAGE`

### CLAIM ID: ABCA-YT-001

#### SOURCE GATE

- **Gemini verdict:** `VERIFIED_AS_WRITTEN`.
- **Timestamp verified by independent AI review:** Yes, 06:18–08:20.
- **Source metadata acceptable:** Yes with preserved context: ABCA is the uploader; Golden Spikes appears in the production/facility context.
- **Provenance complete:** Yes.
- **Source-side caveat:** Material-specific verification does not create blanket ABCA authority.

#### METHODOLOGY GATE

- **Claude verdict:** `APPROVE_AS_WRITTEN`.
- **Claude edit required:** No.
- **Final wording consistent with Gemini source verification:** Yes.
- **Product-domain fit:** Controlled baseball tee setup.
- **Contradiction/policy caveat:** It is not an immutable in-game contact-point law.

#### SCHEMA GATE

- **candidate_id valid:** Yes, `ABCA-YT-001`.
- **concept valid:** Yes, `pitch_location_adjustment`.
- **sport_scope valid:** Yes, `baseball` only.
- **age_guardrail valid:** Yes, `youth_appropriate`.
- **level_scope valid:** Yes, youth/amateur.
- **evidence_type research label valid:** Yes, `coaching_instruction`.
- **mapped production evidence type:** `coaching_experience`.
- **applies_when valid:** Yes, controlled tee setups.
- **does_not_apply_when valid:** Yes, live pitch recognition excluded.
- **observable_evidence valid:** Yes, tee/body geometry is visible.
- **numeric claim handling valid:** Yes, non-numeric.
- **source/material references valid:** Yes.

#### GOVERNANCE GATE

- **review_method:** `dual_model`.
- **human_verified:** `false`.
- **review_status proposed:** `candidate` pre-import staging.
- **active proposed:** `false`.
- **approved-but-unpublished representation valid:** Yes.
- **publishable under current schema:** Yes after explicit approval/selection.
- **blocker if any:** None specific to this record.

#### FINAL AUDIT RESULT

`READY_TO_STAGE`

### CLAIM ID: ABCA-YT-002

#### SOURCE GATE

- **Gemini verdict:** `VERIFIED_AS_WRITTEN`.
- **Timestamp verified by independent AI review:** Yes, 00:58–02:30.
- **Source metadata acceptable:** Yes with the same ABCA/Golden Spikes context.
- **Provenance complete:** Yes, including the verified 2–4 lb statement.
- **Source-side caveat:** Source-specific youth equipment guidance, not universal physical readiness.

#### METHODOLOGY GATE

- **Claude verdict:** `APPROVE_WITH_EDIT`.
- **Claude edit required:** Yes; 2–4 lb youth guidance is retained in final text, level scope, applicability, exclusions, and numeric evidence reference.
- **Final wording consistent with Gemini source verification:** Yes.
- **Product-domain fit:** Baseball youth drill prescription.
- **Contradiction/policy caveat:** “This drill teaches” is retained; it does not say all hitters must load this way.

#### SCHEMA GATE

- **candidate_id valid:** Yes, `ABCA-YT-002`.
- **concept valid:** Yes, `load`.
- **sport_scope valid:** Yes, `baseball` only.
- **age_guardrail valid:** Yes, `youth_appropriate` with explicit equipment/physical exclusions.
- **level_scope valid:** Yes; youth plus explicit 2–4 lb/no-adult-substitution tokens.
- **evidence_type research label valid:** Yes, `drill_prescription`.
- **mapped production evidence type:** `drill_prescription`.
- **applies_when valid:** Yes, includes age-appropriate 2–4 lb equipment.
- **does_not_apply_when valid:** Yes, balance/joint/adult-weight exclusions.
- **observable_evidence valid:** Yes.
- **numeric claim handling valid:** Yes; `numeric_claim = true` and the evidence reference names video `7J-JoyaSabA`, 00:58–02:30.
- **source/material references valid:** Yes.

#### GOVERNANCE GATE

- **review_method:** `dual_model`.
- **human_verified:** `false`.
- **review_status proposed:** `candidate` pre-import staging.
- **active proposed:** `false`.
- **approved-but-unpublished representation valid:** Yes.
- **publishable under current schema:** Yes after explicit approval/selection.
- **blocker if any:** None specific to this record.

#### FINAL AUDIT RESULT

`READY_TO_STAGE`

### CLAIM ID: BLM-001

#### SOURCE GATE

- **Gemini verdict:** `VERIFIED_AS_WRITTEN`.
- **Timestamp verified by independent AI review:** Yes, 00:52–01:45.
- **Source metadata acceptable:** Yes; Blast Motion, video `NThwdXRo0b8`.
- **Provenance complete:** Yes, including the source cue and open contradiction.
- **Source-side caveat:** No proprietary Blast metric is included; the source is a hardware vendor with limited trust outside this material.

#### METHODOLOGY GATE

- **Claude verdict:** `APPROVE_WITH_EDIT`.
- **Claude edit required:** Yes; mechanical/posture text remains, while the internal-focus cue is provenance only.
- **Final wording consistent with Gemini source verification:** Yes.
- **Product-domain fit:** Sensor-independent posture/rotation drill claim.
- **Contradiction/policy caveat:** Open contradiction with DRV1-001 is preserved. Production `coaching_cue` is null; `source_coaching_cue` and its non-default policy are separately retained in staging provenance.

#### SCHEMA GATE

- **candidate_id valid:** Yes, `BLM-001`.
- **concept valid:** Yes, `posture`.
- **sport_scope valid:** Yes, `both` as expressly supported.
- **age_guardrail valid:** Yes, `youth_appropriate`.
- **level_scope valid:** Yes, youth/amateur/advanced.
- **evidence_type research label valid:** Yes, `drill_prescription`.
- **mapped production evidence type:** `drill_prescription`.
- **applies_when valid:** Yes, controlled tee/PVC context.
- **does_not_apply_when valid:** Yes, game variability and universal cue-policy use excluded.
- **observable_evidence valid:** Yes, qualitative posture/rotation only.
- **numeric claim handling valid:** Yes, non-numeric; no proprietary sensor metric.
- **source/material references valid:** Yes.

#### GOVERNANCE GATE

- **review_method:** `dual_model`.
- **human_verified:** `false`.
- **review_status proposed:** `candidate` pre-import staging.
- **active proposed:** `false`.
- **approved-but-unpublished representation valid:** Yes.
- **publishable under current schema:** Yes after explicit approval/selection, with source cue stored only in non-runtime provenance/notes.
- **blocker if any:** None specific to this record.

#### FINAL AUDIT RESULT

`READY_TO_STAGE`

### CLAIM ID: SCI-002

#### SOURCE GATE

- **Gemini verdict:** `VERIFIED_BUT_EDIT_REQUIRED`.
- **Timestamp verified by independent AI review:** Yes, 15:43–16:10.
- **Source metadata acceptable:** Yes; Let's Have This Conversation publisher, Chad Miller interview material, video `fETlemtrceo`.
- **Provenance complete:** Yes.
- **Source-side caveat:** Podcast/interview commentary, not a research or medical publication.

#### METHODOLOGY GATE

- **Claude verdict:** `APPROVE_WITH_EDIT`.
- **Claude edit required:** Yes; normative “optimal” language is removed and the claim remains qualitative.
- **Final wording consistent with Gemini source verification:** Yes.
- **Product-domain fit:** Qualitative kinetic-chain description.
- **Contradiction/policy caveat:** Partial observability only; do not infer precise kinetic timing or force measurement.

#### SCHEMA GATE

- **candidate_id valid:** Yes, `SCI-002`.
- **concept valid:** Yes, `hip_shoulder_sequencing`.
- **sport_scope valid:** Yes, `both` as expressly supported.
- **age_guardrail valid:** Yes, `youth_appropriate`.
- **level_scope valid:** Yes, general.
- **evidence_type research label valid:** Yes, `biomechanical_explanation`.
- **mapped production evidence type:** `biomechanical_explanation`.
- **applies_when valid:** Yes, full-effort rotational swings.
- **does_not_apply_when valid:** Yes, check swings/bunts/emergency adjustments excluded.
- **observable_evidence valid:** Yes, explicitly qualitative and partially observable rather than directly measured.
- **numeric claim handling valid:** Yes, non-numeric; SCI-001's unsupported figures are absent.
- **source/material references valid:** Yes.

#### GOVERNANCE GATE

- **review_method:** `dual_model`.
- **human_verified:** `false`.
- **review_status proposed:** `candidate` pre-import staging.
- **active proposed:** `false`.
- **approved-but-unpublished representation valid:** Yes.
- **publishable under current schema:** Yes after explicit approval/selection.
- **blocker if any:** None specific to this record.

#### FINAL AUDIT RESULT

`READY_TO_STAGE`

### CLAIM ID: DRV1-001

#### SOURCE GATE

- **Gemini verdict:** `VERIFIED_AS_WRITTEN`.
- **Timestamp verified by independent AI review:** Yes, 00:38–01:03.
- **Source metadata acceptable:** Yes; Driveline Baseball, presenter Jason Ochart, video `tXKjS3iKgAk`.
- **Provenance complete:** Yes for source-side verification. The artifact does not claim paper-level independent verification.
- **Source-side caveat:** Gemini verified citations displayed in the source and their use by the presenter. HitterLoop did not independently audit the underlying papers.

#### METHODOLOGY GATE

- **Claude verdict:** `APPROVE_WITH_EDIT`.
- **Claude edit required:** Yes; frame it as cue-language policy, preserve provisional research scope, and retain the contradiction.
- **Final wording consistent with Gemini source verification:** Yes.
- **Product-domain fit:** Cueing/coaching-policy principle, not a swing diagnosis.
- **Contradiction/policy caveat:** Open contradiction with BLM-001's source-specific internal cue remains explicit; neither record invalidates the other.

#### SCHEMA GATE

- **candidate_id valid:** Yes, `DRV1-001`.
- **concept valid:** Yes, `game_approach`, with explicit cue-policy framing.
- **sport_scope valid:** Yes, `both` as expressly supported for the cited motor-learning principle.
- **age_guardrail valid:** Yes, `youth_appropriate`.
- **level_scope valid:** Yes, general.
- **evidence_type research label valid:** Yes, `research_supported` is mapped deterministically.
- **mapped production evidence type:** `research`.
- **applies_when valid:** Yes, verbal coaching feedback contexts.
- **does_not_apply_when valid:** Yes, body-awareness/physical-therapy contexts excluded.
- **observable_evidence valid:** Yes; it explicitly says this is not directly observable in an individual swing.
- **numeric claim handling valid:** Yes, non-numeric.
- **source/material references valid:** Yes; source-side citations are described without claiming a HitterLoop paper audit.

#### GOVERNANCE GATE

- **review_method:** `dual_model`.
- **human_verified:** `false`.
- **review_status proposed:** `candidate` pre-import staging.
- **active proposed:** `false`.
- **approved-but-unpublished representation valid:** Yes.
- **publishable under current schema:** Yes after explicit approval/selection.
- **blocker if any:** None specific to the staged record; a future publisher must retain the source-side-vs-paper-audit caveat.

#### FINAL AUDIT RESULT

`READY_TO_STAGE`

## NEEDS_EDIT

None. Required source/adjudication edits have been incorporated into the staging proposal.

## BLOCKED

No claim is blocked from offline staging. Production release remains blocked by the preview authorization exposure described under Governance verification.

## Prior-review rejections

None among the eight audited claims. The following deferred claims are intentionally absent and were not re-audited or staged:

- `DRV1-002`
- `ABCA-LB-001`
- `ABCA-LB-002`
- `SCI-001`

This ensures the deferred ABCA approach claims and SCI-001's unsupported 8%/11% assertions do not enter the pack.

## Cross-claim policy issues

### DRV1-001 vs BLM-001

The open `cueing-philosophy-internal-vs-external` contradiction is present on both records. DRV1-001 is a broader cue-language principle. BLM-001 is a source-specific mechanical/posture drill claim. BLM-001's internal-focus wording is stored as `source_coaching_cue`, while the production-facing `coaching_cue` is null. The two records are not normalized, merged, or used to invalidate each other.

### Drill prescription vs mechanical truth

- TAN-001 is context-bound softball barrel-path guidance and avoids generic arm-extension/casting language.
- GAS-001 remains a short-source softball timing drill prescription.
- ABCA-YT-002 remains a youth medicine-ball drill with explicit equipment and readiness exclusions.
- BLM-001 remains a controlled drill/posture claim with no proprietary sensor dependency.

None becomes a universal mechanic.

### Sport transfer

- Baseball-only: DRV2-001, ABCA-YT-001, ABCA-YT-002.
- Softball-only: TAN-001, GAS-001.
- Both only where expressly supported: BLM-001, SCI-002, DRV1-001.

No sport-specific record was silently broadened.

### Youth generalization

`youth_appropriate` describes applicability, not universal safety or readiness. ABCA-YT-002 carries balance, joint-screening, equipment-weight, and no-adult-substitution exclusions. Other youth records remain context-scoped.

### Evidence integrity and product domain

- No unsupported Chad Miller numeric assertion is staged.
- No proprietary Blast metric is staged.
- DRV1-001 distinguishes verified source-side citations from an unperformed independent paper audit.
- Source trust is not broadened beyond individual verified materials.
- Deferred approach/mental-game candidates are absent.
- SCI-002 stays qualitative and `biomechanical_explanation`.

## Evidence mapping verification

The implementation's `mapResearchEvidenceType()` is deterministic and throws for unmapped labels. Code and its three unit tests agree on all mappings:

| Research label | Production label | Result |
|---|---|---|
| coaching_instruction | coaching_experience | PASS |
| coaching_heuristic | coaching_experience | PASS |
| research_supported | research | PASS |
| expert_opinion | expert_opinion | PASS |
| drill_prescription | drill_prescription | PASS |
| biomechanical_explanation | biomechanical_explanation | PASS |

The migration and runtime vocabulary both include `drill_prescription` and `biomechanical_explanation`. Unknown values fail closed in mapping and runtime payload parsing.

## Production-state verification

### Before audit test execution

Read-only local Supabase queries returned:

- `methodology_claims`: 0
- `methodology_versions`: 1
- `methodology_version_items`: 0
- Active version: `k-0.1.0`, `published`, `active = true`

### Files protected from this audit

- `knowledge/claims.json`: unchanged and still empty.
- `knowledge/version.json`: unchanged at active `k-0.1.0`.
- No analysis prompt, analysis policy, Gemini production configuration, migration, admin implementation, or RLS file was modified by this audit.

### Test results

- TypeScript build/typecheck: **PASS**.
- Evidence mapping tests: **3/3 PASS**, including unmapped-label failure.
- Legacy non-DB governance/prompt tests reached before DB failure: **11/11 PASS**.
- Full `npm test`: **PASS with local Supabase access enabled** — 149 passed, 1 skipped because `psql` is not on `PATH`, 0 failed (150 total tests).
- Methodology tests: **29/29 PASS** — 20 schema/governance integration tests, 6 repository/runtime tests, and 3 evidence-mapping tests.
- The first sandboxed attempts were denied local connections (`EPERM`/`fetch failed`). They are not counted as application failures; the permitted rerun completed successfully against the same local stack.
- No dedicated admin API test suite was found. Admin API/UI behavior was inspected statically.
- The successful suite exposed a cleanup bug: it left one `TEST-FULL-*` claim plus its admin material/source and left `k-0.1.0` marked `retired` while active. Those exact local test artifacts were removed and the baseline status restored; no seed claim or release was created.

### After audit test execution

Final readback after scoped test-fixture cleanup:

- `methodology_claims`: 0
- `methodology_versions`: 1
- `methodology_version_items`: 0
- Active version: `k-0.1.0`, `published`, `active = true`

No seed claim or real release entered the database.
