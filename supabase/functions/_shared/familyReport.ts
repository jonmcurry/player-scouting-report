// Read-only player report data, shared by two Edge Functions. Authorization
// stays in each function; this module only reads, with whatever client the
// caller hands it (always the service role - both callers authorize first):
//   * get-player-report  - anonymous share-link viewer (token checked there).
//                          { includeVideoIds: false } -> anonymous payload
//                          with redacted player identity (snapshot-tested).
//   * get-family-report  - a linked guardian (is_guardian_for_player checked
//                          there). { includeVideoIds: true } adds the family-
//                          only sections below, which carry clip ids.
//
// Family-only sections (includeVideoIds: true):
//   clips:    every clip of the player -> { id, recordedAt, status,
//             failureReason, uploadedByYou }. status is clipReviewState() - the coach page's
//             rule. uploadedByYou is true iff video_clips.uploaded_by is the
//             viewer (viewerUserId, taken from the verified JWT by the caller);
//             only the boolean leaves this module, never a user id. Clips with
//             a clip_deletions row (deletion started, not finished) are left
//             out - except the viewer's OWN uploads, which stay listed with
//             deleteUnfinished: true so the parent can retry the delete (and
//             "Unlink -> Delete my videos" still covers them). deleteUnfinished
//             is false on every other clip. failureReason is a narrow public
//             enum derived from known policy text; raw error_message never leaves.
//             No AI fields.
//   findings: coach-reviewed findings only (issues approved/edited; drafts and
//             rejected AI drafts never) -> { clipId, title, likelyCause, effect,
//             videoRemovedBy }. videoRemovedBy is 'family' | 'coach' when the
//             finding's clip was deleted through delete-clip
//             (clip_removed_findings), else null.
// Never: AI drafts, notes, source, confidence, analysis metrics, storage paths.

import { shapePlayerReport, sharedPlayerName } from "../get-player-report/shape.ts";
import { clipReviewState, type ClipReviewStatus } from "./clipReviewState.ts";
import { redactSharedValue } from "./sharedText.ts";

export type FamilyClip = {
  id: string;
  recordedAt: string;
  status: ClipReviewStatus;
  failureReason: "duration_limit" | null;
  uploadedByYou: boolean;
  deleteUnfinished: boolean;
};
export type FamilyFinding = {
  clipId: string | null;
  title: string;
  likelyCause: string;
  effect: string;
  videoRemovedBy: "family" | "coach" | null;
};
export type PlayerReport = ReturnType<typeof shapePlayerReport>;
export type FamilyReport = PlayerReport & { clips: FamilyClip[]; findings: FamilyFinding[] };

// deno-lint-ignore no-explicit-any
type Db = any;

/** null when the player doesn't exist. Throws when a family-only read fails (fail closed). */
export async function buildFamilyReport(db: Db, playerId: string, opts: { includeVideoIds: false }): Promise<PlayerReport | null>;
export async function buildFamilyReport(db: Db, playerId: string, opts: { includeVideoIds: true; viewerUserId: string }): Promise<FamilyReport | null>;
export async function buildFamilyReport(db: Db, playerId: string, opts: { includeVideoIds: boolean; viewerUserId?: string }): Promise<PlayerReport | FamilyReport | null> {
  const report = await buildPlayerReport(db, playerId, !opts.includeVideoIds);
  if (!report || !opts.includeVideoIds) return report;
  if (!opts.viewerUserId) throw new Error("viewerUserId is required for the family report");
  const [clips, findings] = await Promise.all([familyClips(db, playerId, opts.viewerUserId), reviewedFindings(db, playerId)]);
  return { ...report, clips, findings };
}

// The queries get-player-report has always run (moved here unchanged).
async function buildPlayerReport(supabase: Db, playerId: string, publicLink: boolean): Promise<PlayerReport | null> {
  const { data: player, error: playerError } = await supabase
    .from("players")
    .select("name, jersey_number, what_to_check_next, teams!inner(name)")
    .eq("id", playerId)
    .single();
  if (playerError || !player) return null;

  const { data: scores } = await supabase
    .from("checklist_scores")
    .select("score, reviewed_by, review_status, checkpoints!inner(label, sort_order)")
    .eq("player_id", playerId)
    .order("sort_order", { referencedTable: "checkpoints" });

  const { count: loggedAtBats } = await supabase
    .from("game_log_entries")
    .select("id", { count: "exact", head: true })
    .eq("player_id", playerId)
    .eq("session_type", "game");

  const { data: priorities } = await supabase
    .from("player_priorities")
    .select("id, title, description, status, priority_order, first_identified_at, resolved_at, follow_up_kind, follow_up_date, follow_up_swings")
    .eq("player_id", playerId)
    .neq("status", "archived");
  const ids = (priorities ?? []).map((p: { id: string }) => p.id);
  const [{ data: drills }, { data: observations }] = ids.length
    ? await Promise.all([
        supabase.from("player_priority_drills").select("player_priority_id, active, coach_note, assigned_at, drill_library(name, purpose, instructions, equipment, curation_status)").in("player_priority_id", ids).order("assigned_at", { ascending: false }),
        supabase.from("player_priority_observations").select("player_priority_id, status, coach_note, observed_at, video_clip_id, phase").in("player_priority_id", ids),
      ])
    : [{ data: [] }, { data: [] }];

  const shaped = shapePlayerReport({
    player: {
      name: publicLink ? sharedPlayerName(player.name) : player.name,
      jersey_number: publicLink ? null : player.jersey_number,
      teamName: publicLink ? "" : (player.teams as unknown as { name: string }).name,
      whatToCheckNext: player.what_to_check_next,
    },
    scores: scores ?? [],
    priorities: priorities ?? [],
    drills: drills ?? [],
    observations: observations ?? [],
    loggedAtBats: loggedAtBats ?? 0,
  });
  if (!publicLink) return shaped;
  const redacted = redactSharedValue(shaped, player.name, (player.teams as { name: string }).name) as PlayerReport;
  // The identity fields were intentionally reduced before generic prose
  // redaction. Restore those allowlisted values so a surname or team token
  // cannot cause the already-private display name itself to be withheld.
  redacted.playerName = sharedPlayerName(player.name);
  redacted.teamName = "";
  redacted.jerseyNumber = null;
  return redacted;
}

function must<T>(res: { data: T | null; error: { message: string } | null }, what: string): T {
  if (res.error) throw new Error(`${what}: ${res.error.message}`);
  return (res.data ?? []) as T;
}

async function familyClips(db: Db, playerId: string, viewerUserId: string): Promise<FamilyClip[]> {
  const all = must<Array<{ id: string; status: string; error_message: string | null; created_at: string; uploaded_by: string | null; game_log_entries: { date: string } }>>(
    await db
      .from("video_clips")
      .select("id, status, error_message, created_at, uploaded_by, game_log_entries!inner(date, player_id)")
      .eq("game_log_entries.player_id", playerId),
    "clips",
  );
  // A clip whose deletion has started (delete-clip step 2 wrote the audit row)
  // is on its way out. Someone else's is never listed, even if a later step
  // failed. The viewer's own upload stays listed (deleteUnfinished) so a delete
  // that failed part-way is visible and can be retried - never silently hidden.
  const deleting = all.length
    ? new Set(must<Array<{ clip_id: string }>>(await db.from("clip_deletions").select("clip_id").in("clip_id", all.map((r) => r.id)), "clip deletions").map((r) => r.clip_id))
    : new Set<string>();
  const isOwn = (r: { uploaded_by: string | null }) => r.uploaded_by !== null && r.uploaded_by === viewerUserId;
  const rows = all.filter((r) => !deleting.has(r.id) || isOwn(r));
  const ids = rows.map((r) => r.id);
  const [runs, issues] = ids.length
    ? await Promise.all([
        db.from("analysis_runs").select("video_clip_id").in("video_clip_id", ids),
        db.from("issues").select("video_clip_id, review_status").in("video_clip_id", ids),
      ])
    : [{ data: [], error: null }, { data: [], error: null }];
  const analyzed = new Set(must<Array<{ video_clip_id: string }>>(runs, "analysis runs").map((r) => r.video_clip_id));
  const byClip = new Map<string, Array<{ review_status: string }>>();
  for (const f of must<Array<{ video_clip_id: string; review_status: string }>>(issues, "clip findings")) {
    const list = byClip.get(f.video_clip_id) ?? [];
    list.push({ review_status: f.review_status });
    byClip.set(f.video_clip_id, list);
  }
  return rows
    .sort((a, b) => b.game_log_entries.date.localeCompare(a.game_log_entries.date) || b.created_at.localeCompare(a.created_at) || a.id.localeCompare(b.id))
    .map((r) => ({
      id: r.id,
      recordedAt: r.game_log_entries.date,
      status: clipReviewState({ status: r.status, analyzed: analyzed.has(r.id) }, byClip.get(r.id)),
      failureReason: r.status === "failed" && /longer than the 3-minute upload limit/i.test(r.error_message ?? "")
        ? "duration_limit"
        : null,
      uploadedByYou: isOwn(r),
      deleteUnfinished: deleting.has(r.id),
    }));
}

async function reviewedFindings(db: Db, playerId: string): Promise<FamilyFinding[]> {
  const rows = must<Array<{ id: string; issue: string; likely_cause: string | null; effect: string | null; video_clip_id: string | null; created_at: string }>>(
    await db
      .from("issues")
      .select("id, issue, likely_cause, effect, video_clip_id, created_at")
      .eq("player_id", playerId)
      .in("review_status", ["approved", "edited"]),
    "findings",
  );
  const unlinked = rows.filter((r) => !r.video_clip_id).map((r) => r.id);
  const removed = unlinked.length
    ? must<Array<{ issue_id: string; removed_by_role: string }>>(
        await db.from("clip_removed_findings").select("issue_id, removed_by_role").in("issue_id", unlinked),
        "removed videos",
      )
    : [];
  const removedBy = new Map(removed.map((r) => [r.issue_id, r.removed_by_role === "guardian" ? "family" as const : "coach" as const]));
  return rows
    .sort((a, b) => b.created_at.localeCompare(a.created_at) || a.id.localeCompare(b.id))
    .map((r) => ({
      clipId: r.video_clip_id,
      title: r.issue,
      likelyCause: r.likely_cause ?? "",
      effect: r.effect ?? "",
      videoRemovedBy: r.video_clip_id ? null : removedBy.get(r.id) ?? null,
    }));
}
