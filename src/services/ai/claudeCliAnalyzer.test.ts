import assert from "node:assert/strict";
import test from "node:test";
import { resolvedModelIds } from "./claudeCliAnalyzer.js";

test("resolvedModelIds records every concrete model the CLI reported, sorted", () => {
  assert.equal(
    resolvedModelIds({ modelUsage: { "claude-sonnet-5": {}, "claude-haiku-4-5-20251001": {} } }),
    "claude-haiku-4-5-20251001,claude-sonnet-5",
  );
});

test("resolvedModelIds is null, not the alias, when the CLI reported no usage", () => {
  assert.equal(resolvedModelIds({}), null);
  assert.equal(resolvedModelIds({ modelUsage: {} }), null);
});
