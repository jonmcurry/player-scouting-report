-- Guardian uploads: a linked guardian (00041) can upload their own child's
-- swing video into the existing pipeline. The clip lands as an ordinary
-- status='pending' video_clips row, so the worker (src/services/db/
-- uploadQueue.ts) picks it up exactly like a coach upload.
--
-- Access model (unchanged from 00041): guardians get NO table grants or
-- policies on development data. Every guardian write goes through the
-- security definer RPCs below:
--   * guardian_create_entry  - a game at-bat or practice rep for their child
--   * guardian_register_clip - records an uploaded clip (path validated,
--                              rate limited, provenance stamped)
-- and the get-upload-url Edge Function gates on can_upload_for_entry().
--
-- New functions follow the 00040 convention: security definer,
-- `set search_path = ''`, fully qualified names. That empty search_path is
-- inherited by anything they call that doesn't pin its own, so the
-- pre-existing helpers/triggers those calls reach (all written for an
-- implicit `public` search_path) are pinned to `public` below - no behavior
-- change for any existing caller.

-- ---------------------------------------------------------------------------
-- 1. Pin search_path on existing helpers/triggers reached from the new RPCs.
-- ---------------------------------------------------------------------------
alter function public.is_coach_for_team(uuid) set search_path = public;
alter function public.ensure_practice_rep_for_entry() set search_path = public;
alter function public.link_new_clip_to_pitch_or_rep() set search_path = public;
alter function public.check_video_clip_link() set search_path = public;
alter function public.touch_updated_at() set search_path = public;

-- ---------------------------------------------------------------------------
-- 2. Upload provenance on video_clips - public AND demo (the demo clone and
--    the fixture loader require column parity; 00031/00036).
-- ---------------------------------------------------------------------------
alter table public.video_clips
  add column uploaded_by uuid references auth.users (id) on delete set null,
  add column uploaded_by_role text not null default 'coach'
    constraint video_clips_uploaded_by_role_check check (uploaded_by_role in ('coach', 'guardian'));
-- Every clip before this migration came through a coach-only path, so the
-- 'coach' default is the true value for existing rows (uploaded_by stays
-- null: who exactly uploaded them was never recorded).

alter table demo.video_clips
  add column uploaded_by uuid,
  add column uploaded_by_role text not null default 'coach'
    constraint demo_video_clips_uploaded_by_role_check check (uploaded_by_role in ('coach', 'guardian'));

comment on column public.video_clips.uploaded_by is
  'auth.users id of the uploader: set by guardian_register_clip for guardians, stamped from auth.uid() for direct (coach) client inserts; null for worker/CLI/legacy rows.';
comment on column public.video_clips.uploaded_by_role is
  'coach (default; every pre-00042 clip) or guardian (only guardian_register_clip can set it - client writes are forced to coach by video_clips_stamp_provenance).';
comment on column demo.video_clips.uploaded_by is
  'Always null in the demo (never a real auth identity); kept for column parity with public.video_clips.';

-- Direct client writes (PostgREST as `authenticated`) cannot forge or change
-- provenance: inserts are stamped coach + auth.uid(), updates keep the old
-- values. Security definer RPCs (running as the owner) and the service-role
-- worker/CLI are not affected.
create or replace function public.video_clips_stamp_provenance()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if current_user in ('authenticated', 'anon') then
    if tg_op = 'INSERT' then
      new.uploaded_by := auth.uid();
      new.uploaded_by_role := 'coach';
    else
      new.uploaded_by := old.uploaded_by;
      new.uploaded_by_role := old.uploaded_by_role;
    end if;
  end if;
  return new;
end;
$$;

create trigger video_clips_stamp_provenance
  before insert or update of uploaded_by, uploaded_by_role on public.video_clips
  for each row execute function public.video_clips_stamp_provenance();

-- Real-data demo fixtures exported before this migration have no
-- uploaded_by/uploaded_by_role keys, and demo.clone_real_fixture (00036)
-- rejects any row whose key set doesn't exactly match demo.video_clips -
-- without this, every stored fixture (including the published canonical
-- one) would stop cloning. Fixture rows are upgraded in memory only (the
-- stored payload and its content_sha256 are untouched):
--   * missing uploaded_by_role -> 'coach' (true for every pre-00042 clip)
--   * uploaded_by -> always null; a fixture carrying a real uploader id is
--     refused (it would publish a private auth identity).
create or replace function demo.upgrade_fixture_payload(p_payload jsonb)
returns jsonb
language plpgsql
immutable
set search_path = ''
as $$
declare
  clips jsonb := '[]'::jsonb;
  r jsonb;
begin
  if jsonb_typeof(p_payload->'tables'->'video_clips') is distinct from 'array' then
    return p_payload;
  end if;
  for r in select value from jsonb_array_elements(p_payload->'tables'->'video_clips') loop
    if (r->>'uploaded_by') is not null then
      raise exception 'demo fixture %: video_clips row % carries an uploaded_by identity - fixtures must never include one',
        p_payload->>'fixtureId', r->>'id';
    end if;
    if not (r ? 'uploaded_by_role') then
      r := r || '{"uploaded_by_role": "coach"}'::jsonb;
    end if;
    clips := clips || jsonb_build_array(r || '{"uploaded_by": null}'::jsonb);
  end loop;
  return jsonb_set(p_payload, '{tables,video_clips}', clips);
end;
$$;
revoke all on function demo.upgrade_fixture_payload(jsonb) from public, anon, authenticated;

-- Same body as 00037 apart from the upgrade_fixture_payload() call. This is
-- the only caller of demo.clone_real_fixture (verify_real_fixture and
-- clone_demo_dataset both go through it).
create or replace function demo.clone_fixture_team(p_payload jsonb)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  new_team_id uuid := gen_random_uuid();
  team jsonb := p_payload->'team';
begin
  if team is null or coalesce(btrim(team->>'name'), '') = '' then
    raise exception 'demo fixture % has no publication-approved team name', p_payload->>'fixtureId';
  end if;
  insert into demo.teams (id, slug, name, sport, level_label)
  values (new_team_id, 'demo-' || replace(gen_random_uuid()::text, '-', ''), team->>'name',
          nullif(team->>'sport', ''), nullif(team->>'level_label', ''));
  perform demo.clone_real_fixture(new_team_id, demo.upgrade_fixture_payload(p_payload));
  return new_team_id;
end;
$$;
revoke all on function demo.clone_fixture_team(jsonb) from public, anon, authenticated;

-- ---------------------------------------------------------------------------
-- 3. Per-guardian upload rate limit (00021 pattern: no policies, no client
--    grants; written only inside guardian_register_clip). Each clip costs AI
--    analysis money, so a successful registration is what is counted.
-- ---------------------------------------------------------------------------
create table public.guardian_upload_events (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users (id) on delete cascade,
  video_clip_id uuid references public.video_clips (id) on delete set null,
  created_at timestamptz not null default now()
);
create index guardian_upload_events_user_created_idx on public.guardian_upload_events (user_id, created_at);
alter table public.guardian_upload_events enable row level security;
revoke all on public.guardian_upload_events from anon, authenticated, public;
grant all on public.guardian_upload_events to service_role;
comment on table public.guardian_upload_events is
  'One row per clip a guardian registered (guardian_register_clip). Backs the 10-clips-per-24h per-guardian limit; deleting a clip does not refund the quota. No client access.';

-- ---------------------------------------------------------------------------
-- 4. RPCs
-- ---------------------------------------------------------------------------

-- Current guardian consent text version (00041's app_settings row), so the
-- client can show/send exactly the version accept_guardian_invite expects.
create or replace function public.current_guardian_consent_version()
returns text
language sql
stable
security definer
set search_path = ''
as $$
  select value from public.app_settings where key = 'guardian_consent_version';
$$;

-- Upload gate used by get-upload-url (through the caller's JWT): a coach of
-- the entry's team, or a linked guardian of the entry's player.
create or replace function public.can_upload_for_entry(p_entry_id uuid)
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
  if auth.uid() is null then
    return false;
  end if;
  select g.player_id, p.team_id into v_player_id, v_team_id
  from public.game_log_entries g
  join public.players p on p.id = g.player_id
  where g.id = p_entry_id;
  if v_player_id is null then
    return false;
  end if;
  return public.is_coach_for_team(v_team_id) or public.is_guardian_for_player(v_player_id);
end;
$$;

-- A guardian creates a game at-bat or a practice rep for their own child,
-- shaped exactly like the coach app's own inserts:
--   game:     like logAtBatSheet.js - session_type 'game', ab = next number
--             for that day (guardians record no opponent, so it counts the
--             day's opponent-less at-bats), opponent/result null.
--   practice: like practicePage.js addRep - session_type 'practice', ab = next
--             rep number for that day's session, position = count of the
--             player's practice entries. The 00027 trigger creates the
--             practice_sessions / practice_repetitions rows.
create or replace function public.guardian_create_entry(p_player_id uuid, p_kind text, p_date date)
returns uuid
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_ab smallint;
  v_position smallint;
  v_id uuid;
begin
  if auth.uid() is null then
    raise exception 'not authenticated';
  end if;
  if coalesce((auth.jwt() ->> 'is_anonymous')::boolean, false) then
    raise exception 'not allowed';
  end if;
  if p_player_id is null or not public.is_guardian_for_player(p_player_id) then
    raise exception 'not allowed';
  end if;
  if p_kind is null or p_kind not in ('game', 'practice') then
    raise exception 'invalid kind';
  end if;
  if p_date is null or p_date > current_date + 1 then
    raise exception 'invalid date';
  end if;

  -- Serialize per player so two concurrent creates can't pick the same ab
  -- (the practice natural key would reject the second one).
  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended('guardian_create_entry:' || p_player_id::text, 0));

  if p_kind = 'game' then
    select coalesce(max(ab), 0) + 1 into v_ab from public.game_log_entries
    where player_id = p_player_id and date = p_date and session_type = 'game' and opponent is null;
    insert into public.game_log_entries (player_id, session_type, date, opponent, ab, result)
    values (p_player_id, 'game', p_date, null, v_ab, null)
    returning id into v_id;
  else
    select coalesce(max(ab), 0) + 1 into v_ab from public.game_log_entries
    where player_id = p_player_id and date = p_date and session_type = 'practice';
    select count(*) into v_position from public.game_log_entries
    where player_id = p_player_id and session_type = 'practice';
    insert into public.game_log_entries (player_id, session_type, date, ab, session_note, position)
    values (p_player_id, 'practice', p_date, v_ab, null, v_position)
    returning id into v_id;
  end if;
  return v_id;
end;
$$;

-- Records a clip a guardian already uploaded to the destination
-- get-upload-url minted. The path must be exactly
--   gs://<bucket>/<team slug>/<player slug>/raw/<p_clip_slug>.<ext>
-- for the entry's own team/player (the same shape get-upload-url builds
-- server-side), so a guardian can't point the worker at another player's
-- footage. Same row shape as coach/components/videoUpload.js's insert;
-- position = existing clip count; the 00027 trigger links it to a pitch/rep.
create or replace function public.guardian_register_clip(p_entry_id uuid, p_clip_slug text, p_raw_gcs_path text)
returns uuid
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_player_id uuid;
  v_player_slug text;
  v_team_slug text;
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

  select g.player_id, p.slug, t.slug into v_player_id, v_player_slug, v_team_slug
  from public.game_log_entries g
  join public.players p on p.id = g.player_id
  join public.teams t on t.id = p.team_id
  where g.id = p_entry_id;
  if v_player_id is null or not public.is_guardian_for_player(v_player_id) then
    raise exception 'not allowed';
  end if;

  if p_clip_slug is null or p_clip_slug !~ '^[A-Za-z0-9_-]{1,200}$' then
    raise exception 'invalid clip slug';
  end if;
  v_object := substring(p_raw_gcs_path from '^gs://[a-z0-9][a-z0-9._-]*/(.+)$');
  v_prefix := v_team_slug || '/' || v_player_slug || '/raw/' || p_clip_slug || '.';
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

-- Identity-only check (Task 3 builds guardian clip viewing on it): true iff
-- the caller is a linked guardian of the clip's player.
create or replace function public.guardian_can_view_clip(p_clip_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce((
    select public.is_guardian_for_player(g.player_id)
    from public.video_clips c
    join public.game_log_entries g on g.id = c.game_log_entry_id
    where c.id = p_clip_id
  ), false);
$$;

-- Functions default to EXECUTE for PUBLIC (and Supabase's default privileges
-- add anon); signed-in users only.
revoke all on function public.current_guardian_consent_version() from public, anon;
revoke all on function public.can_upload_for_entry(uuid) from public, anon;
revoke all on function public.guardian_create_entry(uuid, text, date) from public, anon;
revoke all on function public.guardian_register_clip(uuid, text, text) from public, anon;
revoke all on function public.guardian_can_view_clip(uuid) from public, anon;
revoke all on function public.video_clips_stamp_provenance() from public, anon, authenticated;
grant execute on function public.current_guardian_consent_version() to authenticated, service_role;
grant execute on function public.can_upload_for_entry(uuid) to authenticated, service_role;
grant execute on function public.guardian_create_entry(uuid, text, date) to authenticated, service_role;
grant execute on function public.guardian_register_clip(uuid, text, text) to authenticated, service_role;
grant execute on function public.guardian_can_view_clip(uuid) to authenticated, service_role;

notify pgrst, 'reload schema';
