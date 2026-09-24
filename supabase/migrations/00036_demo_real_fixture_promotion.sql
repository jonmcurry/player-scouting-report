-- Curated REAL-footage promotion into the public demo's canonical clone
-- source. See docs/research/demo-real-data-promotion.md for the full
-- workflow (local processing -> coach review -> curation manifest ->
-- `npm run export-demo-fixture` -> `npm run import-demo-fixture`).
--
-- What this migration does, and why each piece exists:
--
--   1. Additive demo.* columns so a real, pose3d-processed, coach-reviewed
--      clip can actually be represented. 00033 deliberately left
--      video_clip_metrics/video_clip_pose3d/analysis_runs as empty shells
--      ("no lab-grade metrics fabricated") - real promoted data is exactly
--      the case those shells were waiting for, so they now mirror the
--      production columns the real frontend reads (swingMetricsPanel.js
--      selects "*" from video_clip_metrics; skeletonComparison.js selects
--      "joint_names, frames, joints_blob, lead_side" from video_clip_pose3d -
--      the latter two columns did not exist in demo.*, so that query could
--      never succeed in demo mode before this migration).
--   2. demo.game_log_entries.pitch - a pre-existing compat gap 00035 missed:
--      coach/player.html's loadGameLog() selects it, so the demo player
--      page's Game Log list always fell through to its "No recent game"
--      empty state (PostgREST 400 -> data null), for the fictional seed too.
--   3. demo.demo_real_fixtures - canonical, versioned storage for promoted
--      real-data fixtures (one JSON payload per fixture, same
--      unreadable-by-clients posture as demo.demo_seed_templates). Real data
--      is loaded by the service-role import CLI, NEVER by a migration: this
--      repo is public, and a real athlete's data must not live in git.
--   4. demo.clone_real_fixture() - a generic, whitelisted, JSON-driven
--      clone: assigns fresh gen_random_uuid() ids per visitor, remaps every
--      declared FK through a per-clone id map, resolves reference data
--      (checkpoints/swing_phase_types/global drills) by slug, and fails
--      closed on anything it can't resolve. Keeps large pose arrays out of
--      hand-written SQL entirely.
--   5. demo.clone_demo_dataset() becomes a thin wrapper: the existing
--      fictional narrative (renamed, body untouched) + every active real
--      fixture. start_demo_session()/reset_demo_session() call it by name
--      and need no change.
--   6. Hardening: the pre-existing demo.clone_demo_dataset(uuid) inherited
--      Postgres's default EXECUTE-to-PUBLIC grant, so any authenticated
--      (including anonymous demo) caller could invoke this SECURITY DEFINER
--      function directly via PostgREST and mint unlimited orphan teams.
--      Every clone/load function here revokes PUBLIC explicitly.
--
-- Nothing here touches public.*, adds an FK into public.*, or loosens any
-- RLS policy/grant: every new column sits on a table whose existing
-- owner-scoped policy already covers it, and demo.demo_real_fixtures has RLS
-- enabled with zero policies and zero client grants.

-- ---------------------------------------------------------------------
-- 1/2. Additive column parity for real analysis data
-- ---------------------------------------------------------------------
alter table demo.game_log_entries add column pitch text;

-- demo_media_path: the PUBLIC filename of a curated, transcoded demo clip
-- (never a local path or bucket key - constrained to a bare safe
-- filename). demo_media_offset_s: seconds to add to an analysis time_s
-- (swing_phases/pose3d, which are relative to the pipeline's analysis
-- window) to land on the same moment in the trimmed demo media file; null
-- when that alignment is unknown.
alter table demo.video_clips
  add column demo_media_path text,
  add column demo_media_offset_s double precision,
  add constraint demo_video_clips_media_path_safe
    check (demo_media_path is null or demo_media_path ~ '^[a-z0-9][a-z0-9._-]{0,120}\.mp4$');

alter table demo.video_clip_metrics
  add column max_bat_speed_value double precision,
  add column max_bat_speed_unit text,
  add column max_bat_speed_search_window_s double precision,
  add column max_bat_speed_frame integer,
  add column max_bat_speed_full_rate_value double precision,
  add column max_bat_speed_full_rate_source_fps double precision,
  add column attack_angle_at_contact_deg double precision,
  add column hip_shoulder_separation_at_contact_deg double precision,
  add column torso_tilt_at_contact_deg double precision,
  add column pelvis_tilt_at_contact_deg double precision,
  add column lead_side text,
  add column lead_side_method text,
  add column lead_elbow_angle_at_contact_deg double precision,
  add column front_knee_angle_at_contact_deg double precision,
  add column l_elbow_angle_at_contact_deg double precision,
  add column r_elbow_angle_at_contact_deg double precision,
  add column stride_length_hip_widths double precision,
  add column stride_direction_deg double precision,
  add column stride_note text,
  add column created_at timestamptz not null default now();
-- Production's analysis_quality is jsonb (a structured quality object the
-- frontend's analysisQualityLabels() reads); 00033 guessed text. The table
-- has never held a row (00033/00034 never seed it), so this is a pure type
-- correction with nothing to convert in practice.
alter table demo.video_clip_metrics
  alter column analysis_quality type jsonb using (case when analysis_quality is null then null else to_jsonb(analysis_quality) end);

alter table demo.video_clip_pose3d
  add column lead_side text check (lead_side in ('l', 'r')),
  add column joints_blob bytea;

-- Provenance parity for analysis_runs (production: 00028). Nullable here
-- (production has NOT NULL on several) only because pre-existing demo rows
-- could never have carried them; the exporter fails closed if a promoted
-- run is missing any production-required provenance field.
alter table demo.analysis_runs
  add column ai_model text,
  add column ai_model_version text,
  add column prompt_version text,
  add column analysis_policy_version text,
  add column knowledge_version text,
  add column pipeline_version text,
  add column input_manifest jsonb not null default '{}';

alter table demo.issues
  add column analysis_run_id uuid references demo.analysis_runs (id) on delete set null,
  add column finding_key text,
  add column concept text check (concept in (
    'stance_setup', 'load', 'stride_plant', 'hip_shoulder_sequencing', 'hand_path', 'barrel_path', 'contact',
    'extension', 'head_visual_stability', 'finish_balance', 'swing_decision', 'timing', 'front_side_stability',
    'posture', 'barrel_depth', 'pitch_location_adjustment', 'game_approach')),
  add column basis text check (basis in ('video', 'metric', 'reconstruction')),
  -- The AI's original draft, kept when a coach EDITED a finding - review.html
  -- renders it under "See original draft" for review_status='edited'.
  add column ai_original jsonb;

alter table demo.checklist_scores
  add column analysis_run_id uuid references demo.analysis_runs (id) on delete set null;

-- Production allows 'claude' (00024_claude_draft_source.sql); demo never
-- carried that over, so a real claude-sourced reviewed finding could not be
-- promoted without silently rewriting its provenance.
alter table demo.issues drop constraint issues_source_check;
alter table demo.issues add constraint issues_source_check check (source in ('gemini', 'pose3d', 'claude'));
alter table demo.checklist_scores drop constraint checklist_scores_source_check;
alter table demo.checklist_scores add constraint checklist_scores_source_check check (source in ('gemini', 'pose3d', 'claude'));

-- ---------------------------------------------------------------------
-- 3. Canonical real-data fixture storage
-- ---------------------------------------------------------------------
create table demo.demo_real_fixtures (
  fixture_id text primary key check (fixture_id ~ '^[a-z0-9][a-z0-9-]{1,62}$'),
  fixture_version text not null,
  content_sha256 text not null check (content_sha256 ~ '^[0-9a-f]{64}$'),
  payload jsonb not null,
  active boolean not null default true,
  loaded_at timestamptz not null default now()
);
alter table demo.demo_real_fixtures enable row level security;
revoke all on demo.demo_real_fixtures from authenticated, anon, public;
comment on table demo.demo_real_fixtures is
  'Curated real-footage demo fixtures (exporter output), cloned into every visitor''s demo team by demo.clone_demo_dataset(). No client grants/policies. Loaded only via demo.load_real_fixture() (service role).';

-- ---------------------------------------------------------------------
-- 4. Generic JSON-driven fixture clone
-- ---------------------------------------------------------------------
-- Payload contract (produced by src/services/demoExport/, formatVersion 1):
--   {
--     "format": "hitterloop-demo-fixture", "formatVersion": 1,
--     "fixtureId": "...", "teamPlaceholderId": "<uuid>",
--     "tables": { "<table>": [ {<every target column>, "_refs": {...}?}, ... ] }
--   }
-- Every row carries every target column explicitly (jsonb_populate_record
-- would otherwise turn an omitted NOT NULL-with-default column into NULL).
-- "_refs" maps a column to reference data by slug:
--   {"checkpoint_id": {"table": "checkpoints", "slug": "load"}}
create or replace function demo.clone_real_fixture(p_team_id uuid, p_payload jsonb)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  -- Insert order (FK dependency order). practice_sessions.focus_priority_id
  -- is the one cyclic edge (practice_sessions -> player_priorities ->
  -- issues -> video_clips -> practice_repetitions -> practice_sessions): it
  -- is inserted null and patched after everything else exists.
  table_order text[] := array[
    'players', 'drill_library', 'game_log_entries', 'at_bat_pitches', 'practice_sessions',
    'practice_repetitions', 'video_clips', 'video_clip_metrics', 'video_clip_pose3d', 'swing_phases',
    'analysis_runs', 'checklist_scores', 'checklist_score_history', 'issues', 'player_priorities',
    'player_priority_status_history', 'player_priority_drills', 'player_priority_observations',
    'player_share_links'];
  -- Declared FK columns per table, all remapped through the per-clone id
  -- map. Anything not listed here is copied verbatim (the exporter's
  -- validator guarantees no other column carries a source-side uuid).
  fk jsonb := '{
    "players": ["team_id"],
    "drill_library": ["team_id"],
    "game_log_entries": ["player_id"],
    "at_bat_pitches": ["game_log_entry_id"],
    "practice_sessions": ["player_id", "assigned_drill_id"],
    "practice_repetitions": ["practice_session_id", "game_log_entry_id"],
    "video_clips": ["game_log_entry_id", "at_bat_pitch_id", "practice_repetition_id"],
    "video_clip_metrics": ["video_clip_id"],
    "video_clip_pose3d": ["video_clip_id"],
    "swing_phases": ["video_clip_id"],
    "analysis_runs": ["video_clip_id", "player_id"],
    "checklist_scores": ["player_id", "analysis_run_id"],
    "checklist_score_history": ["checklist_score_id"],
    "issues": ["player_id", "video_clip_id", "analysis_run_id"],
    "player_priorities": ["player_id", "team_id", "source_issue_id"],
    "player_priority_status_history": ["player_priority_id"],
    "player_priority_drills": ["player_priority_id", "drill_id"],
    "player_priority_observations": ["player_priority_id", "video_clip_id", "practice_repetition_id", "at_bat_pitch_id", "practice_session_id"],
    "player_share_links": ["player_id"]
  }'::jsonb;
  ref_tables text[] := array['checkpoints', 'swing_phase_types', 'drill_library'];
  idmap jsonb := '{}'::jsonb;
  counts jsonb := '{}'::jsonb;
  t text;
  r jsonb;
  new_row jsonb;
  c text;
  ref_key text;
  ref jsonb;
  ref_id uuid;
  n integer;
  priority_ids uuid[] := '{}';
  target_cols text[];
  row_cols text[];
begin
  if p_payload->>'format' is distinct from 'hitterloop-demo-fixture' or (p_payload->>'formatVersion') is distinct from '1' then
    raise exception 'demo.clone_real_fixture: unsupported fixture format %/%', p_payload->>'format', p_payload->>'formatVersion';
  end if;
  if coalesce(p_payload->>'teamPlaceholderId', '') = '' then
    raise exception 'demo.clone_real_fixture: fixture % has no teamPlaceholderId', p_payload->>'fixtureId';
  end if;
  for t in select jsonb_object_keys(p_payload->'tables') loop
    if not (t = any(table_order)) then
      raise exception 'demo.clone_real_fixture: table "%" is not allowed in a real-data fixture', t;
    end if;
  end loop;

  -- Pass 1: fresh ids for every fixture row (+ the team placeholder).
  idmap := jsonb_build_object(p_payload->>'teamPlaceholderId', p_team_id);
  foreach t in array table_order loop
    for r in select value from jsonb_array_elements(coalesce(p_payload->'tables'->t, '[]'::jsonb)) loop
      if coalesce(r->>'id', '') = '' then
        raise exception 'demo.clone_real_fixture: a % row has no id', t;
      end if;
      if idmap ? (r->>'id') then
        raise exception 'demo.clone_real_fixture: duplicate fixture id % (table %)', r->>'id', t;
      end if;
      idmap := idmap || jsonb_build_object(r->>'id', gen_random_uuid());
    end loop;
  end loop;

  -- Pass 2: insert in dependency order.
  foreach t in array table_order loop
    n := 0;
    -- Exact column-set match: jsonb_populate_record() silently ignores
    -- unknown keys and NULLs missing ones, which would turn any exporter/
    -- schema drift into silent data loss. Fail closed instead.
    select array_agg(a.attname::text order by a.attname) into target_cols
    from pg_catalog.pg_attribute a
    where a.attrelid = format('demo.%I', t)::regclass and a.attnum > 0 and not a.attisdropped;
    for r in select value from jsonb_array_elements(coalesce(p_payload->'tables'->t, '[]'::jsonb)) loop
      select array_agg(k order by k) into row_cols from jsonb_object_keys(r - '_refs') as k;
      if row_cols is distinct from target_cols then
        raise exception 'demo.clone_real_fixture: % row % columns do not match demo.% (row: %, table: %)',
          t, r->>'id', t, row_cols, target_cols;
      end if;
      new_row := (r - '_refs') || jsonb_build_object('id', idmap->(r->>'id'));

      for c in select jsonb_array_elements_text(fk->t) loop
        if (r->>c) is not null then
          if not (idmap ? (r->>c)) then
            raise exception 'demo.clone_real_fixture: %.% = % does not resolve to a row in this fixture', t, c, r->>c;
          end if;
          new_row := new_row || jsonb_build_object(c, idmap->(r->>c));
        end if;
      end loop;

      for ref_key, ref in select key, value from jsonb_each(coalesce(r->'_refs', '{}'::jsonb)) loop
        if not ((ref->>'table') = any(ref_tables)) then
          raise exception 'demo.clone_real_fixture: reference table "%" is not allowed', ref->>'table';
        end if;
        if ref->>'table' = 'checkpoints' then
          select id into ref_id from demo.checkpoints where slug = ref->>'slug';
        elsif ref->>'table' = 'swing_phase_types' then
          select id into ref_id from demo.swing_phase_types where slug = ref->>'slug';
        else
          select id into ref_id from demo.drill_library where demo.drill_library.team_id is null and slug = ref->>'slug';
        end if;
        if ref_id is null then
          raise exception 'demo.clone_real_fixture: %.% references unknown % slug "%"', t, ref_key, ref->>'table', ref->>'slug';
        end if;
        new_row := new_row || jsonb_build_object(ref_key, ref_id);
      end loop;

      if t = 'practice_sessions' then
        new_row := new_row || '{"focus_priority_id": null}'::jsonb;
      elsif t = 'player_share_links' then
        -- Never a source-side token: a fresh, unguessable one per visitor.
        new_row := new_row || jsonb_build_object(
          'token', replace(gen_random_uuid()::text, '-', '') || replace(gen_random_uuid()::text, '-', ''),
          'created_at', now(), 'expires_at', now() + interval '90 days', 'revoked_at', null);
      end if;

      execute format('insert into demo.%I select * from jsonb_populate_record(null::demo.%I, $1)', t, t) using new_row;
      n := n + 1;
      if t = 'player_priorities' then
        priority_ids := priority_ids || (new_row->>'id')::uuid;
      end if;
    end loop;

    -- demo.log_priority_status() auto-writes an INSERT history row per
    -- priority; the fixture carries the real, exported history instead.
    if t = 'player_priorities' and cardinality(priority_ids) > 0 then
      delete from demo.player_priority_status_history where player_priority_id = any(priority_ids);
    end if;
    counts := counts || jsonb_build_object(t, n);
  end loop;

  -- Patch the deferred cyclic FK.
  for r in select value from jsonb_array_elements(coalesce(p_payload->'tables'->'practice_sessions', '[]'::jsonb)) loop
    if (r->>'focus_priority_id') is not null then
      if not (idmap ? (r->>'focus_priority_id')) then
        raise exception 'demo.clone_real_fixture: practice_sessions.focus_priority_id = % does not resolve', r->>'focus_priority_id';
      end if;
      update demo.practice_sessions set focus_priority_id = (idmap->>(r->>'focus_priority_id'))::uuid
      where id = (idmap->>(r->>'id'))::uuid;
    end if;
  end loop;

  -- demo.stamp_priority_followup() re-stamps follow_up_set_at=now() and
  -- clears follow_up_done_at on INSERT; restore the exported values (an
  -- UPDATE that doesn't change follow_up_kind/date/swings passes through
  -- that trigger untouched).
  for r in select value from jsonb_array_elements(coalesce(p_payload->'tables'->'player_priorities', '[]'::jsonb)) loop
    update demo.player_priorities
    set follow_up_set_at = (r->>'follow_up_set_at')::timestamptz,
        follow_up_done_at = (r->>'follow_up_done_at')::timestamptz
    where id = (idmap->>(r->>'id'))::uuid;
  end loop;

  return counts;
end;
$$;
revoke all on function demo.clone_real_fixture(uuid, jsonb) from public, anon, authenticated;

-- ---------------------------------------------------------------------
-- 5. clone_demo_dataset = fictional narrative + every active real fixture
-- ---------------------------------------------------------------------
alter function demo.clone_demo_dataset(uuid) rename to clone_fictional_dataset;
revoke all on function demo.clone_fictional_dataset(uuid) from public, anon, authenticated;

create or replace function demo.clone_demo_dataset(p_user_id uuid)
returns table (team_id uuid, team_slug text, seed_version text)
language plpgsql
security definer
set search_path = ''
as $$
declare
  base record;
  fx record;
  version_label text;
begin
  select * into base from demo.clone_fictional_dataset(p_user_id);
  version_label := base.seed_version;
  for fx in select * from demo.demo_real_fixtures where active order by fixture_id loop
    perform demo.clone_real_fixture(base.team_id, fx.payload);
    version_label := version_label || '+' || fx.fixture_id || '@' || fx.fixture_version;
  end loop;
  return query select base.team_id, base.team_slug, version_label;
end;
$$;
revoke all on function demo.clone_demo_dataset(uuid) from public, anon, authenticated;
comment on function demo.clone_demo_dataset(uuid) is
  'Internal (no client grant). Fictional Phase 4 narrative (demo.clone_fictional_dataset) plus every active demo.demo_real_fixtures payload, cloned into one fresh team. seed_version records every fixture@version included.';

-- ---------------------------------------------------------------------
-- Load/verify (service role only). Verification runs the REAL clone path -
-- fictional seed + every other active fixture + the candidate - inside a
-- savepoint that is always rolled back, so "canonical clone compatibility"
-- is proven by the database itself (constraints, triggers, unique slugs,
-- reference resolution), not re-implemented in TypeScript.
-- ---------------------------------------------------------------------
create or replace function demo.verify_real_fixture(p_payload jsonb)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  base record;
  fx record;
  counts jsonb;
begin
  begin
    select * into base from demo.clone_fictional_dataset(null);
    for fx in select * from demo.demo_real_fixtures
              where active and fixture_id <> coalesce(p_payload->>'fixtureId', '') order by fixture_id loop
      perform demo.clone_real_fixture(base.team_id, fx.payload);
    end loop;
    counts := demo.clone_real_fixture(base.team_id, p_payload);
    raise exception using errcode = 'HLV01', message = counts::text;
  exception when sqlstate 'HLV01' then
    return jsonb_build_object('ok', true, 'counts', sqlerrm::jsonb);
  end;
end;
$$;
revoke all on function demo.verify_real_fixture(jsonb) from public, anon, authenticated;
grant execute on function demo.verify_real_fixture(jsonb) to service_role;

create or replace function demo.load_real_fixture(p_payload jsonb, p_content_sha256 text, p_activate boolean default true)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  verified jsonb;
begin
  if coalesce(p_payload->>'fixtureId', '') = '' or coalesce(p_payload->>'fixtureVersion', '') = '' then
    raise exception 'demo.load_real_fixture: payload needs fixtureId and fixtureVersion';
  end if;
  verified := demo.verify_real_fixture(p_payload);
  insert into demo.demo_real_fixtures (fixture_id, fixture_version, content_sha256, payload, active, loaded_at)
  values (p_payload->>'fixtureId', p_payload->>'fixtureVersion', p_content_sha256, p_payload, p_activate, now())
  on conflict (fixture_id) do update set
    fixture_version = excluded.fixture_version,
    content_sha256 = excluded.content_sha256,
    payload = excluded.payload,
    active = excluded.active,
    loaded_at = excluded.loaded_at;
  return verified || jsonb_build_object('fixtureId', p_payload->>'fixtureId', 'active', p_activate);
end;
$$;
revoke all on function demo.load_real_fixture(jsonb, text, boolean) from public, anon, authenticated;
grant execute on function demo.load_real_fixture(jsonb, text, boolean) to service_role;

create or replace function demo.set_real_fixture_active(p_fixture_id text, p_active boolean)
returns void
language sql
security definer
set search_path = ''
as $$
  update demo.demo_real_fixtures set active = p_active where fixture_id = p_fixture_id;
$$;
revoke all on function demo.set_real_fixture_active(text, boolean) from public, anon, authenticated;
grant execute on function demo.set_real_fixture_active(text, boolean) to service_role;
