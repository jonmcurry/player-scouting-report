-- Fixture data only - mirrors the existing reports/example_ava.html and
-- reports/example_maddie.html demo pages (same fictional "Thunder 10U" team
-- these already use as the example team_summary.html). NEVER put real
-- players/teams in this file - it's committed to git and re-run by every
-- `supabase db reset`.
--
-- All inserts are idempotent (on conflict do nothing/update on natural keys:
-- team slug, player slug, checkpoint slug) so resetting the local DB
-- repeatedly is always safe.

insert into teams (slug, name) values
  ('thunder-10u', 'Thunder 10U')
on conflict (slug) do nothing;

insert into players (team_id, slug, name, jersey_number)
select t.id, v.slug, v.name, v.jersey_number
from teams t
join (values
  ('ava-t',    'Ava T.',    '00'),
  ('maddie-r', 'Maddie R.', '01')
) as v(slug, name, jersey_number) on true
where t.slug = 'thunder-10u'
on conflict (team_id, slug) do nothing;

-- Ava T.: deliberately only 2 at-bats (below MIN_ATBATS_FOR_PATTERN = 3), the
-- "early read warning TRIGGERED" fixture state, mirroring example_ava.html.
insert into game_log_entries (player_id, date, opponent, ab, pitch, result, clip_gcs_path)
select p.id, v.date::date, v.opponent, v.ab, v.pitch, v.result, null
from players p
join (values
  (1, '2026-07-15', 'Riverside', 'Rise ball, high', 'Fly out to center'),
  (2, '2026-07-15', 'Riverside', 'Middle-middle',    'Whiff, swinging strike 3')
) as v(ab, date, opponent, pitch, result) on true
where p.slug = 'ava-t' and p.team_id = (select id from teams where slug = 'thunder-10u');

insert into checklist_scores (player_id, checkpoint_id, score, ai_draft, reviewed_by, notes, source)
select p.id, c.id, v.score, v.score, null, v.notes, 'gemini'
from players p
join (values
  ('stance-setup',     2, 'Balanced enough, nothing notable'),
  ('load',             2, 'Weight shifts back fine'),
  ('stride',           2, 'Stride itself is fine, timing is the issue elsewhere'),
  ('hip-shoulder-sep', 1, 'Hips and shoulders rotate together as one unit - no separation/stretch-and-fire, all arms'),
  ('hand-path',        2, 'Hands get to the ball fine on their own'),
  ('bat-path',         1, 'Steep uppercut path - more chop-and-lift than level-to-slightly-up'),
  ('contact-point',    2, 'Contact point itself is reasonable'),
  ('extension',        1, 'Arms extend but there''s no lower-half drive behind it')
) as v(checkpoint_slug, score, notes) on true
join checkpoints c on c.slug = v.checkpoint_slug
where p.slug = 'ava-t' and p.team_id = (select id from teams where slug = 'thunder-10u')
on conflict (player_id, checkpoint_id) do nothing;

insert into issues (player_id, issue, seen_in_at_bats, likely_cause, effect, reviewed_by, source)
select p.id, v.issue, v.seen_in_at_bats, v.likely_cause, v.effect, null, 'gemini'
from players p
join (values (
  'Arms-only swing - hips and shoulders rotate together as one unit, so all bat speed comes from the arms, with a steep uppercut path.',
  'AB 1 vs Riverside (7/15) was a rise ball high, so the fly out is partly pitch-influenced; AB 2 was middle-middle and still resulted in a whiff - the arms-only disconnect shows up even on a hittable pitch, which is the stronger evidence of the two.',
  'No hip-shoulder separation (stretch-and-fire) - everything fires at once instead of hips leading, so there''s no rotational torque, and the swing compensates with a steep bat path to try to lift the ball instead.',
  'Weak fly balls and empty swings; power ceiling is capped until the lower half gets involved. Only 2 at-bats logged so far - see the warning above.'
)) as v(issue, seen_in_at_bats, likely_cause, effect) on true
where p.slug = 'ava-t' and p.team_id = (select id from teams where slug = 'thunder-10u');

-- Maddie R.: 4 at-bats (at/above MIN_ATBATS_FOR_PATTERN), the "resolved, no
-- warning" fixture state, mirroring example_maddie.html.
insert into game_log_entries (player_id, date, opponent, ab, pitch, result, clip_gcs_path)
select p.id, v.date::date, v.opponent, v.ab, v.pitch, v.result, null
from players p
join (values
  (1, '2026-07-12', 'Eagles',  'Outside, low',   'Groundout to short'),
  (2, '2026-07-12', 'Eagles',  'Middle-middle',  'Line drive single'),
  (3, '2026-07-19', 'Hawks',   'Inside, high',   'Foul ball, 2 strikes'),
  (4, '2026-07-19', 'Hawks',   'Middle-middle',  'Double to the gap')
) as v(ab, date, opponent, pitch, result) on true
where p.slug = 'maddie-r' and p.team_id = (select id from teams where slug = 'thunder-10u');

-- One fixture video_clip + swing_phases row set, on Maddie R.'s AB 2 (the
-- line-drive single) - demonstrates the game_log_entries/video_clips/
-- swing_phases shape without any real upload. No video_clip_pose3d row
-- exists for it (that needs a real pose3d pipeline run, not a plausible
-- fixture), so the coach app's 3D skeleton comparison shows an honest
-- "no 3D swing data available" message for this one demo clip rather than
-- rendering anything.
insert into video_clips (game_log_entry_id, clip_slug, fps, n_frames, duration_s, position)
select g.id, 'maddie_r_ab2_fixture', 30.0, 900, 30.0, 0
from game_log_entries g
join players p on p.id = g.player_id
where p.slug = 'maddie-r' and p.team_id = (select id from teams where slug = 'thunder-10u')
  and g.ab = 2 and g.opponent = 'Eagles'
on conflict (game_log_entry_id, clip_slug) do nothing;

insert into swing_phases (video_clip_id, phase_type_id, frame, time_s, method, confidence, detail)
select vc.id, spt.id, v.frame, v.time_s, v.method, v.confidence, '{}'::jsonb
from video_clips vc
join (values
  ('stance', 620, 20.67, 'fixture data - not a real detection', 'low'),
  ('stride', 655, 21.83, 'fixture data - not a real detection', 'low'),
  ('contact', 670, 22.33, 'fixture data - not a real detection', 'high'),
  ('extension', 672, 22.40, 'fixture data - not a real detection', 'high'),
  ('follow-through', 685, 22.83, 'fixture data - not a real detection', 'low')
) as v(slug, frame, time_s, method, confidence) on true
join swing_phase_types spt on spt.slug = v.slug
where vc.clip_slug = 'maddie_r_ab2_fixture'
on conflict (video_clip_id, phase_type_id) do nothing;
