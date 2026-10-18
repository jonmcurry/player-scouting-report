import { readFile, open, mkdir, rm } from 'node:fs/promises';
import { BenchmarkError, canonicalJson, sha256, HASH } from '../benchmark/registry.ts';
import { safePath } from '../score/inputs.ts';
import { clearRoot } from './paths.ts';
export interface AccessInput { operator: string; engine: string; release_candidate: string; config_sha256: string; membership_digest: string }
const opaque = /^[a-zA-Z0-9][a-zA-Z0-9._-]{7,63}$/;
export function validateAccess(input: AccessInput, at: string) {
  if ([input.operator, input.engine, input.release_candidate, input.config_sha256, input.membership_digest].some(v => typeof v !== 'string') || typeof at !== 'string' || !opaque.test(input.operator) || !opaque.test(input.engine) || input.release_candidate !== input.engine ||
    !HASH.test(input.config_sha256) || !HASH.test(input.membership_digest) ||
    !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/.test(at) || !Number.isFinite(Date.parse(at)) || new Date(at).toISOString() !== at) throw new BenchmarkError('ACCESS_INVALID_FIELDS');
}
export async function readAccess(root: string) {
  const path = await safePath(root, 'registry/test-access.jsonl');
  let text: string;
  try { text = await readFile(path, 'utf8'); }
  catch (e) { if ((e as NodeJS.ErrnoException).code === 'ENOENT') return { previous: '0'.repeat(64) }; throw e; }
  let previous = '0'.repeat(64);
  try {
    if (text && !text.endsWith('\n')) throw new Error();
    for (const line of text ? text.slice(0, -1).split('\n') : []) {
      const v = JSON.parse(line);
      if (Object.keys(v).sort().join(',') !== 'at,config_sha256,engine,membership_digest,operator,previous_line_sha256,release_candidate,schema,schema_version' ||
        v.schema !== 'hitterloop.test-access' || v.schema_version !== '1.0.0' || v.previous_line_sha256 !== previous || canonicalJson(v) !== line) throw new Error();
      validateAccess(v, v.at); previous = sha256(line);
    }
  } catch { throw new BenchmarkError('ACCESS_LOG_CHAIN_BROKEN'); }
  return { previous };
}
/** Serializes cooperating processes; a crash leaves a lock for owner investigation. */
export async function withAccessLock<T>(root: string, action: () => Promise<T>): Promise<T> {
  const path = await safePath(root, 'registry/test-access.lock');
  let handle;
  try { handle = await open(path, 'wx', 0o600); }
  catch (e) { if ((e as NodeJS.ErrnoException).code === 'EEXIST') throw new BenchmarkError('ACCESS_LOG_BUSY'); throw e; }
  try { return await action(); } finally { await handle.close(); await rm(path); }
}
export async function appendAccess(evalRoot: string, input: AccessInput, now: () => string) {
  const root = await clearRoot(evalRoot), at = now(); validateAccess(input, at);
  if (Object.keys(input).sort().join(',') !== 'config_sha256,engine,membership_digest,operator,release_candidate') throw new BenchmarkError('ACCESS_INVALID_FIELDS');
  await mkdir(await safePath(root, 'registry'), { recursive: true });
  return withAccessLock(root, async () => {
    const state = await readAccess(root);
    const line = canonicalJson({ schema: 'hitterloop.test-access', schema_version: '1.0.0', ...input, at, previous_line_sha256: state.previous });
    const handle = await open(await safePath(root, 'registry/test-access.jsonl'), 'a', 0o600);
    try { await handle.writeFile(line + '\n'); await handle.sync(); } finally { await handle.close(); }
    const record_sha256 = sha256(line);
    return { record_sha256, publicLine: `| ${at} | ${input.engine} | ${record_sha256} |` };
  });
}
