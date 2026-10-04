-- Additive foundations for automatic reports. Historical coach-reviewed data
-- stays available for rollback; the new read path ignores it.

alter table public.teams add column age_group text check (age_group ~ '^(8|9|1[0-8])U$');
alter table demo.teams add column age_group text check (age_group ~ '^(8|9|1[0-8])U$');

create or replace function public.create_simple_team(
  p_slug text, p_name text, p_access_code text, p_sport text, p_age_group text, p_level_label text default null
) returns public.teams
language plpgsql volatile security definer set search_path = '' as $$
declare
  v_team public.teams;
begin
  if p_sport is null or p_sport not in ('baseball', 'softball') or
     p_age_group is null or p_age_group !~ '^(8|9|1[0-8])U$' then
    raise exception 'sport and age group required';
  end if;
  v_team := public.create_team(p_slug, p_name, p_access_code);
  if v_team.id is null then return null; end if;
  update public.teams set sport = p_sport, age_group = p_age_group, level_label = p_level_label
    where id = v_team.id returning * into v_team;
  return v_team;
end;
$$;
revoke all on function public.create_simple_team(text, text, text, text, text, text) from public, anon;
grant execute on function public.create_simple_team(text, text, text, text, text, text) to authenticated;

alter table public.game_log_entries add column result_simple text
  check (result_simple in ('hit', 'out', 'walk', 'strikeout'));
alter table demo.game_log_entries add column result_simple text
  check (result_simple in ('hit', 'out', 'walk', 'strikeout'));
alter table public.game_log_entries add column simple_capture_id uuid;
alter table demo.game_log_entries add column simple_capture_id uuid;
create unique index game_log_entries_simple_capture_id on public.game_log_entries(simple_capture_id)
  where simple_capture_id is not null;
create unique index demo_game_log_entries_simple_capture_id on demo.game_log_entries(simple_capture_id)
  where simple_capture_id is not null;

-- A coach or linked guardian creates exactly one backing entry per selected
-- video. The existing practice-entry trigger creates its hidden rep rows.
create or replace function public.create_simple_at_bat(
  p_player_id uuid, p_kind text, p_result text default null, p_date date default current_date,
  p_capture_id uuid default null
) returns uuid
language plpgsql volatile security definer set search_path = '' as $$
declare
  v_team_id uuid;
  v_ab smallint;
  v_position smallint;
  v_id uuid;
begin
  if auth.uid() is null or coalesce((auth.jwt() ->> 'is_anonymous')::boolean, false) then
    raise exception 'not allowed';
  end if;
  select team_id into v_team_id from public.players where id = p_player_id;
  if v_team_id is null or not (public.is_coach_for_team(v_team_id) or public.is_guardian_for_player(p_player_id)) then
    raise exception 'not allowed';
  end if;
  if p_kind not in ('game', 'practice') or p_result is not null and p_result not in ('hit', 'out', 'walk', 'strikeout') then
    raise exception 'invalid capture choice';
  end if;
  if p_date is null or p_date > current_date + 1 or p_date < current_date - 365 then
    raise exception 'invalid date';
  end if;
  if p_capture_id is null then raise exception 'capture ID required'; end if;
  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended('simple_capture:' || p_capture_id::text, 0));
  select id into v_id from public.game_log_entries where simple_capture_id = p_capture_id;
  if v_id is not null then
    if not exists (select 1 from public.game_log_entries where id = v_id and player_id = p_player_id
      and session_type = p_kind and result_simple is not distinct from p_result and date = p_date) then
      raise exception 'capture ID reused for different at-bat';
    end if;
    return v_id;
  end if;
  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended('simple_at_bat:' || p_player_id::text, 0));
  select coalesce(max(ab), 0) + 1 into v_ab from public.game_log_entries
    where player_id = p_player_id and date = p_date and session_type = p_kind;
  if p_kind = 'practice' then
    select count(*) into v_position from public.game_log_entries
      where player_id = p_player_id and session_type = 'practice';
    insert into public.game_log_entries (player_id, session_type, date, ab, session_note, position, result_simple, simple_capture_id)
      values (p_player_id, 'practice', p_date, v_ab, null, v_position, p_result, p_capture_id) returning id into v_id;
  else
    insert into public.game_log_entries (player_id, session_type, date, opponent, ab, result, result_simple, simple_capture_id)
      values (p_player_id, 'game', p_date, null, v_ab, null, p_result, p_capture_id) returning id into v_id;
  end if;
  return v_id;
end;
$$;
revoke all on function public.create_simple_at_bat(uuid, text, text, date, uuid) from public, anon;
grant execute on function public.create_simple_at_bat(uuid, text, text, date, uuid) to authenticated, service_role;

-- Called only after every child clip went through delete-clip. The trigger
-- in 00046 is the final storage-safety backstop.
create or replace function public.delete_simple_at_bat(p_entry_id uuid) returns void
language plpgsql volatile security definer set search_path = '' as $$
declare
  v_player_id uuid;
  v_team_id uuid;
begin
  if auth.uid() is null or coalesce((auth.jwt() ->> 'is_anonymous')::boolean, false) then raise exception 'not allowed'; end if;
  select g.player_id, p.team_id into v_player_id, v_team_id
    from public.game_log_entries g join public.players p on p.id = g.player_id
    where g.id = p_entry_id for update of g;
  if v_player_id is null or not (public.is_coach_for_team(v_team_id) or public.is_guardian_for_player(v_player_id)) then
    raise exception 'not allowed';
  end if;
  if exists (select 1 from public.video_clips where game_log_entry_id = p_entry_id) then
    raise exception 'delete every video through delete-clip first';
  end if;
  delete from public.game_log_entries where id = p_entry_id;
end;
$$;
revoke all on function public.delete_simple_at_bat(uuid) from public, anon;
grant execute on function public.delete_simple_at_bat(uuid) to authenticated;

create table public.upload_reservations (
  user_id uuid not null references auth.users(id) on delete cascade,
  entry_id uuid not null,
  clip_slug text not null,
  object_name text not null,
  created_at timestamptz not null default now(),
  primary key(user_id, entry_id, clip_slug)
);
create index upload_reservations_recent on public.upload_reservations(user_id, created_at desc);
alter table public.upload_reservations enable row level security;
revoke all on public.upload_reservations from public, anon, authenticated;
grant all on public.upload_reservations to service_role;

create or replace function public.reserve_simple_upload(p_entry_id uuid, p_clip_slug text, p_object_name text) returns boolean
language plpgsql volatile security definer set search_path = '' as $$
declare
  v_count integer;
begin
  if auth.uid() is null or coalesce((auth.jwt() ->> 'is_anonymous')::boolean, false)
    or p_clip_slug !~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
    or p_object_name !~* ('^' || p_entry_id::text || '/raw/' || p_clip_slug || '\.[a-z0-9]{1,10}$')
    or not public.can_upload_for_entry(p_entry_id) then
    raise exception 'not allowed';
  end if;
  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended('simple_upload:' || auth.uid()::text, 0));
  if exists (select 1 from public.upload_reservations where user_id = auth.uid() and entry_id = p_entry_id
    and clip_slug = p_clip_slug and object_name = p_object_name) then
    return true;
  end if;
  if exists (select 1 from public.upload_reservations where user_id = auth.uid() and entry_id = p_entry_id and clip_slug = p_clip_slug) then
    raise exception 'upload destination changed';
  end if;
  select count(*) into v_count from public.upload_reservations
    where user_id = auth.uid() and created_at > now() - interval '1 day';
  if v_count >= 10 then return false; end if;
  insert into public.upload_reservations(user_id, entry_id, clip_slug, object_name)
    values(auth.uid(), p_entry_id, p_clip_slug, p_object_name);
  return true;
end;
$$;
revoke all on function public.reserve_simple_upload(uuid, text, text) from public, anon;
grant execute on function public.reserve_simple_upload(uuid, text, text) to authenticated;

-- Only the original reserver may resume a clip whose bytes reached storage
-- before the browser saved its upload checkpoint. No table read is granted.
create or replace function public.has_simple_upload_reservation(p_entry_id uuid, p_clip_slug text, p_object_name text)
returns boolean language sql stable security definer set search_path = '' as $$
  select auth.uid() is not null and public.can_upload_for_entry(p_entry_id) and exists (
    select 1 from public.upload_reservations r where r.user_id = auth.uid()
      and r.entry_id = p_entry_id and r.clip_slug = p_clip_slug and r.object_name = p_object_name
  );
$$;
revoke all on function public.has_simple_upload_reservation(uuid, text, text) from public, anon;
grant execute on function public.has_simple_upload_reservation(uuid, text, text) to authenticated;

-- Legacy player links retain their old reader for rollback. New links bind
-- one report clip or the player's progress page explicitly.
alter table public.player_share_links
  add column share_scope text check (share_scope in ('report', 'progress')),
  add column video_clip_id uuid references public.video_clips(id) on delete cascade,
  add constraint player_share_links_scope_clip check (
    share_scope is null or
    (share_scope = 'report' and video_clip_id is not null) or
    (share_scope = 'progress' and video_clip_id is null)
  );

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

create or replace function public.revoke_simple_share_link(p_link_id uuid) returns void
language plpgsql volatile security definer set search_path = '' as $$
declare
  v_player_id uuid;
  v_team_id uuid;
begin
  if auth.uid() is null or coalesce((auth.jwt() ->> 'is_anonymous')::boolean, false) then
    raise exception 'not allowed';
  end if;
  select l.player_id, p.team_id into v_player_id, v_team_id
    from public.player_share_links l join public.players p on p.id = l.player_id
    where l.id = p_link_id and l.share_scope is not null;
  if v_player_id is null or not (public.is_coach_for_team(v_team_id) or public.is_guardian_for_player(v_player_id)) then
    raise exception 'not allowed';
  end if;
  update public.player_share_links set revoked_at = now() where id = p_link_id and revoked_at is null;
end;
$$;
revoke all on function public.revoke_simple_share_link(uuid) from public, anon;
grant execute on function public.revoke_simple_share_link(uuid) to authenticated, service_role;

alter table public.analysis_runs
  add column summary text,
  add column strengths jsonb not null default '[]'::jsonb,
  add constraint analysis_runs_strengths_array check (jsonb_typeof(strengths) = 'array');
alter table demo.analysis_runs
  add column summary text,
  add column strengths jsonb not null default '[]'::jsonb,
  add constraint analysis_runs_strengths_array check (jsonb_typeof(strengths) = 'array');

alter table public.issues
  add column hidden_reason text check (hidden_reason in ('not_what_happened', 'wrong_kid', 'other')),
  add column hidden_by uuid references auth.users(id) on delete set null;
alter table public.issues drop constraint issues_review_status_check;
alter table public.issues add constraint issues_review_status_check
  check (review_status in ('draft', 'approved', 'edited', 'rejected', 'hidden'));
alter table demo.issues
  add column hidden_reason text check (hidden_reason in ('not_what_happened', 'wrong_kid', 'other')),
  add column hidden_by uuid references auth.users(id) on delete set null;
alter table demo.issues drop constraint issues_review_status_check;
alter table demo.issues add constraint issues_review_status_check
  check (review_status in ('draft', 'approved', 'edited', 'rejected', 'hidden'));

create or replace function public.hide_simple_issue(p_issue_id uuid, p_reason text default null) returns void
language plpgsql volatile security definer set search_path = '' as $$
declare
  v_issue public.issues;
  v_team_id uuid;
  v_summary text;
begin
  if auth.uid() is null or coalesce((auth.jwt() ->> 'is_anonymous')::boolean, false) then
    raise exception 'not allowed';
  end if;
  if p_reason is not null and p_reason not in ('not_what_happened', 'wrong_kid', 'other') then
    raise exception 'invalid reason';
  end if;
  select * into v_issue from public.issues where id = p_issue_id for update;
  select p.team_id into v_team_id from public.players p where p.id = v_issue.player_id;
  if v_team_id is null or not (public.is_coach_for_team(v_team_id) or public.is_guardian_for_player(v_issue.player_id)) then
    raise exception 'not allowed';
  end if;
  select summary into v_summary from public.analysis_runs where id = v_issue.analysis_run_id;
  if v_summary is null or v_issue.video_clip_id is null then raise exception 'not available'; end if;
  if v_issue.review_status = 'hidden' then return; end if;
  update public.issues set
    ai_original = coalesce(ai_original, pg_catalog.jsonb_build_object(
      'issue', v_issue.issue, 'evidence', v_issue.evidence, 'coaching_cue', v_issue.coaching_cue,
      'look_for_next', v_issue.look_for_next, 'concept', v_issue.concept,
      'basis', v_issue.basis, 'confidence', v_issue.confidence,
      'analysis_run_id', v_issue.analysis_run_id
    )),
    review_status = 'hidden', hidden_reason = p_reason, hidden_by = auth.uid()
    where id = p_issue_id;
end;
$$;
revoke all on function public.hide_simple_issue(uuid, text) from public, anon;
grant execute on function public.hide_simple_issue(uuid, text) to authenticated;

alter table public.drill_library
  add column best_for text,
  add column looks_right_when text,
  add column cue text,
  add column common_mistakes text[] not null default '{}',
  add column home_friendly boolean not null default false,
  add column sport text not null default 'both' check (sport in ('baseball', 'softball', 'both')),
  add column min_age smallint check (min_age between 5 and 18),
  add column phase text,
  add column demo_url text,
  add column demo_timestamp text,
  add column source_credit text,
  add column requires_screen boolean not null default false,
  add column weighted_or_overspeed boolean not null default false;
alter table demo.drill_library
  add column best_for text,
  add column looks_right_when text,
  add column cue text,
  add column common_mistakes text[] not null default '{}',
  add column home_friendly boolean not null default false,
  add column sport text not null default 'both' check (sport in ('baseball', 'softball', 'both')),
  add column min_age smallint check (min_age between 5 and 18),
  add column phase text,
  add column demo_url text,
  add column demo_timestamp text,
  add column source_credit text,
  add column requires_screen boolean not null default false,
  add column weighted_or_overspeed boolean not null default false;

-- This counter persists a dismissal's six-swing exclusion even after a clip
-- is deleted. It advances only when a newly completed readable game swing is
-- registered by the worker.
alter table public.players add column readable_game_swing_count integer not null default 0
  check (readable_game_swing_count >= 0);
alter table demo.players add column readable_game_swing_count integer not null default 0
  check (readable_game_swing_count >= 0);
alter table public.video_clips add column readable_game_serial integer;
alter table demo.video_clips add column readable_game_serial integer;
-- The serial belongs to a player, not an entry. Two entries for one player
-- cannot be uniquely constrained on video_clips without denormalization;
-- the locked player counter in the registration function assigns it.
create index video_clips_readable_game_serial_idx on public.video_clips (readable_game_serial)
  where readable_game_serial is not null;

create or replace function public.register_readable_game_swing(p_clip_id uuid)
returns integer
language plpgsql volatile security definer set search_path = '' as $$
declare
  v_player_id uuid;
  v_kind text;
  v_serial integer;
begin
  select g.player_id, g.session_type into v_player_id, v_kind
    from public.video_clips c join public.game_log_entries g on g.id = c.game_log_entry_id
    where c.id = p_clip_id;
  if v_player_id is null then raise exception 'clip not found'; end if;
  if v_kind <> 'game' then return null; end if;
  -- Row lock serializes workers processing two clips for one player.
  perform 1 from public.players where id = v_player_id for update;
  select readable_game_serial into v_serial from public.video_clips where id = p_clip_id for update;
  if v_serial is not null then return v_serial; end if;
  update public.players set readable_game_swing_count = readable_game_swing_count + 1
    where id = v_player_id returning readable_game_swing_count into v_serial;
  update public.video_clips set readable_game_serial = v_serial where id = p_clip_id;
  return v_serial;
end;
$$;
revoke all on function public.register_readable_game_swing(uuid) from public, anon, authenticated;
grant execute on function public.register_readable_game_swing(uuid) to service_role;

create table public.player_focus (
  id uuid primary key default gen_random_uuid(),
  player_id uuid not null references public.players(id) on delete cascade,
  concept text not null,
  status text not null check (status in ('active', 'improving', 'fixed', 'dismissed')),
  started_at timestamptz not null,
  ended_at timestamptz,
  qualified_at_serial integer not null,
  dismissed_at_serial integer,
  dismissed_by uuid references auth.users(id) on delete set null,
  dismissed_reason text check (dismissed_reason in ('not_what_happened', 'wrong_kid', 'other')),
  created_at timestamptz not null default now()
);
create unique index player_focus_one_current on public.player_focus(player_id) where ended_at is null;
create index player_focus_player_history on public.player_focus(player_id, started_at desc);
alter table public.player_focus enable row level security;
create policy player_focus_coach_read on public.player_focus for select to authenticated
  using (public.is_coach_for_team((select team_id from public.players where id = player_id)));
grant select on public.player_focus to authenticated;
grant all on public.player_focus to service_role;

create or replace function public.dismiss_simple_focus(p_player_id uuid, p_reason text default null) returns void
language plpgsql volatile security definer set search_path = '' as $$
declare
  v_team_id uuid;
  v_serial integer;
begin
  if auth.uid() is null or coalesce((auth.jwt() ->> 'is_anonymous')::boolean, false) then raise exception 'not allowed'; end if;
  if p_reason is not null and p_reason not in ('not_what_happened', 'wrong_kid', 'other') then raise exception 'invalid reason'; end if;
  select team_id, readable_game_swing_count into v_team_id, v_serial from public.players where id = p_player_id;
  if v_team_id is null or not (public.is_coach_for_team(v_team_id) or public.is_guardian_for_player(p_player_id)) then
    raise exception 'not allowed';
  end if;
  update public.player_focus set status = 'dismissed', ended_at = now(),
    dismissed_at_serial = v_serial, dismissed_by = auth.uid(), dismissed_reason = p_reason
    where player_id = p_player_id and ended_at is null;
end;
$$;
revoke all on function public.dismiss_simple_focus(uuid, text) from public, anon;
grant execute on function public.dismiss_simple_focus(uuid, text) to authenticated;

create table demo.player_focus (
  id uuid primary key default gen_random_uuid(),
  player_id uuid not null references demo.players(id) on delete cascade,
  concept text not null,
  status text not null check (status in ('active', 'improving', 'fixed', 'dismissed')),
  started_at timestamptz not null,
  ended_at timestamptz,
  qualified_at_serial integer not null,
  dismissed_at_serial integer,
  dismissed_by uuid references auth.users(id) on delete set null,
  dismissed_reason text check (dismissed_reason in ('not_what_happened', 'wrong_kid', 'other')),
  created_at timestamptz not null default now()
);
create unique index demo_player_focus_one_current on demo.player_focus(player_id) where ended_at is null;
alter table demo.player_focus enable row level security;
create policy demo_owner_rw on demo.player_focus for all to authenticated
  using (demo.is_demo_owner_of_player(player_id)) with check (demo.is_demo_owner_of_player(player_id));
grant select, insert, update, delete on demo.player_focus to authenticated;
grant all on demo.player_focus to service_role;

-- New account preference is deliberately outside demo.clone_real_fixture's
-- player data graph. A test must keep this exclusion explicit.
create table public.user_settings (
  user_id uuid primary key references auth.users(id) on delete cascade,
  notify_reports boolean not null default true
);
alter table public.user_settings enable row level security;
create policy user_settings_own on public.user_settings for all to authenticated
  using (user_id = auth.uid()) with check (user_id = auth.uid());
grant select, insert, update, delete on public.user_settings to authenticated;
grant all on public.user_settings to service_role;
