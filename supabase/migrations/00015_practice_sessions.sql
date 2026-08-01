-- Adds support for logging batting-practice/lesson sessions alongside real
-- game at-bats. Reuses game_log_entries (and everything already hung off it
-- via game_log_entry_id - video_clips, the upload/processing pipeline,
-- checklist scoring, skeleton comparison) rather than a parallel table -
-- see NEXT_STEPS.md's "batting-lesson" entry for the reasoning. A practice
-- session has no live opponent or at-bat outcome, so those columns become
-- optional; a new session_note column is practice's own free-text
-- equivalent of "opponent" (e.g. "tee work", "front toss").
alter table game_log_entries
  add column session_type text not null default 'game'
    check (session_type in ('game', 'practice')),
  alter column opponent drop not null,
  alter column result drop not null,
  add column session_note text;

-- The existing natural-key uniqueness (00013, (player_id, date, opponent,
-- ab)) keeps working unmodified for game rows - practice rows always have a
-- NULL opponent, and Postgres never treats two NULLs as equal for a unique
-- constraint, so practice rows never collide against it (or each other)
-- through that constraint. That means practice rows would have NO
-- duplicate-prevention at all without a constraint of their own - this
-- partial index is that constraint, scoped to session_type='practice' so it
-- never interacts with the game natural key above.
create unique index game_log_entries_practice_natural_key
  on game_log_entries (player_id, date, ab)
  where session_type = 'practice';

comment on column game_log_entries.session_type is
  'game (default) or practice - see 00015_practice_sessions.sql. Every query that computes a real-game stat (at-bat counts, "Early Read" status, the public report''s at-bat-outcome correlation, which relies on `position` being a contiguous per-player GAME ordinal) must filter to session_type=''game'' or practice rows will corrupt it.';
