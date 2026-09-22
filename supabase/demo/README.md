# HitterLoop Demo Backend

This directory is a deployable SQL package for a **separate, dedicated
Supabase project** used only for the public demo (`joncurry.co/hitterloop/demo`
eventually — see the main demo architecture doc). It is intentionally
**never** referenced by `supabase/migrations/` or `npm run db:reset`, so
applying/testing it never touches this repo's normal production/dev
database.

## What's here

- `001_demo_lifecycle.sql` — `demo_sessions`, `demo_seed_templates`, and the
  `start_demo_session()` / `reset_demo_session()` / `clone_demo_dataset()`
  functions. Zero changes to any existing table's RLS policy — see the file
  header for why that's sufficient.
- `002_demo_seed_template.sql` — the canonical fictional seed (v1): one
  team, three fictional players. Deliberately minimal for Phase 1-3 (see
  its own header) — the fuller Player A/B/C narrative content is Phase 4.

## Deploying to a real demo Supabase project (Phase 5, not done yet)

1. Create a new, separate Supabase project. Do **not** reuse the production
   project.
2. Apply the exact existing production schema, unmodified:
   `supabase/migrations/*.sql`, in numeric order (this is the *real*
   HitterLoop schema — the demo intentionally runs the real app against a
   real, unmodified copy of it, not a fork).
3. Apply this directory's files, in order: `001_demo_lifecycle.sql`, then
   `002_demo_seed_template.sql`.
4. In that project's Auth settings, enable **Anonymous Sign-Ins**
   (`enable_anonymous_sign_ins`). This is a per-project setting — it must
   only ever be turned on for the demo project, never for production.
5. Record that project's URL and anon key for `coach/demoConfig.js`'s
   `supabaseUrl`/`supabaseAnonKey` (see `coach/demo.local.example.js` for
   the shape). **Never** the service-role key — nothing in the browser
   build ever needs it.
6. Do **not** point any worker (`processUploadQueue.ts`, `analyze.ts`, etc.)
   or `GEMINI_API_KEY` at this project. The demo has no upload/live-analysis
   path by design (`capabilities.uploads`/`capabilities.liveAnalysis` are
   `false`) — a worker existing at all would be a real production-AI-spend
   risk this architecture is specifically designed to avoid.

## Local verification (what was actually done to test this package)

Since this session has no Supabase cloud account/access token, this SQL was
verified by applying it on top of the *local* Supabase dev stack (itself
already a disposable, non-production instance) with
`enable_anonymous_sign_ins` temporarily turned on locally, running real
integration tests (`demo.test.ts` in this directory) using two separate
anonymous `supabase-js` sessions, then running `supabase db reset` — which
cleanly removes everything in this directory again, since none of it is a
real migration.

**Provisioning an actual second cloud Supabase project is a real
infrastructure step this session cannot perform without Supabase account
access being granted.**

## Rollback / reset semantics recap

`reset_demo_session()` deletes the caller's own cloned `teams` row (which
cascades to delete every team-owned row: players, games, priorities,
drills, practice, findings, share links, ...) and re-clones from the active
`demo_seed_templates` row. It only ever touches `demo_sessions.user_id =
auth.uid()`'s own row — resetting one visitor cannot affect another.
