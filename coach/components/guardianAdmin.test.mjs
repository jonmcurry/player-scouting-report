// Pure helpers behind the coach's "Parents" area in Manage player (player.html).
import test from "node:test";
import assert from "node:assert/strict";
import {
  guardianInviteUrl, guardianRows, guardianListHtml, pendingInvitesHtml, inviteCreatedHtml,
  removeGuardianDialog, inviteErrorCopy, formatShortDate, GUARDIAN_DEMO_NOTE, INVITE_DIALOG,
  cancelInvitesDialog, cancelInvitesDoneMessage,
} from "./guardianAdmin.js";

const TODAY = new Date("2026-10-02T12:00:00");

test("invite link points at family.html?invite=<token>, beside player.html", () => {
  const token = "ab".repeat(32);
  assert.equal(guardianInviteUrl({ origin: "https://x.test", pathname: "/coach/player.html" }, token), `https://x.test/coach/family.html?invite=${token}`);
  // Hosts that drop ".html" (joncurry.co) still get the family page.
  assert.equal(guardianInviteUrl({ origin: "https://x.test", pathname: "/coach/player" }, token), `https://x.test/coach/family.html?invite=${token}`);
});

test("guardians are listed oldest first as Guardian 1/2 with relationship and linked date", () => {
  const rows = guardianRows([
    { user_id: "u2", relationship: "guardian", consented_at: "2026-09-30T15:00:00Z" },
    { user_id: "u1", relationship: "parent", consented_at: "2026-09-19T15:00:00Z" },
  ], TODAY);
  assert.deepEqual(rows.map((r) => r.userId), ["u1", "u2"]);
  assert.deepEqual(rows.map((r) => r.title), ["Guardian 1", "Guardian 2"]);
  assert.equal(rows[0].supporting, "Parent · linked Sep 19");
  assert.equal(rows[1].supporting, "Guardian · linked Sep 30");
});

test("dates add the year only when it isn't this year", () => {
  assert.equal(formatShortDate("2026-10-09T12:00:00Z", TODAY), "Oct 9");
  assert.equal(formatShortDate("2025-07-25T12:00:00Z", TODAY), "Jul 25, 2025");
  assert.equal(formatShortDate("nonsense", TODAY), "");
});

test("guardian list: Remove per guardian, empty state, and no emails or ids shown as text", () => {
  const html = guardianListHtml([{ user_id: "u1", relationship: "parent", consented_at: "2026-09-19T15:00:00Z" }], TODAY);
  assert.match(html, /Guardian 1/);
  assert.match(html, /data-remove-guardian="u1"/);
  assert.match(html, />Remove</);
  assert.doesNotMatch(html.replace(/data-[a-z-]+="[^"]*"/g, ""), /u1|@/);
  assert.match(guardianListHtml([], TODAY), /No parents linked yet\./);
});

test("unknown relationship text is escaped and never trusted as markup", () => {
  const html = guardianListHtml([{ user_id: "u\"1", relationship: "<b>x</b>", consented_at: "2026-09-19T15:00:00Z" }], TODAY);
  assert.doesNotMatch(html, /<b>x<\/b>/);
  assert.doesNotMatch(html, /data-remove-guardian="u"1"/);
});

test("pending invites: a count and the soonest expiry, or nothing", () => {
  assert.equal(pendingInvitesHtml([], TODAY), "");
  const html = pendingInvitesHtml([{ expires_at: "2026-10-09T12:00:00Z" }, { expires_at: "2026-10-05T12:00:00Z" }], TODAY);
  assert.match(html, /2 invites not used yet · first expires Oct 5/);
  assert.match(pendingInvitesHtml([{ expires_at: "2026-10-09T12:00:00Z" }], TODAY), /1 invite not used yet · expires Oct 9/);
});

test("pending invites carry a 'Cancel pending invites' control (only when there are any)", () => {
  assert.doesNotMatch(pendingInvitesHtml([], TODAY), /data-cancel-invites/);
  const html = pendingInvitesHtml([{ expires_at: "2026-10-09T12:00:00Z" }, { expires_at: "2026-10-05T12:00:00Z" }], TODAY);
  assert.match(html, /<button type="button" class="tap-target btn-danger"[^>]*data-cancel-invites="2">Cancel pending invites<\/button>/);
});

test("cancel-invites confirm and result copy are plain and say accepted links stay", () => {
  const many = cancelInvitesDialog(2);
  assert.equal(many.title, "Cancel pending invites?");
  assert.match(many.message, /All 2 invite links you sent will stop working right away/);
  assert.match(many.message, /already joined stay linked/);
  assert.equal(many.destructive, true);
  assert.equal(many.cancelLabel, "Keep them", "never two buttons that both say cancel");
  assert.equal(cancelInvitesDialog(1).cancelLabel, "Keep it");
  assert.match(cancelInvitesDialog(1).message, /^The invite link you sent will stop working/);
  assert.equal(cancelInvitesDoneMessage(0), "No pending invites to cancel.");
  assert.equal(cancelInvitesDoneMessage(1), "Invite cancelled.");
  assert.equal(cancelInvitesDoneMessage(3), "3 invites cancelled.");
});

test("a new invite is shown once with a copy button, one-time and 7-day wording", () => {
  const url = "https://x.test/coach/family.html?invite=abc";
  const html = inviteCreatedHtml(url, { expiresAt: "2026-10-09T12:00:00Z", today: TODAY });
  assert.match(html, /readonly/);
  assert.match(html, /value="https:\/\/x\.test\/coach\/family\.html\?invite=abc"/);
  assert.match(html, /data-copy-invite="https:\/\/x\.test\/coach\/family\.html\?invite=abc"/);
  assert.match(html, />Copy</);
  assert.match(html, /Works once, until Oct 9\. It won't be shown again\./);
  assert.doesNotMatch(inviteCreatedHtml('x" onmouseover="y', { expiresAt: "2026-10-09T12:00:00Z", today: TODAY }), /" onmouseover="/);
});

test("invite confirm copy, remove copy and errors are short and plain", () => {
  assert.equal(INVITE_DIALOG.title, "Invite a parent?");
  assert.match(INVITE_DIALOG.message, /7 days/);
  assert.match(INVITE_DIALOG.message, /once/);
  const remove = removeGuardianDialog("Guardian 1", "Emily");
  assert.equal(remove.title, "Remove Guardian 1?");
  assert.match(remove.message, /Videos they sent stay with the team\./);
  assert.equal(remove.destructive, true);
  assert.equal(inviteErrorCopy("not allowed"), "Only this player's coaches can invite a parent.");
  assert.equal(inviteErrorCopy("boom"), "Couldn't create the invite. Try again.");
  assert.equal(GUARDIAN_DEMO_NOTE, "Parent invites aren't part of this demo.");
});
