export type SwingDetectionState = "readable" | "confirmed_no_swing" | "inconclusive";

interface PipelineMetrics {
  phases?: Record<string, { frame?: number | null; time_s?: number | null }> | null;
  swing_detection?: { status?: string | null; confidence?: string | null } | null;
}

/**
 * Convert pipeline evidence into the only three report states the product
 * needs. A no-swing result requires an explicit high-confidence detector
 * signal. Missing phases, optional result chips, and generic detector errors
 * are inconclusive and can never become a claimed take.
 */
export function swingDetectionState(metrics: PipelineMetrics): SwingDetectionState {
  const hasLocatedPhase = Object.values(metrics.phases ?? {}).some(
    (phase) => typeof phase?.frame === "number" && typeof phase?.time_s === "number",
  );
  if (hasLocatedPhase) return "readable";
  if (metrics.swing_detection?.status === "no_swing" && metrics.swing_detection.confidence === "high") {
    return "confirmed_no_swing";
  }
  return "inconclusive";
}
