import { mkdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { registryClip, tempRoot, cleanup, FakeEngineAdapter, annotationFixture, writeAnnotation } from '../../benchmark/testing/fixtures.ts';
import { canonicalJson } from '../../benchmark/registry.ts';
import { buildMembership, type TestClip } from '../membership.ts';
import type { Encryptor } from '../encryption.ts';
export { cleanup, tempRoot };
/** TEST ONLY: reversible XOR is not encryption and must never protect actual test data. */
export class FakeEncryptor implements Encryptor {
  readonly id = 'test-only-xor';
  async encrypt(bytes: Uint8Array) { return Buffer.concat([Buffer.from('TEST-ONLY'), Buffer.from(bytes.map(b => b ^ 0xa5))]); }
}
export const clock = () => '2026-01-01T00:00:00.000Z';
export const testClip = (): TestClip => ({ ...registryClip(), split: 'test' });
export const membership = () => buildMembership([testClip()], 'd'.repeat(64));
export async function setup() {
  const root = await tempRoot(), sealed = await tempRoot(), clip = testClip();
  await mkdir(join(root, 'registry')); await mkdir(join(sealed, 'media')); await mkdir(join(sealed, 'annotations'));
  await writeFile(join(root, 'registry/clips.jsonl'), '{"registry_version":1}\n');
  await writeFile(join(root, 'registry/test-membership.json'), canonicalJson(membership()) + '\n');
  await writeFile(join(sealed, 'registry-test.jsonl'), [{ registry_version: 1 }, clip].map(canonicalJson).join('\n') + '\n');
  await writeFile(join(sealed, 'media', clip.eval_id + '.mp4'), 'synthetic media');
  const annotation = await annotationFixture(); annotation.eval_clip_id = clip.eval_id; annotation.source.sha256 = clip.sha256;
  await writeAnnotation(sealed, annotation);
  const adapter = new FakeEngineAdapter();
  return { root, sealed, clip, adapter, options: { evalRoot: root, sealedRoot: sealed, releaseCandidate: adapter.engineVersion,
    operator: 'operator-0001', encryptor: new FakeEncryptor(), adapter, now: clock, env: { HITTERLOOP_SEALED_ENVIRONMENT: '1' } },
    cleanup: async () => { await cleanup(root); await cleanup(sealed); } };
}
