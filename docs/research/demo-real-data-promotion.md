# Promoting curated real footage into the public demo

**Status (2026-09-24): LIVE.** The canonical public demo fixture at
https://joncurry.co/hitterloop/demo/ is `emily@2026-09-24.3` (activated 16:23 UTC).
It replaced `emily@2026-09-24.2` (activated 15:34 UTC), which stays stored as the
rollback target.

`.3` is `.2` with every swing-metric value withheld (`publishAsUnknown.videoClipMetrics`)
and the unreviewed AI "no action needed" conclusion withheld (`publishAsUnknown.analysisRun`).
Why the metrics went:
- contact confidence is "limited" on 4 of 5 clips;
- handedness is "limited" on all 5;
- 3D reconstruction is "limited" on 4 of 5;
- there are known artifacts (clip-004 attack angle 85.5°; `wrist_lead_ms` is -301.3 on three clips);
- the human review marked every related checkpoint insufficient evidence.

`.3` reuses `.2`'s five approved media files and filenames (`mediaFileVersion`), so no media byte or URL changed.
It was derived from the released `.2` export rather than re-exported, because the local Docker stack was down.
The same withholding semantics were applied, then `fixtureContentSha256` and `validateFixture` were re-run.
Only the withheld fields differ from `.2`.
Publication consent is recorded locally, in the gitignored manifest. The
rollout below was executed as follows:

- **Cloud project `rjnpaqsqslvzkwwwqmze`:** migrations 00036-00040 applied.
  - No rows needed conversion: `public` had no checklist rows, and 264 reviewed demo rows became `verified`.
  - Every demo/public function, constraint and policy matches the local stack once CRs are stripped. The only extra object is the platform's `rls_auto_enable`.
- **Edge Functions:** `get-player-report` v1 and `get-demo-player-report` v2 deployed.
- **Fixture:** stored inactive, verified with a rolled-back clone, then published atomically.
- **Old sessions:** 6 fictional-era sessions retired. The fictional seed stays as the rollback target.
- **Website:** `personal` commits `9cdfbc8` and `1458d6a` deployed (Cloudflare version `83822f72`).
  - The live media match the approved sha256 byte for byte.
  - The fixture import went through `supabase db query --linked`, calling the same `load_real_fixture` / `publish_demo_canonical` RPCs after the CLI's own `readAndCheckFixture` pre-check. This avoided writing a service-role key to disk.

**Rollback:**
- **Pointer:**
  - `select demo.publish_demo_canonical('emily', '2026-09-24.2');` returns to the previous Emily version (same media files).
  - `select demo.publish_demo_canonical(null, null);` returns to fictional.
  - `select demo.publish_demo_canonical('<id>', '<version>');` returns to any stored version.
  - Then run `select demo.retire_noncanonical_sessions();` (fixture pointers only).
  - The Emily fixture stays stored (it can't be deleted while published, and must never be deleted as evidence).
  - Both directions were tested live inside a rolled-back transaction.
- **Website:** `npx wrangler rollback addccda9-2cb1-40ee-b756-57ea146f12e0` (the pre-Emily version), in the `personal` repo.
- **Do not revert 00040 blindly.** Once real coach data uses the `insufficient_evidence` / `rejected` states, dropping the column loses those human decisions. Fix forward instead.

**Known issues found live (not fixed):**
- **Range requests:** the Cloudflare asset layer ignores `Range` and always returns 200 with the full file. Edge plays the clips; iOS Safari playback is unverified.
- **Bare `*.html` URLs:** the service worker precaches `./team.html` and the other pages, and the host 307-redirects them to extensionless URLs. So a bare `*.html` navigation with no query string fails once the worker is installed. The app's own links always carry a query string.

**Resolved in 0.25.0 / `.3`:**
- **Metrics:** Compare and Review now label 2D values "2D video estimate · not calibrated", with units, and show an honest empty state. The demo publishes no metric values.
- **Review no-finding state:** it reads "No reviewed findings for this swing".
- **Report drill copy:** it matches the confirm-then-recommend workflow.
- **Project page:** it no longer calls the demo fictional.

> **Media (2026-09-24):** real clips are published only as
> privacy-treated video (bystanders anonymized) with a human approval bound
> to the exact file. See [demo-privacy-video.md](./demo-privacy-video.md).
> The exporter's default `mediaPolicy` is `"privacy-treated"`, and rollout
> step 3's website `--media` sync refuses anything else.

> **Released state (prepared 2026-09-23, live 2026-09-24):**
> - **Public values:** "Emily" / `emily`, team "10U Softball", reviewer "Coach". Opponents, results, counts, outcomes and swing fields are declared unverified (`publishAsUnknown`) and published as unknown.
> - **Checklist:** two coach-verified checkpoints (Stance & setup = 3, Load = 3); the rest are reviewed insufficient evidence (published as such) or rejected (never published). This uses the checklist review states from migration `00040`.
> - **No coaching conclusions:** 0 findings, priorities, drills, practices or progress claims.
> - **Clips:** `ab1_1` is approved video but unanalyzed.
>
> Emily is not anonymous: her face, build, equipment and #10 remain visible.

## Emily-only canonical model (migrations 00037-00039)

- **One published fixture, not an append.** `demo.demo_canonical` is a
  single-row pointer with two modes:
  - `fixture` + `(fixture_id, fixture_version)`: every new or reset visitor
    gets exactly one team built from that fixture's own team block, with
    exactly its one player.
  - `fictional`: the old Harbor City Hawks narrative, kept **only** as an
    explicit rollback target.
- **Fail closed.** If the pointer names a fixture that can't be cloned,
  `start_demo_session()` raises an error. It never falls back to fictional
  data. A published version can't be deleted (FK `on delete restrict`).
- **Immutable versions.** Fixtures are keyed by `(fixture_id,
  fixture_version)`. Re-loading the same version with different content is
  refused. Loading never publishes; `publish_demo_canonical()` re-verifies
  the payload and switches the pointer atomically.
- **Consent guard (00038).** `assert_fixture_publishable()` refuses to
  store or publish a fixture that lacks `curation.consentRecorded`, or that
  is `localValidationOnly`. The one exception is a stack with a row in
  `demo.demo_dev_settings`, which is local only and never created by any
  migration.
- **The deployed state is unchanged until you act.** 00037 starts the
  pointer in `fictional` mode, so deploying the migrations changes nothing
  for visitors until a verified fixture is explicitly published.
- `retire_noncanonical_sessions()` ends sessions cloned from anything other
  than the current canonical dataset, such as fictional-era sessions after
  the switch. Those visitors simply get a fresh Emily-only clone on their
  next page load.

### Bugs found and fixed while processing real footage

1. **Phantom blank pitches (production bug, 00039).** `ingestPhases`
   saves each clip with `INSERT … ON CONFLICT DO UPDATE`, and Postgres
   fires the `link_new_clip_to_pitch_or_rep()` BEFORE INSERT trigger
   before it detects the conflict. So every processed clip whose at-bat
   had no unlinked pitch left behind a new, blank, orphaned pitch.
   - I reproduced it in a rolled-back transaction (3 → 4 pitches) and fixed
     it by returning early when the row already exists. A new clip still
     auto-links.
   - Emily's three phantom pitches were removed locally. Only rows that were
     provably blank and unlinked were deleted.
2. **First-visit bootstrap abort (frontend).** On a first visit,
   `sw.js`'s `clients.claim()` fires `controllerchange` with no previous
   controller, and `shared.js` then reloaded the page mid-bootstrap. That
   aborted `start_demo_session()`, which showed up as HTTP 499 at the
   gateway. The reload now happens only when an existing worker is replaced.
3. **Full-range video.** The phone HEVC is `yuvj420p` (full range).
   Transcodes now convert it to limited-range `yuv420p` (`out_range=tv`).
   The exporter's output probe rejected the first attempt.
4. **`devUi.js` called `getDemoConfig()` without importing it.** Found by a
   real-browser page-error listener. It's now fixed and guarded by a
   source test.

**Found, not fixed (production):** Review plays the ORIGINAL upload via
`get-video-url`, but phase times are relative to the pipeline's Stage 0
analysis window. So for any long upload that Stage 0 trimmed, production
phase markers seek to the wrong moment. The demo avoids this: each media
file is cut to exactly its analysis window, offset 0.

## Demo playback (frontend)

- In demo mode, `devUi.getVideoUrl()` reads `demo_media_path` and
  `demo_media_offset_s` and resolves them to `<basePath>media/<file>`
  (`/hitterloop/demo/media/…`).
  - The path is validated with the same safe-filename rule the database
    enforces.
  - The demo never calls `get-video-url` or any signing function.
  - A clip with no media, or with unknown alignment, keeps the explicit
    "No video published for this swing" state.
- `videoTimeFor(clipId, t)` applies the offset at every seek site: the
  Review phase markers, Compare's video and frames modes, and the skeleton
  viewer's original-video sync. It's 0 in production.
- `player.html` no longer calls `get-video-url` directly.
- The banner now reads "Public demo — read-only; your changes reset" (it
  used to say "fictional").
- Media filenames are version-stamped
  (`<fixtureId>-<fixtureVersion>-clip-NNN.mp4`), so a new version never
  overwrites or is served from the cache of old files.

## Rollout sequence (executed 2026-09-24; see the status above)

Preconditions: the worksheet is complete, the manifest passes (`npm run
export-demo-fixture -- --manifest demo-curation.emily.json`, with no
`localValidationOnly`), and you have reviewed the media and fixture.

1. **Database:** commit, link `rjnpaqsqslvzkwwwqmze`, `supabase db push`
   (00036-00039).
   - Verify with `supabase db diff --linked --schema demo` (expect no
     changes).
   - Check `has_function_privilege('authenticated', …)` is false for every
     clone, load, and publish function.
   - The pointer stays `fictional`; visitors see no change.
2. **Import the approved fixture, unpublished:** `import-demo-fixture
   --fixture demo-export/emily/fixture.json --allow-remote`. It is stored
   and verified by a scratch clone, and not visible.
3. **Publish media:** `node scripts/sync-hitterloop-demo.mjs --media
   <path>/demo-export/emily`, in the website repo. That command refuses
   unconsented exports and re-verifies every sha256.
4. **Sync the frontend:** the same sync run brings in the updated `coach/`.
   Update the project page's "fictional dataset" sentence (proposed text
   below).
5. **Cloudflare preview:**
   - All media files return `200` and `206` for byte ranges, with
     `Content-Type: video/mp4`.
   - Deep links resolve and the CSP allows them (`media-src 'self'` already
     covers same-origin media).
   - `noindex` is present.
   - The service worker doesn't intercept the media (it network-passes
     uncached same-origin GETs).
6. **Activate atomically:** `import-demo-fixture --fixture
   demo-export/emily/fixture.json --publish --allow-remote`. The reload is a
   no-op for an identical version, then one pointer update publishes it.
7. **Verify** with a fresh anonymous visitor: one team, one player, video
   plays, reset stays Emily-only.
8. **Retire:** run `import-demo-fixture --retire-stale --allow-remote` to
   end fictional-era sessions. The fictional clone function stays only as
   the rollback target.

Order 3→6 avoids any window where a visitor gets half-published data. The
media and frontend go live while the pointer still says fictional, and the
old frontend just shows fictional data with no media. The pointer flips
last.

**Rollback:** `import-demo-fixture --rollback-to <previous>@<version>`,
or `--rollback-fictional`. Either takes effect for every new or reset
visitor immediately. Media files are version-stamped, so older versions'
files can stay published until retired.

**Proposed project-page copy** (depends on your naming decision): "The demo
linked above runs the real coach app on real game footage of one player,
shared with permission. Each visitor gets a private, resettable copy.
Uploads and live analysis are turned off."

## Purpose

The public demo (joncurry.co/hitterloop/demo) runs on a fictional seeded
team. This pipeline adds real, locally analyzed swings to that demo. It never
replaces the fictional team, and it never makes the demo itself live (no
uploads, no live AI). Real footage is processed and reviewed locally. Only
explicitly curated, coach-approved records are exported, and each visitor's
demo team is cloned from them.

```
real video
  -> local HitterLoop processing (npm run process-upload-queue: pose3d + phases + metrics + AI drafts)
  -> local Supabase public.* + frames/<player>/<clip>/
  -> coach review in the local coach app (approve / edit / reject findings, confirm scores, priorities, practice)
  -> curation manifest (demo-curation.json: the clip allowlist + human-only metadata)
  -> npm run export-demo-fixture      -> demo-export/<fixtureId>/{fixture.json, media/, media-manifest.json, validation-report.json}
  -> npm run import-demo-fixture      -> demo.demo_real_fixtures (canonical clone source, DB-verified)
  -> publish (demo.demo_canonical)     -> every visitor's clone = the ONE published fixture (00037)
  -> public read-only demo
```

## Architecture decisions (00036, 2026-09-22; the canonical model was superseded by 00037 above)

**Canonical storage: a versioned JSON fixture stored in a DB table (Option A
stored the Option B way).** `demo.demo_real_fixtures` (migration 00036) holds
one JSON payload per fixture. It has RLS enabled and no client grants, the
same posture as `demo.demo_seed_templates`. `demo.clone_demo_dataset()` is
now a thin wrapper: the existing fictional narrative (renamed
`demo.clone_fictional_dataset`, body untouched) plus
`demo.clone_real_fixture()` for each active fixture. `start_demo_session()`
and `reset_demo_session()` did not change.

Why this option over the others:

- **Not a migration or a SQL fixture.** This repo is public, and a real
  athlete's data must never live in git. The fixture is loaded by a
  service-role CLI and can be versioned privately, never in a migration.
- **Not hand-written SQL.** `demo.clone_real_fixture()` is generic: it
  whitelists tables, assigns a fresh `gen_random_uuid()` per row per visitor,
  remaps every declared FK through a per-clone id map, and resolves
  reference data (checkpoints, swing phase types, global drills) by slug.
  Pose arrays stay as JSON or bytea hex in the payload, and adding a player
  is a data load, not a migration.
- **The database verifies every fixture.** `demo.load_real_fixture()`
  first runs the real canonical clone inside a savepoint that is always
  rolled back: the fictional seed, every other active fixture, and the
  candidate. Constraints, triggers, unique slugs, and reference resolution
  are all enforced by Postgres itself, and a fixture that would break any
  visitor's clone is never stored. The clone also rejects any row whose keys
  don't exactly match the real `demo.<table>` column set, so schema drift
  fails loudly. `jsonb_populate_record` would otherwise drop unknown keys
  and NULL missing ones without any error.

Each visitor's session is tagged with what it contains:
`demo_sessions.seed_version` becomes, for example, `v1+real-player-a@2026-09-22.1`.

### Migration 00036 (additive; applied locally only, not deployed)

- `demo.video_clip_metrics`: gets every real metric column, and
  `analysis_quality` changes from `text` to `jsonb` (production's type; the
  table had never held a row).
- `demo.video_clip_pose3d`: gains `lead_side` and `joints_blob`.
  `skeletonComparison.js` selects both, so that query could never succeed
  in demo mode before this.
- `demo.analysis_runs`: gains production's provenance columns (model, prompt,
  policy, knowledge, and pipeline versions, plus `input_manifest`).
- `demo.issues`: gains `analysis_run_id`, `finding_key`, `concept`, `basis`,
  and `ai_original`, which review.html's "See original draft" needs for
  edited findings. `demo.checklist_scores` gains `analysis_run_id`.
- `source` checks now allow `'claude'` (production 00024), so a
  claude-sourced finding can be promoted without rewriting its provenance.
- `demo.video_clips` gains `demo_media_path` (constrained to a bare safe
  `.mp4` filename) and `demo_media_offset_s`.
- `demo.game_log_entries.pitch`: a pre-existing compatibility gap.
  `player.html`'s `loadGameLog()` selects it, so the demo Game Log always
  showed "No recent game", including for the fictional seed.
- **Security hardening:** the pre-existing `demo.clone_demo_dataset(uuid)`
  was executable by every `authenticated` role through Postgres's default
  `PUBLIC` grant, verified with `has_function_privilege`. Any demo visitor
  could call this SECURITY DEFINER function directly and create unlimited
  orphan teams. Every clone and load function now revokes `PUBLIC`. **The
  live cloud project still has this gap until 00036 is deployed.**

## What gets exported (traced from the frontend)

The subtree matches the Phase 4 trace of every `.from()` in team, player,
at-bat, review, development, practice, compare, and report. Its source of
truth is `src/services/demoExport/translation.ts` (`ENTITY_SPECS`). Every
source column there is either copied, transformed, or explicitly omitted with
a reason. A new, unaccounted-for `public.*` column fails the export with
`SCHEMA_DRIFT`.

| Target `demo.*` table | Included when | Notable transforms and omissions |
|---|---|---|
| players | always (one per fixture) | `name`/`slug` come **only** from the manifest's `publicName`/`publicSlug`; `team_id` points at the visitor's team |
| game_log_entries | entry of an allowlisted clip | human fields can be overridden explicitly; `clip_gcs_path` and legacy `outcome` omitted |
| at_bat_pitches | all pitches of an included at-bat | overridable; counts, outcome, and swung are required for a pitch with a selected clip |
| practice_sessions / practice_repetitions | session of an allowlisted rep, focus of an exported priority, or referenced by an exported observation | `grouping` overridable; `assigned_drill_id` resolved by slug for global drills |
| video_clips | **allowlisted only**, status `ready` | `raw_gcs_path`, `error_message`, and queue bookkeeping reset; `demo_media_path`/`demo_media_offset_s` set |
| video_clip_metrics / video_clip_pose3d / swing_phases | selected clips | copied verbatim (including `joints_blob`); phase types by slug |
| analysis_runs | runs on selected clips, or referenced by exported findings | full provenance; the production-required fields are required |
| issues | `approved`/`edited` (drafts only with `findings.includeDrafts`, and still `draft`); **never** `rejected`; evidence clip must be allowlisted | `reviewed_by` becomes `reviewerDisplayName`; `knowledge_claim_ids`, `rejection_reason`, and internal flags omitted |
| checklist_scores / _history | **coach-reviewed (`reviewed_by` set) only**; AI-draft scores never | checkpoint by slug; coach names aliased |
| player_priorities (+ status history, drills, observations) | manifest `priorities`: `"all"` (non-archived), `"none"`, or a list of ids | auth-user columns and `ai_suggestion` omitted; FKs to unexported rows become null **with a warning** |
| drill_library | team-scoped drills referenced by exported rows | global drills are never copied, only referenced by slug |
| player_share_links | synthesized (`report.shareLink`, default on) | **never copied**: a fresh random token per visitor clone |

Not exported: `comp_recommendations`, `comp_notes`, `drill_recommendations`
(legacy, unreviewed AI output with no review state), coach profiles, and
anything from the methodology tables.

## Approval and curation rules

The schema reliably tells draft from reviewed, so this is not a blocker:

- **Findings (`issues.review_status`):** `draft` is raw AI output, `approved`
  is coach-accepted, `edited` is coach-edited (`ai_original` is preserved),
  and `rejected` is excluded. Only `approved` and `edited` appear as coaching
  conclusions. Drafts need an explicit opt-in and still render as "Draft from
  analysis". Rejected findings never leave the machine.
- **Checklist scores:** `reviewed_by IS NULL` means an AI draft, which is
  never exported. The team dashboard's `team_summary_stats` averages every
  score row, so a draft score would otherwise look authoritative there.
- **Priorities, observations, practice sessions:** coach-authored, included
  only as the manifest says.
- `ai_summary` on an at-bat is a deterministic facts summary that a coach
  chooses to save (`atBatFactsSummary`). No AI backend writes it, so it is
  exported as-is.

## Human-required metadata (never inferred)

The export fails with `HUMAN_*` errors when any of these are missing. They
can be fixed in the coach app or with explicit manifest `overrides`, and
every override is recorded in `fixture.curation.overrides`:

- publication consent (`publication.consentConfirmedBy` / `consentConfirmedAt`)
- the public display name and slug (the real name is never a default)
- `reviewerDisplayName` whenever any reviewed row carries a coach's name
- per clip: media trim bounds in source-video seconds, or an explicit `"full"`
- per game at-bat: date, opponent, AB number, and result
- per pitch with a selected clip: count before (balls and strikes), outcome, and swung
- practice reps: `grouping` (a default `free_swing` produces a warning; a
  missing baseline/post-drill pair fails `expect.comparePairs`)

Warnings, never guesses: missing `pitch_type`/`pitch_location`, unknown
handedness, a game clip not linked to a specific pitch, and unknown media
alignment.

**A manual check is needed for pitch links.** Production's
`link_new_clip_to_pitch_or_rep()` trigger (00027) links an unlinked game
clip to the first clip-less pitch automatically, or creates a blank pitch.
The exporter catches the blank-pitch case (missing counts and outcome). A
guessed link to an *existing* pitch looks the same as a confirmed one in the
DB, so the coach must confirm each selected clip's pitch on the at-bat page
before exporting. This showed up for real: the seed clip `maddie_r_ab2_fixture`
was auto-linked to a blank pitch, and the exporter refused it.

## Ids

Fixture ids are deterministic RFC 9562 v8 UUIDs:
`sha256("hitterloop-demo-fixture:v1", fixtureId, table, sourceId)`. That
gives no collisions across fixtures and byte-identical re-exports, so diffs
show only real changes. They exist **only inside the fixture**: the clone
assigns fresh random ids per visitor, and the validator fails if any local
source row id appears anywhere in the fixture (`LEAK_SOURCE_ID`). There are no
FKs into `public.*`.

## Media

`src/services/demoExport/media.ts` runs ffmpeg with fixed, reproducible
arguments (unit-tested):

- H.264 High, yuv420p, CRF 23, short side at most 720px, fps at most 60, `+faststart`
- trimmed to the manifest's `trim` window; anything over 30s needs `allowLongMedia`
- audio dropped unless the clip sets `includeAudio` (then AAC 128k stereo)
- `-map_metadata -1` plus bitexact flags. Phone GPS, make, and model tags
  are stripped, and the output is re-probed. Any surviving device tag, a
  wrong codec, audio that wasn't opted in, or a duration mismatch fails the
  export. The E2E test plants a GPS tag and checks it is gone.
- The source is read-only: the manifest's `sourceVideo`, or else the
  stored original downloaded from `raw_gcs_path` to a temp dir and deleted
  afterward. Its path is never written anywhere.
- `demo_media_offset_s = analysisWindowStart - trimStart`, which converts a
  phase's `time_s` (relative to the pipeline's analysis window) to a time in
  the media file. `analysisWindowStart` comes from
  `frames/<player>/<clip>/stage0.json` (only its numeric fields are read,
  because the file also records local paths) or the manifest. It stays null,
  with a warning, when Stage 0 tried several candidate windows and doesn't
  record which one succeeded.

On one machine the same inputs produced byte-identical media, verified.
Across machines, x264 output isn't guaranteed identical, which is why every
file's sha256 is recorded.

## Artifact layout

```
demo-export/<fixtureId>/          (gitignored - real data)
  fixture.json            the ONLY thing loaded into the database; content-hashed, hash re-checked on import
  media/<fixtureId>-clip-NNN.mp4   the ONLY publishable files
  media-manifest.json     LOCAL AUDIT ONLY: demo clip -> public filename -> source clip id/slug, trim, sha256 of source + output
  validation-report.json  LOCAL AUDIT ONLY: errors/warnings/exclusions/overrides + the consent record
```

Every real (non-dry) run starts from an empty directory, so a failed export
can never leave an older `fixture.json` next to a new failing report.

## Validation (fail closed)

Pure checks live in `validate.ts` and are shared by the exporter, the
importer, and the tests:

- exact target column sets and required fields
- unique ids, and FK resolution within the fixture
- reference data by slug
- orphaned entries
- pitch/rep/entry linkage and the one-source-per-clip rule
- the clip allowlist (nothing extra, nothing missing)
- media filename safety
- `raw_gcs_path` must be null and the share-link `token` must be null
- a leak scan over every string: local paths, repo-local directories,
  bucket URLs and raw keys, local-stack hosts, JWTs, Supabase, Google, and
  Anthropic-style keys, private keys, forbidden key names nested in JSONB,
  and source row ids
- approved-only findings and reviewed-only scores
- report completeness (warnings)
- expected Compare pairs, using the same eligibility rules as `comparePairs.js`
- fixture size (every visitor clone copies the payload)

The database then independently re-verifies everything with a real clone.

## Usage

```bash
# 0. Local stack + processing (unchanged pipeline)
npx supabase start
npm run process-upload-queue              # after uploading clips in the local coach app

# 1. Review in the local coach app: approve/edit/reject findings, confirm scores,
#    set pitch counts/outcomes, confirm clip->pitch links, practice groupings, priorities.

# 2. Inventory + a starter manifest (nothing pre-selected)
npm run export-demo-fixture -- --team <team-slug> --player <player-slug> --init-manifest demo-curation.json

# 3. Fill demo-curation.json (see docs/research/demo-curation.example.json), then:
npm run export-demo-fixture -- --manifest demo-curation.json --dry-run        # writes nothing
npm run export-demo-fixture -- --manifest demo-curation.json --validate-only  # report only
npm run export-demo-fixture -- --manifest demo-curation.json --output demo-export
#   (--skip-media: data only; those clips show "No video published for this swing")

# 4. Load into LOCAL demo.* (refuses a non-local SUPABASE_URL unless --allow-remote)
npm run import-demo-fixture -- --fixture demo-export/<id>/fixture.json --verify-only
npm run import-demo-fixture -- --fixture demo-export/<id>/fixture.json            # store, unpublished
npm run import-demo-fixture -- --fixture demo-export/<id>/fixture.json --publish  # store + publish atomically
npm run import-demo-fixture -- --status | --rollback-to <id>@<version> | --rollback-fictional | --retire-stale

# 5. Local end-to-end verification (synthetic player; cleans up after itself)
npm run test:demo-real-fixture
```

Both CLIs refuse a non-local `SUPABASE_URL` by default.

## Verification performed (local, 2026-09-22)

- **Unit tests:** `src/services/demoExport/demoExport.test.ts`, 18/18.
  Covers minimal export, approved/edited export, draft and rejected
  exclusion, id remapping, FK preservation, translation and drift, human
  metadata and overrides, the allowlist, private-field stripping and leak
  detection, pose/metrics/phases, report records, Compare, Practice,
  deterministic re-export, fail-closed on invalid source, ffmpeg arguments,
  stage0 alignment, and skip-media.
- **Local E2E:** `supabase/demo/realFixture.e2e.test.ts`, 14/14, with a
  **true anonymous sign-in**. Anonymous sign-ins were temporarily enabled
  per the `demo.test.ts` procedure, then reverted. The exact frontend query
  shapes for Team, Player (including `pitch`), At-Bat, Review (findings,
  provenance, phases, metrics, byte-identical `joints_blob`), Development,
  Practice, Compare, and Report all pass. So do DB rejection of bad fixtures
  and cross-fixture slug collisions, the client boundary (visitors can't
  read fixtures or call clone/load RPCs), isolation, reset, and deactivation.
  Cleanup was verified at zero rows.
- The existing `supabase/demo/demo.test.ts` passes 32/32 with 00036 applied.
- **Real CLIs against real local rows** (the fictional Thunder 10U seed):
  the dry run failed closed on the blank auto-linked pitch and the missing
  pose. With overrides, the export passed; the media came out as H.264
  720p, 6.0s, with metadata stripped. `--verify-only` stored nothing, the
  load activated the fixture, a hand-edited fixture was refused on its
  content hash, deactivation worked, and the re-export was byte-identical.
- The translation spec matches all 19 live `demo.*` tables column-for-column,
  and every `public.*` column has a rule (checked against
  `information_schema`).

**Not verified:** a browser rendering pass. The E2E replays the pages'
exact PostgREST calls; it does not drive the HTML. The Report check replays
`get-demo-player-report`'s exact query sequence plus its `shapePlayerReport`,
because the local edge runtime wasn't serving functions.

## What remains manual

Superseded. See the 2026-09-23 status, the rollout sequence above, and `demo-export/EMILY_REVIEW_WORKSHEET.md`.

## Security and privacy rules

- The manifest is the only allowlist. A clip that isn't listed never
  exports, and neither do findings whose evidence is an unlisted clip.
- Real data never goes into git: `demo-export/` and `demo-curation*.json`
  are gitignored, and the committed example is fictional.
- Only `fixture.json` enters the database, and only `media/*.mp4` may be
  published. The audit files stay local.
- These never leave the machine: raw bucket paths, local paths, worker
  diagnostics, auth user ids, share tokens, coach names (aliased), rejected
  findings, AI-draft scores, and unreviewed observation suggestions.
- Clients cannot touch fixture storage: `demo.demo_real_fixtures` has no
  grants or policies, and the clone, verify, and load RPCs are revoked from
  `PUBLIC`/`anon`/`authenticated` (verified by the E2E).
- Demo RLS and auth are unchanged. Nothing was deployed, methodology was
  not modified, and `k-0.2.0` was not touched. The E2E reads an existing
  `methodology_versions` label and never writes one.
