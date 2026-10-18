import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { loadAnnotation } from './annotations.ts';
import { sha256 } from './registry.ts';
import { annotationFixture, registryClip, tempRoot, cleanup, writeAnnotation } from './testing/fixtures.ts';
test('single annotator bytes and adjudicated preference; missing and unadjudicated', async () => {
  const root = await tempRoot();
  try {
    const a = await annotationFixture(), c = registryClip(a.eval_clip_id, a.source.sha256);
    assert.equal((await loadAnnotation(root, c)).ok, false);
    await writeAnnotation(root, a);
    const single = await loadAnnotation(root, c); assert.ok(single.ok);
    assert.equal(single.identity.annotation_basis, 'single_annotator');
    assert.equal(single.identity.sha256, sha256(await readFile(join(root, 'annotations/1.0.0', c.eval_id, 'ann_0000000000000001.json'))));
    await writeAnnotation(root, a, 'ann_0000000000000002.json');
    assert.equal((await loadAnnotation(root, c) as { code: string }).code, 'annotation_unadjudicated');
    await writeAnnotation(root, a, 'adjudicated.json');
    const selected = await loadAnnotation(root, c); assert.ok(selected.ok); assert.equal(selected.identity.annotation_basis, 'adjudicated');
  } finally { await cleanup(root); }
});
for (const mode of ['schema', 'hash', 'source', 'clip'] as const) test(`annotation rejection: ${mode}`, async () => {
  const root = await tempRoot();
  try {
    const a = await annotationFixture(), c = registryClip(a.eval_clip_id, a.source.sha256);
    if (mode === 'schema') Object.assign(a, { schema_version: '2.0.0' });
    if (mode === 'hash') c.sha256 = 'b'.repeat(64);
    if (mode === 'source') a.source.frame_count++;
    await writeAnnotation(root, a);
    if (mode === 'clip') {
      a.eval_clip_id = 'eval_0000000000000002';
      const { writeFile } = await import('node:fs/promises');
      await writeFile(join(root, 'annotations/1.0.0', c.eval_id, 'ann_0000000000000001.json'), JSON.stringify(a));
    }
    const result = await loadAnnotation(root, c); assert.ok(!result.ok);
    assert.equal(result.code, { schema: 'UNSUPPORTED_ANNOTATION_SCHEMA', hash: 'source_hash_mismatch', source: 'annotation_invalid', clip: 'annotation_clip_mismatch' }[mode]);
  } finally { await cleanup(root); }
});
