import { Command } from 'commander';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { resolve } from 'node:path';
import { BaselineAdapter } from './benchmark/engineAdapter.ts';
import { runBenchmark } from './benchmark/runner.ts';
import { BenchmarkError } from './benchmark/registry.ts';

export async function main(argv = process.argv) {
  const program = new Command().name('eval:run').requiredOption('--engine <version>').requiredOption('--split <split>')
    .option('--repeat <count>').option('--clips <ids>').option('--no-cache').option('--allow-dirty')
    .option('--allow-unverified-environment').option('--release-candidate').option('--coverage-preregistration <path>');
  // Commander diagnostics can echo user-provided paths. Only emit fixed errors.
  program.configureOutput({ writeErr: () => {} }).exitOverride();
  try {
    program.parse(argv);
    const o = program.opts(), repoRoot = fileURLToPath(new URL('../../', import.meta.url));
    const run = await runBenchmark({ evalRoot: process.env.HITTERLOOP_EVAL_ROOT ?? '', repoRoot,
      engine: o.engine, split: o.split, ...(o.repeat === undefined ? {} : { repeat: Number(o.repeat) }),
      clips: o.clips?.split(','), cache: o.cache, allowDirty: o.allowDirty, allowUnverifiedEnvironment: o.allowUnverifiedEnvironment,
      releaseCandidate: o.releaseCandidate, ...(o.coveragePreregistration === undefined ? {} : { coveragePreregistration: o.coveragePreregistration }) }, new BaselineAdapter(repoRoot));
    process.stdout.write(run.run_id + '\n');
  } catch (e) {
    if ((e as { code?: string }).code === 'commander.helpDisplayed') return;
    process.stderr.write((e instanceof BenchmarkError ? e.code : 'BENCHMARK_FAILED') + '\n'); process.exitCode = 1;
  }
}
if (process.argv[1] && pathToFileURL(resolve(process.argv[1])).href === import.meta.url) void main();
