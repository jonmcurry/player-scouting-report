-- Real clip deletion (parent pathway, Task 2b). Deleting a clip used to be a
-- row-only `delete from video_clips` from the coach app, which left behind:
--   * the raw video in GCS,
--   * the worker's derived files under frames/<player>/<clipSlug>/,
--   * unreviewed AI drafts (issues.video_clip_id / analysis_runs.video_clip_id
--     are `on delete set null`, so the drafts simply lost their clip link).
-- Deletion now goes through the delete-clip Edge Function:
--   1. can_delete_clip()            - caller's JWT (coach of the team, or the
--                                     guardian who uploaded the clip)
--   2-4. begin_clip_deletion()      - service role: refuse demo-published clips
--                                     (and everything, while any stored demo
--                                     fixture is unreadable) and unverifiable
--                                     storage paths, write the
--                                     audit row, delete drafts / run-derived AI
--                                     output, remember which reviewed findings
--                                     lose their video
--   5. GCS object delete            - in the Edge Function
--   6. finish_clip_deletion()       - service role: stamp gcs_deleted_at, delete
--                                     the video_clips row (cascades phases,
--                                     pose3d frames, metrics)
-- Every step is idempotent, so a retry after a partial failure finishes the
-- job. The worker (src/cli/purgeDeletedClips.ts) later removes the local
-- frames/ directory and stamps local_purged_at.
--
-- analysis_runs rows are kept (video_clip_id becomes null via the FK); their
-- input_manifest may still name the deleted clip's storage paths.
--
-- public only: the demo schema is read-only and gets nothing here.
-- New functions: security definer, `set search_path = ''`, fully qualified.

-- ---------------------------------------------------------------------------
-- 0. Pin search_path on pre-existing trigger functions reached from the new
--    security definer functions (00042 pattern). Their empty search_path is
--    inherited by triggers - including ones fired by FK actions - and these
--    were written for an implicit `public` path (e.g. log_checklist_score_history
--    inserts into an unqualified checklist_score_history). Reached here by:
--      checklist_scores UPDATE           -> log_checklist_score_history
--      issues UPDATE (clip FK set null)  -> snapshot_issue_ai_original
--      player_priorities UPDATE (source_issue_id FK set null when a draft
--        issue is deleted)               -> enforce_priority_team,
--                                           stamp_priority_followup, log_priority_status
--    (video_clips' own triggers and checklist_scores_derive_review_status are
--    already pinned; the observation triggers fire on INSERT only.) public.*
--    versions only - the demo schema's same-named functions are untouched.
--    No behavior change for any existing caller.
-- ---------------------------------------------------------------------------
alter function public.log_checklist_score_history() set search_path = public;
alter function public.snapshot_issue_ai_original() set search_path = public;
alter function public.enforce_priority_team() set search_path = public;
alter function public.stamp_priority_followup() set search_path = public;
alter function public.log_priority_status() set search_path = public;

-- ---------------------------------------------------------------------------
-- 1. Audit trail + worker purge queue. Service role only (no policies).
-- ---------------------------------------------------------------------------
create table public.clip_deletions (
  clip_id uuid primary key, -- no FK: the clip row is gone once deletion finishes
  player_slug text not null,
  clip_slug text not null,
  raw_gcs_path text,
  -- on delete set null: deleting the requester's account must not be blocked
  -- by (or erase) the audit row; requested_by_role still records who it was.
  requested_by uuid references auth.users (id) on delete set null,
  requested_by_role text not null check (requested_by_role in ('coach', 'guardian')),
  requested_at timestamptz not null default now(),
  gcs_deleted_at timestamptz,
  local_purged_at timestamptz
);
create index clip_deletions_unpurged_idx on public.clip_deletions (requested_at) where local_purged_at is null;
alter table public.clip_deletions enable row level security;
revoke all on public.clip_deletions from anon, authenticated, public;
grant all on public.clip_deletions to service_role;
comment on table public.clip_deletions is
  'One row per deleted clip (delete-clip Edge Function): audit trail and the worker''s local-file purge queue. gcs_deleted_at = the storage step finished (object deleted, already absent, or the clip had no stored object). Service role only.';

-- Reviewed findings whose evidence clip was deleted. Their text stays (they
-- are coach conclusions); this records that the video is gone and who removed
-- it, so the app can say "Video removed by family" instead of guessing why a
-- finding has no clip (legacy findings never had one).
create table public.clip_removed_findings (
  issue_id uuid primary key references public.issues (id) on delete cascade,
  clip_id uuid not null references public.clip_deletions (clip_id) on delete cascade,
  removed_by_role text not null check (removed_by_role in ('coach', 'guardian')),
  removed_at timestamptz not null default now()
);
create index clip_removed_findings_clip_idx on public.clip_removed_findings (clip_id);
alter table public.clip_removed_findings enable row level security;
revoke all on public.clip_removed_findings from anon, authenticated, public;
grant all on public.clip_removed_findings to service_role;
comment on table public.clip_removed_findings is
  'Reviewed issues whose clip was deleted through delete-clip, with who removed it. Read through clip_removals_for_player(). Service role only.';

-- ---------------------------------------------------------------------------
-- 2. Who may delete a clip (checked with the caller's JWT).
-- ---------------------------------------------------------------------------
create or replace function public.can_delete_clip(p_clip_id uuid)
returns boolean
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_player_id uuid;
  v_team_id uuid;
  v_uploaded_by uuid;
begin
  if auth.uid() is null or coalesce((auth.jwt() ->> 'is_anonymous')::boolean, false) then
    return false;
  end if;
  select g.player_id, p.team_id, c.uploaded_by into v_player_id, v_team_id, v_uploaded_by
  from public.video_clips c
  join public.game_log_entries g on g.id = c.game_log_entry_id
  join public.players p on p.id = g.player_id
  where c.id = p_clip_id;
  if v_player_id is null then
    return false;
  end if;
  return public.is_coach_for_team(v_team_id)
    or (public.is_guardian_for_player(v_player_id) and v_uploaded_by = auth.uid());
end;
$$;

-- ---------------------------------------------------------------------------
-- 3. Is this clip in a stored demo fixture? Stored fixtures never carry a
--    source clip id: the exporter maps it to a deterministic fixture id
--    (src/services/demoExport/ids.ts fixtureUuid, format v1):
--      sha256("hitterloop-demo-fixture:v1\0" || fixtureId || "\0video_clips\0" || sourceClipId)
--    -> first 32 hex chars, version nibble 8, RFC variant bits. Recomputing it
--    per stored fixture identifies the clip without storing any source id.
-- ---------------------------------------------------------------------------
create or replace function public.demo_fixture_clip_uuid(p_fixture_id text, p_clip_id uuid)
returns uuid
language sql
immutable
set search_path = ''
as $$
  select (substr(h, 1, 12) || '8' || substr(h, 14, 3)
          || pg_catalog.to_hex(((('x' || substr(h, 17, 1))::bit(4)::int) & 3) | 8)
          || substr(h, 18, 15))::uuid
  from (select pg_catalog.encode(extensions.digest(
          pg_catalog.convert_to('hitterloop-demo-fixture:v1', 'UTF8') || '\x00'::bytea
          || pg_catalog.convert_to(p_fixture_id, 'UTF8') || '\x00'::bytea
          || pg_catalog.convert_to('video_clips', 'UTF8') || '\x00'::bytea
          || pg_catalog.convert_to(p_clip_id::text, 'UTF8'), 'sha256'), 'hex') as h) d;
$$;

create or replace function public.clip_in_stored_demo_fixture(p_clip_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1
    from demo.demo_real_fixtures f
    cross join lateral (
      select distinct x.fid from (values (f.payload ->> 'fixtureId'), (f.fixture_id)) as x(fid) where x.fid is not null
    ) ids
    cross join lateral jsonb_array_elements(
      case when jsonb_typeof(f.payload -> 'tables' -> 'video_clips') = 'array' then f.payload -> 'tables' -> 'video_clips' else '[]'::jsonb end
    ) v
    where v.value ->> 'id' = public.demo_fixture_clip_uuid(ids.fid, p_clip_id)::text
  );
$$;

-- The check above is only trustworthy for fixtures in the exact shape it was
-- written for. Any stored fixture in another shape (unknown format/version,
-- another exporter or id scheme, no fixtureId, video_clips not an array of
-- string ids) makes "is this clip in the public demo?" unanswerable, so
-- begin_clip_deletion refuses every deletion until a human reviews it.
create or replace function public.unrecognized_demo_fixture_count()
returns integer
language sql
stable
security definer
set search_path = ''
as $$
  select count(*)::integer
  from demo.demo_real_fixtures f
  where not (
    coalesce(f.payload ->> 'format' = 'hitterloop-demo-fixture', false)
    and coalesce(f.payload -> 'formatVersion' = '1'::jsonb, false)
    and coalesce(f.payload -> 'exporter' ->> 'name' = 'hitterloop-export-demo-fixture', false)
    and coalesce(f.payload -> 'exporter' -> 'version' = '1'::jsonb, false)
    and coalesce(jsonb_typeof(f.payload -> 'fixtureId') = 'string' and f.payload ->> 'fixtureId' <> '', false)
    and coalesce(jsonb_typeof(f.payload -> 'tables' -> 'video_clips') = 'array', false)
    and not exists (
      select 1 from jsonb_array_elements(
        case when jsonb_typeof(f.payload -> 'tables' -> 'video_clips') = 'array' then f.payload -> 'tables' -> 'video_clips' else '[]'::jsonb end
      ) v
      where jsonb_typeof(v.value -> 'id') is distinct from 'string'
    )
  );
$$;

-- ---------------------------------------------------------------------------
-- 4. Steps 2-4 (service role, one transaction). Returns where the raw object
--    lives so the Edge Function can delete it (step 5).
-- ---------------------------------------------------------------------------
create or replace function public.begin_clip_deletion(p_clip_id uuid, p_requested_by uuid, p_bucket text)
returns jsonb
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_clip public.video_clips;
  v_player_id uuid;
  v_player_slug text;
  v_team_id uuid;
  v_team_slug text;
  v_role text;
  v_prefix text;
  v_rest text;
  v_runs uuid[];
begin
  select * into v_clip from public.video_clips where id = p_clip_id for update;
  if not found then
    raise exception 'clip not found';
  end if;
  select g.player_id, p.slug, p.team_id, t.slug into v_player_id, v_player_slug, v_team_id, v_team_slug
  from public.game_log_entries g
  join public.players p on p.id = g.player_id
  join public.teams t on t.id = p.team_id
  where g.id = v_clip.game_log_entry_id;

  -- Same rule as can_delete_clip, re-derived for the requester (this runs as
  -- the service role, so auth.uid() is not the caller here).
  if exists (select 1 from public.coach_team_access where coach_id = p_requested_by and team_id = v_team_id) then
    v_role := 'coach';
  elsif v_clip.uploaded_by = p_requested_by
        and exists (select 1 from public.player_guardians where user_id = p_requested_by and player_id = v_player_id) then
    v_role := 'guardian';
  else
    raise exception 'not allowed';
  end if;

  -- Refusals come before anything is changed. Fail closed: a stored fixture
  -- this check can't read means we can't rule out public media.
  if public.unrecognized_demo_fixture_count() > 0 then
    raise exception 'demo_fixture_unrecognized';
  end if;
  if public.clip_in_stored_demo_fixture(p_clip_id) then
    raise exception 'clip_in_demo_fixture';
  end if;
  if v_clip.raw_gcs_path is not null then
    -- Only ever delete this clip's own upload: gs://<bucket>/<team>/<player>/raw/<file>.
    -- raw_gcs_path is client-written on the coach path, so it is never trusted
    -- to point anywhere else (e.g. another player's footage).
    v_prefix := 'gs://' || coalesce(p_bucket, '') || '/' || v_team_slug || '/' || v_player_slug || '/raw/';
    v_rest := substr(v_clip.raw_gcs_path, length(v_prefix) + 1);
    if p_bucket is null or p_bucket = '' or left(v_clip.raw_gcs_path, length(v_prefix)) <> v_prefix
       or v_rest = '' or strpos(v_rest, '/') > 0 then
      raise exception 'unverified_storage_path';
    end if;
  end if;

  -- 2. Audit row (a retry after a partial failure keeps the first one).
  insert into public.clip_deletions (clip_id, player_slug, clip_slug, raw_gcs_path, requested_by, requested_by_role)
  values (p_clip_id, v_player_slug, v_clip.clip_slug, v_clip.raw_gcs_path, p_requested_by, v_role)
  on conflict (clip_id) do nothing;

  select coalesce(array_agg(id), '{}') into v_runs from public.analysis_runs where video_clip_id = p_clip_id;

  -- Reviewed findings keep their text; remember that their video is gone.
  insert into public.clip_removed_findings (issue_id, clip_id, removed_by_role)
  select i.id, p_clip_id, v_role from public.issues i
  where i.video_clip_id = p_clip_id and i.review_status <> 'draft'
  on conflict (issue_id) do nothing;

  -- 3. Unreviewed AI findings from this clip.
  delete from public.issues
  where review_status = 'draft' and (video_clip_id = p_clip_id or analysis_run_id = any (v_runs));

  -- 4. AI output derived from this clip's analysis runs. Only the analyzer
  --    (src/cli/analyze.ts) ever sets analysis_run_id on comp_recommendations,
  --    comp_notes and drill_recommendations (no coach path writes them), and
  --    those tables have no review column - every row with the run id is AI output.
  --    checklist_scores: only rows still ai_draft. A coach-reviewed checkpoint is
  --    a coach conclusion and stays. An ai_draft row whose history holds a coach
  --    decision (a forced re-analysis overwrote it) keeps the row and that history
  --    but loses the AI draft values.
  delete from public.checklist_scores s
  where s.analysis_run_id = any (v_runs) and s.review_status = 'ai_draft'
    and not exists (select 1 from public.checklist_score_history h where h.checklist_score_id = s.id and h.changed_by is not null);
  update public.checklist_scores s
  set score = null, ai_draft = null, notes = '', source = null, analysis_run_id = null
  where s.analysis_run_id = any (v_runs) and s.review_status = 'ai_draft';
  delete from public.comp_recommendations where analysis_run_id = any (v_runs);
  delete from public.comp_notes where analysis_run_id = any (v_runs);
  delete from public.drill_recommendations where analysis_run_id = any (v_runs);

  return jsonb_build_object('raw_gcs_path', v_clip.raw_gcs_path, 'role', v_role);
end;
$$;

-- Step 5 is done (object deleted or never stored) -> stamp it, then step 6.
create or replace function public.finish_clip_deletion(p_clip_id uuid)
returns void
language plpgsql
volatile
security definer
set search_path = ''
as $$
begin
  update public.clip_deletions set gcs_deleted_at = coalesce(gcs_deleted_at, now()) where clip_id = p_clip_id;
  if not found then
    raise exception 'no deletion in progress for this clip';
  end if;
  delete from public.video_clips where id = p_clip_id;
end;
$$;

-- ---------------------------------------------------------------------------
-- 5. Which of a player's findings lost their video, and who removed it.
--    Coaches of the player's team only. Guardian reads of development data go
--    only through get-family-report (Task 4 serves this there).
-- ---------------------------------------------------------------------------
create or replace function public.clip_removals_for_player(p_player_id uuid)
returns table (issue_id uuid, removed_by_role text, removed_at timestamptz)
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_team_id uuid;
begin
  select team_id into v_team_id from public.players where id = p_player_id;
  if auth.uid() is null or v_team_id is null or not public.is_coach_for_team(v_team_id) then
    raise exception 'not allowed';
  end if;
  return query
    select r.issue_id, r.removed_by_role, r.removed_at
    from public.clip_removed_findings r
    join public.issues i on i.id = r.issue_id
    where i.player_id = p_player_id and i.video_clip_id is null;
end;
$$;

-- ---------------------------------------------------------------------------
-- 6. Grants: anon nothing; signed-in users only the two caller-checked
--    functions; the deletion steps are service role only.
-- ---------------------------------------------------------------------------
revoke all on function public.can_delete_clip(uuid) from public, anon;
revoke all on function public.clip_removals_for_player(uuid) from public, anon;
revoke all on function public.demo_fixture_clip_uuid(text, uuid) from public, anon, authenticated;
revoke all on function public.clip_in_stored_demo_fixture(uuid) from public, anon, authenticated;
revoke all on function public.unrecognized_demo_fixture_count() from public, anon, authenticated;
revoke all on function public.begin_clip_deletion(uuid, uuid, text) from public, anon, authenticated;
revoke all on function public.finish_clip_deletion(uuid) from public, anon, authenticated;
grant execute on function public.can_delete_clip(uuid) to authenticated, service_role;
grant execute on function public.clip_removals_for_player(uuid) to authenticated, service_role;
grant execute on function public.demo_fixture_clip_uuid(text, uuid) to service_role;
grant execute on function public.clip_in_stored_demo_fixture(uuid) to service_role;
grant execute on function public.unrecognized_demo_fixture_count() to service_role;
grant execute on function public.begin_clip_deletion(uuid, uuid, text) to service_role;
grant execute on function public.finish_clip_deletion(uuid) to service_role;

notify pgrst, 'reload schema';
