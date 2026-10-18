import { readFile, readdir, lstat } from 'node:fs/promises';
import { join, relative, sep } from 'node:path';
import { BenchmarkError } from '../benchmark/registry.ts';
import { validateMembership, saltedHash, type Membership } from './membership.ts';
import { clearRoot } from './paths.ts';
export interface Finding { file: string; kind: 'eval_id' | 'source_sha256' | 'athlete_group'; count: number }
export function scanText(text: string, file: string, value: Membership): Finding[] {
  return scanValidatedText(text, file, validateMembership(value));
}
/** Internal only: callers must validate membership before entering the scan loop. */
function scanValidatedText(text: string, file: string, m: Membership): Finding[] {
  const findings: Finding[] = [];
  for (const [kind, pattern, hashes] of [
    ['eval_id', /eval_[a-f0-9]{16}/g, m.eval_id_hashes],
    ['source_sha256', /[a-f0-9]{64}/g, m.source_sha256_hashes],
    // Whole opaque tokens only: do not match a valid suffix within another identifier.
    ['athlete_group', /(?<![A-Za-z0-9_-])[a-z0-9][a-z0-9-]{7,63}(?![A-Za-z0-9_-])/g, m.athlete_group_hashes],
  ] as const) {
    const set = new Set(hashes);
    const count = [...text.matchAll(pattern)].filter(match => set.has(saltedHash(m.salt, kind, match[0]))).length;
    if (count) findings.push({ file, kind, count });
  }
  return findings;
}
export async function scanSealed(evalRoot: string, value: Membership) {
  const root = await clearRoot(evalRoot), membership = validateMembership(value), findings: Finding[] = [];
  async function walk(dir: string) {
    for (const name of (await readdir(dir)).sort()) {
      const path = join(dir, name), stat = await lstat(path), file = relative(root, path).split(sep).join('/');
      if (stat.isSymbolicLink()) throw new BenchmarkError('SEALED_SYMLINK_REFUSED');
      if (stat.isDirectory()) {
        // Directory names remain clear metadata, even below sealed/ or when empty.
        if (scanValidatedText(file, '', membership).length) throw new BenchmarkError('TEST_IDENTIFIER_IN_PATH');
        await walk(path);
      }
      else if (!stat.isFile()) throw new BenchmarkError('SEALED_SPECIAL_FILE_REFUSED');
      else if (!(file.startsWith('sealed/') && file.endsWith('.age'))) {
        findings.push(...scanValidatedText(await readFile(path, 'utf8'), file, membership));
        // Filenames are clear metadata too; never echo a matching value through a finding path.
        if (scanValidatedText(file, '', membership).length) throw new BenchmarkError('TEST_IDENTIFIER_IN_PATH');
      }
    }
  }
  await walk(root);
  return { clean: findings.length === 0, findings };
}
