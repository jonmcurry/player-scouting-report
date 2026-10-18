import test from 'node:test';
import assert from 'node:assert/strict';
import { parseRegistry, registryExclusion } from './registry.ts';
import { registryClip } from './testing/fixtures.ts';
const parse = (rows: unknown[], header: unknown = { registry_version: 1 }) => parseRegistry([header, ...rows].map(v => JSON.stringify(v)).join('\n') + '\n');
test('registry validates and sorts; consent and withdrawal exclude', () => {
  const a = registryClip(), b = registryClip('eval_0000000000000002', 'a'.repeat(64));
  assert.deepEqual(parse([b, a]), [a, b]); assert.equal(registryExclusion(a), null);
  a.consent.eval_annotation = false; assert.equal(registryExclusion(a), 'consent_eval_annotation_missing');
  a.status = 'withdrawn'; assert.equal(registryExclusion(a), 'withdrawn');
});
for (const [name, rows, code] of [
  ['duplicate id', [registryClip(), registryClip()], 'DUPLICATE_EVAL_ID'],
  ['duplicate hash', [registryClip(), registryClip('eval_0000000000000002')], 'DUPLICATE_SHA256'],
  ['split leakage', [registryClip(), { ...registryClip('eval_0000000000000002', 'a'.repeat(64)), split: 'validation' }], 'ATHLETE_GROUP_SPANS_SPLITS'],
  ['test split', [{ ...registryClip(), split: 'test' }], 'TEST_SPLIT_IN_CLEAR_REGISTRY'],
  ['unknown key', [{ ...registryClip(), name: 'private' }], 'REGISTRY_UNKNOWN_KEYS'],
  ['bad hash', [registryClip('eval_0000000000000001', 'bad')], 'REGISTRY_INVALID_FIELDS'],
  ['bad id', [registryClip('../private')], 'REGISTRY_INVALID_FIELDS'],
  ['bad consent', [{ ...registryClip(), consent: null }], 'REGISTRY_INVALID_FIELDS'],
  ['unknown consent key', [{ ...registryClip(), consent: { ...registryClip().consent, name: 'private' } }], 'REGISTRY_UNKNOWN_KEYS'],
  ['PR3 ID required', [registryClip('clip-00000001')], 'REGISTRY_INVALID_FIELDS'],
  ['uppercase ID forbidden', [registryClip('eval_A000000000000001')], 'REGISTRY_INVALID_FIELDS'],
  ['unknown status', [{ ...registryClip(), status: 'pending' }], 'REGISTRY_INVALID_FIELDS'],
  ['unknown extension', [{ ...registryClip(), media_ext: 'avi' }], 'REGISTRY_INVALID_FIELDS'],
] as const) test(name, () => assert.throws(() => parse([...rows]), { message: code }));
test('unsupported registry and malformed JSON fail closed', () => {
  assert.throws(() => parse([], { registry_version: 2 }), { message: 'UNSUPPORTED_REGISTRY_VERSION' });
  assert.throws(() => parseRegistry('private text'), { message: 'REGISTRY_INVALID_JSON' });
});
