/** Vocabulary translation only. Does not decode media, resolve raw PTS, or call the engine. */
import { SWING_EVENTS, type SwingEventSlug } from "./swingEvents.ts";

export const LEGACY_FIELDS = ["metrics.json.contact", "phases.contact", "phases.stance", "phases.load", "phases.stride", "phases.extension", "phases.follow_through"] as const;
export type LegacyField = typeof LEGACY_FIELDS[number];
export interface LegacyPhaseValue { frame: number | null; time_s: number | null }
export interface LegacyEstimate {
  legacy_phase: string;
  source_field: LegacyField;
  legacy_frame: number | null;
  legacy_time_s: number | null;
  method: "baseline_triple_product" | "baseline_wrist_extremum" | "baseline_phase_heuristic";
  temporal_identity: "unverified_legacy";
}
export interface TranslatedEvent { status: "not_produced" | "legacy_estimate"; estimates: LegacyEstimate[] }
export interface LegacyTranslation {
  events: Record<SwingEventSlug, TranslatedEvent>;
  auxiliary: Record<"load_peak_estimate" | "extension", TranslatedEvent>;
}
export const LEGACY_EVENT_TARGETS: Readonly<Record<LegacyField, SwingEventSlug | "load_peak_estimate" | "extension">> = Object.freeze({
  "metrics.json.contact": "impact_estimate", "phases.contact": "impact_estimate", "phases.stance": "stance_set",
  "phases.load": "load_peak_estimate", "phases.stride": "foot_plant", "phases.extension": "extension", "phases.follow_through": "finish",
});
/** Legacy time_s and frame remain provenance, NEVER a source FrameIdentity.
 * Conflicting aliases are retained as separate estimates; no hidden priority/averaging.
 * A later authorized normalizer must verify a source frame map before scoring timing. */
export function translateLegacyPhases(input: Partial<Record<LegacyField, LegacyPhaseValue>>): LegacyTranslation {
  const empty = (): TranslatedEvent => ({ status: "not_produced", estimates: [] });
  const output: LegacyTranslation = {
    events: Object.fromEntries(SWING_EVENTS.map(e => [e, empty()])) as Record<SwingEventSlug, TranslatedEvent>,
    auxiliary: { load_peak_estimate: empty(), extension: empty() },
  };
  for (const field of Object.keys(input)) if (!LEGACY_FIELDS.includes(field as LegacyField)) throw new Error(`Unknown legacy source field: ${field}`);
  for (const field of LEGACY_FIELDS) {
    const value = input[field];
    if (value === undefined) continue;
    if (!value || Object.keys(value).some(k => k !== "frame" && k !== "time_s") ||
      (value.frame !== null && (!Number.isSafeInteger(value.frame) || value.frame < 0)) ||
      (value.time_s !== null && (typeof value.time_s !== "number" || !Number.isFinite(value.time_s)))) throw new Error(`Invalid legacy phase: ${field}`);
    if (value.frame === null && value.time_s === null) continue;
    const target = LEGACY_EVENT_TARGETS[field];
    const event = target === "extension" || target === "load_peak_estimate" ? output.auxiliary[target] : output.events[target];
    event.status = "legacy_estimate";
    event.estimates.push({ legacy_phase: field.slice(field.lastIndexOf(".") + 1), source_field: field,
      legacy_frame: value.frame, legacy_time_s: value.time_s,
      method: target === "impact_estimate" ? "baseline_triple_product" : target === "load_peak_estimate" ? "baseline_wrist_extremum" : "baseline_phase_heuristic",
      temporal_identity: "unverified_legacy" });
  }
  return output;
}
