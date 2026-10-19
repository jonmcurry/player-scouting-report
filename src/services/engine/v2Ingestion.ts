import { V2_IDENTITY } from "./engineSelection.js";

export const M1_PHASES = ["stance", "load", "stride", "contact", "extension", "follow_through"] as const;

/** v2 artifacts carry their own identity checks and clean-up, which only the worker's v2 path applies. */
export function assertV2IngestionRoute(metrics: Record<string, any>, existingVideoClipId?: string): void {
  if (metrics?.engine === V2_IDENTITY.engine && !existingVideoClipId) {
    throw new Error("v2 artifacts must be ingested by the worker v2 path");
  }
}

/** A v2 ingestion replaces all baseline phase/summary evidence, never fills gaps. */
export function v2IngestionPlan(metrics: Record<string, any>, pose: Record<string, any>) {
  if (metrics.engine !== V2_IDENTITY.engine || metrics.pipeline_version !== V2_IDENTITY.pipeline_version ||
      pose.meta?.engine !== V2_IDENTITY.engine || pose.meta?.pipeline_version !== V2_IDENTITY.pipeline_version) {
    throw new Error("Invalid v2 ingestion identity");
  }
  const frames = pose.frames as Array<{ frame: number; time_s: number }>;
  if (!Array.isArray(frames)) throw new Error("Missing v2 pose frames");
  for (const slug of M1_PHASES) {
    const phase = metrics.phases?.[slug];
    const absent = phase?.frame === null && phase.time_s === null &&
      typeof phase.reason === "string" && phase.reason.length > 0 && phase.method == null;
    const source = frames.find(f => f.frame === phase?.frame);
    const available = Number.isInteger(phase?.frame) && phase.frame >= 0 &&
      Number.isFinite(phase.time_s) && source && Number.isFinite(source.time_s) &&
      Math.abs(source.time_s - phase.time_s) <= 1e-6 &&
      typeof phase.method === "string" && phase.method.startsWith("v2:") && phase.reason == null;
    if (!absent && !available) {
      throw new Error(`Unexpected v2 phase: ${slug}`);
    }
  }
  return {
    deleteSummary: true,
    clipMetadata: { fps: pose.meta.fps, n_frames: frames.length,
      duration_s: frames.length ? frames[frames.length - 1]!.time_s - frames[0]!.time_s : null },
  };
}
