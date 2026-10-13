import assert from 'node:assert/strict';
import { test } from 'node:test';
import { mkdtemp, mkdir, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createHash } from 'node:crypto';
import { compareEngineOutputs, compareEngineOutputDirectories, compareBaselineRuns, aggregateRepeatability, quantile, type Artifacts } from './compareEngineOutputs.js';

function fixture(): Artifacts {
  const meta = { n_frames: 100, fps: 30, width: 1920, height: 1080, keypoint_order: 'coco17' };
  const frames = Array.from({ length: 100 }, (_, frame) => ({ frame, time_s: frame / 30 }));
  const metrics: Record<string, any> = {
    pipeline_version: 'pose3d-live-1.0.0', n_frames: 100, fps: 30, contact: { frame: 50 },
    phases: Object.fromEntries(['stance', 'load', 'stride', 'contact', 'extension', 'follow_through'].map(p => [p, { frame: 50 }])),
    max_bat_speed: { value: 10 }, stride: { length_hip_widths: 1, direction_deg: 0 },
    movement_flags: { lateral_sway: { value: 1 }, wrist_lead_ms: { value: 0 } },
  };
  for (const name of ['attack_angle', 'hip_shoulder_separation', 'torso_tilt', 'pelvis_tilt', 'lead_elbow_angle', 'front_knee_angle', 'l_elbow_angle', 'r_elbow_angle']) metrics[`${name}_at_contact_deg`] = 10;
  return {
    'pose_2d.json': { meta, frames: frames.map(f => ({ ...f, keypoints: Array.from({ length: 17 }, () => [10, 20, 0.9]) })) },
    'bat_path.json': { meta, frames: frames.map(f => ({ ...f, tip: [1, 2], knob: [3, 4] })) },
    'pose_3d.json': { meta, frames: frames.map(f => ({ ...f, tracked: true, joints: Array.from({ length: 17 }, () => [1, 2, 3]), angles: { elbow_deg: 10 } })) },
    'metrics.json': metrics, 'pipeline_status.json': { status: 'complete', detail: { outcome: 'ok' } },
  };
}
const value = (a: Artifacts, key: keyof Artifacts): any => a[key];
test('identical complete artifacts are within configured scope, not provenance verified', () => {
  const result = compareEngineOutputs(fixture(), fixture());
  assert.equal(result.equivalent, true); assert.equal(result.provenanceVerified, false);
  assert.equal(result.keypoints.count, 1700); assert.equal(result.bat.tipAgreement, 1);
});
test('small differences and inclusive phase/keypoint/angle boundaries', () => {
  const a = fixture(), b = fixture();
  value(b, 'pose_2d.json').frames.forEach((f: any) => f.keypoints.forEach((p: number[]) => { p[0]! += 1; }));
  value(b, 'metrics.json').phases.load.frame++;
  value(b, 'metrics.json').attack_angle_at_contact_deg += 0.5;
  assert.equal(compareEngineOutputs(a, b).equivalent, true);
  value(b, 'metrics.json').attack_angle_at_contact_deg += 0.00001;
  assert.equal(compareEngineOutputs(a, b).equivalent, false);
});
test('contact disagreement and configurable exact threshold', () => {
  const a = fixture(), b = fixture();
  value(b, 'metrics.json').contact.frame++;
  value(b, 'metrics.json').phases.contact.frame++;
  assert.equal(compareEngineOutputs(a, b).contactDisplacement, 1);
  assert.equal(compareEngineOutputs(a, b).equivalent, false);
  assert.equal(compareEngineOutputs(a, b, { contactFrames: 1 }).equivalent, true);
});

test('directional angles use circular distance but preserve raw changes; joint angles stay linear', () => {
  const a = fixture(), b = fixture();
  value(a, 'metrics.json').stride.direction_deg = -179.9;
  value(b, 'metrics.json').stride.direction_deg = 179.9;
  const result = compareEngineOutputs(a, b);
  assert.equal(result.equivalent, true);
  assert.ok(result.metricDifferences['stride.direction_deg']!.absolute! < 0.21);
  assert.ok(result.metricDifferences['stride.direction_deg']!.rawAbsolute! > 359);
  value(b, 'metrics.json').front_knee_angle_at_contact_deg += 360;
  assert.equal(compareEngineOutputs(a, b).equivalent, false);
});
test('missing phases/artifacts in both runs cannot pass', () => {
  const a = fixture(); delete value(a, 'metrics.json').phases;
  assert.equal(compareEngineOutputs(a, a).equivalent, false);
  assert.equal(compareEngineOutputs({}, {}).equivalent, false);
  const b = fixture(); value(b, 'metrics.json').phases.load.frame = null;
  assert.equal(compareEngineOutputs(b, b).status, 'inconclusive');
});
test('intermittent bat availability boundary and absent coordinates', () => {
  const a = fixture(), b = fixture();
  value(b, 'bat_path.json').frames[0].tip = null;
  assert.equal(compareEngineOutputs(a, b).bat.tipAgreement, 0.99);
  assert.equal(compareEngineOutputs(a, b).equivalent, true);
  value(b, 'bat_path.json').frames[1].tip = null;
  assert.equal(compareEngineOutputs(a, b).equivalent, false);
  value(a, 'bat_path.json').frames.forEach((f: any) => { f.tip = null; f.knob = null; });
  assert.equal(compareEngineOutputs(a, a).status, 'inconclusive');
});
test('confidence filters both observations and includes exactly 0.5', () => {
  const a = fixture(), b = fixture();
  value(a, 'pose_2d.json').frames[0].keypoints[0] = [0, 0, 0.49];
  value(b, 'pose_2d.json').frames[0].keypoints[0] = [10000, 0, 0.49];
  assert.equal(compareEngineOutputs(a, b).keypoints.count, 1699);
  assert.equal(compareEngineOutputs(a, b).equivalent, true);
  value(b, 'pose_2d.json').frames[0].keypoints[0][2] = 0.5;
  assert.equal(compareEngineOutputs(a, b).keypoints.availabilityDisagreements, 1);
});
test('nonfinite metrics, nulls, zero denominators and symmetric differences', () => {
  for (const bad of [NaN, Infinity, -Infinity, 'NaN', null]) {
    const a = fixture(), b = fixture(); value(b, 'metrics.json').max_bat_speed.value = bad;
    assert.equal(compareEngineOutputs(a, b).equivalent, false);
  }
  const a = fixture(), b = fixture();
  value(b, 'metrics.json').movement_flags.wrist_lead_ms.value = 0.001;
  assert.equal(compareEngineOutputs(a, b).metricDifferences['movement_flags.wrist_lead_ms.value']?.relative, 1);
  assert.deepEqual(compareEngineOutputs(a, b).metricDifferences, compareEngineOutputs(b, a).metricDifferences);
});
test('invalid configuration and malformed observations fail closed', () => {
  for (const overrides of [{ confidence: 2 }, { keypointMedianPx: NaN }, { phaseFrames: -1 }, { batPresenceAgreement: 1.1 }]) {
    assert.throws(() => compareEngineOutputs(fixture(), fixture(), overrides));
  }
  const a = fixture(); value(a, 'pose_2d.json').frames[0].keypoints = [[1, 2, 0.9]];
  assert.equal(compareEngineOutputs(a, a).equivalent, false);
});
test('frame counts, frame identity and decoded domain mismatch are explicit', () => {
  for (const mutate of [(a: any) => a.frames.pop(), (a: any) => a.frames[0].frame++, (a: any) => a.meta.width++]) {
    const a = fixture(); mutate(value(a, 'pose_2d.json'));
    assert.equal(compareEngineOutputs(a, fixture()).equivalent, false);
  }
});
test('nearest rank percentile boundary', () => {
  assert.equal(quantile([], 0.99), null);
  assert.equal(quantile([...Array(99).fill(1), 100], 0.99), 1);
  assert.equal(quantile([...Array(98).fill(1), 8, 100], 0.99), 8);
});
test('missing files return opaque reasons without filesystem paths', async () => {
  const result = await compareEngineOutputDirectories('nonexistent-private-a', 'nonexistent-private-b');
  assert.equal(result.equivalent, false);
  assert.ok(!JSON.stringify(result).includes('nonexistent-private'));
});

test('runner provenance binds matching input/environment to artifact bytes and distinct runs', async t => {
  const root = await mkdtemp(join(tmpdir(), 'pr5-synthetic-'));
  t.after(() => rm(root, { recursive: true, force: true }));
  const dirs = [join(root, 'a'), join(root, 'b')];
  const records: any[] = [];
  for (const dir of dirs) {
    await mkdir(dir);
    const record: any = { schemaVersion: 1, status: 'complete', reused: false, sourceCommit: 'f79b09e63092e87efd1250c3b263d29086d81a79',
      pose3dTree: '766f4fbc64620d428da428e59b144554ca2f2a7b', tag: 'engine-baseline-1.0.0', environmentVersion: 'env-0123456789ab',
      input: { sha256: 'a'.repeat(64), bytes: 1 }, localEvaluationAuthorized: true, offlineHostAttested: true, artifacts: {} };
    for (const [name, artifact] of Object.entries(fixture())) {
      const bytes = Buffer.from(JSON.stringify(artifact));
      await writeFile(join(dir, name), bytes);
      record.artifacts[name] = { sha256: createHash('sha256').update(bytes).digest('hex'), bytes: bytes.length };
    }
    await writeFile(join(dir, 'run-record.json'), JSON.stringify(record)); records.push(record);
  }
  assert.equal((await compareBaselineRuns(dirs[0]!, dirs[1]!)).provenanceVerified, true);
  assert.equal((await compareBaselineRuns(dirs[0]!, dirs[0]!)).equivalent, false);
  for (const mutate of [(r: any) => { r.sourceCommit = 'HEAD'; }, (r: any) => { r.reused = true; },
    (r: any) => { r.input.sha256 = 'b'.repeat(64); }, (r: any) => { r.environmentVersion = 'env-abcdef012345'; }]) {
    const record = structuredClone(records[1]); mutate(record);
    await writeFile(join(dirs[1]!, 'run-record.json'), JSON.stringify(record));
    assert.equal((await compareBaselineRuns(dirs[0]!, dirs[1]!)).equivalent, false);
  }
  await writeFile(join(dirs[1]!, 'run-record.json'), JSON.stringify(records[1]));
  await writeFile(join(dirs[1]!, 'metrics.json'), '{}');
  assert.equal((await compareBaselineRuns(dirs[0]!, dirs[1]!)).provenanceVerified, false);
});

test('aggregate reports never imply empirical tolerance or accuracy from synthetic pairs', () => {
  const result = aggregateRepeatability([compareEngineOutputs(fixture(), fixture())]);
  assert.equal(result.allProvenanceVerified, false);
  assert.equal(result.empiricalToleranceStatus, 'not_established');
  assert.equal(result.accuracyClaim, false);
});
