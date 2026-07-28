-- Coach app support: coach display-name profiles + an automatic checklist
-- score-history audit trail. See supabase/migrations/00001_initial_schema.sql
-- for the base schema and its updated architecture note on why an
-- authenticated coach app querying Supabase directly is a deliberate, scoped
-- exception, not a violation of "the public site never talks to Supabase."

-- ---------------------------------------------------------------------------
-- coach_profiles
-- ---------------------------------------------------------------------------
-- Why a real table instead of Supabase Auth's user_metadata (the simpler-
-- looking option): user_metadata is client-writable (any signed-in coach
-- could call auth.updateUser and rename themselves, or have it silently
-- overwritten by an OAuth provider on a future login) and isn't joinable in
-- SQL for anything aggregate later ("which coach reviewed the most
-- checkpoints"). Same reference-table instinct already used for checkpoints
-- in 00001 - a real, queryable row instead of overloading a blob/metadata
-- field just because it's already there.
create table coach_profiles (
  user_id uuid primary key references auth.users (id) on delete cascade,
  display_name text not null,
  created_at timestamptz not null default now()
);

alter table coach_profiles enable row level security;

-- Any authenticated coach can see any other coach's display name (low-
-- sensitivity - just a name, not the underlying team/access data) - useful
-- for e.g. "who else is on this team" without needing a team-scoped join for
-- something this low-stakes. Writing your own row is the only restricted part.
create policy coach_profiles_select_any on coach_profiles
  for select using (auth.role() = 'authenticated');

create policy coach_profiles_write_own on coach_profiles
  for insert with check (user_id = auth.uid());

create policy coach_profiles_update_own on coach_profiles
  for update using (user_id = auth.uid()) with check (user_id = auth.uid());

-- New table created after 00001's `alter default privileges` calls should
-- inherit those grants automatically (same schema, same executing role across
-- migrations) - granted explicitly here anyway rather than relying on that
-- implicit behavior, consistent with 00001's own "GRANTs and RLS are two
-- separate, independent layers" note, and because this was directly verified
-- to matter there (the whole reason that block exists is a real failure
-- caught by testing, not a hypothetical).
grant select, insert, update, delete on coach_profiles to authenticated;
grant all on coach_profiles to service_role;

-- ---------------------------------------------------------------------------
-- checklist_score_history: auto-populate via trigger, not per-caller code
-- ---------------------------------------------------------------------------
-- Found while designing the coach app: migrate.ts writes history explicitly,
-- but src/services/db/checklistUpsert.ts (used by ingest.ts, analyze.ts, and
-- what the coach app's stepper would otherwise also need to remember to call)
-- does NOT - the audit trail silently goes incomplete for every write path
-- except migrate.ts's one-time bootstrap. A trigger fixes this at the source
-- for every current and future writer (including the coach app's direct
-- UPDATE statements, which don't go through any TypeScript helper at all) -
-- a trigger can't be forgotten by a future call site the way a "remember to
-- also insert into history" convention can.
create or replace function log_checklist_score_history()
returns trigger
language plpgsql
as $$
begin
  if new.score is distinct from old.score then
    insert into checklist_score_history (checklist_score_id, score, changed_by)
    values (new.id, new.score, new.reviewed_by);
  end if;
  return new;
end;
$$;

create trigger checklist_scores_history_trigger
  after update on checklist_scores
  for each row
  execute function log_checklist_score_history();

-- ---------------------------------------------------------------------------
-- Fix a real gap in 00001: coach_team_access itself was never given RLS
-- ---------------------------------------------------------------------------
-- Found by testing the coach app, not by inspection: 00001 creates
-- coach_team_access and reads it from inside is_coach_for_team(), but never
-- runs `enable row level security` or adds a policy FOR IT. Every other
-- coach-facing table correctly restricts to the caller's own team via that
-- function - but with no RLS of its own, coach_team_access was readable in
-- full by any authenticated user, leaking every coach's team-access mapping
-- (which coach has access to which team, and what role) across all teams,
-- not just their own. It surfaced concretely as a phantom duplicate row with
-- a null embedded `teams` join when a coach queried their own access list -
-- PostgREST was correctly returning ANOTHER coach's coach_team_access row too
-- (that coach's own `teams` embed then correctly failed real RLS on the
-- `teams` table itself, which is why it came back null instead of leaking
-- the actual team, but the row's existence and role were already exposed).
--
-- Scope of the fix: a coach can read only their OWN access rows (needed to
-- know "which teams am I on" - exactly what the coach app's team picker
-- queries). Writing coach_team_access stays service_role/admin-only
-- (provisionCoach.ts) - no insert/update/delete policy for authenticated.
alter table coach_team_access enable row level security;

create policy coach_read_own_access on coach_team_access
  for select using (coach_id = auth.uid());

grant select on coach_team_access to authenticated;
grant all on coach_team_access to service_role;
