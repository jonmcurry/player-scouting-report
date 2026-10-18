import { ENGINE_RUNTIME_EVIDENCE_TUPLE, resolveTuple } from '../../services/development/evidenceRegistry.ts';
import { spawn } from 'node:child_process';
import { readFile, mkdir, lstat } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { BenchmarkError, HASH, sha256 } from './registry.ts';

export const ENGINE_VERSION = 'engine-baseline-1.0.0';
export const BASELINE_TREE = '766f4fbc64620d428da428e59b144554ca2f2a7b';
export const ARTIFACT_NAMES = ['pose_2d.json', 'bat_path.json', 'metrics.json', 'pipeline_status.json', 'engine_manifest.json', 'frame_map.json'] as const;
export type ArtifactName = typeof ARTIFACT_NAMES[number];
export interface ArtifactIdentity { sha256: string; bytes: number }
export interface EngineRunArtifacts { dir: string; files: Record<ArtifactName, ArtifactIdentity | null> }
export interface PreflightContext { repoRoot: string; split: 'dev' | 'validation'; allowDirty: boolean; allowUnverifiedEnvironment: boolean }
export interface PreflightResult {
  dirty: boolean; git_commit: string; baseline_tree: string; baseline_verified: boolean;
  models_lock_sha256: string; requirements_lock_sha256: string;
  environment_lock_models_sha256: string; environment_lock_requirements_sha256: string;
  environment_verified: boolean; environment_version: string | null;
  environment_capture_boundary: string;
}
export interface EngineAdapter {
  readonly engineVersion: string;
  preflight(ctx: PreflightContext): Promise<PreflightResult>;
  run(input: { evalId: string; mediaPath: string; sha256: string }, workDir: string): Promise<EngineRunArtifacts>;
}
export interface CommandResult { code: number | null; stdout: string }
export type Execute = (command: string, args: string[], cwd: string, env?: NodeJS.ProcessEnv) => Promise<CommandResult>;
const execute: Execute = (command, args, cwd, env) => new Promise((done, reject) => {
  const child = spawn(command, args, { cwd, env: env ?? process.env, windowsHide: true, stdio: ['ignore', 'pipe', 'ignore'] });
  let stdout = '';
  child.stdout.on('data', chunk => { if (stdout.length < 1024 * 1024) stdout += chunk.toString(); });
  child.on('error', () => reject(new BenchmarkError('PROCESS_START_FAILED')));
  child.on('close', code => done({ code, stdout }));
});
export const pythonExecutable = (repoRoot: string) => process.env.POSE3D_PYTHON ?? join(repoRoot, '.venv_pose3d', process.platform === 'win32' ? 'Scripts' : 'bin', process.platform === 'win32' ? 'python.exe' : 'python');

// PR5 exposes callable, read-only capture/identity functions, not a verify CLI.
// Import them in a fresh process, compare full canonical identities, emit only an opaque version.
const VERIFY_ENVIRONMENT = [
  'import sys,json', 'from pathlib import Path',
  'root=Path(sys.argv[1])', 'sys.path.insert(0,str(root/"src/eval/environment"))',
  'from capture_environment import capture,environment_version',
  'locks=root/"src/eval/environment/locks/env-9a6a8510dec8"',
  'expected=environment_version((locks/"requirements.lock.txt").read_text(encoding="utf-8"),json.loads((locks/"models.lock.json").read_text(encoding="utf-8")))',
  'requirements,manifest=capture(root)', 'actual=environment_version(requirements,manifest)',
  'sys.exit(1) if actual != expected else None', 'print(actual)',
].join('\n');
export interface PreflightChecks {
  git: (root: string) => Promise<{ dirty: boolean; commit: string }>;
  baseline: (root: string) => Promise<boolean>;
  locks: (root: string) => Promise<Pick<PreflightResult, 'models_lock_sha256' | 'requirements_lock_sha256'
    | 'environment_lock_models_sha256' | 'environment_lock_requirements_sha256'>>;
  environment: (root: string) => Promise<{ verified: boolean; version: string | null }>;
}
export function enforcePreflight(f: PreflightResult, ctx: PreflightContext): PreflightResult {
  if (ctx.split !== 'dev' && (ctx.allowDirty || ctx.allowUnverifiedEnvironment)) throw new BenchmarkError('DEV_OVERRIDE_ONLY');
  if (f.dirty && !(ctx.allowDirty && ctx.split === 'dev')) throw new BenchmarkError('DIRTY_TREE');
  if (!/^[a-f0-9]{40}$/.test(f.git_commit)) throw new BenchmarkError('GIT_IDENTITY_UNAVAILABLE');
  if (!f.baseline_verified || f.baseline_tree !== BASELINE_TREE) throw new BenchmarkError('BASELINE_TREE_UNVERIFIED');
  if (!HASH.test(f.models_lock_sha256) || !HASH.test(f.requirements_lock_sha256)) throw new BenchmarkError('LOCK_IDENTITY_UNAVAILABLE');
  if (!f.environment_verified && !(ctx.allowUnverifiedEnvironment && ctx.split === 'dev')) throw new BenchmarkError('ENVIRONMENT_UNVERIFIED');
  if (f.environment_verified && (!f.environment_version || !/^env-[a-f0-9]{12}$/.test(f.environment_version)
    || !HASH.test(f.environment_lock_models_sha256) || !HASH.test(f.environment_lock_requirements_sha256)
    || f.environment_capture_boundary !== 'engine_runtime_inherited_omp')) throw new BenchmarkError('ENVIRONMENT_UNVERIFIED');
  return f;
}
export async function artifactInventory(dir: string): Promise<EngineRunArtifacts> {
  const files = {} as EngineRunArtifacts['files'];
  for (const name of ARTIFACT_NAMES) {
    try {
      const info = await lstat(join(dir, name));
      if (!info.isFile() || info.isSymbolicLink()) throw new BenchmarkError('ARTIFACT_READ_FAILED');
      const bytes = await readFile(join(dir, name)); files[name] = { sha256: sha256(bytes), bytes: bytes.length };
    }
    catch (e) { if ((e as NodeJS.ErrnoException).code !== 'ENOENT') throw new BenchmarkError('ARTIFACT_READ_FAILED'); files[name] = null; }
  }
  return { dir, files };
}
export class BaselineAdapter implements EngineAdapter {
  readonly engineVersion = ENGINE_VERSION;
  private readonly checks: PreflightChecks;
  constructor(private readonly repoRoot: string, private readonly exec: Execute = execute, checks: Partial<PreflightChecks> = {}) {
    this.checks = {
      git: async root => {
        const status = await exec('git', ['status', '--porcelain'], root);
        const commit = await exec('git', ['rev-parse', 'HEAD'], root);
        if (status.code !== 0 || commit.code !== 0) throw new BenchmarkError('GIT_IDENTITY_UNAVAILABLE');
        return { dirty: status.stdout.trim().length > 0, commit: commit.stdout.trim() };
      },
      baseline: async root => (await exec(process.execPath, ['scripts/check-baseline-tree.mjs'], root)).code === 0,
      locks: async root => ({ models_lock_sha256: sha256(await readFile(join(root, 'src/eval/environment/models.lock.json'))),
        requirements_lock_sha256: sha256(await readFile(join(root, 'src/eval/environment/requirements.lock.txt'))),
        environment_lock_models_sha256: sha256(await readFile(join(root, 'src/eval/environment/locks/env-9a6a8510dec8/models.lock.json'))),
        environment_lock_requirements_sha256: sha256(await readFile(join(root, 'src/eval/environment/locks/env-9a6a8510dec8/requirements.lock.txt'))) }),
      environment: async root => {
        try {
          const r = await exec(pythonExecutable(root), ['-B', '-c', VERIFY_ENVIRONMENT, root], root, { ...process.env,
            OMP_NUM_THREADS: process.env.OMP_NUM_THREADS || '1', PYTHONDONTWRITEBYTECODE: '1' });
          const version = r.stdout.trim();
          return r.code === 0 && /^env-[a-f0-9]{12}$/.test(version)
            && version === ENGINE_RUNTIME_EVIDENCE_TUPLE.environmentVersion
            && resolveTuple({ ...ENGINE_RUNTIME_EVIDENCE_TUPLE, environmentVersion: version }) !== null ? { verified: true, version } : { verified: false, version: null };
        } catch { return { verified: false, version: null }; }
      }, ...checks,
    };
  }
  async preflight(ctx: PreflightContext): Promise<PreflightResult> {
    if (resolve(ctx.repoRoot) !== resolve(this.repoRoot)) throw new BenchmarkError('REPOSITORY_MISMATCH');
    const git = await this.checks.git(this.repoRoot);
    if (git.dirty && !(ctx.allowDirty && ctx.split === 'dev')) throw new BenchmarkError('DIRTY_TREE');
    const baseline = await this.checks.baseline(this.repoRoot);
    if (!baseline) throw new BenchmarkError('BASELINE_TREE_UNVERIFIED');
    const locks = await this.checks.locks(this.repoRoot), environment = await this.checks.environment(this.repoRoot);
    return enforcePreflight({ dirty: git.dirty, git_commit: git.commit, baseline_tree: BASELINE_TREE, baseline_verified: baseline,
      ...locks, environment_verified: environment.verified, environment_version: environment.version,
      environment_capture_boundary: 'engine_runtime_inherited_omp' }, ctx);
  }
  async run(input: { evalId: string; mediaPath: string; sha256: string }, workDir: string): Promise<EngineRunArtifacts> {
    // Exclusive work directory prevents stale artifacts from an earlier invocation.
    await mkdir(workDir);
    if (sha256(await readFile(input.mediaPath)) !== input.sha256) throw new BenchmarkError('media_hash_mismatch');
    await this.exec(pythonExecutable(this.repoRoot), [join(this.repoRoot, 'scripts/pose3d/run_pipeline.py'), input.mediaPath, workDir],
      this.repoRoot, { ...process.env, PYTHONUNBUFFERED: '1' });
    // workDir was created empty above, so any status file was written by this run;
    // an mtime comparison would only add false failures on coarse-timestamp filesystems.
    let status: unknown;
    try { status = JSON.parse(await readFile(join(workDir, 'pipeline_status.json'), 'utf8')); }
    catch { throw new BenchmarkError('PIPELINE_STATUS_UNAVAILABLE'); }
    if ((status as { status?: string })?.status !== 'complete') throw new BenchmarkError('PIPELINE_FAILED');
    if (sha256(await readFile(input.mediaPath)) !== input.sha256) throw new BenchmarkError('media_hash_mismatch');
    return artifactInventory(workDir);
  }
}
