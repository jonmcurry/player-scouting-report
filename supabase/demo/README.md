# HitterLoop Demo Backend

**Current architecture (as of 2026-09-22): temporary same-project + isolated
`demo` Postgres schema.** The authoritative implementation lives in the
normal migration path:

- `supabase/migrations/00031_demo_shared_project_schema.sql` — the `demo`
  schema, `demo.teams`/`demo.players`/`demo.demo_sessions`/
  `demo.demo_seed_templates`, RLS, and the
  `demo.start_demo_session()`/`demo.reset_demo_session()`/
  `demo.clone_demo_dataset()` lifecycle functions.
- `supabase/migrations/00032_demo_seed_v1.sql` — the canonical fictional
  seed (v1): one team, three fictional players.
- `supabase/migrations/00033_demo_phase4_schema.sql` — Phase 4: every
  additional `demo.*` table the real coach pages (team/player/at-bat/
  review/development/practice/compare/report) actually query, plus the
  `demo.team_summary_stats` view and ownership helper functions.
- `supabase/migrations/00034_demo_phase4_seed.sql` — extends
  `demo.clone_demo_dataset()` to build the full Jordan/Maya/Riley
  narrative on every clone.
- `supabase/functions/get-demo-player-report/` — the demo-mode Edge
  Function `coach/report.html` calls instead of `get-player-report` in
  demo mode (schema-qualified to `demo`, otherwise identical logic,
  reusing `get-player-report`'s own `shape.ts`).

See `docs/research/demo-shared-project-architecture.md`'s "Phase 4 update"
section for the full table-by-table rationale and seed-story summary.

Full rationale, the exact isolation boundary, and the conditions that
should trigger moving back to a dedicated project are in
[`docs/research/demo-shared-project-architecture.md`](../../docs/research/demo-shared-project-architecture.md).
Read that document first.

## Why this directory still exists

`001_demo_lifecycle.sql` and `002_demo_seed_template.sql` in this directory
are the **original** design: a fully dedicated, separate demo Supabase
project running an unmodified copy of the real production schema, with demo
teams/players stored directly in that project's own `public.teams`/
`public.players`. That plan is not implemented (no free Supabase project
slot on this account as of 2026-09-22) and is superseded by the shared-
project `demo`-schema architecture above. Both files are kept, clearly
marked obsolete/reference-only in their own headers, for history — they are
**not applied anywhere** and are not part of `supabase/migrations/`.

The dedicated-project design is still the intended **eventual** target once
the conditions in the architecture doc are met — at that point, the exact
same `demo` schema + RPCs + seed described above get deployed into a real
second project with only the frontend's `supabaseUrl`/`supabaseAnonKey`
changing, not a rewrite.

## Deploying to the real shared HitterLoop project

The `demo` schema/RPCs/seed are ordinary migrations — `supabase db push` (or
whatever this repo's normal deploy path is) applies them exactly like any
other migration, no separate step. Two things still need manual,
one-time setup on the **real hosted project** (neither is expressible as a
committed migration):

1. **Expose the `demo` schema to the Data API.** Dashboard → Project
   Settings → API → *Exposed schemas* → add `demo` (or `supabase config
   push` once the project is linked, since `supabase/config.toml`'s
   `[api] schemas` already lists `"demo"` locally). Without this, PostgREST
   returns 404 for every demo `.from()`/`.rpc()` call — `public` (real coach
   data) is completely unaffected either way.
2. **Enable Anonymous Sign-Ins**, Dashboard → Auth → Settings →
   `enable_anonymous_sign_ins`. This is project-level, not schema-level —
   see the architecture doc's "Auth model" section for why that's
   acceptable here (anonymous visitors still only ever get access to their
   own `demo.*` rows, never `public.*`).

Also deploy the Edge Function: `supabase functions deploy get-demo-player-report`.
This is a genuinely new deploy step (`get-player-report`/`get-upload-url`/
`get-video-url` already have to be deployed for the normal app; this one
is demo-only) — not covered by `supabase db push`.

Nothing else changes: `coach/demoConfig.js`'s `supabaseUrl`/`supabaseAnonKey`
point at the **same** project/keys the normal app uses (see the frontend
config note below).

## Local verification

Local dev (`npx supabase start`/`db reset`) already applies 00031/00032 like
any other migration — no manual SQL step. The only thing that still needs a
temporary local toggle is anonymous auth (off by default, and must stay off
in the committed `supabase/config.toml`):

```
sed -i '' 's/enable_anonymous_sign_ins = false/enable_anonymous_sign_ins = true/' supabase/config.toml
npx supabase stop && npx supabase start
node --import tsx --test supabase/demo/demo.test.ts
# revert config.toml, then:
npx supabase stop && npx supabase start
```

`demo.test.ts` covers both cross-session isolation (visitor A vs visitor B,
entirely within `demo.*`) and cross-boundary isolation (a demo anonymous
JWT cannot read, mutate, or invoke Edge Functions against real `public.*`
data).

## Frontend config

`coach/demoConfig.js`'s `dataNamespace` field (always `"demo"`, not reader-
configurable) is what actually redirects every `.from()`/`.rpc()` call in
`coach/` to the `demo` schema — see `coach/shared.js`'s Supabase client
construction. `supabaseUrl`/`supabaseAnonKey` are the **same project-level
public identifiers** the normal app uses; see `coach/demo.local.example.js`
for the local shape. Never the service-role key — nothing in the browser
build ever needs it, in demo mode or otherwise.

## Rollback / reset semantics recap

`demo.reset_demo_session()` deletes the caller's own cloned `demo.teams` row
(cascades to `demo.players`) and re-clones from the active
`demo.demo_seed_templates` row. It only ever touches
`demo.demo_sessions.user_id = auth.uid()`'s own row — resetting one visitor
cannot affect another, and can never reach `public.*` at all (no FK, no
shared table, different Postgres schema entirely).
