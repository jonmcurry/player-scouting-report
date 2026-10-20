export const SPORTS = ["baseball", "softball"] as const;
export const AGE_BANDS = ["u8", "8-10", "11-12", "13-14", "15-18", "adult"] as const;
export const BATS = ["L", "R", "S"] as const;
export const THROWS = ["L", "R"] as const;

export type Sport = (typeof SPORTS)[number];
export type AgeBand = (typeof AGE_BANDS)[number];
export type Bats = (typeof BATS)[number];
export type Throws = (typeof THROWS)[number];

export interface PlayerContext {
  sport: Sport | null;
  level: string | null;
  ageBand: AgeBand | null;
  bats: Bats | null;
  throws: Throws | null;
}

export interface PitchContext {
  location: string | null;
  zone: number | null;
  count: { balls: number; strikes: number } | null;
  outcome: string | null;
  swung: boolean | null;
  pitchType: string | null;
}

/** Where the swing happened: a game at-bat, a practice repetition, or not known.
 * Used to respect methodology "does not apply when" scope. Absent = "unknown". */
export type SwingContext = "game" | "practice" | "unknown";

export interface SwingEvidence {
  frameNames: string[];
  context?: SwingContext;
  pipelineVersion: string | null;
  metrics: Record<string, unknown>;
  reconstructionSupplied: boolean;
  excludedMeasurements: { field: string; reason: string }[];
  /** Development-only v2 engine runs: the event ids findings may cite. Absent on every production run,
   * where validation and outputs are unchanged. */
  v2Evidence?: { supportedEvents: string[] };
}

export interface AnalysisInput {
  player: PlayerContext;
  pitch: PitchContext;
  /** Optional user-entered at-bat result, never evidence that a swing did or did not occur. */
  atBatResult?: "hit" | "out" | "walk" | "strikeout" | null;
  swing: SwingEvidence;
  coachReviewedDecisions: { concept: string | null; phase: string | null; videoClipId: string | null; status: string }[];
  knowledgePack: string;
  knowledgeClaimIds: string[];
  /** Each offered claim's own "does not apply when", keyed by claim id (checked against the response). */
  knowledgeClaimExclusions?: Record<string, string>;
  /** The active methodology_versions.version_label this run's knowledgePack was rendered from. */
  knowledgeVersion: string;
}

export const unknown = <T>(value: T | null | undefined): T | "unknown" => value ?? "unknown";

export function buildInputManifest(input: AnalysisInput): Record<string, unknown> {
  const pitch = input.pitch;
  return {
    player_context: {
      sport: unknown(input.player.sport),
      level: unknown(input.player.level),
      age_band: unknown(input.player.ageBand),
      bats: unknown(input.player.bats),
      throws: unknown(input.player.throws),
    },
    pitch_context: {
      location: unknown(pitch.location),
      zone: unknown(pitch.zone),
      count: pitch.count ?? "unknown",
      outcome: unknown(pitch.outcome),
      swung: unknown(pitch.swung),
      pitch_type: unknown(pitch.pitchType),
      available_fields: {
        location: pitch.location !== null,
        zone: pitch.zone !== null,
        count: pitch.count !== null,
        outcome: pitch.outcome !== null,
        swung: pitch.swung !== null,
        pitch_type: pitch.pitchType !== null,
      },
    },
    at_bat_result: unknown(input.atBatResult),
    swing_evidence: {
      frames: [...input.swing.frameNames],
      swing_context: input.swing.context ?? "unknown",
      metrics: Object.keys(input.swing.metrics).sort(),
      reconstruction_supplied: input.swing.reconstructionSupplied,
      excluded_measurements: input.swing.excludedMeasurements,
    },
    coach_reviewed_decisions: input.coachReviewedDecisions,
    knowledge_claim_ids: [...input.knowledgeClaimIds],
    methodology_version: input.knowledgeVersion,
  };
}
