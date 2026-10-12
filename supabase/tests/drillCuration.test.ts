/** Real PostgreSQL tests. Only the explicitly marked disposable PR2 container is accepted.
 * Every test rolls back. Never point this suite at the existing development stack. */
import test, { before } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { selectDrills } from '../../src/services/development/drillSelection.ts';
const container = process.env.PR2_SQL_CONTAINER;
const reviewer = '00000000-0000-4000-a000-000000009901';
const other = '00000000-0000-4000-a000-000000009902';
function sql(query: string): string {
  if (container !== 'codex-pr2-sql') throw new Error('Set PR2_SQL_CONTAINER=codex-pr2-sql for the disposable test database only');
  return execFileSync('docker', ['exec', '-i', container, 'psql', '-X', '-qAt', '-v', 'ON_ERROR_STOP=1', '-U', 'postgres', '-d', 'postgres'], { input: query, encoding: 'utf8', stdio: ['pipe', 'pipe', 'pipe'] }).trim();
}
before(() => {
  assert.equal(sql("select to_regnamespace('pr2_disposable_test') is not null"), 't', 'Explicit disposable test marker required');
});
const fixtures = `
insert into auth.users(id) values ('${reviewer}'), ('${other}');
insert into public.curation_reviewers(user_id,role,qualification,added_by) values ('${reviewer}','drill_curator','Synthetic SQL test reviewer','${other}');
`;
function session(role = 'authenticated', user = reviewer) {
  return `set local role ${role}; set local request.jwt.claim.role = '${role}'; set local request.jwt.claim.sub = '${user}'; set local request.jwt.claims = '{"role":"${role}","sub":"${user}"}';`;
}
const id = "(select id from public.drill_library where slug='d01-open-stance-drill' and team_id is null)";
const hash = "(select public.drill_content_sha256(to_jsonb(d)) from public.drill_library d where id=" + id + ")";
const approve = `select public.approve_drill(${id},${hash},'approved','SQL test');`;
function run(body: string) { return sql(`begin; ${fixtures} ${body}; rollback;`); }
function denied(body: string, pattern: RegExp) {
  assert.throws(() => run(body), (error: any) => { assert.match(String(error.stderr), pattern); return true; });
}
test('all 64 migrations recorded once; both schemas contain 90 unreviewed candidates and no seeded reviewers', () => {
  assert.equal(sql('select count(*) from supabase_migrations.schema_migrations'), '64');
  assert.equal(sql('select count(*) from public.curation_reviewers'), '0');
  for (const schema of ['public','demo']) {
    assert.equal(sql(`select count(*) from ${schema}.drill_library where slug ~ '^d[0-9]{2}-' and curation_status='draft' and curated_at is null and curated_by is null`), '90');
    assert.equal(sql(`select count(*) from ${schema}.drill_library where curation_status='approved'`), '0');
  }
});
test('non-reviewers and concept reviewers cannot approve or retrieve reviewer content', () => {
  denied(session('authenticated', other) + approve, /Active drill reviewer required/);
  denied(session('authenticated', other) + `select public.get_drill_review(${id});`, /Active drill reviewer required/);
  denied(`update public.curation_reviewers set role='concept_reviewer'; ${session()} ${approve}`, /Active drill reviewer required/);
});
test('revoked reviewers cannot approve', () => denied(`update public.curation_reviewers set revoked_at=now(); ${session()} ${approve}`, /Active drill reviewer required/));
test('missing identity, NULL role, service role, and anonymous RPC callers fail closed', () => {
  denied(approve, /Authenticated reviewer required/);
  denied(session('authenticated', '') + approve, /Authenticated reviewer required/);
  denied(session('service_role') + approve, /permission denied for function approve_drill/);
  denied(session('anon') + `select public.approve_drill(gen_random_uuid(),'bad','approved','');`, /permission denied for function approve_drill/);
});
test('wrong and NULL hashes and invalid decisions are rejected', () => {
  denied(session() + `select public.approve_drill(${id},'bad','approved','');`, /Content changed/);
  denied(session() + `select public.approve_drill(${id},null,'approved','');`, /Content changed/);
  denied(session() + `select public.approve_drill(${id},${hash},'draft','');`, /Invalid decision/);
});
test('genuine reviewer identity, snapshot and hash are recorded with matching public/demo approval', () => {
  const output = run(`${session()} ${approve} reset role;
    select jsonb_build_object('public_actor',(select curated_by from public.drill_library where id=${id}),
      'demo_actor',(select curated_by from demo.drill_library where slug='d01-open-stance-drill' and team_id is null),
      'audits',(select count(*) from public.drill_curation_decisions where reviewer_id='${reviewer}' and decision='approved' and content_sha256=public.drill_content_sha256(content)),
      'capabilities',(select count(*) from curation_private.authorizations));`);
  const data = JSON.parse(output.split('\n').at(-1)!);
  assert.deepEqual(data, { public_actor: reviewer, demo_actor: reviewer, audits: 2, capabilities: 0 });
});
test('repeat decisions leave no reusable capability; rejected decisions are audited', () => {
  const output = run(`${session()} ${approve} ${approve}
    select public.approve_drill(${id},${hash},'rejected','Needs revision'); reset role;
    select (select count(*) from curation_private.authorizations) || ':' || (select count(*) from public.drill_curation_decisions) || ':' || (select curation_status from public.drill_library where id=${id});`);
  assert.equal(output.split('\n').at(-1), '0:6:rejected');
});
for (const schema of ['public', 'demo']) {
  test(`${schema}: service and NULL-role writes and spoofed transaction flags cannot approve`, () => {
    const update = `update ${schema}.drill_library set curation_status='approved', curated_at=now(),curated_by='${reviewer}' where slug='d01-open-stance-drill';`;
    denied(update, /Curation decisions require approve_drill/);
    denied(session('service_role') + update, /Curation decisions require approve_drill/);
    denied(session('service_role') + "set local request.jwt.claim.role='authenticated'; set local app.drill_curation_authorized='true';" + update, /Curation decisions require approve_drill/);
    denied(session('service_role') + `insert into ${schema}.drill_library(slug,name,curation_status,curated_by,curated_at) values('spoof','Spoof','approved','${reviewer}',now());`, /New drills must be unreviewed drafts/);
  });
  test(`${schema}: content edits invalidate approval, unchanged content preserves it`, () => {
    const output = run(`${session()} ${approve} reset role; ${session('service_role')}
      update ${schema}.drill_library set instructions=instructions where slug='d01-open-stance-drill';
      select curation_status from ${schema}.drill_library where slug='d01-open-stance-drill';
      update ${schema}.drill_library set instructions=instructions || ' Changed' where slug='d01-open-stance-drill';
      select curation_status || ':' || (curated_by is null)::text || ':' || (curated_at is null)::text from ${schema}.drill_library where slug='d01-open-stance-drill';`);
    assert.deepEqual(output.split('\n').slice(-2), ['approved', 'draft:true:true']);
  });
}
test('content hash covers every safety/display field, and excludes only identity/review metadata', () => {
  const output = sql(`select jsonb_agg(key) from public.drill_library d, lateral jsonb_each(public.drill_review_content(to_jsonb(d))) where slug='d01-open-stance-drill';`);
  const fields: string[] = JSON.parse(output);
  for (const field of ['instructions','is_active','coach_notes','reference_url','phase','target_tags','min_age','requires_screen','weighted_or_overspeed','home_friendly','demo_url','source_credit','sport','cue','looks_right_when']) assert.ok(fields.includes(field), field);
  for (const field of ['id','team_id','created_at','curated_at','curated_by','curation_status']) assert.ok(!fields.includes(field));
});
test('different demo content is not approved or audited', () => {
  const output = run(`update demo.drill_library set instructions=instructions || ' Demo difference' where slug='d01-open-stance-drill'; ${session()} ${approve} reset role;
    select curation_status || ':' || (select count(*) from public.drill_curation_decisions where drill_schema='demo') from demo.drill_library where slug='d01-open-stance-drill';`);
  assert.equal(output.split('\n').at(-1), 'draft:0');
});
test('audit cannot be inserted, updated, deleted or truncated by service clients; even ordinary owner mutation fails', () => {
  for (const operation of ['update public.drill_curation_decisions set notes=\'spoof\'', 'delete from public.drill_curation_decisions', 'truncate public.drill_curation_decisions']) {
    denied(session('service_role') + operation, /permission denied/);
    denied(operation, /append-only/);
  }
  denied(session('service_role') + "insert into public.drill_curation_decisions default values;", /permission denied/);
});
test('service and authenticated clients cannot forge private capabilities; users cannot self-enroll', () => {
  for (const role of ['service_role','authenticated']) denied(session(role) + 'insert into curation_private.authorizations default values;', /permission denied/);
  denied(session() + `insert into public.curation_reviewers(user_id,role,qualification,added_by) values('${other}','drill_curator','self','${other}');`, /permission denied/);
  assert.equal(run(session('service_role') + "update public.curation_reviewers set revoked_at=now(); select count(*) from public.curation_reviewers where revoked_at is not null;"), '1');
});
test('repeated candidate migration/import preserves approved/rejected content and review fields', () => {
  const migration = readFileSync('supabase/migrations/00063_drill_library_candidates.sql','utf8');
  for (const decision of ['approved','rejected']) {
    const output = run(`update public.drill_library set instructions='Human-reviewed custom content' where id=${id}; ${session()}
      select public.approve_drill(${id},${hash},'${decision}','Keep'); reset role; ${migration} ${migration}
      select instructions || ':' || curation_status || ':' || curated_by::text from public.drill_library where id=${id};`);
    assert.equal(output.split('\n').at(-1), `Human-reviewed custom content:${decision}:${reviewer}`);
  }
});
test('review snapshot hash becomes stale after a content edit', () => denied(`create temp table old_hash as select ${hash} as hash;
  update public.drill_library set cue=cue || ' changed' where id=${id}; grant select on old_hash to authenticated;
  ${session()} select public.approve_drill(${id},(select hash from old_hash),'approved','');`, /Content changed/));
test('public and demo database rows select exactly RPC-approved drills for reports', () => {
  for (const schema of ['public','demo']) {
    const output = run(`${session()} ${approve} reset role;
      select jsonb_agg(jsonb_build_object('id',id,'name',name,'targetTags',target_tags,'bestFor',best_for,'isActive',is_active,'curationStatus',curation_status,'minAge',min_age,'sport',sport,'homeFriendly',home_friendly,'equipment',equipment,'phase',phase,'requiresScreen',requires_screen,'weightedOrOverspeed',weighted_or_overspeed)) from ${schema}.drill_library;`);
    const rows = JSON.parse(output.split('\n').at(-1)!);
    const selected = selectDrills(rows, { concept: 'stance_setup', phase: null, sport: 'softball', age: 12 });
    assert.deepEqual(selected.map(d => d.name), ['Open Stance Drill']);
  }
});
test('definer owners, fixed search paths and execute grants are hardened', () => {
  assert.equal(sql(`select count(*) from pg_proc where oid in ('public.approve_drill(uuid,text,text,text)'::regprocedure,'public.get_drill_review(uuid)'::regprocedure,'public.protect_drill_curation_fields()'::regprocedure) and prosecdef and proowner='postgres'::regrole and proconfig @> array['search_path=""'];`), '3');
  for (const role of ['anon','service_role']) assert.equal(sql(`select has_function_privilege('${role}','public.approve_drill(uuid,text,text,text)','EXECUTE');`), 'f');
});
