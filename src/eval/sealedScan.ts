import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { BenchmarkError } from './benchmark/registry.ts';
import { safePath } from './score/inputs.ts';
import { clearRoot } from './sealed/paths.ts';
import { validateMembership } from './sealed/membership.ts';
import { scanSealed } from './sealed/scan.ts';
export async function main() {
  try {
    const root = await clearRoot(process.env.HITTERLOOP_EVAL_ROOT ?? '');
    const membership = validateMembership(JSON.parse(await readFile(await safePath(root, 'registry/test-membership.json'), 'utf8')));
    const result = await scanSealed(root, membership);
    process.stdout.write(JSON.stringify(result) + '\n'); if (!result.clean) process.exitCode = 1;
  } catch (e) { process.stderr.write((e instanceof BenchmarkError ? e.code : 'SEALED_SCAN_FAILED') + '\n'); process.exitCode = 1; }
}
if (process.argv[1] && pathToFileURL(resolve(process.argv[1])).href === import.meta.url) void main();
