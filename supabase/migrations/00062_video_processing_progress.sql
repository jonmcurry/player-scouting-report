-- A real, monotonic stage-completion value for browser-uploaded clips.
-- This is not an elapsed-time estimate: the worker advances it only after
-- concrete pipeline milestones complete, so the UI never invents progress.
alter table public.video_clips
  add column processing_progress smallint not null default 0
    constraint video_clips_processing_progress_check check (processing_progress between 0 and 100);

alter table demo.video_clips
  add column processing_progress smallint not null default 0
    constraint demo_video_clips_processing_progress_check check (processing_progress between 0 and 100);

update public.video_clips set processing_progress = 100 where status = 'ready';
update public.video_clips set processing_progress = 5 where status = 'processing';
update demo.video_clips set processing_progress = 100 where status = 'ready';
update demo.video_clips set processing_progress = 5 where status = 'processing';

comment on column public.video_clips.processing_progress is
  'Completed worker milestone percentage (0-100), not an estimated time remaining.';
comment on column demo.video_clips.processing_progress is
  'Fixture-compatible completed worker milestone percentage; published clips are complete (100).';

-- Stored fixtures predate this column. Add the truthful terminal value in
-- memory so their signed payloads remain untouched and cloneable.
create or replace function demo.upgrade_fixture_payload(p_payload jsonb)
returns jsonb
language plpgsql
immutable
set search_path = ''
as $$
declare
  upgraded jsonb := p_payload;
  rows_out jsonb;
  r jsonb;
begin
  if jsonb_typeof(upgraded->'tables'->'players') = 'array' then
    rows_out := '[]'::jsonb;
    for r in select value from jsonb_array_elements(upgraded->'tables'->'players') loop
      rows_out := rows_out || jsonb_build_array(r || jsonb_build_object(
        'readable_game_swing_count', coalesce((r->>'readable_game_swing_count')::integer, 0)
      ));
    end loop;
    upgraded := jsonb_set(upgraded, '{tables,players}', rows_out);
  end if;

  if jsonb_typeof(upgraded->'tables'->'game_log_entries') = 'array' then
    rows_out := '[]'::jsonb;
    for r in select value from jsonb_array_elements(upgraded->'tables'->'game_log_entries') loop
      rows_out := rows_out || jsonb_build_array(r || jsonb_build_object(
        'result_simple', r->'result_simple', 'simple_capture_id', r->'simple_capture_id'
      ));
    end loop;
    upgraded := jsonb_set(upgraded, '{tables,game_log_entries}', rows_out);
  end if;

  if jsonb_typeof(upgraded->'tables'->'video_clips') = 'array' then
    rows_out := '[]'::jsonb;
    for r in select value from jsonb_array_elements(upgraded->'tables'->'video_clips') loop
      if (r->>'uploaded_by') is not null then
        raise exception 'demo fixture %: video_clips row % carries an uploaded_by identity - fixtures must never include one',
          upgraded->>'fixtureId', r->>'id';
      end if;
      rows_out := rows_out || jsonb_build_array(r || jsonb_build_object(
        'uploaded_by_role', coalesce(r->>'uploaded_by_role', 'coach'),
        'uploaded_by', null, 'readable_game_serial', r->'readable_game_serial',
        'swing_detection_state', coalesce(r->>'swing_detection_state', case when r->>'status' = 'ready' then 'readable' else null end),
        'processing_progress', coalesce((r->>'processing_progress')::integer, 100)
      ));
    end loop;
    upgraded := jsonb_set(upgraded, '{tables,video_clips}', rows_out);
  end if;

  if jsonb_typeof(upgraded->'tables'->'analysis_runs') = 'array' then
    rows_out := '[]'::jsonb;
    for r in select value from jsonb_array_elements(upgraded->'tables'->'analysis_runs') loop
      rows_out := rows_out || jsonb_build_array(r || jsonb_build_object(
        'summary', r->'summary', 'strengths', coalesce(r->'strengths', '[]'::jsonb)
      ));
    end loop;
    upgraded := jsonb_set(upgraded, '{tables,analysis_runs}', rows_out);
  end if;

  if jsonb_typeof(upgraded->'tables'->'issues') = 'array' then
    rows_out := '[]'::jsonb;
    for r in select value from jsonb_array_elements(upgraded->'tables'->'issues') loop
      rows_out := rows_out || jsonb_build_array(r || jsonb_build_object(
        'hidden_reason', r->'hidden_reason', 'hidden_by', null
      ));
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
        'demo_url', r->'demo_url', 'demo_timestamp', r->'demo_timestamp',
        'source_credit', r->'source_credit',
        'requires_screen', coalesce((r->>'requires_screen')::boolean, false),
        'weighted_or_overspeed', coalesce((r->>'weighted_or_overspeed')::boolean, false)
      ));
    end loop;
    upgraded := jsonb_set(upgraded, '{tables,drill_library}', rows_out);
  end if;

  return upgraded;
end;
$$;
revoke all on function demo.upgrade_fixture_payload(jsonb) from public, anon, authenticated;

notify pgrst, 'reload schema';
