import { escapeHtml, openSheet, supabase, toast } from "./devUi.js";
import { evaluateChallenge } from "./challengeModel.js";
import { isDemoMode } from "../demoConfig.js";

let loadNumber = 0;
let selectedId = null;
const esc = (value) => escapeHtml(String(value ?? ""));
const environments = ["tee", "front_toss", "side_toss", "pitching_machine", "live_practice"];
const label = (value) => value.replaceAll("_", " ");
const rpc = async (name, args) => {
  const { data, error } = await supabase.rpc(name, args);
  if (error) throw error;
  return data;
};

export async function mountChallengeProtocols(ctx, session, reps) {
  const host = document.getElementById("challengeProtocols");
  if (!host) return;
  if (isDemoMode()) { host.hidden = true; return; }
  const request = ++loadNumber;
  host.innerHTML = '<section class="bt-card"><span class="bt-eyebrow">Controlled practice</span><p>Loading protocols…</p></section>';
  try {
    const [templates, versions, games] = await Promise.all([
      rpc("list_challenge_templates", { p_session_id: session.id }),
      rpc("list_challenge_protocols", { p_session_id: session.id }),
      rpc("get_challenge_game_evidence", { p_session_id: session.id }),
    ]);
    if (request !== loadNumber) return;
    if (!versions.some((item) => item.id === selectedId)) selectedId = versions[0]?.id ?? null;
    const protocol = selectedId ? await rpc("get_challenge_protocol", { p_protocol_id: selectedId }) : null;
    if (request !== loadNumber) return;
    render(host, { ctx, session, reps, templates, versions, games, protocol });
  } catch (error) {
    if (request !== loadNumber) return;
    host.innerHTML = '<section class="bt-card"><span class="bt-eyebrow">Controlled practice</span><p>Protocols are unavailable for this coach or session.</p></section>';
  }
}

function render(host, data) {
  const { ctx, session, reps, templates, versions, games, protocol } = data;
  const result = protocol && evaluateChallenge(protocol);
  const taskName = (key) => protocol.tasks.find((task) => task.key === key)?.label ?? label(key);
  const available = templates.filter((item) => !versions.some((version) => version.title === item.title && version.version === item.version));
  host.innerHTML = `<section class="bt-card cp-card"><span class="bt-eyebrow">Controlled practice · coach only</span>
    <h2>Challenge protocol</h2><p>Use planned repetitions with recorded task context. Ordinary practice reps do not complete a protocol.</p>
    <label for="protocolTemplate">Protocol template</label><select id="protocolTemplate"><option value="">Choose a template</option>
      ${available.map((item) => `<option value="${esc(item.id)}">${esc(item.title)} · v${esc(item.version)}${item.validated ? "" : " · pilot recording"}</option>`).join("")}</select>
    <button class="bt-button bt-button-secondary" id="startProtocol" type="button">Start protocol</button>
    ${versions.length ? `<label for="protocolVersion">This session's protocols</label><select id="protocolVersion">${versions.map((item) => `<option value="${esc(item.id)}" ${item.id === selectedId ? "selected" : ""}>${esc(item.title)} · v${esc(item.version)}</option>`).join("")}</select>` : ""}
    ${protocol ? `<div class="cp-rule"><strong>${esc(protocol.title)} · v${esc(protocol.version)}</strong>
      <p>Task: ${esc(protocol.tasks.map((task) => `${task.label} (${task.minimum} reps)`).join(" → "))}</p>
      <p>Setup: ${esc(label(protocol.environment))} · ${esc(protocol.captureProfiles.map(label).join(", "))} capture.</p>
      <p>${esc(protocol.safetyNote)}</p></div>
      <p class="cp-state" role="status">${statusText(protocol, result)}</p>
      <div class="cp-tasks">${result.perTask.map((task) => `<p>${esc(task.label)}: ${task.eligible} / ${task.minimum} eligible video reps</p>`).join("")}</div>
      <div class="bt-list">${protocol.slots.map((slot) => `<div class="bt-list-row cp-slot">
        <span class="bt-list-row-copy"><strong>Rep ${slot.number} · ${esc(taskName(slot.task))}</strong>
          <small>${esc(label(slot.state))}${slot.state === "recorded" ? ` · ${esc(label(slot.actualEnvironment))}${slot.readable ? " · readable" : " · video unavailable"}${slot.observation ? ` · coach: ${esc(slot.observation)}` : ""}` : ""}</small></span>
        ${slot.readable && slot.clipId ? `<a class="bt-button bt-button-tertiary" href="${ctx.url("review", { clip: slot.clipId })}">Video</a>` : ""}
        <button type="button" class="bt-button bt-button-tertiary" data-slot="${esc(slot.id)}">Record</button></div>`).join("")}</div>
      ${result.state === "ready" ? `<p class="cp-state">Coach observations across eligible reps: ${result.observations.consistent} consistent, ${result.observations.changed} changed, ${result.observations.unclear} unclear. ${result.changed ? "Changed describes the coach's observation." : "No movement change was marked by the coach."} Improved: unavailable without a validated performance criterion. Task sample: ${result.eligible.length} eligible practice videos. Capture: ${esc(protocol.captureProfiles.map(label).join(", "))}. Source: original video and coach observation.</p>` : ""}
      ${games.length >= 3 ? `<details class="bt-disclosure"><summary><span>Game video to review (${games.length})</span></summary><div class="bt-disclosure-body"><p>Repeated readable game clips are shown separately. Review visually; no transfer or numeric practice-to-game claim is made.</p>
        ${games.map((game) => `<a class="bt-button bt-button-tertiary" href="${ctx.url("review", { clip: game.clipId })}">${esc(game.date)} game video</a>`).join("")}</div></details>`
        : '<p class="bt-caption">Game transfer unavailable: at least three readable game videos are needed for a visual review.</p>'}
    ` : '<p class="bt-caption">Choose a template to start a planned session.</p>'}</section>`;
  host.querySelector("#protocolVersion")?.addEventListener("change", async (event) => {
    selectedId = event.target.value;
    await mountChallengeProtocols(ctx, session, reps);
  });
  host.querySelector("#startProtocol").onclick = async () => {
    const templateId = host.querySelector("#protocolTemplate").value;
    if (!templateId) return toast("Choose a template.");
    try {
      selectedId = await rpc("start_challenge_protocol", { p_session_id: session.id, p_template_id: templateId });
      await mountChallengeProtocols(ctx, session, reps);
    } catch (error) {
      toast(error.message?.includes("validated same-task repeatability required")
        ? "Complete a validated same-task repeatability set first."
        : "Could not start protocol.");
    }
  };
  host.querySelectorAll("[data-slot]").forEach((button) => button.onclick = () => {
    const slot = protocol.slots.find((item) => item.id === button.dataset.slot);
    openSlotSheet(ctx, session, reps, protocol, slot);
  });
}

function statusText(protocol, result) {
  if (!protocol.validated) return `Pilot recording only. ${result.missingCount} pending, ${result.missedCount} missed or failed, and ${result.insufficientCount} ineligible recorded slots. This sport's template still needs two qualified independent coach reviews before a result can be shown.`;
  if (result.state === "prerequisite_missing") return "Same-task repeatability evidence is no longer complete. The challenge result is unavailable.";
  if (result.state === "incomplete") return `Incomplete: ${result.missingCount} pending and ${result.missedCount} missed or failed slots. Record the required attempts to finish.`;
  if (result.state === "insufficient") return `Insufficient evidence: ${result.insufficientCount} recorded reps lack readable, usable video with the required capture and actual task context.`;
  return "Required attempts are complete and readable. This is a coach observation, not a performance score.";
}

function openSlotSheet(ctx, session, reps, protocol, slot) {
  const task = protocol.tasks.find((item) => item.key === slot.task);
  const sheet = openSheet(`Rep ${slot.number} · ${task.label}`, `<p>Record what actually happened. A missed or failed attempt stays visible as incomplete.</p>
    <label for="cpState">Attempt</label><select id="cpState"><option value="pending">Pending</option><option value="recorded">Recorded</option><option value="missed">Missed</option><option value="failed">Failed</option></select>
    <label for="cpRep">Practice rep</label><select id="cpRep"><option value="">Choose a rep</option>${reps.map((rep) => `<option value="${esc(rep.id)}">Rep ${rep.rep_number}${rep.usable === false ? " · unusable" : ""}</option>`).join("")}</select>
    <label for="cpContext">Actual task</label><select id="cpContext"><option value="">Choose actual task</option>
      <option value="${esc(slot.task)}">${esc(task.label)}</option><option value="other">Different or unknown task</option></select>
    <label for="cpEnvironment">Actual environment</label><select id="cpEnvironment"><option value="">Choose actual environment</option>
      ${environments.map((item) => `<option value="${item}">${esc(label(item))}</option>`).join("")}</select>
    <label for="cpObservation">Coach observation</label><select id="cpObservation"><option value="">No observation</option>
      <option value="consistent">Consistent</option><option value="changed">Changed</option><option value="unclear">Unclear</option></select>`,
  '<button type="button" class="bt-button bt-button-primary" id="cpSave">Save attempt</button>');
  sheet.querySelector("#cpState").value = slot.state;
  sheet.querySelector("#cpRep").value = slot.repId ?? "";
  sheet.querySelector("#cpContext").value = slot.actualContext ?? "";
  sheet.querySelector("#cpEnvironment").value = slot.actualEnvironment ?? "";
  sheet.querySelector("#cpObservation").value = slot.observation ?? "";
  sheet.querySelector("#cpSave").onclick = async () => {
    const state = sheet.querySelector("#cpState").value;
    const repId = sheet.querySelector("#cpRep").value || null;
    const context = sheet.querySelector("#cpContext").value || null;
    const environment = sheet.querySelector("#cpEnvironment").value || null;
    const observation = sheet.querySelector("#cpObservation").value || null;
    if (state === "recorded" && (!repId || !environment || !context))
      return toast("Choose a rep and record its actual task and environment.");
    try {
      await rpc("record_challenge_slot", { p_slot_id: slot.id, p_state: state,
        p_rep_id: state === "recorded" ? repId : null,
        p_actual_context: state === "recorded" ? context : null,
        p_actual_environment: state === "recorded" ? environment : null,
        p_observation: state === "recorded" ? observation : null });
      sheet.querySelector(".close-btn")?.click();
      await mountChallengeProtocols(ctx, session, reps);
    } catch (error) { toast(error.message || "Could not save attempt."); }
  };
}
