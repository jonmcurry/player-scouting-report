/** Deterministic player focus from readable game swings. No database or AI calls. */
export const NON_MECHANICAL = new Set(["swing_decision", "pitch_location_adjustment", "game_approach"]);
export const PHASE_ORDER = ["stance", "load", "stride", "contact", "extension", "follow_through"] as const;

export interface Finding {
  id: string;
  concept: string;
  phase: string | null;
  basis: string;
  confidence: string | null;
  contextExplainsIt: boolean;
  emergencySwingSuspected: boolean;
  hidden: boolean;
}
export interface ReadableSwing {
  id: string;
  serial: number; // stable, increasing sequence of completed readable game swings
  date: string;
  sessionType: "game" | "practice";
  readable: boolean;
  findings: Finding[];
}
export interface FocusRecord {
  concept: string;
  status: "active" | "improving" | "fixed" | "dismissed";
  startedAt: string;
  endedAt: string | null;
  qualifiedAtSerial: number;
  dismissedAtSerial: number | null;
  dismissedBy: string | null;
}
export interface FocusResult { current: FocusRecord | null; history: FocusRecord[]; status: "early_read" | "no_pattern" | "still_showing" | "improving" | "looks_fixed"; seen: number; windowSize: number }

export function mechanicalFinding(f: Finding): boolean {
  return !f.hidden && f.basis === "video" && !NON_MECHANICAL.has(f.concept) && !!f.concept && !f.contextExplainsIt && !f.emergencySwingSuspected;
}

export function shownFix(findings: Finding[], qualityPassed: boolean, currentConcept: string | null): Finding | null {
  if (!qualityPassed) return null;
  const eligible = findings.filter((f) => mechanicalFinding(f) && f.confidence === "medium");
  const phaseRank = (phase: string | null) => {
    const index = PHASE_ORDER.indexOf(phase as typeof PHASE_ORDER[number]);
    return index < 0 ? PHASE_ORDER.length : index;
  };
  eligible.sort((a, b) => Number(b.concept === currentConcept) - Number(a.concept === currentConcept)
    || phaseRank(a.phase) - phaseRank(b.phase)
    || a.id.localeCompare(b.id));
  return eligible[0] ?? null;
}

function visibleConcepts(swing: ReadableSwing): Set<string> {
  return new Set(swing.findings.filter(mechanicalFinding).map((f) => f.concept));
}

/** Callers pass recent swings, stored focus history, and the persistent serial counter. */
export function advanceFocus(swings: ReadableSwing[], current: FocusRecord | null, history: FocusRecord[], latestKnownSerial = 0): FocusResult {
  const game = swings.filter((s) => s.readable && s.sessionType === "game").sort((a, b) => a.serial - b.serial || a.id.localeCompare(b.id));
  const latest = game.at(-1);
  const lastSerial = Math.max(latest?.serial ?? 0, latestKnownSerial);
  // Deleted swings leave gaps in the stable sequence. Never fill a missing
  // place in the latest five with an older swing.
  const window = game.filter((s) => s.serial > lastSerial - 5);
  const now = latest?.date ?? "";
  const counts = new Map<string, number>();
  for (const swing of window) for (const concept of visibleConcepts(swing)) counts.set(concept, (counts.get(concept) ?? 0) + 1);
  const excluded = (concept: string) => history.some((h) => h.concept === concept && h.status === "dismissed" && h.dismissedAtSerial !== null && lastSerial <= h.dismissedAtSerial + 6);
  const seen = current ? counts.get(current.concept) ?? 0 : 0;
  if (current) {
    // Retained evidence can shrink after deletion. Keep the historical focus,
    // but do not claim improvement from fewer than three readable clips.
    if (window.length < 3) return { current, history, status: "early_read", seen, windowSize: window.length };
    const lastFour = window.filter((s) => s.serial > lastSerial - 4);
    const disputed = window.some((s) => s.findings.some((f) => f.concept === current.concept && f.hidden));
    const lastFourDisputed = lastFour.some((s) => s.findings.some((f) => f.concept === current.concept && f.hidden));
    if (lastFour.length === 4 && !lastFourDisputed && lastFour.every((s) => !visibleConcepts(s).has(current.concept))) {
      const fixed: FocusRecord = { ...current, status: "fixed", endedAt: now };
      const next = advanceFocus(swings, null, [...history, fixed], lastSerial);
      return { ...next, history: next.history, status: next.current ? next.status : "looks_fixed" };
    }
    if (window.length < Math.min(5, lastSerial) || disputed) {
      return { current, history, status: "early_read", seen, windowSize: window.length };
    }
    const status = seen <= 2 ? "improving" : "still_showing";
    return { current: { ...current, status: status === "improving" ? "improving" : "active" }, history, status, seen, windowSize: window.length };
  }
  if (window.length < 3) return { current: null, history, status: "early_read", seen: 0, windowSize: window.length };
  const candidate = [...counts].filter(([concept, count]) => count >= 3 && !excluded(concept))
    .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))[0];
  if (!candidate) return { current: null, history, status: "no_pattern", seen: 0, windowSize: window.length };
  const focus: FocusRecord = { concept: candidate[0], status: "active", startedAt: now, endedAt: null, qualifiedAtSerial: latest!.serial, dismissedAtSerial: null, dismissedBy: null };
  return { current: focus, history, status: "still_showing", seen: candidate[1], windowSize: window.length };
}

export function dismissFocus(current: FocusRecord, actorId: string, lastGameSerial: number, at: string): FocusRecord {
  return { ...current, status: "dismissed", endedAt: at, dismissedAtSerial: lastGameSerial, dismissedBy: actorId };
}
