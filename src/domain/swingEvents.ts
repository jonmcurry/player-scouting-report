/** PR3 vocabulary, shared without loading the annotation validator or storage. */
export const SWING_EVENTS = ["stance_set", "load_start", "stride_foot_lift", "foot_plant", "swing_launch", "impact_estimate", "contact_confirmed", "finish"] as const;
export type SwingEventSlug = typeof SWING_EVENTS[number];
/** Presentation-order source frame and exact integer PTS (not seconds). */
export interface FrameIdentity { frame_index: number; pts: number }
