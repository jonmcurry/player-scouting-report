import { fraction, index, object } from "./validation.ts";
import { GATE_VERSION } from "./version.ts";
import { RECOVERED_SUBJECT_THRESHOLDS } from "./subjectPolicy.ts";
export interface SubjectThresholds {
  readonly version: string; readonly minBatEvidenceFrames: number | null;
  readonly minBatEvidenceFraction: number | null;
  readonly minTrackedFraction: number | null; readonly maxIdentityJumpFraction: number | null;
}
/** Recovered provisional policy, not reviewer approval or empirical reliability. */
export const SUBJECT_THRESHOLDS: SubjectThresholds = Object.freeze({ version: GATE_VERSION, ...RECOVERED_SUBJECT_THRESHOLDS });
export type SubjectReason = "batter_selection_fallback" | "insufficient_bat_holding_evidence"
  | "batter_not_tracked_in_window" | "possible_identity_switch" | "no_batter_crop"
  | "window_unavailable" | "subject_thresholds_unavailable";
export interface SubjectValidity {
  status: "pass" | "fail"; reasons: SubjectReason[]; gateVersion: string;
  signals: { usedFallback: boolean | null; batEvidenceFrames: number | null; trackFrames: number | null;
    trackedFraction: number | null; identityJumpFraction: number | null; batterCropAvailable: boolean | null;
    windowAvailable: boolean | null };
  thresholds: SubjectThresholds | null;
}
/** Signals are precomputed 2D availability over the declared swing window.
 * Identity-jump fraction uses the existing subjectBox spatial rule upstream.
 * This does not establish true batter identity or track purity. */
function assess(signals: unknown, thresholds: SubjectThresholds | null): SubjectValidity {
  const input = object(signals), reasons: SubjectReason[] = [];
  const s: SubjectValidity["signals"] = {
    usedFallback: typeof input.usedFallback === "boolean" ? input.usedFallback : null,
    batEvidenceFrames: index(input.batEvidenceFrames) ? input.batEvidenceFrames : null,
    trackFrames: index(input.trackFrames) ? input.trackFrames : null,
    trackedFraction: fraction(input.trackedFraction) ? input.trackedFraction : null,
    identityJumpFraction: fraction(input.identityJumpFraction) ? input.identityJumpFraction : null,
    batterCropAvailable: typeof input.batterCropAvailable === "boolean" ? input.batterCropAvailable : null,
    windowAvailable: typeof input.windowAvailable === "boolean" ? input.windowAvailable : null,
  };
  if (!thresholds || !index(thresholds.minBatEvidenceFrames) || thresholds.minBatEvidenceFrames === 0
    || !fraction(thresholds.minBatEvidenceFraction)
    || !fraction(thresholds.minTrackedFraction) || thresholds.minTrackedFraction === 0
    || !fraction(thresholds.maxIdentityJumpFraction)) {
    reasons.push("subject_thresholds_unavailable"); thresholds = null;
  }
  if (s.usedFallback !== false) reasons.push("batter_selection_fallback");
  if (s.batEvidenceFrames === null || s.trackFrames === null || s.batEvidenceFrames > s.trackFrames
    || s.batEvidenceFrames === 0 || (thresholds && s.batEvidenceFrames < Math.max(
      thresholds.minBatEvidenceFrames!, thresholds.minBatEvidenceFraction! * s.trackFrames))) {
    reasons.push("insufficient_bat_holding_evidence");
  }
  if (s.trackFrames === null || s.trackFrames === 0 || s.trackedFraction === null || s.trackedFraction === 0
    || (thresholds && s.trackedFraction < thresholds.minTrackedFraction!)) reasons.push("batter_not_tracked_in_window");
  if (s.identityJumpFraction === null || (thresholds && s.identityJumpFraction > thresholds.maxIdentityJumpFraction!)) {
    reasons.push("possible_identity_switch");
  }
  if (s.batterCropAvailable !== true) reasons.push("no_batter_crop");
  if (s.windowAvailable !== true) reasons.push("window_unavailable");
  return { status: reasons.length ? "fail" : "pass", reasons, gateVersion: GATE_VERSION, signals: s,
    thresholds: thresholds ? { ...thresholds } : null };
}
export function assessSubject(signals: unknown): SubjectValidity { return assess(signals, SUBJECT_THRESHOLDS); }
/** Explicitly hypothetical policy evaluation; never used by assessClip/decideClaim. */
export function simulateSubject(signals: unknown, thresholds: SubjectThresholds) {
  return { scope: "hypothetical" as const, assessment: assess(signals, thresholds) };
}
