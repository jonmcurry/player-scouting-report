-- Phase 4 of the HitterLoop public demo: extends the `demo` schema
-- (00031_demo_shared_project_schema.sql) with the minimum additional
-- domain tables the REAL, unmodified coach/*.html pages need to render
-- meaningful fictional content for team/player/at-bat/review/development/
-- practice/compare/report. See docs/research/demo-shared-project-architecture.md
-- for the full frontend query trace this was derived from - every table
-- below exists because a traced query in coach/*.html or a component it
-- imports actually calls .from() on it; nothing was added "because a
-- similarly-named production table exists."
--
-- Structural divergence from production (documented, not accidental):
--   * demo.issues drops production's analysis-provenance-only columns
--     (concept, basis, knowledge_claim_ids, ai_original, rejection_reason,
--     context_explains_it, emergency_swing_suspected, finding_key,
--     analysis_run_id) - grep-confirmed none of the 8 traced pages render
--     them (ai_original is read only when review_status='edited', which
--     this seed never produces; suggested_priority_title IS kept, it's
--     read by devActions.js).
--   * demo.checklist_scores and demo.at_bat_pitches drop analysis_run_id -
--     not selected by any traced query.
--   * demo.analysis_runs exists (player.html queries it directly) but is
--     NEVER seeded with rows - see 00034's header for why: this demo does
--     not simulate a specific real AI backend having run.
--   * demo.video_clip_metrics / demo.video_clip_pose3d exist (both are
--     queried directly by review.html/swingMetricsPanel.js/
--     skeletonComparison.js) but are never seeded either - every read site
--     already uses .maybeSingle() and renders a graceful "not available"
--     empty state for a missing row, which is the real, unmodified product
--     behavior for a clip that hasn't been through the pose3d pipeline -
--     exactly the right state for fictional demo video that was never
--     really processed. No lab-grade metrics are fabricated.
--   * demo.comp_recommendations / demo.comp_notes / demo.drill_recommendations
--     (a legacy report section, still queried by player.html) exist but
--     are never seeded - they render their existing empty state.
--
-- Every new table's ownership chain roots at demo.players (which roots at
-- demo.teams via ON DELETE CASCADE, established in 00031) - see the FK
-- comments below. This means reset_demo_session()'s existing
-- `delete from demo.teams where id = old_team_id` already correctly wipes
-- every table added here too, with NO changes needed to the reset/clone
-- lifecycle functions themselves - verified live (see demo.test.ts).

-- ---------------------------------------------------------------------
-- Ownership helpers, mirroring production's is_coach_for_player() /
-- is_coach_for_entry() (00025_player_development_model.sql) exactly, one
-- join-hop deeper than demo.is_demo_owner_of_team() (00031). Same
-- SECURITY DEFINER / stable / search_path='' / fully-qualified posture.
-- ---------------------------------------------------------------------
create or replace function demo.is_demo_owner_of_player(target_player_id uuid)
returns boolean
language sql
security definer
stable
set search_path = ''
as $$
  select exists (
    select 1 from demo.players p
    where p.id = target_player_id and demo.is_demo_owner_of_team(p.team_id)
  );
$$;
revoke all on function demo.is_demo_owner_of_player(uuid) from public, anon;
grant execute on function demo.is_demo_owner_of_player(uuid) to authenticated;

-- demo.is_demo_owner_of_entry() / demo.is_demo_owner_of_priority() are
-- defined further below, immediately after demo.game_log_entries /
-- demo.player_priorities exist (a SQL-language function's body is bound at
-- creation time, unlike plpgsql, so it can't forward-reference a table
-- that doesn't exist yet - confirmed live: an earlier version of this file
-- that declared all three helpers up front failed migration with
-- `relation "demo.game_log_entries" does not exist` applying this exact
-- statement).

-- Generic updated_at toucher, mirrors production's touch_updated_at().
create or replace function demo.touch_updated_at()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

-- ---------------------------------------------------------------------
-- Reference data (global, not team-scoped - seeded once below, never
-- cloned per-visitor, never touched by reset). Mirrors production's
-- checkpoints/swing_phase_types (00001/00004) exactly in shape.
-- ---------------------------------------------------------------------
create table demo.checkpoints (
  id uuid primary key default gen_random_uuid(),
  slug text unique not null,
  label text not null,
  sort_order smallint not null unique
);
-- Intentionally NO RLS - shared reference data, same rationale as
-- production's checkpoints (00001_initial_schema.sql).
grant select on demo.checkpoints to authenticated;

create table demo.swing_phase_types (
  id uuid primary key default gen_random_uuid(),
  slug text unique not null,
  label text not null,
  sort_order smallint not null unique
);
grant select on demo.swing_phase_types to authenticated;

-- Small curated drill set (mirrors production's 00025 seed content
-- verbatim) - global rows (team_id null), same RLS shape as production's
-- drill_library_read policy.
create table demo.drill_library (
  id uuid primary key default gen_random_uuid(),
  team_id uuid references demo.teams (id) on delete cascade,
  slug text not null,
  name text not null,
  purpose text not null default '',
  target_tags text[] not null default '{}',
  instructions text not null default '',
  equipment text not null default '',
  age_notes text not null default '',
  coach_notes text not null default '',
  reference_url text,
  is_active boolean not null default true,
  created_at timestamptz not null default now()
);
create unique index demo_drill_library_slug_scope on demo.drill_library (coalesce(team_id, '00000000-0000-0000-0000-000000000000'::uuid), slug);
alter table demo.drill_library enable row level security;
create policy demo_drill_library_read on demo.drill_library for select to authenticated
  using (team_id is null or demo.is_demo_owner_of_team(team_id));
create policy demo_drill_library_team_write on demo.drill_library for all to authenticated
  using (team_id is not null and demo.is_demo_owner_of_team(team_id))
  with check (team_id is not null and demo.is_demo_owner_of_team(team_id));
grant select, insert, update, delete on demo.drill_library to authenticated;

-- ---------------------------------------------------------------------
-- checklist_scores / checklist_score_history
-- ---------------------------------------------------------------------
create table demo.checklist_scores (
  id uuid primary key default gen_random_uuid(),
  player_id uuid not null references demo.players (id) on delete cascade,
  checkpoint_id uuid not null references demo.checkpoints (id),
  score smallint check (score between 1 and 3),
  ai_draft smallint check (ai_draft between 1 and 3),
  reviewed_by text,
  notes text not null default '',
  source text check (source in ('gemini', 'pose3d')),
  updated_at timestamptz not null default now(),
  unique (player_id, checkpoint_id)
);
alter table demo.checklist_scores enable row level security;
create policy demo_owner_rw on demo.checklist_scores for all to authenticated
  using (demo.is_demo_owner_of_player(player_id)) with check (demo.is_demo_owner_of_player(player_id));
grant select, insert, update, delete on demo.checklist_scores to authenticated;

create table demo.checklist_score_history (
  id uuid primary key default gen_random_uuid(),
  checklist_score_id uuid not null references demo.checklist_scores (id) on delete cascade,
  score smallint not null check (score between 1 and 3),
  changed_at timestamptz not null default now(),
  changed_by text
);
alter table demo.checklist_score_history enable row level security;
create policy demo_owner_rw on demo.checklist_score_history for all to authenticated
  using (demo.is_demo_owner_of_player((select player_id from demo.checklist_scores where id = checklist_score_id)))
  with check (demo.is_demo_owner_of_player((select player_id from demo.checklist_scores where id = checklist_score_id)));
grant select, insert, update, delete on demo.checklist_score_history to authenticated;

create or replace function demo.log_checklist_score_history()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if new.score is distinct from old.score then
    insert into demo.checklist_score_history (checklist_score_id, score, changed_by)
    values (new.id, new.score, new.reviewed_by);
  end if;
  return new;
end;
$$;
create trigger demo_checklist_scores_history_trigger
  after update on demo.checklist_scores
  for each row execute function demo.log_checklist_score_history();

-- ---------------------------------------------------------------------
-- game_log_entries (the at-bat / practice-session-entry entity)
-- ---------------------------------------------------------------------
create table demo.game_log_entries (
  id uuid primary key default gen_random_uuid(),
  player_id uuid not null references demo.players (id) on delete cascade,
  date date not null,
  opponent text,
  ab smallint not null,
  result text not null,
  position smallint not null default 0,
  session_type text not null default 'game' check (session_type in ('game', 'practice')),
  pitch_zone smallint check (pitch_zone between 1 and 9),
  pitch_outcome text check (pitch_outcome in ('take', 'foul', 'ball_in_play')),
  ai_summary text,
  ai_summary_generated_at timestamptz,
  created_at timestamptz not null default now(),
  unique (player_id, date, opponent, ab)
);
alter table demo.game_log_entries enable row level security;
create policy demo_owner_rw on demo.game_log_entries for all to authenticated
  using (demo.is_demo_owner_of_player(player_id)) with check (demo.is_demo_owner_of_player(player_id));
grant select, insert, update, delete on demo.game_log_entries to authenticated;

create or replace function demo.is_demo_owner_of_entry(target_entry_id uuid)
returns boolean
language sql
security definer
stable
set search_path = ''
as $$
  select exists (
    select 1 from demo.game_log_entries g
    where g.id = target_entry_id and demo.is_demo_owner_of_player(g.player_id)
  );
$$;
revoke all on function demo.is_demo_owner_of_entry(uuid) from public, anon;
grant execute on function demo.is_demo_owner_of_entry(uuid) to authenticated;

-- ---------------------------------------------------------------------
-- at_bat_pitches
-- ---------------------------------------------------------------------
create table demo.at_bat_pitches (
  id uuid primary key default gen_random_uuid(),
  game_log_entry_id uuid not null references demo.game_log_entries (id) on delete cascade,
  pitch_number integer not null check (pitch_number > 0),
  count_before_balls smallint check (count_before_balls between 0 and 3),
  count_before_strikes smallint check (count_before_strikes between 0 and 2),
  pitch_type text,
  pitch_location text,
  pitch_zone smallint check (pitch_zone between 1 and 9),
  pitch_outcome text check (pitch_outcome in (
    'ball', 'called_strike', 'swinging_strike', 'foul', 'ball_in_play', 'hit_by_pitch', 'take', 'other'
  )),
  swung boolean,
  notes text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (game_log_entry_id, pitch_number)
);
create trigger demo_at_bat_pitches_touch before update on demo.at_bat_pitches
  for each row execute function demo.touch_updated_at();
alter table demo.at_bat_pitches enable row level security;
create policy demo_owner_rw on demo.at_bat_pitches for all to authenticated
  using (demo.is_demo_owner_of_entry(game_log_entry_id)) with check (demo.is_demo_owner_of_entry(game_log_entry_id));
grant select, insert, update, delete on demo.at_bat_pitches to authenticated;

-- ---------------------------------------------------------------------
-- practice_sessions / practice_repetitions (created before video_clips
-- since video_clips references practice_repetitions)
-- ---------------------------------------------------------------------
create table demo.practice_sessions (
  id uuid primary key default gen_random_uuid(),
  player_id uuid not null references demo.players (id) on delete cascade,
  session_date date not null,
  session_goal text not null default '',
  focus_priority_id uuid, -- FK added after demo.player_priorities exists, below
  assigned_drill_id uuid references demo.drill_library (id) on delete set null,
  outcome text check (outcome in ('yes', 'no', 'mixed', 'unclear')),
  outcome_note text not null default '',
  notes text not null default '',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (player_id, session_date)
);
create trigger demo_practice_sessions_touch before update on demo.practice_sessions
  for each row execute function demo.touch_updated_at();
alter table demo.practice_sessions enable row level security;
create policy demo_owner_rw on demo.practice_sessions for all to authenticated
  using (demo.is_demo_owner_of_player(player_id)) with check (demo.is_demo_owner_of_player(player_id));
grant select, insert, update, delete on demo.practice_sessions to authenticated;

create table demo.practice_repetitions (
  id uuid primary key default gen_random_uuid(),
  practice_session_id uuid not null references demo.practice_sessions (id) on delete cascade,
  game_log_entry_id uuid not null unique references demo.game_log_entries (id) on delete cascade,
  rep_number integer not null check (rep_number > 0),
  grouping text not null default 'free_swing'
    check (grouping in ('baseline', 'drill', 'post_drill', 'free_swing', 'other')),
  usable boolean not null default true,
  notes text not null default '',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (practice_session_id, rep_number)
);
create trigger demo_practice_repetitions_touch before update on demo.practice_repetitions
  for each row execute function demo.touch_updated_at();
alter table demo.practice_repetitions enable row level security;
create policy demo_owner_rw on demo.practice_repetitions for all to authenticated
  using (demo.is_demo_owner_of_entry(game_log_entry_id)) with check (demo.is_demo_owner_of_entry(game_log_entry_id));
grant select, insert, update, delete on demo.practice_repetitions to authenticated;

-- ---------------------------------------------------------------------
-- video_clips (evidence attached to a pitch or a practice rep)
-- ---------------------------------------------------------------------
create table demo.video_clips (
  id uuid primary key default gen_random_uuid(),
  game_log_entry_id uuid not null references demo.game_log_entries (id) on delete cascade,
  clip_slug text not null,
  -- Always null in this demo - no real footage is ever stored (see MEDIA/
  -- VIDEO note in docs/research/demo-shared-project-architecture.md). The
  -- real get-video-url/get-demo-player-report code paths already render a
  -- graceful "video unavailable" state for a null raw_gcs_path - that is
  -- the intended demo behavior, not a bug to route around.
  raw_gcs_path text,
  fps double precision,
  n_frames integer,
  duration_s double precision,
  position smallint not null default 0,
  status text not null default 'ready' check (status in ('pending', 'processing', 'ready', 'failed')),
  error_message text,
  claimed_at timestamptz,
  retry_count smallint not null default 0,
  next_retry_at timestamptz,
  at_bat_pitch_id uuid references demo.at_bat_pitches (id) on delete set null,
  practice_repetition_id uuid references demo.practice_repetitions (id) on delete set null,
  created_at timestamptz not null default now(),
  unique (game_log_entry_id, clip_slug),
  constraint demo_video_clips_one_source check (at_bat_pitch_id is null or practice_repetition_id is null)
);
alter table demo.video_clips enable row level security;
create policy demo_owner_rw on demo.video_clips for all to authenticated
  using (demo.is_demo_owner_of_entry(game_log_entry_id)) with check (demo.is_demo_owner_of_entry(game_log_entry_id));
grant select, insert, update, delete on demo.video_clips to authenticated;

-- ---------------------------------------------------------------------
-- video_clip_metrics / video_clip_pose3d - tables exist (queried
-- directly), deliberately never seeded with rows - see this file's header.
-- ---------------------------------------------------------------------
create table demo.video_clip_metrics (
  id uuid primary key default gen_random_uuid(),
  video_clip_id uuid not null unique references demo.video_clips (id) on delete cascade,
  analysis_quality text,
  movement_flags jsonb not null default '{}'
);
alter table demo.video_clip_metrics enable row level security;
create policy demo_owner_rw on demo.video_clip_metrics for all to authenticated
  using (demo.is_demo_owner_of_entry((select game_log_entry_id from demo.video_clips where id = video_clip_id)))
  with check (demo.is_demo_owner_of_entry((select game_log_entry_id from demo.video_clips where id = video_clip_id)));
grant select, insert, update, delete on demo.video_clip_metrics to authenticated;

create table demo.video_clip_pose3d (
  id uuid primary key default gen_random_uuid(),
  video_clip_id uuid not null unique references demo.video_clips (id) on delete cascade,
  joint_order text not null default 'h36m17',
  joint_names jsonb not null default '[]',
  smoothing_method text not null default 'none',
  frames jsonb not null default '[]',
  created_at timestamptz not null default now()
);
alter table demo.video_clip_pose3d enable row level security;
create policy demo_owner_rw on demo.video_clip_pose3d for all to authenticated
  using (demo.is_demo_owner_of_entry((select game_log_entry_id from demo.video_clips where id = video_clip_id)))
  with check (demo.is_demo_owner_of_entry((select game_log_entry_id from demo.video_clips where id = video_clip_id)));
grant select, insert, update, delete on demo.video_clip_pose3d to authenticated;

-- ---------------------------------------------------------------------
-- swing_phases
-- ---------------------------------------------------------------------
create table demo.swing_phases (
  id uuid primary key default gen_random_uuid(),
  video_clip_id uuid not null references demo.video_clips (id) on delete cascade,
  phase_type_id uuid not null references demo.swing_phase_types (id),
  frame integer,
  time_s double precision,
  method text,
  confidence text check (confidence in ('high', 'low')),
  detail jsonb not null default '{}',
  created_at timestamptz not null default now(),
  unique (video_clip_id, phase_type_id)
);
alter table demo.swing_phases enable row level security;
create policy demo_owner_rw on demo.swing_phases for all to authenticated
  using (demo.is_demo_owner_of_entry((select game_log_entry_id from demo.video_clips where id = video_clip_id)))
  with check (demo.is_demo_owner_of_entry((select game_log_entry_id from demo.video_clips where id = video_clip_id)));
grant select, insert, update, delete on demo.swing_phases to authenticated;

-- ---------------------------------------------------------------------
-- analysis_runs - table exists (player.html queries it directly), never
-- seeded with rows - see this file's header.
-- ---------------------------------------------------------------------
create table demo.analysis_runs (
  id uuid primary key default gen_random_uuid(),
  video_clip_id uuid references demo.video_clips (id) on delete set null,
  player_id uuid not null references demo.players (id) on delete cascade,
  backend text not null check (backend in ('gemini', 'claude', 'pose3d')),
  created_at timestamptz not null default now()
);
alter table demo.analysis_runs enable row level security;
create policy demo_owner_rw on demo.analysis_runs for all to authenticated
  using (demo.is_demo_owner_of_player(player_id)) with check (demo.is_demo_owner_of_player(player_id));
grant select, insert, update, delete on demo.analysis_runs to authenticated;

-- ---------------------------------------------------------------------
-- issues (coach-reviewed findings) - see this file's header for the
-- documented column divergence from production.
-- ---------------------------------------------------------------------
create table demo.issues (
  id uuid primary key default gen_random_uuid(),
  player_id uuid not null references demo.players (id) on delete cascade,
  issue text not null,
  seen_in_at_bats text not null default '',
  likely_cause text not null default '',
  effect text not null default '',
  reviewed_by text,
  source text check (source in ('gemini', 'pose3d')),
  review_status text not null default 'draft' check (review_status in ('draft', 'approved', 'edited', 'rejected')),
  evidence text not null default '',
  coaching_cue text not null default '',
  suggested_drill text,
  look_for_next text not null default '',
  confidence text check (confidence in ('high', 'medium', 'low')),
  video_clip_id uuid references demo.video_clips (id) on delete set null,
  phase text,
  suggested_priority_title text,
  created_at timestamptz not null default now()
);
alter table demo.issues enable row level security;
create policy demo_owner_rw on demo.issues for all to authenticated
  using (demo.is_demo_owner_of_player(player_id)) with check (demo.is_demo_owner_of_player(player_id));
grant select, insert, update, delete on demo.issues to authenticated;

-- ---------------------------------------------------------------------
-- player_priorities / status history / drills / observations
-- ---------------------------------------------------------------------
create table demo.player_priorities (
  id uuid primary key default gen_random_uuid(),
  player_id uuid not null references demo.players (id) on delete cascade,
  team_id uuid not null references demo.teams (id) on delete cascade,
  title text not null,
  description text not null default '',
  category text,
  status text not null default 'active' check (status in ('active', 'monitoring', 'resolved', 'archived')),
  priority_order integer not null default 0,
  first_identified_at timestamptz not null default now(),
  last_observed_at timestamptz,
  resolved_at timestamptz,
  source_issue_id uuid references demo.issues (id) on delete set null,
  coach_notes text not null default '',
  follow_up_kind text check (follow_up_kind in ('next_practice', 'next_game', 'after_swings', 'date')),
  follow_up_date date,
  follow_up_swings integer check (follow_up_swings > 0),
  follow_up_note text,
  follow_up_done_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create or replace function demo.enforce_priority_team()
returns trigger
language plpgsql
set search_path = ''
as $$
declare
  real_team uuid;
begin
  select team_id into real_team from demo.players where id = new.player_id;
  if real_team is null then
    raise exception 'demo player % not found', new.player_id;
  end if;
  if new.team_id is null then
    new.team_id = real_team;
  elsif new.team_id <> real_team then
    raise exception 'team_id does not match the demo player''s team';
  end if;
  if tg_op = 'UPDATE' then
    new.updated_at = now();
    if new.status = 'resolved' and old.status <> 'resolved' then
      new.resolved_at = coalesce(new.resolved_at, now());
    elsif new.status <> 'resolved' and old.status = 'resolved' then
      new.resolved_at = null;
    end if;
  elsif new.status = 'resolved' then
    new.resolved_at = coalesce(new.resolved_at, now());
  end if;
  return new;
end;
$$;
create trigger demo_player_priorities_team_check before insert or update on demo.player_priorities
  for each row execute function demo.enforce_priority_team();

alter table demo.player_priorities enable row level security;
create policy demo_owner_rw on demo.player_priorities for all to authenticated
  using (demo.is_demo_owner_of_team(team_id)) with check (demo.is_demo_owner_of_team(team_id));
grant select, insert, update, delete on demo.player_priorities to authenticated;

create or replace function demo.is_demo_owner_of_priority(target_priority_id uuid)
returns boolean
language sql
security definer
stable
set search_path = ''
as $$
  select exists (
    select 1 from demo.player_priorities pp
    where pp.id = target_priority_id and demo.is_demo_owner_of_team(pp.team_id)
  );
$$;
revoke all on function demo.is_demo_owner_of_priority(uuid) from public, anon;
grant execute on function demo.is_demo_owner_of_priority(uuid) to authenticated;

-- Now that demo.player_priorities exists, wire practice_sessions.focus_priority_id.
alter table demo.practice_sessions
  add constraint demo_practice_sessions_focus_priority_fk
  foreign key (focus_priority_id) references demo.player_priorities (id) on delete set null;

create table demo.player_priority_status_history (
  id uuid primary key default gen_random_uuid(),
  player_priority_id uuid not null references demo.player_priorities (id) on delete cascade,
  from_status text,
  to_status text not null,
  note text,
  changed_at timestamptz not null default now()
);
alter table demo.player_priority_status_history enable row level security;
create policy demo_owner_rw on demo.player_priority_status_history for all to authenticated
  using (demo.is_demo_owner_of_priority(player_priority_id)) with check (demo.is_demo_owner_of_priority(player_priority_id));
grant select, insert, update, delete on demo.player_priority_status_history to authenticated;

create or replace function demo.log_priority_status()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if tg_op = 'INSERT' then
    insert into demo.player_priority_status_history (player_priority_id, from_status, to_status)
    values (new.id, null, new.status);
  elsif new.status is distinct from old.status then
    insert into demo.player_priority_status_history (player_priority_id, from_status, to_status)
    values (new.id, old.status, new.status);
  end if;
  return null;
end;
$$;
create trigger demo_player_priorities_status_log after insert or update on demo.player_priorities
  for each row execute function demo.log_priority_status();

create table demo.player_priority_drills (
  id uuid primary key default gen_random_uuid(),
  player_priority_id uuid not null references demo.player_priorities (id) on delete cascade,
  drill_id uuid not null references demo.drill_library (id),
  assigned_at timestamptz not null default now(),
  active boolean not null default true,
  coach_note text not null default '',
  unique (player_priority_id, drill_id)
);
alter table demo.player_priority_drills enable row level security;
create policy demo_owner_rw on demo.player_priority_drills for all to authenticated
  using (demo.is_demo_owner_of_priority(player_priority_id)) with check (demo.is_demo_owner_of_priority(player_priority_id));
grant select, insert, update, delete on demo.player_priority_drills to authenticated;

create table demo.player_priority_observations (
  id uuid primary key default gen_random_uuid(),
  player_priority_id uuid not null references demo.player_priorities (id) on delete cascade,
  video_clip_id uuid references demo.video_clips (id) on delete set null,
  practice_repetition_id uuid references demo.practice_repetitions (id) on delete set null,
  at_bat_pitch_id uuid references demo.at_bat_pitches (id) on delete set null,
  practice_session_id uuid references demo.practice_sessions (id) on delete set null,
  phase text,
  observed_at timestamptz not null default now(),
  status text not null check (status in ('improving', 'unchanged', 'worse', 'resolved', 'unclear')),
  coach_note text not null default '',
  confidence text check (confidence in ('high', 'medium', 'low')),
  context text check (context in ('game', 'practice')),
  created_at timestamptz not null default now()
);
alter table demo.player_priority_observations enable row level security;
create policy demo_owner_rw on demo.player_priority_observations for all to authenticated
  using (demo.is_demo_owner_of_priority(player_priority_id)) with check (demo.is_demo_owner_of_priority(player_priority_id));
grant select, insert, update, delete on demo.player_priority_observations to authenticated;

create or replace function demo.touch_priority_last_observed()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  update demo.player_priorities set last_observed_at = new.observed_at
  where id = new.player_priority_id
    and (last_observed_at is null or last_observed_at < new.observed_at);
  return null;
end;
$$;
create trigger demo_player_priority_observations_touch after insert on demo.player_priority_observations
  for each row execute function demo.touch_priority_last_observed();

-- ---------------------------------------------------------------------
-- Legacy report section - tables exist (player.html queries them
-- directly), deliberately never seeded - see this file's header.
-- ---------------------------------------------------------------------
create table demo.comp_recommendations (
  id uuid primary key default gen_random_uuid(),
  player_id uuid not null references demo.players (id) on delete cascade,
  analysis_run_id uuid references demo.analysis_runs (id) on delete set null,
  comp_name text not null,
  cue text not null,
  position smallint not null default 0,
  created_at timestamptz not null default now()
);
alter table demo.comp_recommendations enable row level security;
create policy demo_owner_rw on demo.comp_recommendations for all to authenticated
  using (demo.is_demo_owner_of_player(player_id)) with check (demo.is_demo_owner_of_player(player_id));
grant select, insert, update, delete on demo.comp_recommendations to authenticated;

create table demo.comp_notes (
  id uuid primary key default gen_random_uuid(),
  player_id uuid not null references demo.players (id) on delete cascade,
  analysis_run_id uuid references demo.analysis_runs (id) on delete set null,
  note text not null,
  position smallint not null default 0,
  created_at timestamptz not null default now()
);
alter table demo.comp_notes enable row level security;
create policy demo_owner_rw on demo.comp_notes for all to authenticated
  using (demo.is_demo_owner_of_player(player_id)) with check (demo.is_demo_owner_of_player(player_id));
grant select, insert, update, delete on demo.comp_notes to authenticated;

create table demo.drill_recommendations (
  id uuid primary key default gen_random_uuid(),
  player_id uuid not null references demo.players (id) on delete cascade,
  analysis_run_id uuid references demo.analysis_runs (id) on delete set null,
  title text not null,
  description text not null,
  position smallint not null default 0,
  created_at timestamptz not null default now()
);
alter table demo.drill_recommendations enable row level security;
create policy demo_owner_rw on demo.drill_recommendations for all to authenticated
  using (demo.is_demo_owner_of_player(player_id)) with check (demo.is_demo_owner_of_player(player_id));
grant select, insert, update, delete on demo.drill_recommendations to authenticated;

-- ---------------------------------------------------------------------
-- player_share_links (backs report.html / get-demo-player-report)
-- ---------------------------------------------------------------------
create table demo.player_share_links (
  id uuid primary key default gen_random_uuid(),
  player_id uuid not null references demo.players (id) on delete cascade,
  token text not null unique,
  created_at timestamptz not null default now(),
  expires_at timestamptz not null default (now() + interval '90 days'),
  revoked_at timestamptz
);
alter table demo.player_share_links enable row level security;
create policy demo_owner_rw on demo.player_share_links for all to authenticated
  using (demo.is_demo_owner_of_player(player_id)) with check (demo.is_demo_owner_of_player(player_id));
grant select, insert, update, delete on demo.player_share_links to authenticated;
-- No policy/grant to anon - same as production (00019_player_share_links.sql):
-- the anonymous-facing read happens entirely through the
-- get-demo-player-report Edge Function (service-role, token-validated),
-- never a direct table grant.

-- ---------------------------------------------------------------------
-- team_summary_stats view, mirrors production's exactly (00001), scoped
-- to demo.checkpoints/demo.checklist_scores/demo.players.
-- ---------------------------------------------------------------------
create view demo.team_summary_stats
with (security_invoker = true)
as
select
  p.team_id,
  c.id as checkpoint_id,
  c.slug as checkpoint_slug,
  c.label as checkpoint_label,
  c.sort_order,
  avg(cs.score)::numeric(3, 2) as avg_score,
  avg(cs.score) < 2.0 as is_team_weakness,
  count(cs.score) as scored_count,
  count(cs.reviewed_by) as reviewed_count
from demo.checkpoints c
left join demo.checklist_scores cs on cs.checkpoint_id = c.id
left join demo.players p on p.id = cs.player_id
group by p.team_id, c.id, c.slug, c.label, c.sort_order;
grant select on demo.team_summary_stats to authenticated;

-- ---------------------------------------------------------------------
-- Reference data seed (global, once - not per-visitor clone content).
-- Content mirrors production's checkpoints (00001)/swing_phase_types
-- (00004)/drill_library (00025) seeds verbatim.
-- ---------------------------------------------------------------------
insert into demo.checkpoints (slug, label, sort_order) values
  ('stance-setup',      'Stance & setup',                    0),
  ('load',              'Load',                               1),
  ('stride',            'Stride / front-foot plant',          2),
  ('hip-shoulder-sep',  'Hip-shoulder separation',            3),
  ('hand-path',         'Hand path to ball',                  4),
  ('bat-path',          'Bat path through zone',               5),
  ('contact-point',     'Contact point',                       6),
  ('extension',         'Extension',                           7),
  ('head-eyes',         'Head/eyes',                           8),
  ('follow-through',    'Follow-through & finish',            9),
  ('swing-decisions',   'Swing decisions (pitch selection)',  10)
on conflict (slug) do nothing;

insert into demo.swing_phase_types (slug, label, sort_order) values
  ('stance',        'Stance',         0),
  ('load',          'Load',           1),
  ('stride',        'Stride',         2),
  ('contact',       'Contact',        3),
  ('extension',     'Extension',      4),
  ('follow-through','Follow-through', 5)
on conflict (slug) do nothing;

insert into demo.drill_library (slug, name, purpose, target_tags, instructions, equipment, age_notes) values
  ('split-stance-tee', 'Split-stance tee drill', 'Keeps the front side closed longer through plant.',
   '{front-side-stability}',
   'Start with feet apart and front foot already down. Hit off a tee focusing on the front hip staying closed until the hands start forward. 10 swings, then 5 with a normal stride to check that it carried over.',
   'Tee, balls, net', 'Works from 8U up; keep it slow and let her feel the front side.'),
  ('stride-to-stop', 'Stride-to-stop', 'Builds a consistent stride and plant.',
   '{stride-consistency,front-side-stability}',
   'Stride and freeze at plant before swinging. Check the foot lands closed and on the same spot each rep.',
   'Tee or soft toss, tape mark', 'Use a tape mark on the ground as the landing target.'),
  ('two-tee-line-drive', 'Two-tee line drive drill', 'Flattens the bat path through contact instead of finishing under the ball.',
   '{hand-path,loft-fly-ball}',
   'Set one tee at normal height and a second about 6 inches lower at the same spot. Hit off the lower tee driving the ball flat up the middle, then repeat on the regular tee reproducing the same path.',
   'Two tees, balls, net', 'Reward line drives, not distance.'),
  ('inside-soft-toss', 'Inside soft toss', 'Timing and hand path against inside pitches.',
   '{timing-inside-pitch,hand-path}',
   'Toss from a 45 degree angle so the ball arrives inside. Focus on hands staying inside the ball and contact out in front. Mix in a few middle tosses.',
   'Balls, net, partner', 'Keep tosses soft and slow at 10U.'),
  ('head-still-tee', 'Head-still tee drill', 'Reduces head movement into and through contact.',
   '{head-movement}',
   'Hit off the tee while a partner watches the helmet. Finish with eyes on the contact spot. Count reps where the head stays quiet through contact.',
   'Tee, balls, partner', 'Keep the goal to quiet head, not slow swing.'),
  ('load-and-pause', 'Load-and-pause', 'Clean, repeatable load position.',
   '{load-timing}',
   'Load and hold a beat at the top before starting the swing. Check hands and weight are where you want them, then go.',
   'Tee or soft toss', 'Fade the pause out once the load looks repeatable.'),
  ('balance-finish', 'Balance and finish', 'Stays balanced through the swing and finish.',
   '{balance-finish,front-side-stability}',
   'Swing off a tee and hold the finish for two seconds. Check weight is centered and she is not falling off.',
   'Tee, balls', 'Simple warm-up drill for any age.')
on conflict do nothing;
