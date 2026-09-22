-- Phase 4 canonical fictional demo narrative. Extends
-- demo.clone_demo_dataset() (CREATE OR REPLACE - originally defined in
-- 00031_demo_shared_project_schema.sql) so every visitor's clone gets the
-- full Jordan/Maya/Riley coaching-loop story, not just bare team/player
-- rows. Fresh row ids every call (gen_random_uuid()), same canonical
-- narrative structure every time - the seed-template/clone architecture
-- from 00031 is unchanged, this only extends what one clone produces.
--
-- No real AI backend is simulated: demo.analysis_runs is never inserted
-- into, and every seeded demo.issues/checklist_scores row is either
-- review_status='draft' (Maya's pending finding - explicitly UNREVIEWED,
-- exactly the review-queue state it's meant to demonstrate) or carries
-- reviewed_by='Coach Demo' with source left null (a coach-authored/
-- reviewed record, never tagged as a specific automated backend that did
-- not actually run against this fictional data). This is the "coach
-- remains final authority, never imply automated truth" requirement from
-- the approved Phase 4 brief.
--
-- No real video: every demo.video_clips row has raw_gcs_path = null
-- (default) - the real, unmodified get-video-url/get-demo-player-report
-- code already renders a graceful "video unavailable" state for that,
-- which is the correct demo behavior, not a gap.
create or replace function demo.clone_demo_dataset(p_user_id uuid)
returns table (team_id uuid, team_slug text, seed_version text)
language plpgsql
security definer
set search_path = ''
as $$
declare
  template record;
  new_team_id uuid := gen_random_uuid();
  new_team_slug text := 'demo-' || replace(gen_random_uuid()::text, '-', '');
  player_json jsonb;
  new_player_id uuid;

  v_jordan_id uuid;
  v_maya_id uuid;
  v_riley_id uuid;

  v_drill_split uuid;
  v_drill_stride uuid;
  v_drill_headstill uuid;

  -- Jordan
  v_j_ge_g1 uuid; v_j_ge_g2 uuid; v_j_ge_prac1 uuid; v_j_ge_prac2 uuid;
  v_j_clip_g1 uuid; v_j_clip_g2 uuid; v_j_clip_prac1 uuid; v_j_clip_prac2 uuid;
  v_j_session uuid; v_j_rep1 uuid; v_j_rep2 uuid;
  v_j_issue uuid; v_j_priority uuid;
  v_j_cp_hipshoulder uuid;

  -- Maya
  v_m_ge1 uuid;
  v_m_pitch1 uuid; v_m_pitch2 uuid; v_m_pitch3 uuid; v_m_pitch4 uuid;
  v_m_clip1 uuid; v_m_clip2 uuid; v_m_clip3 uuid; v_m_clip4 uuid;

  -- Riley
  v_r_ge1 uuid; v_r_ge2 uuid; v_r_ge_prac1 uuid; v_r_ge_prac2 uuid;
  v_r_clip1 uuid; v_r_clip2 uuid; v_r_clip_prac1 uuid; v_r_clip_prac2 uuid;
  v_r_session1 uuid; v_r_session2 uuid; v_r_rep1 uuid; v_r_rep2 uuid;
  v_r_issue uuid; v_r_priority_a uuid; v_r_priority_b uuid;
  v_r_cp_headeyes uuid;
begin
  select * into template from demo.demo_seed_templates where active = true order by created_at desc limit 1;
  if template.seed_version is null then
    raise exception 'no active demo.demo_seed_templates row - the demo canonical seed has not been loaded';
  end if;

  insert into demo.teams (id, slug, name, sport, level_label)
  values (
    new_team_id,
    new_team_slug,
    template.payload->'team'->>'name',
    template.payload->'team'->>'sport',
    template.payload->'team'->>'level_label'
  );

  for player_json in select * from jsonb_array_elements(template.payload->'players')
  loop
    new_player_id := gen_random_uuid();
    insert into demo.players (id, team_id, slug, name, jersey_number, age_band, bats, throws)
    values (
      new_player_id,
      new_team_id,
      player_json->>'slug',
      player_json->>'name',
      player_json->>'jersey_number',
      nullif(player_json->>'age_band', ''),
      nullif(player_json->>'bats', ''),
      nullif(player_json->>'throws', '')
    );
    if player_json->>'slug' = 'jordan-lee' then v_jordan_id := new_player_id;
    elsif player_json->>'slug' = 'maya-torres' then v_maya_id := new_player_id;
    elsif player_json->>'slug' = 'riley-chen' then v_riley_id := new_player_id;
    end if;
  end loop;

  if v_jordan_id is null or v_maya_id is null or v_riley_id is null then
    raise exception 'demo seed template v1 is missing one of jordan-lee/maya-torres/riley-chen - narrative seeding requires all three';
  end if;

  -- team_id qualified with the table name throughout this file: this
  -- function's RETURNS TABLE clause makes a bare "team_id" an ambiguous
  -- reference against any table column also named team_id, in plpgsql -
  -- the same class of bug already documented and fixed in
  -- demo.start_demo_session() (00031). Confirmed live: an earlier
  -- unqualified version of this exact query failed with "column reference
  -- \"team_id\" is ambiguous" when actually run.
  select id into v_drill_split from demo.drill_library where demo.drill_library.team_id is null and slug = 'split-stance-tee';
  select id into v_drill_stride from demo.drill_library where demo.drill_library.team_id is null and slug = 'stride-to-stop';
  select id into v_drill_headstill from demo.drill_library where demo.drill_library.team_id is null and slug = 'head-still-tee';
  select id into v_j_cp_hipshoulder from demo.checkpoints where slug = 'hip-shoulder-sep';
  select id into v_r_cp_headeyes from demo.checkpoints where slug = 'head-eyes';

  -- =====================================================================
  -- Checklist scores - all 11 checkpoints, coach-reviewed, for all three
  -- players. Realistic mixed scores, not a uniform grade.
  -- =====================================================================
  insert into demo.checklist_scores (player_id, checkpoint_id, score, reviewed_by)
  select v_jordan_id, c.id, s.score, 'Coach Demo'
  from demo.checkpoints c
  join (values
    ('stance-setup', 3), ('load', 2), ('stride', 2), ('hip-shoulder-sep', 2), ('hand-path', 3),
    ('bat-path', 2), ('contact-point', 3), ('extension', 2), ('head-eyes', 3), ('follow-through', 2), ('swing-decisions', 3)
  ) as s(slug, score) on s.slug = c.slug;

  insert into demo.checklist_scores (player_id, checkpoint_id, score, reviewed_by)
  select v_maya_id, c.id, s.score, 'Coach Demo'
  from demo.checkpoints c
  join (values
    ('stance-setup', 2), ('load', 2), ('stride', 3), ('hip-shoulder-sep', 2), ('hand-path', 2),
    ('bat-path', 2), ('contact-point', 2), ('extension', 2), ('head-eyes', 2), ('follow-through', 2), ('swing-decisions', 1)
  ) as s(slug, score) on s.slug = c.slug;

  insert into demo.checklist_scores (player_id, checkpoint_id, score, reviewed_by)
  select v_riley_id, c.id, s.score, 'Coach Demo'
  from demo.checkpoints c
  join (values
    ('stance-setup', 3), ('load', 3), ('stride', 2), ('hip-shoulder-sep', 3), ('hand-path', 3),
    ('bat-path', 3), ('contact-point', 2), ('extension', 3), ('head-eyes', 2), ('follow-through', 3), ('swing-decisions', 2)
  ) as s(slug, score) on s.slug = c.slug;

  -- =====================================================================
  -- JORDAN LEE - complete development loop: earlier swing -> coach-
  -- reviewed finding -> priority -> assigned drill -> practice follow-up
  -- -> later swing -> Compare (baseline/post-drill) -> resolution ->
  -- shareable report.
  -- =====================================================================
  insert into demo.game_log_entries (id, player_id, date, opponent, ab, result, session_type)
  values (gen_random_uuid(), v_jordan_id, current_date - 21, 'Riverside Rec', 1, 'Flyout to center', 'game')
  returning id into v_j_ge_g1;
  insert into demo.game_log_entries (id, player_id, date, opponent, ab, result, session_type)
  values (gen_random_uuid(), v_jordan_id, current_date - 3, 'Lakeside Select', 1, 'Double to right-center', 'game')
  returning id into v_j_ge_g2;
  insert into demo.game_log_entries (id, player_id, date, opponent, ab, result, session_type)
  values (gen_random_uuid(), v_jordan_id, current_date - 14, null, 1, 'Practice rep', 'practice')
  returning id into v_j_ge_prac1;
  insert into demo.game_log_entries (id, player_id, date, opponent, ab, result, session_type)
  values (gen_random_uuid(), v_jordan_id, current_date - 14, null, 2, 'Practice rep', 'practice')
  returning id into v_j_ge_prac2;

  insert into demo.video_clips (id, game_log_entry_id, clip_slug, status, position)
  values (gen_random_uuid(), v_j_ge_g1, 'jordan-ab1-swing', 'ready', 0) returning id into v_j_clip_g1;
  insert into demo.video_clips (id, game_log_entry_id, clip_slug, status, position)
  values (gen_random_uuid(), v_j_ge_g2, 'jordan-ab2-swing', 'ready', 0) returning id into v_j_clip_g2;

  insert into demo.player_priorities (id, player_id, team_id, title, description, category, status, priority_order, coach_notes, follow_up_kind)
  values (gen_random_uuid(), v_jordan_id, new_team_id, 'Keep the front side closed a beat longer',
    'Front hip/shoulder are opening before the hands start forward, costing barrel control on pitches away.',
    'front-side-stability', 'active', 0, '', 'next_practice')
  returning id into v_j_priority;

  insert into demo.issues (id, player_id, issue, seen_in_at_bats, likely_cause, effect, evidence, coaching_cue, suggested_drill, look_for_next, confidence, video_clip_id, review_status, reviewed_by, suggested_priority_title)
  values (gen_random_uuid(), v_jordan_id, 'Front side opens early before contact', 'Game vs Riverside Rec, AB1',
    'Front foot plants slightly closed but the hip fires immediately after landing',
    'Loses barrel control on pitches away, tends to roll over',
    'On the game swing vs Riverside Rec, the front hip and shoulder rotate open well before the hands come through, so the barrel drags into the zone late.',
    'Feel the back hip stay loaded a beat longer before the hands start forward.',
    'Split-stance tee drill', 'Whether the front shoulder stays closed until the hands start moving.',
    'medium', v_j_clip_g1, 'approved', 'Coach Demo', 'Keep the front side closed a beat longer')
  returning id into v_j_issue;

  update demo.player_priorities set source_issue_id = v_j_issue where id = v_j_priority;

  insert into demo.player_priority_drills (player_priority_id, drill_id, active, coach_note)
  values (v_j_priority, v_drill_split, true, 'Do this before every tee round this week.');

  insert into demo.practice_sessions (id, player_id, session_date, session_goal, focus_priority_id, assigned_drill_id, outcome, outcome_note, notes)
  values (gen_random_uuid(), v_jordan_id, current_date - 14, 'Front side control', v_j_priority, v_drill_split, 'mixed',
    'Better by the end but still opening early on tee reps from the glove side.',
    '10 split-stance reps, then 10 normal-stride reps.')
  returning id into v_j_session;

  insert into demo.practice_repetitions (id, practice_session_id, game_log_entry_id, rep_number, grouping, usable, notes)
  values (gen_random_uuid(), v_j_session, v_j_ge_prac1, 1, 'baseline', true, 'Before drill work - front hip opens right at foot-plant.')
  returning id into v_j_rep1;
  insert into demo.practice_repetitions (id, practice_session_id, game_log_entry_id, rep_number, grouping, usable, notes)
  values (gen_random_uuid(), v_j_session, v_j_ge_prac2, 2, 'post_drill', true, 'After split-stance reps - front side held noticeably longer.')
  returning id into v_j_rep2;

  insert into demo.video_clips (id, game_log_entry_id, clip_slug, status, position, practice_repetition_id)
  values (gen_random_uuid(), v_j_ge_prac1, 'jordan-practice-baseline', 'ready', 0, v_j_rep1) returning id into v_j_clip_prac1;
  insert into demo.video_clips (id, game_log_entry_id, clip_slug, status, position, practice_repetition_id)
  values (gen_random_uuid(), v_j_ge_prac2, 'jordan-practice-postdrill', 'ready', 0, v_j_rep2) returning id into v_j_clip_prac2;

  insert into demo.player_priority_observations (player_priority_id, video_clip_id, practice_repetition_id, practice_session_id, status, coach_note, confidence, context, observed_at)
  values
    (v_j_priority, v_j_clip_prac1, v_j_rep1, v_j_session, 'unchanged', 'Still opening early at the start of the round.', 'medium', 'practice', (current_date - 14)::timestamptz + interval '16 hours'),
    (v_j_priority, v_j_clip_prac2, v_j_rep2, v_j_session, 'improving', 'Held the back hip loaded noticeably longer by the last few reps.', 'medium', 'practice', (current_date - 14)::timestamptz + interval '17 hours'),
    (v_j_priority, v_j_clip_g2, null, null, 'resolved', 'Carried it into the game - stayed closed through contact on the double to right-center.', 'high', 'game', (current_date - 3)::timestamptz + interval '18 hours');

  update demo.player_priorities set status = 'resolved' where id = v_j_priority;
  update demo.checklist_scores set score = 3, reviewed_by = 'Coach Demo' where player_id = v_jordan_id and checkpoint_id = v_j_cp_hipshoulder;

  insert into demo.player_share_links (player_id, token)
  values (v_jordan_id, replace(gen_random_uuid()::text, '-', '') || replace(gen_random_uuid()::text, '-', ''));

  -- =====================================================================
  -- MAYA TORRES - review queue + a real four-pitch game at-bat.
  -- =====================================================================
  insert into demo.game_log_entries (id, player_id, date, opponent, ab, result, session_type)
  values (gen_random_uuid(), v_maya_id, current_date - 5, 'Riverside Rec', 1, 'Struck out swinging', 'game')
  returning id into v_m_ge1;

  insert into demo.at_bat_pitches (id, game_log_entry_id, pitch_number, count_before_balls, count_before_strikes, pitch_type, pitch_location, pitch_zone, pitch_outcome, swung)
  values (gen_random_uuid(), v_m_ge1, 1, 0, 0, 'fastball', 'Away', 6, 'called_strike', false) returning id into v_m_pitch1;
  insert into demo.at_bat_pitches (id, game_log_entry_id, pitch_number, count_before_balls, count_before_strikes, pitch_type, pitch_location, pitch_zone, pitch_outcome, swung)
  values (gen_random_uuid(), v_m_ge1, 2, 0, 1, 'changeup', 'Low', 8, 'ball', false) returning id into v_m_pitch2;
  insert into demo.at_bat_pitches (id, game_log_entry_id, pitch_number, count_before_balls, count_before_strikes, pitch_type, pitch_location, pitch_zone, pitch_outcome, swung)
  values (gen_random_uuid(), v_m_ge1, 3, 1, 1, 'fastball', 'Inside', 4, 'foul', true) returning id into v_m_pitch3;
  insert into demo.at_bat_pitches (id, game_log_entry_id, pitch_number, count_before_balls, count_before_strikes, pitch_type, pitch_location, pitch_zone, pitch_outcome, swung)
  values (gen_random_uuid(), v_m_ge1, 4, 1, 2, 'riseball', 'High', 2, 'swinging_strike', true) returning id into v_m_pitch4;

  insert into demo.video_clips (id, game_log_entry_id, clip_slug, status, position, at_bat_pitch_id)
  values (gen_random_uuid(), v_m_ge1, 'maya-ab1-pitch1', 'ready', 0, v_m_pitch1) returning id into v_m_clip1;
  insert into demo.video_clips (id, game_log_entry_id, clip_slug, status, position, at_bat_pitch_id)
  values (gen_random_uuid(), v_m_ge1, 'maya-ab1-pitch2', 'ready', 1, v_m_pitch2) returning id into v_m_clip2;
  insert into demo.video_clips (id, game_log_entry_id, clip_slug, status, position, at_bat_pitch_id)
  values (gen_random_uuid(), v_m_ge1, 'maya-ab1-pitch3', 'ready', 2, v_m_pitch3) returning id into v_m_clip3;
  insert into demo.video_clips (id, game_log_entry_id, clip_slug, status, position, at_bat_pitch_id)
  values (gen_random_uuid(), v_m_ge1, 'maya-ab1-pitch4', 'ready', 3, v_m_pitch4) returning id into v_m_clip4;

  -- Pending draft, deliberately review_status='draft' / reviewed_by=null -
  -- this is the review queue's "pending item" for the demo.
  insert into demo.issues (id, player_id, issue, seen_in_at_bats, likely_cause, effect, evidence, coaching_cue, suggested_drill, look_for_next, confidence, video_clip_id, review_status)
  values (gen_random_uuid(), v_maya_id, 'Chasing the high riseball out of the zone', 'Game vs Riverside Rec, AB1',
    'Selling out to protect instead of tracking the pitch up out of the zone',
    'Extends at-bats into pitcher-friendly counts and away pitches',
    'On the 2-strike pitch, the swing starts on a ball that never enters the zone above the letters.',
    'Track the ball to the belt before committing on a 2-strike pitch up.',
    'Inside soft toss', 'Whether she lays off the high pitch in the next at-bat.',
    'medium', v_m_clip4, 'draft');

  -- =====================================================================
  -- RILEY CHEN - longitudinal development: one resolved priority, one
  -- monitoring priority, practice history, visible progression.
  -- =====================================================================
  insert into demo.game_log_entries (id, player_id, date, opponent, ab, result, session_type)
  values (gen_random_uuid(), v_riley_id, current_date - 30, 'Harbor Classic', 1, 'Groundout to short', 'game')
  returning id into v_r_ge1;
  insert into demo.game_log_entries (id, player_id, date, opponent, ab, result, session_type)
  values (gen_random_uuid(), v_riley_id, current_date - 4, 'Coastal Invitational', 1, 'Single up the middle', 'game')
  returning id into v_r_ge2;
  insert into demo.game_log_entries (id, player_id, date, opponent, ab, result, session_type)
  values (gen_random_uuid(), v_riley_id, current_date - 24, null, 1, 'Practice rep', 'practice')
  returning id into v_r_ge_prac1;
  insert into demo.game_log_entries (id, player_id, date, opponent, ab, result, session_type)
  values (gen_random_uuid(), v_riley_id, current_date - 10, null, 1, 'Practice rep', 'practice')
  returning id into v_r_ge_prac2;

  insert into demo.video_clips (id, game_log_entry_id, clip_slug, status, position)
  values (gen_random_uuid(), v_r_ge1, 'riley-ab1-swing', 'ready', 0) returning id into v_r_clip1;
  insert into demo.video_clips (id, game_log_entry_id, clip_slug, status, position)
  values (gen_random_uuid(), v_r_ge2, 'riley-ab2-swing', 'ready', 0) returning id into v_r_clip2;

  insert into demo.issues (id, player_id, issue, seen_in_at_bats, likely_cause, effect, evidence, coaching_cue, suggested_drill, look_for_next, confidence, video_clip_id, review_status, reviewed_by, suggested_priority_title)
  values (gen_random_uuid(), v_riley_id, 'Head drifts toward the pitcher during the load', 'Game vs Harbor Classic, AB1',
    'Weight shift starts in the head before the hands',
    'Late reads on the ball out of the hand',
    'On the early-season swing vs Harbor Classic, the head moves forward noticeably as the hands start to load.',
    'Keep the chin over the back hip through the load.',
    'Head-still tee drill', 'Whether the head stays still into foot-plant.',
    'medium', v_r_clip1, 'approved', 'Coach Demo', 'Quiet the head during the load')
  returning id into v_r_issue;

  insert into demo.player_priorities (id, player_id, team_id, title, description, category, status, priority_order, source_issue_id, follow_up_kind)
  values (gen_random_uuid(), v_riley_id, new_team_id, 'Quiet the head during the load',
    'Head drifts toward the pitcher as the hands load, costing early reads.', 'head-eyes', 'active', 0, v_r_issue, 'next_game')
  returning id into v_r_priority_a;

  insert into demo.player_priorities (id, player_id, team_id, title, description, category, status, priority_order, follow_up_kind)
  values (gen_random_uuid(), v_riley_id, new_team_id, 'Stride length consistency under game speed',
    'Stride shortens under faster velocity, which throws off timing.', 'timing', 'monitoring', 1, 'next_game')
  returning id into v_r_priority_b;

  insert into demo.player_priority_drills (player_priority_id, drill_id, active, coach_note)
  values (v_r_priority_a, v_drill_headstill, true, 'Two rounds before every practice.');
  insert into demo.player_priority_drills (player_priority_id, drill_id, active, coach_note)
  values (v_r_priority_b, v_drill_stride, true, 'Focus on landing on the same spot every rep.');

  insert into demo.practice_sessions (id, player_id, session_date, session_goal, focus_priority_id, assigned_drill_id, outcome, notes)
  values (gen_random_uuid(), v_riley_id, current_date - 24, 'Quiet head through load', v_r_priority_a, v_drill_headstill, 'yes', 'Head-still tee, 3 rounds.')
  returning id into v_r_session1;
  insert into demo.practice_sessions (id, player_id, session_date, session_goal, focus_priority_id, assigned_drill_id, outcome, notes)
  values (gen_random_uuid(), v_riley_id, current_date - 10, 'Stride consistency at speed', v_r_priority_b, v_drill_stride, 'mixed', 'Stride-to-stop off soft toss, mixed speeds.')
  returning id into v_r_session2;

  insert into demo.practice_repetitions (id, practice_session_id, game_log_entry_id, rep_number, grouping, usable, notes)
  values (gen_random_uuid(), v_r_session1, v_r_ge_prac1, 1, 'drill', true, 'Head noticeably quieter by rep 3.')
  returning id into v_r_rep1;
  insert into demo.practice_repetitions (id, practice_session_id, game_log_entry_id, rep_number, grouping, usable, notes)
  values (gen_random_uuid(), v_r_session2, v_r_ge_prac2, 1, 'drill', true, 'Stride length still varies more on the faster tosses.')
  returning id into v_r_rep2;

  insert into demo.video_clips (id, game_log_entry_id, clip_slug, status, position, practice_repetition_id)
  values (gen_random_uuid(), v_r_ge_prac1, 'riley-practice-headstill', 'ready', 0, v_r_rep1) returning id into v_r_clip_prac1;
  insert into demo.video_clips (id, game_log_entry_id, clip_slug, status, position, practice_repetition_id)
  values (gen_random_uuid(), v_r_ge_prac2, 'riley-practice-stride', 'ready', 0, v_r_rep2) returning id into v_r_clip_prac2;

  insert into demo.player_priority_observations (player_priority_id, video_clip_id, practice_repetition_id, practice_session_id, status, coach_note, confidence, context, observed_at)
  values
    (v_r_priority_a, v_r_clip_prac1, v_r_rep1, v_r_session1, 'improving', 'Head stayed noticeably stiller through the load by the end of the round.', 'medium', 'practice', (current_date - 24)::timestamptz + interval '16 hours'),
    (v_r_priority_a, v_r_clip2, null, null, 'resolved', 'Head stayed quiet through the load in the game - saw the ball early on the single.', 'high', 'game', (current_date - 4)::timestamptz + interval '18 hours'),
    (v_r_priority_b, v_r_clip_prac2, v_r_rep2, v_r_session2, 'unchanged', 'Stride still shortens noticeably on the faster tosses.', 'medium', 'practice', (current_date - 10)::timestamptz + interval '16 hours'),
    (v_r_priority_b, v_r_clip2, null, null, 'improving', 'Stride looked more consistent in the game at-bat than in practice reps so far.', 'medium', 'game', (current_date - 4)::timestamptz + interval '18 hours' + interval '1 minute');

  update demo.player_priorities set status = 'resolved' where id = v_r_priority_a;
  update demo.checklist_scores set score = 3, reviewed_by = 'Coach Demo' where player_id = v_riley_id and checkpoint_id = v_r_cp_headeyes;

  return query select new_team_id, new_team_slug, template.seed_version;
end;
$$;
comment on function demo.clone_demo_dataset(uuid) is
  'Clones the canonical fictional demo team + full Jordan/Maya/Riley Phase 4 narrative for one visitor. Fresh row ids per call; see docs/research/demo-shared-project-architecture.md for the full story summary.';
