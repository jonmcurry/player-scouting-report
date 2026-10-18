import { readFile, writeFile, mkdir, open, rm, lstat } from 'node:fs/promises';
import { join } from 'node:path';
import { BenchmarkError, parseRegistry, sha256, canonicalJson } from '../benchmark/registry.ts';
import { runBenchmark } from '../benchmark/runner.ts';
import type { EngineAdapter } from '../benchmark/engineAdapter.ts';
import { safePath } from '../score/inputs.ts';
import { validateMembership, parseTestRegistry } from './membership.ts';
import { checkLeakage, checkTestRegistryMatchesMembership } from './leakage.ts';
import { clearRoot, sealedPlacement, sealedWritePath, inspectTree, repositoryRoot } from './paths.ts';
import { scanText } from './scan.ts';
import { tarBundle, type Encryptor } from './encryption.ts';
import { appendAccess, readAccess, validateAccess } from './accessLog.ts';
export interface SealedOptions {
  evalRoot: string; sealedRoot: string; releaseCandidate: string; operator: string;
  encryptor: Encryptor; adapter: EngineAdapter; now: () => string; env: NodeJS.ProcessEnv;
}
export async function runSealedTest(o: SealedOptions) {
  if (o.env.HITTERLOOP_SEALED_ENVIRONMENT !== '1') throw new BenchmarkError('SEALED_ENVIRONMENT_REQUIRED');
  if (o.releaseCandidate !== o.adapter.engineVersion) throw new BenchmarkError('RELEASE_CANDIDATE_MISMATCH');
  const root = await clearRoot(o.evalRoot), sealed = await sealedPlacement(o.sealedRoot, root);
  if (!o.encryptor || typeof o.encryptor.encrypt !== 'function') throw new BenchmarkError('ENCRYPTOR_REQUIRED');
  await inspectTree(sealed);
  for (const [name, directory] of [['registry-test.jsonl', false], ['media', true], ['annotations', true]] as const) {
    try { const stat = await lstat(join(sealed, name)); if (directory ? !stat.isDirectory() : !stat.isFile()) throw new Error(); }
    catch { throw new BenchmarkError('SEALED_INPUT_MISSING'); }
  }
  let membership;
  try { membership = validateMembership(JSON.parse(await readFile(await safePath(root, 'registry/test-membership.json'), 'utf8'))); }
  catch (e) { throw e instanceof BenchmarkError ? e : new BenchmarkError('MEMBERSHIP_UNREADABLE'); }
  const clips = parseTestRegistry(await readFile(join(sealed, 'registry-test.jsonl'), 'utf8'));
  checkTestRegistryMatchesMembership(clips, membership);
  checkLeakage(parseRegistry(await readFile(await safePath(root, 'registry/clips.jsonl'), 'utf8')), membership);
  const at = o.now();
  // Fingerprint only execution policy known before access; no paths, timestamps or outputs.
  const executionConfig = { engine: o.adapter.engineVersion, split: 'test', repeat: 1, clips: null,
    cache: false, allow_dirty: false, allow_unverified_environment: false, release_candidate: true };
  const configSha256 = sha256(canonicalJson(executionConfig));
  const accessInput = { operator: o.operator, engine: o.adapter.engineVersion, release_candidate: o.releaseCandidate,
    config_sha256: configSha256, membership_digest: membership.digest };
  validateAccess(accessInput, at);
  if (scanText(canonicalJson({ operator: o.operator, engine: o.adapter.engineVersion, at }), 'access-metadata', membership).length) throw new BenchmarkError('AGGREGATE_LEAKAGE_REFUSED');
  await readAccess(root);
  // One cooperating sealed execution at a time. Crash locks require owner investigation.
  const lockPath = await safePath(root, 'registry/sealed-run.lock');
  let lock;
  try { lock = await open(lockPath, 'wx', 0o600); }
  catch (e) { if ((e as NodeJS.ErrnoException).code === 'EEXIST') throw new BenchmarkError('SEALED_RUN_BUSY'); throw e; }
  let output: string | undefined;
  try {
    // Durable access record precedes preflight and all benchmark reads/execution. Never roll it back.
    const access = await appendAccess(root, accessInput, () => at);
    const run = await runBenchmark({ evalRoot: root, repoRoot: repositoryRoot, engine: o.adapter.engineVersion,
      split: 'test', cache: false, releaseCandidate: true, sealed: { dataRoot: sealed, outputRoot: join(sealed, 'results'), env: o.env } }, o.adapter, { now: () => at });
    output = await sealedWritePath(sealed, join(sealed, 'results', run.run_id));
    const aggregate = canonicalJson(run) + '\n';
    if (scanText(aggregate, 'run.json', membership).length) throw new BenchmarkError('AGGREGATE_LEAKAGE_REFUSED');
    const bundle = tarBundle({ 'per_clip.jsonl': await readFile(join(output, 'per_clip.jsonl')),
      'failures.jsonl': await readFile(join(output, 'failures.jsonl')) });
    const encrypted = await o.encryptor.encrypt(bundle);
    if (!encrypted.length || Buffer.from(encrypted).equals(Buffer.from(bundle))) throw new BenchmarkError('ENCRYPTION_FAILED');
    // Validate all destination paths before the first clear write; never overwrite artifacts.
    const destination = await safePath(root, 'sealed/results', run.run_id + '.tar.age');
    const clear = await safePath(root, 'results', run.run_id);
    await mkdir(await safePath(root, 'sealed/results'), { recursive: true });
    await writeFile(destination, encrypted, { flag: 'wx', mode: 0o600 });
    await mkdir(await safePath(root, 'results'), { recursive: true });
    await mkdir(clear);
    await writeFile(await safePath(root, 'results', run.run_id, 'run.json'), aggregate, { flag: 'wx', mode: 0o600 });
    return { run_id: run.run_id, encrypted_bundle_sha256: sha256(encrypted), access_record_sha256: access.record_sha256,
      public_line: access.publicLine, clear_files: [`results/${run.run_id}/run.json`, 'registry/test-access.jsonl'] };
  } finally {
    // rm removes directory entries, not guaranteed physical erasure; use ephemeral encrypted storage.
    if (output) await rm(await sealedWritePath(sealed, output), { recursive: true, force: true });
    await lock.close(); await rm(lockPath);
  }
}
