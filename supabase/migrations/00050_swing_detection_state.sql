-- Preserve the difference between a located swing, a reliably confirmed
-- no-swing at-bat, and detector uncertainty. The optional result chip is
-- deliberately absent from this state transition.
alter table public.video_clips add column swing_detection_state text
  check (swing_detection_state in ('readable', 'confirmed_no_swing', 'inconclusive'));
alter table demo.video_clips add column swing_detection_state text
  check (swing_detection_state in ('readable', 'confirmed_no_swing', 'inconclusive'));

-- Historical analysis runs prove that readable swing evidence reached the
-- validator. A ready clip without a validated run remains inconclusive; no
-- legacy row is guessed to be a take.
update public.video_clips c set swing_detection_state = case
  when c.status = 'ready' and (c.readable_game_serial is not null or exists (
    select 1 from public.analysis_runs r where r.video_clip_id = c.id and r.summary is not null
  )) then 'readable'
  when c.status = 'ready' then 'inconclusive'
  else null
end;
-- Published demo clips were already required to have located phases.
update demo.video_clips set swing_detection_state = case when status = 'ready' then 'readable' else null end;

create or replace function public.register_readable_game_swing(p_clip_id uuid)
returns integer
language plpgsql volatile security definer set search_path = '' as $$
declare
  v_player_id uuid;
  v_kind text;
  v_detection text;
  v_serial integer;
begin
  select g.player_id, g.session_type, c.swing_detection_state into v_player_id, v_kind, v_detection
    from public.video_clips c join public.game_log_entries g on g.id = c.game_log_entry_id
    where c.id = p_clip_id;
  if v_player_id is null then raise exception 'clip not found'; end if;
  if v_kind <> 'game' or v_detection <> 'readable' then return null; end if;
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

-- Keep stored, hash-verified fixtures cloneable without rewriting them. Old
-- ready demo rows already passed the fixture phase checks, so they are
-- readable; other legacy rows remain unclassified.
create or replace function demo.upgrade_fixture_payload(p_payload jsonb)
returns jsonb
language plpgsql immutable set search_path = '' as $$
declare upgraded jsonb := p_payload; rows_out jsonb; r jsonb;
begin
  if jsonb_typeof(upgraded->'tables'->'players') = 'array' then
    rows_out := '[]'::jsonb;
    for r in select value from jsonb_array_elements(upgraded->'tables'->'players') loop
      rows_out := rows_out || jsonb_build_array(r || jsonb_build_object(
        'readable_game_swing_count', coalesce((r->>'readable_game_swing_count')::integer, 0)));
    end loop;
    upgraded := jsonb_set(upgraded, '{tables,players}', rows_out);
  end if;
  if jsonb_typeof(upgraded->'tables'->'game_log_entries') = 'array' then
    rows_out := '[]'::jsonb;
    for r in select value from jsonb_array_elements(upgraded->'tables'->'game_log_entries') loop
      rows_out := rows_out || jsonb_build_array(r || jsonb_build_object(
        'result_simple', r->'result_simple', 'simple_capture_id', r->'simple_capture_id'));
    end loop;
    upgraded := jsonb_set(upgraded, '{tables,game_log_entries}', rows_out);
  end if;
  if jsonb_typeof(upgraded->'tables'->'video_clips') = 'array' then
    rows_out := '[]'::jsonb;
    for r in select value from jsonb_array_elements(upgraded->'tables'->'video_clips') loop
      if (r->>'uploaded_by') is not null then
        raise exception 'demo fixture %: video_clips row % carries an uploaded_by identity - fixtures must never include one', upgraded->>'fixtureId', r->>'id';
      end if;
      rows_out := rows_out || jsonb_build_array(r || jsonb_build_object(
        'uploaded_by_role', coalesce(r->>'uploaded_by_role', 'coach'), 'uploaded_by', null,
        'readable_game_serial', r->'readable_game_serial',
        'swing_detection_state', coalesce(r->>'swing_detection_state', case when r->>'status' = 'ready' then 'readable' else null end)));
    end loop;
    upgraded := jsonb_set(upgraded, '{tables,video_clips}', rows_out);
  end if;
  if jsonb_typeof(upgraded->'tables'->'analysis_runs') = 'array' then
    rows_out := '[]'::jsonb;
    for r in select value from jsonb_array_elements(upgraded->'tables'->'analysis_runs') loop
      rows_out := rows_out || jsonb_build_array(r || jsonb_build_object(
        'summary', r->'summary', 'strengths', coalesce(r->'strengths', '[]'::jsonb)));
    end loop;
    upgraded := jsonb_set(upgraded, '{tables,analysis_runs}', rows_out);
  end if;
  if jsonb_typeof(upgraded->'tables'->'issues') = 'array' then
    rows_out := '[]'::jsonb;
    for r in select value from jsonb_array_elements(upgraded->'tables'->'issues') loop
      rows_out := rows_out || jsonb_build_array(r || jsonb_build_object(
        'hidden_reason', r->'hidden_reason', 'hidden_by', null));
    end loop;
    upgraded := jsonb_set(upgraded, '{tables,issues}', rows_out);
  end if;
  if jsonb_typeof(upgraded->'tables'->'drill_library') = 'array' then
    rows_out := '[]'::jsonb;
    for r in select value from jsonb_array_elements(upgraded->'tables'->'drill_library') loop
      rows_out := rows_out || jsonb_build_array(r || jsonb_build_object(
        'best_for', r->'best_for', 'looks_right_when', r->'looks_right_when', 'cue', r->'cue',
        'common_mistakes', coalesce(r->'common_mistakes', '[]'::jsonb),
        'home_friendly', coalesce((r->>'home_friendly')::boolean, false),
        'sport', coalesce(r->>'sport', 'both'), 'min_age', r->'min_age', 'phase', r->'phase',
        'demo_url', r->'demo_url', 'demo_timestamp', r->'demo_timestamp', 'source_credit', r->'source_credit',
        'requires_screen', coalesce((r->>'requires_screen')::boolean, false),
        'weighted_or_overspeed', coalesce((r->>'weighted_or_overspeed')::boolean, false)));
    end loop;
    upgraded := jsonb_set(upgraded, '{tables,drill_library}', rows_out);
  end if;
  return upgraded;
end;
$$;
revoke all on function demo.upgrade_fixture_payload(jsonb) from public, anon, authenticated;
