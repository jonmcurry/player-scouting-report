-- Phase 0 and the file-backed slice of Phase 1 from the Continuous Knowledge Architecture.
-- Historical AI rows intentionally remain nullable: provenance is never fabricated.

alter table teams
  add column sport text check (sport in ('baseball', 'softball')),
  add column level_label text;

alter table players
  add column age_band text check (age_band in ('u8', '8-10', '11-12', '13-14', '15-18', 'adult')),
  add column bats text check (bats in ('L', 'R', 'S')),
  add column throws text check (throws in ('L', 'R'));

create table analysis_runs (
  id uuid primary key default gen_random_uuid(),
  video_clip_id uuid references video_clips (id) on delete set null,
  player_id uuid not null references players (id) on delete cascade,
  backend text not null check (backend in ('gemini', 'claude', 'pose3d')),
  ai_model text not null,
  ai_model_version text,
  prompt_version text not null,
  analysis_policy_version text not null,
  knowledge_version text not null,
  pipeline_version text,
  input_manifest jsonb not null,
  no_action_needed boolean not null default false,
  no_action_reason text,
  created_at timestamptz not null default now(),
  check (not no_action_needed or nullif(btrim(no_action_reason), '') is not null)
);
create index analysis_runs_player_created_idx on analysis_runs (player_id, created_at desc);
create index analysis_runs_clip_created_idx on analysis_runs (video_clip_id, created_at desc);

alter table issues
  add column analysis_run_id uuid references analysis_runs (id) on delete set null,
  add column concept text check (concept in (
    'stance_setup','load','stride_plant','hip_shoulder_sequencing','hand_path','barrel_path',
    'contact','extension','head_visual_stability','finish_balance','swing_decision','timing',
    'front_side_stability','posture','barrel_depth','pitch_location_adjustment','game_approach'
  )),
  add column basis text check (basis in ('video','metric','reconstruction')),
  add column context_explains_it boolean not null default false,
  add column emergency_swing_suspected boolean not null default false,
  add column knowledge_claim_ids text[] not null default '{}',
  add column suggest_priority boolean not null default false,
  add column finding_key text,
  add column ai_original jsonb,
  add column rejection_reason text check (rejection_reason in (
    'incorrect','unsupported','not_important','wrong_context','bad_drill','duplicate','other'
  ));
create index issues_player_finding_key_idx on issues (player_id, finding_key);

alter table checklist_scores add column analysis_run_id uuid references analysis_runs (id) on delete set null;
alter table comp_recommendations add column analysis_run_id uuid references analysis_runs (id) on delete set null;
alter table comp_notes add column analysis_run_id uuid references analysis_runs (id) on delete set null;
alter table drill_recommendations add column analysis_run_id uuid references analysis_runs (id) on delete set null;

create index checklist_scores_analysis_run_idx on checklist_scores (analysis_run_id);
create index issues_analysis_run_idx on issues (analysis_run_id);
create index comp_recommendations_analysis_run_idx on comp_recommendations (analysis_run_id);
create index comp_notes_analysis_run_idx on comp_notes (analysis_run_id);
create index drill_recommendations_analysis_run_idx on drill_recommendations (analysis_run_id);

-- Snapshot all AI-authored fields at the first coach decision, including approval/rejection.
-- A later edit therefore cannot erase what the model originally returned.
create or replace function snapshot_issue_ai_original()
returns trigger
language plpgsql
as $$
begin
  if old.ai_original is null
     and old.review_status = 'draft'
     and new.review_status in ('approved', 'edited', 'rejected') then
    new.ai_original := jsonb_build_object(
      'issue', old.issue,
      'seen_in_at_bats', old.seen_in_at_bats,
      'likely_cause', old.likely_cause,
      'effect', old.effect,
      'evidence', old.evidence,
      'coaching_cue', old.coaching_cue,
      'suggested_drill', old.suggested_drill,
      'look_for_next', old.look_for_next,
      'confidence', old.confidence,
      'phase', old.phase,
      'concept', old.concept,
      'basis', old.basis,
      'context_explains_it', old.context_explains_it,
      'emergency_swing_suspected', old.emergency_swing_suspected,
      'knowledge_claim_ids', old.knowledge_claim_ids,
      'suggest_priority', old.suggest_priority,
      'finding_key', old.finding_key,
      'analysis_run_id', old.analysis_run_id
    );
  end if;
  return new;
end;
$$;
create trigger issues_snapshot_ai_original
  before update on issues
  for each row execute function snapshot_issue_ai_original();

alter table analysis_runs enable row level security;
create policy coach_read_own_team_analysis_runs on analysis_runs
  for select to authenticated
  using (is_coach_for_team((select team_id from players where players.id = player_id)));

grant select on analysis_runs to authenticated;
grant all on analysis_runs to service_role;
