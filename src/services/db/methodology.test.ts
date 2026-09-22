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
const createdVersionLabels: string[] = [];

before(async () => {
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

after(async () => {
  if (createdVersionLabels.length) {
    await svc.from("methodology_version_items").delete().in("version_label", createdVersionLabels);
    await svc.from("methodology_versions").delete().in("version_label", createdVersionLabels);
  }
  await svc.from("methodology_claims").delete().in("material_id", [videoMaterialId, articleMaterialId]);
  if (createdSourceIds.length) await svc.from("methodology_sources").delete().in("id", createdSourceIds);
  if (createdTeamIds.length) await svc.from("teams").delete().in("id", createdTeamIds);
  for (const id of createdUserIds) await svc.auth.admin.deleteUser(id);
  // A real DB must never be left with zero active methodology versions -
  // deleting this test's own version_label rows above can strip away the
  // currently-active one if a test published over the baseline and this
  // suite's own labels ended up active at cleanup time. Restore the
  // baseline so other test files (and any local dev use) still see one.
  const stillActive = must(await svc.from("methodology_versions").select("version_label").eq("active", true), "active check");
  if ((stillActive as unknown[]).length === 0) {
    await svc.from("methodology_versions").update({ active: true }).eq("version_label", "k-0.1.0");
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
  });
  assert.ok(result.error, "expected video claim without timestamp/location to be rejected");
});

test("review_methodology_claim approves a well-formed claim and records reviewer identity", async () => {
  const claim = must(await svc.from("methodology_claims").insert(newClaim()).select("id").single(), "insert candidate");
  const { data, error } = await admin.client.rpc("review_methodology_claim", {
    p_claim_id: claim.id,
    p_decision: "approved",
    p_approved_text: "Approved text",
  });
  assert.equal(error, null);
  assert.equal(data.review_status, "approved");
  assert.equal(data.active, true);
  assert.equal(data.reviewed_by, admin.id);
  assert.ok(data.reviewed_at);
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

test("preview and publish only include approved+active claims; publication is frozen and immutable", async () => {
  const approvedClaim = must(await svc.from("methodology_claims").insert(newClaim({ concept: "contact" })).select("id").single(), "insert candidate");
  await admin.client.rpc("review_methodology_claim", { p_claim_id: approvedClaim.id, p_decision: "approved", p_approved_text: "Contact cue text" });

  const rejectedClaim = must(await svc.from("methodology_claims").insert(newClaim({ concept: "timing" })).select("id").single(), "insert candidate 2");
  await admin.client.rpc("review_methodology_claim", { p_claim_id: rejectedClaim.id, p_decision: "rejected", p_rejection_reason: "unsupported" });

  const preview = must(await admin.client.rpc("preview_methodology_snapshot"), "preview");
  const previewIds = (preview as { id: string }[]).map((c) => c.id);
  assert.ok(previewIds.includes(approvedClaim.id));
  assert.ok(!previewIds.includes(rejectedClaim.id));

  const versionLabel = `k-test-${suffix}`;
  createdVersionLabels.push(versionLabel);
  const published = must(
    await admin.client.rpc("publish_methodology_snapshot", { p_version_label: versionLabel, p_notes: "test publish" }),
    "publish",
  );
  assert.equal(published.active, true);

  const items = must(await svc.from("methodology_version_items").select("claim_id, item_payload").eq("version_label", versionLabel), "items");
  const itemIds = (items as { claim_id: string }[]).map((i) => i.claim_id);
  assert.ok(itemIds.includes(approvedClaim.id));
  assert.ok(!itemIds.includes(rejectedClaim.id));

  // Published items are immutable at the grant level.
  const editAttempt = await admin.client
    .from("methodology_version_items")
    .update({ item_payload: {} })
    .eq("version_label", versionLabel)
    .eq("claim_id", approvedClaim.id);
  assert.ok(editAttempt.error, "expected published version item update to be rejected");

  // Publishing again deactivates the previous version, leaving exactly one active.
  const versionLabel2 = `k-test2-${suffix}`;
  createdVersionLabels.push(versionLabel2);
  await admin.client.rpc("publish_methodology_snapshot", { p_version_label: versionLabel2, p_notes: "second publish" });
  const active = must(await svc.from("methodology_versions").select("version_label").eq("active", true), "active versions");
  assert.equal((active as { version_label: string }[]).length, 1);
  assert.equal((active as { version_label: string }[])[0]!.version_label, versionLabel2);

  // Re-approving a published claim (which would change its approved_text
  // going into a future publish) is refused - that's an in-place edit,
  // which must go through a new superseding candidate instead.
  const reApprove = await admin.client.rpc("review_methodology_claim", {
    p_claim_id: approvedClaim.id,
    p_decision: "approved",
    p_approved_text: "A different approved text",
  });
  assert.ok(reApprove.error, "expected re-approval of an already-published claim to be rejected");

  // But deactivating a published claim (hotfix: reject/dispute/duplicate/
  // superseded) IS the documented hotfix mechanism - it must succeed, flip
  // active=false, and leave the already-frozen historical snapshot
  // untouched so the NEXT publish simply excludes it.
  const hotfix = await admin.client.rpc("review_methodology_claim", {
    p_claim_id: approvedClaim.id,
    p_decision: "disputed",
  });
  assert.equal(hotfix.error, null, `expected hotfix dispute of a published claim to succeed: ${hotfix.error?.message}`);
  assert.equal(hotfix.data.active, false);
  const frozenPayload = must(
    await svc.from("methodology_version_items").select("item_payload").eq("version_label", versionLabel).eq("claim_id", approvedClaim.id).single(),
    "frozen payload after hotfix",
  );
  assert.equal(frozenPayload.item_payload.approved_text, "Contact cue text", "the already-published snapshot's frozen payload must be untouched by the hotfix");
});

test("publishing a duplicate version_label fails and leaves the prior snapshot untouched", async () => {
  const versionLabel = `k-dup-${suffix}`;
  createdVersionLabels.push(versionLabel);
  await admin.client.rpc("publish_methodology_snapshot", { p_version_label: versionLabel, p_notes: "first" });
  const beforeActive = must(await svc.from("methodology_versions").select("version_label").eq("active", true), "active before").at(0);

  const retry = await admin.client.rpc("publish_methodology_snapshot", { p_version_label: versionLabel, p_notes: "duplicate label" });
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

  const publishAttempt = await coach.client.rpc("publish_methodology_snapshot", { p_version_label: `k-forbidden-${suffix}` });
  assert.ok(publishAttempt.error, "expected non-admin publish RPC call to be rejected");
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
    await admin.client.from("methodology_claims").insert(newClaim({ material_id: mat.id })).select("id").single(),
    "admin insert claim",
  );
  const reviewed = must(
    await admin.client.rpc("review_methodology_claim", { p_claim_id: claim.id, p_decision: "approved", p_approved_text: "Approved" }),
    "admin review",
  );
  assert.equal(reviewed.review_status, "approved");
  createdSourceIds.push(src.id);
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
