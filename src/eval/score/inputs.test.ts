import test from 'node:test';
import assert from 'node:assert/strict';
import { writeFile, readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { loadInputs, evalRoot } from './inputs.ts';
import { disk, repo, writeRun } from './testing/fixtures.ts';
test('load verified PR13-shaped run without media; refuse digest, schema, test split, registry drift', async () => {
  const d = await disk();
  try {
    const load = () => loadInputs(d.root, repo, d.input.run.run_id);
    assert.equal((await load()).clips.length, 1);
    await writeFile(join(d.input.directory, 'failures.jsonl'), '{}\n'); await assert.rejects(load, /RUN_DIGEST_MISMATCH/); await writeRun(d.input);
    d.input.run.schema_version = '2'; await writeRun(d.input); await assert.rejects(load, /UNSUPPORTED_RUN_SCHEMA/);
    d.input.run.schema_version = '1.0.0'; d.input.run.config.split = 'test'; await writeRun(d.input); await assert.rejects(load, /TEST_SPLIT_REQUIRES_SEALED_ENVIRONMENT/);
    d.input.run.config.split = 'dev'; await writeRun(d.input);
    const path = join(d.root, 'registry', 'clips.jsonl'), bytes = await readFile(path, 'utf8'); await writeFile(path, bytes.replace('group-00000001', 'group-00000002')); await assert.rejects(load, /REGISTRY_CHANGED_SINCE_RUN/);
  } finally { await d.cleanup(); }
});
test('annotation hash and source mismatch fail closed; roots and traversal rejected', async () => {
  const d = await disk();
  try {
    const load = () => loadInputs(d.root, repo, d.input.run.run_id), path = join(d.root, 'annotations', '1.0.0', d.input.clips[0]!.registry.eval_id, 'ann_0000000000000001.json');
    const a = JSON.parse(await readFile(path, 'utf8')); await writeFile(path, JSON.stringify(a) + '\n'); await assert.rejects(load, /ANNOTATION_CHANGED_SINCE_RUN/);
    a.source.sha256 = 'f'.repeat(64); await writeFile(path, JSON.stringify(a)); await assert.rejects(load, /SOURCE_HASH_MISMATCH/);
    await assert.rejects(evalRoot(repo, repo), /EVAL_ROOT_INSIDE_REPOSITORY/); await assert.rejects(evalRoot('relative', repo), /EVAL_ROOT_MUST_BE_ABSOLUTE/);
    await assert.rejects(loadInputs(d.root, repo, '../escape'), /INVALID_RUN_ID/);
  } finally { await d.cleanup(); }
});
test('unsupported clip schema, duplicate clip lists and missing paired annotation refused', async () => {
  const d = await disk();
  try {
    const load = () => loadInputs(d.root, repo, d.input.run.run_id), c = d.input.clips[0]!;
    c.record.schema_version = '2'; await writeRun(d.input); await assert.rejects(load, /UNSUPPORTED_RECORD_SCHEMA/);
    c.record.schema_version = '1.0.0'; delete c.record.annotation; await writeRun(d.input); await assert.rejects(load, /INVALID_PAIRED_RECORD/);
    d.input.clips.push(c); await writeRun(d.input); await assert.rejects(load, /CLIP_LIST_MISMATCH/);
  } finally { await d.cleanup(); }
});
