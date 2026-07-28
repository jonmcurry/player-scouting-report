-- Restores content that existed in the real report HTML but was never
-- represented in Supabase: the "2-5. Diagnosis, Comps & Plan" section's
-- Reference Comp table, Drill Recommendations list, and Follow-up fields.
-- ("Primary Issue(s) Identified", the 4th sub-section, is already the
-- `issues` table from 00001 - no change needed there.)
--
-- Confirmed by reading real report files directly, not guessed: comp-row
-- count and comp-note count vary independently (1 comp/1 note in one real
-- file; 2 comps/1 note and 2 comps/2 notes in the two example fixtures), and
-- drills vary 0-2. Real child tables, not jsonb columns - a coach needs to
-- edit/delete/reorder one row independently of the others, which a real
-- table gives for free and a jsonb array read-modify-written from the
-- browser does not. Same shape as the existing `issues`/`game_log_entries`
-- tables, not a new pattern.

create table comp_recommendations (
  id uuid primary key default gen_random_uuid(),
  player_id uuid not null references players (id) on delete cascade,
  comp_name text not null,   -- e.g. "Sierra Romero (softball, Michigan)"
  cue text not null,         -- the tailored explanation for THIS player's issue
  position smallint not null default 0,
  created_at timestamptz not null default now()
);

-- Separate table from comp_recommendations, not a column on it: note count
-- varies independently of comp-row count in real data, and a note is often
-- about a comp that was considered and REJECTED, not one of the rows above.
create table comp_notes (
  id uuid primary key default gen_random_uuid(),
  player_id uuid not null references players (id) on delete cascade,
  note text not null,
  position smallint not null default 0,
  created_at timestamptz not null default now()
);

create table drill_recommendations (
  id uuid primary key default gen_random_uuid(),
  player_id uuid not null references players (id) on delete cascade,
  title text not null,
  description text not null,
  position smallint not null default 0,
  created_at timestamptz not null default now()
);

-- Follow-up is never variable-length (always exactly one re-film-by +
-- one what-to-check-next per player), so it doesn't get a table - matches
-- how jersey_number etc. are already plain columns for true 1:1 facts.
alter table players add column refilm_by text;
alter table players add column what_to_check_next text;

alter table comp_recommendations enable row level security;
alter table comp_notes enable row level security;
alter table drill_recommendations enable row level security;

-- Same coach_rw_own_team policy shape already used for issues/game_log_entries
-- in 00001 - zero new access-control design, just three more copies of an
-- already-approved pattern. The two new `players` columns inherit that
-- table's existing policy automatically (it's the same table).
create policy coach_rw_own_team on comp_recommendations
  for all using (is_coach_for_team((select team_id from players where players.id = player_id)))
  with check (is_coach_for_team((select team_id from players where players.id = player_id)));

create policy coach_rw_own_team on comp_notes
  for all using (is_coach_for_team((select team_id from players where players.id = player_id)))
  with check (is_coach_for_team((select team_id from players where players.id = player_id)));

create policy coach_rw_own_team on drill_recommendations
  for all using (is_coach_for_team((select team_id from players where players.id = player_id)))
  with check (is_coach_for_team((select team_id from players where players.id = player_id)));

grant select, insert, update, delete on comp_recommendations, comp_notes, drill_recommendations to authenticated;
grant all on comp_recommendations, comp_notes, drill_recommendations to service_role;
