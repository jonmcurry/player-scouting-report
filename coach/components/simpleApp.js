import { PUBLIC_APP_ORIGIN } from "../config.js";
import { confirmDialog, showSnackbar, icon, iconButton, topOverlayId, openOverflowMenu } from "./ui.js";
import { openRosterImportSheet } from "./rosterImportSheet.js";
import { guardianRows, formatShortDate, cancelInvitesDialog, cancelInvitesDoneMessage, removeGuardianDialog } from "./guardianAdmin.js";
import { createNavigation, initNavigation } from "./simpleNavigation.js";
import { supabase, escapeHtml, signOut } from "../shared.js";
import { getDemoConfig, isDemoMode } from "../demoConfig.js";
import { enqueueCapture, queuedCaptures, drainCaptureQueue } from "./captureQueue.js";
import { acceptedVideoUpload, VIDEO_UPLOAD_HELP } from "./uploadPolicy.js";
import { deleteClip, deleteClipsForPlayer } from "./clipDeletion.js";
import { demoShowcase } from "./demoShowcase.js";
import { captureModeHtml, captureSummaryHtml } from "./captureGuide.js";
import { experimentalReportHtml, experimentalStillPending, seekTarget, eventLabel } from "./experimentalReport.js";
import { parsePresentation, presentationCopy, REPORT_COPY, strengthsNoneCopy, unavailablePresentation,
  userErrorMessage, describeFunctionsError, reportFetchFailure, publicAppLink, progressTone, progressLabel, rosterSummary, shareLinkRows, playerDetailsSummary, AGE_BAND_LABELS } from "./simplePresentation.js";

const root = document.getElementById("simpleRoot");
const dialog = document.getElementById("captureDialog");
const sheet = document.getElementById("captureSheet");
const params = new URLSearchParams(location.search);
const state = { userId: null, role: null, teamId: null, teamSlug: null, teamName: "", teams: [], level: null, sport: null, guideSport: null,
  guideMode: "game_backstop", captureProfile: "unknown_imported", players: [], selected: null, home: null,
  report: null, tab: "home", files: [], kind: "game", result: null, shared: false, demo: isDemoMode(), pushToken: null, pushReady: false };

const esc = (value) => escapeHtml(String(value ?? ""));
const eurl = (value) => {
  try { const url = new URL(value); return ["https:", "http:"].includes(url.protocol) ? esc(url.href) : null; }
  catch { return null; }
};
const statusText = (status) => ({ pending: "Processing…", processing: "Analyzing…", ready: "Ready",
  unreadable: "Couldn't read this one", failed: "Couldn't read this one", no_swing: "No swing", deletion_pending: "Retry delete" })[status] ?? "Analyzing…";
const isProcessing = (status) => ["pending", "processing"].includes(status);
const progressPercent = (item) => isProcessing(item.status) && Number.isInteger(item.processingProgress)
  ? `${Math.max(0, Math.min(100, item.processingProgress))}%` : null;
// Without a real stored value a processing row shows no number at all, never a guess.
// When the row has no headline its title already is the status, so don't repeat it.
const processingProgressText = (item) => progressPercent(item)
  ?? (isProcessing(item.status) || !item.headline ? "" : statusText(item.status));
const pendingReportText = (data) => {
  const percent = progressPercent({ status: data.status, processingProgress: data.processingProgress });
  return `${percent ? `${percent} complete · ` : ""}Usually ready in a few minutes.`;
};
const shortDate = (value) => value ? new Date(`${value}T12:00:00`).toLocaleDateString(undefined, { month: "short", day: "numeric" }) : "";
function say(text) {
  if (!text) return;
  showSnackbar(text);
  // A native dialog is in the top layer; its action feedback must be there too.
  const host = document.getElementById("btSnackbarHost");
  if (dialog.open && host) dialog.appendChild(host);
}
let deletePending = false;
let deletePlayerPending = false;
const shareLinkPending = new Set();
let sharedLinksGeneration = 0;
let editPlayerId = null;
let hidePending = false;
let hideContext = null;
let retryReportVideo = null;
const deletedSiblingIds = new Set();
let homeRefreshTimer = null;
let reportRefreshTimer = null;
let reportRefreshGeneration = 0;
const navigation = createNavigation({
  history: window.history,
  renderTab: (tab) => { stopReportRefresh(); return tab === "progress" ? showProgress() : showHome(); },
  renderPlayer: (playerId) => showPlayer(playerId),
  renderReport: (clipId) => showReport(clipId),
  renderSheet: (name) => ({ choice: choiceSheet, confirm: () => confirmSheet(state.files, true),
    guide: guideSheet, settings: settingsSheet, correction: correctCaptureSheet, invite: inviteSheet, hide: hideReasonSheet, "add-player": addPlayerSheet, "shared-links": sharedLinksSheet, "edit-player": editPlayerSheet })[name]?.(),
  closeSheet: () => {
    const host = document.getElementById("btSnackbarHost");
    if (host?.parentElement === dialog) document.body.appendChild(host);
    if (dialog.open) dialog.close();
  },
  getScroll: () => window.scrollY,
  restoreScroll: (y) => window.scrollTo(0, y),
  isShared: () => state.shared,
  overlayOpen: () => !!topOverlayId(),
});
initNavigation({ window, navigation, onError: (error) => say(userErrorMessage(error)) });
dialog.addEventListener("cancel", (event) => { event.preventDefault(); navigation.dismissSheets(); });
dialog.addEventListener("close", () => { if (!dialog.open && navigation.sheet) navigation.dismissSheets(); });
function openSheet(name) {
  if (navigation.busy) return;
  navigation.openSheet(name);
  if (!dialog.open) dialog.showModal();
}
function appBar(title, playerName, back = false) {
  const parent = navigation.view.parent;
  const from = navigation.view.hl === "player" ? "Team" : parent?.hl === "player"
    ? state.players.find((player) => player.id === parent.playerId)?.name.split(" ")[0] ?? "Player"
    : navigation.view.fromTab === "progress" ? "Progress" : "Home";
  return `<header class="simple-appbar">${back && !state.shared
    ? iconButton("chevron-left", `Back to ${from}`, { attrs: 'data-action="back"' }) : ""}
    <div><h1>${esc(title)}</h1><p>${esc(playerName)}</p></div></header>`;
}
function reportAppBar(data, clipId) {
  const item = state.home?.feed?.find((entry) => entry.id === clipId);
  const title = item?.date && ["game", "practice"].includes(item.kind)
    ? `${shortDate(item.date)} · ${item.kind === "practice" ? "Practice" : "Game"}` : "At-bat report";
  return appBar(title, data.playerName, true);
}


async function setupNativePush(requestPermission = true) {
  const capacitor = window.Capacitor;
  const push = capacitor?.isPluginAvailable?.("PushNotifications")
    ? capacitor.registerPlugin("PushNotifications") : null;
  if (!push || state.pushReady || !state.userId) return;
  let permission = await push.checkPermissions();
  if (permission.receive === "prompt" && requestPermission) permission = await push.requestPermissions();
  if (permission.receive !== "granted") return;
  state.pushReady = true;
  await push.addListener("registration", async ({ value }) => {
    if (!value) return;
    const { error } = await supabase.rpc("register_notification_push_token", { p_token: value, p_platform: "android" });
    if (error) { state.pushReady = false; say("Device notifications couldn't be enabled."); return; }
    state.pushToken = value;
  });
  await push.addListener("registrationError", () => { state.pushReady = false; say("Device notifications couldn't be enabled."); });
  await push.addListener("pushNotificationActionPerformed", ({ notification }) => {
    const playerId = notification?.data?.playerId;
    if (typeof playerId === "string" && state.players.some((player) => player.id === playerId)) {
      location.href = `./simple.html?player=${encodeURIComponent(playerId)}`;
    }
  });
  await push.register();
}
function setTab(tab) {
  state.tab = tab;
  document.querySelectorAll(".simple-nav [data-tab]").forEach((button) =>
    button.setAttribute("aria-current", button.dataset.tab === (tab === "player" ? "home" : tab) ? "page" : "false"));
}

async function reportApi(playerId, clipId = null, token = null) {
  if (state.demo && !token) {
    const showcase = demoShowcase(playerId, getDemoConfig().basePath, clipId);
    if (!showcase) throw new Error("Demo report not found");
    return showcase;
  }
  const { data, error } = await supabase.functions.invoke("get-simplified-report", {
    body: { ...(playerId ? { playerId } : {}), ...(clipId ? { clipId } : {}), ...(token ? { token } : {}),
      ...(state.demo ? { demo: true } : {}) },
  });
  if (error || !data || data.error) {
    const details = await describeFunctionsError(error);
    console.warn(reportFetchFailure(details));
    const failure = new Error(userErrorMessage(error, { ...details, bodyError: details.bodyError ?? data?.error,
      shared: state.shared, online: navigator.onLine, transport: true }));
    failure.userFacing = true;
    throw failure;
  }
  if (state.demo) {
    const mediaUrl = (path) => path
      ? new URL(`${getDemoConfig().basePath}media/${encodeURIComponent(path)}`, location.origin).href : null;
    if (data.mediaPath) data.videoUrl = mediaUrl(data.mediaPath);
    for (const key of ["thenVideo", "nowVideo"]) {
      if (data.progress?.[key]?.mediaPath) data.progress[key].url = mediaUrl(data.progress[key].mediaPath);
    }
  }
  return data;
}

const isCoach = () => state.role === "coach" && !state.demo && !state.shared;
const coachPlayer = (id) => isCoach() && state.players.find((p) => p.id === id);
let teamGeneration = 0;
let playerGeneration = 0;
const parentActions = new Set();
// The feed refreshes every few seconds while an at-bat is analyzing; the Parents card reuses its last
// read and reloads only when the Player screen opens or after a parent action.
let parentsCache = null;

function rosterActions() {
  return `<div class="simple-actions"><button class="simple-action secondary" data-action="import-players" type="button">Import players</button><button class="simple-action secondary" data-action="add-player" type="button">Add player</button></div>`;
}
function teamHtml(summary, banner = "", failed = false) {
  const heading = `<span class="simple-eyebrow">Team</span><h1>${esc(state.teamName)}</h1>`;
  if (!state.players.length) return `${heading}<section class="simple-card"><h2>No players yet</h2><p>Import your roster from GameChanger, or add a player.</p>${rosterActions()}</section>${banner}`;
  return `${heading}${rosterActions()}${banner}<section class="simple-card"><h2>Players</h2>${[...state.players].sort((a, b) => a.name.localeCompare(b.name)).map((p) => {
    const item = summary?.[p.id];
    return `<div class="simple-roster-row"><button class="simple-row" data-open-player="${esc(p.id)}" type="button"><span class="jersey-badge sm">${esc(p.jersey_number || "–")}</span><span><strong>${esc(p.name)}</strong>${failed ? "" : `<small class="simple-muted">${esc(item?.text ?? "Loading…")}</small>`}${item?.status ? `<span class="bt-status-chip bt-status-${item.status.tone}">${esc(item.status.label)}</span>` : ""}</span>${icon("chevron-right")}</button>${iconButton("ellipsis-vertical", `More for ${p.name}`, { attrs: `data-player-menu="${esc(p.id)}"` })}</div>`;
  }).join("")}${failed ? `<p class="simple-muted">Latest at-bats couldn't load.</p>` : ""}</section>`;
}
async function showTeam() {
  if (!isCoach()) return;
  stopReportRefresh();
  setTab("home");
  clearTimeout(homeRefreshTimer);
  const generation = ++teamGeneration;
  root.innerHTML = teamHtml(null);
  const banner = await queueBanner();
  if (state.tab !== "home" || generation !== teamGeneration) return;
  root.innerHTML = teamHtml(null, banner);
  if (!state.players.length) return;
  try {
    const { data, error } = await supabase.from("game_log_entries")
      .select("player_id, date, session_type, video_clips(status)")
      .in("player_id", state.players.map((p) => p.id)).order("date", { ascending: false });
    if (error) throw error;
    if (state.tab === "home" && generation === teamGeneration) root.innerHTML = teamHtml(rosterSummary(state.players, data, shortDate), banner);
  } catch {
    if (state.tab === "home" && generation === teamGeneration) root.innerHTML = teamHtml(null, banner, true);
  }
}
async function showPlayer(playerId) {
  const player = coachPlayer(playerId);
  if (!player) return;
  stopReportRefresh();
  clearTimeout(homeRefreshTimer);
  state.selected = playerId;
  state.home = null;
  parentsCache = null;
  setTab("player");
  const generation = ++playerGeneration;
  const bar = appBar(player.name, `#${player.jersey_number || "–"} · ${state.teamName}`, true);
  root.innerHTML = `${bar}<section class="simple-card"><p class="simple-muted">Loading…</p></section>`;
  try {
    const home = await reportApi(playerId);
    if (state.tab !== "player" || state.selected !== playerId || generation !== playerGeneration) return;
    state.home = home;
    await renderFeed(true);
  } catch (error) {
    if (state.tab !== "player" || state.selected !== playerId || generation !== playerGeneration) return;
    root.innerHTML = `${bar}<section class="simple-card"><p role="alert">${esc(userErrorMessage(error, { transport: !error.userFacing, online: navigator.onLine }))}</p><button class="simple-action secondary" data-action="retry-player" type="button">Try again</button></section>`;
  }
}
async function pendingInvites(playerId) {
  const { data, error } = await supabase.from("guardian_invites").select("expires_at").eq("player_id", playerId)
    .is("used_at", null).is("revoked_at", null).gt("expires_at", new Date().toISOString());
  if (error) throw error;
  return data ?? [];
}
async function loadParents(playerId) {
  if (!coachPlayer(playerId)) return;
  let html, loaded = false;
  try {
    const [guardians, invites] = await Promise.all([
      supabase.from("player_guardians").select("user_id, relationship, consented_at").eq("player_id", playerId).order("consented_at"),
      pendingInvites(playerId),
    ]);
    if (guardians.error) throw guardians.error;
    const rows = guardianRows(guardians.data);
    const first = [...invites].sort((a, b) => a.expires_at.localeCompare(b.expires_at))[0];
    html = `${rows.length ? rows.map((row) => `<div class="simple-row"><span><strong>${esc(row.title)}</strong><small>${esc(row.supporting)}</small></span><button class="simple-action destructive" data-action="remove-guardian" data-invite-player="${esc(playerId)}" data-user-id="${esc(row.userId)}" data-label="${esc(row.title)}" type="button">Remove</button></div>`).join("") : `<p class="simple-muted">No parents linked yet.</p>`}
      ${first ? `<p class="simple-muted">${invites.length === 1 ? "1 invite not used yet · expires" : `${invites.length} invites not used yet · first expires`} ${esc(formatShortDate(first.expires_at))}</p><button class="simple-action destructive" data-action="cancel-invites" data-invite-player="${esc(playerId)}" type="button">Cancel pending invites</button>` : ""}
      <button class="simple-action secondary" data-action="invite-parent" data-invite-player="${esc(playerId)}" type="button">Invite parent</button>`;
    loaded = true;
  } catch { html = `<p class="simple-muted">Couldn't load parents.</p>`; }
  // A late read for a player who is no longer showing is dropped, not cached.
  if (state.tab === "player" && state.selected === playerId) {
    // Only a successful read is reused; a failed one is retried on the next feed refresh.
    parentsCache = loaded ? { playerId, html } : null;
    const card = document.getElementById("parentsCard");
    if (card) card.innerHTML = `<h2>Parents</h2>${html}`;
  }
}
async function inviteParent(playerId, button) {
  if (!coachPlayer(playerId) || parentActions.has(`invite:${playerId}`)) return;
  if (!publicAppLink(PUBLIC_APP_ORIGIN, "family.html")) { say("Invite links aren't set up in this build yet."); return; }
  parentActions.add(`invite:${playerId}`);
  if (button) button.disabled = true;
  try {
    const { data: token, error } = await supabase.rpc("create_guardian_invite", { p_player_id: playerId, p_relationship: "parent" });
    if (error || !token) throw error ?? new Error();
    state.inviteUrl = publicAppLink(PUBLIC_APP_ORIGIN, "family.html", { invite: token });
    inviteSheet();
    await loadParents(playerId);
  } catch { say("Couldn't create the invite. Try again."); }
  finally { parentActions.delete(`invite:${playerId}`); if (button) button.disabled = false; }
}
async function cancelInvites(playerId, button) {
  if (!coachPlayer(playerId) || parentActions.has(`cancel:${playerId}`)) return;
  parentActions.add(`cancel:${playerId}`);
  if (button) button.disabled = true;
  try {
    const invites = await pendingInvites(playerId);
    if (!invites.length) { say(cancelInvitesDoneMessage(0)); return; }
    if (!await confirmDialog(cancelInvitesDialog(invites.length))) return;
    const { data, error } = await supabase.rpc("revoke_guardian_invites", { p_player_id: playerId });
    if (error) throw error;
    say(cancelInvitesDoneMessage(data));
    await loadParents(playerId);
  } catch { say("Couldn't cancel the invites. Try again."); }
  finally { parentActions.delete(`cancel:${playerId}`); if (button) button.disabled = false; }
}
async function removeGuardian(button) {
  const playerId = button.dataset.invitePlayer, userId = button.dataset.userId;
  const player = coachPlayer(playerId), key = `remove:${playerId}:${userId}`;
  if (!player || parentActions.has(key)) return;
  parentActions.add(key); button.disabled = true;
  try {
    if (!await confirmDialog(removeGuardianDialog(button.dataset.label, player.name))) return;
    const { error } = await supabase.rpc("revoke_guardian", { p_player_id: playerId, p_user_id: userId });
    if (error) throw error;
    say("Parent removed."); await loadParents(playerId);
  } catch { say("Couldn't remove the parent. Try again."); }
  finally { parentActions.delete(key); button.disabled = false; }
}
function playerMenu(button) {
  const player = coachPlayer(button.dataset.playerMenu);
  if (!player) return;
  openOverflowMenu({ title: `More for ${player.name}`, anchor: button, items: [
    { label: "Invite parent", icon: "user-round", onSelect: () => inviteParent(player.id, button) },
    { label: "Cancel pending invites", icon: "x", destructive: true, onSelect: () => cancelInvites(player.id, button) },
  ] });
}
async function openCoachClip(clip) {
  if (!isCoach()) return;
  let player;
  try {
    const { data, error } = await supabase.from("video_clips").select("id, game_log_entries!inner(player_id)").eq("id", clip).maybeSingle();
    player = !error && coachPlayer(data?.game_log_entries?.player_id);
  } catch { /* Unavailable links stay on Team. */ }
  if (!player) { say("That at-bat isn't available."); return; }
  state.selected = player.id;
  await navigation.openPlayer(player.id);
  await showReport(clip);
}
function playerDetailsCard(id) {
  const player = coachPlayer(id);
  if (!player) return "";
  return `<section class="simple-card" id="playerDetailsCard"><h2>Player details</h2><p class="simple-muted">${esc(playerDetailsSummary(player))}</p><button class="simple-action secondary" data-action="edit-player" type="button">Edit details</button><button class="simple-action destructive" data-action="delete-player" type="button" ${deletePlayerPending ? "disabled" : ""}>${deletePlayerPending ? "Deleting…" : "Delete player"}</button></section>`;
}
function editPlayerSheet() {
  const player = coachPlayer(editPlayerId);
  if (!player) return;
  sheet.innerHTML = `<h2 id="simpleSheetTitle">Edit details</h2><label>Name<input id="editPlayerName" value="${esc(player.name)}" required></label><label>Jersey number<input id="editPlayerJersey" value="${esc(player.jersey_number)}" required></label>
    ${selectField("editPlayerAge", "Age band", [["", "Unknown"], ...Object.entries(AGE_BAND_LABELS)], player.age_band ?? "")}
    ${selectField("editPlayerBats", "Bats", [["", "Unknown"], ["L", "Left"], ["R", "Right"], ["S", "Switch"]], player.bats ?? "")}
    ${selectField("editPlayerThrows", "Throws", [["", "Unknown"], ["L", "Left"], ["R", "Right"]], player.throws ?? "")}
    <p class="simple-error" id="editPlayerError" role="alert"></p><button class="simple-action primary" data-action="save-player-details" type="button">Save</button><button class="simple-action link" data-action="close-sheet" type="button">Cancel</button>`;
  openSheet("edit-player");
}
async function savePlayerDetails(button) {
  const player = coachPlayer(editPlayerId);
  if (!player || button.disabled) return;
  const id = player.id;
  const value = (id) => document.getElementById(id).value.trim();
  const errorNode = document.getElementById("editPlayerError");
  const name = value("editPlayerName"), jersey_number = value("editPlayerJersey");
  errorNode.textContent = "";
  if (!name) { errorNode.textContent = "Enter a player name."; return; }
  if (!jersey_number) { errorNode.textContent = "Enter a jersey number."; return; }
  button.disabled = true;
  try {
    const { error } = await supabase.from("players").update({ name, jersey_number,
      age_band: value("editPlayerAge") || null, bats: value("editPlayerBats") || null, throws: value("editPlayerThrows") || null }).eq("id", id).eq("team_id", state.teamId);
    if (error) throw error;
    await navigation.dismissSheets();
    await reloadPlayers(); await showPlayer(id); say("Player details saved.");
  } catch { errorNode.textContent = "Couldn't save player details. Try again."; if (!dialog.open) say(errorNode.textContent); }
  finally { button.disabled = false; }
}
async function deletePlayer(button) {
  const player = coachPlayer(state.selected);
  if (!player || deletePlayerPending) return;
  const { id, name } = player;
  const teamId = state.teamId;
  deletePlayerPending = true;
  try {
    if (!await confirmDialog({ title: `Delete ${name}?`, message: "This deletes every at-bat and video for this player and removes linked parents, pending invites and shared links. This can't be undone.", confirmLabel: "Delete player", destructive: true })) return;
    button.disabled = true; button.textContent = "Deleting…";
    try { await deleteClipsForPlayer(id); }
    catch { say("Couldn't delete all of this player's videos, so the player wasn't deleted. Try again."); return; }
    const { error } = await supabase.from("players").delete().eq("id", id).eq("team_id", teamId);
    if (error) { say("Videos were deleted, but the player couldn't be removed. Try again."); return; }
    // The player is gone; a roster refresh problem must not be reported as a failed delete.
    state.players = state.players.filter((p) => p.id !== id);
    try { await reloadPlayers(); } catch { /* Keep the locally pruned roster. */ }
    await navigation.goTab("home"); say("Player deleted.");
  } catch { say("Couldn't delete the player. Try again."); }
  finally {
    deletePlayerPending = false;
    // Feed refreshes can replace the original button while confirmation is open.
    for (const control of [button, ...root.querySelectorAll('[data-action="delete-player"]')]) {
      control.disabled = false; control.textContent = "Delete player";
    }
  }
}
async function sharedLinksSheet() {
  if (!isCoach()) return;
  const generation = ++sharedLinksGeneration;
  const title = `<h2 id="simpleSheetTitle">Shared links</h2><p>Anyone with an active link can see what it shares until it expires or you turn it off.</p>`;
  const done = `<button class="simple-action link" data-action="back" type="button">Done</button>`;
  sheet.innerHTML = `${title}<p class="simple-muted">Loading…</p>${done}`;
  openSheet("shared-links");
  const current = () => isCoach() && navigation.sheet === "shared-links" && generation === sharedLinksGeneration;
  try {
    const { data, error } = await supabase.from("player_share_links").select("id, player_id, share_scope, video_clip_id, created_at, expires_at, revoked_at, players(name), video_clips(game_log_entries(date, session_type))")
      .eq("created_by", state.userId).not("share_scope", "is", null).order("created_at", { ascending: false }).limit(50);
    if (error) throw error;
    if (!current()) return;
    const rows = shareLinkRows(data, Date.now(), (value) => shortDate(value?.slice(0, 10)));
    const rowHtml = (row) => `<div class="simple-row"><span><strong>${esc(row.title)}</strong><small>${esc(row.supporting)}</small><span class="bt-status-chip bt-status-${row.chip.tone}">${esc(row.chip.label)}</span></span>${row.state === "active" ? `<button class="simple-action destructive" data-action="turn-off-link" data-link-id="${esc(row.id)}" type="button" ${shareLinkPending.has(row.id) ? "disabled" : ""}>Turn off</button>` : ""}</div>`;
    const active = rows.filter((r) => r.state === "active"), inactive = rows.filter((r) => r.state !== "active");
    sheet.innerHTML = title + (rows.length ? `<h3>Active</h3>${active.length ? active.map(rowHtml).join("") : `<p class="simple-muted">No active links.</p>`}${inactive.length ? `<h3>Expired or turned off</h3>${inactive.map(rowHtml).join("")}` : ""}` : `<p>You haven't shared any links yet.</p>`) + done;
  } catch { if (current()) sheet.innerHTML = `${title}<p role="alert">Couldn't load shared links. Try again.</p><button class="simple-action secondary" data-action="shared-links" type="button">Try again</button>${done}`; }
}
async function turnOffLink(button) {
  const id = button.dataset.linkId;
  if (!isCoach() || !id || shareLinkPending.has(id)) return;
  shareLinkPending.add(id); button.disabled = true;
  try {
    if (!await confirmDialog({ title: "Turn off this link?", message: "Anyone who opens it will see that the link has expired or was turned off. This can't be undone.", confirmLabel: "Turn off link", destructive: true })) return;
    const { error } = await supabase.rpc("revoke_simple_share_link", { p_link_id: id });
    if (error) throw error;
    say("Link turned off.");
    if (navigation.sheet === "shared-links") await sharedLinksSheet();
  } catch { say("Couldn't turn off the link. Try again."); }
  finally {
    shareLinkPending.delete(id); button.disabled = false;
    for (const control of sheet.querySelectorAll('[data-action="turn-off-link"]')) {
      if (control.dataset.linkId === id) control.disabled = false;
    }
  }
}
async function reloadPlayers() {
  const { data, error } = await supabase.from("players").select("id, name, jersey_number, slug, age_band, bats, throws").eq("team_id", state.teamId).order("name");
  if (error) throw error;
  state.players = data ?? [];
  if (!state.players.some((p) => p.id === state.selected)) state.selected = state.players[0]?.id ?? null;
}
function selectField(id, label, values, selected = "") {
  return `<label>${label}<select id="${id}">${values.map(([value, text]) => `<option value="${esc(value)}" ${value === selected ? "selected" : ""}>${esc(text)}</option>`).join("")}</select></label>`;
}
function addPlayerSheet() {
  if (!isCoach()) return;
  sheet.innerHTML = `<h2 id="simpleSheetTitle">Add player</h2><label>Name<input id="newPlayerName" required></label><label>Jersey number<input id="newPlayerJersey" required></label>
    ${selectField("newPlayerAge", "Age band", [["", "Unknown"], ...Object.entries(AGE_BAND_LABELS)])}
    ${selectField("newPlayerBats", "Bats", [["", "Unknown"], ["L", "Left"], ["R", "Right"], ["S", "Switch"]])}
    ${selectField("newPlayerThrows", "Throws", [["", "Unknown"], ["L", "Left"], ["R", "Right"]])}
    <p class="simple-error" id="addPlayerError" role="alert"></p><button class="simple-action primary" data-action="save-player" type="button">Save</button><button class="simple-action link" data-action="close-sheet" type="button">Cancel</button>`;
  openSheet("add-player");
}
async function savePlayer(button) {
  if (!isCoach() || button.disabled) return;
  const value = (id) => document.getElementById(id).value.trim();
  const errorNode = document.getElementById("addPlayerError");
  const name = value("newPlayerName"), jersey_number = value("newPlayerJersey");
  errorNode.textContent = "";
  if (!name) { errorNode.textContent = "Enter a player name."; return; }
  if (!jersey_number) { errorNode.textContent = "Enter a jersey number."; return; }
  const base = name.normalize("NFKD").toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "") || "player";
  let slug = base, suffix = 2;
  while (state.players.some((p) => p.slug === slug)) slug = `${base}-${suffix++}`;
  button.disabled = true;
  try {
    const { error } = await supabase.from("players").insert({ team_id: state.teamId, name, jersey_number, slug,
      age_band: value("newPlayerAge") || null, bats: value("newPlayerBats") || null, throws: value("newPlayerThrows") || null });
    if (error) throw error;
    await navigation.dismissSheets();
    await reloadPlayers(); await navigation.goTab("home"); say("Player added.");
  } catch (error) {
    const copy = error?.code === "23505" || /duplicate key/i.test(error?.message ?? "")
      ? "A player with that name already exists on this team." : "Couldn't add the player. Try again.";
    if (dialog.open) errorNode.textContent = copy; else say(copy);
  } finally { button.disabled = false; }
}
function importPlayers() {
  if (!isCoach()) return;
  openRosterImportSheet({ supabase, teamId: state.teamId, existing: state.players, onDone: async ({ created, updated }) => {
    await reloadPlayers(); await navigation.goTab("home");
    say(`Imported ${created} player${created === 1 ? "" : "s"}; updated ${updated} jersey number${updated === 1 ? "" : "s"}. Invite parents from each player's screen.`);
  } });
}
function teamSettingsHtml() {
  if (!isCoach()) return "";
  return `${state.teams.length > 1 ? selectField("coachTeam", "Team", state.teams.map((t) => [t.teams.slug, t.teams.name]), state.teamSlug) : ""}
    <h2>Team details</h2>${selectField("teamSport", "Sport", [["", "Unknown"], ["softball", "Softball"], ["baseball", "Baseball"]], state.sport ?? "")}
    <label>Level<input id="teamLevel" value="${esc(state.level)}"></label><p class="simple-error" role="alert" id="teamDetailsError"></p>
    <button class="simple-action secondary" data-action="save-team" type="button">Save</button>
    <a class="simple-action link" href="./index.html?legacy=1">Legacy coach tools</a>`;
}
async function saveTeam(button) {
  if (!isCoach() || button.disabled) return;
  button.disabled = true;
  const errorNode = document.getElementById("teamDetailsError");
  errorNode.textContent = "";
  const patch = { sport: document.getElementById("teamSport").value || null, level_label: document.getElementById("teamLevel").value.trim() || null };
  try {
    const { error } = await supabase.from("teams").update(patch).eq("id", state.teamId);
    if (error) throw error;
    state.sport = patch.sport; state.guideSport = patch.sport; state.level = patch.level_label;
    say("Team details saved.");
  } catch { errorNode.textContent = "Couldn't save team details. Try again."; }
  finally { button.disabled = false; }
}

async function loadHome() {
  if (isCoach()) return state.tab === "player" ? showPlayer(state.selected) : showHome();
  if (!state.selected) return;
  state.home = await reportApi(state.selected);
  await showHome();
}

function playerControls() {
  if (state.role === "coach") return `<section class="simple-card"><h2>Roster</h2>${state.players.map((player) =>
    `<div class="simple-roster-row"><button class="simple-row" data-player="${esc(player.id)}" type="button"><span><strong>${esc(player.name)}</strong><small>${state.demo ? "Open full report" : player.id === state.selected ? "Selected player" : "Open reports and progress"}</small></span><span aria-hidden="true">›</span></button>
      ${state.demo ? "" : `<button class="simple-action link" data-action="invite-parent" data-invite-player="${esc(player.id)}" type="button">Invite parent</button>`}</div>`).join("")}
</section>`;
  if (state.players.length < 2) return "";
  return `<div class="simple-switcher" role="group" aria-label="Choose a child">${state.players.map((player) =>
    `<button type="button" data-player="${esc(player.id)}" aria-pressed="${player.id === state.selected}">${esc(player.name)}</button>`).join("")}</div>`;
}

async function queueBanner() {
  if (!state.userId) return "";
  const pending = await queuedCaptures(state.userId);
  if (!pending.length) return "";
  return `<section class="simple-card"><strong>${pending.length} video${pending.length === 1 ? "" : "s"} waiting to send</strong>
    <p class="simple-muted">Uploads resume when this device is online and HitterLoop is open.</p>
    ${pending.some((item) => item.error) ? `<p class="simple-error">${esc(pending.find((item) => item.error)?.error)}</p>` : ""}
    <button class="simple-action secondary" data-action="retry" type="button">Retry now</button></section>`;
}

async function showHome() {
  if (isCoach()) return showTeam();
  return renderFeed(false);
}
async function renderFeed(playerView = false) {
  setTab(playerView ? "player" : "home");
  const home = state.home;
  if (!home) return;
  const screen = state.tab;
  const playerId = state.selected;
  const banner = await queueBanner();
  if (state.tab !== screen || state.selected !== playerId) return;
  root.innerHTML = `${playerView ? appBar(state.players.find((p) => p.id === playerId)?.name, `#${state.players.find((p) => p.id === playerId)?.jersey_number ?? "–"} · ${state.teamName}`, true)
    : `<span class="simple-eyebrow">Home</span><h1>${esc(home.playerName)}</h1>${playerControls()}`}
    ${state.demo ? `<section class="simple-card"><p><strong>Public demo</strong></p><p class="simple-muted">Explore automatic reports and progress using a privacy-reviewed example. Changes are disabled and reset for each visitor.</p></section>`
      : `<button class="simple-action primary" data-action="record" type="button">Record at-bat</button>`}
    ${banner}
    ${home.progress?.current ? `<button class="simple-row simple-card" data-action="progress" type="button"><span><strong>Working on ${esc(home.progress.current.title ?? home.progress.current.concept.replaceAll("_", " "))}</strong><small>See progress</small></span><span aria-hidden="true">›</span></button>` : ""}
    <section class="simple-card"><h2>Recent at-bats</h2>${home.feed?.length ? home.feed.map((item) =>
      `<button class="simple-row" ${item.status === "deletion_pending" ? `data-retry-delete="${esc(item.id)}" data-entry-id="${esc(item.entryId)}"` : `data-clip="${esc(item.id)}"`} type="button"><span><strong>${esc(item.headline ?? statusText(item.status))}</strong><small>${esc(shortDate(item.date))} · ${item.kind === "practice" ? "Practice" : "Game"}${item.experimental ? " · Experimental" : ""}</small></span><span class="simple-progress-percent">${esc(processingProgressText(item))}</span></button>`).join("")
      : `<p>Film an at-bat to get your first report.</p><button class="simple-action link" data-action="guide" type="button">How to film</button>`}</section>`;
  if (playerView) {
    const cached = parentsCache?.playerId === playerId ? parentsCache.html : null;
    root.insertAdjacentHTML("beforeend", `<section class="simple-card" id="parentsCard"><h2>Parents</h2>${cached ?? '<p class="simple-muted">Loading…</p>'}</section>`);
    root.insertAdjacentHTML("beforeend", playerDetailsCard(playerId));
    if (!cached) await loadParents(playerId);
  }
  scheduleHomeRefresh();
}

const feedShowing = () => state.tab === "player" && isCoach() || state.tab === "home" && !isCoach();
function scheduleHomeRefresh() {
  if (homeRefreshTimer !== null) clearTimeout(homeRefreshTimer);
  homeRefreshTimer = null;
  const active = state.home?.feed?.some((item) => ["pending", "processing"].includes(item.status));
  if (!active || !feedShowing() || document.visibilityState === "hidden") return;
  homeRefreshTimer = setTimeout(() => {
    homeRefreshTimer = null;
    refreshHome().catch((error) => { say(userErrorMessage(error, { shared: state.shared, online: navigator.onLine })); scheduleHomeRefresh(); });
  }, 3000);
}

// A background refresh must not pull the person back to Home if they opened a
// report or switched child while the request was in flight.
async function refreshHome() {
  if (!feedShowing() || document.visibilityState === "hidden" || !state.selected) return;
  const playerId = state.selected;
  const home = await reportApi(playerId);
  if (!feedShowing() || state.selected !== playerId) return;
  state.home = home;
  await renderFeed(isCoach());
}

function drillCard(drill) {
  const demo = eurl(drill.demoUrl);
  return `<details class="simple-card simple-drill"><summary><span><strong>${esc(drill.name)}</strong><small>Best for: ${esc(drill.bestFor)}</small><small>${esc(drill.equipment || "No equipment")}${drill.homeFriendly ? " · Home friendly" : ""}${drill.requiresScreen ? " · Protective screen required" : ""}</small></span>${icon("chevron-down", { className: "simple-disclosure-chevron" })}</summary>
    ${drill.instructions ? `<p>${esc(drill.instructions)}</p>` : ""}
    ${drill.cue ? `<p><strong>Say:</strong> ${esc(drill.cue)}</p>` : ""}
    ${drill.looksRightWhen ? `<p><strong>Looks right when:</strong> ${esc(drill.looksRightWhen)}</p>` : ""}
    ${drill.commonMistakes?.length ? `<p><strong>Watch out for:</strong> ${esc(drill.commonMistakes.join("; "))}</p>` : ""}
    ${demo ? `<a href="${demo}" target="_blank" rel="noopener noreferrer">Watch demo${drill.demoTimestamp ? ` at ${esc(drill.demoTimestamp)}` : ""}</a>` : ""}
    ${drill.sourceCredit ? `<p class="simple-muted">Credit: ${esc(drill.sourceCredit)}</p>` : ""}</details>`;
}

function seekTo(video, time) {
  return new Promise((resolve, reject) => {
    const cleanup = () => {
      video.removeEventListener("error", fail);
      video.removeEventListener("loadedmetadata", seek);
      video.removeEventListener("seeked", done);
    };
    const done = () => { cleanup(); resolve(); };
    const fail = () => { cleanup(); reject(new Error("Video couldn't load. Refresh and try again.")); };
    const seek = () => {
      const at = Math.max(0, Math.min(time, video.duration || time));
      if (Math.abs(video.currentTime - at) < 0.04) { done(); return; }
      video.addEventListener("seeked", done, { once: true });
      try { video.currentTime = at; } catch (error) { cleanup(); reject(error); }
    };
    if (video.error) { fail(); return; }
    video.addEventListener("error", fail, { once: true });
    if (video.readyState >= 1) seek();
    else video.addEventListener("loadedmetadata", seek, { once: true });
  });
}

async function showReport(clipId, token = null, preloaded = null) {
  stopReportRefresh();
  say("");
  const generation = reportRefreshGeneration;
  const playerId = state.selected;
  const startingSheet = navigation.sheet;
  const data = preloaded ?? await reportApi(state.selected, clipId, token);
  if (generation !== reportRefreshGeneration || playerId !== state.selected
    || (state.tab !== "report" && navigation.sheet !== startingSheet)) return;
  // A newly opened report starts at its title bar; in-place refreshes keep the reader's position.
  const opening = navigation.view.hl !== "report";
  navigation.openReport(clipId);
  if (opening) window.scrollTo(0, 0);
  state.report = { ...data, clipId };
  setTab("report");
  const report = data.report;
  const presentation = parsePresentation(data.presentation);
  const copy = presentationCopy(presentation);
  // Experimental v2 clips retain their labelled renderer and development-only fallback.
  if (data.experimental) {
    const canAct = !state.shared && !state.demo;
    root.innerHTML = `${reportAppBar(data, clipId)}${experimentalReportHtml(data, { esc, canAct, pendingText: pendingReportText(data) })}
      ${canAct ? `<div class="simple-actions">
      <button class="simple-action destructive" data-action="delete" type="button">Delete at-bat</button></div>` : ""}`;
    prepareReportVideo(clipId, token);
    if (experimentalStillPending(data)) scheduleReportRefresh(clipId, token);
    return;
  }
  if (presentation?.analysisState === "no_swing") {
    root.innerHTML = `${reportAppBar(data, clipId)}<h2 class="simple-cue">No swing to analyze in this at-bat.</h2>
      ${data.videoUrl ? `<video id="reportVideo" class="simple-video" src="${esc(data.videoUrl)}" controls playsinline></video>` : ""}
      <div class="simple-card"><p>This at-bat stays in the feed. The result choice did not decide whether a swing happened.</p></div>
      <div id="captureSummaryHost"></div>
      ${state.shared || state.demo ? "" : `<div class="simple-actions"><button class="simple-action secondary" data-action="share-report" type="button">Share</button>
      <button class="simple-action destructive" data-action="delete" type="button">Delete at-bat</button></div>`}`;
    prepareReportVideo(clipId, token);
    loadCaptureSummary(clipId).catch(() => {});
    return;
  }
  if (!["supported_finding", "no_supported_issue", "limited"].includes(presentation?.analysisState)) {
    const pending = presentation?.analysisState === "processing";
    const unavailable = pending ? null : unavailablePresentation(data);
    root.innerHTML = `${reportAppBar(data, clipId)}<h2 class="simple-cue">${pending ? "Analyzing…" : esc(unavailable.title)}</h2>
      <div class="simple-card"><p id="processingProgress">${pending ? esc(pendingReportText(data)) : esc(unavailable.reason)}</p>${unavailable?.showFilmingTip ? `<button class="simple-action link" data-action="guide" type="button">How to film next time</button>` : ""}</div>
      <div id="captureSummaryHost"></div>
      ${data.videoUrl ? `<video id="reportVideo" class="simple-video" src="${esc(data.videoUrl)}" controls playsinline></video>` : ""}
      ${state.shared || state.demo ? "" : `<div class="simple-actions">
      <button class="simple-action destructive" data-action="delete" type="button">Delete at-bat</button></div>`}`;
    prepareReportVideo(clipId, token);
    loadCaptureSummary(clipId).catch(() => {});
    if (pending) scheduleReportRefresh(clipId, token);
    return;
  }
  const shownFix = presentation.fixState === "shown" && report?.fix;
  root.innerHTML = `${reportAppBar(data, clipId)}
    ${copy.statusLine ? `<p class="simple-status-line" role="note">${icon("info")}<span>${esc(copy.statusLine)}</span></p>` : ""}
    ${data.videoUrl ? `<div class="simple-video-wrap"><video id="reportVideo" class="simple-video" src="${esc(data.videoUrl)}" controls playsinline preload="metadata"></video>
      <button class="simple-action link" data-action="play-video" type="button">Play video</button></div>
      <div class="simple-actions"><button class="simple-action secondary" data-action="half-speed" type="button">½ speed</button></div>` : `<p class="simple-error">Video isn't available yet.</p>`}
    ${presentation.summaryState !== "not_applicable" ? `<section class="simple-card"><h2>How it went</h2><p>${esc(report.summary)}</p></section>` : ""}
    <section class="simple-card"><h2>What looked good</h2>${presentation.strengthsState === "shown" && report.strengths?.length
      ? `<ul class="simple-strength-list">${report.strengths.map((item) => `<li class="simple-strength-item">${icon("check")}<span>${esc(item)}</span></li>`).join("")}</ul>`
      : `<p>${esc(strengthsNoneCopy())}</p>`}</section>
    <section class="simple-card"><h2>One thing to work on</h2>${shownFix
      ? `<h3>${esc(report.fix.issue)}</h3><p>${esc(report.fix.evidence)}</p><p>Say to ${esc(data.playerName.split(" ")[0])}:</p>
        <p class="simple-cue">“${esc(report.fix.coachingCue)}”</p><p><strong>Next time, watch for:</strong> ${esc(report.fix.lookForNext)}</p>`
      : `<p>${esc(copy.body)}</p>`}</section>
    ${shownFix ? `<section><h2>Drills that can help</h2>${report.drills.length ? report.drills.map(drillCard).join("") : `<p>No drill for this yet.</p>`}</section>` : ""}
    ${state.shared || state.demo ? "" : `<div id="captureSummaryHost"></div>${state.role === "coach" ? '<div id="coachAnalysisHost"></div>' : ""}<div class="simple-actions"><button class="simple-action secondary" data-action="share-report" type="button">Share</button>
      ${shownFix ? `<button class="simple-action secondary" data-action="hide-fix" type="button">Doesn't look right</button>` : ""}
      <button class="simple-action destructive" data-action="delete" type="button">Delete at-bat</button></div>`}`;
  prepareReportVideo(clipId, token);
  loadCaptureSummary(clipId).catch(() => {});
  loadCoachAnalysisAction(clipId).catch(() => {});
}

// Keep the same video element and cap automatic URL refresh at one per render.
function prepareReportVideo(clipId, token) {
  retryReportVideo = null;
  const video = document.getElementById("reportVideo");
  if (!video) return;
  const generation = reportRefreshGeneration;
  const playerId = state.selected;
  let attempted = false;
  let pending = false;
  let errorHost = null;
  const current = () => generation === reportRefreshGeneration && state.tab === "report" && state.report?.clipId === clipId;
  const fail = () => {
    if (!current()) return;
    if (!errorHost) {
      errorHost = document.createElement("div");
      errorHost.className = "simple-video-error";
      errorHost.setAttribute("role", "alert");
      video.after(errorHost);
    }
    errorHost.innerHTML = `<p>Video couldn't load.</p><button class="simple-action secondary" data-action="retry-video" type="button">Try again</button>`;
  };
  const refresh = async () => {
    if (pending || !current()) return;
    pending = true;
    attempted = true;
    if (errorHost) errorHost.innerHTML = "";
    try {
      const fresh = await reportApi(playerId, clipId, token);
      if (!current()) return;
      if (!fresh.videoUrl) { fail(); return; }
      video.src = fresh.videoUrl;
      video.load();
    } catch { fail(); }
    finally { pending = false; }
  };
  video.addEventListener("error", () => {
    if (!current()) return;
    // While a fresh URL is being fetched, errors still belong to the old URL; the new one reports its own.
    if (pending) return;
    if (!attempted) void refresh();
    else fail();
  });
  retryReportVideo = refresh;
  if (video.error) void refresh();
}

function openHideReason(issueId) {
  if (!issueId || state.shared || state.demo || hidePending) return;
  hideContext = { issueId, clipId: state.report.clipId, playerId: state.selected };
  hideReasonSheet();
}
function hideReasonSheet() {
  sheet.innerHTML = `<h2 id="simpleSheetTitle">Doesn't look right</h2>
    <div class="simple-actions">${[["not_what_happened", "Not what happened"], ["wrong_kid", "Wrong kid in video"], ["other", "Other"]].map(([reason, label]) =>
      `<button class="simple-action secondary" data-hide-reason="${reason}" type="button">${label}</button>`).join("")}</div>
    <p id="hideError" class="simple-error" role="alert"></p>
    <button class="simple-action link" data-action="close-sheet" type="button">Cancel</button>`;
  openSheet("hide");
}
async function submitHideReason(target) {
  const reason = target.dataset.hideReason;
  if (hidePending || !hideContext || !["not_what_happened", "wrong_kid", "other"].includes(reason)) return;
  const context = hideContext;
  hidePending = true;
  target.disabled = true;
  try {
    const { data, error } = await supabase.functions.invoke("hide-simple-issue", { body: { issueId: context.issueId, reason } });
    if (error || data?.error) throw new Error("Couldn't hide this finding. Try again.");
    // Back may have closed the sheet while the request was in flight.
    if (navigation.sheet === "hide") await navigation.dismissSheets();
    say("Hidden for this report.");
    if (state.tab === "report" && state.report?.clipId === context.clipId && state.selected === context.playerId) {
      await showReport(context.clipId);
    }
    if (state.selected === context.playerId) state.home = await reportApi(context.playerId);
  } catch {
    if (navigation.sheet === "hide") document.getElementById("hideError").textContent = "Couldn't hide this finding. Try again.";
    else say("Couldn't refresh the report. Try again.");
  } finally { hidePending = false; target.disabled = false; }
}

async function deleteReport(target) {
  if (deletePending || !state.report?.clipId) return;
  deletePending = true;
  // The targets are fixed when Delete is tapped: a refresh while the dialog is open replaces
  // state.report, and must never change which clips or at-bat the confirmation deletes.
  const report = Object.freeze({ clipId: state.report.clipId, entryId: state.report.entryId, playerId: state.selected,
    siblings: Object.freeze([...new Set(state.report.entryClipIds ?? [])].filter((id) => id !== state.report.clipId)) });
  let confirmed = false;
  try {
    if (!await confirmDialog({ title: "Delete this at-bat?",
      message: "This deletes the at-bat and all its videos. This can't be undone.",
      confirmLabel: "Delete at-bat", destructive: true })) return;
    confirmed = true;
    // A pending report may have re-rendered while the dialog was open; act on the live button.
    target = root.querySelector?.('[data-action="delete"]') ?? target;
    target.disabled = true;
    target.setAttribute?.("aria-disabled", "true");
    target.textContent = "Deleting…";
    const { siblings } = report;
    let deleted = siblings.some((id) => deletedSiblingIds.has(id));
    if (!navigator.onLine) {
      say(deleted ? "You're offline. Try again when you're back online." : "You're offline. Nothing was deleted.");
      return;
    }
    stopReportRefresh();
    try {
      for (const clipId of [...siblings, report.clipId]) {
        if (deletedSiblingIds.has(clipId)) continue;
        await deleteClip(clipId);
        if (clipId !== report.clipId) deletedSiblingIds.add(clipId);
        deleted = true;
      }
    } catch {
      say(deleted ? "Some videos couldn't be deleted. Try again." : "We couldn't delete this at-bat. Try again.");
      if (state.tab === "report" && state.report?.clipId === report.clipId) {
        prepareReportVideo(report.clipId, state.shared ? params.get("share") : null);
        if (reportStillPending(state.report)) scheduleReportRefresh(report.clipId, null);
      }
      return;
    }
    let cleanupFailed = false;
    try {
      const { error } = await supabase.rpc("delete_simple_at_bat", { p_entry_id: report.entryId });
      cleanupFailed = !!error;
    } catch { cleanupFailed = true; }
    // A feed refresh failure cannot keep a deleted video on the report.
    if (state.home?.feed) state.home.feed = state.home.feed.filter((item) => item.entryId !== report.entryId && item.id !== report.clipId);
    try { state.home = await reportApi(report.playerId); } catch { /* Use the remaining cached feed. */ }
    await navigation.returnFromReport();
    say(cleanupFailed ? "Video deleted, but the empty at-bat record still needs cleanup." : "At-bat deleted.");
  } finally {
    deletePending = false;
    if (confirmed) {
      target.disabled = false;
      target.setAttribute?.("aria-disabled", "false");
      target.textContent = "Delete at-bat";
    }
  }
}

function stopReportRefresh() {
  if (reportRefreshTimer !== null) clearTimeout(reportRefreshTimer);
  reportRefreshTimer = null;
  reportRefreshGeneration += 1;
}

const reportStillPending = (data) => data?.experimental ? experimentalStillPending(data)
  : !!data?.status && !["ready", "no_swing"].includes(data.report?.state) && !["ready", "failed"].includes(data.status);

// While analysis runs, only the percentage text changes in place so a video the
// person is already watching keeps playing; any other change re-renders once.
function scheduleReportRefresh(clipId, token) {
  const generation = reportRefreshGeneration;
  const current = () => generation === reportRefreshGeneration && state.tab === "report" && state.report?.clipId === clipId;
  reportRefreshTimer = setTimeout(async () => {
    reportRefreshTimer = null;
    if (!current() || document.visibilityState === "hidden") return;
    try {
      const data = await reportApi(state.selected, clipId, token);
      if (!current()) return;
      const progressNode = document.getElementById("processingProgress");
      if (!reportStillPending(data) || !progressNode) { await showReport(clipId, token, data); return; }
      state.report = { ...data, clipId };
      progressNode.textContent = pendingReportText(data);
      scheduleReportRefresh(clipId, token);
    } catch (error) {
      if (!current()) return;
      say(userErrorMessage(error, { shared: state.shared, online: navigator.onLine }));
      scheduleReportRefresh(clipId, token);
    }
  }, 3000);
}

async function loadCoachAnalysisAction(clipId) {
  if (state.role !== "coach" || state.demo || state.shared || !clipId) return;
  const { data, error } = await supabase.rpc("coach_analysis_available", { p_clip_id: clipId });
  const host = document.getElementById("coachAnalysisHost");
  if (!error && data === true && host && state.report?.clipId === clipId)
    host.innerHTML = `<a class="simple-action secondary" href="./analysis.html?clip=${encodeURIComponent(clipId)}">Coach analysis</a>`;
}

async function loadCaptureSummary(clipId) {
  if (state.shared || state.demo || !clipId) return;
  const { data, error } = await supabase.rpc("get_clip_capture_summary", { p_clip_id: clipId });
  const host = document.getElementById("captureSummaryHost");
  if (!error && data && state.report?.clipId === clipId && host)
    host.innerHTML = captureSummaryHtml(data, { canCorrect: state.role === "coach" });
}

function correctCaptureSheet() {
  sheet.innerHTML = `<h2 id="simpleSheetTitle">Correct camera view</h2><p>Choose the view actually used for this video. This saves a new correction; it does not change the original upload choice.</p>
    <div class="simple-actions"><button class="simple-action secondary" data-correct-profile="game_backstop" type="button">Game / backstop</button>
    <button class="simple-action secondary" data-correct-profile="open_side_practice" type="button">Open-side practice</button>
    <button class="simple-action secondary" data-correct-profile="unknown_imported" type="button">Not sure</button></div>
    <button class="simple-action link" data-action="close-sheet" type="button">Cancel</button>`;
  openSheet("correction");
}

function progressSentence(progress) {
  const current = progress.current;
  if (progress.summary) return progress.summary;
  if (progress.status === "checking") return "Checking the latest game swings. Try again shortly.";
  if (!current && progress.status === "early_read") return "Keep filming to see a pattern.";
  if (!current && progress.status === "looks_fixed") return "That focus hasn't shown up in the last 4 at-bats. Nice work.";
  if (!current) return "No clear pattern yet. Keep filming game at-bats.";
  if (current.status === "early_read") return current.windowSize < 3
    ? "Keep filming to see a pattern." : "More game swings are needed for a reliable comparison.";
  if (current.status === "improving") return `Showing up less: ${current.seen} of the last ${current.windowSize} at-bats.`;
  return `Still showing up in ${current.seen} of the last ${current.windowSize} at-bats.`;
}

async function showProgress() {
  setTab("progress");
  // Shared progress links render already-loaded data without a player id; only an empty account has neither.
  if (!state.selected && !state.home) { root.innerHTML = `${appBar("Progress", isCoach() ? state.teamName : "")}<section class="simple-card"><p>${isCoach() ? "Add a player to see progress." : "Ask your child's coach for an invite link."}</p></section>`; return; }
  const playerId = state.selected;
  const data = state.home ?? await reportApi(playerId);
  if (state.tab !== "progress" || state.selected !== playerId) return;
  state.home = data;
  const progress = data.progress;
  root.innerHTML = `${appBar("Progress", data.playerName)}${isCoach() && state.players.length > 1 ? `<div class="simple-switcher" role="group" aria-label="Choose a player">${state.players.map((p) => `<button type="button" data-progress-player="${esc(p.id)}" aria-pressed="${p.id === state.selected}">${esc(p.name)}</button>`).join("")}</div>` : ""}
    <section class="simple-card"><h2>Current focus</h2>
      <p class="simple-status bt-status-chip bt-status-${progressTone(progress.status)}">${esc(progressLabel(progress.status))}</p>${progress.current
      ? `<p class="simple-cue">${esc(progress.current.title ?? progress.current.concept.replaceAll("_", " "))}</p>
        ${progress.current.description ? `<p>${esc(progress.current.description)}</p>` : ""}
        <p class="simple-muted">Since ${esc(shortDate(progress.current.startedAt?.slice(0, 10)))}</p>

        <p>${esc(progressSentence(progress))}</p>
        ${progress.practice?.total ? `<p class="simple-muted">In practice: seen in ${esc(progress.practice.seen)} of the last ${esc(progress.practice.total)} readable swings.</p>` : ""}
        <h2>${state.demo ? "Coach-picked drill" : "Drill for this focus"}</h2>${progress.focusDrill ? drillCard(progress.focusDrill) : `<p>No drill for this yet.</p>`}
        ${state.shared || state.demo ? "" : `<button class="simple-action link" data-action="dismiss-focus" type="button">Doesn't look right</button>`}`
      : `<p>${esc(progressSentence(progress))}</p>`}</section>
    ${progress.thenVideo && progress.nowVideo ? `<section class="simple-card"><h2>Then vs. now</h2><p>Watch the two videos side by side. Camera views and timing can differ.</p>
      <div class="simple-compare"><figure><video id="thenVideo" src="${esc(progress.thenVideo.url)}" playsinline preload="metadata"></video><figcaption>${esc(progress.thenLabel ?? "Then")}</figcaption></figure>
      <figure><video id="nowVideo" src="${esc(progress.nowVideo.url)}" playsinline preload="metadata"></video><figcaption>${esc(progress.nowLabel ?? "Now")}</figcaption></figure></div>
      <div class="simple-actions"><button class="simple-action secondary" data-action="play-compare" type="button">Play together</button>
      <button class="simple-action secondary" data-action="refresh-progress" type="button">Refresh videos</button></div></section>` : ""}
    <section class="simple-card"><h2>History</h2>${progress.observations?.length ? progress.observations.map((item) =>
      `<p><strong>${esc(item.status)}</strong> · ${esc(shortDate(item.date))}</p><p>${esc(item.note)}</p>`).join("") : progress.history.length ? progress.history.map((item) =>
      `<p>${esc(item.concept.replaceAll("_", " "))} · ${esc(item.status === "fixed" ? "Looks fixed" : item.status === "dismissed" ? "Dismissed" : item.status.replaceAll("_", " "))} · ${esc(shortDate(item.endedAt?.slice(0, 10)))}</p>`).join("") : `<p>No past focus yet.</p>`}</section>
    ${state.shared || state.demo ? "" : `<button class="simple-action secondary" data-action="share-progress" type="button">Share progress</button>`}`;
  const thenVideo = document.getElementById("thenVideo");
  const nowVideo = document.getElementById("nowVideo");
  if (thenVideo && nowVideo) {
    for (const video of [thenVideo, nowVideo]) video.addEventListener("ended", () => {
      thenVideo.pause(); nowVideo.pause();
      const button = root.querySelector('[data-action="play-compare"]');
      if (button) button.textContent = "Play together";
    });
  }
}

function inviteSheet() {
  sheet.innerHTML = `<h2 id="simpleSheetTitle">Invite parent</h2><p>Send this link only to the parent. It works once and expires in 7 days.</p>
    <input class="simple-invite-link" aria-label="Parent invite link" readonly value="${esc(state.inviteUrl)}">
    <button class="simple-action primary" data-action="copy-invite" type="button">Copy link</button>
    <button class="simple-action link" data-action="close-sheet" type="button">Done</button>`;
  openSheet("invite");
}

function choiceSheet() {
  sheet.innerHTML = `<h2 id="simpleSheetTitle">Record at-bat</h2><p>Film from behind home plate with the whole batter and bat in frame.</p>
    <div class="simple-actions"><button class="simple-action primary" data-action="record-now" type="button">Record now</button>
    <button class="simple-action secondary" data-action="choose-video" type="button">Choose video</button></div>
    <button class="simple-action link" data-action="guide" type="button">How to film</button>
    <button class="simple-action link" data-action="close-sheet" type="button">Cancel</button>`;
  openSheet("choice");
}

function guideSheet() {
  sheet.innerHTML = `<h2 id="simpleSheetTitle">How to film</h2>
    <p class="simple-safety-note" role="note"><strong>Catcher view is not enabled.</strong> Only film from a protected position. Never place a person or unsecured phone behind the plate in a live, unprotected path.</p>
    <p>Sport</p><div class="simple-chip-row" role="group" aria-label="Guide sport">${["baseball", "softball"].map((sport) =>
      `<button type="button" data-guide-sport="${sport}" aria-pressed="${state.guideSport === sport}">${sport === "baseball" ? "Baseball" : "Softball"}</button>`).join("")}</div>
    <p>Camera view</p><div class="simple-chip-row" role="group" aria-label="Guide camera view">${[["game_backstop", "Game / backstop"], ["open_side_practice", "Open-side practice"]].map(([mode, label]) =>
      `<button type="button" data-guide-mode="${mode}" aria-pressed="${state.guideMode === mode}">${label}</button>`).join("")}</div>
    <div class="simple-guide">${captureModeHtml(state.guideMode, state.guideSport)}
      <p class="simple-guide-note">Use even light and a steady mount. A regular high frame rate helps, but this guide does not calibrate the camera. You can skip it and choose an existing video.</p>
      <p class="simple-guide-note">GameChanger clip? Save it to your phone, then tap <strong>Choose video</strong>.</p>
    </div><button class="simple-action primary" data-action="close-sheet" type="button">Got it</button>`;
  openSheet("guide");
}

async function settingsSheet() {
  if (state.demo) {
    sheet.innerHTML = `<h2 id="simpleSheetTitle">Demo</h2><p>This public demo is read-only and resets for each visitor.</p>
      <a class="simple-action secondary" href="${esc(getDemoConfig().returnUrl)}">About HitterLoop</a>
      <button class="simple-action link" data-action="close-sheet" type="button">Done</button>`;
    openSheet("settings");
    return;
  }
  const startingView = navigation.view;
  const startingSheet = navigation.sheet;
  const { data, error } = await supabase.from("user_settings").select("notify_reports").eq("user_id", state.userId).maybeSingle();
  if (navigation.view !== startingView || navigation.sheet !== startingSheet || navigation.busy) return;
  if (error) throw error;
  sheet.innerHTML = `<h2 id="simpleSheetTitle">Settings</h2><label class="simple-setting"><input id="notifyReports" type="checkbox" ${data?.notify_reports !== false ? "checked" : ""}>
    <span><strong>Report notifications</strong><small>Use device notifications when enabled, otherwise email.</small></span></label>
    <button class="simple-action secondary" data-action="guide" type="button">How to film</button>
    ${isCoach() ? '<button class="simple-action secondary" data-action="shared-links" type="button">Shared links</button>' : ""}
    ${teamSettingsHtml()}
    <button class="simple-action secondary" data-action="sign-out" type="button">Sign out</button>
    <button class="simple-action link" data-action="close-sheet" type="button">Done</button>`;
  openSheet("settings");
}

function confirmSheet(files, preserve = false) {
  state.files = files;
  if (!preserve) { state.kind = "game"; state.result = null; state.captureProfile = "unknown_imported"; state.capturePlayer = state.selected; }
  sheet.innerHTML = `<h2 id="simpleSheetTitle">Send ${files.length} video${files.length === 1 ? "" : "s"}</h2>
    <label>Player<select id="capturePlayer" required>${state.players.map((player) =>
      `<option value="${esc(player.id)}" ${player.id === state.capturePlayer ? "selected" : ""}>${esc(player.name)}</option>`).join("")}</select></label>
    <p>Game or practice?</p><div class="simple-chip-row"><button type="button" data-kind="game" aria-pressed="${state.kind === "game"}">Game</button><button type="button" data-kind="practice" aria-pressed="${state.kind === "practice"}">Practice</button></div>
    <p>Camera view (optional)</p><div id="captureProfileChoices" class="simple-chip-row">${profileChoices(state.kind)}</div>
    <p>Result (optional)</p><div class="simple-chip-row">${["Hit", "Out", "Walk", "Strikeout", "Skip"].map((label) =>
      `<button type="button" data-result="${label.toLowerCase()}" aria-pressed="${label.toLowerCase() === (state.result ?? "skip")}">${label}</button>`).join("")}</div>
    <p id="sendError" class="simple-error" role="alert"></p>
    <button class="simple-action primary" data-action="send" type="button">Send</button>
    <button class="simple-action link" data-action="close-sheet" type="button">Cancel</button>`;
  openSheet("confirm");
}

function profileChoices(kind) {
  const known = kind === "game" ? ["game_backstop", "Game / backstop"] : ["open_side_practice", "Open-side practice"];
  return [["unknown_imported", "Not sure"], known].map(([slug, label]) =>
    `<button type="button" data-capture-profile="${slug}" aria-pressed="${state.captureProfile === slug}">${label}</button>`).join("");
}

async function validVideo(file) {
  const dot = file.name.lastIndexOf(".");
  if (!acceptedVideoUpload(dot > 0 ? file.name.slice(dot) : ".mp4", file.type)) throw new Error(VIDEO_UPLOAD_HELP);
  const src = URL.createObjectURL(file);
  try {
    const video = document.createElement("video");
    video.preload = "metadata";
    const duration = await new Promise((resolve, reject) => {
      video.onloadedmetadata = () => resolve(video.duration);
      video.onerror = () => reject(new Error("Couldn't read this video's length."));
      video.src = src;
    });
    if (!Number.isFinite(duration) || duration <= 0 || duration > 180) throw new Error("Choose a video under 3 minutes.");
  } finally { URL.revokeObjectURL(src); }
}

async function sendCaptures(button) {
  button.disabled = true;
  const playerId = document.getElementById("capturePlayer").value;
  try {
    if (!state.players.some((player) => player.id === playerId)) throw new Error("Choose a player.");
    const waiting = await queuedCaptures(state.userId);
    if (state.files.length + waiting.length > 10) throw new Error("Send at most 10 videos at a time, including videos already waiting to upload.");
    for (const file of state.files) await validVideo(file);
    for (const file of state.files) await enqueueCapture({ userId: state.userId, playerId, kind: state.kind,
      result: state.result, captureProfile: state.captureProfile, file });
  } catch (error) {
    const copy = userErrorMessage(error, { shared: state.shared, online: navigator.onLine });
    const inline = document.getElementById("sendError");
    if (dialog.open && inline) inline.textContent = copy;
    else say(copy);
    button.disabled = false;
    return;
  }
  state.selected = playerId;
  await navigation.dismissSheets();
  say("Video queued. Usually ready in a few minutes.");
  try {
    if (!isCoach()) state.home = await reportApi(state.selected);
    await navigation.goTab("home");
    if (isCoach()) await navigation.openPlayer(playerId);
    drainCaptureQueue(state.userId, state.role === "parent", () => refreshHome());
  } catch (error) { say(userErrorMessage(error, { shared: state.shared, online: navigator.onLine })); }
}

async function share(scope) {
  if (state.demo) throw new Error("Sharing is disabled in the public demo.");
  if (!publicAppLink(PUBLIC_APP_ORIGIN, "simple.html")) { say("Sharing isn't set up in this build yet."); return; }
  const { data: token, error } = await supabase.rpc("create_simple_share_link", {
    p_player_id: state.selected, p_scope: scope, p_clip_id: scope === "report" ? state.report?.clipId : null,
  });
  if (error) throw error;
  if (!token) throw new Error("Couldn't create link");
  const url = publicAppLink(PUBLIC_APP_ORIGIN, "simple.html", { share: token });
  if (navigator.share) {
    // Dismissing the share sheet is a choice, not a failure.
    try { await navigator.share({ url }); } catch (error) { if (error?.name === "AbortError") return; throw error; }
  }
  else { await navigator.clipboard.writeText(url); say("Link copied. It expires in 90 days."); }
}

root.addEventListener("click", async (event) => {
  const target = event.target.closest("[data-action],[data-open-player],[data-player-menu],[data-progress-player],[data-player],[data-clip],[data-retry-delete],[data-see-event],[data-hide-issue]");
  if (!target) return;
  try {
    if (isCoach()) {
      if (target.dataset.openPlayer) { await navigation.openPlayer(target.dataset.openPlayer); return; }
      if (target.dataset.playerMenu) { playerMenu(target); return; }
      if (target.dataset.progressPlayer) {
        const id = target.dataset.progressPlayer;
        if (!state.players.some((p) => p.id === id)) return;
        state.selected = id; state.home = null;
        const home = await reportApi(id);
        if (state.tab === "progress" && state.selected === id) { state.home = home; await showProgress(); }
        return;
      }
    }
    if (target.dataset.player) {
      state.selected = target.dataset.player;
      if (state.demo) {
        state.home = await reportApi(state.selected);
        const latest = state.home?.feed?.find((item) => item.id === state.home.featuredClipId)
          ?? state.home?.feed?.find((item) => item.status === "ready");
        if (latest) await showReport(latest.id);
        else say("No completed report is available yet.");
      } else await loadHome();
      return;
    }
    if (target.dataset.retryDelete) {
      await deleteClip(target.dataset.retryDelete);
      const { error } = await supabase.rpc("delete_simple_at_bat", { p_entry_id: target.dataset.entryId });
      await refreshHome();
      say(error && !/delete every video/i.test(error.message)
        ? "Video deleted, but the empty at-bat record still needs cleanup." : "Video deleted.");
      return;
    }
    if (target.dataset.clip) { await showReport(target.dataset.clip, state.shared ? params.get("share") : null); return; }
    if (target.dataset.seeEvent) {
      // Pause on the event's own source frame so the moment stays on screen.
      const video = document.getElementById("reportVideo");
      const at = seekTarget(state.report?.experimental, target.dataset.seeEvent);
      if (video && at !== null) {
        video.pause();
        try { await seekTo(video, at); }
        catch { return; } // The existing video error UI owns failed playback.
        video.scrollIntoView({ block: "center" });
        video.focus({ preventScroll: true });
        const label = eventLabel(state.report.experimental.events.find((item) => item.id === target.dataset.seeEvent));
        // A visually hidden region inside this report: the visible #simpleMessage box would keep the text.
        const live = document.getElementById("seekAnnouncement");
        // Clear first so a second tap on the same moment is announced again.
        if (live) { live.textContent = ""; setTimeout(() => { live.textContent = `Video paused at ${label.charAt(0).toLowerCase()}${label.slice(1)}`; }, 50); }
      }
      return;
    }
    if (target.dataset.hideIssue) { openHideReason(target.dataset.hideIssue); return; }
    switch (target.dataset.action) {
      case "edit-player": editPlayerId = state.selected; editPlayerSheet(); break;
      case "delete-player": await deletePlayer(target); break;
      case "add-player": addPlayerSheet(); break;
      case "import-players": importPlayers(); break;
      case "retry-player": await showPlayer(state.selected); break;
      case "cancel-invites": await cancelInvites(target.dataset.invitePlayer, target); break;
      case "remove-guardian": await removeGuardian(target); break;
      case "record": choiceSheet(); break;
      case "guide": guideSheet(); break;
      case "correct-capture-view": if (state.role === "coach" && state.report?.clipId) correctCaptureSheet(); break;
      case "back": navigation.back(); break;
      case "home": await navigation.goTab("home"); break;
      case "retry-video": await retryReportVideo?.(); break;
      case "play-video": {
        const video = document.getElementById("reportVideo");
        if (video) {
          if (video.ended) video.currentTime = 0;
          await video.play().catch(() => {});
        }
        break;
      }
      case "jump-contact": {
        if (!state.report?.experimental) break;
        const video = document.getElementById("reportVideo");
        const moment = seekTarget(state.report.experimental, "impact_estimate");
        if (video && Number.isFinite(moment)) {
          try { await seekTo(video, Math.max(0, moment - 0.5)); } catch { break; }
          // An interrupted play() (e.g. a second tap) is not an app failure.
          await video.play().catch(() => {});
        }
        break;
      }
      case "progress": await navigation.goTab("progress"); break;
      case "refresh-progress": state.home = await reportApi(state.selected, null, state.shared ? params.get("share") : null); await showProgress(); break;
      case "play-compare": {
        const thenVideo = document.getElementById("thenVideo"); const nowVideo = document.getElementById("nowVideo");
        const pair = [state.home?.progress?.thenVideo, state.home?.progress?.nowVideo];
        if (!thenVideo || !nowVideo || pair.some((item) => !item)) break;
        if (!thenVideo.paused || !nowVideo.paused) {
          thenVideo.pause(); nowVideo.pause(); target.textContent = "Play together"; break;
        }
        if (thenVideo.ended || nowVideo.ended) {
          await Promise.allSettled([seekTo(thenVideo, 0), seekTo(nowVideo, 0)]);
        }
        await Promise.allSettled([thenVideo.play(), nowVideo.play()]);
        target.textContent = "Pause both";
        break;
      }
      case "retry": await drainCaptureQueue(state.userId, state.role === "parent", () => refreshHome()); break;
      case "half-speed": {
        const video = document.getElementById("reportVideo");
        if (video) { video.playbackRate = video.playbackRate === 0.5 ? 1 : 0.5; target.textContent = video.playbackRate === 0.5 ? "Normal speed" : "½ speed"; }
        break;
      }
      case "invite-parent": await inviteParent(target.dataset.invitePlayer, target); break;
      case "hide-fix": openHideReason(state.report?.report?.fix?.id); break;
      case "dismiss-focus": {
        const { error } = await supabase.rpc("dismiss_simple_focus", { p_player_id: state.selected });
        if (error) throw error;
        state.home = await reportApi(state.selected); await showProgress(); break;
      }
      case "retry-experimental": {
        const { error } = await supabase.rpc("retry_experimental_v2_clip", { p_clip_id: state.report.clipId });
        if (error) throw error;
        say("Analysis queued again."); await showReport(state.report.clipId); break;
      }
      case "share-report": await share("report"); break;
      case "share-progress": await share("progress"); break;
      case "delete": await deleteReport(target); break;
    }
  } catch (error) { say(userErrorMessage(error, { shared: state.shared, online: navigator.onLine })); }
});

sheet.addEventListener("click", async (event) => {
  const target = event.target.closest("[data-action],[data-kind],[data-result],[data-guide-mode],[data-guide-sport],[data-capture-profile],[data-correct-profile],[data-hide-reason]");
  if (!target) return;
  if (target.dataset.hideReason) { await submitHideReason(target); return; }
  if (target.dataset.kind) { state.kind = target.dataset.kind; state.captureProfile = "unknown_imported";
    sheet.querySelectorAll("[data-kind]").forEach((button) => button.setAttribute("aria-pressed", button === target ? "true" : "false"));
    sheet.querySelector("#captureProfileChoices").innerHTML = profileChoices(state.kind); }
  if (target.dataset.result) { state.result = target.dataset.result === "skip" ? null : target.dataset.result;
    sheet.querySelectorAll("[data-result]").forEach((button) => button.setAttribute("aria-pressed", button === target ? "true" : "false")); }
  if (target.dataset.captureProfile) { state.captureProfile = target.dataset.captureProfile;
    sheet.querySelectorAll("[data-capture-profile]").forEach((button) => button.setAttribute("aria-pressed", button === target ? "true" : "false")); }
  if (target.dataset.guideMode) { state.guideMode = target.dataset.guideMode; guideSheet();
    sheet.querySelector(`[data-guide-mode="${state.guideMode}"]`)?.focus(); }
  if (target.dataset.guideSport) { state.guideSport = target.dataset.guideSport; guideSheet();
    sheet.querySelector(`[data-guide-sport="${state.guideSport}"]`)?.focus(); }
  if (target.dataset.correctProfile && state.role === "coach" && state.report?.clipId) {
    const { error } = await supabase.rpc("record_clip_capture_profile", {
      p_clip_id: state.report.clipId, p_profile_slug: target.dataset.correctProfile, p_kind: "coach_correction",
    });
    if (error) { say("Camera view could not be corrected."); return; }
    await navigation.dismissSheets(); say("Camera view correction saved.");
    loadCaptureSummary(state.report.clipId).catch(() => {});
  }
  if (target.dataset.action === "shared-links") await sharedLinksSheet();
  if (target.dataset.action === "turn-off-link") await turnOffLink(target);
  if (target.dataset.action === "save-player-details") await savePlayerDetails(target);
  if (target.dataset.action === "back") navigation.back();
  if (target.dataset.action === "save-player") await savePlayer(target);
  if (target.dataset.action === "save-team") await saveTeam(target);
  if (target.dataset.action === "close-sheet") await navigation.dismissSheets();
  if (target.dataset.action === "sign-out") {
    if (state.pushToken) await supabase.rpc("unregister_notification_push_token", { p_token: state.pushToken });
    await signOut(); location.href = "./index.html";
  }
  if (target.dataset.action === "guide") guideSheet();
  if (target.dataset.action === "copy-invite") {
    try { await navigator.clipboard.writeText(sheet.querySelector(".simple-invite-link")?.value ?? ""); say("Invite link copied."); }
    catch { say("Select the link above to copy it."); }
  }
  if (target.dataset.action === "record-now") document.getElementById("recordFile").click();
  if (target.dataset.action === "choose-video") document.getElementById("chooseFiles").click();
  if (target.dataset.action === "send") await sendCaptures(target);
});
sheet.addEventListener("change", async (event) => {
  if (event.target.id === "coachTeam" && isCoach() && state.teams.some((t) => t.teams?.slug === event.target.value)) location.href = `./simple.html?team=${encodeURIComponent(event.target.value)}`;
  if (event.target.id === "capturePlayer") state.capturePlayer = event.target.value;
  if (event.target.id !== "notifyReports") return;
  const { error } = await supabase.from("user_settings").upsert({ user_id: state.userId, notify_reports: event.target.checked });
  if (error) { event.target.checked = !event.target.checked; say("Couldn't save notification setting."); }
  else {
    if (event.target.checked) await setupNativePush(true);
    say("Notification setting saved.");
  }
});

for (const id of ["recordFile", "chooseFiles"]) document.getElementById(id).addEventListener("change", (event) => {
  const files = [...event.target.files];
  event.target.value = "";
  if (files.length) confirmSheet(files);
});
document.querySelectorAll(".simple-nav [data-tab]").forEach((button) => button.addEventListener("click", async () => {
  try {
    if (button.dataset.tab === "record") choiceSheet();
    else await navigation.goTab(button.dataset.tab);
  } catch (error) { say(userErrorMessage(error, { shared: state.shared, online: navigator.onLine })); }
}));
document.getElementById("accountBtn").addEventListener("click", async () => {
  try { await settingsSheet(); } catch (error) { say(userErrorMessage(error, { shared: state.shared, online: navigator.onLine })); }
});
window.addEventListener("online", () => { if (state.userId) drainCaptureQueue(state.userId, state.role === "parent", () => refreshHome()); });
document.addEventListener("visibilitychange", () => {
  if (document.visibilityState === "visible" && feedShowing() && state.userId) refreshHome().catch((error) => say(userErrorMessage(error, { shared: state.shared, online: navigator.onLine })));
  // Only a still-processing report refreshes on return; a finished one keeps its video's place.
  else if (document.visibilityState === "visible" && state.tab === "report" && state.report?.clipId && isProcessing(state.report.status))
    showReport(state.report.clipId, state.shared ? params.get("share") : null).catch((error) => say(userErrorMessage(error, { shared: state.shared, online: navigator.onLine })));
  else scheduleHomeRefresh();
});

async function start() {
  try {
    if (state.demo) document.querySelector('.simple-nav [data-tab="record"]').hidden = true;
    const token = params.get("share");
    if (token) {
      state.shared = true;
      state.selected = params.get("player");
      document.querySelector(".simple-brand").removeAttribute("href");
      document.querySelector(".simple-nav").hidden = true;
      document.getElementById("accountBtn").hidden = true;
      const clipId = params.get("clip");
      const data = await reportApi(state.selected, clipId, token);
      if (data.report) await showReport(clipId, token, data);
      else { state.home = data; await showProgress(); }
      return;
    }
    const { data: { session } } = await supabase.auth.getSession();
    if (!session) { location.href = `./index.html?next=${encodeURIComponent("./simple.html")}`; return; }
    state.userId = session.user.id;
    let team;
    if (state.demo) {
      const { data: demoTeams, error: demoTeamError } = await supabase.from("teams")
        .select("id,slug,name").order("created_at").limit(1);
      if (demoTeamError) throw demoTeamError;
      const selectedDemoTeam = (demoTeams ?? []).find((item) => item.slug === params.get("team")) ?? demoTeams?.[0];
      team = selectedDemoTeam ? { team_id: selectedDemoTeam.id, teams: selectedDemoTeam } : null;
    } else {
      const { data: access, error: accessError } = await supabase.from("coach_team_access").select("team_id, teams(slug, name, sport, level_label)");
      if (accessError) throw accessError;
      state.teams = access ?? [];
      team = (access ?? []).find((item) => item.teams?.slug === params.get("team")) ?? access?.[0];
    }
    if (team) {
      state.role = "coach"; state.teamId = team.team_id; state.teamSlug = team.teams?.slug ?? null;
      state.teamName = team.teams?.name ?? "Team"; state.level = team.teams?.level_label ?? null;
      state.sport = team.teams?.sport ?? null; state.guideSport = state.sport;
      const { data: players, error } = await supabase.from("players").select("id, name, jersey_number, slug, age_band, bats, throws").eq("team_id", team.team_id).order("name");
      if (error) throw error;
      state.players = players ?? [];
    } else {
      state.role = "parent";
      const [{ data: links, error }, { data: version, error: versionError }] = await Promise.all([
        supabase.from("player_guardians").select("player_id, consent_version").eq("user_id", state.userId),
        supabase.rpc("current_guardian_consent_version"),
      ]);
      if (error || versionError || !version) throw error ?? versionError ?? new Error("Couldn't check consent");
      if ((links ?? []).some((link) => link.consent_version !== version)) {
        location.href = "./family.html";
        return;
      }
      state.players = (links ?? []).map((link) => ({ id: link.player_id, name: "Child" }));
    }
    const homeLabel = document.querySelector('.simple-nav [data-tab="home"]');
    if (homeLabel) homeLabel.textContent = isCoach() ? "Team" : "Home";
    if (!state.players.length) {
      if (isCoach()) { await showHome(); if (params.get("clip")) await openCoachClip(params.get("clip")); }
      else root.innerHTML = `<h1>No child linked yet</h1><p>Ask your child's coach for an invite link.</p>`;
      return;
    }
    state.selected = state.players.some((player) => player.id === params.get("player")) ? params.get("player") : state.players[0].id;
    if (state.role === "parent") {
      const summaries = await Promise.all(state.players.map((player) => reportApi(player.id).catch(() => null)));
      state.players.forEach((player, i) => { player.name = summaries[i]?.playerName ?? "Child"; });
    }
    await loadHome();
    if (isCoach() && params.get("player") === state.selected) await navigation.openPlayer(state.selected);
    if (isCoach() && navigation.view.hl === "player" && params.get("clip")) {
      await showReport(params.get("clip"));
    } else if (isCoach() && params.get("clip")) {
      await openCoachClip(params.get("clip"));
    } else if (state.demo && state.role === "coach" && params.get("clip")) {
      const clip = state.home?.feed?.find((item) => item.id === params.get("clip"));
      if (clip) await showReport(clip.id);
    }
    if (!state.demo) {
      const { data: notificationSetting } = await supabase.from("user_settings").select("notify_reports")
        .eq("user_id", state.userId).maybeSingle();
      if (notificationSetting?.notify_reports !== false) setupNativePush(true).catch(() => {});
    }
    const guideKey = `hitterloop-filming-guide-seen:${state.userId}`;
    let showFirstUseGuide = true;
    try { showFirstUseGuide = localStorage.getItem(guideKey) !== "1"; }
    catch { /* Storage can be unavailable in private browsing. */ }
    if (showFirstUseGuide && !state.demo) {
      guideSheet();
      try { localStorage.setItem(guideKey, "1"); } catch { /* The guide remains available in Settings. */ }
    }
    if (!state.demo) drainCaptureQueue(state.userId, state.role === "parent", () => refreshHome());
  } catch (error) {
    const copy = userErrorMessage(error, { shared: state.shared, online: navigator.onLine });
    const expiredShare = state.shared && copy === REPORT_COPY.sharedMissing;
    stopReportRefresh();
    clearTimeout(homeRefreshTimer);
    document.querySelector(".simple-nav").hidden = true;
    document.querySelector(".simple-top").hidden = true;
    say("");
    root.innerHTML = `<h1>${expiredShare ? "Link unavailable" : "Couldn't load HitterLoop"}</h1>
      <p class="simple-error" role="alert">${esc(copy)}</p>
      ${expiredShare ? "" : '<button class="simple-action primary" id="retryInitialLoad" type="button">Try again</button>'}`;
    document.getElementById("retryInitialLoad")?.addEventListener("click", () => location.reload());
    if (copy === REPORT_COPY.offline) window.addEventListener("online", () => location.reload(), { once: true });
  }
}
start();
