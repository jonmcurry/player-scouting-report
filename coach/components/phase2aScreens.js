// Pure presentation decisions for the Phase 2A Development and Practice screens.
// These functions never write data or infer progress; they only shape existing,
// coach-authored rows for deterministic rendering and tests.
import { GROUPING_LABELS, gameTransfer, nextFocus } from "./developmentLogic.js";

export function developmentFocusModel({ priorities = [], progressById = {}, dueIds = [], assignments = [] } = {}) {
  const focus = nextFocus(priorities, progressById, dueIds);
  if (!focus) return null;
  const assignment = assignments.find((row) => row.player_priority_id === focus.priority.id && row.active) ?? null;
  return { ...focus, assignment };
}

export function transferModel(observations = []) {
  const checks = gameTransfer(observations);
  const latest = checks.at(-1) ?? null;
  if (!latest) return {
    key: "not_observed",
    label: "Not observed yet",
    detail: "No practice-to-game check recorded yet.",
    status: null,
  };
  if (!latest.game) return {
    key: "awaiting_game",
    label: "Waiting for next game",
    detail: `Practice recorded ${String(latest.practice.observed_at).slice(0, 10)}.`,
    status: latest.practice.status,
  };
  return {
    key: "coach_confirmed",
    label: "Coach confirmed",
    detail: `Game check recorded ${String(latest.game.observed_at).slice(0, 10)}.`,
    status: latest.game.status,
  };
}

export function existingSessionForDate(sessions = [], date) {
  return sessions.find((session) => session.session_date === date) ?? null;
}

export function practiceStartDefaults({ priorities = [], assignments = [], requestedPriorityId = null } = {}) {
  const priority = priorities.find((row) => row.id === requestedPriorityId)
    ?? priorities.find((row) => row.status === "active")
    ?? priorities[0]
    ?? null;
  const assignment = priority
    ? assignments.find((row) => row.player_priority_id === priority.id && row.active)
    : null;
  return {
    priorityId: priority?.id ?? "",
    drillId: assignment?.drill_id ?? "",
    goal: priority?.description ?? "",
  };
}

export function practiceProgression(reps = [], selectedGroup = null) {
  const groups = ["baseline", "drill", "post_drill"];
  const usable = reps.filter((rep) => rep.usable !== false);
  const counts = Object.fromEntries(groups.map((group) => [group, usable.filter((rep) => rep.grouping === group).length]));
  const suggested = counts.baseline === 0 ? "baseline" : counts.drill === 0 ? "drill" : "post_drill";
  const current = groups.includes(selectedGroup) ? selectedGroup : suggested;
  return {
    current,
    steps: groups.map((key) => ({
      key,
      label: GROUPING_LABELS[key],
      count: counts[key],
      state: key === current ? "current" : counts[key] > 0 ? "done" : "not_started",
    })),
  };
}

export function practicePrimaryAction({ hasPostDrill = false, assessmentSelected = false, assessmentSaved = false, assessing = false } = {}) {
  if (assessmentSaved) return "next_step";
  if (assessmentSelected || assessing) return "finish";
  if (hasPostDrill) return "compare";
  return "add_rep";
}

export function repPrimaryAction(rep) {
  const ready = rep?.clip?.status === "ready";
  return ready ? { key: "review", label: "Review" } : { key: "attach", label: rep?.clip ? "Video status" : "Attach video" };
}
