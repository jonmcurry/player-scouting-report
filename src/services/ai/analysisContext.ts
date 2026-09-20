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

export interface SwingEvidence {
  frameNames: string[];
  pipelineVersion: string | null;
  metrics: Record<string, unknown>;
  reconstructionSupplied: boolean;
  excludedMeasurements: { field: string; reason: string }[];
}

export interface AnalysisInput {
  player: PlayerContext;
  pitch: PitchContext;
  swing: SwingEvidence;
  coachReviewedDecisions: { concept: string | null; phase: string | null; videoClipId: string | null; status: string }[];
  knowledgePack: string;
  knowledgeClaimIds: string[];
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
    swing_evidence: {
      frames: [...input.swing.frameNames],
      metrics: Object.keys(input.swing.metrics).sort(),
      reconstruction_supplied: input.swing.reconstructionSupplied,
      excluded_measurements: input.swing.excludedMeasurements,
    },
    coach_reviewed_decisions: input.coachReviewedDecisions,
    knowledge_claim_ids: [...input.knowledgeClaimIds],
  };
}
