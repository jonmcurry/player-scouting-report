/** Evaluation-only baseline normalization. No inference, media decoding or production writes. */
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { SWING_EVENTS, type FrameIdentity } from '../../domain/swingEvents.ts';
import { LEGACY_FIELDS, LEGACY_EVENT_TARGETS, translateLegacyPhases } from '../../domain/legacyPhaseMapping.ts';
import { BASELINE_ENGINE, engineCodeForPipelineVersion, isEvidenceTuple, resolveTuple } from '../../services/development/evidenceRegistry.ts';
import { GATE_VERSION, PROPOSED_CLAIMS_VERSION } from '../../services/development/evidence/version.ts';
import { rawFrameIndices, type AnalysisWindow } from '../../services/pose3d/analysisWindow.ts';
import type { Joint } from '../schema/annotation.ts';

export const ENGINE_OBSERVATIONS_SCHEMA = 'hitterloop.engine-observations';
export const ENGINE_OBSERVATIONS_VERSION = '1.0.0';
export const NORMALIZER_VERSION = 'normalize-1.0.0';
// Type-only annotation dependency avoids its module-level schema file read.
const JOINTS = ['nose', 'left_eye', 'right_eye', 'left_ear', 'right_ear', 'left_shoulder', 'right_shoulder', 'left_elbow', 'right_elbow', 'left_wrist', 'right_wrist', 'left_hip', 'right_hip', 'left_knee', 'right_knee', 'left_ankle', 'right_ankle'] as const satisfies readonly Joint[];
type Obj = Record<string, unknown>;
const isObject = (v: unknown): v is Obj => v !== null && typeof v === 'object' && !Array.isArray(v);
const obj = (v: unknown): Obj => isObject(v) ? v : {};
const finite = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v);
const integer = (v: unknown): v is number => typeof v === 'number' && Number.isSafeInteger(v);
const index = (v: unknown): v is number => integer(v) && v >= 0;
const str = (v: unknown): string | null => typeof v === 'string' ? v : null;
function engineLabel(v: unknown): string | null {
  if (typeof v !== 'string') return null;
  return v.length > 512 || /\\|[A-Za-z]:[/]|^[/~]|\/Users\/|\/home\/|[\u0000-\u001f\u007f]/.test(v) || /[a-z][a-z0-9+.-]*:\/\//i.test(v)
    ? 'REDACTED_UNSAFE_LABEL' : v;
}
const strings = (v: unknown): v is string[] => Array.isArray(v) && v.every(x => typeof x === 'string');
const hash = (v: unknown): v is string => typeof v === 'string' && /^[a-f0-9]{64}$/.test(v);
function timeBase(v: unknown): number | null {
  if (typeof v !== 'string' || !/^[1-9]\d*(\/[1-9]\d*)?$/.test(v)) return null;
  const [n, d = 1] = v.split('/').map(Number);
  return integer(n) && integer(d) && Number.isFinite(n / d) ? n / d : null;
}
/** JSON domain only: recursively sorted object keys, preserved array order. */
export function canonicalJson(value: unknown): string {
  if (value === null || typeof value === 'string' || typeof value === 'boolean' || finite(value)) return JSON.stringify(value);
  if (Array.isArray(value)) return '[' + Array.from(value, canonicalJson).join(',') + ']';
  if (isObject(value)) return '{' + Object.keys(value).sort().map(k => JSON.stringify(k) + ':' + canonicalJson(value[k])).join(',') + '}';
  throw new TypeError('NON_JSON_VALUE');
}
async function sha256(text: string): Promise<string> {
  return [...new Uint8Array(await globalThis.crypto.subtle.digest('SHA-256', new TextEncoder().encode(text)))].map(b => b.toString(16).padStart(2, '0')).join('');
}
export interface LegacyWindow { window: AnalysisWindow; rawPts: number[]; rawTimeBase: string }
export interface NormalizationInput {
  pose2d: unknown; batPath: unknown; metrics: unknown; pipelineStatus?: unknown; manifest?: unknown;
  frameMapJson?: string | null; legacyWindow?: LegacyWindow | null;
}
interface ProcessedIdentity {
  intermediate_frame: number | null; intermediate_pts: number | null; intermediate_time_base: string | null;
  analysis_pts: number | null; analysis_time_base: string | null;
}
export interface ObservationIdentity {
  status: 'verified' | 'assumed' | 'unmappable'; source: FrameIdentity | null;
  raw_pts_s: number | null; raw_time_base: string | null; assumed: FrameIdentity | null;
  processed: ProcessedIdentity; reasons: string[];
}
const emptyProcessed = (): ProcessedIdentity => ({ intermediate_frame: null, intermediate_pts: null, intermediate_time_base: null, analysis_pts: null, analysis_time_base: null });
function unmappable(reason: string): ObservationIdentity {
  return { status: 'unmappable', source: null, raw_pts_s: null, raw_time_base: null, assumed: null, processed: emptyProcessed(), reasons: reason === '' ? [] : [reason] };
}
export interface EndpointObservation {
  status: 'observed' | 'missing' | 'invalid'; x: number | null; y: number | null; outside_raster: boolean | null; reasons: string[];
}
export interface KeypointObservation extends EndpointObservation { source_confidence: number | null }
function endpoint(v: unknown, width: number, height: number, dimensions = 2): EndpointObservation {
  if (v == null) return { status: 'missing', x: null, y: null, outside_raster: null, reasons: ['MISSING_POINT'] };
  if (!Array.isArray(v) || v.length !== dimensions || !v.every(finite) || (dimensions === 3 && (v[2]! < 0 || v[2]! > 1))) {
    return { status: 'invalid', x: null, y: null, outside_raster: null, reasons: ['INVALID_POINT'] };
  }
  const [x, y] = v as [number, number];
  return { status: 'observed', x, y, outside_raster: x < 0 || y < 0 || x > width || y > height, reasons: [] };
}
function batter(v: unknown, width: number, height: number) {
  if (v == null) return { status: 'not_observed' as const, keypoints: null, reasons: [] as string[] };
  if (!Array.isArray(v) || v.length !== 17) return { status: 'malformed' as const, keypoints: null, reasons: ['INVALID_COCO17_ARRAY'] };
  const keypoints = Object.fromEntries(JOINTS.map((joint, i) => {
    const p = endpoint(v[i], width, height, 3);
    return [joint, { ...p, source_confidence: p.status === 'observed' ? v[i][2] as number : null }];
  })) as Record<Joint, KeypointObservation>;
  return { status: 'observed' as const, keypoints, reasons: [] as string[] };
}
function bat(v: unknown, width: number, height: number) {
  const row = obj(v), tip = endpoint(row.tip, width, height), knob = endpoint(row.knob, width, height);
  const reasons: string[] = [];
  if (row.conf != null && (!finite(row.conf) || row.conf < 0 || row.conf > 1)) reasons.push('INVALID_BAT_CONFIDENCE');
  if (row.track_id != null && !integer(row.track_id)) reasons.push('INVALID_BAT_TRACK_ID');
  if (tip.status === 'invalid' || knob.status === 'invalid') reasons.push('INVALID_BAT_ENDPOINT');
  return { status: reasons.length ? 'malformed' as const : tip.status === 'observed' || knob.status === 'observed' ? 'observed' as const : 'not_observed' as const,
    bat_track_id: integer(row.track_id) ? row.track_id : null,
    source_confidence: finite(row.conf) && row.conf >= 0 && row.conf <= 1 ? row.conf : null, tip, knob, reasons };
}
interface EventEstimate {
  source_field: string; legacy_frame: number | null; legacy_time_s: number | null; method_class: string;
  engine_method: string | null; engine_confidence: string | null; identity: ObservationIdentity;
}
interface EventObservation {
  status: 'not_produced' | 'estimated' | 'invalid'; estimates: EventEstimate[];
  uncertainty: { frames: null; ms: null; reason: 'unquantified_baseline' }; reasons: string[];
}
const EVENT_NAMES = [...SWING_EVENTS, 'load_peak_estimate', 'extension'] as const;
function events(metrics: Obj, identities: ObservationIdentity[]) {
  const output = Object.fromEntries(EVENT_NAMES.map(e => [e, { status: 'not_produced', estimates: [],
    uncertainty: { frames: null, ms: null, reason: 'unquantified_baseline' }, reasons: [] } as EventObservation])) as Record<typeof EVENT_NAMES[number], EventObservation>;
  const phases = obj(metrics.phases);
  for (const field of LEGACY_FIELDS) {
    const key = field.slice(field.lastIndexOf('.') + 1), parent = field === 'metrics.json.contact' ? metrics : phases;
    if (!Object.hasOwn(parent, key)) continue;
    const value = obj(parent[key]), target = LEGACY_EVENT_TARGETS[field], event = output[target];
    try {
      const translated = translateLegacyPhases({ [field]: { frame: value.frame, time_s: value.time_s } } as Parameters<typeof translateLegacyPhases>[0]);
      const entry = target === 'extension' || target === 'load_peak_estimate' ? translated.auxiliary[target] : translated.events[target];
      for (const estimate of entry.estimates) event.estimates.push({ source_field: field, legacy_frame: estimate.legacy_frame,
        legacy_time_s: estimate.legacy_time_s, method_class: estimate.method, engine_method: engineLabel(value.method), engine_confidence: engineLabel(value.confidence),
        identity: estimate.legacy_frame !== null && identities[estimate.legacy_frame] ? identities[estimate.legacy_frame]! : unmappable('EVENT_FRAME_OUT_OF_RANGE') });
      if (event.status !== 'invalid' && event.estimates.length) event.status = 'estimated';
    } catch { event.status = 'invalid'; event.reasons.push('INVALID_LEGACY_PHASE:' + field); }
  }
  return output;
}
function artifact(v: unknown): v is { meta: Obj & { fps: number; width: number; height: number; n_frames: number }; frames: Obj[] } {
  const a = obj(v), m = obj(a.meta);
  return isObject(a.meta) && ['fps', 'width', 'height'].every(k => finite(m[k]) && m[k] > 0)
    && index(m.n_frames) && Array.isArray(a.frames) && a.frames.length === m.n_frames
    && Array.from(a.frames).every((f, i) => isObject(f) && f.frame === i);
}
function validRow(v: unknown, i: number): boolean {
  if (!isObject(v) || v.analysis_index !== i || !['verified', 'unmappable'].includes(String(v.status)) || !strings(v.reasons)) return false;
  // Structure is clip-wide; invalid/null raw identity values are evaluated per row.
  return ['raw_frame', 'raw_pts', 'raw_time_base', 'raw_pts_s'].every(k => Object.hasOwn(v, k))
    && ['intermediate_frame', 'intermediate_pts', 'analysis_pts'].every(k => v[k] === null || integer(v[k]))
    && ['intermediate_time_base', 'analysis_time_base'].every(k => v[k] === null || timeBase(v[k]) !== null);
}
/** No filesystem operations. Async only for exact-text SHA-256. */
export async function normalizeEngineOutputs(input: NormalizationInput): Promise<NormalizationResult> {
  const fail = (code: string, ...detail: string[]): NormalizationResult => ({ ok: false, error: { code, detail } });
  const metrics = obj(input.metrics), manifest = obj(input.manifest), pose = input.pose2d, bats = input.batPath;
  if (engineCodeForPipelineVersion(metrics.pipeline_version) !== BASELINE_ENGINE) return fail('UNSUPPORTED_ENGINE_VERSION');
  if (obj(obj(pose).meta).keypoint_order !== 'coco17') return fail('UNSUPPORTED_POSE_SCHEMA');
  if (!artifact(pose) || !artifact(bats)) return fail('MALFORMED_ARTIFACT');
  if (pose.meta.n_frames !== bats.meta.n_frames) return fail('MALFORMED_ARTIFACT', 'FRAME_COUNT_MISMATCH');
  if (['fps', 'width', 'height'].some(k => pose.meta[k] !== bats.meta[k])) return fail('MALFORMED_ARTIFACT', 'RASTER_METADATA_MISMATCH');
  if (input.manifest != null && (manifest.schema_version !== 1 || manifest.instrumentation_version !== 'inst-1' || manifest.engine_code_version !== BASELINE_ENGINE)) return fail('UNSUPPORTED_INSTRUMENTATION');
  const legacy = input.legacyWindow;
  if (legacy != null && (!isObject(legacy.window) || !finite(legacy.window.startS) || legacy.window.startS < 0 || !index(legacy.window.frameStep) || legacy.window.frameStep < 1
    || timeBase(legacy.rawTimeBase) === null || !Array.isArray(legacy.rawPts) || !Array.from(legacy.rawPts).every((p, i, all) => integer(p) && (i === 0 || p > all[i - 1]!))
    || !legacy.rawPts.every(p => finite(p * timeBase(legacy.rawTimeBase)!)))) return fail('INVALID_LEGACY_WINDOW');
  const n = pose.meta.n_frames;
  let identities = Array.from({ length: n }, () => unmappable('FRAME_MAP_ABSENT'));
  let mapStatus: 'verified' | 'partially_verified' | 'rejected' | 'absent' = 'absent';
  let mapReasons: string[] = [];
  let identityMode: 'verified_frame_map' | 'legacy_assumed_window' | 'unavailable' = 'unavailable';
  if (input.frameMapJson != null) {
    let map: Obj;
    try { map = obj(JSON.parse(input.frameMapJson)); } catch { return fail('UNSUPPORTED_FRAME_MAP', 'INVALID_JSON'); }
    if (map.schema_version !== 1 || map.instrumentation_version !== 'inst-1') return fail('UNSUPPORTED_FRAME_MAP');
    const reject: string[] = [];
    if (input.manifest == null) reject.push('NO_MANIFEST');
    if (!hash(manifest.frame_map_sha256) || await sha256(input.frameMapJson) !== manifest.frame_map_sha256) reject.push('HASH_MISMATCH');
    if (typeof map.run_id !== 'string' || !/^[a-f0-9]{32}$/.test(map.run_id) || map.run_id !== manifest.run_id) reject.push('RUN_ID_MISMATCH');
    if (!hash(map.input_sha256) || map.input_sha256 !== manifest.input_sha256) reject.push('INPUT_SHA256_MISMATCH');
    if (!index(map.attempt_number) || map.attempt_number !== manifest.attempt_number) reject.push('ATTEMPT_MISMATCH');
    const rows = Array.isArray(map.frames) ? Array.from(map.frames) : [];
    if (!Array.isArray(map.frames) || rows.length !== n || rows.length !== manifest.pose_decoded_frames || rows.length !== manifest.bat_decoded_frames) reject.push('COUNT_MISMATCH');
    if (!rows.every(validRow)) reject.push('MALFORMED_ROWS');
    if (reject.length === 0) {
      let previousFrame = -1, previousPts: number | null = null, base: string | null = null;
      identities = rows.map(value => {
        const r = obj(value), unit = timeBase(r.raw_time_base), reasons = [...r.reasons as string[]];
        const identity = unmappable('');
        identity.processed = { intermediate_frame: r.intermediate_frame as number | null, intermediate_pts: r.intermediate_pts as number | null,
          intermediate_time_base: r.intermediate_time_base as string | null, analysis_pts: r.analysis_pts as number | null, analysis_time_base: r.analysis_time_base as string | null };
        if (r.status !== 'verified' && !reasons.length) reasons.push('ROW_NOT_VERIFIED');
        if (!index(r.raw_frame) || !integer(r.raw_pts) || unit === null || !finite(r.raw_pts_s)
          || !finite((r.raw_pts as number) * unit) || Math.abs((r.raw_pts_s as number) - (r.raw_pts as number) * unit) > 1e-9) reasons.push('INVALID_RAW_IDENTITY');
        if (!reasons.length && ((r.raw_frame as number) <= previousFrame || (previousPts !== null && (r.raw_pts as number) <= previousPts))) reasons.push('NONINCREASING_RAW_IDENTITY');
        if (!reasons.length) {
          if (base !== null && r.raw_time_base !== base) reject.push('TIME_BASE_MISMATCH');
          base = r.raw_time_base as string; previousFrame = r.raw_frame as number; previousPts = r.raw_pts as number;
          return { ...identity, status: 'verified' as const, source: { frame_index: previousFrame, pts: previousPts }, raw_pts_s: r.raw_pts_s as number, raw_time_base: base, reasons: [] };
        }
        return { ...identity, reasons };
      });
    }
    if (reject.length) {
      mapStatus = 'rejected'; mapReasons = [...new Set(reject)].map(r => 'FRAME_MAP_REJECTED:' + r);
      identities = Array.from({ length: n }, () => ({ ...unmappable(''), reasons: [...mapReasons] }));
    } else {
      const count = identities.filter(i => i.status === 'verified').length;
      mapStatus = count === n ? 'verified' : 'partially_verified';
      mapReasons = [...new Set(identities.flatMap(i => i.reasons))].sort();
      if (count > 0) identityMode = 'verified_frame_map';
    }
  } else if (legacy) {
    identityMode = 'legacy_assumed_window';
    const seconds = legacy.rawPts.map(p => p * timeBase(legacy.rawTimeBase)!);
    identities = identities.map((_, i) => {
      const indices = rawFrameIndices(legacy.window, seconds, [i]), k = indices?.[0];
      return k === undefined ? unmappable('LEGACY_WINDOW_UNMAPPABLE') : { ...unmappable(''), status: 'assumed',
        assumed: { frame_index: k, pts: legacy.rawPts[k]! }, raw_pts_s: seconds[k]!, raw_time_base: legacy.rawTimeBase, reasons: [] };
    });
  }
  const frames = pose.frames.map((row, i) => ({ analysis_index: i, identity: identities[i]!,
    batter: batter(row.keypoints, pose.meta.width, pose.meta.height), bat: bat(bats.frames[i], pose.meta.width, pose.meta.height) }));
  const fragments: { start_analysis_index: number; end_analysis_index: number; frames: number }[] = [];
  for (const f of frames) if (f.batter.status === 'observed') {
    const last = fragments.at(-1);
    if (last && last.end_analysis_index === f.analysis_index - 1) { last.end_analysis_index++; last.frames++; }
    else fragments.push({ start_analysis_index: f.analysis_index, end_analysis_index: f.analysis_index, frames: 1 });
  }
  const candidate = { engineCodeVersion: manifest.engine_code_version, instrumentationVersion: manifest.instrumentation_version,
    environmentVersion: manifest.environment_version, gateVersion: GATE_VERSION, claimsVersion: PROPOSED_CLAIMS_VERSION, reliabilityProfileVersion: null };
  const tuple = isEvidenceTuple(candidate) ? candidate : null;
  const selection = obj(pose.meta.bat_evidence), pipeline = obj(input.pipelineStatus), swing = obj(metrics.swing_detection);
  const normalizedEvents = events(metrics, identities);
  const observations = {
    schema: ENGINE_OBSERVATIONS_SCHEMA, schema_version: ENGINE_OBSERVATIONS_VERSION, normalizer_version: NORMALIZER_VERSION,
    provenance: { engine_code_version: BASELINE_ENGINE, pipeline_version: metrics.pipeline_version as string, detector_version: engineLabel(metrics.detector_version),
      instrumentation_version: str(manifest.instrumentation_version), environment_version: str(manifest.environment_version), expected_environment_version: str(manifest.expected_environment_version),
      manifest_status: engineLabel(manifest.status), manifest_reasons: strings(manifest.reasons) ? manifest.reasons.map(v => engineLabel(v)!) : [], source_commit: engineLabel(manifest.source_commit),
      source_dirty: typeof manifest.source_dirty === 'boolean' ? manifest.source_dirty : null, tuple, registry: { status: resolveTuple(tuple)?.status ?? null } },
    source: { sha256: hash(manifest.input_sha256) ? manifest.input_sha256 : null, run_id: str(manifest.run_id), attempt_number: index(manifest.attempt_number) ? manifest.attempt_number : null,
      raw_time_base: identities.find(i => i.status === 'verified' && i.raw_time_base !== null)?.raw_time_base ?? null, identity_mode: identityMode, frame_map: { status: mapStatus, reasons: mapReasons } },
    analysis: { fps: pose.meta.fps, n_frames: n, width: pose.meta.width, height: pose.meta.height, coordinate_space: 'analysis_raster_pixels' as const }, frames,
    batter_track: { track_id: null, track_id_reason: 'pose_2d_has_no_person_track_id' as const,
      selection: { used_fallback: typeof selection.used_fallback === 'boolean' ? selection.used_fallback : null,
        track_frames: finite(selection.track_frames) ? selection.track_frames : null, bat_evidence_frames: finite(selection.bat_evidence_frames) ? selection.bat_evidence_frames : null },
      fragments, observed_frames: fragments.reduce((sum, f) => sum + f.frames, 0), total_frames: n },
    events: normalizedEvents,
    unsupported_legacy_fields: Object.keys(obj(metrics.phases)).filter(k => !(LEGACY_FIELDS as readonly string[]).includes('phases.' + k)).sort(),
    outcome: { classification: 'unknown' as const, reason: 'baseline_cannot_classify_outcome' as const, engine_swing_detection: { status: engineLabel(swing.status), confidence: engineLabel(swing.confidence) } },
    failures: { pipeline_status: engineLabel(pipeline.status), pipeline_outcome: engineLabel(obj(pipeline.detail).outcome),
      unavailable: [input.frameMapJson == null ? 'frame_map' : null, input.manifest == null ? 'engine_manifest' : null, input.pipelineStatus == null ? 'pipeline_status' : null].filter((v): v is string => v !== null),
      invalid_observation_count: frames.reduce((sum, f) => sum + Number(f.batter.status === 'malformed') + Object.values(f.batter.keypoints ?? {}).filter(p => p.status === 'invalid').length
        + Number(f.bat.status === 'malformed'), 0) + Object.values(normalizedEvents).filter(e => e.status === 'invalid').length },
    three_d: { used: false as const, reason: 'normalization_excludes_3d' as const }, confidence_semantics: 'uncalibrated_engine_score' as const,
  };
  return { ok: true, observations, digest: await sha256(canonicalJson(observations)) };
}
export interface EngineObservations {
  schema: string; schema_version: string; normalizer_version: string;
  provenance: { engine_code_version: string; pipeline_version: string; detector_version: string | null; instrumentation_version: string | null;
    environment_version: string | null; expected_environment_version: string | null; manifest_status: string | null; manifest_reasons: string[];
    source_commit: string | null; source_dirty: boolean | null; tuple: import('../../services/development/evidenceRegistry.ts').EvidenceTuple | null; registry: { status: string | null } };
  source: { sha256: string | null; run_id: string | null; attempt_number: number | null; raw_time_base: string | null;
    identity_mode: 'verified_frame_map' | 'legacy_assumed_window' | 'unavailable'; frame_map: { status: 'verified' | 'partially_verified' | 'rejected' | 'absent'; reasons: string[] } };
  analysis: { fps: number; n_frames: number; width: number; height: number; coordinate_space: 'analysis_raster_pixels' };
  frames: { analysis_index: number; identity: ObservationIdentity; batter: ReturnType<typeof batter>; bat: ReturnType<typeof bat> }[];
  batter_track: { track_id: null; track_id_reason: 'pose_2d_has_no_person_track_id'; selection: { used_fallback: boolean | null; track_frames: number | null; bat_evidence_frames: number | null };
    fragments: { start_analysis_index: number; end_analysis_index: number; frames: number }[]; observed_frames: number; total_frames: number };
  events: ReturnType<typeof events>; unsupported_legacy_fields: string[];
  outcome: { classification: 'unknown'; reason: 'baseline_cannot_classify_outcome'; engine_swing_detection: { status: string | null; confidence: string | null } };
  failures: { pipeline_status: string | null; pipeline_outcome: string | null; unavailable: string[]; invalid_observation_count: number };
  three_d: { used: false; reason: 'normalization_excludes_3d' }; confidence_semantics: 'uncalibrated_engine_score';
};
export type NormalizationResult = { ok: true; observations: EngineObservations; digest: string } | { ok: false; error: { code: string; detail: string[] } };
/** Fixed read allowlist. Missing optional artifacts are explicit; other I/O/JSON failures are safe codes. */
export async function normalizeEngineOutputDirectory(dir: string, opts?: { legacyWindow?: LegacyWindow | null }): Promise<NormalizationResult> {
  async function read(name: string, optional = false, text = false): Promise<unknown> {
    try { const content = await readFile(join(dir, name), 'utf8'); return text ? content : JSON.parse(content); }
    catch (error) { if (optional && obj(error).code === 'ENOENT') return null; throw new Error('ARTIFACT_READ_FAILED'); }
  }
  try {
    const [pose2d, batPath, metrics, pipelineStatus, manifest, frameMapJson] = await Promise.all([
      read('pose_2d.json'), read('bat_path.json'), read('metrics.json'), read('pipeline_status.json', true), read('engine_manifest.json', true), read('frame_map.json', true, true),
    ]);
    return normalizeEngineOutputs({ pose2d, batPath, metrics, pipelineStatus, manifest, frameMapJson: frameMapJson as string | null, legacyWindow: opts?.legacyWindow });
  } catch { return { ok: false, error: { code: 'ARTIFACT_READ_FAILED', detail: [] } }; }
}
