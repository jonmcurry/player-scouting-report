# Drill curation integrity — PR2 / S0-02 + S0-03

## Migration identities and preflight

| Version | Behavior |
| --- | --- |
| 00062 | `video_processing_progress.sql`, unchanged |
| 00063 | `drill_library_candidates.sql`, replaces the duplicate drill migration; 90 global drafts in each of public/demo; no curator or approval timestamp |
| 00064 | `drill_curation_reviewers.sql`, reviewer allowlist, approval RPC, audit, and trigger protection; no seeded reviewers |

Read-only preflight on 2026-10-11 found one local PostgreSQL container, `supabase_db_softball_analysis` (54322). Its application database ends at **00035**: neither duplicate 00062 was applied, and neither processing-progress nor curation columns exist. Its other connectable databases (`_supabase`, `storage_vectors`) have no application migration history or drill table. No existing database was reset, repaired, or migrated. No hosted database was accessed.

Actual Supabase CLI **2.117.0** behavior, tested only on a disposable database at loopback 55432:

- The original migration set applies through 00061, then attempts the alphabetically first duplicate, `00062_approved_drill_library.sql`. That file fails parsing on an unescaped apostrophe in an array value. The new generator correctly escapes strings and typed arrays.
- Two minimal valid `00062` files are both attempted; the second fails `schema_migrations_pkey`, SQLSTATE 23505. The CLI does **not** reject duplicate filenames before execution.
- Corrected `db reset --db-url <disposable-loopback-url> --no-seed --yes` applies **00001–00064**, exactly 64 history rows. Both candidate sets have 90 drafts and zero approvals.

The new `check:migrations` guard rejects duplicate numeric prefixes (including alternative zero padding), malformed SQL filenames, and empty migration directories. `npm test` runs it.

### Repair matrix for future authorized application

Inspect both history and schema; a migration number alone cannot identify which duplicate ran.

| State | Action |
| --- | --- |
| 00062 absent | Apply corrected ordered migrations under normal release authorization. |
| 00062 recorded, progress columns present | Retain history; apply 00063/00064. |
| Drill file recorded as 00062, progress absent | Stop; obtain approval for migration-history repair or disposable reset. Never silently mark missing progress work applied. |
| Old automated approvals exist | Inventory provenance before publication. This PR does not certify placeholder/first-user approvals or bulk-reset genuine approvals. The owner must reconcile uncertain legacy records separately. |

Repeated candidate SQL/imports update **draft content only**. Existing approved/rejected content and review metadata are preserved. No historical focus/report/assignment records are rewritten. Migration 00064 is applied once through normal migration history, not manually replayed.

## Security model

`curation_reviewers` records an Auth user id, role, qualification, provisioning identity/time and revocation time. Only service clients can insert/update it; authenticated users can read their own entry. Concept reviewers cannot approve drills. No importer grants reviewer privileges.

`get_drill_review` returns the complete server-projected content and SHA-256. `approve_drill` requires an authenticated JWT, non-null `auth.uid()`, an active drill curator, an approved/rejected decision and an exact current hash. Identity is never a client parameter. Row locks serialize content changes, approvals and revocation. Hash input includes every display, safety and selection field, including future fields, excluding only id/team_id/created_at and review metadata. Changes to id/team_id independently invalidate approval.

The RPC creates a **private, single-use authorization record** bound to transaction id, backend pid, schema, drill id, hash, reviewer and decision. The trigger consumes it; the RPC also clears any remainder. No caller-controlled transaction flag grants authority. `curation_private` grants no access to anon/authenticated/service_role. RPC and protection-trigger functions are owned by postgres, use SECURITY DEFINER, empty search paths and qualified references. Reviewer RPC execution is granted only to authenticated. Direct service-role writes, NULL-role sessions and spoofed flags cannot approve. Database owners who deliberately change DDL remain trusted administrators; no trigger can prevent superuser compromise.

Append-only audit rows retain content snapshots, hash, actual reviewer, decision, timestamp and notes. API roles cannot insert/update/delete/truncate them. Ordinary owner UPDATE/DELETE/TRUNCATE also fails. Audit identity survives drill deletion; Auth user deletion cannot cascade away audit records.

Public and demo have equivalent triggers. Material edits to approved/rejected rows return them to draft with cleared review metadata. A global public decision mirrors to the global demo row of the same slug **only when content hashes match**, with its own audit row in the same transaction. Mismatched demo content stays unchanged; resolve the difference and review again. Team drills are not mirrored across unrelated teams.

The importer uses conditional draft updates, including after concurrent insert collisions. Reviewed rows are skipped rather than overwritten. Simplified reports retain their existing approval filter; legacy family/demo report shaping now also excludes draft/rejected/missing/null review status. Historical assignments remain intact.

## Product-owner reviewer runbook

Verify a real reviewer's qualifications and Auth identity before provisioning. From an authorized service administration session, or an explicitly authorized database-owner session:

```sql
insert into public.curation_reviewers(user_id, role, qualification, added_by)
values ('<reviewer-auth-uuid>', 'drill_curator', '<verified qualification and approval reference>', '<owner-auth-uuid>');
-- Revoke without deleting prior decisions:
update public.curation_reviewers set revoked_at = now() where user_id = '<reviewer-auth-uuid>';
```

Trust provisioning is separate from importing. Never give a reviewer a service key, manufacture a reviewer JWT, reuse another person's session, or bypass review with transaction settings.

```sh
# Set SUPABASE_URL and SUPABASE_ANON_KEY (or SUPABASE_PUBLISHABLE_KEY).
npm run review-drill -- --email reviewer@example.com --drill-id <uuid>
```

The CLI requires an interactive terminal, confirms the database/email, sends an email OTP with account creation disabled, signs in as that person, displays content/hash and requests an explicit decision and notes. Inspect the linked demonstration and every safety field before deciding. Stale content fails and must be reviewed again. The CLI rejects service/secret keys, uses no service client, disables persistent sessions and signs out on exit.

The Auth sign-in email template must display the OTP code for this code-entry flow (rather than only a magic link). Confirm that configuration under separate environment-change authorization. Email delivery and a real human review session remain operational checks before use; no real reviewer was contacted during these tests. The real API integration suite instead uses signed synthetic JWTs against isolated PostgREST, including tampered-token rejection.

## Disposable test setup

`npm test` needs no database. The explicit database suites require fresh disposable infrastructure:

```sh
PR2_SQL_CONTAINER=codex-pr2-sql npm run test:drill-curation:sql
PR2_SQL_CONTAINER=codex-pr2-sql node --import tsx --test supabase/tests/drillCurationRest.test.ts
```

Tested images: `public.ecr.aws/supabase/postgres:17.6.1.166` and `public.ecr.aws/supabase/postgrest:v14.5`. Use cached images where available. Never run these against the existing development stack.

1. Create a **new** PostgreSQL container named `codex-pr2-sql`, loopback port 55432 and a test-only password. Copy config/migrations to a scratch workdir. The standalone image needs the Auth helper `auth.jwt()` reading JSON from `request.jwt.claims`; a full Supabase stack already has it.
2. Apply migrations using the installed CLI's `db reset --workdir <scratch> --db-url 'postgresql://postgres:<test-password>@127.0.0.1:55432/postgres?sslmode=disable' --no-seed --yes`. The CLI calls this URL target “remote”; it is strictly the disposable loopback container.
3. Confirm the target is disposable, then create schema `pr2_disposable_test`. SQL tests require this marker and roll back every fixture.
4. Clone the pristine database to `pr2_rest_test` in that same disposable container. If background connections prevent cloning, briefly disallow connections and terminate them **only in the disposable source**, using `supabase_admin`, then restore connections.
5. Start separate PostgREST on loopback 55431, DB URI pointing to `pr2_rest_test`, exposed schemas `public,demo`, anon role `anon`, and JWT secret `pr2-disposable-test-secret-at-least-32-characters`. Wait for the schema cache to load before running the API suite. The test client adapts Supabase's gateway prefix to direct PostgREST.
6. API tests reproduce the locally inspected modern Auth claim helper definitions in the clone, then persist synthetic users/reviews there. Use a **fresh clone per run** because approvals are append-only. Remove only disposable containers/network afterward.

## Scope and verification record

PR1 remains uncommitted/unstaged and its baseline tag unchanged. The supplied implementation plan is preserved. Version 0.52.0 / Android code 72 identifies PR2; both lockfiles' root metadata was still 0.50.2 while package manifests were 0.51.0 and is synchronized with this release. No mobile UI changed or emulator deployment occurred.

No pose3d code, engine version, model, AI prompt, evidence gate, historical focus/report record, production data or hosted service changed. No commit, push, tag publication or deployment occurred. PR3 has not begun.

## Exact PR2 file inventory

PR1's baseline files and the supplied implementation plan are **not** PR2 changes. Shared `package.json`/`NEXT_STEPS.md` retain the pre-existing PR1 edits; nothing is staged.

Added:

- `docs/architecture/DRILL_CURATION.md`
- `scripts/check-migration-versions.mjs`
- `scripts/check-migration-versions.test.mjs`
- `src/cli/importCuratedDrills.test.ts`
- `src/cli/reviewDrill.ts`
- `supabase/migrations/00063_drill_library_candidates.sql`
- `supabase/migrations/00064_drill_curation_reviewers.sql`
- `supabase/tests/drillCuration.test.ts`
- `supabase/tests/drillCurationRest.test.ts`
- `supabase/tests/drillReport.test.ts`

Removed/replaced by 00063:

- `supabase/migrations/00062_approved_drill_library.sql`

Modified:

- `CHANGELOG.md`
- `NEXT_STEPS.md`
- `package.json`
- `package-lock.json`
- `mobile/package.json`
- `mobile/package-lock.json`
- `mobile/android/app/build.gradle`
- `src/cli/importCuratedDrills.ts`
- `src/services/db/developmentFlows.test.ts`
- `src/services/development/drillCandidateParser.ts`
- `src/services/development/drillCandidateParser.test.ts`
- `supabase/functions/_shared/familyReport.ts`
- `supabase/functions/get-demo-player-report/index.ts`
- `supabase/functions/get-player-report/shape.ts`

### Validation commands and outcomes

- `npm test`: **305 passing test executions**, zero failures (12 baseline, 3 migration guard, 10 focused drill/report, 32 compiled including 4 importer tests repeated, 248 existing UI/brand tests).
- `PR2_SQL_CONTAINER=codex-pr2-sql npm run test:drill-curation:sql`: **19/19 pass**.
- `PR2_SQL_CONTAINER=codex-pr2-sql node --import tsx --test supabase/tests/drillCurationRest.test.ts`: **1/1 API integration passes**, covering inserts/updates, repeated imports, JWT tampering, review identity, revocation and demo parity.
- `node --import tsx --test src/services/db/developmentFlows.test.ts` using a temporary loopback gateway adapter and synthetic service JWT for the disposable API: **6/6 pass**.
- Existing `supabase/tests/simplifiedFoundations.smoke.sql` through `psql -v ON_ERROR_STOP=1`, wrapped in BEGIN/ROLLBACK on the disposable database: **pass**.
- `git diff --check`: **pass**. Baseline guard verifies the original 13-file pose3d tree; progress migration has no diff.

No rendered UI work was performed; visual QA is not applicable. Real email OTP delivery and human review remain unverified operational steps. Existing database and production migration application are deliberately unperformed.

### Independent review and reconciliation

Repository `Invoke-OrchestratedQA.ps1` / Gemini `gemini-3.1-pro-high` completed the scoped implementation review on 2026-10-12. Two shorter attempts timed out without findings; the final run with the wrapper's standard 600-second allowance completed. Review evidence: `.git/gemini-review/review-20261012-061645-034c93.diff` (local, untracked). No independent test execution is claimed; Codex ran the tests above.

**BLOCKING: none.** Three NON-BLOCKING notes were independently evaluated:

1. **Demo mismatch is not reported by the RPC response.** Confirmed operational limitation. Leaving a mismatched row unchanged is expressly required by S0-03; the mismatch test proves no approval/audit is fabricated. The RPC returns the public decision id, not a mirror-success claim. The runbook documents this behavior; no unsafe automatic synchronization was added.
2. **Report `curation_status` is optional in the input type.** Kept intentionally for a defensive boundary: missing/null status must be treated as unapproved. Both real upstream queries now select the column and the report regression test verifies missing data is excluded. Supabase query results are dynamically shaped; a required interface field alone would not guarantee a database projection.
3. **CLI decisions require exact lowercase tokens.** Kept intentionally: the prompts specify the accepted words and state that other decision input cancels. No accidental input records an approval. Case normalization is optional UX polish, not an authorization defect.

One **QUESTION / JUDGMENT CALL** concerned coach-created team drills. Resolved by the user's explicit requirement that only approved drills appear in reports and only qualified allowlisted reviewers approve. Assignment by a coach is not an exception. An active qualified curator can approve team drills through the same RPC; no cross-team demo mirroring occurs.

No confirmed defects required code changes after review. Remaining operational checks: real reviewer email OTP configuration/delivery and authorized future application to existing environments. Unknown legacy approvals elsewhere require provenance review before publication; no such approvals were present in the accessible existing local database.
