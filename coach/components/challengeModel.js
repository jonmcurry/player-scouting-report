// Client projection only. Server RPCs enforce coach scope and the independent
// template gate; this function never converts coach notes into an AI finding.
export function evaluateChallenge(protocol) {
  const slots = protocol?.slots ?? [];
  const missing = slots.filter((slot) => slot.state === "pending");
  const unrecorded = slots.filter((slot) => slot.state === "missed" || slot.state === "failed");
  const eligible = slots.filter((slot) => slot.state === "recorded"
    && slot.actualContext === slot.task
    && slot.actualEnvironment === protocol.environment
    && slot.repUsable !== false && slot.repMatchesSession === true && slot.readable === true
    && slot.captureSupported === true
    && protocol.captureProfiles.includes(slot.captureProfile));
  const perTask = (protocol?.tasks ?? []).map((task) => ({
    key: task.key, label: task.label, minimum: task.minimum,
    eligible: eligible.filter((slot) => slot.task === task.key).length,
  }));
  const short = perTask.filter((task) => task.eligible < task.minimum);
  const observations = Object.fromEntries(["consistent", "changed", "unclear"]
    .map((value) => [value, eligible.filter((slot) => slot.observation === value).length]));
  const complete = slots.length > 0 && !missing.length && !unrecorded.length && !short.length;
  const state = !protocol?.validated ? "unvalidated"
    : protocol.kind === "challenge" && protocol.repeatabilityReady !== true ? "prerequisite_missing"
    : missing.length || unrecorded.length ? "incomplete"
      : short.length ? "insufficient" : "ready";
  return {
    state, complete: complete && protocol.validated,
    eligible, perTask,
    observations,
    missingCount: missing.length, missedCount: unrecorded.length,
    insufficientCount: slots.filter((slot) => slot.state === "recorded" && !eligible.includes(slot)).length,
    // A coach's observed change is descriptive. No Phase 6 template defines
    // a validated performance criterion, so improvement is never inferred.
    changed: state === "ready" && eligible.some((slot) => slot.observation === "changed"),
    improved: false,
  };
}
