-- Follow-up bookkeeping for priorities, and per-clip analysis-quality summary.

-- When a follow-up was set: "review next practice / next game / after N swings" is
-- evaluated against activity that happened AFTER this moment, so it can't be
-- derived from created_at/updated_at (edited for unrelated reasons).
alter table player_priorities add column follow_up_set_at timestamptz;
update player_priorities set follow_up_set_at = updated_at where follow_up_kind is not null;

create or replace function stamp_priority_followup()
returns trigger
language plpgsql
as $$
begin
  if new.follow_up_kind is not null and (
       tg_op = 'INSERT'
       or new.follow_up_kind is distinct from old.follow_up_kind
       or new.follow_up_date is distinct from old.follow_up_date
       or new.follow_up_swings is distinct from old.follow_up_swings) then
    new.follow_up_set_at = now();
    new.follow_up_done_at = null;
  elsif new.follow_up_kind is null then
    new.follow_up_set_at = null;
    new.follow_up_done_at = null;
  end if;
  return new;
end;
$$;
create trigger player_priorities_followup_stamp before insert or update on player_priorities
  for each row execute function stamp_priority_followup();

-- Plain-language quality summary written at ingest time (see
-- src/services/db/analysisQuality.ts): pose/bat coverage, contact confidence,
-- 3D reconstruction quality, occlusion, handedness confidence, each rated
-- good / limited / poor. Nullable: clips processed before this existed simply
-- have no summary and the coach UI says so instead of inventing one.
alter table video_clip_metrics add column analysis_quality jsonb;
