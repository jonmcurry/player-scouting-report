import { isEvidenceTuple } from "../evidenceRegistry.ts";
import { GATE_VERSION, PROPOSED_CLAIMS_VERSION } from "./version.ts";
import { assessClip, type ClipEvidenceAssessment, type ClipEvidenceInput } from "./assessClip.ts";
import { decideClaim } from "./decideClaim.ts";
import { extractClipEvidenceSignals, subjectSignalsFrom, type AiInputNames } from "./artifactSignals.ts";
import { ISSUE_PHASES } from "../../../domain/swingPhases.ts";
import { object } from "./validation.ts";
import type { Concept, EvidenceTuple, PhaseSlug } from "./types.ts";

/** Pipeline artifacts for ONE processing attempt. The worker adapter is
 * responsible for freshness (written during this attempt). */
export interface ShadowArtifacts {
  metrics: unknown; pose2d: unknown; batPath: unknown;
  /** Parsed engine_manifest.json, or null when absent/stale. */
  manifest: unknown;
  /** Exact frame_map.json text (hash-verified by PR8), or null when absent/stale. */
  frameMapJson: string | null;
  aiInputs: AiInputNames;
  captureProfile: string | null;
}
/** Insert shape for public.clip_evidence_assessments (PR9, S0-09). */
export interface ClipEvidenceAssessmentRow {
  video_clip_id: string;
  engine_code_version: string; instrumentation_version: string; environment_version: string;
  gate_version: string; claims_version: string; reliability_profile_version: string | null;
  mode: "shadow"; clip_status: "eligible" | "withhold";
  family_reason: ClipEvidenceAssessment["familyReason"];
  subject: unknown; events: unknown; strict_baseline: unknown;
  source_sha256: string; backfilled: false;
}
export type ShadowBuildResult =
  | { ok: true; row: ClipEvidenceAssessmentRow; input: ClipEvidenceInput; assessment: ClipEvidenceAssessment }
  | { ok: false; reason: "source_hash_unavailable" | "tuple_unavailable" | "source_hash_mismatch" };

const SHA256 = /^[a-f0-9]{64}$/;

/** Observed tuple: engine/instrumentation/environment exactly as the PR6
 * manifest recorded them (environment_version is the actual captured identity,
 * null when capture failed). No field is inferred or defaulted. */
export function observedTuple(manifest: unknown): EvidenceTuple | null {
  const m = object(manifest);
  const tuple = { engineCodeVersion: m.engine_code_version, instrumentationVersion: m.instrumentation_version,
    environmentVersion: m.environment_version, gateVersion: GATE_VERSION, claimsVersion: PROPOSED_CLAIMS_VERSION,
    reliabilityProfileVersion: null };
  return isEvidenceTuple(tuple) ? tuple : null;
}

/** Pure. Builds the clip assessment and its PR9 row. Skips (never guesses)
 * when the run's provenance cannot be tied to the worker's own source hash. */
export async function buildShadowAssessment(args: {
  videoClipId: string; sourceSha256: string | null; artifacts: ShadowArtifacts;
}): Promise<ShadowBuildResult> {
  if (typeof args.sourceSha256 !== "string" || !SHA256.test(args.sourceSha256)) return { ok: false, reason: "source_hash_unavailable" };
  const a = args.artifacts, tuple = observedTuple(a.manifest);
  if (!tuple) return { ok: false, reason: "tuple_unavailable" };
  if (object(a.manifest).input_sha256 !== args.sourceSha256) return { ok: false, reason: "source_hash_mismatch" };
  const strictSignals = extractClipEvidenceSignals({ pose2d: a.pose2d, batPath: a.batPath, metrics: a.metrics,
    aiInputs: a.aiInputs, captureProfile: a.captureProfile });
  const input: ClipEvidenceInput = { tuple, subject: subjectSignalsFrom(strictSignals), metrics: a.metrics,
    frameMap: a.frameMapJson === null ? null : { frameMapJson: a.frameMapJson, manifest: a.manifest }, strictSignals };
  const assessment = await assessClip(input);
  return { ok: true, input, assessment, row: {
    video_clip_id: args.videoClipId,
    engine_code_version: tuple.engineCodeVersion, instrumentation_version: tuple.instrumentationVersion,
    environment_version: tuple.environmentVersion, gate_version: tuple.gateVersion,
    claims_version: tuple.claimsVersion, reliability_profile_version: tuple.reliabilityProfileVersion,
    mode: "shadow", clip_status: assessment.clipStatus, family_reason: assessment.familyReason,
    subject: assessment.subject, events: assessment.events, strict_baseline: assessment.strictBaseline,
    source_sha256: args.sourceSha256, backfilled: false,
  } };
}

/**
 * Minimal per-issue record for issues.claim_decision (coach-readable via RLS,
 * never selected by parent-facing paths). Carries statuses and versions only:
 * no subject signals, frames, file names or text. Supplied evidence is
 * explicitly marked unavailable because the S0-10 evidence package (PR12) does
 * not exist yet; V3 is therefore recorded as computed without supplied media,
 * not as a finding that media was missing. Never displayable or enforce-eligible.
 */
export async function buildClaimDecisionRecord(input: ClipEvidenceInput, issue: { concept: unknown; phase: unknown },
  assessmentId: string) {
  const phase = (ISSUE_PHASES as readonly unknown[]).includes(issue.phase) ? issue.phase as PhaseSlug : null;
  const decision = await decideClaim({ ...input, concept: issue.concept as Concept, phase,
    supplied: null, visibility: null, mode: "shadow" });
  return {
    schema: "claim-decision-shadow-1",
    assessmentId, mode: "shadow" as const,
    concept: typeof issue.concept === "string" ? issue.concept : null, phase,
    gateVersion: decision.clip.subject.gateVersion, claimsVersion: decision.sufficiency.claimsVersion,
    clipStatus: decision.clip.clipStatus,
    requiredEvents: Object.fromEntries(decision.sufficiency.requiredEvents
      .map(event => [event, decision.clip.events[event].status])),
    sufficiency: { status: decision.sufficiency.status, missing: [...decision.sufficiency.missing],
      requirementStatus: decision.sufficiency.requirementStatus },
    reliability: { status: decision.reliability.status, profileVersion: decision.reliability.profileVersion },
    suppliedEvidence: { status: "unavailable" as const, reason: "evidence_package_not_implemented" },
    hypothetical: { wouldDisplay: decision.hypothetical.wouldDisplay, authorizedForProduction: false as const },
    displayable: false as const, enforceEligible: false as const,
    authorizationReasons: [...decision.authorizationReasons],
  };
}
export type ClaimDecisionRecord = Awaited<ReturnType<typeof buildClaimDecisionRecord>>;
