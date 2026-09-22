# Methodology Admin Runbook

This covers the HitterLoop global hitting-methodology knowledge system: the
`methodology_*` tables (`supabase/migrations/00029_methodology_knowledge.sql`),
the `/admin/` internal tool, and the runtime path that consumes what gets
published (`src/services/knowledge/methodologyRepository.ts`, used by
`src/cli/analyze.ts`).

**A methodology release is not an app release.** Publishing a new version
through `/admin/versions.html` takes effect the next time `analyze` runs -
no Android rebuild, no PWA redeploy, no version bump anywhere in
`coach/`/`mobile/`.

## Architecture in one line

```
source -> material -> candidate claim -> human review -> approved claim
   -> preview -> publish -> one active immutable snapshot -> analysis prompt
```

Only the frozen `methodology_version_items` of the **one active**
`methodology_versions` row is ever read at runtime. Candidate, rejected,
disputed, duplicate, and superseded claims never reach a prompt - see
`loadActiveMethodologySnapshot()`.

## Access

Methodology admin is a separate, global allowlist
(`methodology_admins`) - it is **not** a coach/head-coach role and it does
**not** grant team/player data access, in either direction. Grant it to an
existing Supabase auth user:

```
npm run provision-methodology-admin -- --email you@example.com --grant
npm run provision-methodology-admin -- --email you@example.com --revoke
```

Then sign in at `/admin/index.html` with that account.

## Source-review standards

- `trust_status` is never a blanket "trusted". Use `approved_for_scope` to
  mean "useful within the documented `topic_strengths`/`sport_scope`/
  `level_scope`/`limitations_notes`" - not universal authority.
- `limited` / `do_not_use` are real, expected outcomes, not failure states -
  record why in `limitations_notes`.
- Deactivating a source (`active = false`) only stops it from being used for
  *future* material entry. It never retroactively changes a published
  snapshot - those already hold frozen, denormalized source/material
  provenance in their `item_payload`.

## Claim-review standards

- `approved_text` is a human-authored/edited version kept **separate** from
  `extracted_text` (the original, preserved as-is).
- Be conservative on `age_guardrail`: unknown or youth-adjacent applicability
  defaults to the most conservative guardrail at runtime regardless of what
  you pick here (see `filterApplicableMethodology`), but pick accurately -
  don't mark elite/advanced-only mechanics `youth_appropriate`.
- A numeric claim (`numeric_claim = true`) cannot be approved without
  `numeric_evidence_ref`.
- A video-material claim cannot be approved without either a source
  timestamp (`source_start_seconds`) or an explicit, verified
  `source_location` note.
- Contradiction is expected and fine - use `contradiction_group`/
  `contradiction_state` rather than forcing one "correct" doctrine. An open
  contradiction must not become universal guidance; resolve or scope both
  sides before either reaches production.
- Drill linkage (`related_drill_id`) is deliberately out of the v1 review
  workflow - do not treat "the source recommends a drill" as "HitterLoop
  should assign this drill." That's a separate, later curation step.

## Publish workflow

1. `/admin/versions.html` shows a live preview (`preview_methodology_snapshot()`)
   of exactly what the next publish would freeze, diffed against the current
   active snapshot.
2. Publishing (`publish_methodology_snapshot`) is atomic: it freezes
   approved+active claims into a new immutable `methodology_version_items`
   row set, deactivates the previous version, and activates the new one, all
   in one transaction. A failure leaves the previous snapshot active.
3. Version labels are never reused (`k-0.2.0` can never be published twice)
   and a published snapshot's `item_payload` is never edited or deleted -
   enforced by revoked grants, not just policy.

## Hotfix workflow

If an **already-published**, currently-active claim turns out to be
wrong/unsafe:

1. On `/admin/knowledge.html`, click "Deactivate (hotfix)" on that claim (or
   use `/admin/claim.html`'s dispute/reject action). This disputes the claim
   and sets `active = false` - it does **not** touch the already-frozen
   historical snapshot, which stays exactly as published.
2. Publish a new version on `/admin/versions.html` (e.g. `k-0.2.0` had the
   problem -> publish `k-0.2.1`). The new snapshot simply excludes the
   deactivated claim.
3. The old `k-0.2.0` snapshot remains readable/auditable forever; it is
   simply no longer active.

## Rollback workflow

Rollback is **never** "reactivate an old version label." It is always
publishing a **new** version whose claim set matches the desired historical
state:

```
k-0.1.0 (baseline)
  -> k-0.2.0 introduces a bad change
  -> k-0.2.1 publishes the safe k-0.1.0 claim set again, as a NEW label
```

An analysis run performed after the rollback records `k-0.2.1`, not
`k-0.1.0` - this keeps operational history honest and auditable: you can
always tell, from `analysis_runs.knowledge_version` alone, exactly which
real publish event produced a given run's guidance.

## Editing a published claim

You cannot edit a published claim's `approved_text` in place -
`review_methodology_claim` refuses a re-approval once a claim has been
frozen into any `methodology_version_items` row. `/admin/claim.html` offers
"Create superseding candidate" instead: a fresh `candidate` row with
`supersedes_claim_id` pointing at the original, which goes through the full
review -> approve -> publish cycle again.

## Fail-closed behavior

If `methodology_versions` has no `active = true` row, `analyze` refuses to
run rather than falling back to candidate claims, `knowledge/claims.json`,
or model-pretraining knowledge - it raises a clearly labeled error. Per the
existing non-fatal per-clip boundary in `processUploadQueue.ts`, this is
logged clearly and the clip remains ready for a retry rather than crashing
the worker. Always keep at least one version active (the empty `k-0.1.0`
baseline if nothing else has been approved yet).

## Out of scope (for now)

No Gemini/AI extraction, no automated YouTube discovery, no scheduled
ingestion, no automatic claim approval or publication, no embeddings/vector
search, no drill auto-linking, no changes to `metrics`/
`reconstructionSupplied`/3D integration. The first methodology seed (~10
source videos, ~8-12 approved claims) is entered and reviewed entirely by
hand through `/admin/`.
