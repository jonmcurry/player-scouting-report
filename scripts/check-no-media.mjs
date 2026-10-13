import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { readFileSync, lstatSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const policyPath = new URL('./media-asset-allowlist.json', import.meta.url);
const REPO_ROOT = fileURLToPath(new URL('../', import.meta.url));
const sha256 = bytes => createHash('sha256').update(bytes).digest('hex');
const MEDIA = /\.(?:mp4|m4v|mov|webm|avi|mkv|mpeg|mpg|mts|m2ts|3gp|3g2|wmv|flv|ogv|vob|mxf|png|jpe?g|webp|gif|svg|avif|heic|heif|bmp|tiff?|dng|raw|ico|apng|jxl|mp3|m4a|wav|aac|flac|ogg|opus)(?:$|[^a-z0-9])/i;
// .ts is a source suffix in this repository, so transport-stream media is
// covered by the private-directory policy rather than a global suffix ban.
const isMedia = name => MEDIA.test(name);
const PRIVATE_DIR = /(?:^|\/)(?:videos|frames|eval-data|eval-results|golden|demo-export|pose_out)(?:\/|$)|(?:^|\/)eval\/(?:media|data|results)(?:\/|$)|^coach\/media(?:\/|$)/i;
const PRIVATE_RESULT = /(?:^|\/)(?:analysis_result[^/]*|pose_[23]d|metrics|engine_manifest|frame_map|privacy_summary|[^/]+\.(?:summary|validation))\.(?:json|jsonl|csv|npy|npz|html)(?:\.[^/]*)?$|(?:^|\/)demo-curation[^/]*\.json$|^validation\/.*manifest.*\.json$/i;
const KEEP = new Set(['frames/.gitkeep', 'videos/.gitkeep']);
// PR5 source files only; the surrounding golden directory remains private.
const GOLDEN_SOURCE = new Set(['src/eval/golden/compareEngineOutputs.ts', 'src/eval/golden/compareEngineOutputs.test.ts']);

function git(root, args) {
  try { return execFileSync('git', ['--no-replace-objects', '-C', root, ...args], { stdio: ['ignore', 'pipe', 'pipe'], maxBuffer: 64 * 1024 * 1024 }); }
  catch { throw new Error('Media guard could not inspect the Git index. Run from a complete Git checkout; details suppressed for privacy.'); }
}

/** Exact, reviewed static assets only. No directory, wildcard or private-output exception. */
export function readAssetAllowlist(policy = JSON.parse(readFileSync(policyPath, 'utf8'))) {
  if (policy?.schemaVersion !== 1 || !Array.isArray(policy.assets)) throw new Error('Invalid media asset allowlist.');
  const assets = new Map();
  for (const entry of policy.assets) {
    if (!entry || typeof entry.path !== 'string' || entry.path !== path.posix.normalize(entry.path) ||
        /[\\\0*?\[\]]/.test(entry.path) || entry.path.startsWith('/') || entry.path.startsWith('../') ||
        PRIVATE_DIR.test(entry.path) || !/^[a-f0-9]{64}$/.test(entry.sha256 ?? '') ||
        typeof entry.reason !== 'string' || !entry.reason.trim() || assets.has(entry.path.toLowerCase())) {
      throw new Error('Invalid or duplicate media asset allowlist entry; exact paths, hashes and review reasons are required.');
    }
    assets.set(entry.path.toLowerCase(), entry);
  }
  return assets;
}

/** The index is authoritative even if an ignored file was force-added or removed on disk.
 * Only allowlisted assets/placeholders are read; prohibited content is never opened. */
export function checkNoMedia(root = REPO_ROOT, assets = readAssetAllowlist()) {
  const index = git(root, ['ls-files', '--stage', '-z']).toString('utf8').split('\0').filter(Boolean);
  const violations = [];
  for (const record of index) {
    const match = /^(\d+) ([a-f0-9]+) ([0-3])\t([\s\S]+)$/.exec(record);
    if (!match) throw new Error('Media guard encountered an unreadable index entry.');
    const [, mode, oid, stage, name] = match;
    const ref = sha256(name).slice(0, 12); // paths themselves may contain child names
    const reject = code => violations.push({ ref, code });
    if (stage !== '0') { reject('UNMERGED_INDEX'); continue; }
    const approved = assets.get(name.toLowerCase());
    if (KEEP.has(name) || approved) {
      const expected = KEEP.has(name) ? sha256('') : approved.sha256;
      if (!['100644', '100755'].includes(mode) || (approved && approved.path !== name)) {
        reject('ASSET_PATH_OR_MODE_CHANGED'); continue;
      }
      if (sha256(git(root, ['cat-file', 'blob', oid])) !== expected) reject('ASSET_CONTENT_CHANGED_IN_INDEX');
      try {
        const full = path.join(root, name);
        // A symlinked ancestor must not redirect the read into private storage.
        let current = root;
        for (const segment of name.split('/')) {
          current = path.join(current, segment);
          if (lstatSync(current).isSymbolicLink()) throw new Error('symlink');
        }
        if (!lstatSync(full).isFile()) throw new Error('not a regular file');
        const bytes = readFileSync(full);
        // Git may use CRLF text checkouts on Windows. Only this byte-preserving
        // newline conversion is permitted; image binaries must match exactly.
        const same = sha256(bytes) === expected || (/\.(svg|json)$/.test(name) && sha256(bytes.toString('utf8').replaceAll('\r\n', '\n')) === expected);
        if (!same) reject('ASSET_CONTENT_CHANGED_ON_DISK');
      } catch { reject('ASSET_UNREADABLE_ON_DISK'); }
    } else if (mode === '160000') reject('UNINSPECTED_SUBMODULE');
    else if (GOLDEN_SOURCE.has(name) && ['100644', '100755'].includes(mode)) { /* reviewed source path */ }
    else if (PRIVATE_DIR.test(name)) reject('PRIVATE_DIRECTORY');
    else if (isMedia(name)) reject('UNAPPROVED_MEDIA');
    else if (PRIVATE_RESULT.test(name)) reject('PRIVATE_RESULT');
  }
  return { checked: index.length, violations };
}

export function formatMediaCheck(result) {
  if (!result.violations.length) return `Media guard passed (${result.checked} indexed entries).`;
  return [
    'Media guard rejected indexed files (paths and contents suppressed):',
    ...result.violations.map(v => `  ${v.ref}: ${v.code}`),
    'Inspect git ls-files locally; refs are the first 12 hex characters of SHA-256 of each repository-relative path.',
    'Remove private files from the index with git rm --cached -- <path> (keeps the local file); store them outside Git.',
    'Changed/new static assets require an explicit privacy review and an exact hash entry in scripts/media-asset-allowlist.json.',
    'Do not paste private paths, media, or per-clip results into CI logs, PR text, or coding-agent context.',
  ].join('\n');
}

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  try {
    const result = checkNoMedia();
    console.log(formatMediaCheck(result));
    if (result.violations.length) process.exitCode = 1;
  } catch {
    console.error('Media guard could not verify the index/allowlist. Check the checkout and policy locally; details suppressed for privacy.');
    process.exitCode = 1;
  }
}
