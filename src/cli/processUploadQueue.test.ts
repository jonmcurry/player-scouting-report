import test from "node:test";
import assert from "node:assert/strict";
import os from "node:os";
import path from "node:path";
import { containerStartS, pipelineProgressFromOutput, startOffsetSupported } from "./processUploadQueue.js";

test("v2 stills are only extracted when the container starts within 1 ms of zero; unreadable fails closed", async () => {
  for (const ok of [0, 0.0009, -0.0009, 0.001]) assert.equal(startOffsetSupported(ok), true, String(ok));
  // Measured: a 1.5 s start made the load still show 45 frames late. Negative and unreadable starts fail closed too.
  for (const bad of [0.0011, -0.0011, -0.05, 1.5, Number.NaN, Number.POSITIVE_INFINITY]) assert.equal(startOffsetSupported(bad), false, String(bad));
  // A file that can't be probed (missing here, whether or not ffprobe is installed) reads as unknown.
  assert.ok(Number.isNaN(await containerStartS(path.join(os.tmpdir(), `no-such-upload-${process.pid}.mp4`))));
});

test("pipeline output maps only completed stage starts to monotonic progress milestones", () => {
  assert.deepEqual(pipelineProgressFromOutput("--- Stage 0/4: locate ---\n--- Stage 1/4: detect ---"), [30, 45]);
  assert.deepEqual(pipelineProgressFromOutput("--- Stage 3.5/4: refine ---\n--- Stage 4/4: overlay ---"), [82, 88]);
  assert.deepEqual(pipelineProgressFromOutput("ordinary pipeline log output"), []);
});
