import { LEGACY_FIELDS, LEGACY_EVENT_TARGETS, SWING_EVENTS } from "./eventMapping.ts";
import { BASELINE_ENGINE } from "../evidenceRegistry.ts";
import { finite, index, integer, object, text } from "./validation.ts";
import type { EventAssessments, EvidenceEvent, EventLocalisation } from "./types.ts";

export const EVIDENCE_EVENTS: readonly EvidenceEvent[] = Object.freeze([...SWING_EVENTS, "load_peak_estimate", "extension"]);
/** Exact bytes of the PR6 artifact, plus its independently obtained companion.
 * Callers are responsible for associating metrics with this run/input/attempt.
 * PR8 performs no disk, network, media, environment or model operations. */
export interface FrameMapEvidence { frameMapJson: string; manifest: unknown }
export function emptyEvents(): EventAssessments {
  return Object.fromEntries(EVIDENCE_EVENTS.map(event => [event, {
    event, status: "not_produced", rawFrame: null, rawPts: null, rawTimeBase: null, rawPtsS: null,
    sourceField: null, method: null, engineConfidence: null, uncertaintyMs: null, reasons: ["event_not_produced"],
  }])) as EventAssessments;
}
const hash = (v: unknown): v is string => typeof v === "string" && /^[a-f0-9]{64}$/.test(v);
function timeBase(value: unknown): number | null {
  if (typeof value !== "string" || !/^[1-9]\d*(\/[1-9]\d*)?$/.test(value)) return null;
  const [n, d = 1] = value.split("/").map(Number);
  return integer(n) && integer(d) && n > 0 && d > 0 ? n / d : null;
}
/** Web Crypto hashes the supplied bytes in both runtimes; no trust in a supplied
 * 'hash verified' Boolean. Verification says identity, never event accuracy. */
async function verifiedRows(evidence: unknown): Promise<Map<number, Record<string, unknown>> | null> {
  const envelope = object(evidence), manifest = object(envelope.manifest);
  if (typeof envelope.frameMapJson !== "string" || !hash(manifest.frame_map_sha256)) return null;
  const bytes = new TextEncoder().encode(envelope.frameMapJson);
  const digest = [...new Uint8Array(await globalThis.crypto.subtle.digest("SHA-256", bytes))]
    .map(byte => byte.toString(16).padStart(2, "0")).join("");
  if (digest !== manifest.frame_map_sha256) return null;
  let map: Record<string, unknown>;
  try { map = object(JSON.parse(envelope.frameMapJson)); } catch { return null; }
  if (map.schema_version !== 1 || manifest.schema_version !== 1
    || map.instrumentation_version !== "inst-1" || manifest.instrumentation_version !== "inst-1"
    || manifest.engine_code_version !== BASELINE_ENGINE
    || map.verified !== true || map.status !== "verified"
    || !Array.isArray(map.reasons) || map.reasons.length !== 0
    || typeof map.run_id !== "string" || !/^[a-f0-9]{32}$/.test(map.run_id)
    || map.run_id !== manifest.run_id || !hash(map.input_sha256) || map.input_sha256 !== manifest.input_sha256
    || !index(map.attempt_number) || map.attempt_number !== manifest.attempt_number
    || !Array.isArray(map.frames) || map.frames.length === 0 || map.frames.length > 20000
    || map.frames.length !== manifest.pose_decoded_frames || map.frames.length !== manifest.bat_decoded_frames) return null;
  const rows = new Map<number, Record<string, unknown>>();
  let previousFrame = -1, previousPts: number | null = null, base: unknown;
  for (let i = 0; i < map.frames.length; i++) {
    const row = object(map.frames[i]), unit = timeBase(row.raw_time_base);
    if (row.analysis_index !== i || row.status !== "verified" || !Array.isArray(row.reasons) || row.reasons.length
      || !index(row.raw_frame) || row.raw_frame <= previousFrame || !integer(row.raw_pts) || unit === null
      || !finite(row.raw_pts_s) || !finite(row.raw_pts * unit)
      || Math.abs(row.raw_pts_s - row.raw_pts * unit) > 1e-9
      || (i > 0 && (row.raw_time_base !== base || row.raw_pts <= previousPts!))) return null;
    previousFrame = row.raw_frame; previousPts = row.raw_pts; base = row.raw_time_base;
    rows.set(i, row);
  }
  return rows;
}

/** Baseline adapter only. Low impact confidence fails its own event, not finish
 * or foot plant. Labels are engine metadata, NOT probabilities or calibration.
 * Missing methods/confidence fail closed. No i/fps or legacy time_s conversion. */
export async function localiseEvents(metrics: unknown, frameMap: unknown): Promise<EventAssessments> {
  const output = emptyEvents(), source = object(metrics), phases = object(source.phases);
  const rows = await verifiedRows(frameMap);
  for (const field of LEGACY_FIELDS) {
    const key = field.slice(field.lastIndexOf(".") + 1);
    const parent = field === "metrics.json.contact" ? source : phases;
    if (!Object.hasOwn(parent, key)) continue;
    const value = object(parent[key]), event = LEGACY_EVENT_TARGETS[field];
    // Null legacy fields mean the algorithm did not produce this event.
    if (value.frame === null && value.time_s === null) continue;
    const result: EventLocalisation = { ...output[event], sourceField: field,
      method: text(value.method) ? value.method : null,
      engineConfidence: text(value.confidence) ? value.confidence : null, reasons: [], status: "pass" };
    if (!index(value.frame)) result.reasons.push("event_frame_unavailable");
    if (!text(value.method)) result.reasons.push("event_method_unavailable");
    if (typeof value.confidence !== "string" || !["high", "medium", "low"].includes(value.confidence)) {
      result.reasons.push("event_confidence_unavailable");
    } else if (event === "impact_estimate" && value.confidence !== "high") {
      result.reasons.push("impact_estimate_low_engine_confidence");
    }
    const row = index(value.frame) ? rows?.get(value.frame) : undefined;
    if (!row) {
      result.status = "unmappable";
      result.reasons.push("frame_identity_unverifiable");
    } else {
      result.rawFrame = row.raw_frame as number; result.rawPts = row.raw_pts as number;
      result.rawTimeBase = row.raw_time_base as string; result.rawPtsS = row.raw_pts_s as number;
      result.status = result.reasons.length ? "fail" : "pass";
    }
    const previous = output[event];
    // Both contact aliases may exist. Conflicts fail instead of silently choosing.
    if (previous.sourceField !== null && (previous.rawFrame !== result.rawFrame || previous.rawPts !== result.rawPts
      || previous.method !== result.method || previous.engineConfidence !== result.engineConfidence
      || previous.status !== result.status)) {
      output[event] = { ...previous, status: "fail", reasons: ["conflicting_legacy_aliases"] };
    } else if (previous.sourceField === null) output[event] = result;
  }
  return output;
}
