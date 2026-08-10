-- Real, confirmed gap: a clip marked status='failed' (src/services/db/
-- uploadQueue.ts's markClipFailed) never became claimable again on its own -
-- claimNextPendingClip's claimable filter only ever looked at 'pending' or
-- stale-'processing' rows. A transient failure (a momentary GCS blip, a
-- flaky download) permanently stranded a clip with no automatic recovery,
-- leaving the existing manual "Retry" button (coach/player.html) as the
-- only way out.
--
-- retry_count: how many automatic attempts a clip has already used, capped
-- by MAX_AUTO_RETRIES in uploadQueue.ts - once exhausted, markClipFailed
-- falls back to today's exact behavior (status='failed', human retry only).
-- next_retry_at: backoff gate so a persistently-broken clip isn't
-- immediately re-claimed by the very next poll tick.
alter table video_clips
  add column retry_count smallint not null default 0,
  add column next_retry_at timestamptz;
