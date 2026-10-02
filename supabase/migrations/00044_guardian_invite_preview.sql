-- Invite preview for the family page's consent screen (coach/family.html):
-- Consent text v1 names the child ({player} = first name), but a guardian
-- can't read players before accepting. This returns ONLY the first name of
-- the invite's player (first word of players.name) - no id, team, or other
-- detail - and only for an invite that accept_guardian_invite would accept
-- right now on token grounds: found by sha256(p_token) (never plaintext),
-- not used, not revoked, not expired.
--
-- Every failure (unknown/garbage token, used, revoked, expired, anonymous
-- demo session) returns the same NULL, so this is not an oracle for which
-- of those cases applies. Read-only; never consumes the invite.

create or replace function public.guardian_invite_preview(p_token text)
returns text
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_name text;
begin
  if auth.uid() is null then
    return null;
  end if;
  if coalesce((auth.jwt() ->> 'is_anonymous')::boolean, false) then
    return null;
  end if;
  if p_token is null or p_token = '' then
    return null;
  end if;

  select p.name into v_name
  from public.guardian_invites i
  join public.players p on p.id = i.player_id
  where i.token_hash = encode(extensions.digest(p_token, 'sha256'), 'hex')
    and i.used_at is null
    and i.revoked_at is null
    and i.expires_at > now();

  if v_name is null then
    return null;
  end if;
  return nullif(pg_catalog.split_part(pg_catalog.btrim(v_name), ' ', 1), '');
end;
$$;

revoke all on function public.guardian_invite_preview(text) from public, anon;
grant execute on function public.guardian_invite_preview(text) to authenticated;
