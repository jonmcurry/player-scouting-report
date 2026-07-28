-- Adds real video-serving + swing-phase-timestamp support for the coach app's
-- frame scrubber. Confirmed by reading real report data directly (not
-- guessed): a single game_log_entries row can describe MULTIPLE physical clip
-- files (emily_c.html's AB1 row has `clip: "videos/Emily_C_AB1 (1-4).mp4"`,
-- but the real files are 4 separate clips, Emily_C_AB1 (1).mp4 ... (4).mp4) -
-- so this can't be a second column on game_log_entries, it needs its own
-- child table. `game_log_entries.clip_gcs_path` is left untouched (still a
-- cosmetic legacy display column read by the live migrate.ts/generate.ts
-- round-trip) - this feature reads exclusively from video_clips instead.

create table video_clips (
  id uuid primary key default gen_random_uuid(),
  game_log_entry_id uuid not null references game_log_entries (id) on delete cascade,
  -- Matches frames/<player_slug>/<clip_slug>/ directory name exactly - the
  -- natural key connecting a Supabase row back to its pose3d pipeline output
  -- on disk (see src/cli/ingestPhases.ts).
  clip_slug text not null,
  -- gs://<bucket>/... ; null until src/cli/uploadClip.ts has run for this clip.
  gcs_path text,
  fps double precision,
  n_frames integer,
  duration_s double precision,
  -- Display order among multiple physical clips for the same at-bat row -
  -- same rationale as game_log_entries.position (real filename order isn't
  -- guaranteed to match true in-game sequence, per that report's own note).
  position smallint not null default 0,
  created_at timestamptz not null default now(),
  unique (game_log_entry_id, clip_slug)
);

-- Fixed reference set, same shape/rationale as `checkpoints` - a stable slug
-- + explicit sort_order, not a free-text phase name, so the scrubber's tick
-- order never depends on insertion order or string sorting.
create table swing_phase_types (
  id uuid primary key default gen_random_uuid(),
  slug text unique not null,
  label text not null,
  sort_order smallint not null unique
);

insert into swing_phase_types (slug, label, sort_order) values
  ('stance',        'Stance',         0),
  ('load',          'Load',           1),
  ('stride',        'Stride',         2),
  ('contact',       'Contact',        3),
  ('extension',     'Extension',      4),
  ('follow-through','Follow-through', 5)
on conflict (slug) do nothing;

-- One row per phase per clip (up to 6) - mirrors checklist_scores' "fixed set
-- of named things per parent row" shape. frame/time_s are null when
-- metrics.py's detector couldn't locate that phase on real data (a real,
-- honest outcome for several of these - see scripts/pose3d/metrics.py's
-- module docstring) rather than ever holding a fabricated timestamp.
create table swing_phases (
  id uuid primary key default gen_random_uuid(),
  video_clip_id uuid not null references video_clips (id) on delete cascade,
  phase_type_id uuid not null references swing_phase_types (id),
  frame integer,
  time_s double precision,
  method text,
  confidence text check (confidence in ('high', 'low')),
  -- Per-phase evidence numbers (e.g. knee_angle_deg, speed_hip_widths_per_s) -
  -- these vary by phase (see each find_*_frame()'s own "detail" dict in
  -- metrics.py), unlike frame/time_s/confidence which are the same shape
  -- across all 6, so a jsonb column fits here without hiding a fixed,
  -- independently-queryable fact behind it.
  detail jsonb not null default '{}',
  created_at timestamptz not null default now(),
  unique (video_clip_id, phase_type_id)
);

alter table video_clips enable row level security;
alter table swing_phases enable row level security;
-- swing_phase_types is shared reference data, not team-scoped - same
-- intentional no-RLS-policy rationale as `checkpoints`.

-- Same coach_rw_own_team policy shape used throughout 00001/00003, extended
-- one join-hop deeper each time (video_clips -> game_log_entries -> players;
-- swing_phases -> video_clips -> game_log_entries -> players) - the same
-- nested-select pattern checklist_score_history already established, not a
-- new access-control idea.
create policy coach_rw_own_team on video_clips
  for all using (
    is_coach_for_team((
      select p.team_id from game_log_entries g
      join players p on p.id = g.player_id
      where g.id = game_log_entry_id
    ))
  )
  with check (
    is_coach_for_team((
      select p.team_id from game_log_entries g
      join players p on p.id = g.player_id
      where g.id = game_log_entry_id
    ))
  );

create policy coach_rw_own_team on swing_phases
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

grant select, insert, update, delete on video_clips, swing_phases to authenticated;
grant all on video_clips, swing_phases, swing_phase_types to service_role;
