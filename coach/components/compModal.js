// "Compare against Reference Comp" modal. Shows a generic, non-identifying
// illustration + the sourced cue text - NEVER a real photo of a real named
// athlete (confirmed decision: this repo has already rebuilt one page from
// real video to a generic figure specifically to avoid using even the
// player's OWN likeness; using real photos of real professional/college
// athletes here would be a bigger step in the wrong direction, not smaller,
// and a real licensing/rights problem besides).
//
// Comp text is the same sourced softball bank already used in readme.md /
// the public report templates - weighted softball-first per this project's
// existing, fact-checked convention, not re-derived here.
import { buildExtensionCorrectedFrames, renderSkeletonComparison, renderSkeletonFrameToCanvas } from "./skeletonComparison.js";

const COMP_BY_CHECKPOINT = {
  "hip-shoulder-sep": {
    illustration: "hip-shoulder-separation.svg",
    comp: "Haylie McCleney",
    cue: "Documented hips→torso→shoulders→barrel sequencing - hips lead, shoulders follow a beat later.",
  },
  "swing-decisions": {
    illustration: "swing-decisions.svg",
    comp: "Haylie McCleney",
    cue: "Same sequencing discipline extended to pitch selection - swinging at strikes, taking balls.",
  },
  extension: {
    illustration: "extension.svg",
    comp: "Sierra Romero",
    cue: 'Lets the ball travel deep before releasing the barrel - the "let it travel" cue.',
  },
  "contact-point": {
    illustration: "contact-point.svg",
    comp: "Sierra Romero",
    cue: "Deeper contact point, same 'let it travel' principle as her extension cue.",
  },
  "bat-path": {
    illustration: "bat-path.svg",
    comp: "Lauren Chamberlain",
    cue: "Keeps the barrel through the zone longer for lift, instead of a short chop.",
  },
  "stance-setup": {
    illustration: "stance-setup.svg",
    comp: "Amanda Chidester",
    cue: "Swings at ~85% effort deliberately from a balanced setup, trading power for consistency.",
  },
  load: {
    illustration: "load.svg",
    comp: "Jocelyn Alo",
    cue: "Keeps the load compact and controlled to stay in the zone under pressure.",
  },
  stride: {
    illustration: "stride.svg",
    comp: "Natasha Watley",
    cue: "Documented footwork discipline through the stride - controlled, not lunging.",
  },
  "hand-path": {
    illustration: "hand-path.svg",
    comp: "Natasha Watley",
    cue: "Documented hand-path efficiency to the ball.",
  },
  "head-eyes": {
    illustration: "head-eyes.svg",
    comp: "Amanda Chidester",
    cue: "Consistent head position through contact supports her zone-wide consistency.",
  },
  "follow-through": {
    illustration: "follow-through.svg",
    comp: "Sierra Romero",
    cue: "Full finish following the same extension the ball-travel cue produces.",
  },
};

// Tier 1: the only 2 checkpoints with a genuine single-angle correspondence
// in pose_3d.json's angles dict (see the approved plan's section 3) - get
// the live real-vs-corrected skeleton comparison, not a static split.
const TIER_1_CHECKPOINTS = new Set(["extension", "hip-shoulder-sep"]);

// Tier 2: the 5 remaining checkpoints that correspond to one real instant
// in the swing (a real phase timestamp), get a static real-skeleton
// snapshot at that phase - not a live comparison (no single-angle target
// exists for these), not illustration-only either. Tier 3 (everything not
// listed here or in TIER_1_CHECKPOINTS: hand-path, bat-path, head-eyes,
// swing-decisions) evaluates across the whole swing, not one frame or one
// angle - illustration-only, unchanged, an honest scope boundary rather
// than an invented mapping.
const CHECKPOINT_TO_PHASE_SLUG = {
  "stance-setup": "stance",
  load: "load",
  stride: "stride",
  "contact-point": "contact",
  "follow-through": "follow-through",
};

// onClose disposes any live WebGL scene(s) mounted inside the modal
// (skeletonScene.js) - a real GPU context per canvas, not just DOM nodes, so
// closing the modal must free it explicitly rather than rely on garbage
// collection (browsers cap how many WebGL contexts can be live at once).
/** Shared modal-backdrop shell (used internally by this file's own comp
 * modals, and reused directly by team.html's "Add Player" modal rather than
 * duplicating the same ~15-line pattern a third time). Markup passed via
 * innerHTML must include one `.close-btn` element. */
export function closeableModal(innerHTML, onClose) {
  const backdrop = document.createElement("div");
  backdrop.className = "modal-backdrop";
  backdrop.innerHTML = innerHTML;
  const close = () => {
    if (onClose) onClose();
    backdrop.remove();
  };
  backdrop.querySelector(".close-btn").addEventListener("click", close);
  backdrop.addEventListener("click", (e) => {
    if (e.target === backdrop) close();
  });
  document.body.appendChild(backdrop);
  return backdrop;
}

/** Tier 1: the full live real-vs-corrected (or real-only, when no
 * correction applies) skeleton comparison, reusing the exact same component
 * player.html mounts per game-log card - "fully superseded by the new
 * comparison" per the approved plan, not a separate static view. */
async function openTier1Modal(checkpointSlug, checkpointLabel, info, clipContext) {
  let sceneHandle = null;
  const backdrop = closeableModal(
    `
    <div class="modal" style="max-width:640px;">
      <button class="close-btn tap-target">✕</button>
      <h2 style="margin-top:0;">${checkpointLabel}</h2>
      <div class="skeleton-comparison-mount"></div>
      ${info.comp ? `<p><b>Reference comp: ${info.comp}</b></p>` : ""}
      <p>${info.cue}</p>
    </div>
  `,
    () => sceneHandle && sceneHandle.dispose(),
  );

  let correctedFrames = null;
  let note;
  if (checkpointSlug === "extension") {
    correctedFrames = buildExtensionCorrectedFrames(clipContext.realFrames, clipContext.leadSide, clipContext.extensionScore);
    note = !clipContext.leadSide
      ? "Front-leg side unknown for this clip - showing her real swing only."
      : correctedFrames
        ? null
        : "Extension is already at target, or unscored - showing her real swing only.";
  } else {
    // hip-shoulder-sep: no validated angle-to-score mapping exists anywhere
    // in this codebase (scripts/pose3d/pose3d_to_checklist.py's own
    // docstring says so explicitly) - shown real-only rather than inventing
    // a target, per the approved plan's section 3 decision.
    note = "No calibrated healthy target exists yet for hip-shoulder separation - showing her real swing only.";
  }

  sceneHandle = await renderSkeletonComparison(backdrop.querySelector(".skeleton-comparison-mount"), {
    realFrames: clipContext.realFrames,
    correctedFrames,
    phases: clipContext.phases,
    note,
  });
}

/**
 * @param {string} checkpointSlug
 * @param {string} checkpointLabel
 * @param {{ realFrames: Array, phases: Array<{slug: string, timeS: number|null}>, leadSide: "l"|"r"|null, extensionScore: number|null } | null} [clipContext]
 *   Real clip context from the currently-loaded game log, if any - see
 *   player.html's loadClipsForEntry(). Omit or pass null to always get the
 *   illustration-only modal (e.g. no clip processed yet for this player).
 */
export function openCompModal(checkpointSlug, checkpointLabel, clipContext) {
  const info = COMP_BY_CHECKPOINT[checkpointSlug] ?? {
    illustration: "generic-swing.svg",
    comp: null,
    cue: "No specific reference comp for this checkpoint yet.",
  };

  if (TIER_1_CHECKPOINTS.has(checkpointSlug) && clipContext) {
    // Not awaited - openCompModal() itself stays synchronous (the modal
    // backdrop appears immediately, showing its own "Loading 3D model..."
    // state; see renderSkeletonComparison). Caught here so a real network
    // failure loading the character model surfaces as a visible alert
    // instead of a silent unhandled rejection.
    openTier1Modal(checkpointSlug, checkpointLabel, info, clipContext).catch((err) => {
      console.error(err);
      alert(`Couldn't load the 3D model: ${err.message}`);
    });
    return;
  }

  const phaseSlug = CHECKPOINT_TO_PHASE_SLUG[checkpointSlug];
  const phase =
    clipContext && phaseSlug
      ? clipContext.phases.find((p) => p.slug === phaseSlug && p.timeS !== null)
      : null;

  let sceneHandle = null;
  const backdrop = closeableModal(
    `
    <div class="modal">
      <button class="close-btn tap-target">✕</button>
      <h2 style="margin-top:0;">${checkpointLabel}</h2>
      ${
        phase
          ? `
        <div class="comp-split">
          <div class="comp-split-col">
            <p class="hint" style="text-align:center;margin:0 0 4px;">Her reconstructed swing</p>
            <canvas class="comp-extracted-frame"></canvas>
          </div>
          <div class="comp-split-col">
            <p class="hint" style="text-align:center;margin:0 0 4px;">Reference (generic)</p>
            <img src="./illustrations/${info.illustration}" alt="Illustrative diagram (generic, not a real player)">
          </div>
        </div>
        <p class="hint" style="text-align:center;">Left side: a real 3D pose reconstructed from her filmed swing, rendered as a
          skeleton, not a video frame. Right side: illustrative diagram only — not a photo of any real player or athlete.</p>
      `
          : `
        <div style="width:100%;max-width:220px;margin:0 auto;">
          <img src="./illustrations/${info.illustration}" alt="Illustrative diagram (generic, not a real player)" style="width:100%;">
        </div>
        <p class="hint" style="text-align:center;">Illustrative diagram only — not a photo of any real player or athlete.</p>
      `
      }
      ${info.comp ? `<p><b>Reference comp: ${info.comp}</b></p>` : ""}
      <p>${info.cue}</p>
    </div>
  `,
    () => sceneHandle && sceneHandle.dispose(),
  );

  if (phase) {
    const canvasEl = backdrop.querySelector(".comp-extracted-frame");
    renderSkeletonFrameToCanvas(clipContext.realFrames, phase.timeS, canvasEl)
      .then((handle) => { sceneHandle = handle; })
      .catch((err) => {
        console.error(err);
        alert(`Couldn't load the 3D model: ${err.message}`);
      });
  }
}
