import { STRICT_GATE_VERSION } from "./version.ts";
import { BASELINE_ENGINE } from "../evidenceRegistry.ts";
import { fraction, index, object } from "./validation.ts";
import { RECOVERED_SUBJECT_THRESHOLDS, SUBJECT_SPATIAL_RULE } from "./subjectPolicy.ts";
import type { PhaseSlug } from "./types.ts";

/** Original Revision 1 S0-04 contract. These are legacy analysis indices, not
 * verified raw frame identities. Preserve contact semantics for comparison only. */
export interface ClipEvidenceSignals {
  engineVersion: string;
  batterSelection: { usedFallback: boolean; trackFrames: number; batEvidenceFrames: number };
  contact: { frame: number | null; confidence: "high" | "low" | null };
  phases: Partial<Record<PhaseSlug, { frame: number | null; confidence: "high" | "low" | null }>>;
  swingWindow: { frames: number; batterTrackedFraction: number; identityJumpFraction: number;
    coreKeypointFraction: number; batDetectedFraction: number } | null;
  aiInputs: { phaseStills: string[]; zooms: string[]; sequenceFrames: number; sequenceSkipped: string | null };
  captureProfile: string | null;
}
export type StrictRule = "G1" | "G2" | "G3" | "G4" | "G5" | "G6" | "G7" | "G8";
export type StrictReason = "batter_selection_fallback" | "insufficient_bat_holding_evidence"
  | "contact_not_located" | "contact_low_confidence" | "batter_not_tracked_in_swing"
  | "possible_identity_switch" | "swing_window_unavailable" | "no_batter_crop" | "engine_unknown";
export const STRICT_SUPPORTED_ENGINES = Object.freeze(["baseline-1.0.0"] as const);
/** Explicit name projection for comparisons only. NOT engine/environment
 * equivalence, not a PR7 alias, and never applied implicitly by the comparator. */
export function strictEngineVersionForComparison(version: unknown): "baseline-1.0.0" | null {
  return version === "baseline-1.0.0" || version === BASELINE_ENGINE ? "baseline-1.0.0" : null;
}
type FamilyReason = "batter_unclear" | "swing_unclear";
export interface StrictBaselineAssessment {
  version: typeof STRICT_GATE_VERSION; status: "eligible" | "withhold";
  scope: "shadow_comparator_only"; approvedForProduction: false;
  evaluated: boolean; reasons: StrictReason[]; failedRules: StrictRule[];
  familyReason: FamilyReason | null; familyReasons: FamilyReason[]; unmappedFamilyRules: StrictRule[];
  invalidSignals: string[]; signals: unknown;
  thresholds: Readonly<typeof RECOVERED_SUBJECT_THRESHOLDS & { maxJumpBodyHeights: number }>;
  requiredBatEvidenceFrames: number | null;
}
/** Exact G1-G8 predicates for well-formed consulted signals, in rule order.
 * Malformed consulted fields fail closed and are separately identified.
 * Discrepancies in R1: G2 has no reason in its enum (use R2's explicit reason);
 * G8 has no family mapping (retain null); combined-family precedence is absent
 * (expose every mapping, with the first rule's mapped family as the singular value).
 * Never use this result as production permission, including status=eligible. */
export function assessStrictBaseline(input: unknown): StrictBaselineAssessment {
  const thresholds = Object.freeze({ ...RECOVERED_SUBJECT_THRESHOLDS,
    maxJumpBodyHeights: SUBJECT_SPATIAL_RULE.maxJumpBodyHeights });
  const out: StrictBaselineAssessment = { version: STRICT_GATE_VERSION, status: "withhold",
    scope: "shadow_comparator_only", approvedForProduction: false, evaluated: true,
    reasons: [], failedRules: [], familyReason: null, familyReasons: [], unmappedFamilyRules: [],
    invalidSignals: [], signals: input, thresholds, requiredBatEvidenceFrames: null };
  function fail(rule: StrictRule, reason: StrictReason, family: FamilyReason | null) {
    out.failedRules.push(rule); out.reasons.push(reason);
    if (family && !out.familyReasons.includes(family)) out.familyReasons.push(family);
    if (!family) out.unmappedFamilyRules.push(rule);
  }
  function valid(condition: boolean, path: string): boolean {
    if (!condition) out.invalidSignals.push(path);
    return condition;
  }
  if (input === null || input === undefined) {
    fail("G5", "swing_window_unavailable", "swing_unclear");
    out.invalidSignals.push("signals");
  } else {
    const s = object(input), b = object(s.batterSelection), c = object(s.contact), w = object(s.swingWindow);
    const a = object(s.aiInputs);
    if (!valid(typeof b.usedFallback === "boolean", "batterSelection.usedFallback") || b.usedFallback === true) {
      fail("G1", "batter_selection_fallback", "batter_unclear");
    }
    const trackValid = valid(index(b.trackFrames), "batterSelection.trackFrames");
    const batValid = valid(index(b.batEvidenceFrames), "batterSelection.batEvidenceFrames");
    if (trackValid) out.requiredBatEvidenceFrames = Math.max(thresholds.minBatEvidenceFrames,
      thresholds.minBatEvidenceFraction * (b.trackFrames as number));
    if (!trackValid || !batValid || (b.batEvidenceFrames as number) < out.requiredBatEvidenceFrames!) {
      fail("G2", "insufficient_bat_holding_evidence", "batter_unclear");
    }
    if (c.frame == null || !valid(index(c.frame), "contact.frame")) fail("G3", "contact_not_located", "swing_unclear");
    valid(c.confidence === null || c.confidence === "high" || c.confidence === "low", "contact.confidence");
    if (c.confidence !== "high") fail("G4", "contact_low_confidence", "swing_unclear");
    if (s.swingWindow == null) fail("G5", "swing_window_unavailable", "swing_unclear");
    else {
      if (!valid(fraction(w.batterTrackedFraction), "swingWindow.batterTrackedFraction")
        || (w.batterTrackedFraction as number) < thresholds.minTrackedFraction) {
        fail("G5", "batter_not_tracked_in_swing", "swing_unclear");
      }
      if (!valid(fraction(w.identityJumpFraction), "swingWindow.identityJumpFraction")
        || (w.identityJumpFraction as number) > thresholds.maxIdentityJumpFraction) {
        fail("G6", "possible_identity_switch", "batter_unclear");
      }
    }
    if (!valid(Array.isArray(a.zooms) && Array.from(a.zooms).every(v => typeof v === "string"), "aiInputs.zooms")
      || !(a.zooms as string[]).includes("zoom_contact")) fail("G7", "no_batter_crop", "batter_unclear");
    valid(typeof s.engineVersion === "string", "engineVersion");
    if (s.engineVersion !== STRICT_SUPPORTED_ENGINES[0]) fail("G8", "engine_unknown", null);
  }
  out.evaluated = out.invalidSignals.length === 0;
  out.status = out.failedRules.length === 0 && out.evaluated ? "eligible" : "withhold";
  out.familyReason = out.familyReasons[0] ?? null;
  return out;
}
