/** PostgreSQL integration tests for PR9. The exact container/database marker
 * prevents accidental execution against development, staging or production. */
import test, { before } from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";

const container = process.env.PR9_SQL_CONTAINER;
const database = process.env.PR9_SQL_DATABASE;
const coach = "00000000-0000-4000-a000-000000009901";
const team = "00000000-0000-4000-a000-000000009902";
const player = "00000000-0000-4000-a000-000000009903";
const entry = "00000000-0000-4000-a000-000000009904";
const clip = "00000000-0000-4000-a000-000000009905";
const assessment = "00000000-0000-4000-a000-000000009906";

function sql(query: string): string {
  if (!container || database !== "pr9_disposable_test")
    throw new Error("PR9 tests require an explicit container and the pr9_disposable_test database");
  return execFileSync("docker", ["exec", "-i", container, "psql", "-X", "-qAt", "-v", "ON_ERROR_STOP=1",
    "-U", "postgres", "-d", database], { input: query, encoding: "utf8", stdio: ["pipe", "pipe", "pipe"] }).trim();
}

function denied(body: string, pattern: RegExp) {
  assert.throws(() => sql(`begin; ${fixtures} ${body}; rollback;`), (error: any) => {
    assert.match(String(error.stderr), pattern); return true;
  });
}

const fixtures = `
insert into auth.users(id) values ('${coach}');
insert into public.methodology_versions(version_label,notes,status,active)
  values ('pr9-test','Synthetic PR9 test version','published',false);
insert into public.teams(id,slug,name,sport) values ('${team}','pr9-team','PR9 team','softball');
insert into public.coach_team_access(coach_id,team_id,role) values ('${coach}','${team}','head_coach');
insert into public.players(id,team_id,slug,name,jersey_number) values ('${player}','${team}','pr9-player','PR9 player','9');
insert into public.game_log_entries(id,player_id,date,opponent,ab,result) values ('${entry}','${player}','2026-10-14','Test',1,'Out');
insert into public.video_clips(id,game_log_entry_id,clip_slug,status,uploaded_by,uploaded_by_role)
  values ('${clip}','${entry}','pr9-clip','ready','${coach}','coach');
`;

function assessmentRow(options: { clipId?: string; mode?: string; status?: string;
  family?: string; hash?: string } = {}) {
  const clipId = options.clipId ?? `'${clip}'`, mode = options.mode ?? "off";
  const status = options.status ?? "eligible", family = options.family ?? "null";
  const hash = options.hash ?? "repeat('a',64)";
  return `(id,video_clip_id,engine_code_version,instrumentation_version,environment_version,
  gate_version,claims_version,reliability_profile_version,mode,clip_status,family_reason,
  subject,events,strict_baseline,source_sha256,backfilled)
values ('${assessment}',${clipId},'engine-baseline-1.0.0','inst-1','env-f4ad5b330d0c',
  'gate-1.0.0','claims-0.1.0-proposed',null,'${mode}','${status}',${family},
  '{"status":"pass"}','{}','{"status":"withhold"}',${hash},false)`;
}

before(() => {
  assert.equal(sql("select marker from public.pr9_disposable_marker"), "pr9_disposable_test");
  assert.equal(sql("select count(*) from supabase_migrations.schema_migrations"), "65");
});

test("00065 applied once with exact table, index and RLS shape", () => {
  assert.equal(sql("select count(*) from information_schema.tables where table_schema='public' and table_name='clip_evidence_assessments'"), "1");
  assert.equal(sql("select relrowsecurity from pg_class where oid='public.clip_evidence_assessments'::regclass"), "t");
  assert.equal(sql("select count(*) from pg_policies where schemaname='public' and tablename='clip_evidence_assessments'"), "0");
  assert.equal(sql("select count(*) from pg_indexes where schemaname='public' and indexname='clip_evidence_assessments_latest'"), "1");
  assert.equal(sql("select count(*) from pg_indexes where schemaname='public' and indexname='analysis_runs_evidence_assessment_id_idx' and indexdef like '%WHERE (evidence_assessment_id IS NOT NULL)%'"), "1");
  assert.equal(sql(`select count(*) from pg_proc where oid in
    ('public.protect_clip_evidence_assessment()'::regprocedure,
     'public.clear_clip_evidence_run_links()'::regprocedure)
    and prosecdef and proowner='postgres'::regrole and proconfig @> array['search_path=""']`), "2");
});

test("existing rows remain valid and all added public/demo columns are nullable", () => {
  const result = sql(`begin; ${fixtures}
    insert into public.analysis_runs(video_clip_id,player_id,backend,ai_model,prompt_version,analysis_policy_version,knowledge_version,input_manifest)
      values ('${clip}','${player}','gemini','test','test','test','pr9-test','{}');
    insert into public.issues(player_id,issue) values ('${player}','Historical issue');
    select count(*) from public.analysis_runs where evidence_assessment_id is null and provider_usage is null;
    select count(*) from public.issues where claim_decision is null; rollback;`);
  assert.deepEqual(result.split("\n").slice(-2), ["1", "1"]);
  for (const [schema, tableName, columns] of [["public","analysis_runs",["evidence_assessment_id","provider_usage"]],
    ["public","issues",["claim_decision"]], ["demo","analysis_runs",["evidence_assessment_id","provider_usage"]],
    ["demo","issues",["claim_decision"]]] as const) {
    for (const column of columns) assert.equal(sql(`select is_nullable from information_schema.columns where table_schema='${schema}' and table_name='${tableName}' and column_name='${column}'`), "YES");
  }
  assert.equal(sql("select to_regclass('demo.clip_evidence_assessments') is null"), "t");
});

test("service role inserts exact nullable tuple and historical JSON", () => {
  const result = sql(`begin; ${fixtures} set local role service_role;
    insert into public.clip_evidence_assessments ${assessmentRow()};
    select mode||':'||clip_status||':'||(reliability_profile_version is null)::text||':'||(family_reason is null)::text
      from public.clip_evidence_assessments where id='${assessment}'; rollback;`);
  assert.equal(result, "off:eligible:true:true");
});

for (const mode of ["disabled", "SHADOW", "", "enforced"]) test(`invalid mode ${JSON.stringify(mode)} fails`, () =>
  denied(`insert into public.clip_evidence_assessments ${assessmentRow({ mode })};`, /check constraint/));
for (const status of ["pass", "fail", "unknown", ""]) test(`invalid clip status ${JSON.stringify(status)} fails`, () =>
  denied(`insert into public.clip_evidence_assessments ${assessmentRow({ status })};`, /check constraint/));
for (const hash of ["A".repeat(64), "a".repeat(63), "g".repeat(64), "", "null"]) test(`invalid SHA-256 ${hash.length} fails`, () =>
  denied(`insert into public.clip_evidence_assessments ${assessmentRow({ hash: hash === "null" ? "null" : `'${hash}'` })};`, /not-null constraint|check constraint/));

test("family reason accepts only the three S0-09 values and null", () => {
  for (const reason of ["batter_unclear", "swing_unclear", "analysis_version_unavailable"])
    assert.equal(sql(`begin; ${fixtures} insert into public.clip_evidence_assessments ${assessmentRow({ family: `'${reason}'` })}; select family_reason from public.clip_evidence_assessments; rollback;`), reason);
  denied(`insert into public.clip_evidence_assessments ${assessmentRow({ family: "'engine_unknown'" })};`, /check constraint/);
});

test("provider_usage and claim_decision require JSON objects but remain nullable", () => {
  for (const value of ["'[]'::jsonb", "'true'::jsonb", "'\"text\"'::jsonb", "'1'::jsonb"])
    denied(`insert into public.analysis_runs(video_clip_id,player_id,backend,ai_model,prompt_version,analysis_policy_version,knowledge_version,input_manifest,provider_usage)
      values ('${clip}','${player}','gemini','test','test','test','pr9-test','{}',${value});`, /check constraint/);
  const result = sql(`begin; ${fixtures} insert into public.clip_evidence_assessments ${assessmentRow()};
    insert into public.analysis_runs(video_clip_id,player_id,backend,ai_model,prompt_version,analysis_policy_version,knowledge_version,input_manifest,evidence_assessment_id,provider_usage)
      values ('${clip}','${player}','gemini','test','test','test','pr9-test','{}','${assessment}','{"tokens":1}');
    insert into public.issues(player_id,issue,claim_decision) values ('${player}','Claim','{"displayable":false}');
    select jsonb_typeof(provider_usage) from public.analysis_runs; select jsonb_typeof(claim_decision) from public.issues; rollback;`);
  assert.deepEqual(result.split("\n").slice(-2), ["object", "object"]);
  denied(`insert into public.issues(player_id,issue,claim_decision) values ('${player}','Bad','[]');`, /check constraint/);
});

test("guardian and coach roles cannot read or write private assessments", () => {
  for (const role of ["anon", "authenticated"]) {
    denied(`set local role ${role}; set local request.jwt.claim.sub='${coach}'; select * from public.clip_evidence_assessments;`, /permission denied/);
    denied(`set local role ${role}; insert into public.clip_evidence_assessments ${assessmentRow()};`, /permission denied/);
  }
  assert.equal(sql("select count(*) from information_schema.role_table_grants where table_schema='public' and table_name='clip_evidence_assessments' and grantee in ('anon','authenticated','PUBLIC')"), "0");
});

test("updates, direct deletes and truncation fail even for service role and owner", () => {
  for (const prefix of ["", "set local role service_role;"]) {
    denied(`${prefix} insert into public.clip_evidence_assessments ${assessmentRow()}; update public.clip_evidence_assessments set clip_status='withhold' where id='${assessment}';`, /append only|permission denied/);
    denied(`${prefix} insert into public.clip_evidence_assessments ${assessmentRow()}; delete from public.clip_evidence_assessments where id='${assessment}';`, /append only|permission denied/);
    denied(`${prefix} insert into public.clip_evidence_assessments ${assessmentRow()}; truncate public.clip_evidence_assessments cascade;`, /append only|permission denied/);
  }
});

test("foreign keys reject unknown clips and analysis links", () => {
  denied(`insert into public.clip_evidence_assessments ${assessmentRow({ clipId: "gen_random_uuid()" })};`, /foreign key constraint/);
  denied(`insert into public.analysis_runs(video_clip_id,player_id,backend,ai_model,prompt_version,analysis_policy_version,knowledge_version,input_manifest,evidence_assessment_id)
    values ('${clip}','${player}','gemini','test','test','test','pr9-test','{}',gen_random_uuid());`, /foreign key constraint/);
});

test("clip-deletion workflow cascades assessments and nulls retained run links", () => {
  const result = sql(`begin; ${fixtures} insert into public.clip_evidence_assessments ${assessmentRow()};
    insert into public.analysis_runs(video_clip_id,player_id,backend,ai_model,prompt_version,analysis_policy_version,knowledge_version,input_manifest,evidence_assessment_id)
      values ('${clip}','${player}','gemini','test','test','test','pr9-test','{}','${assessment}');
    set local role service_role;
    select public.begin_clip_deletion('${clip}','${coach}','test-bucket');
    select public.finish_clip_deletion('${clip}'); reset role;
    select (select count(*) from public.video_clips where id='${clip}')||':'||
      (select count(*) from public.clip_evidence_assessments where id='${assessment}')||':'||
      (select count(*) from public.analysis_runs where player_id='${player}' and video_clip_id is null and evidence_assessment_id is null); rollback;`);
  assert.equal(result.split("\n").at(-1), "0:0:1");
});

test("migration does not add assessment data to existing parent-facing functions or views", () => {
  const source = readFileSync("supabase/migrations/00065_clip_evidence_assessments.sql", "utf8");
  assert.doesNotMatch(source, /create\s+(or\s+replace\s+)?(view|function)\s+[^\s(]*family/is);
  assert.doesNotMatch(source, /grant\s+select\s+on\s+public\.clip_evidence_assessments\s+to\s+(anon|authenticated|public)/i);
  assert.equal(sql("select count(*) from information_schema.view_column_usage where table_schema='public' and table_name='clip_evidence_assessments'"), "0");
});
