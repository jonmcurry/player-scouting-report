import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import { acceptedVideoUpload, VIDEO_UPLOAD_HELP } from "./uploadPolicy.js";

test("browser and Edge upload policies are exact drift-guarded copies", () => {
  const browser = fs.readFileSync(new URL("./uploadPolicy.js", import.meta.url), "utf8").replaceAll("\r\n", "\n");
  const edge = fs.readFileSync(new URL("../../supabase/functions/_shared/uploadPolicy.ts", import.meta.url), "utf8").replaceAll("\r\n", "\n");
  assert.equal(edge, browser);
});

test("supported video uploads normalize extension and preserve an allowed MIME type", () => {
  assert.deepEqual(acceptedVideoUpload(".MOV", "video/quicktime"), { extension: ".mov", contentType: "video/quicktime" });
  assert.deepEqual(acceptedVideoUpload(".m4v", "video/x-m4v"), { extension: ".m4v", contentType: "video/x-m4v" });
  assert.deepEqual(acceptedVideoUpload(".webm", "video/webm"), { extension: ".webm", contentType: "video/webm" });
});

test("known phone video extensions supply a canonical type when metadata is absent", () => {
  assert.deepEqual(acceptedVideoUpload(".mp4", ""), { extension: ".mp4", contentType: "video/mp4" });
  assert.deepEqual(acceptedVideoUpload(".mov", null), { extension: ".mov", contentType: "video/quicktime" });
});

test("unsupported extensions and mismatched MIME claims fail closed", () => {
  for (const input of [[".avi", "video/avi"], [".exe", "video/mp4"], [".mp4", "text/plain"], [".mov", "video/mp4"]]) {
    assert.equal(acceptedVideoUpload(...input), null);
  }
  assert.match(VIDEO_UPLOAD_HELP, /MP4.*MOV.*WebM/);
});
