-- Cancel pending guardian invites (parent pathway, final review fix wave).
-- 00041 lets a coach create invite links but gave them no way to take one
-- back: a link sent to the wrong person stayed usable until it expired
-- (7 days) or was used. revoke_guardian() only removes an accepted link.
--
-- revoke_guardian_invites(p_player_id) - coaches of the player's team only:
-- stamps revoked_at on every invite for that player that is still usable
-- (unused, unrevoked, unexpired) and returns how many it cancelled.
-- accept_guardian_invite already refuses revoked invites ('invite revoked'),
-- and guardian_invite_preview returns null for them (00044).
-- Accepted links are untouched (revoke_guardian removes those).
--
-- public only (the demo schema has no guardian tables). Security definer,
-- `set search_path = ''`, fully qualified (00043 convention).

create or replace function public.revoke_guardian_invites(p_player_id uuid)
returns integer
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_team_id uuid;
  v_count integer;
begin
  if auth.uid() is null or coalesce((auth.jwt() ->> 'is_anonymous')::boolean, false) then
    raise exception 'not allowed';
  end if;
  select team_id into v_team_id from public.players where id = p_player_id;
  if v_team_id is null or not public.is_coach_for_team(v_team_id) then
    raise exception 'not allowed';
  end if;

  update public.guardian_invites
  set revoked_at = now()
  where player_id = p_player_id
    and used_at is null
    and revoked_at is null
    and expires_at > now();
  get diagnostics v_count = row_count;
  return v_count;
end;
$$;

revoke all on function public.revoke_guardian_invites(uuid) from public, anon;
grant execute on function public.revoke_guardian_invites(uuid) to authenticated;

comment on function public.revoke_guardian_invites(uuid) is
  'Coach of the player''s team: cancel every still-usable (unused, unrevoked, unexpired) guardian invite for the player. Returns the number cancelled.';

notify pgrst, 'reload schema';
