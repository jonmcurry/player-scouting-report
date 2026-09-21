export type Vec3 = [number, number, number];
export type Quat = [number, number, number, number];
export type ObservationStatus = "observed" | "interpolated" | "model_inferred" | "missing";
export type ConfidenceLevel = "high" | "medium" | "low";

// PIPELINE_VERSION and COORDINATE_SYSTEM are persisted in stored reconstructions and validated on load
// (serialization.ts). The historical product-name prefix in these values is deliberate: changing it would
// make every existing stored animation fail that check. They are format identifiers, not branding.
export const PIPELINE_VERSION = "barreltrace-reconstruction-v1";
export const SKELETON_VERSION = "h36m17-v1";
export const ANIMATION_FORMAT_VERSION = 1;

/** HitterLoop canonical coordinates: X=batter left/right, Y=vertical, Z=toward pitcher. */
export const COORDINATE_SYSTEM = "barreltrace-x-right-y-up-z-pitcher" as const;

export interface ReconstructionFrame {
  frame: number;
  t: number;
  rootPosition: Vec3;
  rootRotation: Quat;
  joints: Record<string, Quat>;
  bat: { position: Vec3; rotation: Quat; confidence: number; status: ObservationStatus } | null;
  confidence: number;
}

export interface ReconstructionAnimation {
  formatVersion: typeof ANIMATION_FORMAT_VERSION;
  fps: number;
  duration: number;
  coordinateSystem: typeof COORDINATE_SYSTEM;
  skeletonVersion: typeof SKELETON_VERSION;
  pipelineVersion: typeof PIPELINE_VERSION;
  frames: ReconstructionFrame[];
}

export function confidenceLevel(value: number): ConfidenceLevel {
  return value >= 0.8 ? "high" : value >= 0.5 ? "medium" : "low";
}
