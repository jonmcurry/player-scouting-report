import { CLAIM_REQUIREMENTS } from '../../services/development/evidence/claimRequirements.ts';
import { requirementSha256 } from '../../services/development/evidence/conceptApprovals.ts';
import type { Concept } from '../../services/development/evidence/types.ts';

// Wording only from implementation plan section 3.2. No inferred coaching claims.
const rationale: Partial<Record<Concept, string>> = {
  hip_shoulder_sequencing: 'depth-dominated from backstop view; revisit per capture profile in Stage 2',
  stance_setup: 'not eligible until the stance detector is measured (find_stance_frame known to mislocate)',
  timing: 'pitch timing not observable',
  swing_decision: 'not mechanical', pitch_location_adjustment: 'not mechanical', game_approach: 'not mechanical',
};
export async function renderConceptRequirementsDoc(): Promise<string> {
  const lines = ['# Concept evidence requirements', '',
    'Generated from CLAIM_REQUIREMENTS. Status: proposed; D7 review pending. No approvals exist.',
    'Contact is not universal. Event groups are ANDed; alternatives inside each group are ORed.',
    'Rationale text comes only from implementation plan section 3.2; absent rationales await the reviewer.',
    'SYNTHETIC diagrams illustrate proposed requirement completeness only, never biomechanical truth or display authorization.',
    'All examples are text; no media or athletes. Visibility and camera constraints must also hold.',
    'Sequence-bound event substitutions are not approved. Baseline produces no swing_launch or stride_foot_lift.', '',
    '| Concept | Required events (AND of OR groups) | Images | Min sequence frames | Visibility | Camera restriction | Disabled reason | Requirement SHA-256 |',
    '|---|---|---|---:|---|---|---|---|'];
  for (const concept of Object.keys(CLAIM_REQUIREMENTS) as Concept[]) {
    const r = CLAIM_REQUIREMENTS[concept];
    const events = r.events.map(g => '(' + g.join(' OR ') + ')').join(' AND ') || 'none';
    lines.push(`| ${concept} | ${events} | ${r.images} | ${r.minSequenceFrames} | ${JSON.stringify(r.visibility)} | ${r.cameraProfiles === null ? 'no additional restriction' : JSON.stringify(r.cameraProfiles)} | ${r.disabledReason ?? 'none'} | ${await requirementSha256(concept)} |`);
  }
  for (const concept of Object.keys(CLAIM_REQUIREMENTS) as Concept[]) {
    const r = CLAIM_REQUIREMENTS[concept];
    const events = r.events.map(g => '[' + g[0] + ']').join(' -> ');
    lines.push('', `## ${concept}`, '', `Rationale: ${rationale[concept] ?? 'Rationale pending reviewer (D7)'}`, '',
      'Status: proposed — no approval recorded (D7 pending)', '', '```text', 'SYNTHETIC sufficient evidence example:',
      ...(r.disabledReason ? ['[frame] -> [frame] => NONE: concept disabled; no sufficient example exists.'] : [
        `events: ${events}`,
        `frames: ${Array.from({ length: r.images.includes('sequence') ? r.minSequenceFrames : 1 }, (_, i) => '[f' + i + ']').join(' -> ')}`,
        `supplied: ${r.images}; required events covered; visibility: ${JSON.stringify(r.visibility)}; camera: unrestricted`,
      ]), 'SYNTHETIC insufficient evidence example:',
      r.disabledReason ? '[frame] -> [frame] => withheld: disabled regardless of frames.'
        : `[missing ${r.events[0]?.[0] ?? 'evidence'}] -> [frame] => required event group unsatisfied (all its alternatives absent).`,
      '```');
  }
  return lines.join('\n') + '\n';
}
