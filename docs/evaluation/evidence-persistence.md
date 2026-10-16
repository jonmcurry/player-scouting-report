# PR9 evidence assessment persistence

PR9 adds storage only. It does not call the PR8 assessor, change processing
state, invoke an AI provider, create claims, alter a report, enable a flag, or
backfill any row.

## Schema

Migration `00065_clip_evidence_assessments.sql` implements Revision 2 S0-09.
`public.clip_evidence_assessments` records a UUID, clip FK, the exact six-part
version tuple, mode, clip status, optional family reason, V1 subject JSON, V2
event JSON, the historical strict comparator JSON, lowercase SHA-256 source
identity, backfill marker and creation time. Its latest-per-clip index is
`(video_clip_id, created_at desc)`.

The accepted modes are exactly `off`, `shadow`, and `enforce`; statuses are
exactly `eligible` and `withhold`; family reasons are exactly
`batter_unclear`, `swing_unclear`, and `analysis_version_unavailable`. PR8's
strict comparator can separately report `engine_unknown`, and PR8 documents
that Revision 1 supplied no family mapping for G8. PR9 does not widen the S0-09
family contract to hide that mismatch. A strict result belongs inside
`strict_baseline`, while `family_reason` remains null when no allowed
dimensional family reason applies.

The three assessment JSON columns follow the exact S0-09 contract: non-null
JSON, without a migration-level object-type constraint. Their internal shape is
versioned by the recorded tuple and validated by the assessment producer before
future insertion. `analysis_runs.provider_usage` and `issues.claim_decision`
have the plan's explicit nullable-or-object constraints.
JSON scalar `null` is deliberately rejected by those checks; absence is SQL
`NULL`. S0-09 specifies independent status and family checks, so PR9 does not
invent a cross-column rule forbidding a family on an eligible record. Future
producers remain responsible for writing semantically coherent assessments.

Existing public rows remain valid because `analysis_runs.evidence_assessment_id`,
`analysis_runs.provider_usage`, and `issues.claim_decision` are nullable and
receive no backfill. The evidence FK uses `ON DELETE SET NULL`. Demo mirrors
those three nullable columns, with the same JSON checks and no evidence table or
FK. Demo therefore remains on its legacy report policy.

## Privacy and append-only behavior

RLS is enabled with no policies. `public`, `anon`, and `authenticated` have no
table privileges. `service_role` may select and insert but has no UPDATE, DELETE,
or TRUNCATE grant. Owner-level triggers independently reject those mutations, so
append-only behavior does not rely on RLS or grants alone. No new view,
RPC, endpoint, report payload, or family/coach read policy exposes the table.

The row DELETE trigger permits deletion only after the referenced clip is no
longer visible in the deleting transaction, which is the state produced by the
`video_clips` FK cascade. A narrow `video_clips` BEFORE DELETE trigger first
clears retained `analysis_runs.evidence_assessment_id` links. This handles the
otherwise unsafe ordering between the clip's `ON DELETE SET NULL` path and the
assessment's `ON DELETE CASCADE` / run's `ON DELETE SET NULL` path. It changes no
other run data. The existing `begin_clip_deletion` / `finish_clip_deletion`
workflow then deletes the assessment and leaves the provider run with both
nullable links cleared.

This mechanism cannot distinguish the approved deletion RPC from another
privileged deletion of the parent clip: every valid parent deletion must be
allowed to cascade. Existing controls on `video_clips` remain the authority for
starting deletion. Direct assessment mutation is blocked for service-role and
the table owner. A PostgreSQL superuser can always disable triggers; preventing
that is outside an application migration's trust boundary.

## Validation

The integration suite ran against a separate `pr9_disposable_test` database in
the local Supabase PostgreSQL 17.6.1 container. It was created from a schema-only
clone of the local 62-migration database, migrations 00063 and 00064 were then
applied, followed by 00065. An explicit marker and exact database-name guard
prevent the test from targeting the ordinary local database. The schema restore
omitted two unrelated `realtime.list_changes*` functions because the image
refused their restricted `log_min_messages` setting; public/demo application
schemas and every dependency used by PR9 restored successfully.

All 23 PR9 database tests pass: application/ledger, existing rows, valid and
invalid tuples, hashes, family reasons, JSON checks, RLS/table grants, privileged
append-only behavior, FKs, demo columns, parent-facing absence and the complete
two-stage clip-deletion cascade. Migration numbering, PR2 curation tests, PR7's
61 tests, PR8's 94 tests, TypeScript build, evaluation isolation and the 15-test
demo real-fixture suite pass.

The PR4 privacy command and therefore full `npm test` stop at `check:no-media`:
the then-current HEAD (the exposed screenshot commit, since replaced) independently committed 14 screenshot files without
media-allowlist entries. PR9 adds no media and does not modify that unrelated
commit. The remaining media-guard unit cases report 53 pass, 1 repository-state
failure and 3 platform skips; the remaining 62 privacy tests pass. No production
or staging migration was applied.

Native Deno is unavailable on this host. PR9 changes SQL and Node integration
tests only; no Edge Function source changed. PostgreSQL integration is verified,
while native Deno/Supabase bundling remains outside this PR's executed checks.

## Independent review

The repository orchestrated QA wrapper completed with Gemini 3.8 Flash (High):
`.git/gemini-review/review-20261014-101113-719e29.md`. It reported no blocking
findings. Its suggested partial index on the new `analysis_runs` FK was added to
avoid sequential scans during link cleanup and referential actions. The review's
two judgment calls—independent status/family checks and rejection of JSON scalar
null—retain the exact S0-09 contract as described above. Its note that revoked
trigger-function access makes direct authenticated clip deletion fail closed is
consistent with the existing service-role deletion RPC design. No personal-data
leak, RLS bypass, cascade defect, migration-order issue, or production behavior
change was found.
