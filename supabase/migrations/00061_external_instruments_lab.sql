-- Phase 7: private provider-neutral instrument staging and performance read.
-- No provider mapping, consent, analyst access, or device claim is released here.
-- The family/share/demo paths are unchanged. No automatic synchronization.
create table public.performance_lab_access (
  team_id uuid not null references public.teams(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  enabled_at timestamptz not null,
  training_acknowledged_at timestamptz not null,
  primary key(team_id,user_id)
);
create table public.instrument_consent_records (
  id uuid primary key default gen_random_uuid(),
  player_id uuid not null references public.players(id) on delete cascade,
  data_owner_label text not null check (length(btrim(data_owner_label)) between 2 and 120),
  consent_artifact_sha256 text not null check (consent_artifact_sha256 ~ '^[a-f0-9]{64}$'),
  scope text not null check (scope = 'private_performance_analysis'),
  granted_at timestamptz not null,
  revoked_at timestamptz,
  recorded_by uuid not null references auth.users(id),
  created_at timestamptz not null default now(),
  unique(id,player_id),
  check (revoked_at is null or revoked_at >= granted_at)
);
create table public.instrument_imports (
  id uuid primary key default gen_random_uuid(),
  player_id uuid not null references public.players(id) on delete cascade,
  consent_id uuid not null,
  practice_session_id uuid references public.practice_sessions(id) on delete set null,
  imported_by uuid not null references auth.users(id),
  imported_at timestamptz not null default now(),
  source_file_sha256 text not null check (source_file_sha256 ~ '^[a-f0-9]{64}$'),
  source_format text not null check (source_format in ('csv','json')),
  provider text not null check (length(btrim(provider)) between 2 and 120),
  device_type text not null check (device_type in ('bat_sensor','radar','ball_flight','facility_export','other')),
  device_model text not null check (length(btrim(device_model)) between 1 and 120),
  firmware text not null check (length(btrim(firmware)) between 1 and 120),
  warnings text[] not null default '{}',
  source_record_count integer not null check (source_record_count between 1 and 2000),
  unique(player_id,source_file_sha256),
  unique(id,player_id),
  foreign key(consent_id,player_id) references public.instrument_consent_records(id,player_id)
);
create index instrument_import_player on public.instrument_imports(player_id,imported_at desc);
create table public.instrument_readings (
  id uuid primary key default gen_random_uuid(),
  import_id uuid not null references public.instrument_imports(id) on delete cascade,
  record_key text not null check (length(btrim(record_key)) between 1 and 120),
  device_timestamp timestamptz,
  source_field text not null check (length(btrim(source_field)) between 1 and 120),
  original_value text not null check (length(original_value) between 1 and 200),
  original_unit text not null check (length(btrim(original_unit)) between 1 and 40),
  provider_definition_version text not null check (length(btrim(provider_definition_version)) between 1 and 80),
  warnings text[] not null default '{}',
  created_at timestamptz not null default now(),
  unique(import_id,record_key,source_field)
);
create index instrument_readings_import on public.instrument_readings(import_id,record_key);

-- Exact provider/model/firmware/definition/field/unit keys prevent a new
-- firmware or provider definition from silently inheriting an old mapping.
create table public.instrument_field_mappings (
  id uuid primary key default gen_random_uuid(),
  provider text not null,
  device_type text not null,
  device_model text not null,
  firmware text not null,
  provider_definition_version text not null,
  source_field text not null,
  source_unit text not null,
  mapping_version text not null check (mapping_version ~ '^[0-9]+\.[0-9]+\.[0-9]+$'),
  definition_id uuid not null references public.measurement_definitions(id) on delete restrict,
  scale numeric not null,
  offset_value numeric not null default 0,
  reviewed_by uuid not null references auth.users(id),
  review_record text not null check (length(btrim(review_record)) >= 20),
  created_at timestamptz not null default now(),
  unique(provider,device_type,device_model,firmware,provider_definition_version,
    source_field,source_unit,mapping_version)
);
create index instrument_mapping_definition on public.instrument_field_mappings(definition_id);
create table public.instrument_normalizations (
  id uuid primary key default gen_random_uuid(),
  reading_id uuid not null references public.instrument_readings(id) on delete cascade,
  mapping_id uuid not null references public.instrument_field_mappings(id) on delete restrict,
  normalized_value numeric not null,
  created_at timestamptz not null default now(),
  unique(reading_id,mapping_id)
);
create table public.instrument_link_events (
  id uuid primary key default gen_random_uuid(),
  import_id uuid not null references public.instrument_imports(id) on delete cascade,
  record_key text not null,
  action text not null check (action in ('link','unlink')),
  attempt_id uuid references public.swing_attempts(id) on delete set null,
  actor_id uuid not null references auth.users(id),
  reason text not null check (length(btrim(reason)) between 3 and 500),
  created_at timestamptz not null default now(),
  -- A linked attempt may later be deleted; its FK clears without blocking
  -- deletion. The link RPC requires an active attempt at insertion.
  check (action <> 'unlink' or attempt_id is null)
);
create index instrument_link_latest on public.instrument_link_events(import_id,record_key,created_at desc,id desc);
create table public.performance_export_events (
  id uuid primary key default gen_random_uuid(),
  player_id uuid not null references public.players(id) on delete cascade,
  actor_id uuid not null references auth.users(id),
  payload_sha256 text not null check (payload_sha256 ~ '^[a-f0-9]{64}$'),
  record_count integer not null check (record_count >= 0),
  exported_at timestamptz not null default now()
);

alter table public.performance_lab_access enable row level security;
alter table public.instrument_consent_records enable row level security;
alter table public.instrument_imports enable row level security;
alter table public.instrument_readings enable row level security;
alter table public.instrument_field_mappings enable row level security;
alter table public.instrument_normalizations enable row level security;
alter table public.instrument_link_events enable row level security;
alter table public.performance_export_events enable row level security;
revoke all on public.performance_lab_access,public.instrument_consent_records,public.instrument_imports,
  public.instrument_readings,public.instrument_field_mappings,public.instrument_normalizations,
  public.instrument_link_events,public.performance_export_events from public,anon,authenticated;
grant all on public.performance_lab_access,public.instrument_consent_records,public.instrument_imports,
  public.instrument_readings,public.instrument_field_mappings,public.instrument_normalizations,
  public.instrument_link_events,public.performance_export_events to service_role;

create or replace function public.performance_lab_allowed(p_player_id uuid)
returns boolean language sql stable security definer set search_path = '' as $$
  select auth.uid() is not null and not coalesce((auth.jwt()->>'is_anonymous')::boolean,false)
    and exists (select 1 from public.players p
      join public.performance_lab_access a on a.team_id=p.team_id and a.user_id=auth.uid()
      where p.id=p_player_id and public.is_coach_for_team(p.team_id));
$$;
create or replace function public.performance_analysis_available(p_player_id uuid)
returns boolean language sql stable security definer set search_path = '' as $$
  select public.performance_lab_allowed(p_player_id);
$$;
create or replace function public.validate_instrument_import()
returns trigger language plpgsql set search_path = '' as $$
begin
  if not exists (select 1 from public.instrument_consent_records c
    where c.id=new.consent_id and c.player_id=new.player_id and c.revoked_at is null
      and c.scope='private_performance_analysis') then raise exception 'active consent required'; end if;
  if new.practice_session_id is not null and not exists
    (select 1 from public.practice_sessions s where s.id=new.practice_session_id and s.player_id=new.player_id)
    then raise exception 'session/player mismatch'; end if;
  if not exists (select 1 from public.players p join public.performance_lab_access a
    on a.team_id=p.team_id and a.user_id=new.imported_by
    join public.coach_team_access cta on cta.team_id=p.team_id and cta.coach_id=new.imported_by
    where p.id=new.player_id) then raise exception 'importer is not enabled for this player'; end if;
  return new;
end; $$;
create trigger instrument_import_validate before insert on public.instrument_imports
  for each row execute function public.validate_instrument_import();
create or replace function public.validate_instrument_mapping()
returns trigger language plpgsql set search_path = '' as $$
begin
  if not exists (select 1 from public.measurement_definitions d
    join lateral (select v.* from public.measurement_validation_decisions v
      where v.definition_id=d.id order by v.decided_at desc,v.id desc limit 1) latest on true
    where d.id=new.definition_id and d.source_class='external_device'
      and 'performance_lab'=any(d.visibility)
      and latest.status in ('validated_internal','validated_external')
      and d.unit<>'' and new.reviewed_by<>d.created_by and new.reviewed_by<>latest.decided_by)
    then raise exception 'independent validated external definition required'; end if;
  return new;
end; $$;
create trigger instrument_mapping_validate before insert on public.instrument_field_mappings
  for each row execute function public.validate_instrument_mapping();
create or replace function public.reject_instrument_history_change()
returns trigger language plpgsql set search_path = '' as $$
begin raise exception 'instrument history is append only'; end; $$;
create or replace function public.preserve_instrument_import()
returns trigger language plpgsql set search_path = '' as $$
begin
  if (to_jsonb(new)-'practice_session_id') is distinct from
      (to_jsonb(old)-'practice_session_id') or
      (new.practice_session_id is distinct from old.practice_session_id
        and new.practice_session_id is not null)
    then raise exception 'instrument import is immutable'; end if;
  return new;
end; $$;
create trigger instrument_import_immutable before update on public.instrument_imports
  for each row execute function public.preserve_instrument_import();
create trigger instrument_reading_immutable before update on public.instrument_readings
  for each row execute function public.reject_instrument_history_change();
create trigger instrument_mapping_immutable before update or delete on public.instrument_field_mappings
  for each row execute function public.reject_instrument_history_change();
create trigger instrument_normalization_immutable before update on public.instrument_normalizations
  for each row execute function public.reject_instrument_history_change();
create or replace function public.preserve_instrument_link()
returns trigger language plpgsql set search_path = '' as $$
begin
  if (to_jsonb(new)-'attempt_id') is distinct from
      (to_jsonb(old)-'attempt_id') or
      (new.attempt_id is distinct from old.attempt_id and new.attempt_id is not null)
    then raise exception 'instrument link history is immutable'; end if;
  return new;
end; $$;
create trigger instrument_link_immutable before update on public.instrument_link_events
  for each row execute function public.preserve_instrument_link();
create trigger instrument_export_immutable before update on public.performance_export_events
  for each row execute function public.reject_instrument_history_change();

-- The CLI is a service-role-only writer. It sends a bounded canonical envelope
-- after hashing the raw file once. SQL checks player, consent and import scope.
create or replace function public.stage_instrument_import(p_envelope jsonb)
returns uuid language plpgsql volatile security definer set search_path = '' as $$
declare v_id uuid; v_item jsonb; v_items jsonb; v_count integer;
begin
  if auth.role() <> 'service_role' then raise exception 'service role required'; end if;
  if jsonb_typeof(p_envelope) <> 'object' then raise exception 'invalid envelope'; end if;
  if octet_length(p_envelope::text) > 2500000 then raise exception 'envelope too large'; end if;
  v_items := p_envelope->'readings';
  if jsonb_typeof(v_items) <> 'array' then raise exception 'readings array required'; end if;
  v_count := jsonb_array_length(v_items);
  if v_count not between 1 and 2000 then raise exception 'invalid reading count'; end if;
  insert into public.instrument_imports(player_id,consent_id,practice_session_id,imported_by,
    source_file_sha256,source_format,provider,device_type,device_model,firmware,warnings,source_record_count)
    values((p_envelope->>'playerId')::uuid,(p_envelope->>'consentId')::uuid,
      nullif(p_envelope->>'sessionId','')::uuid,(p_envelope->>'importedBy')::uuid,
      p_envelope->>'fileSha256',p_envelope->>'format',p_envelope->>'provider',
      p_envelope->>'deviceType',p_envelope->>'deviceModel',p_envelope->>'firmware',
      coalesce(array(select jsonb_array_elements_text(p_envelope->'warnings')),array[]::text[]),v_count)
    returning id into v_id;
  for v_item in select value from jsonb_array_elements(v_items) loop
    if jsonb_typeof(v_item) <> 'object' or
      jsonb_typeof(v_item->'value') <> 'string' or
      jsonb_typeof(v_item->'unit') <> 'string' or
      jsonb_typeof(v_item->'field') <> 'string' then raise exception 'invalid original reading'; end if;
    insert into public.instrument_readings(import_id,record_key,device_timestamp,
      source_field,original_value,original_unit,provider_definition_version,warnings)
      values(v_id,v_item->>'recordKey',nullif(v_item->>'timestamp','')::timestamptz,
        v_item->>'field',v_item->>'value',v_item->>'unit',v_item->>'definitionVersion',
        coalesce(array(select jsonb_array_elements_text(v_item->'warnings')),array[]::text[]));
  end loop;
  return v_id;
end; $$;

-- Service-only, reviewed exact mapping. Creates a new immutable interpretation
-- version; it never rewrites original values or earlier interpretations.
create or replace function public.apply_instrument_mapping(p_import_id uuid,p_mapping_id uuid)
returns integer language plpgsql volatile security definer set search_path = '' as $$
declare v_mapping public.instrument_field_mappings; v_import public.instrument_imports; v_count integer;
begin
  if auth.role() <> 'service_role' then raise exception 'service role required'; end if;
  select * into v_import from public.instrument_imports where id=p_import_id;
  select * into v_mapping from public.instrument_field_mappings where id=p_mapping_id;
  if v_import.id is null or v_mapping.id is null then raise exception 'import or mapping unavailable'; end if;
  if (v_import.provider,v_import.device_type,v_import.device_model,v_import.firmware) is distinct from
     (v_mapping.provider,v_mapping.device_type,v_mapping.device_model,v_mapping.firmware)
    then raise exception 'provider identity mismatch'; end if;
  if not exists (select 1 from public.instrument_consent_records c
    where c.id=v_import.consent_id and c.revoked_at is null) then raise exception 'consent inactive'; end if;
  if not exists (select 1 from public.measurement_validation_decisions vd
    where vd.definition_id=v_mapping.definition_id and vd.status in ('validated_internal','validated_external')
      and vd.id=(select latest.id from public.measurement_validation_decisions latest
        where latest.definition_id=v_mapping.definition_id
        order by latest.decided_at desc,latest.id desc limit 1))
    then raise exception 'mapping definition is not currently validated'; end if;
  insert into public.instrument_normalizations(reading_id,mapping_id,normalized_value)
    select r.id,v_mapping.id,(r.original_value::numeric*v_mapping.scale+v_mapping.offset_value)
    from public.instrument_readings r where r.import_id=p_import_id
      and r.source_field=v_mapping.source_field and r.original_unit=v_mapping.source_unit
      and r.provider_definition_version=v_mapping.provider_definition_version
      and r.original_value ~ '^[-+]?(?:[0-9]+(?:\.[0-9]*)?|\.[0-9]+)$'
    on conflict(reading_id,mapping_id) do nothing;
  get diagnostics v_count = row_count;
  return v_count;
end; $$;

-- A manually selected active attempt is the only Phase 7 link path.
create or replace function public.link_instrument_record(p_import_id uuid,p_record_key text,
  p_attempt_id uuid,p_reason text)
returns uuid language plpgsql volatile security definer set search_path = '' as $$
declare v_import public.instrument_imports; v_id uuid; v_player uuid; v_session uuid;
begin
  select * into v_import from public.instrument_imports where id=p_import_id;
  if not found or not public.performance_lab_allowed(v_import.player_id)
    then raise exception 'not allowed'; end if;
  if not exists(select 1 from public.instrument_consent_records c
    where c.id=v_import.consent_id and c.revoked_at is null) then raise exception 'consent inactive'; end if;
  if not exists(select 1 from public.instrument_readings r
    where r.import_id=p_import_id and r.record_key=p_record_key) then raise exception 'record unavailable'; end if;
  if p_attempt_id is not null then
    select g.player_id,r.practice_session_id into v_player,v_session
      from public.active_legacy_swing_attempts a
      join public.video_clips c on c.id=a.video_clip_id
      join public.game_log_entries g on g.id=c.game_log_entry_id
      left join public.practice_repetitions r on r.id=c.practice_repetition_id
      where a.id=p_attempt_id;
    if v_player is distinct from v_import.player_id or
      (v_import.practice_session_id is not null and v_session is distinct from v_import.practice_session_id)
      then raise exception 'attempt does not match import player/session'; end if;
  end if;
  insert into public.instrument_link_events(import_id,record_key,action,attempt_id,actor_id,reason)
    values(p_import_id,p_record_key,case when p_attempt_id is null then 'unlink' else 'link' end,
      p_attempt_id,auth.uid(),p_reason) returning id into v_id;
  return v_id;
end; $$;

create or replace function public.list_performance_attempts(p_player_id uuid)
returns jsonb language plpgsql stable security definer set search_path = '' as $$
begin
  if not public.performance_lab_allowed(p_player_id) then raise exception 'not allowed'; end if;
  return coalesce((select jsonb_agg(jsonb_build_object('attemptId',x.attempt_id,
    'date',x.source_date,'series',x.series,'clipId',x.clip_id) order by x.source_date desc,x.attempt_id)
    from (select a.id as attempt_id,g.date as source_date,g.session_type as series,c.id as clip_id
      from public.active_legacy_swing_attempts a join public.video_clips c on c.id=a.video_clip_id
      join public.game_log_entries g on g.id=c.game_log_entry_id
      where g.player_id=p_player_id order by g.date desc,a.id limit 100) x),'[]'::jsonb);
end; $$;

create or replace function public.get_performance_analysis(p_player_id uuid)
returns jsonb language plpgsql stable security definer set search_path = '' as $$
declare v_total integer; v_result jsonb;
begin
  if not public.performance_lab_allowed(p_player_id) then raise exception 'not allowed'; end if;
  select count(*) into v_total from public.instrument_readings r
    join public.instrument_imports i on i.id=r.import_id
    join public.instrument_consent_records c on c.id=i.consent_id and c.revoked_at is null
    where i.player_id=p_player_id;
  select jsonb_build_object('playerId',p_player_id,'totalReadings',v_total,
    'truncated',v_total>500,
    'imports',coalesce((select jsonb_agg(jsonb_build_object('id',i.id,'provider',i.provider,
      'deviceType',i.device_type,'deviceModel',i.device_model,'firmware',i.firmware,
      'format',i.source_format,'fileSha256',i.source_file_sha256,
      'importedAt',i.imported_at,'sessionId',i.practice_session_id,
      'readingCount',i.source_record_count,'warnings',i.warnings) order by i.imported_at desc,i.id)
      from public.instrument_imports i join public.instrument_consent_records c
        on c.id=i.consent_id and c.revoked_at is null where i.player_id=p_player_id),'[]'::jsonb),
    'readings',coalesce((select jsonb_agg(jsonb_build_object('id',x.id,'importId',x.import_id,
      'recordKey',x.record_key,'deviceTimestamp',x.device_timestamp,
      'field',x.source_field,'value',x.original_value,'unit',x.original_unit,
      'providerDefinitionVersion',x.provider_definition_version,'warnings',x.warnings,
      'attemptId',x.attempt_id,'linkReason',x.link_reason,
      'normalized',x.normalized) order by x.imported_at desc,x.id)
      from (select r.*,i.imported_at,
        case when link.action='link' and a.id is not null then a.id else null end as attempt_id,
        case when link.action='link' and a.id is not null then link.reason else null end as link_reason,
        coalesce((select jsonb_agg(jsonb_build_object('mappingId',m.id,'mappingVersion',m.mapping_version,
          'definitionId',d.id,'definition',d.display_name,'definitionVersion',d.version,
          'value',n.normalized_value,'unit',d.unit,'minimumSample',d.aggregate_min_sample,
          'source','external instrument') order by m.mapping_version,m.id)
          from public.instrument_normalizations n join public.instrument_field_mappings m on m.id=n.mapping_id
          join public.measurement_definitions d on d.id=m.definition_id
          where n.reading_id=r.id and exists (select 1 from public.measurement_validation_decisions vd
            where vd.definition_id=d.id and vd.status in ('validated_internal','validated_external')
              and vd.id=(select latest.id from public.measurement_validation_decisions latest
                where latest.definition_id=d.id order by latest.decided_at desc,latest.id desc limit 1))),
          '[]'::jsonb) as normalized
        from public.instrument_readings r join public.instrument_imports i on i.id=r.import_id
        join public.instrument_consent_records cr on cr.id=i.consent_id and cr.revoked_at is null
        left join lateral (select l.* from public.instrument_link_events l
          where l.import_id=i.id and l.record_key=r.record_key
          order by l.created_at desc,l.id desc limit 1) link on true
        left join public.active_legacy_swing_attempts a on a.id=link.attempt_id
        where i.player_id=p_player_id order by i.imported_at desc,r.id limit 500) x),'[]'::jsonb))
    into v_result;
  return v_result;
end; $$;

create or replace function public.export_performance_analysis(p_player_id uuid)
returns jsonb language plpgsql volatile security definer set search_path = '' as $$
declare v_payload jsonb; v_id uuid;
begin
  if not public.performance_lab_allowed(p_player_id) then raise exception 'not allowed'; end if;
  if not exists (select 1 from public.instrument_imports i
    join public.instrument_consent_records c on c.id=i.consent_id and c.revoked_at is null
    where i.player_id=p_player_id) then raise exception 'no active consented import'; end if;
  v_payload := public.get_performance_analysis(p_player_id);
  if (v_payload->>'truncated')::boolean then raise exception 'export exceeds bounded selection'; end if;
  insert into public.performance_export_events(player_id,actor_id,payload_sha256,record_count)
    values(p_player_id,auth.uid(),encode(extensions.digest(v_payload::text,'sha256'),'hex'),
      (v_payload->>'totalReadings')::integer) returning id into v_id;
  return jsonb_build_object('auditId',v_id,'exportedAt',now(),'data',v_payload);
end; $$;

revoke all on function public.performance_lab_allowed(uuid),public.performance_analysis_available(uuid),
  public.stage_instrument_import(jsonb),public.apply_instrument_mapping(uuid,uuid),
  public.link_instrument_record(uuid,text,uuid,text),public.list_performance_attempts(uuid),
  public.get_performance_analysis(uuid),public.export_performance_analysis(uuid)
  from public,anon,authenticated;
grant execute on function public.performance_analysis_available(uuid),
  public.link_instrument_record(uuid,text,uuid,text),public.list_performance_attempts(uuid),
  public.get_performance_analysis(uuid),public.export_performance_analysis(uuid) to authenticated;
grant execute on function public.stage_instrument_import(jsonb),
  public.apply_instrument_mapping(uuid,uuid) to service_role;
