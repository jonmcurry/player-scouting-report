-- Surfaces metrics.py's summary numbers (bat speed, attack angle,
-- hip-shoulder separation, torso/pelvis tilt, elbow/knee angles, stride) and
-- the new automated movement-pattern flags (lateral sway, knee/hip-rotation
-- dominance, wrist-lead timing) - all of it previously computed but only
-- ever existing in the raw metrics.json file on disk, with zero UI/DB
-- surface anywhere (confirmed by grep before writing this - ingestPhases.ts
-- only ever ingested the `phases` sub-object).
--
-- One row per clip (1:1 with video_clips, same shape as video_clip_pose3d).
-- Fixed/stable summary fields get real typed columns (queryable/filterable);
-- the new, evolving movement-pattern flags go into one `movement_flags`
-- jsonb column - same rationale swing_phases.detail already established for
-- variable-shape evidence that isn't the same fixed shape across every row.
create table video_clip_metrics (
  id uuid primary key default gen_random_uuid(),
  video_clip_id uuid not null references video_clips (id) on delete cascade,
  unique (video_clip_id),

  max_bat_speed_value double precision,
  max_bat_speed_unit text,
  max_bat_speed_search_window_s double precision,
  max_bat_speed_frame integer,
  -- Additive 240fps-decimation refinement (scripts/pose3d/refine_bat_speed.py)
  -- - null for every clip that never went through frame-rate decimation,
  -- i.e. every clip processed so far.
  max_bat_speed_full_rate_value double precision,
  max_bat_speed_full_rate_source_fps double precision,

  attack_angle_at_contact_deg double precision,
  hip_shoulder_separation_at_contact_deg double precision,
  torso_tilt_at_contact_deg double precision,
  pelvis_tilt_at_contact_deg double precision,

  lead_side text check (lead_side in ('l', 'r')),
  lead_side_method text,
  lead_elbow_angle_at_contact_deg double precision,
  front_knee_angle_at_contact_deg double precision,
  l_elbow_angle_at_contact_deg double precision,
  r_elbow_angle_at_contact_deg double precision,

  stride_length_hip_widths double precision,
  stride_direction_deg double precision,
  stride_note text,

  movement_flags jsonb not null default '{}',
  created_at timestamptz not null default now()
);

alter table video_clip_metrics enable row level security;

-- Exact same join-hop/is_coach_for_team shape as swing_phases' real policy
-- (video_clip_metrics -> video_clips -> game_log_entries -> players).
create policy coach_rw_own_team on video_clip_metrics
  for all using (
    is_coach_for_team((
      select p.team_id from video_clips vc
      join game_log_entries g on g.id = vc.game_log_entry_id
      join players p on p.id = g.player_id
      where vc.id = video_clip_id
    ))
  )
  with check (
    is_coach_for_team((
      select p.team_id from video_clips vc
      join game_log_entries g on g.id = vc.game_log_entry_id
      join players p on p.id = g.player_id
      where vc.id = video_clip_id
    ))
  );

grant select, insert, update, delete on video_clip_metrics to authenticated;
grant all on video_clip_metrics to service_role;
