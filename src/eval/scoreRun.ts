import { writeFile, lstat } from 'node:fs/promises';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { resolve } from 'node:path';
import { canonicalJson } from './benchmark/registry.ts';
import { loadInputs, safePath } from './score/inputs.ts';
import { assembleMetrics } from './score/metrics.ts';
import { renderRun, assertOutputSafe } from './report/renderRun.ts';
import { DEFAULT_SEED } from './stats/clusterBootstrap.ts';
export async function scoreRun(root: string, repo: string, id: string, seed = DEFAULT_SEED) {
  const input = await loadInputs(root, repo, id), m = assembleMetrics(input, seed);
  const json = assertOutputSafe(canonicalJson(m) + '\n'), report = renderRun(m);
  const paths = await Promise.all(['metrics.json', 'report.md'].map(n => safePath(input.root, 'results', id, n)));
  for (const path of paths) { try { await lstat(path); throw new Error('RESULT_ALREADY_EXISTS'); } catch (e) { if ((e as NodeJS.ErrnoException).code !== 'ENOENT') throw e; } }
  await writeFile(paths[0]!, json, { flag: 'wx' });
  await writeFile(paths[1]!, report, { flag: 'wx' }); return m;
}
export function argumentsFor(args: string[], names: string[], flags: string[] = []) {
  const result: Record<string, string> = {};
  for (let i = 0; i < args.length; i++) { const key = args[i]!; if ((!names.includes(key) && !flags.includes(key)) || key in result) throw new Error('INVALID_ARGUMENTS');
    if (flags.includes(key)) result[key] = 'true'; else { const value = args[++i]; if (!value || value.startsWith('--')) throw new Error('INVALID_ARGUMENTS'); result[key] = value; } }
  return result;
}
if (process.argv[1] && pathToFileURL(resolve(process.argv[1])).href === import.meta.url) {
  try { const a = argumentsFor(process.argv.slice(2), ['--run', '--seed']); await scoreRun(process.env.HITTERLOOP_EVAL_ROOT ?? '', fileURLToPath(new URL('../../', import.meta.url)), a['--run'] ?? '', a['--seed'] === undefined ? DEFAULT_SEED : Number(a['--seed'])); console.log('Scored run. Private outputs remain in EVAL_ROOT.'); }
  catch (e) { console.error(e instanceof Error && /^[A-Z][A-Z0-9_]+$/.test(e.message) ? e.message : 'SCORING_FAILED'); process.exitCode = 1; }
}
