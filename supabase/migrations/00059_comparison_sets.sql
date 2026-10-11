-- Phase 5: private versioned comparison sets. No definition is promoted here.
-- The family and share report paths remain unchanged.
create table public.comparison_definition_releases (
  definition_id uuid not null references public.measurement_definitions(id) on delete restrict,
  validation_decision_id uuid not null references public.measurement_validation_decisions(id) on delete restrict,
  approved_by uuid not null,
  approval_record text not null check (nullif(btrim(approval_record), '') is not null),
  released_at timestamptz not null default now(),
  primary key (definition_id, validation_decision_id)
);
create or replace function public.validate_comparison_release()
returns trigger language plpgsql set search_path = '' as $$
begin
  if not exists (select 1 from public.measurement_definitions d
    join public.measurement_validation_decisions v on v.definition_id = d.id
    where d.id = new.definition_id and v.id = new.validation_decision_id
      and v.status in ('validated_internal','validated_external')
      and new.approved_by <> d.created_by and new.approved_by <> v.decided_by)
    then raise exception 'independent comparison release approval required'; end if;
  return new;
end;
$$;
create trigger validate_comparison_release before insert on public.comparison_definition_releases
  for each row execute function public.validate_comparison_release();
create or replace function public.preserve_comparison_release()
returns trigger language plpgsql set search_path = '' as $$
begin raise exception 'comparison release record is immutable'; end;
$$;
create trigger preserve_comparison_release before update on public.comparison_definition_releases
  for each row execute function public.preserve_comparison_release();
alter table public.comparison_definition_releases enable row level security;
revoke all on public.comparison_definition_releases from public, anon, authenticated;
grant all on public.comparison_definition_releases to service_role;

create table public.comparison_sets (
  id uuid primary key default gen_random_uuid(),
  player_id uuid not null references public.players(id) on delete cascade,
  reference_clip_id uuid references public.video_clips(id) on delete set null,
  definition_id uuid not null references public.measurement_definitions(id) on delete restrict,
  validation_decision_id uuid not null references public.measurement_validation_decisions(id) on delete restrict,
  version integer not null check (version > 0),
  series text not null check (series in ('game','practice')),
  sport text not null check (sport in ('softball','baseball')),
  intent text not null,
  environment text not null,
  profile_slug text not null,
  profile_version text not null,
  orientation text not null,
  created_by uuid not null,
  created_at timestamptz not null default now(),
  aggregate jsonb,
  unique (player_id, definition_id, series, version)
);
create index comparison_sets_recent on public.comparison_sets(player_id, created_at desc);
create table public.comparison_set_members (
  id uuid primary key default gen_random_uuid(),
  comparison_set_id uuid not null references public.comparison_sets(id) on delete cascade,
  attempt_id uuid references public.swing_attempts(id) on delete set null,
  clip_id uuid references public.video_clips(id) on delete set null,
  package_id uuid references public.analysis_evidence_packages(id) on delete set null,
  source_date date,
  source_revision text,
  value_numeric numeric,
  exclusion_reason text check (exclusion_reason in
    ('sport_mismatch','intent_mismatch','environment_mismatch','incompatible_capture',
     'insufficient_quality','definition_version_mismatch','missing_result','coach_excluded','deleted_media')),
  check ((exclusion_reason is null) = (value_numeric is not null)),
  unique (comparison_set_id, attempt_id)
);
create index comparison_members_clip on public.comparison_set_members(clip_id);
alter table public.comparison_sets enable row level security;
alter table public.comparison_set_members enable row level security;
revoke all on public.comparison_sets, public.comparison_set_members from public, anon, authenticated;
grant all on public.comparison_sets, public.comparison_set_members to service_role;

create or replace function public.validate_comparison_set_insert()
returns trigger language plpgsql set search_path = '' as $$
begin
  if not exists (select 1 from public.video_clips c
    join public.game_log_entries g on g.id = c.game_log_entry_id
    join public.players p on p.id = g.player_id join public.teams t on t.id = p.team_id
    join public.measurement_validation_decisions v on v.id = new.validation_decision_id
    where c.id = new.reference_clip_id and g.player_id = new.player_id
      and t.sport = new.sport and v.definition_id = new.definition_id)
    then raise exception 'comparison set source mismatch'; end if;
  return new;
end;
$$;
create trigger validate_comparison_set before insert on public.comparison_sets
  for each row execute function public.validate_comparison_set_insert();
create or replace function public.validate_comparison_member_insert()
returns trigger language plpgsql set search_path = '' as $$
begin
  if not exists (select 1 from public.comparison_sets s
    join public.swing_attempts a on a.id = new.attempt_id
    join public.video_clips c on c.id = a.video_clip_id and c.id = new.clip_id
    join public.game_log_entries g on g.id = c.game_log_entry_id
    where s.id = new.comparison_set_id and g.player_id = s.player_id
      and g.date = new.source_date)
    then raise exception 'comparison member source mismatch'; end if;
  if new.exclusion_reason is null and not exists (
    select 1 from public.comparison_sets s
    join public.analysis_evidence_packages ep on ep.id = new.package_id
    join public.analysis_technical_results r on r.package_id = ep.id
    where s.id = new.comparison_set_id and ep.video_clip_id = new.clip_id
      and ep.swing_attempt_id = new.attempt_id and r.definition_id = s.definition_id
      and jsonb_typeof(r.value) = 'number' and (r.value::text)::numeric = new.value_numeric)
    then raise exception 'comparison member result mismatch'; end if;
  return new;
end;
$$;
create trigger validate_comparison_member before insert on public.comparison_set_members
  for each row execute function public.validate_comparison_member_insert();
create or replace function public.preserve_comparison_set_version()
returns trigger language plpgsql set search_path = '' as $$
begin
  if (to_jsonb(new) - 'aggregate' - 'reference_clip_id') is distinct from
      (to_jsonb(old) - 'aggregate' - 'reference_clip_id')
    or (new.reference_clip_id is distinct from old.reference_clip_id
      and new.reference_clip_id is not null)
    or (new.aggregate is distinct from old.aggregate
      and new.aggregate is not null and old.aggregate is not null)
    then raise exception 'comparison set version is immutable'; end if;
  return new;
end;
$$;
create trigger preserve_comparison_set_version before update on public.comparison_sets
  for each row execute function public.preserve_comparison_set_version();

-- A deletion request immediately strips derived values. The FK actions on
-- physical deletion subsequently null the source identifiers. No media path,
-- hash, or deleted-attempt identifier is kept in the client projection.
create or replace function public.redact_comparison_member_on_deletion()
returns trigger language plpgsql set search_path = '' as $$
begin
  update public.comparison_sets set aggregate = null where id in
    (select comparison_set_id from public.comparison_set_members where clip_id = new.clip_id);
  update public.comparison_set_members set value_numeric = null, package_id = null,
    source_date = null, source_revision = null, exclusion_reason = 'deleted_media'
    where clip_id = new.clip_id;
  return new;
end;
$$;
create trigger redact_comparison_member after insert on public.clip_deletions
  for each row execute function public.redact_comparison_member_on_deletion();
create or replace function public.redact_comparison_member_on_clip_removal()
returns trigger language plpgsql set search_path = '' as $$
begin
  if new.clip_id is null and old.clip_id is not null then
    new.attempt_id := null; new.package_id := null; new.value_numeric := null;
    new.source_date := null; new.source_revision := null;
    new.exclusion_reason := 'deleted_media';
  elsif new.exclusion_reason = 'deleted_media' and new.value_numeric is null then
    new.package_id := null; new.source_revision := null; new.source_date := null;
  elsif (new.attempt_id is null and old.attempt_id is not null)
    or (new.package_id is null and old.package_id is not null) then
    new.package_id := null; new.value_numeric := null; new.source_revision := null;
    new.exclusion_reason := 'missing_result';
  else
    raise exception 'comparison membership is immutable';
  end if;
  return new;
end;
$$;
create trigger redact_comparison_member_fk before update on public.comparison_set_members
  for each row execute function public.redact_comparison_member_on_clip_removal();
create or replace function public.invalidate_comparison_aggregate_after_redaction()
returns trigger language plpgsql set search_path = '' as $$
begin
  if old.value_numeric is not null and new.value_numeric is null then
    update public.comparison_sets set aggregate = null where id = new.comparison_set_id;
  end if;
  return new;
end;
$$;
create trigger invalidate_comparison_aggregate after update on public.comparison_set_members
  for each row execute function public.invalidate_comparison_aggregate_after_redaction();

-- A single authoritative snapshot projection. Internal helper is not granted
-- to browsers; every public entrypoint first checks coach_analysis_attempt.
create or replace function public.comparison_attempt_snapshot(p_clip_id uuid, p_definition_id uuid)
returns jsonb language plpgsql stable security definer set search_path = '' as $$
declare v_snapshot jsonb;
begin
  select jsonb_build_object('attemptId', a.id, 'clipId', c.id,
    'playerId', g.player_id, 'date', g.date, 'sport', t.sport,
    'series', case when g.session_type = 'game' then 'game' else 'practice' end,
    'intent', h.intent, 'environment', h.environment, 'contextSport', h.sport,
    'profile', coalesce(decl.profile_slug, assess.declared_profile_slug, assess.inferred_profile_slug),
    'profileVersion', coalesce(decl.profile_version, assess.declared_profile_version, assess.inferred_profile_version),
    'orientation', assess.orientation,
    'captureState', case when decl.id is not null and
      (decl.profile_slug, decl.profile_version) is distinct from
      (assess.declared_profile_slug, assess.declared_profile_version)
      then 'needs_recheck' else assess.profile_plausibility end,
    'assessmentStage', assess.stage,
    'qualityClear', assess.camera_motion = 'unavailable' and assess.blur = 'unavailable'
      and assess.athlete_ambiguity = 'unavailable' and
      assess.exposure = 'unavailable',
    'packageId', result.package_id, 'resultDefinitionId', result.definition_id,
    'value', result.numeric_value, 'visible', result.visible,
    'sourceRevision', jsonb_build_array(g.player_id, g.date, g.session_type, t.sport,
      h.revision, h.intent, h.environment, assess.id, decl.id,
      (select cp.status from public.capture_profiles cp where cp.slug =
        coalesce(decl.profile_slug, assess.declared_profile_slug, assess.inferred_profile_slug)
        and cp.version = coalesce(decl.profile_version, assess.declared_profile_version,
          assess.inferred_profile_version)), result.package_id)::text)
    into v_snapshot
    from public.active_legacy_swing_attempts a
    join public.video_clips c on c.id = a.video_clip_id
    join public.game_log_entries g on g.id = c.game_log_entry_id
    join public.players p on p.id = g.player_id
    join public.teams t on t.id = p.team_id
    left join lateral (select revision, sport, intent, environment from public.swing_attempt_context_history
      where swing_attempt_id = a.id order by revision desc limit 1) h on true
    left join lateral (select id, profile_slug, profile_version from public.clip_capture_declarations
      where video_clip_id = c.id order by created_at desc, id desc limit 1) decl on true
    left join lateral (select * from public.clip_capture_assessments
      where video_clip_id = c.id order by case stage when 'full' then 0 else 1 end,
        created_at desc, id desc limit 1) assess on true
    left join lateral (select ep.id as package_id, r.definition_id,
      case when jsonb_typeof(r.value) = 'number' and abs((r.value::text)::numeric) <= 1000000000000
        then (r.value::text)::numeric end as numeric_value,
      exists (select 1 from public.analysis_evidence_items i where i.package_id = ep.id
        and i.role = 'included' and i.visibility = 'visible') as visible
      from public.analysis_evidence_packages ep
      join public.analysis_technical_results r on r.package_id = ep.id
      where ep.video_clip_id = c.id and ep.swing_attempt_id = a.id
        and r.definition_id = p_definition_id
        and ep.analysis_run_id = (select ar.id from public.analysis_runs ar
          where ar.video_clip_id = c.id order by ar.created_at desc, ar.id desc limit 1)
      order by ep.created_at desc, ep.id desc limit 1) result on true
    where c.id = p_clip_id and not exists
      (select 1 from public.clip_deletions d where d.clip_id = c.id);
  return v_snapshot;
end;
$$;

create or replace function public.build_comparison_set(
  p_reference_clip_id uuid, p_definition_id uuid, p_omit_attempts uuid[] default '{}')
returns uuid language plpgsql volatile security definer set search_path = '' as $$
declare v_ref jsonb; v_def public.measurement_definitions; v_status text; v_decision_id uuid;
  v_set_id uuid; v_version integer; v_clip record; v_item jsonb; v_reason text;
  v_count integer; v_total integer; v_stats jsonb;
begin
  if public.coach_analysis_attempt(p_reference_clip_id) is null then raise exception 'not found'; end if;
  if cardinality(p_omit_attempts) > 500 then raise exception 'too many exclusions'; end if;
  select * into v_def from public.measurement_definitions where id = p_definition_id;
  select id, status into v_decision_id, v_status from public.measurement_validation_decisions
    where definition_id = p_definition_id order by decided_at desc, id desc limit 1;
  if v_def.id is null or v_status not in ('validated_internal','validated_external')
    or not exists (select 1 from public.comparison_definition_releases rel
      where rel.definition_id = p_definition_id and rel.validation_decision_id = v_decision_id)
    or v_def.source_class not in ('video_observed','video_estimated','comparable_video')
    or not ('coach' = any(v_def.visibility)) or v_def.aggregate_min_sample is null
    or v_def.aggregate_min_sample < 5
    or cardinality(v_def.required_landmarks) > 0 or v_def.minimum_quality <> '{}'::jsonb
    then raise exception 'definition is not released for comparison'; end if;
  v_ref := public.comparison_attempt_snapshot(p_reference_clip_id, p_definition_id);
  if v_ref is null or v_ref->>'intent' is null or v_ref->>'intent' = 'unknown'
    or v_ref->>'environment' is null or v_ref->>'environment' = 'unknown'
    or v_ref->>'captureState' <> 'supported' or v_ref->>'assessmentStage' <> 'full'
    or v_ref->>'profile' is null or v_ref->>'profileVersion' is null
    or v_ref->>'profile' = 'unknown_imported' or v_ref->>'orientation' is null
    or v_ref->>'orientation' = 'unknown'
    or v_ref->>'contextSport' is distinct from v_ref->>'sport'
    or not (v_ref->>'sport' = any(v_def.sports))
    or not (v_ref->>'intent' = any(v_def.intents))
    or not (v_ref->>'profile' = any(v_def.capture_profiles))
    or not exists (select 1 from public.capture_profiles cp
      where cp.slug = v_ref->>'profile' and cp.version = v_ref->>'profileVersion'
        and cp.status = 'enabled' and v_ref->>'sport' = any(cp.sports))
    or (v_def.compatibility_rules ? 'environments' and not
      (case when jsonb_typeof(v_def.compatibility_rules->'environments') = 'array'
        then exists (select 1 from jsonb_array_elements_text(v_def.compatibility_rules->'environments')
          as allowed(value) where allowed.value = v_ref->>'environment')
        else false end))
    then raise exception 'reference is not comparable'; end if;
  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(
    'comparison:' || (v_ref->>'playerId') || ':' || p_definition_id::text || ':' || (v_ref->>'series'), 0));
  select coalesce(max(version), 0) + 1 into v_version from public.comparison_sets
    where player_id = (v_ref->>'playerId')::uuid and definition_id = p_definition_id
      and series = v_ref->>'series';
  insert into public.comparison_sets(player_id, reference_clip_id, definition_id,
    validation_decision_id, version,
    series, sport, intent, environment, profile_slug, profile_version, orientation, created_by)
    values ((v_ref->>'playerId')::uuid, p_reference_clip_id, p_definition_id, v_decision_id, v_version,
      v_ref->>'series', v_ref->>'sport', v_ref->>'intent', v_ref->>'environment',
      v_ref->>'profile', v_ref->>'profileVersion', v_ref->>'orientation', auth.uid())
    returning id into v_set_id;
  for v_clip in select c.id from public.active_legacy_swing_attempts a
    join public.video_clips c on c.id = a.video_clip_id
    join public.game_log_entries g on g.id = c.game_log_entry_id
    where g.player_id = (v_ref->>'playerId')::uuid
      and not exists (select 1 from public.clip_deletions d where d.clip_id = c.id)
    order by g.date, c.id loop
    v_item := public.comparison_attempt_snapshot(v_clip.id, p_definition_id);
    v_reason := case
      when v_item->>'sport' is distinct from v_ref->>'sport'
        or v_item->>'contextSport' is distinct from v_ref->>'sport' then 'sport_mismatch'
      when v_item->>'intent' is distinct from v_ref->>'intent' then 'intent_mismatch'
      when v_item->>'environment' is distinct from v_ref->>'environment'
        or v_item->>'series' is distinct from v_ref->>'series' then 'environment_mismatch'
      when v_item->>'profile' is distinct from v_ref->>'profile'
        or v_item->>'profileVersion' is distinct from v_ref->>'profileVersion'
        or v_item->>'orientation' is distinct from v_ref->>'orientation'
        or v_item->>'captureState' is distinct from 'supported'
        or v_item->>'assessmentStage' is distinct from 'full' then 'incompatible_capture'
      when v_item->>'resultDefinitionId' is not null
        and v_item->>'resultDefinitionId' <> p_definition_id::text then 'definition_version_mismatch'
      when v_item->>'value' is null or v_item->>'packageId' is null then 'missing_result'
      when v_item->>'qualityClear' is distinct from 'true'
        or v_item->>'visible' is distinct from 'true'
        or exists (select 1 from unnest(v_def.required_phases) as required_phase(slug)
          where not exists (select 1 from public.effective_swing_phase_events e
            where e.swing_attempt_id = (v_item->>'attemptId')::uuid
              and e.event_slug = required_phase.slug and e.time_s is not null
              and e.visibility = 'visible')) then 'insufficient_quality'
      when (v_item->>'attemptId')::uuid = any(p_omit_attempts) then 'coach_excluded'
      else null end;
    insert into public.comparison_set_members(comparison_set_id, attempt_id, clip_id,
      package_id, source_date, source_revision, value_numeric, exclusion_reason)
      values (v_set_id, (v_item->>'attemptId')::uuid, v_clip.id,
        case when v_reason is null then (v_item->>'packageId')::uuid else null end,
        (v_item->>'date')::date, v_item->>'sourceRevision',
        case when v_reason is null then (v_item->>'value')::numeric else null end, v_reason);
  end loop;
  select count(*), count(*) filter (where exclusion_reason is null) into v_total, v_count
    from public.comparison_set_members where comparison_set_id = v_set_id;
  if v_count >= v_def.aggregate_min_sample then
    select jsonb_build_object('count', v_count, 'excludedCount', v_total-v_count,
      'from', min(source_date), 'through', max(source_date),
      'median', percentile_cont(0.5) within group (order by value_numeric),
      'q1', percentile_cont(0.25) within group (order by value_numeric),
      'q3', percentile_cont(0.75) within group (order by value_numeric),
      'iqr', percentile_cont(0.75) within group (order by value_numeric) -
        percentile_cont(0.25) within group (order by value_numeric)) into v_stats
      from public.comparison_set_members where comparison_set_id = v_set_id
        and exclusion_reason is null;
    update public.comparison_sets set aggregate = v_stats where id = v_set_id;
  end if;
  return v_set_id;
end;
$$;

-- A previous snapshot never silently changes. Stale data is withheld after a
-- deletion, a newer definition decision, or source reprocessing/correction.
create or replace function public.get_comparison_set(p_set_id uuid)
returns jsonb language plpgsql stable security definer set search_path = '' as $$
declare v_set public.comparison_sets; v_def public.measurement_definitions;
  v_status text; v_decision_id uuid; v_stale boolean; v_members jsonb;
begin
  select * into v_set from public.comparison_sets where id = p_set_id;
  if v_set.id is null or v_set.reference_clip_id is null
    or public.coach_analysis_attempt(v_set.reference_clip_id) is null then raise exception 'not found'; end if;
  select * into v_def from public.measurement_definitions where id = v_set.definition_id;
  select id, status into v_decision_id, v_status from public.measurement_validation_decisions
    where definition_id = v_set.definition_id order by decided_at desc, id desc limit 1;
  v_stale := v_decision_id is distinct from v_set.validation_decision_id
    or not exists (select 1 from public.comparison_definition_releases rel
      where rel.definition_id = v_set.definition_id
        and rel.validation_decision_id = v_set.validation_decision_id)
    or coalesce(v_status not in ('validated_internal','validated_external'), true) or exists (
    select 1 from public.comparison_set_members m where m.comparison_set_id = p_set_id
      and (m.clip_id is null or exists
        (select 1 from public.clip_deletions d where d.clip_id = m.clip_id)
        or m.source_revision is distinct from
          (public.comparison_attempt_snapshot(m.clip_id, v_set.definition_id)->>'sourceRevision')));
  select coalesce(jsonb_agg(jsonb_build_object('clipId', case when v_stale then null else m.clip_id end,
    'attemptId', case when v_stale then null else m.attempt_id end,
    'date', case when v_stale then null else m.source_date end,
    'reason', m.exclusion_reason,
    'value', case when v_stale then null else m.value_numeric end)
    order by m.source_date, m.id), '[]'::jsonb) into v_members
    from public.comparison_set_members m where m.comparison_set_id = p_set_id;
  return jsonb_build_object('id', v_set.id, 'version', v_set.version,
    'series', v_set.series, 'definition', v_def.display_name, 'definitionVersion', v_def.version,
    'unit', v_def.unit, 'status', case when v_stale then 'stale'
      when v_set.aggregate is null then 'insufficient_sample' else 'descriptive' end,
    'aggregate', case when v_stale then null else v_set.aggregate end,
    'minimum', v_def.aggregate_min_sample, 'trendMinimum', v_def.trend_min_sample,
    'trend', null,
    'focusSupport', case when not v_stale and v_set.aggregate is not null
      and v_set.series = 'game' and nullif(v_def.compatibility_rules->>'focus_concept', '') is not null
      and exists (select 1 from public.player_focus f where f.player_id = v_set.player_id
        and f.ended_at is null and f.concept = v_def.compatibility_rules->>'focus_concept')
      then jsonb_build_object('concept', v_def.compatibility_rules->>'focus_concept',
        'meaning', 'descriptive evidence only; focus status remains governed by game findings')
      else null end,
    'members', v_members);
end;
$$;

create or replace function public.list_comparison_definitions(p_clip_id uuid)
returns jsonb language plpgsql stable security definer set search_path = '' as $$
declare v_sport text; v_result jsonb;
begin
  if public.coach_analysis_attempt(p_clip_id) is null then raise exception 'not found'; end if;
  select t.sport into v_sport from public.video_clips c
    join public.game_log_entries g on g.id = c.game_log_entry_id
    join public.players p on p.id = g.player_id join public.teams t on t.id = p.team_id
    where c.id = p_clip_id;
  select coalesce(jsonb_agg(jsonb_build_object('id', d.id, 'name', d.display_name,
    'version', d.version, 'unit', d.unit) order by d.display_name), '[]'::jsonb)
    into v_result from public.measurement_definitions d where 'coach' = any(d.visibility)
      and v_sport = any(d.sports) and d.aggregate_min_sample >= 5
      and d.source_class in ('video_observed','video_estimated','comparable_video')
      and cardinality(d.required_landmarks) = 0 and d.minimum_quality = '{}'::jsonb
      and cardinality(d.capture_profiles) > 0 and exists
        (select 1 from public.comparison_definition_releases rel
          where rel.definition_id = d.id and rel.validation_decision_id =
            (select x.id from public.measurement_validation_decisions x
              where x.definition_id = d.id order by x.decided_at desc, x.id desc limit 1))
      and exists
        (select 1 from public.measurement_validation_decisions v where v.definition_id = d.id
          and v.status in ('validated_internal','validated_external')
          and v.id = (select x.id from public.measurement_validation_decisions x
            where x.definition_id = d.id order by x.decided_at desc, x.id desc limit 1));
  return v_result;
end;
$$;

create or replace function public.list_comparison_sets(p_clip_id uuid)
returns jsonb language plpgsql stable security definer set search_path = '' as $$
declare v_player_id uuid; v_result jsonb;
begin
  if public.coach_analysis_attempt(p_clip_id) is null then raise exception 'not found'; end if;
  select g.player_id into v_player_id from public.video_clips c
    join public.game_log_entries g on g.id = c.game_log_entry_id where c.id = p_clip_id;
  select coalesce(jsonb_agg(jsonb_build_object('id', recent.id, 'version', recent.version,
    'definitionId', recent.definition_id, 'definition', recent.display_name,
    'series', recent.series, 'createdAt', recent.created_at)
    order by recent.created_at desc, recent.id), '[]'::jsonb) into v_result from (
      select s.id, s.version, s.definition_id, d.display_name, s.series, s.created_at
      from public.comparison_sets s join public.measurement_definitions d on d.id = s.definition_id
      where s.player_id = v_player_id and s.reference_clip_id is not null
      order by s.created_at desc, s.id desc limit 50) recent;
  return v_result;
end;
$$;

revoke all on function public.comparison_attempt_snapshot(uuid,uuid),
  public.build_comparison_set(uuid,uuid,uuid[]), public.get_comparison_set(uuid),
  public.list_comparison_definitions(uuid), public.list_comparison_sets(uuid)
  from public, anon, authenticated;
grant execute on function public.build_comparison_set(uuid,uuid,uuid[]),
  public.get_comparison_set(uuid), public.list_comparison_definitions(uuid),
  public.list_comparison_sets(uuid) to authenticated;
