// Pure shaping of the public player report. Kept free of Deno/npm imports so it can be unit-tested
// with tsx (see src/services/db/development.test.ts). This is the whitelist for what an anonymous
// share-link viewer can see: coach-confirmed content only - no AI drafts, no internal metrics
// (pose coverage, bone stability, reconstruction diagnostics), no internal ids beyond opaque clip ids
// that the video endpoint re-validates.

export const STATUS_LABELS: Record<string, string> = {
  improving: "Improving",
  unchanged: "Holding steady",
  worse: "Still developing",
  resolved: "Got it",
};

export interface RawPriority {
  id: string; title: string; description: string | null; status: string;
  priority_order: number; first_identified_at: string; resolved_at: string | null;
  follow_up_kind?: string | null; follow_up_date?: string | null; follow_up_swings?: number | null;
}
export interface RawObservation {
  player_priority_id: string; status: string; coach_note: string | null; observed_at: string; video_clip_id: string | null; phase: string | null;
}
export interface RawDrillAssignment {
  player_priority_id: string; active: boolean; coach_note: string | null; assigned_at?: string | null;
  drill_library: { name: string; purpose: string | null; instructions: string | null; equipment: string | null } | null;
}
export interface RawScore { score: number | null; reviewed_by: string | null; review_status?: string | null; checkpoints: { label: string } }

/** Coach-confirmed score (00040 review_status; rows read without it fall back to reviewed_by + a score). */
const isVerified = (s: RawScore) => (s.review_status ? s.review_status === "verified" : Boolean(s.reviewed_by) && s.score != null);

export function shapePlayerReport(input: {
  player: { name: string; jersey_number: string | number | null; teamName: string; whatToCheckNext?: string | null };
  scores: RawScore[];
  priorities: RawPriority[];
  drills: RawDrillAssignment[];
  observations: RawObservation[];
  loggedAtBats: number;
}) {
  const { player, scores, priorities, drills, observations, loggedAtBats } = input;
  const confirmedScores = scores.filter(isVerified);
  // Reviewed "can't tell from this footage" checkpoints are shown as such; rejected AI drafts never appear.
  const insufficient = scores.filter((s) => s.review_status === "insufficient_evidence");
  const visible = priorities
    .filter((p) => p.status !== "archived")
    .sort((a, b) => STATUS_RANK(a.status) - STATUS_RANK(b.status) || a.priority_order - b.priority_order || a.first_identified_at.localeCompare(b.first_identified_at) || a.id.localeCompare(b.id));

  return {
    playerName: player.name,
    jerseyNumber: player.jersey_number,
    teamName: player.teamName,
    nextStep: player.whatToCheckNext ?? null,
    loggedAtBats,
    // Only checkpoints a coach confirmed at the top score - never an unreviewed AI draft.
    strengths: confirmedScores.filter((s) => s.score === 3).map((s) => s.checkpoints.label),
    priorities: visible.map((p) => {
      const obs = observations
        .filter((o) => o.player_priority_id === p.id && o.status !== "unclear")
        // Newest first, so parents see recent progress before old history.
        .sort((a, b) => new Date(b.observed_at).getTime() - new Date(a.observed_at).getTime());
      return {
        title: p.title,
        why: p.description ?? "",
        status: p.status === "resolved" ? "resolved" : (obs[0]?.status ?? "active"),
        statusLabel: p.status === "resolved" ? STATUS_LABELS.resolved : (STATUS_LABELS[obs[0]?.status ?? ""] ?? "Working on it"),
        nextCheck: nextCheckLabel(p),
        drills: drills
          .filter((d) => d.player_priority_id === p.id && d.active && d.drill_library)
          // Newest assignment first, so the report's lead drill never depends on row order.
          .sort((a, b) => String(b.assigned_at ?? "").localeCompare(String(a.assigned_at ?? "")) || a.drill_library!.name.localeCompare(b.drill_library!.name))
          .map((d) => ({
            name: d.drill_library!.name,
            purpose: d.drill_library!.purpose ?? "",
            instructions: d.drill_library!.instructions ?? "",
            equipment: d.drill_library!.equipment ?? "",
            coachNote: d.coach_note ?? "",
          })),
        progress: obs.map((o) => ({ date: o.observed_at.slice(0, 10), label: STATUS_LABELS[o.status] ?? o.status, note: o.coach_note ?? "" })),
        clips: obs.filter((o) => o.video_clip_id).slice(0, 3).map((o) => ({ clipId: o.video_clip_id!, date: o.observed_at.slice(0, 10), phase: o.phase })),
      };
    }),
    // The complete checklist stays available, but the page tucks it away.
    checkpoints: [
      ...confirmedScores.map((s) => ({ label: s.checkpoints.label, score: s.score, state: "verified" })),
      ...insufficient.map((s) => ({ label: s.checkpoints.label, score: null, state: "insufficient_evidence" })),
    ],
  };
}

const STATUS_RANK = (status: string) => (status === "active" ? 0 : status === "monitoring" ? 1 : 2);

function nextCheckLabel(priority: RawPriority) {
  switch (priority.follow_up_kind) {
    case "next_practice": return "Your coach will look at this again at the next practice.";
    case "next_game": return "Your coach will look at this again in the next game.";
    case "after_swings": return priority.follow_up_swings ? `Your coach will look at this again after ${priority.follow_up_swings} swings.` : "";
    case "date": return priority.follow_up_date ? `Your coach will look at this again by ${priority.follow_up_date}.` : "";
    default: return "";
  }
}
