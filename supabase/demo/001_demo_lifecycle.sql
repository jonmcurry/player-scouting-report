-- ===========================================================================
-- OBSOLETE / REFERENCE-ONLY as of 2026-09-22. Preserved for history only -
-- NOT the authoritative demo implementation anymore, and NOT applied
-- anywhere.
--
-- This file targeted a DEDICATED demo Supabase project (a full second copy
-- of the real production schema via supabase/migrations/*.sql, plus these
-- additions, with demo teams/players stored directly in that project's
-- public.teams/public.players). That plan is superseded by the temporary
-- SAME-PROJECT + isolated `demo` Postgres schema architecture - see
-- supabase/migrations/00031_demo_shared_project_schema.sql (the real,
-- authoritative migration) and docs/research/demo-shared-project-architecture.md
-- for why and what changed. supabase/demo/README.md documents both the
-- historical dedicated-project plan (still the eventual target - see that
-- doc's "future migration back to a dedicated project" section) and today's
-- interim reality.
-- ===========================================================================

-- Demo-only additions (Phases 1-2 of the approved HitterLoop demo
-- architecture). Applied ONLY to a dedicated demo Supabase project, AFTER
-- supabase/migrations/*.sql (the real, unmodified production schema) - see
-- supabase/demo/README.md. Never referenced by supabase/migrations/ or
-- `npm run db:reset`, so it never touches this repo's normal dev/test
-- database.
--
-- Zero changes to any existing table's RLS policy are made or needed here.
-- Every existing team-scoped policy already keys off is_coach_for_team()
-- (00001_initial_schema.sql), which only checks coach_team_access - a
-- Supabase anonymous-auth user is still a real authenticated auth.uid(),
-- so once they have exactly one coach_team_access row (inserted below,
-- scoped to their own cloned team), the entire existing app just works
-- against their clone with no special-casing anywhere else in the schema.
-- Isolation is a property of "one coach_team_access row per visitor,
-- pointing at their own team" plus the cascade deletes already in place on
-- every team-owned table (verified directly against information_schema
-- before writing this file - players/coach_team_access/drill_library/
-- player_priorities all CASCADE on teams, and everything hanging off
-- players also CASCADEs), not anything new.

-- ---------------------------------------------------------------------
-- demo_sessions - one row per anonymous visitor, tracking which cloned
-- team is theirs, for how long, and which reset generation they're on.
-- ---------------------------------------------------------------------
create table demo_sessions (
  user_id uuid primary key references auth.users (id) on delete cascade,
  -- Deliberately NOT "on delete cascade" from teams: reset_demo_session()
  -- must delete the OLD team only after repointing this row at the NEW
  -- team, never before - a real bug found and fixed while writing this
  -- file's own verification (demo.test.ts). An earlier cascading version
  -- of this FK meant deleting the old team during reset silently deleted
  -- this very row too (a DELETE cascade races ahead of the UPDATE that
  -- was meant to save it), so a concurrent-reset test found 2 of 3 calls
  -- failing with "no demo session to reset" and the session left with NO
  -- row at all after a "successful" reset. Fixed by both removing the
  -- cascade here AND reordering every RPC below to always clone-then-
  -- repoint-then-delete, never delete-then-clone.
  team_id uuid not null unique references teams (id),
  seed_version text not null,
  generation integer not null default 1,
  created_at timestamptz not null default now(),
  last_active_at timestamptz not null default now(),
  expires_at timestamptz not null
);
alter table demo_sessions enable row level security;
-- Read-only to its own owner. All mutation happens exclusively through the
-- SECURITY DEFINER functions below (which, following this repo's existing
-- create_team/review_methodology_claim pattern, run as the migration-owner
-- role and therefore bypass RLS the same way every other guarded RPC here
-- already does) - never a direct authenticated insert/update/delete.
create policy demo_sessions_read_own on demo_sessions
  for select to authenticated using (user_id = auth.uid());
grant select on demo_sessions to authenticated;

-- ---------------------------------------------------------------------
-- demo_seed_templates - the canonical fictional dataset, stored as one
-- JSON blob per version rather than a duplicated second copy of the real
-- table structures. Keeps a single source of schema truth (the real
-- tables, populated by clone_demo_dataset() below) while making future
-- CONTENT changes (Phase 4's fuller Player A/B/C narrative) a data update,
-- not a new migration. No RLS policy at all is granted to `authenticated`
-- - the canonical seed must not be directly visible or mutable to demo
-- visitors (security requirement), so only the SECURITY DEFINER clone
-- function can ever read this table.
-- ---------------------------------------------------------------------
create table demo_seed_templates (
  seed_version text primary key,
  payload jsonb not null,
  active boolean not null default true,
  created_at timestamptz not null default now()
);
alter table demo_seed_templates enable row level security;
-- Deliberately no policies and no grants to authenticated/anon.
revoke all on demo_seed_templates from authenticated, anon;

-- ---------------------------------------------------------------------
-- clone_demo_dataset - shared internal helper used by both bootstrap and
-- reset. Reads the active canonical template and inserts a brand-new
-- team/players set owned by the given user. Not exposed to authenticated
-- directly (no grant) - only callable from within this file's other
-- SECURITY DEFINER functions.
-- ---------------------------------------------------------------------
create or replace function clone_demo_dataset(p_user_id uuid)
returns table (team_id uuid, team_slug text, seed_version text)
language plpgsql
security definer
set search_path = public
as $$
declare
  template record;
  new_team_id uuid := gen_random_uuid();
  new_team_slug text := 'demo-' || replace(gen_random_uuid()::text, '-', '');
  player_json jsonb;
begin
  select * into template from demo_seed_templates where active = true order by created_at desc limit 1;
  if template.seed_version is null then
    raise exception 'no active demo_seed_templates row - the demo canonical seed has not been loaded';
  end if;

  insert into teams (id, slug, name, sport, level_label)
  values (
    new_team_id,
    new_team_slug,
    template.payload->'team'->>'name',
    template.payload->'team'->>'sport',
    template.payload->'team'->>'level_label'
  );

  for player_json in select * from jsonb_array_elements(template.payload->'players')
  loop
    insert into players (id, team_id, slug, name, jersey_number, age_band, bats, throws)
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

  insert into coach_team_access (coach_id, team_id, role) values (p_user_id, new_team_id, 'head_coach');

  return query select new_team_id, new_team_slug, template.seed_version;
end;
$$;

-- ---------------------------------------------------------------------
-- start_demo_session - anonymous bootstrap. Idempotent: a live session
-- already existing for this caller is returned as-is rather than
-- re-cloned, so a page reload never produces duplicate teams. Identity
-- always comes from auth.uid() - never accepts a caller-supplied user id.
-- ---------------------------------------------------------------------
create or replace function start_demo_session()
returns table (team_id uuid, team_slug text, generation integer)
language plpgsql
security definer
set search_path = public
as $$
declare
  existing demo_sessions;
  cloned record;
  cleanup_team uuid;
  old_team_id uuid;
begin
  if auth.uid() is null then
    raise exception 'not authenticated';
  end if;

  -- Serialize concurrent calls from the same visitor (e.g. two tabs opened
  -- at once) - released automatically at transaction end.
  perform pg_advisory_xact_lock(hashtext(auth.uid()::text));

  select * into existing from demo_sessions where user_id = auth.uid();
  if existing.user_id is not null and existing.expires_at > now() then
    update demo_sessions set last_active_at = now() where user_id = auth.uid();
    return query select existing.team_id, (select slug from teams where id = existing.team_id), existing.generation;
    return;
  end if;

  if existing.user_id is not null then
    old_team_id := existing.team_id;
  end if;

  -- Bounded, cron-free "lazy cleanup" of a HANDFUL of other visitors'
  -- expired sessions per the amendment's "lazy cleanup, no scheduler yet"
  -- instruction - not a full sweep, just enough that storage doesn't grow
  -- unbounded purely from bootstrap traffic. team_id qualified with the
  -- table name throughout: the RETURNS TABLE clause above makes "team_id"
  -- an OUT-parameter variable in this function's own scope, which plpgsql
  -- otherwise treats as ambiguous against demo_sessions.team_id in an
  -- unqualified reference (confirmed directly while testing this file -
  -- an earlier unqualified version failed with "column reference
  -- \"team_id\" is ambiguous" when actually run).
  for cleanup_team in
    select demo_sessions.team_id from demo_sessions
    where demo_sessions.expires_at < now() and demo_sessions.user_id <> auth.uid()
    order by demo_sessions.expires_at asc
    limit 5
  loop
    delete from demo_sessions where demo_sessions.team_id = cleanup_team;
    delete from teams where id = cleanup_team;
  end loop;

  -- Clone the new dataset and repoint this user's demo_sessions row at it
  -- BEFORE deleting any prior team - never delete-then-clone (see this
  -- table's own team_id column comment for why).
  select * into cloned from clone_demo_dataset(auth.uid());

  insert into demo_sessions (user_id, team_id, seed_version, generation, expires_at)
  values (auth.uid(), cloned.team_id, cloned.seed_version, 1, now() + interval '24 hours')
  on conflict (user_id) do update set
    team_id = excluded.team_id,
    seed_version = excluded.seed_version,
    generation = 1,
    created_at = now(),
    last_active_at = now(),
    expires_at = excluded.expires_at;

  if old_team_id is not null then
    delete from teams where id = old_team_id;
  end if;

  return query select cloned.team_id, cloned.team_slug, 1;
end;
$$;
grant execute on function start_demo_session() to authenticated;
comment on function start_demo_session() is
  'Anonymous demo bootstrap. Idempotent for a live session. Identity always from auth.uid(); never accepts a caller-supplied user/team id.';

-- ---------------------------------------------------------------------
-- reset_demo_session - transactional reset. Requires the caller to have
-- an existing demo_sessions row (call start_demo_session() first).
-- ---------------------------------------------------------------------
create or replace function reset_demo_session()
returns table (team_id uuid, team_slug text, generation integer)
language plpgsql
security definer
set search_path = public
as $$
declare
  existing demo_sessions;
  cloned record;
  next_generation integer;
  old_team_id uuid;
begin
  if auth.uid() is null then
    raise exception 'not authenticated';
  end if;

  perform pg_advisory_xact_lock(hashtext(auth.uid()::text));

  select * into existing from demo_sessions where user_id = auth.uid();
  if existing.user_id is null then
    raise exception 'no demo session to reset - call start_demo_session() first';
  end if;

  next_generation := existing.generation + 1;
  old_team_id := existing.team_id;

  -- Clone the new dataset and repoint demo_sessions at it FIRST, then
  -- delete the old team only afterward - never delete-then-clone. See
  -- demo_sessions.team_id's column comment: an earlier delete-first
  -- version of this function raced its own cascade and silently wiped the
  -- very session row it was about to update, confirmed by a concurrent-
  -- reset test failing 2/3 calls with "no demo session to reset".
  select * into cloned from clone_demo_dataset(auth.uid());

  update demo_sessions set
    team_id = cloned.team_id,
    seed_version = cloned.seed_version,
    generation = next_generation,
    last_active_at = now(),
    expires_at = now() + interval '24 hours'
  where user_id = auth.uid();

  -- Delete the caller's own PRIOR team ONLY, now that demo_sessions no
  -- longer references it - cascade wipes everything team-owned (players,
  -- games, priorities, drills, practice, findings, share links, ...).
  -- Never touches any other visitor's team.
  delete from teams where id = old_team_id;

  return query select cloned.team_id, cloned.team_slug, next_generation;
end;
$$;
grant execute on function reset_demo_session() to authenticated;
comment on function reset_demo_session() is
  'Transactional demo reset: deletes and re-clones the caller''s own team, recreates a fresh share token via the normal player_share_links flow (the old one is cascade-deleted with the old team), increments generation. Identity always from auth.uid(); never accepts a caller-supplied user/team id. Resetting one visitor never affects another - only demo_sessions.user_id = auth.uid() is ever touched.';
