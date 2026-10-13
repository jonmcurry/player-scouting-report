// Existing environment only: never install Python, packages, models or FFmpeg.
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
const cwd = fileURLToPath(new URL('../', import.meta.url));
const candidates = process.platform === 'win32'
  ? [path.join(cwd, '.venv_pose3d/Scripts/python.exe'), 'python', 'py', 'python3']
  : [path.join(cwd, '.venv_pose3d/bin/python'), 'python3', 'python'];
const python = candidates.find(p => spawnSync(p, ['-c',
  'import cv2,numpy,scipy; import sys; sys.exit(0 if sys.version_info >= (3,9) else 1)'],
  { cwd, stdio: 'ignore' }).status === 0);
if (!python) {
  console.error('inst-1 synthetic tests require existing Python 3.9+, OpenCV, NumPy, SciPy and FFmpeg/FFprobe. Nothing was installed.');
  process.exitCode = 1;
} else {
  const result = spawnSync(python, ['-m', 'unittest', 'discover', '-s', 'scripts/tests/inst1', '-p', 'test_*.py'],
    { cwd, stdio: 'inherit' });
  process.exitCode = result.status ?? 1;
}
