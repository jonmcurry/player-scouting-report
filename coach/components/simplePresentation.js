// Presentation only: no browser, transport, or database dependencies.
export const REPORT_COPY = Object.freeze({
  fixNone: "We didn't see one clear thing to work on in this swing. One video can't show everything; patterns show up over 3+ game at-bats.",
  strengthsNone: "Nothing stood out clearly enough to call out in this swing.",
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
export const HIDDEN_AFTER_FEEDBACK = "An observation from this swing was hidden after feedback.";
export const PRESENTATION_COPY = Object.freeze({
  not_confident: "We noticed something, but couldn't see it clearly enough to recommend a change.",
  hidden_after_feedback: "A suggestion from this at-bat was hidden after feedback.",
  withheld_evidence: "We couldn't check the swing mechanics well enough from this video to suggest a change.",
  limited: "Limited analysis: some possible observations were held back because the video evidence didn't support them.",
  fallbackTitle: "This report can't be shown right now",
  fallbackBody: "Try again later. The video is still here.",
});
const presentationEnums = Object.freeze({
  engine: ["baseline", "experimental_v2"],
  analysisState: ["processing", "supported_finding", "no_supported_issue", "limited", "insufficient_evidence", "unable_to_analyze", "no_swing", "technical_failure"],
  fixState: ["shown", "none_found", "not_confident", "hidden_after_feedback", "withheld_evidence", "not_applicable"],
  strengthsState: ["shown", "none_found", "not_applicable"],
  summaryState: ["shown", "replaced_after_feedback", "not_applicable"],
  familyReason: ["batter_unclear", "swing_unclear", "clip_too_short", "video_blurry", "duration_limit", "evidence_unsupported", "not_enabled", "unknown", null],
  momentLabel: ["impact_estimate", null],
});
export function parsePresentation(value) {
  try {
    if (!value || typeof value !== "object" || Array.isArray(value) || value.version !== 1
      || typeof value.engineOutcome !== "string" || !value.engineOutcome
      || typeof value.limited !== "boolean" || value.limited !== (value.analysisState === "limited")
      || !Array.isArray(value.reasonCodes) || !Array.from(value.reasonCodes).every(code => typeof code === "string")
      || Object.entries(presentationEnums).some(([key, values]) => !values.includes(value[key]))) return null;
    return Object.freeze({ version: 1, ...Object.fromEntries(Object.keys(presentationEnums).map(key => [key, value[key]])),
      engineOutcome: value.engineOutcome, limited: value.limited, reasonCodes: Object.freeze([...value.reasonCodes]) });
  } catch { return null; }
}
const captureReasons = new Set(["batter_unclear", "swing_unclear", "clip_too_short", "video_blurry"]);
export function presentationCopy(value, { experimental = false, outcome, suppressedCount = 0 } = {}) {
  const p = parsePresentation(value);
  if (!p) return { title: PRESENTATION_COPY.fallbackTitle, body: PRESENTATION_COPY.fallbackBody };
  const statusLine = p.limited ? PRESENTATION_COPY.limited : null;
  if (experimental) {
    const original = outcome ?? p.engineOutcome;
    if (original === "findings" && p.fixState === "hidden_after_feedback") return {
      title: "An observation was hidden after feedback", body: HIDDEN_AFTER_FEEDBACK, statusLine };
    if (original === "findings" && p.fixState === "withheld_evidence") return {
      title: "Not enough evidence to show a finding", body: "A possible observation couldn't be shown because the swing moment it cited isn't available.", statusLine };
    return { ...outcomeCopy(original, suppressedCount), statusLine };
  }
  const reason = ({ batter_unclear: REPORT_COPY.batter, swing_unclear: REPORT_COPY.swing,
    clip_too_short: REPORT_COPY.short, video_blurry: REPORT_COPY.blurry, duration_limit: REPORT_COPY.duration })[p.familyReason];
  switch (p.analysisState) {
    case "processing": return { title: "Analyzing…", body: "", statusLine };
    case "no_swing": return { title: "No swing to analyze in this at-bat.", body: "This at-bat stays in the feed. The result choice did not decide whether a swing happened.", statusLine };
    case "technical_failure": return { title: REPORT_COPY.technicalTitle, body: REPORT_COPY.technicalReason, statusLine };
    case "insufficient_evidence":
    case "unable_to_analyze": return { title: p.familyReason === "duration_limit" ? REPORT_COPY.durationTitle : REPORT_COPY.unavailableTitle,
      body: reason ?? REPORT_COPY.unavailableReason, statusLine };
    default: return { title: "One thing to work on", body: p.fixState === "none_found" ? REPORT_COPY.fixNone : PRESENTATION_COPY[p.fixState] ?? "", statusLine };
  }
}
export function unavailablePresentation(value) {
  const p = parsePresentation(value?.presentation ?? value);
  const copy = presentationCopy(p);
  const showFilmingTip = p?.analysisState === "insufficient_evidence"
    || (p?.analysisState === "unable_to_analyze" && captureReasons.has(p.familyReason));
  return { kind: showFilmingTip ? "unavailable_evidence" : "failed_technical", title: copy.title, reason: copy.body, showFilmingTip };
}

/** Existing experimental wording, shared here to keep copy dependencies acyclic. */
export function outcomeCopy(outcome, suppressedCount = 0) {
  switch (outcome) {
    case "processing": return { title: "Analyzing…", body: "The experimental engine is still working on this swing." };
    case "findings": return { title: "What the evidence supports", body: "Only observations tied to a specific swing moment are shown." };
    case "no_supported_issue": return { title: "No supported coaching issue",
      body: "The analysis didn't find a coaching issue it could support from this video. That isn't a verified clean swing." };
    case "insufficient_evidence": return { title: "Not enough evidence to show a finding",
      body: `${suppressedCount === 1 ? "A possible observation was" : "Possible observations were"} held back because the video evidence wasn't strong enough. This isn't a verified clean swing.` };
    case "withheld": return { title: "Analysis withheld",
      body: "The coaching analysis made a claim the video evidence can't support, so nothing from it is shown." };
    case "not_assessable": return { title: "This swing couldn't be assessed", body: "Here's what got in the way:" };
    case "analysis_not_enabled": return { title: "Swing moments found",
      body: "Coaching analysis is turned off for this experimental build, so only the detected swing moments are shown." };
    case "analysis_failed": return { title: "The experimental analysis didn't finish", body: "Something went wrong while analyzing this swing." };
    default: return { title: "Experimental analysis unavailable", body: "This swing's experimental result can't be shown." };
  }
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


export function shareLinkState(link, now) {
  if (link.revoked_at) return "turned_off";
  return link.expires_at && new Date(link.expires_at).getTime() <= new Date(now).getTime() ? "expired" : "active";
}
export function shareLinkRows(links, now, formatDate) {
  return (links ?? []).map((link) => {
    const state = shareLinkState(link, now);
    const date = link.video_clips?.game_log_entries?.date;
    const title = `${link.share_scope === "progress" ? "Progress" : "At-bat report"} · ${link.players?.name || "Unknown player"}${link.share_scope === "report" && date ? ` · ${formatDate(date)}` : ""}`;
    const supporting = state === "turned_off" ? `Turned off ${formatDate(link.revoked_at)}`
      : state === "expired" ? `Expired ${formatDate(link.expires_at)}`
      : `Shared ${formatDate(link.created_at)} · Expires ${formatDate(link.expires_at)}`;
    return { id: link.id, state, title, supporting, chip: { label: state === "active" ? "Active" : state === "expired" ? "Expired" : "Turned off", tone: state === "active" ? "success" : "neutral" } };
  });
}
/** Player age bands (players.age_band) with the labels shown in forms and summaries. */
export const AGE_BAND_LABELS = Object.freeze({ u8: "Under 8", "8-10": "8–10", "11-12": "11–12", "13-14": "13–14", "15-18": "15–18", adult: "Adult" });
export function playerDetailsSummary(player) {
  const age = AGE_BAND_LABELS[player.age_band];
  const bats = ({ L: "left", R: "right", S: "switch" })[player.bats];
  const throws = ({ L: "left", R: "right" })[player.throws];
  return [`#${player.jersey_number || "–"}`, age ? `Age ${age}` : "Age band unknown", bats ? `Bats ${bats}` : "Bats unknown", throws ? `Throws ${throws}` : "Throws unknown"].join(" · ");
}
