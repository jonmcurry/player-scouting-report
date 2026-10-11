import { supabase, requireSession, escapeHtml, qs } from "../shared.js";
import { isDemoMode } from "../demoConfig.js";
import { openSheet, toast } from "./devUi.js";
import { labDistributions } from "./performanceLabModel.js";

const playerId = qs("player");
const clipId = qs("clip");
const root = document.getElementById("labRoot");
const status = document.getElementById("labStatus");
const esc = (value) => escapeHtml(String(value ?? ""));
let report;
let attempts = [];
const date = (value) => value ? String(value).slice(0, 10) : "Date unavailable";
const fmt = (value) => Number(value).toLocaleString(undefined, { maximumFractionDigits: 2 });

async function rpc(name, args) {
  const { data, error } = await supabase.rpc(name, args);
  if (error) throw error;
  return data;
}

function render() {
  const distributions = labDistributions(report);
  const importById = new Map(report.imports.map((item) => [item.id, item]));
  root.innerHTML = `<div class="ca-title"><span class="bt-eyebrow">Enabled staff only</span><h1>Performance lab</h1>
    <p>Device fields stay separate from video observations. Original units and provider versions are preserved.</p></div>
    <section class="bt-card pl-summary"><h2>External data</h2><p>${report.imports.length} import${report.imports.length === 1 ? "" : "s"} · ${report.totalReadings} original reading${report.totalReadings === 1 ? "" : "s"}</p>
      ${report.truncated ? '<p>Only the newest 500 readings are shown. Distributions and export are unavailable until a smaller selected set is supported.</p>' : ""}
      <p>Data appears only after athlete consent and program access are recorded. No device is needed for the development report.</p>
      <button type="button" class="bt-button bt-button-secondary" id="labExport" ${report.truncated || !report.totalReadings ? "disabled" : ""}>Download audited JSON</button></section>
    <section class="bt-card"><h2>Mapped distributions</h2>
      ${distributions.length ? distributions.map((group) => `<article class="pl-distribution">
        <strong>${esc(group.definition)} · definition v${esc(group.definitionVersion)}</strong>
        <p>${esc(group.source)} · mapping v${esc(group.mappingVersion)}</p>
        <p>${group.count} eligible reading${group.count === 1 ? "" : "s"} · ${esc(date(group.from))} to ${esc(date(group.through))} · ${esc(group.unit)}</p>
        <p>Dates use device timestamps when present, otherwise the import date.</p>
        ${group.stats ? `<dl class="ca-stats"><div><dt>Median</dt><dd>${fmt(group.stats.median)} ${esc(group.unit)}</dd></div>
          <div><dt>Middle half</dt><dd>${fmt(group.stats.q1)}–${fmt(group.stats.q3)} ${esc(group.unit)}</dd></div></dl>`
          : `<p>Distribution unavailable. At least ${Number.isFinite(group.minimum) ? group.minimum : "a reviewed minimum"} eligible readings are required.</p>`}
        </article>`).join("") : '<p>No reviewed provider mapping is available for these fields. Original readings remain inspectable below.</p>'}</section>
    <section class="bt-card"><h2>Original device readings</h2>
      ${report.imports.length ? report.imports.map((item) => {
        const rows = report.readings.filter((row) => row.importId === item.id);
        return `<details class="bt-disclosure"><summary><span>${esc(item.provider)} · ${esc(item.deviceModel)} · ${esc(date(item.importedAt))} (${rows.length} shown)</span></summary>
          <div class="bt-disclosure-body"><p>Device: ${esc(item.deviceType.replaceAll("_", " "))} · firmware ${esc(item.firmware)} · ${esc(item.format.toUpperCase())}</p>
          <p>Source file SHA-256: <code>${esc(item.fileSha256)}</code></p>
          ${(item.warnings ?? []).map((warning) => `<p>Import warning: ${esc(warning)}</p>`).join("")}
          ${rows.length ? `<div class="pl-rows">${rows.map((row) => `<div class="pl-reading"><div><strong>${esc(row.field)}: ${esc(row.value)} ${esc(row.unit)}</strong>
            <small>Provider definition ${esc(row.providerDefinitionVersion)} · record ${esc(row.recordKey)} · ${esc(date(row.deviceTimestamp ?? item.importedAt))}</small>
            <small>${row.attemptId ? "Manually linked to a readable video attempt" : "No attempt linked"}</small></div>
            <button type="button" class="bt-button bt-button-tertiary" data-link="${esc(row.id)}">${row.attemptId ? "Change link" : "Link attempt"}</button></div>`).join("")}</div>` : "<p>No readings in the displayed window.</p>"}</div></details>`;
      }).join("") : '<p>No instrument import is available for this athlete.</p>'}</section>`;
  root.querySelector("#labExport").onclick = exportData;
  root.querySelectorAll("[data-link]").forEach((button) => button.onclick = () => {
    const row = report.readings.find((item) => item.id === button.dataset.link);
    if (row) openLinkSheet(row, importById.get(row.importId));
  });
}

function openLinkSheet(row, source) {
  const sheet = openSheet("Link one device record", `<p>Select the exact video attempt. If more than one attempt is plausible, leave this record unlinked.</p>
    <p>${esc(source.provider)} · ${esc(row.recordKey)} · ${esc(row.field)} ${esc(row.value)} ${esc(row.unit)}</p>
    <label for="labAttempt">Video attempt</label><select id="labAttempt"><option value="">Leave unlinked</option>
      ${attempts.map((item) => `<option value="${esc(item.attemptId)}" ${item.attemptId === row.attemptId ? "selected" : ""}>${esc(item.date)} · ${esc(item.series)} · ${esc(item.attemptId.slice(0, 8))}</option>`).join("")}</select>
    <label for="labReason">Reason for this manual match</label><textarea id="labReason" maxlength="500" placeholder="Which video and device record did you verify?" required></textarea>`,
  '<button type="button" class="bt-button bt-button-primary" id="labSaveLink">Save link event</button>');
  sheet.querySelector("#labSaveLink").onclick = async () => {
    const reason = sheet.querySelector("#labReason").value.trim();
    if (reason.length < 3) return toast("Describe how you verified this match.");
    const selected = sheet.querySelector("#labAttempt").value || null;
    try {
      await rpc("link_instrument_record", { p_import_id: row.importId,
        p_record_key: row.recordKey, p_attempt_id: selected, p_reason: reason });
      sheet.querySelector(".close-btn")?.click();
      await load();
      status.textContent = selected ? "Manual link saved." : "Link removed.";
    } catch { toast("The link could not be saved. Check the player and session."); }
  };
}

async function exportData() {
  const button = root.querySelector("#labExport");
  button.disabled = true;
  try {
    const result = await rpc("export_performance_analysis", { p_player_id: playerId });
    const blob = new Blob([JSON.stringify(result, null, 2)], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = `hitterloop-performance-${playerId}-${date(result.exportedAt)}.json`;
    link.click();
    setTimeout(() => URL.revokeObjectURL(url), 60_000);
    status.textContent = "Audited export downloaded.";
  } catch { status.textContent = "Export unavailable. Check access and consent."; }
  finally { button.disabled = false; }
}

async function load() {
  const [data, candidates] = await Promise.all([
    rpc("get_performance_analysis", { p_player_id: playerId }),
    rpc("list_performance_attempts", { p_player_id: playerId }),
  ]);
  report = data;
  attempts = candidates;
  status.textContent = "";
  render();
}

async function start() {
  if (isDemoMode()) { status.textContent = "Performance lab is unavailable in the public demo."; return; }
  if (!playerId || !/^[0-9a-f-]{36}$/i.test(playerId)) { status.textContent = "Choose an athlete from Coach analysis."; return; }
  if (clipId && /^[0-9a-f-]{36}$/i.test(clipId))
    document.getElementById("labBack").href = `./analysis.html?clip=${encodeURIComponent(clipId)}`;
  if (!await requireSession()) return;
  try { await load(); } catch { status.textContent = "Performance lab is unavailable for this athlete or account."; }
}
start();
