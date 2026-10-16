-- PR9: versioned clip evidence assessments are private, historical records.
-- They are separate from processing state, provider runs, coaching claims and
-- parent-visible reports. No policy below grants client access.

create table public.clip_evidence_assessments (
  id uuid primary key default gen_random_uuid(),
  video_clip_id uuid not null references public.video_clips(id) on delete cascade,
  engine_code_version text not null,
  instrumentation_version text not null,
  environment_version text not null,
  gate_version text not null,
  claims_version text not null,
  reliability_profile_version text,
  mode text not null check (mode in ('off','shadow','enforce')),
  clip_status text not null check (clip_status in ('eligible','withhold')),
  family_reason text check (family_reason in ('batter_unclear','swing_unclear','analysis_version_unavailable')),
  subject jsonb not null,
  events jsonb not null,
  strict_baseline jsonb not null,
  source_sha256 text not null check (source_sha256 ~ '^[a-f0-9]{64}$'),
  backfilled boolean not null default false,
  created_at timestamptz not null default now()
);

create index clip_evidence_assessments_latest
  on public.clip_evidence_assessments(video_clip_id, created_at desc);

alter table public.clip_evidence_assessments enable row level security;
revoke all on public.clip_evidence_assessments from public, anon, authenticated;
grant select, insert on public.clip_evidence_assessments to service_role;

-- RLS does not constrain service_role. Reject mutation even for that privileged
-- application role. A cascading video_clips deletion runs after the parent row
-- is no longer visible, so it is the only row-level DELETE this trigger permits.
create function public.protect_clip_evidence_assessment()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if tg_op = 'DELETE'
     and not exists (select 1 from public.video_clips where id = old.video_clip_id) then
    return old;
  end if;
  raise exception 'clip evidence assessments are append only';
end;
$$;

create trigger clip_evidence_assessments_no_update
  before update on public.clip_evidence_assessments
  for each row execute function public.protect_clip_evidence_assessment();
create trigger clip_evidence_assessments_cascade_delete_only
  before delete on public.clip_evidence_assessments
  for each row execute function public.protect_clip_evidence_assessment();
create trigger clip_evidence_assessments_no_truncate
  before truncate on public.clip_evidence_assessments
  for each statement execute function public.protect_clip_evidence_assessment();

revoke all on function public.protect_clip_evidence_assessment() from public, anon, authenticated;

alter table public.analysis_runs
  add column evidence_assessment_id uuid
    references public.clip_evidence_assessments(id) on delete set null,
  add column provider_usage jsonb
    check (provider_usage is null or jsonb_typeof(provider_usage) = 'object');

create index analysis_runs_evidence_assessment_id_idx
  on public.analysis_runs(evidence_assessment_id)
  where evidence_assessment_id is not null;

alter table public.issues
  add column claim_decision jsonb
    check (claim_decision is null or jsonb_typeof(claim_decision) = 'object');

-- A retained analysis_runs row has two independent SET NULL paths when its clip
-- is deleted. PostgreSQL may process the assessment CASCADE before both actions
-- reach analysis_runs, causing an immediate FK check to see the now-deleted
-- assessment id. Clear only the new link before the parent cascade begins.
create function public.clear_clip_evidence_run_links()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  update public.analysis_runs
  set evidence_assessment_id = null
  where evidence_assessment_id in (
    select id from public.clip_evidence_assessments where video_clip_id = old.id
  );
  return old;
end;
$$;

create trigger video_clips_clear_evidence_run_links
  before delete on public.video_clips
  for each row execute function public.clear_clip_evidence_run_links();

revoke all on function public.clear_clip_evidence_run_links() from public, anon, authenticated;

-- Demo retains its legacy policy. Mirror nullable report-shape columns only;
-- there is deliberately no demo.clip_evidence_assessments table and therefore
-- no demo foreign key for evidence_assessment_id.
alter table demo.analysis_runs
  add column evidence_assessment_id uuid,
  add column provider_usage jsonb
    check (provider_usage is null or jsonb_typeof(provider_usage) = 'object');

alter table demo.issues
  add column claim_decision jsonb
    check (claim_decision is null or jsonb_typeof(claim_decision) = 'object');

comment on table public.clip_evidence_assessments is
  'Private append-only historical gate assessments. clip_status is not claim reliability or display authorization.';
comment on column public.clip_evidence_assessments.reliability_profile_version is
  'Exact profile version at assessment time; NULL means no calibrated profile was recorded.';
comment on column public.analysis_runs.evidence_assessment_id is
  'Assessment used by a provider run that actually occurred; NULL for historical or unlinked runs.';
comment on column public.issues.claim_decision is
  'Nullable historical claim decision; does not alter existing review/display state.';

notify pgrst, 'reload schema';
