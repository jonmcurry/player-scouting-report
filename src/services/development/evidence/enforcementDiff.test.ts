import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { enforcementDiff, renderEnforcementDiff, SUPPRESSED, type DiffRun } from './enforcementDiff.ts';
import { runEnforcementDiff, disposablePsqlReader } from '../../../cli/enforcementDiff.ts';

const decision = (wouldDisplay: boolean) => ({ hypothetical: { wouldDisplay, authorizedForProduction: false } });
function runs(): DiffRun[] {
  const out: DiffRun[] = [];
  for (let i = 0; i < 10; i++) out.push({ has_assessment: true, clip_status: 'eligible', family_reason: null,
    issues: [{ concept: 'contact', claim_decision: decision(i < 6) }, { concept: 'load', claim_decision: decision(true) }] });
  for (let i = 0; i < 6; i++) out.push({ has_assessment: true, clip_status: 'withhold', family_reason: 'batter_unclear',
    issues: [{ concept: 'contact', claim_decision: decision(true) }] });
  for (let i = 0; i < 5; i++) out.push({ has_assessment: false, clip_status: null, family_reason: null, issues: [{ concept: 'contact', claim_decision: null }] });
  return out;
}
const focus = [...Array(6)].map((_, i) => ({ concept: 'contact', status: i < 5 ? 'active' : 'improving' }));

test('hand-computed aggregate: eligible + enforced concept + wouldDisplay is the only way to display', async () => {
  const d = await enforcementDiff(runs(), focus, ['contact']);
  assert.deepEqual(d.runs, { total: 21, assessed: 16, legacy_unassessed: 5 });
  assert.deepEqual(d.withheld, { overall: 6, by_family_reason: { batter_unclear: 6 } });
  // contact: 10 eligible (6 display) + 6 withheld (clip not eligible) + 5 legacy (no assessment) = 21 issues.
  assert.deepEqual(d.concepts.contact, { issues: 21, would_display: 6, would_disappear: 15 });
  // load is not an enforced concept, so even wouldDisplay=true findings disappear.
  assert.deepEqual(d.concepts.load, { issues: 10, would_display: 0, would_disappear: 10 });
  assert.deepEqual(d.focus.contact, { kept_rechecking: 6, other_open: 0 });
  assert.equal(d.legacy_safe_only.runs_without_ai_summary_or_fix, 5);
  assert.match(d.digest, /^[a-f0-9]{64}$/); assert.equal((await enforcementDiff(runs(), focus, ['contact'])).digest, d.digest);
  assert.notEqual((await enforcementDiff(runs().slice(1), focus, ['contact'])).digest, d.digest);
});
test('small cells are suppressed; zero is not suppressed; outputs carry no identifiers', async () => {
  const d = await enforcementDiff(runs().slice(0, 3), [{ concept: 'load', status: 'active' }], ['contact']);
  assert.equal(d.runs.total, SUPPRESSED); assert.equal(d.runs.legacy_unassessed, 0); assert.equal(d.focus.load!.kept_rechecking, SUPPRESSED);
  const text = JSON.stringify(d) + renderEnforcementDiff(d);
  assert.doesNotMatch(text, /[a-f0-9]{8}-[a-f0-9]{4}-|eval_[a-f0-9]{16}|[A-Za-z]:\\|\/Users\/|\.mp4|\.mov/i);
});
test('invalid enforced concepts refused, including disabled concepts', async () => {
  for (const c of [[], ['nope'], ['timing'], ['contact', 'contact']]) await assert.rejects(enforcementDiff(runs(), focus, c), /INVALID_ENFORCED_CONCEPTS/);
});
test('CLI: requires confirmation, refuses repo-internal output, never overwrites, disposable reader only', async () => {
  const reader = async () => ({ runs: runs(), focus });
  const repoRoot = process.cwd();
  await assert.rejects(runEnforcementDiff({ confirm: false, enforcedConcepts: ['contact'], out: join(tmpdir(), 'x'), repoRoot, reader }), /DRY_RUN_CONFIRMATION_REQUIRED/);
  await assert.rejects(runEnforcementDiff({ confirm: true, enforcedConcepts: ['contact'], out: join(repoRoot, 'tmp-diff'), repoRoot, reader }), /OUT_INSIDE_REPOSITORY/);
  await assert.rejects(runEnforcementDiff({ confirm: true, enforcedConcepts: ['contact'], out: 'relative', repoRoot, reader }), /OUT_MUST_BE_ABSOLUTE/);
  const out = await mkdtemp(join(tmpdir(), 'enforcement-diff-'));
  try {
    const d = await runEnforcementDiff({ confirm: true, enforcedConcepts: ['contact'], out, repoRoot, reader });
    assert.equal(JSON.parse(await readFile(join(out, 'enforcement-diff.json'), 'utf8')).digest, d.digest);
    await assert.rejects(runEnforcementDiff({ confirm: true, enforcedConcepts: ['contact'], out, repoRoot, reader }), /EEXIST/);
  } finally { await rm(out, { recursive: true, force: true }); }
  for (const db of ['postgres', 'production', 'pr17_test', 'x_disposable_test; drop']) assert.throws(() => disposablePsqlReader('c', db), /DISPOSABLE_DATABASE_REQUIRED/);
  assert.doesNotThrow(() => disposablePsqlReader('supabase_db_softball_analysis', 'pr17_disposable_test'));
});
