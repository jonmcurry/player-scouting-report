import test from 'node:test';
import assert from 'node:assert/strict';
import { BaselineAdapter, BASELINE_TREE, enforcePreflight, type PreflightChecks } from './engineAdapter.ts';
import { readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { sha256 } from './registry.ts';
import { preflightFacts, repoRoot, tempRoot, cleanup } from './testing/fixtures.ts';
const ctx = { repoRoot, split: 'dev' as const, allowDirty: false, allowUnverifiedEnvironment: false };
const checks = (dirty = false, verified = true): PreflightChecks => ({
  git: async () => ({ dirty, commit: 'a'.repeat(40) }), baseline: async () => true,
  locks: async () => ({ models_lock_sha256: 'b'.repeat(64), requirements_lock_sha256: 'c'.repeat(64),
    environment_lock_models_sha256: preflightFacts().environment_lock_models_sha256,
    environment_lock_requirements_sha256: preflightFacts().environment_lock_requirements_sha256 }),
  environment: async () => ({ verified, version: verified ? 'env-0123456789ab' : null }),
});
test('BaselineAdapter injected preflight never starts a process or engine', async () => {
  let spawned = 0;
  const adapter = new BaselineAdapter(repoRoot, async () => { spawned++; throw new Error('FORBIDDEN_SPAWN'); }, checks());
  assert.equal((await adapter.preflight(ctx)).baseline_tree, BASELINE_TREE); assert.equal(spawned, 0);
});
for (const mode of ['dirty', 'environment'] as const) test(`preflight refuses ${mode}; dev-only override`, async () => {
  const adapter = new BaselineAdapter(repoRoot, async () => { throw new Error('FORBIDDEN_SPAWN'); }, checks(mode === 'dirty', mode !== 'environment'));
  await assert.rejects(adapter.preflight(ctx), { message: mode === 'dirty' ? 'DIRTY_TREE' : 'ENVIRONMENT_UNVERIFIED' });
  const override = { ...ctx, allowDirty: true, allowUnverifiedEnvironment: true };
  const facts = await adapter.preflight(override);
  assert.equal(facts.dirty, mode === 'dirty'); assert.equal(facts.environment_verified, mode !== 'environment');
  await assert.rejects(adapter.preflight({ ...override, split: 'validation' }));
});
test('default preflight checks issue exact read-only commands and parse the registered runtime environment identity', async () => {
  const runEnv = async (env: { code: number; stdout: string }) => {
    const calls: { command: string; args: string[] }[] = [];
    const adapter = new BaselineAdapter(repoRoot, async (command, args) => {
      calls.push({ command, args });
      if (command === 'git') return { code: 0, stdout: args[0] === 'status' ? '' : 'a'.repeat(40) + '\n' };
      if (args[0] === 'scripts/check-baseline-tree.mjs') return { code: 0, stdout: '' };
      if (args[0] === '-B' && args[1] === '-c') return env;
      throw new Error('FORBIDDEN_SPAWN');
    });
    return { calls, result: adapter.preflight(ctx) };
  };
  const ok = await runEnv({ code: 0, stdout: 'env-9a6a8510dec8\n' });
  const facts = await ok.result;
  assert.equal(facts.environment_verified, true); assert.equal(facts.environment_version, 'env-9a6a8510dec8');
  assert.equal(facts.environment_capture_boundary, 'engine_runtime_inherited_omp');
  assert.match(facts.models_lock_sha256, /^[a-f0-9]{64}$/); assert.match(facts.requirements_lock_sha256, /^[a-f0-9]{64}$/);
  const lockDirectory = join(repoRoot, 'src/eval/environment/locks/env-9a6a8510dec8');
  assert.equal(facts.environment_lock_models_sha256, sha256(await readFile(join(lockDirectory, 'models.lock.json'))));
  assert.equal(facts.environment_lock_requirements_sha256, sha256(await readFile(join(lockDirectory, 'requirements.lock.txt'))));
  assert.equal(facts.environment_lock_models_sha256, '15a970e7af4833a3da2988c670ecf3eb89e099f9ee200bf76f5b2f3fa0affaf8');
  assert.equal(facts.environment_lock_requirements_sha256, '4be180910788d1c43088b08f896457c05e59c8a0f8998a0a9e974807222a82d6');
  assert.equal(facts.models_lock_sha256, sha256(await readFile(join(repoRoot, 'src/eval/environment/models.lock.json'))));
  assert.equal(facts.requirements_lock_sha256, sha256(await readFile(join(repoRoot, 'src/eval/environment/requirements.lock.txt'))));
  assert.deepEqual(ok.calls.slice(0, 3).map(c => [c.command, ...c.args]), [['git', 'status', '--porcelain'], ['git', 'rev-parse', 'HEAD'], [process.execPath, 'scripts/check-baseline-tree.mjs']]);
  const script = ok.calls[3]!.args[2]!;
  assert.match(script, /from capture_environment import capture,environment_version/);
  assert.ok(script.includes('locks=root/"src/eval/environment/locks/env-9a6a8510dec8"'));
  assert.ok(script.includes('sys.exit(1) if actual != expected else None'));
  assert.equal(script.match(/read_text\(encoding="utf-8"\)/g)?.length, 2);
  assert.doesNotMatch(script, /write|open\(|install|pip install|mkdir/);
  assert.ok(!ok.calls.some(c => c.args.some(a => a.includes('run_pipeline.py'))));
  for (const env of [{ code: 1, stdout: 'env-0123456789ab' }, { code: 0, stdout: 'not-an-identity' },
    { code: 0, stdout: 'env-000000000000' }, { code: 0, stdout: 'env-f4ad5b330d0c' }])
    await assert.rejects((await runEnv(env)).result, { message: 'ENVIRONMENT_UNVERIFIED' });
});
test('BaselineAdapter.run follows the pipeline_status contract (spawn spy, no engine)', async () => {
  const root = await tempRoot();
  try {
    const media = join(root, 'clip.mp4'); await writeFile(media, 'synthetic');
    const input = { evalId: 'eval_0000000000000001', mediaPath: media, sha256: sha256('synthetic') };
    const adapter = (status: string | null, code: number) => new BaselineAdapter(repoRoot, async (_command, args, _cwd, env) => {
      assert.ok(args[0]!.endsWith(join('scripts', 'pose3d', 'run_pipeline.py'))); assert.equal(env?.PYTHONUNBUFFERED, '1');
      if (status) await writeFile(join(args[2]!, 'pipeline_status.json'), JSON.stringify({ status }));
      return { code, stdout: '' };
    }, checks());
    const done = await adapter('complete', 1).run(input, join(root, 'a'));
    assert.match(done.files['pipeline_status.json']!.sha256, /^[a-f0-9]{64}$/); assert.equal(done.files['pose_2d.json'], null);
    await assert.rejects(adapter('crashed', 0).run(input, join(root, 'b')), { message: 'PIPELINE_FAILED' });
    await assert.rejects(adapter(null, 0).run(input, join(root, 'c')), { message: 'PIPELINE_STATUS_UNAVAILABLE' });
    await assert.rejects(adapter('complete', 0).run(input, join(root, 'a')));
    await assert.rejects(adapter('complete', 0).run({ ...input, sha256: 'f'.repeat(64) }, join(root, 'd')), { message: 'media_hash_mismatch' });
  } finally { await cleanup(root); }
});
test('baseline and lock integrity fail closed', () => {
  assert.throws(() => enforcePreflight({ ...preflightFacts(), baseline_verified: false }, ctx), { message: 'BASELINE_TREE_UNVERIFIED' });
  assert.throws(() => enforcePreflight({ ...preflightFacts(), models_lock_sha256: '' }, ctx), { message: 'LOCK_IDENTITY_UNAVAILABLE' });
});

test('default capture inherits preset OMP and defaults only absent or empty values', async () => {
  const original = process.env.OMP_NUM_THREADS;
  try {
    for (const preset of [undefined, '', '4']) {
      if (preset === undefined) delete process.env.OMP_NUM_THREADS;
      else process.env.OMP_NUM_THREADS = preset;
      const { environment: _environment, ...otherChecks } = checks();
      let calls = 0;
      const adapter = new BaselineAdapter(repoRoot, async (_command, args, _cwd, env) => {
        calls++;
        assert.deepEqual(args.slice(0, 2), ['-B', '-c']);
        assert.equal(env?.OMP_NUM_THREADS, preset || '1');
        assert.equal(env?.PYTHONDONTWRITEBYTECODE, '1');
        assert.equal(env?.PATH, process.env.PATH);
        return { code: preset === '4' ? 1 : 0, stdout: 'env-9a6a8510dec8' };
      }, otherChecks);
      if (preset === '4') await assert.rejects(adapter.preflight(ctx), { message: 'ENVIRONMENT_UNVERIFIED' });
      else assert.equal((await adapter.preflight(ctx)).environment_verified, true);
      assert.equal(calls, 1);
      assert.equal(process.env.OMP_NUM_THREADS, preset);
    }
  } finally {
    if (original === undefined) delete process.env.OMP_NUM_THREADS;
    else process.env.OMP_NUM_THREADS = original;
  }
});

test('verified preflight requires the exact engine runtime capture boundary even with dev override', () => {
  for (const boundary of [undefined, '', 'fresh_process']) {
    const facts = { ...preflightFacts(), environment_capture_boundary: boundary } as ReturnType<typeof preflightFacts>;
    assert.throws(() => enforcePreflight(facts, ctx), { message: 'ENVIRONMENT_UNVERIFIED' });
    assert.throws(() => enforcePreflight(facts, { ...ctx, allowUnverifiedEnvironment: true }), { message: 'ENVIRONMENT_UNVERIFIED' });
  }
});

for (const key of ['environment_lock_models_sha256', 'environment_lock_requirements_sha256'] as const) {
  test(`verified preflight requires a valid ${key}, including with dev override`, () => {
    for (const value of [undefined, '', 'g'.repeat(64), 'a'.repeat(63), 'a'.repeat(65)]) {
      const facts = { ...preflightFacts(), [key]: value } as ReturnType<typeof preflightFacts>;
      assert.throws(() => enforcePreflight(facts, ctx), { message: 'ENVIRONMENT_UNVERIFIED' });
      const override = { ...ctx, allowUnverifiedEnvironment: true };
      assert.throws(() => enforcePreflight(facts, override), { message: 'ENVIRONMENT_UNVERIFIED' });
      const unverified = { ...facts, environment_verified: false, environment_version: null };
      assert.equal(enforcePreflight(unverified, override), unverified);
    }
    const missing = { ...preflightFacts() } as Partial<ReturnType<typeof preflightFacts>>;
    delete missing[key];
    assert.throws(() => enforcePreflight(missing as ReturnType<typeof preflightFacts>, ctx), { message: 'ENVIRONMENT_UNVERIFIED' });
  });
}
