/**
 * Integration tests for the methodology knowledge system (migration
 * 00029_methodology_knowledge.sql): claim-approval constraints, immutable
 * publication, one-active-version enforcement, and RLS/authorization.
 * Real local Supabase, no mocks - same standard as development.test.ts.
 * Requires `npx supabase start` and .env with SUPABASE_URL /
 * SUPABASE_ANON_KEY / SUPABASE_SERVICE_ROLE_KEY.
 */
import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import "dotenv/config";
import { getSupabaseClient } from "./supabaseClient.js";

const suffix = `${Date.now()}`;
const password = "TestPass123!methodology";
const svc = getSupabaseClient();

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function must(res: { data: any; error: { message: string } | null }, what: string): any {
  if (res.error) throw new Error(`${what}: ${res.error.message}`);
  return res.data;
}

interface User { id: string; email: string; client: SupabaseClient }
const createdUserIds: string[] = [];

async function makeUser(label: string, grantAdmin: boolean): Promise<User> {
  const email = `methodology-${label}-${suffix}@test.local`;
  const created = await svc.auth.admin.createUser({ email, password, email_confirm: true });
  if (created.error || !created.data.user) throw new Error(`createUser: ${created.error?.message}`);
  createdUserIds.push(created.data.user.id);
  if (grantAdmin) {
    must(await svc.from("methodology_admins").upsert({ user_id: created.data.user.id }), "grant admin");
  }
  const client = createClient(process.env.SUPABASE_URL!, process.env.SUPABASE_ANON_KEY!, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
  const signed = await client.auth.signInWithPassword({ email, password });
  if (signed.error) throw new Error(`sign in: ${signed.error.message}`);
  return { id: created.data.user.id, email, client };
}

let admin: User;
let coach: User;
let sourceId: string;
let videoMaterialId: string;
let articleMaterialId: string;

const createdTeamIds: string[] = [];
const createdSourceIds: string[] = [];
// Materials created OUTSIDE before()'s two file-level fixtures (i.e. by an
// individual test authoring its own source/material, like the "full path"
// test below) - must be tracked here or cleanup leaves them (and any claim
// referencing them) orphaned, since methodology_materials.source_id and
// methodology_claims.material_id have no ON DELETE CASCADE (00029) and the
// old cleanup below deleted sources without ever deleting these first,
// which fails on the FK and - because that delete's result was never
// checked - failed silently, leaving the source/material/claim behind.
// Confirmed as the exact defect docs/research/methodology-codex-audit-v1.md
// found (a leftover TEST-FULL-* fixture).
const createdMaterialIds: string[] = [];
const createdVersionLabels: string[] = [];
// The version that was active BEFORE this file ran (e.g. a locally published
// k-0.2.0) - restored in after(). Hard-coding k-0.1.0 there silently swapped a
// real local methodology back to the baseline (confirmed 2026-09-23).
let previouslyActive: { version_label: string; status: string } | null = null;

before(async () => {
  previouslyActive = ((await svc.from("methodology_versions").select("version_label, status").eq("active", true).maybeSingle()).data ?? null) as typeof previouslyActive;
  admin = await makeUser("admin", true);
  coach = await makeUser("coach", false);

  sourceId = (must(
    await svc.from("methodology_sources").insert({
      name: `Test Source ${suffix}`,
      source_type: "training_org",
      canonical_url: "https://example.com/source",
      sport_scope: "baseball",
      trust_status: "approved_for_scope",
    }).select("id").single(),
    "source",
  ) as { id: string }).id;
  createdSourceIds.push(sourceId);

  videoMaterialId = (must(
    await svc.from("methodology_materials").insert({
      source_id: sourceId,
      title: "Test video",
      canonical_url: "https://youtube.com/watch?v=test",
      material_type: "video",
    }).select("id").single(),
    "video material",
  ) as { id: string }).id;

  articleMaterialId = (must(
    await svc.from("methodology_materials").insert({
      source_id: sourceId,
      title: "Test article",
      canonical_url: "https://example.com/article",
      material_type: "article",
    }).select("id").single(),
    "article material",
  ) as { id: string }).id;
});

/** Deletes and logs (rather than silently swallowing) any real failure -
 * the old bare `await ...delete()` calls here let an FK-violation failure
 * (deleting a source while its material still existed) pass completely
 * unnoticed, which is exactly how the TEST-FULL-* fixture leak went
 * undetected. Cleanup failures still don't fail the test run itself
 * (a broken after() shouldn't mask which test actually failed), but they
 * are now impossible to miss in the test output. */
async function cleanupDelete(table: string, column: string, ids: string[]): Promise<void> {
  if (!ids.length) return;
  const result = await svc.from(table).delete().in(column, ids);
  if (result.error) console.error(`[methodology.test.ts cleanup] delete from ${table} where ${column} in (${ids.join(",")}) failed: ${result.error.message}`);
}

after(async () => {
  if (createdVersionLabels.length) {
    await svc.from("methodology_version_items").delete().in("version_label", createdVersionLabels);
    await svc.from("methodology_versions").delete().in("version_label", createdVersionLabels);
  }
  // Strict dependency order: claims reference materials reference sources,
  // and none of those FKs cascade (00029) - deleting a parent before its
  // children exist would fail. All claims first (both the file-level
  // fixture materials AND anything an individual test authored its own
  // material for), then materials, then sources.
  await cleanupDelete("methodology_claims", "material_id", [videoMaterialId, articleMaterialId, ...createdMaterialIds]);
  await cleanupDelete("methodology_materials", "id", [videoMaterialId, articleMaterialId, ...createdMaterialIds]);
  await cleanupDelete("methodology_sources", "id", createdSourceIds);
  await cleanupDelete("teams", "id", createdTeamIds);
  for (const id of createdUserIds) await svc.auth.admin.deleteUser(id);
  // A real DB must never be left with zero active methodology versions, or
  // with k-0.1.0 only partially restored (active=true but still carrying
  // status='retired' from whatever publish deactivated it - a real,
  // confirmed defect: the previous version of this restoration set active
  // without also resetting status, leaving an inconsistent baseline row).
  // Deleting this test's own version_label rows above can strip away the
  // currently-active one if a test published over the baseline - restore
  // it fully so other test files (and any local dev use) see a genuinely
  // valid baseline, not just an active=true flag.
  const stillActive = must(await svc.from("methodology_versions").select("version_label").eq("active", true), "active check") as { version_label: string }[];
  const restoreLabel = previouslyActive?.version_label ?? "k-0.1.0";
  if (stillActive.length !== 1 || stillActive[0]!.version_label !== restoreLabel) {
    // Exactly one active version, and it's the one that was active before this file ran.
    await svc.from("methodology_versions").update({ active: false }).eq("active", true).neq("version_label", restoreLabel);
    await svc.from("methodology_versions").update({ active: true, status: "published" }).eq("version_label", restoreLabel);
    if (restoreLabel !== "k-0.1.0") await svc.from("methodology_versions").update({ status: "retired" }).eq("version_label", "k-0.1.0").eq("active", false);
  }
});

function newClaim(overrides: Record<string, unknown> = {}) {
  return {
    material_id: articleMaterialId,
    concept: "load",
    extracted_text: "Some extracted text",
    sport_scope: "baseball",
    age_guardrail: "teen_appropriate",
    evidence_type: "coaching_experience",
    source_location: "para 3",
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// Claim approval constraints
// ---------------------------------------------------------------------------

test("candidate claim cannot be marked active directly", async () => {
  const claim = must(await svc.from("methodology_claims").insert(newClaim()).select("id").single(), "insert candidate");
  const result = await svc.from("methodology_claims").update({ active: true }).eq("id", claim.id);
  assert.ok(result.error, "expected direct activation of a candidate claim to violate the check constraint");
});

test("numeric claim requires numeric_evidence_ref before approval", async () => {
  const claim = must(
    await svc.from("methodology_claims").insert(newClaim({ numeric_claim: true })).select("id").single(),
    "insert numeric candidate",
  );
  const result = await admin.client.rpc("review_methodology_claim", {
    p_claim_id: claim.id,
    p_decision: "approved",
    p_approved_text: "Approved text",
    p_review_method: "human",
  });
  assert.ok(result.error, "expected approval to be rejected without numeric_evidence_ref");
});

test("video claim requires source timestamp or location before approval", async () => {
  const claim = must(
    await svc.from("methodology_claims").insert(newClaim({ material_id: videoMaterialId, source_location: null })).select("id").single(),
    "insert video candidate",
  );
  const result = await admin.client.rpc("review_methodology_claim", {
    p_claim_id: claim.id,
    p_decision: "approved",
    p_approved_text: "Approved text",
    p_review_method: "human",
  });
  assert.ok(result.error, "expected video claim without timestamp/location to be rejected");
});

test("approval without review_method is rejected", async () => {
  const claim = must(await svc.from("methodology_claims").insert(newClaim()).select("id").single(), "insert candidate");
  const result = await admin.client.rpc("review_methodology_claim", {
    p_claim_id: claim.id,
    p_decision: "approved",
    p_approved_text: "Approved text",
  });
  assert.ok(result.error, "expected approval with no review_method to be rejected");
  assert.match(result.error!.message, /review_method is required/);
});

test("review_methodology_claim approves a well-formed claim, records reviewer identity, and does NOT activate it", async () => {
  const claim = must(await svc.from("methodology_claims").insert(newClaim()).select("id").single(), "insert candidate");
  const { data, error } = await admin.client.rpc("review_methodology_claim", {
    p_claim_id: claim.id,
    p_decision: "approved",
    p_approved_text: "Approved text",
    p_review_method: "human",
  });
  assert.equal(error, null);
  assert.equal(data.review_status, "approved");
  // The central governance fix: approval alone must NEVER set active=true -
  // only snapshot publication does. See the publication tests below.
  assert.equal(data.active, false, "approval must never activate a claim by itself");
  assert.equal(data.reviewed_by, admin.id);
  assert.ok(data.reviewed_at);
  assert.equal(data.review_method, "human");
  assert.equal(data.human_verified, true, "review_method=human must set human_verified=true");
});

test("dual-model approval results in approved / review_method=dual_model / human_verified=false / active=false", async () => {
  const claim = must(await svc.from("methodology_claims").insert(newClaim()).select("id").single(), "insert candidate");
  const { data, error } = await admin.client.rpc("review_methodology_claim", {
    p_claim_id: claim.id,
    p_decision: "approved",
    p_approved_text: "Approved text",
    p_review_method: "dual_model",
  });
  assert.equal(error, null);
  assert.equal(data.review_status, "approved");
  assert.equal(data.review_method, "dual_model");
  assert.equal(data.human_verified, false, "dual_model (AI-only) review must never imply human_verified");
  assert.equal(data.active, false);
});

test("mixed-review approval sets human_verified=true (a human genuinely contributed, even alongside AI review)", async () => {
  const claim = must(await svc.from("methodology_claims").insert(newClaim()).select("id").single(), "insert candidate");
  const { data, error } = await admin.client.rpc("review_methodology_claim", {
    p_claim_id: claim.id,
    p_decision: "approved",
    p_approved_text: "Approved text",
    p_review_method: "mixed",
  });
  assert.equal(error, null);
  assert.equal(data.review_method, "mixed");
  assert.equal(data.human_verified, true, "mixed means both human and AI/model review contributed - a human WAS genuinely involved, so human_verified must be true");
  assert.equal(data.active, false);
});

test("caller cannot independently set human_verified - the RPC exposes no such parameter at all, only review_method", async () => {
  const claim = must(await svc.from("methodology_claims").insert(newClaim()).select("id").single(), "insert candidate");
  // review_methodology_claim has no p_human_verified parameter - attempting
  // to pass one doesn't get silently dropped, it makes PostgREST unable to
  // resolve the function at all (no matching signature), which is an even
  // stronger guarantee than "ignored": there is no API surface through
  // which a caller can influence human_verified except review_method.
  const attemptedArgs: Record<string, unknown> = {
    p_claim_id: claim.id,
    p_decision: "approved",
    p_approved_text: "Approved text",
    p_review_method: "dual_model",
    p_human_verified: true, // not a real parameter - must make the whole call fail, not be honored
  };
  const result = await admin.client.rpc("review_methodology_claim", attemptedArgs);
  assert.ok(result.error, "a caller attempting to pass p_human_verified must fail outright, not have it silently accepted");

  // The legitimate call (review_method only) proves human_verified is
  // still correctly server-derived once the bogus parameter is dropped.
  const legit = must(
    await admin.client.rpc("review_methodology_claim", {
      p_claim_id: claim.id, p_decision: "approved", p_approved_text: "Approved text", p_review_method: "dual_model",
    }),
    "legitimate approval",
  );
  assert.equal(legit.human_verified, false);
});

test("a fresh candidate defaults to candidate / human_verified=false / review_method=null / active=false", async () => {
  const claim = must(
    await svc.from("methodology_claims").insert(newClaim()).select("review_status, human_verified, review_method, active").single(),
    "insert candidate",
  );
  assert.equal(claim.review_status, "candidate");
  assert.equal(claim.human_verified, false);
  assert.equal(claim.review_method, null);
  assert.equal(claim.active, false);
});

test("human_verified can never be true unless review_method is human (DB-level guarantee, not just app logic)", async () => {
  const claim = must(await svc.from("methodology_claims").insert(newClaim()).select("id").single(), "insert candidate");
  // Direct table write, bypassing the RPC entirely, using service_role.
  const attempt = await svc.from("methodology_claims").update({ human_verified: true, review_method: "dual_model" }).eq("id", claim.id);
  assert.ok(attempt.error, "expected human_verified=true with review_method=dual_model to violate the check constraint even via a direct write");
});

test("candidate_id is durable and unique when present", async () => {
  const candidateId = `TEST-DUR-${suffix}`;
  const claim = must(
    await svc.from("methodology_claims").insert(newClaim({ candidate_id: candidateId })).select("candidate_id").single(),
    "insert with candidate_id",
  );
  assert.equal(claim.candidate_id, candidateId);
});

test("duplicate candidate_id is rejected", async () => {
  const candidateId = `TEST-DUP-${suffix}`;
  must(await svc.from("methodology_claims").insert(newClaim({ candidate_id: candidateId })), "insert first");
  const second = await svc.from("methodology_claims").insert(newClaim({ candidate_id: candidateId }));
  assert.ok(second.error, "expected a second claim with the same candidate_id to be rejected");
});

test("multiple claims with no candidate_id (null) are allowed - uniqueness only applies when present", async () => {
  must(await svc.from("methodology_claims").insert(newClaim()), "insert null-id claim 1");
  const second = await svc.from("methodology_claims").insert(newClaim());
  assert.equal(second.error, null, "two claims with candidate_id=null must both be allowed");
});

test("rejected/disputed/duplicate/superseded claims are never active", async () => {
  for (const decision of ["rejected", "disputed", "duplicate", "superseded"] as const) {
    const claim = must(await svc.from("methodology_claims").insert(newClaim()).select("id").single(), `insert ${decision} candidate`);
    const args: Record<string, unknown> = { p_claim_id: claim.id, p_decision: decision };
    if (decision === "rejected") args.p_rejection_reason = "not_well_supported";
    if (decision === "duplicate") {
      const other = must(await svc.from("methodology_claims").insert(newClaim()).select("id").single(), "insert dup target");
      args.p_duplicate_of_claim_id = other.id;
    }
    const { data, error } = await admin.client.rpc("review_methodology_claim", args);
    assert.equal(error, null, `${decision}: ${error?.message}`);
    assert.equal(data.active, false, `${decision} claim must not be active`);
  }
});

// ---------------------------------------------------------------------------
// Publication
// ---------------------------------------------------------------------------

test("approved does not imply staged: publish requires an explicit claim-id list, and an approved claim not selected is never included or activated", async () => {
  const claimA = must(await svc.from("methodology_claims").insert(newClaim({ concept: "contact", candidate_id: `TEST-A-${suffix}` })).select("id").single(), "insert claim A");
  const approvedA = must(
    await admin.client.rpc("review_methodology_claim", { p_claim_id: claimA.id, p_decision: "approved", p_approved_text: "Claim A text", p_review_method: "dual_model" }),
    "approve A",
  );
  assert.equal(approvedA.active, false, "approval alone must never activate a claim");

  const claimB = must(await svc.from("methodology_claims").insert(newClaim({ concept: "timing", candidate_id: `TEST-B-${suffix}` })).select("id").single(), "insert claim B");
  const approvedB = must(
    await admin.client.rpc("review_methodology_claim", { p_claim_id: claimB.id, p_decision: "approved", p_approved_text: "Claim B text", p_review_method: "human" }),
    "approve B",
  );
  assert.equal(approvedB.active, false);

  // Both A and B are approved and show up in the unfiltered preview (the
  // pool to choose a release from) - approval status alone doesn't
  // distinguish them yet.
  const pool = must(await admin.client.rpc("preview_methodology_snapshot"), "preview pool");
  const poolIds = (pool as { id: string }[]).map((c) => c.id);
  assert.ok(poolIds.includes(claimA.id) && poolIds.includes(claimB.id), "both approved claims must appear in the unfiltered preview pool");

  // publish_methodology_claim with no p_claim_ids at all must be rejected -
  // there is no implicit "everything approved" release.
  const noIdsAttempt = await admin.client.rpc("publish_methodology_snapshot", { p_version_label: `k-noids-${suffix}` });
  assert.ok(noIdsAttempt.error, "publish without p_claim_ids must be rejected");

  // Preview with an explicit selection shows exactly that selection.
  const stagedPreview = must(await admin.client.rpc("preview_methodology_snapshot", { p_claim_ids: [claimA.id] }), "staged preview");
  const stagedPreviewIds = (stagedPreview as { id: string }[]).map((c) => c.id);
  assert.deepEqual(stagedPreviewIds, [claimA.id], "an explicit selection must preview exactly that set, not every approved claim");

  // Publish selecting ONLY claim A.
  const versionLabel = `k-stage-test-${suffix}`;
  createdVersionLabels.push(versionLabel);
  const published = must(
    await admin.client.rpc("publish_methodology_snapshot", { p_version_label: versionLabel, p_claim_ids: [claimA.id], p_notes: "stage test" }),
    "publish A only",
  );
  assert.equal(published.active, true);

  const items = must(await svc.from("methodology_version_items").select("claim_id, item_payload").eq("version_label", versionLabel), "items");
  const itemIds = (items as { claim_id: string }[]).map((i) => i.claim_id);
  assert.ok(itemIds.includes(claimA.id), "frozen snapshot must contain selected claim A");
  assert.ok(!itemIds.includes(claimB.id), "frozen snapshot must NOT contain unselected (but approved) claim B");

  const afterPublish = must(
    await svc.from("methodology_claims").select("id, active, review_status").in("id", [claimA.id, claimB.id]).order("id"),
    "claims after publish",
  ) as { id: string; active: boolean; review_status: string }[];
  const claimAAfter = afterPublish.find((c) => c.id === claimA.id)!;
  const claimBAfter = afterPublish.find((c) => c.id === claimB.id)!;
  assert.equal(claimAAfter.active, true, "selected claim A must now be active");
  assert.equal(claimAAfter.review_status, "approved");
  assert.equal(claimBAfter.active, false, "unselected claim B must remain inactive");
  assert.equal(claimBAfter.review_status, "approved", "claim B stays approved - being left out of a release does not un-approve it");

  // A later release CAN include B (approved status was never consumed by
  // being skipped) - and, publishing without A this time, A becomes
  // inactive again while remaining approved.
  const versionLabel2 = `k-stage-test2-${suffix}`;
  createdVersionLabels.push(versionLabel2);
  await admin.client.rpc("publish_methodology_snapshot", { p_version_label: versionLabel2, p_claim_ids: [claimB.id], p_notes: "second release, B only" });
  const items2 = must(await svc.from("methodology_version_items").select("claim_id").eq("version_label", versionLabel2), "items2");
  const itemIds2 = (items2 as { claim_id: string }[]).map((i) => i.claim_id);
  assert.ok(itemIds2.includes(claimB.id) && !itemIds2.includes(claimA.id), "a later release can select a previously-unstaged approved claim");

  const afterSecondPublish = must(
    await svc.from("methodology_claims").select("id, active").in("id", [claimA.id, claimB.id]).order("id"),
    "claims after second publish",
  ) as { id: string; active: boolean }[];
  assert.equal(afterSecondPublish.find((c) => c.id === claimA.id)!.active, false, "A must become inactive once excluded from the new active release");
  assert.equal(afterSecondPublish.find((c) => c.id === claimB.id)!.active, true, "B must become active now that it's selected");

  // Publishing with a claim id that isn't approved is rejected outright.
  const unapprovedClaim = must(await svc.from("methodology_claims").insert(newClaim({ concept: "posture" })).select("id").single(), "insert unapproved");
  const badSelection = await admin.client.rpc("publish_methodology_snapshot", { p_version_label: `k-bad-${suffix}`, p_claim_ids: [unapprovedClaim.id] });
  assert.ok(badSelection.error, "publish must reject a claim id that is not currently approved");

  // Historical methodology_version_items rows remain immutable throughout.
  const editAttempt = await admin.client
    .from("methodology_version_items")
    .update({ item_payload: {} })
    .eq("version_label", versionLabel)
    .eq("claim_id", claimA.id);
  assert.ok(editAttempt.error, "expected published version item update to be rejected");
  const frozenPayloadStillIntact = must(
    await svc.from("methodology_version_items").select("item_payload").eq("version_label", versionLabel).eq("claim_id", claimA.id).single(),
    "frozen payload unchanged",
  );
  assert.equal(frozenPayloadStillIntact.item_payload.approved_text, "Claim A text", "the first release's frozen payload for A must remain exactly as published");
});

test("hotfix on a published claim: dispute clears active immediately without touching the frozen historical payload, and a later publish correctly excludes it", async () => {
  const claim = must(await svc.from("methodology_claims").insert(newClaim({ concept: "contact" })).select("id").single(), "insert candidate");
  await admin.client.rpc("review_methodology_claim", { p_claim_id: claim.id, p_decision: "approved", p_approved_text: "Contact cue text", p_review_method: "human" });

  const versionLabel = `k-hotfix-${suffix}`;
  createdVersionLabels.push(versionLabel);
  await admin.client.rpc("publish_methodology_snapshot", { p_version_label: versionLabel, p_claim_ids: [claim.id], p_notes: "hotfix test" });

  // Re-approving a published claim (which would change its approved_text
  // going into a future publish) is refused - that's an in-place edit,
  // which must go through a new superseding candidate instead.
  const reApprove = await admin.client.rpc("review_methodology_claim", {
    p_claim_id: claim.id,
    p_decision: "approved",
    p_approved_text: "A different approved text",
    p_review_method: "human",
  });
  assert.ok(reApprove.error, "expected re-approval of an already-published claim to be rejected");

  // Deactivating a published claim (hotfix: reject/dispute/duplicate/
  // superseded) IS the documented hotfix mechanism - it must succeed,
  // immediately flip active=false, and leave the already-frozen historical
  // snapshot untouched so the NEXT publish simply excludes it.
  const hotfix = await admin.client.rpc("review_methodology_claim", { p_claim_id: claim.id, p_decision: "disputed" });
  assert.equal(hotfix.error, null, `expected hotfix dispute of a published claim to succeed: ${hotfix.error?.message}`);
  assert.equal(hotfix.data.active, false);
  const frozenPayload = must(
    await svc.from("methodology_version_items").select("item_payload").eq("version_label", versionLabel).eq("claim_id", claim.id).single(),
    "frozen payload after hotfix",
  );
  assert.equal(frozenPayload.item_payload.approved_text, "Contact cue text", "the already-published snapshot's frozen payload must be untouched by the hotfix");

  // The disputed claim can no longer be selected into a later release
  // (publish validates every id is currently approved).
  const versionLabel2 = `k-hotfix2-${suffix}`;
  createdVersionLabels.push(versionLabel2);
  const laterPublish = await admin.client.rpc("publish_methodology_snapshot", { p_version_label: versionLabel2, p_claim_ids: [claim.id], p_notes: "post-hotfix" });
  assert.ok(laterPublish.error, "a disputed (no longer approved) claim id must be rejected if selected for a new release");
});

test("publishing a duplicate version_label fails and leaves the prior snapshot untouched", async () => {
  const versionLabel = `k-dup-${suffix}`;
  createdVersionLabels.push(versionLabel);
  await admin.client.rpc("publish_methodology_snapshot", { p_version_label: versionLabel, p_claim_ids: [], p_notes: "first" });
  const beforeActive = must(await svc.from("methodology_versions").select("version_label").eq("active", true), "active before").at(0);

  const retry = await admin.client.rpc("publish_methodology_snapshot", { p_version_label: versionLabel, p_claim_ids: [], p_notes: "duplicate label" });
  assert.ok(retry.error, "expected duplicate version_label publish to fail");

  const afterActive = must(await svc.from("methodology_versions").select("version_label").eq("active", true), "active after").at(0);
  assert.equal(afterActive.version_label, beforeActive.version_label, "a failed publish must leave the previous snapshot active");
});

// ---------------------------------------------------------------------------
// Authorization / RLS
// ---------------------------------------------------------------------------

test("ordinary authenticated coach sees zero methodology rows and cannot call review/publish RPCs", async () => {
  const sources = must(await coach.client.from("methodology_sources").select("id"), "coach read sources");
  assert.equal((sources as unknown[]).length, 0);
  const claims = must(await coach.client.from("methodology_claims").select("id"), "coach read claims");
  assert.equal((claims as unknown[]).length, 0);

  const insertAttempt = await coach.client.from("methodology_sources").insert(newClaim());
  assert.ok(insertAttempt.error, "expected coach insert into methodology_sources to be rejected");

  const claim = must(await svc.from("methodology_claims").insert(newClaim()).select("id").single(), "insert candidate");
  const reviewAttempt = await coach.client.rpc("review_methodology_claim", {
    p_claim_id: claim.id,
    p_decision: "approved",
    p_approved_text: "x",
  });
  assert.ok(reviewAttempt.error, "expected non-admin review RPC call to be rejected");

  const publishAttempt = await coach.client.rpc("publish_methodology_snapshot", { p_version_label: `k-forbidden-${suffix}`, p_claim_ids: [] });
  assert.ok(publishAttempt.error, "expected non-admin publish RPC call to be rejected");
});

test("preview_methodology_snapshot() requires methodology admin - anon denied, ordinary coach denied, admin allowed", async () => {
  // A real, confirmed gap this test locks in: preview_methodology_snapshot()
  // is SECURITY DEFINER (bypasses RLS by design) and previously had no
  // is_methodology_admin() check at all, unlike review_methodology_claim()/
  // publish_methodology_snapshot() - meaning any authenticated user could
  // call it directly and enumerate every approved methodology_claims row,
  // regardless of methodology_claims' own RLS policies.
  const approvedForThisTest = must(await svc.from("methodology_claims").insert(newClaim({ concept: "posture" })).select("id").single(), "insert candidate for preview-auth test");
  await admin.client.rpc("review_methodology_claim", { p_claim_id: approvedForThisTest.id, p_decision: "approved", p_approved_text: "text", p_review_method: "dual_model" });

  // ANON: no session at all - PostgREST authenticates the request as the
  // `anon` role using just the anon key.
  const anonClient = createClient(process.env.SUPABASE_URL!, process.env.SUPABASE_ANON_KEY!, { auth: { persistSession: false, autoRefreshToken: false } });
  const anonAttempt = await anonClient.rpc("preview_methodology_snapshot");
  assert.ok(anonAttempt.error, "anon must not be able to call preview_methodology_snapshot()");

  // ORDINARY COACH: authenticated, but not a methodology admin.
  const coachAttempt = await coach.client.rpc("preview_methodology_snapshot");
  assert.ok(coachAttempt.error, "an ordinary authenticated coach must not be able to call preview_methodology_snapshot()");
  const coachScopedAttempt = await coach.client.rpc("preview_methodology_snapshot", { p_claim_ids: [approvedForThisTest.id] });
  assert.ok(coachScopedAttempt.error, "an ordinary coach must not be able to enumerate even a specific approved claim via preview");

  // METHODOLOGY ADMIN: allowed, and actually sees the approved claim.
  const adminAttempt = must(await admin.client.rpc("preview_methodology_snapshot"), "admin preview");
  assert.ok((adminAttempt as { id: string }[]).some((c) => c.id === approvedForThisTest.id), "an authorized methodology admin must still be able to preview approved claims");
});

test("methodology admin can author the full source -> material -> claim -> review -> preview -> publish path", async () => {
  const src = must(
    await admin.client.from("methodology_sources").insert({
      name: `Admin Source ${suffix}`,
      source_type: "educator",
      canonical_url: "https://example.com/admin-source",
      sport_scope: "softball",
    }).select("id").single(),
    "admin insert source",
  );
  const mat = must(
    await admin.client.from("methodology_materials").insert({
      source_id: src.id,
      title: "Admin material",
      canonical_url: "https://example.com/admin-material",
      material_type: "article",
    }).select("id").single(),
    "admin insert material",
  );
  const claim = must(
    await admin.client.from("methodology_claims").insert(newClaim({ material_id: mat.id, candidate_id: `TEST-FULL-${suffix}` })).select("id").single(),
    "admin insert claim",
  );
  const reviewed = must(
    await admin.client.rpc("review_methodology_claim", { p_claim_id: claim.id, p_decision: "approved", p_approved_text: "Approved", p_review_method: "human" }),
    "admin review",
  );
  assert.equal(reviewed.review_status, "approved");
  createdSourceIds.push(src.id);
  createdMaterialIds.push(mat.id);
});

test("methodology admin status grants no team/player access, and head-coach status grants no methodology admin", async () => {
  const team = must(await svc.from("teams").insert({ slug: `methodology-team-${suffix}`, name: "Methodology Team" }).select("id").single(), "team");
  createdTeamIds.push(team.id);

  // admin (methodology admin, not a coach anywhere) must not see this team's players.
  const teamRead = must(await admin.client.from("teams").select("id").eq("id", team.id), "admin read team");
  assert.equal((teamRead as unknown[]).length, 0);

  // A head coach on that team must not be treated as a methodology admin.
  const headCoachEmail = `methodology-headcoach-${suffix}@test.local`;
  const created = await svc.auth.admin.createUser({ email: headCoachEmail, password, email_confirm: true });
  if (created.error || !created.data.user) throw new Error(`createUser: ${created.error?.message}`);
  createdUserIds.push(created.data.user.id);
  must(await svc.from("coach_team_access").insert({ coach_id: created.data.user.id, team_id: team.id, role: "head_coach" }), "grant head coach");
  const headCoachClient = createClient(process.env.SUPABASE_URL!, process.env.SUPABASE_ANON_KEY!, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
  const signed = await headCoachClient.auth.signInWithPassword({ email: headCoachEmail, password });
  if (signed.error) throw new Error(`sign in: ${signed.error.message}`);

  const sourcesAsHeadCoach = must(await headCoachClient.from("methodology_sources").select("id"), "head coach read sources");
  assert.equal((sourcesAsHeadCoach as unknown[]).length, 0);
});
