// Pure Phase 1B presentation decisions. Keeping these rules outside page DOM
// code makes the UX hierarchy deterministic and easy to regression test.

export function teamAttentionModel({ needsReview = [], dueFollowUps = [] } = {}) {
  const reviewCount = needsReview.reduce((sum, row) => sum + Number(row.n || 0), 0);
  const dueCount = dueFollowUps.length;
  const parts = [];
  if (reviewCount) parts.push(`${reviewCount} swing${reviewCount === 1 ? "" : "s"} to review`);
  if (dueCount) parts.push(`${dueCount} follow-up${dueCount === 1 ? "" : "s"} due`);
  return { reviewCount, dueCount, headline: parts.join(" · ") || "You're all caught up." };
}

export function nextActionModel({ drafts = [], duePriority = null, priority = null, assignment = null } = {}) {
  if (drafts.length) return {
    kind: "review", title: `${drafts.length} observation${drafts.length === 1 ? "" : "s"} to review`,
    detail: "Coach review is the next step.", label: "Review swing", clipId: drafts[0].video_clip_id,
  };
  if (duePriority) return { kind: "follow-up", title: `Check ${duePriority.title}`, detail: "Follow-up due", label: "Update progress" };
  if (priority && !assignment) return { kind: "drill", title: `Pick a drill for ${priority.title}`, detail: "Turn the priority into a practice plan.", label: "Choose drill" };
  if (priority && assignment) return { kind: "practice", title: `Practice ${priority.title}`, detail: assignment.drill_library?.name || "Assigned drill", label: "Start practice" };
  return { kind: "atbat", title: "Log the next at-bat", detail: "Add the next game observation.", label: "Log at-bat" };
}

export function findingActionState(issue, isTracked = false) {
  const reviewed = issue?.review_status !== "draft";
  return {
    reviewed,
    showApprove: !reviewed,
    showEdit: true,
    showReject: !reviewed,
    showTrack: reviewed && !isTracked && issue?.review_status !== "rejected",
    showAssignDrill: reviewed && isTracked,
  };
}

export function reviewSummary(issues = []) {
  const approved = issues.filter((i) => ["approved", "edited"].includes(i.review_status)).length;
  const drafts = issues.filter((i) => i.review_status === "draft").length;
  // "Draft from analysis · Not reviewed" describes actual unreviewed AI drafts - never zero findings.
  const status = approved ? ` · ${approved} approved` : drafts ? " · Draft from analysis · Not reviewed" : "";
  return {
    total: issues.length,
    approved,
    label: `${issues.length} observation${issues.length === 1 ? "" : "s"}${status}`,
  };
}

// A reviewed finding whose evidence clip was deleted (delete-clip records it -
// clip_removals_for_player). `removals` maps issue id -> "guardian" | "coach".
// Findings that simply never had a clip get no label: never guess why.
export function removedVideoNote(issue, removals) {
  if (!issue || !removals || issue.review_status === "draft" || issue.video_clip_id) return null;
  const role = removals.get(issue.id);
  if (role === "guardian") return "Video removed by family";
  if (role === "coach") return "Video removed by coach";
  return null;
}
