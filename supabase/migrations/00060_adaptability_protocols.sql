-- Phase 6: private, coach-entered controlled practice. No template is released
-- by this migration. Recording a pilot session cannot publish a result.
create table public.challenge_templates (
  id uuid primary key default gen_random_uuid(),
  slug text not null,
  version text not null check (version ~ '^[0-9]+\.[0-9]+\.[0-9]+$'),
  title text not null,
  kind text not null check (kind in ('baseline','repeatability','challenge')),
  sports text[] not null default array['softball','baseball']::text[]
    check (cardinality(sports)>0 and sports <@ array['softball','baseball']::text[]),
  environment text not null check (environment in ('tee','front_toss','side_toss','pitching_machine','live_practice')),
  capture_profiles text[] not null check (cardinality(capture_profiles) > 0),
  tasks jsonb not null check (jsonb_typeof(tasks) = 'array' and jsonb_array_length(tasks) between 1 and 12),
  external_required boolean not null default false,
  safety_note text not null check (btrim(safety_note) <> ''),
  supported_conclusion text not null,
  unique(slug, version)
);
insert into public.challenge_templates(slug,version,title,kind,environment,capture_profiles,tasks,safety_note,supported_conclusion) values
('middle_baseline','1.0.0','Middle-location baseline','baseline','front_toss',array['open_side_practice'],
 '[{"key":"middle","label":"Middle location","minimum":3}]',
 'Use an age-appropriate ball and a protected filming position. Stop if the athlete is uncomfortable.','Coach-observed movement within one stated task'),
('same_task','1.0.0','Same-task repeatability','repeatability','front_toss',array['open_side_practice'],
 '[{"key":"middle","label":"Same middle-location task","minimum":5}]',
 'Keep the task and safe capture setup steady. Do not prescribe pitch speed or heavy equipment.','Coach-observed consistency within the same task'),
('high_low','1.0.0','High / low','challenge','front_toss',array['open_side_practice'],
 '[{"key":"high","label":"High location","minimum":3},{"key":"low","label":"Low location","minimum":3}]',
 'Use controlled, age-appropriate tosses. Do not ask an athlete to reach for unsafe pitches.','Coach-observed change between labeled locations'),
('inside_outside','1.0.0','Inside / outside','challenge','front_toss',array['open_side_practice'],
 '[{"key":"inside","label":"Inside location","minimum":3},{"key":"outside","label":"Outside location","minimum":3}]',
 'Use controlled, age-appropriate tosses and a protected filming position.','Coach-observed change between labeled locations'),
('speed_pair','1.0.0','Faster / slower','challenge','front_toss',array['open_side_practice'],
 '[{"key":"faster","label":"Faster task","minimum":3},{"key":"slower","label":"Slower task","minimum":3}]',
 'A coach chooses comfortable relative speeds; no velocity target or equipment prescription is implied.','Coach-observed change between labeled speed tasks'),
('mixed','1.0.0','Mixed task sequence','challenge','front_toss',array['open_side_practice'],
 '[{"key":"high","label":"High location","minimum":3},{"key":"low","label":"Low location","minimum":3},{"key":"inside","label":"Inside location","minimum":3},{"key":"outside","label":"Outside location","minimum":3}]',
 'A coach controls each safe toss and may stop at any time. Do not force a response to an unsafe pitch.','Coach-observed adjustment across a recorded mixed order');

-- Qualified-coach validation is a service-only release decision. The two
-- reviewers must be distinct and leave a documented record. No rows seeded.
create table public.challenge_qualified_reviewers (
  coach_id uuid not null references auth.users(id),
  sport text not null check (sport in ('softball','baseball')),
  qualification_record text not null check (length(btrim(qualification_record)) >= 20),
  recorded_at timestamptz not null default now(),
  primary key(coach_id,sport)
);
create table public.challenge_template_validations (
  template_id uuid not null references public.challenge_templates(id) on delete restrict,
  sport text not null check (sport in ('softball','baseball')),
  reviewer_one uuid not null references auth.users(id),
  reviewer_two uuid not null references auth.users(id),
  evidence_record text not null check (length(btrim(evidence_record)) >= 20),
  approved_at timestamptz not null default now(),
  check (reviewer_one <> reviewer_two),
  primary key(template_id,sport)
);
create or replace function public.check_challenge_validation()
returns trigger language plpgsql set search_path = '' as $$
begin
  if not exists (select 1 from public.challenge_qualified_reviewers
      where coach_id=new.reviewer_one and sport=new.sport)
    or not exists (select 1 from public.challenge_qualified_reviewers
      where coach_id=new.reviewer_two and sport=new.sport)
    then raise exception 'two qualified coach reviewers required'; end if;
  if not exists (select 1 from public.challenge_templates t where t.id=new.template_id
    and new.sport=any(t.sports)) then raise exception 'unsupported protocol sport'; end if;
  return new;
end; $$;
create trigger challenge_validation_qualified before insert on public.challenge_template_validations
  for each row execute function public.check_challenge_validation();
create or replace function public.preserve_challenge_governance()
returns trigger language plpgsql set search_path = '' as $$
begin raise exception 'protocol governance records are immutable; create a new template version'; end; $$;
create trigger challenge_template_immutable before update or delete on public.challenge_templates
  for each row execute function public.preserve_challenge_governance();
create trigger challenge_validation_immutable before update or delete on public.challenge_template_validations
  for each row execute function public.preserve_challenge_governance();
create trigger challenge_reviewer_immutable before update or delete on public.challenge_qualified_reviewers
  for each row execute function public.preserve_challenge_governance();
create table public.challenge_protocols (
  id uuid primary key default gen_random_uuid(),
  practice_session_id uuid not null references public.practice_sessions(id) on delete cascade,
  template_id uuid not null references public.challenge_templates(id) on delete restrict,
  created_by uuid not null references auth.users(id),
  created_at timestamptz not null default now(),
  unique(practice_session_id, template_id)
);
create table public.challenge_slots (
  id uuid primary key default gen_random_uuid(),
  protocol_id uuid not null references public.challenge_protocols(id) on delete cascade,
  sequence_number integer not null check (sequence_number > 0),
  task_key text not null,
  state text not null default 'pending' check (state in ('pending','recorded','missed','failed')),
  practice_repetition_id uuid unique references public.practice_repetitions(id) on delete set null,
  actual_context text,
  actual_environment text,
  coach_observation text check (coach_observation in ('consistent','changed','unclear')),
  updated_by uuid references auth.users(id),
  updated_at timestamptz,
  unique(protocol_id,sequence_number),
  -- A later rep deletion clears its FK but must not block the deletion.
  check ((state = 'recorded' and actual_context is not null and actual_environment is not null)
    or (state <> 'recorded' and practice_repetition_id is null and actual_context is null and actual_environment is null and coach_observation is null))
);
create index challenge_protocol_session on public.challenge_protocols(practice_session_id,created_at);
create index challenge_protocol_template on public.challenge_protocols(template_id);
create index challenge_slot_protocol on public.challenge_slots(protocol_id,sequence_number);
alter table public.challenge_templates enable row level security;
alter table public.challenge_qualified_reviewers enable row level security;
alter table public.challenge_template_validations enable row level security;
alter table public.challenge_protocols enable row level security;
alter table public.challenge_slots enable row level security;
revoke all on public.challenge_templates,public.challenge_qualified_reviewers,public.challenge_template_validations,public.challenge_protocols,public.challenge_slots from public,anon,authenticated;
grant all on public.challenge_templates,public.challenge_qualified_reviewers,public.challenge_template_validations,public.challenge_protocols,public.challenge_slots to service_role;

create or replace function public.challenge_coach_allowed(p_session_id uuid)
returns boolean language sql stable security definer set search_path = '' as $$
  select auth.uid() is not null and not coalesce((auth.jwt()->>'is_anonymous')::boolean,false)
    and exists (select 1 from public.practice_sessions s
      join public.players p on p.id=s.player_id
      join public.coach_analysis_access a on a.team_id=p.team_id and a.coach_id=auth.uid()
      where s.id=p_session_id and public.is_coach_for_team(p.team_id));
$$;
create or replace function public.list_challenge_templates(p_session_id uuid)
returns jsonb language plpgsql stable security definer set search_path = '' as $$
declare v_sport text;
begin
  if not public.challenge_coach_allowed(p_session_id) then raise exception 'not allowed'; end if;
  select tm.sport into v_sport from public.practice_sessions s join public.players p on p.id=s.player_id
    join public.teams tm on tm.id=p.team_id where s.id=p_session_id;
  return coalesce((select jsonb_agg(jsonb_build_object('id',t.id,'slug',t.slug,'version',t.version,
    'title',t.title,'kind',t.kind,'environment',t.environment,'captureProfiles',t.capture_profiles,
    'tasks',t.tasks,'externalRequired',t.external_required,'safetyNote',t.safety_note,
    'validated',v.template_id is not null) order by t.slug,t.version)
    from public.challenge_templates t left join public.challenge_template_validations v
      on v.template_id=t.id and v.sport=v_sport where v_sport=any(t.sports)),'[]'::jsonb);
end; $$;
create or replace function public.start_challenge_protocol(p_session_id uuid,p_template_id uuid)
returns uuid language plpgsql volatile security definer set search_path = '' as $$
declare v_id uuid; v_template public.challenge_templates; v_task jsonb; v_n integer := 0; v_i integer;
  v_sport text;
begin
  if not public.challenge_coach_allowed(p_session_id) then raise exception 'not allowed'; end if;
  select tm.sport into v_sport from public.practice_sessions s join public.players p on p.id=s.player_id
    join public.teams tm on tm.id=p.team_id where s.id=p_session_id;
  select * into v_template from public.challenge_templates where id=p_template_id;
  if not found or not v_sport=any(v_template.sports) then raise exception 'template unavailable'; end if;
  -- Every advanced challenge needs a completed same-task set whose template
  -- has passed independent validation. A pilot same-task set cannot unlock it.
  if v_template.kind='challenge' and not public.challenge_repeatability_ready(p_session_id,v_sport)
    then raise exception 'validated same-task repeatability required first'; end if;
  insert into public.challenge_protocols(practice_session_id,template_id,created_by)
    values(p_session_id,p_template_id,auth.uid()) returning id into v_id;
  for v_task in select value from jsonb_array_elements(v_template.tasks) loop
    if (v_task->>'minimum')::integer not between 2 and 12 then raise exception 'invalid template minimum'; end if;
    for v_i in 1..(v_task->>'minimum')::integer loop
      v_n := v_n+1;
      insert into public.challenge_slots(protocol_id,sequence_number,task_key)
        values(v_id,v_n,v_task->>'key');
    end loop;
  end loop;
  if v_template.slug='mixed' then
    update public.challenge_slots set sequence_number=sequence_number+100
      where protocol_id=v_id;
    with shuffled as (
      select id,row_number() over (order by random()) as new_number
      from public.challenge_slots where protocol_id=v_id
    ) update public.challenge_slots s set sequence_number=shuffled.new_number
      from shuffled where s.id=shuffled.id;
  end if;
  return v_id;
end; $$;
create or replace function public.challenge_repeatability_ready(p_session_id uuid,p_sport text)
returns boolean language sql stable security definer set search_path = '' as $$
  select exists (
    select 1 from public.challenge_protocols p
    join public.challenge_templates t on t.id=p.template_id
    join public.challenge_template_validations v on v.template_id=t.id and v.sport=p_sport
    where p.practice_session_id=p_session_id and t.kind='repeatability'
      and not exists (select 1 from public.challenge_slots s
        left join public.practice_repetitions r on r.id=s.practice_repetition_id
        left join public.video_clips c on c.practice_repetition_id=r.id
          and c.status='ready' and c.swing_detection_state='readable'
        left join public.clip_capture_assessments ca on ca.video_clip_id=c.id and ca.stage='full'
        where s.protocol_id=p.id and (s.state <> 'recorded' or s.actual_context<>s.task_key
          or s.actual_environment<>t.environment or r.practice_session_id<>p_session_id
          or r.usable=false or c.id is null
          or ca.declared_profile_slug is null or not ca.declared_profile_slug=any(t.capture_profiles)
          or ca.profile_plausibility <> 'supported'
          or ca.camera_motion <> 'unavailable' or ca.blur <> 'unavailable'
          or ca.exposure <> 'unavailable' or ca.athlete_ambiguity <> 'unavailable'
          or not exists (select 1 from public.capture_profiles cp where cp.slug=ca.declared_profile_slug
            and cp.version=ca.declared_profile_version and cp.status='enabled'
            and p_sport=any(cp.sports))
          or exists(select 1 from public.clip_deletions d where d.clip_id=c.id)))
  );
$$;
create or replace function public.record_challenge_slot(p_slot_id uuid,p_state text,
  p_rep_id uuid default null,p_actual_context text default null,p_actual_environment text default null,
  p_observation text default null)
returns void language plpgsql volatile security definer set search_path = '' as $$
declare v_slot public.challenge_slots; v_protocol public.challenge_protocols; v_template public.challenge_templates;
  v_rep_session uuid;
begin
  select * into v_slot from public.challenge_slots where id=p_slot_id for update;
  if not found then raise exception 'slot unavailable'; end if;
  select * into v_protocol from public.challenge_protocols where id=v_slot.protocol_id;
  if not public.challenge_coach_allowed(v_protocol.practice_session_id) then raise exception 'not allowed'; end if;
  select * into v_template from public.challenge_templates where id=v_protocol.template_id;
  if p_state not in ('recorded','missed','failed','pending') then raise exception 'invalid state'; end if;
  if p_state='recorded' then
    if p_actual_context is null or (p_actual_context <> 'other' and not exists
      (select 1 from jsonb_array_elements(v_template.tasks) x where x->>'key'=p_actual_context))
      then raise exception 'actual task context must be recorded'; end if;
    if p_actual_environment is null or p_actual_environment not in
      ('tee','front_toss','side_toss','pitching_machine','live_practice')
      then raise exception 'actual environment required'; end if;
    select practice_session_id into v_rep_session from public.practice_repetitions where id=p_rep_id;
    if v_rep_session is distinct from v_protocol.practice_session_id then raise exception 'rep/session mismatch'; end if;
    if p_observation is not null and p_observation not in ('consistent','changed','unclear')
      then raise exception 'invalid observation'; end if;
  elsif p_rep_id is not null or p_actual_context is not null or p_actual_environment is not null or p_observation is not null
    then raise exception 'unrecorded slot cannot carry result'; end if;
  update public.challenge_slots set state=p_state,practice_repetition_id=p_rep_id,
    actual_context=p_actual_context,actual_environment=p_actual_environment,coach_observation=p_observation,
    updated_by=auth.uid(),updated_at=now() where id=p_slot_id;
end; $$;
create or replace function public.get_challenge_protocol(p_protocol_id uuid)
returns jsonb language plpgsql stable security definer set search_path = '' as $$
declare v_protocol public.challenge_protocols; v_result jsonb;
  v_sport text;
begin
  select * into v_protocol from public.challenge_protocols where id=p_protocol_id;
  if not found or not public.challenge_coach_allowed(v_protocol.practice_session_id) then raise exception 'not allowed'; end if;
  select tm.sport into v_sport from public.practice_sessions s join public.players p on p.id=s.player_id
    join public.teams tm on tm.id=p.team_id where s.id=v_protocol.practice_session_id;
  select jsonb_build_object('id',p.id,'sessionId',p.practice_session_id,'templateId',t.id,
    'title',t.title,'kind',t.kind,'version',t.version,'environment',t.environment,
    'captureProfiles',t.capture_profiles,'tasks',t.tasks,'safetyNote',t.safety_note,
    'supportedConclusion',t.supported_conclusion,'validated',v.template_id is not null,
    'repeatabilityReady',case when t.kind='challenge'
      then public.challenge_repeatability_ready(p.practice_session_id,v_sport) else true end,
    'slots',coalesce((select jsonb_agg(jsonb_build_object('id',s.id,'number',s.sequence_number,
      'task',s.task_key,'state',s.state,'repId',s.practice_repetition_id,
      'actualContext',s.actual_context,'actualEnvironment',s.actual_environment,
      'observation',s.coach_observation,'repUsable',r.usable,
      'repMatchesSession',r.practice_session_id=p.practice_session_id,
      'clipId',c.id,'readable',c.id is not null and c.status='ready' and c.swing_detection_state='readable'
        and d.clip_id is null,'captureProfile',ca.declared_profile_slug,'captureVersion',ca.declared_profile_version,
      'captureSupported',ca.profile_plausibility='supported'
        and ca.camera_motion='unavailable' and ca.blur='unavailable'
        and ca.exposure='unavailable' and ca.athlete_ambiguity='unavailable'
        and ca.declared_profile_slug=any(t.capture_profiles)
        and exists (select 1 from public.capture_profiles cp where cp.slug=ca.declared_profile_slug
          and cp.version=ca.declared_profile_version and cp.status='enabled'
          and v_sport=any(cp.sports)))
      order by s.sequence_number)
      from public.challenge_slots s left join public.practice_repetitions r on r.id=s.practice_repetition_id
      left join lateral (select vc.* from public.video_clips vc where vc.practice_repetition_id=r.id
        order by vc.created_at desc limit 1) c on true
      left join public.clip_deletions d on d.clip_id=c.id
      left join lateral (select x.*
        from public.clip_capture_assessments x where x.video_clip_id=c.id and x.stage='full'
        order by x.created_at desc limit 1) ca on true
      where s.protocol_id=p.id),'[]'::jsonb)) into v_result
    from public.challenge_protocols p join public.challenge_templates t on t.id=p.template_id
    left join public.challenge_template_validations v on v.template_id=t.id and v.sport=v_sport
    where p.id=p_protocol_id;
  return v_result;
end; $$;
create or replace function public.list_challenge_protocols(p_session_id uuid)
returns jsonb language plpgsql stable security definer set search_path = '' as $$
begin
  if not public.challenge_coach_allowed(p_session_id) then raise exception 'not allowed'; end if;
  return coalesce((select jsonb_agg(jsonb_build_object('id',p.id,'title',t.title,
    'version',t.version,'kind',t.kind,'createdAt',p.created_at) order by p.created_at desc)
    from public.challenge_protocols p join public.challenge_templates t on t.id=p.template_id
    where p.practice_session_id=p_session_id),'[]'::jsonb);
end; $$;
-- Visual game references remain a separate series. The read gives dates and
-- clip identifiers only; it never calculates a practice/game delta.
create or replace function public.get_challenge_game_evidence(p_session_id uuid)
returns jsonb language plpgsql stable security definer set search_path = '' as $$
begin
  if not public.challenge_coach_allowed(p_session_id) then raise exception 'not allowed'; end if;
  return coalesce((select jsonb_agg(jsonb_build_object('clipId',x.id,'date',x.date)
    order by x.date desc,x.id) from (
    select c.id,g.date from public.practice_sessions s
    join public.game_log_entries g on g.player_id=s.player_id and g.session_type='game'
    join public.video_clips c on c.game_log_entry_id=g.id
      and c.status='ready' and c.swing_detection_state='readable'
    where s.id=p_session_id and not exists
      (select 1 from public.clip_deletions d where d.clip_id=c.id)
    order by g.date desc,c.id limit 10) x),'[]'::jsonb);
end; $$;
revoke all on function public.challenge_coach_allowed(uuid),public.challenge_repeatability_ready(uuid,text),
 public.list_challenge_templates(uuid),
 public.start_challenge_protocol(uuid,uuid),public.record_challenge_slot(uuid,text,uuid,text,text,text),
 public.get_challenge_protocol(uuid),public.list_challenge_protocols(uuid),
 public.get_challenge_game_evidence(uuid) from public,anon,authenticated;
grant execute on function public.list_challenge_templates(uuid),public.start_challenge_protocol(uuid,uuid),
 public.record_challenge_slot(uuid,text,uuid,text,text,text),public.get_challenge_protocol(uuid),
 public.list_challenge_protocols(uuid),public.get_challenge_game_evidence(uuid) to authenticated;
