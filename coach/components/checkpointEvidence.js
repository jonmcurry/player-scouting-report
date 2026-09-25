// What kind of evidence each checklist checkpoint is judged from - the coach app's one definition
// (used by compModal.js). Plain data, no DOM, so Node tests can import it too.
//
// Mirrored by src/types/scouting.ts CHECKPOINT_EVIDENCE_TIERS: the Node/TypeScript side (and its
// Docker image, which ships src/ only) cannot import this browser module at runtime, and this app
// has no build step to import TypeScript. src/services/ai/semanticValidation.test.ts imports this
// file and fails if the two definitions ever differ - change both together.
//
//   single-angle   - a genuine single-angle correspondence in pose_3d.json's angles dict
//   single-instant - corresponds to one real swing instant; `phase` is its swing_phase_types slug
//   whole-swing    - evaluated across the whole swing, not one frame or one angle
// `phase` on a single-angle checkpoint is the instant its angle is read at, when there is one.
export const CHECKPOINT_EVIDENCE_TIERS = {
  "stance-setup": { tier: "single-instant", phase: "stance" },
  load: { tier: "single-instant", phase: "load" },
  stride: { tier: "single-instant", phase: "stride" },
  "hip-shoulder-sep": { tier: "single-angle", phase: null },
  "hand-path": { tier: "whole-swing", phase: null },
  "bat-path": { tier: "whole-swing", phase: null },
  "contact-point": { tier: "single-instant", phase: "contact" },
  extension: { tier: "single-angle", phase: "extension" },
  "head-eyes": { tier: "whole-swing", phase: null },
  "follow-through": { tier: "single-instant", phase: "follow-through" },
  "swing-decisions": { tier: "whole-swing", phase: null },
};
