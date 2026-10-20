/** Synthetic-only v2 engine artifacts and images for tests. No real footage or athlete data. */
import fs from "node:fs";
import path from "node:path";
import type { V2ImageDescriptor } from "./v2EvidencePackage.js";

const SHA = "a".repeat(64);
const PNG = Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47]), Buffer.from("synthetic")]);

/** 12 frames at 30 fps (time_s = pts / 90000); supported events at frames 3 (load), 8 (impact), 10 (finish). */
export function syntheticArtifacts(overrides: { batStatus?: Record<number, string>; events?: Array<Record<string, unknown>>; decision?: Record<string, unknown> } = {}) {
  const frames = Array.from({ length: 12 }, (_, i) => ({ index: i, pts: i * 3000, time_base: [1, 90000], time_s: Number((i / 30).toFixed(6)) }));
  const event = (id: string, frame: number | null, extra: Record<string, unknown> = {}) => ({ id, status: frame === null ? "unavailable" : "available",
    frame, pts: frame === null ? null : frame * 3000, time_s: frame === null ? null : frames[frame]!.time_s,
    window_s: frame === null ? null : [frames[frame]!.time_s, frames[frame]!.time_s], observation: frame === null ? null : "direct",
    downstream_use: frame === null ? null : "experimental", reason_codes: frame === null ? ["INSUFFICIENT_OBSERVATIONS"] : [], ...extra });
  const events = overrides.events ?? [
    event("stance_set", null), event("load_start", null, { reason_codes: ["NOT_PRODUCED"] }),
    event("load_peak_estimate", 3, { observation: "pose" }), event("stride_foot_lift", null), event("foot_plant", null),
    event("swing_launch", 7, { downstream_use: "not_recommended" }), event("impact_estimate", 8),
    event("contact_confirmed", null, { reason_codes: ["NOT_PRODUCED"] }), event("extension", null), event("finish", 10),
  ];
  const phases: Record<string, unknown> = { stance: { frame: null }, load: { frame: 3 }, stride: { frame: null },
    contact: { frame: 8 }, extension: { frame: null }, follow_through: { frame: 10 } };
  return {
    metrics: { engine: "hitterloop-engine-v2-exp", pipeline_version: "hitterloop-v2-exp-0.3.0", events, phases,
      swing_detection: { status: "swing_candidate", confidence: "low" } as Record<string, unknown>,
      diagnostics: { reason_codes: [], possible_batter_selection_conflict: false } as Record<string, unknown> },
    frameMap: { input_sha256: SHA, frames },
    batPath: { frames: frames.map(f => ({ frame: f.index, status: overrides.batStatus?.[f.index] ?? "detected" })) },
    pose2d: { frames: frames.map(f => ({ frame: f.index, keypoints: [[1, 1, 0.9]] })) },
    tracks: { grounding: { final_decision: overrides.decision ?? { status: "selected", segment_id: "1:0", basis: "pose_and_bat", reason_codes: [] } } },
    status: { status: "complete" } as Record<string, unknown>,
  };
}

export const SYNTHETIC_SOURCE_SHA = SHA;

export function syntheticImages(dir: string, names: Array<[string, V2ImageDescriptor["kind"], string | null, number]>): V2ImageDescriptor[] {
  return names.map(([name, kind, phase, frame]) => {
    fs.writeFileSync(path.join(dir, name), PNG);
    return { name, kind, phase, analysisFrame: frame, assumed: { rawFrame: frame, rawPtsS: Number((frame / 30).toFixed(6)) } };
  });
}
