-- A coach asked Claude to directly analyze a real at-bat's extracted frame
-- stills after discovering analyze.ts's Gemini path was unusable (an invalid
-- API key - see NEXT_STEPS.md). Doing that write honestly means a real new
-- provenance value, not silently mislabeling Claude's own read as 'gemini' -
-- the whole point of the source column is letting the coach UI (and anyone
-- auditing later) tell which automation actually produced a draft.
alter table checklist_scores drop constraint checklist_scores_source_check;
alter table checklist_scores add constraint checklist_scores_source_check
  check (source in ('gemini', 'pose3d', 'claude'));

alter table issues drop constraint issues_source_check;
alter table issues add constraint issues_source_check
  check (source in ('gemini', 'pose3d', 'claude'));
