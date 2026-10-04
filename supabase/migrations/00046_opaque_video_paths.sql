-- New raw uploads use opaque entry and clip UUIDs. Keep the legacy path
-- verifier only for deleting old objects until the separate storage migration
-- has copied them. Shared and guardian video reads reject legacy paths.
-- Direct row deletion must not bypass GCS cleanup and the audit trail.

alter table public.clip_deletions add column game_log_entry_id uuid;
update public.clip_deletions d set game_log_entry_id = c.game_log_entry_id
  from public.video_clips c where c.id = d.clip_id and d.game_log_entry_id is null;

-- Coaches insert pending video_clips directly. Enforce the same opaque path
-- invariant that guardian_register_clip checks, including on later path
-- changes. Historical rows are left alone unless their raw path changes.
create or replace function public.video_clips_validate_raw_path()
returns trigger language plpgsql set search_path = '' as $$
declare
  v_object text;
  v_prefix text;
  v_ext text;
begin
  if new.raw_gcs_path is null then return new; end if;
  if tg_op = 'UPDATE' then
    if new.raw_gcs_path is not distinct from old.raw_gcs_path then return new; end if;
  end if;
  v_object := substring(new.raw_gcs_path from '^gs://[a-z0-9][a-z0-9._-]*/(.+)$');
  -- The copy migration uses the row UUID; a new browser upload uses its
  -- opaque clip_slug UUID before the row ID exists.
  v_prefix := new.game_log_entry_id::text || '/raw/' || new.id::text || '.';
  if v_object is not null and left(v_object, length(v_prefix)) <> v_prefix
     and new.clip_slug ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' then
    v_prefix := new.game_log_entry_id::text || '/raw/' || new.clip_slug || '.';
  end if;
  if v_object is null or left(v_object, length(v_prefix)) <> v_prefix then raise exception 'invalid raw video path'; end if;
  v_ext := substr(v_object, length(v_prefix) + 1);
  if v_ext !~ '^[A-Za-z0-9]{1,10}$' then raise exception 'invalid raw video extension'; end if;
  return new;
end;
$$;
create trigger video_clips_raw_path_check before insert or update of raw_gcs_path on public.video_clips
  for each row execute function public.video_clips_validate_raw_path();
revoke all on function public.video_clips_validate_raw_path() from public, anon, authenticated;

drop policy if exists coach_rw_own_team on public.video_clips;
create policy coach_select_own_team on public.video_clips for select to authenticated
  using (public.is_coach_for_team((
    select p.team_id from public.game_log_entries g join public.players p on p.id = g.player_id
    where g.id = game_log_entry_id
  )));
create policy coach_insert_own_team on public.video_clips for insert to authenticated
  with check (public.is_coach_for_team((
    select p.team_id from public.game_log_entries g join public.players p on p.id = g.player_id
    where g.id = game_log_entry_id
  )));
create policy coach_update_own_team on public.video_clips for update to authenticated
  using (public.is_coach_for_team((
    select p.team_id from public.game_log_entries g join public.players p on p.id = g.player_id
    where g.id = game_log_entry_id
  )))
  with check (public.is_coach_for_team((
    select p.team_id from public.game_log_entries g join public.players p on p.id = g.player_id
    where g.id = game_log_entry_id
  )));

create or replace function public.prevent_entry_delete_with_clips()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  if exists (select 1 from public.video_clips where game_log_entry_id = old.id) then
    raise exception 'delete clips through delete-clip before deleting an at-bat';
  end if;
  return old;
end;
$$;
create trigger game_log_entries_keep_clips_before_delete
  before delete on public.game_log_entries for each row
  execute function public.prevent_entry_delete_with_clips();
revoke all on function public.prevent_entry_delete_with_clips() from public, anon, authenticated;

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
begin
  if auth.uid() is null or coalesce((auth.jwt() ->> 'is_anonymous')::boolean, false) then
    return false;
  end if;
  select g.player_id, p.team_id into v_player_id, v_team_id
  from public.video_clips c
  join public.game_log_entries g on g.id = c.game_log_entry_id
  join public.players p on p.id = g.player_id
  where c.id = p_clip_id;
  if v_player_id is null then
    return false;
  end if;
  return public.is_coach_for_team(v_team_id)
    or public.is_guardian_for_player(v_player_id);
end;
$$;

create or replace function public.guardian_register_clip(p_entry_id uuid, p_clip_slug text, p_raw_gcs_path text)
returns uuid
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_player_id uuid;
  v_object text;
  v_prefix text;
  v_ext text;
  v_count integer;
  v_id uuid;
begin
  if auth.uid() is null then
    raise exception 'not authenticated';
  end if;
  if coalesce((auth.jwt() ->> 'is_anonymous')::boolean, false) then
    raise exception 'not allowed';
  end if;

  select g.player_id into v_player_id
  from public.game_log_entries g
  where g.id = p_entry_id;
  if v_player_id is null or not public.is_guardian_for_player(v_player_id) then
    raise exception 'not allowed';
  end if;

  if p_clip_slug is null or p_clip_slug !~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' then
    raise exception 'invalid clip slug';
  end if;
  v_object := substring(p_raw_gcs_path from '^gs://[a-z0-9][a-z0-9._-]*/(.+)$');
  v_prefix := p_entry_id::text || '/raw/' || p_clip_slug || '.';
  if v_object is null or left(v_object, length(v_prefix)) <> v_prefix then
    raise exception 'invalid upload path';
  end if;
  v_ext := substr(v_object, length(v_prefix) + 1);
  if v_ext !~ '^[A-Za-z0-9]{1,10}$' then
    raise exception 'invalid upload path';
  end if;

  -- Rate limit: 10 registered clips per guardian per rolling 24h. Locked per
  -- guardian so concurrent calls can't both slip under the limit.
  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended('guardian_register_clip:' || auth.uid()::text, 0));
  -- A queued browser upload may retry registration after the response was
  -- lost. Return the same clip instead of charging the daily cap twice.
  select id into v_id from public.video_clips
    where game_log_entry_id = p_entry_id and clip_slug = p_clip_slug
      and raw_gcs_path = p_raw_gcs_path and uploaded_by = auth.uid()
      and uploaded_by_role = 'guardian';
  if v_id is not null then return v_id; end if;
  select count(*) into v_count from public.guardian_upload_events
  where user_id = auth.uid() and created_at > now() - interval '1 day';
  if v_count >= 10 then
    raise exception 'rate limited: at most 10 uploads per day';
  end if;

  select count(*) into v_count from public.video_clips where game_log_entry_id = p_entry_id;
  insert into public.video_clips (game_log_entry_id, clip_slug, raw_gcs_path, status, position, uploaded_by, uploaded_by_role)
  values (p_entry_id, p_clip_slug, p_raw_gcs_path, 'pending', v_count, auth.uid(), 'guardian')
  returning id into v_id;

  insert into public.guardian_upload_events (user_id, video_clip_id) values (auth.uid(), v_id);
  return v_id;
end;
$$;

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
  v_migrated_prefix text;
  v_migrated_rest text;
  v_legacy_prefix text;
  v_legacy_rest text;
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
  elsif exists (select 1 from public.player_guardians where user_id = p_requested_by and player_id = v_player_id) then
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
    -- Accept this clip's opaque path or its old team/player path while the
    -- old object is being retired. Other storage objects fail closed.
    v_prefix := 'gs://' || coalesce(p_bucket, '') || '/' || v_clip.game_log_entry_id::text || '/raw/' || v_clip.clip_slug || '.';
    v_rest := substr(v_clip.raw_gcs_path, length(v_prefix) + 1);
    v_migrated_prefix := 'gs://' || coalesce(p_bucket, '') || '/' || v_clip.game_log_entry_id::text || '/raw/' || v_clip.id::text || '.';
    v_migrated_rest := substr(v_clip.raw_gcs_path, length(v_migrated_prefix) + 1);
    v_legacy_prefix := 'gs://' || coalesce(p_bucket, '') || '/' || v_team_slug || '/' || v_player_slug || '/raw/' || v_clip.clip_slug || '.';
    v_legacy_rest := substr(v_clip.raw_gcs_path, length(v_legacy_prefix) + 1);
    if p_bucket is null or p_bucket = '' or (
      (left(v_clip.raw_gcs_path, length(v_prefix)) <> v_prefix or v_rest !~ '^[A-Za-z0-9]{1,10}$')
      and (left(v_clip.raw_gcs_path, length(v_migrated_prefix)) <> v_migrated_prefix or v_migrated_rest !~ '^[A-Za-z0-9]{1,10}$')
      and (left(v_clip.raw_gcs_path, length(v_legacy_prefix)) <> v_legacy_prefix or v_legacy_rest !~ '^[A-Za-z0-9]{1,10}$')
    ) then
      raise exception 'unverified_storage_path';
    end if;
  end if;

  -- 2. Audit row (a retry after a partial failure keeps the first one).
  insert into public.clip_deletions (clip_id, player_slug, clip_slug, game_log_entry_id, raw_gcs_path, requested_by, requested_by_role)
  values (p_clip_id, v_player_slug, v_clip.clip_slug, v_clip.game_log_entry_id, v_clip.raw_gcs_path, p_requested_by, v_role)
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
