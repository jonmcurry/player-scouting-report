-- Real, confirmed gap: create_team (00018) checks the shared access code
-- with a plain `=` and no throttling - any authenticated coach can call the
-- RPC unboundedly to brute-force it. Low real risk today (low-value target,
-- small user base) but a real, closeable gap, not a hypothetical one.
--
-- No policies on this table, same "service-role/security-definer-only"
-- pattern app_settings already uses (00018) - nothing outside this function
-- ever needs direct access to it.
create table team_creation_attempts (
  id uuid primary key default gen_random_uuid(),
  coach_id uuid not null references auth.users (id),
  attempted_at timestamptz not null default now()
);

-- Same signature as 00018's create_team - a plain `create or replace` is
-- safe here (unlike 00018's own note about the 2-arg/3-arg overload trap,
-- which only applies when the ARGUMENT signature changes).
--
-- Real bug found and fixed while writing this migration's own verification
-- (not just assumed correct): an earlier version of this function recorded
-- each attempt with `insert ... ; ... raise exception 'invalid access
-- code'` when the code was wrong - but PL/pgSQL rolls back EVERY statement
-- executed earlier in the same function call the moment an exception
-- propagates out of it, which silently undid that same insert on every
-- single wrong-code attempt. Confirmed directly: 6 wrong-code calls in a
-- row all still returned "invalid access code" with zero rows ever landing
-- in team_creation_attempts - the exact case a brute-force rate limiter
-- most needs to catch. Fixed by returning NULL instead of raising for the
-- rate-limited/wrong-code cases specifically, so this function's whole
-- transaction commits normally either way and the tracking insert always
-- sticks - the client checks for a null result the same way it already
-- checks `error` from every other Supabase call. `not authenticated` still
-- raises (a genuine access-control failure, and there's no coach_id to
-- track an attempt against in that case anyway).
create or replace function create_team(p_slug text, p_name text, p_access_code text)
returns teams
language plpgsql
security definer
set search_path = public
as $$
declare
  new_team teams;
  real_code text;
  recent_attempts integer;
begin
  if auth.uid() is null then
    raise exception 'not authenticated';
  end if;

  -- Scoped to this coach only (cheap, no full-table scan) - doubles as
  -- ongoing cleanup, no separate cron job needed at this scale.
  delete from team_creation_attempts
    where coach_id = auth.uid() and attempted_at < now() - interval '1 day';

  select count(*) into recent_attempts from team_creation_attempts
    where coach_id = auth.uid() and attempted_at > now() - interval '15 minutes';
  if recent_attempts >= 5 then
    return null; -- rate limited - see this function's header comment on why this returns rather than raises
  end if;

  -- Recorded BEFORE the code check, deliberately, AND never rolled back by
  -- a subsequent wrong-code failure below (see header comment) - a failed
  -- guess must still count toward the limit, or this whole gate is a no-op.
  insert into team_creation_attempts (coach_id) values (auth.uid());

  select value into real_code from app_settings where key = 'team_creation_code';
  if real_code is null or p_access_code is null or p_access_code <> real_code then
    return null; -- wrong code - see this function's header comment on why this returns rather than raises
  end if;

  insert into teams (slug, name) values (p_slug, p_name) returning * into new_team;
  insert into coach_team_access (coach_id, team_id, role) values (auth.uid(), new_team.id, 'head_coach');

  return new_team;
end;
$$;

grant execute on function create_team(text, text, text) to authenticated;

comment on function create_team(text, text, text) is
  'Self-service team creation (coach/index.html), gated by an access code checked against app_settings, rate-limited to 5 attempts/15min per coach (see 00021_team_creation_rate_limit.sql). Returns NULL (not a thrown error) for both "wrong code" and "rate limited" - the caller must check for a null result, not rely on Supabase-client `error` - keeps signup itself frictionless while still requiring the app owner to hand out access before a stranger can create real team data.';
