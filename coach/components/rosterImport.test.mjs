import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { parseCsv, suggestColumns, identityRows, pasteRows, screenshotRows, matchExisting } from "./rosterImport.js";

test("CSV identity extraction ignores stats and tolerates reordered columns", () => {
  const csv = parseCsv('\uFEFFAVG,Last Name,Number,First Name\r\n.400,"Da,vis",12,Maya\r\n');
  assert.deepEqual(suggestColumns(csv[0]), { number: 2, first: 3, last: 1, full: -1 });
  assert.deepEqual(identityRows(csv, suggestColumns(csv[0])), [{ firstName: "Maya", lastName: "Da,vis", jerseyNumber: "12", needsReview: false }]);
});

test("unknown headers require mapping and uncertain names remain flagged", () => {
  const csv = parseCsv('Column A,Column B\n7,Alex\n');
  assert.throws(() => identityRows(csv, suggestColumns(csv[0])), /Choose a player name/);
  assert.deepEqual(identityRows(csv, { number: 0, full: 1 }), [{ firstName: "Alex", lastName: "", jerseyNumber: "7", needsReview: true }]);
});

test("paste import and existing player matching", () => {
  const rows = pasteRows("12 Maya Davis\n7 Alex Jones");
  assert.equal(rows.length, 2);
  assert.equal(matchExisting(rows[0], [{ id: "one", name: "Maya Davis", jersey_number: "21" }])?.id, "one");
  assert.equal(matchExisting({ firstName: "Jose", lastName: "Nuñez" }, [{ id: "two", name: "José Núñez" }])?.id, "two");
});

test("screenshot extraction stays review-required and rejects malformed or oversized output", () => {
  assert.deepEqual(screenshotRows([
    { firstName: " Maya ", lastName: "Davis", jerseyNumber: "12", confidence: "high" },
    { firstName: "Alex", lastName: "", jerseyNumber: "7", confidence: "medium" },
  ]), [
    { firstName: "Maya", lastName: "Davis", jerseyNumber: "12", needsReview: false },
    { firstName: "Alex", lastName: "", jerseyNumber: "7", needsReview: true },
  ]);
  assert.throws(() => screenshotRows({ players: [] }), /player list/);
  assert.throws(() => screenshotRows(Array.from({ length: 101 }, () => ({}))), /too many rows/);
  assert.throws(() => screenshotRows(["Maya Davis"]), /invalid row/);
});

test("screenshot UI discloses Gemini before selection and keeps extracted rows in review", () => {
  const source = readFileSync(new URL("./rosterImportSheet.js", import.meta.url), "utf8");
  assert.match(source, /image is sent to Google's paid Gemini service/);
  assert.match(source, /retained for 55 days for abuse monitoring/);
  assert.match(source, /id="rosterScreenshot"[^>]+disabled/);
  assert.match(source, /Every extracted row must be reviewed/);
  assert.match(source, /extract-roster-screenshot/);
  assert.match(source, /row\.needsReview \? " needs-review"/);
});

test("screenshot function is coach-scoped, bounded, transient, and fail-closed", () => {
  const source = readFileSync(new URL("../../supabase/functions/extract-roster-screenshot/index.ts", import.meta.url), "utf8");
  assert.match(source, /coach_team_access/);
  assert.match(source, /\.eq\("coach_id", userData\.user\.id\)\.eq\("team_id", teamId\)/);
  assert.match(source, /imageBase64\.length > MAX_BASE64_LENGTH/);
  assert.match(source, /GEMINI_PAID_SERVICE_CONFIRMED/);
  assert.match(source, /responseMimeType: "application\/json"/);
  assert.doesNotMatch(source, /\.from\("players"\).*insert/s);
  assert.doesNotMatch(source, /console\.(?:log|error|warn)/);
});

test("screenshot function response schema keeps generationConfig structurally closed", () => {
  const fn = readFileSync(new URL("../../supabase/functions/extract-roster-screenshot/index.ts", import.meta.url), "utf8");
  assert.match(fn, /responseSchema:[\s\S]*?\n\s*},\n\s*},\n\s*}\),/,
    "responseSchema and generationConfig both close before JSON.stringify");
});
