import { PROPOSED_CLAIMS_VERSION } from "./version.ts";
import type { BodyPart, Concept, EvidenceEvent } from "./types.ts";
export interface ClaimRequirement {
  readonly version: string; readonly status: "proposed"; readonly reviewApproval: null;
  /** AND of OR groups. No sequence-bound substitutions before D7 approval. */
  readonly events: readonly (readonly EvidenceEvent[])[];
  readonly images: "still_zoom" | "sequence" | "sequence_extension_zoom" | "still_or_sequence" | "still" | "none";
  readonly minSequenceFrames: number;
  /** true = qualitatively visible at every required frame; numbers = plan fractions. */
  readonly visibility: Readonly<Partial<Record<BodyPart, number | true>>>;
  readonly disabledReason: string | null;
  /** null imposes no additional view restriction; [] disallows every profile. */
  readonly cameraProfiles: readonly string[] | null;
}
const impact = ["impact_estimate", "contact_confirmed"] as const;
function requirement(events: ClaimRequirement["events"], images: ClaimRequirement["images"],
  visibility: ClaimRequirement["visibility"], disabledReason: string | null = null, minSequenceFrames = 2): ClaimRequirement {
  return Object.freeze({ version: PROPOSED_CLAIMS_VERSION, status: "proposed", reviewApproval: null,
    events: Object.freeze(events.map(group => Object.freeze([...group]))), images, minSequenceFrames,
    visibility: Object.freeze({ ...visibility }), disabledReason,
    cameraProfiles: disabledReason === "depth_dominated_unapproved" ? Object.freeze([]) : null });
}
/** Section 3.2 as proposed. Neither image availability nor these rules establish
 * biomechanical truth. No coach approval or camera exception is invented. */
export const CLAIM_REQUIREMENTS: Readonly<Record<Concept, ClaimRequirement>> = Object.freeze({
  contact: requirement([impact], "still_zoom", { batter: true, bat: 0.5 }),
  extension: requirement([impact, ["extension"]], "sequence_extension_zoom", { arms: true }, null, 8),
  load: requirement([["load_start"], ["swing_launch"]], "sequence", { hands: true }),
  stride_plant: requirement([["foot_plant", "stride_foot_lift"]], "sequence", { feet: 0.8 }),
  hand_path: requirement([["swing_launch"], impact], "sequence", { bat: 0.5 }),
  barrel_path: requirement([["swing_launch"], impact], "sequence", { bat: 0.5 }),
  barrel_depth: requirement([["swing_launch"], impact], "sequence", { bat: 0.5 }),
  head_visual_stability: requirement([["swing_launch"], ["impact_estimate"]], "sequence", { head: 0.8 }),
  finish_balance: requirement([["finish"]], "still_or_sequence", { lower_body: true }),
  front_side_stability: requirement([["foot_plant"], ["impact_estimate"]], "sequence", { torso: true, lead_leg: true }),
  posture: requirement([["foot_plant"], ["impact_estimate"]], "sequence", { torso: true, lead_leg: true }),
  hip_shoulder_sequencing: requirement([], "none", {}, "depth_dominated_unapproved"),
  stance_setup: requirement([["stance_set"]], "still", {}, "stance_detector_unmeasured"),
  timing: requirement([], "none", {}, "pitch_timing_unobservable"),
  swing_decision: requirement([], "none", {}, "not_mechanical"),
  pitch_location_adjustment: requirement([], "none", {}, "not_mechanical"),
  game_approach: requirement([], "none", {}, "not_mechanical"),
});
