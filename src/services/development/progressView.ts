import { advanceFocus, type FocusRecord, type FocusResult, type ReadableSwing } from "./focus.ts";

export type StoredProgress = Omit<FocusResult, "status"> & { status: FocusResult["status"] | "checking" };

/** Present persisted transitions. Recent evidence can withhold a stale claim while a writer catches up. */
export function storedProgress(
  current: FocusRecord | null, history: FocusRecord[], computed: FocusResult,
  swings: ReadableSwing[], latestSerial: number,
): StoredProgress {
  if (current) {
    if (computed.status === "early_read") return { current, history, status: "early_read", seen: computed.seen, windowSize: computed.windowSize };
    const storedStatus = current.status === "improving" ? "improving" : "still_showing";
    const agrees = computed.current?.concept === current.concept && computed.status === storedStatus;
    return { current, history, status: agrees ? storedStatus : "checking",
      seen: agrees ? computed.seen : 0, windowSize: computed.windowSize };
  }
  if (computed.current) return { current: null, history, status: "checking", seen: 0, windowSize: computed.windowSize };
  const last = history[0];
  if (last?.status === "fixed") {
    const prior = history.slice(1);
    const confirmed = advanceFocus(swings, { ...last, status: "active", endedAt: null }, prior, latestSerial);
    if (confirmed.status === "looks_fixed") return { current: null, history, status: "looks_fixed", seen: 0, windowSize: confirmed.windowSize };
  }
  return { current: null, history, status: computed.status === "early_read" ? "early_read" : "no_pattern",
    seen: 0, windowSize: computed.windowSize };
}
