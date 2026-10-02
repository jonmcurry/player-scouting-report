// Pure helpers for the coach's "Parents" area in Manage player (player.html):
// invite a parent (a one-time family.html link, valid 7 days, shown once),
// cancel invites not used yet, see who is linked, and remove a link.
//
// Coaches can't read other accounts' emails, so a linked guardian is shown by
// relationship and linked date only ("Guardian 1 · Parent · linked Sep 19").
// Removing a guardian leaves the videos they sent with the team.

function esc(value) {
  return String(value ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

export const GUARDIAN_DEMO_NOTE = "Parent invites aren't part of this demo.";

export const INVITE_DIALOG = Object.freeze({
  title: "Invite a parent?",
  message: "This makes a link to the family page. It works once and expires in 7 days. Send it only to the parent.",
  confirmLabel: "Create invite",
});

/** "Oct 9" in the device's time zone; the year is added when it isn't this year. */
export function formatShortDate(value, today = new Date()) {
  const d = new Date(value ?? "");
  if (Number.isNaN(d.getTime())) return "";
  const label = `${MONTHS[d.getMonth()]} ${d.getDate()}`;
  return d.getFullYear() === today.getFullYear() ? label : `${label}, ${d.getFullYear()}`;
}

/** The invite link: family.html next to this page, carrying the one-time token. */
export function guardianInviteUrl({ origin, pathname }, token) {
  // Hosts that serve extensionless URLs drop ".html" (same rule as the share links).
  const base = String(pathname ?? "").replace(/player(\.html)?$/, "family.html");
  return `${origin}${base}?invite=${encodeURIComponent(token)}`;
}

function relationshipLabel(relationship) {
  return relationship === "parent" ? "Parent" : "Guardian";
}

/** player_guardians rows -> display rows, oldest link first ("Guardian 1", "Guardian 2"). */
export function guardianRows(guardians = [], today = new Date()) {
  return [...(guardians ?? [])]
    .sort((a, b) => new Date(a.consented_at ?? 0) - new Date(b.consented_at ?? 0))
    .map((g, i) => {
      const linked = formatShortDate(g.consented_at, today);
      return {
        userId: g.user_id,
        title: `Guardian ${i + 1}`,
        supporting: `${relationshipLabel(g.relationship)}${linked ? ` · linked ${linked}` : ""}`,
      };
    });
}

export function guardianListHtml(guardians = [], today = new Date()) {
  const rows = guardianRows(guardians, today);
  if (!rows.length) return `<p class="hint">No parents linked yet.</p>`;
  return rows.map((row) => `
        <div style="display:flex;align-items:center;gap:8px;margin-bottom:6px;flex-wrap:wrap;">
          <div style="flex:1;min-width:0;">
            <div>${esc(row.title)}</div>
            <div class="hint" style="font-size:11px;">${esc(row.supporting)}</div>
          </div>
          <button type="button" class="tap-target btn-danger" style="flex:none;" data-remove-guardian="${esc(row.userId)}" data-guardian-label="${esc(row.title)}">Remove</button>
        </div>`).join("");
}

/** Unused, unexpired invites: one line plus "Cancel pending invites", or "" when there are none. */
export function pendingInvitesHtml(invites = [], today = new Date()) {
  const list = [...(invites ?? [])].sort((a, b) => new Date(a.expires_at) - new Date(b.expires_at));
  if (!list.length) return "";
  const first = formatShortDate(list[0].expires_at, today);
  const text = list.length === 1
    ? `1 invite not used yet · expires ${first}`
    : `${list.length} invites not used yet · first expires ${first}`;
  // The line on its own row, the button under it: side by side, the line wraps to a narrow column at 390px.
  return `<div style="margin:6px 0;">
          <p class="hint" style="margin:0 0 6px;">${esc(text)}</p>
          <button type="button" class="tap-target btn-danger" data-cancel-invites="${list.length}">Cancel pending invites</button>
        </div>`;
}

/** confirmDialog options for "Cancel pending invites" (revoke_guardian_invites). */
export function cancelInvitesDialog(count) {
  const links = count === 1 ? "The invite link you sent" : `All ${count} invite links you sent`;
  return {
    title: count === 1 ? "Cancel the pending invite?" : "Cancel pending invites?",
    message: `${links} will stop working right away. Parents who already joined stay linked.`,
    confirmLabel: "Cancel invites",
    // Not "Cancel": two buttons both saying cancel would be ambiguous.
    cancelLabel: count === 1 ? "Keep it" : "Keep them",
    destructive: true,
  };
}

/** revoke_guardian_invites' count -> snackbar text. */
export function cancelInvitesDoneMessage(cancelled) {
  if (!cancelled) return "No pending invites to cancel.";
  return cancelled === 1 ? "Invite cancelled." : `${cancelled} invites cancelled.`;
}

/** The new invite, shown once: the link in a read-only field (long-press works too) and Copy. */
export function inviteCreatedHtml(url, { expiresAt, today = new Date() } = {}) {
  const until = formatShortDate(expiresAt, today);
  return `
        <div class="card" style="margin:8px 0;">
          <div style="display:flex;align-items:center;gap:8px;flex-wrap:wrap;">
            <input type="text" readonly aria-label="Invite link" style="flex:1;min-width:0;" value="${esc(url)}">
            <button type="button" class="tap-target" style="flex:none;" data-copy-invite="${esc(url)}">Copy</button>
          </div>
          <p class="hint" style="margin:6px 0 0;">Works once, until ${esc(until)}. It won't be shown again.</p>
        </div>`;
}

export function removeGuardianDialog(label, playerName) {
  return {
    title: `Remove ${label}?`,
    message: `They lose access to ${playerName}'s family page right away. Videos they sent stay with the team.`,
    confirmLabel: "Remove",
    destructive: true,
  };
}

/** create_guardian_invite / revoke_guardian error -> plain copy (never the raw database text). */
export function inviteErrorCopy(message) {
  if (/not allowed/.test(String(message ?? ""))) return "Only this player's coaches can invite a parent.";
  return "Couldn't create the invite. Try again.";
}
