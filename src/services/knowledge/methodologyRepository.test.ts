/**
 * Integration tests for the runtime active-snapshot loader (Phase 2).
 * Real local Supabase, no mocks - same standard as
 * src/services/db/methodology.test.ts. Requires `npx supabase start`.
 */
import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import "dotenv/config";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { getSupabaseClient } from "../db/supabaseClient.js";
import { loadActiveMethodologySnapshot, filterApplicableMethodology, renderMethodologyPack } from "./methodologyRepository.js";
import type { MethodologyItem } from "./methodologyTypes.js";

const suffix = `${Date.now()}`;
const svc = getSupabaseClient();

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function must(res: { data: any; error: { message: string } | null }, what: string): any {
  if (res.error) throw new Error(`${what}: ${res.error.message}`);
  return res.data;
}

let sourceId: string;
let materialId: string;
let adminUserId: string;
let adminClient: SupabaseClient;
const createdVersionLabels: string[] = [];

before(async () => {
  sourceId = (must(
    await svc.from("methodology_sources").insert({
      name: `Repo Test Source ${suffix}`, source_type: "training_org",
      canonical_url: "https://example.com/repo-source", sport_scope: "baseball",
    }).select("id").single(),
    "source",
  ) as { id: string }).id;
  materialId = (must(
    await svc.from("methodology_materials").insert({
      source_id: sourceId, title: "Repo test material", canonical_url: "https://example.com/repo-material", material_type: "article",
    }).select("id").single(),
    "material",
  ) as { id: string }).id;

  const email = `repo-admin-${suffix}@test.local`;
  const password = "TestPass123!repo";
  const created = await svc.auth.admin.createUser({ email, password, email_confirm: true });
  if (created.error || !created.data.user) throw new Error(`createUser: ${created.error?.message}`);
  adminUserId = created.data.user.id;
  await svc.from("methodology_admins").upsert({ user_id: adminUserId });
  adminClient = createClient(process.env.SUPABASE_URL!, process.env.SUPABASE_ANON_KEY!, { auth: { persistSession: false, autoRefreshToken: false } });
  const signed = await adminClient.auth.signInWithPassword({ email, password });
  if (signed.error) throw new Error(`sign in: ${signed.error.message}`);
});

after(async () => {
  if (createdVersionLabels.length) {
    await svc.from("methodology_version_items").delete().in("version_label", createdVersionLabels);
    await svc.from("methodology_versions").delete().in("version_label", createdVersionLabels);
  }
  await svc.from("methodology_claims").delete().eq("material_id", materialId);
  await svc.from("methodology_materials").delete().eq("id", materialId);
  await svc.from("methodology_sources").delete().eq("id", sourceId);
  // If this run's publish() left a non-baseline version active (e.g. an
  // earlier assertion failed before reaching a later publish), make sure a
  // real DB is never left with zero active versions for the next test run.
  const stillActive = must(await svc.from("methodology_versions").select("version_label").eq("active", true), "active check");
  if ((stillActive as unknown[]).length === 0) {
    await svc.from("methodology_versions").update({ active: true }).eq("version_label", "k-0.1.0");
  }
  await svc.auth.admin.deleteUser(adminUserId);
});

async function approveClaim(overrides: Record<string, unknown>): Promise<string> {
  const claim = must(
    await svc.from("methodology_claims").insert({
      material_id: materialId, concept: "load", extracted_text: "extracted",
      sport_scope: "baseball", age_guardrail: "advanced_only", evidence_type: "coaching_experience",
      source_location: "p1", ...overrides,
    }).select("id").single(),
    "insert claim",
  );
  must(
    await adminClient.rpc("review_methodology_claim", {
      p_claim_id: claim.id, p_decision: "approved", p_approved_text: "Approved text for repo test",
    }),
    "approve via review_methodology_claim (reviewer identity must come from auth.uid(), not a raw service-role update)",
  );
  return claim.id as string;
}

test("empty baseline snapshot (k-0.1.0) loads validly with zero items", async () => {
  const active = must(await svc.from("methodology_versions").select("version_label").eq("active", true), "active before");
  assert.equal((active as { version_label: string }[]).length, 1, "exactly one active version must exist");
  const snapshot = await loadActiveMethodologySnapshot();
  if (snapshot.versionLabel === "k-0.1.0") assert.equal(snapshot.items.length, 0);
});

test("loading picks up exactly the frozen items of the currently active version, never live candidate rows", async () => {
  const approvedId = await approveClaim({ sport_scope: "baseball", age_guardrail: "advanced_only" });
  must(await svc.from("methodology_claims").insert({
    material_id: materialId, concept: "timing", extracted_text: "still a candidate",
    sport_scope: "baseball", age_guardrail: "advanced_only", evidence_type: "coaching_experience", source_location: "p2",
  }), "insert candidate");

  const versionLabel = `k-repo-test-${suffix}`;
  createdVersionLabels.push(versionLabel);
  must(await adminClient.rpc("publish_methodology_snapshot", { p_version_label: versionLabel, p_notes: "repo test" }), "publish");

  const snapshot = await loadActiveMethodologySnapshot();
  assert.equal(snapshot.versionLabel, versionLabel);
  const ids = snapshot.items.map((i) => i.claimId);
  assert.ok(ids.includes(approvedId));
  assert.equal(ids.length, 1, "only the one approved+active claim should be frozen in, never the candidate");
});

function stubItem(overrides: Partial<MethodologyItem>): MethodologyItem {
  return {
    claimId: "stub", concept: "load", approvedText: "text", observableEvidence: "", coachingCue: null,
    appliesWhen: "", doesNotApplyWhen: "", sportScope: "baseball", levelScope: [], ageGuardrail: "advanced_only",
    evidenceType: "coaching_experience", numericClaim: false, numericEvidenceRef: null, sourceName: "", sourceUrl: "",
    materialTitle: "", materialUrl: "", materialExternalId: null, materialPublishedAt: null, sourceStartSeconds: null,
    sourceEndSeconds: null, sourceLocation: null, reviewedBy: null, reviewedAt: null, ...overrides,
  };
}

test("filterApplicableMethodology excludes wrong sport and non-youth items for an unknown/youth age band", () => {
  const items = [
    stubItem({ claimId: "x", sportScope: "softball", ageGuardrail: "youth_appropriate" }),
    stubItem({ claimId: "y", sportScope: "baseball", ageGuardrail: "advanced_only" }),
  ];
  const forYoungBaseball = filterApplicableMethodology(items, { sport: "baseball", ageBand: "8-10" });
  assert.equal(forYoungBaseball.length, 0, "wrong sport AND non-youth guardrail should both be excluded");

  const forYoungBaseballYouthItem = filterApplicableMethodology(
    [stubItem({ claimId: "z", sportScope: "baseball", ageGuardrail: "youth_appropriate" })],
    { sport: "baseball", ageBand: "8-10" },
  );
  assert.equal(forYoungBaseballYouthItem.length, 1);
});

test("renderMethodologyPack keeps the reference-data framing that subordinates methodology to policy", () => {
  const rendered = renderMethodologyPack([]);
  assert.match(rendered.text, /No approved methodology claims matched/);
});

test("missing active methodology version fails closed rather than falling back to anything", async () => {
  const before = must(await svc.from("methodology_versions").select("version_label").eq("active", true), "active before");
  await svc.from("methodology_versions").update({ active: false }).eq("active", true);
  try {
    await assert.rejects(loadActiveMethodologySnapshot(), /No active methodology snapshot found/);
  } finally {
    // restore, so later tests (and other files sharing this DB) still see an active version
    for (const row of before as { version_label: string }[]) {
      await svc.from("methodology_versions").update({ active: true }).eq("version_label", row.version_label);
    }
  }
});
