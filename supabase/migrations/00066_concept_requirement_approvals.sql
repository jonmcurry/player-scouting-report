-- D7 concept requirement review audit; no enforcement effect and no seeded approvals.
-- requirement_sha256 hashes the exact canonical requirement the reviewer saw.
-- The server cannot recompute it; consumers must compare it to the current requirement hash.
create table public.concept_requirement_approvals (
  id uuid primary key default gen_random_uuid(),
  concept text not null check (concept in ('contact', 'extension', 'load', 'stride_plant', 'hand_path', 'barrel_path', 'barrel_depth', 'head_visual_stability', 'finish_balance', 'front_side_stability', 'posture', 'hip_shoulder_sequencing', 'stance_setup', 'timing', 'swing_decision', 'pitch_location_adjustment', 'game_approach')),
  claims_version text not null check (claims_version ~ '^claims-[0-9]+\.[0-9]+\.[0-9]+(-proposed)?$'),
  requirement_sha256 text not null check (requirement_sha256 ~ '^[a-f0-9]{64}$'),
  reviewer_id uuid not null,
  decision text not null check (decision in ('approved', 'rejected')),
  notes text not null default '',
  decided_at timestamptz not null default transaction_timestamp()
);
alter table public.concept_requirement_approvals owner to postgres;
alter table public.concept_requirement_approvals enable row level security;
revoke all on public.concept_requirement_approvals from public, anon, authenticated, service_role;
grant select on public.concept_requirement_approvals to service_role;
create trigger immutable_concept_requirement_approvals
before update or delete or truncate on public.concept_requirement_approvals
for each statement execute function public.prevent_curation_audit_mutation();

create function public.approve_concept_requirement(p_concept text, p_claims_version text,
  p_requirement_sha256 text, p_decision text, p_notes text default '') returns uuid
language plpgsql security definer set search_path = '' as $$
declare approval_id uuid;
begin
  if coalesce(auth.role(), '') <> 'authenticated' or auth.uid() is null then
    raise exception 'Authenticated reviewer required';
  end if;
  -- Serialize revocation with the entire approval transaction.
  perform 1 from public.curation_reviewers
    where user_id = auth.uid() and role = 'concept_reviewer' and revoked_at is null for share;
  if not found then raise exception 'Active concept reviewer required'; end if;
  if p_decision is null or p_decision not in ('approved', 'rejected') then raise exception 'Invalid decision'; end if;
  if p_concept is null or p_concept not in ('contact', 'extension', 'load', 'stride_plant', 'hand_path', 'barrel_path', 'barrel_depth', 'head_visual_stability', 'finish_balance', 'front_side_stability', 'posture', 'hip_shoulder_sequencing', 'stance_setup', 'timing', 'swing_decision', 'pitch_location_adjustment', 'game_approach') then raise exception 'Invalid concept'; end if;
  if p_claims_version is null or p_claims_version !~ '^claims-[0-9]+\.[0-9]+\.[0-9]+(-proposed)?$' then
    raise exception 'Invalid claims version';
  end if;
  if p_requirement_sha256 is null or p_requirement_sha256 !~ '^[a-f0-9]{64}$' then
    raise exception 'Invalid requirement hash';
  end if;
  insert into public.concept_requirement_approvals(concept, claims_version, requirement_sha256, reviewer_id, decision, notes)
    values (p_concept, p_claims_version, p_requirement_sha256, auth.uid(), p_decision, coalesce(p_notes, ''))
    returning id into approval_id;
  return approval_id;
end;
$$;
alter function public.approve_concept_requirement(text,text,text,text,text) owner to postgres;
revoke all on function public.approve_concept_requirement(text,text,text,text,text) from public, anon, authenticated, service_role;
grant execute on function public.approve_concept_requirement(text,text,text,text,text) to authenticated;
