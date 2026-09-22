/**
 * Runtime shape of a frozen methodology_version_items.item_payload row, as
 * written by publish_methodology_snapshot() in
 * supabase/migrations/00029_methodology_knowledge.sql. This is the ONLY
 * shape the runtime analysis path ever reads - never methodology_claims
 * directly (candidate/rejected/disputed rows must never reach a prompt).
 */
import type { AgeBand, Sport } from "../ai/analysisContext.js";
import { CONCEPTS, type Concept } from "./knowledgePack.js";

export { CONCEPTS };
export type { Concept };

export const METHODOLOGY_AGE_GUARDRAILS = [
  "youth_appropriate", "teen_appropriate", "advanced_only", "requires_physical_screening",
] as const;
export type MethodologyAgeGuardrail = (typeof METHODOLOGY_AGE_GUARDRAILS)[number];

export const METHODOLOGY_EVIDENCE_TYPES = [
  "research", "instrumented_measurement", "coaching_experience", "video_observation",
  "expert_opinion", "analogy", "unknown", "drill_prescription", "biomechanical_explanation",
] as const;
export type MethodologyEvidenceType = (typeof METHODOLOGY_EVIDENCE_TYPES)[number];

export interface MethodologyItem {
  claimId: string;
  /** Durable research/import-pipeline ID (e.g. "DRV2-001"), if the claim has one - see methodologyEvidenceMapping.ts's header for why this is kept separate from claimId (the generated uuid). */
  candidateId: string | null;
  reviewMethod: "human" | "dual_model" | "mixed" | null;
  humanVerified: boolean;
  concept: string;
  approvedText: string;
  observableEvidence: string;
  coachingCue: string | null;
  appliesWhen: string;
  doesNotApplyWhen: string;
  sportScope: Sport | "both";
  levelScope: string[];
  ageGuardrail: MethodologyAgeGuardrail;
  evidenceType: MethodologyEvidenceType;
  numericClaim: boolean;
  numericEvidenceRef: string | null;
  sourceName: string;
  sourceUrl: string;
  materialTitle: string;
  materialUrl: string;
  materialExternalId: string | null;
  materialPublishedAt: string | null;
  sourceStartSeconds: number | null;
  sourceEndSeconds: number | null;
  sourceLocation: string | null;
  reviewedBy: string | null;
  reviewedAt: string | null;
}

export interface MethodologySnapshot {
  versionLabel: string;
  items: MethodologyItem[];
}

const isRecord = (v: unknown): v is Record<string, unknown> => !!v && typeof v === "object" && !Array.isArray(v);
const str = (v: unknown, fallback = ""): string => (typeof v === "string" ? v : fallback);
const strOrNull = (v: unknown): string | null => (typeof v === "string" ? v : null);
const numOrNull = (v: unknown): number | null => (typeof v === "number" ? v : null);

/**
 * Validates one frozen item_payload row, failing loudly on anything
 * malformed rather than silently passing bad data into a prompt. Ageband/
 * evidence-type values that don't match the current vocabulary are
 * rejected rather than coerced - a schema drift between publish-time and
 * read-time must be visible, not silently reinterpreted.
 */
export function parseMethodologyItem(claimId: string, payload: unknown): MethodologyItem {
  if (!isRecord(payload)) throw new Error(`methodology item ${claimId}: item_payload must be an object`);
  const ageGuardrail = payload.age_guardrail;
  if (!METHODOLOGY_AGE_GUARDRAILS.includes(ageGuardrail as MethodologyAgeGuardrail)) {
    throw new Error(`methodology item ${claimId}: invalid age_guardrail`);
  }
  const evidenceType = payload.evidence_type;
  if (!METHODOLOGY_EVIDENCE_TYPES.includes(evidenceType as MethodologyEvidenceType)) {
    throw new Error(`methodology item ${claimId}: invalid evidence_type`);
  }
  const sportScope = payload.sport_scope;
  if (sportScope !== "baseball" && sportScope !== "softball" && sportScope !== "both") {
    throw new Error(`methodology item ${claimId}: invalid sport_scope`);
  }
  if (typeof payload.approved_text !== "string" || !payload.approved_text) {
    throw new Error(`methodology item ${claimId}: approved_text is required`);
  }
  return {
    claimId,
    candidateId: strOrNull(payload.candidate_id),
    reviewMethod: (payload.review_method === "human" || payload.review_method === "dual_model" || payload.review_method === "mixed") ? payload.review_method : null,
    humanVerified: payload.human_verified === true,
    concept: str(payload.concept),
    approvedText: payload.approved_text,
    observableEvidence: str(payload.observable_evidence),
    coachingCue: strOrNull(payload.coaching_cue),
    appliesWhen: str(payload.applies_when),
    doesNotApplyWhen: str(payload.does_not_apply_when),
    sportScope,
    levelScope: Array.isArray(payload.level_scope) ? payload.level_scope.filter((x): x is string => typeof x === "string") : [],
    ageGuardrail: ageGuardrail as MethodologyAgeGuardrail,
    evidenceType: evidenceType as MethodologyEvidenceType,
    numericClaim: payload.numeric_claim === true,
    numericEvidenceRef: strOrNull(payload.numeric_evidence_ref),
    sourceName: str(payload.source_name),
    sourceUrl: str(payload.source_url),
    materialTitle: str(payload.material_title),
    materialUrl: str(payload.material_url),
    materialExternalId: strOrNull(payload.material_external_id),
    materialPublishedAt: strOrNull(payload.material_published_at),
    sourceStartSeconds: numOrNull(payload.source_start_seconds),
    sourceEndSeconds: numOrNull(payload.source_end_seconds),
    sourceLocation: strOrNull(payload.source_location),
    reviewedBy: strOrNull(payload.reviewed_by),
    reviewedAt: strOrNull(payload.reviewed_at),
  };
}

export type { AgeBand };
