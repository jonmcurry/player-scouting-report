import { mkdir, writeFile, readFile } from 'node:fs/promises';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { resolve } from 'node:path';
import { canonicalJson } from './benchmark/registry.ts';
import { safePath } from './score/inputs.ts';
import { argumentsFor } from './scoreRun.ts';
import { loadScored, compareRuns, regressions, renderComparison } from './report/compareRuns.ts';
import { publish } from './report/publish.ts';
import { DEFAULT_SEED } from './stats/clusterBootstrap.ts';
import { assertOutputSafe } from './report/renderRun.ts';
export async function compareRunsCli(root: string, repo: string, baseId: string, candidateId: string, publishSummary = false, seed = DEFAULT_SEED) {
  const base = await loadScored(root, repo, baseId), candidate = await loadScored(root, repo, candidateId);
  const c = compareRuns(base.metrics, candidate.metrics, seed); c.private.regressions = regressions(base.input, candidate.input);
  const template = await readFile(new URL('../../eval/templates/comparison-report.md', import.meta.url), 'utf8');
  const json = assertOutputSafe(canonicalJson(c) + '\n'), report = assertOutputSafe(renderComparison(c, template));
  const summary = publishSummary ? assertOutputSafe(publish(c, base.metrics, candidate.metrics)) : null;
  const dir = await safePath(base.input.root, 'results', `compare-${baseId}-${candidateId}`);
  await mkdir(dir);
  await writeFile(await safePath(base.input.root, dir, 'comparison.json'), json, { flag: 'wx' });
  await writeFile(await safePath(base.input.root, dir, 'report.md'), report, { flag: 'wx' });
  if (summary !== null) await writeFile(await safePath(base.input.root, dir, 'summary.md'), summary, { flag: 'wx' });
  return c;
}
if (process.argv[1] && pathToFileURL(resolve(process.argv[1])).href === import.meta.url) {
  try { const a = argumentsFor(process.argv.slice(2), ['--base', '--candidate', '--seed'], ['--publish-summary']); await compareRunsCli(process.env.HITTERLOOP_EVAL_ROOT ?? '', fileURLToPath(new URL('../../', import.meta.url)), a['--base'] ?? '', a['--candidate'] ?? '', a['--publish-summary'] === 'true', a['--seed'] === undefined ? DEFAULT_SEED : Number(a['--seed'])); console.log('Compared scored runs. Outputs remain in EVAL_ROOT.'); }
  catch (e) { console.error(e instanceof Error && /^[A-Z][A-Z0-9_]+$/.test(e.message) ? e.message : 'COMPARISON_FAILED'); process.exitCode = 1; }
}
