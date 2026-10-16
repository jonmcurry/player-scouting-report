/**
 * The swing window extract.ts samples its AI swing sequence from, as a pure
 * function so the evidence layer (PR10 shadow assessment) measures subject
 * signals over exactly the same analyzed frames instead of a re-derived copy.
 * Revision 1 S0-04 defines the subject window as "the same window extract.ts uses".
 *
 * Frames are analyzed-video indices (pose_2d.json), not raw-upload frames.
 */
export const SEQUENCE_LEAD_S = 0.1;
export const SEQUENCE_TAIL_S = 0.4;
export const SEQUENCE_MAX_S = 3;

export interface SwingWindowPhase { slug: string; frame: number }
export type SwingWindow =
  | { available: true; start: number; end: number; anchorFrame: number }
  | { available: false; reason: string };

/** Ends after the LAST located swing phase (contact/extension/follow-through),
 * starts just before load, and is capped at SEQUENCE_MAX_S. */
export function swingSequenceWindow(phases: readonly SwingWindowPhase[], fps: number, nFrames: number): SwingWindow {
  const load = phases.find((p) => p.slug === "load");
  const contact = phases.find((p) => p.slug === "contact");
  if (!load || !contact || contact.frame <= load.frame) {
    return { available: false, reason: "load and contact are not both located in order" };
  }
  const last = Math.max(...phases.filter((p) => ["contact", "extension", "follow_through"].includes(p.slug)).map((p) => p.frame));
  const start = Math.max(0, load.frame - Math.round(SEQUENCE_LEAD_S * fps));
  const end = Math.min(nFrames - 1, last + Math.round(SEQUENCE_TAIL_S * fps), start + Math.round(SEQUENCE_MAX_S * fps));
  return { available: true, start, end, anchorFrame: load.frame };
}
