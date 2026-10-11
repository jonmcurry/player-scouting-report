import { createHash } from "node:crypto";

export const ATTEMPT_CONTEXT_VERSION = "phase3-context-v1";
export const LEGACY_EVENT_SLOTS = {
  stance: "legacy_stance", load: "legacy_load", stride: "legacy_stride",
  contact: "contact_estimate", extension: "extension", follow_through: "legacy_follow_through",
} as const;
export type Sport = "softball" | "baseball" | "unknown";
export type Environment = "tee" | "front_toss" | "side_toss" | "pitching_machine"
  | "live_practice" | "game" | "unknown";
export type Intent = "conventional_full" | "slap" | "power_slap" | "bunt"
  | "drag_bunt" | "checked_protective" | "take" | "unknown";
export const CONCRETE_INTENTS: ReadonlyArray<Exclude<Intent, "unknown">> = [
  "conventional_full", "slap", "power_slap", "bunt", "drag_bunt", "checked_protective", "take",
];
export interface AttemptContext { sport: Sport; environment: Environment; intent: Intent }
export interface LegacyPhase {
  frame?: number | null; time_s?: number | null; method?: string | null;
  confidence?: "high" | "low" | null;
}
export interface LegacyEvent {
  event_slug: typeof LEGACY_EVENT_SLOTS[keyof typeof LEGACY_EVENT_SLOTS];
  frame: number | null; time_s: number | null; method: string | null;
  confidence: "high" | "low" | null; detector_version: string | null;
  visibility: "visible" | "partial" | "unavailable";
}

/** A game log proves game environment, not camera view or swing intent. */
export function classifyAttemptContext(input: {
  sport: string | null; sessionType: string | null; detectionState: string | null;
}): AttemptContext | null {
  if (input.detectionState !== "readable") return null;
  return {
    sport: input.sport === "softball" || input.sport === "baseball" ? input.sport : "unknown",
    environment: input.sessionType === "game" ? "game" : "unknown",
    intent: "unknown",
  };
}

/** Preserve legacy detector semantics; no load/stride subtype is guessed. */
export function legacyPhaseEvents(phases: Record<string, LegacyPhase> | null | undefined,
  detectorVersion: string | null, visibility?: Record<string, { body?: string }> | null): LegacyEvent[] {
  return Object.entries(LEGACY_EVENT_SLOTS).filter(([slug]) => phases?.[slug] !== undefined)
    .map(([slug, event_slug]) => {
      const phase = phases![slug]!;
      const located = Number.isInteger(phase.frame) && phase.frame! >= 0
        && Number.isFinite(phase.time_s) && phase.time_s! >= 0;
      const body = visibility?.[slug]?.body;
      return {
        event_slug, frame: located ? phase.frame! : null, time_s: located ? phase.time_s! : null,
        method: typeof phase.method === "string" ? phase.method : null,
        confidence: phase.confidence === "high" || phase.confidence === "low" ? phase.confidence : null,
        detector_version: detectorVersion,
        visibility: located && (body === "visible" || body === "partial") ? body : "unavailable",
      };
    });
}

export function attemptSourceRevision(pipelineVersion: string | null, events: LegacyEvent[]): string {
  const hash = createHash("sha256").update(JSON.stringify({ pipelineVersion, events })).digest("hex");
  return `pipeline:${hash}`;
}

/** A context correction always reroutes from the latest snapshot. */
export function methodologyAvailability(definition: {
  status: string; sports: string[]; intents: string[]; environments?: string[];
}, context: AttemptContext): { available: boolean; reasons: string[] } {
  const reasons: string[] = [];
  if (definition.status !== "validated_internal" && definition.status !== "validated_external")
    reasons.push("definition_unvalidated");
  if (context.sport === "unknown" || !definition.sports.includes(context.sport))
    reasons.push("sport_unavailable");
  if (!definition.intents.includes(context.intent)
    || (context.intent === "unknown" && !CONCRETE_INTENTS.every((intent) => definition.intents.includes(intent))))
    reasons.push("intent_unavailable");
  if (definition.environments?.length && (context.environment === "unknown"
    || !definition.environments.includes(context.environment))) reasons.push("environment_unavailable");
  return { available: reasons.length === 0, reasons };
}

/** A canonical attempt is the same legacy swing, never a second count. */
export function legacyAttemptParity(clip: { id: string; status: string; swing_detection_state: string | null },
  attempts: Array<{ id: string; video_clip_id: string; attempt_index: number }>,
  expectedEvents: LegacyEvent[], storedEvents: Array<Pick<LegacyEvent, "event_slug" | "frame" | "time_s">>): {
  matches: boolean; reasons: string[]; swingCount: number;
} {
  const expectedCount = clip.status === "ready" && clip.swing_detection_state === "readable" ? 1 : 0;
  const reasons: string[] = [];
  if (attempts.length !== expectedCount || attempts.some((a) => a.video_clip_id !== clip.id || a.attempt_index !== 0))
    reasons.push("canonical_attempt_mismatch");
  const phaseMismatch = storedEvents.length !== expectedEvents.length || expectedEvents.some((event) =>
    !storedEvents.some((stored) => stored.event_slug === event.event_slug
      && stored.frame === event.frame && (stored.time_s === null || event.time_s === null
        ? stored.time_s === event.time_s : Number(stored.time_s) === Number(event.time_s))));
  if (expectedCount && phaseMismatch) reasons.push("phase_event_mismatch");
  return { matches: reasons.length === 0, reasons, swingCount: expectedCount };
}
