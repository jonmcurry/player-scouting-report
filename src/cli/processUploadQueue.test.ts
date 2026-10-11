import test from "node:test";
import assert from "node:assert/strict";
import { pipelineProgressFromOutput } from "./processUploadQueue.js";

test("pipeline output maps only completed stage starts to monotonic progress milestones", () => {
  assert.deepEqual(pipelineProgressFromOutput("--- Stage 0/4: locate ---\n--- Stage 1/4: detect ---"), [30, 45]);
  assert.deepEqual(pipelineProgressFromOutput("--- Stage 3.5/4: refine ---\n--- Stage 4/4: overlay ---"), [82, 88]);
  assert.deepEqual(pipelineProgressFromOutput("ordinary pipeline log output"), []);
});
