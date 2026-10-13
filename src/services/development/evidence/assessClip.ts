import { isEvidenceTuple, resolveTuple } from "../evidenceRegistry.ts";
import { localiseEvents } from "./events.ts";
import { assessSubject, type SubjectValidity } from "./subject.ts";
import { assessStrictBaseline, type StrictBaselineAssessment } from "./strictBaseline.ts";
import type { EvidenceTuple, EventAssessments } from "./types.ts";
import { object } from "./validation.ts";
export interface ClipEvidenceAssessment {
  tuple: EvidenceTuple | null; subject: SubjectValidity; events: EventAssessments;
  clipStatus: "eligible" | "withhold";
  familyReason: "batter_unclear" | "swing_unclear" | "analysis_version_unavailable" | null;
  strictBaseline: StrictBaselineAssessment;
}
export interface ClipEvidenceInput {
  tuple: unknown; subject: unknown; metrics: unknown; frameMap: unknown;
  /** Explicit original-contract inputs; never infer legacy signals from tuple defaults. */
  strictSignals?: unknown;
}
/** An availability assessment, never a report gate. Unknown tuples do not acquire
 * defaults, and a failed event is never promoted to a clip-wide subject failure. */
export async function assessClip(input: ClipEvidenceInput): Promise<ClipEvidenceAssessment> {
  const entry = resolveTuple(input.tuple), subject = assessSubject(input.subject);
  const manifest = object(object(input.frameMap).manifest);
  const known = entry && manifest.engine_code_version === entry.engineCodeVersion
    && manifest.instrumentation_version === entry.instrumentationVersion
    && manifest.environment_version === entry.environmentVersion;
  return { tuple: isEvidenceTuple(input.tuple) ? { ...input.tuple } : null, subject,
    events: await localiseEvents(input.metrics, input.frameMap),
    clipStatus: known && subject.status === "pass" ? "eligible" : "withhold",
    familyReason: !known || subject.reasons.includes("subject_thresholds_unavailable")
      ? "analysis_version_unavailable" : subject.status === "pass" ? null
      : subject.reasons.includes("window_unavailable") ? "swing_unclear" : "batter_unclear",
    strictBaseline: assessStrictBaseline(input.strictSignals) };
}
