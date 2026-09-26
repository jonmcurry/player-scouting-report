// Pure (no DOM, no Supabase) player-development logic shared by the coach pages
// (development / atbat / session / compare / review / team dashboard) and by
// developmentLogic.test.mjs. Kept dependency-free on purpose: coach/ is
// plain browser ESM with no build step, and the tests import this file
// directly, so what is tested is exactly what ships.
//
// Coach judgment is authoritative throughout: nothing here resolves a
// priority, assigns a drill, or declares improvement. AI-sourced text only
// ever appears as a suggestion field.

export const PRIORITY_CATEGORIES = [
  { slug: "front-side-stability", label: "Front-side stability" },
  { slug: "hand-path", label: "Hand path" },
  { slug: "timing-inside-pitch", label: "Timing vs inside pitch" },
  { slug: "head-movement", label: "Head movement" },
  { slug: "stride-consistency", label: "Stride consistency" },
  { slug: "loft-fly-ball", label: "Ball flight (too much loft)" },
  { slug: "load-timing", label: "Load / timing" },
  { slug: "balance-finish", label: "Balance & finish" },
  { slug: "other", label: "Other" },
];

export const PRIORITY_STATUSES = ["active", "monitoring", "resolved", "archived"];
export const OBSERVATION_STATUSES = ["improving", "unchanged", "worse", "resolved", "unclear"];
export const PRACTICE_GROUPINGS = ["baseline", "drill", "post_drill", "free_swing", "other"];
export const PITCH_OUTCOMES = [
  "ball", "called_strike", "swinging_strike", "foul", "ball_in_play", "hit_by_pitch", "take", "other",
];

export const OBSERVATION_LABELS = {
  improving: "Improving",
  unchanged: "Unchanged",
  worse: "Worse",
  resolved: "Resolved",
  unclear: "Unclear",
};
export const GROUPING_LABELS = {
  baseline: "Baseline",
  drill: "Drill",
  post_drill: "Post-drill",
  free_swing: "Free swing",
  other: "Other",
};
export const PITCH_OUTCOME_LABELS = {
  ball: "Ball",
  called_strike: "Called strike",
  swinging_strike: "Swinging strike",
  foul: "Foul",
  ball_in_play: "Ball in play",
  hit_by_pitch: "Hit by pitch",
  take: "Take",
  other: "Other",
};

/** Whether an outcome implies a swing. null = the outcome doesn't say
 * (ball/other/HBP could be either only for "other"; ball/called strike/HBP
 * are always takes). Used to default `swung` without inventing data. */
export function swungFromOutcome(outcome) {
  switch (outcome) {
    case "swinging_strike":
    case "foul":
    case "ball_in_play":
      return true;
    case "ball":
    case "called_strike":
    case "hit_by_pitch":
    case "take":
      return false;
    default:
      return null;
  }
}

// ---------------------------------------------------------------------------
// Priorities
// ---------------------------------------------------------------------------

export function isValidPriorityStatus(s) {
  return PRIORITY_STATUSES.includes(s);
}

/** Any change between two valid, different statuses is a coach decision and
 * is allowed (reopening a resolved priority included). What is NOT allowed is
 * an AI/automated actor making the change - callers pass `actor`. */
export function canTransitionPriority(from, to, actor = "coach") {
  if (actor !== "coach") return false;
  if (!isValidPriorityStatus(from) || !isValidPriorityStatus(to)) return false;
  return from !== to;
}

/** Given a coach's observation status, what priority status (if any) is
 * *suggested*. Never applied automatically - the UI offers it as a one-tap
 * action the coach must take. */
export function suggestedPriorityStatus(observationStatus) {
  return observationStatus === "resolved" ? "resolved" : null;
}

/** Latest coach observation drives the progress label. Observations are all
 * coach-authored rows, so this is coach-confirmed progress by construction. */
export function deriveProgress(observations) {
  const obs = [...(observations ?? [])].sort((a, b) => new Date(b.observed_at) - new Date(a.observed_at));
  if (obs.length === 0) return { status: null, label: "Needs review", latest: null, count: 0 };
  const latest = obs[0];
  return { status: latest.status, label: OBSERVATION_LABELS[latest.status] ?? "Needs review", latest, count: obs.length };
}

/** Player-overview ordering: active first (by priority_order then age), then monitoring. */
export function orderPriorities(priorities) {
  const rank = { active: 0, monitoring: 1, resolved: 2, archived: 3 };
  return [...priorities].sort(
    (a, b) =>
      (rank[a.status] ?? 9) - (rank[b.status] ?? 9) ||
      (a.priority_order ?? 0) - (b.priority_order ?? 0) ||
      new Date(a.first_identified_at) - new Date(b.first_identified_at),
  );
}

/** Suggested drills for a priority from the curated library's tag mapping.
 * Purely a suggestion list - the coach assigns. Already-assigned drills are excluded. */
export function suggestDrills(priority, library, assignedDrillIds = []) {
  const assigned = new Set(assignedDrillIds);
  const tag = priority?.category;
  if (!tag || tag === "other") return [];
  return (library ?? []).filter(
    (d) => d.is_active !== false && !assigned.has(d.id) && (d.target_tags ?? []).includes(tag),
  );
}

/** Guess a priority category from AI-draft text so "Promote to priority" can
 * pre-fill one. Keyword match only - the coach can change it. */
export function guessCategory(text) {
  const t = String(text ?? "").toLowerCase();
  const rules = [
    ["front-side-stability", /front[- ]?side|opens? early|early opening|front (hip|shoulder|foot)|flying open/],
    ["hand-path", /hand path|hands? (drop|loop|cast)|bat path|hitch/],
    ["timing-inside-pitch", /inside pitch|jammed|timing.*inside|inside.*timing/],
    ["head-movement", /head (movement|moves?|drifts?)|eyes? (off|move)/],
    ["stride-consistency", /stride|plant/],
    ["loft-fly-ball", /fly[- ]?ball|loft|under the ball/],
    ["load-timing", /\bload\b|timing/],
    ["balance-finish", /balance|finish|falls? off/],
  ];
  for (const [slug, re] of rules) if (re.test(t)) return slug;
  return "other";
}

// ---------------------------------------------------------------------------
// Follow-ups
// ---------------------------------------------------------------------------

/** A follow-up is a simple due/not-due state, not a calendar.
 * ctx = { now: Date, practiceSessionDates: 'YYYY-MM-DD'[], gameDates: 'YYYY-MM-DD'[], swingDates: ISO[] }
 * - next_practice / next_game: due once such an event happened after the follow-up was set
 * - after_swings: due once N swings were captured after it was set
 * - date: due on/after that date */
export function isFollowUpDue(priority, ctx) {
  if (!priority?.follow_up_kind || priority.follow_up_done_at) return false;
  if (priority.status === "resolved" || priority.status === "archived") return false;
  const since = priority.follow_up_set_at ? new Date(priority.follow_up_set_at) : null;
  const after = (d) => (since ? new Date(`${String(d).slice(0, 10)}T23:59:59`) >= since : true);
  switch (priority.follow_up_kind) {
    case "date":
      return !!priority.follow_up_date && new Date(`${priority.follow_up_date}T00:00:00`) <= (ctx.now ?? new Date());
    case "next_practice":
      return (ctx.practiceSessionDates ?? []).some(after);
    case "next_game":
      return (ctx.gameDates ?? []).some(after);
    case "after_swings": {
      const n = (ctx.swingDates ?? []).filter((d) => (since ? new Date(d) >= since : true)).length;
      return n >= (priority.follow_up_swings ?? Infinity);
    }
    default:
      return false;
  }
}

export function followUpLabel(p) {
  switch (p?.follow_up_kind) {
    case "next_practice": return "Review next practice";
    case "next_game": return "Review in next game";
    case "after_swings": return `Review after ${p.follow_up_swings} swings`;
    case "date": return `Review by ${p.follow_up_date}`;
    default: return "";
  }
}

// ---------------------------------------------------------------------------
// Game transfer (practice -> next game), coach-confirmed observations only
// ---------------------------------------------------------------------------

const GOOD = new Set(["improving", "resolved"]);

/** Pairs each practice observation with the first game observation after it.
 * `observations` are the coach's rows for ONE priority. Nothing is inferred
 * from AI: a missing game observation is "awaiting_game", not "failed". */
export function gameTransfer(observations) {
  const obs = [...(observations ?? [])].sort((a, b) => new Date(a.observed_at) - new Date(b.observed_at));
  const practice = obs.filter((o) => o.context === "practice");
  const games = obs.filter((o) => o.context === "game");
  return practice.map((p) => {
    const g = games.find((x) => new Date(x.observed_at) > new Date(p.observed_at)) ?? null;
    let result = "awaiting_game";
    if (g) {
      if (g.status === "unclear") result = "unclear";
      else if (GOOD.has(g.status)) result = GOOD.has(p.status) ? "carried_over" : "improved_in_game";
      else if (g.status === "unchanged") result = GOOD.has(p.status) ? "partly_carried_over" : "no_change";
      else result = "not_carried_over";
    }
    return { practice: p, game: g, result };
  });
}

export const TRANSFER_LABELS = {
  carried_over: "Carried over to the game",
  improved_in_game: "Improved in the game",
  partly_carried_over: "Only partly carried over",
  no_change: "No change",
  not_carried_over: "Did not carry over",
  unclear: "Unclear",
  awaiting_game: "Waiting on a game to check",
};

// ---------------------------------------------------------------------------
// Timeline
// ---------------------------------------------------------------------------

/** Merges heterogenous events into one newest-first list that reads without
 * opening any clip. Input arrays are all optional. Every event has
 * { at: ISO, kind, title, detail, href? }. */
export function buildTimeline({
  games = [], // { date, opponent, ab, swingsAnalyzed, pitchCount, id }
  practiceSessions = [], // { id, session_date, goal, focusTitle, drillName, repCount, swingCount, outcome, outcome_note }
  priorities = [], // { id, title, first_identified_at }
  drillAssignments = [], // { assigned_at, drillName, priorityTitle }
  statusHistory = [], // { changed_at, from_status, to_status, priorityTitle, note }
  observations = [], // { observed_at, status, priorityTitle, coach_note, context }
  notes = [], // { at, text, priorityTitle }
  comparisons = [], // { at, title, detail, href }
} = {}) {
  const ev = [];
  const day = (d) => new Date(`${String(d).slice(0, 10)}T12:00:00`).toISOString();

  // Group game at-bats by date: "Sep 19 - Game, 2 swings analyzed".
  const gamesByDate = new Map();
  for (const g of games) {
    const k = String(g.date).slice(0, 10);
    if (!gamesByDate.has(k)) gamesByDate.set(k, []);
    gamesByDate.get(k).push(g);
  }
  for (const [date, list] of gamesByDate) {
    const swings = list.reduce((n, g) => n + (g.swingsAnalyzed ?? 0), 0);
    const opp = [...new Set(list.map((g) => g.opponent).filter(Boolean))].join(", ");
    ev.push({
      at: day(date),
      kind: "game",
      title: `Game${opp ? ` vs ${opp}` : ""}`,
      detail: `${list.length} at-bat${list.length === 1 ? "" : "s"}, ${swings} swing${swings === 1 ? "" : "s"} analyzed`,
      href: list.length === 1 ? { page: "atbat", id: list[0].id } : null,
    });
  }
  for (const s of practiceSessions) {
    const bits = [`${s.swingCount ?? 0} swing${s.swingCount === 1 ? "" : "s"}`];
    if (s.drillName) bits.push(s.drillName);
    if (s.focusTitle) bits.push(`Focus: ${s.focusTitle}`);
    if (s.outcome) bits.push(`Coach: ${OUTCOME_LABELS[s.outcome] ?? s.outcome}`);
    if (s.outcome_note) bits.push(`"${s.outcome_note}"`);
    ev.push({ at: day(s.session_date), kind: "practice", title: "Practice", detail: bits.join(" · "), href: { page: "session", id: s.id } });
  }
  for (const p of priorities) {
    ev.push({ at: p.first_identified_at, kind: "priority_created", title: `Priority created: ${p.title}`, detail: p.description ?? "" });
  }
  for (const a of drillAssignments) {
    ev.push({ at: a.assigned_at, kind: "drill_assigned", title: `Drill assigned: ${a.drillName}`, detail: a.priorityTitle ? `For ${a.priorityTitle}` : "" });
  }
  for (const h of statusHistory) {
    if (!h.from_status) continue; // creation is already shown as "Priority created"
    ev.push({
      at: h.changed_at,
      kind: "priority_status",
      title: `${h.priorityTitle}: ${h.from_status} → ${h.to_status}`,
      detail: h.note ?? "",
    });
  }
  for (const o of observations) {
    ev.push({
      at: o.observed_at,
      kind: "observation",
      title: `${o.priorityTitle}: ${OBSERVATION_LABELS[o.status] ?? o.status}`,
      detail: [o.context === "game" ? "In a game" : o.context === "practice" ? "In practice" : "", o.coach_note ? `"${o.coach_note}"` : ""]
        .filter(Boolean)
        .join(" · "),
    });
  }
  for (const n of notes) ev.push({ at: n.at, kind: "coach_note", title: "Coach note", detail: n.text });
  for (const c of comparisons) ev.push({ at: c.at, kind: "comparison", title: c.title ?? "Comparison", detail: c.detail ?? "", href: c.href ?? null });

  return ev.filter((e) => e.at).sort((a, b) => new Date(b.at) - new Date(a.at));
}

export const OUTCOME_LABELS = { yes: "Improved", no: "Did not improve", mixed: "Mixed", unclear: "Unclear" };

// ---------------------------------------------------------------------------
// At-bat / pitches
// ---------------------------------------------------------------------------

/** Next available pitch number for an at-bat. */
export function nextPitchNumber(pitches) {
  return (pitches ?? []).reduce((m, p) => Math.max(m, p.pitch_number ?? 0), 0) + 1;
}

/** Sequence check: pitch numbers must be unique positive integers. Returns
 * the problems (empty = fine). Order is by pitch_number, never insertion. */
export function validatePitchOrder(pitches) {
  const problems = [];
  const seen = new Set();
  for (const p of pitches ?? []) {
    if (!Number.isInteger(p.pitch_number) || p.pitch_number < 1) problems.push(`Invalid pitch number ${p.pitch_number}`);
    else if (seen.has(p.pitch_number)) problems.push(`Duplicate pitch number ${p.pitch_number}`);
    seen.add(p.pitch_number);
  }
  return problems;
}

export function sortPitches(pitches) {
  return [...(pitches ?? [])].sort((a, b) => a.pitch_number - b.pitch_number);
}

/** Count before each pitch. Uses the stored count when the coach entered one;
 * otherwise infers it from the previous pitch's known outcome. Once an
 * earlier pitch's outcome doesn't determine the count (generic take, other,
 * or a missing outcome) the inferred count becomes null - never guessed. */
export function inferCounts(pitches) {
  const out = [];
  let balls = 0;
  let strikes = 0;
  let known = true;
  for (const p of sortPitches(pitches)) {
    const stored = p.count_before_balls != null && p.count_before_strikes != null;
    if (stored) {
      balls = p.count_before_balls;
      strikes = p.count_before_strikes;
      known = true;
    }
    out.push({ pitch: p, balls: known ? balls : null, strikes: known ? strikes : null, inferred: known && !stored });
    if (!known) continue;
    switch (p.pitch_outcome) {
      case "ball": balls = Math.min(4, balls + 1); break;
      case "called_strike":
      case "swinging_strike": strikes = Math.min(3, strikes + 1); break;
      case "foul": if (strikes < 2) strikes += 1; break;
      case "ball_in_play":
      case "hit_by_pitch": break;
      default: known = false;
    }
  }
  return out;
}

export function countLabel(b, s) {
  return b == null || s == null ? "count unknown" : `${b}-${s}`;
}

/** Stamp each clip with `analyzed`, from the ids of clips that have an
 * analysis_runs row (the same signal player.html and review.html use - there
 * is no `analyzed` column on video_clips). `analyzedClipIds` null means that
 * lookup failed or wasn't made: ready clips then get `analyzed: null`
 * (unknown), never false. A clip that isn't ready can't have been analyzed. */
export function markClipsAnalyzed(clips, analyzedClipIds) {
  const known = analyzedClipIds == null ? null : new Set(analyzedClipIds);
  return (clips ?? []).map((c) => ({
    ...c,
    analyzed: c.status !== "ready" ? false : known ? known.has(c.id) : null,
  }));
}

/** Per-pitch analysis state: true if any ready clip is known analyzed, false
 * only if every ready clip is known not analyzed (or there is none), null
 * when that can't be established from the loaded rows. */
function pitchAnalyzed(cs) {
  const ready = cs.filter((c) => c.status === "ready");
  if (ready.some((c) => c.analyzed === true)) return true;
  if (ready.every((c) => c.analyzed === false)) return false;
  return null;
}

/** `clips` null/undefined means the clip rows didn't load: analysis state is
 * then unknown (all analyzed* counts null) rather than "none analyzed" - even
 * for an at-bat with no pitches. Analyzed video is only an "analyzed swing"
 * when the pitch is explicitly recorded as a swing - analysis never proves a
 * swing happened. Analyzed video on a recorded take, on a pitch whose
 * swing/take isn't recorded, or not attached to any pitch is counted apart. */
export function summarizeAtBat(entry, pitches, clips) {
  const sorted = sortPitches(pitches);
  const clipsKnown = Array.isArray(clips);
  const clipsByPitch = new Map();
  for (const c of clips ?? []) {
    if (!c.at_bat_pitch_id) continue;
    if (!clipsByPitch.has(c.at_bat_pitch_id)) clipsByPitch.set(c.at_bat_pitch_id, []);
    clipsByPitch.get(c.at_bat_pitch_id).push(c);
  }
  const rows = inferCounts(sorted).map(({ pitch, balls, strikes, inferred }) => {
    const cs = clipsByPitch.get(pitch.id) ?? [];
    return {
      pitch,
      count: countLabel(balls, strikes),
      countInferred: inferred,
      outcomeLabel: PITCH_OUTCOME_LABELS[pitch.pitch_outcome] ?? "Outcome not recorded",
      swung: pitch.swung ?? swungFromOutcome(pitch.pitch_outcome),
      clips: cs,
      hasVideo: cs.length > 0,
      videoAnalyzed: clipsKnown ? pitchAnalyzed(cs) : null,
      videoStatus: cs.length === 0 ? "none" : cs.some((c) => c.status === "failed") ? "failed" : cs.some((c) => c.status !== "ready") ? "processing" : "ready",
    };
  });
  const unassignedReady = (clips ?? []).filter((c) => !c.at_bat_pitch_id && c.status === "ready");
  const analysisKnown = clipsKnown && rows.every((r) => r.videoAnalyzed != null) && unassignedReady.every((c) => typeof c.analyzed === "boolean");
  const analyzedWhere = (swung) => (analysisKnown ? rows.filter((r) => r.videoAnalyzed && swung(r.swung)).length : null);
  return {
    result: entry?.result ?? null,
    pitchCount: sorted.length,
    swings: rows.filter((r) => r.swung === true).length,
    takes: rows.filter((r) => r.swung === false).length,
    swingUnknown: rows.filter((r) => r.swung == null).length,
    analyzedSwings: analyzedWhere((swung) => swung === true),
    analyzedTakes: analyzedWhere((swung) => swung === false),
    analyzedUnrecorded: analyzedWhere((swung) => swung == null),
    unassignedAnalyzed: analysisKnown ? unassignedReady.filter((c) => c.analyzed).length : null,
    rows,
  };
}

/** True when every clause atBatFactsSummary would state is backed by loaded
 * data - the gate for persisting it as ai_summary. */
export function atBatSummaryComplete(summary) {
  return summary.analyzedSwings != null;
}

/** At-bat-level AI-free summary from known metadata only. It states what is
 * recorded and what is not; it never invents pitch type, location, intent or
 * strategy, and says plainly when only one swing exists. Unknown swing/take
 * or analysis state is said to be unknown or left out - never counted as 0.
 * `swingFacts` is an optional array of per-analyzed-swing
 * { phaseTimes: {stance, load, contact} } */
export function atBatFactsSummary(summary, swingFacts = []) {
  const lines = [];
  const n = summary.pitchCount;
  const pitchesLabel = `${n} pitch${n === 1 ? "" : "es"} recorded`;
  if (n > 0 && summary.swingUnknown === n) {
    lines.push(`${pitchesLabel}. Swing or take is not recorded for ${n === 1 ? "it" : "these pitches"}.`);
  } else {
    const known = `${summary.swings} swing${summary.swings === 1 ? "" : "s"}, ${summary.takes} take${summary.takes === 1 ? "" : "s"}`;
    lines.push(summary.swingUnknown > 0
      ? `${pitchesLabel}: ${known}; swing or take not recorded for ${summary.swingUnknown}.`
      : `${pitchesLabel}: ${known}.`);
  }
  const otherAnalyzed = (summary.analyzedTakes ?? 0) + (summary.analyzedUnrecorded ?? 0) + (summary.unassignedAnalyzed ?? 0);
  if (summary.analyzedSwings == null) {
    // Analysis state couldn't be confirmed - withhold the claim.
  } else if (summary.analyzedSwings === 0) {
    if (otherAnalyzed === 0) lines.push("No video in this at-bat has been analyzed yet.");
  } else if (summary.analyzedSwings === 1) {
    lines.push("Only one swing was analyzed in this at-bat, so there is nothing to compare across swings.");
  } else {
    const loadToContact = swingFacts
      .map((f) => (f?.phaseTimes?.contact != null && f?.phaseTimes?.load != null ? f.phaseTimes.contact - f.phaseTimes.load : null))
      .filter((v) => v != null);
    lines.push(`${summary.analyzedSwings} swings were analyzed - compare them side by side to check stance/load consistency.`);
    if (loadToContact.length >= 2) {
      const min = Math.min(...loadToContact);
      const max = Math.max(...loadToContact);
      lines.push(`Load-to-contact time ranged ${min.toFixed(2)}-${max.toFixed(2)}s across those swings (automated timing, low confidence).`);
    }
  }
  if (summary.analyzedUnrecorded > 0) lines.push(`${summary.analyzedUnrecorded} pitch${summary.analyzedUnrecorded === 1 ? " has" : "es have"} analyzed video.`);
  if (summary.analyzedTakes > 0) lines.push(`${summary.analyzedTakes} pitch${summary.analyzedTakes === 1 ? " recorded as a take has" : "es recorded as takes have"} analyzed video.`);
  if (summary.unassignedAnalyzed > 0) lines.push(`${summary.unassignedAnalyzed} analyzed video${summary.unassignedAnalyzed === 1 ? " is" : "s are"} not attached to a pitch.`);
  const unrecorded = summary.rows.filter((r) => r.pitch.pitch_outcome == null).length;
  if (unrecorded > 0) lines.push(`${unrecorded} pitch outcome${unrecorded === 1 ? " is" : "s are"} not recorded.`);
  return lines.join(" ");
}

/** A finite numeric score, or null. Missing data stays missing: null,
 * undefined, "", NaN, Infinity and non-numeric values are never coerced to 0
 * (Number(null) === 0 made a team with two 3s and nine unscored checkpoints
 * average 0.5). Numeric strings are accepted because Postgres numeric can
 * arrive as a string. */
function validScore(v) {
  if (typeof v === "number") return Number.isFinite(v) ? v : null;
  if (typeof v === "string" && /^\s*-?\d+(\.\d+)?\s*$/.test(v) && Number.isFinite(Number(v))) return Number(v);
  return null;
}

/** Mean of the valid scores in `values` (see validScore), or null if none. */
export function averageValidScores(values) {
  const valid = (values ?? []).map(validScore).filter((v) => v != null);
  return valid.length ? valid.reduce((a, b) => a + b, 0) / valid.length : null;
}

/** Player history "Team Avg": mean of per-checkpoint averages over
 * coach-verified checklist scores only. `rows` are checklist_scores rows
 * ({ checkpoint_id, score, review_status }). review_status is the authority -
 * ai_draft, rejected and insufficient_evidence rows never participate, and a
 * score's value is never used to guess its review state. null when no
 * verified score exists. */
export function teamAverageFromChecklistRows(rows) {
  const byCheckpoint = new Map();
  for (const row of rows ?? []) {
    const score = validScore(row?.score);
    if (row?.review_status !== "verified" || score == null || !row.checkpoint_id) continue;
    if (!byCheckpoint.has(row.checkpoint_id)) byCheckpoint.set(row.checkpoint_id, []);
    byCheckpoint.get(row.checkpoint_id).push(score);
  }
  return averageValidScores([...byCheckpoint.values()].map(averageValidScores));
}

// ---------------------------------------------------------------------------
// Practice sessions
// ---------------------------------------------------------------------------

/** reps: [{ id, grouping, usable, hasClip, analyzed }] */
export function summarizePracticeSession(session, reps, priority) {
  const captured = reps.filter((r) => r.hasClip);
  const usable = captured.filter((r) => r.usable !== false);
  const rejected = captured.filter((r) => r.usable === false);
  const by = { baseline: 0, drill: 0, post_drill: 0, free_swing: 0, other: 0 };
  for (const r of usable) by[r.grouping] = (by[r.grouping] ?? 0) + 1;
  return {
    captured: captured.length,
    usable: usable.length,
    rejected: rejected.length,
    byGrouping: by,
    hasBeforeAfter: by.baseline > 0 && by.post_drill > 0,
    focus: priority?.title ?? null,
    priorityStatus: priority?.status ?? null,
    // Improvement is only ever the coach's call.
    coachAssessment: session?.outcome ? OUTCOME_LABELS[session.outcome] : null,
    coachAssessmentNote: session?.outcome_note ?? "",
  };
}

/** Picks the two rep sets for the "did the movement change inside this
 * session" comparison; null when there's nothing to compare yet. */
export function beforeAfterSets(reps) {
  const usable = reps.filter((r) => r.hasClip && r.usable !== false);
  const before = usable.filter((r) => r.grouping === "baseline");
  const after = usable.filter((r) => r.grouping === "post_drill");
  return { before, after, ready: before.length > 0 && after.length > 0 };
}

// ---------------------------------------------------------------------------
// Swing comparison
// ---------------------------------------------------------------------------

export const PHASES = [
  { slug: "stance", label: "Stance" },
  { slug: "load", label: "Load" },
  { slug: "stride", label: "Stride / plant" },
  { slug: "contact", label: "Contact (estimate)" },
  { slug: "extension", label: "Extension" },
  { slug: "follow_through", label: "Finish" },
];

export const FRAME_PRESETS = [
  { id: "load-contact", label: "Load → Contact", a: "load", b: "contact" },
  { id: "plant-contact", label: "Plant → Contact", a: "stride", b: "contact" },
  { id: "contact-finish", label: "Contact → Finish", a: "contact", b: "follow_through" },
];

export function phaseTime(phases, slug) {
  const p = (phases ?? []).find((x) => x.slug === slug || x.slug === slug.replace("_", "-"));
  return p && p.timeS != null ? p.timeS : p && p.time_s != null ? p.time_s : null;
}

/** Playback offset that puts `slug` at the same instant in both swings.
 * Returns the two start offsets (seconds) so that stepping both by the same
 * delta keeps them aligned around the phase. `lead` = seconds shown before it. */
export function alignAroundPhase(phasesA, phasesB, slug, lead = 0.5) {
  const ta = phaseTime(phasesA, slug);
  const tb = phaseTime(phasesB, slug);
  if (ta == null || tb == null) return null;
  return { startA: Math.max(0, ta - lead), startB: Math.max(0, tb - lead), phaseA: ta, phaseB: tb, lead };
}

/** Selection rules for the compare page: two different swings, any source. */
export function validateComparisonSelection(a, b) {
  if (!a || !b) return { ok: false, reason: "No comparison selected." };
  if (a.clipId === b.clipId) return { ok: false, reason: "Pick two different swings." };
  return { ok: true, reason: null };
}

export function describeSwing(s) {
  if (!s) return "";
  const where = s.context === "practice" ? `Practice rep ${s.repNumber ?? ""}`.trim() : `AB ${s.ab ?? ""}${s.pitchNumber ? ` · Pitch ${s.pitchNumber}` : ""}`.trim();
  return `${s.date} — ${where}`;
}

/** The 2D values are image-plane estimates from one uncalibrated camera, never
 * direct measurements - each row says what the number actually is. */
export const METRIC_SOURCE_2D = "2D video estimate · not calibrated";

/** Metric rows for a comparison: 2D video estimates only. Single-camera 3D
 * reconstructions (joint angles) are never shown to coaches - they can look
 * visibly wrong even when the clip's own quality label says "good".
 * Returns [{ label, a, b, unit, source, note }] with nulls omitted. */
export function metricComparison(metricsA, metricsB) {
  const direct = [
    ["Bat speed (2D, body-relative)", "max_bat_speed_full_rate_value", "max_bat_speed_value", "shoulder-widths/s",
      "Image-plane speed scaled to body size - not mph, and not comparable across camera positions."],
    ["Attack angle (2D)", "attack_angle_at_contact_deg", null, "°", "Bat angle in the image at contact; depends on the camera angle."],
    ["Stride (2D, whole clip)", "stride_length_hip_widths", null, "hip-widths",
      "Front-ankle travel in the image from the clip's first tracked frame - not a calibrated stride length."],
  ];
  const rows = [];
  const pick = (m, k1, k2) => (m ? m[k1] ?? (k2 ? m[k2] : null) ?? null : null);
  for (const [label, k1, k2, unit, note] of direct) {
    const a = pick(metricsA, k1, k2);
    const b = pick(metricsB, k1, k2);
    if (a != null || b != null) rows.push({ label, a, b, unit, source: METRIC_SOURCE_2D, note });
  }
  return rows;
}

// ---------------------------------------------------------------------------
// Analysis quality (plain language)
// ---------------------------------------------------------------------------

export function rateFraction(v, good, limited) {
  if (v == null || Number.isNaN(v)) return null;
  return v >= good ? "good" : v >= limited ? "limited" : "poor";
}

/** Maps raw ingest-time numbers to the coach-facing Good/Limited/Poor panel. */
export function analysisQualityLabels(q) {
  if (!q) return null;
  return {
    pose: q.pose_coverage_rating ?? rateFraction(q.pose_coverage, 0.85, 0.6),
    bat: q.bat_coverage_rating ?? rateFraction(q.bat_coverage, 0.5, 0.25),
    contact: q.contact_confidence ?? null,
    reconstruction: q.reconstruction ?? rateFraction(q.pose3d_coverage, 0.85, 0.6),
    occlusion: q.occlusion ?? null,
    handedness: q.handedness ?? null,
  };
}

export const QUALITY_TEXT = { good: "Good", limited: "Limited", poor: "Poor" };

// ---------------------------------------------------------------------------
// Swing history filters
// ---------------------------------------------------------------------------

/** swing = { clipId, context:'game'|'practice', date, entryId, pitchId, repId, swung,
 *   balls, strikes, pitchType, pitchLocation, priorityIds:[], issueIds:[], drillIds:[],
 *   reviewed:boolean, batConfidence } - built from real rows; absent metadata stays null. */
export function filterSwings(swings, f = {}) {
  return swings.filter((s) => {
    if (f.context && s.context !== f.context) return false;
    if (f.dateFrom && s.date < f.dateFrom) return false;
    if (f.dateTo && s.date > f.dateTo) return false;
    if (f.entryId && s.entryId !== f.entryId) return false;
    if (f.pitchId && s.pitchId !== f.pitchId) return false;
    if (f.swung === "swing" && s.swung !== true) return false;
    if (f.swung === "take" && s.swung !== false) return false;
    if (f.priorityId && !(s.priorityIds ?? []).includes(f.priorityId)) return false;
    if (f.issueId && !(s.issueIds ?? []).includes(f.issueId)) return false;
    if (f.drillId && !(s.drillIds ?? []).includes(f.drillId)) return false;
    if (f.reviewed === "reviewed" && !s.reviewed) return false;
    if (f.reviewed === "unreviewed" && s.reviewed) return false;
    if (f.strikes != null && s.strikes !== f.strikes) return false;
    if (f.balls != null && s.balls !== f.balls) return false;
    if (f.pitchType && s.pitchType !== f.pitchType) return false;
    if (f.pitchLocation && s.pitchLocation !== f.pitchLocation) return false;
    if (f.lowBatConfidence && s.batConfidence !== "poor") return false;
    if (f.grouping && s.grouping !== f.grouping) return false;
    return true;
  });
}

// ---------------------------------------------------------------------------
// Report (player-facing)
// ---------------------------------------------------------------------------

/** Public-report progress series for one priority from coach-confirmed
 * observations only, oldest first. */
export function progressSeries(observations) {
  return [...(observations ?? [])]
    .sort((a, b) => new Date(a.observed_at) - new Date(b.observed_at))
    .map((o) => ({ date: String(o.observed_at).slice(0, 10), label: OBSERVATION_LABELS[o.status] ?? o.status, note: o.coach_note || "" }));
}

/** Text rating for the "what you're doing well" list: checkpoints the coach
 * confirmed at 3. Unreviewed AI drafts are never shown to a player. */
export function strengthsFromChecklist(rows) {
  return (rows ?? []).filter((r) => r.reviewed_by && r.score === 3).map((r) => r.label ?? r.slug);
}

// ---------------------------------------------------------------------------
// Coach review draft structure
// ---------------------------------------------------------------------------

export function isReviewable(issue) {
  return issue && issue.review_status !== "rejected";
}

/** Coach action on an AI draft. Returns the patch to write. Approving or
 * editing stamps the reviewer; nothing here ever touches coach-reviewed rows
 * from an AI actor (callers only invoke this from a coach click). */
export function issueReviewPatch(action, coachName, edits = {}) {
  if (action === "approve") return { review_status: "approved", reviewed_by: coachName };
  if (action === "edit") return { ...edits, review_status: "edited", reviewed_by: coachName };
  if (action === "reject") return { review_status: "rejected", reviewed_by: coachName };
  throw new Error(`Unknown review action: ${action}`);
}

/** Should an AI re-run replace this existing issue row? Never if a coach has
 * reviewed it (approved/edited/rejected). */
export function aiMayReplaceIssue(issue) {
  return !issue.reviewed_by && (issue.review_status ?? "draft") === "draft";
}

// ---------------------------------------------------------------------------
// Coaching loop + next focus
// ---------------------------------------------------------------------------

/** The visible game -> priority -> drill -> practice -> next game -> coach loop
 * for one priority. Every step's state comes from real rows: nothing is
 * marked done because an AI said so. */
export function coachingLoop(priority, observations = [], assignments = []) {
  const obs = [...observations].sort((a, b) => new Date(a.observed_at) - new Date(b.observed_at));
  const firstPractice = obs.find((o) => o.context === "practice");
  const gameAfterPractice = firstPractice ? obs.find((o) => o.context === "game" && new Date(o.observed_at) > new Date(firstPractice.observed_at)) : null;
  const closed = priority.status === "resolved" || priority.status === "archived";
  const steps = [
    { key: "identified", label: "Issue identified", done: true },
    { key: "priority", label: "Priority created", done: true },
    { key: "drill", label: "Drill assigned", done: assignments.some((a) => a.active !== false) },
    { key: "practice", label: "Practice before/after", done: !!firstPractice },
    { key: "transfer", label: "Next game check", done: !!gameAfterPractice },
    { key: "decision", label: "Keep / modify / resolve", done: closed },
  ];
  const firstOpen = steps.findIndex((s) => !s.done);
  return steps.map((s, i) => ({ ...s, state: s.done ? "done" : i === firstOpen ? "now" : "todo" }));
}

/** What the coach should look at next: due follow-ups first, then priorities
 * with no coach observation yet, then the ones reported worse/unchanged, then
 * the top active priority. `progress` maps priority id -> deriveProgress(). */
export function nextFocus(priorities, progress, dueIds = []) {
  const open = orderPriorities(priorities.filter((p) => p.status === "active" || p.status === "monitoring"));
  if (open.length === 0) return null;
  const due = open.find((p) => dueIds.includes(p.id));
  if (due) return { priority: due, reason: "Follow-up is due" };
  const unreviewed = open.find((p) => !progress[p.id] || progress[p.id].status === null);
  if (unreviewed) return { priority: unreviewed, reason: "No coach observation yet" };
  const stuck = open.find((p) => ["worse", "unchanged"].includes(progress[p.id].status));
  if (stuck) return { priority: stuck, reason: progress[stuck.id].status === "worse" ? "Reported worse" : "Not improving yet" };
  return { priority: open[0], reason: "Top priority" };
}

/** Practice reps to reference for a session-level before/after summary. */
export function summarizeGroupingChange(observations) {
  return observations.filter((o) => o.context === "practice").map((o) => o.status);
}

// ---------------------------------------------------------------------------
// Analysis quality fallback (clips processed before quality summaries existed)
// ---------------------------------------------------------------------------

/** Best-effort quality summary from data every clip already has: the phase
 * detector's own confidence and the reconstruction-reliability flags. Anything
 * we cannot know stays null (shown as "Not measured"), never guessed. */
export function deriveQualityFromPhases(phases, hasPose3d) {
  const contact = (phases ?? []).find((p) => p.slug === "contact");
  const flagged = (phases ?? []).filter((p) => p.timeS != null && p.reconstructionReliable != null);
  let reconstruction = null;
  if (!hasPose3d) reconstruction = "poor";
  else if (flagged.length) {
    const bad = flagged.filter((p) => p.reconstructionReliable === false).length;
    reconstruction = bad === 0 ? "good" : bad <= flagged.length / 2 ? "limited" : "poor";
  }
  return {
    contact_confidence: contact?.timeS == null ? "poor" : contact.confidence === "high" ? "good" : "limited",
    reconstruction,
    pose_coverage: null,
    bat_coverage: null,
    occlusion: null,
    handedness: null,
  };
}

// ---------------------------------------------------------------------------
// Longitudinal metric trends (robust metrics only)
// ---------------------------------------------------------------------------

/** 2D video estimates (or plain coverage figures) - charted over time only when the clip's own quality allows.
 * Reconstructed 3D angles (hip-shoulder separation, torso tilt, knee angle) are deliberately NOT here:
 * they are monocular estimates and a noisy series of them reads as false precision. */
export const TREND_METRICS = [
  { key: "swing_duration_s", label: "Load → contact time", unit: "s", needs: "contact" },
  { key: "max_bat_speed", label: "Bat speed (2D, body-relative)", unit: "shoulder-widths/s", needs: "bat" },
  { key: "stride_length_hip_widths", label: "Stride (2D, whole clip)", unit: "hip-widths", needs: "pose" },
  { key: "pose_coverage", label: "Pose tracking coverage", unit: "%", pct: true },
  { key: "bat_coverage", label: "Bat tracking coverage", unit: "%", pct: true },
];

/** rows: [{ date, clipId, metrics (video_clip_metrics row|null), quality (raw analysis_quality|null), loadToContactS }]
 * Returns [{ key, label, unit, points:[{date, value, clipId}], shown }] - a point is dropped when the clip's
 * own quality says the underlying detection was poor, so bad clips don't draw fake trends. */
export function robustMetricTrends(rows) {
  const ok = (r, need) => {
    const q = analysisQualityLabels(r.quality);
    if (!q) return true; // pre-quality clip: accept the 2D estimate, coverage rows just won't exist
    if (need === "bat") return q.bat !== "poor";
    if (need === "pose") return q.pose !== "poor";
    if (need === "contact") return q.contact !== "poor";
    return true;
  };
  const value = (r, m) => {
    if (m.key === "swing_duration_s") return r.loadToContactS ?? null;
    if (m.key === "max_bat_speed") return r.metrics?.max_bat_speed_full_rate_value ?? r.metrics?.max_bat_speed_value ?? null;
    if (m.key === "stride_length_hip_widths") return r.metrics?.stride_length_hip_widths ?? null;
    const v = r.quality?.[m.key];
    return v == null ? null : Math.round(v * 100);
  };
  const sorted = [...(rows ?? [])].sort((a, b) => String(a.date).localeCompare(String(b.date)));
  return TREND_METRICS.map((m) => {
    const points = sorted
      .filter((r) => ok(r, m.needs))
      .map((r) => ({ date: r.date, value: value(r, m), clipId: r.clipId }))
      .filter((p) => p.value != null && Number.isFinite(p.value));
    return { key: m.key, label: m.label, unit: m.unit, points, shown: points.length >= 2 };
  });
}
