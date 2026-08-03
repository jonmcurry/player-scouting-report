-- Self-service coach signup: a coach creates their own team instead of an
-- admin running provisionCoach.ts. teams' only existing RLS policy
-- (coach_rw_own_team, 00001) is `for all using/with check
-- (is_coach_for_team(id))` - a chicken-and-egg deny for INSERT, since a
-- coach can't have a coach_team_access row for a team that doesn't exist
-- yet. coach_team_access itself has zero insert/update/delete policies at
-- all (deliberately, per 00002's own comment - admin-only via
-- provisionCoach.ts, which always uses the service_role client).
--
-- Rather than add two new client-facing INSERT policies (one on teams, one
-- on coach_team_access gated by "team has zero coaches yet" to stop a coach
-- self-joining someone else's existing team), this is a single security
-- definer RPC - same pattern this schema already uses for
-- is_coach_for_team(). One function call, one transaction: no window where
-- a team can exist with no coach attached, which two separate client-side
-- inserts (not wrapped in a transaction) would risk.
--
-- Coach invites to an EXISTING team are deliberately not built here - see
-- NEXT_STEPS.md. role='head_coach' here just gives the previously-inert
-- role column its first real meaning (the team's creator) - not enforced
-- anywhere yet.
create or replace function create_team(p_slug text, p_name text)
returns teams
language plpgsql
security definer
set search_path = public
as $$
declare
  new_team teams;
begin
  if auth.uid() is null then
    raise exception 'not authenticated';
  end if;

  insert into teams (slug, name) values (p_slug, p_name) returning * into new_team;
  insert into coach_team_access (coach_id, team_id, role) values (auth.uid(), new_team.id, 'head_coach');

  return new_team;
end;
$$;

grant execute on function create_team(text, text) to authenticated;

comment on function create_team(text, text) is
  'Self-service team creation (coach/index.html) - atomically creates a team AND makes the calling coach its head_coach, so a team can never exist with zero coaches attached. Player creation needs no equivalent function - the existing coach_rw_own_team policy on players already allows insert for any team the caller has coach_team_access to.';
