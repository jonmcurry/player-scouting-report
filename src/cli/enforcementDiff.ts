/**
 * PR17 (S1-12) enforcement dry-run diff CLI. Read-only and aggregate-only.
 *
 *   npm run enforcement:diff -- --confirm-dry-run --enforced-concepts contact --out <dir outside repo>
 *     --psql-container <container> --database <name>_disposable_test
 *
 * The only built-in reader is `docker exec psql` against a database whose name ends in
 * `_disposable_test`. Reading a hosted project requires a separately authorized reader;
 * this tool never writes to any database and never changes flags, reports or focus.
 */
import { execFileSync } from 'node:child_process';
import { mkdir, realpath, writeFile } from 'node:fs/promises';
import { isAbsolute, join, relative, resolve, sep } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { enforcementDiff, renderEnforcementDiff, type DiffFocus, type DiffRun } from '../services/development/evidence/enforcementDiff.js';
import { DIFF_INPUTS_QUERY, mapDiffInputs } from '../services/development/evidence/enforcementReadModel.js';

export type DiffReader = () => Promise<{ runs: DiffRun[]; focus: DiffFocus[] }>;
const DISPOSABLE = /^[a-z0-9_]+_disposable_test$/;
const inside = (root: string, child: string) => { const r = relative(root, child); return r === '' || (!r.startsWith(`..${sep}`) && r !== '..' && !isAbsolute(r)); };

export function disposablePsqlReader(container: string, database: string): DiffReader {
  if (!/^[a-zA-Z0-9][a-zA-Z0-9_.-]*$/.test(container) || !DISPOSABLE.test(database)) throw new Error('DISPOSABLE_DATABASE_REQUIRED');
  return async () => mapDiffInputs(JSON.parse(execFileSync('docker', ['exec', '-i', container, 'psql', '-X', '-qAt', '-v', 'ON_ERROR_STOP=1',
    '-U', 'postgres', '-d', database], { input: `begin read only; ${DIFF_INPUTS_QUERY} rollback;`, encoding: 'utf8', stdio: ['pipe', 'pipe', 'pipe'] }).trim()));
}
export async function runEnforcementDiff(args: { confirm: boolean; enforcedConcepts: string[]; out: string; repoRoot: string; reader: DiffReader }) {
  if (!args.confirm) throw new Error('DRY_RUN_CONFIRMATION_REQUIRED');
  if (!args.out || !isAbsolute(args.out)) throw new Error('OUT_MUST_BE_ABSOLUTE');
  const repo = await realpath(args.repoRoot);
  if (inside(repo, resolve(args.out))) throw new Error('OUT_INSIDE_REPOSITORY');
  const { runs, focus } = await args.reader();
  const diff = await enforcementDiff(runs, focus, args.enforcedConcepts);
  await mkdir(args.out, { recursive: true });
  if (inside(repo, await realpath(args.out))) throw new Error('OUT_INSIDE_REPOSITORY');
  await writeFile(join(args.out, 'enforcement-diff.json'), JSON.stringify(diff, null, 2) + '\n', { flag: 'wx' });
  await writeFile(join(args.out, 'enforcement-diff.md'), renderEnforcementDiff(diff), { flag: 'wx' });
  return diff;
}
if (process.argv[1] && pathToFileURL(resolve(process.argv[1])).href === import.meta.url) {
  const value = (flag: string) => { const i = process.argv.indexOf(flag); return i >= 0 ? process.argv[i + 1] : undefined; };
  try {
    const diff = await runEnforcementDiff({ confirm: process.argv.includes('--confirm-dry-run'),
      enforcedConcepts: (value('--enforced-concepts') ?? '').split(',').filter(Boolean), out: value('--out') ?? '',
      repoRoot: fileURLToPath(new URL('../../', import.meta.url)),
      reader: disposablePsqlReader(value('--psql-container') ?? '', value('--database') ?? '') });
    console.log(`Dry-run diff written (digest ${diff.digest}). Nothing was enforced.`);
  } catch (e) { console.error(e instanceof Error && /^[A-Z][A-Z0-9_]+$/.test(e.message) ? e.message : 'ENFORCEMENT_DIFF_FAILED'); process.exitCode = 1; }
}
