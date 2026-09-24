-- Fix: phantom blank pitches created by the upload worker.
--
-- link_new_clip_to_pitch_or_rep() (00027) is a BEFORE INSERT trigger on
-- video_clips. ingestPhases' findOrCreateVideoClip() saves an ALREADY
-- EXISTING clip row with INSERT ... ON CONFLICT (game_log_entry_id,
-- clip_slug) DO UPDATE, and Postgres fires BEFORE INSERT triggers before it
-- detects the conflict. When every pitch in the at-bat was already linked to
-- a clip, the trigger therefore inserted a brand-new blank at_bat_pitches row
-- as a side effect - then the conflict turned the statement into an UPDATE of
-- the existing clip, leaving that blank pitch orphaned in the at-bat's
-- sequence. Reproduced 2026-09-23 on the local stack: one phantom pitch per
-- processed game at-bat.
--
-- The fix is the minimum: if a row with this (game_log_entry_id, clip_slug)
-- already exists, this INSERT is going to resolve as a conflict, so the
-- trigger must not create or claim anything. Behavior for a genuinely new
-- clip is unchanged.
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
  if exists (
    select 1 from video_clips vc
    where vc.game_log_entry_id = new.game_log_entry_id and vc.clip_slug = new.clip_slug
  ) then
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
