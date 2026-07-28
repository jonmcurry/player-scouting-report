-- Initial schema for the private coach-editing backend.
--
-- Architecture note (see the approved migration plan): Supabase is the PRIVATE
-- coach-editing source of truth only. The public scouting reports on GitHub
-- Pages never talk to Supabase directly - a `generate` CLI (using the
-- service_role key, server-side only) reads this data and compiles the same
-- kind of flat static HTML that exists today. Because of that split, there is
-- deliberately no RLS policy granting the `anon` role read access anywhere in
-- this file - anon gets zero rows by default-deny, everywhere.
--
-- Updated note (00002_coach_app.sql): a second, SEPARATE client was later
-- added - an authenticated coach-facing app (coach/) that DOES talk to
-- Supabase directly from the browser. This is a deliberate, scoped exception,
-- not a violation of the paragraph above: it authenticates and runs as
-- `authenticated` (via the coach_rw_own_team policies below), never as
-- `anon` - anon still gets zero rows, everywhere, unchanged. The public
-- reports/ site remains exactly as described above, untouched.

create extension if not exists pgcrypto; -- gen_random_uuid()

-- ---------------------------------------------------------------------------
-- Reference data
-- ---------------------------------------------------------------------------

-- The 11 checklist checkpoints, fixed and shared across every team/player.
-- A reference table (not a free-text column) on purpose: today's two report
-- templates match checkpoints by ARRAY POSITION and already disagree on label
-- text ("Hip-Shoulder Sep." vs "Hip-shoulder separation") - a stable slug plus
-- an explicit sort_order removes that fragility entirely.
create table checkpoints (
  id uuid primary key default gen_random_uuid(),
  slug text unique not null,
  label text not null,
  sort_order smallint not null unique
);

insert into checkpoints (slug, label, sort_order) values
  ('stance-setup',      'Stance & setup',                    0),
  ('load',              'Load',                               1),
  ('stride',            'Stride / front-foot plant',          2),
  ('hip-shoulder-sep',  'Hip-shoulder separation',            3),
  ('hand-path',         'Hand path to ball',                  4),
  ('bat-path',          'Bat path through zone',               5),
  ('contact-point',     'Contact point',                       6),
  ('extension',         'Extension',                           7),
  ('head-eyes',         'Head/eyes',                           8),
  ('follow-through',    'Follow-through & finish',            9),
  ('swing-decisions',   'Swing decisions (pitch selection)',  10)
on conflict (slug) do nothing;

-- ---------------------------------------------------------------------------
-- Core tables
-- ---------------------------------------------------------------------------

create table teams (
  id uuid primary key default gen_random_uuid(),
  slug text unique not null,
  name text not null,
  created_at timestamptz not null default now()
);

-- Coaches authenticate via Supabase Auth (auth.users); this join table is the
-- entire access-control model - a coach can read/write a team's data iff a row
-- exists here. No other notion of "public" access exists in this schema.
create table coach_team_access (
  coach_id uuid not null references auth.users (id) on delete cascade,
  team_id uuid not null references teams (id) on delete cascade,
  role text not null default 'coach' check (role in ('coach', 'head_coach')),
  primary key (coach_id, team_id)
);

create table players (
  id uuid primary key default gen_random_uuid(),
  team_id uuid not null references teams (id) on delete cascade,
  slug text not null,
  name text not null,
  jersey_number text not null,
  created_at timestamptz not null default now(),
  unique (team_id, slug)
);

create table game_log_entries (
  id uuid primary key default gen_random_uuid(),
  player_id uuid not null references players (id) on delete cascade,
  date date not null,
  opponent text not null,
  ab smallint not null,
  -- Free text, e.g. "Outside, low" / "Rise ball, high" - deliberately not an
  -- enum, see src/types/scouting.ts's module docstring for why.
  pitch text,
  result text not null,
  -- GCS object path once media is migrated to cloud storage (e.g.
  -- "gs://<bucket>/<team_slug>/<player_slug>/<clip>.mp4"). Never a publicly
  -- readable URL embedded directly - see the "public HTML vs private media"
  -- note in the approved plan before ever surfacing this in generated HTML.
  clip_gcs_path text,
  -- Explicit display order, set from the source array's index at migrate
  -- time. Real report data doesn't reliably have a unique/monotonic sort key
  -- otherwise - multiple at-bats from the same real-world day are commonly
  -- logged with an identical `date` value (the day they were filmed/reviewed,
  -- not a true per-game timestamp), which was confirmed to silently reorder
  -- (interleave two different games' entries) when this was tested end-to-
  -- end against real data ordering only by (date, ab).
  position smallint not null default 0,
  created_at timestamptz not null default now()
);

create table checklist_scores (
  id uuid primary key default gen_random_uuid(),
  player_id uuid not null references players (id) on delete cascade,
  checkpoint_id uuid not null references checkpoints (id),
  score smallint check (score between 1 and 3),
  ai_draft smallint check (ai_draft between 1 and 3),
  reviewed_by text,
  notes text not null default '',
  -- Which automation produced ai_draft, if any - lets the UI distinguish a
  -- Gemini read from the pose3d pipeline's measured-angle read when they
  -- disagree. Null when a coach entered the score directly (no draft).
  source text check (source in ('gemini', 'pose3d')),
  updated_at timestamptz not null default now(),
  unique (player_id, checkpoint_id)
);

-- Real audit trail instead of a bare int[] "history" column - each re-score
-- is a row with a timestamp and who changed it, so the report's Trend column
-- becomes a query, not an ambiguous array a human has to keep in sync by hand.
create table checklist_score_history (
  id uuid primary key default gen_random_uuid(),
  checklist_score_id uuid not null references checklist_scores (id) on delete cascade,
  score smallint not null check (score between 1 and 3),
  changed_at timestamptz not null default now(),
  changed_by text
);

create table issues (
  id uuid primary key default gen_random_uuid(),
  player_id uuid not null references players (id) on delete cascade,
  issue text not null,
  seen_in_at_bats text not null default '',
  likely_cause text not null default '',
  effect text not null default '',
  reviewed_by text,
  source text check (source in ('gemini', 'pose3d')),
  created_at timestamptz not null default now()
);

-- ---------------------------------------------------------------------------
-- Base table grants
-- ---------------------------------------------------------------------------
-- GRANTs and RLS are two separate, independent layers - a role needs a GRANT
-- to touch a table AT ALL before RLS policies (or service_role's RLS-bypass
-- attribute) even come into play. A fresh Postgres schema starts with none of
-- Supabase's roles able to touch anything here; this is the layer that was
-- missing the first time this migration was tested end-to-end (every request
-- failed with "permission denied for table X", including as service_role,
-- until this block was added) - hosted Supabase projects get an equivalent
-- baseline set up by their own project-provisioning process, but a plain
-- `supabase db reset` against these migrations does not, so it has to be
-- explicit here.
--
-- service_role gets full access (it's the only role generate/migrate/ingest
-- ever authenticate as, and it bypasses RLS by its own Postgres attribute -
-- see supabase/config.toml). authenticated gets the same base grants, but
-- RLS (below) is what actually restricts a coach to their own team's rows -
-- the grant alone would let any authenticated user query any row without it.
-- anon deliberately gets NOTHING here, on top of having no RLS policy either
-- - two independent reasons anon can never read anything, not one.
grant usage on schema public to service_role, authenticated;
grant all on all tables in schema public to service_role;
grant select, insert, update, delete on all tables in schema public to authenticated;
alter default privileges in schema public
  grant all on tables to service_role;
alter default privileges in schema public
  grant select, insert, update, delete on tables to authenticated;

-- ---------------------------------------------------------------------------
-- Row-Level Security
-- ---------------------------------------------------------------------------

-- Single helper, reused by every policy below, so the access model changes in
-- exactly one place if it ever needs to. security definer so it can read
-- coach_team_access regardless of the calling role's own row-level grants.
create or replace function is_coach_for_team(target_team_id uuid)
returns boolean
language sql
security definer
stable
as $$
  select exists (
    select 1 from coach_team_access
    where coach_id = auth.uid() and team_id = target_team_id
  );
$$;

alter table teams enable row level security;
alter table players enable row level security;
alter table game_log_entries enable row level security;
alter table checklist_scores enable row level security;
alter table checklist_score_history enable row level security;
alter table issues enable row level security;
-- checkpoints is shared reference data, not team-scoped; intentionally no RLS
-- policy restricts it, but it's also not writable by anon/authenticated roles
-- (no policy = no access for those roles either - only service_role, which
-- bypasses RLS entirely, can modify it).

create policy coach_rw_own_team on teams
  for all using (is_coach_for_team(id)) with check (is_coach_for_team(id));

create policy coach_rw_own_team on players
  for all using (is_coach_for_team(team_id)) with check (is_coach_for_team(team_id));

create policy coach_rw_own_team on game_log_entries
  for all using (is_coach_for_team((select team_id from players where players.id = player_id)))
  with check (is_coach_for_team((select team_id from players where players.id = player_id)));

create policy coach_rw_own_team on checklist_scores
  for all using (is_coach_for_team((select team_id from players where players.id = player_id)))
  with check (is_coach_for_team((select team_id from players where players.id = player_id)));

create policy coach_rw_own_team on checklist_score_history
  for all using (
    is_coach_for_team((
      select p.team_id from checklist_scores cs
      join players p on p.id = cs.player_id
      where cs.id = checklist_score_id
    ))
  )
  with check (
    is_coach_for_team((
      select p.team_id from checklist_scores cs
      join players p on p.id = cs.player_id
      where cs.id = checklist_score_id
    ))
  );

create policy coach_rw_own_team on issues
  for all using (is_coach_for_team((select team_id from players where players.id = player_id)))
  with check (is_coach_for_team((select team_id from players where players.id = player_id)));

-- ---------------------------------------------------------------------------
-- Views
-- ---------------------------------------------------------------------------

-- Team-wide checkpoint averages + weakness flag (< PATTERN_AVG_THRESHOLD, kept
-- in sync with src/types/scouting.ts's exported constant) + confirmed-review
-- counts. Inherits RLS from the underlying tables via security_invoker, so a
-- coach querying this view only ever sees their own team's rows - same
-- access model as the base tables, not a separate hole to keep in sync.
create view team_summary_stats
with (security_invoker = true)
as
select
  p.team_id,
  c.id as checkpoint_id,
  c.slug as checkpoint_slug,
  c.label as checkpoint_label,
  c.sort_order,
  avg(cs.score)::numeric(3, 2) as avg_score,
  avg(cs.score) < 2.0 as is_team_weakness,
  count(cs.score) as scored_count,
  count(cs.reviewed_by) as reviewed_count
from checkpoints c
left join checklist_scores cs on cs.checkpoint_id = c.id
left join players p on p.id = cs.player_id
group by p.team_id, c.id, c.slug, c.label, c.sort_order;
