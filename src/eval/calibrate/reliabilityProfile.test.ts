import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { dataset, inputs, observation, observations } from './testing/fixtures.ts';
import { buildProfile, estimateEntries, verifyProfile, profileDigest } from './reliabilityProfile.ts';
import { eligibleDataset, loadScoredInputs } from './eligibility.ts';
import { canonicalJson } from '../benchmark/registry.ts';
import { disk, writeRun, repo } from '../score/testing/fixtures.ts';
import { assembleMetrics } from '../score/metrics.ts';
import { calibrate, renderCalibration } from '../calibrateCli.ts';
import { lookupReliability, validReliabilityEntry } from '../../services/development/evidence/reliability.ts';

const contact = (rows: ReturnType<typeof observations>, seed = 1) => estimateEntries(rows, seed).entries.find(e => e.concept === 'contact')!;
test('hand-computed point estimate; unknown passes excluded and counted', () => {
  const rows = observations(10, 10); rows[0]!.evidence.identity = 'wrong'; rows[1]!.evidence.visibility = 'wrong';
  rows[2]!.evidence.identity = 'unknown';
  const e = contact(rows); assert.equal(e.observed_unsafe_rate, 2 / 99); assert.equal(e.n_swings, 99); assert.equal(e.n_unmeasurable, 1);
});
test('D8 statuses and cluster rule of three, including insufficient sample', () => {
  const within = contact(observations(20, 5)); assert.equal(within.status, 'inconclusive'); assert.equal(within.reason, 'coverage_not_preregistered'); assert.equal(within.upper_bound_95, 3 / (100 / 1.4));
  const small = contact(observations(4, 5)); assert.equal(small.status, 'inconclusive'); assert.equal(small.reason, 'insufficient_sample');
  const unsafe = observations(10, 10); unsafe.slice(0, 6).forEach(o => o.evidence.identity = 'wrong');
  assert.equal(contact(unsafe).status, 'exceeds_ceiling'); assert.equal(contact(unsafe).observed_unsafe_rate, 0.06);
  const zero = observations(5, 1).map(o => ({ ...o, v3: 'unknown' as const }));
  assert.equal(contact(zero).status, 'unmeasured'); assert.equal(contact(zero).n_swings, 0); assert.equal(contact(zero).n_unmeasurable, 5);
  assert.equal(contact([observation()]).upper_bound_95, 1);
});
test('point estimate above ceiling wins over a small sample, with its own reason', () => {
  const rows = observations(2, 1); rows[0]!.evidence.identity = 'wrong';
  const e = contact(rows);
  assert.equal(e.n_athletes, 2); assert.equal(e.observed_unsafe_rate, 0.5);
  assert.equal(e.status, 'exceeds_ceiling'); assert.equal(e.reason, 'point_estimate_exceeds_ceiling');
  assert.equal(validReliabilityEntry(e), true);
  assert.equal(contact(observations(20, 5)).reason, 'coverage_not_preregistered');
});
test('camera slices remain separate and disabled concepts not applicable', () => {
  const rows = observations(20, 5); rows.push(observation(500, { capture_profile: 'other' }));
  const entries = estimateEntries(rows).entries;
  assert.equal(entries.find(e => e.concept === 'contact' && e.capture_profile === 'other')!.status, 'inconclusive');
  assert.equal(entries.find(e => e.concept === 'contact' && e.capture_profile === 'game_backstop')!.n_swings, 100);
  assert.equal(entries.find(e => e.concept === 'timing')!.status, 'not_applicable');
});
test('capture profiles with no observed swings still get explicit unmeasured entries', () => {
  const entries = estimateEntries([], 1, ['game_backstop']).entries;
  assert.equal(entries.find(e => e.concept === 'contact')!.status, 'unmeasured');
  assert.equal(entries.find(e => e.concept === 'timing')!.status, 'not_applicable');
  assert.ok(entries.every(e => e.n_swings === 0));
});
test('confidence is counted but cannot affect estimates', () => {
  const rows = observations(), before = estimateEntries(rows);
  rows.forEach((o, i) => o.engine_confidence = i % 2);
  const after = estimateEntries(rows); assert.deepEqual(before.entries, after.entries); assert.deepEqual(before.causes, after.causes);
  assert.equal(after.engine_confidence_present, rows.length);
});
test('identical bytes, date changes version/digest, seed changes nondegenerate CI', async () => {
  const d = await dataset(), rows = observations(17, 7);
  rows.forEach((o, i) => { if (i % 11 === 0 || i < 19) o.evidence.identity = 'wrong'; });
  const a = buildProfile(d, '2026-10-18', 1, rows), b = buildProfile(d, '2026-10-18', 1, rows);
  assert.equal(canonicalJson(a), canonicalJson(b));
  assert.notEqual(a.profile_digest, buildProfile(d, '2026-10-19', 1, rows).profile_digest);
  assert.notEqual(a.version, buildProfile(d, '2026-10-19', 1, rows).version);
  const changed = buildProfile(d, '2026-10-18', 200, rows);
  assert.notDeepEqual(a.entries.find(e => e.concept === 'contact')!.ci95, changed.entries.find(e => e.concept === 'contact')!.ci95);
  assert.throws(() => buildProfile(d, '2026-02-30'), /INVALID_DATE/);
  assert.throws(() => buildProfile(d, '2026-10-18', -1), /INVALID_SEED/);
});
test('profile integrity, source change, no registration, synthetic prevention', async () => {
  const d = await dataset(), p = buildProfile(d, '2026-10-18', 1, observations());
  assert.deepEqual(verifyProfile(p), { valid: true, registration: 'not_registered' });
  assert.equal(lookupReliability('contact', p.tuple, 'game_backstop', [p]).status, 'unmeasured');
  for (const key of Object.keys(p)) {
    const changed = structuredClone(p) as any;
    if (key === 'provenance') changed.provenance.seed++;
    else if (key === 'entries') changed.entries[0].reason = 'tampered';
    else if (key === 'tuple') changed.tuple.environmentVersion = 'env-000000000001';
    else changed[key] = 'tampered';
    assert.throws(() => verifyProfile(changed), key);
  }
  const changed = structuredClone(p); changed.provenance.sources[0]!.results_digest = 'b'.repeat(64);
  assert.throws(() => verifyProfile(changed), /PROFILE_DIGEST_MISMATCH/);
  const unknown = structuredClone(p); unknown.tuple = { ...unknown.tuple, environmentVersion: 'env-000000000001' }; unknown.profile_digest = profileDigest(unknown);
  assert.throws(() => verifyProfile(unknown), /TUPLE_NOT_REGISTERED/);
  assert.equal(p.decision_status, 'experimental');
  d.data_origin = 'private_consented'; assert.throws(() => buildProfile(d, '2026-10-18', 1, observations()), /SYNTHETIC_INJECTION_ONLY/);
});
test('real-shaped PR13 input produces no measured active concepts and no private IDs in output', async () => {
  const i = await inputs(), d = eligibleDataset([i]), p = buildProfile(d, '2026-10-18');
  assert.ok(p.entries.length > 0);
  assert.ok(p.entries.every(e => e.status === 'unmeasured' || e.status === 'not_applicable'));
  const bytes = canonicalJson(p) + renderCalibration(p);
  for (const value of [i.clips[0]!.registry.eval_id, i.clips[0]!.registry.athlete_group, i.run.run_id, 'C:\\Users\\', '/tmp/']) assert.ok(!bytes.includes(value));
  assert.match(renderCalibration(p), /SYNTHETIC DATA/);
  assert.match(renderCalibration(p), /not production acceptance; not registered/);
});
test('file-only CLI requires scored verified inputs, writes private deterministic files, refuses overwrite', async () => {
  const v = await inputs(), f = await disk(v.clips);
  try {
    f.input.run = v.run; await writeRun(f.input);
    await assert.rejects(loadScoredInputs(f.root, repo, v.run.run_id), /SCORED_RUN_REQUIRED/);
    // Re-load so annotation_digest reflects the actual synthetic annotation bytes.
    const { loadInputs } = await import('../score/inputs.ts');
    const loaded = await loadInputs(f.root, repo, v.run.run_id);
    const metrics = assembleMetrics(loaded, 1);
    const metricPath = join(loaded.directory, 'metrics.json'); await writeFile(metricPath, canonicalJson(metrics));
    const p = await calibrate(f.root, repo, [v.run.run_id], [], '2026-10-18');
    const dir = join(f.root, 'calibration', p.version);
    assert.equal(await readFile(join(dir, 'profile.json'), 'utf8'), canonicalJson(p) + '\n');
    const payload = await readFile(join(dir, 'measurement-payloads.json'), 'utf8');
    assert.match(payload, /requires_human_reviewer_ids_at_persistence/);
    assert.match(await readFile(join(dir, 'report.md'), 'utf8'), /not registered/);
    for (const name of ['profile.json', 'measurement-payloads.json', 'report.md']) {
      const bytes = await readFile(join(dir, name), 'utf8');
      for (const id of [v.clips[0]!.registry.eval_id, v.clips[0]!.registry.athlete_group, f.root]) assert.ok(!bytes.includes(id));
    }
    await assert.rejects(calibrate(f.root, repo, [v.run.run_id], [], '2026-10-18'), /CALIBRATION_ALREADY_EXISTS/);
    metrics.results_digest = 'f'.repeat(64); await writeFile(metricPath, canonicalJson(metrics));
    await assert.rejects(loadScoredInputs(f.root, repo, v.run.run_id), /METRICS_INPUTS_MISMATCH/);
    await assert.rejects(calibrate(repo, repo, [v.run.run_id], [], '2026-10-18'), /EVAL_ROOT_INSIDE_REPOSITORY/);
  } finally { await f.cleanup(); }
});
