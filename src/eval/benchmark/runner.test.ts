import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdir, writeFile, readFile, readdir, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { runBenchmark, cacheKey, type BenchmarkOptions } from './runner.ts';
import { sha256, canonicalJson } from './registry.ts';
import { ENGINE_VERSION, BASELINE_TREE } from './engineAdapter.ts';
import { normalizeEngineOutputDirectory } from '../normalize/engineObservations.ts';
import { COVERAGE_DEFINITIONS, preregistrationDigest, type CoveragePreregistration } from '../calibrate/preregistration.ts';
import { INITIAL_EVIDENCE_TUPLE, ENGINE_RUNTIME_EVIDENCE_TUPLE } from '../../services/development/evidenceRegistry.ts';
import { terminalArtifacts, annotationFixture, registryClip, FakeEngineAdapter, tempRoot, cleanup, writeAnnotation, repoRoot } from './testing/fixtures.ts';

async function setup(count = 1) {
  const root = await tempRoot(); await mkdir(join(root, 'registry')); await mkdir(join(root, 'media'));
  const clips: ReturnType<typeof registryClip>[] = [];
  for (let i = 1; i <= count; i++) {
    const id = `eval_${i.toString(16).padStart(16, '0')}`, media = `synthetic-${i}`, clip = registryClip(id, sha256(media));
    const annotation = await annotationFixture(); annotation.eval_clip_id = id; annotation.source.sha256 = clip.sha256;
    await writeAnnotation(root, annotation); await writeFile(join(root, 'media', id + '.mp4'), media); clips.push(clip);
  }
  const registry = async (reverse = false) => writeFile(join(root, 'registry/clips.jsonl'), [{ registry_version: 1 }, ...(reverse ? [...clips].reverse() : clips)].map(v => JSON.stringify(v)).join('\n') + '\n');
  await registry();
  const options: BenchmarkOptions = { evalRoot: root, repoRoot, engine: ENGINE_VERSION, split: 'dev' };
  return { root, clips, registry, options, adapter: new FakeEngineAdapter() };
}
async function records(root: string, runId: string) {
  const text = await readFile(join(root, 'results', runId, 'per_clip.jsonl'), 'utf8');
  return text.trim().split('\n').filter(Boolean).map(line => JSON.parse(line));
}
async function removeResults(root: string) { await rm(join(root, 'results'), { recursive: true, force: true }); }
test('deterministic run, bytes/digest exclude timing; cache hit; result overwrite refused', async () => {
  const s = await setup();
  try {
    const a = await runBenchmark(s.options, s.adapter, { now: () => '2026-01-01T00:00:00Z' });
    const before = await readFile(join(s.root, 'results', a.run_id, 'per_clip.jsonl'));
    assert.equal((await records(s.root, a.run_id))[0].status, 'paired'); assert.equal(s.adapter.calls, 1);
    const { timing: _timing, results_digest, ...without } = a;
    assert.equal(results_digest, sha256(canonicalJson(without) + before.toString() + await readFile(join(s.root, 'results', a.run_id, 'failures.jsonl'), 'utf8')));
    await assert.rejects(runBenchmark(s.options, s.adapter), { message: 'RESULT_ALREADY_EXISTS' });
    await removeResults(s.root);
    const b = await runBenchmark(s.options, s.adapter, { now: () => '2026-01-02T00:00:00Z' });
    assert.equal(a.run_id, b.run_id); assert.equal(a.results_digest, b.results_digest); assert.notDeepEqual(a.timing, b.timing);
    assert.deepEqual(await readFile(join(s.root, 'results', b.run_id, 'per_clip.jsonl')), before); assert.equal(s.adapter.calls, 1);
  } finally { await cleanup(s.root); }
});
test('registry and --clips ordering independence', async () => {
  const s = await setup(2);
  try {
    const a = await runBenchmark({ ...s.options, clips: s.clips.map(c => c.eval_id) }, s.adapter);
    const before = await records(s.root, a.run_id); await removeResults(s.root); await s.registry(true);
    const b = await runBenchmark({ ...s.options, clips: s.clips.map(c => c.eval_id).reverse() }, s.adapter);
    assert.equal(a.run_id, b.run_id); assert.equal(a.results_digest, b.results_digest); assert.deepEqual(await records(s.root, b.run_id), before);
  } finally { await cleanup(s.root); }
});
test('every cache key component matters', () => {
  const c = { source_sha256: 'a', engine_version: ENGINE_VERSION, instrumentation_version: 'inst-1', baseline_tree: BASELINE_TREE,
    models_lock_sha256: 'b', requirements_lock_sha256: 'c', environment_version: 'env-0123456789ab', config_sha256: 'd' };
  for (const key of Object.keys(c)) assert.notEqual(cacheKey({ ...c, [key]: 'changed' }), cacheKey(c));
});
test('unverified environment never reads or writes the cache', async () => {
  const s = await setup();
  try {
    s.adapter.facts.environment_verified = false; s.adapter.facts.environment_version = null;
    const opts = { ...s.options, allowUnverifiedEnvironment: true };
    const a = await runBenchmark(opts, s.adapter); assert.equal(a.cache_used, false); await removeResults(s.root);
    await runBenchmark(opts, s.adapter); assert.equal(s.adapter.calls, 2);
    await assert.rejects(readdir(join(s.root, 'cache')), { code: 'ENOENT' });
  } finally { await cleanup(s.root); }
});
test('cache integrity failure reexecutes and records fixed code; no-cache always executes', async () => {
  const s = await setup();
  try {
    await runBenchmark(s.options, s.adapter); await removeResults(s.root);
    const [key] = await readdir(join(s.root, 'cache')); await writeFile(join(s.root, 'cache', key!, 'pose_2d.json'), '{}');
    const b = await runBenchmark(s.options, s.adapter); assert.equal(s.adapter.calls, 2);
    assert.match(await readFile(join(s.root, 'results', b.run_id, 'failures.jsonl'), 'utf8'), /cache_integrity_failed/);
    await removeResults(s.root); await runBenchmark({ ...s.options, cache: false }, s.adapter); assert.equal(s.adapter.calls, 3);
  } finally { await cleanup(s.root); }
});
test('repeat executes adapter N times, then cache only replaces first; PR5 summary', async () => {
  const s = await setup();
  try {
    const a = await runBenchmark({ ...s.options, repeat: 3 }, s.adapter);
    assert.equal(s.adapter.calls, 3); assert.equal(a.repeatability.comparisonCount, 2);
    const per = (await records(s.root, a.run_id))[0]; assert.equal(per.repeatability.length, 2);
    assert.equal(per.repeatability[0].provenanceVerified, false);
    assert.deepEqual(per.repeatability[0].failures, []);
    await removeResults(s.root); await runBenchmark({ ...s.options, repeat: 3 }, s.adapter); assert.equal(s.adapter.calls, 5);
  } finally { await cleanup(s.root); }
});
for (const mode of ['withdrawn', 'consent', 'media', 'annotation', 'engine', 'unbound', 'normalization', 'schema', 'normalizer'] as const) test(`runner exclusion/precondition ${mode}`, async () => {
  const s = await setup();
  try {
    if (mode === 'withdrawn') s.clips[0]!.status = 'withdrawn';
    if (mode === 'consent') s.clips[0]!.consent.eval_annotation = false;
    await s.registry();
    if (mode === 'media') await writeFile(join(s.root, 'media', s.clips[0]!.eval_id + '.mp4'), 'tampered');
    if (mode === 'annotation') { const a = await annotationFixture(); a.source.sha256 = 'b'.repeat(64); await writeAnnotation(s.root, a); }
    if (mode === 'engine') s.adapter.mutate = a => { a.manifest.input_sha256 = 'b'.repeat(64); };
    if (mode === 'unbound') s.adapter.mutate = a => { Object.assign(a.manifest, { input_sha256: null }); };
    if (mode === 'normalization') s.adapter.mutate = a => { a.metrics.pipeline_version = 'future'; };
    const result = await runBenchmark(s.options, s.adapter, { normalize: async dir => {
      const n = await normalizeEngineOutputDirectory(dir);
      if (n.ok && mode === 'schema') n.observations.schema_version = 'future';
      if (n.ok && mode === 'normalizer') n.observations.normalizer_version = 'future';
      return n;
    } });
    const p = (await records(s.root, result.run_id))[0];
    if (mode === 'unbound') { assert.equal(p.status, 'paired'); assert.ok(p.pairing.preconditions.includes('engine_source_unbound')); }
    else assert.equal(p.exclusion, { withdrawn: 'withdrawn', consent: 'consent_eval_annotation_missing', media: 'media_hash_mismatch', annotation: 'source_hash_mismatch',
      engine: 'source_hash_mismatch', normalization: 'normalization_failed:UNSUPPORTED_ENGINE_VERSION', schema: 'UNSUPPORTED_OBSERVATIONS_SCHEMA', normalizer: 'UNSUPPORTED_NORMALIZER_VERSION' }[mode]);
    if (['withdrawn', 'consent', 'media', 'annotation'].includes(mode)) assert.equal(s.adapter.calls, 0);
  } finally { await cleanup(s.root); }
});
for (const releaseCandidate of [false, true]) test(`sealed split always refused, release candidate ${releaseCandidate}`, async () => {
  await assert.rejects(runBenchmark({ evalRoot: '', repoRoot, engine: ENGINE_VERSION, split: 'test', releaseCandidate }, new FakeEngineAdapter()), { message: 'TEST_SPLIT_REQUIRES_SEALED_ENVIRONMENT' });
});
test('root, engine, repeat, selection and preflight refuse before engine', async () => {
  const s = await setup();
  try {
    for (const [change, code] of [
      [{ evalRoot: repoRoot }, 'EVAL_ROOT_INSIDE_REPOSITORY'], [{ evalRoot: 'relative' }, 'EVAL_ROOT_MUST_BE_ABSOLUTE'],
      [{ engine: 'future' }, 'UNSUPPORTED_ENGINE_VERSION'], [{ repeat: 1 }, 'INVALID_REPEAT'], [{ repeat: 2.5 }, 'INVALID_REPEAT'],
      [{ clips: ['../private'] }, 'INVALID_CLIP_SELECTION'], [{ clips: ['eval_ffffffffffffffff'] }, 'UNKNOWN_CLIP_SELECTION'],
    ] as [Partial<BenchmarkOptions>, string][]) await assert.rejects(runBenchmark({ ...s.options, ...change }, s.adapter), { message: code });
    s.adapter.facts.dirty = true; await assert.rejects(runBenchmark(s.options, s.adapter), { message: 'DIRTY_TREE' });
    s.adapter.facts.dirty = false; s.adapter.facts.environment_verified = false;
    await assert.rejects(runBenchmark(s.options, s.adapter), { message: 'ENVIRONMENT_UNVERIFIED' }); assert.equal(s.adapter.calls, 0);
    await runBenchmark({ ...s.options, allowUnverifiedEnvironment: true }, s.adapter);
  } finally { await cleanup(s.root); }
});
test('every result file excludes paths, private names, coordinates, numeric accuracy fields', async () => {
  const s = await setup();
  try {
    const result = await runBenchmark(s.options, s.adapter);
    const output = join(s.root, 'results', result.run_id);
    assert.deepEqual((await readdir(output)).sort(), ['failures.jsonl', 'per_clip.jsonl', 'run.json']);
    for (const name of await readdir(output)) {
      const content = await readFile(join(output, name), 'utf8');
      assert.doesNotMatch(content, /[A-Za-z]:[/\\]|Users|\/home\/|\.(?:mp4|mov|m4v|png|jpg)\b|Forbidden Synthetic Name/);
      assert.equal(content.includes(s.root), false);
      assert.doesNotMatch(content, /"(?:coordinates|error|delta|accuracy|rate|pass|tolerance_met|rmse|mean)":/);
    }
  } finally { await cleanup(s.root); }
});
test('missing and unadjudicated annotations exclude without execution', async () => {
  const s = await setup(2);
  try {
    const a = await annotationFixture(); a.eval_clip_id = s.clips[1]!.eval_id; a.source.sha256 = s.clips[1]!.sha256;
    await writeAnnotation(s.root, a, 'ann_0000000000000002.json');
    await rm(join(s.root, 'annotations/1.0.0', s.clips[0]!.eval_id, 'ann_0000000000000001.json'));
    const result = await runBenchmark(s.options, s.adapter);
    assert.deepEqual((await records(s.root, result.run_id)).map(p => p.exclusion), ['annotation_missing', 'annotation_unadjudicated']);
    assert.equal(s.adapter.calls, 0);
  } finally { await cleanup(s.root); }
});
test('dirty override is recorded on dev and prohibited on validation', async () => {
  const s = await setup();
  try {
    s.adapter.facts.dirty = true;
    const result = await runBenchmark({ ...s.options, allowDirty: true }, s.adapter); assert.equal(result.dirty, true);
    await assert.rejects(runBenchmark({ ...s.options, split: 'validation', allowDirty: true }, s.adapter), { message: 'DEV_OVERRIDE_ONLY' });
    await assert.rejects(runBenchmark({ ...s.options, split: 'validation', allowUnverifiedEnvironment: true }, s.adapter), { message: 'DEV_OVERRIDE_ONLY' });
  } finally { await cleanup(s.root); }
});
test('adapter exceptions cannot leak paths or names', async () => {
  const s = await setup();
  try {
    s.adapter.run = async () => { throw new Error('C:/Users/private/private.mp4'); };
    const result = await runBenchmark(s.options, s.adapter);
    assert.equal((await records(s.root, result.run_id))[0].exclusion, 'ENGINE_EXECUTION_FAILED');
  } finally { await cleanup(s.root); }
});
test('CLI refuses sealed split and suppresses unknown-argument values without spawning', async () => {
  const { main } = await import('../runBenchmark.ts');
  const prior = process.exitCode, write = process.stderr.write;
  const output: string[] = [];
  process.stderr.write = ((text: string) => { output.push(text); return true; }) as typeof process.stderr.write;
  try {
    await main(['node', 'runBenchmark', '--engine', ENGINE_VERSION, '--split', 'test', '--release-candidate']);
    assert.deepEqual(output, ['TEST_SPLIT_REQUIRES_SEALED_ENVIRONMENT\n']); output.length = 0;
    await main(['node', 'runBenchmark', '--private=C:/Users/private']); assert.deepEqual(output, ['BENCHMARK_FAILED\n']);
  } finally { process.stderr.write = write; process.exitCode = prior; }
});


test('terminal exclusions are deterministic across repeated runs, cache and registry order; normalization never called', async () => {
  const s = await setup(2);
  try {
    s.adapter.mutate = a => { Object.assign(a, terminalArtifacts(a.manifest.input_sha256)); };
    const dependencies = { normalize: async (): Promise<never> => { throw new Error('normalizer must not run'); } };
    const a = await runBenchmark(s.options, s.adapter, dependencies);
    const before = await records(s.root, a.run_id);
    assert.deepEqual(a.counts_by_exclusion_reason, { engine_terminal_low_quality_footage: 2 });
    assert.deepEqual(a.tuples, []);
    for (const p of before) {
      assert.equal(p.status, 'excluded'); assert.equal(p.exclusion, 'engine_terminal_low_quality_footage');
      assert.equal(p.terminal.outcome, 'low_quality_footage');
      assert.equal('pairing' in p, false); assert.equal('gates' in p, false);
    }
    for (const reverse of [false, true]) {
      await removeResults(s.root); await s.registry(reverse);
      const b = await runBenchmark(s.options, s.adapter, dependencies);
      assert.equal(b.run_id, a.run_id); assert.equal(b.results_digest, a.results_digest);
      assert.deepEqual(await records(s.root, b.run_id), before);
    }
    assert.equal(s.adapter.calls, 2);
  } finally { await cleanup(s.root); }
});
for (const mode of ['pose', 'phases', 'decoded', 'verified', 'frames', 'outcome', 'status'] as const)
  test(`spoofed terminal ${mode} never reaches normalization, gates or pairing`, async () => {
    const s = await setup();
    try {
      s.adapter.mutate = a => {
        const t = terminalArtifacts(a.manifest.input_sha256);
        if (mode === 'pose') Object.assign(t.pose2d, { frames: [{}] });
        if (mode === 'phases') Object.assign(t.metrics, { phases: {} });
        if (mode === 'outcome') t.pipelineStatus.detail.outcome = 'future';
        if (mode === 'status') Object.assign(t.pipelineStatus, { extra: true });
        const map = JSON.parse(t.frameMapJson);
        if (mode === 'decoded') map.attempt_history[0].analysis_timing.decoded_frames = 119;
        if (mode === 'verified') map.verified = true;
        if (mode === 'frames') map.frames = [{}];
        t.frameMapJson = JSON.stringify(map); t.manifest.frame_map_sha256 = sha256(t.frameMapJson);
        Object.assign(a, t);
      };
      const r = await runBenchmark(s.options, s.adapter, { normalize: async (): Promise<never> => { throw new Error('must not normalize'); } });
      const p = (await records(s.root, r.run_id))[0];
      const code = mode === 'outcome' ? 'terminal_outcome_unsupported' : mode === 'status' ? 'terminal_status_malformed' : 'terminal_artifacts_inconsistent';
      assert.equal(p.exclusion, code); assert.deepEqual(r.counts_by_exclusion_reason, { [code]: 1 });
      assert.equal('pairing' in p, false); assert.equal('gates' in p, false); assert.equal('terminal' in p, false);
    } finally { await cleanup(s.root); }
  });
test('ordinary ok clip with real numeric timestamp status is paired, not excluded', async () => {
  const s = await setup();
  try {
    s.adapter.mutate = a => {
      assert.deepEqual(a.pipelineStatus, { status: 'complete', detail: { outcome: 'ok' }, written_at: 1700000000.5 });
    };
    const r = await runBenchmark(s.options, s.adapter);
    const p = (await records(s.root, r.run_id))[0];
    assert.equal(s.adapter.calls, 1);
    assert.equal(p.status, 'paired');
    assert.ok(p.pairing);
    assert.equal('exclusion' in p, false);
    assert.equal('terminal' in p, false);
    assert.deepEqual(r.counts_by_exclusion_reason, {});
  } finally { await cleanup(s.root); }
});
test('ordinary ok output with mismatched frame count still fails PR11 normalization', async () => {
  const s = await setup();
  try {
    s.adapter.mutate = a => { a.pose2d.frames = []; };
    const r = await runBenchmark(s.options, s.adapter);
    assert.equal((await records(s.root, r.run_id))[0].exclusion, 'normalization_failed:MALFORMED_ARTIFACT');
  } finally { await cleanup(s.root); }
});

// PR17 owner exception: coverage pre-registration bound into the run identity before execution.
async function writePolicy(root: string, mutate: (p: CoveragePreregistration) => void = () => {}) {
  const p: CoveragePreregistration = { schema: 'hitterloop.coverage-preregistration', schema_version: '1.0.0',
    policy_id: 'synthetic-policy', tuple: { ...ENGINE_RUNTIME_EVIDENCE_TUPLE }, definitions: { ...COVERAGE_DEFINITIONS },
    minimum_measurable_coverage: 0.5, registered_at: '2025-12-31T00:00:00.000Z', approved_by: 'reviewer-test', digest: '' };
  mutate(p); p.digest = preregistrationDigest(p);
  await mkdir(join(root, 'preregistration'), { recursive: true });
  await writeFile(join(root, 'preregistration', 'policy.json'), JSON.stringify(p)); return p;
}
test('runs without a pre-registration keep byte-identical identity; binding changes run_id and digest', async () => {
  const s = await setup();
  try {
    const now = () => '2026-01-01T00:00:00Z';
    const plain = await runBenchmark(s.options, s.adapter, { now });
    assert.equal('coverage_preregistration_sha256' in plain.config, false);
    await removeResults(s.root);
    const again = await runBenchmark(s.options, s.adapter, { now });
    assert.equal(again.run_id, plain.run_id); assert.equal(again.results_digest, plain.results_digest);
    await removeResults(s.root);
    const p = await writePolicy(s.root);
    const bound = await runBenchmark({ ...s.options, coveragePreregistration: 'preregistration/policy.json' }, s.adapter, { now });
    assert.equal(bound.config.coverage_preregistration_sha256, p.digest);
    assert.notEqual(bound.run_id, plain.run_id); assert.notEqual(bound.results_digest, plain.results_digest);
    assert.equal(bound.config_sha256, sha256(canonicalJson(bound.config)));
  } finally { await cleanup(s.root); }
});
test('binding refuses late, tampered, mismatched or out-of-directory pre-registrations before execution', async () => {
  const s = await setup();
  try {
    const now = () => '2026-01-01T00:00:00Z', bind = { ...s.options, coveragePreregistration: 'preregistration/policy.json' };
    await writePolicy(s.root, p => { p.registered_at = '2026-01-01T00:00:00.000Z'; });
    await assert.rejects(runBenchmark(bind, s.adapter, { now }), { message: 'PREREGISTRATION_NOT_BEFORE_RESULTS' });
    await writePolicy(s.root, p => { p.tuple = { ...INITIAL_EVIDENCE_TUPLE }; });
    await assert.rejects(runBenchmark(bind, s.adapter, { now }), { message: 'PREREGISTRATION_TUPLE_MISMATCH' });
    const p = await writePolicy(s.root);
    await writeFile(join(s.root, 'preregistration', 'policy.json'), JSON.stringify({ ...p, minimum_measurable_coverage: 0.4 }));
    await assert.rejects(runBenchmark(bind, s.adapter, { now }), { message: 'PREREGISTRATION_DIGEST_MISMATCH' });
    await writePolicy(s.root, p => { p.minimum_measurable_coverage = 0; });
    await assert.rejects(runBenchmark(bind, s.adapter, { now }), { message: 'INVALID_COVERAGE_MINIMUM' });
    await writePolicy(s.root, p => { (p.definitions as Record<string, string>).denominator = 'changed'; });
    await assert.rejects(runBenchmark(bind, s.adapter, { now }), { message: 'PREREGISTRATION_DEFINITIONS_MISMATCH' });
    await writeFile(join(s.root, 'registry', 'policy.json'), '{}');
    await assert.rejects(runBenchmark({ ...s.options, coveragePreregistration: 'registry/policy.json' }, s.adapter, { now }), { message: 'EVAL_PATH_ESCAPE' });
    await assert.rejects(runBenchmark({ ...s.options, coveragePreregistration: 'preregistration/absent.json' }, s.adapter, { now }), { message: 'PREREGISTRATION_UNREADABLE' });
    assert.equal(s.adapter.calls, 0);
  } finally { await cleanup(s.root); }
});
