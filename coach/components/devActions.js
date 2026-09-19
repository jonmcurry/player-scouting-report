// Coach actions shared by the development, review and session pages: promote an
// AI observation to a priority, assign a drill, log a progress observation, set a
// follow-up, change a priority's status. Every function here is a deliberate
// coach click - none is ever invoked from AI output - and each one only writes
// coach-authored rows.
import { supabase, L, openSheet, toast, escapeHtml, fmtDate } from "./devUi.js";

const opt = (value, label, selected) => `<option value="${escapeHtml(value)}" ${selected ? "selected" : ""}>${escapeHtml(label)}</option>`;

function fail(err) {
  console.error(err);
  toast(`Couldn't save: ${err.message ?? err}`);
}

/** Creates a priority. `source_issue_id` links back to the AI draft it came
 * from; promoting an unreviewed draft counts as the coach confirming it. */
export async function createPriority(ctx, { title, description = "", category = null, issue = null, followUp = null }) {
  const row = {
    player_id: ctx.player.id,
    title: title.trim(),
    description,
    category,
    source_issue_id: issue?.id ?? null,
    created_by_coach_id: ctx.coachId,
    ...(followUp ?? {}),
  };
  const { data, error } = await supabase.from("player_priorities").insert(row).select("*").single();
  if (error) throw error;
  if (issue && (issue.review_status ?? "draft") === "draft") {
    await supabase.from("issues").update({ review_status: "approved", reviewed_by: ctx.coachName }).eq("id", issue.id);
  }
  return data;
}

/** Sheet: promote an AI observation (issue row) to an active priority. */
export function openPromoteSheet(ctx, issue, onDone) {
  const title = issue.suggested_priority_title || issue.issue;
  const category = L.guessCategory(`${issue.issue} ${issue.evidence ?? ""}`);
  const backdrop = openSheet(
    "Promote to priority",
    `
    <p class="hint">This starts tracking the issue as one of ${escapeHtml(ctx.player.name)}'s coaching priorities. Nothing is created until you confirm.</p>
    <div class="dev-field"><label>Priority</label><input id="pTitle" value="${escapeHtml(title)}"></div>
    <div class="dev-field"><label>Category (matches drills)</label>
      <select id="pCat">${L.PRIORITY_CATEGORIES.map((c) => opt(c.slug, c.label, c.slug === category)).join("")}</select></div>
    <div class="dev-field"><label>What you're working on</label><textarea id="pDesc">${escapeHtml(issue.coaching_cue || issue.effect || "")}</textarea></div>
    <div class="dev-btns"><button class="primary tap-target" id="pSave">Start tracking</button></div>`,
  );
  backdrop.querySelector("#pSave").addEventListener("click", async () => {
    const t = backdrop.querySelector("#pTitle").value.trim();
    if (!t) return toast("Give the priority a name.");
    try {
      const p = await createPriority(ctx, {
        title: t,
        description: backdrop.querySelector("#pDesc").value,
        category: backdrop.querySelector("#pCat").value,
        issue,
      });
      backdrop.querySelector(".close-btn").click();
      toast("Priority created");
      onDone?.(p);
    } catch (e) { fail(e); }
  });
}

/** Sheet: add a priority from scratch (no AI involved). */
export function openAddPrioritySheet(ctx, onDone) {
  openPromoteSheet(ctx, { issue: "", suggested_priority_title: "", review_status: "approved", id: null }, onDone);
}

/** Sheet: assign a drill to a priority. Suggestions come from the tag mapping;
 * the coach picks (or writes a custom team drill). */
export function openAssignDrillSheet(ctx, priority, library, assignedDrillIds, onDone) {
  const suggested = L.suggestDrills(priority, library, assignedDrillIds);
  const rest = library.filter((d) => !assignedDrillIds.includes(d.id) && !suggested.includes(d));
  const card = (d, star) => `
    <label class="dev-card" style="display:block;cursor:pointer;">
      <input type="radio" name="drill" value="${d.id}"> <b>${escapeHtml(d.name)}</b> ${star ? '<span class="pill good">Suggested</span>' : ""}
      <div class="hint">${escapeHtml(d.purpose)}</div>
    </label>`;
  const backdrop = openSheet(
    "Assign a drill",
    `
    <p class="hint">For: <b>${escapeHtml(priority.title)}</b>. You choose the drill; suggestions only come from the drill library's tags.</p>
    ${suggested.length ? suggested.map((d) => card(d, true)).join("") : ""}
    ${rest.length ? `<details><summary>Other drills (${rest.length})</summary>${rest.map((d) => card(d, false)).join("")}</details>` : ""}
    ${!suggested.length && !rest.length ? '<p class="hint">Every library drill is already assigned.</p>' : ""}
    <details><summary>Add a custom drill for this team</summary>
      <div class="dev-field"><label>Name</label><input id="dName"></div>
      <div class="dev-field"><label>How to run it</label><textarea id="dHow"></textarea></div>
    </details>
    <div class="dev-field"><label>Note to player (optional)</label><input id="dNote"></div>
    <div class="dev-btns"><button class="primary tap-target" id="dSave">Assign drill</button></div>`,
  );
  backdrop.querySelector("#dSave").addEventListener("click", async () => {
    try {
      let drillId = backdrop.querySelector('input[name="drill"]:checked')?.value ?? null;
      const customName = backdrop.querySelector("#dName").value.trim();
      if (!drillId && customName) {
        const slug = `${customName.toLowerCase().replace(/[^a-z0-9]+/g, "-")}-${Date.now().toString(36)}`;
        const { data, error } = await supabase
          .from("drill_library")
          .insert({
            team_id: ctx.team.id,
            slug,
            name: customName,
            instructions: backdrop.querySelector("#dHow").value,
            target_tags: priority.category ? [priority.category] : [],
          })
          .select("id")
          .single();
        if (error) throw error;
        drillId = data.id;
      }
      if (!drillId) return toast("Pick a drill first.");
      const { error } = await supabase
        .from("player_priority_drills")
        .insert({ player_priority_id: priority.id, drill_id: drillId, coach_note: backdrop.querySelector("#dNote").value });
      if (error) throw error;
      backdrop.querySelector(".close-btn").click();
      toast("Drill assigned");
      onDone?.();
    } catch (e) { fail(e); }
  });
}

/** Sheet: log a progress observation for a priority (coach judgment). `evidence`
 * = { clipId, pitchId, repId, sessionId, phase } from wherever the coach is. */
export function openObservationSheet(ctx, priority, evidence = {}, onDone, aiSuggestion = null) {
  const backdrop = openSheet(
    `Progress: ${priority.title}`,
    `
    <p class="hint">Your call - this is what the timeline and the player report show as progress.</p>
    ${aiSuggestion ? `<p class="hint">AI suggestion (not applied): ${escapeHtml(aiSuggestion)}</p>` : ""}
    <div class="dev-btns" id="oStatus">
      ${L.OBSERVATION_STATUSES.map((s) => `<button type="button" data-s="${s}" class="tap-target">${L.OBSERVATION_LABELS[s]}</button>`).join("")}
    </div>
    <div class="dev-field"><label>Coach note</label><textarea id="oNote" placeholder="e.g. Much more stable at plant"></textarea></div>
    <div class="dev-btns"><button class="primary tap-target" id="oSave">Save</button></div>`,
  );
  let status = null;
  backdrop.querySelector("#oStatus").addEventListener("click", (e) => {
    const b = e.target.closest("[data-s]");
    if (!b) return;
    status = b.dataset.s;
    backdrop.querySelectorAll("#oStatus button").forEach((x) => x.classList.toggle("active", x === b));
  });
  backdrop.querySelector("#oSave").addEventListener("click", async () => {
    if (!status) return toast("Choose improving, unchanged, worse, resolved or unclear.");
    try {
      const { error } = await supabase.from("player_priority_observations").insert({
        player_priority_id: priority.id,
        video_clip_id: evidence.clipId ?? null,
        at_bat_pitch_id: evidence.pitchId ?? null,
        practice_repetition_id: evidence.repId ?? null,
        practice_session_id: evidence.sessionId ?? null,
        phase: evidence.phase ?? null,
        status,
        coach_note: backdrop.querySelector("#oNote").value,
        ai_suggestion: aiSuggestion,
      });
      if (error) throw error;
      backdrop.querySelector(".close-btn").click();
      if (L.suggestedPriorityStatus(status) && priority.status !== "resolved") {
        if (confirm(`Mark "${priority.title}" as resolved?`)) await changePriorityStatus(priority, "resolved");
      }
      toast("Progress saved");
      onDone?.();
    } catch (e) { fail(e); }
  });
}

export async function changePriorityStatus(priority, to) {
  if (!L.canTransitionPriority(priority.status, to)) return;
  const { error } = await supabase.from("player_priorities").update({ status: to }).eq("id", priority.id);
  if (error) throw error;
}

export function openStatusSheet(priority, onDone) {
  const backdrop = openSheet(
    "Priority status",
    `
    <p class="hint">Only you change this - it never changes on its own.</p>
    <div class="dev-btns" id="sBtns">
      ${L.PRIORITY_STATUSES.filter((s) => s !== priority.status)
        .map((s) => `<button type="button" data-s="${s}" class="tap-target">${s === "monitoring" ? "Monitoring" : s[0].toUpperCase() + s.slice(1)}</button>`)
        .join("")}
    </div>
    <div class="dev-field"><label>Coach notes</label><textarea id="sNotes">${escapeHtml(priority.coach_notes ?? "")}</textarea></div>
    <div class="dev-btns"><button class="tap-target" id="sNotesSave">Save notes only</button></div>`,
  );
  backdrop.querySelector("#sBtns").addEventListener("click", async (e) => {
    const b = e.target.closest("[data-s]");
    if (!b) return;
    try {
      const patch = { status: b.dataset.s, coach_notes: backdrop.querySelector("#sNotes").value };
      const { error } = await supabase.from("player_priorities").update(patch).eq("id", priority.id);
      if (error) throw error;
      backdrop.querySelector(".close-btn").click();
      onDone?.();
    } catch (err) { fail(err); }
  });
  backdrop.querySelector("#sNotesSave").addEventListener("click", async () => {
    try {
      const { error } = await supabase.from("player_priorities").update({ coach_notes: backdrop.querySelector("#sNotes").value }).eq("id", priority.id);
      if (error) throw error;
      backdrop.querySelector(".close-btn").click();
      onDone?.();
    } catch (err) { fail(err); }
  });
}

export function openFollowUpSheet(priority, onDone) {
  const kinds = [
    ["", "No follow-up"],
    ["next_practice", "Review next practice"],
    ["next_game", "Review in next game"],
    ["after_swings", "Review after N swings"],
    ["date", "Review by a date"],
  ];
  const backdrop = openSheet(
    "Follow-up",
    `
    <div class="dev-field"><label>When should this be looked at again?</label>
      <select id="fKind">${kinds.map(([v, l]) => opt(v, l, (priority.follow_up_kind ?? "") === v)).join("")}</select></div>
    <div class="dev-field" id="fDateWrap" hidden><label>Date</label><input type="date" id="fDate" value="${escapeHtml(priority.follow_up_date ?? "")}"></div>
    <div class="dev-field" id="fSwingsWrap" hidden><label>Swings</label><input type="number" min="1" id="fSwings" value="${priority.follow_up_swings ?? 10}"></div>
    <div class="dev-field"><label>Reminder note (optional)</label><input id="fNote" value="${escapeHtml(priority.follow_up_note ?? "")}" placeholder="Watch whether the front hip stays closed"></div>
    <div class="dev-btns"><button class="primary tap-target" id="fSave">Save</button>${priority.follow_up_kind ? '<button class="tap-target" id="fDone">Mark follow-up done</button>' : ""}</div>`,
  );
  const sync = () => {
    const k = backdrop.querySelector("#fKind").value;
    backdrop.querySelector("#fDateWrap").hidden = k !== "date";
    backdrop.querySelector("#fSwingsWrap").hidden = k !== "after_swings";
  };
  backdrop.querySelector("#fKind").addEventListener("change", sync);
  sync();
  backdrop.querySelector("#fSave").addEventListener("click", async () => {
    const k = backdrop.querySelector("#fKind").value || null;
    if (k === "date" && !backdrop.querySelector("#fDate").value) return toast("Pick a date.");
    try {
      const { error } = await supabase
        .from("player_priorities")
        .update({
          follow_up_kind: k,
          follow_up_date: k === "date" ? backdrop.querySelector("#fDate").value : null,
          follow_up_swings: k === "after_swings" ? Number(backdrop.querySelector("#fSwings").value) : null,
          follow_up_note: k ? backdrop.querySelector("#fNote").value : null,
        })
        .eq("id", priority.id);
      if (error) throw error;
      backdrop.querySelector(".close-btn").click();
      onDone?.();
    } catch (err) { fail(err); }
  });
  backdrop.querySelector("#fDone")?.addEventListener("click", async () => {
    try {
      const { error } = await supabase.from("player_priorities").update({ follow_up_done_at: new Date().toISOString() }).eq("id", priority.id);
      if (error) throw error;
      backdrop.querySelector(".close-btn").click();
      onDone?.();
    } catch (err) { fail(err); }
  });
}

/** Approve / edit / reject an AI-drafted observation (issues row). */
export async function reviewIssue(ctx, issue, action, edits = {}) {
  const patch = L.issueReviewPatch(action, ctx.coachName, edits);
  const { error } = await supabase.from("issues").update(patch).eq("id", issue.id);
  if (error) throw error;
}

export function openEditIssueSheet(ctx, issue, onDone) {
  const backdrop = openSheet(
    "Edit observation",
    `
    <div class="dev-field"><label>What I see</label><textarea id="eIssue">${escapeHtml(issue.issue)}</textarea></div>
    <div class="dev-field"><label>Evidence</label><textarea id="eEv">${escapeHtml(issue.evidence ?? "")}</textarea></div>
    <div class="dev-field"><label>Coaching cue</label><input id="eCue" value="${escapeHtml(issue.coaching_cue ?? "")}"></div>
    <div class="dev-field"><label>What to look for next time</label><input id="eLook" value="${escapeHtml(issue.look_for_next ?? "")}"></div>
    <div class="dev-btns"><button class="primary tap-target" id="eSave">Save edits</button></div>`,
  );
  backdrop.querySelector("#eSave").addEventListener("click", async () => {
    try {
      await reviewIssue(ctx, issue, "edit", {
        issue: backdrop.querySelector("#eIssue").value.trim(),
        evidence: backdrop.querySelector("#eEv").value,
        coaching_cue: backdrop.querySelector("#eCue").value,
        look_for_next: backdrop.querySelector("#eLook").value,
      });
      backdrop.querySelector(".close-btn").click();
      onDone?.();
    } catch (e) { fail(e); }
  });
}

export { fmtDate };
