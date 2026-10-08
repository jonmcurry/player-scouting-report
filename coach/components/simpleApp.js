import { supabase, escapeHtml, signOut } from "../shared.js";
import { getDemoConfig, isDemoMode } from "../demoConfig.js";
import { enqueueCapture, queuedCaptures, drainCaptureQueue } from "./captureQueue.js";
import { acceptedVideoUpload, VIDEO_UPLOAD_HELP } from "./uploadPolicy.js";
import { deleteClip } from "./clipDeletion.js";

const root = document.getElementById("simpleRoot");
const message = document.getElementById("simpleMessage");
const dialog = document.getElementById("captureDialog");
const sheet = document.getElementById("captureSheet");
const params = new URLSearchParams(location.search);
const state = { userId: null, role: null, teamId: null, teamSlug: null, players: [], selected: null, home: null,
  report: null, tab: "home", files: [], kind: "game", result: null, shared: false, demo: isDemoMode(), pushToken: null, pushReady: false };

const esc = (value) => escapeHtml(String(value ?? ""));
const eurl = (value) => {
  try { const url = new URL(value); return ["https:", "http:"].includes(url.protocol) ? esc(url.href) : null; }
  catch { return null; }
};
const statusText = (status) => ({ pending: "Uploading…", processing: "Analyzing…", ready: "Ready",
  unreadable: "Couldn't read this one", failed: "Couldn't read this one", no_swing: "No swing", deletion_pending: "Retry delete" })[status] ?? "Analyzing…";
const shortDate = (value) => value ? new Date(`${value}T12:00:00`).toLocaleDateString(undefined, { month: "short", day: "numeric" }) : "";
function say(text) { message.textContent = text; }

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
    button.setAttribute("aria-current", button.dataset.tab === tab ? "page" : "false"));
}

async function reportApi(playerId, clipId = null, token = null) {
  const { data, error } = await supabase.functions.invoke("get-simplified-report", {
    body: { ...(playerId ? { playerId } : {}), ...(clipId ? { clipId } : {}), ...(token ? { token } : {}),
      ...(state.demo ? { demo: true } : {}) },
  });
  if (error || !data || data.error) throw new Error(data?.error ?? error?.message ?? "Couldn't load report");
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

async function loadHome() {
  if (!state.selected) return;
  state.home = await reportApi(state.selected);
  await showHome();
}

function playerControls() {
  if (state.role === "coach") return `<section class="simple-card"><h2>Roster</h2>${state.players.map((player) =>
    `<div class="simple-roster-row"><button class="simple-row" data-player="${esc(player.id)}" type="button"><span><strong>${esc(player.name)}</strong><small>${state.demo ? "Open latest report" : player.id === state.selected ? "Selected player" : "Open reports and progress"}</small></span><span aria-hidden="true">›</span></button>
      ${state.demo ? "" : `<button class="simple-action link" data-action="invite-parent" data-invite-player="${esc(player.id)}" type="button">Invite parent</button>`}</div>`).join("")}
    ${state.demo ? "" : `<p><a href="./team.html?team=${encodeURIComponent(state.teamSlug ?? "")}">Add or import players</a></p>`}</section>`;
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
  setTab("home");
  const home = state.home;
  if (!home) return;
  root.innerHTML = `<span class="simple-eyebrow">Home</span><h1>${esc(home.playerName)}</h1>${playerControls()}
    ${state.demo ? `<section class="simple-card"><p><strong>Public demo</strong></p><p class="simple-muted">Explore automatic reports and progress using a privacy-reviewed example. Changes are disabled and reset for each visitor.</p></section>`
      : `<button class="simple-action primary" data-action="record" type="button">Record at-bat</button>`}
    ${await queueBanner()}
    ${home.progress?.current ? `<button class="simple-row simple-card" data-action="progress" type="button"><span><strong>Working on ${esc(home.progress.current.concept.replaceAll("_", " "))}</strong><small>See progress</small></span><span aria-hidden="true">›</span></button>` : ""}
    <section class="simple-card"><h2>Recent at-bats</h2>${home.feed?.length ? home.feed.map((item) =>
      `<button class="simple-row" ${item.status === "deletion_pending" ? `data-retry-delete="${esc(item.id)}" data-entry-id="${esc(item.entryId)}"` : `data-clip="${esc(item.id)}"`} type="button"><span><strong>${esc(item.headline ?? statusText(item.status))}</strong><small>${esc(shortDate(item.date))} · ${item.kind === "practice" ? "Practice" : "Game"}</small></span><span>${esc(statusText(item.status))}</span></button>`).join("")
      : `<p>Film an at-bat to get your first report.</p><button class="simple-action link" data-action="guide" type="button">How to film</button>`}</section>`;
}

function drillCard(drill) {
  const demo = eurl(drill.demoUrl);
  return `<details class="simple-card simple-drill"><summary><span><strong>${esc(drill.name)}</strong><small>Best for: ${esc(drill.bestFor)}</small><small>${esc(drill.equipment || "No equipment")}${drill.homeFriendly ? " · Home friendly" : ""}${drill.requiresScreen ? " · Protective screen required" : ""}</small></span><span aria-hidden="true">⌄</span></summary>
    ${drill.instructions ? `<p>${esc(drill.instructions)}</p>` : ""}
    ${drill.cue ? `<p><strong>Say:</strong> ${esc(drill.cue)}</p>` : ""}
    ${drill.looksRightWhen ? `<p><strong>Looks right when:</strong> ${esc(drill.looksRightWhen)}</p>` : ""}
    ${drill.commonMistakes?.length ? `<p><strong>Watch out for:</strong> ${esc(drill.commonMistakes.join("; "))}</p>` : ""}
    ${demo ? `<a href="${demo}" target="_blank" rel="noopener noreferrer">Watch demo${drill.demoTimestamp ? ` at ${esc(drill.demoTimestamp)}` : ""}</a>` : ""}
    ${drill.sourceCredit ? `<p class="simple-muted">Credit: ${esc(drill.sourceCredit)}</p>` : ""}</details>`;
}

function contactMarker(time) {
  return Number.isFinite(time) && time >= 0
    ? `<div class="simple-contact-track" aria-label="Contact marker"><span class="simple-contact-dot" hidden></span></div>
      <button class="simple-action link" data-action="jump-contact" type="button">Jump to contact</button>` : "";
}

function prepareContactMarker(video, time) {
  const marker = video?.parentElement?.querySelector(".simple-contact-dot");
  if (!marker) return;
  const place = () => {
    if (!Number.isFinite(video.duration) || time > video.duration) return;
    marker.style.left = `${Math.min(100, time / video.duration * 100)}%`;
    marker.hidden = false;
  };
  if (video.readyState >= 1) place();
  else video.addEventListener("loadedmetadata", place, { once: true });
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
  say("");
  const data = preloaded ?? await reportApi(state.selected, clipId, token);
  state.report = { ...data, clipId };
  setTab("report");
  const report = data.report;
  if (report.state === "no_swing") {
    root.innerHTML = `<span class="simple-eyebrow">At-bat report</span><h1>No swing to analyze in this at-bat.</h1>
      ${data.videoUrl ? `<video class="simple-video" src="${esc(data.videoUrl)}" controls playsinline></video>` : ""}
      <div class="simple-card"><p>This at-bat stays in the feed. The result choice did not decide whether a swing happened.</p></div>
      ${state.shared || state.demo ? "" : `<div class="simple-actions"><button class="simple-action secondary" data-action="share-report" type="button">Share</button>
      <button class="simple-action secondary" data-action="delete" type="button">Delete at-bat</button></div>`}`;
    return;
  }
  if (report.state !== "ready") {
    const pending = !["ready", "failed"].includes(data.status);
    root.innerHTML = `<span class="simple-eyebrow">At-bat report</span><h1>${pending ? "Analyzing…" : "We couldn't analyze this video"}</h1>
      <div class="simple-card"><p>${pending ? "Usually ready in a few minutes." : esc(report.reason)}</p>${pending ? "" : `<button class="simple-action link" data-action="guide" type="button">How to film next time</button>`}</div>
      ${data.videoUrl ? `<video class="simple-video" src="${esc(data.videoUrl)}" controls playsinline></video>` : ""}
      ${state.shared || state.demo ? "" : `<button class="simple-action secondary" data-action="home" type="button">Back to Home</button>`}`;
    return;
  }
  root.innerHTML = `<span class="simple-eyebrow">At-bat report</span><h1>${esc(data.playerName)}</h1>
    ${data.videoUrl ? `<div class="simple-video-wrap"><video id="reportVideo" class="simple-video" src="${esc(data.videoUrl)}" controls playsinline preload="metadata"></video>
      ${contactMarker(data.contactTime)}</div>
      <div class="simple-actions"><button class="simple-action secondary" data-action="half-speed" type="button">½ speed</button>
      <button class="simple-action secondary" data-action="refresh-video" type="button">Refresh video</button></div>` : `<p class="simple-error">Video isn't available yet.</p>`}
    <section class="simple-card"><span class="simple-eyebrow">How it went</span><p>${esc(report.summary)}</p></section>
    <section class="simple-card"><span class="simple-eyebrow">What looked good</span>${report.strengths.length
      ? `<ul>${report.strengths.map((item) => `<li class="simple-strength">✓ ${esc(item)}</li>`).join("")}</ul>`
      : `<p>We couldn't tell what was working from this angle.</p>`}</section>
    <section class="simple-card"><span class="simple-eyebrow">One thing to fix</span>${report.fix
      ? `<h2>${esc(report.fix.issue)}</h2><p>${esc(report.fix.evidence)}</p><p>Say to ${esc(data.playerName.split(" ")[0])}:</p>
        <p class="simple-cue">“${esc(report.fix.coachingCue)}”</p><p><strong>Next time, watch for:</strong> ${esc(report.fix.lookForNext)}</p>`
      : `<p>Nothing clear to fix from this at-bat. Keep filming. Patterns show up over 3+ at-bats.</p>`}</section>
    ${report.fix ? `<section><h2>Drills that can help</h2>${report.drills.length ? report.drills.map(drillCard).join("") : `<p>No drill for this yet.</p>`}</section>` : ""}
    ${state.shared || state.demo ? "" : `<div class="simple-actions"><button class="simple-action secondary" data-action="share-report" type="button">Share</button>
      ${report.fix ? `<button class="simple-action secondary" data-action="hide-fix" type="button">Doesn't look right</button>` : ""}
      <button class="simple-action secondary" data-action="delete" type="button">Delete at-bat</button></div>`}`;
  const video = document.getElementById("reportVideo");
  if (video && Number.isFinite(data.contactTime) && data.contactTime >= 0) {
    prepareContactMarker(video, data.contactTime);
    seekTo(video, Math.max(0, data.contactTime - 0.5)).catch(() => {});
  }
}

function progressSentence(progress) {
  const current = progress.current;
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
  const data = state.home ?? await reportApi(state.selected);
  state.home = data;
  const progress = data.progress;
  root.innerHTML = `<span class="simple-eyebrow">Progress</span><h1>${esc(data.playerName)}</h1>
    <section class="simple-card"><h2>Current focus</h2>${progress.current
      ? `<p class="simple-cue">${esc(progress.current.concept.replaceAll("_", " "))}</p>
        <p class="simple-muted">Since ${esc(shortDate(progress.current.startedAt?.slice(0, 10)))}</p>
        <p class="simple-status">${esc(progress.current.status === "improving" ? "Improving" : progress.current.status === "early_read" ? "Early read" : progress.current.status === "checking" ? "Checking" : "Still showing up")}</p>
        <p>${esc(progressSentence(progress))}</p>
        ${progress.practice?.total ? `<p class="simple-muted">In practice: seen in ${esc(progress.practice.seen)} of the last ${esc(progress.practice.total)} readable swings.</p>` : ""}
        <h2>Drill for this focus</h2>${progress.focusDrill ? drillCard(progress.focusDrill) : `<p>No drill for this yet.</p>`}
        ${state.shared || state.demo ? "" : `<button class="simple-action link" data-action="dismiss-focus" type="button">Doesn't look right</button>`}`
      : `<p>${esc(progressSentence(progress))}</p>`}</section>
    ${progress.thenVideo && progress.nowVideo ? `<section class="simple-card"><h2>Then vs. now</h2><p>Watch the two videos around contact. Camera views can differ.</p>
      <div class="simple-compare"><figure><video id="thenVideo" src="${esc(progress.thenVideo.url)}" playsinline preload="metadata"></video><figcaption>Then</figcaption></figure>
      <figure><video id="nowVideo" src="${esc(progress.nowVideo.url)}" playsinline preload="metadata"></video><figcaption>Now</figcaption></figure></div>
      <div class="simple-actions"><button class="simple-action secondary" data-action="play-compare" type="button">Play together</button>
      <button class="simple-action secondary" data-action="refresh-progress" type="button">Refresh videos</button></div></section>` : ""}
    <section class="simple-card"><h2>History</h2>${progress.history.length ? progress.history.map((item) =>
      `<p>${esc(item.concept.replaceAll("_", " "))} · ${esc(item.status === "fixed" ? "Looks fixed" : item.status === "dismissed" ? "Dismissed" : item.status.replaceAll("_", " "))} · ${esc(shortDate(item.endedAt?.slice(0, 10)))}</p>`).join("") : `<p>No past focus yet.</p>`}</section>
    ${state.shared || state.demo ? "" : `<button class="simple-action secondary" data-action="share-progress" type="button">Share progress</button>`}`;
  const thenVideo = document.getElementById("thenVideo");
  const nowVideo = document.getElementById("nowVideo");
  if (thenVideo && nowVideo) {
    const thenContact = Number.isFinite(progress.thenVideo.contactTime) ? progress.thenVideo.contactTime : 0;
    const nowContact = Number.isFinite(progress.nowVideo.contactTime) ? progress.nowVideo.contactTime : 0;
    const align = (source, destination, sourceContact, destinationContact) => {
      if (source.paused || destination.paused) return;
      const wanted = Math.max(0, Math.min(destination.duration || Infinity,
        source.currentTime - sourceContact + destinationContact));
      if (Math.abs(destination.currentTime - wanted) <= 0.25) return;
      destination.currentTime = wanted;
    };
    thenVideo.addEventListener("timeupdate", () => align(thenVideo, nowVideo, thenContact, nowContact));
    nowVideo.addEventListener("timeupdate", () => align(nowVideo, thenVideo, nowContact, thenContact));
    for (const video of [thenVideo, nowVideo]) video.addEventListener("ended", () => {
      thenVideo.pause(); nowVideo.pause();
      const button = root.querySelector('[data-action="play-compare"]');
      if (button) button.textContent = "Play together";
    });
  }
}

function choiceSheet() {
  sheet.innerHTML = `<h2 id="simpleSheetTitle">Record at-bat</h2><p>Film from behind home plate with the whole batter and bat in frame.</p>
    <div class="simple-actions"><button class="simple-action primary" data-action="record-now" type="button">Record now</button>
    <button class="simple-action secondary" data-action="choose-video" type="button">Choose video</button></div>
    <button class="simple-action link" data-action="guide" type="button">How to film</button>
    <button class="simple-action link" data-action="close-sheet" type="button">Cancel</button>`;
  dialog.showModal();
}

function guideSheet() {
  sheet.innerHTML = `<h2 id="simpleSheetTitle">How to film</h2><div class="simple-guide">
    <div class="simple-guide-step"><svg viewBox="0 0 80 64" aria-hidden="true"><path d="M40 8 65 32 40 56 15 32Z"/><circle cx="40" cy="25" r="4"/><path d="M40 29v12M30 57h20M40 57V46"/></svg><p><strong>Behind home plate</strong><br>Film as straight on as you can. Through the fence is fine; put the lens close to it.</p></div>
    <div class="simple-guide-step"><svg viewBox="0 0 80 64" aria-hidden="true"><rect x="18" y="5" width="44" height="54" rx="4"/><circle cx="40" cy="18" r="5"/><path d="M40 23v18m0-13-14 9m14-9 14 9M40 41 31 53m9-12 9 12M52 22l12-13"/></svg><p><strong>Whole batter in frame</strong><br>Show head to feet, with room for the bat.</p></div>
    <div class="simple-guide-step"><svg viewBox="0 0 80 64" aria-hidden="true"><path d="M10 39h60M16 31v16m24-16v16m24-16v16"/><circle cx="40" cy="20" r="8"/><path d="m37 16 9 4-9 4Z"/></svg><p><strong>Capture the full swing</strong><br>Start before the pitch and stop after the follow-through. A whole at-bat in one clip is fine.</p></div>
    <div class="simple-guide-step"><svg viewBox="0 0 80 64" aria-hidden="true"><rect x="30" y="5" width="20" height="32" rx="3"/><path d="M40 37v9M27 58l13-12 13 12M40 46v12"/></svg><p><strong>Hold steady</strong><br>A fence mount or tripod helps.</p></div>
    <p class="simple-guide-note">GameChanger clip? Save it to your phone, then tap <strong>Choose video</strong>.</p>
  </div><button class="simple-action primary" data-action="close-sheet" type="button">Got it</button>`;
  if (!dialog.open) dialog.showModal();
}

async function settingsSheet() {
  if (state.demo) {
    sheet.innerHTML = `<h2 id="simpleSheetTitle">Demo</h2><p>This public demo is read-only and resets for each visitor.</p>
      <a class="simple-action secondary" href="${esc(getDemoConfig().returnUrl)}">About HitterLoop</a>
      <button class="simple-action link" data-action="close-sheet" type="button">Done</button>`;
    dialog.showModal();
    return;
  }
  const { data, error } = await supabase.from("user_settings").select("notify_reports").eq("user_id", state.userId).maybeSingle();
  if (error) throw error;
  sheet.innerHTML = `<h2 id="simpleSheetTitle">Settings</h2><label class="simple-setting"><input id="notifyReports" type="checkbox" ${data?.notify_reports !== false ? "checked" : ""}>
    <span><strong>Report notifications</strong><small>Use device notifications when enabled, otherwise email.</small></span></label>
    <button class="simple-action secondary" data-action="guide" type="button">How to film</button>
    <button class="simple-action secondary" data-action="sign-out" type="button">Sign out</button>
    <button class="simple-action link" data-action="close-sheet" type="button">Done</button>`;
  dialog.showModal();
}

function confirmSheet(files) {
  state.files = files;
  state.kind = "game"; state.result = null;
  sheet.innerHTML = `<h2 id="simpleSheetTitle">Send ${files.length} video${files.length === 1 ? "" : "s"}</h2>
    <label>Player<select id="capturePlayer">${state.players.map((player) =>
      `<option value="${esc(player.id)}" ${player.id === state.selected ? "selected" : ""}>${esc(player.name)}</option>`).join("")}</select></label>
    <p>Game or practice?</p><div class="simple-chip-row"><button type="button" data-kind="game" aria-pressed="true">Game</button><button type="button" data-kind="practice" aria-pressed="false">Practice</button></div>
    <p>Result (optional)</p><div class="simple-chip-row">${["Hit", "Out", "Walk", "Strikeout", "Skip"].map((label) =>
      `<button type="button" data-result="${label.toLowerCase()}" aria-pressed="${label === "Skip"}">${label}</button>`).join("")}</div>
    <button class="simple-action primary" data-action="send" type="button">Send</button>
    <button class="simple-action link" data-action="close-sheet" type="button">Cancel</button>`;
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
  try {
    const playerId = document.getElementById("capturePlayer").value;
    if (!state.players.some((player) => player.id === playerId)) throw new Error("Choose a player.");
    const waiting = await queuedCaptures(state.userId);
    if (state.files.length + waiting.length > 10) throw new Error("Send at most 10 videos at a time, including videos already waiting to upload.");
    for (const file of state.files) await validVideo(file);
    for (const file of state.files) await enqueueCapture({ userId: state.userId, playerId, kind: state.kind, result: state.result, file });
    state.selected = playerId;
    dialog.close();
    say("Video queued. Usually ready in a few minutes.");
    await loadHome();
    drainCaptureQueue(state.userId, state.role === "parent", async () => { if (state.tab === "home") await loadHome(); });
  } catch (error) { say(error.message); button.disabled = false; }
}

async function share(scope) {
  const { data: token, error } = await supabase.rpc("create_simple_share_link", {
    p_player_id: state.selected, p_scope: scope, p_clip_id: scope === "report" ? state.report?.clipId : null,
  });
  if (error || !token) throw new Error(error?.message ?? "Couldn't create link");
  const url = new URL("./simple.html", location.href);
  url.searchParams.set("share", token);
  if (navigator.share) await navigator.share({ url: url.href });
  else { await navigator.clipboard.writeText(url.href); say("Link copied. It expires in 90 days."); }
}

root.addEventListener("click", async (event) => {
  const target = event.target.closest("[data-action],[data-player],[data-clip],[data-retry-delete]");
  if (!target) return;
  try {
    if (target.dataset.player) {
      state.selected = target.dataset.player;
      await loadHome();
      if (state.demo) {
        const latest = state.home?.feed?.find((item) => item.status === "ready");
        if (latest) await showReport(latest.id);
        else say("No completed report is available yet.");
      }
      return;
    }
    if (target.dataset.retryDelete) {
      await deleteClip(target.dataset.retryDelete);
      const { error } = await supabase.rpc("delete_simple_at_bat", { p_entry_id: target.dataset.entryId });
      await loadHome();
      say(error && !/delete every video/i.test(error.message)
        ? "Video deleted, but the empty at-bat record still needs cleanup." : "Video deleted.");
      return;
    }
    if (target.dataset.clip) { await showReport(target.dataset.clip, state.shared ? params.get("share") : null); return; }
    switch (target.dataset.action) {
      case "record": choiceSheet(); break;
      case "guide": guideSheet(); break;
      case "home": await showHome(); break;
      case "refresh-video": await showReport(state.report.clipId, state.shared ? params.get("share") : null); break;
      case "jump-contact": {
        const video = document.getElementById("reportVideo");
        if (video && Number.isFinite(state.report?.contactTime)) await seekTo(video, state.report.contactTime);
        break;
      }
      case "progress": await showProgress(); break;
      case "refresh-progress": state.home = await reportApi(state.selected, null, state.shared ? params.get("share") : null); await showProgress(); break;
      case "play-compare": {
        const thenVideo = document.getElementById("thenVideo"); const nowVideo = document.getElementById("nowVideo");
        const pair = [state.home?.progress?.thenVideo, state.home?.progress?.nowVideo];
        if (!thenVideo || !nowVideo || pair.some((item) => !item)) break;
        if (!thenVideo.paused || !nowVideo.paused) {
          thenVideo.pause(); nowVideo.pause(); target.textContent = "Play together"; break;
        }
        const offsets = pair.map((item) => Number.isFinite(item.contactTime) ? item.contactTime : 0);
        await Promise.all([seekTo(thenVideo, Math.max(0, offsets[0] - 0.5)), seekTo(nowVideo, Math.max(0, offsets[1] - 0.5))]);
        await Promise.allSettled([thenVideo.play(), nowVideo.play()]);
        target.textContent = "Pause both";
        break;
      }
      case "retry": await drainCaptureQueue(state.userId, state.role === "parent", () => loadHome()); break;
      case "half-speed": {
        const video = document.getElementById("reportVideo");
        if (video) { video.playbackRate = video.playbackRate === 0.5 ? 1 : 0.5; target.textContent = video.playbackRate === 0.5 ? "Normal speed" : "½ speed"; }
        break;
      }
      case "invite-parent": {
        if (state.role !== "coach" || !state.players.some((player) => player.id === target.dataset.invitePlayer)) break;
        const { data: token, error } = await supabase.rpc("create_guardian_invite", {
          p_player_id: target.dataset.invitePlayer, p_relationship: "parent",
        });
        if (error || !token) throw new Error("Couldn't create the invite. Try again.");
        const invite = new URL("./family.html", location.href);
        invite.searchParams.set("invite", token);
        const url = invite.href;
        sheet.innerHTML = `<h2 id="simpleSheetTitle">Invite parent</h2><p>Send this link only to the parent. It works once and expires in 7 days.</p>
          <input class="simple-invite-link" aria-label="Parent invite link" readonly value="${esc(url)}">
          <button class="simple-action primary" data-action="copy-invite" type="button">Copy link</button>
          <button class="simple-action link" data-action="close-sheet" type="button">Done</button>`;
        dialog.showModal();
        break;
      }
      case "hide-fix": {
        const fixId = state.report?.report?.fix?.id;
        if (!fixId) break;
        const { error } = await supabase.functions.invoke("hide-simple-issue", { body: { issueId: fixId } });
        if (error) throw error;
        await showReport(state.report.clipId); state.home = await reportApi(state.selected); say("Fix hidden for this report."); break;
      }
      case "dismiss-focus": {
        const { error } = await supabase.rpc("dismiss_simple_focus", { p_player_id: state.selected });
        if (error) throw error;
        state.home = await reportApi(state.selected); await showProgress(); break;
      }
      case "share-report": await share("report"); break;
      case "share-progress": await share("progress"); break;
      case "delete": {
        if (!confirm("Delete this at-bat and all its videos?")) break;
        try {
          for (const clipId of state.report.entryClipIds ?? [state.report.clipId]) await deleteClip(clipId);
          const { error } = await supabase.rpc("delete_simple_at_bat", { p_entry_id: state.report.entryId });
          if (error) throw error;
          say("At-bat deleted.");
        } finally {
          await loadHome();
        }
        break;
      }
    }
  } catch (error) { say(error.message ?? "Please try again."); }
});

sheet.addEventListener("click", async (event) => {
  const target = event.target.closest("[data-action],[data-kind],[data-result]");
  if (!target) return;
  if (target.dataset.kind) { state.kind = target.dataset.kind; sheet.querySelectorAll("[data-kind]").forEach((button) => button.setAttribute("aria-pressed", button === target ? "true" : "false")); }
  if (target.dataset.result) { state.result = target.dataset.result === "skip" ? null : target.dataset.result;
    sheet.querySelectorAll("[data-result]").forEach((button) => button.setAttribute("aria-pressed", button === target ? "true" : "false")); }
  if (target.dataset.action === "close-sheet") dialog.close();
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
    else if (button.dataset.tab === "progress") await showProgress();
    else await showHome();
  } catch (error) { say(error.message); }
}));
document.getElementById("accountBtn").addEventListener("click", async () => {
  try { await settingsSheet(); } catch (error) { say(error.message); }
});
window.addEventListener("online", () => { if (state.userId) drainCaptureQueue(state.userId, state.role === "parent", () => loadHome()); });

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
      const { data: access, error: accessError } = await supabase.from("coach_team_access").select("team_id, teams(slug, name)");
      if (accessError) throw accessError;
      team = (access ?? []).find((item) => item.teams?.slug === params.get("team")) ?? access?.[0];
    }
    if (team) {
      state.role = "coach"; state.teamId = team.team_id; state.teamSlug = team.teams?.slug ?? null;
      const { data: players, error } = await supabase.from("players").select("id,name").eq("team_id", team.team_id).order("name");
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
    if (!state.players.length) {
      root.innerHTML = state.role === "coach" ? `<h1>No players yet</h1><p><a href="./team.html?team=${esc(team?.teams?.slug)}">Add or import players</a></p>`
        : `<h1>No child linked yet</h1><p>Ask your child's coach for an invite link.</p>`;
      return;
    }
    state.selected = state.players.some((player) => player.id === params.get("player")) ? params.get("player") : state.players[0].id;
    if (state.role === "parent") {
      const summaries = await Promise.all(state.players.map((player) => reportApi(player.id).catch(() => null)));
      state.players.forEach((player, i) => { player.name = summaries[i]?.playerName ?? "Child"; });
    }
    await loadHome();
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
    if (!state.demo) drainCaptureQueue(state.userId, state.role === "parent", () => loadHome());
  } catch (error) { root.innerHTML = `<h1>Couldn't load HitterLoop</h1><p class="simple-error">${esc(error.message)}</p>`; }
}
start();
