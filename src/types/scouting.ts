/**
 * Domain types for the scouting-report data model.
 *
 * Field names here are taken directly from reports/_individual_report_template.html
 * and reports/_team_comparison_template.html (read, not guessed) - notably:
 *   - there is no PitchQuality enum; pitch info is free text in the Game Log
 *     (e.g. "Outside, low", "Rise ball, high", "Middle-middle") and is cross-
 *     referenced narratively in Issues.seenInAtBats, never a strict field elsewhere.
 *   - the 11 checklist checkpoints are today matched by ARRAY POSITION between the
 *     two templates, which already disagree on label text ("Hip-Shoulder Sep." vs
 *     "Hip-shoulder separation"). `checkpointSlug` replaces that position-matching
 *     with a stable key into the `checkpoints` reference table
 *     (supabase/migrations/00001_initial_schema.sql).
 */

/** MIN_ATBATS_FOR_PATTERN from _individual_report_template.html - below this, the
 * generated report shows an early-read warning instead of asserting a pattern. */
export const MIN_ATBATS_FOR_PATTERN = 3;

/** PATTERN_AVG_THRESHOLD from _team_comparison_template.html - a checkpoint whose
 * team-wide average score falls below this is flagged as a team weakness. */
export const PATTERN_AVG_THRESHOLD = 2.0;

export type Score = 1 | 2 | 3;

/** Who/what produced an AI-drafted score or issue - lets the UI distinguish Gemini's
 * read from the pose3d pipeline's measured-angle read when they disagree. */
export type DraftSource = "gemini" | "pose3d";

export interface GameLogEntry {
  id: string;
  playerId: string;
  date: string;
  opponent: string;
  ab: number;
  /** Free text, e.g. "Outside, low" or "Rise ball, high" - not an enum. May be
   * absent (template renders "—" when missing). */
  pitch: string | null;
  result: string;
  /** Local video path today (e.g. "videos/emily_c_...ab1.mp4"); a GCS object path
   * once media is migrated to cloud storage - see gcsPath vs clip note below. */
  clip: string;
}

export interface ChecklistEntry {
  id: string;
  playerId: string;
  /** Stable key into the checkpoints reference table - NOT the display label,
   * which can differ across templates/teams and isn't safe to match on. */
  checkpointSlug: string;
  score: Score | null;
  aiDraft: Score | null;
  reviewedBy: string | null;
  /** Prior scores, oldest first, for the report's Trend column. Modeled here as a
   * plain array for the in-memory/JSON shape; persisted as a real audited history
   * table (checklist_score_history) in Supabase, not a bare int[] column - see the
   * migration for why. */
  history: Score[];
  notes: string;
  source: DraftSource | null;
}

export interface IssueEntry {
  id: string;
  playerId: string;
  issue: string;
  seenInAtBats: string;
  likelyCause: string;
  effect: string;
  reviewedBy: string | null;
  source: DraftSource | null;
}

/** One row of a team_summary.html PLAYERS entry. `scores`/`reviewedCount` are
 * always computed at generate-time from the player's own ChecklistEntry rows -
 * never persisted, so they can't drift from the underlying data (see generate.ts). */
export interface PlayerSummary {
  playerId: string;
  number: string;
  name: string;
  slug: string;
  strength: string;
  issue: string;
  drill: string;
  comp: string;
  reportPath: string | null;
  scores: (Score | null)[];
  reviewedCount: number;
}

export interface PlayerReportData {
  playerId: string;
  playerSlug: string;
  name: string;
  jerseyNumber: string;
  teamSlug: string;
  gameLogs: GameLogEntry[];
  checklist: ChecklistEntry[];
  issues: IssueEntry[];
}

export interface TeamData {
  teamSlug: string;
  teamName: string;
  coaches: string[];
  players: PlayerReportData[];
}

/** The 11 fixed checkpoints, in canonical display order - mirrors the
 * `checkpoints` table seeded in 00001_initial_schema.sql. Slugs are the stable
 * identifiers; labels are the current display text (individual-report wording,
 * since it's the more descriptive of the two templates' current phrasings). */
export const CHECKPOINTS: { slug: string; label: string }[] = [
  { slug: "stance-setup", label: "Stance & setup" },
  { slug: "load", label: "Load" },
  { slug: "stride", label: "Stride / front-foot plant" },
  { slug: "hip-shoulder-sep", label: "Hip-shoulder separation" },
  { slug: "hand-path", label: "Hand path to ball" },
  { slug: "bat-path", label: "Bat path through zone" },
  { slug: "contact-point", label: "Contact point" },
  { slug: "extension", label: "Extension" },
  { slug: "head-eyes", label: "Head/eyes" },
  { slug: "follow-through", label: "Follow-through & finish" },
  { slug: "swing-decisions", label: "Swing decisions (pitch selection)" },
];
