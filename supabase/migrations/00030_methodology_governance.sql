-- Fixes the governance/schema blockers found by the Codex audit of
-- 00029_methodology_knowledge.sql: approving a claim immediately set
-- active=true (conflating "reviewed" with "in production"), there was no
-- way to represent AI-reviewed-but-not-human-reviewed provenance, no
-- durable candidate ID survived import, and the research evidence-type
-- vocabulary didn't match production's. This migration is governance/schema
-- only - it does not import, approve, stage, or publish any claim, and does
-- not touch knowledge/claims.json, analysis prompt behavior, or the Gemini
-- production model.
--
-- Backward compatibility: every ALTER TABLE below is additive
-- (nullable/defaulted columns, or a constraint that's trivially satisfied
-- by every existing row's defaults) so it's safe against a populated
-- database. No existing methodology_claims row's active/review_status is
-- touched by this migration, and methodology_version_items (the immutable
-- published-snapshot payloads) is not touched at all - historical published
-- content is preserved exactly as published. Pre-existing approved rows (if
-- any) will show review_method = NULL after this migration, honestly
-- reflecting that this repo has no record of how they were actually
-- reviewed - deliberately NOT backfilled to 'human' or any other value,
-- since fabricating review provenance would be worse than leaving it
-- unknown. The "review_method required to approve" rule is enforced only
-- at the review_methodology_claim() RPC going forward (see below), not as a
-- table CHECK constraint, specifically so it can never conflict with
-- historical data that predates this governance model.

-- ---------------------------------------------------------------------
-- 1. Durable candidate ID - survives import/review/version staging/publish.
--    Nullable (hand-authored admin claims with no research pipeline ID are
--    still valid), unique when present (a plain unique index already
--    allows any number of NULLs in Postgres).
-- ---------------------------------------------------------------------
alter table methodology_claims add column candidate_id text;
create unique index methodology_claims_candidate_id_key on methodology_claims (candidate_id) where candidate_id is not null;
comment on column methodology_claims.candidate_id is
  'Stable, durable identifier from the research/import pipeline (e.g. "DRV2-001") - distinct from the generated uuid id, and preserved across review and publication so a claim can be traced back to its research artifact.';

-- ---------------------------------------------------------------------
-- 2. human_verified - real, never implied by AI review. Defaults false and
--    is only ever set true by review_methodology_claim() when
--    review_method = 'human' - enforced below by a CHECK constraint, not
--    just application logic, so it cannot be set true any other way even
--    by a future bug or a direct (admin-update-policy-permitted) table
--    write on a still-candidate row.
-- ---------------------------------------------------------------------
alter table methodology_claims add column human_verified boolean not null default false;

-- ---------------------------------------------------------------------
-- 3. review_method - who/what actually performed the review. Nullable
--    before review (a fresh candidate has none). Not constrained to be
--    non-null on approval at the table level (see backward-compatibility
--    note above) - that rule lives in review_methodology_claim().
-- ---------------------------------------------------------------------
alter table methodology_claims add column review_method text check (review_method in ('human', 'dual_model', 'mixed'));
comment on column methodology_claims.review_method is
  'How this claim was actually reviewed: human (a person reviewed it end to end - human_verified=true), dual_model (independent AI passes only, e.g. this project''s Gemini-verification + Claude-adjudication pattern, with no human involvement - human_verified=false), or mixed (both human review and AI/model review contributed to the final decision - human_verified=true, since a human was genuinely involved even if not the sole reviewer). NULL before any review.';

-- human_verified can only be true when review_method reflects genuine human
-- involvement ('human' or 'mixed') - makes "fake human verification"
-- structurally impossible for a pure dual_model (AI-only) review, not just
-- a matter of application discipline.
alter table methodology_claims add constraint methodology_claims_human_verified_requires_human_method
  check (review_method in ('human', 'mixed') or human_verified = false);

-- ---------------------------------------------------------------------
-- 4. Evidence-type vocabulary: audited the production check constraint
--    (research, instrumented_measurement, coaching_experience,
--    video_observation, expert_opinion, analogy, unknown) against the
--    research vocabulary actually used across the seed-v1 artifacts
--    (coaching_instruction, coaching_heuristic, drill_prescription,
--    biomechanical_explanation, research_supported, expert_opinion).
--
--    Deterministic mapping, documented here and in
--    src/services/knowledge/methodologyEvidenceMapping.ts (the single
--    source of truth an import script must use - no silent coercion):
--      coaching_instruction   -> coaching_experience  (a coach's stated
--                                 practice/instructional convention IS a
--                                 species of coaching experience)
--      coaching_heuristic     -> coaching_experience  (an experiential
--                                 diagnostic heuristic IS a species of
--                                 coaching experience)
--      research_supported     -> research             (identical meaning)
--      expert_opinion         -> expert_opinion        (identical, no change)
--      drill_prescription     -> drill_prescription    (NEW - a prescribed
--                                 practice protocol is categorically
--                                 different from an experiential judgment;
--                                 collapsing it into coaching_experience
--                                 would lose real meaning)
--      biomechanical_explanation -> biomechanical_explanation (NEW - a
--                                 mechanistic/anatomical account is
--                                 categorically different from experience,
--                                 research, or a drill; no existing label
--                                 fits without changing its meaning)
--
--    Minimal extension: exactly two new values added, everything else maps
--    onto the existing vocabulary with no meaning change.
-- ---------------------------------------------------------------------
alter table methodology_claims drop constraint methodology_claims_evidence_type_check;
alter table methodology_claims add constraint methodology_claims_evidence_type_check
  check (evidence_type in (
    'research', 'instrumented_measurement', 'coaching_experience', 'video_observation',
    'expert_opinion', 'analogy', 'unknown', 'drill_prescription', 'biomechanical_explanation'
  ));

-- ---------------------------------------------------------------------
-- 5. review_methodology_claim() - approval no longer touches `active` at
--    all (it stays exactly what it already was - false for a fresh
--    candidate, per the table default). `active` is now set ONLY by
--    publish_methodology_snapshot() below, as a direct consequence of
--    snapshot membership - never by review. review_method is now a real
--    parameter, required when approving, and human_verified is DERIVED
--    from it inside the function (never a caller-supplied boolean) so a
--    caller cannot claim human_verified=true while specifying
--    review_method='dual_model' or vice versa.
--
--    Hotfix exception: when a decision moves an already-published claim
--    OUT of 'approved' (dispute/reject/duplicate/superseded), this also
--    clears active=false immediately - not because review sets active in
--    general, but because leaving a disputed claim's stale active=true
--    around until the next publish would violate the table's own
--    "not active or review_status = 'approved'" invariant, and because a
--    hotfix should visibly stop claiming active status right away rather
--    than lie about it for an indeterminate window. This does NOT set
--    active=true under any circumstance - only ever clears it.
-- ---------------------------------------------------------------------
create or replace function review_methodology_claim(
  p_claim_id uuid,
  p_decision text,
  p_approved_text text default null,
  p_review_notes text default null,
  p_rejection_reason text default null,
  p_duplicate_of_claim_id uuid default null,
  p_supersedes_claim_id uuid default null,
  p_review_method text default null
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
  if p_review_method is not null and p_review_method not in ('human', 'dual_model', 'mixed') then
    raise exception 'invalid review_method: % (must be human, dual_model, or mixed)', p_review_method;
  end if;

  select * into claim_row from methodology_claims where id = p_claim_id;
  if claim_row.id is null then
    raise exception 'claim not found: %', p_claim_id;
  end if;

  if p_decision = 'approved' then
    if p_approved_text is null or btrim(p_approved_text) = '' then
      raise exception 'approved_text is required to approve a claim';
    end if;
    if p_review_method is null then
      raise exception 'review_method is required to approve a claim (human, dual_model, or mixed) - approval must record how it was actually reviewed';
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
  -- after publication - that IS the documented hotfix mechanism: it takes
  -- the claim out of 'approved', so the NEXT publish naturally excludes it
  -- (publish now selects on review_status = 'approved' alone - see below),
  -- while the already-frozen historical methodology_version_items payload
  -- is never touched and remains immutable.
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
    review_method = coalesce(p_review_method, review_method),
    -- human_verified=true for 'human' (a person reviewed it end to end) AND
    -- 'mixed' (a human genuinely contributed to the decision, even
    -- alongside AI review) - false only for 'dual_model' (AI-only, no
    -- human involvement at all). Always server-derived, never a
    -- caller-supplied boolean.
    human_verified = case when p_decision = 'approved' then (p_review_method in ('human', 'mixed')) else human_verified end,
    -- active is NEVER set true here - only publish_methodology_snapshot()
    -- does that. It IS cleared here when a hotfix moves a previously-
    -- published, currently-active claim out of 'approved' - see header note.
    active = case when p_decision <> 'approved' then false else active end,
    updated_at = now()
  where id = p_claim_id
  returning * into updated;

  return updated;
end;
$$;
grant execute on function review_methodology_claim(uuid, text, text, text, text, uuid, uuid, text) to authenticated;
comment on function review_methodology_claim(uuid, text, text, text, text, uuid, uuid, text) is
  'Admin-only claim review decision. Reviewer identity/timestamp always come from auth.uid()/now(), never client input. review_method is required to approve; human_verified is derived from it (true only for review_method=''human''), never caller-supplied directly. Never sets active=true - approval and activation are fully separate; active only becomes true via publish_methodology_snapshot(). Refuses to re-approve (with different text) a claim already frozen into a published methodology_version_items row, but allows the hotfix decisions (reject/dispute/duplicate/superseded) on a published claim, clearing active=false immediately in that case.';

-- Old 7-arg overload is superseded by the 8-arg version above. Since
-- Postgres resolves overloaded functions by exact argument signature, the
-- old signature would otherwise remain callable (bypassing the new
-- review_method requirement) - drop it explicitly so only the new,
-- governance-aware signature exists.
drop function if exists review_methodology_claim(uuid, text, text, text, text, uuid, uuid);

-- ---------------------------------------------------------------------
-- 6/7. Approved / staged / active are three distinct states, not two.
--    APPROVED means "passed review, eligible for use" - it must NOT force
--    a claim into the next release. STAGED/SELECTED is a deliberate act of
--    choosing exactly which approved claims belong in a particular release,
--    performed by passing an explicit claim-id list to preview/publish.
--    ACTIVE means "actually in the currently published snapshot".
--
--    This reuses the existing methodology_versions/methodology_version_items
--    architecture as the staging mechanism (per the smallest-safe-change
--    preference) rather than adding a parallel concept: "staging" and
--    "freezing" happen as the same atomic act, at the moment of publish,
--    driven by an explicit p_claim_ids array the caller must supply - never
--    an implicit "everything currently approved". An approved claim with no
--    release yet built around it simply stays approved/inactive
--    indefinitely, exactly as intended.
--
--    preview_methodology_snapshot(p_claim_ids) - p_claim_ids is OPTIONAL
--    here: with no argument, it lists every currently-approved claim (the
--    pool an admin chooses a release from); with an explicit array, it
--    previews exactly that candidate selection before committing to
--    publish it - "preview/staging explicitly chooses approved claim IDs".
--
--    publish_methodology_snapshot(p_claim_ids) - p_claim_ids is REQUIRED
--    (no default): the caller must explicitly enumerate which approved
--    claims this release includes, even to publish an empty snapshot
--    (pass '{}'::uuid[] deliberately). Every id supplied must currently be
--    an approved claim, or the whole publish is rejected. This is the one
--    and only difference from the prior draft of this migration, which
--    selected every review_status='approved' claim unconditionally and so
--    collapsed "approved" and "selected for this release" into the same
--    state - confirmed by inspection and fixed here.
-- ---------------------------------------------------------------------
-- SECURITY DEFINER + `select * from methodology_claims` with no admin check
-- would let ANY authenticated user enumerate every approved claim - the
-- same class of data methodology_claims' own RLS policies (00029) already
-- restrict to methodology admins only. A SECURITY DEFINER function runs
-- with the DEFINER's privileges, bypassing RLS entirely, so this function
-- itself is the only thing standing between "approved methodology content"
-- and "readable by any coach" - it must enforce the same admin check every
-- other methodology admin RPC does. plpgsql (not sql) so it can actually
-- raise, matching review_methodology_claim()/publish_methodology_snapshot()'s
-- existing is_methodology_admin() guard - no second authorization model.
create or replace function preview_methodology_snapshot(p_claim_ids uuid[] default null)
returns setof methodology_claims
language plpgsql
security definer
stable
set search_path = public
as $$
begin
  if not is_methodology_admin() then
    raise exception 'not authorized: methodology admin required';
  end if;
  return query
    select * from methodology_claims
    where review_status = 'approved'
      and (p_claim_ids is null or id = any(p_claim_ids))
    order by id;
end;
$$;
grant execute on function preview_methodology_snapshot(uuid[]) to authenticated;
comment on function preview_methodology_snapshot(uuid[]) is
  'Admin-only. With no argument: every currently-approved claim (the pool to choose a release from). With an explicit claim-id array: previews exactly that candidate selection, as publish_methodology_snapshot() would freeze it. Requires is_methodology_admin() - the same guard every other methodology admin RPC uses - since as a SECURITY DEFINER function it would otherwise bypass methodology_claims'' own RLS entirely.';
-- The prior zero-arg signature is a distinct overload in Postgres (0 args
-- vs 1 arg-with-default) and would otherwise remain callable, ambiguously
-- competing with the new default - drop it explicitly.
drop function if exists preview_methodology_snapshot();

create or replace function publish_methodology_snapshot(p_version_label text, p_claim_ids uuid[], p_notes text default '')
returns methodology_versions
language plpgsql
security definer
set search_path = public
as $$
declare
  new_version methodology_versions;
  invalid_id uuid;
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
  if p_claim_ids is null then
    raise exception 'p_claim_ids is required - pass an explicit array of approved claim ids to include in this release (or ''{}''::uuid[] to publish deliberately empty). Publishing never implicitly includes every approved claim.';
  end if;

  select cid into invalid_id from unnest(p_claim_ids) as cid
  where not exists (select 1 from methodology_claims where id = cid and review_status = 'approved')
  limit 1;
  if invalid_id is not null then
    raise exception 'claim % is not an approved claim - only approved claims may be staged into a release', invalid_id;
  end if;

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
      'candidate_id', c.candidate_id,
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
      'review_method', c.review_method,
      'human_verified', c.human_verified,
      'claim_id', c.id
    )
  from methodology_claims c
  join methodology_materials m on m.id = c.material_id
  join methodology_sources s on s.id = m.source_id
  where c.review_status = 'approved' and c.id = any(p_claim_ids);

  -- Reconcile active to exactly match the new snapshot's membership - the
  -- only writes to methodology_claims.active anywhere in this schema. An
  -- approved claim NOT in p_claim_ids simply never becomes active here,
  -- and an approved claim that WAS active from a prior release but is
  -- excluded from this one becomes inactive - it remains approved and can
  -- be staged into a later release at any time.
  update methodology_claims set active = true
  where id in (select claim_id from methodology_version_items where version_label = p_version_label);
  update methodology_claims set active = false
  where active = true
    and id not in (select claim_id from methodology_version_items where version_label = p_version_label);

  return new_version;
end;
$$;
grant execute on function publish_methodology_snapshot(text, uuid[], text) to authenticated;
comment on function publish_methodology_snapshot(text, uuid[], text) is
  'Admin-only atomic publish: freezes exactly the caller-specified, currently-approved claims (p_claim_ids) into a new immutable methodology_version_items snapshot and activates it. Rejects any id that is not currently approved. The ONLY function that ever sets methodology_claims.active - approval never does, and being approved never implies being selected for a release. Reconciles active to exactly the new snapshot''s membership. Raises (rolling back the whole transaction) on any failure, leaving the previous snapshot active. An empty p_claim_ids array is valid (the initial k-0.1.0 baseline is empty).';
-- The prior (text, text) signature had no way to distinguish "approved" from
-- "selected for this release" - drop it so only the claim-id-aware version
-- is callable.
drop function if exists publish_methodology_snapshot(text, text);
