import { execFile } from 'node:child_process';
import { BenchmarkError } from '../benchmark/registry.ts';
export interface Encryptor { readonly id: string; encrypt(plaintext: Uint8Array): Promise<Uint8Array> }
export function ageCliEncryptor(recipient: string, env: NodeJS.ProcessEnv = process.env): Encryptor {
  if (!/^age1[02-9ac-hj-np-z]{58}$/.test(recipient)) throw new BenchmarkError('INVALID_AGE_RECIPIENT');
  return { id: 'age-cli', encrypt: plaintext => new Promise((resolve, reject) => {
    try {
      const child = execFile('age', ['-r', recipient], { env, encoding: 'buffer', windowsHide: true, maxBuffer: 256 * 1024 * 1024 }, (error, stdout) => {
        if (error) return reject(new BenchmarkError((error as NodeJS.ErrnoException).code === 'ENOENT' ? 'AGE_UNAVAILABLE' : 'AGE_ENCRYPTION_FAILED'));
        if (!stdout.length || stdout.equals(Buffer.from(plaintext))) return reject(new BenchmarkError('AGE_ENCRYPTION_FAILED'));
        resolve(stdout);
      });
      child.stdin?.on('error', () => { /* execFile callback owns the fixed error. */ });
      child.stdin?.end(plaintext);
    } catch (error) { reject(new BenchmarkError((error as NodeJS.ErrnoException).code === 'ENOENT' ? 'AGE_UNAVAILABLE' : 'AGE_ENCRYPTION_FAILED')); }
  }) };
}
/** Deterministic regular-file POSIX ustar; deliberately refuses long/unsafe names. */
export function tarBundle(files: Record<string, Uint8Array>): Uint8Array {
  const chunks: Buffer[] = [];
  for (const name of Object.keys(files).sort()) {
    if (!/^[a-zA-Z0-9][a-zA-Z0-9._/-]*$/.test(name) || name.split('/').some(p => !p || p === '..' || p === '.') || Buffer.byteLength(name) > 100) throw new BenchmarkError('INVALID_TAR_NAME');
    const data = Buffer.from(files[name]!), header = Buffer.alloc(512);
    const octal = (offset: number, size: number, value: number) => {
      const s = value.toString(8); if (s.length >= size) throw new BenchmarkError('TAR_SIZE_OVERFLOW');
      header.write(s.padStart(size - 1, '0') + '\0', offset, size, 'ascii');
    };
    header.write(name, 0, 100, 'utf8'); octal(100, 8, 0o644); octal(108, 8, 0); octal(116, 8, 0);
    octal(124, 12, data.length); octal(136, 12, 0); header.fill(32, 148, 156); header[156] = 48;
    header.write('ustar\0', 257, 6, 'ascii'); header.write('00', 263, 2, 'ascii');
    const sum = header.reduce((a, b) => a + b, 0); header.write(sum.toString(8).padStart(6, '0') + '\0 ', 148, 8, 'ascii');
    chunks.push(header, data, Buffer.alloc((512 - data.length % 512) % 512));
  }
  chunks.push(Buffer.alloc(1024)); return Buffer.concat(chunks);
}
