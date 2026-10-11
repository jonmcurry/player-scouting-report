-- Analysis depth Phase 3. Private, additive single-attempt compatibility
-- layer. video_clips and swing_phases remain authoritative for every current
-- report, focus, share, and demo read. No multi-attempt clip is admitted yet.

create table public.swing_attempts (
  id uuid primary key default gen_random_uuid(),
  video_clip_id uuid not null unique references public.video_clips(id) on delete cascade,
  attempt_index integer not null default 0 check (attempt_index = 0),
  origin text not null default 'legacy_canonical' check (origin = 'legacy_canonical'),
  source_detection_state text not null check (source_detection_state = 'readable'),
  created_at timestamptz not null default now(),
  unique (id, video_clip_id)
);

-- A later detector reprocess may downgrade a clip. Retain its historical
-- derived row for audit, but never count it as a current readable attempt.
create view public.active_legacy_swing_attempts with (security_invoker = true) as
select a.* from public.swing_attempts a join public.video_clips c on c.id = a.video_clip_id
where c.status = 'ready' and c.swing_detection_state = 'readable'
  and not exists (select 1 from public.clip_deletions d where d.clip_id = c.id);

-- Existing evidence packages keep video_clip_id authoritative. New packages
-- may opt into an attempt link only when it belongs to the same clip.
alter table public.analysis_evidence_packages
  add column swing_attempt_id uuid;
alter table public.analysis_evidence_packages
  add constraint analysis_evidence_attempt_same_clip
  foreign key (swing_attempt_id, video_clip_id)
  references public.swing_attempts(id, video_clip_id) on delete cascade;

create table public.swing_attempt_context_history (
  id uuid primary key default gen_random_uuid(),
  swing_attempt_id uuid not null references public.swing_attempts(id) on delete cascade,
  revision integer not null check (revision > 0),
  source text not null check (source in ('classified','coach_correction')),
  sport text not null check (sport in ('softball','baseball','unknown')),
  environment text not null check (environment in
    ('tee','front_toss','side_toss','pitching_machine','live_practice','game','unknown')),
  intent text not null check (intent in
    ('conventional_full','slap','power_slap','bunt','drag_bunt','checked_protective','take','unknown')),
  approach jsonb not null default '{}'::jsonb check (jsonb_typeof(approach) = 'object'
    and length(approach::text) <= 1200),
  classifier_version text,
  actor_id uuid,
  reason text,
  created_at timestamptz not null default now(),
  unique (swing_attempt_id, revision),
  check ((source = 'classified' and classifier_version is not null
      and nullif(btrim(classifier_version), '') is not null and actor_id is null)
    or (source = 'coach_correction' and classifier_version is null and actor_id is not null
      and reason is not null and nullif(btrim(reason), '') is not null)),
  check (approach = '{}'::jsonb or source = 'coach_correction')
);
create index swing_attempt_context_latest on public.swing_attempt_context_history(swing_attempt_id, revision desc);

create table public.swing_phase_events (
  id uuid primary key default gen_random_uuid(),
  swing_attempt_id uuid not null references public.swing_attempts(id) on delete cascade,
  event_slug text not null check (event_slug in
    ('ready_stance','load_start','peak_load','stride_start','front_foot_plant',
     'launch_rotation_start','bat_enters_zone','contact_estimate','extension','finish',
     'legacy_stance','legacy_load','legacy_stride','legacy_follow_through')),
  source text not null check (source in ('pipeline_snapshot','legacy_backfill','coach_correction')),
  source_revision text not null check (btrim(source_revision) <> ''),
  pipeline_version text,
  detector_version text,
  method text,
  frame integer check (frame is null or frame >= 0),
  time_s numeric check (time_s is null or time_s >= 0),
  uncertainty_frames integer check (uncertainty_frames is null or uncertainty_frames >= 0),
  uncertainty_status text not null check (uncertainty_status in ('quantified','unquantified','unavailable')),
  visibility text not null check (visibility in ('visible','partial','unavailable')),
  confidence text check (confidence in ('high','low')),
  actor_id uuid,
  reason text,
  created_at timestamptz not null default now(),
  unique (swing_attempt_id, event_slug, source_revision),
  check ((frame is null) = (time_s is null)),
  check ((uncertainty_status = 'quantified') = (uncertainty_frames is not null)),
  check (frame is not null or uncertainty_status = 'unavailable'),
  check (source <> 'coach_correction' or actor_id is not null
    and reason is not null and nullif(btrim(reason), '') is not null)
);
create index swing_phase_events_latest on public.swing_phase_events(swing_attempt_id, event_slug, created_at desc);

-- A later machine reprocess cannot silently supersede a coach correction.
-- A later phase may add explicit correction withdrawal after video review.
create view public.effective_swing_phase_events with (security_invoker = true) as
select distinct on (swing_attempt_id, event_slug) * from public.swing_phase_events
order by swing_attempt_id, event_slug, (source = 'coach_correction') desc, created_at desc, id desc;

create or replace function public.reject_swing_attempt_record_update()
returns trigger language plpgsql set search_path = '' as $$
begin raise exception 'attempt records are append only'; end;
$$;
create trigger swing_attempts_no_update before update on public.swing_attempts
  for each row execute function public.reject_swing_attempt_record_update();
create trigger swing_attempt_context_no_update before update on public.swing_attempt_context_history
  for each row execute function public.reject_swing_attempt_record_update();
create trigger swing_phase_events_no_update before update on public.swing_phase_events
  for each row execute function public.reject_swing_attempt_record_update();

-- The only canonical resolver. p_create=false is read-only; p_create=true is
-- used by the service worker/backfill after the original clip is ready. A
-- readable stored state is required. A result chip never creates an attempt.
create or replace function public.resolve_legacy_swing_attempt(p_clip_id uuid, p_create boolean default false)
returns uuid language plpgsql volatile security definer set search_path = '' as $$
declare v_clip public.video_clips; v_attempt uuid; v_sport text; v_environment text;
  v_latest public.swing_attempt_context_history;
begin
  select * into v_clip from public.video_clips where id = p_clip_id for update;
  if not found or exists (select 1 from public.clip_deletions where clip_id = p_clip_id) then return null; end if;
  if v_clip.status <> 'ready' or v_clip.swing_detection_state <> 'readable' then return null; end if;
  select id into v_attempt from public.swing_attempts where video_clip_id = p_clip_id;
  if not coalesce(p_create, false) then return v_attempt; end if;
  if v_attempt is null then
    insert into public.swing_attempts(video_clip_id, source_detection_state)
      values (p_clip_id, 'readable') on conflict (video_clip_id) do nothing;
    select id into v_attempt from public.swing_attempts where video_clip_id = p_clip_id;
  end if;
  select case when t.sport in ('softball','baseball') then t.sport else 'unknown' end,
    case when g.session_type = 'game' then 'game' else 'unknown' end
    into v_sport, v_environment from public.game_log_entries g
    join public.players p on p.id = g.player_id
    join public.teams t on t.id = p.team_id where g.id = v_clip.game_log_entry_id;
  v_sport := coalesce(v_sport, 'unknown');
  v_environment := coalesce(v_environment, 'unknown');
  select * into v_latest from public.swing_attempt_context_history
    where swing_attempt_id = v_attempt order by revision desc limit 1;
  if not found or (v_latest.source = 'classified'
      and (v_latest.sport <> v_sport or v_latest.environment <> v_environment)) then
    insert into public.swing_attempt_context_history
      (swing_attempt_id, revision, source, sport, environment, intent, classifier_version)
      values (v_attempt, coalesce(v_latest.revision, 0) + 1, 'classified',
        v_sport, v_environment, 'unknown', 'phase3-context-v1');
  end if;
  return v_attempt;
end;
$$;

-- The sole legacy dual-write boundary. Null p_events snapshots the six
-- stored legacy phase rows for backfill; a supplied array snapshots a fresh
-- pipeline run. Both preserve unavailable events without guessed times.
create or replace function public.record_legacy_attempt_snapshot(
  p_clip_id uuid, p_source_revision text, p_events jsonb default null)
returns uuid language plpgsql volatile security definer set search_path = '' as $$
declare v_attempt uuid; v_event jsonb; v_slug text;
begin
  if nullif(btrim(p_source_revision), '') is null then raise exception 'source revision required'; end if;
  if p_events is not null and jsonb_typeof(p_events) <> 'array' then raise exception 'events must be an array'; end if;
  v_attempt := public.resolve_legacy_swing_attempt(p_clip_id, true);
  if v_attempt is null then return null; end if;
  if p_events is null then
    insert into public.swing_phase_events
      (swing_attempt_id, event_slug, source, source_revision, pipeline_version, detector_version,
       method, frame, time_s, uncertainty_status, visibility, confidence)
    select v_attempt, case pt.slug when 'stance' then 'legacy_stance'
      when 'load' then 'legacy_load' when 'stride' then 'legacy_stride'
      when 'contact' then 'contact_estimate' when 'extension' then 'extension'
      when 'follow-through' then 'legacy_follow_through' end,
      'legacy_backfill', p_source_revision, null, null, ph.method,
      case when ph.frame is not null and ph.time_s is not null then ph.frame else null end,
      case when ph.frame is not null and ph.time_s is not null then ph.time_s else null end,
      case when ph.frame is not null and ph.time_s is not null then 'unquantified' else 'unavailable' end,
      'unavailable', ph.confidence
    from public.swing_phases ph join public.swing_phase_types pt on pt.id = ph.phase_type_id
    where ph.video_clip_id = p_clip_id and pt.slug in
      ('stance','load','stride','contact','extension','follow-through')
    on conflict (swing_attempt_id, event_slug, source_revision) do nothing;
  else
    for v_event in select value from jsonb_array_elements(p_events) loop
      v_slug := v_event->>'event_slug';
      if v_slug not in ('legacy_stance','legacy_load','legacy_stride','contact_estimate','extension','legacy_follow_through')
        then raise exception 'invalid legacy event slug'; end if;
      insert into public.swing_phase_events
        (swing_attempt_id, event_slug, source, source_revision, pipeline_version, detector_version,
         method, frame, time_s, uncertainty_status, visibility, confidence)
      values (v_attempt, v_slug, 'pipeline_snapshot', p_source_revision,
        nullif(v_event->>'pipeline_version',''), nullif(v_event->>'detector_version',''),
        nullif(v_event->>'method',''),
        (v_event->>'frame')::integer, (v_event->>'time_s')::numeric,
        case when v_event->>'frame' is not null and v_event->>'time_s' is not null
          then 'unquantified' else 'unavailable' end,
        coalesce(v_event->>'visibility','unavailable'), nullif(v_event->>'confidence',''))
      on conflict (swing_attempt_id, event_slug, source_revision) do nothing;
    end loop;
  end if;
  return v_attempt;
end;
$$;

-- Coach correction appends a complete context snapshot. The effective
-- context is always the highest revision; consumers re-evaluate definition
-- applicability from that snapshot, so a changed intent cannot retain a
-- stale conventional-only eligibility decision.
create or replace function public.correct_swing_attempt_context(
  p_attempt_id uuid, p_sport text, p_environment text, p_intent text,
  p_approach jsonb, p_reason text)
returns uuid language plpgsql volatile security definer set search_path = '' as $$
declare v_attempt public.swing_attempts; v_team_id uuid; v_team_sport text; v_revision integer; v_id uuid;
begin
  if auth.uid() is null or coalesce((auth.jwt()->>'is_anonymous')::boolean, false) then raise exception 'not allowed'; end if;
  select * into v_attempt from public.swing_attempts where id = p_attempt_id for update;
  if not found then raise exception 'attempt not found'; end if;
  select p.team_id, t.sport into v_team_id, v_team_sport from public.video_clips c
    join public.game_log_entries g on g.id = c.game_log_entry_id
    join public.players p on p.id = g.player_id join public.teams t on t.id = p.team_id
    where c.id = v_attempt.video_clip_id;
  if not public.is_coach_for_team(v_team_id)
    or exists (select 1 from public.clip_deletions where clip_id = v_attempt.video_clip_id)
    then raise exception 'not allowed'; end if;
  if v_team_sport in ('softball','baseball') and p_sport <> v_team_sport then raise exception 'sport differs from team'; end if;
  if p_approach is null or jsonb_typeof(p_approach) <> 'object'
    or exists (select 1 from jsonb_object_keys(p_approach) as keys(key)
      where key not in ('pitch_type','pitch_speed','pitch_location','count','approach','intended_direction'))
    then raise exception 'invalid approach context'; end if;
  select coalesce(max(revision),0)+1 into v_revision from public.swing_attempt_context_history
    where swing_attempt_id = p_attempt_id;
  insert into public.swing_attempt_context_history
    (swing_attempt_id, revision, source, sport, environment, intent, approach, actor_id, reason)
    values (p_attempt_id, v_revision, 'coach_correction', p_sport, p_environment,
      p_intent, p_approach, auth.uid(), p_reason) returning id into v_id;
  return v_id;
end;
$$;

create or replace function public.correct_swing_phase_event(
  p_attempt_id uuid, p_event_slug text, p_frame integer, p_time_s numeric,
  p_uncertainty_frames integer, p_visibility text, p_reason text)
returns uuid language plpgsql volatile security definer set search_path = '' as $$
declare v_attempt public.swing_attempts; v_team_id uuid; v_id uuid;
begin
  if auth.uid() is null or coalesce((auth.jwt()->>'is_anonymous')::boolean, false) then raise exception 'not allowed'; end if;
  select * into v_attempt from public.swing_attempts where id = p_attempt_id for update;
  if not found then raise exception 'attempt not found'; end if;
  select p.team_id into v_team_id from public.video_clips c
    join public.game_log_entries g on g.id = c.game_log_entry_id
    join public.players p on p.id = g.player_id where c.id = v_attempt.video_clip_id;
  if not public.is_coach_for_team(v_team_id)
    or exists (select 1 from public.clip_deletions where clip_id = v_attempt.video_clip_id)
    then raise exception 'not allowed'; end if;
  insert into public.swing_phase_events
    (swing_attempt_id, event_slug, source, source_revision, frame, time_s,
     uncertainty_frames, uncertainty_status, visibility, actor_id, reason)
  values (p_attempt_id, p_event_slug, 'coach_correction', gen_random_uuid()::text,
    p_frame, p_time_s, p_uncertainty_frames,
    case when p_uncertainty_frames is not null then 'quantified'
      when p_frame is not null then 'unquantified' else 'unavailable' end,
    p_visibility, auth.uid(), p_reason) returning id into v_id;
  return v_id;
end;
$$;

alter table public.swing_attempts enable row level security;
alter table public.swing_attempt_context_history enable row level security;
alter table public.swing_phase_events enable row level security;
revoke all on public.swing_attempts, public.swing_attempt_context_history, public.swing_phase_events
  from public, anon, authenticated;
grant all on public.swing_attempts, public.swing_attempt_context_history, public.swing_phase_events
  to service_role;
revoke all on public.active_legacy_swing_attempts from public, anon, authenticated;
grant select on public.active_legacy_swing_attempts to service_role;
revoke all on public.effective_swing_phase_events from public, anon, authenticated;
grant select on public.effective_swing_phase_events to service_role;
revoke all on function public.resolve_legacy_swing_attempt(uuid,boolean),
  public.record_legacy_attempt_snapshot(uuid,text,jsonb),
  public.correct_swing_attempt_context(uuid,text,text,text,jsonb,text),
  public.correct_swing_phase_event(uuid,text,integer,numeric,integer,text,text)
  from public, anon, authenticated;
grant execute on function public.resolve_legacy_swing_attempt(uuid,boolean),
  public.record_legacy_attempt_snapshot(uuid,text,jsonb) to service_role;
grant execute on function public.correct_swing_attempt_context(uuid,text,text,text,jsonb,text),
  public.correct_swing_phase_event(uuid,text,integer,numeric,integer,text,text)
  to authenticated;
