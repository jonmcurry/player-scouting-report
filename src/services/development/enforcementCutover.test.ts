import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile, readdir } from 'node:fs/promises';
import { join } from 'node:path';
import { cutoverFocus, RECHECKING_NOTE, type CutoverSwing, type CutoverFinding } from './enforcementCutover.ts';
import { advanceFocus, type FocusRecord } from './focus.ts';

const policy = { h5SafeLegacyEvidence: { decided: true as const, definition: 'synthetic test definition' }, h6CoachAttestedCounts: false };
const stored: FocusRecord = { concept: 'load', status: 'improving', startedAt: '2026-09-01', endedAt: null, qualifiedAtSerial: 3, dismissedAtSerial: null, dismissedBy: null };
const history: FocusRecord[] = [{ concept: 'stride_plant', status: 'fixed', startedAt: '2026-08-01', endedAt: '2026-08-20', qualifiedAtSerial: 1, dismissedAtSerial: null, dismissedBy: null }];
function finding(over: Partial<CutoverFinding> = {}): CutoverFinding {
  return { id: 'f-' + Math.random().toString(16).slice(2), concept: 'load', phase: 'load', basis: 'video', confidence: 'medium',
    contextExplainsIt: false, emergencySwingSuspected: false, hidden: false, displayable: true, enforcedTuple: true, ...over };
}
function swing(serial: number, findings: CutoverFinding[] = [finding()], over: Partial<CutoverSwing> = {}): CutoverSwing {
  return { id: `s-${serial}`, serial, date: '2026-10-01', sessionType: 'game', readable: true, findings, analysedUnderEnforcedTuple: true, ...over };
}

test('undecided H5 or H6 fails closed and returns stored state untouched', () => {
  for (const p of [null, undefined, {}, { ...policy, h5SafeLegacyEvidence: null }, { ...policy, h6CoachAttestedCounts: null },
    { ...policy, h5SafeLegacyEvidence: { decided: true, definition: '  ' } }]) {
    const r = cutoverFocus({ stored, history, swingsAfterCutover: [swing(10), swing(11), swing(12)], policy: p });
    assert.equal(r.outcome, 'policy_undecided'); if (r.outcome === 'policy_undecided') { assert.equal(r.stored, stored); assert.equal(r.history, history); }
  }
});
test('fewer than three eligible swings freezes transitions without demoting stored status', () => {
  for (const status of ['active', 'improving'] as const) {
    const s = { ...stored, status };
    const r = cutoverFocus({ stored: s, history, swingsAfterCutover: [swing(10), swing(11)], policy });
    assert.equal(r.outcome, 'rechecking');
    if (r.outcome === 'rechecking') { assert.equal(r.stored, s); assert.equal(r.stored?.status, status); assert.equal(r.note, RECHECKING_NOTE); assert.equal(r.eligibleSwings, 2); }
  }
  // Practice, unreadable and non-enforced swings never count toward the three.
  const r = cutoverFocus({ stored, history, policy, swingsAfterCutover: [swing(10), swing(11), swing(12, [finding()], { sessionType: 'practice' }),
    swing(13, [finding()], { readable: false }), swing(14, [finding()], { analysedUnderEnforcedTuple: false })] });
  assert.equal(r.outcome, 'rechecking');
});
test('exactly three eligible swings resume transitions through unchanged advanceFocus, on counted findings only', () => {
  const swings = [swing(10), swing(11, [finding({ displayable: false })]), swing(12, [finding({ enforcedTuple: false }), finding({ concept: 'posture' })])];
  const r = cutoverFocus({ stored, history, swingsAfterCutover: swings, policy });
  assert.equal(r.outcome, 'advanced');
  const expected = advanceFocus([swing(10), swing(11, []), swing(12, [finding({ concept: 'posture' })])].map(s => ({ ...s,
    findings: s.findings.map(({ displayable: _d, enforcedTuple: _e, coachAttested: _c, ...f }) => f) })), { ...stored }, history.map(h => ({ ...h })));
  if (r.outcome === 'advanced') { assert.deepEqual(r.result, expected); assert.equal(r.eligibleSwings, 3); }
});
test('coach-attested findings count only when H6 is true', () => {
  const attested = [swing(10, [finding({ displayable: false, enforcedTuple: false, coachAttested: true })]),
    swing(11, [finding({ displayable: false, enforcedTuple: false, coachAttested: true })]), swing(12, [finding({ displayable: false, enforcedTuple: false, coachAttested: true })])];
  const off = cutoverFocus({ stored, history, swingsAfterCutover: attested, policy });
  const on = cutoverFocus({ stored, history, swingsAfterCutover: attested, policy: { ...policy, h6CoachAttestedCounts: true } });
  assert.ok(off.outcome === 'advanced' && on.outcome === 'advanced');
  if (off.outcome === 'advanced' && on.outcome === 'advanced') assert.notDeepEqual(off.result, on.result);
});
test('history and stored records are never mutated', () => {
  const s = { ...stored }, h = history.map(x => ({ ...x })), before = JSON.stringify([s, h]);
  cutoverFocus({ stored: s, history: h, swingsAfterCutover: [swing(10), swing(11), swing(12), swing(13)], policy });
  assert.equal(JSON.stringify([s, h]), before);
});
test('the cut-over module is not wired into any production focus, report or Edge code', async () => {
  const files = ['src/services/development/focus.ts', 'src/services/development/focusPersistence.ts', 'src/services/development/progressView.ts'];
  const edge = async (dir: string): Promise<string[]> => (await readdir(dir, { withFileTypes: true })).flatMap(e => e.isDirectory() ? [] : [join(dir, e.name)])
    .concat(...await Promise.all((await readdir(dir, { withFileTypes: true })).filter(e => e.isDirectory()).map(e => edge(join(dir, e.name)))));
  for (const file of [...files, ...(await edge('supabase/functions')).filter(f => /\.[cm]?[jt]s$/.test(f))])
    assert.doesNotMatch(await readFile(file, 'utf8'), /enforcementCutover/, file);
});
