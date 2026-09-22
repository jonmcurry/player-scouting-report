// Thin wrappers around the methodology_* tables and RPCs
// (supabase/migrations/00029_methodology_knowledge.sql). Every write that
// changes review state or publishes goes through the guarded RPCs, never a
// raw table update - reviewer identity and publication atomicity live in
// the database, not here.
import { supabase } from "./shared.js";

function unwrap(result, what) {
  if (result.error) throw new Error(`${what}: ${result.error.message}`);
  return result.data;
}

// --- Sources ---------------------------------------------------------------

export async function listSources() {
  return unwrap(await supabase.from("methodology_sources").select("*").order("name"), "listing sources");
}

export async function getSource(id) {
  return unwrap(await supabase.from("methodology_sources").select("*").eq("id", id).single(), "loading source");
}

export async function createSource(fields) {
  return unwrap(await supabase.from("methodology_sources").insert(fields).select().single(), "creating source");
}

export async function updateSource(id, fields) {
  return unwrap(await supabase.from("methodology_sources").update(fields).eq("id", id).select().single(), "updating source");
}

// --- Materials ---------------------------------------------------------------

export async function listMaterials() {
  return unwrap(
    await supabase.from("methodology_materials").select("*, methodology_sources(name)").order("created_at", { ascending: false }),
    "listing materials",
  );
}

export async function getMaterial(id) {
  return unwrap(await supabase.from("methodology_materials").select("*, methodology_sources(name)").eq("id", id).single(), "loading material");
}

export async function createMaterial(fields) {
  return unwrap(await supabase.from("methodology_materials").insert(fields).select().single(), "creating material");
}

export async function updateMaterial(id, fields) {
  return unwrap(await supabase.from("methodology_materials").update(fields).eq("id", id).select().single(), "updating material");
}

// --- Claims ---------------------------------------------------------------

export async function listClaims({ reviewStatus } = {}) {
  let query = supabase
    .from("methodology_claims")
    .select("*, methodology_materials(title, material_type, methodology_sources(name))")
    .order("created_at", { ascending: false });
  if (reviewStatus) query = query.eq("review_status", reviewStatus);
  return unwrap(await query, "listing claims");
}

export async function getClaim(id) {
  return unwrap(
    await supabase.from("methodology_claims").select("*, methodology_materials(*, methodology_sources(*))").eq("id", id).single(),
    "loading claim",
  );
}

export async function createClaim(fields) {
  return unwrap(await supabase.from("methodology_claims").insert(fields).select().single(), "creating claim");
}

/** Non-review edits to a still-candidate claim (e.g. fixing a typo before
 * review). Review-state transitions always go through reviewClaim(). */
export async function updateCandidateClaim(id, fields) {
  return unwrap(await supabase.from("methodology_claims").update(fields).eq("id", id).select().single(), "updating candidate claim");
}

/**
 * decision: 'approved' | 'rejected' | 'disputed' | 'duplicate' | 'superseded'
 * reviewMethod: 'human' | 'dual_model' | 'mixed' - required when decision is
 * 'approved' (the RPC itself enforces this; human_verified is derived from
 * it server-side, never sent as a separate flag here, so the UI can't
 * accidentally claim human verification for an AI-only review).
 */
export async function reviewClaim({ claimId, decision, approvedText, reviewNotes, rejectionReason, duplicateOfClaimId, supersedesClaimId, reviewMethod }) {
  return unwrap(
    await supabase.rpc("review_methodology_claim", {
      p_claim_id: claimId,
      p_decision: decision,
      p_approved_text: approvedText ?? null,
      p_review_notes: reviewNotes ?? null,
      p_rejection_reason: rejectionReason ?? null,
      p_duplicate_of_claim_id: duplicateOfClaimId ?? null,
      p_supersedes_claim_id: supersedesClaimId ?? null,
      p_review_method: reviewMethod ?? null,
    }),
    "reviewing claim",
  );
}

/** "Editing" a published claim: create a fresh candidate with
 * supersedes_claim_id set, per the immutable-publication rule - never
 * mutate the original row. Deliberately does NOT copy candidate_id,
 * review_method, or human_verified from the original - this is a distinct
 * new claim requiring its own review and, if it should carry a durable ID,
 * its own explicit one (e.g. "DRV2-001-v2"), not an inherited one that
 * would misrepresent its own review history. */
export async function createSupersedingCandidate(originalClaim, fields) {
  const { id, review_status, reviewed_by, reviewed_at, active, created_at, updated_at, duplicate_of_claim_id, candidate_id, review_method, human_verified, ...rest } = originalClaim;
  return createClaim({
    ...rest,
    ...fields,
    supersedes_claim_id: id,
    review_status: "candidate",
    approved_text: null,
    reviewed_by: null,
    reviewed_at: null,
    review_method: null,
    human_verified: false,
    active: false,
  });
}

// --- Versions / publication ---------------------------------------------------------------

export async function listVersions() {
  return unwrap(await supabase.from("methodology_versions").select("*").order("created_at", { ascending: false }), "listing versions");
}

export async function getActiveVersion() {
  return unwrap(await supabase.from("methodology_versions").select("*").eq("active", true).maybeSingle(), "loading active version");
}

export async function getActiveVersionItems(versionLabel) {
  return unwrap(
    await supabase.from("methodology_version_items").select("*").eq("version_label", versionLabel).order("position"),
    "loading version items",
  );
}

/** With no argument: every currently-approved claim (the pool to build a
 * release from). With claimIds: previews exactly that selection. */
export async function previewSnapshot(claimIds) {
  return unwrap(await supabase.rpc("preview_methodology_snapshot", { p_claim_ids: claimIds ?? null }), "previewing snapshot");
}

/** claimIds is required - publish never implicitly includes every approved
 * claim (approved != selected for this release). Pass [] to publish a
 * deliberately empty snapshot. */
export async function publishSnapshot(versionLabel, claimIds, notes) {
  return unwrap(
    await supabase.rpc("publish_methodology_snapshot", { p_version_label: versionLabel, p_claim_ids: claimIds, p_notes: notes ?? "" }),
    "publishing snapshot",
  );
}
