import type { SwingEventSlug, FrameIdentity } from "../../../domain/swingEvents.ts";
import type { Concept } from "../../../domain/concepts.ts";
import type { PhaseSlug } from "../../../domain/swingPhases.ts";
import type { EvidenceTuple } from "../evidenceRegistry.ts";
import type { GateMode } from "../../config/analysisFlags.ts";
export type { SwingEventSlug, FrameIdentity, Concept, PhaseSlug, EvidenceTuple, GateMode };
export type EvidenceEvent = SwingEventSlug | "load_peak_estimate" | "extension";
export type DimensionStatus = "pass" | "fail" | "not_produced" | "unmappable";
export type ReliabilityStatus = "within_ceiling" | "exceeds_ceiling" | "inconclusive" | "unmeasured";
export interface EventLocalisation {
  event: EvidenceEvent; status: DimensionStatus;
  rawFrame: number | null; rawPts: number | null; rawTimeBase: string | null; rawPtsS: number | null;
  sourceField: string | null; method: string | null; engineConfidence: string | null;
  uncertaintyMs: null; reasons: string[];
}
export type EventAssessments = Record<EvidenceEvent, EventLocalisation>;
export type BodyPart = "batter" | "bat" | "arms" | "hands" | "feet" | "head" | "lower_body" | "torso" | "lead_leg";
/** Availability at exact original frames. No URLs, pixels, or 3D quantities. */
export interface SuppliedEvidence {
  stills: Partial<Record<EvidenceEvent, FrameIdentity>>;
  zooms: Partial<Record<EvidenceEvent, FrameIdentity>>;
  sequence: readonly FrameIdentity[];
  captureProfile: string | null;
}
/** Per-required-frame availability; Boolean for qualitative plan requirements,
 * fraction for explicitly numeric requirements. No confidence-to-probability conversion. */
export interface VisibilitySample extends FrameIdentity {
  parts: Partial<Record<BodyPart, number | boolean>>;
}
export interface ClaimSufficiency {
  concept: Concept; status: "sufficient" | "insufficient"; missing: string[];
  requiredEvents: EvidenceEvent[]; claimsVersion: string;
  requirementStatus: "proposed"; reviewApproval: null;
}
export interface ClaimReliability {
  concept: Concept; status: ReliabilityStatus; profileVersion: string | null;
  observedUnsafeRate: number | null; upperBound95: number | null;
  sampleSwings: number | null; sampleAthletes: number | null;
}
