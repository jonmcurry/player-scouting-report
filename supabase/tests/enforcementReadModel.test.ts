/** PR17 disposable PostgreSQL only; every test rolls back. Synthetic UUIDs, no names. */
import test, { before } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { ACTIVE_CONCEPT_REVIEWERS_QUERY, DIFF_INPUTS_QUERY, approvalsQuery, mapApprovals, mapDiffInputs, mapReviewers }
  from '../../src/services/development/evidence/enforcementReadModel.ts';
import { assessEnforceability } from '../../src/services/development/evidence/enforceability.ts';
import { enforcementDiff } from '../../src/services/development/evidence/enforcementDiff.ts';
import { requirementSha256 } from '../../src/services/development/evidence/conceptApprovals.ts';

const container = process.env.PR17_SQL_CONTAINER, database = process.env.PR17_SQL_DATABASE;
const [active, revoked, curator, owner, coach] = [1, 2, 3, 4, 5].map(n => `00000000-0000-4000-a000-0000000017${String(n).padStart(2, '0')}`);
const team = '00000000-0000-4000-a000-000000001711', player = '00000000-0000-4000-a000-000000001712';
const entry = '00000000-0000-4000-a000-000000001713', clip = '00000000-0000-4000-a000-000000001714';
const assessment = '00000000-0000-4000-a000-000000001715', run = '00000000-0000-4000-a000-000000001716';
const legacyRun = '00000000-0000-4000-a000-000000001717';
function sql(query: string): string {
  if (!container || database !== 'pr17_disposable_test') throw new Error('PR17 tests require an explicit container and the pr17_disposable_test database');
  return execFileSync('docker', ['exec', '-i', container, 'psql', '-X', '-qAt', '-v', 'ON_ERROR_STOP=1',
    '-U', 'postgres', '-d', database], { input: query, encoding: 'utf8', stdio: ['pipe', 'pipe', 'pipe'] }).trim();
}
const last = (out: string) => out.split('\n').at(-1)!;
const reviewers = `insert into auth.users(id) values ('${active}'),('${revoked}'),('${curator}'),('${owner}');
insert into public.curation_reviewers(user_id,role,qualification,added_by,revoked_at) values
  ('${active}','concept_reviewer','Synthetic test reviewer','${owner}',null),
  ('${revoked}','concept_reviewer','Synthetic test reviewer','${owner}',now()),
  ('${curator}','drill_curator','Synthetic test curator','${owner}',null);`;
const as = (sub: string) => `set local role authenticated; select set_config('request.jwt.claims','{"role":"authenticated","sub":"${sub}"}',true);`;
const approve = (hash: string, decision: string) =>
  `select public.approve_concept_requirement('contact','claims-0.1.0-proposed','${hash}','${decision}');`;

before(() => { assert.equal(sql('begin; select current_database(); rollback;'), 'pr17_disposable_test'); });

test('reviewer read model excludes revoked reviewers and drill curators', () => {
  const ids = mapReviewers(JSON.parse(last(sql(`begin; ${reviewers} ${ACTIVE_CONCEPT_REVIEWERS_QUERY} rollback;`))));
  assert.deepEqual(ids, [active]);
});
test('approvals read model returns RPC-recorded rows latest-first and feeds the enforceability contract', async () => {
  const current = await requirementSha256('contact');
  // Two RPC decisions in ONE transaction share transaction_timestamp(): no defined latest, so it must fail closed.
  const same = mapApprovals(JSON.parse(last(sql(`begin; ${reviewers} ${as(active)} ${approve(current, 'approved')} ${approve(current, 'rejected')} reset role;
    ${approvalsQuery('claims-0.1.0-proposed')} rollback;`))));
  assert.equal(same.length, 2);
  assert.ok(same.every(r => r.reviewer_id === active && r.requirement_sha256 === current && r.claims_version === 'claims-0.1.0-proposed'));
  assert.ok((await assessEnforceability({ approvals: same, activeConceptReviewers: [active], concepts: ['contact'] })).missing.includes('approval_conflicting:contact'));
  // Separate decision instants (as separate requests produce): latest-first ordering, latest rejection wins.
  const out = sql(`begin; ${reviewers} insert into public.concept_requirement_approvals(concept,claims_version,requirement_sha256,reviewer_id,decision,decided_at)
    values ('contact','claims-0.1.0-proposed','${current}','${active}','approved','2026-10-17T00:00:00Z'),
           ('contact','claims-0.1.0-proposed','${current}','${active}','rejected','2026-10-17T12:00:00Z');
    ${approvalsQuery('claims-0.1.0-proposed')} rollback;`);
  const rows = mapApprovals(JSON.parse(last(out)));
  assert.deepEqual(rows.map(r => [r.decision, r.decided_at]), [['rejected', '2026-10-17T12:00:00.000Z'], ['approved', '2026-10-17T00:00:00.000Z']]);
  const result = await assessEnforceability({ approvals: rows, activeConceptReviewers: [active], concepts: ['contact'] });
  assert.ok(result.missing.includes('approval_rejected:contact') && !result.missing.includes('approval_conflicting:contact') && !result.enforceable);
  const stale = mapApprovals(JSON.parse(last(sql(`begin; ${reviewers} ${as(active)} ${approve('a'.repeat(64), 'approved')} reset role;
    ${approvalsQuery('claims-0.1.0-proposed')} rollback;`))));
  assert.ok((await assessEnforceability({ approvals: stale, activeConceptReviewers: [active], concepts: ['contact'] })).missing.includes('approval_stale:contact'));
  assert.ok((await assessEnforceability({ approvals: stale, activeConceptReviewers: mapReviewers(JSON.parse(last(sql(`begin; ${reviewers}
    update public.curation_reviewers set revoked_at = now() where user_id = '${active}'; ${ACTIVE_CONCEPT_REVIEWERS_QUERY} rollback;`)))),
    concepts: ['contact'] })).missing.includes('approval_reviewer_unauthorized:contact'));
  assert.throws(() => approvalsQuery("claims-0.1.0'; drop table x; --"), /INVALID_CLAIMS_VERSION/);
});
test('clients cannot read approvals, and can never enumerate other reviewers', () => {
  assert.throws(() => sql(`begin; ${reviewers} ${as(active)} ${approvalsQuery('claims-0.1.0-proposed')} rollback;`),
    (e: any) => /permission denied/.test(String(e.stderr)));
  // 00064's reviewer_self_read policy exposes only the caller's own row; enforceability uses service-role reads.
  for (const [sub, expected] of [[active, [active]], [curator, []], [revoked, []], [owner, []]] as const)
    assert.deepEqual(mapReviewers(JSON.parse(last(sql(`begin; ${reviewers} ${as(sub)} ${ACTIVE_CONCEPT_REVIEWERS_QUERY} rollback;`)))), expected, sub);
});
test('diff read model aggregates real tables without identifiers and matches the pure aggregator', async () => {
  const out = sql(`begin; ${reviewers} insert into auth.users(id) values ('${coach}');
    insert into public.methodology_versions(version_label,notes,status,active) values ('pr17-test','Synthetic PR17 test version','published',false);
    insert into public.teams(id,slug,name,sport) values ('${team}','pr17-team','PR17 team','softball');
    insert into public.coach_team_access(coach_id,team_id,role) values ('${coach}','${team}','head_coach');
    insert into public.players(id,team_id,slug,name,jersey_number) values ('${player}','${team}','pr17-player','PR17 player','17');
    insert into public.game_log_entries(id,player_id,date,opponent,ab,result) values ('${entry}','${player}','2026-10-18','Test',1,'Out');
    insert into public.video_clips(id,game_log_entry_id,clip_slug,status,uploaded_by,uploaded_by_role) values ('${clip}','${entry}','pr17-clip','ready','${coach}','coach');
    insert into public.clip_evidence_assessments(id,video_clip_id,engine_code_version,instrumentation_version,environment_version,gate_version,claims_version,
      reliability_profile_version,mode,clip_status,family_reason,subject,events,strict_baseline,source_sha256,backfilled)
      values ('${assessment}','${clip}','engine-baseline-1.0.0','inst-1','env-9a6a8510dec8','gate-1.0.0','claims-0.1.0-proposed',null,'shadow','eligible',null,
      '{"status":"pass"}','{}','{"status":"withhold"}',repeat('a',64),false);
    insert into public.analysis_runs(id,video_clip_id,player_id,backend,ai_model,prompt_version,analysis_policy_version,knowledge_version,input_manifest,evidence_assessment_id)
      values ('${run}','${clip}','${player}','gemini','test','test','test','pr17-test','{}','${assessment}'),
             ('${legacyRun}','${clip}','${player}','gemini','test','test','test','pr17-test','{}',null);
    insert into public.issues(player_id,issue,analysis_run_id,concept,claim_decision) values
      ('${player}','Synthetic','${run}','contact','{"hypothetical":{"wouldDisplay":true,"authorizedForProduction":false}}'),
      ('${player}','Synthetic','${run}','load','{"hypothetical":{"wouldDisplay":true,"authorizedForProduction":false}}'),
      ('${player}','Synthetic','${legacyRun}','contact',null);
    insert into public.player_focus(player_id,concept,status,started_at,qualified_at_serial) values ('${player}','contact','active',now(),1);
    ${DIFF_INPUTS_QUERY} rollback;`);
  const raw = last(out), inputs = mapDiffInputs(JSON.parse(raw));
  for (const id of [team, player, entry, clip, assessment, run, legacyRun, coach]) assert.doesNotMatch(raw, new RegExp(id), id);
  assert.equal(inputs.runs.length, 2); assert.equal(inputs.runs.filter(r => r.has_assessment).length, 1);
  assert.deepEqual(inputs.focus, [{ concept: 'contact', status: 'active' }]);
  const d = await enforcementDiff(inputs.runs, inputs.focus, ['contact']);
  // Two runs and single-digit concept counts are below the suppression minimum; only zeros remain visible.
  assert.equal(d.withheld.overall, 0); assert.equal(d.concepts.load!.would_display, 0);
});
