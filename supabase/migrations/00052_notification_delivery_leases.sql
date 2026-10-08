-- Reliable, service-only consumption for the notification outbox created in
-- 00051. Provider delivery stays outside Postgres, but workers can now lease
-- events atomically, record each recipient once, recover stale claims, and
-- retry failures without resending successful recipients.

alter table public.notification_events
  add column claim_token uuid;

create table public.notification_delivery_receipts (
  event_id uuid not null references public.notification_events(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  delivered_at timestamptz not null default now(),
  primary key (event_id, user_id)
);
alter table public.notification_delivery_receipts enable row level security;
revoke all on public.notification_delivery_receipts from public, anon, authenticated;
grant all on public.notification_delivery_receipts to service_role;

comment on table public.notification_delivery_receipts is
  'Service-only per-recipient receipts. Prevents duplicate sends when one delivery in a batch fails.';

create or replace function public.claim_notification_events(p_limit integer default 50)
returns table(
  id uuid,
  event_kind text,
  player_id uuid,
  report_has_fix boolean,
  focus_status text,
  focus_concept text,
  focus_seen integer,
  focus_window_size integer,
  claim_token uuid
)
language plpgsql volatile security definer set search_path = '' as $$
begin
  if p_limit is null or p_limit < 1 or p_limit > 100 then
    raise exception 'notification claim limit must be between 1 and 100';
  end if;
  return query
  with candidates as (
    select e.id
    from public.notification_events e
    where e.delivered_at is null
      and e.available_at <= now()
      and (e.claimed_at is null or e.claimed_at < now() - interval '15 minutes')
    order by e.available_at, e.created_at
    limit p_limit
    for update skip locked
  )
  update public.notification_events e
  set claimed_at = now(), claim_token = gen_random_uuid(), delivery_attempts = e.delivery_attempts + 1
  from candidates c
  where e.id = c.id
  returning e.id, e.event_kind, e.player_id, e.report_has_fix, e.focus_status,
    e.focus_concept, e.focus_seen, e.focus_window_size, e.claim_token;
end;
$$;
revoke all on function public.claim_notification_events(integer) from public, anon, authenticated;
grant execute on function public.claim_notification_events(integer) to service_role;

create or replace function public.record_notification_delivery(
  p_event_ids uuid[],
  p_user_id uuid
) returns void
language plpgsql volatile security definer set search_path = '' as $$
declare
  v_event_id uuid;
begin
  if p_user_id is null or coalesce(array_length(p_event_ids, 1), 0) = 0 then
    raise exception 'notification receipt requires events and a recipient';
  end if;
  foreach v_event_id in array p_event_ids loop
    if not exists (
      select 1 from public.notification_events e
      where e.id = v_event_id and e.delivered_at is null and e.claim_token is not null
    ) or not exists (
      select 1 from public.notification_event_recipients(v_event_id) r where r.user_id = p_user_id
    ) then
      raise exception 'notification recipient is not currently eligible';
    end if;
    insert into public.notification_delivery_receipts(event_id, user_id)
    values (v_event_id, p_user_id)
    on conflict (event_id, user_id) do nothing;
  end loop;
end;
$$;
revoke all on function public.record_notification_delivery(uuid[], uuid) from public, anon, authenticated;
grant execute on function public.record_notification_delivery(uuid[], uuid) to service_role;

create or replace function public.finish_notification_event(
  p_event_id uuid,
  p_claim_token uuid,
  p_error text default null
) returns boolean
language plpgsql volatile security definer set search_path = '' as $$
declare
  v_attempts integer;
begin
  select e.delivery_attempts into v_attempts
  from public.notification_events e
  where e.id = p_event_id and e.delivered_at is null and e.claim_token = p_claim_token
  for update;
  if v_attempts is null then return false; end if;

  if nullif(btrim(p_error), '') is not null then
    update public.notification_events
    set claimed_at = null,
        claim_token = null,
        last_error = left(btrim(p_error), 500),
        available_at = now() + make_interval(mins => least(60, greatest(2, power(2, least(v_attempts, 6))::integer)))
    where id = p_event_id and claim_token = p_claim_token;
    return true;
  end if;

  if exists (
    select 1 from public.notification_event_recipients(p_event_id) r
    where not exists (
      select 1 from public.notification_delivery_receipts d
      where d.event_id = p_event_id and d.user_id = r.user_id
    )
  ) then
    raise exception 'notification event still has undelivered current recipients';
  end if;

  update public.notification_events
  set delivered_at = now(), claimed_at = null, claim_token = null, last_error = null
  where id = p_event_id and claim_token = p_claim_token;
  return found;
end;
$$;
revoke all on function public.finish_notification_event(uuid, uuid, text) from public, anon, authenticated;
grant execute on function public.finish_notification_event(uuid, uuid, text) to service_role;
