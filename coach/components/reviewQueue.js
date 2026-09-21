// Pure review-queue model. A queue item is one ready clip with at least one
// draft finding. The database remains the source of truth; skipped ids only
// affect the current browser session's ordering.

const time = (value) => {
  const n = new Date(value ?? 0).getTime();
  return Number.isFinite(n) ? n : 0;
};

function clipFor(issue) {
  return issue.video_clip ?? issue.video_clips ?? null;
}

function playerFor(issue, clip) {
  return issue.player ?? clip?.game_log_entries?.players ?? null;
}

function swingOrder(item) {
  const entry = item.entry ?? {};
  const pitch = item.pitch?.pitch_number ?? Number.MAX_SAFE_INTEGER;
  const rep = item.rep?.rep_number ?? Number.MAX_SAFE_INTEGER;
  return [time(entry.date), Number(entry.ab ?? 0), Math.min(pitch, rep), time(item.createdAt)];
}

function compareOrder(a, b) {
  const aa = swingOrder(a); const bb = swingOrder(b);
  for (let i = 0; i < aa.length; i += 1) if (aa[i] !== bb[i]) return aa[i] - bb[i];
  return String(a.clipId).localeCompare(String(b.clipId));
}

export function buildReviewQueue(issues = [], { skippedClipIds = [] } = {}) {
  const byClip = new Map();
  let orphanDraftCount = 0;
  for (const issue of issues) {
    const clipId = issue.video_clip_id ?? clipFor(issue)?.id ?? null;
    if (!clipId) {
      if ((issue.review_status ?? "draft") === "draft") orphanDraftCount += 1;
      continue;
    }
    const clip = clipFor(issue) ?? {};
    if (clip.status && clip.status !== "ready") continue;
    if (!byClip.has(clipId)) {
      const entry = clip.game_log_entries ?? issue.game_log_entry ?? {};
      byClip.set(clipId, {
        clipId,
        player: playerFor(issue, clip) ?? { id: issue.player_id, name: "Player" },
        entry,
        pitch: clip.at_bat_pitches ?? issue.at_bat_pitch ?? null,
        rep: clip.practice_repetitions ?? issue.practice_repetition ?? null,
        createdAt: issue.created_at,
        findings: [],
      });
    }
    byClip.get(clipId).findings.push(issue);
  }

  const all = [...byClip.values()].map((item) => {
    const draftCount = item.findings.filter((finding) => finding.review_status === "draft").length;
    const decidedCount = item.findings.length - draftCount;
    return { ...item, draftCount, decidedCount, totalCount: item.findings.length, partial: draftCount > 0 && decidedCount > 0 };
  });
  const pending = all.filter((item) => item.draftCount > 0).sort(compareOrder);
  const reviewed = all.filter((item) => item.draftCount === 0).sort((a, b) => compareOrder(b, a)).slice(0, 5);

  const groupMap = new Map();
  for (const item of pending) {
    const key = item.player?.id ?? item.player?.name ?? "unknown";
    if (!groupMap.has(key)) groupMap.set(key, { player: item.player, swings: [] });
    groupMap.get(key).swings.push(item);
  }
  const groups = [...groupMap.values()].sort((a, b) => compareOrder(a.swings[0], b.swings[0]));
  const skipped = new Set(skippedClipIds);
  const next = pending.find((item) => !skipped.has(item.clipId)) ?? pending[0] ?? null;
  return { pending, reviewed, groups, next, pendingSwingCount: pending.length, playerCount: groups.length, orphanDraftCount };
}

export const distinctPendingSwingCount = (issues = []) => buildReviewQueue(issues).pendingSwingCount;

export function findingSequence(findings = []) {
  const nextIndex = findings.findIndex((finding) => finding.review_status === "draft");
  return findings.map((finding, index) => ({
    ...finding,
    actionable: index === nextIndex,
    expanded: index === nextIndex,
  }));
}

export function queueRemaining(queue, currentClipId) {
  return queue.pending.filter((item) => item.clipId !== currentClipId).length;
}
