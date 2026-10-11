/** Phase 1 read model. No endpoint calls this until a later, authorized phase. */
export const sourceLabels = {
  video_observed: "Observed in video",
  video_estimated: "Estimated from video",
  comparable_video: "Calculated from comparable video",
  external_device: "Measured by device/provider",
  coach_entered: "Entered by coach/user",
} as const;

export type SourceClass = keyof typeof sourceLabels;
export type ValidationStatus = "experimental" | "validated_internal" | "validated_external" | "retired";
export type ExclusionReason =
  | "incompatible_capture" | "hidden_body_part" | "detector_uncertainty"
  | "deleted_media" | "intent_mismatch" | "environment_mismatch"
  | "definition_version_mismatch" | "insufficient_quality"
  | "wrong_athlete" | "unknown_context";

export const exclusionLabels: Record<ExclusionReason, string> = {
  incompatible_capture: "Different camera setup",
  hidden_body_part: "Required body part was hidden",
  detector_uncertainty: "Event timing was uncertain",
  deleted_media: "Source video was deleted",
  intent_mismatch: "Different attempt type",
  environment_mismatch: "Different setting",
  definition_version_mismatch: "Different measurement definition",
  insufficient_quality: "Video quality was insufficient",
  wrong_athlete: "Different athlete",
  unknown_context: "Attempt context was unknown",
};

export interface EvidenceReadRow {
  packageId: string;
  playerId: string;
  clipId: string;
  resultKey: string;
  definitionSlug: string;
  definitionVersion: string;
  plainDefinition: string;
  status: ValidationStatus;
  sourceClass: SourceClass;
  provider?: string | null;
  value: unknown;
  uncertainty: { status: string; lower?: number; upper?: number };
  limitation: string;
  versions: {
    pipeline: string; detector: string; measurement: string;
    methodology: string; prompt: string; model: string;
  };
  items: Array<{
    kind: string; role: "included" | "excluded" | "context";
    frameStart?: number | null; frameEnd?: number | null;
    fps?: number | null; uncertaintyFrames?: number | null;
    exclusionReason?: ExclusionReason | null;
    // Internal-only fields may coexist on storage rows. Never spread them.
    [key: string]: unknown;
  }>;
  [key: string]: unknown;
}

/** A view-specific, explicit allowlist. Authorization must happen before calling. */
export function projectEvidence(row: EvidenceReadRow, view: "family" | "coach" | "performance_lab") {
  if (row.status !== "validated_internal" && row.status !== "validated_external") return null;
  if (view === "family") return null; // Phase 1 makes no family claim available.
  if (!row.items.some((item) => item.role === "included")) return null;
  const source = row.sourceClass === "external_device"
    ? row.provider ? `Measured by ${row.provider}` : null
    : sourceLabels[row.sourceClass];
  if (!source) return null;
  return {
    result: row.resultKey,
    definition: { slug: row.definitionSlug, version: row.definitionVersion, text: row.plainDefinition },
    source,
    value: row.value,
    uncertainty: row.uncertainty,
    limitation: row.limitation,
    versions: { pipeline: row.versions.pipeline, detector: row.versions.detector,
      measurement: row.versions.measurement, methodology: row.versions.methodology,
      prompt: row.versions.prompt, model: row.versions.model },
    evidence: row.items.map((item) => ({
      kind: item.kind, role: item.role, frameStart: item.frameStart ?? null,
      frameEnd: item.frameEnd ?? null, fps: item.fps ?? null,
      uncertaintyFrames: item.uncertaintyFrames ?? null,
      exclusion: item.exclusionReason ? exclusionLabels[item.exclusionReason] : null,
    })),
  };
}
