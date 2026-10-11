-- Phase 4: a separate, coach-only phase read and text annotation boundary.
-- Family, share, demo, and focus reads remain on their existing paths.

-- Explicit team enablement and coach training acknowledgement are release
-- gates. No client can grant itself this capability.
create table public.coach_analysis_access (
  team_id uuid not null references public.teams(id) on delete cascade,
  coach_id uuid not null references auth.users(id) on delete cascade,
  enabled_at timestamptz not null,
  training_acknowledged_at timestamptz not null,
  primary key (team_id, coach_id)
);
alter table public.coach_analysis_access enable row level security;
revoke all on public.coach_analysis_access from public, anon, authenticated;
grant all on public.coach_analysis_access to service_role;

create table public.coach_annotation_events (
  id uuid primary key default gen_random_uuid(),
  video_clip_id uuid not null references public.video_clips(id) on delete cascade,
  swing_attempt_id uuid not null,
  event_slug text not null check (event_slug in
    ('legacy_stance','legacy_load','legacy_stride','contact_estimate','extension','legacy_follow_through')),
  action text not null check (action in ('create','delete')),
  annotation_id uuid not null,
  body text,
  visibility text not null default 'guardian_visible' check (visibility = 'guardian_visible'),
  actor_id uuid not null,
  created_at timestamptz not null default now(),
  foreign key (swing_attempt_id, video_clip_id)
    references public.swing_attempts(id, video_clip_id) on delete cascade,
  check ((action = 'create' and body is not null and length(btrim(body)) between 1 and 2000)
    or (action = 'delete' and body is null))
);
create unique index coach_annotation_one_create on public.coach_annotation_events(annotation_id) where action = 'create';
create unique index coach_annotation_one_delete on public.coach_annotation_events(annotation_id) where action = 'delete';
create index coach_annotation_clip_events on public.coach_annotation_events(video_clip_id, created_at desc);
alter table public.coach_annotation_events enable row level security;
revoke all on public.coach_annotation_events from public, anon, authenticated;
grant all on public.coach_annotation_events to service_role;

create or replace function public.reject_coach_annotation_event_change()
returns trigger language plpgsql set search_path = '' as $$
begin raise exception 'annotation history is append only'; end;
$$;
create trigger coach_annotation_no_update before update on public.coach_annotation_events
  for each row execute function public.reject_coach_annotation_event_change();
-- Clip deletion must cascade this private history; no client has DELETE.

-- Central coach and live-clip check, reused by every Phase 4 boundary.
create or replace function public.coach_analysis_attempt(p_clip_id uuid)
returns uuid language plpgsql stable security definer set search_path = '' as $$
declare v_team_id uuid; v_attempt uuid;
begin
  if auth.uid() is null or coalesce((auth.jwt()->>'is_anonymous')::boolean, false)
    then return null; end if;
  select p.team_id, a.id into v_team_id, v_attempt
    from public.video_clips c
    join public.game_log_entries g on g.id = c.game_log_entry_id
    join public.players p on p.id = g.player_id
    join public.active_legacy_swing_attempts a on a.video_clip_id = c.id
    where c.id = p_clip_id and not exists
      (select 1 from public.clip_deletions d where d.clip_id = c.id);
  if v_attempt is null or not public.is_coach_for_team(v_team_id)
    or not exists (select 1 from public.coach_analysis_access a
      where a.team_id = v_team_id and a.coach_id = auth.uid()) then return null; end if;
  return v_attempt;
end;
$$;

create or replace function public.coach_analysis_available(p_clip_id uuid)
returns boolean language sql stable security definer set search_path = '' as $$
  select public.coach_analysis_attempt(p_clip_id) is not null;
$$;

create or replace function public.add_coach_text_annotation(
  p_clip_id uuid, p_event_slug text, p_body text, p_visibility text default 'guardian_visible')
returns uuid language plpgsql volatile security definer set search_path = '' as $$
declare v_attempt uuid; v_id uuid := gen_random_uuid();
begin
  v_attempt := public.coach_analysis_attempt(p_clip_id);
  if v_attempt is null then raise exception 'not allowed'; end if;
  if p_visibility is distinct from 'guardian_visible' then
    raise exception 'staff-private notes are not enabled';
  end if;
  insert into public.coach_annotation_events
    (video_clip_id, swing_attempt_id, event_slug, action, annotation_id, body, visibility, actor_id)
    values (p_clip_id, v_attempt, p_event_slug, 'create', v_id, p_body,
      'guardian_visible', auth.uid());
  return v_id;
end;
$$;

create or replace function public.delete_coach_text_annotation(p_annotation_id uuid)
returns void language plpgsql volatile security definer set search_path = '' as $$
declare v_note public.coach_annotation_events;
begin
  select * into v_note from public.coach_annotation_events
    where annotation_id = p_annotation_id and action = 'create' for update;
  if not found or public.coach_analysis_attempt(v_note.video_clip_id) is null
    then raise exception 'not allowed'; end if;
  insert into public.coach_annotation_events
    (video_clip_id, swing_attempt_id, event_slug, action, annotation_id, visibility, actor_id)
    values (v_note.video_clip_id, v_note.swing_attempt_id, v_note.event_slug,
      'delete', p_annotation_id, v_note.visibility, auth.uid())
    on conflict (annotation_id) where action = 'delete' do nothing;
end;
$$;

-- One allowlisted read; no raw media path, source hash, debug fields, or
-- numerical claim is returned. The original video uses get-video-url.
create or replace function public.get_coach_analysis(p_clip_id uuid)
returns jsonb language plpgsql stable security definer set search_path = '' as $$
declare v_attempt uuid; v_result jsonb; v_player_id uuid; v_sport text; v_candidates jsonb;
begin
  v_attempt := public.coach_analysis_attempt(p_clip_id);
  if v_attempt is null then raise exception 'not found'; end if;
  select g.player_id, t.sport into v_player_id, v_sport
    from public.video_clips c join public.game_log_entries g on g.id = c.game_log_entry_id
    join public.players p on p.id = g.player_id join public.teams t on t.id = p.team_id
    where c.id = p_clip_id;
  select coalesce(jsonb_agg(jsonb_build_object(
      'clipId', ranked.clip_id, 'date', ranked.clip_date, 'environment', ranked.environment,
      'sport', v_sport, 'intent', ranked.intent,
      'contextEnvironment', ranked.context_environment, 'profile', ranked.profile,
      'orientation', ranked.orientation, 'captureState', ranked.capture_state,
      'phases', ranked.phases)
      order by ranked.clip_date desc, ranked.clip_id), '[]'::jsonb)
    into v_candidates from (select c2.id as clip_id, g2.date as clip_date,
      case when g2.session_type = 'game' then 'game' else 'practice' end as environment,
      h2.intent, h2.environment as context_environment,
      q2.profile, q2.orientation, q2.capture_state,
      (select jsonb_object_agg(e2.event_slug, e2.time_s)
        from public.effective_swing_phase_events e2 where e2.swing_attempt_id = a2.id
          and e2.time_s is not null) as phases
      from public.active_legacy_swing_attempts a2
      join public.video_clips c2 on c2.id = a2.video_clip_id
      join public.game_log_entries g2 on g2.id = c2.game_log_entry_id
      left join lateral (select intent, environment from public.swing_attempt_context_history
        where swing_attempt_id = a2.id order by revision desc limit 1) h2 on true
      left join lateral (select coalesce(
          (select d.profile_slug from public.clip_capture_declarations d
            where d.video_clip_id = c2.id order by d.created_at desc, d.id desc limit 1),
          a.declared_profile_slug, a.inferred_profile_slug) as profile,
        a.orientation, case when exists (select 1 from
          (select profile_slug, profile_version from public.clip_capture_declarations
            where video_clip_id = c2.id order by created_at desc, id desc limit 1) d
          where (d.profile_slug, d.profile_version) is distinct from
            (a.declared_profile_slug, a.declared_profile_version)) then 'needs_recheck'
          else a.profile_plausibility end as capture_state
        from public.clip_capture_assessments a where a.video_clip_id = c2.id
        order by case a.stage when 'full' then 0 else 1 end, a.created_at desc limit 1) q2 on true
      where g2.player_id = v_player_id and c2.id <> p_clip_id
        and not exists (select 1 from public.clip_deletions d where d.clip_id = c2.id)
      order by g2.date desc, c2.id limit 20) ranked;
  select jsonb_build_object(
    'clipId', c.id, 'attemptId', v_attempt, 'playerId', p.id,
    'playerName', p.name, 'sport', t.sport, 'environment',
      case when g.session_type = 'game' then 'game' else 'practice' end,
    'date', g.date,
    'context', (select jsonb_build_object('sport', h.sport, 'environment', h.environment,
      'intent', h.intent, 'source', h.source, 'revision', h.revision)
      from public.swing_attempt_context_history h where h.swing_attempt_id = v_attempt
      order by h.revision desc limit 1),
    'capture', (select jsonb_build_object('profile', coalesce(
      (select d.profile_slug from public.clip_capture_declarations d
        where d.video_clip_id = c.id order by d.created_at desc, d.id desc limit 1),
      a.declared_profile_slug, a.inferred_profile_slug),
      'orientation', a.orientation, 'fps', a.actual_fps,
      'state', case when exists (select 1 from
        (select profile_slug, profile_version from public.clip_capture_declarations
          where video_clip_id = c.id order by created_at desc, id desc limit 1) d
        where (d.profile_slug, d.profile_version) is distinct from
          (a.declared_profile_slug, a.declared_profile_version)) then 'needs_recheck'
        else a.profile_plausibility end)
      from public.clip_capture_assessments a where a.video_clip_id = c.id
      order by case a.stage when 'full' then 0 else 1 end, a.created_at desc limit 1),
    'phases', coalesce((select jsonb_agg(jsonb_build_object(
      'slug', e.event_slug, 'time', e.time_s, 'frame', e.frame,
      'uncertaintyFrames', e.uncertainty_frames, 'uncertaintyStatus', e.uncertainty_status,
      'visibility', e.visibility, 'source', e.source,
      'pipelineVersion', e.pipeline_version, 'detectorVersion', e.detector_version,
      'correctedBy', (select cp.display_name from public.coach_profiles cp
        where cp.user_id = e.actor_id limit 1), 'reason', e.reason,
      'original', (select jsonb_build_object('time', o.time_s, 'frame', o.frame,
        'source', o.source, 'detectorVersion', o.detector_version)
        from public.swing_phase_events o where o.swing_attempt_id = v_attempt
          and o.event_slug = e.event_slug and o.source <> 'coach_correction'
        order by o.created_at desc, o.id desc limit 1)) order by e.event_slug)
      from public.effective_swing_phase_events e where e.swing_attempt_id = v_attempt), '[]'::jsonb),
    'annotations', coalesce((select jsonb_agg(jsonb_build_object(
      'id', n.annotation_id, 'slug', n.event_slug, 'body', n.body,
      'visibility', n.visibility, 'author', (select cp.display_name
        from public.coach_profiles cp where cp.user_id = n.actor_id limit 1),
      'createdAt', n.created_at)
      order by n.created_at)
      from public.coach_annotation_events n where n.swing_attempt_id = v_attempt
        and n.action = 'create' and not exists
          (select 1 from public.coach_annotation_events x where x.annotation_id = n.annotation_id
            and x.action = 'delete')), '[]'::jsonb),
    'evidencePackages', coalesce((select jsonb_agg(jsonb_build_object(
      'packageId', ep.id, 'definition', d.display_name,
      'sourceClass', d.source_class, 'providerName', r.provider_name)
      order by ep.created_at desc)
      from public.analysis_evidence_packages ep
      join public.analysis_technical_results r on r.package_id = ep.id
      join public.measurement_definitions d on d.id = r.definition_id
      where ep.video_clip_id = c.id and ep.swing_attempt_id = v_attempt
        and 'coach' = any(d.visibility) and t.sport = any(d.sports)
        and exists (select 1 from public.measurement_validation_decisions val
          where val.definition_id = d.id and val.status in ('validated_internal','validated_external')
            and val.id = (select x.id from public.measurement_validation_decisions x
              where x.definition_id = d.id order by x.decided_at desc, x.id desc limit 1))
        and exists (select 1 from public.swing_attempt_context_history h
          where h.swing_attempt_id = v_attempt and h.revision =
            (select max(revision) from public.swing_attempt_context_history
              where swing_attempt_id = v_attempt)
            and (h.intent <> 'unknown' and h.intent = any(d.intents)
              or h.intent = 'unknown' and array['unknown','conventional_full','slap',
                'power_slap','bunt','drag_bunt','checked_protective','take']::text[] <@ d.intents)
            and (not (d.compatibility_rules ? 'environments') or
              case when jsonb_typeof(d.compatibility_rules->'environments') = 'array'
                then h.environment <> 'unknown' and h.environment in
                  (select jsonb_array_elements_text(d.compatibility_rules->'environments'))
                else false end))), '[]'::jsonb),
    'candidates', v_candidates
    ) into v_result
    from public.video_clips c join public.game_log_entries g on g.id = c.game_log_entry_id
    join public.players p on p.id = g.player_id join public.teams t on t.id = p.team_id
    where c.id = p_clip_id;
  return v_result;
end;
$$;

-- Guardian-visible notes have a separate player-scoped read. They are not
-- inserted into the family summary or ordinary share response.
create or replace function public.get_guardian_coach_annotations(p_clip_id uuid)
returns jsonb language plpgsql stable security definer set search_path = '' as $$
declare v_player_id uuid; v_state text;
begin
  if auth.uid() is null or coalesce((auth.jwt()->>'is_anonymous')::boolean, false)
    then raise exception 'not found'; end if;
  select g.player_id, c.status into v_player_id, v_state from public.video_clips c
    join public.game_log_entries g on g.id = c.game_log_entry_id where c.id = p_clip_id;
  if v_player_id is null or v_state <> 'ready'
    or not public.is_guardian_for_player(v_player_id)
    or exists (select 1 from public.clip_deletions where clip_id = p_clip_id)
    or not exists (select 1 from public.active_legacy_swing_attempts
      where video_clip_id = p_clip_id)
    or not exists (select 1 from public.analysis_runs where video_clip_id = p_clip_id)
    or exists (select 1 from public.issues where video_clip_id = p_clip_id
      and review_status = 'draft')
    then raise exception 'not found'; end if;
  return coalesce((select jsonb_agg(jsonb_build_object('id', n.annotation_id,
    'phase', n.event_slug, 'body', n.body, 'author',
      (select cp.display_name from public.coach_profiles cp where cp.user_id = n.actor_id limit 1),
    'createdAt', n.created_at) order by n.created_at)
    from public.coach_annotation_events n where n.video_clip_id = p_clip_id
      and n.action = 'create' and n.visibility = 'guardian_visible'
      and not exists (select 1 from public.coach_annotation_events x
        where x.annotation_id = n.annotation_id and x.action = 'delete')), '[]'::jsonb);
end;
$$;

-- One package per call and only if the same coach can see its active clip.
-- This boundary exposes provenance, never raw hashes or storage paths.
create or replace function public.get_analysis_evidence(p_package_id uuid)
returns jsonb language plpgsql stable security definer set search_path = '' as $$
declare v_package public.analysis_evidence_packages; v_report jsonb; v_result jsonb;
begin
  select * into v_package from public.analysis_evidence_packages where id = p_package_id;
  if not found or public.coach_analysis_attempt(v_package.video_clip_id) is null
    then raise exception 'not found'; end if;
  v_report := public.get_coach_analysis(v_package.video_clip_id);
  if not exists (select 1 from jsonb_array_elements(v_report->'evidencePackages') e
    where e->>'packageId' = p_package_id::text) then raise exception 'not found'; end if;
  select jsonb_build_object('packageId', ep.id, 'sourceClass', d.source_class,
    'providerName', r.provider_name,
    'definition', d.display_name, 'definitionVersion', d.version,
    'plainDefinition', d.plain_definition, 'limitations', d.limitations,
    'methodologyReferences', to_jsonb(d.methodology_references),
    'uncertainty', r.uncertainty, 'pipelineVersion', ep.pipeline_version,
    'detectorVersion', ep.detector_version, 'methodologyVersion', ep.methodology_version,
    'items', coalesce((select jsonb_agg(jsonb_build_object('kind', i.kind, 'role', i.role,
      'startFrame', i.source_frame_start, 'endFrame', i.source_frame_end,
      'fps', i.source_fps, 'uncertaintyFrames', i.uncertainty_frames,
      'visibility', i.visibility, 'exclusionReason', i.exclusion_reason)
      order by i.item_order) from public.analysis_evidence_items i where i.package_id = ep.id), '[]'::jsonb))
    into v_result from public.analysis_evidence_packages ep
      join public.analysis_technical_results r on r.package_id = ep.id
      join public.measurement_definitions d on d.id = r.definition_id
      where ep.id = p_package_id and 'coach' = any(d.visibility)
        and exists (select 1 from public.measurement_validation_decisions v
          where v.definition_id = d.id and v.status in ('validated_internal','validated_external')
            and v.id = (select x.id from public.measurement_validation_decisions x
              where x.definition_id = d.id order by x.decided_at desc, x.id desc limit 1));
  if v_result is null then raise exception 'not found'; end if;
  return v_result;
end;
$$;

revoke all on function public.coach_analysis_attempt(uuid), public.coach_analysis_available(uuid),
  public.get_coach_analysis(uuid), public.get_guardian_coach_annotations(uuid),
  public.get_analysis_evidence(uuid), public.add_coach_text_annotation(uuid,text,text,text),
  public.delete_coach_text_annotation(uuid) from public, anon, authenticated;
grant execute on function public.coach_analysis_available(uuid), public.get_coach_analysis(uuid),
  public.get_analysis_evidence(uuid), public.get_guardian_coach_annotations(uuid),
  public.add_coach_text_annotation(uuid,text,text,text), public.delete_coach_text_annotation(uuid)
  to authenticated;
-- The helper remains callable only by its definer-owned server functions.
