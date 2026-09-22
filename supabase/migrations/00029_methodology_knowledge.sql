-- Phases 1-3 of the HitterLoop Methodology Knowledge System (see the
-- approved architecture doc + Codex amendments). This migration covers
-- Phase 1 only: database contracts, admin authorization, immutable
-- publication. No claims are seeded here - only the empty k-0.1.0 baseline
-- version, mirroring knowledge/version.json's existing empty baseline.
-- Gemini extraction, drill auto-linking, and metrics/3D work are explicitly
-- out of scope (see the amendments) and are not touched by this migration.

-- ---------------------------------------------------------------------
-- Methodology admin allowlist - global, not a coach_team_access role.
-- Being a coach or head coach does NOT imply methodology admin, and
-- methodology-admin status does NOT grant team/player data access.
-- ---------------------------------------------------------------------
create table methodology_admins (
  user_id uuid primary key references auth.users (id),
  created_at timestamptz not null default now(),
  created_by uuid references auth.users (id)
);

create or replace function is_methodology_admin()
returns boolean
language sql
security definer
stable
as $$
  select exists (
    select 1 from methodology_admins where user_id = auth.uid()
  );
$$;

-- ---------------------------------------------------------------------
-- methodology_sources
-- ---------------------------------------------------------------------
create table methodology_sources (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  source_type text not null check (source_type in (
    'governing_body', 'association', 'research', 'training_org', 'educator', 'publication', 'other'
  )),
  canonical_url text not null,
  sport_scope text not null check (sport_scope in ('baseball', 'softball', 'both')),
  level_scope text[] not null default '{}',
  topic_strengths text[] not null default '{}',
  limitations_notes text not null default '',
  -- Deliberately NOT a "trusted" state - approval of a source never implies
  -- its claims are automatically accepted. approved_for_scope means "useful
  -- within the documented scope/limitations", not "universal authority".
  trust_status text not null default 'candidate' check (trust_status in (
    'candidate', 'approved_for_scope', 'limited', 'do_not_use'
  )),
  -- active=false only removes this source from future research/material
  -- entry - it must never retroactively affect historical snapshots, which
  -- reference frozen payloads in methodology_version_items, not this row.
  active boolean not null default true,
  created_by uuid references auth.users (id),
  updated_by uuid references auth.users (id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- ---------------------------------------------------------------------
-- methodology_materials
-- ---------------------------------------------------------------------
create table methodology_materials (
  id uuid primary key default gen_random_uuid(),
  source_id uuid not null references methodology_sources (id),
  title text not null,
  canonical_url text not null,
  external_id text,
  published_at date,
  material_type text not null check (material_type in (
    'video', 'article', 'clinic', 'podcast', 'book', 'other'
  )),
  ingestion_state text not null default 'queued' check (ingestion_state in (
    'queued', 'extracted', 'reviewed', 'rejected', 'failed'
  )),
  notes text not null default '',
  last_extraction_error text,
  created_by uuid references auth.users (id),
  updated_by uuid references auth.users (id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index methodology_materials_source_idx on methodology_materials (source_id);

-- ---------------------------------------------------------------------
-- methodology_claims - one atomic methodology proposition.
-- ---------------------------------------------------------------------
create table methodology_claims (
  id uuid primary key default gen_random_uuid(),
  material_id uuid not null references methodology_materials (id),

  source_start_seconds numeric,
  source_end_seconds numeric,
  source_location text,

  concept text not null,
  extracted_text text not null,
  approved_text text,
  observable_evidence text not null default '',
  coaching_cue text,
  applies_when text not null default '',
  does_not_apply_when text not null default '',

  sport_scope text not null check (sport_scope in ('baseball', 'softball', 'both')),
  level_scope text[] not null default '{}',
  -- Reuses knowledge/claims.json's existing AGE_GUARDRAILS vocabulary
  -- (src/services/knowledge/knowledgePack.ts) rather than inventing a new one.
  age_guardrail text not null check (age_guardrail in (
    'youth_appropriate', 'teen_appropriate', 'advanced_only', 'requires_physical_screening'
  )),

  -- Reuses knowledge/claims.json's existing EVIDENCE_TYPES vocabulary.
  evidence_type text not null check (evidence_type in (
    'research', 'instrumented_measurement', 'coaching_experience', 'video_observation',
    'expert_opinion', 'analogy', 'unknown'
  )),
  numeric_claim boolean not null default false,
  numeric_evidence_ref text,

  quality_notes text not null default '',
  contradiction_group text,
  contradiction_state text not null default 'none' check (contradiction_state in ('none', 'open', 'resolved')),
  review_status text not null default 'candidate' check (review_status in (
    'candidate', 'approved', 'rejected', 'disputed', 'duplicate', 'superseded'
  )),
  reviewed_by uuid references auth.users (id),
  reviewed_at timestamptz,
  review_notes text not null default '',
  rejection_reason text,

  duplicate_of_claim_id uuid references methodology_claims (id),
  supersedes_claim_id uuid references methodology_claims (id),

  -- Not part of the required v1 review workflow (Codex amendment 3) - a
  -- later deliberate curation step connects methodology to production
  -- drills. Never auto-populated from source material.
  related_drill_id uuid,

  active boolean not null default false,
  deactivated_at timestamptz,
  deactivated_by uuid references auth.users (id),
  deactivation_reason text,

  created_by uuid references auth.users (id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),

  -- active claims must be approved (doc SS11).
  check (not active or review_status = 'approved'),
  -- approval requires approved_text + reviewer identity + timestamp together.
  check (
    review_status <> 'approved'
    or (approved_text is not null and reviewed_by is not null and reviewed_at is not null)
  ),
  -- numeric claims require an evidence reference before they can be approved.
  check (not (numeric_claim and review_status = 'approved') or numeric_evidence_ref is not null),
  -- duplicates must record what they duplicate.
  check (review_status <> 'duplicate' or duplicate_of_claim_id is not null),
  -- video-material claims require a timestamp or an explicit verified
  -- location note before approval (checked in review_methodology_claim();
  -- this table-level constraint below is best-effort since it can't join
  -- to methodology_materials directly).
  check (
    review_status <> 'approved'
    or source_start_seconds is not null
    or nullif(btrim(source_location), '') is not null
  )
);
create index methodology_claims_material_idx on methodology_claims (material_id);
create index methodology_claims_review_status_idx on methodology_claims (review_status);
create index methodology_claims_active_idx on methodology_claims (active) where active;

-- ---------------------------------------------------------------------
-- methodology_versions - immutable published snapshots.
-- ---------------------------------------------------------------------
create table methodology_versions (
  version_label text primary key,
  notes text not null default '',
  status text not null default 'published' check (status in ('published', 'retired')),
  active boolean not null default false,
  created_by uuid references auth.users (id),
  created_at timestamptz not null default now(),
  published_at timestamptz
);
-- At most one active version at a time.
create unique index one_active_methodology_version on methodology_versions (active) where active;

-- Empty baseline, mirroring knowledge/version.json's existing empty
-- baseline - infrastructure, not a claim seed (Codex amendment: do not
-- seed claims in migrations).
insert into methodology_versions (version_label, notes, status, active, published_at)
values ('k-0.1.0', 'Initial empty production methodology set. No claims have been human-approved yet.', 'published', true, now());

-- ---------------------------------------------------------------------
-- methodology_version_items - frozen per-version claim payloads.
-- ---------------------------------------------------------------------
create table methodology_version_items (
  version_label text not null references methodology_versions (version_label),
  claim_id uuid not null references methodology_claims (id),
  position smallint not null,
  item_payload jsonb not null,
  created_at timestamptz not null default now(),
  primary key (version_label, claim_id)
);
create unique index methodology_version_items_position_idx on methodology_version_items (version_label, position);

-- ---------------------------------------------------------------------
-- RLS - anon: no access. authenticated (ordinary coach): no rows, no
-- mutation. methodology admin: read + guarded RPC mutation. service_role:
-- full access (the worker reads the active frozen snapshot this way).
-- ---------------------------------------------------------------------
alter table methodology_admins enable row level security;
alter table methodology_sources enable row level security;
alter table methodology_materials enable row level security;
alter table methodology_claims enable row level security;
alter table methodology_versions enable row level security;
alter table methodology_version_items enable row level security;

create policy methodology_admins_admin_read on methodology_admins
  for select to authenticated using (is_methodology_admin());

create policy methodology_sources_admin_read on methodology_sources
  for select to authenticated using (is_methodology_admin());
create policy methodology_sources_admin_write on methodology_sources
  for insert to authenticated with check (is_methodology_admin());
create policy methodology_sources_admin_update on methodology_sources
  for update to authenticated using (is_methodology_admin()) with check (is_methodology_admin());

create policy methodology_materials_admin_read on methodology_materials
  for select to authenticated using (is_methodology_admin());
create policy methodology_materials_admin_write on methodology_materials
  for insert to authenticated with check (is_methodology_admin());
create policy methodology_materials_admin_update on methodology_materials
  for update to authenticated using (is_methodology_admin()) with check (is_methodology_admin());

create policy methodology_claims_admin_read on methodology_claims
  for select to authenticated using (is_methodology_admin());
create policy methodology_claims_admin_write on methodology_claims
  for insert to authenticated with check (is_methodology_admin());
-- Direct UPDATE is intentionally narrow: real review-state transitions go
-- through review_methodology_claim() below so reviewer identity can never
-- come from client input. This policy only covers non-review edits an
-- admin might make to an unreviewed candidate row (e.g. fixing a typo
-- before review) - review_status/reviewed_by/reviewed_at/active changes
-- belong to the RPC, not raw client updates.
create policy methodology_claims_admin_update on methodology_claims
  for update to authenticated
  using (is_methodology_admin() and review_status = 'candidate')
  with check (is_methodology_admin() and review_status = 'candidate');

create policy methodology_versions_admin_read on methodology_versions
  for select to authenticated using (is_methodology_admin());

create policy methodology_version_items_admin_read on methodology_version_items
  for select to authenticated using (is_methodology_admin());

-- Published items are immutable: no UPDATE/DELETE grant to anyone but
-- service_role, for any role, admin included - not even RLS-gated. This is
-- enforced at the grant level, not just by omitting a policy, mirroring
-- 00017_lock_down_reference_tables.sql's revoke pattern.
revoke update, delete on methodology_version_items from authenticated;
revoke update, delete on methodology_versions from authenticated;

grant select on methodology_admins to authenticated;
grant select, insert, update on methodology_sources to authenticated;
grant select, insert, update on methodology_materials to authenticated;
grant select, insert, update on methodology_claims to authenticated;
grant select on methodology_versions to authenticated;
grant select on methodology_version_items to authenticated;

grant all on methodology_admins to service_role;
grant all on methodology_sources to service_role;
grant all on methodology_materials to service_role;
grant all on methodology_claims to service_role;
grant all on methodology_versions to service_role;
grant all on methodology_version_items to service_role;

-- ---------------------------------------------------------------------
-- review_methodology_claim - the only path to changing review_status.
-- Reviewer identity always comes from auth.uid(), never client input.
-- ---------------------------------------------------------------------
create or replace function review_methodology_claim(
  p_claim_id uuid,
  p_decision text,
  p_approved_text text default null,
  p_review_notes text default null,
  p_rejection_reason text default null,
  p_duplicate_of_claim_id uuid default null,
  p_supersedes_claim_id uuid default null
)
returns methodology_claims
language plpgsql
security definer
set search_path = public
as $$
declare
  updated methodology_claims;
  material_row methodology_materials;
  claim_row methodology_claims;
begin
  if not is_methodology_admin() then
    raise exception 'not authorized: methodology admin required';
  end if;
  if p_decision not in ('approved', 'rejected', 'disputed', 'duplicate', 'superseded') then
    raise exception 'invalid decision: %', p_decision;
  end if;

  select * into claim_row from methodology_claims where id = p_claim_id;
  if claim_row.id is null then
    raise exception 'claim not found: %', p_claim_id;
  end if;

  if p_decision = 'approved' then
    if p_approved_text is null or btrim(p_approved_text) = '' then
      raise exception 'approved_text is required to approve a claim';
    end if;
    if claim_row.numeric_claim and claim_row.numeric_evidence_ref is null then
      raise exception 'numeric claim requires numeric_evidence_ref before approval';
    end if;
    select * into material_row from methodology_materials where id = claim_row.material_id;
    if material_row.material_type = 'video'
       and claim_row.source_start_seconds is null
       and nullif(btrim(claim_row.source_location), '') is null then
      raise exception 'video-material claims require a source timestamp or verified location before approval';
    end if;
  end if;

  if p_decision = 'duplicate' and p_duplicate_of_claim_id is null then
    raise exception 'duplicate_of_claim_id is required when marking a claim duplicate';
  end if;
  if p_decision = 'rejected' and (p_rejection_reason is null or btrim(p_rejection_reason) = '') then
    raise exception 'rejection_reason is required to reject a claim';
  end if;

  -- Published claims are never substantively edited in place - re-approving
  -- one (which would change its approved_text going into a future publish)
  -- requires a new candidate with supersedes_claim_id instead. Deactivating
  -- one (reject/dispute/duplicate/superseded) is explicitly allowed even
  -- after publication - that IS the documented hotfix mechanism (doc SS20):
  -- it flips active=false so the NEXT publish excludes it, while the
  -- already-frozen historical methodology_version_items payload is never
  -- touched and remains immutable.
  if p_decision = 'approved' and exists (select 1 from methodology_version_items where claim_id = p_claim_id) then
    raise exception 'this claim has already been published with different approved_text - corrections require a new candidate with supersedes_claim_id, not re-approving the published row';
  end if;

  update methodology_claims set
    review_status = p_decision,
    approved_text = case when p_decision = 'approved' then p_approved_text else approved_text end,
    review_notes = coalesce(p_review_notes, review_notes),
    rejection_reason = case when p_decision = 'rejected' then p_rejection_reason else rejection_reason end,
    duplicate_of_claim_id = case when p_decision = 'duplicate' then p_duplicate_of_claim_id else duplicate_of_claim_id end,
    supersedes_claim_id = coalesce(p_supersedes_claim_id, supersedes_claim_id),
    reviewed_by = auth.uid(),
    reviewed_at = now(),
    active = (p_decision = 'approved'),
    updated_at = now()
  where id = p_claim_id
  returning * into updated;

  return updated;
end;
$$;
grant execute on function review_methodology_claim(uuid, text, text, text, text, uuid, uuid) to authenticated;
comment on function review_methodology_claim(uuid, text, text, text, text, uuid, uuid) is
  'Admin-only claim review decision. Reviewer identity/timestamp always come from auth.uid()/now(), never client input. Refuses to touch a claim already frozen into a published methodology_version_items row.';

-- ---------------------------------------------------------------------
-- preview_methodology_snapshot - exact claim set a publish would freeze.
-- ---------------------------------------------------------------------
create or replace function preview_methodology_snapshot()
returns setof methodology_claims
language sql
security definer
stable
set search_path = public
as $$
  select * from methodology_claims
  where review_status = 'approved' and active = true
  order by id;
$$;
grant execute on function preview_methodology_snapshot() to authenticated;

-- ---------------------------------------------------------------------
-- publish_methodology_snapshot - atomic publication.
-- ---------------------------------------------------------------------
create or replace function publish_methodology_snapshot(p_version_label text, p_notes text default '')
returns methodology_versions
language plpgsql
security definer
set search_path = public
as $$
declare
  new_version methodology_versions;
  claim_count integer;
begin
  if not is_methodology_admin() then
    raise exception 'not authorized: methodology admin required';
  end if;
  if p_version_label is null or btrim(p_version_label) = '' then
    raise exception 'version_label is required';
  end if;
  if exists (select 1 from methodology_versions where version_label = p_version_label) then
    raise exception 'version_label % already exists - historical labels are never reused', p_version_label;
  end if;

  -- Deactivate the current active version FIRST (still same transaction as
  -- the insert below - nothing else can observe the momentary "zero active"
  -- state) so the new row can be inserted already active=true, and its
  -- RETURNING clause reflects that without a second write.
  update methodology_versions set active = false, status = 'retired'
  where active = true;

  insert into methodology_versions (version_label, notes, status, active, created_by, published_at)
  values (p_version_label, coalesce(p_notes, ''), 'published', true, auth.uid(), now())
  returning * into new_version;

  insert into methodology_version_items (version_label, claim_id, position, item_payload)
  select
    p_version_label,
    c.id,
    row_number() over (order by c.id)::smallint,
    jsonb_build_object(
      'concept', c.concept,
      'approved_text', c.approved_text,
      'observable_evidence', c.observable_evidence,
      'coaching_cue', c.coaching_cue,
      'applies_when', c.applies_when,
      'does_not_apply_when', c.does_not_apply_when,
      'sport_scope', c.sport_scope,
      'level_scope', c.level_scope,
      'age_guardrail', c.age_guardrail,
      'evidence_type', c.evidence_type,
      'numeric_claim', c.numeric_claim,
      'numeric_evidence_ref', c.numeric_evidence_ref,
      'source_name', s.name,
      'source_url', s.canonical_url,
      'material_title', m.title,
      'material_url', m.canonical_url,
      'material_external_id', m.external_id,
      'material_published_at', m.published_at,
      'source_start_seconds', c.source_start_seconds,
      'source_end_seconds', c.source_end_seconds,
      'source_location', c.source_location,
      'reviewed_by', c.reviewed_by,
      'reviewed_at', c.reviewed_at,
      'claim_id', c.id
    )
  from methodology_claims c
  join methodology_materials m on m.id = c.material_id
  join methodology_sources s on s.id = m.source_id
  where c.review_status = 'approved' and c.active = true;

  get diagnostics claim_count = row_count;

  return new_version;
end;
$$;
grant execute on function publish_methodology_snapshot(text, text) to authenticated;
comment on function publish_methodology_snapshot(text, text) is
  'Admin-only atomic publish: freezes approved+active claims into a new immutable methodology_version_items snapshot and activates it. Raises (rolling back the whole transaction) on any failure, leaving the previous snapshot active. Empty claim sets are valid (the initial k-0.1.0 baseline is empty).';

-- ---------------------------------------------------------------------
-- analysis_runs.knowledge_version -> methodology_versions FK.
-- Verified against this repo's local dev DB before adding: zero existing
-- analysis_runs rows at migration-write time (fresh local stack), so no
-- backfill was needed here. This does NOT verify production - inspect real
-- production analysis_runs.knowledge_version values before running this
-- migration against a production database; if any value there isn't a row
-- in methodology_versions (e.g. an old file-pack version label), insert a
-- matching retired methodology_versions row for it first or this ALTER
-- will fail.
-- ---------------------------------------------------------------------
alter table analysis_runs
  add constraint analysis_runs_knowledge_version_fkey
  foreign key (knowledge_version) references methodology_versions (version_label);
