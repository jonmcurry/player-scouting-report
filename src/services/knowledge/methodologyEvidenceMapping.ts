/**
 * Deterministic mapping from the research/import-pipeline evidence-type
 * vocabulary (used across docs/research/methodology-seed-v1.md and
 * docs/research/methodology-seed-v1.import.json) to the production
 * methodology_claims.evidence_type vocabulary (see
 * supabase/migrations/00030_methodology_governance.sql SS4).
 *
 * This is the single source of truth an import script must use - no silent
 * coercion, no ad hoc re-derivation elsewhere. Every research label maps to
 * exactly one production label, and no mapping changes what either label
 * actually means:
 *
 *   coaching_instruction   -> coaching_experience  (a stated instructional/
 *                              practice convention is a species of coaching
 *                              experience)
 *   coaching_heuristic     -> coaching_experience  (an experiential
 *                              diagnostic heuristic is a species of
 *                              coaching experience)
 *   research_supported     -> research             (identical meaning)
 *   expert_opinion         -> expert_opinion        (identical, unchanged)
 *   drill_prescription     -> drill_prescription    (production vocabulary
 *                              was minimally extended for this - a
 *                              prescribed practice protocol is
 *                              categorically different from an experiential
 *                              judgment, and collapsing it into
 *                              coaching_experience would lose real meaning)
 *   biomechanical_explanation -> biomechanical_explanation (also newly
 *                              added - a mechanistic/anatomical account is
 *                              categorically different from experience,
 *                              research, or a drill)
 *
 * Any research label not in this map has no defined production mapping -
 * mapResearchEvidenceType() throws rather than guessing, so a future
 * research vocabulary drift is caught at import time, not silently
 * miscategorized.
 */
import { METHODOLOGY_EVIDENCE_TYPES, type MethodologyEvidenceType } from "./methodologyTypes.js";

export const RESEARCH_EVIDENCE_TYPES = [
  "coaching_instruction", "coaching_heuristic", "drill_prescription",
  "biomechanical_explanation", "research_supported", "expert_opinion",
] as const;
export type ResearchEvidenceType = (typeof RESEARCH_EVIDENCE_TYPES)[number];

export const RESEARCH_TO_PRODUCTION_EVIDENCE_TYPE: Record<ResearchEvidenceType, MethodologyEvidenceType> = {
  coaching_instruction: "coaching_experience",
  coaching_heuristic: "coaching_experience",
  research_supported: "research",
  expert_opinion: "expert_opinion",
  drill_prescription: "drill_prescription",
  biomechanical_explanation: "biomechanical_explanation",
};

export function mapResearchEvidenceType(researchLabel: string): MethodologyEvidenceType {
  const mapped = RESEARCH_TO_PRODUCTION_EVIDENCE_TYPE[researchLabel as ResearchEvidenceType];
  if (!mapped) {
    throw new Error(
      `No deterministic mapping for research evidence_type "${researchLabel}" - ` +
        `add it to RESEARCH_TO_PRODUCTION_EVIDENCE_TYPE in methodologyEvidenceMapping.ts ` +
        `(and confirm it belongs in METHODOLOGY_EVIDENCE_TYPES) before importing, rather than guessing.`,
    );
  }
  if (!METHODOLOGY_EVIDENCE_TYPES.includes(mapped)) {
    throw new Error(`Mapped production evidence_type "${mapped}" is not in METHODOLOGY_EVIDENCE_TYPES - mapping table is out of sync with the schema.`);
  }
  return mapped;
}
