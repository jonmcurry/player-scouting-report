-- Fail closed for shared reports while any linked guardian has stale consent,
-- and add service-only native push-token storage. Actual provider delivery
-- remains an external worker concern.

create or replace function public.all_linked_guardians_current(p_player_id uuid)
returns boolean language sql stable security definer set search_path = '' as $$
  select not exists (
    select 1
    from public.player_guardians pg
    left join public.app_settings s
      on s.key = 'guardian_consent_version'
    where pg.player_id = p_player_id
      and (s.value is null or s.value = '' or pg.consent_version is distinct from s.value)
  );
$$;
revoke all on function public.all_linked_guardians_current(uuid) from public, anon, authenticated;
grant execute on function public.all_linked_guardians_current(uuid) to service_role;

create or replace function public.create_simple_share_link(
  p_player_id uuid, p_scope text, p_clip_id uuid default null
) returns text
language plpgsql volatile security definer set search_path = '' as $$
declare
  v_team_id uuid;
  v_token text;
begin
  if auth.uid() is null or coalesce((auth.jwt() ->> 'is_anonymous')::boolean, false) then
    raise exception 'not allowed';
  end if;
  select team_id into v_team_id from public.players where id = p_player_id;
  if v_team_id is null or not (public.is_coach_for_team(v_team_id) or public.is_guardian_for_player(p_player_id)) then
    raise exception 'not allowed';
  end if;
  if not public.all_linked_guardians_current(p_player_id) then
    raise exception 'sharing is unavailable until guardian consent is current';
  end if;
  if p_scope is null or (p_scope = 'report' and (p_clip_id is null or not exists (
    select 1 from public.video_clips c join public.game_log_entries g on g.id = c.game_log_entry_id
    where c.id = p_clip_id and g.player_id = p_player_id and c.status = 'ready'
  ))) or (p_scope = 'progress' and p_clip_id is not null) or p_scope not in ('report', 'progress') then
    raise exception 'invalid share target';
  end if;
  v_token := pg_catalog.encode(extensions.gen_random_bytes(32), 'hex');
  insert into public.player_share_links(player_id, token, created_by, share_scope, video_clip_id)
    values (p_player_id, v_token, auth.uid(), p_scope, p_clip_id);
  return v_token;
end;
$$;
revoke all on function public.create_simple_share_link(uuid, text, uuid) from public, anon;
grant execute on function public.create_simple_share_link(uuid, text, uuid) to authenticated, service_role;

create table public.notification_push_tokens (
  token text primary key check (char_length(token) between 20 and 4096),
  user_id uuid not null references auth.users(id) on delete cascade,
  platform text not null check (platform in ('android')),
  created_at timestamptz not null default now(),
  last_seen_at timestamptz not null default now(),
  disabled_at timestamptz
);
create index notification_push_tokens_user_idx
  on public.notification_push_tokens(user_id, last_seen_at desc);
alter table public.notification_push_tokens enable row level security;
revoke all on public.notification_push_tokens from public, anon, authenticated;
grant all on public.notification_push_tokens to service_role;

comment on table public.notification_push_tokens is
  'Service-only native notification destinations. Clients register or remove only their own token through narrow RPCs.';

create or replace function public.register_notification_push_token(p_token text, p_platform text)
returns void language plpgsql volatile security definer set search_path = '' as $$
begin
  if auth.uid() is null or coalesce((auth.jwt() ->> 'is_anonymous')::boolean, false)
    or p_platform <> 'android' or char_length(coalesce(p_token, '')) not between 20 and 4096 then
    raise exception 'invalid push token';
  end if;
  insert into public.notification_push_tokens(token, user_id, platform)
    values (p_token, auth.uid(), p_platform)
  on conflict (token) do update set
    user_id = excluded.user_id,
    platform = excluded.platform,
    last_seen_at = now(),
    disabled_at = null;

  delete from public.notification_push_tokens t
  where t.user_id = auth.uid() and t.token not in (
    select keep.token from public.notification_push_tokens keep
    where keep.user_id = auth.uid()
    order by keep.last_seen_at desc, keep.token
    limit 5
  );
end;
$$;
revoke all on function public.register_notification_push_token(text, text) from public, anon;
grant execute on function public.register_notification_push_token(text, text) to authenticated;

create or replace function public.unregister_notification_push_token(p_token text)
returns void language sql volatile security definer set search_path = '' as $$
  delete from public.notification_push_tokens
  where token = p_token and user_id = auth.uid();
$$;
revoke all on function public.unregister_notification_push_token(text) from public, anon;
grant execute on function public.unregister_notification_push_token(text) to authenticated;

create or replace function public.disable_notification_push_token(p_token text)
returns void language sql volatile security definer set search_path = '' as $$
  update public.notification_push_tokens set disabled_at = now()
  where token = p_token;
$$;
revoke all on function public.disable_notification_push_token(text) from public, anon, authenticated;
grant execute on function public.disable_notification_push_token(text) to service_role;
