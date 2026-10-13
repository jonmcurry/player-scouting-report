import type { ClaimReliability, Concept, EvidenceTuple } from "./types.ts";
/** Lookup key for future validated profiles. Validation/calibration belongs to
 * Stage 1; changing the lookup later does not change V1-V3. No injection API is
 * exposed to production in PR8. A profile version alone is never measurement. */
export interface ReliabilityQuery { concept: Concept; tuple: EvidenceTuple; captureProfile: string | null }
export type ReliabilityLookup = (query: ReliabilityQuery) => ClaimReliability;
export function lookupReliability(concept: Concept, _tuple: unknown, _captureProfile: unknown): ClaimReliability {
  return { concept, status: "unmeasured", profileVersion: null,
    observedUnsafeRate: null, upperBound95: null, sampleSwings: null, sampleAthletes: null };
}
