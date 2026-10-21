// Presentation only: no browser, transport, or database dependencies.
export const REPORT_COPY = Object.freeze({
  fixNone: "We didn't see one clear thing to work on in this swing. One video can't show everything; patterns show up over 3+ game at-bats.",
  strengthsNone: "Nothing stood out clearly enough to call out in this swing.",
  momentButton: "Watch the swing",
  momentMarker: "Estimated hitting moment",
  unavailableTitle: "We couldn't analyze this swing",
  durationTitle: "We couldn't analyze this video",
  technicalTitle: "Something went wrong on our side.",
  technicalReason: "We couldn't finish analyzing this video.",
  unavailableReason: "We couldn't analyze this video.",
  batter: "We couldn't find the batter clearly.",
  swing: "We couldn't find a swing in this clip. If it was a take or walk, there's no swing to analyze.",
  short: "This clip was too short to see the swing.",
  blurry: "The video was too blurry to see the swing clearly.",
  duration: "This video was longer than the 3-minute limit.",
  offline: "You're offline. Reports will load when you reconnect.",
  signIn: "Please sign in again.",
  sharedMissing: "This link has expired or was turned off. Ask the person who sent it for a new one.",
  missing: "This isn't available. It may have been deleted or the link turned off.",
  trouble: "HitterLoop is having trouble right now. Try again in a minute.",
});
export const fixNoneCopy = () => REPORT_COPY.fixNone;
export const strengthsNoneCopy = () => REPORT_COPY.strengthsNone;
export const momentLabels = Object.freeze({ button: REPORT_COPY.momentButton, marker: REPORT_COPY.momentMarker });
const captureReasons = new Set([REPORT_COPY.batter, REPORT_COPY.swing, REPORT_COPY.short, REPORT_COPY.blurry]);

export function unavailablePresentation({ status, report }) {
  const reason = report?.reason;
  if (status === "failed" && !captureReasons.has(reason)) {
    return { kind: "failed_technical", title: reason === REPORT_COPY.duration ? REPORT_COPY.durationTitle : REPORT_COPY.technicalTitle,
      reason: reason === REPORT_COPY.duration ? reason : REPORT_COPY.technicalReason, showFilmingTip: false };
  }
  return { kind: "unavailable_evidence", title: REPORT_COPY.unavailableTitle,
    reason: reason || REPORT_COPY.unavailableReason, showFilmingTip: true };
}

const httpStatus = (value) => Number.isInteger(value) && value >= 100 && value <= 599 ? value : null;
export async function describeFunctionsError(error) {
  const status = httpStatus(error?.context?.status);
  let bodyError;
  try {
    const context = error?.context;
    const body = await (context?.clone ? context.clone() : context)?.json?.();
    if (typeof body?.error === "string") bodyError = body.error;
  } catch { /* An unreadable response must never replace the safe fallback. */ }
  return { status, bodyError };
}

export function userErrorMessage(error, { shared = false, online = true, status, bodyError, transport = false } = {}) {
  const name = error?.name;
  const message = typeof error?.message === "string" ? error.message : "";
  if (!online || name === "FunctionsFetchError" || (name === "TypeError" && /Failed to fetch|Load failed/i.test(message))) return REPORT_COPY.offline;
  const code = httpStatus(status) ?? httpStatus(error?.context?.status) ?? httpStatus(error?.status);
  if (code === 401) return REPORT_COPY.signIn;
  if (code === 404) return shared ? REPORT_COPY.sharedMissing : REPORT_COPY.missing;
  if (code >= 500 || name === "FunctionsRelayError") return REPORT_COPY.trouble;
  // Only approved copy may cross the API boundary, never arbitrary response text.
  const allowed = [REPORT_COPY.signIn, REPORT_COPY.missing, REPORT_COPY.sharedMissing, REPORT_COPY.trouble];
  if (allowed.includes(bodyError)) return bodyError;
  if (/Edge Function|Failed to fetch|fetch failed|NetworkError|non-2xx/i.test(message)
    || (error && "code" in Object(error) && "details" in Object(error))) return REPORT_COPY.trouble;
  if (name === "FunctionsHttpError" || code || (name && name !== "Error")) return REPORT_COPY.trouble;
  if (!transport && error instanceof Error && message) return message;
  return REPORT_COPY.trouble;
}

export function reportFetchFailure({ status } = {}) {
  return { functionName: "get-simplified-report", status: httpStatus(status) };
}

/** Public links must never target a device, LAN address or an arbitrary path. */
export function publicAppLink(origin, page, params = {}) {
  if (typeof origin !== "string" || !origin.trim() || !["simple.html", "family.html"].includes(page)) return null;
  try {
    const base = new URL(origin);
    const host = base.hostname.toLowerCase().replace(/\.$/, "");
    const labels = host.split(".");
    if (base.protocol !== "https:" || base.username || base.password || base.pathname !== "/"
      || base.search || base.hash || origin.includes("?") || origin.includes("#")
      || labels.length < 2 || host.length > 253
      || labels.some((label) => !/^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/.test(label))
      || /^[0-9.]+$/.test(host) || /(?:^|\.)(?:localhost|local|internal)$/.test(host)) return null;
    const url = new URL(page, base.origin + "/");
    url.search = new URLSearchParams(params).toString();
    return url.href;
  } catch { return null; }
}

/** Colour never implies improvement for neutral or unknown statuses. */
export function progressTone(status) {
  return status === "improving" || status === "looks_fixed" ? "success" : "neutral";
}
/** Labels for the server's visible progress statuses (progressView.ts storedProgress). */
export function progressLabel(status) {
  return ({ improving: "Improving", looks_fixed: "Looks fixed", early_read: "Early read",
    checking: "Checking", still_showing: "Still showing up" })[status] ?? "No clear pattern";
}

/** Latest game entry only; focus remains owned by the server's Progress read. */
/** formatDate defaults to a fixed format for tests; the app passes its device-locale shortDate. */
export function rosterSummary(players, entries, formatDate = (value) => new Date(`${value}T12:00:00`).toLocaleDateString("en-US", { month: "short", day: "numeric" })) {
  const latest = new Map();
  for (const entry of entries ?? []) {
    if (entry.session_type === "practice") continue;
    if (!latest.has(entry.player_id) || entry.date > latest.get(entry.player_id).date) latest.set(entry.player_id, entry);
  }
  return Object.fromEntries(players.map(({ id }) => {
    const entry = latest.get(id);
    const clips = (entry?.video_clips ?? []).filter((clip) => clip.status !== "deletion_pending");
    const status = clips.some((clip) => ["pending", "processing"].includes(clip.status))
      ? { label: "Analyzing", tone: "neutral" }
      : clips.length && clips.every((clip) => ["failed", "unreadable"].includes(clip.status))
        ? { label: "Couldn't analyze", tone: "warning" } : null;
    return [id, { text: entry?.date ? `Last at-bat ${formatDate(entry.date)}` : "No at-bats yet", status }];
  }));
}
