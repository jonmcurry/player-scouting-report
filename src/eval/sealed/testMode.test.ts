import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile, writeFile, readdir, rm, mkdir, symlink } from 'node:fs/promises';
import { join } from 'node:path';
import { runSealedTest } from './testMode.ts';
import { scanSealed } from './scan.ts';
import { sealedWritePath } from './paths.ts';
import { setup, membership, clock, tempRoot, cleanup } from './testing/fixtures.ts';
import { runBenchmark } from '../benchmark/runner.ts';
import { repoRoot, registryClip, FakeEngineAdapter } from '../benchmark/testing/fixtures.ts';
import { canonicalJson, sha256 } from '../benchmark/registry.ts';
import { assessEnforceability } from '../../services/development/evidence/enforceability.ts';
test('synthetic sealed run encrypts once, logs once, cleans plaintext, disables cache, never qualifies as sealed evidence', async () => {
  const s = await setup();
  try {
    const result = await runSealedTest(s.options); assert.equal(s.adapter.calls, 1);
    assert.deepEqual(await readdir(join(s.root, 'sealed/results')), [result.run_id + '.tar.age']);
    assert.deepEqual(await readdir(join(s.root, 'results', result.run_id)), ['run.json']);
    assert.equal((await readFile(join(s.root, 'registry/test-access.jsonl'), 'utf8')).trim().split('\n').length, 1);
    const encrypted = await readFile(join(s.root, 'sealed/results', result.run_id + '.tar.age'));
    assert.equal(encrypted.subarray(0, 9).toString(), 'TEST-ONLY');
    const tar = Buffer.from(encrypted.subarray(9).map(b => b ^ 0xa5)); assert.ok(tar.includes(Buffer.from(s.clip.eval_id)));
    await assert.rejects(readdir(join(s.sealed, 'results', result.run_id)), { code: 'ENOENT' });
    for (const name of ['cache', 'work']) await assert.rejects(readdir(join(s.root, name)), { code: 'ENOENT' });
    assert.equal((await scanSealed(s.root, membership())).clean, true);
    assert.ok((await assessEnforceability({ sealedTest: result })).missing.includes('production:sealed_test_missing'));
    assert.ok(!('passed' in result)); assert.ok(!('sealedTest' in result));
    // Re-execution is counted even when exclusive export refuses existing artifacts.
    await assert.rejects(runSealedTest(s.options), { code: 'EEXIST' });
    const lines = (await readFile(join(s.root, 'registry/test-access.jsonl'), 'utf8')).trim().split('\n');
    assert.equal(lines.length, 2); assert.equal(sha256(lines[0]!), result.access_record_sha256);
    assert.equal(JSON.parse(lines[1]!).previous_line_sha256, result.access_record_sha256);
    const aggregate = JSON.parse(await readFile(join(s.root, 'results', result.run_id, 'run.json'), 'utf8'));
    assert.equal(JSON.parse(lines[0]!).config_sha256, aggregate.config_sha256);
    assert.equal(JSON.parse(lines[0]!).config_sha256, JSON.parse(lines[1]!).config_sha256);
    assert.ok(!('run_id' in JSON.parse(lines[0]!)));
    await writeFile(join(s.root, 'planted-failure.jsonl'), canonicalJson({ eval_id: s.clip.eval_id }));
    assert.equal((await scanSealed(s.root, membership())).clean, false);
  } finally { await s.cleanup(); }
});
for (const mode of ['environment', 'candidate', 'relative', 'repository', 'evalroot', 'missingroot', 'registry', 'media', 'annotations', 'membership', 'mismatch', 'leak-id', 'leak-source', 'leak-group', 'encryptor', 'operator', 'clock', 'chain'] as const) test(`precondition ${mode} refuses before any adapter call`, async () => {
  const s = await setup(); let preflights = 0; s.adapter.preflight = async () => { preflights++; return s.adapter.facts; };
  try {
    let code = '';
    if (mode === 'environment') { s.options.env.HITTERLOOP_SEALED_ENVIRONMENT = '0'; code = 'SEALED_ENVIRONMENT_REQUIRED'; }
    if (mode === 'candidate') { s.options.releaseCandidate = 'different'; code = 'RELEASE_CANDIDATE_MISMATCH'; }
    if (['relative', 'repository', 'evalroot', 'missingroot'].includes(mode)) {
      s.options.sealedRoot = { relative: 'relative', repository: repoRoot, evalroot: s.root, missingroot: join(s.sealed, 'missing') }[mode as 'relative']!; code = 'SEALED_ROOT_PLACEMENT';
    }
    if (['registry', 'media', 'annotations'].includes(mode)) { await rm(join(s.sealed, mode === 'registry' ? 'registry-test.jsonl' : mode), { recursive: true }); code = 'SEALED_INPUT_MISSING'; }
    if (mode === 'membership') { await writeFile(join(s.root, 'registry/test-membership.json'), '{}'); code = 'MEMBERSHIP_INVALID_SCHEMA'; }
    if (mode === 'mismatch') { await writeFile(join(s.sealed, 'registry-test.jsonl'), '{"registry_version":1}\n'); code = 'TEST_MEMBERSHIP_MISMATCH'; }
    if (mode.startsWith('leak-')) {
      const clip = { ...registryClip('eval_0000000000000002', 'a'.repeat(64)), athlete_group: 'group-00000002' };
      if (mode === 'leak-id') { clip.eval_id = s.clip.eval_id; code = 'TEST_EVAL_ID_IN_CLEAR_REGISTRY'; }
      if (mode === 'leak-source') { clip.sha256 = s.clip.sha256; code = 'TEST_SOURCE_IN_CLEAR_REGISTRY'; }
      if (mode === 'leak-group') { clip.athlete_group = s.clip.athlete_group; code = 'TEST_ATHLETE_GROUP_IN_CLEAR_REGISTRY'; }
      await writeFile(join(s.root, 'registry/clips.jsonl'), [{ registry_version: 1 }, clip].map(canonicalJson).join('\n'));
    }
    if (mode === 'encryptor') { Object.assign(s.options, { encryptor: null }); code = 'ENCRYPTOR_REQUIRED'; }
    if (mode === 'operator') { s.options.operator = 'bad'; code = 'ACCESS_INVALID_FIELDS'; }
    if (mode === 'clock') { s.options.now = () => 'bad'; code = 'ACCESS_INVALID_FIELDS'; }
    if (mode === 'chain') { await writeFile(join(s.root, 'registry/test-access.jsonl'), 'broken'); code = 'ACCESS_LOG_CHAIN_BROKEN'; }
    await assert.rejects(runSealedTest(s.options), { message: code }); assert.equal(s.adapter.calls, 0); assert.equal(preflights, 0);
  } finally { await s.cleanup(); }
});
test('encryption failure never publishes plaintext and cleans completed private results', async () => {
  const s = await setup();
  try { s.options.encryptor.encrypt = async () => { throw new Error('AGE_UNAVAILABLE'); };
    await assert.rejects(runSealedTest(s.options), { message: 'AGE_UNAVAILABLE' });
    await assert.rejects(readdir(join(s.root, 'results')), { code: 'ENOENT' });
    assert.equal((await readFile(join(s.root, 'registry/test-access.jsonl'), 'utf8')).trim().split('\n').length, 1);
    assert.deepEqual(await readdir(join(s.sealed, 'results')), ['.work']);
    assert.equal((await scanSealed(s.root, membership())).clean, true);
  } finally { await s.cleanup(); }
});
test('outside sealed write path and symlink refused', async () => {
  const s = await setup();
  try {
    await assert.rejects(sealedWritePath(s.sealed, join(s.root, 'unsafe')), { message: 'UNENCRYPTED_PER_CLIP_WRITE_REFUSED' });
    await symlink(s.root, join(s.sealed, 'redirect'), 'junction');
    await assert.rejects(runSealedTest(s.options), { message: 'SEALED_SYMLINK_REFUSED' }); assert.equal(s.adapter.calls, 0);
  } finally { await s.cleanup(); }
});
test('runner rejects sealed output outside root and ordinary test split', async () => {
  const s = await setup();
  try {
    const options = { evalRoot: s.root, repoRoot, engine: s.adapter.engineVersion, split: 'test' as const };
    await assert.rejects(runBenchmark(options, s.adapter), { message: 'TEST_SPLIT_REQUIRES_SEALED_ENVIRONMENT' });
    await assert.rejects(runBenchmark({ ...options, sealed: { dataRoot: s.sealed, outputRoot: s.root, env: s.options.env } }, s.adapter), { message: 'UNENCRYPTED_PER_CLIP_WRITE_REFUSED' });
    assert.equal(s.adapter.calls, 0);
  } finally { await s.cleanup(); }
});
test('pre-change dev run identity and result bytes remain identical', async () => {
  const root = await tempRoot();
  try {
    await mkdir(join(root, 'registry'));
    await writeFile(join(root, 'registry/clips.jsonl'), [{ registry_version: 1 }, { ...registryClip(), status: 'withdrawn' }].map(v => JSON.stringify(v)).join('\n') + '\n');
    const r = await runBenchmark({ evalRoot: root, repoRoot, engine: 'engine-baseline-1.0.0', split: 'dev' }, new FakeEngineAdapter(), { now: clock });
    assert.equal(r.run_id, 'run-866327c44da4ae90'); assert.equal(r.results_digest, 'cf61864114028c8709c2c20bdf593f3aa1ee395cbff054cdc56c8ad4f39089c3');
    assert.equal(await readFile(join(root, 'results', r.run_id, 'per_clip.jsonl'), 'utf8'), '{"eval_id":"eval_0000000000000001","exclusion":"withdrawn","schema":"hitterloop.benchmark-clip","schema_version":"1.0.0","status":"excluded"}\n');
    assert.equal(await readFile(join(root, 'results', r.run_id, 'run.json'), 'utf8'), canonicalJson(r) + '\n');
  } finally { await cleanup(root); }
});

test('aggregate leakage refuses export before encrypted or clear publication', async () => {
  const s = await setup();
  try {
    s.adapter.facts.environment_capture_boundary = 'engine_runtime_inherited_omp';
    // A valid-format preflight hash can still equal a test source hash.
    s.adapter.facts.models_lock_sha256 = s.clip.sha256;
    await assert.rejects(runSealedTest(s.options), { message: 'AGGREGATE_LEAKAGE_REFUSED' });
    await assert.rejects(readdir(join(s.root, 'results')), { code: 'ENOENT' });
    assert.equal((await scanSealed(s.root, membership())).clean, true);
  } finally { await s.cleanup(); }
});
test('adapter returning an external artifact directory is a fatal sealed write refusal', async () => {
  const s = await setup();
  try {
    const original = s.adapter.run.bind(s.adapter);
    s.adapter.run = async (input, path) => ({ ...await original(input, path), dir: s.root });
    await assert.rejects(runSealedTest(s.options), { message: 'UNENCRYPTED_PER_CLIP_WRITE_REFUSED' });
    assert.equal((await scanSealed(s.root, membership())).clean, true);
  } finally { await s.cleanup(); }
});
test('identity encryptor cannot export a plaintext tar', async () => {
  const s = await setup();
  try {
    s.options.encryptor.encrypt = async bytes => Buffer.from(bytes);
    await assert.rejects(runSealedTest(s.options), { message: 'ENCRYPTION_FAILED' });
    await assert.rejects(readdir(join(s.root, 'sealed')), { code: 'ENOENT' });
  } finally { await s.cleanup(); }
});

test('opaque operator metadata cannot carry a test identifier into the access log', async () => {
  const s = await setup();
  try {
    s.options.operator = s.clip.eval_id;
    await assert.rejects(runSealedTest(s.options), { message: 'AGGREGATE_LEAKAGE_REFUSED' });
    assert.equal(s.adapter.calls, 0);
    await assert.rejects(readFile(join(s.root, 'registry/test-access.jsonl')), { code: 'ENOENT' });
  } finally { await s.cleanup(); }
});

for (const phase of ['preflight', 'run'] as const) test(`sealed ${phase} exception preserves exactly one access before execution and exports nothing`, async () => {
  const s = await setup();
  try {
    const fail = async () => {
      const lines = (await readFile(join(s.root, 'registry/test-access.jsonl'), 'utf8')).trim().split('\n');
      assert.equal(lines.length, 1);
      const record = JSON.parse(lines[0]!);
      assert.equal(record.operator, s.options.operator); assert.equal(record.at, clock());
      assert.equal(record.membership_digest, membership().digest);
      assert.equal(record.config_sha256, sha256(canonicalJson({ engine: s.adapter.engineVersion, split: 'test', repeat: 1,
        clips: null, cache: false, allow_dirty: false, allow_unverified_environment: false, release_candidate: true })));
      throw new Error('SYNTHETIC_ABORT');
    };
    if (phase === 'preflight') s.adapter.preflight = fail;
    else {
      const original = s.adapter.run.bind(s.adapter);
      s.adapter.run = async (input, path) => { await original(input, path); return fail(); };
    }
    await assert.rejects(runSealedTest(s.options), { message: phase === 'run' ? 'ENGINE_EXECUTION_FAILED' : 'SYNTHETIC_ABORT' });
    assert.equal((await readFile(join(s.root, 'registry/test-access.jsonl'), 'utf8')).trim().split('\n').length, 1);
    for (const directory of ['sealed', 'results']) await assert.rejects(readdir(join(s.root, directory)), { code: 'ENOENT' });
    assert.equal((await scanSealed(s.root, membership())).clean, true);
  } finally { await s.cleanup(); }
});
test('direct sealed runner refuses absent attestation before filesystem or adapter access', async () => {
  const adapter = new FakeEngineAdapter(); let preflights = 0;
  adapter.preflight = async () => { preflights++; return adapter.facts; };
  for (const env of [undefined, {}, { HITTERLOOP_SEALED_ENVIRONMENT: '0' }]) {
    await assert.rejects(runBenchmark({ evalRoot: '', repoRoot: '', engine: adapter.engineVersion, split: 'test',
      sealed: { dataRoot: '', outputRoot: '', env } }, adapter), { message: 'SEALED_ENVIRONMENT_REQUIRED' });
  }
  assert.equal(adapter.calls, 0); assert.equal(preflights, 0);
});

test('two completed executions each have their own linked access record', async () => {
  const s = await setup();
  try {
    const first = await runSealedTest(s.options);
    s.adapter.facts.git_commit = 'e'.repeat(40);
    const second = await runSealedTest(s.options);
    assert.notEqual(first.run_id, second.run_id);
    assert.notEqual(first.access_record_sha256, second.access_record_sha256);
    const lines = (await readFile(join(s.root, 'registry/test-access.jsonl'), 'utf8')).trim().split('\n');
    assert.equal(lines.length, 2);
    assert.equal(sha256(lines[0]!), first.access_record_sha256);
    assert.equal(sha256(lines[1]!), second.access_record_sha256);
    assert.equal(JSON.parse(lines[1]!).previous_line_sha256, first.access_record_sha256);
    assert.equal((await readdir(join(s.root, 'sealed/results'))).length, 2);
    assert.equal(s.adapter.calls, 2);
  } finally { await s.cleanup(); }
});

test('direct sealed runner refuses every supplied repeat before adapter calls', async () => {
  const s = await setup(); let preflights = 0;
  s.adapter.preflight = async () => { preflights++; return s.adapter.facts; };
  try {
    for (const repeat of [0, 1, 2, 3]) {
      await assert.rejects(runBenchmark({ evalRoot: s.root, repoRoot, engine: s.adapter.engineVersion,
        split: 'test', repeat, sealed: { dataRoot: s.sealed, outputRoot: join(s.sealed, 'results'), env: s.options.env } },
      s.adapter), { message: 'SEALED_OPTION_REFUSED' });
    }
    assert.equal(s.adapter.calls, 0); assert.equal(preflights, 0);
  } finally { await s.cleanup(); }
});
