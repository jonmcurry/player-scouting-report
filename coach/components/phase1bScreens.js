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
    kind: "review", title: `${drafts.length} finding${drafts.length === 1 ? "" : "s"} to review`,
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
  return {
    total: issues.length,
    approved,
    label: `${issues.length} finding${issues.length === 1 ? "" : "s"} · ${approved ? `${approved} approved` : "Draft from analysis · Not reviewed"}`,
  };
}
