-- Analysis-depth Phase 1. Local, additive foundation only: no advanced reads
-- are exposed to a browser, shared link, or demo schema. Existing reports
-- retain their legacy shape and are not retroactively given provenance.

create table public.measurement_definitions (
  id uuid primary key default gen_random_uuid(),
  slug text not null check (slug ~ '^[a-z][a-z0-9_]*$'),
  version text not null check (version ~ '^[0-9]+\.[0-9]+\.[0-9]+$'),
  display_name text not null check (btrim(display_name) <> ''),
  plain_definition text not null check (btrim(plain_definition) <> ''),
  source_class text not null check (source_class in
    ('video_observed','video_estimated','comparable_video','external_device','coach_entered')),
  sports text[] not null check (sports <@ array['softball','baseball']::text[] and cardinality(sports) > 0),
  intents text[] not null check (intents <@ array['conventional_full','slap','power_slap','bunt','drag_bunt','checked_protective','take','unknown']::text[] and cardinality(intents) > 0),
  capture_profiles text[] not null default '{}',
  required_landmarks text[] not null default '{}',
  required_phases text[] not null default '{}',
  minimum_quality jsonb not null default '{}'::jsonb check (jsonb_typeof(minimum_quality) = 'object'),
  unit text not null check (btrim(unit) <> ''),
  compatibility_rules jsonb not null default '{}'::jsonb check (jsonb_typeof(compatibility_rules) = 'object'),
  aggregate_min_sample integer check (aggregate_min_sample is null or aggregate_min_sample > 0),
  trend_min_sample integer check (trend_min_sample is null or trend_min_sample > 0),
  uncertainty_method text not null check (btrim(uncertainty_method) <> ''),
  visibility text[] not null default '{}' check (visibility <@ array['family','coach','performance_lab']::text[]),
  methodology_references text[] not null default '{}',
  limitations text not null check (btrim(limitations) <> ''),
  prohibited_interpretations text[] not null check (cardinality(prohibited_interpretations) > 0),
  -- Historical reviewer IDs remain audit facts if an admin account closes.
  created_by uuid not null,
  created_at timestamptz not null default now(),
  unique (slug, version),
  unique (id, source_class),
  check (trend_min_sample is null or aggregate_min_sample is not null and trend_min_sample >= aggregate_min_sample)
);

-- Status is an append-only human decision; a new definition version never
-- silently inherits validation from its predecessor.
create table public.measurement_validation_decisions (
  id uuid primary key default gen_random_uuid(),
  definition_id uuid not null references public.measurement_definitions(id) on delete restrict,
  status text not null check (status in ('experimental','validated_internal','validated_external','retired')),
  rationale text not null check (btrim(rationale) <> ''),
  decided_by uuid not null,
  decided_at timestamptz not null default now()
);
create index measurement_validation_latest on public.measurement_validation_decisions(definition_id, decided_at desc, id desc);

create table public.analysis_evidence_packages (
  id uuid primary key default gen_random_uuid(),
  analysis_run_id uuid not null references public.analysis_runs(id) on delete cascade,
  player_id uuid not null references public.players(id) on delete cascade,
  video_clip_id uuid not null references public.video_clips(id) on delete cascade,
  result_key text not null check (btrim(result_key) <> ''),
  pipeline_version text not null check (btrim(pipeline_version) <> ''),
  detector_version text not null check (btrim(detector_version) <> ''),
  measurement_version text not null check (btrim(measurement_version) <> ''),
  methodology_version text not null check (btrim(methodology_version) <> ''),
  prompt_version text not null check (btrim(prompt_version) <> ''),
  model_version text not null check (btrim(model_version) <> ''),
  source_manifest_hash text not null check (source_manifest_hash ~ '^[a-f0-9]{64}$'),
  created_at timestamptz not null default now(),
  unique (analysis_run_id, result_key),
  unique (id, player_id, video_clip_id)
);
create index analysis_evidence_packages_clip on public.analysis_evidence_packages(video_clip_id);

create table public.analysis_evidence_items (
  id uuid primary key default gen_random_uuid(),
  package_id uuid not null references public.analysis_evidence_packages(id) on delete cascade,
  item_order integer not null check (item_order >= 0),
  kind text not null check (kind in ('frame','time_range','observation','external_record','coach_entry','aggregate_member')),
  role text not null check (role in ('included','excluded','context')),
  exclusion_reason text check (exclusion_reason in
    ('incompatible_capture','hidden_body_part','detector_uncertainty','deleted_media',
     'intent_mismatch','environment_mismatch','definition_version_mismatch',
     'insufficient_quality','wrong_athlete','unknown_context')),
  source_frame_start integer check (source_frame_start is null or source_frame_start >= 0),
  source_frame_end integer check (source_frame_end is null or source_frame_end >= 0),
  source_fps numeric check (source_fps is null or source_fps > 0),
  uncertainty_frames integer check (uncertainty_frames is null or uncertainty_frames >= 0),
  source_hash text check (source_hash is null or source_hash ~ '^[a-f0-9]{64}$'),
  visibility text not null check (visibility in ('visible','partial','unavailable','not_applicable')),
  created_at timestamptz not null default now(),
  unique (package_id, item_order),
  check ((role = 'excluded') = (exclusion_reason is not null)),
  check (source_frame_end is null or source_frame_start is not null and source_frame_end >= source_frame_start),
  check (source_frame_start is null or source_fps is not null)
);

create table public.analysis_technical_results (
  id uuid primary key default gen_random_uuid(),
  package_id uuid not null references public.analysis_evidence_packages(id) on delete cascade,
  definition_id uuid not null,
  source_class text not null,
  provider_name text,
  value jsonb not null check (jsonb_typeof(value) <> 'null'),
  uncertainty jsonb not null check (jsonb_typeof(uncertainty) = 'object'
    and nullif(btrim(uncertainty->>'status'), '') is not null),
  created_at timestamptz not null default now(),
  unique (package_id),
  check (source_class <> 'external_device' or nullif(btrim(provider_name), '') is not null),
  check (source_class = 'external_device' or provider_name is null),
  foreign key (definition_id, source_class)
    references public.measurement_definitions(id, source_class) on delete restrict
);

-- A result is committed only with at least one included source item. This
-- deferred check permits package, items, then result in one transaction.
create or replace function public.require_included_analysis_evidence()
returns trigger language plpgsql set search_path = '' as $$
begin
  if not exists (select 1 from public.analysis_evidence_items
    where package_id = new.package_id and role = 'included') then
    raise exception 'technical result requires included evidence';
  end if;
  return new;
end;
$$;
create constraint trigger require_included_analysis_evidence
  after insert on public.analysis_technical_results deferrable initially deferred
  for each row execute function public.require_included_analysis_evidence();

create or replace function public.preserve_included_analysis_evidence()
returns trigger language plpgsql set search_path = '' as $$
begin
  if exists (select 1 from public.analysis_technical_results where package_id = old.package_id)
    and not exists (select 1 from public.analysis_evidence_items
      where package_id = old.package_id and role = 'included') then
    raise exception 'technical result requires included evidence';
  end if;
  return old;
end;
$$;
create constraint trigger preserve_included_analysis_evidence
  after delete on public.analysis_evidence_items deferrable initially deferred
  for each row execute function public.preserve_included_analysis_evidence();

create or replace function public.validate_analysis_technical_result()
returns trigger language plpgsql set search_path = '' as $$
begin
  if not exists (
    select 1 from public.analysis_evidence_packages p
    join public.measurement_definitions d on d.id = new.definition_id
    where p.id = new.package_id and p.measurement_version = d.version
  ) then raise exception 'technical result definition version differs from evidence package'; end if;
  return new;
end;
$$;
create trigger validate_analysis_technical_result before insert on public.analysis_technical_results
  for each row execute function public.validate_analysis_technical_result();

-- The only client-facing registry mutation uses the pre-existing global
-- methodology-admin allowlist. It never reads a player, clip, or media row.
create or replace function public.register_measurement_definition(p_definition jsonb)
returns uuid language plpgsql volatile security definer set search_path = '' as $$
declare v_id uuid;
begin
  if auth.uid() is null or not public.is_methodology_admin() then raise exception 'not allowed'; end if;
  insert into public.measurement_definitions
    (slug, version, display_name, plain_definition, source_class, sports, intents,
     capture_profiles, required_landmarks, required_phases, minimum_quality, unit,
     compatibility_rules, aggregate_min_sample, trend_min_sample, uncertainty_method,
     visibility, methodology_references, limitations, prohibited_interpretations, created_by)
  values
    (p_definition->>'slug', p_definition->>'version', p_definition->>'display_name',
     p_definition->>'plain_definition', p_definition->>'source_class',
     array(select jsonb_array_elements_text(p_definition->'sports')),
     array(select jsonb_array_elements_text(p_definition->'intents')),
     coalesce(array(select jsonb_array_elements_text(p_definition->'capture_profiles')), '{}'),
     coalesce(array(select jsonb_array_elements_text(p_definition->'required_landmarks')), '{}'),
     coalesce(array(select jsonb_array_elements_text(p_definition->'required_phases')), '{}'),
     coalesce(p_definition->'minimum_quality', '{}'::jsonb), p_definition->>'unit',
     coalesce(p_definition->'compatibility_rules', '{}'::jsonb),
     (p_definition->>'aggregate_min_sample')::integer, (p_definition->>'trend_min_sample')::integer,
     p_definition->>'uncertainty_method',
     coalesce(array(select jsonb_array_elements_text(p_definition->'visibility')), '{}'),
     coalesce(array(select jsonb_array_elements_text(p_definition->'methodology_references')), '{}'),
     p_definition->>'limitations',
     array(select jsonb_array_elements_text(p_definition->'prohibited_interpretations')),
     auth.uid()) returning id into v_id;
  insert into public.measurement_validation_decisions(definition_id, status, rationale, decided_by)
    values (v_id, 'experimental', 'New definition; validation pending', auth.uid());
  return v_id;
end;
$$;

create or replace function public.record_measurement_validation(
  p_definition_id uuid, p_status text, p_rationale text
) returns void language plpgsql volatile security definer set search_path = '' as $$
begin
  if auth.uid() is null or not public.is_methodology_admin() then raise exception 'not allowed'; end if;
  if p_status not in ('experimental','validated_internal','validated_external','retired')
    or nullif(btrim(p_rationale), '') is null then raise exception 'invalid validation decision'; end if;
  if not exists (select 1 from public.measurement_definitions where id = p_definition_id) then
    raise exception 'unknown definition';
  end if;
  insert into public.measurement_validation_decisions(definition_id, status, rationale, decided_by)
    values (p_definition_id, p_status, p_rationale, auth.uid());
end;
$$;

-- Validate server writes even when they bypass RLS. A package cannot attach
-- a different player's clip or a different run's version manifest.
create or replace function public.validate_analysis_evidence_package()
returns trigger language plpgsql set search_path = '' as $$
begin
  if not exists (
    select 1 from public.analysis_runs r
    join public.video_clips c on c.id = new.video_clip_id
    join public.game_log_entries g on g.id = c.game_log_entry_id
    where r.id = new.analysis_run_id and r.player_id = new.player_id
      and r.video_clip_id = new.video_clip_id and g.player_id = new.player_id
      and r.pipeline_version is not distinct from new.pipeline_version
      and r.knowledge_version = new.methodology_version
      and r.prompt_version = new.prompt_version
      and coalesce(r.ai_model_version, r.ai_model) = new.model_version
  ) then raise exception 'evidence package does not match analysis run and clip'; end if;
  return new;
end;
$$;
create trigger validate_analysis_evidence_package before insert on public.analysis_evidence_packages
  for each row execute function public.validate_analysis_evidence_package();

-- Evidence and definition content is append-only. Cascading deletes from a
-- deleted clip remove evidence and hashes immediately; no media path is stored.
create or replace function public.reject_analysis_evidence_update()
returns trigger language plpgsql set search_path = '' as $$
begin raise exception 'analysis evidence and definitions are immutable'; end;
$$;
create trigger immutable_measurement_definitions before update on public.measurement_definitions
  for each row execute function public.reject_analysis_evidence_update();
create trigger immutable_validation_decisions before update on public.measurement_validation_decisions
  for each row execute function public.reject_analysis_evidence_update();
create trigger immutable_evidence_packages before update on public.analysis_evidence_packages
  for each row execute function public.reject_analysis_evidence_update();
create trigger immutable_evidence_items before update on public.analysis_evidence_items
  for each row execute function public.reject_analysis_evidence_update();
create trigger immutable_technical_results before update on public.analysis_technical_results
  for each row execute function public.reject_analysis_evidence_update();

alter table public.measurement_definitions enable row level security;
alter table public.measurement_validation_decisions enable row level security;
alter table public.analysis_evidence_packages enable row level security;
alter table public.analysis_evidence_items enable row level security;
alter table public.analysis_technical_results enable row level security;
create policy measurement_definitions_admin_read on public.measurement_definitions
  for select to authenticated using (public.is_methodology_admin());
create policy measurement_validation_admin_read on public.measurement_validation_decisions
  for select to authenticated using (public.is_methodology_admin());
revoke all on public.measurement_definitions, public.measurement_validation_decisions,
  public.analysis_evidence_packages, public.analysis_evidence_items,
  public.analysis_technical_results from public, anon, authenticated;
grant select on public.measurement_definitions, public.measurement_validation_decisions to authenticated;
grant all on public.measurement_definitions, public.measurement_validation_decisions,
  public.analysis_evidence_packages, public.analysis_evidence_items,
  public.analysis_technical_results to service_role;
revoke all on function public.register_measurement_definition(jsonb) from public, anon;
revoke all on function public.record_measurement_validation(uuid, text, text) from public, anon;
grant execute on function public.register_measurement_definition(jsonb) to authenticated;
grant execute on function public.record_measurement_validation(uuid, text, text) to authenticated;

-- demo is intentionally excluded: its frozen fixture has no Phase 1 technical
-- evidence and the public demo reader has no reference to these tables.
