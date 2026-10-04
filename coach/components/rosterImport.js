// The browser reads the export locally. Only the reviewed identity fields are
// ever returned to the caller; statistics and source rows are discarded.
const normalize = (value) => String(value ?? "").normalize("NFKD").replace(/\p{M}/gu, "").trim().toLowerCase().replace(/[^a-z0-9]/g, "");

export function parseCsv(text) {
  const rows = [];
  let row = [], cell = "", quoted = false;
  const source = String(text ?? "").replace(/^\uFEFF/, "");
  for (let i = 0; i < source.length; i++) {
    const ch = source[i];
    if (quoted) {
      if (ch === '"' && source[i + 1] === '"') { cell += '"'; i++; }
      else if (ch === '"') quoted = false;
      else cell += ch;
    } else if (ch === '"') quoted = true;
    else if (ch === ",") { row.push(cell); cell = ""; }
    else if (ch === "\n" || ch === "\r") {
      if (ch === "\r" && source[i + 1] === "\n") i++;
      row.push(cell); cell = "";
      if (row.some((part) => part.trim())) rows.push(row);
      row = [];
    } else cell += ch;
  }
  if (quoted) throw new Error("The CSV has an unfinished quoted cell.");
  row.push(cell);
  if (row.some((part) => part.trim())) rows.push(row);
  if (rows.length < 2) throw new Error("The CSV needs a header and at least one player row.");
  return rows;
}

export function suggestColumns(headers) {
  const aliases = {
    number: ["number", "no", "jersey", "jerseynumber", "playernumber", "uniformnumber"],
    first: ["firstname", "first", "givenname"],
    last: ["lastname", "last", "surname", "familyname"],
    full: ["player", "playername", "name", "athlete", "athletename"],
  };
  const used = new Set();
  const result = {};
  for (const [key, names] of Object.entries(aliases)) {
    const index = headers.findIndex((header, i) => !used.has(i) && names.includes(normalize(header)));
    result[key] = index;
    if (index >= 0) used.add(index);
  }
  return result;
}

function splitName(full) {
  const parts = String(full ?? "").trim().split(/\s+/).filter(Boolean);
  return { first: parts.shift() ?? "", last: parts.join(" ") };
}

export function identityRows(csvRows, columns) {
  const { number = -1, first = -1, last = -1, full = -1 } = columns;
  if (full < 0 && first < 0) throw new Error("Choose a player name column.");
  return csvRows.slice(1).map((row) => {
    const combined = full >= 0 ? splitName(row[full]) : { first: "", last: "" };
    const firstName = String(first >= 0 ? row[first] : combined.first ?? "").trim();
    const lastName = String(last >= 0 ? row[last] : combined.last ?? "").trim();
    const jerseyNumber = String(number >= 0 ? row[number] : "").trim();
    return { firstName, lastName, jerseyNumber, needsReview: !firstName || !lastName };
  }).filter((row) => row.firstName || row.lastName || row.jerseyNumber);
}

export function pasteRows(text) {
  return String(text ?? "").split(/\r?\n/).filter((line) => line.trim()).map((line) => {
    const match = line.trim().match(/^(?:#?([0-9]{1,3})\s+)?(.+)$/);
    const name = splitName(match?.[2] ?? "");
    return { firstName: name.first, lastName: name.last, jerseyNumber: match?.[1] ?? "", needsReview: !name.first || !name.last };
  });
}

export function matchExisting(row, existing) {
  const name = normalize(`${row.firstName} ${row.lastName}`);
  if (!name) return null;
  return existing.find((player) => normalize(player.name) === name) ?? null;
}
