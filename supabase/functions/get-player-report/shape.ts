// Pure shaping of the public player report. Kept free of Deno/npm imports so it can be unit-tested
// with tsx (see src/services/db/development.test.ts). This is the whitelist for what an anonymous
// share-link viewer can see: coach-confirmed content only - no AI drafts, no internal metrics
// (pose coverage, bone stability, reconstruction diagnostics), no internal ids beyond opaque clip ids
// that the video endpoint re-validates.

export const STATUS_LABELS: Record<string, string> = {
  improving: "Improving",
  unchanged: "Holding steady",
  worse: "Needs more work",
  resolved: "Got it",
};

export interface RawPriority {
  id: string; title: string; description: string | null; status: string;
  priority_order: number; first_identified_at: string; resolved_at: string | null;
}
export interface RawObservation {
  player_priority_id: string; status: string; coach_note: string | null; observed_at: string; video_clip_id: string | null; phase: string | null;
}
export interface RawDrillAssignment {
  player_priority_id: string; active: boolean; coach_note: string | null;
  drill_library: { name: string; purpose: string | null; instructions: string | null; equipment: string | null } | null;
}
export interface RawScore { score: number | null; reviewed_by: string | null; checkpoints: { label: string } }

export function shapePlayerReport(input: {
  player: { name: string; jersey_number: string | number | null; teamName: string };
  scores: RawScore[];
  priorities: RawPriority[];
  drills: RawDrillAssignment[];
  observations: RawObservation[];
  loggedAtBats: number;
}) {
  const { player, scores, priorities, drills, observations, loggedAtBats } = input;
  const visible = priorities
    .filter((p) => p.status !== "archived")
    .sort((a, b) => (a.status === "resolved" ? 1 : 0) - (b.status === "resolved" ? 1 : 0) || a.priority_order - b.priority_order);

  return {
    playerName: player.name,
    jerseyNumber: player.jersey_number,
    teamName: player.teamName,
    loggedAtBats,
    // Only checkpoints a coach confirmed at the top score - never an unreviewed AI draft.
    strengths: scores.filter((s) => s.reviewed_by && s.score === 3).map((s) => s.checkpoints.label),
    priorities: visible.map((p) => {
      const obs = observations
        .filter((o) => o.player_priority_id === p.id && o.status !== "unclear")
        .sort((a, b) => new Date(a.observed_at).getTime() - new Date(b.observed_at).getTime());
      return {
        title: p.title,
        why: p.description ?? "",
        status: p.status === "resolved" ? "resolved" : (obs.at(-1)?.status ?? "active"),
        statusLabel: p.status === "resolved" ? STATUS_LABELS.resolved : (STATUS_LABELS[obs.at(-1)?.status ?? ""] ?? "Working on it"),
        drills: drills
          .filter((d) => d.player_priority_id === p.id && d.active && d.drill_library)
          .map((d) => ({
            name: d.drill_library!.name,
            purpose: d.drill_library!.purpose ?? "",
            instructions: d.drill_library!.instructions ?? "",
            equipment: d.drill_library!.equipment ?? "",
            coachNote: d.coach_note ?? "",
          })),
        progress: obs.map((o) => ({ date: o.observed_at.slice(0, 10), label: STATUS_LABELS[o.status] ?? o.status, note: o.coach_note ?? "" })),
        clips: obs.filter((o) => o.video_clip_id).slice(-3).map((o) => ({ clipId: o.video_clip_id!, date: o.observed_at.slice(0, 10), phase: o.phase })),
      };
    }),
    // The complete checklist stays available, but the page tucks it away.
    checkpoints: scores.map((s) => ({ label: s.checkpoints.label, score: s.score, reviewedBy: s.reviewed_by })),
  };
}
