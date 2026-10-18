/** PostgreSQL integration tests for PR10's shadow writes, against the same
 * guarded disposable database as PR9 (never development, staging or production).
 * Rows come from the real pure builder; statements mirror evidenceAssessmentStore.ts. */
import test, { before } from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import { buildClaimDecisionRecord, buildShadowAssessment } from "../../src/services/development/evidence/shadowAssessment.ts";
import { BASELINE_ENGINE, INITIAL_EVIDENCE_TUPLE } from "../../src/services/development/evidenceRegistry.ts";

const container = process.env.PR9_SQL_CONTAINER;
const database = process.env.PR9_SQL_DATABASE;
const coach = "00000000-0000-4000-a000-000000010001", team = "00000000-0000-4000-a000-000000010002";
const player = "00000000-0000-4000-a000-000000010003", entry = "00000000-0000-4000-a000-000000010004";
const clip = "00000000-0000-4000-a000-000000010005", run = "00000000-0000-4000-a000-000000010006";
const issue = "00000000-0000-4000-a000-000000010007";
const SHA = "e".repeat(64);

function sql(query: string): string {
  if (!container || database !== "pr9_disposable_test")
    throw new Error("PR10 DB tests require an explicit container and the pr9_disposable_test database");
  return execFileSync("docker", ["exec", "-i", container, "psql", "-X", "-qAt", "-v", "ON_ERROR_STOP=1",
    "-U", "postgres", "-d", database], { input: query, encoding: "utf8", stdio: ["pipe", "pipe", "pipe"] }).trim();
}
const lit = (value: unknown) => `$pr10$${JSON.stringify(value)}$pr10$`;
const fixtures = `
insert into auth.users(id) values ('${coach}');
insert into public.methodology_versions(version_label,notes,status,active) values ('pr10-test','Synthetic PR10 test version','published',false);
insert into public.teams(id,slug,name,sport) values ('${team}','pr10-team','PR10 team','softball');
insert into public.coach_team_access(coach_id,team_id,role) values ('${coach}','${team}','head_coach');
insert into public.players(id,team_id,slug,name,jersey_number) values ('${player}','${team}','pr10-player','PR10 player','10');
insert into public.game_log_entries(id,player_id,date,opponent,ab,result) values ('${entry}','${player}','2026-10-16','Test',1,'Out');
insert into public.video_clips(id,game_log_entry_id,clip_slug,status,uploaded_by,uploaded_by_role)
  values ('${clip}','${entry}','pr10-clip','ready','${coach}','coach');
insert into public.analysis_runs(id,video_clip_id,player_id,backend,ai_model,prompt_version,analysis_policy_version,knowledge_version,input_manifest)
  values ('${run}','${clip}','${player}','gemini','test','test','test','pr10-test','{}');
insert into public.issues(id,player_id,issue,video_clip_id,analysis_run_id,review_status,concept,phase)
  values ('${issue}','${player}','Synthetic draft finding','${clip}','${run}','draft','contact','contact');
`;

async function shadow() {
  const manifest = { schema_version: 1, engine_code_version: BASELINE_ENGINE, instrumentation_version: "inst-1",
    environment_version: INITIAL_EVIDENCE_TUPLE.environmentVersion, input_sha256: SHA };
  const built = await buildShadowAssessment({ videoClipId: clip, sourceSha256: SHA, artifacts: {
    metrics: { pipeline_version: "pose3d-live-1.0.0", contact: { frame: 5, time_s: 0.2, method: "synthetic", confidence: "high" },
      phases: { load: { frame: 2, time_s: 0.1, method: "synthetic", confidence: "low" } } },
    pose2d: null, batPath: null, manifest, frameMapJson: null,
    aiInputs: { phaseStills: [], zooms: [], sequenceFrames: 0, sequenceSkipped: "synthetic" }, captureProfile: null } });
  assert.ok(built.ok);
  return built;
}
function insertSql(row: Record<string, unknown>, id: string) {
  const full: Record<string, unknown> = { id, ...row };
  const cols = Object.keys(full);
  const values = cols.map(c => full[c] === null ? "null" : typeof full[c] === "boolean" ? String(full[c])
    : typeof full[c] === "string" ? `'${full[c]}'` : `${lit(full[c])}::jsonb`);
  return `insert into public.clip_evidence_assessments(${cols.join(",")}) values (${values.join(",")});`;
}
const A1 = "00000000-0000-4000-a000-000000010011", A2 = "00000000-0000-4000-a000-000000010012";

before(() => {
  assert.equal(sql("select marker from public.pr9_disposable_marker"), "pr9_disposable_test");
});

test("the builder's exact row inserts as service_role and round-trips its JSON", async () => {
  const { row } = await shadow();
  const out = sql(`begin; ${fixtures} set local role service_role;
    ${insertSql(row as unknown as Record<string, unknown>, A1)}
    select (subject = ${lit(row.subject)}::jsonb and events = ${lit(row.events)}::jsonb
      and strict_baseline = ${lit(row.strict_baseline)}::jsonb and mode = 'shadow' and source_sha256 = '${SHA}')::text
    from public.clip_evidence_assessments where id = '${A1}'; rollback;`);
  assert.equal(out.split("\n").at(-1), "true");
});

test("run link is set once and never overwritten; claim decision likewise; review state untouched", async () => {
  const built = await shadow();
  const decision = await buildClaimDecisionRecord(built.input, { concept: "contact", phase: "contact" }, A1);
  const row = built.row as unknown as Record<string, unknown>;
  const out = sql(`begin; ${fixtures} set local role service_role;
    ${insertSql(row, A1)} ${insertSql(row, A2)}
    with l1 as (update public.analysis_runs set evidence_assessment_id = '${A1}'
      where id = '${run}' and evidence_assessment_id is null returning 1) select count(*) from l1;
    with l2 as (update public.analysis_runs set evidence_assessment_id = '${A2}'
      where id = '${run}' and evidence_assessment_id is null returning 1) select count(*) from l2;
    select (evidence_assessment_id = '${A1}')::text from public.analysis_runs where id = '${run}';
    with d1 as (update public.issues set claim_decision = ${lit(decision)}::jsonb
      where id = '${issue}' and analysis_run_id = '${run}' and claim_decision is null returning 1) select count(*) from d1;
    with d2 as (update public.issues set claim_decision = '{"overwrite":true}'::jsonb
      where id = '${issue}' and analysis_run_id = '${run}' and claim_decision is null returning 1) select count(*) from d2;
    select review_status||':'||(ai_original is null)::text||':'||issue||':'||(claim_decision->>'displayable')||':'
      ||(claim_decision->>'enforceEligible')||':'||(claim_decision->'reliability'->>'status')
      from public.issues where id = '${issue}';
    rollback;`).split("\n").filter(Boolean);
  assert.deepEqual(out.slice(-6), ["1", "0", "true", "1", "0", "draft:true:Synthetic draft finding:false:false:unmeasured"]);
});

test("clip deletion after shadow writes removes the assessment, clears the run link and deletes the issue with its decision", async () => {
  const built = await shadow();
  const decision = await buildClaimDecisionRecord(built.input, { concept: "contact", phase: "contact" }, A1);
  const out = sql(`begin; ${fixtures} set local role service_role;
    ${insertSql(built.row as unknown as Record<string, unknown>, A1)}
    update public.analysis_runs set evidence_assessment_id = '${A1}' where id = '${run}';
    update public.issues set claim_decision = ${lit(decision)}::jsonb where id = '${issue}';
    select public.begin_clip_deletion('${clip}','${coach}','test-bucket');
    select public.finish_clip_deletion('${clip}'); reset role;
    select (select count(*) from public.clip_evidence_assessments where video_clip_id = '${clip}')||':'||
      (select count(*) from public.analysis_runs where id = '${run}' and evidence_assessment_id is null)||':'||
      (select count(*) from public.issues where id = '${issue}'); rollback;`);
  assert.equal(out.split("\n").at(-1), "0:1:0");
});

test("authenticated (coach/guardian) sessions cannot read assessments; parent-facing code never selects the new columns", () => {
  for (const role of ["authenticated", "anon"]) {
    assert.throws(() => sql(`begin; ${fixtures} set local role ${role}; set local request.jwt.claim.sub='${coach}';
      select count(*) from public.clip_evidence_assessments; rollback;`), (e: any) => /permission denied/.test(String(e.stderr)));
  }
  const files: string[] = [];
  const walk = (dir: string) => { for (const f of readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, f.name);
    if (f.isDirectory()) walk(p); else if (/\.(ts|js|mjs)$/.test(f.name) && !/\.test\./.test(f.name)) files.push(p);
  } };
  for (const dir of ["supabase/functions", "coach"]) walk(dir);
  for (const file of files) {
    let source = readFileSync(file, "utf8").replaceAll("\r\n", "\n");
    if (file.replaceAll("\\", "/") === "supabase/functions/get-simplified-report/index.ts") {
      const call = source.match(/if \(mode === "shadow"\) await runReportShadow\(\{[\s\S]*?log: console\.log \}\);/);
      assert.ok(call, "only the guarded diagnostic call can read private columns");
      const queries = [
        'service.from("clip_evidence_assessments")\n          .select("clip_status, family_reason, mode, reliability_profile_version").eq("video_clip_id", clipId)\n          .order("created_at", { ascending: false }).limit(1).maybeSingle()',
        'service.from("issues").select("claim_decision").eq("id", id).maybeSingle()',
      ];
      let allowed = call[0];
      for (const query of queries) { assert.ok(allowed.includes(query)); allowed = allowed.replace(query, ""); }
      assert.doesNotMatch(allowed, /claim_decision|evidence_assessment|clip_evidence_assessments/);
      source = source.replace(call[0], allowed);
    }
    assert.doesNotMatch(source, /claim_decision|evidence_assessment|clip_evidence_assessments/, file);
  }
});
