#!/usr/bin/env node
/**
 * ONE-OFF RELEASE SCRIPT for the first real HitterLoop methodology
 * publication (k-0.2.0). Not wired into any npm script - run explicitly:
 *   npx tsx scripts/release/publishK020.ts
 *
 * Reads docs/research/methodology-reviewed-stage-v1.json as the sole
 * authoritative source of claim content (no reconstruction from older raw
 * research files), imports the 8 staged records, approves each through the
 * real review_methodology_claim() RPC as review_method=dual_model, stages
 * exactly those 8 into k-0.2.0 via explicit claim-id selection, and
 * publishes through publish_methodology_snapshot().
 *
 * Everything here runs through a genuine authenticated methodology-admin
 * session (not raw service-role table writes) for every governed
 * operation (review/preview/publish), matching the real admin path -
 * service-role is used only for read-only precondition checks and to
 * create/grant that admin account, exactly as npm run provision-coach /
 * provision-methodology-admin already do for real operator accounts.
 *
 * IMPORTANT SCOPE NOTE: this runs against the LOCAL Supabase dev stack -
 * this session has no cloud/production Supabase account access (a known,
 * previously-flagged gap), so there is no live production database to
 * publish to yet. This is the first real, non-test, non-synthetic
 * methodology release *content-wise*, executed against the only database
 * environment available here.
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import "dotenv/config";
import { getSupabaseClient } from "../../src/services/db/supabaseClient.js";
import { grantMethodologyAdmin } from "../../src/cli/provisionMethodologyAdmin.js";
import { mapResearchEvidenceType } from "../../src/services/knowledge/methodologyEvidenceMapping.js";
import { loadActiveMethodologySnapshot } from "../../src/services/knowledge/methodologyRepository.js";

const EXPECTED_CANDIDATE_IDS = ["DRV2-001", "TAN-001", "GAS-001", "ABCA-YT-001", "ABCA-YT-002", "BLM-001", "SCI-002", "DRV1-001"];
const DEFERRED_CANDIDATE_IDS = ["DRV1-002", "ABCA-LB-001", "ABCA-LB-002", "SCI-001"];
const VERSION_LABEL = "k-0.2.0";
const RELEASE_NOTES =
  "First non-empty reviewed HitterLoop methodology seed. Dual-model reviewed: " +
  "Gemini source/video verification, Claude methodology adjudication, Codex " +
  "provenance/schema audit. No human verification.";

// Provenance for the 6 unique sources these 8 claims cite, taken directly
// from the already-completed docs/research/methodology-source-registry-v1.md
// (consulted only for provenance, not to reopen claim review).
const SOURCE_PROVENANCE: Record<string, { name: string; source_type: string; canonical_url: string; sport_scope: string; trust_status: string }> = {
  "driveline-baseball": { name: "Driveline Baseball", source_type: "training_org", canonical_url: "https://www.youtube.com/@drivelinebaseball", sport_scope: "both", trust_status: "approved_for_scope" },
  "tanner-tees": { name: "TannerTees", source_type: "training_org", canonical_url: "https://www.youtube.com/@TannerTees", sport_scope: "softball", trust_status: "candidate" },
  "flocollege-softball": { name: "FloCollege | Softball", source_type: "publication", canonical_url: "https://www.youtube.com/@FloCollegeSoftball", sport_scope: "softball", trust_status: "candidate" },
  "abca": { name: "American Baseball Coaches Association", source_type: "association", canonical_url: "https://www.youtube.com/@ABCA1945", sport_scope: "baseball", trust_status: "approved_for_scope" },
  "blast-motion": { name: "Blast Motion", source_type: "training_org", canonical_url: "https://www.youtube.com/@BlastMotion", sport_scope: "both", trust_status: "limited" },
  "lets-have-this-conversation": { name: "Let's Have This Conversation", source_type: "publication", canonical_url: "https://www.youtube.com/@letshavethisconversation", sport_scope: "both", trust_status: "limited" },
};

interface StagedClaim {
  candidate_id: string;
  source_key: string;
  material_key: string;
  source_url: string;
  source_video_id: string;
  material_title: string;
  verified_timestamps: { start_seconds: number; end_seconds: number };
  concept: string;
  extracted_text: string;
  final_claim_text: string;
  observable_evidence: string;
  coaching_cue: string | null;
  sport_scope: string;
  age_guardrail: string;
  level_scope: string[];
  applies_when: string;
  does_not_apply_when: string;
  research_evidence_type: string;
  evidence_type: string;
  numeric_claim: boolean;
  numeric_evidence_ref: string | null;
  contradiction_group: string | null;
  contradiction_state: string;
  gemini_verification_verdict: string;
  claude_adjudication_verdict: string;
  review_method: string;
  human_verified: boolean;
  review_status: string;
  active: boolean;
}

const REQUIRED_FIELDS: (keyof StagedClaim)[] = [
  "candidate_id", "final_claim_text", "source_url", "verified_timestamps", "sport_scope", "age_guardrail",
  "applies_when", "does_not_apply_when", "research_evidence_type", "evidence_type",
  "gemini_verification_verdict", "claude_adjudication_verdict",
];

function must<T>(res: { data: T; error: { message: string } | null }, what: string): T {
  if (res.error) throw new Error(`${what}: ${res.error.message}`);
  return res.data;
}

function section(title: string) {
  console.log(`\n${"=".repeat(70)}\n${title}\n${"=".repeat(70)}`);
}

async function main() {
  const svc = getSupabaseClient();

  // -------------------------------------------------------------------
  section("0. LOAD + VALIDATE STAGED JSON (authoritative input)");
  // -------------------------------------------------------------------
  const stagePath = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../docs/research/methodology-reviewed-stage-v1.json");
  const staged = JSON.parse(fs.readFileSync(stagePath, "utf8")) as StagedClaim[];
  console.log(`Loaded ${staged.length} record(s) from ${stagePath}`);

  if (staged.length !== 8) throw new Error(`STOP: expected exactly 8 staged records, found ${staged.length}`);
  const stagedIds = staged.map((c) => c.candidate_id);
  const stagedIdSet = new Set(stagedIds);
  if (new Set(stagedIds).size !== stagedIds.length) throw new Error(`STOP: duplicate candidate_id in staged JSON: ${stagedIds.join(",")}`);
  for (const id of EXPECTED_CANDIDATE_IDS) if (!stagedIdSet.has(id)) throw new Error(`STOP: expected candidate_id ${id} missing from staged JSON`);
  for (const id of stagedIds) if (!EXPECTED_CANDIDATE_IDS.includes(id)) throw new Error(`STOP: unexpected candidate_id ${id} in staged JSON (not in the expected 8)`);
  for (const id of DEFERRED_CANDIDATE_IDS) if (stagedIdSet.has(id)) throw new Error(`STOP: deferred candidate_id ${id} must NOT be present in this release`);
  console.log("Candidate ID set matches exactly the expected 8; no deferred claims present.");

  for (const c of staged) {
    for (const field of REQUIRED_FIELDS) {
      if (c[field] === undefined || c[field] === null || c[field] === "") throw new Error(`STOP: ${c.candidate_id} is missing required field "${field}"`);
    }
    if (c.human_verified !== false) throw new Error(`STOP: ${c.candidate_id} has human_verified=${c.human_verified}, expected false`);
    if (c.active !== false) throw new Error(`STOP: ${c.candidate_id} has active=${c.active}, expected false`);
    if (c.review_status !== "candidate") throw new Error(`STOP: ${c.candidate_id} has review_status=${c.review_status}, expected candidate`);
    if (c.review_method !== "dual_model") throw new Error(`STOP: ${c.candidate_id} has review_method=${c.review_method}, this release requires dual_model only`);
    const mapped = mapResearchEvidenceType(c.research_evidence_type);
    if (mapped !== c.evidence_type) {
      throw new Error(`STOP: ${c.candidate_id} evidence_type mismatch - research_evidence_type "${c.research_evidence_type}" maps to "${mapped}" but staged evidence_type is "${c.evidence_type}"`);
    }
  }
  console.log("All 8 records: required fields present, human_verified=false, active=false, review_status=candidate, review_method=dual_model, evidence_type mapping self-consistent.");

  // -------------------------------------------------------------------
  section("1. PRECONDITION CHECK (DB)");
  // -------------------------------------------------------------------
  const claimCountBefore = must(await svc.from("methodology_claims").select("id", { count: "exact", head: true }), "count claims");
  const claimCount = (await svc.from("methodology_claims").select("id", { count: "exact", head: true })).count ?? 0;
  if (claimCount !== 0) throw new Error(`STOP: methodology_claims is not empty (count=${claimCount}) - refusing to proceed`);

  const itemCount = (await svc.from("methodology_version_items").select("version_label", { count: "exact", head: true })).count ?? 0;
  if (itemCount !== 0) throw new Error(`STOP: methodology_version_items is not empty (count=${itemCount}) - refusing to proceed`);

  const versions = must(await svc.from("methodology_versions").select("version_label, active, status"), "list versions") as { version_label: string; active: boolean; status: string }[];
  if (versions.length !== 1 || versions[0]!.version_label !== "k-0.1.0" || !versions[0]!.active || versions[0]!.status !== "published") {
    throw new Error(`STOP: expected exactly one version (k-0.1.0, active, published), found: ${JSON.stringify(versions)}`);
  }
  console.log("Preconditions satisfied: methodology_claims=0, methodology_version_items=0, only k-0.1.0 active+published.");
  void claimCountBefore;

  // -------------------------------------------------------------------
  section("2. CREATE / SIGN IN RELEASE-OPERATOR METHODOLOGY ADMIN");
  // -------------------------------------------------------------------
  const operatorEmail = "methodology-release-operator@hitterloop.local";
  const operatorPassword = `Release-${Date.now()}!Op`;
  let operatorUserId: string;
  const existing = await svc.auth.admin.listUsers({ page: 1, perPage: 200 });
  const existingUser = existing.data?.users.find((u) => u.email?.toLowerCase() === operatorEmail);
  if (existingUser) {
    operatorUserId = existingUser.id;
    await svc.auth.admin.updateUserById(operatorUserId, { password: operatorPassword });
    console.log(`Reusing existing release-operator account ${operatorEmail} (${operatorUserId}), password reset for this run.`);
  } else {
    const created = await svc.auth.admin.createUser({ email: operatorEmail, password: operatorPassword, email_confirm: true });
    if (created.error || !created.data.user) throw new Error(`Creating release-operator account: ${created.error?.message}`);
    operatorUserId = created.data.user.id;
    console.log(`Created release-operator account ${operatorEmail} (${operatorUserId}).`);
  }
  await grantMethodologyAdmin(operatorEmail, null);
  const adminClient: SupabaseClient = createClient(process.env.SUPABASE_URL!, process.env.SUPABASE_ANON_KEY!, { auth: { persistSession: false, autoRefreshToken: false } });
  const signed = await adminClient.auth.signInWithPassword({ email: operatorEmail, password: operatorPassword });
  if (signed.error) throw new Error(`Signing in as release operator: ${signed.error.message}`);
  console.log("Signed in as authenticated methodology admin - all governed operations below go through this real session.");

  // -------------------------------------------------------------------
  section("3. IMPORT: sources -> materials -> claims (candidate rows)");
  // -------------------------------------------------------------------
  const sourceIdByKey = new Map<string, string>();
  for (const [key, prov] of Object.entries(SOURCE_PROVENANCE)) {
    const used = staged.some((c) => c.source_key === key);
    if (!used) continue;
    const row = must(
      await adminClient.from("methodology_sources").insert({
        name: prov.name, source_type: prov.source_type, canonical_url: prov.canonical_url,
        sport_scope: prov.sport_scope, trust_status: prov.trust_status,
      }).select("id").single(),
      `insert source ${key}`,
    ) as { id: string };
    sourceIdByKey.set(key, row.id);
    console.log(`  source ${key} -> ${row.id}`);
  }

  const materialIdByKey = new Map<string, string>();
  for (const c of staged) {
    if (materialIdByKey.has(c.material_key)) continue;
    const sourceId = sourceIdByKey.get(c.source_key);
    if (!sourceId) throw new Error(`STOP: no source row for source_key ${c.source_key} (material ${c.material_key})`);
    const materialType = c.material_key === "chad-miller-science-of-hitting" ? "podcast" : "video";
    const row = must(
      await adminClient.from("methodology_materials").insert({
        source_id: sourceId, title: c.material_title, canonical_url: c.source_url,
        external_id: c.source_video_id, material_type: materialType,
      }).select("id").single(),
      `insert material ${c.material_key}`,
    ) as { id: string };
    materialIdByKey.set(c.material_key, row.id);
    console.log(`  material ${c.material_key} -> ${row.id}`);
  }

  const claimIdByCandidateId = new Map<string, string>();
  for (const c of staged) {
    const materialId = materialIdByKey.get(c.material_key);
    if (!materialId) throw new Error(`STOP: no material row for material_key ${c.material_key} (claim ${c.candidate_id})`);
    const row = must(
      await adminClient.from("methodology_claims").insert({
        candidate_id: c.candidate_id,
        material_id: materialId,
        source_start_seconds: c.verified_timestamps.start_seconds,
        source_end_seconds: c.verified_timestamps.end_seconds,
        concept: c.concept,
        extracted_text: c.extracted_text,
        observable_evidence: c.observable_evidence,
        coaching_cue: c.coaching_cue,
        applies_when: c.applies_when,
        does_not_apply_when: c.does_not_apply_when,
        sport_scope: c.sport_scope,
        level_scope: c.level_scope,
        age_guardrail: c.age_guardrail,
        evidence_type: c.evidence_type,
        numeric_claim: c.numeric_claim,
        numeric_evidence_ref: c.numeric_evidence_ref,
        contradiction_group: c.contradiction_group,
        contradiction_state: c.contradiction_state,
        quality_notes: `Gemini verdict: ${c.gemini_verification_verdict}. Claude verdict: ${c.claude_adjudication_verdict}.`,
      }).select("id, review_status, human_verified, active, candidate_id").single(),
      `insert claim ${c.candidate_id}`,
    ) as { id: string; review_status: string; human_verified: boolean; active: boolean; candidate_id: string };
    if (row.review_status !== "candidate" || row.human_verified !== false || row.active !== false) {
      throw new Error(`STOP: ${c.candidate_id} did not import as candidate/human_verified=false/active=false: ${JSON.stringify(row)}`);
    }
    claimIdByCandidateId.set(c.candidate_id, row.id);
    console.log(`  claim ${c.candidate_id} -> ${row.id} (candidate, human_verified=false, active=false)`);
  }
  console.log(`\nImported ${claimIdByCandidateId.size} claim(s).`);

  // -------------------------------------------------------------------
  section("4. APPROVE via review_methodology_claim() - review_method=dual_model");
  // -------------------------------------------------------------------
  for (const c of staged) {
    const claimId = claimIdByCandidateId.get(c.candidate_id)!;
    const result = must(
      await adminClient.rpc("review_methodology_claim", {
        p_claim_id: claimId,
        p_decision: "approved",
        p_approved_text: c.final_claim_text,
        p_review_method: "dual_model",
        p_review_notes: `Staged release k-0.2.0 import. Gemini: ${c.gemini_verification_verdict}. Claude: ${c.claude_adjudication_verdict}.`,
      }),
      `approve ${c.candidate_id}`,
    ) as { review_status: string; review_method: string; human_verified: boolean; active: boolean };
    if (result.review_status !== "approved" || result.review_method !== "dual_model" || result.human_verified !== false || result.active !== false) {
      throw new Error(`STOP: ${c.candidate_id} post-approval state wrong: ${JSON.stringify(result)}`);
    }
    console.log(`  ${c.candidate_id}: approved, review_method=dual_model, human_verified=false, active=false`);
  }
  console.log("\nAll 8 claims approved. Approval alone activated nothing (confirmed per-claim above).");

  // -------------------------------------------------------------------
  section("5. PREVIEW exact release selection");
  // -------------------------------------------------------------------
  const claimIds = EXPECTED_CANDIDATE_IDS.map((id) => claimIdByCandidateId.get(id)!);
  const preview = must(await adminClient.rpc("preview_methodology_snapshot", { p_claim_ids: claimIds }), "preview") as { id: string; candidate_id: string }[];
  console.log(`Preview returned ${preview.length} claim(s): ${preview.map((c) => c.candidate_id).sort().join(", ")}`);
  if (preview.length !== 8) throw new Error(`STOP: preview returned ${preview.length} claims, expected exactly 8`);
  const previewIds = new Set(preview.map((c) => c.candidate_id));
  for (const id of EXPECTED_CANDIDATE_IDS) if (!previewIds.has(id)) throw new Error(`STOP: preview missing ${id}`);
  for (const id of previewIds) if (!EXPECTED_CANDIDATE_IDS.includes(id)) throw new Error(`STOP: preview contains unexpected ${id}`);
  console.log("Preview matches exactly the expected 8 candidate IDs - no extras, no omissions.");

  // -------------------------------------------------------------------
  section(`6. PUBLISH ${VERSION_LABEL}`);
  // -------------------------------------------------------------------
  const published = must(
    await adminClient.rpc("publish_methodology_snapshot", { p_version_label: VERSION_LABEL, p_claim_ids: claimIds, p_notes: RELEASE_NOTES }),
    "publish",
  ) as { version_label: string; active: boolean; status: string };
  console.log(`Published: ${JSON.stringify(published)}`);
  if (published.version_label !== VERSION_LABEL || !published.active || published.status !== "published") {
    throw new Error(`STOP: publish result unexpected: ${JSON.stringify(published)}`);
  }

  // -------------------------------------------------------------------
  section("7. POST-PUBLISH STATE VERIFICATION");
  // -------------------------------------------------------------------
  const allVersions = must(await svc.from("methodology_versions").select("version_label, active, status").order("created_at"), "all versions") as { version_label: string; active: boolean; status: string }[];
  console.log("methodology_versions:", JSON.stringify(allVersions));
  const k010 = allVersions.find((v) => v.version_label === "k-0.1.0");
  const k020 = allVersions.find((v) => v.version_label === VERSION_LABEL);
  if (!k010 || k010.active || k010.status !== "retired") throw new Error(`STOP: k-0.1.0 not correctly retired: ${JSON.stringify(k010)}`);
  if (!k020 || !k020.active || k020.status !== "published") throw new Error(`STOP: k-0.2.0 not correctly active+published: ${JSON.stringify(k020)}`);

  const items = must(await svc.from("methodology_version_items").select("claim_id, item_payload").eq("version_label", VERSION_LABEL), "items") as { claim_id: string; item_payload: Record<string, unknown> }[];
  console.log(`methodology_version_items for ${VERSION_LABEL}: ${items.length}`);
  if (items.length !== 8) throw new Error(`STOP: expected 8 frozen items, found ${items.length}`);

  const claimsAfter = must(await svc.from("methodology_claims").select("id, candidate_id, review_status, review_method, human_verified, active"), "claims after publish") as
    { id: string; candidate_id: string; review_status: string; review_method: string; human_verified: boolean; active: boolean }[];
  console.log(`methodology_claims total: ${claimsAfter.length}`);
  if (claimsAfter.length !== 8) throw new Error(`STOP: expected 8 total claims, found ${claimsAfter.length}`);
  for (const c of claimsAfter) {
    if (c.review_status !== "approved" || c.review_method !== "dual_model" || c.human_verified !== false || c.active !== true) {
      throw new Error(`STOP: claim ${c.candidate_id} final state wrong: ${JSON.stringify(c)}`);
    }
  }
  console.log("All 8 claims: approved, review_method=dual_model, human_verified=false, active=true.");

  // -------------------------------------------------------------------
  section("8. FROZEN PAYLOAD VALIDATION");
  // -------------------------------------------------------------------
  const REQUIRED_PAYLOAD_KEYS = [
    "candidate_id", "approved_text", "evidence_type", "sport_scope", "age_guardrail", "level_scope",
    "applies_when", "does_not_apply_when", "observable_evidence", "source_name", "source_url",
    "material_title", "material_url", "source_start_seconds", "source_end_seconds",
    "reviewed_by", "reviewed_at", "review_method", "human_verified", "claim_id",
  ];
  const frozenCandidateIds = new Set<string>();
  for (const item of items) {
    for (const key of REQUIRED_PAYLOAD_KEYS) {
      if (!(key in item.item_payload)) throw new Error(`STOP: frozen item ${item.claim_id} missing payload key "${key}"`);
    }
    frozenCandidateIds.add(item.item_payload.candidate_id as string);
  }
  for (const id of EXPECTED_CANDIDATE_IDS) if (!frozenCandidateIds.has(id)) throw new Error(`STOP: frozen payload set missing candidate_id ${id}`);
  console.log(`All ${items.length} frozen payloads carry every required key; candidate_id set matches exactly: ${[...frozenCandidateIds].sort().join(", ")}`);

  // -------------------------------------------------------------------
  section("9. RUNTIME LOADER VALIDATION");
  // -------------------------------------------------------------------
  const snapshot = await loadActiveMethodologySnapshot();
  console.log(`Runtime loader: versionLabel=${snapshot.versionLabel}, items=${snapshot.items.length}`);
  if (snapshot.versionLabel !== VERSION_LABEL) throw new Error(`STOP: runtime loaded wrong version: ${snapshot.versionLabel}`);
  if (snapshot.items.length !== 8) throw new Error(`STOP: runtime loaded ${snapshot.items.length} items, expected 8`);
  const runtimeCandidateIds = new Set(snapshot.items.map((i) => i.candidateId));
  for (const id of EXPECTED_CANDIDATE_IDS) if (!runtimeCandidateIds.has(id)) throw new Error(`STOP: runtime snapshot missing ${id}`);
  console.log(`Runtime candidate IDs match exactly: ${[...runtimeCandidateIds].sort().join(", ")}`);
  for (const item of snapshot.items) {
    if (!item.approvedText) throw new Error(`STOP: runtime item ${item.candidateId} failed to parse approvedText`);
  }
  console.log("All 8 items parsed correctly by the runtime loader (approvedText present on every item).");

  // Fail-closed check: temporarily deactivate the published version, confirm
  // the loader throws rather than falling back to anything, then restore.
  await svc.from("methodology_versions").update({ active: false }).eq("version_label", VERSION_LABEL);
  let failedClosed = false;
  try {
    await loadActiveMethodologySnapshot();
  } catch (err) {
    failedClosed = err instanceof Error && /No active methodology snapshot found/.test(err.message);
  }
  await svc.from("methodology_versions").update({ active: true }).eq("version_label", VERSION_LABEL);
  if (!failedClosed) throw new Error("STOP: loader did not fail closed when no version was active");
  console.log("Fail-closed check: with no active version, loader throws (no fallback). Restored k-0.2.0 active afterward.");

  // -------------------------------------------------------------------
  section("10. SECURITY RE-CHECK against the real k-0.2.0 data");
  // -------------------------------------------------------------------
  const coachEmail = `methodology-security-recheck-${Date.now()}@test.local`;
  const coachPassword = "TestPass123!recheck";
  const coachCreated = await svc.auth.admin.createUser({ email: coachEmail, password: coachPassword, email_confirm: true });
  if (coachCreated.error || !coachCreated.data.user) throw new Error(`creating recheck coach: ${coachCreated.error?.message}`);
  const coachClient = createClient(process.env.SUPABASE_URL!, process.env.SUPABASE_ANON_KEY!, { auth: { persistSession: false, autoRefreshToken: false } });
  const coachSigned = await coachClient.auth.signInWithPassword({ email: coachEmail, password: coachPassword });
  if (coachSigned.error) throw new Error(`signing in recheck coach: ${coachSigned.error.message}`);

  const coachReadClaims = must(await coachClient.from("methodology_claims").select("id"), "coach read claims") as unknown[];
  const coachPreview = await coachClient.rpc("preview_methodology_snapshot");
  const coachPublish = await coachClient.rpc("publish_methodology_snapshot", { p_version_label: "k-hijack", p_claim_ids: [] });
  const coachReview = await coachClient.rpc("review_methodology_claim", { p_claim_id: claimIds[0], p_decision: "approved", p_approved_text: "x", p_review_method: "human" });
  console.log(`Ordinary coach: reads ${coachReadClaims.length} methodology_claims rows (expect 0); preview error=${!!coachPreview.error}; publish error=${!!coachPublish.error}; review error=${!!coachReview.error}`);
  if (coachReadClaims.length !== 0) throw new Error("STOP: ordinary coach can enumerate methodology_claims after publication");
  if (!coachPreview.error) throw new Error("STOP: ordinary coach can call preview_methodology_snapshot() after publication");
  if (!coachPublish.error) throw new Error("STOP: ordinary coach can call publish_methodology_snapshot() after publication");
  if (!coachReview.error) throw new Error("STOP: ordinary coach can call review_methodology_claim() after publication");
  await svc.auth.admin.deleteUser(coachCreated.data.user.id);

  const adminPreviewAfter = must(await adminClient.rpc("preview_methodology_snapshot"), "admin preview after publish") as unknown[];
  console.log(`Methodology admin can still preview (${adminPreviewAfter.length} approved claim(s) visible).`);
  console.log("Runtime (service-role) load already proven above (section 9).");

  // -------------------------------------------------------------------
  section("DONE");
  // -------------------------------------------------------------------
  console.log(`k-0.2.0 published with ${items.length} claims. Release operator: ${operatorEmail} (${operatorUserId}).`);
}

main().catch((err) => {
  console.error("\nRELEASE SCRIPT FAILED:", err instanceof Error ? err.message : err);
  process.exit(1);
});
