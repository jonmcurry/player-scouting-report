import test from "node:test";
import assert from "node:assert/strict";
import { agyModelSource, agyResponseText, getConfiguredAgyModel, requireAgyDataConfirmation } from "./agyCliAnalyzer.js";

test("agy backend refuses to send swing images without the explicit data opt-in", () => {
  assert.throws(() => requireAgyDataConfirmation({}), /AGY_ANALYZER_DATA_CONFIRMED=true/);
  assert.throws(() => requireAgyDataConfirmation({ AGY_ANALYZER_DATA_CONFIRMED: "false" }), /AGY_ANALYZER_DATA_CONFIRMED/);
  // A paid-Gemini-API confirmation does not cover the Antigravity account.
  assert.throws(() => requireAgyDataConfirmation({ GEMINI_PAID_SERVICE_CONFIRMED: "true" }), /AGY_ANALYZER_DATA_CONFIRMED/);
  assert.doesNotThrow(() => requireAgyDataConfirmation({ AGY_ANALYZER_DATA_CONFIRMED: "true" }));
});

test("agy model must be explicit and its source is the answering model family", () => {
  assert.throws(() => getConfiguredAgyModel({}), /AGY_ANALYZER_MODEL/);
  assert.equal(getConfiguredAgyModel({ AGY_ANALYZER_MODEL: " gemini-3.1-pro-high " }), "gemini-3.1-pro-high");
  assert.equal(agyModelSource("gemini-3.1-pro-high"), "gemini");
  assert.equal(agyModelSource("claude-sonnet-5-5-high"), "claude");
  assert.throws(() => agyModelSource("gpt-oss-120b-medium"), /no matching analysis source/);
});

test("only a SUCCESS envelope with a response counts as an analysis", () => {
  assert.equal(agyResponseText(JSON.stringify({ status: "SUCCESS", response: "{\"a\":1}" })), "{\"a\":1}");
  assert.throws(() => agyResponseText(JSON.stringify({ status: "TIMEOUT", response: "{\"partial\":" })), /did not complete/);
  assert.throws(() => agyResponseText(JSON.stringify({ status: "SUCCESS", response: "  " })), /did not complete/);
  assert.throws(() => agyResponseText("[agy] print timeout after 300s"), /wasn't valid JSON/);
});
