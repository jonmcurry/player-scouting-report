-- Adds upload/processing status tracking to video_clips, for the coach app's
-- new browser-upload flow: a coach uploads a raw clip straight from their
-- phone, and a background worker (running on a machine with the pose3d
-- pipeline's .venv_pose3d - see scripts/pose3d/README.md) picks it up and
-- finishes the job automatically, without a per-clip CLI command.
--
-- status defaults to 'ready' so every EXISTING row (all CLI-uploaded via
-- uploadClip.ts, already has a real gcs_path) is unaffected - no backfill
-- needed. New browser-uploaded rows are inserted with status='pending'
-- explicitly by the coach app itself.

alter table video_clips
  add column status text not null default 'ready'
    check (status in ('pending', 'processing', 'ready', 'failed')),
  add column error_message text,
  -- Separate from the existing gcs_path column on purpose: gcs_path keeps
  -- meaning exactly what it means today ("the final, browser-playable H.264
  -- file uploadClip.ts wrote"), staying null until that step actually runs -
  -- so a half-processed clip can never look finished to player.html's
  -- existing `if (!clip.gcs_path) return` gate. raw_gcs_path is only ever
  -- read by the worker, to know what to download and process.
  add column raw_gcs_path text,
  -- Set when the worker atomically claims a pending row (status flips to
  -- 'processing') - lets a stuck/crashed claim be spotted later, even
  -- though automatic lease/timeout recovery isn't built this pass (see the
  -- approved plan's "real open risks" section).
  add column claimed_at timestamptz;
