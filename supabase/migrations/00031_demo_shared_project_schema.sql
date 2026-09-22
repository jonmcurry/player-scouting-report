-- Temporary interim demo architecture: SAME HitterLoop Supabase project +
-- a strictly isolated `demo` schema, replacing the originally-planned
-- dedicated demo Supabase project (see supabase/demo/README.md for why:
-- no remaining free Supabase project slot on this account as of 2026-09-22).
--
-- This is a REAL migration (unlike supabase/demo/001_demo_lifecycle.sql,
-- which targeted a separate project that never got provisioned) because it
-- now lives inside the shared production project and must go through the
-- normal migration path to ever exist there.
--
-- Hard boundary this file enforces: NO demo domain data (teams, players,
-- ...) is ever stored in `public.*`, and NO table in this `demo` schema has
-- a foreign key into `public.*`. The only shared dependency is `auth.users`
-- (project-level identity - unavoidable and explicitly allowed by the
-- approved architecture). This is logical isolation via a separate schema
-- + its own RLS, not project-level physical isolation - see
-- docs/research/demo-shared-project-architecture.md for the full writeup
-- and the conditions that should trigger moving back to a dedicated
-- project.
--
-- Everything below is a from-scratch mirror of just the two production
-- tables the demo currently needs (teams, players - see
-- supabase/demo/002_demo_seed_template.sql's own header for why the fuller
-- Player A/B/C narrative tables are still out of scope), independently
-- owned, with its own RLS modeled directly on production's
-- is_coach_for_team() / coach_rw_own_team pattern (00001_initial_schema.sql)
-- so demo coach pages (team.html, player.html, ...) keep working against
-- `.from("teams")` / `.from("players")` completely unchanged - the schema
-- redirection happens once, in the demo-mode Supabase client construction
-- (coach/shared.js), never as a per-query conditional.

create schema demo;
comment on schema demo is
  'Isolated demo domain data for the temporary same-project HitterLoop public demo. No FKs into public.*. See docs/research/demo-shared-project-architecture.md.';

-- Schema itself must be usable by `authenticated` (anon demo visitors are
-- `authenticated` with is_anonymous:true, not the `anon` role - see
-- coach/shared.js's bootstrapDemoSession()). Table/function-level
-- grants + RLS below do the actual authorization; this is just schema
-- visibility, the minimum PostgREST/psql require to resolve names in it.
grant usage on schema demo to authenticated;
-- service_role also needs explicit schema USAGE - RLS-bypass (its Postgres
-- role attribute) and schema/table GRANTs are two independent layers, same
-- note as 00001_initial_schema.sql's own "GRANTs and RLS are two separate,
-- independent layers" - service_role is what the demo report Edge Function
-- (get-demo-player-report, added in a later migration) uses internally,
-- same token-authorization-not-RLS pattern as production's
-- get-player-report. Confirmed live: omitting this produced a real
-- "permission denied for schema demo" (42501) from PostgREST/psql when
-- get-demo-player-report actually ran against the local stack.
grant usage on schema demo to service_role;
alter default privileges in schema demo grant all on tables to service_role;
alter default privileges in schema demo grant all on sequences to service_role;
alter default privileges in schema demo grant execute on functions to service_role;
-- Nothing here is ever meant for the anonymous (unauthenticated, pre-JWT)
-- Postgres role or service-role-less external callers.
revoke all on schema demo from anon, public;

-- ---------------------------------------------------------------------
-- demo.teams / demo.players - independently owned mirrors of just the
-- columns production's teams/players carry today (see
-- supabase/migrations/00001_initial_schema.sql +
-- 00028_continuous_knowledge_foundations.sql for the source of truth this
-- was checked against). Deliberately NOT the full production table set
-- (game_log_entries, checklist_scores, video_clips, player_priorities,
-- drill_library, ... - grep coach/*.html's .from() calls for the complete
-- list) - those stay Phase 4 scope; demo pages that read them will get an
-- empty/missing-relation response in demo mode today, same as they already
-- got empty results pre-this-change (no regression in what data exists,
-- only in how an absent relation is reported - documented in
-- docs/research/demo-shared-project-architecture.md).
-- ---------------------------------------------------------------------
create table demo.teams (
  id uuid primary key default gen_random_uuid(),
  slug text unique not null,
  name text not null,
  sport text check (sport in ('baseball', 'softball')),
  level_label text,
  created_at timestamptz not null default now()
);

create table demo.players (
  id uuid primary key default gen_random_uuid(),
  team_id uuid not null references demo.teams (id) on delete cascade,
  slug text not null,
  name text not null,
  jersey_number text not null,
  refilm_by text,
  what_to_check_next text,
  age_band text check (age_band in ('u8', '8-10', '11-12', '13-14', '15-18', 'adult')),
  bats text check (bats in ('L', 'R', 'S')),
  throws text check (throws in ('L', 'R')),
  created_at timestamptz not null default now(),
  unique (team_id, slug)
);

-- ---------------------------------------------------------------------
-- demo.demo_sessions - one row per anonymous visitor: which cloned demo
-- team is theirs, for how long, which reset generation. This IS the
-- ownership anchor demo.is_demo_owner_of_team() below checks - there is no
-- demo.coach_team_access; a demo visitor only ever has exactly one team.
-- ---------------------------------------------------------------------
create table demo.demo_sessions (
  user_id uuid primary key references auth.users (id) on delete cascade,
  -- Deliberately NOT "on delete cascade" from demo.teams: reset must
  -- repoint this row at the NEW team before deleting the OLD one, never
  -- the reverse - a real bug found and fixed in the original
  -- supabase/demo/001_demo_lifecycle.sql (see that file's own comment on
  -- this same column for the full concurrent-reset failure history this
  -- constraint prevents). Preserved unchanged here.
  team_id uuid not null unique references demo.teams (id),
  seed_version text not null,
  generation integer not null default 1,
  created_at timestamptz not null default now(),
  last_active_at timestamptz not null default now(),
  expires_at timestamptz not null
);
alter table demo.demo_sessions enable row level security;
create policy demo_sessions_read_own on demo.demo_sessions
  for select to authenticated using (user_id = auth.uid());
grant select on demo.demo_sessions to authenticated;
-- No insert/update/delete grant - mutation only through the SECURITY
-- DEFINER functions below, exactly like the original design.

-- ---------------------------------------------------------------------
-- demo.demo_seed_templates - canonical fictional dataset as one JSON blob
-- per version, same rationale as the original design (see
-- supabase/demo/002_demo_seed_template.sql). No RLS policy and no grants
-- to authenticated/anon at all - only the SECURITY DEFINER clone function
-- (running as its owner) can ever read it.
-- ---------------------------------------------------------------------
create table demo.demo_seed_templates (
  seed_version text primary key,
  payload jsonb not null,
  active boolean not null default true,
  created_at timestamptz not null default now()
);
alter table demo.demo_seed_templates enable row level security;
revoke all on demo.demo_seed_templates from authenticated, anon;

-- ---------------------------------------------------------------------
-- Ownership check, modeled directly on production's is_coach_for_team()
-- (00001_initial_schema.sql) - security definer so it can read
-- demo.demo_sessions regardless of the calling role's own row-level
-- grants, stable, search_path pinned to '' with every reference fully
-- schema-qualified so name resolution can never be hijacked by a
-- session-level search_path change or an accidental public-schema match.
-- ---------------------------------------------------------------------
create or replace function demo.is_demo_owner_of_team(target_team_id uuid)
returns boolean
language sql
security definer
stable
set search_path = ''
as $$
  select exists (
    select 1 from demo.demo_sessions
    where demo.demo_sessions.user_id = auth.uid()
      and demo.demo_sessions.team_id = target_team_id
  );
$$;
revoke all on function demo.is_demo_owner_of_team(uuid) from public, anon;
grant execute on function demo.is_demo_owner_of_team(uuid) to authenticated;

alter table demo.teams enable row level security;
alter table demo.players enable row level security;

create policy demo_owner_rw_own_team on demo.teams
  for all to authenticated
  using (demo.is_demo_owner_of_team(id))
  with check (demo.is_demo_owner_of_team(id));

create policy demo_owner_rw_own_team on demo.players
  for all to authenticated
  using (demo.is_demo_owner_of_team(team_id))
  with check (demo.is_demo_owner_of_team(team_id));

-- Table-level grants; RLS above is the actual authorization boundary
-- (matches this repo's existing "RLS, not grant absence, is the real
-- boundary" posture - see 00001_initial_schema.sql's architecture note).
-- Direct insert/delete on demo.teams is intentionally NOT granted -
-- creating/destroying a team only ever happens through
-- demo.clone_demo_dataset()/demo.reset_demo_session() below (which run as
-- the owning role and bypass RLS the same way production's
-- create_team()/review_methodology_claim() already do), never a raw client
-- insert/delete.
grant select, update on demo.teams to authenticated;
grant select, insert, update, delete on demo.players to authenticated;

-- ---------------------------------------------------------------------
-- demo.clone_demo_dataset - internal helper shared by bootstrap and reset.
-- No grant to authenticated: only callable from within this file's other
-- SECURITY DEFINER functions. Fully schema-qualified, search_path pinned
-- to '' - never resolves against public.* even by accident.
-- ---------------------------------------------------------------------
create or replace function demo.clone_demo_dataset(p_user_id uuid)
returns table (team_id uuid, team_slug text, seed_version text)
language plpgsql
security definer
set search_path = ''
as $$
declare
  template record;
  new_team_id uuid := gen_random_uuid();
  new_team_slug text := 'demo-' || replace(gen_random_uuid()::text, '-', '');
  player_json jsonb;
begin
  select * into template from demo.demo_seed_templates where active = true order by created_at desc limit 1;
  if template.seed_version is null then
    raise exception 'no active demo.demo_seed_templates row - the demo canonical seed has not been loaded';
  end if;

  insert into demo.teams (id, slug, name, sport, level_label)
  values (
    new_team_id,
    new_team_slug,
    template.payload->'team'->>'name',
    template.payload->'team'->>'sport',
    template.payload->'team'->>'level_label'
  );

  for player_json in select * from jsonb_array_elements(template.payload->'players')
  loop
    insert into demo.players (id, team_id, slug, name, jersey_number, age_band, bats, throws)
    values (
      gen_random_uuid(),
      new_team_id,
      player_json->>'slug',
      player_json->>'name',
      player_json->>'jersey_number',
      nullif(player_json->>'age_band', ''),
      nullif(player_json->>'bats', ''),
      nullif(player_json->>'throws', '')
    );
  end loop;

  return query select new_team_id, new_team_slug, template.seed_version;
end;
$$;

-- ---------------------------------------------------------------------
-- demo.start_demo_session / demo.reset_demo_session - unchanged lifecycle
-- semantics from the original design (idempotent bootstrap, transactional
-- clone-new -> repoint-session -> delete-old reset ordering, per-user
-- advisory-lock concurrency guard, bounded lazy cleanup of other expired
-- sessions), now fully schema-qualified against demo.* and never touching
-- public.* at all. Kept in the `demo` schema (not `public`) so a demo-mode
-- Supabase client scoped to db.schema:"demo" (coach/shared.js) can call
-- them as plain RPCs with no name change - see
-- docs/research/demo-shared-project-architecture.md for why this schema-
-- scoped-client approach was chosen over exposing demo.* for arbitrary
-- direct table access or over a wider RPC rename.
-- ---------------------------------------------------------------------
create or replace function demo.start_demo_session()
returns table (team_id uuid, team_slug text, generation integer)
language plpgsql
security definer
set search_path = ''
as $$
declare
  existing demo.demo_sessions;
  cloned record;
  cleanup_team uuid;
  old_team_id uuid;
begin
  if auth.uid() is null then
    raise exception 'not authenticated';
  end if;

  perform pg_advisory_xact_lock(hashtext(auth.uid()::text));

  select * into existing from demo.demo_sessions where user_id = auth.uid();
  if existing.user_id is not null and existing.expires_at > now() then
    update demo.demo_sessions set last_active_at = now() where user_id = auth.uid();
    return query select existing.team_id, (select slug from demo.teams where id = existing.team_id), existing.generation;
    return;
  end if;

  if existing.user_id is not null then
    old_team_id := existing.team_id;
  end if;

  -- Bounded, cron-free lazy cleanup of a handful of other visitors'
  -- expired sessions - see demo.start_demo_session()'s original design
  -- note (supabase/demo/001_demo_lifecycle.sql) for why this exists and
  -- why team_id is fully qualified (RETURNS TABLE makes an unqualified
  -- "team_id" ambiguous against demo.demo_sessions.team_id in plpgsql).
  for cleanup_team in
    select demo.demo_sessions.team_id from demo.demo_sessions
    where demo.demo_sessions.expires_at < now() and demo.demo_sessions.user_id <> auth.uid()
    order by demo.demo_sessions.expires_at asc
    limit 5
  loop
    delete from demo.demo_sessions where demo.demo_sessions.team_id = cleanup_team;
    delete from demo.teams where demo.teams.id = cleanup_team;
  end loop;

  select * into cloned from demo.clone_demo_dataset(auth.uid());

  insert into demo.demo_sessions (user_id, team_id, seed_version, generation, expires_at)
  values (auth.uid(), cloned.team_id, cloned.seed_version, 1, now() + interval '24 hours')
  on conflict (user_id) do update set
    team_id = excluded.team_id,
    seed_version = excluded.seed_version,
    generation = 1,
    created_at = now(),
    last_active_at = now(),
    expires_at = excluded.expires_at;

  if old_team_id is not null then
    delete from demo.teams where id = old_team_id;
  end if;

  return query select cloned.team_id, cloned.team_slug, 1;
end;
$$;
revoke all on function demo.start_demo_session() from public, anon;
grant execute on function demo.start_demo_session() to authenticated;
comment on function demo.start_demo_session() is
  'Anonymous demo bootstrap into the demo schema. Idempotent for a live session. Identity always from auth.uid(); never accepts a caller-supplied user/team id.';

create or replace function demo.reset_demo_session()
returns table (team_id uuid, team_slug text, generation integer)
language plpgsql
security definer
set search_path = ''
as $$
declare
  existing demo.demo_sessions;
  cloned record;
  next_generation integer;
  old_team_id uuid;
begin
  if auth.uid() is null then
    raise exception 'not authenticated';
  end if;

  perform pg_advisory_xact_lock(hashtext(auth.uid()::text));

  select * into existing from demo.demo_sessions where user_id = auth.uid();
  if existing.user_id is null then
    raise exception 'no demo session to reset - call demo.start_demo_session() first';
  end if;

  next_generation := existing.generation + 1;
  old_team_id := existing.team_id;

  -- clone-new -> repoint-session -> delete-old, never the reverse. See
  -- demo.demo_sessions.team_id's column comment above for the concurrent-
  -- reset corruption this ordering prevents.
  select * into cloned from demo.clone_demo_dataset(auth.uid());

  update demo.demo_sessions set
    team_id = cloned.team_id,
    seed_version = cloned.seed_version,
    generation = next_generation,
    last_active_at = now(),
    expires_at = now() + interval '24 hours'
  where user_id = auth.uid();

  delete from demo.teams where id = old_team_id;

  return query select cloned.team_id, cloned.team_slug, next_generation;
end;
$$;
revoke all on function demo.reset_demo_session() from public, anon;
grant execute on function demo.reset_demo_session() to authenticated;
comment on function demo.reset_demo_session() is
  'Transactional demo reset inside the demo schema: deletes and re-clones the caller''s own team, increments generation. Identity always from auth.uid(); never accepts a caller-supplied user/team id. Resetting one visitor never affects another.';
