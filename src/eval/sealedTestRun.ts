import { Command } from 'commander';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { BenchmarkError } from './benchmark/registry.ts';
import { BaselineAdapter } from './benchmark/engineAdapter.ts';
import { repositoryRoot } from './sealed/paths.ts';
import { ageCliEncryptor } from './sealed/encryption.ts';
import { runSealedTest } from './sealed/testMode.ts';
export async function main(argv = process.argv) {
  const program = new Command().name('eval:sealed-test').requiredOption('--split <split>')
    .requiredOption('--sealed-root <path>').requiredOption('--release-candidate <version>')
    .requiredOption('--operator <opaque>').requiredOption('--recipient <public-key>');
  program.configureOutput({ writeErr: () => {} }).exitOverride();
  try {
    program.parse(argv); const o = program.opts();
    if (o.split !== 'test') throw new BenchmarkError('TEST_REGISTRY_SPLIT_REQUIRED');
    const result = await runSealedTest({ evalRoot: process.env.HITTERLOOP_EVAL_ROOT ?? '', sealedRoot: o.sealedRoot,
      releaseCandidate: o.releaseCandidate, operator: o.operator, encryptor: ageCliEncryptor(o.recipient),
      adapter: new BaselineAdapter(repositoryRoot), now: () => new Date().toISOString(), env: process.env });
    process.stdout.write(JSON.stringify(result) + '\n');
    process.stderr.write('Destroy the decrypted registry-test.jsonl, media/, annotations/ and any interrupted results in the sealed root.\n');
  } catch (e) {
    if ((e as { code?: string }).code === 'commander.helpDisplayed') return;
    process.stderr.write((e instanceof BenchmarkError ? e.code : 'SEALED_TEST_FAILED') + '\n'); process.exitCode = 1;
  }
}
if (process.argv[1] && pathToFileURL(resolve(process.argv[1])).href === import.meta.url) void main();
