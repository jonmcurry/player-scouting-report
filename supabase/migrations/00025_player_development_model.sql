-- Player-development domain model (additive - nothing existing is renamed or dropped).
--
-- Before this migration the app was clip-centric: a game_log_entries row
-- WAS the at-bat, and its "pitches" were just video_clips.position tabs; a
-- practice "session" was several game_log_entries(session_type='practice')
-- rows; drills were per-player free text; there was no notion of a coaching
-- priority or of progress against one. This adds:
--
--   Team > Player > Game > At-Bat (game_log_entries) > Pitch (at_bat_pitches) > video_clips
--   Player > Practice Session (practice_sessions) > Repetition (practice_repetitions) > video_clips
--   Issue (AI draft / coach-reviewed) > Priority (player_priorities) > Drill (drill_library via
--   player_priority_drills) > Observation (player_priority_observations, coach-authoritative)
--
-- Design constraints kept on purpose:
--  * video_clips.game_log_entry_id stays NOT NULL. The upload worker, ingestPhases and the
--    video-url function all resolve a clip through its entry; a clip additionally points at
--    its pitch or rep, it never replaces that link. Practice reps keep a backing
--    game_log_entries(session_type='practice') row for the same reason.
--  * AI output never creates a priority, resolves one, or overwrites coach-reviewed content:
--    priorities/observations are coach-written rows; issues gain a review_status instead.
--  * Every new table is RLS-protected through the same coach_team_access model.

-- ---------------------------------------------------------------------------
-- Access helpers (security definer so they can read coach_team_access, same as
-- is_coach_for_team)
-- ---------------------------------------------------------------------------
create or replace function is_coach_for_player(target_player_id uuid)
returns boolean
language sql
security definer
stable
set search_path = public
as $$
  select exists (
    select 1
    from players p
    join coach_team_access a on a.team_id = p.team_id
    where p.id = target_player_id and a.coach_id = auth.uid()
  );
$$;

create or replace function is_coach_for_entry(target_entry_id uuid)
returns boolean
language sql
security definer
stable
set search_path = public
as $$
  select exists (
    select 1
    from game_log_entries g
    join players p on p.id = g.player_id
    join coach_team_access a on a.team_id = p.team_id
    where g.id = target_entry_id and a.coach_id = auth.uid()
  );
$$;

create or replace function touch_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

-- ---------------------------------------------------------------------------
-- Drill library (small curated set; global rows have team_id null)
-- ---------------------------------------------------------------------------
create table drill_library (
  id uuid primary key default gen_random_uuid(),
  team_id uuid references teams (id) on delete cascade,
  slug text not null,
  name text not null,
  purpose text not null default '',
  -- Priority/issue categories this drill targets (see coach/components/developmentLogic.js
  -- PRIORITY_CATEGORIES). AI may suggest from this mapping; the coach picks.
  target_tags text[] not null default '{}',
  instructions text not null default '',
  equipment text not null default '',
  age_notes text not null default '',
  coach_notes text not null default '',
  reference_url text,
  is_active boolean not null default true,
  created_at timestamptz not null default now()
);
create unique index drill_library_slug_scope on drill_library (coalesce(team_id, '00000000-0000-0000-0000-000000000000'::uuid), slug);
create index drill_library_tags_idx on drill_library using gin (target_tags);
alter table drill_library enable row level security;
create policy drill_library_read on drill_library for select to authenticated
  using (team_id is null or is_coach_for_team(team_id));
create policy drill_library_team_write on drill_library for all to authenticated
  using (team_id is not null and is_coach_for_team(team_id))
  with check (team_id is not null and is_coach_for_team(team_id));

insert into drill_library (slug, name, purpose, target_tags, instructions, equipment, age_notes) values
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
   'Tee, balls', 'Simple warm-up drill for any age.');

-- ---------------------------------------------------------------------------
-- Pitches within a game at-bat
-- ---------------------------------------------------------------------------
create table at_bat_pitches (
  id uuid primary key default gen_random_uuid(),
  game_log_entry_id uuid not null references game_log_entries (id) on delete cascade,
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
create index at_bat_pitches_entry_idx on at_bat_pitches (game_log_entry_id);
create trigger at_bat_pitches_touch before update on at_bat_pitches
  for each row execute function touch_updated_at();
alter table at_bat_pitches enable row level security;
create policy coach_rw_own_team on at_bat_pitches for all to authenticated
  using (is_coach_for_entry(game_log_entry_id))
  with check (is_coach_for_entry(game_log_entry_id));

-- ---------------------------------------------------------------------------
-- Priorities (coach-confirmed development focus)
-- ---------------------------------------------------------------------------
create table player_priorities (
  id uuid primary key default gen_random_uuid(),
  player_id uuid not null references players (id) on delete cascade,
  team_id uuid not null references teams (id) on delete cascade,
  title text not null,
  description text not null default '',
  category text,
  status text not null default 'active' check (status in ('active', 'monitoring', 'resolved', 'archived')),
  priority_order integer not null default 0,
  first_identified_at timestamptz not null default now(),
  last_observed_at timestamptz,
  resolved_at timestamptz,
  source_issue_id uuid references issues (id) on delete set null,
  created_by_coach_id uuid references auth.users (id) default auth.uid(),
  coach_notes text not null default '',
  follow_up_kind text check (follow_up_kind in ('next_practice', 'next_game', 'after_swings', 'date')),
  follow_up_date date,
  follow_up_swings integer check (follow_up_swings > 0),
  follow_up_note text,
  follow_up_done_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index player_priorities_player_idx on player_priorities (player_id, status);
create index player_priorities_team_idx on player_priorities (team_id);

-- team_id is denormalized for team-level dashboards; this keeps it from ever
-- disagreeing with the player's real team (and lets a client omit it).
create or replace function enforce_priority_team()
returns trigger
language plpgsql
as $$
declare
  real_team uuid;
begin
  select team_id into real_team from players where id = new.player_id;
  if real_team is null then
    raise exception 'player % not found', new.player_id;
  end if;
  if new.team_id is null then
    new.team_id = real_team;
  elsif new.team_id <> real_team then
    raise exception 'team_id does not match the player''s team';
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
create trigger player_priorities_team_check before insert or update on player_priorities
  for each row execute function enforce_priority_team();

alter table player_priorities enable row level security;
create policy coach_rw_own_team on player_priorities for all to authenticated
  using (is_coach_for_team(team_id))
  with check (is_coach_for_team(team_id));

create table player_priority_status_history (
  id uuid primary key default gen_random_uuid(),
  player_priority_id uuid not null references player_priorities (id) on delete cascade,
  from_status text,
  to_status text not null,
  changed_by uuid references auth.users (id) default auth.uid(),
  note text,
  changed_at timestamptz not null default now()
);
create index player_priority_status_history_idx on player_priority_status_history (player_priority_id, changed_at);
alter table player_priority_status_history enable row level security;
create policy coach_rw_own_team on player_priority_status_history for all to authenticated
  using (is_coach_for_team((select team_id from player_priorities where id = player_priority_id)))
  with check (is_coach_for_team((select team_id from player_priorities where id = player_priority_id)));

create or replace function log_priority_status()
returns trigger
language plpgsql
as $$
begin
  if tg_op = 'INSERT' then
    insert into player_priority_status_history (player_priority_id, from_status, to_status)
    values (new.id, null, new.status);
  elsif new.status is distinct from old.status then
    insert into player_priority_status_history (player_priority_id, from_status, to_status)
    values (new.id, old.status, new.status);
  end if;
  return null;
end;
$$;
create trigger player_priorities_status_log after insert or update on player_priorities
  for each row execute function log_priority_status();

create table player_priority_drills (
  id uuid primary key default gen_random_uuid(),
  player_priority_id uuid not null references player_priorities (id) on delete cascade,
  drill_id uuid not null references drill_library (id),
  assigned_by uuid references auth.users (id) default auth.uid(),
  assigned_at timestamptz not null default now(),
  active boolean not null default true,
  coach_note text not null default '',
  unique (player_priority_id, drill_id)
);
alter table player_priority_drills enable row level security;
create policy coach_rw_own_team on player_priority_drills for all to authenticated
  using (is_coach_for_team((select team_id from player_priorities where id = player_priority_id)))
  with check (is_coach_for_team((select team_id from player_priorities where id = player_priority_id)));

-- ---------------------------------------------------------------------------
-- Practice sessions / repetitions
-- ---------------------------------------------------------------------------
create table practice_sessions (
  id uuid primary key default gen_random_uuid(),
  player_id uuid not null references players (id) on delete cascade,
  session_date date not null,
  session_goal text not null default '',
  focus_priority_id uuid references player_priorities (id) on delete set null,
  assigned_drill_id uuid references drill_library (id) on delete set null,
  -- Coach's end-of-session call; never set by AI.
  outcome text check (outcome in ('yes', 'no', 'mixed', 'unclear')),
  outcome_note text not null default '',
  notes text not null default '',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (player_id, session_date)
);
create index practice_sessions_player_idx on practice_sessions (player_id, session_date desc);
create trigger practice_sessions_touch before update on practice_sessions
  for each row execute function touch_updated_at();
alter table practice_sessions enable row level security;
create policy coach_rw_own_team on practice_sessions for all to authenticated
  using (is_coach_for_player(player_id))
  with check (
    is_coach_for_player(player_id)
    and (focus_priority_id is null or exists (
      select 1 from player_priorities pp where pp.id = focus_priority_id and pp.player_id = practice_sessions.player_id))
  );

create table practice_repetitions (
  id uuid primary key default gen_random_uuid(),
  practice_session_id uuid not null references practice_sessions (id) on delete cascade,
  -- Backing game_log_entries(session_type='practice') row: the upload worker and
  -- ingest steps resolve every clip through a game_log_entries row.
  game_log_entry_id uuid not null unique references game_log_entries (id) on delete cascade,
  rep_number integer not null check (rep_number > 0),
  grouping text not null default 'free_swing'
    check (grouping in ('baseline', 'drill', 'post_drill', 'free_swing', 'other')),
  usable boolean not null default true,
  notes text not null default '',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (practice_session_id, rep_number)
);
create index practice_repetitions_session_idx on practice_repetitions (practice_session_id);
create trigger practice_repetitions_touch before update on practice_repetitions
  for each row execute function touch_updated_at();
alter table practice_repetitions enable row level security;
create policy coach_rw_own_team on practice_repetitions for all to authenticated
  using (is_coach_for_entry(game_log_entry_id))
  with check (
    is_coach_for_entry(game_log_entry_id)
    and is_coach_for_player((select player_id from practice_sessions where id = practice_session_id))
    and (select player_id from practice_sessions where id = practice_session_id)
      = (select player_id from game_log_entries where id = game_log_entry_id)
  );

-- ---------------------------------------------------------------------------
-- Clips are evidence attached to a pitch or a practice rep
-- ---------------------------------------------------------------------------
alter table video_clips
  add column at_bat_pitch_id uuid references at_bat_pitches (id) on delete set null,
  add column practice_repetition_id uuid references practice_repetitions (id) on delete set null,
  add constraint video_clips_one_source check (at_bat_pitch_id is null or practice_repetition_id is null);
create index video_clips_pitch_idx on video_clips (at_bat_pitch_id);
create index video_clips_rep_idx on video_clips (practice_repetition_id);

create or replace function check_video_clip_link()
returns trigger
language plpgsql
as $$
begin
  if new.at_bat_pitch_id is not null and not exists (
    select 1 from at_bat_pitches where id = new.at_bat_pitch_id and game_log_entry_id = new.game_log_entry_id
  ) then
    raise exception 'clip''s pitch belongs to a different at-bat';
  end if;
  if new.practice_repetition_id is not null and not exists (
    select 1 from practice_repetitions where id = new.practice_repetition_id and game_log_entry_id = new.game_log_entry_id
  ) then
    raise exception 'clip''s practice rep belongs to a different session entry';
  end if;
  return new;
end;
$$;
create trigger video_clips_link_check before insert or update of at_bat_pitch_id, practice_repetition_id, game_log_entry_id on video_clips
  for each row execute function check_video_clip_link();

-- ---------------------------------------------------------------------------
-- Observations: coach judgment about a priority, linked to evidence
-- ---------------------------------------------------------------------------
create table player_priority_observations (
  id uuid primary key default gen_random_uuid(),
  player_priority_id uuid not null references player_priorities (id) on delete cascade,
  video_clip_id uuid references video_clips (id) on delete set null,
  practice_repetition_id uuid references practice_repetitions (id) on delete set null,
  at_bat_pitch_id uuid references at_bat_pitches (id) on delete set null,
  practice_session_id uuid references practice_sessions (id) on delete set null,
  phase text,
  observed_at timestamptz not null default now(),
  status text not null check (status in ('improving', 'unchanged', 'worse', 'resolved', 'unclear')),
  coach_note text not null default '',
  ai_suggestion text,
  confidence text check (confidence in ('high', 'medium', 'low')),
  -- 'game' | 'practice', derived from the linked evidence; drives game-transfer views.
  context text check (context in ('game', 'practice')),
  created_by uuid references auth.users (id) default auth.uid(),
  created_at timestamptz not null default now()
);
create index player_priority_observations_idx on player_priority_observations (player_priority_id, observed_at desc);
create index player_priority_observations_clip_idx on player_priority_observations (video_clip_id);

create or replace function set_observation_context()
returns trigger
language plpgsql
as $$
declare
  entry_id uuid;
  ctx text;
begin
  if new.context is null then
    entry_id := null;
    if new.at_bat_pitch_id is not null then
      select game_log_entry_id into entry_id from at_bat_pitches where id = new.at_bat_pitch_id;
    elsif new.practice_repetition_id is not null then
      select game_log_entry_id into entry_id from practice_repetitions where id = new.practice_repetition_id;
    elsif new.video_clip_id is not null then
      select game_log_entry_id into entry_id from video_clips where id = new.video_clip_id;
    elsif new.practice_session_id is not null then
      new.context := 'practice';
    end if;
    if entry_id is not null then
      select session_type into ctx from game_log_entries where id = entry_id;
      new.context := ctx;
    end if;
  end if;
  return new;
end;
$$;
create trigger player_priority_observations_context before insert on player_priority_observations
  for each row execute function set_observation_context();

-- Keeps the priority's last_observed_at current so "follow-ups due" and
-- "recent progress" don't need to scan observations.
create or replace function touch_priority_last_observed()
returns trigger
language plpgsql
as $$
begin
  update player_priorities set last_observed_at = new.observed_at
  where id = new.player_priority_id
    and (last_observed_at is null or last_observed_at < new.observed_at);
  return null;
end;
$$;
create trigger player_priority_observations_touch after insert on player_priority_observations
  for each row execute function touch_priority_last_observed();

alter table player_priority_observations enable row level security;
create policy coach_rw_own_team on player_priority_observations for all to authenticated
  using (is_coach_for_team((select team_id from player_priorities where id = player_priority_id)))
  with check (is_coach_for_team((select team_id from player_priorities where id = player_priority_id)));

-- ---------------------------------------------------------------------------
-- Issues: structured coaching draft + review state (AI drafts, coach decides)
-- ---------------------------------------------------------------------------
alter table issues
  add column review_status text not null default 'draft'
    check (review_status in ('draft', 'approved', 'edited', 'rejected')),
  add column evidence text not null default '',
  add column coaching_cue text not null default '',
  add column suggested_drill text,
  add column look_for_next text not null default '',
  add column confidence text check (confidence in ('high', 'medium', 'low')),
  add column video_clip_id uuid references video_clips (id) on delete set null,
  add column phase text,
  add column suggested_priority_title text;
update issues set review_status = 'approved' where reviewed_by is not null;
create index issues_player_status_idx on issues (player_id, review_status);

alter table game_log_entries
  add column ai_summary text,
  add column ai_summary_generated_at timestamptz;

-- ---------------------------------------------------------------------------
-- Data migration: existing clips become evidence on pitches / practice reps.
-- Idempotent and non-destructive - only fills the new nullable links.
-- ---------------------------------------------------------------------------

-- 1. Game at-bats: one pitch per existing clip (the UI already presented each
--    clip as "Pitch N" by position, so pitch N == clip N). Numbering is dense.
create temp table _ranked_game_clips on commit preserve rows as
select vc.id as clip_id,
       vc.game_log_entry_id as entry_id,
       row_number() over (partition by vc.game_log_entry_id order by vc.position, vc.created_at, vc.id) as n
from video_clips vc
join game_log_entries g on g.id = vc.game_log_entry_id
where g.session_type = 'game' and vc.at_bat_pitch_id is null;

insert into at_bat_pitches (game_log_entry_id, pitch_number)
select r.entry_id, r.n
from _ranked_game_clips r
on conflict (game_log_entry_id, pitch_number) do nothing;

update video_clips vc
set at_bat_pitch_id = p.id
from _ranked_game_clips r
join at_bat_pitches p on p.game_log_entry_id = r.entry_id and p.pitch_number = r.n
where vc.id = r.clip_id and vc.at_bat_pitch_id is null;

-- 2. Copy the at-bat-level pitch metadata onto the last pitch only (the legacy
--    columns described the at-bat's final pitch); never invent metadata for the
--    earlier pitches.
update at_bat_pitches p
set pitch_location = coalesce(p.pitch_location, g.pitch),
    pitch_zone = coalesce(p.pitch_zone, g.pitch_zone),
    pitch_outcome = coalesce(p.pitch_outcome, case g.pitch_outcome
        when 'take' then 'take'
        when 'foul' then 'foul'
        when 'ball_in_play' then 'ball_in_play'
        else null end),
    swung = coalesce(p.swung, case g.pitch_outcome
        when 'take' then false
        when 'foul' then true
        when 'ball_in_play' then true
        else null end)
from game_log_entries g
where g.id = p.game_log_entry_id
  and g.session_type = 'game'
  and p.pitch_number = (select max(p2.pitch_number) from at_bat_pitches p2 where p2.game_log_entry_id = p.game_log_entry_id);

-- 3. Practice: a session per (player, date); a rep per practice entry.
insert into practice_sessions (player_id, session_date, notes)
select g.player_id, g.date, coalesce(string_agg(distinct g.session_note, '; ') filter (where g.session_note is not null), '')
from game_log_entries g
where g.session_type = 'practice'
group by g.player_id, g.date
on conflict (player_id, session_date) do nothing;

insert into practice_repetitions (practice_session_id, game_log_entry_id, rep_number)
select s.id, g.id, g.ab
from game_log_entries g
join practice_sessions s on s.player_id = g.player_id and s.session_date = g.date
where g.session_type = 'practice'
on conflict (game_log_entry_id) do nothing;

update video_clips vc
set practice_repetition_id = r.id
from practice_repetitions r
where r.game_log_entry_id = vc.game_log_entry_id and vc.practice_repetition_id is null;

drop table _ranked_game_clips;
