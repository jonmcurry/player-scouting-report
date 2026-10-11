import { supabase, requireSession, escapeHtml, qs } from "../shared.js";
import { isDemoMode } from "../demoConfig.js";
import { PHASES, phaseBySlug, phaseAvailability, comparableSetup, syncPoints } from "./coachAnalysisModel.js";

const root = document.getElementById("analysisRoot");
const status = document.getElementById("analysisStatus");
const drawer = document.getElementById("evidenceDrawer");
const drawerBody = document.getElementById("evidenceBody");
const clipId = qs("clip");
let report = null;
let selected = "contact_estimate";
let compared = null;
let syncOffset = null;
let comparisonRequest = 0;
let comparisonLoad = 0;
let comparisonDefinitions = [];
let comparisonVersions = [];
let activeComparisonSet = null;
let selectedDefinitionId = null;
const comparisonOmitted = new Set();
const esc = (value) => escapeHtml(String(value ?? ""));
const phaseLabel = (slug) => PHASES.find(([key]) => key === slug)?.[1] ?? "Phase";
const timeLabel = (value) => value === null || value === undefined ? "Time unavailable" : `${Number(value).toFixed(2)} s`;
const sourceLabel = (source, provider = null) => source === "coach_correction" ? "Entered by coach"
  : source === "pipeline_snapshot" || source === "video_estimated" ? "Estimated from video"
    : source === "video_observed" ? "Observed in video"
      : source === "comparable_video" ? "Calculated from comparable video"
        : source === "external_device" ? `Measured by ${provider || "device"}`
          : source === "coach_entered" ? "Entered by coach" : "Legacy video estimate";
const safeUrl = (value) => {
  try { const url = new URL(value); return url.protocol === "https:" || url.protocol === "http:" ? url.href : null; }
  catch { return null; }
};

async function videoUrl(id) {
  const { data, error } = await supabase.functions.invoke("get-video-url", { body: { videoClipId: id } });
  if (error || !safeUrl(data?.url)) throw new Error("Original video is unavailable.");
  return safeUrl(data.url);
}

async function drawFilmstrip(url) {
  const located = PHASES.map(([slug]) => ({ slug, time: phaseBySlug(report, slug)?.time }))
    .filter((item) => item.time !== null && item.time !== undefined);
  if (!located.length) return;
  const preview = document.createElement("video");
  preview.crossOrigin = "anonymous";
  preview.muted = true;
  preview.preload = "auto";
  const waitFor = (eventName, action = () => {}) => new Promise((resolve, reject) => {
    const cleanup = () => { clearTimeout(timer); preview.removeEventListener(eventName, done); preview.removeEventListener("error", fail); };
    const done = () => { cleanup(); resolve(); };
    const fail = () => { cleanup(); reject(new Error("Preview unavailable")); };
    const timer = setTimeout(fail, 4000);
    preview.addEventListener(eventName, done, { once: true });
    preview.addEventListener("error", fail, { once: true });
    try { action(); } catch { fail(); }
  });
  try {
    await waitFor("loadedmetadata", () => { preview.src = url; });
    const canvas = document.createElement("canvas");
    canvas.width = 120; canvas.height = 80;
    for (const item of located) {
      const frame = root.querySelector(`[data-select-phase="${item.slug}"] .ca-frame-picture`);
      if (!frame) continue;
      const at = Math.min(Number(item.time), Math.max(0, preview.duration - .01));
      if (Math.abs(preview.currentTime - at) >= .01)
        await waitFor("seeked", () => { preview.currentTime = at; });
      canvas.getContext("2d").drawImage(preview, 0, 0, 120, 80);
      frame.style.backgroundImage = `url("${canvas.toDataURL("image/jpeg", .65)}")`;
      frame.textContent = "";
    }
  } catch { /* A text filmstrip remains usable when the media host blocks canvas reads. */ }
  finally { preview.removeAttribute("src"); preview.load(); }
}

function phaseCard(slug, label) {
  const phase = phaseBySlug(report, slug);
  const notes = (report.annotations ?? []).filter((note) => note.slug === slug);
  const available = phase && phase.frame !== null && phase.time !== null;
  const uncertainty = phase?.uncertaintyStatus === "quantified"
    ? `±${esc(phase.uncertaintyFrames)} frame${phase.uncertaintyFrames === 1 ? "" : "s"}`
    : phase?.uncertaintyStatus === "unquantified" ? "Timing uncertainty not measured" : "Timing unavailable";
  return `<section class="bt-card ca-phase" id="phase-${esc(slug)}" data-selected="${slug === selected}">
    <div class="ca-phase-head"><div><span class="bt-eyebrow">${esc(label)}</span><h2>${esc(phaseAvailability(phase))}</h2></div>
      <button type="button" class="bt-button bt-button-secondary" data-seek="${esc(slug)}" ${available ? "" : "disabled"}
        aria-label="Jump original video to ${esc(label)}">Watch moment</button></div>
    <p class="ca-meta">${phase ? `${esc(sourceLabel(phase.source))} · ${esc(timeLabel(phase.time))} · ${esc(uncertainty)}` : "No phase event was recorded."}</p>
    ${phase?.source === "coach_correction" ? `<p class="ca-meta">Corrected by ${esc(phase.correctedBy || "a coach")}. ${esc(phase.reason || "")}</p>` : ""}
    <p>No validated movement observation is attached to this phase yet. Review the original video before drawing a conclusion.</p>
    ${phase ? `<button type="button" class="bt-button bt-button-tertiary" data-phase-evidence="${esc(slug)}">How was this located?</button>` : ""}
    <details class="bt-disclosure"><summary><span>Coach notes (${notes.length})</span></summary><div class="bt-disclosure-body">
      ${notes.length ? notes.map((note) => `<article class="ca-note"><p>${esc(note.body)}</p><small>Entered by ${esc(note.author || "a coach")} · Guardian-visible</small>
        <button type="button" class="bt-button bt-button-tertiary" data-delete-note="${esc(note.id)}" aria-label="Delete coach note for ${esc(label)}">Delete note</button></article>`).join("")
        : "<p>No coach note for this phase.</p>"}
      <form data-note-form="${esc(slug)}"><label for="note-${esc(slug)}">Add a coach note</label>
        <textarea id="note-${esc(slug)}" name="body" maxlength="2000" required></textarea>
        <label for="visibility-${esc(slug)}">Who can see this note</label><select id="visibility-${esc(slug)}" name="visibility">
          <option value="guardian_visible">Guardian-visible</option>
          <option value="staff_private" disabled>Staff-only — unavailable pending privacy approval</option></select>
        <p class="ca-meta">Entered by coach. Staff-only notes need approved privacy and retention rules.</p>
        <button type="submit" class="bt-button bt-button-primary">Save note</button></form></div></details>
  </section>`;
}

function render() {
  const phaseButtons = PHASES.map(([slug, label]) => {
    const phase = phaseBySlug(report, slug);
    const available = phase && phase.frame !== null && phase.time !== null;
    return `<button type="button" class="ca-frame" data-select-phase="${esc(slug)}" aria-pressed="${slug === selected}"
      aria-label="${esc(label)}: ${esc(phaseAvailability(phase))}; ${esc(timeLabel(phase?.time))}">
      <span class="ca-frame-picture" aria-hidden="true">${available ? "▶" : "—"}</span><strong>${esc(label)}</strong><small>${esc(timeLabel(phase?.time))}</small></button>`;
  }).join("");
  const candidates = (report.candidates ?? []).map((candidate) => {
    const gate = comparableSetup(report, candidate);
    return `<option value="${esc(candidate.clipId)}" ${gate.compatible ? "" : "disabled"}>${esc(candidate.date)} · ${esc(candidate.environment)} · ${esc(candidate.profile || "view unknown")}${gate.compatible ? "" : ` · ${esc(gate.reasons.join(", "))}`}</option>`;
  }).join("");
  root.innerHTML = `<div class="ca-title"><div><span class="bt-eyebrow">Coach analysis</span><h1>${esc(report.playerName)}</h1>
    <p>${esc(report.sport)} · ${esc(report.environment)} · ${esc(report.date)} · ${esc(report.context?.intent || "intent unknown")}</p>
    <div id="performanceLabLink"></div></div></div>
    <section class="ca-video-section"><h2>Original video</h2><video id="analysisVideo" controls playsinline preload="metadata" aria-label="Original swing video for ${esc(report.playerName)}"></video>
      <p class="ca-meta">Phase times are estimates. The video is the source of truth.</p></section>
    <section><h2>Phases</h2><div class="ca-filmstrip" role="group" aria-label="Phase filmstrip">${phaseButtons}</div></section>
    <section class="ca-phases" aria-label="Phase details">${PHASES.map(([slug, label]) => phaseCard(slug, label)).join("")}</section>
    <section class="bt-card"><h2>Compare video</h2><p>Choose another swing with the same sport, intent, session type, camera view, and orientation. No numeric difference is shown.</p>
      <label for="compareClip">Compatible swing</label><select id="compareClip"><option value="">Choose a swing</option>${candidates}</select>
      <div id="compareHost"></div></section>
    <section class="bt-card"><h2>Evidence and definitions</h2>${(report.evidencePackages ?? []).length
      ? (report.evidencePackages ?? []).map((item) => `<button type="button" class="bt-button bt-button-secondary ca-evidence-link" data-package="${esc(item.packageId)}">${esc(item.definition)} · ${esc(sourceLabel(item.sourceClass, item.providerName))}</button>`).join("")
      : "<p>No validated technical result is available for this attempt. Phase provenance is available in each phase card.</p>"}</section>
    <section class="bt-card ca-fingerprint" aria-labelledby="fingerprintTitle"><h2 id="fingerprintTitle">Comparable history</h2>
      <p class="ca-meta">Game and practice stay separate. A distribution needs enough compatible, validated measurements. It is a description, not a swing score.</p>
      <div id="fingerprintHost"><p>Checking available definitions…</p></div></section>`;
  status.textContent = "";
  videoUrl(report.clipId).then((url) => {
    const video = document.getElementById("analysisVideo");
    if (video) { video.src = url; drawFilmstrip(url).catch(() => {}); }
  }).catch((error) => { status.textContent = error.message; });
}

const reasonLabel = {
  sport_mismatch: "Different sport", intent_mismatch: "Different attempt type",
  environment_mismatch: "Different setting", incompatible_capture: "Different or unchecked camera setup",
  insufficient_quality: "Video evidence is insufficient", definition_version_mismatch: "Different definition version",
  missing_result: "No eligible measurement", coach_excluded: "Excluded by coach",
  deleted_media: "Source video deleted",
};

function renderComparisonSet() {
  const host = document.getElementById("fingerprintHost");
  if (!host) return;
  const options = comparisonDefinitions.map((item) => `<option value="${esc(item.id)}">${esc(item.name)} · v${esc(item.version)}</option>`).join("");
  const set = activeComparisonSet;
  const stats = set?.aggregate;
  const body = set ? `<div class="ca-distribution"><h3>${esc(set.definition)} · ${esc(set.series)} · baseline v${esc(set.version)}</h3>
    <p>${set.status === "stale" ? "This baseline is stale after a source, decision, or deletion change. Build a new version before using its values."
      : set.status === "insufficient_sample" ? `Only individual attempts are available. At least ${esc(set.minimum)} eligible swings are required for a distribution.`
        : `${esc(stats.count)} eligible swings, ${esc(stats.excludedCount)} excluded · ${esc(stats.from)} to ${esc(stats.through)}.`}</p>
    ${stats && set.status === "descriptive" ? `<dl class="ca-stats"><div><dt>Median</dt><dd>${esc(stats.median)} ${esc(set.unit)}</dd></div>
      <div><dt>Middle half</dt><dd>${esc(stats.q1)}–${esc(stats.q3)} ${esc(set.unit)}</dd></div>
      <div><dt>Interquartile range</dt><dd>${esc(stats.iqr)} ${esc(set.unit)}</dd></div></dl>` : ""}
    ${set.focusSupport ? `<p class="ca-meta">Related to the current ${esc(set.focusSupport.concept.replaceAll("_", " "))} focus. ${esc(set.focusSupport.meaning)}</p>` : ""}
    <p class="ca-meta">Trend unavailable. Separate compatible windows and a reviewed change rule are required.</p>
    <details class="bt-disclosure"><summary><span>Included and excluded attempts (${set.members.length})</span></summary><div class="bt-disclosure-body">
      <ul class="ca-members">${set.members.map((member) => `<li>${member.clipId && set.status !== "stale"
        ? `<label><input type="checkbox" data-omit-attempt="${esc(member.attemptId)}" ${comparisonOmitted.has(member.attemptId) ? "checked" : ""}
          ${member.reason && member.reason !== "coach_excluded" ? "disabled" : ""}> <span>${esc(member.date)} · ${member.reason
            ? esc(reasonLabel[member.reason] || "Excluded") : `${esc(member.value)} ${esc(set.unit)} · Included`}</span></label>`
        : `<span>${esc(reasonLabel[member.reason] || "Unavailable")}</span>`}</li>`).join("")}</ul>
      <p class="ca-meta">Select attempts to leave out, then build a new version. The original measurements are unchanged.</p></div></details></div>` : "";
  host.innerHTML = `${comparisonDefinitions.length
    ? `<label for="fingerprintDefinition">Measurement</label><select id="fingerprintDefinition">${options}</select>
      <button type="button" class="bt-button bt-button-secondary" data-build-fingerprint>Build baseline version</button>`
    : "<p>No measurement definition has passed the comparison release gate for this sport. Individual video review remains available above.</p>"}
    ${comparisonVersions.length ? `<label for="fingerprintVersion">Saved baseline versions</label><select id="fingerprintVersion">
      <option value="">Choose a version</option>${comparisonVersions.map((item) => `<option value="${esc(item.id)}"
        ${item.id === set?.id ? "selected" : ""}>${esc(item.definition)} · ${esc(item.series)} · v${esc(item.version)} · ${esc(item.createdAt?.slice(0, 10))}</option>`).join("")}</select>` : ""}
    <div id="fingerprintStatus" role="status" aria-live="polite"></div>${body}`;
  if (comparisonDefinitions.length) document.getElementById("fingerprintDefinition").value =
    selectedDefinitionId && comparisonDefinitions.some((item) => item.id === selectedDefinitionId)
      ? selectedDefinitionId : comparisonDefinitions[0].id;
}

async function loadComparisonDefinitions() {
  const request = ++comparisonLoad;
  const [definitions, versions] = await Promise.all([
    supabase.rpc("list_comparison_definitions", { p_clip_id: report.clipId }),
    supabase.rpc("list_comparison_sets", { p_clip_id: report.clipId }),
  ]);
  if (request !== comparisonLoad) return;
  comparisonDefinitions = definitions.error ? [] : definitions.data ?? [];
  comparisonVersions = versions.error ? [] : versions.data ?? [];
  if (!comparisonDefinitions.some((item) => item.id === selectedDefinitionId))
    selectedDefinitionId = comparisonDefinitions[0]?.id ?? null;
  renderComparisonSet();
}

async function buildComparisonSet() {
  const definitionId = document.getElementById("fingerprintDefinition")?.value;
  const message = document.getElementById("fingerprintStatus");
  if (!definitionId || !message) return;
  const button = document.querySelector("[data-build-fingerprint]");
  if (button?.disabled) return;
  if (button) button.disabled = true;
  message.textContent = "Building a version from current eligible swings…";
  try {
    const { data: setId, error } = await supabase.rpc("build_comparison_set", {
      p_reference_clip_id: report.clipId, p_definition_id: definitionId,
      p_omit_attempts: [...comparisonOmitted],
    });
    if (error || !setId) { message.textContent = "The baseline could not be built from current evidence."; return; }
    const read = await supabase.rpc("get_comparison_set", { p_set_id: setId });
    if (read.error || !read.data) { message.textContent = "The new version could not be read."; return; }
    activeComparisonSet = { ...read.data, definitionId };
    selectedDefinitionId = definitionId;
    const versions = await supabase.rpc("list_comparison_sets", { p_clip_id: report.clipId });
    if (!versions.error) comparisonVersions = versions.data ?? [];
    renderComparisonSet();
  } finally { if (button?.isConnected) button.disabled = false; }
}

function showPhaseEvidence(slug) {
  const phase = phaseBySlug(report, slug);
  if (!phase) return;
  document.getElementById("evidenceTitle").textContent = `${phaseLabel(slug)} evidence`;
  drawerBody.innerHTML = `<p><strong>${esc(sourceLabel(phase.source))}</strong></p>
    <dl><dt>Source frame</dt><dd>${phase.frame ?? "Unavailable"}</dd>
    <dt>Time</dt><dd>${esc(timeLabel(phase.time))}</dd>
    <dt>Video frame rate</dt><dd>${esc(report.capture?.fps || "Unavailable")}</dd>
    <dt>Uncertainty</dt><dd>${phase.uncertaintyStatus === "quantified" ? `±${esc(phase.uncertaintyFrames)} frames` : esc(phase.uncertaintyStatus || "unavailable")}</dd>
    <dt>Visibility</dt><dd>${esc(phase.visibility)}</dd>
    <dt>Pipeline version</dt><dd>${esc(phase.pipelineVersion || "Unavailable")}</dd>
    <dt>Detector version</dt><dd>${esc(phase.detectorVersion || "Unavailable")}</dd></dl>
    ${phase.source === "coach_correction" ? `<p>Corrected by ${esc(phase.correctedBy || "a coach")}. ${esc(phase.reason || "")}</p>
      <details><summary>Original detector marker</summary><p>${phase.original ? `${esc(timeLabel(phase.original.time))}, frame ${esc(phase.original.frame ?? "unavailable")}` : "No detector marker was recorded."}</p></details>` : ""}
    <p class="ca-meta">Definition: legacy phase location. This marker is an estimate from video, not a validated movement measurement. Missing or hidden movement remains unavailable.</p>`;
  drawer.showModal();
}

async function showPackage(id) {
  const { data, error } = await supabase.rpc("get_analysis_evidence", { p_package_id: id });
  if (error || !data) throw new Error("Evidence is unavailable.");
  document.getElementById("evidenceTitle").textContent = data.definition;
  drawerBody.innerHTML = `<p>${esc(data.plainDefinition)}</p><dl>
    <dt>Source</dt><dd>${esc(sourceLabel(data.sourceClass, data.providerName))}</dd><dt>Definition version</dt><dd>${esc(data.definitionVersion)}</dd>
    <dt>Uncertainty</dt><dd>${esc(data.uncertainty?.status || "Unavailable")}</dd>
    <dt>Pipeline / detector</dt><dd>${esc(data.pipelineVersion)} / ${esc(data.detectorVersion)}</dd>
    <dt>Methodology version</dt><dd>${esc(data.methodologyVersion)}</dd></dl>
    <p><strong>Limits:</strong> ${esc(data.limitations)}</p>
    ${(data.methodologyReferences ?? []).length ? `<details><summary>Methodology references</summary><ul>${data.methodologyReferences.map((reference) => {
      const url = safeUrl(reference);
      return `<li>${url ? `<a href="${esc(url)}" target="_blank" rel="noopener noreferrer">${esc(reference)}</a>` : esc(reference)}</li>`;
    }).join("")}</ul></details>` : ""}
    <details><summary>Source items (${(data.items ?? []).length})</summary><ul>${(data.items ?? []).map((item) =>
      `<li>${esc(item.role)} ${esc(item.kind)} · ${esc(item.visibility)} · frames ${esc(item.startFrame ?? "unknown")}–${esc(item.endFrame ?? "unknown")} · ${esc(item.fps ?? "frame rate unavailable")} fps${item.exclusionReason ? ` · ${esc(item.exclusionReason)}` : ""}</li>`).join("")}</ul></details>`;
  drawer.showModal();
}

async function compareTo(clip) {
  const request = ++comparisonRequest;
  const candidate = (report.candidates ?? []).find((item) => item.clipId === clip);
  compared = candidate && comparableSetup(report, candidate).compatible ? candidate : null;
  syncOffset = null;
  const host = document.getElementById("compareHost");
  if (!compared) { host.innerHTML = ""; return; }
  host.innerHTML = `<p class="ca-meta">${esc(report.environment)} · ${esc(report.capture?.profile)} beside ${esc(candidate.environment)} · ${esc(candidate.profile)}. Match phase markers before playback.</p>
    <div class="ca-compare"><video id="compareOriginal" controls playsinline preload="metadata" aria-label="Current original swing"></video>
      <video id="compareOther" controls playsinline preload="metadata" aria-label="Compared original swing"></video></div>
    <button type="button" class="bt-button bt-button-secondary" id="playSynced" data-play-synced>Play from selected phase</button>`;
  try {
    const [first, second] = await Promise.all([videoUrl(report.clipId), videoUrl(candidate.clipId)]);
    if (request !== comparisonRequest || compared !== candidate) return;
    document.getElementById("compareOriginal").src = first;
    document.getElementById("compareOther").src = second;
    document.getElementById("compareOriginal").addEventListener("timeupdate", () => {
      const left = document.getElementById("compareOriginal");
      const right = document.getElementById("compareOther");
      if (syncOffset !== null && left && right && !left.paused && !right.paused
        && Math.abs(right.currentTime - left.currentTime - syncOffset) > .2)
        right.currentTime = Math.max(0, left.currentTime + syncOffset);
    });
  } catch { if (request === comparisonRequest) host.innerHTML = "<p>One of the videos is unavailable. Choose another swing.</p>"; }
}

root.addEventListener("click", async (event) => {
  const target = event.target.closest("[data-select-phase],[data-seek],[data-phase-evidence],[data-package],[data-delete-note],[data-play-synced],[data-build-fingerprint]");
  if (!target) return;
  try {
    if (target.hasAttribute("data-build-fingerprint")) await buildComparisonSet();
    else if (target.dataset.selectPhase) {
      selected = target.dataset.selectPhase;
      root.querySelectorAll("[data-select-phase]").forEach((button) => button.setAttribute("aria-pressed", String(button === target)));
      root.querySelectorAll(".ca-phase").forEach((card) => { card.dataset.selected = String(card.id === `phase-${selected}`); });
      document.getElementById(`phase-${selected}`)?.scrollIntoView({ behavior: "smooth", block: "nearest" });
      const phase = phaseBySlug(report, selected);
      const video = document.getElementById("analysisVideo");
      if (video && phase?.time !== null && phase?.time !== undefined) video.currentTime = Number(phase.time);
    } else if (target.dataset.seek) {
      const phase = phaseBySlug(report, target.dataset.seek);
      const video = document.getElementById("analysisVideo");
      if (video && phase?.time !== null && phase?.time !== undefined) video.currentTime = Number(phase.time);
    } else if (target.dataset.phaseEvidence) showPhaseEvidence(target.dataset.phaseEvidence);
    else if (target.dataset.package) await showPackage(target.dataset.package);
    else if (target.dataset.deleteNote) {
      const { error } = await supabase.rpc("delete_coach_text_annotation", { p_annotation_id: target.dataset.deleteNote });
      if (error) throw error;
      await load(); status.textContent = "Coach note deleted.";
    } else if (target.dataset.playSynced) {
      const points = syncPoints(report, compared, selected);
      if (!points) { status.textContent = "This phase is unavailable in one of the videos."; return; }
      const first = document.getElementById("compareOriginal"), second = document.getElementById("compareOther");
      first.pause(); second.pause(); first.currentTime = points[0]; second.currentTime = points[1];
      syncOffset = points[1] - points[0];
      await Promise.all([first.play(), second.play()]);
    }
  } catch { status.textContent = "That action could not be completed. Please try again."; }
});

root.addEventListener("change", (event) => {
  if (event.target.matches("[data-omit-attempt]")) {
    if (event.target.checked) comparisonOmitted.add(event.target.dataset.omitAttempt);
    else comparisonOmitted.delete(event.target.dataset.omitAttempt);
  }
  if (event.target.id === "fingerprintDefinition") {
    selectedDefinitionId = event.target.value;
    comparisonOmitted.clear();
    activeComparisonSet = null;
    renderComparisonSet();
  }
  if (event.target.id === "fingerprintVersion" && event.target.value) {
    const selectedId = event.target.value;
    supabase.rpc("get_comparison_set", { p_set_id: selectedId }).then(({ data, error }) => {
      if (error || !data) { status.textContent = "That baseline version is unavailable."; renderComparisonSet(); return; }
      comparisonOmitted.clear();
      activeComparisonSet = { ...data,
        definitionId: comparisonVersions.find((item) => item.id === selectedId)?.definitionId };
      selectedDefinitionId = activeComparisonSet.definitionId;
      renderComparisonSet();
    }).catch(() => { status.textContent = "That baseline version is unavailable."; renderComparisonSet(); });
  }
  if (event.target.id === "compareClip") compareTo(event.target.value).catch(() => {
    status.textContent = "Comparison could not be loaded.";
  });
});

root.addEventListener("submit", async (event) => {
  const form = event.target.closest("[data-note-form]");
  if (!form) return;
  event.preventDefault();
  const body = form.elements.body.value.trim();
  if (!body) return;
  const button = form.querySelector("button[type=submit]");
  button.disabled = true;
  try {
    const { error } = await supabase.rpc("add_coach_text_annotation", {
      p_clip_id: clipId, p_event_slug: form.dataset.noteForm, p_body: body,
      p_visibility: form.elements.visibility.value,
    });
    if (error) throw error;
    await load(); status.textContent = "Coach note saved.";
  } catch { button.disabled = false; status.textContent = "Coach note could not be saved."; }
});

document.getElementById("closeEvidence").addEventListener("click", () => drawer.close());

async function load() {
  const { data, error } = await supabase.rpc("get_coach_analysis", { p_clip_id: clipId });
  if (error || !data) throw new Error("Coach analysis is unavailable for this video.");
  report = data;
  activeComparisonSet = null;
  comparisonOmitted.clear();
  selectedDefinitionId = null;
  document.getElementById("backToReport").href = `./simple.html?player=${encodeURIComponent(data.playerId)}&clip=${encodeURIComponent(data.clipId)}`;
  render();
  supabase.rpc("performance_analysis_available", { p_player_id: data.playerId }).then(({ data: allowed, error: labError }) => {
    const host = document.getElementById("performanceLabLink");
    if (!labError && allowed === true && host && report === data)
      host.innerHTML = `<a class="bt-button bt-button-secondary" href="./lab.html?player=${encodeURIComponent(data.playerId)}&clip=${encodeURIComponent(data.clipId)}">Performance lab</a>`;
  }).catch(() => {});
  loadComparisonDefinitions().catch(() => {
    const host = document.getElementById("fingerprintHost");
    if (host) host.textContent = "Comparable history is unavailable.";
  });
}

async function start() {
  if (isDemoMode()) { status.textContent = "Coach analysis is unavailable in the public demo."; return; }
  if (!clipId || !/^[0-9a-f-]{36}$/i.test(clipId)) { status.textContent = "Choose a video from the development summary."; return; }
  const session = await requireSession();
  if (!session) return;
  try { await load(); } catch (error) { status.textContent = error.message; }
}
start();
