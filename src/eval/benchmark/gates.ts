import { assessClip } from '../../services/development/evidence/assessClip.ts';
import { extractClipEvidenceSignals, subjectSignalsFrom } from '../../services/development/evidence/artifactSignals.ts';
import { observedTuple } from '../../services/development/evidence/shadowAssessment.ts';
import { subjectBoxAt, type Pose2dFrame, type BatFrame } from '../../services/pose3d/subjectBox.ts';
import { object, index } from '../../services/development/evidence/validation.ts';

export interface GateArtifacts { pose2d: unknown; batPath: unknown; metrics: unknown; manifest: unknown; frameMapJson: string | null }
/** Replicates only the crop availability decision. No pixels or generated image claims. */
export function benchmarkAiInputs(a: GateArtifacts) {
  const pose = object(a.pose2d), bat = object(a.batPath), meta = object(pose.meta), phases = object(object(a.metrics).phases);
  const located = ['stance', 'load', 'stride', 'contact', 'extension', 'follow_through'].flatMap(slug => {
    const frame = object(phases[slug]).frame;
    return index(frame) && typeof meta.n_frames === 'number' && frame < meta.n_frames ? [{ slug, frame }] : [];
  });
  const zooms = located.filter(p => {
    try { return !!subjectBoxAt(pose.frames as Pose2dFrame[], bat.frames as BatFrame[], p.frame, meta.width as number, meta.height as number); }
    catch { return false; }
  }).map(p => `zoom_${p.slug}`);
  return { phaseStills: located.map(p => `phase_${p.slug}`), zooms, sequenceFrames: 0, sequenceSkipped: 'not_generated_in_benchmark' };
}
export async function runGates(a: GateArtifacts, captureProfile: string | null) {
  const candidate = observedTuple(a.manifest);
  const tuple = candidate && /^env-[a-f0-9]{12}$/.test(candidate.environmentVersion) ? candidate : null;
  const aiInputs = benchmarkAiInputs(a);
  const base = { tuple, aiInputs_source: 'subject_box_replica_no_media', aiInputs };
  if (!tuple) return { ...base, status: 'not_evaluated' as const, reason: 'tuple_unavailable' };
  const strictSignals = extractClipEvidenceSignals({ ...a, aiInputs, captureProfile });
  const result = await assessClip({ tuple, subject: subjectSignalsFrom(strictSignals), metrics: a.metrics,
    frameMap: a.frameMapJson === null ? null : { frameMapJson: a.frameMapJson, manifest: a.manifest }, strictSignals });
  return { ...base, status: 'evaluated' as const, clip_status: result.clipStatus, family_reason: result.familyReason,
    v1: { status: result.subject.status, reasons: result.subject.reasons },
    v2: Object.fromEntries(Object.entries(result.events).map(([event, value]) => [event, { status: value.status }])),
    strict: { version: result.strictBaseline.version, status: result.strictBaseline.status, failedRules: result.strictBaseline.failedRules } };
}
