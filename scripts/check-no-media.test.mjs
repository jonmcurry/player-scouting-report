import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFileSync, spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { checkNoMedia, formatMediaCheck, readAssetAllowlist } from './check-no-media.mjs';

const hash = data => createHash('sha256').update(data).digest('hex');
function repository(t) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'no-media-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const git = (...args) => execFileSync('git', ['-C', root, ...args], { stdio: ['pipe', 'pipe', 'pipe'] });
  git('init', '-q');
  const put = (name, body = 'synthetic test bytes') => {
    fs.mkdirSync(path.dirname(path.join(root, name)), { recursive: true });
    fs.writeFileSync(path.join(root, name), body);
  };
  const stage = (name, body) => { put(name, body); git('add', '-f', '--', name); };
  return { root, git, put, stage };
}

test('repository contains only explicitly approved static media and synthetic fixtures', () => {
  const result = checkNoMedia();
  assert.ok(result.checked > 100);
  assert.deepEqual(result.violations, []);
});

for (const name of [
  'videos/recording.txt', 'FRAMES/player/pose.json', 'Eval-Data/labels.JSON', 'nested/EVAL-RESULTS/result.csv',
  'nested/GoLdEn/output.json', 'eval/results/opaque.bin', 'DEMO-EXPORT/fixture.json', 'scripts/POSE_OUT/output.dat',
  'coach/media/clip.json', 'outside/clip.MP4', 'outside/clip.MoV', 'outside/clip.WEBM',
  'outside/still.JPEG', 'outside/still.HeIc', 'outside/still.PnG', 'coach/assets/new-image.webp',
  'docs/contact_sheet.svg', 'outside/ANALYSIS_RESULT_123.JSON', 'outside/METRICS.json',
  'outside/FRAME_MAP.json', 'outside/clip.validation.json', 'DEMO-CURATION-private.JSON',
  'validation/private-manifest.JSON', 'outside/space and\nnewline.MP4', 'outside/clip.MP4.bak', 'outside/still.PNG.txt',
  'outside/clip.MP4_bak', 'outside/clip.mp4-old', 'outside/clip.mp4\tbackup',
]) test(`force-added prohibited file case ${hash(name).slice(0, 8)}`, { skip: process.platform === 'win32' && /[\n\t]/.test(name) }, t => {
  const r = repository(t);
  r.put('.gitignore', '*\n');
  r.stage(name);
  const result = checkNoMedia(r.root, new Map());
  assert.equal(result.violations.length, 1);
  assert.equal(result.violations[0].ref, hash(name).slice(0, 12));
  const output = formatMediaCheck(result);
  assert.ok(!output.includes(name) && !output.includes('synthetic test bytes'));
  assert.match(output, /git rm --cached/);
  // Restoring/removing the working file does not hide the staged object.
  fs.unlinkSync(path.join(r.root, name));
  assert.equal(checkNoMedia(r.root, new Map()).violations.length, 1);
});

test('exact assets are hash bound in both index and working copy; no directory allowance', t => {
  const r = repository(t);
  const name = 'coach/icons/static.svg';
  const content = '<svg xmlns="http://www.w3.org/2000/svg"/>';
  const assets = readAssetAllowlist({ schemaVersion: 1, assets: [{ path: name, sha256: hash(content), reason: 'Synthetic static test asset' }] });
  r.stage(name, content);
  assert.deepEqual(checkNoMedia(r.root, assets).violations, []);
  r.put(name, 'replacement');
  assert.equal(checkNoMedia(r.root, assets).violations[0].code, 'ASSET_CONTENT_CHANGED_ON_DISK');
  r.git('add', '--', name); r.put(name, content);
  assert.equal(checkNoMedia(r.root, assets).violations[0].code, 'ASSET_CONTENT_CHANGED_IN_INDEX');
  r.stage('coach/icons/another.svg', content);
  assert.ok(checkNoMedia(r.root, assets).violations.some(v => v.code === 'UNAPPROVED_MEDIA'));
});

test('asset aliases, symlinks and nonempty placeholders are rejected', { skip: process.platform === 'win32' }, t => {
  const r = repository(t);
  r.put('synthetic.txt', 'synthetic');
  fs.symlinkSync('synthetic.txt', path.join(r.root, 'icon.png'));
  r.git('add', '--', 'icon.png');
  const assets = readAssetAllowlist({ schemaVersion: 1, assets: [{ path: 'icon.png', sha256: hash('synthetic.txt'), reason: 'Synthetic fixture' }] });
  assert.equal(checkNoMedia(r.root, assets).violations[0].code, 'ASSET_PATH_OR_MODE_CHANGED');
  r.stage('frames/.gitkeep', 'must be empty');
  assert.ok(checkNoMedia(r.root, assets).violations.some(v => v.code === 'ASSET_CONTENT_CHANGED_IN_INDEX'));
});

test('approved path casing cannot authorize another indexed spelling', t => {
  const r = repository(t);r.stage('icon.PNG', 'synthetic');
  const assets = readAssetAllowlist({ schemaVersion: 1, assets: [{ path: 'icon.png', sha256: hash('synthetic'), reason: 'Synthetic fixture' }] });
  assert.equal(checkNoMedia(r.root, assets).violations[0].code, 'ASSET_PATH_OR_MODE_CHANGED');
});

test('approved SVG text tolerates only CRLF checkout conversion', t => {
  const r = repository(t);const name = 'icon.svg';const content = '<svg>\n</svg>\n';
  const assets = readAssetAllowlist({ schemaVersion: 1, assets: [{ path: name, sha256: hash(content), reason: 'Synthetic' }] });
  r.stage(name, content);r.put(name, content.replaceAll('\n', '\r\n'));
  assert.deepEqual(checkNoMedia(r.root, assets).violations, []);
  r.put(name, content.replace('</svg>', '<image/></svg>'));
  assert.equal(checkNoMedia(r.root, assets).violations[0].code, 'ASSET_CONTENT_CHANGED_ON_DISK');
});

test('source, synthetic JSON annotations and empty approved placeholders remain allowed', t => {
  const r = repository(t);
  r.stage('src/example.ts', 'export const example = true;');
  r.stage('eval/schema/examples/synthetic.json', '{"data_origin":"synthetic"}');
  r.stage('frames/.gitkeep', '');r.stage('videos/.gitkeep', '');
  assert.deepEqual(checkNoMedia(r.root, new Map()).violations, []);
});

test('wildcards, private directories, duplicate paths, missing hashes and reasons cannot widen the allowlist', () => {
  const entry = { path: 'coach/icon.png', sha256: hash('synthetic'), reason: 'Synthetic' };
  for (const patch of [{ path: 'coach/*.png' }, { path: 'eval-data/clip.png' }, { path: '../icon.png' }, { path: '/icon.png' }, { sha256: '' }, { reason: '' }]) {
    assert.throws(() => readAssetAllowlist({ schemaVersion: 1, assets: [{ ...entry, ...patch }] }));
  }
  assert.throws(() => readAssetAllowlist({ schemaVersion: 1, assets: [entry, { ...entry, path: 'COACH/ICON.PNG' }] }));
  assert.throws(() => readAssetAllowlist({ schemaVersion: 2, assets: [] }));
});

test('no checkout cannot silently pass the guard', t => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'no-media-invalid-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  assert.throws(() => checkNoMedia(root, new Map()), /could not inspect/);
});

test('gitignore covers evaluation input, results and nested goldens, including mixed case', t => {
  const r = repository(t);
  r.put('.gitignore', fs.readFileSync(new URL('../.gitignore', import.meta.url), 'utf8'));
  for (const name of ['eval-data/a.json', 'EVAL-DATA/a.json', 'eval-results/a.csv', 'nested/Eval-Results/a.csv', 'nested/GoLdEn/a.bin', 'eval/media/a.png', 'Eval/Media/a.png', 'eval/Results/a.json', 'EVAL/DATA/a.json']) {
    assert.ok(r.git('check-ignore', '--', name).length > 0);
  }
  const ignored = spawnSync('git', ['-C', r.root, 'check-ignore', '--stdin', '-z'], { input: 'eval/schema/examples/synthetic.json\0' });
  assert.equal(ignored.status, 1);
  assert.equal(ignored.stdout.length, 0);
});

test('imported media guard defaults to its own checkout regardless of caller directory', t => {
  const r = repository(t);
  const url = new URL('./check-no-media.mjs', import.meta.url).href;
  const script = `const {checkNoMedia}=await import(${JSON.stringify(url)}); console.log(checkNoMedia().checked);`;
  assert.ok(Number(execFileSync(process.execPath, ['--input-type=module', '-e', script], { cwd: r.root, encoding: 'utf8' })) > 100);
});
