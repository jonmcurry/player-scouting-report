import { test } from "node:test";
import assert from "node:assert/strict";
import { sharedPlayerName } from "../functions/get-player-report/shape.ts";

test("shared report name contains only the first name and last initial", () => {
  assert.equal(sharedPlayerName("Maya Davis"), "Maya D.");
  assert.equal(sharedPlayerName("  Maya  Ann  Davis "), "Maya D.");
  assert.equal(sharedPlayerName("Maya"), "Maya");
  assert.equal(sharedPlayerName(""), "");
});
