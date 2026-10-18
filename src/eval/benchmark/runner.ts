import { parseTestRegistry } from '../sealed/membership.ts';
import { sealedPlacement, sealedWritePath, inspectTree } from '../sealed/paths.ts';
import { readFile, writeFile, mkdir, mkdtemp, realpath, rm, cp, lstat } from 'node:fs/promises';
import { join, resolve, relative, isAbsolute, sep } from 'node:path';
import { normalizeEngineOutputDirectory, NORMALIZER_VERSION, type NormalizationResult } from '../normalize/engineObservations.ts';
import { compareEngineOutputs, aggregateRepeatability, provisionalTolerances, artifactNames, type Artifacts } from '../golden/compareEngineOutputs.ts';
import { parseRegistry, registryExclusion, BenchmarkError, canonicalJson, sha256, EVAL_ID } from './registry.ts';
import { loadAnnotation } from './annotations.ts';
import { pairObservations, assertObservationVersion } from './pairing.ts';
import { runGates, type GateArtifacts } from './gates.ts';
import { ENGINE_VERSION, BASELINE_TREE, ARTIFACT_NAMES, artifactInventory, enforcePreflight, type EngineAdapter, type EngineRunArtifacts } from './engineAdapter.ts';

import { classifyTerminal } from './terminal.ts';
import { validatePreregistrationStructure, type CoveragePreregistration } from '../calibrate/preregistration.ts';

export const BENCHMARK_RUNNER_VERSION = 'bench-1.0.0';
export const BENCHMARK_RECORD_SCHEMA = 'hitterloop.benchmark-clip';
export const BENCHMARK_RUN_SCHEMA = 'hitterloop.benchmark-run';
export const BENCHMARK_SCHEMA_VERSION = '1.0.0';
export interface BenchmarkOptions {
  evalRoot: string; repoRoot: string; engine: string; split: 'dev' | 'validation' | 'test'; repeat?: number;
  clips?: string[]; cache?: boolean; allowDirty?: boolean; allowUnverifiedEnvironment?: boolean; releaseCandidate?: boolean;
  /** PR17 owner exception: path (absolute or EVAL_ROOT-relative) under EVAL_ROOT/preregistration/. */
  coveragePreregistration?: string;
  /** Internal only: runSealedTest owns this option; never exposed by eval:run. */
  sealed?: { dataRoot: string; outputRoot: string; env?: NodeJS.ProcessEnv };
}
export interface CacheComponents {
  source_sha256: string; engine_version: string; instrumentation_version: string; baseline_tree: string;
  models_lock_sha256: string; requirements_lock_sha256: string; environment_version: string; config_sha256: string;
}
export const cacheKey = (components: CacheComponents) => sha256(canonicalJson(components));
const inside = (root: string, child: string) => { const r = relative(root, child); return r === '' || (!r.startsWith(`..${sep}`) && r !== '..' && !isAbsolute(r)); };
async function safePath(root: string, path: string): Promise<string> {
  if (!inside(root, resolve(path))) throw new BenchmarkError('EVAL_PATH_ESCAPE');
  let cursor = root;
  for (const part of relative(root, path).split(sep).filter(Boolean)) {
    cursor = join(cursor, part);
    try { if ((await lstat(cursor)).isSymbolicLink()) throw new BenchmarkError('EVAL_PATH_ESCAPE'); }
    catch (e) { if ((e as NodeJS.ErrnoException).code === 'ENOENT') break; throw e; }
  }
  // Walk existing ancestors so links cannot redirect new writes into the repository.
  let parent = resolve(path);
  while (true) {
    try { if (!inside(root, await realpath(parent))) throw new BenchmarkError('EVAL_PATH_ESCAPE'); break; }
    catch (e) { if ((e as NodeJS.ErrnoException).code !== 'ENOENT') throw e; }
    const next = resolve(parent, '..'); if (next === parent) throw new BenchmarkError('EVAL_PATH_ESCAPE'); parent = next;
  }
  return path;
}
async function json(path: string): Promise<unknown> { try { return JSON.parse(await readFile(path, 'utf8')); } catch { return null; } }
async function optionalIdentity(path: string) {
  try {
    const info = await lstat(path); if (!info.isFile() || info.isSymbolicLink()) throw new BenchmarkError('ARTIFACT_READ_FAILED');
    const b = await readFile(path); return { sha256: sha256(b), bytes: b.length };
  }
  catch (e) { if ((e as NodeJS.ErrnoException).code !== 'ENOENT') throw new BenchmarkError('ARTIFACT_READ_FAILED'); return null; }
}
async function repeatArtifacts(dir: string): Promise<Artifacts> {
  return Object.fromEntries(await Promise.all(artifactNames.map(async n => [n, await json(join(dir, n))])));
}
async function gateArtifacts(dir: string): Promise<GateArtifacts> {
  let frameMapJson: string | null = null;
  try { frameMapJson = await readFile(join(dir, 'frame_map.json'), 'utf8'); } catch { /* Optional. */ }
  return { pose2d: await json(join(dir, 'pose_2d.json')), batPath: await json(join(dir, 'bat_path.json')),
    metrics: await json(join(dir, 'metrics.json')), manifest: await json(join(dir, 'engine_manifest.json')), frameMapJson };
}
export async function runBenchmark(options: BenchmarkOptions, adapter: EngineAdapter,
  dependencies: { normalize?: (dir: string) => Promise<NormalizationResult>; now?: () => string } = {}) {
  if (options.sealed && options.sealed.env?.HITTERLOOP_SEALED_ENVIRONMENT !== '1') throw new BenchmarkError('SEALED_ENVIRONMENT_REQUIRED');
  if (options.split === 'test' && !options.sealed) throw new BenchmarkError('TEST_SPLIT_REQUIRES_SEALED_ENVIRONMENT');
  if (options.sealed ? options.split !== 'test' : !['dev', 'validation'].includes(options.split)) throw new BenchmarkError('INVALID_SPLIT');
  if (options.engine !== ENGINE_VERSION || adapter.engineVersion !== options.engine) throw new BenchmarkError('UNSUPPORTED_ENGINE_VERSION');
  if (!options.evalRoot || !isAbsolute(options.evalRoot)) throw new BenchmarkError('EVAL_ROOT_MUST_BE_ABSOLUTE');
  const repo = await realpath(options.repoRoot);
  if (inside(repo, resolve(options.evalRoot))) throw new BenchmarkError('EVAL_ROOT_INSIDE_REPOSITORY');
  let root: string;
  try { root = await realpath(options.evalRoot); } catch { throw new BenchmarkError('EVAL_ROOT_MUST_EXIST'); }
  if (inside(repo, root)) throw new BenchmarkError('EVAL_ROOT_INSIDE_REPOSITORY');
  let dataRoot = root, writeRoot = root;
  if (options.sealed) {
    dataRoot = await sealedPlacement(options.sealed.dataRoot, root, repo);
    writeRoot = dataRoot;
    await sealedWritePath(writeRoot, options.sealed.outputRoot);
    if (resolve(options.sealed.outputRoot) !== join(dataRoot, 'results')) throw new BenchmarkError('UNENCRYPTED_PER_CLIP_WRITE_REFUSED');
    await inspectTree(dataRoot);
    if (options.repeat !== undefined || options.clips || options.coveragePreregistration || options.allowDirty || options.allowUnverifiedEnvironment) throw new BenchmarkError('SEALED_OPTION_REFUSED');
  }
  const writePath = (path: string) => options.sealed ? sealedWritePath(writeRoot, path) : safePath(root, path);
  const repeat = options.repeat ?? 1;
  if (!Number.isSafeInteger(repeat) || repeat < 1 || (options.repeat !== undefined && repeat < 2)) throw new BenchmarkError('INVALID_REPEAT');
  const selected = options.clips ? [...new Set(options.clips)].sort() : null;
  if (selected?.some(id => !EVAL_ID.test(id)) || selected?.length === 0) throw new BenchmarkError('INVALID_CLIP_SELECTION');
  const now = dependencies.now ?? (() => new Date().toISOString());
  // Bind the coverage pre-registration into the run identity before any execution. The key is
  // absent (not null) when unused, so existing config bytes, run_id and digests are unchanged.
  let preregistration: CoveragePreregistration | null = null;
  if (options.coveragePreregistration !== undefined) {
    const directory = await safePath(root, join(root, 'preregistration'));
    let value: unknown;
    try { value = JSON.parse(await readFile(await safePath(directory, resolve(root, options.coveragePreregistration)), 'utf8')); }
    catch (e) { throw e instanceof BenchmarkError ? e : new BenchmarkError('PREREGISTRATION_UNREADABLE'); }
    try { preregistration = validatePreregistrationStructure(value); }
    catch (e) { throw new BenchmarkError(e instanceof Error && /^[A-Z][A-Z0-9_]+$/.test(e.message) ? e.message : 'INVALID_PREREGISTRATION'); }
    if (Date.parse(preregistration.registered_at) >= Date.parse(now())) throw new BenchmarkError('PREREGISTRATION_NOT_BEFORE_RESULTS');
  }
  const config = { engine: options.engine, split: options.split, repeat, clips: selected, cache: options.sealed ? false : options.cache !== false,
    allow_dirty: options.allowDirty ?? false, allow_unverified_environment: options.allowUnverifiedEnvironment ?? false, release_candidate: options.releaseCandidate ?? false,
    ...(preregistration ? { coverage_preregistration_sha256: preregistration.digest } : {}) };
  const config_sha256 = sha256(canonicalJson(config));
  const ctx = { repoRoot: repo, split: options.split === 'test' ? 'validation' as const : options.split, allowDirty: config.allow_dirty, allowUnverifiedEnvironment: config.allow_unverified_environment };
  const preflight = enforcePreflight(await adapter.preflight(ctx), ctx);
  if (preregistration && (preregistration.tuple.engineCodeVersion !== adapter.engineVersion
    || preregistration.tuple.instrumentationVersion !== 'inst-1'
    || preregistration.tuple.environmentVersion !== preflight.environment_version)) throw new BenchmarkError('PREREGISTRATION_TUPLE_MISMATCH');
  // An unverified environment has no identity to bind cached artifacts to, so it never reads or writes the cache.
  const useCache = config.cache && preflight.environment_verified && preflight.environment_version !== null;
  const registryBytes = await readFile(await safePath(dataRoot, join(dataRoot, options.sealed ? 'registry-test.jsonl' : 'registry/clips.jsonl')), 'utf8');
  const registry = options.sealed ? parseTestRegistry(registryBytes) : parseRegistry(registryBytes);
  // Semantic registry identity makes registry line ordering irrelevant.
  const registry_sha256 = sha256(canonicalJson({ registry_version: 1, clips: registry }));
  if (selected?.some(id => !registry.some(c => c.eval_id === id && c.split === options.split))) throw new BenchmarkError('UNKNOWN_CLIP_SELECTION');
  const clips = registry.filter(c => c.split === options.split && (!selected || selected.includes(c.eval_id)));
  const start = now();
  const workRoot = await writePath(join(writeRoot, options.sealed ? 'results/.work' : 'work')); await mkdir(workRoot, { recursive: true });
  const scratch = await mkdtemp(join(workRoot, 'benchmark-'));
  const records: Record<string, unknown>[] = [], failures: { eval_id: string; code: string }[] = [];
  const comparisons: ReturnType<typeof compareEngineOutputs>[] = [];
  const counts: Record<string, number> = {};
  const annotationHashes: Record<string, string | null> = {}, artifactHashes: Record<string, unknown> = {};
  const tuples: unknown[] = [];
  try {
    for (const clip of clips) {
      const record: Record<string, unknown> = { schema: BENCHMARK_RECORD_SCHEMA, schema_version: BENCHMARK_SCHEMA_VERSION, eval_id: clip.eval_id };
      records.push(record);
      const exclude = (code: string) => { record.status = 'excluded'; record.exclusion = code; counts[code] = (counts[code] ?? 0) + 1; failures.push({ eval_id: clip.eval_id, code }); };
      const exclusion = registryExclusion({ ...clip, split: 'dev' });
      if (exclusion) { exclude(exclusion); continue; }
      await safePath(dataRoot, join(dataRoot, 'annotations', '1.0.0', clip.eval_id));
      const annotation = await loadAnnotation(dataRoot, { ...clip, split: 'dev' });
      annotationHashes[clip.eval_id] = annotation.ok ? annotation.identity.sha256 : annotation.sha256;
      if (!annotation.ok) { exclude(annotation.code); continue; }
      record.annotation = annotation.identity;
      const media = await safePath(dataRoot, join(dataRoot, 'media', `${clip.eval_id}.${clip.media_ext}`));
      try { if (sha256(await readFile(media)) !== clip.sha256) { exclude('media_hash_mismatch'); continue; } }
      catch { exclude('media_missing'); continue; }
      const key = cacheKey({ source_sha256: clip.sha256, engine_version: adapter.engineVersion, instrumentation_version: 'inst-1',
        baseline_tree: BASELINE_TREE, models_lock_sha256: preflight.models_lock_sha256, requirements_lock_sha256: preflight.requirements_lock_sha256,
        environment_version: preflight.environment_version ?? 'unverified', config_sha256 });
      const cacheDir = options.sealed ? '' : await safePath(root, join(root, 'cache', key));
      let first: EngineRunArtifacts | null = null;
      if (useCache) {
        try {
          await lstat(cacheDir);
          const inventory = await artifactInventory(cacheDir), extra = await optionalIdentity(join(cacheDir, 'pose_3d.json'));
          const manifest = await json(await safePath(root, join(cacheDir, 'cache.json')));
          if (inventory.files['pose_2d.json'] && inventory.files['bat_path.json'] && inventory.files['metrics.json'] &&
              canonicalJson(manifest) === canonicalJson({ key, files: inventory.files, repeat_pose3d: extra })) first = inventory;
          else failures.push({ eval_id: clip.eval_id, code: 'cache_integrity_failed' });
        } catch (e) { if ((e as NodeJS.ErrnoException).code !== 'ENOENT') failures.push({ eval_id: clip.eval_id, code: 'cache_integrity_failed' }); }
      }
      const runs: EngineRunArtifacts[] = [], hashes: unknown[] = [], repeatData: Artifacts[] = [];
      try {
        for (let i = 0; i < repeat; i++) {
          const artifacts = i === 0 && first ? first : await adapter.run({ evalId: clip.eval_id, mediaPath: media, sha256: clip.sha256 }, join(scratch, `${clip.eval_id}-${i}`));
          await writePath(artifacts.dir);
          const actual = await artifactInventory(artifacts.dir);
          if (canonicalJson(actual.files) !== canonicalJson(artifacts.files)) throw new BenchmarkError('ARTIFACT_INTEGRITY_FAILED');
          runs.push(actual);
          hashes.push({ files: actual.files, repeat_pose3d: await optionalIdentity(join(actual.dir, 'pose_3d.json')) });
          if (repeat > 1) repeatData.push(await repeatArtifacts(actual.dir));
        }
        if (sha256(await readFile(media)) !== clip.sha256) throw new BenchmarkError('media_hash_mismatch');
      } catch (e) {
        // A sealed execution failure is an aborted access, never a successful export.
        if (options.sealed) throw e instanceof BenchmarkError ? e : new BenchmarkError('ENGINE_EXECUTION_FAILED');
        if (e instanceof BenchmarkError && e.code === 'UNENCRYPTED_PER_CLIP_WRITE_REFUSED') throw e;
        exclude(e instanceof BenchmarkError ? e.code : 'ENGINE_EXECUTION_FAILED'); continue;
      }
      artifactHashes[clip.eval_id] = hashes; record.artifacts = hashes;
      const firstRun = runs[0]!;
      if (useCache && !first) {
        await mkdir(await safePath(root, join(root, 'cache')), { recursive: true });
        // Only the derived hash directory under the verified cache root is replaced.
        await safePath(root, cacheDir); await rm(cacheDir, { recursive: true, force: true }); await mkdir(cacheDir);
        for (const n of [...ARTIFACT_NAMES, 'pose_3d.json']) if (await optionalIdentity(join(firstRun.dir, n))) await cp(join(firstRun.dir, n), join(cacheDir, n));
        await writeFile(join(cacheDir, 'cache.json'), canonicalJson({ key, files: firstRun.files, repeat_pose3d: await optionalIdentity(join(firstRun.dir, 'pose_3d.json')) }) + '\n');
      }
      const clipComparisons = repeatData.slice(1).map((r, i) => compareEngineOutputs(repeatData[i]!, r, provisionalTolerances));
      record.repeatability = clipComparisons; comparisons.push(...clipComparisons);
      for (const r of clipComparisons) if (r.status !== 'within_tolerance') failures.push({ eval_id: clip.eval_id, code: 'repeatability_' + r.status });
      const terminal = classifyTerminal({ ...await gateArtifacts(firstRun.dir),
        pipelineStatus: await json(join(firstRun.dir, 'pipeline_status.json')), registrySha256: clip.sha256 });
      if (terminal.kind === 'verified_terminal') {
        record.terminal = terminal.record; exclude('engine_terminal_low_quality_footage'); continue;
      }
      if (terminal.kind === 'terminal_rejected') { exclude(terminal.code); continue; }
      const normalized = await (dependencies.normalize ?? normalizeEngineOutputDirectory)(firstRun.dir);
      if (!normalized.ok) { exclude('normalization_failed:' + normalized.error.code); continue; }
      try { assertObservationVersion(normalized.observations); } catch (e) { exclude((e as BenchmarkError).code); continue; }
      const observations = normalized.observations;
      if (observations.source.sha256 !== null && observations.source.sha256 !== clip.sha256) { exclude('source_hash_mismatch'); continue; }
      const gates = await runGates(await gateArtifacts(firstRun.dir), annotation.annotation.camera.capture_profile);
      record.gates = gates;
      if (gates.tuple && !tuples.some(t => canonicalJson(t) === canonicalJson(gates.tuple))) tuples.push(gates.tuple);
      record.pairing = pairObservations(annotation.annotation, observations); record.status = 'paired';
    }
    const versions = { runner: BENCHMARK_RUNNER_VERSION, schema: BENCHMARK_SCHEMA_VERSION, normalizer: NORMALIZER_VERSION, instrumentation: 'inst-1',
      engine: adapter.engineVersion, baseline_tree: BASELINE_TREE, models_lock_sha256: preflight.models_lock_sha256,
      requirements_lock_sha256: preflight.requirements_lock_sha256, environment_version: preflight.environment_version,
      git_commit: preflight.git_commit, dirty: preflight.dirty, environment_verified: preflight.environment_verified };
    const run_id = 'run-' + sha256(canonicalJson({ config, registry_sha256, annotationHashes, artifactHashes, versions })).slice(0, 16);
    const per_clip = records.map(canonicalJson).join('\n') + (records.length ? '\n' : '');
    const failureBytes = failures.map(canonicalJson).join('\n') + (failures.length ? '\n' : '');
    const run = { schema: BENCHMARK_RUN_SCHEMA, schema_version: BENCHMARK_SCHEMA_VERSION, runner_version: BENCHMARK_RUNNER_VERSION,
      run_id, config, config_sha256, cache_used: useCache, engine_version: adapter.engineVersion, tuple: tuples.length === 1 ? tuples[0] : null, tuples,
      preflight, models_lock_sha256: preflight.models_lock_sha256, requirements_lock_sha256: preflight.requirements_lock_sha256,
      git_commit: preflight.git_commit, dirty: preflight.dirty, registry_sha256, registry_hash_basis: 'canonical_validated_registry',
      clip_list_sha256: sha256(canonicalJson(clips.map(c => c.eval_id))),
      counts_by_exclusion_reason: counts, clip_count: clips.length, repeatability: aggregateRepeatability(comparisons) };
    // The digest field itself is necessarily omitted, in addition to timing.
    const results_digest = sha256(canonicalJson(run) + per_clip + failureBytes);
    const result = { ...run, results_digest, timing: { start, end: now() } };
    const results = await writePath(options.sealed?.outputRoot ?? join(root, 'results')); await mkdir(results, { recursive: true });
    const output = await writePath(join(results, run_id));
    try { await mkdir(output); } catch (e) { if ((e as NodeJS.ErrnoException).code === 'EEXIST') throw new BenchmarkError('RESULT_ALREADY_EXISTS'); throw e; }
    await writeFile(await writePath(join(output, 'run.json')), canonicalJson(result) + '\n', { flag: 'wx' });
    await writeFile(await writePath(join(output, 'per_clip.jsonl')), per_clip, { flag: 'wx' });
    await writeFile(await writePath(join(output, 'failures.jsonl')), failureBytes, { flag: 'wx' });
    return result;
  } finally { if (inside(workRoot, scratch) && scratch !== workRoot) await rm(scratch, { recursive: true, force: true }); }
}
