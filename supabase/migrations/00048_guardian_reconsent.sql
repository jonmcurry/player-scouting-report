-- A linked guardian must accept the current consent text before accessing a
-- child's reports, progress, videos, uploads, or deletion controls. Keep the
-- link row so the guardian can renew consent or unlink without a new invite.
create or replace function public.is_guardian_for_player(target_player_id uuid)
returns boolean language sql stable security definer set search_path = '' as $$
  select auth.uid() is not null and exists (
    select 1 from public.player_guardians pg
    join public.app_settings s on s.key = 'guardian_consent_version'
    where pg.user_id = auth.uid() and pg.player_id = target_player_id
      and pg.consent_version = s.value and s.value <> ''
  );
$$;
revoke all on function public.is_guardian_for_player(uuid) from public, anon;
grant execute on function public.is_guardian_for_player(uuid) to authenticated, service_role;

-- A stale link may reveal only its own child's first name so the same named
-- consent text used for invitations can be shown again. No roster read grant.
create or replace function public.guardian_consent_preview(p_player_id uuid)
returns text language sql stable security definer set search_path = '' as $$
  select case when auth.uid() is not null
    and not coalesce((auth.jwt() ->> 'is_anonymous')::boolean, false)
    then split_part(btrim(p.name), ' ', 1) else null end
  from public.player_guardians pg
  join public.players p on p.id = pg.player_id
  where pg.user_id = auth.uid() and pg.player_id = p_player_id;
$$;
revoke all on function public.guardian_consent_preview(uuid) from public, anon;
grant execute on function public.guardian_consent_preview(uuid) to authenticated, service_role;

-- A guardian may renew only an existing link and only for the current text
-- version. Revoked or unrelated accounts cannot manufacture a link.
create or replace function public.renew_guardian_consent(p_player_id uuid, p_consent_version text)
returns void language plpgsql volatile security definer set search_path = '' as $$
declare
  v_current text;
begin
  if auth.uid() is null or coalesce((auth.jwt() ->> 'is_anonymous')::boolean, false) then
    raise exception 'not allowed';
  end if;
  select value into v_current from public.app_settings where key = 'guardian_consent_version';
  if v_current is null or v_current = '' or p_consent_version is distinct from v_current then
    raise exception 'consent version mismatch';
  end if;
  update public.player_guardians set consent_version = v_current, consented_at = now()
    where user_id = auth.uid() and player_id = p_player_id;
  if not found then raise exception 'not allowed'; end if;
end;
$$;
revoke all on function public.renew_guardian_consent(uuid, text) from public, anon;
grant execute on function public.renew_guardian_consent(uuid, text) to authenticated;
