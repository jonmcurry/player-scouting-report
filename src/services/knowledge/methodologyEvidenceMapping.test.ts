import test from "node:test";
import assert from "node:assert/strict";
import { mapResearchEvidenceType, RESEARCH_EVIDENCE_TYPES, RESEARCH_TO_PRODUCTION_EVIDENCE_TYPE } from "./methodologyEvidenceMapping.js";
import { METHODOLOGY_EVIDENCE_TYPES } from "./methodologyTypes.js";

test("every research evidence type maps deterministically to a valid production evidence type", () => {
  for (const label of RESEARCH_EVIDENCE_TYPES) {
    const mapped = mapResearchEvidenceType(label);
    assert.ok(METHODOLOGY_EVIDENCE_TYPES.includes(mapped), `${label} -> ${mapped} must be a real production evidence_type`);
    // Deterministic: calling it again for the same input gives the same output.
    assert.equal(mapResearchEvidenceType(label), mapped);
  }
});

test("specific mappings match the documented, non-lossy scheme", () => {
  assert.equal(RESEARCH_TO_PRODUCTION_EVIDENCE_TYPE.coaching_instruction, "coaching_experience");
  assert.equal(RESEARCH_TO_PRODUCTION_EVIDENCE_TYPE.coaching_heuristic, "coaching_experience");
  assert.equal(RESEARCH_TO_PRODUCTION_EVIDENCE_TYPE.research_supported, "research");
  assert.equal(RESEARCH_TO_PRODUCTION_EVIDENCE_TYPE.expert_opinion, "expert_opinion");
  // These two were minimally added to production rather than collapsed
  // into an existing (semantically different) label.
  assert.equal(RESEARCH_TO_PRODUCTION_EVIDENCE_TYPE.drill_prescription, "drill_prescription");
  assert.equal(RESEARCH_TO_PRODUCTION_EVIDENCE_TYPE.biomechanical_explanation, "biomechanical_explanation");
});

test("an unknown research label throws rather than silently guessing", () => {
  assert.throws(() => mapResearchEvidenceType("some_new_unmapped_label"), /No deterministic mapping/);
});
