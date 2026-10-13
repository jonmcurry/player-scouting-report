import { assessClip, type ClipEvidenceInput } from "./assessClip.ts";
import { assessSufficiency } from "./sufficiency.ts";
import { lookupReliability } from "./reliability.ts";
import { object } from "./validation.ts";
import type { ClaimReliability, Concept, GateMode, PhaseSlug } from "./types.ts";
export interface ClaimInput extends ClipEvidenceInput {
  concept: Concept; phase: PhaseSlug | null; supplied: unknown; visibility: unknown; mode: GateMode;
}
/** Pure Boolean composition for explicit hypothetical tests. This result has no
 * authority to display or enforce anything, and accepts no registry mutation. */
export function simulateClaimDecision(input: {
  subjectPass: boolean; requiredEventsPass: boolean; sufficient: boolean;
  reliabilityStatus: ClaimReliability["status"]; mode: GateMode;
}) {
  if (!["off", "shadow", "enforce"].includes(input.mode)) throw new Error("Unknown evidence mode");
  const reliabilityAllowed = input.reliabilityStatus === "within_ceiling"
    || (input.mode === "shadow" && input.reliabilityStatus === "unmeasured");
  return { scope: "hypothetical" as const, authorizedForProduction: false as const,
    reliabilityStatus: input.reliabilityStatus,
    wouldDisplay: input.mode !== "off" && input.subjectPass === true && input.requiredEventsPass === true
      && input.sufficient === true && reliabilityAllowed };
}
/** Recomputes dimensions from inputs; never accepts an injected reliability
 * verdict, enforced fixture, or caller-supplied displayable Boolean. PR8 has no
 * calibrated profiles or approved requirements, so authorization is always false. */
export async function decideClaim(input: ClaimInput) {
  if (!["off", "shadow", "enforce"].includes(input.mode)) throw new Error("Unknown evidence mode");
  const clip = await assessClip(input);
  const sufficiency = assessSufficiency(input.concept, input.phase, input.supplied, input.visibility, clip.events);
  const reliability = lookupReliability(input.concept, clip.tuple, object(input.supplied).captureProfile);
  const hypothetical = simulateClaimDecision({ subjectPass: clip.clipStatus === "eligible",
    requiredEventsPass: sufficiency.requiredEvents.length > 0
      && sufficiency.requiredEvents.every(event => clip.events[event].status === "pass"),
    sufficient: sufficiency.status === "sufficient", reliabilityStatus: reliability.status, mode: input.mode });
  return { concept: input.concept, phase: input.phase, mode: input.mode, clip, sufficiency, reliability,
    hypothetical, displayable: false as const, enforceEligible: false as const,
    authorizationReasons: ["requirements_proposed", "reliability_unmeasured", "no_enforced_tuple"] };
}
