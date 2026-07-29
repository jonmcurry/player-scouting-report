-- Structured pitch location + outcome for the mobile "Log AB" 9-zone quick
-- picker (see ux.md Step 3B / 5.2). Additive alongside game_log_entries.pitch
-- (existing free-text "Outside, low"/"Rise ball, high" field, kept as-is -
-- src/types/scouting.ts's module docstring deliberately rejects a
-- PitchQuality enum for pitch TYPE/quality, which this is not: pitch_zone is
-- a strike-zone grid position and pitch_outcome is a fixed take/foul/in-play
-- result, both genuinely fixed small sets, unlike open-ended pitch
-- descriptions). Both nullable - older rows and the freeform-only entry path
-- have neither.
alter table game_log_entries
  add column pitch_zone smallint check (pitch_zone between 1 and 9),
  add column pitch_outcome text check (pitch_outcome in ('take', 'foul', 'ball_in_play'));
