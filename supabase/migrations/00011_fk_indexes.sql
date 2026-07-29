-- Performance: Postgres auto-indexes primary keys, but NOT foreign key
-- columns. A handful of FKs here happen to already be covered as the
-- leftmost column of an existing `unique()` constraint (checklist_scores.
-- player_id, video_clips.game_log_entry_id, video_clip_pose3d.video_clip_id,
-- coach_team_access's composite PK) - the ones below have no coverage at
-- all, so every RLS policy check and every coach-app query filtering on
-- them (team roster loads, a player's game log, her issues/comps/drills,
-- score-history lookups) does a full sequential scan once these tables
-- have more than a trivial handful of rows. Cheap, zero-risk fix before
-- scaling past a handful of players per team.
create index if not exists players_team_id_idx on players (team_id);
create index if not exists game_log_entries_player_id_idx on game_log_entries (player_id);
create index if not exists issues_player_id_idx on issues (player_id);
create index if not exists comp_recommendations_player_id_idx on comp_recommendations (player_id);
create index if not exists comp_notes_player_id_idx on comp_notes (player_id);
create index if not exists drill_recommendations_player_id_idx on drill_recommendations (player_id);
create index if not exists checklist_score_history_checklist_score_id_idx on checklist_score_history (checklist_score_id);
