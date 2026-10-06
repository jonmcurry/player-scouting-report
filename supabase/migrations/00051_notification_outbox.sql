-- Provider-independent notification boundary for the simplified app.
-- Events contain only opaque ids and one player's report/focus state. They
-- are service-role only: no coach or guardian can list the queue, infer a
-- teammate, or manufacture a notification. A future push/email worker must
-- resolve recipients at delivery time through notification_event_recipients
-- so revocation, re-consent, team removal, and the user's preference apply
-- immediately rather than being snapshotted when processing finishes.

create table public.notification_events (
  id uuid primary key default gen_random_uuid(),
  event_kind text not null check (event_kind in ('report_ready', 'analysis_failed', 'focus_status')),
  player_id uuid not null references public.players(id) on delete cascade,
  video_clip_id uuid references public.video_clips(id) on delete cascade,
  focus_id uuid references public.player_focus(id) on delete cascade,
  target_user_id uuid references auth.users(id) on delete cascade,
  report_has_fix boolean,
  focus_status text check (focus_status in ('improving', 'fixed')),
  focus_concept text,
  focus_seen integer check (focus_seen is null or focus_seen >= 0),
  focus_window_size integer check (focus_window_size is null or focus_window_size between 0 and 5),
  dedupe_key text not null unique,
  available_at timestamptz not null default now(),
  claimed_at timestamptz,
  delivered_at timestamptz,
  delivery_attempts integer not null default 0 check (delivery_attempts >= 0),
  last_error text,
  created_at timestamptz not null default now(),
  check (
    (event_kind = 'report_ready' and video_clip_id is not null and focus_id is null
      and target_user_id is null and report_has_fix is not null and focus_status is null)
    or
    (event_kind = 'analysis_failed' and video_clip_id is not null and focus_id is null
      and target_user_id is not null and report_has_fix is null and focus_status is null)
    or
    (event_kind = 'focus_status' and video_clip_id is null and focus_id is not null
      and target_user_id is null and report_has_fix is null and focus_status is not null
      and nullif(btrim(focus_concept), '') is not null)
  )
);
create index notification_events_pending_idx on public.notification_events(available_at, created_at)
  where delivered_at is null;
create index notification_events_player_kind_idx on public.notification_events(player_id, event_kind, created_at desc);
alter table public.notification_events enable row level security;
revoke all on public.notification_events from public, anon, authenticated;
grant all on public.notification_events to service_role;

comment on table public.notification_events is
  'Service-only outbox. Rows contain one player only and no names/contact details. Resolve current recipients at delivery time.';

-- Atomic, idempotent event creation. Report events wait two minutes so a
-- delivery worker can combine a multi-video upload into one per-player note.
-- Focus changes use a rolling seven-day player cooldown, not a calendar week.
create or replace function public.enqueue_notification_event(
  p_event_kind text,
  p_player_id uuid,
  p_source_id uuid,
  p_report_has_fix boolean default null,
  p_focus_status text default null,
  p_focus_concept text default null,
  p_focus_seen integer default null,
  p_focus_window_size integer default null
) returns uuid
language plpgsql volatile security definer set search_path = '' as $$
declare
  v_clip public.video_clips;
  v_focus public.player_focus;
  v_target uuid;
  v_key text;
  v_id uuid;
begin
  if p_event_kind = 'report_ready' then
    select c.* into v_clip from public.video_clips c
      join public.game_log_entries g on g.id = c.game_log_entry_id
      where c.id = p_source_id and g.player_id = p_player_id;
    if v_clip.id is null or p_report_has_fix is null then raise exception 'invalid report event'; end if;
    v_key := 'report_ready:' || v_clip.id::text;
    insert into public.notification_events
      (event_kind, player_id, video_clip_id, report_has_fix, dedupe_key, available_at)
    values ('report_ready', p_player_id, v_clip.id, p_report_has_fix, v_key, now() + interval '2 minutes')
    on conflict (dedupe_key) do nothing returning id into v_id;
  elsif p_event_kind = 'analysis_failed' then
    select c.* into v_clip from public.video_clips c
      join public.game_log_entries g on g.id = c.game_log_entry_id
      where c.id = p_source_id and g.player_id = p_player_id;
    if v_clip.id is null then raise exception 'invalid failure event'; end if;
    v_target := v_clip.uploaded_by;
    if v_target is null then return null; end if;
    v_key := 'analysis_failed:' || v_clip.id::text;
    insert into public.notification_events
      (event_kind, player_id, video_clip_id, target_user_id, dedupe_key)
    values ('analysis_failed', p_player_id, v_clip.id, v_target, v_key)
    on conflict (dedupe_key) do nothing returning id into v_id;
  elsif p_event_kind = 'focus_status' then
    if p_focus_status not in ('improving', 'fixed') or nullif(btrim(p_focus_concept), '') is null
      or p_focus_seen is null or p_focus_seen < 0
      or p_focus_window_size is null or p_focus_window_size < 0 or p_focus_window_size > 5 then
      raise exception 'invalid focus event';
    end if;
    select * into v_focus from public.player_focus where id = p_source_id and player_id = p_player_id;
    if v_focus.id is null then raise exception 'invalid focus event'; end if;
    perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended('notification-focus:' || p_player_id::text, 0));
    if exists (select 1 from public.notification_events
      where player_id = p_player_id and event_kind = 'focus_status'
        and created_at > now() - interval '7 days') then return null; end if;
    v_key := 'focus_status:' || v_focus.id::text || ':' || p_focus_status;
    insert into public.notification_events
      (event_kind, player_id, focus_id, focus_status, focus_concept, focus_seen, focus_window_size, dedupe_key)
    values ('focus_status', p_player_id, v_focus.id, p_focus_status, btrim(p_focus_concept),
      p_focus_seen, p_focus_window_size, v_key)
    on conflict (dedupe_key) do nothing returning id into v_id;
  else
    raise exception 'invalid notification event kind';
  end if;
  if v_id is null then select id into v_id from public.notification_events where dedupe_key = v_key; end if;
  return v_id;
end;
$$;
revoke all on function public.enqueue_notification_event(text, uuid, uuid, boolean, text, text, integer, integer)
  from public, anon, authenticated;
grant execute on function public.enqueue_notification_event(text, uuid, uuid, boolean, text, text, integer, integer)
  to service_role;

-- Current delivery recipients only. Missing user_settings means opted in.
-- A failure remains uploader-only and is suppressed if that uploader no
-- longer has access to this player. Every result belongs to this event's one
-- player, so a multi-player coach upload cannot leak another child's name.
create or replace function public.notification_event_recipients(p_event_id uuid)
returns table(user_id uuid)
language sql stable security definer set search_path = '' as $$
  with event as (
    select e.event_kind, e.player_id, e.target_user_id, p.team_id
    from public.notification_events e join public.players p on p.id = e.player_id
    where e.id = p_event_id and e.delivered_at is null
  ), eligible as (
    select c.coach_id as user_id from event e
      join public.coach_team_access c on c.team_id = e.team_id
    union
    select g.user_id from event e
      join public.player_guardians g on g.player_id = e.player_id
      join public.app_settings s on s.key = 'guardian_consent_version'
        and s.value <> '' and g.consent_version = s.value
  )
  select distinct x.user_id from event e join eligible x on true
    left join public.user_settings u on u.user_id = x.user_id
  where coalesce(u.notify_reports, true)
    and (e.event_kind <> 'analysis_failed' or x.user_id = e.target_user_id);
$$;
revoke all on function public.notification_event_recipients(uuid) from public, anon, authenticated;
grant execute on function public.notification_event_recipients(uuid) to service_role;
