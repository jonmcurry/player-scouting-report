import { outcomeCopy, parsePresentation, presentationCopy } from "./simplePresentation.js";
import { icon } from "./ui.js";
// Experimental v2 engine report (development-only, M5). Pure rendering from the
// `experimental` block of get-simplified-report: no network, no provider
// confidence, nothing presented as validated. Normal reports never reach here.

export const EXPERIMENTAL_LABEL = "Experimental analysis — not yet validated";
export { outcomeCopy, HIDDEN_AFTER_FEEDBACK } from "./simplePresentation.js";

const EVENT_LABELS = Object.freeze({
  stance_set: "Set-up", load_peak_estimate: "Load (estimated)", foot_plant: "Front foot down",
  impact_estimate: "Estimated hitting moment", extension: "Extension", finish: "Finish",
});
const CLAIM_LABELS = Object.freeze({ direct_observation: "Direct observation", qualified_interpretation: "Qualified interpretation" });

export const eventLabel = (event) => EVENT_LABELS[event?.id] ?? event?.label ?? "Swing moment";
export const claimLabel = (claimType) => CLAIM_LABELS[claimType] ?? "Observation";

/** Lead-in for the reasons list when some proposed observations were held back. */
export const heldBackLead = (count) => count === 1 ? "One possible observation was held back:"
  : count > 1 ? `${count} possible observations were held back:` : "Some possible observations were held back:";

/** Still waiting on the worker: refresh until it reaches a terminal outcome or the clip fails. */
export const experimentalStillPending = (data) => data.status !== "failed"
  && (data.experimental?.outcome === "processing" || ["pending", "processing"].includes(data.status));

/** Seconds into the original video for an event's own frame, or null when unknown. */
export function seekTarget(experimental, eventId) {
  const event = experimental?.events?.find((item) => item.id === eventId);
  return event && Number.isFinite(event.seekS) && event.seekS >= 0 ? event.seekS : null;
}

function seeIt(esc, experimental, eventId) {
  const at = seekTarget(experimental, eventId);
  const event = (experimental.events ?? []).find((item) => item.id === eventId);
  if (at === null || !event) return `<span class="simple-muted">${esc(eventLabel({ id: eventId }))}</span>`;
  return `<button class="simple-action secondary simple-see-it" data-see-event="${esc(eventId)}" type="button"
    aria-label="See it · ${esc(eventLabel(event))}: show this in the video">See it · ${esc(eventLabel(event))}</button>`;
}

function findingCard(esc, experimental, finding, firstName, canAct, issueCount) {
  // The read model sends cited events as objects; ids are accepted too.
  const moments = (finding.events ?? []).map((event) => seeIt(esc, experimental, typeof event === "string" ? event : event?.id)).join("");
  const claim = `<span class="simple-claim" data-claim="${esc(finding.claimType)}">${esc(claimLabel(finding.claimType))}</span>`;
  if (finding.kind === "strength") {
    return `<section class="simple-card"><h2>What looked good</h2>${claim}
      <p class="simple-strength-item">${icon("check")}<span>${esc(finding.text)}</span></p><p class="simple-muted">${esc(finding.evidence)}</p><div class="simple-actions">${moments}</div></section>`;
  }
  return `<section class="simple-card"><h2>${issueCount === 1 ? "One thing to work on" : "Something to work on"}</h2>${claim}
    <h3>${esc(finding.issue)}</h3><p>${esc(finding.evidence)}</p>
    ${finding.coachingCue ? `<p>Say to ${esc(firstName)}:</p><p class="simple-cue">“${esc(finding.coachingCue)}”</p>` : ""}
    ${finding.lookForNext ? `<p><strong>Next time, watch for:</strong> ${esc(finding.lookForNext)}</p>` : ""}
    <div class="simple-actions">${moments}${canAct && finding.id ? `<button class="simple-action secondary" data-hide-issue="${esc(finding.id)}" type="button">Doesn't look right</button>` : ""}</div></section>`;
}

/** The experimental report body. `data` is the get-simplified-report clip response. */
export function experimentalReportHtml(data, { esc, canAct = false, pendingText = "" }) {
  const experimental = data.experimental;
  const presentation = parsePresentation(data.presentation);
  const pending = presentation ? presentation.analysisState === "processing" : experimental.outcome === "processing" || ["pending", "processing"].includes(data.status);
  const outcome = pending ? "processing" : experimental.outcome;
  const findings = pending ? [] : experimental.findings ?? [];
  const issues = findings.filter((item) => item.kind === "issue");
  // Without a presentation block the client can't tell why a "findings" run shows no issue, so it
  // makes no claim at all rather than heading an empty report "What the evidence supports".
  const copy = presentation ? presentationCopy(presentation, { experimental: true, outcome, suppressedCount: experimental.suppressedCount })
    : outcomeCopy(outcome === "findings" && !issues.length ? "unavailable" : outcome, experimental.suppressedCount);
  const firstName = String(data.playerName ?? "").split(" ")[0] || "the hitter";
  const strengths = findings.filter((item) => item.kind === "strength");
  const reasons = pending ? [] : experimental.reasons ?? [];
  const events = pending ? [] : experimental.events ?? [];
  return `
    <p class="simple-experimental" role="note">${esc(EXPERIMENTAL_LABEL)}</p>
    <p id="seekAnnouncement" class="simple-sr-only" role="status" aria-live="polite"></p>
    ${copy.statusLine ? `<p class="simple-status-line" role="note">${icon("info")}<span>${esc(copy.statusLine)}</span></p>` : ""}
    <p class="simple-cue">${esc(copy.title)}</p>
    ${data.videoUrl ? `<div class="simple-video-wrap"><video id="reportVideo" class="simple-video" src="${esc(data.videoUrl)}" controls playsinline preload="metadata"></video>${seekTarget(experimental, "impact_estimate") !== null ? `<button class="simple-action link" data-action="jump-contact" type="button">Watch the swing</button>` : ""}</div>` : ""}
    <section class="simple-card"><p>${esc(copy.body)}</p>
      ${pending ? `<p id="processingProgress" class="simple-muted">${esc(pendingText)}</p>` : ""}
      ${reasons.length && experimental.suppressedCount > 0 && ["findings", "insufficient_evidence", "no_supported_issue"].includes(outcome)
        ? `<p class="simple-muted">${esc(heldBackLead(experimental.suppressedCount))}</p>` : ""}
      ${reasons.length ? `<ul class="simple-reasons">${reasons.map((reason) => `<li data-reason="${esc(reason.code)}">${esc(reason.text)}</li>`).join("")}</ul>` : ""}
      ${!pending && experimental.summary ? `<p>${esc(experimental.summary)}</p>` : ""}
      ${canAct && !pending && experimental.retryEligible ? `<button class="simple-action primary" data-action="retry-experimental" type="button">Try the analysis again</button>` : ""}</section>
    ${issues.map((item) => findingCard(esc, experimental, item, firstName, canAct, issues.length)).join("")}
    ${strengths.map((item) => findingCard(esc, experimental, item, firstName, canAct, issues.length)).join("")}
    ${events.length ? `<section class="simple-card"><h2>Swing moments</h2>
      <p class="simple-muted">Moments the experimental engine located in the original video.</p>
      <div class="simple-actions">${events.map((event) => seeIt(esc, experimental, event.id)).join("")}</div></section>` : ""}`;
}
