-- 00040: explicit checklist review state.
--
-- Before this, a checklist_scores row could only mean "AI draft" (reviewed_by
-- IS NULL) or "coach-confirmed score" (reviewed_by set). A coach who looked at
-- an AI draft and concluded "the footage can't support this" or "this draft is
-- wrong" had no way to say so: the draft stayed on screen as "AI Draft -
-- Unconfirmed" with its number. review_status makes that explicit:
--
--   ai_draft               unreviewed automated draft (reviewed_by IS NULL)
--   verified               coach-confirmed score (reviewed_by set, score set)
--   insufficient_evidence  coach-reviewed: not judgeable from the evidence (no score)
--   rejected               coach-reviewed: the AI draft is wrong (no score)
--
-- Backward compatible: a BEFORE trigger derives the status for every existing
-- writer (AI/pose3d draft sync, the score stepper, seeds, clones) - only the two
-- new coach actions set insufficient_evidence/rejected explicitly. The AI draft
-- value (ai_draft), its note, source and analysis_run_id are never touched by a
-- review, so the rejected/insufficient draft stays recoverable. History now
-- records status transitions too (score becomes nullable there).
--
-- Applied identically to public.* and demo.* (the demo clone requires exact
-- column parity).

do $$
declare s text; bad int;
begin
  foreach s in array array['public', 'demo'] loop
    -- A reviewed row with no score cannot be classified truthfully (no code path
    -- ever created one); refuse rather than guess. (EXECUTE doesn't set FOUND,
    -- so count into a variable.)
    execute format('select count(*) from %I.checklist_scores where reviewed_by is not null and score is null', s) into bad;
    if bad > 0 then
      raise exception '00040: %.checklist_scores has reviewed rows without a score - resolve them manually first', s;
    end if;

    execute format($f$
      alter table %1$I.checklist_scores add column review_status text not null default 'ai_draft';
      update %1$I.checklist_scores
        set review_status = case when reviewed_by is not null then 'verified' else 'ai_draft' end;
      alter table %1$I.checklist_scores
        add constraint checklist_scores_review_status_valid
          check (review_status in ('ai_draft', 'verified', 'insufficient_evidence', 'rejected')),
        add constraint checklist_scores_review_state_consistent check (
          (review_status = 'ai_draft' and reviewed_by is null)
          or (review_status = 'verified' and reviewed_by is not null and score is not null)
          or (review_status in ('insufficient_evidence', 'rejected') and reviewed_by is not null and score is null));

      alter table %1$I.checklist_score_history alter column score drop not null;
      alter table %1$I.checklist_score_history add column review_status text;
      update %1$I.checklist_score_history
        set review_status = case when changed_by is not null then 'verified' else 'ai_draft' end;
      alter table %1$I.checklist_score_history
        add constraint checklist_score_history_review_status_valid
          check (review_status is null or review_status in ('ai_draft', 'verified', 'insufficient_evidence', 'rejected'));
    $f$, s);
  end loop;
end $$;

-- Derive the status for writers that don't set it (all pre-00040 code paths).
create or replace function public.checklist_scores_derive_review_status()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if new.reviewed_by is null then
    new.review_status := 'ai_draft';
  elsif new.score is not null then
    new.review_status := 'verified';
  elsif new.review_status not in ('insufficient_evidence', 'rejected') then
    raise exception 'a reviewed checklist checkpoint without a score must be insufficient_evidence or rejected';
  end if;
  return new;
end;
$$;

create trigger checklist_scores_derive_review_status
  before insert or update on public.checklist_scores
  for each row execute function public.checklist_scores_derive_review_status();
create trigger checklist_scores_derive_review_status
  before insert or update on demo.checklist_scores
  for each row execute function public.checklist_scores_derive_review_status();

-- History: also log review-state transitions (a score -> "insufficient" change
-- has no new score, but it is a real coach decision).
create or replace function public.log_checklist_score_history()
returns trigger
language plpgsql
as $$
begin
  if new.score is distinct from old.score or new.review_status is distinct from old.review_status then
    insert into checklist_score_history (checklist_score_id, score, changed_by, review_status)
    values (new.id, new.score, new.reviewed_by, new.review_status);
  end if;
  return new;
end;
$$;

create or replace function demo.log_checklist_score_history()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if new.score is distinct from old.score or new.review_status is distinct from old.review_status then
    insert into demo.checklist_score_history (checklist_score_id, score, changed_by, review_status)
    values (new.id, new.score, new.reviewed_by, new.review_status);
  end if;
  return new;
end;
$$;

notify pgrst, 'reload schema';
