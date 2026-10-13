/** Existing coaching taxonomy, shared without loading knowledge files. */
export const CONCEPTS = [
  "stance_setup", "load", "stride_plant", "hip_shoulder_sequencing", "hand_path", "barrel_path",
  "contact", "extension", "head_visual_stability", "finish_balance", "swing_decision", "timing",
  "front_side_stability", "posture", "barrel_depth", "pitch_location_adjustment", "game_approach",
] as const;
export type Concept = (typeof CONCEPTS)[number];
