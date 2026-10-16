import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { normalizeEngineOutputs as normalizeOutputs, normalizeEngineOutputDirectory as normalizeDirectory, canonicalJson, type NormalizationInput, type NormalizationResult } from './engineObservations.ts';
import { COCO_17 } from '../schema/annotation.ts';
import { BASELINE_ENGINE, LEGACY_PIPELINE_VERSION, INITIAL_EVIDENCE_TUPLE } from '../../services/development/evidenceRegistry.ts';
import { observedTuple } from '../../services/development/evidence/shadowAssessment.ts';

function checked(result: NormalizationResult): NormalizationResult {
  if (result.ok) {
    const o = result.observations;
    for (const identity of [...o.frames.map(f => f.identity), ...Object.values(o.events).flatMap(e => e.estimates.map(x => x.identity))]) {
      assert.equal(identity.reasons.includes(''), false, 'frame/event identity must not contain an empty-string reason');
    }
  }
  return result;
}
async function normalizeEngineOutputs(input: NormalizationInput) { return checked(await normalizeOutputs(input)); }
async function normalizeEngineOutputDirectory(dir: string) { return checked(await normalizeDirectory(dir)); }

async function digest(s: string) {
  return [...new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(s)))].map(b => b.toString(16).padStart(2, '0')).join('');
}
function fixture(n = 4) {
  const meta = { fps: 30, width: 100, height: 80, n_frames: n, keypoint_order: 'coco17', video: 'Z:/synthetic-only/never-a-real-video.mp4', bat_evidence: { used_fallback: false, track_frames: n, bat_evidence_frames: n } };
  return {
    pose2d: { meta: { ...meta }, frames: Array.from({ length: n }, (_, frame) => ({ frame, time_s: 999, keypoints: Array.from({ length: 17 }, () => [10.1234, 20.5678, 0.001]) as unknown })) },
    batPath: { meta: { ...meta }, frames: Array.from({ length: n }, (_, frame) => ({ frame, tip: [10, 20] as unknown, knob: [30, 40] as unknown, conf: 0.02 as unknown, track_id: -1 })) },
    metrics: { pipeline_version: LEGACY_PIPELINE_VERSION, detector_version: 'synthetic-1', contact: { frame: 1, time_s: 123, method: 'triple_product', confidence: 'low' }, phases: {} as Record<string, unknown>, swing_detection: { status: 'detected', confidence: 'high' } },
    pipelineStatus: { status: 'complete', detail: { outcome: 'ok' } },
  };
}
function frameMap(pts = [0, 10, 20, 30]) {
  return { schema_version: 1, instrumentation_version: 'inst-1', run_id: 'a'.repeat(32), input_sha256: 'b'.repeat(64), attempt_number: 0,
    status: 'verified', verified: true, reasons: [] as string[], frames: pts.map((raw_pts, analysis_index) => ({ analysis_index, raw_frame: analysis_index, raw_pts,
      raw_pts_s: raw_pts / 300, raw_time_base: '1/300', intermediate_frame: analysis_index, intermediate_pts: analysis_index, intermediate_time_base: '1/30',
      analysis_pts: analysis_index, analysis_time_base: '1/30', status: 'verified', reasons: [] as string[] })) };
}
async function bound(map = frameMap()) {
  const frameMapJson = JSON.stringify(map);
  return { frameMapJson, manifest: { schema_version: 1, instrumentation_version: 'inst-1', engine_code_version: BASELINE_ENGINE,
    environment_version: INITIAL_EVIDENCE_TUPLE.environmentVersion, expected_environment_version: 'different-expected', status: 'unverified', reasons: ['ENVIRONMENT_DIFFERS'],
    source_commit: 'c'.repeat(40), source_dirty: true, run_id: map.run_id, input_sha256: map.input_sha256, attempt_number: map.attempt_number,
    frame_map_sha256: await digest(frameMapJson), pose_decoded_frames: map.frames.length, bat_decoded_frames: map.frames.length } };
}
async function normalized(input: NormalizationInput) {
  const r = await normalizeEngineOutputs(input); if (!r.ok) assert.fail(r.error.code); return r;
}
async function rejects(input: NormalizationInput, code: string) {
  const r = await normalizeEngineOutputs(input); assert.equal(r.ok, false); if (!r.ok) assert.equal(r.error.code, code);
}

test('deterministic canonical digest, key order independent, no input mutation; COCO order matches PR3', async () => {
  const input = { ...fixture(), ...await bound() }, snapshot = structuredClone(input);
  const a = await normalized(input), b = await normalized(input);
  assert.deepEqual(a, b); assert.deepEqual(input, snapshot);
  const reverse = (v: unknown): unknown => Array.isArray(v) ? v.map(reverse) : v && typeof v === 'object' ? Object.fromEntries(Object.entries(v).reverse().map(([k, x]) => [k, reverse(x)])) : v;
  assert.deepEqual(await normalized(reverse(input) as NormalizationInput), a);
  assert.equal(a.digest, await digest(canonicalJson(a.observations)));
  assert.deepEqual(Object.keys(a.observations.frames[0]!.batter.keypoints!), COCO_17);
  assert.equal(JSON.stringify(a).includes(input.pose2d.meta.video), false);
});
for (const pts of [[0, 10, 20, 30], [-9, 0, 17, 35]]) test(`exact CFR/VFR identities ${pts.join(',')}`, async () => {
  const input = { ...fixture(), ...await bound(frameMap(pts)) }, o = (await normalized(input)).observations;
  assert.equal(o.source.frame_map.status, 'verified'); assert.equal(o.source.identity_mode, 'verified_frame_map');
  assert.equal(o.source.raw_time_base, '1/300');
  o.frames.forEach((f, i) => { assert.equal(f.identity.status, 'verified'); assert.deepEqual(f.identity.source, { frame_index: i, pts: pts[i] }); assert.equal(f.identity.raw_pts_s, pts[i]! / 300); });
  assert.deepEqual(o.provenance.tuple, observedTuple(input.manifest)); assert.equal(o.provenance.registry.status, 'shadow');
  assert.equal(o.provenance.environment_version, INITIAL_EVIDENCE_TUPLE.environmentVersion);
  assert.equal(o.provenance.expected_environment_version, 'different-expected');
});
test('partial rows retain reasons, reject reordered row, resume against previous verified row', async () => {
  const map = frameMap(); map.frames[1]!.reasons = ['CONTENT_AMBIGUOUS']; map.frames[2]!.raw_frame = 0;
  const o = (await normalized({ ...fixture(), ...await bound(map) })).observations;
  assert.equal(o.source.frame_map.status, 'partially_verified');
  assert.deepEqual(o.frames.map(f => f.identity.status), ['verified', 'unmappable', 'unmappable', 'verified']);
  assert.ok(o.frames[1]!.identity.reasons.includes('CONTENT_AMBIGUOUS'));
  assert.ok(o.frames[2]!.identity.reasons.includes('NONINCREASING_RAW_IDENTITY'));
  assert.equal(o.frames[1]!.identity.source, null); assert.equal(o.frames[1]!.identity.processed.analysis_pts, 1);
});
for (const kind of ['hash', 'run', 'input', 'attempt', 'count', 'structure', 'timebase', 'manifest'] as const) test(`whole map rejection: ${kind}`, async () => {
  const map = frameMap();
  if (kind === 'structure') map.frames[1]!.analysis_index = 9;
  if (kind === 'timebase') { map.frames[1]!.raw_time_base = '1/600'; map.frames[1]!.raw_pts_s = 10 / 600; }
  const binding = await bound(map);
  if (kind === 'hash') binding.frameMapJson += ' ';
  if (kind === 'run') binding.manifest.run_id = 'd'.repeat(32);
  if (kind === 'input') binding.manifest.input_sha256 = 'd'.repeat(64);
  if (kind === 'attempt') binding.manifest.attempt_number++;
  if (kind === 'count') binding.manifest.bat_decoded_frames--;
  const o = (await normalized({ ...fixture(), ...binding, ...(kind === 'manifest' ? { manifest: null } : {}), legacyWindow: { window: { startS: 0, frameStep: 1 }, rawPts: [0, 10, 20, 30], rawTimeBase: '1/300' } })).observations;
  assert.equal(o.source.frame_map.status, 'rejected'); assert.equal(o.source.identity_mode, 'unavailable');
  assert.equal(o.source.raw_time_base, null);
  o.frames.forEach(f => { assert.equal(f.identity.status, 'unmappable'); assert.equal(f.identity.source, null); assert.equal(f.identity.assumed, null); assert.match(f.identity.reasons[0]!, /^FRAME_MAP_REJECTED:/); });
});
for (const bad of [null, 1.5, Number.MAX_SAFE_INTEGER + 1, '2']) test(`invalid raw identity stays local: ${bad}`, async () => {
  const map = frameMap(); (map.frames[1] as unknown as Record<string, unknown>).raw_pts = bad;
  const o = (await normalized({ ...fixture(), ...await bound(map) })).observations;
  assert.equal(o.source.frame_map.status, 'partially_verified'); assert.equal(o.frames[1]!.identity.status, 'unmappable'); assert.equal(o.frames[2]!.identity.status, 'verified');
});
test('absent identity and legacy assumed window do not fabricate source', async () => {
  const input = fixture(), absent = (await normalized(input)).observations;
  assert.equal(absent.source.frame_map.status, 'absent'); assert.deepEqual(absent.frames[0]!.identity.reasons, ['FRAME_MAP_ABSENT']);
  assert.equal(absent.source.raw_time_base, null);
  const o = (await normalized({ ...input, legacyWindow: { window: { startS: 0.01, frameStep: 2 }, rawPts: [0, 10, 20, 40, 70], rawTimeBase: '1/1000' } })).observations;
  assert.equal(o.source.identity_mode, 'legacy_assumed_window');
  assert.equal(o.source.raw_time_base, null); assert.equal(o.frames[0]!.identity.raw_time_base, '1/1000');
  assert.deepEqual(o.frames[0]!.identity.assumed, { frame_index: 1, pts: 10 }); assert.deepEqual(o.frames[1]!.identity.assumed, { frame_index: 3, pts: 40 });
  assert.equal(o.frames[0]!.identity.status, 'assumed'); assert.equal(o.frames[0]!.identity.source, null);
  assert.deepEqual(o.frames[2]!.identity.reasons, ['LEGACY_WINDOW_UNMAPPABLE']);
  for (const rawPts of [[0, 0], [1, 0], [0, 1.5], [0, NaN]]) await rejects({ ...input, legacyWindow: { window: { startS: 0, frameStep: 1 }, rawPts, rawTimeBase: '1/30' } }, 'INVALID_LEGACY_WINDOW');
});
test('incomplete COCO, invalid values, low confidence and outside raster are explicit', async () => {
  const input = fixture(6); input.pose2d.frames[0]!.keypoints = [null, undefined, [10, 20, 1.5], [NaN, 2, 0.3], ['10', 20, 0.3], [-1, 90, 0.001], ...Array.from({ length: 11 }, () => [100, 80, 0])];
  input.pose2d.frames[1]!.keypoints = Array(16).fill([1, 2, 0.3]); input.pose2d.frames[3]!.keypoints = null; input.pose2d.frames[4]!.keypoints = null;
  const o = (await normalized(input)).observations, kp = o.frames[0]!.batter.keypoints!;
  assert.equal(kp.nose.status, 'missing'); assert.equal(kp.left_eye.status, 'missing');
  for (const joint of ['right_eye', 'left_ear', 'right_ear'] as const) { assert.equal(kp[joint].status, 'invalid'); assert.equal(kp[joint].x, null); assert.equal(kp[joint].source_confidence, null); }
  assert.equal(kp.left_shoulder.status, 'observed'); assert.equal(kp.left_shoulder.outside_raster, true); assert.equal(kp.left_shoulder.source_confidence, 0.001);
  assert.equal(kp.right_shoulder.outside_raster, false); assert.equal(o.frames[1]!.batter.status, 'malformed');
  assert.deepEqual(o.batter_track.fragments, [{ start_analysis_index: 0, end_analysis_index: 0, frames: 1 }, { start_analysis_index: 2, end_analysis_index: 2, frames: 1 }, { start_analysis_index: 5, end_analysis_index: 5, frames: 1 }]);
  assert.equal(o.batter_track.observed_frames, 3); assert.equal(o.failures.invalid_observation_count, 4);
});
test('bat missing endpoints and malformed confidence never synthesize points', async () => {
  const input = fixture(); input.batPath.frames[0]!.tip = null; input.batPath.frames[1]!.knob = ['x', 1]; input.batPath.frames[1]!.conf = 1.5;
  input.batPath.frames[3]!.tip = null; input.batPath.frames[3]!.knob = null;
  const o = (await normalized(input)).observations;
  assert.equal(o.frames[0]!.bat.status, 'observed'); assert.equal(o.frames[0]!.bat.tip.status, 'missing'); assert.equal(o.frames[0]!.bat.knob.x, 30);
  assert.equal(o.frames[1]!.bat.status, 'malformed'); assert.equal(o.frames[1]!.bat.source_confidence, null);
  assert.equal(o.frames[3]!.bat.status, 'not_observed'); assert.equal(o.frames[3]!.bat.knob.x, null);
  assert.equal(o.frames[3]!.bat.tip.status, 'missing'); assert.equal(o.frames[3]!.bat.knob.status, 'missing');
});

for (const count of [3, 5]) test(`bat frame count ${count} must match pose frame count 4`, async () => {
  assert.deepEqual(await normalizeEngineOutputs({ ...fixture(), batPath: fixture(count).batPath }),
    { ok: false, error: { code: 'MALFORMED_ARTIFACT', detail: ['FRAME_COUNT_MISMATCH'] } });
});

const normalMethod = 'argmax(front-knee angle) over a 0.4s forward window from contact';
const unsafeLabels = ['Z:/synthetic-only/never-a-real-video.mp4', 'prefix C:/private/fake.mp4', 'folder\\fake.mp4', '/private/fake.mp4', '~/fake.mp4',
  'prefix /Users/fake/video.mp4', 'prefix /home/fake/video.mp4', 'HTTPS://invalid.example/fake', 'custom+test.1://fake', 'x'.repeat(513),
  ...Array.from({ length: 32 }, (_, i) => `label${String.fromCharCode(i)}private`), 'label\u007fprivate'];
for (const [i, label] of [normalMethod, 'x'.repeat(512), ...unsafeLabels, null, 42, {}, []].entries()) test(`engine label defense ${i}`, async () => {
  const input = fixture(), binding = await bound();
  Object.assign(input.metrics, { detector_version: label });
  Object.assign(input.metrics.contact, { method: label, confidence: label });
  Object.assign(input.metrics.swing_detection, { status: label, confidence: label });
  Object.assign(input.pipelineStatus, { status: label, detail: { outcome: label } });
  Object.assign(binding.manifest, { source_commit: label, status: label, reasons: typeof label === 'string' ? [label] : [] });
  const result = await normalized({ ...input, ...binding }), o = result.observations;
  const expected = typeof label !== 'string' ? null : unsafeLabels.includes(label) ? 'REDACTED_UNSAFE_LABEL' : label;
  assert.deepEqual([o.provenance.detector_version, o.provenance.source_commit, o.provenance.manifest_status,
    o.events.impact_estimate.estimates[0]!.engine_method, o.events.impact_estimate.estimates[0]!.engine_confidence,
    o.outcome.engine_swing_detection.status, o.outcome.engine_swing_detection.confidence, o.failures.pipeline_status, o.failures.pipeline_outcome], Array(9).fill(expected));
  assert.deepEqual(o.provenance.manifest_reasons, typeof label === 'string' ? [expected] : []);
  if (typeof label === 'string' && unsafeLabels.includes(label)) assert.equal(JSON.stringify(result).includes(JSON.stringify(label).slice(1, -1)), false);
  assert.equal(JSON.stringify(result).includes(input.pose2d.meta.video), false);
});
test('legacy aliases retained, load auxiliary, malformed events isolated, unknown phases sorted', async () => {
  const input = fixture(); input.metrics.phases = { contact: { frame: 2, time_s: 999, confidence: 'high', method: 'alias' }, load: { frame: 0, time_s: 0 }, stride: { frame: 'bad', time_s: 0 }, extension: { frame: 99, time_s: 9 }, zzz: {}, aaa: {} };
  const o = (await normalized({ ...input, ...await bound() })).observations;
  assert.equal(o.events.impact_estimate.status, 'estimated'); assert.deepEqual(o.events.impact_estimate.estimates.map(e => e.legacy_frame), [1, 2]);
  assert.equal(o.events.impact_estimate.estimates[0]!.method_class, 'baseline_triple_product'); assert.equal(o.events.impact_estimate.estimates[0]!.engine_confidence, 'low');
  assert.deepEqual(o.events.impact_estimate.estimates[0]!.identity, o.frames[1]!.identity);
  assert.equal(o.events.load_peak_estimate.status, 'estimated'); assert.equal(o.events.foot_plant.status, 'invalid');
  assert.deepEqual(o.events.extension.estimates[0]!.identity.reasons, ['EVENT_FRAME_OUT_OF_RANGE']);
  assert.deepEqual(o.unsupported_legacy_fields, ['aaa', 'zzz']);
  for (const e of ['contact_confirmed', 'load_start', 'stride_foot_lift', 'swing_launch'] as const) assert.equal(o.events[e].status, 'not_produced');
  assert.equal(o.outcome.classification, 'unknown'); assert.equal(o.confidence_semantics, 'uncalibrated_engine_score');
});
test('bad alias marks event invalid without discarding valid alias; null/null means not produced', async () => {
  const input = fixture(); input.metrics.phases.contact = false; input.metrics.phases.load = { frame: null, time_s: null };
  const o = (await normalized(input)).observations;
  assert.equal(o.events.impact_estimate.status, 'invalid'); assert.equal(o.events.impact_estimate.estimates.length, 1); assert.equal(o.events.load_peak_estimate.status, 'not_produced');
});
test('version gates and artifact structure reject instead of reinterpret', async () => {
  const a = fixture(); a.metrics.pipeline_version = 'future'; await rejects(a, 'UNSUPPORTED_ENGINE_VERSION');
  const b = fixture(); b.pose2d.meta.keypoint_order = 'other'; await rejects(b, 'UNSUPPORTED_POSE_SCHEMA');
  const c = await bound(); c.manifest.instrumentation_version = 'inst-2'; await rejects({ ...fixture(), ...c }, 'UNSUPPORTED_INSTRUMENTATION');
  const map = frameMap(); map.schema_version = 2; await rejects({ ...fixture(), ...await bound(map) }, 'UNSUPPORTED_FRAME_MAP');
  for (const mutate of [(x: ReturnType<typeof fixture>) => { x.pose2d.meta.n_frames++; }, (x: ReturnType<typeof fixture>) => { x.pose2d.meta.fps = NaN; }, (x: ReturnType<typeof fixture>) => { x.batPath.frames[0]!.frame = 1; }, (x: ReturnType<typeof fixture>) => { x.batPath.meta.width++; }]) {
    const input = fixture(); mutate(input); await rejects(input, 'MALFORMED_ARTIFACT');
  }
});
test('3D and unrelated private metadata do not affect observations', async () => {
  const input = fixture(), before = await normalized(input);
  Object.assign(input.metrics, { pose_3d: { invalid: true } }); Object.assign(input.pose2d.meta, { pose_3d: [NaN], athlete_name: 'Synthetic Name', url: 'https://invalid.example/private' });
  assert.deepEqual(await normalized({ ...input, ...{ pose3d: 'ignored' } }), before);
});
test('directory reads allowlisted artifacts only, tolerates absent optional files, returns safe errors', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'normalizer-synthetic-'));
  try {
    const input = fixture();
    for (const [name, value] of Object.entries({ 'pose_2d.json': input.pose2d, 'bat_path.json': input.batPath, 'metrics.json': input.metrics })) await writeFile(join(dir, name), JSON.stringify(value));
    await writeFile(join(dir, 'pose_3d.json'), 'THIS IS INVALID JSON');
    const expected = await normalized({ ...input, pipelineStatus: undefined });
    assert.deepEqual(await normalizeEngineOutputDirectory(dir), expected);
    const binding = await bound(); await writeFile(join(dir, 'frame_map.json'), binding.frameMapJson); await writeFile(join(dir, 'engine_manifest.json'), JSON.stringify(binding.manifest));
    assert.deepEqual(await normalizeEngineOutputDirectory(dir), await normalizeEngineOutputs({ ...input, ...binding, pipelineStatus: undefined }));
    await writeFile(join(dir, 'metrics.json'), 'invalid');
    assert.deepEqual(await normalizeEngineOutputDirectory(dir), { ok: false, error: { code: 'ARTIFACT_READ_FAILED', detail: [] } });
  } finally { assert.equal(dir.startsWith(join(tmpdir(), 'normalizer-synthetic-')), true); await rm(dir, { recursive: true, force: true }); }
});
