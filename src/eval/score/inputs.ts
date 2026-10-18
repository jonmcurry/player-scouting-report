import { readFile, realpath, lstat } from 'node:fs/promises';
import { join, resolve, relative, isAbsolute, sep } from 'node:path';
import { parseRegistry, canonicalJson, sha256, BenchmarkError, EVAL_ID, type RegistryClip } from '../benchmark/registry.ts';
import { loadAnnotation } from '../benchmark/annotations.ts';
import type { pairObservations } from '../benchmark/pairing.ts';
import type { runGates } from '../benchmark/gates.ts';
import type { ClipAnnotation } from '../schema/annotation.ts';
export type Pairing = ReturnType<typeof pairObservations>;
export interface ClipRecord {
  schema: string; schema_version: string; eval_id: string; status: 'paired' | 'excluded'; exclusion?: string;
  annotation?: { sha256: string }; pairing?: Pairing; gates?: Awaited<ReturnType<typeof runGates>>;
  artifacts?: unknown;
  terminal?: { environment: { environment_version: string | null } };
}
export interface Run {
  schema: string; schema_version: string; runner_version: string; run_id: string; results_digest: string;
  registry_sha256: string; clip_list_sha256: string; clip_count: number; config: { split: string };
  engine_version: string; preflight: { environment_version: string | null }; repeatability: unknown;
  models_lock_sha256?: string; requirements_lock_sha256?: string; git_commit?: string;
  tuples?: Record<string, unknown>[];
}
export interface InputClip { record: ClipRecord; registry: RegistryClip; annotation: ClipAnnotation | null }
export interface Inputs { root: string; directory: string; run: Run; clips: InputClip[]; failures: { eval_id: string; code: string }[]; annotation_digest: string }
export const inside = (root: string, path: string) => { const r = relative(root, path); return r === '' || (r !== '..' && !r.startsWith(`..${sep}`) && !isAbsolute(r)); };
export async function safePath(root: string, ...parts: string[]) {
  const path = resolve(root, ...parts);
  if (!inside(root, path)) throw new BenchmarkError('EVAL_PATH_ESCAPE');
  let cursor = root;
  for (const part of relative(root, path).split(sep).filter(Boolean)) {
    cursor = join(cursor, part);
    try { if ((await lstat(cursor)).isSymbolicLink()) throw new BenchmarkError('EVAL_PATH_ESCAPE'); }
    catch (e) { if ((e as NodeJS.ErrnoException).code === 'ENOENT') break; throw e; }
  }
  return path;
}
export async function evalRoot(value: string, repo: string) {
  if (!value || !isAbsolute(value)) throw new BenchmarkError('EVAL_ROOT_MUST_BE_ABSOLUTE');
  const repository = await realpath(repo);
  if (inside(repository, resolve(value))) throw new BenchmarkError('EVAL_ROOT_INSIDE_REPOSITORY');
  const root = await realpath(value);
  if (inside(repository, root)) throw new BenchmarkError('EVAL_ROOT_INSIDE_REPOSITORY');
  return root;
}
export function runId(id: string) { if (!/^run-[a-f0-9]{16}$/.test(id)) throw new BenchmarkError('INVALID_RUN_ID'); return id; }
export function digestRun(run: Run, perClip: string, failures: string) {
  const { timing: _t, results_digest: _d, ...rest } = run as Run & { timing?: unknown };
  return sha256(canonicalJson(rest) + perClip + failures);
}
export async function loadInputs(value: string, repo: string, id: string): Promise<Inputs> {
  const root = await evalRoot(value, repo), directory = await safePath(root, 'results', runId(id));
  const read = async (file: string) => readFile(await safePath(root, 'results', id, file), 'utf8');
  const [runBytes, perClip, failureBytes] = await Promise.all([read('run.json'), read('per_clip.jsonl'), read('failures.jsonl')]);
  const run: Run = JSON.parse(runBytes);
  if (run.schema !== 'hitterloop.benchmark-run' || run.schema_version !== '1.0.0' || run.runner_version !== 'bench-1.0.0') throw new BenchmarkError('UNSUPPORTED_RUN_SCHEMA');
  if (run.config.split === 'test') throw new BenchmarkError('TEST_SPLIT_REQUIRES_SEALED_ENVIRONMENT');
  if (!['dev', 'validation'].includes(run.config.split) || run.run_id !== id) throw new BenchmarkError('INVALID_RUN');
  if (digestRun(run, perClip, failureBytes) !== run.results_digest) throw new BenchmarkError('RUN_DIGEST_MISMATCH');
  const registry = parseRegistry(await readFile(await safePath(root, 'registry', 'clips.jsonl'), 'utf8'));
  if (sha256(canonicalJson({ registry_version: 1, clips: registry })) !== run.registry_sha256) throw new BenchmarkError('REGISTRY_CHANGED_SINCE_RUN');
  const lines = (s: string) => s.trim() ? s.trimEnd().split('\n').map(line => JSON.parse(line)) : [];
  const records: ClipRecord[] = lines(perClip), failures: Inputs['failures'] = lines(failureBytes);
  const ids = records.map(r => r.eval_id);
  if (new Set(ids).size !== ids.length || records.length !== run.clip_count || sha256(canonicalJson([...ids].sort())) !== run.clip_list_sha256) throw new BenchmarkError('CLIP_LIST_MISMATCH');
  const clips: InputClip[] = [], hashes: Record<string, string> = {};
  for (const record of records) {
    if (record.schema !== 'hitterloop.benchmark-clip' || record.schema_version !== '1.0.0' || !EVAL_ID.test(record.eval_id) || !['paired', 'excluded'].includes(record.status)) throw new BenchmarkError('UNSUPPORTED_RECORD_SCHEMA');
    const clip = registry.find(c => c.eval_id === record.eval_id);
    if (!clip || clip.split !== run.config.split) throw new BenchmarkError('REGISTRY_RECORD_MISMATCH');
    let annotation: ClipAnnotation | null = null;
    if (record.annotation) {
      await safePath(root, 'annotations', '1.0.0', clip.eval_id);
      const loaded = await loadAnnotation(root, clip);
      if (!loaded.ok || loaded.identity.sha256 !== record.annotation.sha256) throw new BenchmarkError(loaded.ok || loaded.code !== 'source_hash_mismatch' ? 'ANNOTATION_CHANGED_SINCE_RUN' : 'SOURCE_HASH_MISMATCH');
      annotation = loaded.annotation; hashes[clip.eval_id] = loaded.identity.sha256;
    }
    if (record.status === 'paired' && (!annotation || !record.pairing || !record.gates)) throw new BenchmarkError('INVALID_PAIRED_RECORD');
    clips.push({ record, registry: clip, annotation });
  }
  if (failures.some(f => !ids.includes(f.eval_id) || typeof f.code !== 'string')) throw new BenchmarkError('INVALID_FAILURE_RECORD');
  return { root, directory, run, clips, failures, annotation_digest: sha256(canonicalJson(hashes)) };
}
