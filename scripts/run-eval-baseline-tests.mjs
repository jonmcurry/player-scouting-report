// Standard-library-only Python tests; never provision an environment or install packages.
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const cwd = fileURLToPath(new URL('../', import.meta.url));
const candidates = process.platform === 'win32' ? ['python', 'py', 'python3'] : ['python3', 'python'];
const python = candidates.find(candidate => spawnSync(candidate, ['-c',
  'import sys; sys.exit(0 if sys.version_info >= (3, 9) else 1)'], { cwd, stdio: 'ignore' }).status === 0);
if (!python) {
  console.error('PR5 synthetic tests require an existing Python 3.9+ interpreter; none was installed.');
  process.exitCode = 1;
} else {
  const result = spawnSync(python, ['-m', 'unittest', 'discover', '-s', 'src/eval/environment', '-p', 'test_environment.py'], { cwd, stdio: 'inherit' });
  process.exitCode = result.status ?? 1;
}
