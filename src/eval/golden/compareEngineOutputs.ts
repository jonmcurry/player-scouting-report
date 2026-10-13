import { readFile, realpath } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { join } from 'node:path';

// These measure repeatability of legacy estimates, never contact/pose accuracy.
export const provisionalTolerances = Object.freeze({
  contactFrames: 0, phaseFrames: 1, confidence: 0.5,
  keypointMedianPx: 1, keypointP99Px: 8, batPresenceAgreement: 0.99,
  batMedianPx: 1, batP99Px: 8, metricRelative: 0.01, angleAbsoluteDeg: 0.5,
});
export type Tolerances = { [K in keyof typeof provisionalTolerances]: number };
type ObjectValue = Record<string, any>;
const object = (v: unknown): v is ObjectValue => !!v && typeof v === 'object' && !Array.isArray(v);
const finite = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v);
const index = (v: unknown): v is number => finite(v) && Number.isInteger(v) && v >= 0;
const point = (v: unknown, dimensions: number): v is number[] => Array.isArray(v) && v.length === dimensions && v.every(finite);
const phases = ['stance', 'load', 'stride', 'contact', 'extension', 'follow_through'];
export const artifactNames = ['pose_2d.json', 'bat_path.json', 'pose_3d.json', 'metrics.json', 'pipeline_status.json'] as const;
export type Artifacts = Partial<Record<typeof artifactNames[number], unknown>>;

/** Nearest-rank quantile, inclusive boundaries; empty populations are unknown. */
export function quantile(values: number[], fraction: number): number | null {
  if (!values.length) return null;
  const sorted = [...values].sort((a, b) => a - b);
  return sorted[Math.max(0, Math.ceil(fraction * sorted.length) - 1)]!;
}
function summary(values: number[]) {
  return { count: values.length, median: quantile(values, 0.5), p99: quantile(values, 0.99), max: values.length ? values.reduce((a, b) => Math.max(a, b)) : null };
}

function validateTolerances(input: Partial<Tolerances>): Tolerances {
  const result = { ...provisionalTolerances, ...input };
  if (Object.keys(input).some(k => !(k in provisionalTolerances)) ||
      Object.values(result).some(v => !finite(v) || v < 0) ||
      result.confidence > 1 || result.batPresenceAgreement > 1 ||
      !index(result.contactFrames) || !index(result.phaseFrames)) throw new Error('INVALID_TOLERANCES');
  return result;
}

/** Artifact comparison alone does NOT verify source, input or environment provenance. */
export function compareEngineOutputs(left: Artifacts, right: Artifacts, overrides: Partial<Tolerances> = {}) {
  const tolerances = validateTolerances(overrides);
  const failures: string[] = [];
  const unavailable: string[] = [];
  const fail = (reason: string) => { if (!failures.includes(reason)) failures.push(reason); };
  const kp: number[] = [], bat: number[] = [];
  const phaseDisplacement: Record<string, number | null> = {};
  const metricDifferences: Record<string, { absolute: number | null; rawAbsolute: number | null; relative: number | null; status: string }> = {};
  let contactDisplacement: number | null = null;
  let tipAgreement: number | null = null, knobAgreement: number | null = null;
  let keypointAvailabilityDisagreements = 0;

  function frames(value: unknown, kind: 'pose' | 'bat' | '3d', side: string): ObjectValue | null {
    if (!object(value) || !object(value.meta) || !Array.isArray(value.frames) || !value.frames.length ||
        value.meta.n_frames !== value.frames.length || !finite(value.meta.fps) || value.meta.fps <= 0 ||
        !finite(value.meta.width) || value.meta.width <= 0 || !finite(value.meta.height) || value.meta.height <= 0) {
      fail(`${side}:${kind}:malformed`); return null;
    }
    for (let i = 0; i < value.frames.length; i++) {
      const f = value.frames[i];
      if (!object(f) || f.frame !== i || !finite(f.time_s) || f.time_s < 0) { fail(`${side}:${kind}:frame_identity`); return null; }
      if (kind === 'pose' && !(f.keypoints === null || (Array.isArray(f.keypoints) && f.keypoints.length === 17 &&
          f.keypoints.every((p: unknown) => point(p, 3) && p[2]! >= 0 && p[2]! <= 1)))) { fail(`${side}:pose:keypoints`); return null; }
      if (kind === 'bat' && (!(f.tip === null || point(f.tip, 2)) || !(f.knob === null || point(f.knob, 2)))) { fail(`${side}:bat:endpoints`); return null; }
      if (kind === '3d' && (!Array.isArray(f.joints) || f.joints.length !== 17 || !f.joints.every((p: unknown) => point(p, 3)) ||
          typeof f.tracked !== 'boolean' || !object(f.angles) || !Object.values(f.angles).every(v => v === null || finite(v)))) { fail(`${side}:3d:malformed`); return null; }
    }
    if (kind === 'pose' && value.meta.keypoint_order !== 'coco17') { fail(`${side}:pose:order`); return null; }
    return value;
  }
  for (const [side, data] of [['left', left], ['right', right]] as const) {
    for (const name of artifactNames) if (!object(data[name])) fail(`${side}:${name}:missing_or_malformed`);
    const status = data['pipeline_status.json'];
    if (!object(status) || status.status !== 'complete' || status.detail?.outcome !== 'ok') fail(`${side}:pipeline_not_successful`);
  }
  const lp = frames(left['pose_2d.json'], 'pose', 'left'), rp = frames(right['pose_2d.json'], 'pose', 'right');
  const lb = frames(left['bat_path.json'], 'bat', 'left'), rb = frames(right['bat_path.json'], 'bat', 'right');
  const l3 = frames(left['pose_3d.json'], '3d', 'left'), r3 = frames(right['pose_3d.json'], '3d', 'right');
  const all = [lp, rp, lb, rb, l3, r3].filter((v): v is ObjectValue => v !== null);
  const reference = all[0];
  if (reference && all.some(v => ['n_frames', 'fps', 'width', 'height'].some(k => v.meta[k] !== reference.meta[k]))) fail('frame_metadata_mismatch');
  if (reference && all.some(v => v.frames.some((f: ObjectValue, i: number) => f.time_s !== reference.frames[i]?.time_s))) fail('frame_timestamps_mismatch');
  // Index matching is valid only in the same decoded coordinate/frame domain.
  const aligned = !failures.some(f => f === 'frame_metadata_mismatch' || f === 'frame_timestamps_mismatch');
  if (lp && rp && aligned) {
    for (let i = 0; i < lp.frames.length; i++) {
      const a = lp.frames[i].keypoints, b = rp.frames[i].keypoints;
      for (let j = 0; j < 17; j++) {
        const av = !!a && a[j][2] >= tolerances.confidence, bv = !!b && b[j][2] >= tolerances.confidence;
        if (av !== bv) keypointAvailabilityDisagreements++;
        if (av && bv) kp.push(Math.hypot(a[j][0] - b[j][0], a[j][1] - b[j][1]));
      }
    }
    if (keypointAvailabilityDisagreements) fail('keypoint_availability_disagreement');
  }
  if (!kp.length) unavailable.push('keypoints:no_matched_valid_observations');
  const keypoints = summary(kp);
  if (keypoints.median !== null && (keypoints.median > tolerances.keypointMedianPx || keypoints.p99! > tolerances.keypointP99Px)) fail('keypoint_tolerance');
  if (lb && rb && aligned) {
    const counts = { tip: 0, knob: 0 };
    for (let i = 0; i < lb.frames.length; i++) for (const endpoint of ['tip', 'knob'] as const) {
      const a = lb.frames[i][endpoint], b = rb.frames[i][endpoint];
      if ((a === null) === (b === null)) counts[endpoint]++;
      if (a !== null && b !== null) bat.push(Math.hypot(a[0] - b[0], a[1] - b[1]));
    }
    tipAgreement = counts.tip / lb.frames.length; knobAgreement = counts.knob / lb.frames.length;
    if (tipAgreement < tolerances.batPresenceAgreement || knobAgreement < tolerances.batPresenceAgreement) fail('bat_availability_tolerance');
  }
  if (!bat.length) unavailable.push('bat:no_comparable_coordinates');
  const batCoordinates = summary(bat);
  if (batCoordinates.median !== null && (batCoordinates.median > tolerances.batMedianPx || batCoordinates.p99! > tolerances.batP99Px)) fail('bat_coordinate_tolerance');

  const lm = left['metrics.json'], rm = right['metrics.json'];
  if (object(lm) && object(rm)) {
    for (const [side, m] of [['left', lm], ['right', rm]] as const) {
      if (m.pipeline_version !== 'pose3d-live-1.0.0' || !index(m.n_frames) || m.n_frames !== reference?.meta.n_frames || m.fps !== reference?.meta.fps || m.error) fail(`${side}:metrics:metadata`);
    }
    const frameValue = (v: unknown): v is number => index(v) && v < (reference?.meta.n_frames ?? 0);
    const a = lm.contact?.frame, b = rm.contact?.frame;
    if (!frameValue(a) || !frameValue(b)) fail('contact:missing_or_malformed');
    else { contactDisplacement = Math.abs(a - b); if (contactDisplacement > tolerances.contactFrames) fail('contact:disagreement'); }
    for (const phase of phases) {
      const a = lm.phases?.[phase]?.frame, b = rm.phases?.[phase]?.frame;
      phaseDisplacement[phase] = null;
      if (a === null && b === null) unavailable.push(`phase:${phase}:both_unavailable`);
      else if (!frameValue(a) || !frameValue(b)) fail(`phase:${phase}:missing_or_malformed`);
      else {
        phaseDisplacement[phase] = Math.abs(a - b);
        if (Math.abs(a - b) > (phase === 'contact' ? tolerances.contactFrames : tolerances.phaseFrames)) fail(`phase:${phase}:tolerance`);
      }
    }
    if (lm.phases?.contact?.frame !== lm.contact?.frame || rm.phases?.contact?.frame !== rm.contact?.frame) fail('contact:inconsistent_alias');
    // Explicit known numeric fields prevent arbitrary artifact keys/text leaking into a report.
    const metricPaths = [
      'max_bat_speed.value', 'max_bat_speed_full_rate.value', 'attack_angle_at_contact_deg',
      'hip_shoulder_separation_at_contact_deg', 'torso_tilt_at_contact_deg', 'pelvis_tilt_at_contact_deg',
      'lead_elbow_angle_at_contact_deg', 'front_knee_angle_at_contact_deg', 'l_elbow_angle_at_contact_deg',
      'r_elbow_angle_at_contact_deg', 'stride.length_hip_widths', 'stride.direction_deg',
      'movement_flags.lateral_sway.value', 'movement_flags.wrist_lead_ms.value',
    ];
    const at = (m: ObjectValue, path: string): unknown => path.split('.').reduce<any>((v, k) => v?.[k], m);
    for (const path of metricPaths) {
      const a = at(lm, path), b = at(rm, path);
      if (path === 'max_bat_speed_full_rate.value' && a === undefined && b === undefined) continue;
      if (a == null && b == null) {
        metricDifferences[path] = { absolute: null, rawAbsolute: null, relative: null, status: 'both_unavailable' };
        unavailable.push(`metric:${path}:both_unavailable`); continue;
      }
      if (!finite(a) || !finite(b)) {
        metricDifferences[path] = { absolute: null, rawAbsolute: null, relative: null, status: 'missing_or_nonfinite' }; fail(`metric:${path}:missing_or_nonfinite`); continue;
      }
      const rawAbsolute = Math.abs(a - b), scale = Math.max(Math.abs(a), Math.abs(b));
      const circular = path === 'stride.direction_deg' || path === 'attack_angle_at_contact_deg';
      const absolute = circular ? Math.min(rawAbsolute % 360, 360 - rawAbsolute % 360) : rawAbsolute;
      const relative = scale === 0 ? 0 : absolute / scale;
      // Symmetric relative difference; degrees use absolute tolerance, not a relative escape hatch.
      const pass = path.endsWith('_deg') ? absolute <= tolerances.angleAbsoluteDeg : relative <= tolerances.metricRelative;
      metricDifferences[path] = { absolute, rawAbsolute, relative, status: pass ? 'within_tolerance' : 'outside_tolerance' };
      if (!pass) fail(`metric:${path}:tolerance`);
    }
  }
  return {
    schemaVersion: 1, scope: 'legacy-contact-phases-coco17-bat-summary-metrics', provenanceVerified: false,
    status: failures.length ? 'different_or_invalid' : unavailable.length ? 'inconclusive' : 'within_tolerance',
    equivalent: failures.length === 0 && unavailable.length === 0,
    tolerances, failures, unavailable, contactDisplacement, phaseDisplacement,
    keypoints: { ...keypoints, availabilityDisagreements: keypointAvailabilityDisagreements },
    bat: { tipAgreement, knobAgreement, coordinates: batCoordinates }, metricDifferences,
  };
}

/** Reads only fixed JSON names. Parse/read errors become opaque failures, never path-bearing exceptions. */
export async function compareEngineOutputDirectories(left: string, right: string, tolerances: Partial<Tolerances> = {}) {
  const read = async (directory: string): Promise<Artifacts> => {
    const output: Artifacts = {};
    await Promise.all(artifactNames.map(async name => {
      try { output[name] = JSON.parse(await readFile(join(directory, name), 'utf8')); }
      catch { output[name] = undefined; }
    }));
    return output;
  };
  const [a, b] = await Promise.all([read(left), read(right)]);
  return compareEngineOutputs(a, b, tolerances);
}

/** Verify local runner records and artifact bytes before a baseline repeatability comparison.
 * Records are an auditable local attestation, not a cryptographic signature of execution.
 */
export async function compareBaselineRuns(left: string, right: string, tolerances: Partial<Tolerances> = {}) {
  const invalid = () => ({ ...compareEngineOutputs({}, {}, tolerances), failures: ['run_provenance_invalid'] });
  try {
    if (await realpath(left) === await realpath(right)) return invalid();
    const records: ObjectValue[] = [];
    const artifacts: Artifacts[] = [];
    for (const directory of [left, right]) {
      const record = JSON.parse(await readFile(join(directory, 'run-record.json'), 'utf8'));
      if (!object(record) || record.schemaVersion !== 1 || record.status !== 'complete' || record.reused !== false ||
          record.sourceCommit !== 'f79b09e63092e87efd1250c3b263d29086d81a79' ||
          record.pose3dTree !== '766f4fbc64620d428da428e59b144554ca2f2a7b' || record.tag !== 'engine-baseline-1.0.0' ||
          record.localEvaluationAuthorized !== true || record.offlineHostAttested !== true ||
          !/^env-[a-f0-9]{12}$/.test(record.environmentVersion) || !/^[a-f0-9]{64}$/.test(record.input?.sha256) ||
          !Number.isSafeInteger(record.input?.bytes) || record.input.bytes <= 0) return invalid();
      const data: Artifacts = {};
      for (const name of artifactNames) {
        const bytes = await readFile(join(directory, name));
        const hash = createHash('sha256').update(bytes).digest('hex');
        if (record.artifacts?.[name]?.sha256 !== hash || record.artifacts?.[name]?.bytes !== bytes.length) return invalid();
        data[name] = JSON.parse(bytes.toString('utf8'));
      }
      records.push(record); artifacts.push(data);
    }
    if (records[0]!.input.sha256 !== records[1]!.input.sha256 || records[0]!.input.bytes !== records[1]!.input.bytes ||
        records[0]!.environmentVersion !== records[1]!.environmentVersion) return invalid();
    return { ...compareEngineOutputs(artifacts[0]!, artifacts[1]!, tolerances), provenanceVerified: true };
  } catch { return invalid(); }
}

/** Aggregate numbers only. Keep this private pending the publication/cohort review. */
export function aggregateRepeatability(results: ReturnType<typeof compareEngineOutputs>[]) {
  const contact = results.flatMap(r => r.contactDisplacement === null ? [] : [r.contactDisplacement]);
  const phase = results.flatMap(r => Object.values(r.phaseDisplacement).filter((v): v is number => v !== null));
  return {
    comparisonCount: results.length,
    withinTolerance: results.filter(r => r.equivalent).length,
    inconclusive: results.filter(r => r.status === 'inconclusive').length,
    differentOrInvalid: results.filter(r => r.status === 'different_or_invalid').length,
    allProvenanceVerified: results.length > 0 && results.every(r => r.provenanceVerified),
    contactFrames: summary(contact), phaseFrames: summary(phase),
    // No automatic threshold change: at least five distinct permitted inputs and
    // per-observation distributions must be reviewed before adopting 2 x P99.
    empiricalToleranceStatus: 'not_established', accuracyClaim: false,
  };
}
