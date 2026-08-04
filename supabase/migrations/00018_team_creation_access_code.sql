-- Self-signup (00016) is fully open with no compensating control, on an app
-- whose own coach/config.js comment says it shouldn't be for a "publicly
-- reachable login page." A team-less coach account is inert on its own (see
-- 00017), so the thing actually worth gating is team creation, not account
-- creation - a coach can still sign up freely, but needs a real access code
-- (handed out by the app owner) to create her first team.
--
-- app_settings has NO policies at all - service_role only, same pattern
-- 00017 should have used for checkpoints/swing_phase_types from the start.
create table app_settings (
  key text primary key,
  value text not null
);
alter table app_settings enable row level security;

-- Placeholder only - this repo is public (jonmcurry/player-scouting-report).
-- A real production code must be set directly against the hosted project via
-- SQL once one exists, never committed here:
--   update app_settings set value = '...' where key = 'team_creation_code';
insert into app_settings (key, value) values ('team_creation_code', 'LOCAL-DEV-ONLY-CHANGE-ME');

-- Postgres overloads functions by signature - create or replace with a 3rd
-- parameter would leave the OLD 2-arg, no-code-check version still callable
-- side by side, completely defeating the gate. Must drop it explicitly.
drop function if exists create_team(text, text);

create or replace function create_team(p_slug text, p_name text, p_access_code text)
returns teams
language plpgsql
security definer
set search_path = public
as $$
declare
  new_team teams;
  real_code text;
begin
  if auth.uid() is null then
    raise exception 'not authenticated';
  end if;

  select value into real_code from app_settings where key = 'team_creation_code';
  if real_code is null or p_access_code is null or p_access_code <> real_code then
    raise exception 'invalid access code';
  end if;

  insert into teams (slug, name) values (p_slug, p_name) returning * into new_team;
  insert into coach_team_access (coach_id, team_id, role) values (auth.uid(), new_team.id, 'head_coach');

  return new_team;
end;
$$;

grant execute on function create_team(text, text, text) to authenticated;

comment on function create_team(text, text, text) is
  'Self-service team creation (coach/index.html), gated by an access code checked against app_settings - keeps signup itself frictionless while still requiring the app owner to hand out access before a stranger can create real team data.';
