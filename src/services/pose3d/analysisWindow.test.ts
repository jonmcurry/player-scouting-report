import test from "node:test";
import assert from "node:assert/strict";
import { analysisWindowFor, rawFrameIndices } from "./analysisWindow.js";

const RAW = "videos\\_uploads\\clip.mp4";
const TRIM = "frames\\p\\clip\\_trimmed_input.mp4";
const DEC = "frames\\p\\clip\\_decimated_input.mp4";

test("untrimmed clip analyzed directly: start 0, step 1", () => {
  assert.deepEqual(analysisWindowFor({ rawVideoPath: RAW, analyzedVideoPath: RAW, stage0: null, decimate: null }), { startS: 0, frameStep: 1 });
  assert.deepEqual(analysisWindowFor({ rawVideoPath: "videos/_uploads/clip.mp4", analyzedVideoPath: RAW, stage0: null, decimate: null }), { startS: 0, frameStep: 1 }, "separator differences don't matter");
});

test("Stage 0 trimmed window: start is the window start", () => {
  const stage0 = { video_path_for_pipeline: TRIM, trim_start_s: 32.864 };
  assert.deepEqual(analysisWindowFor({ rawVideoPath: RAW, analyzedVideoPath: TRIM, stage0, decimate: { decimated: false } }), { startS: 32.864, frameStep: 1 });
});

test("ambiguous Stage 0: the candidate that was actually analyzed sets the start", () => {
  const stage0 = {
    video_path_for_pipeline: "frames\\p\\clip\\_candidate_0.mp4", trim_start_s: 10,
    candidate_windows: [
      { video_path_for_pipeline: "frames\\p\\clip\\_candidate_0.mp4", trim_start_s: 10 },
      { video_path_for_pipeline: "frames\\p\\clip\\_candidate_1.mp4", trim_start_s: 400 },
    ],
  };
  assert.deepEqual(analysisWindowFor({ rawVideoPath: RAW, analyzedVideoPath: "frames\\p\\clip\\_candidate_1.mp4", stage0, decimate: null }), { startS: 400, frameStep: 1 });
  assert.deepEqual(analysisWindowFor({ rawVideoPath: RAW, analyzedVideoPath: "frames\\p\\clip\\_candidate_0.mp4", stage0, decimate: null }), { startS: 10, frameStep: 1 }, "top-level entry repeating a candidate agrees with it");
});

test("two recorded windows with the same file but different starts fail closed", () => {
  const stage0 = { video_path_for_pipeline: TRIM, trim_start_s: 10, candidate_windows: [{ video_path_for_pipeline: TRIM, trim_start_s: 400 }] };
  assert.equal(analysisWindowFor({ rawVideoPath: RAW, analyzedVideoPath: TRIM, stage0, decimate: null }), null);
});

test("decimated copy maps back through the file it was made from, with its factor as the step", () => {
  const stage0 = { video_path_for_pipeline: TRIM, trim_start_s: 5 };
  assert.deepEqual(analysisWindowFor({ rawVideoPath: RAW, analyzedVideoPath: DEC, stage0, decimate: { decimated: true, original_video_path: TRIM, decimation_factor: 4 } }), { startS: 5, frameStep: 4 });
  assert.deepEqual(analysisWindowFor({ rawVideoPath: RAW, analyzedVideoPath: DEC, stage0: null, decimate: { decimated: true, original_video_path: RAW, decimation_factor: 2 } }), { startS: 0, frameStep: 2 });
  assert.equal(analysisWindowFor({ rawVideoPath: RAW, analyzedVideoPath: DEC, stage0: null, decimate: { decimated: true, original_video_path: RAW, decimation_factor: null } }), null, "unknown factor");
});

test("unknown alignment fails closed", () => {
  assert.equal(analysisWindowFor({ rawVideoPath: RAW, analyzedVideoPath: "elsewhere.mp4", stage0: null, decimate: null }), null);
  assert.equal(analysisWindowFor({ rawVideoPath: RAW, analyzedVideoPath: TRIM, stage0: { video_path_for_pipeline: "other.mp4", trim_start_s: 3 }, decimate: null }), null);
  assert.equal(analysisWindowFor({ rawVideoPath: RAW, analyzedVideoPath: TRIM, stage0: { video_path_for_pipeline: TRIM, trim_start_s: null }, decimate: null }), null);
});

test("rawFrameIndices: first raw frame at/after the window start, then one-to-one (or every step-th)", () => {
  // Variable frame rate: gaps differ, so index != time * fps.
  const pts = [0, 0.033, 0.07, 0.1, 0.135, 0.167, 0.2, 0.24, 0.27, 0.3];
  assert.deepEqual(rawFrameIndices({ startS: 0, frameStep: 1 }, pts, [0, 3, 9]), [0, 3, 9]);
  assert.deepEqual(rawFrameIndices({ startS: 0.1, frameStep: 1 }, pts, [0, 2]), [3, 5]);
  assert.deepEqual(rawFrameIndices({ startS: 0.0995, frameStep: 1 }, pts, [0]), [3], "start rounded to ms like Stage 0's ffmpeg call");
  assert.deepEqual(rawFrameIndices({ startS: 0, frameStep: 2 }, pts, [0, 1, 4]), [0, 2, 8]);
  assert.equal(rawFrameIndices({ startS: 0.2, frameStep: 1 }, pts, [5]), null, "past the end");
  assert.equal(rawFrameIndices({ startS: 5, frameStep: 1 }, pts, [0]), null, "window starts after the video");
});
