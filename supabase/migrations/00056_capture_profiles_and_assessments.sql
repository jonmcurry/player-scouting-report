-- Analysis depth Phase 2. Additive, private capture evidence. The demo schema
-- is deliberately excluded: its frozen clips do not carry raw capture facts.
-- No profile is a camera calibration, measurement validation, or report gate.

create table public.capture_profiles (
  slug text not null check (slug ~ '^[a-z][a-z0-9_]*$'),
  version text not null check (version ~ '^[0-9]+\.[0-9]+\.[0-9]+$'),
  label text not null check (btrim(label) <> ''),
  status text not null check (status in ('enabled','disabled','retired')),
  sports text[] not null check (sports <@ array['softball','baseball']::text[] and cardinality(sports) > 0),
  requirements text[] not null,
  limitations text[] not null,
  safety_note text,
  created_at timestamptz not null default now(),
  primary key (slug, version)
);
insert into public.capture_profiles(slug, version, label, status, sports, requirements, limitations, safety_note) values
  ('game_backstop','1.0.0','Game / backstop','enabled',array['softball','baseball'],
   array['Whole hitter, plate area, and full bat arc','Stable view from before the pitch through the finish'],
   array['Fence, catcher, umpire, and lower-body occlusion can limit detail','No physical-unit measurement without separate calibration'],null),
  ('open_side_practice','1.0.0','Open-side practice','enabled',array['softball','baseball'],
   array['Full body and bat','Fixed phone approximately side-on to the plate'],
   array['Do not numerically compare with backstop footage by default'],null),
  ('unknown_imported','1.0.0','Unknown / imported','enabled',array['softball','baseball'],
   array['Keep the hitter and bat visible'],array['Camera setup is unconfirmed'],null),
  ('catcher_view_practice','1.0.0','Catcher view practice','disabled',array['softball','baseball'],
   array['Protected camera position and full bat arc'],array['Not enabled until safety and validation review'],
   'Only film from a protected position. Never place a person or unsecured phone behind the plate in a live, unprotected path.');

-- An initial declaration is optional. Coach corrections append; neither
-- changes the original selection or retroactively edits an assessment.
create table public.clip_capture_declarations (
  id uuid primary key default gen_random_uuid(),
  video_clip_id uuid not null references public.video_clips(id) on delete cascade,
  profile_slug text not null,
  profile_version text not null,
  kind text not null check (kind in ('declared','coach_correction')),
  actor_id uuid not null,
  created_at timestamptz not null default now(),
  foreign key (profile_slug, profile_version) references public.capture_profiles(slug, version)
);
create unique index clip_capture_one_declaration on public.clip_capture_declarations(video_clip_id) where kind = 'declared';
create index clip_capture_declarations_latest on public.clip_capture_declarations(video_clip_id, created_at desc, id desc);

create table public.clip_capture_assessments (
  id uuid primary key default gen_random_uuid(),
  video_clip_id uuid not null references public.video_clips(id) on delete cascade,
  assessment_version text not null check (btrim(assessment_version) <> ''),
  stage text not null check (stage in ('media','full')),
  source_sha256 text not null check (source_sha256 ~ '^[a-f0-9]{64}$'),
  declared_profile_slug text,
  declared_profile_version text,
  inferred_profile_slug text not null default 'unknown_imported',
  inferred_profile_version text not null default '1.0.0',
  inference_status text not null default 'unavailable' check (inference_status in ('supported','unavailable')),
  frame_width integer check (frame_width is null or frame_width > 0),
  frame_height integer check (frame_height is null or frame_height > 0),
  rotation_degrees integer check (rotation_degrees is null or rotation_degrees in (0,90,180,270)),
  orientation text check (orientation in ('landscape','portrait','square','unknown')),
  reported_fps numeric check (reported_fps is null or reported_fps > 0),
  actual_fps numeric check (actual_fps is null or actual_fps > 0),
  duration_s numeric check (duration_s is null or duration_s > 0),
  camera_motion text not null check (camera_motion in ('possible_issue','unavailable')),
  blur text not null check (blur in ('possible_issue','unavailable')),
  exposure text not null check (exposure in ('possible_dark','possible_bright','unavailable')),
  athlete_ambiguity text not null check (athlete_ambiguity in ('possible_issue','unavailable')),
  obstructions jsonb not null check (jsonb_typeof(obstructions) = 'object'),
  phase_visibility jsonb not null check (jsonb_typeof(phase_visibility) = 'object'),
  profile_plausibility text not null check (profile_plausibility in ('supported','questionable','unavailable')),
  setup_fingerprint text check (setup_fingerprint is null or setup_fingerprint ~ '^[a-f0-9]{64}$'),
  recommendations text[] not null default '{}'
    check (recommendations <@ array['whole_hitter','bat_arc','brighter_light','avoid_backlight','stable_focus']::text[]),
  created_at timestamptz not null default now(),
  unique (video_clip_id, assessment_version, stage),
  foreign key (declared_profile_slug, declared_profile_version)
    references public.capture_profiles(slug, version),
  foreign key (inferred_profile_slug, inferred_profile_version)
    references public.capture_profiles(slug, version),
  check ((declared_profile_slug is null) = (declared_profile_version is null)),
  check (cardinality(recommendations) <= 2)
);

create or replace function public.record_clip_capture_profile(p_clip_id uuid, p_profile_slug text, p_kind text default 'declared')
returns uuid language plpgsql volatile security definer set search_path = '' as $$
declare v_clip public.video_clips; v_player_id uuid; v_team_id uuid; v_version text; v_existing public.clip_capture_declarations; v_id uuid;
begin
  if auth.uid() is null or coalesce((auth.jwt()->>'is_anonymous')::boolean, false) then raise exception 'not allowed'; end if;
  select * into v_clip from public.video_clips where id = p_clip_id for update;
  if not found then raise exception 'clip not found'; end if;
  if exists (select 1 from public.clip_deletions where clip_id = p_clip_id) then raise exception 'not allowed'; end if;
  select g.player_id, p.team_id into v_player_id, v_team_id from public.game_log_entries g
    join public.players p on p.id = g.player_id where g.id = v_clip.game_log_entry_id;
  if p_kind not in ('declared','coach_correction') then raise exception 'invalid capture declaration'; end if;
  if p_kind = 'coach_correction' and not public.is_coach_for_team(v_team_id) then raise exception 'not allowed'; end if;
  if p_kind = 'declared' and not (public.is_coach_for_team(v_team_id)
    or public.is_guardian_for_player(v_player_id) and v_clip.uploaded_by = auth.uid()) then raise exception 'not allowed'; end if;
  select version into v_version from public.capture_profiles
    where slug = p_profile_slug and status = 'enabled' order by string_to_array(version,'.')::int[] desc limit 1;
  if v_version is null then raise exception 'capture profile unavailable'; end if;
  if p_kind = 'declared' then
    select * into v_existing from public.clip_capture_declarations
      where video_clip_id = p_clip_id and kind = 'declared';
    if found then
      if v_existing.profile_slug = p_profile_slug and v_existing.profile_version = v_version
        and v_existing.actor_id = auth.uid() then return v_existing.id; end if;
      raise exception 'capture profile already declared';
    end if;
  end if;
  insert into public.clip_capture_declarations(video_clip_id, profile_slug, profile_version, kind, actor_id)
    values (p_clip_id, p_profile_slug, v_version, p_kind, auth.uid()) returning id into v_id;
  return v_id;
end;
$$;

-- Small player-scoped read. An ordinary share token and methodology-admin
-- status confer no access. Raw source hash, versions, paths and diagnostics
-- never enter the response.
create or replace function public.get_clip_capture_summary(p_clip_id uuid)
returns jsonb language plpgsql stable security definer set search_path = '' as $$
declare v_player_id uuid; v_team_id uuid; v_assessment public.clip_capture_assessments;
  v_profile text; v_latest_slug text; v_latest_version text;
begin
  if auth.uid() is null or coalesce((auth.jwt()->>'is_anonymous')::boolean, false) then raise exception 'not allowed'; end if;
  select g.player_id, p.team_id into v_player_id, v_team_id from public.video_clips c
    join public.game_log_entries g on g.id = c.game_log_entry_id
    join public.players p on p.id = g.player_id where c.id = p_clip_id;
  if v_player_id is null or not (public.is_coach_for_team(v_team_id)
    or public.is_guardian_for_player(v_player_id)) then raise exception 'not allowed'; end if;
  if exists (select 1 from public.clip_deletions where clip_id = p_clip_id) then raise exception 'not allowed'; end if;
  select * into v_assessment from public.clip_capture_assessments where video_clip_id = p_clip_id
    order by case stage when 'full' then 0 else 1 end, created_at desc limit 1;
  if not found then return jsonb_build_object('state','pending'); end if;
  select profile_slug, profile_version into v_latest_slug, v_latest_version
    from public.clip_capture_declarations where video_clip_id = p_clip_id
    order by created_at desc, id desc limit 1;
  select label into v_profile from public.capture_profiles
    where slug = coalesce(v_latest_slug, v_assessment.declared_profile_slug, v_assessment.inferred_profile_slug)
      and version = coalesce(v_latest_version, v_assessment.declared_profile_version, v_assessment.inferred_profile_version);
  return jsonb_build_object('state', case
      when v_latest_slug is distinct from v_assessment.declared_profile_slug
        or v_latest_version is distinct from v_assessment.declared_profile_version then 'needs_recheck'
      when v_assessment.stage = 'full' then 'checked' else 'partial' end,
    'profile', coalesce(v_profile, 'Camera view unknown'),
    'recommendations', to_jsonb(v_assessment.recommendations),
    'bodyVisibility', coalesce(v_assessment.phase_visibility->'contact'->>'body','unavailable'),
    'batVisibility', coalesce(v_assessment.phase_visibility->'contact'->>'bat','unavailable'));
end;
$$;

create or replace function public.reject_capture_record_update()
returns trigger language plpgsql set search_path = '' as $$
begin raise exception 'capture definitions and assessments are append only'; end;
$$;
create trigger capture_profiles_no_update before update on public.capture_profiles for each row execute function public.reject_capture_record_update();
create trigger clip_capture_declarations_no_update before update on public.clip_capture_declarations for each row execute function public.reject_capture_record_update();
create trigger clip_capture_assessments_no_update before update on public.clip_capture_assessments for each row execute function public.reject_capture_record_update();

alter table public.capture_profiles enable row level security;
alter table public.clip_capture_declarations enable row level security;
alter table public.clip_capture_assessments enable row level security;
revoke all on public.capture_profiles, public.clip_capture_declarations, public.clip_capture_assessments from public, anon, authenticated;
grant all on public.capture_profiles, public.clip_capture_declarations, public.clip_capture_assessments to service_role;
revoke all on function public.record_clip_capture_profile(uuid,text,text), public.get_clip_capture_summary(uuid) from public, anon;
grant execute on function public.record_clip_capture_profile(uuid,text,text), public.get_clip_capture_summary(uuid) to authenticated;
