import test from "node:test";
import assert from "node:assert/strict";
import { parseCsv, suggestColumns, identityRows, pasteRows, matchExisting } from "./rosterImport.js";

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
