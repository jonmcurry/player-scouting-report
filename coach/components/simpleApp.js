import { supabase, escapeHtml, signOut } from "../shared.js";
import { getDemoConfig, isDemoMode } from "../demoConfig.js";
import { enqueueCapture, queuedCaptures, drainCaptureQueue } from "./captureQueue.js";
import { acceptedVideoUpload, VIDEO_UPLOAD_HELP } from "./uploadPolicy.js";
import { deleteClip } from "./clipDeletion.js";
import { demoShowcase } from "./demoShowcase.js";
import { captureModeHtml, captureSummaryHtml } from "./captureGuide.js";
import { experimentalReportHtml, experimentalStillPending, seekTarget } from "./experimentalReport.js";

const root = document.getElementById("simpleRoot");
const message = document.getElementById("simpleMessage");
const dialog = document.getElementById("captureDialog");
const sheet = document.getElementById("captureSheet");
const params = new URLSearchParams(location.search);
const state = { userId: null, role: null, teamId: null, teamSlug: null, sport: null, guideSport: null,
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
function say(text) { message.textContent = text; }
let homeRefreshTimer = null;
let reportRefreshTimer = null;
let reportRefreshGeneration = 0;

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
  if (state.demo && !token) {
    const showcase = demoShowcase(playerId, getDemoConfig().basePath, clipId);
    if (!showcase) throw new Error("Demo report not found");
    return showcase;
  }
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
    `<div class="simple-roster-row"><button class="simple-row" data-player="${esc(player.id)}" type="button"><span><strong>${esc(player.name)}</strong><small>${state.demo ? "Open full report" : player.id === state.selected ? "Selected player" : "Open reports and progress"}</small></span><span aria-hidden="true">›</span></button>
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
    ${home.progress?.current ? `<button class="simple-row simple-card" data-action="progress" type="button"><span><strong>Working on ${esc(home.progress.current.title ?? home.progress.current.concept.replaceAll("_", " "))}</strong><small>See progress</small></span><span aria-hidden="true">›</span></button>` : ""}
    <section class="simple-card"><h2>Recent at-bats</h2>${home.feed?.length ? home.feed.map((item) =>
      `<button class="simple-row" ${item.status === "deletion_pending" ? `data-retry-delete="${esc(item.id)}" data-entry-id="${esc(item.entryId)}"` : `data-clip="${esc(item.id)}"`} type="button"><span><strong>${esc(item.headline ?? statusText(item.status))}</strong><small>${esc(shortDate(item.date))} · ${item.kind === "practice" ? "Practice" : "Game"}${item.experimental ? " · Experimental" : ""}</small></span><span class="simple-progress-percent">${esc(processingProgressText(item))}</span></button>`).join("")
      : `<p>Film an at-bat to get your first report.</p><button class="simple-action link" data-action="guide" type="button">How to film</button>`}</section>`;
  scheduleHomeRefresh();
}

function scheduleHomeRefresh() {
  if (homeRefreshTimer !== null) clearTimeout(homeRefreshTimer);
  homeRefreshTimer = null;
  const active = state.home?.feed?.some((item) => ["pending", "processing"].includes(item.status));
  if (!active || state.tab !== "home" || document.visibilityState === "hidden") return;
  homeRefreshTimer = setTimeout(() => {
    homeRefreshTimer = null;
    refreshHome().catch((error) => { say(error.message); scheduleHomeRefresh(); });
  }, 3000);
}

// A background refresh must not pull the person back to Home if they opened a
// report or switched child while the request was in flight.
async function refreshHome() {
  if (state.tab !== "home" || document.visibilityState === "hidden" || !state.selected) return;
  const playerId = state.selected;
  const home = await reportApi(playerId);
  if (state.tab !== "home" || state.selected !== playerId) return;
  state.home = home;
  await showHome();
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
  stopReportRefresh();
  say("");
  const data = preloaded ?? await reportApi(state.selected, clipId, token);
  state.report = { ...data, clipId };
  setTab("report");
  const report = data.report;
  // Experimental v2 clips have their own report; normal reports are unchanged.
  if (data.experimental) {
    const canAct = !state.shared && !state.demo;
    root.innerHTML = `${experimentalReportHtml(data, { esc, canAct, pendingText: pendingReportText(data) })}
      ${canAct ? `<div class="simple-actions"><button class="simple-action secondary" data-action="home" type="button">Back to Home</button>
      <button class="simple-action secondary" data-action="delete" type="button">Delete at-bat</button></div>` : ""}`;
    if (experimentalStillPending(data)) scheduleReportRefresh(clipId, token);
    return;
  }
  if (report.state === "no_swing") {
    root.innerHTML = `<span class="simple-eyebrow">At-bat report</span><h1>No swing to analyze in this at-bat.</h1>
      ${data.videoUrl ? `<video class="simple-video" src="${esc(data.videoUrl)}" controls playsinline></video>` : ""}
      <div class="simple-card"><p>This at-bat stays in the feed. The result choice did not decide whether a swing happened.</p></div>
      <div id="captureSummaryHost"></div>
      ${state.shared || state.demo ? "" : `<div class="simple-actions"><button class="simple-action secondary" data-action="share-report" type="button">Share</button>
      <button class="simple-action secondary" data-action="delete" type="button">Delete at-bat</button></div>`}`;
    loadCaptureSummary(clipId).catch(() => {});
    return;
  }
  if (report.state !== "ready") {
    const pending = !["ready", "failed"].includes(data.status);
    root.innerHTML = `<span class="simple-eyebrow">At-bat report</span><h1>${pending ? "Analyzing…" : "We couldn't analyze this video"}</h1>
      <div class="simple-card"><p id="processingProgress">${pending ? esc(pendingReportText(data)) : esc(report.reason)}</p>${pending ? "" : `<button class="simple-action link" data-action="guide" type="button">How to film next time</button>`}</div>
      <div id="captureSummaryHost"></div>
      ${data.videoUrl ? `<video class="simple-video" src="${esc(data.videoUrl)}" controls playsinline></video>` : ""}
      ${state.shared || state.demo ? "" : `<div class="simple-actions"><button class="simple-action secondary" data-action="home" type="button">Back to Home</button>
      <button class="simple-action secondary" data-action="delete" type="button">Delete at-bat</button></div>`}`;
    loadCaptureSummary(clipId).catch(() => {});
    if (pending) scheduleReportRefresh(clipId, token);
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
    ${state.shared || state.demo ? "" : `<div id="captureSummaryHost"></div>${state.role === "coach" ? '<div id="coachAnalysisHost"></div>' : ""}<div class="simple-actions"><button class="simple-action secondary" data-action="share-report" type="button">Share</button>
      ${report.fix ? `<button class="simple-action secondary" data-action="hide-fix" type="button">Doesn't look right</button>` : ""}
      <button class="simple-action secondary" data-action="delete" type="button">Delete at-bat</button></div>`}`;
  const video = document.getElementById("reportVideo");
  if (video && Number.isFinite(data.contactTime) && data.contactTime >= 0) {
    prepareContactMarker(video, data.contactTime);
    seekTo(video, Math.max(0, data.contactTime - 0.5)).catch(() => {});
  }
  loadCaptureSummary(clipId).catch(() => {});
  loadCoachAnalysisAction(clipId).catch(() => {});
}

function stopReportRefresh() {
  if (reportRefreshTimer !== null) clearTimeout(reportRefreshTimer);
  reportRefreshTimer = null;
  reportRefreshGeneration += 1;
}

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
      const stillPending = data.experimental ? experimentalStillPending(data)
        : !["ready", "no_swing"].includes(data.report.state) && !["ready", "failed"].includes(data.status);
      if (!stillPending || !progressNode) { await showReport(clipId, token, data); return; }
      state.report = { ...data, clipId };
      progressNode.textContent = pendingReportText(data);
      scheduleReportRefresh(clipId, token);
    } catch (error) {
      if (!current()) return;
      say(error.message);
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
  dialog.showModal();
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
  const data = state.home ?? await reportApi(state.selected);
  state.home = data;
  const progress = data.progress;
  root.innerHTML = `<span class="simple-eyebrow">Progress</span><h1>${esc(data.playerName)}</h1>
    <section class="simple-card"><h2>Current focus</h2>${progress.current
      ? `<p class="simple-cue">${esc(progress.current.title ?? progress.current.concept.replaceAll("_", " "))}</p>
        ${progress.current.description ? `<p>${esc(progress.current.description)}</p>` : ""}
        <p class="simple-muted">Since ${esc(shortDate(progress.current.startedAt?.slice(0, 10)))}</p>
        <p class="simple-status">${esc(progress.current.status === "improving" ? "Improving" : progress.current.status === "early_read" ? "Early read" : progress.current.status === "checking" ? "Checking" : "Still showing up")}</p>
        <p>${esc(progressSentence(progress))}</p>
        ${progress.practice?.total ? `<p class="simple-muted">In practice: seen in ${esc(progress.practice.seen)} of the last ${esc(progress.practice.total)} readable swings.</p>` : ""}
        <h2>${state.demo ? "Coach-picked drill" : "Drill for this focus"}</h2>${progress.focusDrill ? drillCard(progress.focusDrill) : `<p>No drill for this yet.</p>`}
        ${state.shared || state.demo ? "" : `<button class="simple-action link" data-action="dismiss-focus" type="button">Doesn't look right</button>`}`
      : `<p>${esc(progressSentence(progress))}</p>`}</section>
    ${progress.thenVideo && progress.nowVideo ? `<section class="simple-card"><h2>Then vs. now</h2><p>Watch the two videos around contact. Camera views can differ.</p>
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
  sheet.innerHTML = `<h2 id="simpleSheetTitle">How to film</h2>
    <p>Sport</p><div class="simple-chip-row" role="group" aria-label="Guide sport">${["baseball", "softball"].map((sport) =>
      `<button type="button" data-guide-sport="${sport}" aria-pressed="${state.guideSport === sport}">${sport === "baseball" ? "Baseball" : "Softball"}</button>`).join("")}</div>
    <p>Camera view</p><div class="simple-chip-row" role="group" aria-label="Guide camera view">${[["game_backstop", "Game / backstop"], ["open_side_practice", "Open-side practice"]].map(([mode, label]) =>
      `<button type="button" data-guide-mode="${mode}" aria-pressed="${state.guideMode === mode}">${label}</button>`).join("")}</div>
    <div class="simple-guide">${captureModeHtml(state.guideMode, state.guideSport)}
      <p class="simple-guide-note">Use even light and a steady mount. A regular high frame rate helps, but this guide does not calibrate the camera. You can skip it and choose an existing video.</p>
      <p class="simple-guide-note"><strong>Catcher view is not enabled.</strong> Only film from a protected position. Never place a person or unsecured phone behind the plate in a live, unprotected path.</p>
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
  state.kind = "game"; state.result = null; state.captureProfile = "unknown_imported";
  sheet.innerHTML = `<h2 id="simpleSheetTitle">Send ${files.length} video${files.length === 1 ? "" : "s"}</h2>
    <label>Player<select id="capturePlayer">${state.players.map((player) =>
      `<option value="${esc(player.id)}" ${player.id === state.selected ? "selected" : ""}>${esc(player.name)}</option>`).join("")}</select></label>
    <p>Game or practice?</p><div class="simple-chip-row"><button type="button" data-kind="game" aria-pressed="true">Game</button><button type="button" data-kind="practice" aria-pressed="false">Practice</button></div>
    <p>Camera view (optional)</p><div id="captureProfileChoices" class="simple-chip-row">${profileChoices("game")}</div>
    <p>Result (optional)</p><div class="simple-chip-row">${["Hit", "Out", "Walk", "Strikeout", "Skip"].map((label) =>
      `<button type="button" data-result="${label.toLowerCase()}" aria-pressed="${label === "Skip"}">${label}</button>`).join("")}</div>
    <button class="simple-action primary" data-action="send" type="button">Send</button>
    <button class="simple-action link" data-action="close-sheet" type="button">Cancel</button>`;
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
  try {
    const playerId = document.getElementById("capturePlayer").value;
    if (!state.players.some((player) => player.id === playerId)) throw new Error("Choose a player.");
    const waiting = await queuedCaptures(state.userId);
    if (state.files.length + waiting.length > 10) throw new Error("Send at most 10 videos at a time, including videos already waiting to upload.");
    for (const file of state.files) await validVideo(file);
    for (const file of state.files) await enqueueCapture({ userId: state.userId, playerId, kind: state.kind,
      result: state.result, captureProfile: state.captureProfile, file });
    state.selected = playerId;
    dialog.close();
    say("Video queued. Usually ready in a few minutes.");
    await loadHome();
    drainCaptureQueue(state.userId, state.role === "parent", async () => { if (state.tab === "home") await loadHome(); });
  } catch (error) { say(error.message); button.disabled = false; }
}

async function share(scope) {
  if (state.demo) throw new Error("Sharing is disabled in the public demo.");
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
  const target = event.target.closest("[data-action],[data-player],[data-clip],[data-retry-delete],[data-see-event],[data-hide-issue]");
  if (!target) return;
  try {
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
      await loadHome();
      say(error && !/delete every video/i.test(error.message)
        ? "Video deleted, but the empty at-bat record still needs cleanup." : "Video deleted.");
      return;
    }
    if (target.dataset.clip) { await showReport(target.dataset.clip, state.shared ? params.get("share") : null); return; }
    if (target.dataset.seeEvent) {
      // Pause on the event's own source frame so the moment stays on screen.
      const video = document.getElementById("reportVideo");
      const at = seekTarget(state.report?.experimental, target.dataset.seeEvent);
      if (video && at !== null) { video.pause(); await seekTo(video, at); video.scrollIntoView({ block: "center" }); }
      return;
    }
    if (target.dataset.hideIssue) {
      const { error } = await supabase.functions.invoke("hide-simple-issue", { body: { issueId: target.dataset.hideIssue } });
      if (error) throw error;
      await showReport(state.report.clipId); say("Observation hidden for this report."); return;
    }
    switch (target.dataset.action) {
      case "record": choiceSheet(); break;
      case "guide": guideSheet(); break;
      case "correct-capture-view": if (state.role === "coach" && state.report?.clipId) correctCaptureSheet(); break;
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
      case "retry-experimental": {
        const { error } = await supabase.rpc("retry_experimental_v2_clip", { p_clip_id: state.report.clipId });
        if (error) throw error;
        say("Analysis queued again."); await showReport(state.report.clipId); break;
      }
      case "share-report": await share("report"); break;
      case "share-progress": await share("progress"); break;
      case "delete": {
        if (!confirm("Delete this at-bat and all its videos?")) break;
        stopReportRefresh();
        try {
          for (const clipId of state.report.entryClipIds?.length ? state.report.entryClipIds : [state.report.clipId]) await deleteClip(clipId);
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
  const target = event.target.closest("[data-action],[data-kind],[data-result],[data-guide-mode],[data-guide-sport],[data-capture-profile],[data-correct-profile]");
  if (!target) return;
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
    dialog.close(); say("Camera view correction saved.");
    loadCaptureSummary(state.report.clipId).catch(() => {});
  }
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
document.addEventListener("visibilitychange", () => {
  if (document.visibilityState === "visible" && state.tab === "home" && state.userId) refreshHome().catch((error) => say(error.message));
  // Only a still-processing report refreshes on return; a finished one keeps its video's place.
  else if (document.visibilityState === "visible" && state.tab === "report" && state.report?.clipId && isProcessing(state.report.status))
    showReport(state.report.clipId, state.shared ? params.get("share") : null).catch((error) => say(error.message));
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
      const { data: access, error: accessError } = await supabase.from("coach_team_access").select("team_id, teams(slug, name, sport)");
      if (accessError) throw accessError;
      team = (access ?? []).find((item) => item.teams?.slug === params.get("team")) ?? access?.[0];
    }
    if (team) {
      state.role = "coach"; state.teamId = team.team_id; state.teamSlug = team.teams?.slug ?? null;
      state.sport = team.teams?.sport ?? null; state.guideSport = state.sport;
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
    if (state.role === "coach" && params.get("clip")) {
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
    if (!state.demo) drainCaptureQueue(state.userId, state.role === "parent", () => loadHome());
  } catch (error) { root.innerHTML = `<h1>Couldn't load HitterLoop</h1><p class="simple-error">${esc(error.message)}</p>`; }
}
start();
