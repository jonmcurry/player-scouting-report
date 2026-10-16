import type { getSupabaseClient } from "./supabaseClient.js";
import type { ClaimDecisionRecord, ClipEvidenceAssessmentRow } from "../development/evidence/shadowAssessment.js";

/** PR10 shadow writes only. All three are additive to PR9's schema and never
 * touch processing state, report text, review status, focus or notifications. */
export interface EvidenceShadowDb {
  insertAssessment(row: ClipEvidenceAssessmentRow): Promise<string>;
  /** Links a provider run to the assessment from the SAME processing attempt; never overwrites. */
  linkRun(analysisRunId: string, assessmentId: string): Promise<void>;
  runIssues(analysisRunId: string): Promise<{ id: string; concept: unknown; phase: unknown }[]>;
  /** Sets a still-null claim_decision on an issue of this run; never overwrites. */
  recordClaimDecision(issueId: string, analysisRunId: string, decision: ClaimDecisionRecord): Promise<void>;
}

// Errors carry a fixed description and the database error code only - never
// the driver message, which can echo row values.
const failure = (what: string, error: { code?: string } | null) =>
  new Error(`${what} failed (${error?.code ?? "no_row"})`);

export function supabaseEvidenceShadowDb(client: ReturnType<typeof getSupabaseClient>): EvidenceShadowDb {
  return {
    async insertAssessment(row) {
      const { data, error } = await client.from("clip_evidence_assessments").insert(row).select("id").single();
      if (error || !data) throw failure("evidence assessment insert", error);
      return data.id as string;
    },
    async linkRun(analysisRunId, assessmentId) {
      const { error } = await client.from("analysis_runs").update({ evidence_assessment_id: assessmentId })
        .eq("id", analysisRunId).is("evidence_assessment_id", null);
      if (error) throw failure("analysis run evidence link", error);
    },
    async runIssues(analysisRunId) {
      const { data, error } = await client.from("issues").select("id, concept, phase").eq("analysis_run_id", analysisRunId);
      if (error) throw failure("run issue lookup", error);
      return (data ?? []) as { id: string; concept: unknown; phase: unknown }[];
    },
    async recordClaimDecision(issueId, analysisRunId, decision) {
      const { error } = await client.from("issues").update({ claim_decision: decision })
        .eq("id", issueId).eq("analysis_run_id", analysisRunId).is("claim_decision", null);
      if (error) throw failure("issue claim decision", error);
    },
  };
}
