import test from "node:test";
import assert from "node:assert/strict";
import { requirePaidGeminiService } from "./geminiDataTerms.js";

test("Gemini child-data processing fails closed without an exact paid-service confirmation", () => {
  for (const value of [undefined, "", "false", "TRUE", "yes"]) {
    assert.throws(() => requirePaidGeminiService(value), /paid-service data terms/);
  }
  assert.doesNotThrow(() => requirePaidGeminiService("true"));
});
