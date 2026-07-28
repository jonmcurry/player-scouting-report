-- Stores the per-frame 3D joint trajectory (from scripts/pose3d/lift_3d.py's
-- pose_3d.json) for the coach app's new 3D skeleton comparison view, which
-- replaces raw video playback entirely (see the approved plan). Fetched by
-- the browser via a plain `supabase.from("video_clip_pose3d").select(...)`
-- call - deliberately NOT another GCS+signed-URL+Edge-Function path like the
-- video work this replaces. That whole bug class (Content-Type, codec,
-- frame-rate-vs-display-refresh-rate, browser caching - all real, all found
-- and fixed this session, and playback was STILL jittery on the user's real
-- device) simply doesn't apply to a JSON fetch rendered by our own canvas
-- code - this is the actual fix, not another patch on video.

create table video_clip_pose3d (
  id uuid primary key default gen_random_uuid(),
  video_clip_id uuid not null unique references video_clips (id) on delete cascade,
  joint_order text not null default 'h36m17',
  joint_names jsonb not null,       -- verbatim copy of pose_3d.json's meta.joint_names
  -- Honest record of what actually ran, same spirit as checklist_scores.source -
  -- the real per-frame joint data is smoothed once here (see
  -- src/services/pose3d/smoothJoints.ts) since scripts/pose3d/ has never
  -- smoothed anything after 3D lifting (only 2D keypoints, before lifting,
  -- via one_euro_filter.py) - this is what a prior version of this project's
  -- OWN 3D swing-model page cited as the reason it gave up on real pose data
  -- ("no real per-frame data means no noisy real data to fight, which is
  -- what made earlier data-driven versions look jerky").
  smoothing_method text not null,
  -- [{frame, time_s, tracked, joints:[[x,y,z]x17], angles:{...}}, ...] -
  -- angles are copied through UNSMOOTHED (the renderer needs joint XYZ for
  -- bone directions; the FK correction reads the anchor frame's raw angle
  -- directly) - see the approved plan's smoothing section for why smoothing
  -- both independently would risk making them geometrically inconsistent.
  frames jsonb not null,
  created_at timestamptz not null default now()
);

alter table video_clip_pose3d enable row level security;

-- Same coach_rw_own_team shape already used for swing_phases (00004),
-- extended one join-hop deeper (video_clip_pose3d -> video_clips ->
-- game_log_entries -> players -> teams) - not a new access-control idea.
create policy coach_rw_own_team on video_clip_pose3d
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

grant select, insert, update, delete on video_clip_pose3d to authenticated;
grant all on video_clip_pose3d to service_role;
