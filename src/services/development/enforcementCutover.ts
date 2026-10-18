/**
 * PR17 (S1-12) enforcement cut-over rules for focus/progress, as a PURE module.
 *
 * Deliberately NOT imported by focus.ts, focusPersistence.ts, progressView.ts or any
 * report or Edge function: wiring it in is a separate, owner-authorized step. It needs
 * two owner decisions that do not exist yet and fails closed without them:
 *   H5 - the definition of "safe legacy evidence";
 *   H6 - whether coach-attested findings count toward automated focus.
 * Rules (plan S1-12): stored and displayed status are never demoted; transitions freeze
 * until at least three eligible swings exist after cut-over; history is never rewritten.
 */
import { advanceFocus, type Finding, type FocusRecord, type FocusResult, type ReadableSwing } from './focus.ts';

export const MIN_ELIGIBLE_SWINGS_AFTER_CUTOVER = 3; // Plan S1-12: "until >=3 eligible swings exist after cut-over".
export const RECHECKING_NOTE = 're-checking with the latest analysis';
export interface CutoverFinding extends Finding { displayable?: boolean; enforcedTuple?: boolean; coachAttested?: boolean }
export interface CutoverSwing extends ReadableSwing { findings: CutoverFinding[]; analysedUnderEnforcedTuple: boolean }
export interface CutoverPolicy {
  h5SafeLegacyEvidence: { decided: true; definition: string } | null;
  h6CoachAttestedCounts: boolean | null;
}
export type CutoverOutcome =
  | { outcome: 'policy_undecided'; stored: FocusRecord | null; history: FocusRecord[]; note: null }
  | { outcome: 'rechecking'; stored: FocusRecord | null; history: FocusRecord[]; note: typeof RECHECKING_NOTE; eligibleSwings: number }
  | { outcome: 'advanced'; result: FocusResult; eligibleSwings: number };

function decided(policy: unknown): policy is CutoverPolicy {
  const p = policy as Partial<CutoverPolicy> | null;
  return !!p && typeof p.h6CoachAttestedCounts === 'boolean' && !!p.h5SafeLegacyEvidence
    && p.h5SafeLegacyEvidence.decided === true && typeof p.h5SafeLegacyEvidence.definition === 'string'
    && p.h5SafeLegacyEvidence.definition.trim().length > 0;
}
export function cutoverFocus(args: { stored: FocusRecord | null; history: FocusRecord[]; swingsAfterCutover: CutoverSwing[];
  policy: unknown; latestKnownSerial?: number }): CutoverOutcome {
  const { stored, history } = args;
  if (!decided(args.policy)) return { outcome: 'policy_undecided', stored, history, note: null };
  const h6 = args.policy.h6CoachAttestedCounts;
  // Only displayable findings from enforced tuples count (plus coach-attested ones if H6 allows).
  const counted = (f: CutoverFinding) => (f.displayable === true && f.enforcedTuple === true) || (h6 && f.coachAttested === true);
  const eligible = args.swingsAfterCutover.filter(s => s.readable && s.sessionType === 'game' && s.analysedUnderEnforcedTuple === true);
  if (eligible.length < MIN_ELIGIBLE_SWINGS_AFTER_CUTOVER) return { outcome: 'rechecking', stored, history, note: RECHECKING_NOTE, eligibleSwings: eligible.length };
  const filtered: ReadableSwing[] = eligible.map(s => ({ ...s, findings: s.findings.filter(counted).map(({ displayable: _d, enforcedTuple: _e, coachAttested: _c, ...f }) => f) }));
  // advanceFocus receives copies; the caller's stored history objects are never mutated.
  return { outcome: 'advanced', result: advanceFocus(filtered, stored ? { ...stored } : null, history.map(h => ({ ...h })), args.latestKnownSerial),
    eligibleSwings: eligible.length };
}
