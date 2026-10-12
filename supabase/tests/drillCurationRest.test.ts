/** Real PostgREST/JWT integration. Requires a fresh disposable pr2_rest_test clone;
 * this suite deliberately persists synthetic approvals there (audit is append-only).
 * See docs/architecture/DRILL_CURATION.md. Never reads application .env. */
import test from 'node:test';
import assert from 'node:assert/strict';
import { createHmac } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { createClient } from '@supabase/supabase-js';
import { applyCandidates } from '../../src/cli/importCuratedDrills.ts';
import { loadCandidateDrills } from '../../src/services/development/drillCandidateParser.ts';
const url = 'http://127.0.0.1:55431';
const secret = 'pr2-disposable-test-secret-at-least-32-characters';
const reviewer = '00000000-0000-4000-a000-000000009901';
const nonreviewer = '00000000-0000-4000-a000-000000009902';
function token(role: string, sub?: string) {
  const payload = [ { alg: 'HS256', typ: 'JWT' }, { role, sub, exp: Math.floor(Date.now()/1000)+300 } ].map(v => Buffer.from(JSON.stringify(v)).toString('base64url')).join('.');
  return `${payload}.${createHmac('sha256', secret).update(payload).digest('base64url')}`;
}
function client(role: string, sub?: string) {
  return createClient(url, 'test-api-key', { global: { fetch: (input, init) => fetch(String(input).replace('/rest/v1/', '/'), init), headers: { Authorization: `Bearer ${token(role,sub)}` } }, auth: { persistSession: false, autoRefreshToken: false } });
}
function sql(query: string) {
  return execFileSync('docker', ['exec','-i','codex-pr2-sql','psql','-X','-qAt','-v','ON_ERROR_STOP=1','-U','supabase_admin','-d','pr2_rest_test'], { input: query, encoding: 'utf8' }).trim();
}
const must = (r: any) => { assert.equal(r.error, null, JSON.stringify(r.error)); return r.data; };
test('signed reviewer JWT approves as self; real imports never overwrite approvals or grant reviewers', async () => {
  assert.equal(process.env.PR2_SQL_CONTAINER, 'codex-pr2-sql', 'Explicit disposable test opt-in required');
  assert.equal(sql("select to_regnamespace('pr2_disposable_test') is not null"), 't');
  // The standalone PostgreSQL image predates GoTrue's modern claim helpers.
  // Match the read-only inspected local Auth definitions; only this test clone changes.
  sql(`create or replace function auth.role() returns text language sql stable as $$ select coalesce(nullif(current_setting('request.jwt.claim.role',true),''),nullif(current_setting('request.jwt.claims',true),'')::jsonb->>'role') $$;
    create or replace function auth.uid() returns uuid language sql stable as $$ select coalesce(nullif(current_setting('request.jwt.claim.sub',true),''),nullif(current_setting('request.jwt.claims',true),'')::jsonb->>'sub')::uuid $$;
    insert into auth.users(id) values('${reviewer}'),('${nonreviewer}');
    insert into public.curation_reviewers(user_id,role,qualification,added_by) values('${reviewer}','drill_curator','Synthetic API reviewer','${nonreviewer}');`);
  const svc = client('service_role'); const user = client('authenticated', reviewer);
  // Wait for PostgREST's schema cache after initial startup, without external requests.
  let ready;
  for (let i=0;i<20;i++) {
    ready = await svc.from('drill_library').select('id').limit(1);
    if (!ready.error) break;
    await new Promise(resolve => setTimeout(resolve, 250));
  }
  must(ready);
  const drills = loadCandidateDrills();
  // Exercise real inserts as well as updates. No assigned/historical rows are touched.
  await applyCandidates(svc, [{ ...drills[0]!, slug: 'pr2-rest-new-candidate' }]);
  for (const schema of ['public','demo']) assert.equal(must(await svc.schema(schema).from('drill_library').select('curation_status').eq('slug','pr2-rest-new-candidate').single()).curation_status,'draft');
  await applyCandidates(svc, drills);
  for (const schema of ['public','demo']) {
    assert.equal(must(await svc.schema(schema).from('drill_library').select('id').eq('curation_status','approved')).length, 0);
  }
  const row = must(await svc.from('drill_library').select('*').eq('slug',drills[0]!.slug).single());
  const review = must(await user.rpc('get_drill_review', { p_drill_id: row.id }));
  assert.deepEqual(review.content.instructions, drills[0]!.instructions);
  const args = { p_drill_id: row.id, p_content_sha256: review.content_sha256, p_decision: 'approved', p_notes: 'Reviewed via signed test JWT' };
  assert.ok((await client('authenticated',nonreviewer).rpc('approve_drill',args)).error);
  assert.ok((await svc.rpc('approve_drill',args)).error);
  assert.ok((await user.rpc('approve_drill',{ ...args, p_content_sha256: 'bad' })).error);
  // Direct PostgREST URL has no /rest/v1 gateway prefix; validate signed JWT rejection there.
  const forged = await fetch(`${url}/rpc/approve_drill`, { method:'POST', headers: { Authorization: `Bearer ${token('authenticated',reviewer)}broken`, 'Content-Type':'application/json' }, body: JSON.stringify(args) });
  assert.equal(forged.status,401);
  must(await user.rpc('approve_drill',args));
  for (const schema of ['public','demo']) {
    const approved = must(await svc.schema(schema).from('drill_library').select('*').eq('slug',row.slug).single());
    assert.equal(approved.curated_by,reviewer); assert.equal(approved.curation_status,'approved');
    assert.ok((await svc.schema(schema).from('drill_library').update({ curated_by:nonreviewer }).eq('id',approved.id)).error);
  }
  await applyCandidates(svc, [{ ...drills[0]!, instructions:'Unreviewed overwrite attempt' }, ...drills.slice(1)]);
  for (const schema of ['public','demo']) {
    const preserved = must(await svc.schema(schema).from('drill_library').select('*').eq('slug',row.slug).single());
    assert.equal(preserved.instructions, row.instructions); assert.equal(preserved.curation_status,'approved'); assert.equal(preserved.curated_by,reviewer);
  }
  assert.equal(must(await svc.from('curation_reviewers').select('*')).length,1);
  assert.equal(must(await svc.from('drill_curation_decisions').select('*')).length,2);
  must(await svc.from('curation_reviewers').update({ revoked_at:new Date().toISOString() }).eq('user_id',reviewer));
  assert.ok((await user.rpc('approve_drill',args)).error);
});
