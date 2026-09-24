# HitterLoop demo: temporary same-project + isolated `demo` schema

> **Update (0.20.0, local only, not deployed):** migration 00036 lets
> curated, coach-reviewed real footage join every visitor's clone through
> `demo.demo_real_fixtures`. `demo.clone_demo_dataset()` is now the
> fictional narrative (renamed `demo.clone_fictional_dataset`) plus every
> active real fixture. The migration also fixes the missing
> `game_log_entries.pitch` column and a `clone_demo_dataset` PUBLIC-execute
> gap. See [demo-real-data-promotion.md](./demo-real-data-promotion.md).

**Status as of 2026-09-22 (live-audit compatibility fix pass): the
deployed public demo at joncurry.co/hitterloop/demo surfaced real
frontend/schema mismatches once real traffic hit it — the schema/RLS
architecture and cloud deployment itself were sound, but several `demo.*`
tables were missing columns/tables the real (unmodified) coach frontend
genuinely selects, and Review/Compare had no demo-safe video strategy.
Every gap was traced to the exact frontend source line before touching
schema (never guessed from the audit's own wording), fixed with a single
additive migration (00035), and proven with new exact-query regression
tests. See "LIVE-AUDIT COMPATIBILITY FIX PASS" below for the full
trace-by-trace detail. The underlying same-project/isolated-schema
architecture, RLS model, and reset/isolation guarantees were not touched
or redesigned.

## LIVE-AUDIT COMPATIBILITY FIX PASS (2026-09-22)

**Root cause of each reported live failure**, traced against the actual
frontend source before any schema change (Rule 1 of this pass — the
8-item failure list from the live audit was a symptom description, not a
spec to blindly implement against):

1. **`demo.player_priorities.follow_up_set_at` does not exist** —
   genuinely selected by `coach/player.html`, `coach/components/teamDashboard.js`
   (team.html's dashboard — the actual cause of "Team — FAIL"), and read by
   `coach/components/developmentLogic.js`'s `isFollowUpDue()`. Production
   sets this column via a `BEFORE INSERT/UPDATE` trigger
   (`00026_priority_followup_and_quality.sql`), not app code. **Fix:**
   added the column plus the identical trigger, schema-qualified, to
   `demo.player_priorities` — existing seed INSERTs (which already set
   `follow_up_kind`) get it stamped automatically, no seed-logic change.
2. **Expected `game_log_entries`/pitch-related columns do not exist** —
   traced to `demo.game_log_entries.session_note`, genuinely selected by
   `player.html`'s practice-activity list and genuinely INSERTed by
   `practicePage.js`'s `addRep()` (adding a new practice rep from the UI
   fails outright without it). **Also found, not named by the audit but
   caught by this pass's own new regression test:** `demo.game_log_entries.result`
   incorrectly kept `NOT NULL` — production dropped that constraint in
   `00015_practice_sessions.sql` specifically because a practice rep has
   no game result, and `addRep()` never sets it. **Fix:** added
   `session_note`, dropped `result`'s `NOT NULL`. (Maya's seeded 4-pitch
   at-bat itself was independently verified correct and unaffected — see
   item 6 below.)
3. **`demo.swing_phases.reconstruction_reliable` does not exist** —
   genuinely selected by `player.html` and `devUi.js`'s `loadPhases()`
   (used by Review and Compare). Production added it in
   `00023_swing_phase_reconstruction_reliability.sql`. **Fix:** added the
   column. `demo.swing_phases` is still never seeded with rows (no
   lab-grade metrics fabricated, unchanged from Phase 4) — this is purely
   "the column must exist for the query not to 400."
4. **`analysis_runs` queries fail against the demo schema** — traced to
   `demo.analysis_runs` missing `no_action_needed`/`no_action_reason`,
   genuinely selected by `review.html`. **Fix:** added both columns plus
   production's own check constraint. Table remains unseeded (no specific
   AI backend simulated as having run).
5. **`coach_profiles` returns 404** — genuinely queried by
   `coach/shared.js`'s `getMyDisplayName()` (called from atbat.html,
   review.html, player.html, devUi.js). Its own error handling already
   falls back to the literal `"Coach"` on any error, so this was never a
   page-breaking failure, but it is a real, fixable gap: demo visitors
   should see "Coach Demo," not a generic fallback and console noise.
   **Fix:** new `demo.coach_profiles` table (no FK to
   `public.coach_profiles`, no real identity linkage — the display name
   is always the fixed literal `"Coach Demo"`), auto-populated once per
   visitor by `demo.start_demo_session()` (identity bookkeeping, survives
   reset — not per-clone content).
6. **Maya's four pitches don't render (At-Bat — PARTIAL)** — reproduced
   the *exact* live browser query sequence (`game_log_entries` entry
   lookup with the real `players!inner(...)` embed, `loadPitches()`,
   the clips query) directly against the cloud project before changing
   anything: **all 4 pitches, all 4 clips, zero errors, byte-for-byte
   correct.** No code-level bug was found in the pitch-fetch or
   pitch-render path (`inferCounts()`, `pitchMetaParts()`, the render
   template were all re-checked against this exact data shape and are
   safe). Reported honestly rather than claiming an invented fix: this
   specific symptom could not be reproduced against the current deployed
   schema/frontend, and is most plausibly explained by a stale/cached
   page load at audit time (see item 8) rather than a data or query
   defect. A new regression test (`AT-BAT: atbat.html's exact entry +
   four-pitch query shape...`) proves the exact frontend query shape
   returns all 4 pitches, as insurance.
7. **Review source video / Compare selected videos "unavailable"** — both
   already had graceful, non-crashing fallback UI for a null video URL;
   the audit's complaint is about UX quality, not a crash. **Fix: demo
   media strategy Option C** (explicit placeholder, no fabricated
   footage) — see below.
8. **`get-video-url` 404/CORS** — root cause: that function is
   deliberately not deployed to the demo project (real private-video
   signing has no place in a public demo). **Resolved by not needing the
   function at all** — see below.

### Demo media strategy: Option C (explicit placeholder, no signing function)

No existing public-safe/synthetic video asset was found in the repo
(checked). Building one is real media-production work, out of scope for a
"surgical compatibility fix." Chose Option C per the task's own
preference ordering:

- `devUi.js`'s `getVideoUrl()` — the single chokepoint both `review.html`
  and `compare.html` call — now checks `isDemoMode()` first and returns
  `null` immediately, **never invoking `get-video-url` at all** in demo
  mode. No CORS/404 noise, no attempted call to a function that doesn't
  exist for this project.
- `review.html`'s `renderWatch()` and `compare.html`'s three
  "no video element" render sites (`renderVideo`'s two panes,
  `renderFrames`' `frame()` helper — factored into one shared
  `videoPlaceholderHtml()`/`emptyState(...)` call) now render an explicit
  **"Demo evidence placeholder — the public demo doesn't store real swing
  video"** message instead of "Video unavailable" *specifically and only*
  in demo mode. Production's genuine "Video unavailable / Try again
  later" state (a real load failure, e.g. `dropVideo()`'s `error` handler)
  is completely unchanged — the placeholder branch is only reachable when
  `url` is null, which in demo mode is now the deterministic outcome by
  design, never a failure being disguised.
- **No demo-safe video-signing function was created.** The demo never
  needs one: no real media exists to protect, so there is nothing to sign
  a URL for. This directly satisfies "avoid a signing function entirely
  if possible."
- Phase timing, coach notes, drill assignments, and progress history
  (all real seeded data) still render normally alongside the placeholder
  — the flow stays understandable, nothing about it claims real footage
  exists.

### `config.local.js` — flagged for the website-sync task, not fixed here

Every `coach/*.html` page (all 10) unconditionally loads
`<script src="./demo.local.js"></script><script src="./config.local.js"></script>`.
This is pre-existing, intentional app-source behavior (the local-dev
override pattern, mirrored in `demoBanner.test.mjs`'s own assertions) —
a missing file 404s silently and harmlessly in a real browser; nothing
depends on it loading. The live audit's `config.local.js 404` is this
exact, by-design, inert 404 — not an app bug. The website-sync task can
either accept it as harmless or add an empty stub file at that path if
the 404 itself is noisy in its own monitoring; either is a website-repo
decision, not an app-source change.

## CLOUD DEPLOYMENT STATUS (2026-09-22, cloud pass 3 — READY)

**Positively identified cloud project:** `npx supabase projects list`
(now authenticated) returns two projects on this account —
`rjnpaqsqslvzkwwwqmze` ("hitterloop", us-west-2, `linked: true`) and
`plceccpvaicsjohxlbal` ("joncurry", unrelated, `linked: false`). The
linked project is unambiguously "hitterloop." Re-confirmed via
`supabase link --project-ref rjnpaqsqslvzkwwwqmze` and matching
`supabase/.temp/project-ref`.

**Critical finding before any mutation:** this "hitterloop" project was
completely empty — `supabase migration list` showed all 34 local
migrations as pending with zero applied remotely, and a live REST probe
confirmed `public.teams` didn't exist. Not just "no demo schema yet" — the
base app schema (00001-00030) had never been deployed here either. This
was outside this task's literal stated scope ("apply the demo migrations")
so **execution stopped and the user was asked** rather than assumed;
confirmed instruction: push the full migration history (00001-00034), not
just the demo-only slice. Verified via `grep` beforehand that 00031-00034
have zero dependency on `public.*` (only comment references), so this was
a genuine choice, not a forced one.

**Migrations: APPLIED.** `supabase db push` ran all 34 migrations
(00001-00034) successfully, `supabase migration list` shows `local ==
remote` for every one. **Structural verification (not just "the push
didn't error"):** `supabase db diff --linked --schema demo` — which
rebuilds a full shadow database from the local migrations and diffs it
against the real remote `demo` schema — returned **"No schema changes
found"**: every `demo.*` table, column, constraint, RLS policy, and
SECURITY DEFINER function (including `search_path` pinning) on the real
cloud project is byte-for-byte identical to what's committed locally and
was already tested there. The equivalent `--schema public` diff found only
one difference, and it's benign: Supabase's hosted platform auto-adds an
`rls_auto_enable` event-trigger safety net to newly created tables
project-wide (confirmed this is a platform-level guardrail, not something
our migrations omit maliciously — though it did surface a real,
pre-existing, unrelated-to-demo gap: migration `00021_team_creation_rate_limit.sql`
never explicitly enables RLS on `team_creation_attempts`; the hosted
platform's auto-enable trigger has closed that gap on this cloud project,
but the same gap would remain open on a fresh local `supabase db reset`,
which doesn't have that platform feature. Flagged here for a future
session — out of scope for this demo-only task, not touched).

**Edge Function: DEPLOYED.** `supabase functions deploy get-demo-player-report`
succeeded; `supabase functions list` confirms exactly one function exists
on this project (`get-demo-player-report`, ACTIVE) — no unrelated function
was deployed, and (matching the empty-project finding above)
`get-player-report`/`get-upload-url`/`get-video-url` are genuinely not
deployed here either, since deploying them is the normal app's own launch
task, not this demo task's job. `supabase secrets list` confirms only the
platform's own auto-injected `SUPABASE_URL`/`SUPABASE_ANON_KEY`/
`SUPABASE_SERVICE_ROLE_KEY`/etc. secrets exist — nothing custom was added,
and their values are never visible via the CLI (hashed in the listing).

**Dashboard settings: DONE and live-verified (2026-09-22, cloud pass 3).**
The user completed both manually; both re-checked live before trusting the
report, not assumed:
1. **`demo` schema exposed to the Data API.** A bare `Accept-Profile: demo`
   REST call with only the `anon` role now returns `42501 permission
   denied for schema demo` (not `PGRST106` anymore) — the schema is
   exposed at the PostgREST level, and this specific denial is *correct,
   by design*: `USAGE` on `demo` was only ever granted to `authenticated`,
   never `anon` (00031's own grant statement). Confirmed with a real
   signed-in (anonymous) session's JWT instead: `GET .../teams` under
   `Accept-Profile: demo` returned `[]` (200 OK, empty — no rows yet), and
   `POST .../rpc/start_demo_session` under `Content-Profile: demo`
   returned a real cloned team. Both prove the schema is correctly exposed
   AND correctly access-controlled, not just "open."
2. **Anonymous Sign-Ins enabled.** `POST /auth/v1/signup` with an empty
   body now returns a real session (`is_anonymous: true`, a signed JWT),
   not `anonymous_provider_disabled`.

**Full cloud integration/security suite: 25/25 PASS.**
`node --env-file=<cloud credentials> --import tsx --test
supabase/demo/demo.test.ts` run against the real `hitterloop` project
(credentials supplied via a local, git-ignored, immediately-deleted env
file — never embedded in a shell command). Every test that passed locally
also passed live in cloud: bootstrap + idempotency, two independent
anonymous visitors with verified cross-read/cross-mutate denial, an
ordinary authenticated (non-anonymous) user seeing zero demo sessions, a
demo anonymous JWT unable to read or mutate real `public.teams`/
`public.players` (via a synthetic planted row, cleaned up by the test
itself), transactional reset, 3-way concurrent reset safety, the full
canonical seed (exact team/3 players), Jordan's complete resolved-loop
story, Maya's exact 4-pitch at-bat with a pending draft finding, Riley's
longitudinal resolved+monitoring data, and `get-demo-player-report`
returning Jordan's real resolved priority/drill/progress for a live cloud
share token.

**One caveat, reported honestly rather than glossed over:** the test
named "cannot invoke production analysis/upload APIs (get-upload-url)"
passed with a `404`, but on this project that 404 comes from Supabase's
function gateway reporting *no such function* — `get-upload-url` was
never deployed here (correctly, per this task's own "deploy ONLY
`get-demo-player-report`" scope) — not from the app's own RLS-based
denial logic the test was originally written to exercise locally. It does
not, in this environment, prove that boundary the way it does against the
local stack (where `get-upload-url` is deployed and denies for the real
reason). Not a security gap — there is no real upload path on this fresh
project for anyone, demo or otherwise, to reach yet.

**Cleanup: verified complete.** Running the suite against a live project
(unlike local, which gets a full `db reset` after) left real residue:
28 anonymous `auth.users` rows and their cloned `demo.teams` (with all
cascaded Phase 4 content). Cleaned up with a small service-role script
(git-ignored, deleted immediately after use): each user's team deleted
first (order matters — `demo_sessions.team_id` has no cascade *from*
teams, only *to* it, by design; deleting the team while its session still
referenced it correctly failed with a FK violation, confirming that
constraint still works as intended), then the now-orphaned teams. Final
verified state: **0** anonymous `auth.users`, **0** rows in every
`demo.*` table (`teams`, `players`, `demo_sessions`, `game_log_entries`,
`at_bat_pitches`, `issues`, `player_priorities`, `practice_sessions`,
`player_share_links`), **0** rows in `public.teams`/`players`/
`game_log_entries` (the boundary tests' own planted fixtures were already
self-cleaning). No synthetic residue remains anywhere.

**Security scan: clean.** No service-role key, database password, or JWT
signing secret in any file left in this repo (the cloud-credentials env
file and the cleanup script were both temporary, git-ignored-pattern
names, and deleted before this pass ended — confirmed via `git status`).
The anon key and project URL in `coach/demo.site.example.js` are
intentionally public, non-secret identifiers per the architecture's own
stated security model (RLS is the boundary, not key secrecy).

## TEMPORARY HOSTING MODEL

**Same Supabase project + isolated `demo` Postgres schema.** This is
**logical isolation, not project-level physical isolation.** It exists only
because the Supabase account has no remaining free project slot for a
second, fully separate demo project — that was the original architecture
(see "Future migration back to a dedicated project" below) and remains the
intended eventual target.

## Why this is safe as logical isolation

1. **Separate Postgres schema (`demo`), not a flag on real tables.** No
   demo row is ever stored in `public.teams`/`public.players`/etc. — the
   fictional dataset lives in `demo.teams`/`demo.players`, entirely
   independent tables with their own primary keys.
2. **No FK from `demo.*` into `public.*`, anywhere**, verified directly
   against `information_schema` after applying the migration (see
   `supabase/migrations/00031_demo_shared_project_schema.sql`'s own commit
   history for the live query and result). The only shared dependency is
   `auth.users` (project-level identity), which is unavoidable and
   explicitly allowed by the approved architecture.
3. **RLS enabled on every client-reachable `demo.*` table**
   (`demo.teams`, `demo.players`, `demo.demo_sessions`), verified live via
   `pg_tables.rowsecurity`. `demo.demo_seed_templates` (the canonical seed)
   has RLS enabled with **zero policies and zero grants** to
   `authenticated`/`anon` — unreadable by any client role, only the
   SECURITY DEFINER clone function (running as its owner) can see it.
4. **Ownership modeled exactly on production's own pattern.**
   `demo.is_demo_owner_of_team()` mirrors `is_coach_for_team()`
   (`00001_initial_schema.sql`) almost verbatim — SECURITY DEFINER, stable,
   checks the caller's own `demo.demo_sessions` row. `demo.teams`/
   `demo.players` get a single `for all` policy scoped to
   `demo.is_demo_owner_of_team(...)`, same shape as production's
   `coach_rw_own_team`.
5. **Every SECURITY DEFINER function pins `search_path = ''`** (not just
   `= public`, which the original dedicated-project design used) and fully
   schema-qualifies every reference (`demo.demo_sessions`, `auth.uid()`,
   etc.) — verified live via `pg_proc.proconfig` showing
   `{"search_path=\"\""}`. on all four demo functions
   (`is_demo_owner_of_team`, `clone_demo_dataset`, `start_demo_session`,
   `reset_demo_session`). This is stricter than production's own
   `set search_path = public` convention, specifically because a function
   living in a non-default schema must never resolve an unqualified name
   against `public` by accident.
6. **Schema-level grants are minimal and asymmetric.**
   `grant usage on schema demo to authenticated` only — `anon` and `public`
   have no usage on the schema at all (verified via
   `has_schema_privilege('anon', 'demo', 'USAGE')` returning `false`).
   Table grants: `demo.teams` gets `select, update` (no insert/delete — a
   team is only ever created/destroyed via the clone/reset functions);
   `demo.players` gets full `select, insert, update, delete` (matches
   existing coach behavior — a demo "coach" can add/edit/remove fictional
   players just like a real one); `demo.demo_sessions` gets `select` only.
7. **Anonymous demo auth is project-level, but demo authorization is not.**
   A demo anonymous JWT is a real `authenticated` role member, same tenant
   as normal coaches — but it can only ever pass `is_coach_for_team()`
   (production) or `is_demo_owner_of_team()` (demo) if a matching
   `coach_team_access`/`demo_sessions` row exists, and demo bootstrap never
   creates a `public.coach_team_access` row (it never touches `public.*` at
   all). This was verified live, not assumed — see "Cross-boundary
   isolation test results" below.

## Frontend: one client, schema-scoped

`coach/demoConfig.js`'s `dataNamespace` field (forced to `"demo"` in demo
mode, `"public"` in normal mode — never client-settable to anything else)
drives the **one and only place** the Supabase client is constructed
(`coach/shared.js`):

```js
export const supabase = createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
  db: { schema: getDemoConfig().dataNamespace },
});
```

Every existing `.from("teams")`, `.from("players")`, `.rpc("start_demo_session")`,
`.rpc("reset_demo_session")` call site across `coach/*.html` and
`coach/components/*.js` is **completely unchanged** — schema resolution
happens once, centrally, not as a per-query or per-page conditional. This
directly satisfies "do not spread schema-name conditionals throughout the
app."

`supabaseUrl`/`supabaseAnonKey` are now the **same project-level public
identifiers** the normal app uses (this is fine — RLS, not anon-key
secrecy, is the security boundary, exactly as the existing architecture
note in `00001_initial_schema.sql` already states). The service-role key is
never present in `coach/` in either mode.

`coach/demo.site.example.js` (new, 2026-09-22) is a reference template —
not consumed by any code, not the website repo — holding the real cloud
`hitterloop` project's URL and anon key in the exact
`window.__HITTERLOOP_DEMO_CONFIG__` shape the eventual joncurry.co publish
step needs to inject. Kept here because this repo owns the demo backend
and its real values; the website repo (untouched this session) decides how
it actually injects them.

## RPC surface

Kept the existing two functions, moved into the `demo` schema so a
schema-scoped client's `.rpc()` calls resolve them with **zero name
change**: `demo.start_demo_session()`, `demo.reset_demo_session()`,
`demo.clone_demo_dataset()` (internal only, no grant to `authenticated`).
No new Edge Function was introduced or needed — the SQL/RPC layer alone
handles bootstrap/reset, same as the original design.

## Phase 4 update (2026-09-22): expanded demo domain model

Phase 4 extends the `demo` schema with the minimum additional tables the
REAL, unmodified `coach/team.html` / `player.html` / `atbat.html` /
`review.html` / `development.html` / `practice.html` (via
`practicePage.js`) / `compare.html` (via `comparePairs.js`/`devUi.js`) /
`report.html` pages actually query, derived from a direct trace of every
`.from()`/`.rpc()`/`.functions.invoke()` call in those pages and the
components they import. See `supabase/migrations/00033_demo_phase4_schema.sql`'s
header for the full table-by-table rationale and documented column/table
divergences from production.

**Demo tables added** (all under `demo.*`, all rooted at `demo.players` →
`demo.teams` via `ON DELETE CASCADE`, so the existing
`reset_demo_session()` needed zero changes to correctly wipe everything):
`checkpoints`, `swing_phase_types`, `drill_library` (global reference data,
seeded once, never cloned per-visitor); `checklist_scores`,
`checklist_score_history`, `game_log_entries`, `at_bat_pitches`,
`video_clips`, `video_clip_metrics`, `video_clip_pose3d`, `swing_phases`,
`analysis_runs`, `issues`, `player_priorities`,
`player_priority_status_history`, `player_priority_drills`,
`player_priority_observations`, `practice_sessions`,
`practice_repetitions`, `player_share_links`, `comp_recommendations`,
`comp_notes`, `drill_recommendations` (all per-visitor, cloned/reset
together); plus a `demo.team_summary_stats` view mirroring production's.

**Deliberately never seeded with rows** (tables exist so their real,
unmodified query never 404s, but stay empty): `video_clip_metrics`,
`video_clip_pose3d` (every real read site already uses `.maybeSingle()`
and renders its own graceful "not available" empty state for a clip that
was never pose3d-processed — exactly right for fictional demo video),
`analysis_runs` (no specific real AI backend is simulated as having run),
`comp_recommendations`/`comp_notes`/`drill_recommendations` (a legacy
report section, same graceful-empty behavior).

**RPC changes:** `demo.clone_demo_dataset()` (internal, called by
`start_demo_session()`/`reset_demo_session()`, both otherwise unchanged)
now also builds the full canonical Jordan/Maya/Riley narrative after
cloning team+players — see "Canonical seed" below. New ownership helpers
`demo.is_demo_owner_of_player()`, `demo.is_demo_owner_of_entry()`,
`demo.is_demo_owner_of_priority()`, mirroring production's
`is_coach_for_player()`/`is_coach_for_entry()` exactly (SECURITY DEFINER,
stable, `search_path=''`, fully schema-qualified).

**Canonical seed (fictional, cloned fresh per visitor via
`gen_random_uuid()` every call, same structure every time):**
- **Jordan Lee #7** — complete development loop: an earlier game swing →
  a coach-reviewed finding (`issues`, `review_status='approved'`) → a
  `player_priorities` row → an assigned drill
  (`player_priority_drills`) → a practice session with a baseline and a
  post-drill repetition (`practice_sessions`/`practice_repetitions`,
  `grouping`) → three `player_priority_observations` showing an
  unchanged → improving → resolved arc → the priority marked
  `status='resolved'` (trigger-logged in
  `player_priority_status_history`) → a later game swing as the
  resolution evidence → one `checklist_scores` row bumped with a real
  `checklist_score_history` entry → a `player_share_links` token, so the
  report page has something real to render immediately.
- **Maya Torres #12** — one game at-bat with exactly 4
  `at_bat_pitches` rows (a real, coherent 0-0→0-1→1-1→1-2 count
  progression, ending in a swinging-strike strikeout), one `video_clips`
  row per pitch, and one **pending** (`review_status='draft'`,
  `reviewed_by=null`) finding tied to the decisive pitch — the review
  queue's required "meaningful pending item."
- **Riley Chen #4** — longitudinal: one `resolved` priority (head
  stability, backed by an approved issue) and one `monitoring` priority
  (stride consistency), two practice sessions on different dates, four
  observations spread over ~4 weeks showing real progression, one
  `checklist_score_history` entry.

**No real AI backend is simulated** — every seeded `issues`/
`checklist_scores` row is either `review_status='draft'` (Maya's, still
genuinely unreviewed) or carries `reviewed_by='Coach Demo'` with `source`
left `null` (a coach-authored/reviewed record, never tagged as a specific
automated backend that didn't actually run against this fictional data).
`demo.analysis_runs` is never inserted into.

**No real media** — every `demo.video_clips` row has `raw_gcs_path = null`
by design. `coach/report.html` now branches on `isDemoMode()` to call a
new `get-demo-player-report` Edge Function (schema-qualified to `demo`,
otherwise byte-for-byte the same logic as `get-player-report`, reusing its
`shape.ts` directly — `get-player-report` itself is completely untouched)
instead of `get-player-report`; that function's video-serving branch
always returns "not available" rather than attempting a GCS lookup that
would only ever fail. `get-video-url` (used for in-app clip playback) is
schema-`public`-only and was deliberately left unchanged: in demo mode it
naturally 404s for a demo clip id (wrong schema, and `raw_gcs_path` is
null anyway) and the existing, unmodified UI already renders that as
"video unavailable" — the correct behavior, not a gap.

**At-bat upload/camera UI gap (closed this pass):** `coach/atbat.html`'s
`chooseVideo()` — the single function every Record-pitch/camera-icon/"Add
another video" path already routed through — now checks
`getDemoConfig().capabilities.uploads` before ever creating or clicking
the OS file/camera picker, and the same three controls carry the existing
`.upload-control` CSS class so `shared.js`'s existing demo CSS rule hides
them outright. The overflow menu excludes "Add another video" entirely in
demo mode rather than showing then blocking it. The identical gap existed
in `coach/components/practicePage.js`'s `attachVideo()`/
`addRepsWithVideo()` (the practice page's own raw file-picker
chokepoints, found by a repo-wide grep for every `type = "file"`/
`.capture`/`accept="video`/`getUserMedia` site) and was fixed the same
way. `coach/player.html`'s upload controls were already correctly
CSS-hidden (confirmed in the prior audit) and are unchanged.

**liveAnalysis:** re-audited — still no user-facing "run analysis now"
trigger anywhere in `coach/` (grep-confirmed). `capabilities.liveAnalysis`
remains a reserved, centrally-plumbed flag with nothing to gate yet; no
placeholder code was added just to reference it.

## What's still out of scope (Phase 5+)

**Resolved by Phase 4 (above):** every table the 8 traced pages actually
query now exists under `demo.*` with real (or intentionally empty, see
above) content — the "relation does not exist" regression this section
used to describe no longer applies to any of the 8 traced pages.

Still genuinely out of scope (Phase 5+, deployment/publishing, not app
code): a second/third fictional team for multi-team scenarios, a richer
`video_clip_metrics`/`video_clip_pose3d` demonstration (deliberately never
built — see above), and anything the 8 traced pages don't themselves
query (there is no exhaustive attempt to populate every production table
that exists somewhere in the schema, only the ones actually reachable from
team/player/at-bat/review/development/practice/compare/report).

## Storage

No demo storage bucket was created. `capabilities.uploads` remains `false`
in demo mode (unchanged), so demo client storage write access is `NONE` by
design — nothing to audit here beyond confirming that flag stays false
(covered by the existing `demoBanner.test.mjs` assertions).

## Conditions that should trigger moving to a dedicated project

Any of the following should trigger provisioning the originally-planned
dedicated demo Supabase project (deploy path already documented in
`supabase/demo/README.md` — same `demo` schema/RPCs/seed, just a different
`supabaseUrl`/`supabaseAnonKey`, no app-logic rewrite):

- Real external HitterLoop customers/production data start existing in the
  same project (higher blast-radius stakes for any shared-project mistake).
- Demo uploads or live demo AI/worker execution are ever enabled (this
  architecture's entire safety case assumes `capabilities.uploads`/
  `liveAnalysis` stay `false` forever in this shared-project form).
- Meaningfully higher public traffic or abuse risk (rate limiting, DB load,
  or storage growth from `demo.*` starts competing with production
  capacity/quotas).
- A need for independent operational blast radius or quotas — e.g. wanting
  to be able to reset/wipe/rebuild the entire demo dataset without any
  possibility of touching production migrations, connection pool, or
  monitoring.

## Future migration back to a dedicated project

Conceptually: same `demo` schema + RPCs + seed → apply
`supabase/migrations/00031_demo_shared_project_schema.sql` through
`00034_demo_phase4_seed.sql`'s statements (schema-qualification already
assumes nothing else exists in the target project) into a fresh, separate
Supabase project → deploy `supabase/functions/get-demo-player-report`
alongside it → change only `coach/demoConfig.js`'s `supabaseUrl`/
`supabaseAnonKey` inputs. No application logic, RLS policy, or RPC rewrite
needed — this was a design constraint from the start of this task, not an
afterthought.
