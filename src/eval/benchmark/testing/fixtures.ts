import { readFile, writeFile, mkdir, mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';
import { type ClipAnnotation } from '../../schema/annotation.ts';
import { normalizeEngineOutputs } from '../../normalize/engineObservations.ts';
import { ENGINE_RUNTIME_EVIDENCE_TUPLE, INITIAL_EVIDENCE_TUPLE } from '../../../services/development/evidenceRegistry.ts';
import { sha256, type RegistryClip } from '../registry.ts';
import { artifactInventory, BASELINE_TREE, ENGINE_VERSION, type EngineAdapter, type PreflightResult } from '../engineAdapter.ts';

export const repoRoot = fileURLToPath(new URL('../../../../', import.meta.url));
export async function annotationFixture(): Promise<ClipAnnotation> {
  return JSON.parse(await readFile(new URL('../../../../eval/schema/examples/right-handed-swing.json', import.meta.url), 'utf8'));
}
export function registryClip(id = 'eval_0000000000000001', source = sha256('synthetic media')): RegistryClip {
  return { eval_id: id, sha256: source, split: 'dev', athlete_group: 'group-00000001',
    consent: { consent_ref: 'consent-00000001', eval_annotation: true, eval_external_ai: false }, status: 'active', media_ext: 'mp4' };
}
export const preflightFacts = (): PreflightResult => ({ dirty: false, git_commit: 'a'.repeat(40), baseline_tree: BASELINE_TREE, baseline_verified: true,
  models_lock_sha256: 'b'.repeat(64), requirements_lock_sha256: 'c'.repeat(64), environment_verified: true,
  environment_lock_models_sha256: '15a970e7af4833a3da2988c670ecf3eb89e099f9ee200bf76f5b2f3fa0affaf8',
  environment_lock_requirements_sha256: '4be180910788d1c43088b08f896457c05e59c8a0f8998a0a9e974807222a82d6',
  environment_version: ENGINE_RUNTIME_EVIDENCE_TUPLE.environmentVersion, environment_capture_boundary: 'engine_runtime_inherited_omp' });
export function artifacts(source = '0'.repeat(64), pts = Array.from({ length: 12 }, (_, i) => 9000 + i * 30)) {
  const meta = { n_frames: pts.length, fps: 30, width: 1280, height: 720, keypoint_order: 'coco17',
    video: 'C:/Users/synthetic/private.mp4', athlete_name: 'Forbidden Synthetic Name',
    bat_evidence: { used_fallback: false, track_frames: pts.length, bat_evidence_frames: pts.length } };
  const map = { schema_version: 1, instrumentation_version: 'inst-1', run_id: 'd'.repeat(32), input_sha256: source, attempt_number: 0,
    status: 'verified', verified: true, reasons: [], frames: pts.map((p, i) => ({ analysis_index: i, raw_frame: i, raw_pts: p,
      raw_pts_s: p / 1000, raw_time_base: '1/1000', intermediate_frame: i, intermediate_pts: i, intermediate_time_base: '1/30',
      analysis_pts: i, analysis_time_base: '1/30', status: 'verified', reasons: [] })) };
  const frameMapJson = JSON.stringify(map);
  const phase = (frame: number) => ({ frame, time_s: frame / 30, confidence: 'high', method: 'synthetic' });
  return {
    pose2d: { meta, frames: pts.map((_, frame) => ({ frame, time_s: frame / 30, keypoints: Array.from({ length: 17 }, (_, k) => [100 + k, 100 + k * 10, 0.9]) as unknown })) },
    batPath: { meta, frames: pts.map((_, frame) => ({ frame, time_s: frame / 30, tip: [200, 100] as unknown, knob: [100, 200] as unknown, conf: 0.9 })) },
    metrics: { pipeline_version: 'pose3d-live-1.0.0', n_frames: pts.length, fps: 30, contact: phase(6),
      phases: { stance: phase(0), load: phase(1), stride: phase(4), contact: phase(6), extension: phase(8), follow_through: phase(10) } },
    pipelineStatus: { status: 'complete', detail: { outcome: 'ok' }, written_at: 1700000000.5 },
    manifest: { schema_version: 1, instrumentation_version: 'inst-1', engine_code_version: ENGINE_VERSION,
      environment_version: INITIAL_EVIDENCE_TUPLE.environmentVersion, run_id: map.run_id, input_sha256: source, attempt_number: 0,
      frame_map_sha256: sha256(frameMapJson), pose_decoded_frames: pts.length, bat_decoded_frames: pts.length }, frameMapJson,
    pose3d: { meta, frames: pts.map((_, frame) => ({ frame, time_s: frame / 30, joints: Array.from({ length: 17 }, () => [0, 0, 0]), tracked: true, angles: {} })) },
  };
}
export async function observations() {
  const result = await normalizeEngineOutputs(artifacts());
  if (!result.ok) throw new Error(result.error.code);
  return result.observations;
}
export class FakeEngineAdapter implements EngineAdapter {
  readonly engineVersion = ENGINE_VERSION;
  calls = 0;
  facts = preflightFacts();
  mutate: (a: ReturnType<typeof artifacts>) => void = () => {};
  async preflight() { return this.facts; }
  async run(input: { evalId: string; mediaPath: string; sha256: string }, dir: string) {
    this.calls++; await mkdir(dir);
    const a = artifacts(input.sha256); this.mutate(a);
    for (const [name, value] of Object.entries({ 'pose_2d.json': a.pose2d, 'bat_path.json': a.batPath, 'metrics.json': a.metrics,
      'pipeline_status.json': a.pipelineStatus, 'engine_manifest.json': a.manifest, 'pose_3d.json': a.pose3d })) await writeFile(join(dir, name), JSON.stringify(value));
    await writeFile(join(dir, 'frame_map.json'), a.frameMapJson);
    return artifactInventory(dir);
  }
}
export async function tempRoot() { return mkdtemp(join(tmpdir(), 'benchmark-synthetic-')); }
export async function cleanup(root: string) {
  if (!relative(tmpdir(), root).startsWith('benchmark-synthetic-')) throw new Error('UNSAFE_TEST_CLEANUP');
  await rm(root, { recursive: true, force: true });
}
export async function writeAnnotation(root: string, a: ClipAnnotation, name = 'ann_0000000000000001.json') {
  const dir = join(root, 'annotations', '1.0.0', a.eval_clip_id); await mkdir(dir, { recursive: true });
  await writeFile(join(dir, name), JSON.stringify(a));
}

export function terminalArtifacts(source = '0'.repeat(64)) {
  const meta = { n_frames: 120, fps: 30, width: 1280, height: 720,
    keypoint_order: 'coco17', keypoint_names: ['nose', 'l_eye', 'r_eye', 'l_ear', 'r_ear',
      'l_shoulder', 'r_shoulder', 'l_elbow', 'r_elbow', 'l_wrist', 'r_wrist',
      'l_hip', 'r_hip', 'l_knee', 'r_knee', 'l_ankle', 'r_ankle'], video: 'synthetic' };
  const map = { schema_version: 1, instrumentation_version: 'inst-1', run_id: 'd'.repeat(32),
    input_sha256: source, attempt_number: 0, status: 'unmappable', verified: false,
    frames: [], reasons: ['NO_ANALYZED_FRAMES'],
    attempt_history: [{ attempt_number: 0, analysis_timing: { decoded_frames: 120 } }] };
  const frameMapJson = JSON.stringify(map);
  return { pose2d: { meta, frames: [] }, batPath: { meta: structuredClone(meta), frames: [] },
    metrics: { clip: 'synthetic', n_frames: null, fps: null, error: 'synthetic diagnostic', pipeline_version: 'pose3d-live-1.0.0' },
    pipelineStatus: { status: 'complete', detail: { outcome: 'low_quality_footage', error: 'synthetic diagnostic' }, written_at: 1700000000.5 },
    manifest: { engine_code_version: ENGINE_VERSION, instrumentation_version: 'inst-1', input_sha256: source,
      run_id: map.run_id, attempt_number: 0, frame_map_sha256: sha256(frameMapJson), pose_decoded_frames: 0,
      bat_decoded_frames: 0, environment_version: null, environment_verification: null }, frameMapJson };
}
