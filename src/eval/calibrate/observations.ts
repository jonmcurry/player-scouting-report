import { CLAIM_REQUIREMENTS } from '../../services/development/evidence/claimRequirements.ts';
import type { Concept } from '../../services/development/evidence/types.ts';
import { SWING_EVENTS } from '../schema/annotation.ts';
import { sha256 } from '../benchmark/registry.ts';
import type { Inputs } from '../score/inputs.ts';
import { timing } from '../score/events.ts';
import { TOLERANCES } from '../score/gate.ts';
import { engineAttributable } from '../score/failures.ts';

export type Verdict = 'pass' | 'fail' | 'unknown';
export type Correctness = 'correct' | 'wrong' | 'unknown';
export interface Observation {
  athlete_group: string; capture_profile: string; concept: Concept; clip_hash: string; swing_hash: string;
  v1: Verdict; v2: Record<string, Verdict>; v3: 'sufficient' | 'insufficient' | 'unknown';
  evidence: { identity: Correctness; timing: Record<string, Correctness>; visibility: Correctness };
  engine_confidence?: number;
  reasons?: { v3: 'v3_not_evaluated_in_benchmark'; identity: 'engine_track_id_unavailable'; visibility: 'v3_not_evaluated_in_benchmark';
    /** PR17: an engine-attributable failure before any claim was produced. */
    engine?: 'engine_failure_before_claims' };
}
export function validateObservations(observations: readonly Observation[]) {
  const seen = new Set<string>();
  for (const o of observations) {
    if (Object.hasOwn(o, 'engine_confidence') && (typeof o.engine_confidence !== 'number'
      || !Number.isFinite(o.engine_confidence) || o.engine_confidence < 0 || o.engine_confidence > 1)) throw new Error('INVALID_ENGINE_CONFIDENCE');
    if (!Object.hasOwn(CLAIM_REQUIREMENTS, o.concept) || !o.athlete_group || !o.capture_profile?.trim()
      || !/^[a-f0-9]{64}$/.test(o.clip_hash) || !/^[a-f0-9]{64}$/.test(o.swing_hash)
      || !['pass', 'fail', 'unknown'].includes(o.v1) || !['sufficient', 'insufficient', 'unknown'].includes(o.v3)
      || !o.v2 || Object.values(o.v2).some(v => !['pass', 'fail', 'unknown'].includes(v))
      || !o.evidence || !['correct', 'wrong', 'unknown'].includes(o.evidence.identity)
      || !['correct', 'wrong', 'unknown'].includes(o.evidence.visibility) || !o.evidence.timing
      || Object.values(o.evidence.timing).some(v => !['correct', 'wrong', 'unknown'].includes(v))) throw new Error('INVALID_OBSERVATION');
    const key = JSON.stringify([o.clip_hash, o.swing_hash, o.concept]);
    if (seen.has(key)) throw new Error('DUPLICATE_OBSERVATION');
    seen.add(key);
  }
}
export function classifyObservation(o: Observation): { status: 'safe' | 'unsafe' | 'failed' | 'unmeasurable' | 'not_applicable'; causes: string[] } {
  const r = CLAIM_REQUIREMENTS[o.concept];
  if (r.disabledReason) return { status: 'not_applicable', causes: [r.disabledReason] };
  const groups = r.events.map(group => group.some(e => o.v2[e] === 'pass') ? 'pass'
    : group.every(e => o.v2[e] === 'fail') ? 'fail' : 'unknown');
  // An early engine failure is a pre-registered opportunity with no claim: unmeasurable, never safe or unsafe.
  if (o.reasons?.engine === 'engine_failure_before_claims') return { status: 'unmeasurable', causes: ['engine_failure_before_claims'] };
  if (o.v1 === 'fail' || o.v3 === 'insufficient' || groups.includes('fail')) return { status: 'failed', causes: [] };
  const causes: string[] = [];
  if (o.v1 !== 'pass') causes.push('v1_unknown');
  if (groups.includes('unknown')) causes.push('required_event_unknown');
  if (o.v3 !== 'sufficient') causes.push(o.reasons?.v3 ?? 'v3_unknown');
  if (causes.length) return { status: 'unmeasurable', causes };
  // Only passing alternatives are used; unknown evidence is never counted safe.
  const events = [...new Set(r.events.flatMap(g => g.filter(e => o.v2[e] === 'pass')))];
  const correctness = [o.evidence.identity, ...(Object.keys(r.visibility).length ? [o.evidence.visibility] : []),
    ...events.map(e => Object.hasOwn(TOLERANCES, e) ? o.evidence.timing[e] ?? 'unknown' : 'unknown')];
  // Known-wrong evidence is unsafe (and measurable) even when another component is unknown;
  // letting an unknown mask it would bias the unsafe-pass rate toward zero.
  if (correctness.includes('wrong')) return { status: 'unsafe', causes: [] };
  if (o.evidence.identity === 'unknown') causes.push(o.reasons?.identity ?? 'identity_unknown');
  if (Object.keys(r.visibility).length && o.evidence.visibility === 'unknown') causes.push(o.reasons?.visibility ?? 'visibility_unknown');
  if (events.some(e => !Object.hasOwn(TOLERANCES, e) || !o.evidence.timing[e] || o.evidence.timing[e] === 'unknown')) causes.push('timing_unknown');
  return causes.length ? { status: 'unmeasurable', causes: [...new Set(causes)] } : { status: 'safe', causes: [] };
}
/** Input clips must already pass annotation eligibility. PR13 has no measured V3
 * or engine subject identity, irrespective of V1/V2 availability verdicts. */
export function observationsFromInputs(inputs: Inputs): Observation[] {
  // failures.jsonl also lists PAIRED clips with non-exclusion codes (cache_integrity_failed,
  // repeatability_*); filtering on it dropped valid clips. Decide per record instead (PR17).
  return inputs.clips.filter(c => c.record.status === 'paired' || engineAttributable(c)).flatMap(c => (c.annotation?.swings ?? []).flatMap(s => {
    const early = c.record.status === 'excluded';
    const g = c.record.gates, evaluated = c.record.status === 'paired' && g?.status === 'evaluated';
    const verdict = (v: unknown): Verdict => v === 'pass' ? 'pass' : v === 'fail' ? 'fail' : 'unknown';
    const v2 = Object.fromEntries(Object.entries(evaluated ? g.v2 : {}).map(([e, v]) => [e, verdict(v.status)]));
    const correctness = Object.fromEntries(SWING_EVENTS.map(e => {
      const t = evaluated ? timing(c, s, e) : null, tolerance = TOLERANCES[e];
      return [e, t && tolerance !== undefined ? t.frames <= tolerance ? 'correct' : 'wrong' : 'unknown'];
    })) as Record<string, Correctness>;
    return (Object.keys(CLAIM_REQUIREMENTS) as Concept[]).map(concept => ({
      athlete_group: c.registry.athlete_group, capture_profile: c.annotation!.camera.capture_profile,
      concept, clip_hash: sha256(c.registry.eval_id), swing_hash: sha256(c.registry.eval_id + ':' + s.swing_id),
      v1: evaluated ? verdict(g.v1.status) : 'unknown', v2, v3: 'unknown',
      evidence: { identity: 'unknown', timing: correctness, visibility: 'unknown' },
      reasons: { v3: 'v3_not_evaluated_in_benchmark', identity: 'engine_track_id_unavailable', visibility: 'v3_not_evaluated_in_benchmark',
        ...(early ? { engine: 'engine_failure_before_claims' as const } : {}) },
    }));
  }));
}
