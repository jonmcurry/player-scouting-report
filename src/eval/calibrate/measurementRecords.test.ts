import test from 'node:test';
import assert from 'node:assert/strict';
import { measurementRecords } from './measurementRecords.ts';
import { buildProfile } from './reliabilityProfile.ts';
import { dataset, observations } from './testing/fixtures.ts';
import { sha256 } from '../benchmark/registry.ts';

test('00055 file payloads have experimental decisions, null reviewer IDs, no display visibility', async () => {
  const d = await dataset(), p = buildProfile(d, '2026-10-18', 42);
  const annotations = d.inputs.flatMap(i => i.clips.map(c => c.annotation!));
  const payload = measurementRecords(p, annotations);
  assert.equal(payload.requires_human_reviewer_ids_at_persistence, true); assert.equal(payload.records.length, p.entries.length);
  for (const { measurement_definition: m, validation_decision: v } of payload.records) {
    assert.match(m.slug, /^[a-z][a-z0-9_]*$/); assert.equal(m.version, p.schema_version); assert.equal(m.created_by, null);
    assert.equal(v.decided_by, null); assert.equal(v.status, 'experimental'); assert.deepEqual(m.visibility, []);
    assert.equal(m.source_class, 'video_estimated'); assert.equal(m.unit, 'fraction'); assert.equal(m.aggregate_min_sample, null);
    assert.deepEqual(m.compatibility_rules.tuple, p.tuple); assert.match(m.uncertainty_method, /2000 replicates, seed 42/);
    assert.ok(m.sports.every(s => ['baseball', 'softball'].includes(s))); assert.ok(m.intents.length > 0);
    assert.ok(m.prohibited_interpretations.includes('engine confidence is not reliability'));
  }
});
test('(slug, version) is unique across capture profiles, matching the 00055 unique constraint', async () => {
  const d = await dataset();
  const rows = [...observations(20, 5), ...observations(20, 5).map((o, i) => ({ ...o, capture_profile: 'other',
    clip_hash: o.clip_hash.replace(/.$/, 'f'), swing_hash: sha256(`other-${i}`) }))];
  const p = buildProfile(d, '2026-10-18', 1, rows);
  const base = d.inputs.flatMap(i => i.clips.map(c => c.annotation!));
  const as = (profile: 'game_backstop' | 'other') => base.map(a => ({ ...structuredClone(a), camera: { ...a.camera, capture_profile: profile } }));
  const payload = measurementRecords(p, [...base, ...as('game_backstop'), ...as('other')]);
  const keys = payload.records.map(r => `${r.measurement_definition.slug}@${r.measurement_definition.version}`);
  assert.ok(new Set(p.entries.map(e => e.capture_profile)).size >= 2);
  assert.equal(new Set(keys).size, keys.length);
  assert.ok(keys.includes('reliability_contact_game_backstop@1.2.0') && keys.includes('reliability_contact_other@1.2.0'));
});
test('unknown sport refused, known intents retained; unknown stays unknown', async () => {
  const d = await dataset(), p = buildProfile(d, '2026-10-18'), a = d.inputs[0]!.clips[0]!.annotation!;
  a.sport = 'unknown'; assert.throws(() => measurementRecords(p, [a]), /SPORT_UNAVAILABLE/);
  a.sport = 'softball'; a.swings.forEach(s => s.intent = 'unknown');
  assert.deepEqual(measurementRecords(p, [a]).records[0]!.measurement_definition.intents, ['unknown']);
});
