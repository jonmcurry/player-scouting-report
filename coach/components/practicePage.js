import {
  L, supabase, qs, loadContext, renderHeader, loadPriorities, loadDrillLibrary,
  loadDrillAssignments, emptyState, escapeHtml, toast, fmtDate, openSheet,
  statusChip, confirmDialog, showSnackbar,
} from "./devUi.js";
import { openObservationSheet, openFollowUpSheet } from "./devActions.js";
import { uploadRawClip } from "./videoUpload.js";
import { renderDrillInAppBar } from "./appShell.js";
import { icon, openOverflowMenu } from "./ui.js";
import { getDemoConfig } from "../demoConfig.js";
import {
  existingSessionForDate, practicePrimaryAction, practiceProgression,
  practiceStartDefaults, repPrimaryAction,
} from "./phase2aScreens.js";

let ctx;
let sessions = [];
let session = null;
let reps = [];
let priorities = [];
let library = [];
let assignments = [];
let analyzed = new Set();
let currentGroup = null;
let assessmentChoice = null;
let assessmentInView = false;
let assessmentObserver = null;
const returnedFromCompare = qs("assessing") === "1" || /\/compare\.html(?:[?#]|$)/.test(document.referrer);

const today = () => new Date().toISOString().slice(0, 10);
const opt = (value, label, selected = false) => `<option value="${escapeHtml(value)}" ${selected ? "selected" : ""}>${escapeHtml(label)}</option>`;
const closeSheet = async (sheet) => { sheet.querySelector(".close-btn")?.click(); await sheet.whenClosed; };

export async function startPracticePage() {
  try {
    ctx = await loadContext();
    if (!ctx) return;
    await renderHeader(ctx, "practice");
    [priorities, library] = await Promise.all([
      loadPriorities(ctx.player.id, ["active", "monitoring"]),
      loadDrillLibrary(ctx.team.id),
    ]);
    assignments = await loadDrillAssignments(priorities.map((priority) => priority.id));
    await loadSessions();
    document.getElementById("loading").hidden = true;
    document.getElementById("content").hidden = false;
    const id = qs("session");
    if (id && sessions.some((row) => row.id === id)) await openSession(id);
    else {
      renderPicker();
      if (qs("start") === "1") {
        openNewSession();
        const url = new URL(location.href);
        url.searchParams.delete("start");
        history.replaceState(history.state, "", url);
      }
    }
  } catch (error) {
    console.error(error);
    document.getElementById("loading").textContent = "Couldn't load practice. Check your connection and try again.";
  }
}

async function loadSessions() {
  const { data, error } = await supabase.from("practice_sessions")
    .select("*, practice_repetitions(id), player_priorities:focus_priority_id(title), drill_library:assigned_drill_id(name)")
    .eq("player_id", ctx.player.id).order("session_date", { ascending: false });
  if (error) throw error;
  sessions = data ?? [];
}

function renderPicker() {
  session = null;
  document.getElementById("sessionView").hidden = true;
  const picker = document.getElementById("picker");
  picker.hidden = false;
  const todaySession = existingSessionForDate(sessions, today());
  picker.innerHTML = `
    <section class="bt-card p2a-practice-list-head"><div><h1>Practice</h1><p>${todaySession ? "Today's session is ready to continue." : "Start with the player's current focus and drill."}</p></div>
      <button class="bt-button bt-button-primary" id="newSession">${todaySession ? "Continue today's session" : "Start practice"}</button></section>
    <h2 class="p2a-section-label">Recent sessions</h2>
    <div class="bt-list">${sessions.length ? sessions.map((row) => `
      <button class="bt-list-row p2a-session-row" data-sid="${row.id}">
        <span class="bt-list-row-copy"><span class="bt-list-row-title">${fmtDate(row.session_date)}</span>
          <span class="bt-list-row-supporting">${row.practice_repetitions.length} rep${row.practice_repetitions.length === 1 ? "" : "s"}${row.player_priorities?.title ? ` · ${escapeHtml(row.player_priorities.title)}` : " · No focus"}${row.drill_library?.name ? ` · ${escapeHtml(row.drill_library.name)}` : ""}</span></span>
        ${row.outcome ? statusChip(row.outcome, { domain: "practice" }) : '<span class="bt-caption">No assessment</span>'}${icon("chevron-right", { size: 20 })}</button>`).join("")
      : emptyState("No practice yet", "Start a session to work on a priority.", '<button class="bt-button bt-button-secondary" id="emptyStart">Start practice</button>')}</div>`;
  picker.onclick = (event) => {
    const row = event.target.closest("[data-sid]");
    if (row) openSession(row.dataset.sid);
  };
  document.getElementById("newSession").onclick = todaySession ? () => openSession(todaySession.id) : () => openNewSession();
  document.getElementById("emptyStart")?.addEventListener("click", () => openNewSession());
}

function openNewSession(forceForm = false) {
  const todaySession = existingSessionForDate(sessions, today());
  if (todaySession && !forceForm) {
    const sheet = openSheet("Continue practice", `<p>You already have a session today.</p><p class="bt-supporting">Continue it instead of creating a duplicate.</p><button class="bt-button bt-button-tertiary" id="differentDate">Choose another date</button>`, '<button class="bt-button bt-button-primary" id="continueToday">Continue today\'s session</button>');
    sheet.querySelector("#continueToday").onclick = async () => { await closeSheet(sheet); await openSession(todaySession.id); };
    sheet.querySelector("#differentDate").onclick = async () => { await closeSheet(sheet); openNewSession(true); };
    return;
  }
  const defaults = practiceStartDefaults({ priorities, assignments, requestedPriorityId: qs("priority") });
  const sheet = openSheet("Start practice", `
    <div class="dev-field"><label>Focus</label><select id="nPri"><option value="">No specific focus</option>${priorities.map((p) => opt(p.id, p.title, p.id === defaults.priorityId)).join("")}</select></div>
    <div class="dev-field"><label>Drill</label><select id="nDrill"><option value="">No drill</option>${library.map((d) => opt(d.id, d.name, d.id === defaults.drillId)).join("")}</select></div>
    <button class="bt-button bt-button-tertiary" id="addGoal" ${defaults.goal ? "hidden" : ""}>Add a goal</button>
    <div class="dev-field" id="goalWrap" ${defaults.goal ? "" : "hidden"}><label>Goal</label><input id="nGoal" value="${escapeHtml(defaults.goal)}" placeholder="What should change today?"></div>
    <button class="bt-button bt-button-tertiary" id="changeDate">Today · Change</button>
    <div class="dev-field" id="dateWrap" ${forceForm ? "" : "hidden"}><label>Date</label><input type="date" id="nDate" value="${today()}"></div>`,
  '<button class="bt-button bt-button-primary" id="nSave">Start session</button>');
  const syncPriority = () => {
    const priority = priorities.find((row) => row.id === sheet.querySelector("#nPri").value);
    const assignment = assignments.find((row) => row.player_priority_id === priority?.id && row.active);
    sheet.querySelector("#nDrill").value = assignment?.drill_id ?? "";
    if (!sheet.querySelector("#nGoal").value.trim()) sheet.querySelector("#nGoal").value = priority?.description ?? "";
  };
  sheet.querySelector("#nPri").addEventListener("change", syncPriority);
  sheet.querySelector("#addGoal").onclick = () => { sheet.querySelector("#goalWrap").hidden = false; sheet.querySelector("#addGoal").hidden = true; sheet.querySelector("#nGoal").focus(); };
  sheet.querySelector("#changeDate").onclick = () => { sheet.querySelector("#dateWrap").hidden = false; sheet.querySelector("#changeDate").hidden = true; };
  sheet.querySelector("#nSave").onclick = async () => {
    const date = sheet.querySelector("#nDate").value;
    if (!date) return toast("Pick a date.");
    const existing = existingSessionForDate(sessions, date);
    if (existing) {
      await closeSheet(sheet);
      toast("Continuing the existing session for that date.");
      return openSession(existing.id);
    }
    const { data, error } = await supabase.from("practice_sessions").insert({
      player_id: ctx.player.id,
      session_date: date,
      focus_priority_id: sheet.querySelector("#nPri").value || null,
      assigned_drill_id: sheet.querySelector("#nDrill").value || null,
      session_goal: sheet.querySelector("#nGoal").value.trim(),
    }).select("id").single();
    if (error) return toast(`Couldn't create: ${error.message}`);
    await closeSheet(sheet);
    await loadSessions();
    await openSession(data.id);
  };
}

async function openSession(id) {
  session = sessions.find((row) => row.id === id);
  currentGroup = null;
  assessmentChoice = session?.outcome ?? null;
  history.replaceState(null, "", ctx.url("session", { session: id }));
  document.getElementById("picker").hidden = true;
  document.getElementById("sessionView").hidden = false;
  document.getElementById("devTabs").hidden = true;
  renderDrillInAppBar(document.getElementById("appBar"), {
    title: `Practice · ${fmtDate(session.session_date)}`,
    backHref: ctx.url("session"),
    backLabel: "All practice sessions",
    overflowItems: [{ label: "Player development", icon: "trending-up", onSelect: () => { location.href = ctx.url("development"); } }],
  });
  await reloadSession();
}

async function reloadSession() {
  const [{ data: fresh, error: sessionError }, { data: repRows, error: repsError }] = await Promise.all([
    supabase.from("practice_sessions").select("*").eq("id", session.id).single(),
    supabase.from("practice_repetitions").select("*, video_clips(id, status, error_message)").eq("practice_session_id", session.id).order("rep_number"),
  ]);
  if (sessionError || repsError) return toast(`Couldn't refresh practice: ${(sessionError || repsError).message}`);
  session = fresh;
  reps = repRows ?? [];
  const readyIds = reps.flatMap((rep) => rep.video_clips.filter((clip) => clip.status === "ready").map((clip) => clip.id));
  analyzed = new Set();
  if (readyIds.length) {
    const { data } = await supabase.from("video_clip_metrics").select("video_clip_id").in("video_clip_id", readyIds);
    (data ?? []).forEach((row) => analyzed.add(row.video_clip_id));
  }
  assessmentChoice = session.outcome ?? assessmentChoice;
  render();
}

const focusPriority = () => priorities.find((priority) => priority.id === session.focus_priority_id) ?? null;
const assignedDrill = () => library.find((drill) => drill.id === session.assigned_drill_id) ?? null;
const repView = (rep) => ({
  id: rep.id,
  grouping: rep.grouping,
  usable: rep.usable,
  hasClip: rep.video_clips.length > 0,
  analyzed: rep.video_clips.some((clip) => analyzed.has(clip.id)),
  clip: rep.video_clips.find((clip) => clip.status === "ready") ?? rep.video_clips[0] ?? null,
  rep,
});

function render() {
  const views = reps.map(repView);
  const progression = practiceProgression(views, currentGroup);
  currentGroup = progression.current;
  renderBrief();
  renderProgression(progression);
  renderReps(views);
  const beforeAfter = renderCompare(views);
  renderAssessment(views, beforeAfter);
  renderNextStep(views);
  renderPrimaryAction(beforeAfter);
}

function renderBrief() {
  document.getElementById("sessionHead").innerHTML = `<section class="bt-card p2a-session-brief">
    <div class="p2a-section-head"><span class="bt-eyebrow">Session plan</span><button class="bt-button bt-button-tertiary" id="editSession">Edit</button></div>
    <div class="p2a-brief-row"><span>Focus</span><strong>${escapeHtml(focusPriority()?.title ?? "No specific focus")}</strong></div>
    <div class="p2a-brief-row"><span>Drill</span><strong>${escapeHtml(assignedDrill()?.name ?? "No drill")}</strong></div>
    <div class="p2a-brief-row"><span>Goal</span><strong>${escapeHtml(session.session_goal || "Add a goal")}</strong></div></section>`;
  document.getElementById("editSession").onclick = openEditSession;
}

function renderProgression(progression) {
  document.getElementById("practiceStepper").innerHTML = `<div class="p2a-practice-stepper" role="tablist" aria-label="Practice progression">${progression.steps.map((step, index) => `
    <button role="tab" aria-selected="${step.key === progression.current}" data-group="${step.key}" class="${step.state}"><span>${index + 1}</span><strong>${step.label}</strong><small>${step.count} rep${step.count === 1 ? "" : "s"}</small></button>`).join('<i aria-hidden="true"></i>')}</div>`;
  document.getElementById("practiceStepper").onclick = (event) => {
    const button = event.target.closest("[data-group]");
    if (!button) return;
    currentGroup = button.dataset.group;
    render();
    document.getElementById("reps").scrollIntoView({ behavior: matchMedia("(prefers-reduced-motion: reduce)").matches ? "auto" : "smooth", block: "start" });
  };
}

function clipState(rep) {
  if (!rep.clip) return '<span class="bt-caption">No video</span>';
  if (rep.clip.status === "ready") return statusChip("ready", { domain: "processing", label: rep.analyzed ? "Analyzed" : "Ready" });
  return statusChip(rep.clip.status, { domain: "processing" });
}

function renderReps(views) {
  const active = views.filter((rep) => rep.grouping === currentGroup).sort((a, b) => Number(b.usable) - Number(a.usable) || a.rep.rep_number - b.rep.rep_number);
  const other = views.filter((rep) => ["free_swing", "other"].includes(rep.grouping));
  const rejected = views.filter((rep) => rep.usable === false).length;
  const row = (rep) => {
    const action = repPrimaryAction(rep);
    const primary = action.key === "review"
      ? `<a class="bt-button bt-button-tertiary" href="${ctx.url("review", { clip: rep.clip.id })}">Review</a>`
      : rep.clip ? '<span class="bt-caption">Open menu</span>' : '<button class="bt-button bt-button-tertiary upload-control" data-rep-action="attach">Attach video</button>';
    return `<div class="bt-list-row p2a-rep-row ${rep.usable === false ? "is-unusable" : ""}" data-rid="${rep.id}">
      <span class="p2a-rep-number">${rep.rep.rep_number}</span><span class="bt-list-row-copy"><span class="bt-list-row-title">Rep ${rep.rep.rep_number}</span>
        <span class="bt-list-row-supporting">${escapeHtml(L.GROUPING_LABELS[rep.grouping])}${rep.usable === false ? " · Rejected" : ""}</span></span>${clipState(rep)}${primary}
      <button class="bt-icon-button" aria-label="More actions for rep ${rep.rep.rep_number}" data-rep-action="menu">${icon("ellipsis-vertical", { size: 22 })}</button></div>`;
  };
  document.getElementById("reps").innerHTML = `<section class="p2a-rep-section"><div class="p2a-section-head"><h2>${escapeHtml(L.GROUPING_LABELS[currentGroup])}</h2>
      <button class="bt-button bt-button-secondary upload-control" id="quickAddRep">Add rep</button></div>
    <p class="bt-caption">${views.filter((rep) => rep.usable !== false).length} usable${rejected ? ` · ${rejected} rejected` : ""} · New reps go to ${escapeHtml(L.GROUPING_LABELS[currentGroup])}</p>
    <div class="bt-list">${active.length ? active.map(row).join("") : emptyState(`No ${L.GROUPING_LABELS[currentGroup].toLowerCase()} reps`, "Add a rep with video when you're ready.")}</div>
    ${other.length ? `<details class="bt-disclosure"><summary><span>Other reps (${other.length})</span></summary><div class="bt-disclosure-body bt-list">${other.map(row).join("")}</div></details>` : ""}</section>`;
  document.getElementById("quickAddRep").onclick = addRepsWithVideo;
  document.getElementById("reps").onclick = onRepClick;
}

function renderCompare(views) {
  const sets = L.beforeAfterSets(views);
  const host = document.getElementById("beforeAfter");
  if (!sets.ready) {
    host.innerHTML = `<section class="bt-card p2a-compare-card">${emptyState(sets.before.length ? "No post-drill swings yet" : "No baseline swings yet", sets.before.length ? "Record a rep after the drill to compare." : "Record a baseline rep before starting the drill.")}</section>`;
    return sets;
  }
  const before = sets.before[0].clip;
  const after = sets.after.at(-1).clip;
  host.innerHTML = `<section class="bt-card p2a-compare-card"><span class="bt-eyebrow">Compare</span><h2>Baseline → post-drill</h2>
    <p>${sets.before.length} baseline and ${sets.after.length} post-drill swing${sets.after.length === 1 ? "" : "s"} are ready.</p>
    <a class="bt-button bt-button-secondary" id="comparePractice" href="${ctx.url("compare", { a: before.id, b: after.id, mode: "video", ...(session.focus_priority_id ? { priority: session.focus_priority_id } : {}) })}">Compare baseline → post-drill</a></section>`;
  return sets;
}

function renderAssessment(views, beforeAfter) {
  document.getElementById("assessment").innerHTML = `<section class="bt-card p2a-assessment"><span class="bt-eyebrow">Coach assessment</span><h2>Did the movement improve?</h2>
    <p class="bt-supporting">This is your call. It is never set automatically.</p>
    <div class="bt-assessment-choices" id="outcomeBtns" role="group" aria-label="Session assessment">${["yes", "no", "mixed", "unclear"].map((value) => `<button data-outcome="${value}" aria-pressed="${assessmentChoice === value}" class="${assessmentChoice === value ? "active" : ""}">${statusChip(value, { domain: "practice" })}</button>`).join("")}</div>
    <div class="dev-field"><label>Coach note (optional)</label><textarea id="outNote" placeholder="What changed during the session?">${escapeHtml(session.outcome_note ?? "")}</textarea></div></section>`;
  document.getElementById("outcomeBtns").onclick = (event) => {
    const button = event.target.closest("[data-outcome]");
    if (!button) return;
    assessmentChoice = button.dataset.outcome;
    document.querySelectorAll("#outcomeBtns [data-outcome]").forEach((choice) => {
      choice.classList.toggle("active", choice === button);
      choice.setAttribute("aria-pressed", String(choice === button));
    });
    renderPrimaryAction(beforeAfter);
  };
  document.getElementById("outNote").addEventListener("input", () => renderPrimaryAction(beforeAfter));
  assessmentObserver?.disconnect();
  assessmentObserver = new IntersectionObserver(([entry]) => {
    const next = entry.intersectionRatio >= 0.5;
    if (next === assessmentInView) return;
    assessmentInView = next;
    renderPrimaryAction(beforeAfter);
  }, { threshold: [0, 0.5, 1] });
  assessmentObserver.observe(document.querySelector(".p2a-assessment"));
}

function renderNextStep(views) {
  const host = document.getElementById("nextStep");
  if (!session.outcome) { host.innerHTML = ""; return; }
  const priority = focusPriority();
  host.innerHTML = `<section class="bt-card p2a-next-step"><span class="bt-eyebrow">Next step</span><h2>${priority ? `Update ${escapeHtml(priority.title)}` : "Return to the coaching plan"}</h2>
    <p>${priority ? "Record what this session means for the priority." : "Choose the next focus on Development."}</p>
    ${priority ? '<button class="bt-button bt-button-primary" id="markPriority">Update priority progress</button>' : `<a class="bt-button bt-button-primary" href="${ctx.url("development")}">Return to Development</a>`}
    <div><button class="bt-button bt-button-tertiary" id="followUp" ${priority ? "" : "hidden"}>Schedule follow-up</button><a class="bt-button bt-button-tertiary" href="${ctx.url("development")}">Development</a></div></section>`;
  document.getElementById("markPriority")?.addEventListener("click", () => {
    const ready = views.filter((rep) => rep.clip?.status === "ready");
    const evidence = ready.filter((rep) => rep.grouping === "post_drill").at(-1) ?? ready.at(-1);
    openObservationSheet(ctx, priority, { clipId: evidence?.clip.id ?? null, repId: evidence?.id ?? null, sessionId: session.id }, reloadSession);
  });
  document.getElementById("followUp")?.addEventListener("click", () => openFollowUpSheet(priority, reloadSession));
}

function renderPrimaryAction(beforeAfter) {
  const hasNote = Boolean(document.getElementById("outNote")?.value.trim());
  const state = practicePrimaryAction({
    hasPostDrill: beforeAfter.ready,
    assessmentSelected: Boolean(assessmentChoice) && assessmentChoice !== session.outcome,
    assessmentSaved: Boolean(session.outcome) && assessmentChoice === session.outcome,
    assessing: assessmentInView || hasNote || returnedFromCompare,
  });
  const host = document.getElementById("practiceActions");
  if (state === "next_step") { host.innerHTML = ""; return; }
  if (state === "finish") {
    const href = document.getElementById("comparePractice")?.href;
    host.innerHTML = `<div class="bt-sticky-action-bar p2a-assessment-actions"><button class="bt-button bt-button-primary" id="finishSession" ${assessmentChoice ? "" : "disabled"}>Finish session</button>${href ? `<a class="bt-button bt-button-secondary" href="${href}">Compare</a>` : ""}${assessmentChoice ? "" : '<span class="bt-caption">Choose how it went</span>'}</div>`;
    document.getElementById("finishSession").onclick = finishSession;
    return;
  }
  if (state === "compare") {
    const href = document.getElementById("comparePractice")?.href;
    host.innerHTML = `<div class="bt-sticky-action-bar"><a class="bt-button bt-button-primary" href="${href}">Compare baseline → post-drill</a></div>`;
    return;
  }
  host.innerHTML = '<div class="bt-sticky-action-bar"><button class="bt-button bt-button-primary upload-control" id="addRepVideo">Add rep with video</button><button class="bt-button bt-button-secondary" id="addRepBare">Add without video</button></div>';
  document.getElementById("addRepVideo").onclick = addRepsWithVideo;
  document.getElementById("addRepBare").onclick = async () => { await addRep(); await reloadSession(); };
}

async function finishSession() {
  if (!assessmentChoice) return toast("Choose Improved, Unchanged, Mixed or Unclear.");
  const { error } = await supabase.from("practice_sessions").update({
    outcome: assessmentChoice,
    outcome_note: document.getElementById("outNote")?.value ?? "",
  }).eq("id", session.id);
  if (error) return toast(`Couldn't save: ${error.message}`);
  toast("Session assessment saved");
  await loadSessions();
  await reloadSession();
}

async function onRepClick(event) {
  const button = event.target.closest("[data-rep-action]");
  const row = event.target.closest("[data-rid]");
  if (!button || !row) return;
  const rep = reps.find((item) => item.id === row.dataset.rid);
  if (button.dataset.repAction === "attach") return attachVideo(rep);
  if (button.dataset.repAction !== "menu") return;
  openOverflowMenu({ title: `Rep ${rep.rep_number}`, anchor: button, items: [
    ...(rep.video_clips.some((clip) => clip.status === "ready") ? [{ label: "Review swing", icon: "video", onSelect: () => { location.href = ctx.url("review", { clip: rep.video_clips.find((clip) => clip.status === "ready").id }); } }] : []),
    ...(getDemoConfig().capabilities.uploads ? [{ label: rep.video_clips.length ? "Add another video" : "Attach video", icon: "camera", onSelect: () => attachVideo(rep) }] : []),
    ...["baseline", "drill", "post_drill"].filter((group) => group !== rep.grouping).map((group) => ({ label: `Move to ${L.GROUPING_LABELS[group]}`, icon: "repeat", onSelect: () => updateRepWithUndo(rep, { grouping: group }, `Moved to ${L.GROUPING_LABELS[group]}`) })),
    { label: rep.usable === false ? "Mark usable" : "Mark unusable", icon: rep.usable === false ? "check" : "x", onSelect: () => updateRepWithUndo(rep, { usable: rep.usable === false }, rep.usable === false ? "Rep marked usable" : "Rep marked unusable") },
    { label: "Delete rep", icon: "trash-2", destructive: true, onSelect: () => deleteRep(rep) },
  ] });
}

async function updateRepWithUndo(rep, patch, message) {
  const previous = Object.fromEntries(Object.keys(patch).map((key) => [key, rep[key]]));
  const { error } = await supabase.from("practice_repetitions").update(patch).eq("id", rep.id);
  if (error) return toast(`Couldn't save: ${error.message}`);
  await reloadSession();
  showSnackbar(message, { actionLabel: "Undo", onAction: async () => { await supabase.from("practice_repetitions").update(previous).eq("id", rep.id); await reloadSession(); } });
}

async function deleteRep(rep) {
  const approved = await confirmDialog({ title: `Delete rep ${rep.rep_number}?`, message: "Its attached video will also be deleted.", confirmLabel: "Delete rep", destructive: true });
  if (!approved) return;
  const { error } = await supabase.from("game_log_entries").delete().eq("id", rep.game_log_entry_id);
  if (error) return toast(`Couldn't delete: ${error.message}`);
  await loadSessions();
  await reloadSession();
}

// Both file-picker chokepoints below (attachVideo, addRepsWithVideo) check
// the centralized demo capability flag before ever creating/clicking the
// OS file/camera picker - same pattern as atbat.html's chooseVideo() and
// videoUpload.js's uploadRawClip() gate, via the one demoConfig.js, never
// a pathname check.
function attachVideo(rep) {
  if (!getDemoConfig().capabilities.uploads) { toast("Uploads are turned off in this demo."); return; }
  const input = document.createElement("input");
  input.type = "file";
  input.accept = "video/*";
  input.onchange = async () => {
    if (!input.files[0]) return;
    toast("Uploading video…");
    try {
      await uploadRawClip(rep.game_log_entry_id, input.files[0], { repId: rep.id });
      toast("Uploaded · processing will start automatically");
      await reloadSession();
    } catch (error) { toast(error.message); }
  };
  input.click();
}

async function addRep() {
  const number = reps.reduce((max, rep) => Math.max(max, rep.rep_number), 0) + 1;
  const { count } = await supabase.from("game_log_entries").select("id", { count: "exact", head: true }).eq("player_id", ctx.player.id).eq("session_type", "practice");
  const { data: entry, error } = await supabase.from("game_log_entries").insert({
    player_id: ctx.player.id,
    session_type: "practice",
    date: session.session_date,
    ab: number,
    session_note: session.session_goal || null,
    position: count ?? 0,
  }).select("id").single();
  if (error) { toast(`Couldn't add rep: ${error.message}`); return null; }
  const { data: rep } = await supabase.from("practice_repetitions").select("*").eq("game_log_entry_id", entry.id).single();
  if (rep && rep.grouping !== currentGroup) await supabase.from("practice_repetitions").update({ grouping: currentGroup }).eq("id", rep.id);
  if (rep) rep.grouping = currentGroup;
  reps.push({ ...rep, video_clips: [] });
  return rep;
}

function addRepsWithVideo() {
  if (!getDemoConfig().capabilities.uploads) { toast("Uploads are turned off in this demo."); return; }
  const input = document.createElement("input");
  input.type = "file";
  input.accept = "video/*";
  input.multiple = true;
  input.onchange = async () => {
    const files = [...input.files];
    for (const [index, file] of files.entries()) {
      toast(`Adding rep ${index + 1} of ${files.length}…`);
      const rep = await addRep();
      if (!rep) break;
      try { await uploadRawClip(rep.game_log_entry_id, file, { repId: rep.id }); }
      catch (error) { toast(`Rep saved, but video failed: ${error.message}`); }
    }
    await loadSessions();
    await reloadSession();
  };
  input.click();
}

function openEditSession() {
  const sheet = openSheet("Session plan", `
    <div class="dev-field"><label>Focus</label><select id="eP"><option value="">No specific focus</option>${priorities.map((p) => opt(p.id, p.title, p.id === session.focus_priority_id)).join("")}</select></div>
    <div class="dev-field"><label>Drill</label><select id="eD"><option value="">No drill</option>${library.map((d) => opt(d.id, d.name, d.id === session.assigned_drill_id)).join("")}</select></div>
    <div class="dev-field"><label>Goal</label><input id="eG" value="${escapeHtml(session.session_goal ?? "")}"></div>
    <div class="dev-field"><label>Notes</label><textarea id="eN">${escapeHtml(session.notes ?? "")}</textarea></div>`,
  '<button class="bt-button bt-button-primary" id="eSave">Save plan</button>');
  sheet.querySelector("#eSave").onclick = async () => {
    const { error } = await supabase.from("practice_sessions").update({
      focus_priority_id: sheet.querySelector("#eP").value || null,
      assigned_drill_id: sheet.querySelector("#eD").value || null,
      session_goal: sheet.querySelector("#eG").value.trim(),
      notes: sheet.querySelector("#eN").value,
    }).eq("id", session.id);
    if (error) return toast(`Couldn't save: ${error.message}`);
    await closeSheet(sheet);
    await loadSessions();
    await reloadSession();
  };
}
