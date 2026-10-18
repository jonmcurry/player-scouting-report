import test from 'node:test';
import assert from 'node:assert/strict';
import { classifyTerminal, type TerminalInput } from './terminal.ts';
import { terminalArtifacts, artifacts } from './testing/fixtures.ts';
import { canonicalJson, sha256 } from './registry.ts';
const fixture = (): TerminalInput => ({ ...terminalArtifacts(), registrySha256: '0'.repeat(64) });
const obj = (v: unknown) => v as Record<string, any>;
const mapChange = (a: TerminalInput, change: (m: Record<string, any>) => void) => {
  const m = JSON.parse(a.frameMapJson!); change(m); a.frameMapJson = JSON.stringify(m);
  obj(a.manifest).frame_map_sha256 = sha256(a.frameMapJson);
};

test('verified terminal record is deterministic, sorted and contains no diagnostic, path or coordinate fields', () => {
  const a = fixture(); obj(a.metrics).error = 'C:/private/secret.mp4'; obj(a.pipelineStatus).detail.error = '/home/private';
  obj(a.pose2d).meta.video = obj(a.batPath).meta.video = 'C:/private/secret.mp4';
  const result = classifyTerminal(a); assert.equal(result.kind, 'verified_terminal');
  if (result.kind !== 'verified_terminal') return;
  assert.deepEqual(result.record, { analyzed_frames: 0, attempt_number: 0, decoded_frames: 120,
    environment: { environment_verification: null, environment_version: null },
    frame_map_sha256: sha256(a.frameMapJson!), outcome: 'low_quality_footage', provenance: 'manifest_frame_map_bound', run_id: 'd'.repeat(32) });
  assert.equal(JSON.stringify(result.record), canonicalJson(result.record));
  assert.deepEqual(classifyTerminal(a), result);
  assert.doesNotMatch(JSON.stringify(result.record), /private|secret|synthetic diagnostic|coordinates|"(?:error|delta|accuracy|rate|pass|tolerance_met|rmse|mean|confidence)":/);
});
test('environment identity and verification are preserved verbatim', () => {
  const a = fixture(); Object.assign(obj(a.manifest), { environment_version: 'env-9a6a8510dec8', environment_verification: 'different_from_capture' });
  const r = classifyTerminal(a); assert.equal(r.kind, 'verified_terminal');
  if (r.kind === 'verified_terminal') assert.deepEqual(r.record.environment, { environment_version: 'env-9a6a8510dec8', environment_verification: 'different_from_capture' });
});
test('ordinary output and absent status use unchanged normalizer path', () => {
  assert.deepEqual(classifyTerminal({ ...artifacts(), registrySha256: '0'.repeat(64) }), { kind: 'not_terminal' });
  for (const pipelineStatus of [null, {}, { detail: { outcome: 'low_quality_footage' } }])
    assert.deepEqual(classifyTerminal({ ...fixture(), pipelineStatus }), { kind: 'not_terminal' });
});
test('real numeric written_at with outcome ok continues to normalization', () => {
  const a = artifacts();
  assert.deepEqual(a.pipelineStatus, { status: 'complete', detail: { outcome: 'ok' }, written_at: 1700000000.5 });
  assert.deepEqual(classifyTerminal({ ...a, registrySha256: '0'.repeat(64) }), { kind: 'not_terminal' });
});
test('real numeric written_at with genuine early stop verifies', () => {
  const a = fixture();
  assert.equal(obj(a.pipelineStatus).written_at, 1700000000.5);
  assert.equal(classifyTerminal(a).kind, 'verified_terminal');
});
for (const outcome of ['ok', 'low_quality_footage']) {
  for (const written_at of ['1700000000.5', NaN, Infinity, -Infinity, null, undefined]) {
    test(`${outcome} rejects present nonnumeric or nonfinite written_at ${String(written_at)}`, () => {
      const a = fixture(); Object.assign(obj(a.pipelineStatus), { detail: { outcome }, written_at });
      assert.deepEqual(classifyTerminal(a), { kind: 'terminal_rejected', code: 'terminal_status_malformed' });
    });
  }
}
const cases: [string, (a: TerminalInput) => void, string][] = [
  ['unsupported outcome', a => { obj(a.pipelineStatus).detail.outcome = 'future'; }, 'terminal_outcome_unsupported'],
  ['status key', a => { obj(a.pipelineStatus).extra = true; }, 'terminal_status_malformed'],
  ['detail key', a => { obj(a.pipelineStatus).detail.extra = true; }, 'terminal_status_malformed'],
  ['crashed', a => { obj(a.pipelineStatus).status = 'crashed'; }, 'terminal_status_malformed'],
  ['missing map', a => { a.frameMapJson = null; }, 'terminal_frame_map_missing'],
  ['missing manifest', a => { a.manifest = null; }, 'terminal_manifest_missing'],
  ['exact map bytes', a => { a.frameMapJson += ' '; }, 'terminal_frame_map_hash_mismatch'],
  ['engine version', a => { obj(a.manifest).engine_code_version = 'future'; }, 'terminal_version_unsupported'],
  ['instrumentation version', a => { obj(a.manifest).instrumentation_version = 'future'; }, 'terminal_version_unsupported'],
  ['registry hash', a => { a.registrySha256 = '1'.repeat(64); }, 'terminal_source_hash_mismatch'],
  ['manifest source', a => { obj(a.manifest).input_sha256 = '1'.repeat(64); }, 'terminal_source_hash_mismatch'],
  ['map source', a => mapChange(a, m => { m.input_sha256 = '1'.repeat(64); }), 'terminal_identity_mismatch'],
  ['run identity', a => mapChange(a, m => { m.run_id = 'e'.repeat(32); }), 'terminal_identity_mismatch'],
  ['attempt identity', a => mapChange(a, m => { m.attempt_number = 1; }), 'terminal_identity_mismatch'],
  ['unsafe run id', a => { obj(a.manifest).run_id = 'C:/private'; }, 'terminal_identity_mismatch'],
  ['pose frames', a => { obj(a.pose2d).frames = [{ frame: 0 }]; }, 'terminal_artifacts_inconsistent'],
  ['bat frames', a => { obj(a.batPath).frames = [{ frame: 0 }]; }, 'terminal_artifacts_inconsistent'],
  ['phases', a => { obj(a.metrics).phases = {}; }, 'terminal_artifacts_inconsistent'],
  ['contact', a => { obj(a.metrics).contact = {}; }, 'terminal_artifacts_inconsistent'],
  ['metrics count', a => { obj(a.metrics).n_frames = 120; }, 'terminal_artifacts_inconsistent'],
  ['decoded count', a => mapChange(a, m => { m.attempt_history[0].analysis_timing.decoded_frames = 119; }), 'terminal_artifacts_inconsistent'],
  ['history absent', a => mapChange(a, m => { delete m.attempt_history; }), 'terminal_artifacts_inconsistent'],
  ['map verified', a => mapChange(a, m => { m.verified = true; }), 'terminal_artifacts_inconsistent'],
  ['map frames', a => mapChange(a, m => { m.frames = [{}]; }), 'terminal_artifacts_inconsistent'],
  ['map status', a => mapChange(a, m => { m.status = 'verified'; }), 'terminal_artifacts_inconsistent'],
  ['map reason', a => mapChange(a, m => { m.reasons = []; }), 'terminal_artifacts_inconsistent'],
  ['pose count', a => { obj(a.manifest).pose_decoded_frames = 1; }, 'terminal_artifacts_inconsistent'],
  ['bat count', a => { obj(a.manifest).bat_decoded_frames = 1; }, 'terminal_artifacts_inconsistent'],
  ['meta mismatch', a => { obj(a.batPath).meta.width = 640; }, 'terminal_artifacts_inconsistent'],
  ['invalid meta', a => { obj(a.pose2d).meta.fps = obj(a.batPath).meta.fps = 0; }, 'terminal_artifacts_inconsistent'],
  ['invalid map JSON', a => { a.frameMapJson = '{'; obj(a.manifest).frame_map_sha256 = sha256('{'); }, 'terminal_artifacts_inconsistent'],
  ['non-string verification', a => { obj(a.manifest).environment_verification = ['verified']; }, 'terminal_artifacts_inconsistent'],
  ['unsafe environment', a => { obj(a.manifest).environment_version = 'C:/private'; }, 'terminal_artifacts_inconsistent'],
];
for (const [name, mutate, code] of cases) test(`terminal rejects ${name}`, () => {
  const a = fixture(); mutate(a); assert.deepEqual(classifyTerminal(a), { kind: 'terminal_rejected', code });
});
test('first failure precedence is deterministic', () => {
  const a = fixture(); a.frameMapJson = null; a.manifest = null;
  assert.deepEqual(classifyTerminal(a), { kind: 'terminal_rejected', code: 'terminal_frame_map_missing' });
});
