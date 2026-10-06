import { openBottomSheet, button } from "./ui.js";
import { parseCsv, suggestColumns, identityRows, pasteRows, matchExisting } from "./rosterImport.js";

const esc = (value) => String(value ?? "").replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;").replaceAll('"', "&quot;").replaceAll("'", "&#039;");
const slug = (value) => String(value).normalize("NFKD").toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");

/** CSV/paste stays in browser memory. Only names and jersey numbers reach Supabase. */
export function openRosterImportSheet({ supabase, teamId, existing, onDone }) {
  let csv = null;
  let rows = [];
  const sheet = openBottomSheet({ title: "Import players", bodyHtml: `
    <p>GameChanger staff: export season stats as CSV, then choose that file. If the columns differ, you'll map them before import. Statistics are never saved.</p>
    <label class="hl-import-field">GameChanger CSV <input id="rosterCsv" type="file" accept=".csv,text/csv,text/plain"></label>
    <div id="rosterMapping"></div>
    <label class="hl-import-field">Or paste a roster, one player per line (12 Maya Davis)<textarea id="rosterPaste" rows="5"></textarea></label>
    ${button("Review pasted players", { attrs: 'id="reviewPaste"' })}
    <div id="rosterReview"></div><p id="rosterImportError" class="error-text" role="alert"></p>
  `, className: "hl-roster-import" });
  const error = sheet.querySelector("#rosterImportError");
  const review = sheet.querySelector("#rosterReview");
  const mapping = sheet.querySelector("#rosterMapping");
  const setError = (message) => { error.textContent = message; };
  const choices = (selected) => `<option value="-1">Not in file</option>${csv[0].map((header, index) => `<option value="${index}" ${selected === index ? "selected" : ""}>${esc(header || `Column ${index + 1}`)}</option>`).join("")}`;
  const showMapping = () => {
    const guess = suggestColumns(csv[0]);
    mapping.innerHTML = `<p>Confirm which columns identify players. The other columns are ignored.</p>${[
      ["number", "Jersey number"], ["first", "First name"], ["last", "Last name"], ["full", "Full name"],
    ].map(([key, label]) => `<label class="hl-import-field">${label}<select data-column="${key}">${choices(guess[key])}</select></label>`).join("")}
    ${button("Review CSV players", { attrs: 'id="reviewCsv"' })}`;
    mapping.querySelector("#reviewCsv").onclick = () => {
      try {
        const cols = Object.fromEntries([...mapping.querySelectorAll("[data-column]")].map((el) => [el.dataset.column, Number(el.value)]));
        if (cols.full < 0 && (cols.first < 0 || cols.last < 0)) throw new Error("Choose a full name or both first and last name columns.");
        rows = identityRows(csv, cols);
        csv = null; mapping.replaceChildren();
        renderReview();
      } catch (cause) { setError(cause.message); }
    };
  };
  sheet.querySelector("#rosterCsv").onchange = async (event) => {
    setError(""); review.replaceChildren();
    const input = event.target;
    const file = input.files?.[0];
    if (!file) return;
    try {
      if (file.size > 2_000_000) throw new Error("Choose a CSV smaller than 2 MB.");
      csv = parseCsv(await file.text()); showMapping();
    } catch (cause) { csv = null; setError(cause.message); }
    finally { input.value = ""; }
  };
  sheet.querySelector("#reviewPaste").onclick = () => {
    setError(""); csv = null; mapping.replaceChildren();
    rows = pasteRows(sheet.querySelector("#rosterPaste").value);
    renderReview();
  };

  function renderReview() {
    if (!rows.length) { review.innerHTML = "<p>No players found.</p>"; return; }
    review.innerHTML = `<h3>Review players</h3><p>Edit names and numbers. Existing names are skipped unless you choose to update the jersey number.</p>
      <div class="hl-import-rows">${rows.map((row, i) => {
        const found = matchExisting(row, existing);
        return `<div class="hl-import-row" data-row="${i}">
          <label><input type="checkbox" data-include ${found ? "" : "checked"}> Include</label>
          <label>Number <input data-number value="${esc(row.jerseyNumber)}" maxlength="12"></label>
          <label>First <input data-first value="${esc(row.firstName)}" required></label>
          <label>Last <input data-last value="${esc(row.lastName)}" required></label>
          <small data-match>${found ? `Existing player: ${esc(found.name)}. Check Include to update their jersey number.` : row.needsReview ? "Check this name before importing." : ""}</small>
        </div>`;
      }).join("")}</div>${button("Import selected players", { variant: "primary", attrs: 'id="confirmRosterImport"' })}`;
    review.querySelector("#confirmRosterImport").onclick = importSelected;
  }

  async function importSelected() {
    setError("");
    const selected = [...review.querySelectorAll("[data-row]")].filter((el) => el.querySelector("[data-include]").checked).map((el) => ({
      firstName: el.querySelector("[data-first]").value.trim(),
      lastName: el.querySelector("[data-last]").value.trim(),
      jerseyNumber: el.querySelector("[data-number]").value.trim(),
    }));
    if (!selected.length) return setError("Select at least one player.");
    if (selected.some((row) => !row.firstName || !row.lastName)) return setError("Check every selected first and last name.");
    const buttonEl = review.querySelector("#confirmRosterImport");
    buttonEl.disabled = true;
    let created = 0, updated = 0;
    try {
      const known = [...existing];
      for (const row of selected) {
        const name = `${row.firstName} ${row.lastName}`;
        const found = matchExisting(row, known);
        if (found) {
          if (row.jerseyNumber && found.jersey_number !== row.jerseyNumber) {
            const { error: updateError } = await supabase.from("players").update({ jersey_number: row.jerseyNumber }).eq("id", found.id).eq("team_id", teamId);
            if (updateError) throw updateError;
            found.jersey_number = row.jerseyNumber; updated++;
          }
          continue;
        }
        let playerSlug = slug(name);
        if (!playerSlug) throw new Error(`Couldn't make a player link for ${name}.`);
        let suffix = 2;
        while (known.some((player) => player.slug === playerSlug)) playerSlug = `${slug(name)}-${suffix++}`;
        const { data, error: insertError } = await supabase.from("players")
          .insert({ team_id: teamId, name, jersey_number: row.jerseyNumber, slug: playerSlug })
          .select("id, name, jersey_number, slug").single();
        if (insertError) throw insertError;
        known.push(data); created++;
      }
      sheet.remove();
      await onDone({ created, updated });
    } catch (cause) { setError(`Import stopped after ${created} new players and ${updated} jersey updates: ${cause.message}`); }
    finally { buttonEl.disabled = false; }
  }
  return sheet;
}
