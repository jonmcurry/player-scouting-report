// Pure rendering helpers for coach/family.html - the parent/guardian page.
//
// Families see only what the coach confirmed (get-family-report's payload:
// coach-reviewed Priorities, Drills, progress checks and findings, plus each
// clip's review status). Nothing here reads or renders AI drafts, checklist
// scores or swing metrics, and status copy never credits an automated finding,
// says "issue" or shows a score. Copy is for parents and kids: plain, short and kind.
import { button, emptyState, icon } from "./ui.js";

function esc(value) {
  return String(value ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

const STATUS_COPY = Object.freeze({
  // detail "" = chip only (the list stays scannable); failed and awaiting_coach keep a line.
  processing: { label: "Processing", detail: "", tone: "neutral" },
  failed: {
    label: "Couldn't analyze — try filming closer",
    detail: "We couldn't see the swing clearly. Film from the side, closer, with the whole body and bat in frame.",
    tone: "warning",
  },
  // An analysis ran and flagged nothing. The family label claims nothing about the swing
  // (never a clean bill of health); the coach page keeps its own label (clipReviewState.js).
  analyzed: { label: "Sent to your coach", detail: "", tone: "muted" },
  awaiting_coach: { label: "Waiting for coach", detail: "Your coach will look at this swing.", tone: "neutral" },
  reviewed: { label: "Coach reviewed", detail: "Your coach looked at this swing.", tone: "success" },
});

/** Family wording for a clip review state (clipReviewState.js). Unknown states fail closed to "Processing". */
export function clipStatusCopy(status) {
  const copy = STATUS_COPY[status] ?? STATUS_COPY.processing;
  return { label: copy.label, detail: copy.detail, tone: copy.tone };
}

function statusChipHtml(status) {
  const { label, tone } = clipStatusCopy(status);
  return `<span class="bt-status-chip bt-status-${tone}" data-status="${esc(status)}"><span>${esc(label)}</span></span>`;
}

/** Notes the coach reviewed whose video is gone (or that never had one). */
function notesWithoutVideo(report) {
  return (report?.findings ?? []).filter((finding) => !finding.clipId);
}

/** The "Your swings" empty state, or "" when there is something to list. */
export function familyEmptyState(report) {
  if ((report?.clips ?? []).length || notesWithoutVideo(report).length) return "";
  return emptyState("No swings yet", "Send a swing and it will show up here.", "", "video");
}

const NO_PRIORITY_DEFAULT_NEXT = "The most useful next video shows the whole body and the bat all the way through contact.";

/** "What to work on": the coach's current Priority, its Drill and the latest progress check - or the
 * report's no-Priority card. Nothing is claimed that the coach didn't record. */
export function focusSection(report) {
  const priorities = report?.priorities ?? [];
  const focus = priorities.find((p) => p.status !== "resolved") ?? null;
  const heading = '<h2 class="hl-family-heading">What to work on</h2>';
  if (!focus) {
    // Same copy as report.html's no-Priority card: no Priority, Drill or progress is claimed.
    return `<section class="hl-family-section" aria-labelledby="hlWork">${heading.replace("<h2", '<h2 id="hlWork"')}
      <div class="bt-card bt-report-next"><h3>Your coach hasn’t picked a Priority yet.</h3><p>${esc(report?.nextStep || NO_PRIORITY_DEFAULT_NEXT)}</p><p class="bt-supporting">A Priority is the one thing to work on next. Once your coach picks one, the Drill and progress show up here.</p></div></section>`;
  }
  const drill = focus.drills?.[0] ?? null;
  const latest = focus.progress?.[0] ?? null;
  const drillHtml = drill
    ? `<h3>${esc(drill.name)}</h3>${drill.purpose ? `<p>${esc(drill.purpose)}</p>` : ""}${drill.instructions || drill.equipment || drill.coachNote
      ? `<details class="bt-disclosure"><summary><span>How to do it</span><span class="bt-disclosure-chevron">${icon("chevron-down", { size: 20 })}</span></summary><div class="bt-disclosure-body">${drill.instructions ? `<p>${esc(drill.instructions)}</p>` : ""}${drill.equipment ? `<p><strong>Equipment:</strong> ${esc(drill.equipment)}</p>` : ""}${drill.coachNote ? `<p><strong>Coach:</strong> “${esc(drill.coachNote)}”</p>` : ""}</div></details>`
      : ""}`
    : "<h3>No Drill picked yet.</h3><p>Your coach chooses a Drill for this Priority.</p>";
  const progressHtml = latest
    ? `<p><time>${esc(latest.date)}</time> · <strong>${esc(latest.label)}</strong></p>${latest.note ? `<p>“${esc(latest.note)}”</p>` : ""}`
    : "<p>No progress check yet. It shows up here after your coach checks a later swing against this Priority.</p>";
  return `<section class="hl-family-section" aria-labelledby="hlWork"><h2 class="hl-family-heading" id="hlWork">What to work on</h2>
    <div class="bt-card bt-report-focus"><span class="bt-eyebrow">Priority</span><div class="bt-report-title-row"><h3>${esc(focus.title)}</h3><span class="bt-public-status">${esc(focus.statusLabel)}</span></div>${focus.why ? `<p>${esc(focus.why)}</p>` : ""}${focus.nextCheck ? `<p class="bt-supporting">${esc(focus.nextCheck)}</p>` : ""}</div>
    <div class="bt-card"><span class="bt-eyebrow">Drill</span>${drillHtml}</div>
    <div class="bt-card"><span class="bt-eyebrow">Latest progress check</span>${progressHtml}</div></section>`;
}

function findingHtml(finding) {
  return `<li><strong>${esc(finding.title)}</strong>${finding.likelyCause ? `<p><span class="bt-supporting">Why it happens:</span> ${esc(finding.likelyCause)}</p>` : ""}${finding.effect ? `<p><span class="bt-supporting">What it changes:</span> ${esc(finding.effect)}</p>` : ""}</li>`;
}

/** The coach's reviewed notes for one clip (read-only player). */
export function coachNotes(report, clipId) {
  const notes = (report?.findings ?? []).filter((finding) => finding.clipId && finding.clipId === clipId);
  if (!notes.length) return "<p>Your coach didn’t leave notes on this swing.</p>";
  return `<ul class="hl-coach-notes">${notes.map(findingHtml).join("")}</ul>`;
}

const REMOVED_COPY = { family: "Video removed by family", coach: "Video removed by coach" };
const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

export const SWINGS_INTRO = "Your coach reviews swings when they can. Only notes your coach has reviewed appear on this page.";

/** "2026-09-19" -> "Sep 19" (adds the year when it isn't the current one). */
export function formatSwingDay(isoDate, today = new Date()) {
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(String(isoDate ?? ""));
  if (!m) return String(isoDate ?? "");
  const [year, month, day] = [Number(m[1]), Number(m[2]), Number(m[3])];
  const label = `${MONTHS[month - 1] ?? m[2]} ${day}`;
  return year === today.getFullYear() ? label : `${label}, ${year}`;
}

/** Shown on the parent's own upload whose delete failed part-way (get-family-report deleteUnfinished). */
export const DELETE_UNFINISHED_COPY = Object.freeze({
  label: "Deleting didn’t finish",
  detail: "This video wasn’t fully removed yet. Tap Try again to finish deleting it.",
});

function unfinishedDeleteRow(clip) {
  const day = esc(formatSwingDay(clip.recordedAt));
  return `<li class="hl-swing" data-delete-unfinished="true"><div class="hl-swing-top"><span class="bt-status-chip bt-status-warning" data-status="delete_unfinished"><span>${esc(DELETE_UNFINISHED_COPY.label)}</span></span></div><p class="hl-swing-detail">${esc(DELETE_UNFINISHED_COPY.detail)}</p><div class="hl-swing-actions">${button("Try again", { variant: "secondary", iconName: "trash-2", attrs: `data-retry-delete="${esc(clip.id)}" aria-label="Try deleting this video from ${day} again"` })}</div></li>`;
}

function swingRow(clip) {
  // A delete of the parent's own upload that failed part-way: no Watch (the video is on its way
  // out and get-video-url refuses it), just the retry. Only ever the viewer's own upload.
  if (clip.deleteUnfinished === true && clip.uploadedByYou === true) return unfinishedDeleteRow(clip);
  const { detail } = clipStatusCopy(clip.status);
  const actions = [
    clip.status === "reviewed" ? button("Watch with coach’s notes", { variant: "secondary", iconName: "video", attrs: `data-open-clip="${esc(clip.id)}"` }) : "",
    clip.uploadedByYou ? button("Delete", { variant: "tertiary", iconName: "trash-2", attrs: `data-delete-clip="${esc(clip.id)}" aria-label="Delete this video from ${esc(formatSwingDay(clip.recordedAt))}"` }) : "",
  ].filter(Boolean).join("");
  return `<li class="hl-swing"><div class="hl-swing-top">${statusChipHtml(clip.status)}</div>${detail ? `<p class="hl-swing-detail">${esc(detail)}</p>` : ""}${actions ? `<div class="hl-swing-actions">${actions}</div>` : ""}</li>`;
}

/** "Your swings": one intro line, then clips grouped by day ("Sep 19 · 5 swings"), each with a status
 * chip; reviewed notes whose video is gone come last. Clips arrive newest first (get-family-report). */
export function swingsList(report, today = new Date()) {
  const groups = [];
  for (const clip of report?.clips ?? []) {
    const last = groups.at(-1);
    if (last && last.date === clip.recordedAt) last.clips.push(clip);
    else groups.push({ date: clip.recordedAt, clips: [clip] });
  }
  const parts = groups.map((group) => `<li class="hl-swing-day"><h3 class="hl-swing-day-head">${esc(formatSwingDay(group.date, today))} · ${group.clips.length} swing${group.clips.length === 1 ? "" : "s"}</h3><ul class="hl-swings">${group.clips.map(swingRow).join("")}</ul></li>`);
  const orphans = notesWithoutVideo(report);
  if (orphans.length) {
    const rows = orphans.map((finding) => {
      const removed = REMOVED_COPY[finding.videoRemovedBy] ?? "No video with this note";
      return `<li class="hl-swing"><div class="hl-swing-top">${statusChipHtml("reviewed")}<span class="hl-swing-removed">${esc(removed)}</span></div><ul class="hl-coach-notes">${findingHtml(finding)}</ul></li>`;
    }).join("");
    parts.push(`<li class="hl-swing-day"><h3 class="hl-swing-day-head">Coach notes without a video</h3><ul class="hl-swings">${rows}</ul></li>`);
  }
  if (!parts.length) return "";
  return `<p class="hl-swings-intro">${esc(SWINGS_INTRO)}</p><ul class="hl-swing-days">${parts.join("")}</ul>`;
}

/** "Emily Carter" -> "Emily". */
export function firstName(name) {
  return String(name ?? "").trim().split(/\s+/)[0] ?? "";
}

/** Consent text v1, verbatim; {player} is the child's first name (guardian_invite_preview).
 * There is no unnamed form: without a name the consent is not shown at all. */
export function consentText(player) {
  const p = String(player ?? "").trim();
  if (!p) throw new Error("consentText needs the child's first name");
  return `I'm the parent or legal guardian of ${p}. I agree that videos I or ${p}'s coaches upload are stored by HitterLoop and analyzed by automated tools, including AI models from third-party providers, to draft notes for the coach. The coach decides what goes on ${p}'s plan; automated drafts are never shown to me as conclusions. Only ${p}'s coaches and linked parents can see these videos. They are never published publicly without my separate written permission. I can delete any video I uploaded at any time, and I can unlink myself from ${p} at any time.`;
}

/** accept_guardian_invite error -> a friendly message (never the raw database text). */
export function inviteErrorMessage(message) {
  const m = String(message ?? "");
  if (/expired/.test(m)) return "This invite has expired. Ask your coach for a new link.";
  if (/already used/.test(m)) return "This invite has already been used. If that was you, your family page is below. Otherwise, ask your coach for a new link.";
  if (/revoked/.test(m)) return "This invite is no longer active. Ask your coach for a new link.";
  if (/cannot accept a guardian invite/.test(m)) return "You coach this team, so you can't accept a parent invite with this account.";
  if (/consent version/.test(m)) return "The consent text was updated. Please reload the page and try again.";
  if (/invalid invite/.test(m)) return "This invite link isn't valid. Ask your coach for a new link.";
  if (/not allowed|not authenticated/.test(m)) return "Please sign in with your own account to accept this invite.";
  return "Something went wrong. Please try again.";
}

/** Where index.html may send a family after sign-in: this app's family page only (no open redirect). */
export function familyReturnPath(next) {
  return typeof next === "string" && /^\.\/family\.html(\?invite=[0-9a-f]{16,128})?$/i.test(next) ? next : null;
}

/** YYYY-MM-DD in the device's own time zone (the day the family filmed it). */
export function localDateString(date = new Date()) {
  const pad = (n) => String(n).padStart(2, "0");
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
}

/** Upload failure -> a friendly message. The demo's own "uploads are disabled" text is already plain. */
export function uploadErrorMessage(message) {
  const m = String(message ?? "");
  if (/rate limited/.test(m)) return "You've sent the most swings allowed for today. Try again tomorrow.";
  if (/disabled in this demo/.test(m)) return m;
  return "The swing didn't send. Check your connection and try again.";
}

/** delete-clip HTTP status -> a friendly message. 409 is a server-side hold (e.g. a published demo). */
export function deleteErrorMessage(status) {
  if (status === 403) return "You can only delete videos you sent.";
  if (status === 409) return "This video can't be deleted right now. Ask your coach for help.";
  return "Couldn't delete the video. Please try again.";
}

/** guardian_invite_preview returned null: one message for every reason (the RPC doesn't say which). */
export const INVITE_UNAVAILABLE = "This invite link can't be used. It may have expired or already been used. Ask your coach for a new link.";

// ---- "Unlink me" (guardian-initiated). A coach removing a parent leaves that parent's videos with
// the team; a parent unlinking themselves chooses. delete-clip needs the link, so own uploads are
// deleted first and the link is removed only after every delete succeeds.

export const UNLINK_QUESTION = "Delete the videos you uploaded, or leave them with the team?";

/** The clips this account sent for the child (get-family-report's uploadedByYou), including any whose
 * earlier delete didn't finish (deleteUnfinished) - "Delete my videos" retries those too. */
export function ownUploadIds(report) {
  return (report?.clips ?? []).filter((clip) => clip.uploadedByYou === true).map((clip) => clip.id);
}

/** Bottom-sheet content when the parent has uploads: the plain question and both choices. */
export function unlinkSheet(player, uploadCount) {
  const videos = `${uploadCount} video${uploadCount === 1 ? "" : "s"}`;
  return {
    title: `Unlink from ${player}?`,
    bodyHtml: `<p>You'll stop seeing ${esc(player)}'s page. Your coach can send a new invite later.</p><p>You sent ${videos}. ${esc(UNLINK_QUESTION)}</p><p class="bt-supporting">Notes your coach already wrote stay either way.</p>`,
    footerHtml: `<div class="hl-unlink-actions">${button("Leave them with the team", { variant: "secondary", attrs: 'data-unlink-choice="keep"' })}${button("Delete my videos", { variant: "destructive", attrs: 'data-unlink-choice="delete"' })}</div>`,
  };
}

/** confirmDialog options when the parent has no uploads. */
export function unlinkConfirm(player) {
  return {
    title: `Unlink from ${player}?`,
    message: `You'll stop seeing ${player}'s page. Your coach can send a new invite later.`,
    confirmLabel: "Unlink",
    destructive: true,
  };
}

export function unlinkDoneMessage(player) {
  return `You're unlinked from ${player}.`;
}

export function unlinkDeleteFailedMessage(failed) {
  return `${failed} video${failed === 1 ? "" : "s"} couldn't be deleted, so you're still linked. Please try again.`;
}
