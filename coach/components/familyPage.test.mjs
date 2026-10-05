// Pure helpers behind coach/family.html (the parent-facing page). Families
// see only what the coach confirmed: no AI drafts, scores or metrics.
import test from "node:test";
import assert from "node:assert/strict";
import {
  clipStatusCopy, familyEmptyState, focusSection, swingsList, coachNotes, consentText,
  firstName, inviteErrorMessage, familyReturnPath, localDateString, formatSwingDay, SWINGS_INTRO, INVITE_UNAVAILABLE,
} from "./familyPage.js";

const STATUSES = ["processing", "failed", "analyzed", "awaiting_coach", "reviewed"];

test("clip status copy uses the family wording", () => {
  assert.equal(clipStatusCopy("awaiting_coach").label, "Waiting for coach");
  assert.equal(clipStatusCopy("processing").label, "Processing");
  assert.equal(clipStatusCopy("failed").label, "Couldn't analyze — try filming closer");
  assert.equal(clipStatusCopy("analyzed").label, "Sent to your coach");
  assert.equal(clipStatusCopy("reviewed").label, "Coach reviewed");
  assert.deepEqual(clipStatusCopy("failed", "duration_limit"), {
    label: "Video was too long",
    detail: "Choose a video that is 3 minutes or shorter.",
    tone: "warning",
  });
});

test("no status copy mentions 'AI found', 'issue', or a score", () => {
  for (const s of [...STATUSES, "something-new", undefined]) {
    const { label, detail } = clipStatusCopy(s);
    for (const text of [label, detail]) {
      assert.equal(typeof text, "string");
      assert.doesNotMatch(text, /AI found|issue|score|\d/i, `${s}: ${text}`);
    }
  }
});

test("an unknown status fails closed to 'Processing' (claims nothing)", () => {
  assert.equal(clipStatusCopy("bogus").label, "Processing");
});

test("'analyzed' claims nothing about the swing: no clean bill of health, no review", () => {
  const { label, detail } = clipStatusCopy("analyzed");
  assert.equal(label, "Sent to your coach");
  assert.doesNotMatch(`${label} ${detail}`, /analy|flagged|nothing|looks good|great|perfect|no problems|review/i);
});

test("scannable list: chip only for analyzed and processing; failed and awaiting keep a line", () => {
  assert.equal(clipStatusCopy("analyzed").detail, "");
  assert.equal(clipStatusCopy("processing").detail, "");
  assert.match(clipStatusCopy("failed").detail, /Film from the side/);
  assert.ok(clipStatusCopy("awaiting_coach").detail.length > 0);
});

test("duration-limit failure uses the safe server classification instead of filming advice", () => {
  const html = swingsList({ clips: [{
    id: "long", recordedAt: "2026-10-01", status: "failed", failureReason: "duration_limit", uploadedByYou: true,
  }], findings: [] });
  assert.match(html, /Video was too long/);
  assert.match(html, /3 minutes or shorter/);
  assert.doesNotMatch(html, /filming closer|Film from the side/);
});

const base = { playerName: "Emily Carter", teamName: "Latham", priorities: [], clips: [], findings: [], strengths: [], checkpoints: [] };

test("empty state shows when there are no swings and no coach notes", () => {
  assert.match(familyEmptyState(base), /No swings yet/);
  assert.equal(familyEmptyState({ ...base, clips: [{ id: "c1", recordedAt: "2026-10-01", status: "processing", uploadedByYou: true }] }), "");
  assert.equal(familyEmptyState({ ...base, findings: [{ clipId: null, title: "t", likelyCause: "", effect: "", videoRemovedBy: "family" }] }), "");
  assert.match(familyEmptyState({}), /No swings yet/);
});

test("What to work on: no Priority -> the report's no-Priority card, no invented Drill or progress", () => {
  const html = focusSection(base);
  assert.match(html, /What to work on/);
  assert.match(html, /Your coach hasn.t picked a Priority yet\./);
  assert.doesNotMatch(html, /Drill<\/span>|Latest progress check/);
});

test("What to work on: shows the coach's Priority, Drill and latest progress check", () => {
  const report = {
    ...base,
    priorities: [{
      title: "Stay <b>balanced</b>", why: "Keeps the head still.", status: "improving", statusLabel: "Improving", nextCheck: "",
      drills: [{ name: "Tee drill", purpose: "Balance", instructions: "Hit off a tee.", equipment: "Tee", coachNote: "Slow" }],
      progress: [{ date: "2026-09-30", label: "Improving", note: "Better" }, { date: "2026-09-01", label: "Holding steady", note: "" }],
    }],
  };
  const html = focusSection(report);
  assert.match(html, /Stay &lt;b&gt;balanced&lt;\/b&gt;/, "escaped");
  assert.match(html, /Tee drill/);
  assert.match(html, /2026-09-30/);
  assert.match(html, /Latest progress check/);
  assert.doesNotMatch(html, /2026-09-01/, "only the latest progress check");
});

test("What to work on: a Priority without a Drill or progress says so, without inventing one", () => {
  const html = focusSection({ ...base, priorities: [{ title: "Load", why: "", status: "active", statusLabel: "Working on it", nextCheck: "", drills: [], progress: [] }] });
  assert.match(html, /No Drill picked yet/);
  assert.match(html, /No progress check yet/);
});

test("a resolved-only Priority list is not shown as current", () => {
  const html = focusSection({ ...base, priorities: [{ title: "Old", why: "", status: "resolved", statusLabel: "Got it", nextCheck: "", drills: [], progress: [] }] });
  assert.match(html, /hasn.t picked a Priority yet/);
});

test("swings list: linked parents can delete any of their child's videos", () => {
  const report = {
    ...base,
    clips: [
      { id: "a1", recordedAt: "2026-10-01", status: "reviewed", uploadedByYou: true },
      { id: "b2", recordedAt: "2026-09-30", status: "processing", uploadedByYou: false },
      { id: "c3", recordedAt: "2026-09-29", status: "failed", uploadedByYou: false },
    ],
    findings: [],
  };
  const html = swingsList(report, new Date(2026, 9, 2));
  assert.match(html, /Coach reviewed/);
  assert.match(html, /Processing/);
  assert.equal((html.match(/data-delete-clip=/g) ?? []).length, 3);
  assert.match(html, /data-delete-clip="a1"/);
  assert.match(html, /data-delete-clip="b2"/);
  assert.match(html, /data-delete-clip="c3"/);
  assert.equal((html.match(/data-open-clip=/g) ?? []).length, 1);
  assert.match(html, /data-open-clip="a1"/);
});

test("swings list: the parent's own upload whose delete didn't finish shows a Try again state (no Watch, no plain Delete)", async () => {
  const { DELETE_UNFINISHED_COPY } = await import("./familyPage.js");
  const report = {
    ...base,
    clips: [
      { id: "own-stuck", recordedAt: "2026-10-01", status: "reviewed", uploadedByYou: true, deleteUnfinished: true },
      { id: "own-ok", recordedAt: "2026-10-01", status: "reviewed", uploadedByYou: true, deleteUnfinished: false },
      // Never sent by the server (others' mid-deletion clips stay hidden); still rendered as a normal row.
      { id: "theirs", recordedAt: "2026-10-01", status: "processing", uploadedByYou: false, deleteUnfinished: true },
    ],
    findings: [],
  };
  const html = swingsList(report, new Date(2026, 9, 2));
  assert.match(html, /Deleting didn’t finish/);
  assert.equal(DELETE_UNFINISHED_COPY.label, "Deleting didn’t finish");
  assert.equal((html.match(/data-retry-delete=/g) ?? []).length, 1);
  assert.match(html, /data-retry-delete="own-stuck"[^>]*>[\s\S]*?Try again/);
  assert.doesNotMatch(html, /data-open-clip="own-stuck"/, "no Watch on a clip being deleted");
  assert.doesNotMatch(html, /data-delete-clip="own-stuck"/);
  assert.match(html, /data-open-clip="own-ok"/);
  assert.match(html, /data-delete-clip="own-ok"/);
  assert.doesNotMatch(html, /data-retry-delete="theirs"/, "retry only on the viewer's own upload");
});

test("swings list: one intro line, then days grouped as 'Sep 19 · N swings', no per-row detail for chip-only states", () => {
  const clip = (id, recordedAt, status) => ({ id, recordedAt, status, uploadedByYou: false });
  const html = swingsList({ ...base, clips: [
    clip("a", "2026-09-19", "analyzed"), clip("b", "2026-09-19", "analyzed"), clip("c", "2026-09-19", "processing"),
    clip("d", "2026-09-19", "awaiting_coach"), clip("e", "2026-09-19", "analyzed"), clip("f", "2025-07-25", "failed"),
  ] }, new Date(2026, 9, 2));
  assert.equal(html.split(SWINGS_INTRO).length - 1, 1, "exactly one intro line");
  assert.equal(SWINGS_INTRO, "Your coach reviews swings when they can. Only notes your coach has reviewed appear on this page.");
  assert.ok(html.indexOf(SWINGS_INTRO) < html.indexOf("hl-swing-day"), "intro sits above the list");
  assert.match(html, /Sep 19 · 5 swings/);
  assert.match(html, /Jul 25, 2025 · 1 swing</);
  assert.equal((html.match(/hl-swing-detail/g) ?? []).length, 2, "only failed and awaiting_coach rows carry a line");
  assert.doesNotMatch(html, /2026-09-19/, "no raw ISO dates in the list");
});

test("formatSwingDay: 'Sep 19', year only when it isn't the current year", () => {
  const today = new Date(2026, 9, 2);
  assert.equal(formatSwingDay("2026-09-19", today), "Sep 19");
  assert.equal(formatSwingDay("2026-01-05", today), "Jan 5");
  assert.equal(formatSwingDay("2025-12-31", today), "Dec 31, 2025");
});

test("swings list: reviewed notes whose video is gone say who removed it", () => {
  const html = swingsList({
    ...base,
    findings: [
      { clipId: null, title: "Early hands", likelyCause: "", effect: "", videoRemovedBy: "family" },
      { clipId: null, title: "Late load", likelyCause: "", effect: "", videoRemovedBy: "coach" },
    ],
  });
  assert.match(html, /Video removed by family/);
  assert.match(html, /Video removed by coach/);
  assert.match(html, /Early hands/);
});

test("coach notes show only the reviewed findings for that clip", () => {
  const report = { ...base, findings: [
    { clipId: "a1", title: "Front side opens <early>", likelyCause: "Stride", effect: "Pulls off", videoRemovedBy: null },
    { clipId: "z9", title: "Other clip", likelyCause: "", effect: "", videoRemovedBy: null },
  ] };
  const html = coachNotes(report, "a1");
  assert.match(html, /Front side opens &lt;early&gt;/);
  assert.match(html, /Stride/);
  assert.doesNotMatch(html, /Other clip/);
  assert.match(coachNotes(report, "nope"), /Your coach didn.t leave notes on this swing\./);
});

test("consent text has no unnamed form: no name, no consent text", () => {
  assert.throws(() => consentText(""));
  assert.throws(() => consentText(null));
  assert.throws(() => consentText("   "));
});

test("a null invite preview gets one message for every reason", () => {
  assert.match(INVITE_UNAVAILABLE, /expired or already been used/);
  assert.match(INVITE_UNAVAILABLE, /Ask your coach for a new link/);
});

test("consent text v1 is verbatim with the child's first name", () => {
  assert.equal(firstName("Emily Carter"), "Emily");
  assert.equal(firstName("  "), "");
  assert.equal(
    consentText("Emily"),
    "I'm the parent or legal guardian of Emily. I agree that videos I or Emily's coaches upload are stored by HitterLoop and analyzed by automated tools, including AI models from third-party providers, to draft notes for the coach. The coach decides what goes on Emily's plan; automated drafts are never shown to me as conclusions. Only Emily's coaches and linked parents can see these videos. They are never published publicly without my separate written permission. I can delete any video I uploaded at any time, and I can unlink myself from Emily at any time.",
  );
});

test("invite errors map to friendly messages", () => {
  assert.match(inviteErrorMessage("invite expired"), /expired/i);
  assert.match(inviteErrorMessage("invite already used"), /already been used/i);
  assert.match(inviteErrorMessage("invite revoked"), /no longer active/i);
  assert.match(inviteErrorMessage("invalid invite"), /isn.t valid/i);
  assert.match(inviteErrorMessage("a coach on this team cannot accept a guardian invite"), /coach/i);
  assert.match(inviteErrorMessage("consent version mismatch"), /reload/i);
  assert.match(inviteErrorMessage("boom"), /Something went wrong/);
  for (const m of ["invite expired", "invalid invite", "boom"]) assert.doesNotMatch(inviteErrorMessage(m), /exception|sql|rpc/i);
});

test("the sign-in return path only ever points at this app's family page", () => {
  const token = "a".repeat(64);
  assert.equal(familyReturnPath(`./family.html?invite=${token}`), `./family.html?invite=${token}`);
  assert.equal(familyReturnPath("./family.html"), "./family.html");
  assert.equal(familyReturnPath(`./family.html?invite=${"AbC1".repeat(16)}`), `./family.html?invite=${"AbC1".repeat(16)}`, "token check is case-insensitive");
  for (const bad of [null, "", "https://evil.example/family.html", "//evil.example", "./family.html?invite=<x>", "javascript:alert(1)", "./team.html", "./family.html?invite=abc&x=1"]) {
    assert.equal(familyReturnPath(bad), null, String(bad));
  }
});

test("localDateString is the device's local calendar date", () => {
  assert.equal(localDateString(new Date(2026, 0, 5, 23, 30)), "2026-01-05");
});

test("upload and delete errors are friendly, never raw backend text", async () => {
  const { uploadErrorMessage, deleteErrorMessage } = await import("./familyPage.js");
  assert.match(uploadErrorMessage("rate limited: at most 10 uploads per day"), /today/);
  assert.match(uploadErrorMessage("Uploads are disabled in this demo. Explore the pre-seeded swings instead."), /disabled in this demo/);
  assert.match(uploadErrorMessage("Couldn't get an upload destination: FunctionsHttpError"), /didn.t send/);
  assert.doesNotMatch(uploadErrorMessage("Couldn't get an upload destination: FunctionsHttpError"), /Functions|destination/);
  assert.match(deleteErrorMessage(403), /no longer have permission/);
  assert.match(deleteErrorMessage(409), /can.t be deleted right now/);
  assert.doesNotMatch(deleteErrorMessage(409), /demo/i);
  assert.match(deleteErrorMessage(500), /try again/);
});

test("unlink: only the guardian's own uploads are offered for deletion", async () => {
  const { ownUploadIds } = await import("./familyPage.js");
  assert.deepEqual(ownUploadIds({ clips: [
    { id: "a", uploadedByYou: true }, { id: "b", uploadedByYou: false }, { id: "c" }, { id: "d", uploadedByYou: true },
  ] }), ["a", "d"]);
  // An own upload whose earlier delete didn't finish is still "mine": Delete my videos retries it.
  assert.deepEqual(ownUploadIds({ clips: [
    { id: "a", uploadedByYou: true, deleteUnfinished: true }, { id: "b", uploadedByYou: true, deleteUnfinished: false },
  ] }), ["a", "b"]);
  assert.deepEqual(ownUploadIds(null), []);
});

test("unlink sheet asks the plain question with both choices; no uploads -> a simple confirm", async () => {
  const { unlinkSheet, UNLINK_QUESTION, unlinkConfirm } = await import("./familyPage.js");
  assert.equal(UNLINK_QUESTION, "Delete the videos you uploaded, or leave them with the team?");
  const sheet = unlinkSheet("Emily", 3);
  assert.equal(sheet.title, "Unlink from Emily?");
  assert.match(sheet.bodyHtml, /Delete the videos you uploaded, or leave them with the team\?/);
  assert.match(sheet.bodyHtml, /3 videos/);
  assert.match(sheet.footerHtml, /data-unlink-choice="delete"/);
  assert.match(sheet.footerHtml, /data-unlink-choice="keep"/);
  assert.match(sheet.footerHtml, /Delete my videos/);
  assert.match(sheet.footerHtml, /Leave them with the team/);
  assert.match(unlinkSheet("Emily", 1).bodyHtml, /1 video\b/);
  assert.match(unlinkSheet("<b>", 1).title, /<b>/, "title is escaped by bottomSheetMarkup");
  assert.doesNotMatch(unlinkSheet("<b>", 1).bodyHtml, /<b>/);
  const confirm = unlinkConfirm("Emily");
  assert.equal(confirm.title, "Unlink from Emily?");
  assert.match(confirm.message, /You'll stop seeing Emily's page\./);
  assert.equal(confirm.confirmLabel, "Unlink");
});

test("unlink messages: done, and a partial delete keeps the link", async () => {
  const { unlinkDoneMessage, unlinkDeleteFailedMessage } = await import("./familyPage.js");
  assert.equal(unlinkDoneMessage("Emily"), "You're unlinked from Emily.");
  assert.equal(unlinkDeleteFailedMessage(1), "1 video couldn't be deleted, so you're still linked. Please try again.");
  assert.equal(unlinkDeleteFailedMessage(2), "2 videos couldn't be deleted, so you're still linked. Please try again.");
});
