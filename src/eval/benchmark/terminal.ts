import { canonicalJson, sha256, HASH } from './registry.ts';

export interface TerminalInput {
  pipelineStatus: unknown; pose2d: unknown; batPath: unknown; metrics: unknown;
  manifest: unknown; frameMapJson: string | null; registrySha256: string;
}
export const TERMINAL_CODES = [
  'terminal_status_malformed', 'terminal_outcome_unsupported', 'terminal_frame_map_missing',
  'terminal_manifest_missing', 'terminal_frame_map_hash_mismatch', 'terminal_version_unsupported',
  'terminal_source_hash_mismatch', 'terminal_identity_mismatch', 'terminal_artifacts_inconsistent',
] as const;
type Code = typeof TERMINAL_CODES[number];
export interface TerminalRecord {
  analyzed_frames: 0; attempt_number: number; decoded_frames: number;
  environment: { environment_verification: string | null; environment_version: string | null };
  frame_map_sha256: string; outcome: 'low_quality_footage'; provenance: 'manifest_frame_map_bound'; run_id: string;
}
export type TerminalResult = { kind: 'not_terminal' } | { kind: 'terminal_rejected'; code: Code }
  | { kind: 'verified_terminal'; record: TerminalRecord };
const object = (v: unknown): Record<string, unknown> => v !== null && typeof v === 'object' && !Array.isArray(v) ? v as Record<string, unknown> : {};
const empty = (v: unknown) => Array.isArray(v) && v.length === 0;
const index = (v: unknown): v is number => Number.isSafeInteger(v) && (v as number) >= 0;
const positive = (v: unknown) => typeof v === 'number' && Number.isFinite(v) && v > 0;
const exactKeys = (v: Record<string, unknown>, keys: string[]) => Object.keys(v).sort().join(',') === keys.sort().join(',');

/** Evaluation-only early-stop contract. Never serializes engine diagnostics or media metadata. */
export function classifyTerminal(input: TerminalInput): TerminalResult {
  const status = object(input.pipelineStatus), detail = object(status.detail);
  const reject = (code: Code): TerminalResult => ({ kind: 'terminal_rejected', code });
  if (status.status === undefined) return { kind: 'not_terminal' };
  if (Object.keys(status).some(k => !['status', 'detail', 'written_at'].includes(k)) ||
      Object.keys(detail).some(k => !['outcome', 'error'].includes(k)) ||
      ('written_at' in status && (typeof status.written_at !== 'number' || !Number.isFinite(status.written_at))) ||
      (detail.error !== undefined && typeof detail.error !== 'string')) return reject('terminal_status_malformed');
  if (detail.outcome === 'ok') return { kind: 'not_terminal' };
  if (status.status !== 'complete' || typeof detail.outcome !== 'string') return reject('terminal_status_malformed');
  if (detail.outcome !== 'low_quality_footage') return reject('terminal_outcome_unsupported');
  if (input.frameMapJson === null) return reject('terminal_frame_map_missing');
  const m = object(input.manifest);
  if (!Object.keys(m).length) return reject('terminal_manifest_missing');
  if (sha256(input.frameMapJson) !== m.frame_map_sha256) return reject('terminal_frame_map_hash_mismatch');
  if (m.engine_code_version !== 'engine-baseline-1.0.0' || m.instrumentation_version !== 'inst-1') return reject('terminal_version_unsupported');
  let map: Record<string, unknown>;
  try { map = object(JSON.parse(input.frameMapJson)); } catch { return reject('terminal_artifacts_inconsistent'); }
  if (!HASH.test(input.registrySha256) || m.input_sha256 !== input.registrySha256) return reject('terminal_source_hash_mismatch');
  if (typeof m.run_id !== 'string' || !/^[a-f0-9]{32}$/.test(m.run_id) || !index(m.attempt_number) ||
      map.run_id !== m.run_id || map.attempt_number !== m.attempt_number || map.input_sha256 !== m.input_sha256) return reject('terminal_identity_mismatch');
  const pose = object(input.pose2d), bat = object(input.batPath), meta = object(pose.meta), metrics = object(input.metrics);
  const history = map.attempt_history, last = Array.isArray(history) ? object(history.at(-1)) : {};
  const environmentVersion = m.environment_version ?? null, environmentVerification = m.environment_verification ?? null;
  if (!empty(pose.frames) || !empty(bat.frames) || canonicalJson(meta) !== canonicalJson(bat.meta) ||
      !index(meta.n_frames) || !positive(meta.fps) || !positive(meta.width) || !positive(meta.height) ||
      typeof meta.video !== 'string' || typeof meta.keypoint_order !== 'string' || !meta.keypoint_order ||
      !Array.isArray(meta.keypoint_names) || !meta.keypoint_names.length || !meta.keypoint_names.every(k => typeof k === 'string' && k.length > 0) ||
      m.pose_decoded_frames !== 0 || m.bat_decoded_frames !== 0 ||
      !exactKeys(metrics, ['clip', 'n_frames', 'fps', 'error', 'pipeline_version']) || typeof metrics.clip !== 'string' ||
      metrics.n_frames !== null || metrics.fps !== null || typeof metrics.error !== 'string' || metrics.pipeline_version !== 'pose3d-live-1.0.0' ||
      map.status !== 'unmappable' || map.verified !== false || !empty(map.frames) ||
      !Array.isArray(map.reasons) || !map.reasons.includes('NO_ANALYZED_FRAMES') ||
      object(last.analysis_timing).decoded_frames !== meta.n_frames ||
      (environmentVersion !== null && (typeof environmentVersion !== 'string' || !/^env-[a-f0-9]{12}$/.test(environmentVersion))) ||
      (environmentVerification !== null && (typeof environmentVerification !== 'string' || !['verified', 'unverified', 'different_from_capture'].includes(environmentVerification)))) return reject('terminal_artifacts_inconsistent');
  return { kind: 'verified_terminal', record: {
    analyzed_frames: 0, attempt_number: m.attempt_number, decoded_frames: meta.n_frames,
    environment: { environment_verification: environmentVerification as string | null, environment_version: environmentVersion as string | null },
    frame_map_sha256: m.frame_map_sha256 as string, outcome: 'low_quality_footage', provenance: 'manifest_frame_map_bound', run_id: m.run_id,
  } };
}
