const timestamp = (record) => new Date(record.date ?? record.createdAt ?? 0).getTime();
const ordered = (a, b) => timestamp(a) <= timestamp(b) ? [a, b] : [b, a];
const ready = (records) => records.filter((record) => record.status === "ready" && record.swung !== false);

export function suggestedComparePairs(records = [], { priorityId = null, source = null } = {}) {
  const rows = ready(records); const pairs = [];
  const add = (key, label, a, b, contextPriorityId = null) => {
    if (!a || !b || a.clipId === b.clipId || pairs.some((pair) => pair.a.clipId === a.clipId && pair.b.clipId === b.clipId)) return;
    const [before, after] = ordered(a, b);
    pairs.push({ key, label, a: before, b: after, priorityId: contextPriorityId });
  };

  const sessions = [...new Set(rows.filter((r) => r.context === "practice" && r.sessionId).map((r) => r.sessionId))]
    .sort((a, b) => Math.max(...rows.filter((r) => r.sessionId === b).map(timestamp)) - Math.max(...rows.filter((r) => r.sessionId === a).map(timestamp)));
  for (const sessionId of sessions) {
    const session = rows.filter((r) => r.sessionId === sessionId);
    const baseline = session.filter((r) => r.grouping === "baseline").sort((a, b) => timestamp(a) - timestamp(b))[0];
    const post = session.filter((r) => r.grouping === "post_drill").sort((a, b) => timestamp(a) - timestamp(b)).at(-1);
    if (baseline && post) { add("baseline_post", "Baseline → Post-drill", baseline, post, baseline.priorityIds?.[0] ?? post.priorityIds?.[0] ?? null); break; }
  }

  const priorities = priorityId ? [priorityId] : [...new Set(rows.flatMap((r) => r.priorityIds ?? []))];
  for (const id of priorities) {
    const evidence = rows.filter((r) => r.priorityIds?.includes(id)).sort((a, b) => timestamp(a) - timestamp(b));
    if (evidence.length >= 2) add("priority_before_after", `Before → After: ${evidence[0].priorityTitles?.[id] ?? "priority"}`, evidence[0], evidence.at(-1), id);
    const practices = evidence.filter((r) => r.context === "practice");
    const p = practices.at(-1);
    const g = rows.filter((r) => r.context === "game" && p && timestamp(r) > timestamp(p)).sort((a, b) => timestamp(a) - timestamp(b))[0];
    if (p && g) add("practice_game", "Practice → Next game", p, g, id);
  }

  const gameDates = [...new Set(rows.filter((r) => r.context === "game").map((r) => r.date))].sort().reverse();
  if (gameDates.length >= 2) add("game_game", "Previous game → Latest game", rows.find((r) => r.context === "game" && r.date === gameDates[1]), rows.find((r) => r.context === "game" && r.date === gameDates[0]));

  const rank = (pair) => source === "practice" && pair.key === "baseline_post" ? -2 : priorityId && pair.priorityId === priorityId ? -1 : 0;
  return pairs.sort((a, b) => rank(a) - rank(b)).slice(0, 3);
}

export function sharedPhase(phasesA = [], phasesB = [], preferred = "contact") {
  const availableA = new Set(phasesA.filter((p) => p.timeS != null).map((p) => p.slug));
  const availableB = new Set(phasesB.filter((p) => p.timeS != null).map((p) => p.slug));
  if (availableA.has(preferred) && availableB.has(preferred)) return preferred;
  return ["stance", "load", "stride", "plant", "contact", "extension", "follow-through"].find((phase) => availableA.has(phase) && availableB.has(phase)) ?? null;
}
