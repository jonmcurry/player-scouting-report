import test from 'node:test';
import assert from 'node:assert/strict';
import { unmeasured } from './unmeasured.ts';
test('unmeasured retained explicitly with reasons and null values', () => { const m = unmeasured(); assert.equal(m.length, 30); for (const x of m) { assert.equal(x.status, 'unmeasured'); assert.equal(x.value, null); assert.ok(x.reason); } });
