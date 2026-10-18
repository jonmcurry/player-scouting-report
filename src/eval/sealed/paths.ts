import { lstat, readdir, realpath } from 'node:fs/promises';
import { resolve, parse, relative, sep, join, isAbsolute } from 'node:path';
import { fileURLToPath } from 'node:url';
import { BenchmarkError } from '../benchmark/registry.ts';
import { evalRoot, inside, safePath } from '../score/inputs.ts';
export const repositoryRoot = fileURLToPath(new URL('../../../', import.meta.url));
export async function noLinks(path: string) {
  let cursor = parse(resolve(path)).root;
  for (const part of relative(cursor, resolve(path)).split(sep).filter(Boolean)) {
    cursor = join(cursor, part);
    try { if ((await lstat(cursor)).isSymbolicLink()) throw new BenchmarkError('SEALED_SYMLINK_REFUSED'); }
    catch (e) { if ((e as NodeJS.ErrnoException).code === 'ENOENT') break; throw e; }
  }
}
export async function clearRoot(path: string) {
  await noLinks(path);
  return evalRoot(path, repositoryRoot);
}
export async function sealedPlacement(path: string, root: string, repo = repositoryRoot) {
  try {
    if (!isAbsolute(path)) throw new Error();
    await noLinks(path);
    const actual = await realpath(path), repository = await realpath(repo);
    if (!(await lstat(actual)).isDirectory() || inside(repository, actual) || inside(actual, repository) || inside(root, actual) || inside(actual, root)) throw new Error();
    return actual;
  } catch { throw new BenchmarkError('SEALED_ROOT_PLACEMENT'); }
}
export async function sealedWritePath(root: string, path: string) {
  try { await noLinks(root); return await safePath(root, path); }
  catch { throw new BenchmarkError('UNENCRYPTED_PER_CLIP_WRITE_REFUSED'); }
}
export async function inspectTree(root: string) {
  await noLinks(root);
  for (const name of await readdir(root)) {
    const path = join(root, name), stat = await lstat(path);
    if (stat.isSymbolicLink()) throw new BenchmarkError('SEALED_SYMLINK_REFUSED');
    if (stat.isDirectory()) await inspectTree(path);
    else if (!stat.isFile()) throw new BenchmarkError('SEALED_SPECIAL_FILE_REFUSED');
  }
}
