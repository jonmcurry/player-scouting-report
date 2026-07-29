-- Real bug found while verifying the pose3d storage optimization (00012):
-- migrate.ts's replaceGameLogs() used to DELETE every one of a player's
-- game_log_entries rows and re-INSERT fresh ones (fresh gen_random_uuid()
-- ids) on every re-run - and video_clips.game_log_entry_id references
-- game_log_entries ON DELETE CASCADE, so any video/pose3d data already
-- ingested for those at-bats was silently destroyed by simply re-running
-- migrate.ts again (e.g. after editing a report's notes, or - what actually
-- happened - re-running it to verify an unrelated title-text change).
--
-- (player_id, date, opponent, ab) is already the de facto natural key this
-- codebase treats as unique - src/services/db/videoClipUpsert.ts's
-- findGameLogEntryId() already does a `.single()` lookup on exactly these
-- four columns, which only works correctly if they're already unique in
-- practice. Confirmed zero real duplicate (player_id, date, opponent, ab)
-- tuples exist today before adding this as a real constraint, not just an
-- assumption.
alter table game_log_entries
  add constraint game_log_entries_natural_key unique (player_id, date, opponent, ab);
