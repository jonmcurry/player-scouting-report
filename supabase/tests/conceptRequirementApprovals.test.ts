/** PR16 disposable PostgreSQL only; every test rolls back its transaction. */
import test, { before } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { CLAIM_REQUIREMENTS } from '../../src/services/development/evidence/claimRequirements.ts';

const container = process.env.PR16_SQL_CONTAINER, database = process.env.PR16_SQL_DATABASE;
const actor = '00000000-0000-4000-a000-000000001601';
const other = '00000000-0000-4000-a000-000000001602';
function sql(query: string): string {
  if (!container || database !== 'pr16_disposable_test') throw new Error('PR16 tests require an explicit container and the pr16_disposable_test database');
  return execFileSync('docker', ['exec', '-i', container, 'psql', '-X', '-qAt', '-v', 'ON_ERROR_STOP=1',
    '-U', 'postgres', '-d', database], { input: query, encoding: 'utf8', stdio: ['pipe', 'pipe', 'pipe'] }).trim();
}
const fixtures = `insert into auth.users(id) values ('${actor}'), ('${other}');`;
const reviewer = (role = 'concept_reviewer', revoked = false) => `insert into public.curation_reviewers(user_id,role,qualification,added_by,revoked_at)
  values ('${actor}','${role}','Synthetic test reviewer','${other}',${revoked ? 'now()' : 'null'});`;
const session = (role = 'authenticated', sub: string | null = actor) => `set local role ${role};
  select set_config('request.jwt.claims','${JSON.stringify({ role, ...(sub ? { sub } : {}) })}',true);`;
const call = (concept = "'contact'", version = "'claims-0.1.0-proposed'", hash = "repeat('a',64)", decision = "'approved'") =>
  `select public.approve_concept_requirement(${concept},${version},${hash},${decision});`;
function transaction(body: string) { return sql(`begin; ${fixtures} ${body} rollback;`); }
function denied(body: string, pattern: RegExp) {
  assert.throws(() => transaction(body), (error: any) => { assert.match(String(error.stderr), pattern); return true; });
}
before(() => { assert.equal(sql('begin; select current_database(); rollback;'), 'pr16_disposable_test'); });
test('anon, missing JWT subject and non-authenticated JWT refused', () => {
  denied(session('anon') + call(), /permission denied/);
  denied(reviewer() + session('authenticated', null) + call(), /Authenticated reviewer required/);
  denied(reviewer() + `select set_config('request.jwt.claims','{"role":"service_role","sub":"${actor}"}',true);` + call(), /Authenticated reviewer required/);
});
test('unlisted, drill curator and revoked concept reviewer refused', () => {
  denied(session() + call(), /Active concept reviewer required/);
  denied(reviewer('drill_curator') + session() + call(), /Active concept reviewer required/);
  denied(reviewer('concept_reviewer', true) + session() + call(), /Active concept reviewer required/);
});
test('active reviewer can approve or reject all exact concept slugs; identity is JWT sub', () => {
  for (const concept of Object.keys(CLAIM_REQUIREMENTS)) {
    const result = transaction(reviewer() + session() + call(`'${concept}'`) + call(`'${concept}'`, undefined, undefined, "'rejected'") +
      `reset role; select count(*)||':'||bool_and(reviewer_id='${actor}'::uuid)::text||':'||bool_and(decided_at=transaction_timestamp())::text from public.concept_requirement_approvals;`);
    assert.equal(result.split('\n').at(-1), '2:true:true');
  }
  denied(reviewer() + session() + `select public.approve_concept_requirement(p_concept=>'contact',p_claims_version=>'claims-0.1.0-proposed',
    p_requirement_sha256=>repeat('a',64),p_decision=>'approved',p_reviewer_id=>'${other}');`, /does not exist/);
});
test('invalid and null decision, concept, version and hash refused', () => {
  for (const value of ["'invalid'", 'null', "''"]) {
    denied(reviewer() + session() + call(undefined, undefined, undefined, value), /Invalid decision/);
    denied(reviewer() + session() + call(value), /Invalid concept/);
    denied(reviewer() + session() + call(undefined, value), /Invalid claims version/);
    denied(reviewer() + session() + call(undefined, undefined, value), /Invalid requirement hash/);
  }
  for (const version of ["'claims-1x2x3'", "'claims-1.2.3-other'"]) denied(reviewer() + session() + call(undefined, version), /Invalid claims version/);
  for (const hash of ["repeat('A',64)", "repeat('a',63)", "repeat('g',64)"]) denied(reviewer() + session() + call(undefined, undefined, hash), /Invalid requirement hash/);
});
test('append-only for owner and service_role; clients cannot select or insert', () => {
  for (const role of ['', 'set local role service_role;']) for (const command of [
    "update public.concept_requirement_approvals set notes='changed';", 'delete from public.concept_requirement_approvals;', 'truncate public.concept_requirement_approvals;',
  ]) denied(reviewer() + session() + call() + 'reset role;' + role + command, /append-only|permission denied/);
  for (const role of ['anon', 'authenticated']) denied(session(role) + 'select * from public.concept_requirement_approvals;', /permission denied/);
  for (const role of ['anon', 'authenticated', 'service_role']) denied(session(role) +
    `insert into public.concept_requirement_approvals(concept,claims_version,requirement_sha256,reviewer_id,decision) values ('contact','claims-1.0.0',repeat('a',64),'${actor}','approved');`, /permission denied/);
  assert.equal(transaction(reviewer() + session() + call() + 'reset role; set local role service_role; select count(*) from public.concept_requirement_approvals;').split('\n').at(-1), '1');
});
test('RLS, postgres ownership, empty search_path and minimal execute ACL', () => {
  assert.equal(transaction("select relrowsecurity from pg_class where oid='public.concept_requirement_approvals'::regclass;"), 't');
  assert.equal(transaction("select count(*) from pg_policies where schemaname='public' and tablename='concept_requirement_approvals';"), '0');
  assert.equal(transaction(`select count(*) from pg_proc where oid='public.approve_concept_requirement(text,text,text,text,text)'::regprocedure
    and prosecdef and proowner='postgres'::regrole and proconfig @> array['search_path=""'];`), '1');
  for (const role of ['anon', 'service_role']) assert.equal(transaction(`select has_function_privilege('${role}', 'public.approve_concept_requirement(text,text,text,text,text)', 'execute');`), 'f');
  assert.equal(transaction("select has_function_privilege('authenticated', 'public.approve_concept_requirement(text,text,text,text,text)', 'execute');"), 't');
  assert.equal(transaction(`select count(*) from pg_proc p, lateral aclexplode(p.proacl) a
    where p.oid='public.approve_concept_requirement(text,text,text,text,text)'::regprocedure and a.grantee=0;`), '0');
});
