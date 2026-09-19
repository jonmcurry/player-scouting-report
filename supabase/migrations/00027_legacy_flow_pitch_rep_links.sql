-- Keeps the older "Log At-Bat / Attach Video" and "Log Practice Rep" flows (which only know about
-- game_log_entries + video_clips) consistent with the pitch / practice-rep domain model added in
-- 00025, so nothing recorded through them is invisible to the development pages.
--
--  * A practice entry gets its practice_sessions row (per player+date) and practice_repetitions row.
--  * A clip inserted without an explicit pitch/rep is attached to the entry's first pitch that has
--    no clip yet, or to a new next-numbered pitch; a practice clip is attached to its entry's rep.
-- Explicit links (the new at-bat / session pages set them) are never touched.

create or replace function ensure_practice_rep_for_entry()
returns trigger
language plpgsql
as $$
declare
  sid uuid;
begin
  if new.session_type <> 'practice' then
    return new;
  end if;
  insert into practice_sessions (player_id, session_date, notes)
  values (new.player_id, new.date, coalesce(new.session_note, ''))
  on conflict (player_id, session_date) do nothing;
  select id into sid from practice_sessions where player_id = new.player_id and session_date = new.date;
  insert into practice_repetitions (practice_session_id, game_log_entry_id, rep_number)
  values (sid, new.id, new.ab)
  on conflict do nothing;
  return new;
end;
$$;

drop trigger if exists game_log_entries_practice_rep on game_log_entries;
create trigger game_log_entries_practice_rep after insert on game_log_entries
  for each row execute function ensure_practice_rep_for_entry();

create or replace function link_new_clip_to_pitch_or_rep()
returns trigger
language plpgsql
as $$
declare
  st text;
  pid uuid;
begin
  if new.at_bat_pitch_id is not null or new.practice_repetition_id is not null then
    return new;
  end if;
  select session_type into st from game_log_entries where id = new.game_log_entry_id;
  if st = 'practice' then
    select id into new.practice_repetition_id from practice_repetitions where game_log_entry_id = new.game_log_entry_id;
  elsif st = 'game' then
    select p.id into pid
    from at_bat_pitches p
    where p.game_log_entry_id = new.game_log_entry_id
      and not exists (select 1 from video_clips vc where vc.at_bat_pitch_id = p.id)
    order by p.pitch_number
    limit 1;
    if pid is null then
      insert into at_bat_pitches (game_log_entry_id, pitch_number)
      values (new.game_log_entry_id,
              coalesce((select max(pitch_number) from at_bat_pitches where game_log_entry_id = new.game_log_entry_id), 0) + 1)
      returning id into pid;
    end if;
    new.at_bat_pitch_id := pid;
  end if;
  return new;
end;
$$;

drop trigger if exists video_clips_default_link on video_clips;
create trigger video_clips_default_link before insert on video_clips
  for each row execute function link_new_clip_to_pitch_or_rep();
