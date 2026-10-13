/** Existing legacy prompt/database phase vocabulary, unchanged. */
export const ISSUE_PHASES = ["stance", "load", "stride", "contact", "extension", "follow_through"] as const;
export type PhaseSlug = (typeof ISSUE_PHASES)[number];
