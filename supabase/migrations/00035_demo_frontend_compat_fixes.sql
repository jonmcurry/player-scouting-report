-- Compatibility fix pass: the live production frontend (already deployed
-- to joncurry.co/hitterloop/demo, querying the real cloud demo.* schema)
-- surfaced real column/table gaps between what coach/*.html genuinely
-- selects and what 00033_demo_phase4_schema.sql actually created. Every
-- addition below was verified against a live PostgREST query trace against
-- the real cloud project (not guessed from the live-audit's own wording) -
-- see docs/research/demo-shared-project-architecture.md's compatibility-fix
-- section for the full trace-by-trace rationale.
--
-- Genuinely NOT touched here (traced and found already correct):
-- checkpoints, drill_library, practice_sessions/repetitions, issues,
-- player_priority_drills/observations, video_clips, at_bat_pitches,
-- video_clip_metrics/pose3d shapes, player_share_links - none of these had
-- a real column gap; only the four objects below did.

-- ---------------------------------------------------------------------
-- 1. demo.player_priorities.follow_up_set_at - genuinely selected by
--    coach/player.html, coach/components/teamDashboard.js (team.html's
--    dashboard), and coach/components/developmentLogic.js's
--    isFollowUpDue(). Production sets it via a BEFORE INSERT/UPDATE
--    trigger (00026_priority_followup_and_quality.sql), not app code -
--    mirrored exactly, so demo.clone_demo_dataset()'s existing INSERTs
--    (which already set follow_up_kind inline) get it stamped for free,
--    no seed-logic change needed.
-- ---------------------------------------------------------------------
alter table demo.player_priorities add column follow_up_set_at timestamptz;

create or replace function demo.stamp_priority_followup()
returns trigger
language plpgsql
set search_path = ''
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
create trigger demo_player_priorities_followup_stamp before insert or update on demo.player_priorities
  for each row execute function demo.stamp_priority_followup();

-- ---------------------------------------------------------------------
-- 2. demo.swing_phases.reconstruction_reliable - genuinely selected by
--    coach/player.html and coach/components/devUi.js's loadPhases()
--    (used by review.html/compare.html). Production added it in
--    00023_swing_phase_reconstruction_reliability.sql. demo.swing_phases
--    is never seeded with rows (see 00033's header - no lab-grade
--    metrics fabricated), so this is purely a "the column must exist for
--    the query not to 400" fix, not a seed-content change.
-- ---------------------------------------------------------------------
alter table demo.swing_phases add column reconstruction_reliable boolean;

-- ---------------------------------------------------------------------
-- 3. demo.analysis_runs.no_action_needed / no_action_reason - genuinely
--    selected by coach/review.html
--    (`select("id,no_action_needed,no_action_reason,created_at")`).
--    demo.analysis_runs is never seeded with rows either (00033's header:
--    no specific real AI backend is simulated as having run) - same
--    "column must exist, no fabricated provenance" fix.
-- ---------------------------------------------------------------------
alter table demo.analysis_runs
  add column no_action_needed boolean not null default false,
  add column no_action_reason text,
  add constraint demo_analysis_runs_no_action_reason_check
    check (not no_action_needed or nullif(btrim(no_action_reason), '') is not null);

-- ---------------------------------------------------------------------
-- 4. demo.game_log_entries.session_note - genuinely selected by
--    coach/player.html's practice-activity list and genuinely INSERTed by
--    coach/components/practicePage.js's addRep() (adding a new practice
--    rep from the UI) - without this column, adding a rep in demo mode
--    fails outright (PostgREST 400, "column not found"). Production
--    added it in 00015_practice_sessions.sql. No seed-content change:
--    the existing Phase 4 seed's practice-backing game_log_entries rows
--    are left with session_note null (the UI already falls back to
--    "Rep N" for that case, matching production's own graceful default).
-- ---------------------------------------------------------------------
alter table demo.game_log_entries add column session_note text;
-- Found by this migration's own regression test, not the live audit:
-- production dropped `result`'s NOT NULL constraint in
-- 00015_practice_sessions.sql specifically because a practice rep
-- legitimately has no game result - demo.game_log_entries (00033) never
-- carried that drop over, so practicePage.js's real addRep() insert
-- (which never sets `result`) would 23502-fail against the demo schema.
-- The Phase 4 seed's own practice-backing rows already work around this
-- by passing a placeholder 'Practice rep' string, which masked the gap
-- until a real frontend-shaped insert (this migration's own test) caught it.
alter table demo.game_log_entries alter column result drop not null;

-- ---------------------------------------------------------------------
-- 5. demo.coach_profiles - genuinely queried by coach/shared.js's
--    getMyDisplayName() (called from atbat.html, review.html, player.html,
--    devUi.js - i.e. most of the app). Its own error handling already
--    falls back to the literal string "Coach" on any error (including a
--    404 for a missing relation), so this was never a page-breaking
--    failure - but the live audit is right that it's a real, fixable gap:
--    demo visitors should see "Coach Demo", not a generic fallback and a
--    console 404. Fixed with a minimal, demo-owned table (no FK to
--    public.coach_profiles, no real coach identity/profile linkage - the
--    display name is always the fixed literal "Coach Demo", never
--    anything derived from a real account), auto-populated once per
--    visitor inside demo.start_demo_session() (identity/session
--    bookkeeping, not per-clone content - survives reset, like
--    production's own coach_profiles is per-coach-identity, not
--    per-team-data).
-- ---------------------------------------------------------------------
create table demo.coach_profiles (
  user_id uuid primary key references auth.users (id) on delete cascade,
  display_name text not null,
  created_at timestamptz not null default now()
);
alter table demo.coach_profiles enable row level security;
-- Mirrors production's own policy shape (00002_coach_app.sql): any
-- authenticated demo visitor can read any other visitor's display name
-- (low-sensitivity - it is always literally "Coach Demo" for everyone,
-- never real identity), writing is restricted to your own row.
create policy demo_coach_profiles_select_any on demo.coach_profiles
  for select to authenticated using (true);
create policy demo_coach_profiles_write_own on demo.coach_profiles
  for insert to authenticated with check (user_id = auth.uid());
create policy demo_coach_profiles_update_own on demo.coach_profiles
  for update to authenticated using (user_id = auth.uid()) with check (user_id = auth.uid());
grant select, insert, update on demo.coach_profiles to authenticated;

-- demo.start_demo_session() (00031) extended (CREATE OR REPLACE) to
-- upsert this visitor's fixed "Coach Demo" profile row on every
-- bootstrap - idempotent, and does not touch it on reset (reset only
-- ever clones/deletes the team, never demo_sessions/coach_profiles
-- identity rows).
create or replace function demo.start_demo_session()
returns table (team_id uuid, team_slug text, generation integer)
language plpgsql
security definer
set search_path = ''
as $$
declare
  existing demo.demo_sessions;
  cloned record;
  cleanup_team uuid;
  old_team_id uuid;
begin
  if auth.uid() is null then
    raise exception 'not authenticated';
  end if;

  perform pg_advisory_xact_lock(hashtext(auth.uid()::text));

  insert into demo.coach_profiles (user_id, display_name)
  values (auth.uid(), 'Coach Demo')
  on conflict (user_id) do nothing;

  select * into existing from demo.demo_sessions where user_id = auth.uid();
  if existing.user_id is not null and existing.expires_at > now() then
    update demo.demo_sessions set last_active_at = now() where user_id = auth.uid();
    return query select existing.team_id, (select slug from demo.teams where id = existing.team_id), existing.generation;
    return;
  end if;

  if existing.user_id is not null then
    old_team_id := existing.team_id;
  end if;

  for cleanup_team in
    select demo.demo_sessions.team_id from demo.demo_sessions
    where demo.demo_sessions.expires_at < now() and demo.demo_sessions.user_id <> auth.uid()
    order by demo.demo_sessions.expires_at asc
    limit 5
  loop
    delete from demo.demo_sessions where demo.demo_sessions.team_id = cleanup_team;
    delete from demo.teams where demo.teams.id = cleanup_team;
  end loop;

  select * into cloned from demo.clone_demo_dataset(auth.uid());

  insert into demo.demo_sessions (user_id, team_id, seed_version, generation, expires_at)
  values (auth.uid(), cloned.team_id, cloned.seed_version, 1, now() + interval '24 hours')
  on conflict (user_id) do update set
    team_id = excluded.team_id,
    seed_version = excluded.seed_version,
    generation = 1,
    created_at = now(),
    last_active_at = now(),
    expires_at = excluded.expires_at;

  if old_team_id is not null then
    delete from demo.teams where id = old_team_id;
  end if;

  return query select cloned.team_id, cloned.team_slug, 1;
end;
$$;
comment on function demo.start_demo_session() is
  'Anonymous demo bootstrap into the demo schema. Idempotent for a live session. Also upserts a fixed "Coach Demo" coach_profiles row per visitor (identity bookkeeping, unaffected by reset). Identity always from auth.uid(); never accepts a caller-supplied user/team id.';
